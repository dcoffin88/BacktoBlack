import sqlite3 from 'sqlite3';

const DB_FILE = 'backtoblack.db';

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the backtoblack database.');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      household_id TEXT,
      name TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS liabilities (
      id TEXT PRIMARY KEY,
      content TEXT,
      user_id INTEGER,
      household_id TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      content TEXT,
      user_id INTEGER,
      household_id TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      content TEXT,
      user_id INTEGER,
      household_id TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      content TEXT,
      user_id INTEGER,
      household_id TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS incomes (
      id TEXT PRIMARY KEY,
      content TEXT,
      user_id INTEGER,
      household_id TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS household_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_id INTEGER,
      inviter_email TEXT,
      invitee_email TEXT,
      household_id TEXT,
      token TEXT,
      status TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS budget_checks (
      id TEXT PRIMARY KEY,
      check_date TEXT,
      expense_checks TEXT,
      liability_checks TEXT,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS budget_extra_payments (
      id TEXT PRIMARY KEY,
      liability_id TEXT,
      amount REAL,
      check_date TEXT,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS budget_amortization_overrides (
      id TEXT PRIMARY KEY,
      liability_id TEXT,
      period INTEGER,
      payment REAL,
      purchase REAL,
      interest REAL,
      check_date TEXT,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )
  `);

  console.log('Database tables created successfully.');
});

db.close((err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Closed the database connection.');
});
