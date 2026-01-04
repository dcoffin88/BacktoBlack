import 'dotenv/config';
import express from 'express';
import sqlite3 from 'sqlite3';
import { Liability, Expense, Asset, UserSettings, IncomeSource } from '../types';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const app = express();
const port = 3001;
const DB_FILE = 'backtoblack.db';
const JWT_SECRET = 'your_jwt_secret'; // Replace with a strong secret in a real application

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the backtoblack database.');
});

// Ensure legacy databases have the name column on users (added after initial release)
const ensureUserNameColumn = () => {
  db.all('PRAGMA table_info(users)', (tableErr, rows) => {
    if (tableErr) {
      console.error('Failed to inspect users table:', tableErr.message);
      return;
    }
    const hasName = rows.some((r: any) => r.name === 'name');
    if (!hasName) {
      db.run('ALTER TABLE users ADD COLUMN name TEXT', (alterErr) => {
        if (alterErr) {
          console.error('Failed to add name column to users table:', alterErr.message);
        } else {
          console.log('Added name column to users table.');
        }
      });
    }
  });
};
ensureUserNameColumn();

app.use(express.json());

type AuthedUser = { id: number; email: string; householdId?: string | null };
type AuthedRequest = express.Request & { user?: AuthedUser };

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

const generateHouseholdId = () => {
  try {
    return randomUUID();
  } catch {
    return `hh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
};

const migrateHousehold = (
  scopeHousehold: string,
  userAId: number,
  userBId: number,
  currentHouseholdA?: string | null,
  currentHouseholdB?: string | null
) => {
  db.run('UPDATE users SET household_id = ? WHERE id IN (?, ?)', [scopeHousehold, userAId, userBId]);

  const migrateTables = ['liabilities', 'expenses', 'assets', 'settings', 'incomes'];
  migrateTables.forEach((table) => {
    db.run(
      `UPDATE ${table} SET household_id = ? WHERE user_id IN (?, ?) OR household_id IN (?, ?)`,
      [scopeHousehold, userAId, userBId, currentHouseholdA || scopeHousehold, currentHouseholdB || scopeHousehold],
      (updateErr) => {
        if (updateErr) {
          console.error(`Failed to migrate ${table}:`, updateErr.message);
        }
      }
    );
  });
};

const normalizeIncomeSources = (
  sources: IncomeSource[] = [],
  userId: number,
  partnerId?: number | null,
  fallbackOwnerId?: number | null
) => {
  return sources.map((source) => {
    const existingOwnerId = (source as any).ownerId as number | undefined;
    const derivedOwnerId =
      existingOwnerId
      ?? ((source.isPartner && partnerId) ? partnerId : undefined)
      ?? (fallbackOwnerId ?? userId);
    const isPartner = derivedOwnerId !== userId;

    return { ...source, ownerId: derivedOwnerId, isPartner };
  });
};

// --- Auth ---
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const householdId = generateHouseholdId();
    db.run('INSERT INTO users (email, password, household_id) VALUES (?, ?, ?)', [email, hashedPassword, householdId], function(err) {
      if (err) {
        console.error(err);
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ id: this.lastID, email, householdId });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, (user as any).password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Extend token lifetime so sessions survive reboots
    const token = jwt.sign({ id: (user as any).id, email: (user as any).email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, householdId: (user as any).household_id || null });
  });
});

const authenticateToken = (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, payload: any) => {
    if (err) return res.sendStatus(403);

    db.get('SELECT id, email, household_id FROM users WHERE id = ?', [payload.id], (dbErr, userRow) => {
      if (dbErr) {
        return res.status(500).json({ error: dbErr.message });
      }
      if (!userRow) {
        return res.sendStatus(401);
      }
      req.user = { id: (userRow as any).id, email: (userRow as any).email, householdId: (userRow as any).household_id };
      next();
    });
  });
};

// --- Profile ---
app.get('/api/profile', authenticateToken, (req, res) => {
  const user = req.user!;
  db.get('SELECT id, email, name FROM users WHERE id = ?', [user.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

app.put('/api/profile', authenticateToken, (req, res) => {
  const user = req.user!;
  const { name, email } = req.body;
  
  db.run('UPDATE users SET name = ?, email = ? WHERE id = ?', [name, email, user.id], (err) => {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

app.put('/api/profile/password', authenticateToken, async (req, res) => {
  const user = req.user!;
  const { currentPassword, newPassword } = req.body;

  if (!newPassword) return res.status(400).json({ error: 'New password required' });

  db.get('SELECT password FROM users WHERE id = ?', [user.id], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const isMatch = await bcrypt.compare(currentPassword, (row as any).password);
    if (!isMatch) return res.status(401).json({ error: 'Current password incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id], (updateErr) => {
      if (updateErr) return res.status(500).json({ error: updateErr.message });
      res.json({ success: true });
    });
  });
});


// --- Liabilities ---
app.get('/api/liabilities', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  db.all('SELECT content FROM liabilities WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)', [scopeId, user.id], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const liabilities = rows.map(row => JSON.parse((row as any).content));
    res.json(liabilities);
  });
});

app.post('/api/liabilities', authenticateToken, (req: AuthedRequest, res) => {
  const liability: Liability = req.body;
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  const payload = { ...liability, householdId: scopeId };
  db.run('INSERT OR REPLACE INTO liabilities (id, content, user_id, household_id) VALUES (?, ?, ?, ?)', [liability.id, JSON.stringify(payload), user.id, scopeId], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(payload);
  });
});

app.delete('/api/liabilities/:id', authenticateToken, (req: AuthedRequest, res) => {
  const { id } = req.params;
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  db.run('DELETE FROM liabilities WHERE id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)', [id, scopeId, user.id], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ id });
  });
});

// --- Expenses ---
app.get('/api/expenses', authenticateToken, (req: AuthedRequest, res) => {
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    db.all('SELECT content FROM expenses WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)', [scopeId, user.id], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const expenses = rows.map(row => JSON.parse((row as any).content));
        res.json(expenses);
    });
});

app.post('/api/expenses', authenticateToken, (req: AuthedRequest, res) => {
    const expense: Expense = req.body;
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    const payload = { ...expense, householdId: scopeId };
    db.run('INSERT OR REPLACE INTO expenses (id, content, user_id, household_id) VALUES (?, ?, ?, ?)', [expense.id, JSON.stringify(payload), user.id, scopeId], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(payload);
    });
});

app.delete('/api/expenses/:id', authenticateToken, (req: AuthedRequest, res) => {
    const { id } = req.params;
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    db.run('DELETE FROM expenses WHERE id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)', [id, scopeId, user.id], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ id });
    });
});

// --- Assets ---
app.get('/api/assets', authenticateToken, (req: AuthedRequest, res) => {
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    db.all('SELECT content FROM assets WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)', [scopeId, user.id], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const assets = rows.map(row => JSON.parse((row as any).content));
        res.json(assets);
    });
});

app.post('/api/assets', authenticateToken, (req: AuthedRequest, res) => {
    const asset: Asset = req.body;
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    const payload = { ...asset, householdId: scopeId };
    db.run('INSERT OR REPLACE INTO assets (id, content, user_id, household_id) VALUES (?, ?, ?, ?)', [asset.id, JSON.stringify(payload), user.id, scopeId], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(payload);
    });
});

app.delete('/api/assets/:id', authenticateToken, (req: AuthedRequest, res) => {
    const { id } = req.params;
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    db.run('DELETE FROM assets WHERE id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)', [id, scopeId, user.id], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ id });
    });
});

// --- Incomes ---
app.get('/api/incomes', authenticateToken, (req: AuthedRequest, res) => {
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    db.all('SELECT content, user_id FROM incomes WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)', [scopeId, user.id], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const incomes = rows.map(row => {
          const parsed = JSON.parse((row as any).content) as IncomeSource;
          const ownerId = (parsed as any).ownerId ?? (row as any).user_id;
          // Partner status is relative to the requesting user
          const derivedIsPartner = ownerId !== user.id;
          return { ...parsed, ownerId, isPartner: derivedIsPartner };
        });
        res.json(incomes);
    });
});

app.post('/api/incomes', authenticateToken, (req: AuthedRequest, res) => {
    const income: IncomeSource = req.body;
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    const persist = (partnerId: number | null) => {
      // If partner is checked but we can't find a partner id, store with a placeholder ownerId (-1) so it stays classified as partner
      const derivedOwnerId = income.isPartner ? (partnerId ?? -1) : user.id;
      const payload = { ...income, ownerId: derivedOwnerId, householdId: scopeId, isPartner: income.isPartner };
      db.run('INSERT OR REPLACE INTO incomes (id, content, user_id, household_id) VALUES (?, ?, ?, ?)', [income.id, JSON.stringify(payload), derivedOwnerId, scopeId], (err) => {
          if (err) {
              res.status(500).json({ error: err.message });
              return;
          }
          res.json(payload);
      });
    };

    if (user.householdId) {
      db.get('SELECT id FROM users WHERE household_id = ? AND id != ? LIMIT 1', [user.householdId, user.id], (partnerErr, partnerRow) => {
        if (partnerErr) {
          res.status(500).json({ error: partnerErr.message });
          return;
        }
        const partnerId = partnerRow ? (partnerRow as any).id : null;
        persist(partnerId);
      });
    } else {
      persist(null);
    }
});

app.delete('/api/incomes/:id', authenticateToken, (req: AuthedRequest, res) => {
    const { id } = req.params;
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    db.run('DELETE FROM incomes WHERE id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)', [id, scopeId, user.id], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ id });
    });
});

// --- Settings ---
app.get('/api/settings', authenticateToken, (req: AuthedRequest, res) => {
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    const fetchAndReturn = (partnerId: number | null, partnerName?: string) => {
      db.get("SELECT content, user_id FROM settings WHERE household_id = ? OR id = 'user_settings' ORDER BY household_id IS NULL LIMIT 1", [scopeId], (err, row) => {
          if (err) {
              res.status(500).json({ error: err.message });
              return;
          }
          
          if (!row && !user.householdId) {
              res.json(null);
              return;
          }

          const settings: UserSettings = row 
            ? JSON.parse((row as any).content) 
            : { 
                monthlyBudget: 0, 
                emailReports: false, 
                email: user.email, 
                incomeSources: [],
                useSimpleTerms: false,
                currencySymbol: '$'
            };

          if (settings.useSimpleTerms === undefined) settings.useSimpleTerms = false;
          if (!settings.currencySymbol) settings.currencySymbol = '$';
          
          // Force enable partner mode if household is present
          if (user.householdId) {
              settings.enablePartner = true;
              settings.householdId = user.householdId;
              settings.partnerLinked = true;
              // Override partner name if available from their profile
              if (partnerName) {
                settings.partnerName = partnerName;
              }
          }

          const rowOwnerId = row ? (row as any).user_id as number | null : null;
          const incomeSources = normalizeIncomeSources(settings.incomeSources || [], user.id, partnerId, rowOwnerId);
          res.json({ ...settings, incomeSources });
      });
    };

    if (user.householdId) {
      db.get('SELECT id FROM users WHERE household_id = ? AND id != ? LIMIT 1', [user.householdId, user.id], (partnerErr, partnerRow) => {
        if (partnerErr) {
          res.status(500).json({ error: partnerErr.message });
          return;
        }
        const partnerId = partnerRow ? (partnerRow as any).id : null;
        const partnerName = partnerRow ? (partnerRow as any).name : undefined;
        fetchAndReturn(partnerId, partnerName);
      });
    } else {
      fetchAndReturn(null);
    }
});

app.post('/api/settings', authenticateToken, (req: AuthedRequest, res) => {
    const settings: UserSettings = req.body;
    const user = req.user!;
    const scopeId = user.householdId || user.id;
    const persist = (partnerId: number | null) => {
      const normalizedSettings: UserSettings = {
        useSimpleTerms: false,
        currencySymbol: '$',
        ...settings,
      };

      const incomeSources = normalizeIncomeSources(settings.incomeSources || [], user.id, partnerId);
      const payload = { ...normalizedSettings, householdId: scopeId, incomeSources };
      db.run("INSERT OR REPLACE INTO settings (id, content, user_id, household_id) VALUES (?, ?, ?, ?)", [scopeId.toString(), JSON.stringify(payload), user.id, scopeId], (err) => {
          if (err) {
              res.status(500).json({ error: err.message });
              return;
          }
          res.json(payload);
      });
    };

    if (user.householdId) {
      db.get('SELECT id FROM users WHERE household_id = ? AND id != ? LIMIT 1', [user.householdId, user.id], (partnerErr, partnerRow) => {
        if (partnerErr) {
          res.status(500).json({ error: partnerErr.message });
          return;
        }
        const partnerId = partnerRow ? (partnerRow as any).id : null;
        persist(partnerId);
      });
    } else {
      persist(null);
    }
});

// --- Household Linking ---
app.post('/api/household/join', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const { partnerEmail } = req.body as { partnerEmail?: string };
  if (!partnerEmail) {
    return res.status(400).json({ error: 'partnerEmail is required' });
  }

  db.get('SELECT id, email, household_id FROM users WHERE email = ?', [partnerEmail], (err, partnerRow) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!partnerRow) {
      return res.status(404).json({ error: 'Partner account not found' });
    }

    const partner = partnerRow as any;
    const targetHousehold = user.householdId || partner.household_id || generateHouseholdId();
    const partnerHousehold = partner.household_id || null;
    const currentHousehold = user.householdId || null;

    db.serialize(() => {
      migrateHousehold(targetHousehold, user.id, partner.id, currentHousehold, partnerHousehold);

      // Ensure there is a settings row for the household (prefer existing user settings)
      db.get(
        'SELECT content FROM settings WHERE household_id IN (?, ?) OR id = ? LIMIT 1',
        [currentHousehold, partnerHousehold, 'user_settings'],
        (settingsErr, settingsRow) => {
          if (settingsErr) {
            console.error('Settings migration warning:', settingsErr.message);
          } else if (settingsRow) {
            const merged = { 
                ...JSON.parse((settingsRow as any).content), 
                householdId: targetHousehold,
                enablePartner: true,
                partnerLinked: true
            };
            db.run(
              'INSERT OR REPLACE INTO settings (id, content, user_id, household_id) VALUES (?, ?, ?, ?)',
              [targetHousehold.toString(), JSON.stringify(merged), user.id, targetHousehold]
            );
          }
          res.json({ householdId: targetHousehold });
        }
      );
    });
  });
});

// --- Household Invite/Accept ---
app.post('/api/household/invite', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const { partnerEmail } = req.body as { partnerEmail?: string };
  if (!partnerEmail) {
    return res.status(400).json({ error: 'partnerEmail is required' });
  }
  if (partnerEmail === user.email) {
    return res.status(400).json({ error: 'Cannot invite yourself' });
  }

  const token = generateHouseholdId();
  const targetHousehold = user.householdId || token;

  db.run(
    'INSERT INTO household_invites (inviter_id, inviter_email, invitee_email, household_id, token, status) VALUES (?, ?, ?, ?, ?, ?)',
    [user.id, user.email, partnerEmail, targetHousehold, token, 'PENDING'],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create invite' });
      }
      res.json({ token, householdId: targetHousehold });
    }
  );
});

app.get('/api/household/invites', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  db.all(
    'SELECT * FROM household_invites WHERE (invitee_email = ? OR inviter_id = ?) AND status = "PENDING"',
    [user.email, user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const invites = rows.map((row: any) => ({
        token: row.token,
        status: row.status,
        inviterEmail: row.inviter_email,
        inviteeEmail: row.invitee_email,
        householdId: row.household_id,
        isIncoming: row.invitee_email === user.email
      }));
      res.json(invites);
    }
  );
});

app.post('/api/household/accept', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const { token } = req.body as { token?: string };
  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }
  db.get(
    'SELECT * FROM household_invites WHERE token = ? AND status = "PENDING"',
    [token],
    (err, inviteRow) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!inviteRow) {
        return res.status(404).json({ error: 'Invite not found or already handled' });
      }
      const invite: any = inviteRow;
      if (invite.invitee_email !== user.email) {
        return res.status(403).json({ error: 'Invite not addressed to this user' });
      }

      db.get('SELECT id, email, household_id FROM users WHERE id = ?', [invite.inviter_id], (inviterErr, inviterRow) => {
        if (inviterErr) {
          return res.status(500).json({ error: inviterErr.message });
        }
        if (!inviterRow) {
          return res.status(404).json({ error: 'Inviter not found' });
        }

        const inviter: any = inviterRow;
        const targetHousehold = invite.household_id || inviter.household_id || user.householdId || generateHouseholdId();
        migrateHousehold(targetHousehold, inviter.id, user.id, inviter.household_id, user.householdId);

        db.run('UPDATE household_invites SET status = "ACCEPTED", household_id = ? WHERE token = ?', [targetHousehold, token]);

        db.get(
          'SELECT content FROM settings WHERE household_id IN (?, ?) OR id = ? LIMIT 1',
          [inviter.household_id, user.householdId, 'user_settings'],
          (settingsErr, settingsRow) => {
            if (settingsErr) {
              console.error('Settings migration warning:', settingsErr.message);
            } else if (settingsRow) {
              const merged = { 
                  ...JSON.parse((settingsRow as any).content), 
                  householdId: targetHousehold,
                  enablePartner: true,
                  partnerLinked: true
              };
              db.run(
                'INSERT OR REPLACE INTO settings (id, content, user_id, household_id) VALUES (?, ?, ?, ?)',
                [targetHousehold.toString(), JSON.stringify(merged), user.id, targetHousehold]
              );
            }
            res.json({ householdId: targetHousehold });
          }
        );
      });
    }
  );
});

app.post('/api/household/decline', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const { token } = req.body as { token?: string };
  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }
  db.get(
    'SELECT * FROM household_invites WHERE token = ? AND status = "PENDING"',
    [token],
    (err, inviteRow) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!inviteRow) {
        return res.status(404).json({ error: 'Invite not found or already handled' });
      }
      const invite: any = inviteRow;
      if (invite.invitee_email !== user.email) {
        return res.status(403).json({ error: 'Invite not addressed to this user' });
      }
      db.run('UPDATE household_invites SET status = "DECLINED" WHERE token = ?', [token], (updateErr) => {
        if (updateErr) {
          return res.status(500).json({ error: updateErr.message });
        }
        db.run('UPDATE users SET household_id = NULL WHERE email = ? AND household_id = ?', [invite.invitee_email, invite.household_id], (clearErr) => {
          if (clearErr) {
            console.error('Failed to clear invitee household on decline', clearErr.message);
          }
          res.json({ token, status: 'DECLINED' });
        });
      });
    }
  );
});

app.post('/api/household/invite/cancel', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const { token } = req.body as { token?: string };
  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  db.get('SELECT * FROM household_invites WHERE token = ? AND status = "PENDING"', [token], (err, inviteRow) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!inviteRow) {
      return res.status(404).json({ error: 'Invite not found or already handled' });
    }
    const invite: any = inviteRow;
    const isParticipant = invite.inviter_id === user.id || invite.invitee_email === user.email;
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized to cancel this invite' });
    }
    db.run('UPDATE household_invites SET status = "CANCELLED" WHERE token = ?', [token], (updateErr) => {
      if (updateErr) {
        return res.status(500).json({ error: updateErr.message });
      }
      db.run('UPDATE users SET household_id = NULL WHERE email = ? AND household_id = ?', [invite.invitee_email, invite.household_id], (clearErr) => {
        if (clearErr) {
          console.error('Failed to clear invitee household on cancel', clearErr.message);
        }
        res.json({ token, status: 'CANCELLED' });
      });
    });
  });
});

app.post('/api/household/leave', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  if (!user.householdId) {
    return res.status(400).json({ error: 'Not part of a household' });
  }

  const householdId = user.householdId;

  db.all('SELECT id FROM users WHERE household_id = ?', [householdId], (memberErr, memberRows) => {
    if (memberErr) {
      return res.status(500).json({ error: memberErr.message });
    }
    const memberIds: number[] = memberRows.map((r: any) => r.id);

    db.serialize(() => {
      // Clear household for all members
      db.run('UPDATE users SET household_id = NULL WHERE household_id = ?', [householdId]);

      // Detach shared records for all members
      const tables = ['liabilities', 'expenses', 'assets', 'incomes'];
      tables.forEach((table) => {
        db.run(
          `UPDATE ${table} SET household_id = NULL WHERE household_id = ?`,
          [householdId],
          (err) => {
            if (err) {
              console.error(`Failed to move ${table} to standalone`, err.message);
            }
          }
        );
      });

      // Copy settings to standalone (terminate partnership flags)
      db.get('SELECT content FROM settings WHERE household_id = ? LIMIT 1', [householdId], (err, row) => {
        if (err) {
          console.error('Failed to fetch settings for leave household', err.message);
        }
        if (row) {
          const cloned = {
            ...JSON.parse((row as any).content),
            householdId: undefined,
            enablePartner: false,
            partnerLinked: false,
          };
          db.run(
            'INSERT OR REPLACE INTO settings (id, content, user_id, household_id) VALUES (?, ?, ?, NULL)',
            ['user_settings', JSON.stringify(cloned), user.id]
          );
        } else {
          // Ensure a basic settings row exists post-leave
          db.run(
            'INSERT OR REPLACE INTO settings (id, content, user_id, household_id) VALUES (?, ?, ?, NULL)',
            ['user_settings', JSON.stringify({ householdId: undefined, enablePartner: false, partnerLinked: false }), user.id]
          );
        }
        // Cancel pending invites tied to this household
        db.run('UPDATE household_invites SET status = "CANCELLED" WHERE household_id = ?', [householdId], () => {
          res.json({ householdId: null, membersUnlinked: memberIds });
        });
      });
    });
  });
});


app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
