import 'dotenv/config';
import express from 'express';
import sqlite3 from 'sqlite3';
import { Liability, Expense, Asset, UserSettings, IncomeSource, BudgetSchedule, StrategyType, PayoffResult } from '../types';
import { calculateIndividualAmortization, AmortizationRow, calculatePayoff } from './liabilityAlgorithms';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';

import { startScheduler, triggerMonthlyReportForUser, triggerTransferReportForUser, getAvailableChequeDates } from './scheduler';

const app = express();
const port = 3001;
const DB_FILE = 'backtoblack.db';
const JWT_SECRET = 'your_jwt_secret'; // Replace with a strong secret in a real application
const toLocalDateString = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split('T')[0];
const todayIso = toLocalDateString(new Date());

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the backtoblack database.');
  startScheduler(db);
});

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

const ensureBudgetChequesTable = () => {
  db.run(
    `CREATE TABLE IF NOT EXISTS budget_cheques (
      id TEXT PRIMARY KEY,
      cheque_date TEXT,
      expense_cheques TEXT,
      liability_cheques TEXT,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )`,
    (err) => {
      if (err) {
        console.error('Failed to ensure budget_cheques table:', err.message);
      }
    }
  );
};
ensureBudgetChequesTable();

const ensureBudgetExtrasTable = () => {
  db.run(
    `CREATE TABLE IF NOT EXISTS budget_extra_payments (
      id TEXT PRIMARY KEY,
      liability_id TEXT,
      amount REAL,
      cheque_date TEXT,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )`,
    (err) => {
      if (err) {
        console.error('Failed to ensure budget_extra_payments table:', err.message);
      }
    }
  );
};
ensureBudgetExtrasTable();

const ensureBudgetExtrasCheckedColumn = () => {
  db.all('PRAGMA table_info(budget_extra_payments)', (tableErr, rows) => {
    if (tableErr) {
      console.error('Failed to inspect budget_extra_payments table:', tableErr.message);
      return;
    }
    const hasChecked = rows.some((r: any) => r.name === 'is_checked');
    if (!hasChecked) {
      db.run('ALTER TABLE budget_extra_payments ADD COLUMN is_checked INTEGER DEFAULT 1', (alterErr) => {
        if (alterErr) {
          console.error('Failed to add is_checked column to budget_extra_payments table:', alterErr.message);
        } else {
          console.log('Added is_checked column to budget_extra_payments table.');
        }
      });
    }
  });
};
ensureBudgetExtrasCheckedColumn();

const ensureBudgetExtrasIncomeSourceColumn = () => {
  db.all('PRAGMA table_info(budget_extra_payments)', (tableErr, rows) => {
    if (tableErr) {
      console.error('Failed to inspect budget_extra_payments table:', tableErr.message);
      return;
    }
    const hasCol = rows.some((r: any) => r.name === 'income_source_id');
    if (!hasCol) {
      db.run('ALTER TABLE budget_extra_payments ADD COLUMN income_source_id TEXT', (alterErr) => {
        if (alterErr) {
          console.error('Failed to add income_source_id column to budget_extra_payments table:', alterErr.message);
        } else {
          console.log('Added income_source_id column to budget_extra_payments table.');
        }
      });
    }
  });
};
ensureBudgetExtrasIncomeSourceColumn();

const ensureBudgetAmortizationOverridesTable = () => {
  db.run(
    `CREATE TABLE IF NOT EXISTS budget_amortization_overrides (
      id TEXT PRIMARY KEY,
      liability_id TEXT,
      period INTEGER,
      payment REAL,
      purchase REAL,
      interest REAL,
      cheque_date TEXT,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )`,
    (err) => {
      if (err) {
        console.error('Failed to ensure budget_amortization_overrides table:', err.message);
      }
    }
  );
};
ensureBudgetAmortizationOverridesTable();

const ensureBudgetAmortizationOverridesPurchaseColumn = () => {
  db.all('PRAGMA table_info(budget_amortization_overrides)', (tableErr, rows) => {
    if (tableErr) {
      console.error('Failed to inspect amortization overrides table:', tableErr.message);
      return;
    }
    const hasPurchase = rows.some((r: any) => r.name === 'purchase');
    if (!hasPurchase) {
      db.run('ALTER TABLE budget_amortization_overrides ADD COLUMN purchase REAL', (alterErr) => {
        if (alterErr) {
          console.error('Failed to add purchase column to amortization overrides table:', alterErr.message);
        } else {
          console.log('Added purchase column to amortization overrides table.');
        }
      });
    }
  });
};
ensureBudgetAmortizationOverridesPurchaseColumn();

const ensureBudgetScheduleTable = () => {
  db.run(
    `CREATE TABLE IF NOT EXISTS budget_schedule (
      id TEXT PRIMARY KEY,
      strategy TEXT,
      strategy_label TEXT,
      saved_at TEXT,
      monthly_budget REAL,
      timeline TEXT,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )`,
    (err) => {
      if (err) {
        console.error('Failed to ensure budget_schedule table:', err.message);
      }
    }
  );
};
ensureBudgetScheduleTable();

const runMigrations = () => {
  // 1. budget_checks -> budget_cheques
  db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='budget_checks'", [], (err, rows) => {
    if (err || !rows) return;
    if (rows.length > 0) {
      console.log('Migrating budget_checks to budget_cheques...');
      db.run(`INSERT OR IGNORE INTO budget_cheques (id, cheque_date, expense_cheques, liability_cheques, household_id, user_id, updated_at) 
              SELECT id, check_date, expense_checks, liability_checks, household_id, user_id, updated_at FROM budget_checks`, (copyErr) => {
        if (!copyErr) {
          db.run('DROP TABLE budget_checks');
          console.log('Migrated budget_checks and dropped old table.');
        } else {
          console.error('Failed to copy data from budget_checks:', copyErr.message);
        }
      });
    }
  });

  // 2. budget_extra_payments.check_date -> cheque_date
  db.all("PRAGMA table_info(budget_extra_payments)", [], (err, rows: any[]) => {
    if (err || !rows) return;
    const hasChequeDate = rows.some(r => r.name === 'check_date');
    if (hasChequeDate) {
      console.log('Renaming budget_extra_payments.check_date to cheque_date...');
      db.run('ALTER TABLE budget_extra_payments RENAME COLUMN check_date TO cheque_date', (alterErr) => {
        if (alterErr) {
          console.error('Failed to rename check_date in budget_extra_payments:', alterErr.message);
        } else {
          console.log('Renamed check_date to cheque_date in budget_extra_payments.');
        }
      });
    }
  });

  // 3. budget_amortization_overrides.check_date -> cheque_date
  db.all("PRAGMA table_info(budget_amortization_overrides)", [], (err, rows: any[]) => {
    if (err || !rows) return;
    const hasChequeDate = rows.some(r => r.name === 'check_date');
    if (hasChequeDate) {
      console.log('Renaming budget_amortization_overrides.check_date to cheque_date...');
      db.run('ALTER TABLE budget_amortization_overrides RENAME COLUMN check_date TO cheque_date', (alterErr) => {
        if (alterErr) {
          console.error('Failed to rename check_date in budget_amortization_overrides:', alterErr.message);
        } else {
          console.log('Renamed check_date to cheque_date in budget_amortization_overrides.');
        }
      });
    }
  });
};
runMigrations();

const ensureLiabilityAmortizationTables = () => {
  db.run(
    `CREATE TABLE IF NOT EXISTS liability_amortization (
      id TEXT PRIMARY KEY,
      liability_id TEXT,
      period INTEGER,
      payment REAL,
      interest REAL,
      principal REAL,
      fees REAL,
      remaining_balance REAL,
      extra_payment REAL,
      actual_date TEXT,
      is_historical INTEGER,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )`,
    (err) => {
      if (err) {
        console.error('Failed to ensure liability_amortization table:', err.message);
      }
    }
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS liability_amortization_summary (
      id TEXT PRIMARY KEY,
      liability_id TEXT,
      is_infinite INTEGER,
      total_interest REAL,
      total_fees REAL,
      months INTEGER,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )`,
    (err) => {
      if (err) {
        console.error('Failed to ensure liability_amortization_summary table:', err.message);
      }
    }
  );
};
ensureLiabilityAmortizationTables();

const ensureStrategySimulationTable = () => {
  db.run(
    `CREATE TABLE IF NOT EXISTS strategy_simulations (
      id TEXT PRIMARY KEY,
      strategy TEXT,
      monthly_budget REAL,
      timeline TEXT,
      total_interest REAL,
      months INTEGER,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )`,
    (err) => {
      if (err) {
        console.error('Failed to ensure strategy_simulations table:', err.message);
      }
    }
  );
};
ensureStrategySimulationTable();

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

const dbGetAsync = (sql: string, params: any[] = []) =>
  new Promise<any>((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

const dbAllAsync = (sql: string, params: any[] = []) =>
  new Promise<any[]>((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

const dbRunAsync = (sql: string, params: any[] = []) =>
  new Promise<void>((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

const parseLocalDate = (value?: string | null) => {
  if (!value) return null;
  const d = value.includes('T') ? new Date(value) : new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const normalizeLiabilityForStorage = (liability: Liability) => {
  const normalized: Liability = { ...liability };
  if (!Number.isFinite(normalized.startingBalance) || normalized.startingBalance <= 0) {
    if (Number.isFinite(normalized.balance) && normalized.balance > 0) {
      normalized.startingBalance = normalized.balance;
    }
  }
  const stored = { ...normalized } as any;
  delete stored.balance;
  return { normalized, stored };
};

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const getDueDayForMonth = (year: number, monthIndex: number, dueDay: number) => {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  if (dueDay === 30) return lastDay;
  return Math.min(Math.max(1, dueDay), lastDay);
};

const getPaymentAnchorDate = (liability: Liability) => {
  const parsed = parseLocalDate(liability.nextDueDate);
  if (parsed) {
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }
  const start = parseLocalDate(liability.startDate);

  // For weekly/bi-weekly, the schedule usually anchors strictly to the start date
  // rather than a specific "due day" of the month.
  if ( liability.paymentFrequency === 'WEEKLY' || liability.paymentFrequency === 'BI_WEEKLY') {
    if (start) {
      start.setHours(0, 0, 0, 0);
      return start;
    }
  }

  const base = start || new Date();
  const dueDay = getDueDayForMonth(base.getFullYear(), base.getMonth(), liability.dueDate || 1);
  const anchor = new Date(base.getFullYear(), base.getMonth(), dueDay);
  anchor.setHours(0, 0, 0, 0);
  return anchor;
};

const getPeriodIndexFromDate = (liability: Liability, chequeDate?: string | null) => {
  const target = parseLocalDate(chequeDate);
  if (!target) return null;
  target.setHours(0, 0, 0, 0);
  let anchor = getPaymentAnchorDate(liability);
  const freq = liability.paymentFrequency || 'MONTHLY';

  if (freq === 'WEEKLY' || freq === 'BI_WEEKLY') {
    const intervalDays = freq === 'WEEKLY' ? 7 : 14;
    const start = parseLocalDate(liability.startDate);
    if (start) start.setHours(0, 0, 0, 0);
    if (start && anchor < start) {
      let guard = 0;
      while (anchor < start && guard < 500) {
        anchor = addDays(anchor, intervalDays);
        guard++;
      }
    }
    const previousAnchor = addDays(anchor, -intervalDays);
    if (target >= previousAnchor && target < anchor) {
      return 1;
    }
    let period = 1;
    let cursor = new Date(anchor);
    let guard = 0;
    while (cursor < target && guard < 500) {
      cursor = addDays(cursor, intervalDays);
      period += 1;
      guard++;
    }
    while (cursor > target && guard < 1000) {
      cursor = addDays(cursor, -intervalDays);
      period -= 1;
      guard++;
    }
    return period;
  }

  const start = parseLocalDate(liability.startDate);
  if (start) start.setHours(0, 0, 0, 0);
  if (start && anchor < start) {
    let guard = 0;
    while (anchor < start && guard < 120) {
      anchor = new Date(anchor.getFullYear(), anchor.getMonth() + 1, anchor.getDate());
      guard++;
    }
  }
  const previousAnchor = new Date(anchor.getFullYear(), anchor.getMonth() - 1, anchor.getDate());
  if (target >= previousAnchor && target < anchor) {
    return 1;
  }
  let period = 1;
  let cursor = new Date(anchor);
  let guard = 0;
  while (cursor < target && guard < 1200) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    period += 1;
    guard++;
  }
  while (cursor > target && guard < 2400) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, cursor.getDate());
    period -= 1;
    guard++;
  }
  return period;
};

const getScheduleMonthIndex = (savedAt?: string) => {
  if (!savedAt) return 1;
  const savedDate = new Date(savedAt);
  if (Number.isNaN(savedDate.getTime())) return 1;
  const today = new Date();
  const savedMonthCount = savedDate.getFullYear() * 12 + savedDate.getMonth();
  const currentMonthCount = today.getFullYear() * 12 + today.getMonth();
  return Math.max(1, currentMonthCount - savedMonthCount + 1);
};

const getPeriodsPerYear = (liability: Liability) => {
  const isBiWeekly = liability.paymentFrequency === 'BI_WEEKLY';
  const isWeekly = liability.paymentFrequency === 'WEEKLY';
  return isBiWeekly ? 26 : isWeekly ? 52 : 12;
};

const isMinimumPaymentId = (id: string) => id.startsWith('min-');

const fetchLiabilityById = async (liabilityId: string, scopeId: string | number, userId: number) => {
  const row = await dbGetAsync(
    'SELECT content FROM liabilities WHERE id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
    [liabilityId, scopeId, userId]
  );
  if (!row) return null;
  try {
    return JSON.parse((row as any).content) as Liability;
  } catch {
    return null;
  }
};

const getBalanceFromTimeline = (timeline: AmortizationRow[]) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let latestDate: Date | null = null;
  let latestBalance: number | null = null;

  timeline.forEach((row) => {
    const parsed = parseLocalDate(row.actualDate ?? null);
    if (!parsed || parsed > today) return;
    if (!latestDate || parsed > latestDate) {
      latestDate = parsed;
      latestBalance = row.remainingBalance;
    }
  });

  if (latestBalance !== null) return latestBalance;

  const historicalRows = timeline.filter((row) => {
    if (!(row.isHistorical || row.month <= 0)) return false;
    const parsed = parseLocalDate(row.actualDate ?? null);
    return !parsed || parsed <= today;
  });
  if (!historicalRows.length) return null;
  const latestHistorical = historicalRows.reduce((acc, cur) =>
    cur.month > acc.month ? cur : acc
  );
  return latestHistorical.remainingBalance;
};

const buildAmortizationInputsForLiability = async (
  liability: Liability,
  scopeId: string | number,
  userId: number
) => {
  const overridesRows = await dbAllAsync(
    'SELECT liability_id, period, payment, purchase, interest, cheque_date FROM budget_amortization_overrides WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
    [liability.id, scopeId, userId]
  );

  const overridesByPeriod = overridesRows.reduce<Record<number, { payment: number; interest: number; purchase?: number; chequeDate?: string | null }>>(
    (acc, row: any) => {
      const period = Number(row.period);
      if (!Number.isFinite(period)) return acc;
      acc[period] = {
        payment: row.payment,
        interest: row.interest,
        purchase: row.purchase ?? 0,
        chequeDate: row.cheque_date || null,
      };
      return acc;
    },
    {}
  );

  const extrasMap = Object.entries(overridesByPeriod).reduce<Record<number, { amount: number; chequeDate?: string | null; forceHistorical?: boolean; interest?: number }>>(
    (acc, [periodKey, override]) => {
      const period = Number(periodKey);
      if (!Number.isFinite(period)) return acc;
      const amount = (override.payment || 0) - (override.purchase || 0);
      acc[period] = {
        amount,
        chequeDate: override.chequeDate || null,
        interest: override.interest,
      };
      return acc;
    },
    {}
  );

  const extraRows = await dbAllAsync(
    'SELECT id, amount, cheque_date, is_checked FROM budget_extra_payments WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
    [liability.id, scopeId, userId]
  );

  const mergedExtras = extraRows.reduce<Record<number, { amount: number; chequeDate?: string | null; forceHistorical?: boolean; interest?: number }>>(
    (acc, row: any) => {
      if (row.id && isMinimumPaymentId(row.id)) return acc;

      const isChecked = row.is_checked !== 0;
      if (!isChecked) return acc;
      const rawPeriod = getPeriodIndexFromDate(liability, row.cheque_date);
      if (rawPeriod === null || rawPeriod === undefined) return acc;
      const period = rawPeriod;
      const override = overridesByPeriod[period];
      acc[period] = {
        amount: (acc[period]?.amount || 0) + row.amount,
        chequeDate: row.cheque_date || acc[period]?.chequeDate,
        interest: override?.interest,
      };
      return acc;
    },
    {}
  );

  const extrasMapMerged = { ...extrasMap, ...mergedExtras };

  const scheduleRow = await dbGetAsync(
    `SELECT strategy, strategy_label, saved_at, monthly_budget, timeline
     FROM budget_schedule
     WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [scopeId, userId]
  );

  const planPaymentsMap: Record<number, number> = {};
  if (scheduleRow) {
    let schedule: BudgetSchedule | null = null;
    try {
      schedule = {
        strategy: scheduleRow.strategy,
        strategyLabel: scheduleRow.strategy_label,
        savedAt: scheduleRow.saved_at,
        monthlyBudget: scheduleRow.monthly_budget,
        timeline: JSON.parse(scheduleRow.timeline || '[]'),
      };
    } catch {
      schedule = null;
    }
    if (schedule?.timeline?.length) {
      const scheduleMonthIndex = getScheduleMonthIndex(schedule.savedAt);
      const offset = scheduleMonthIndex - 1;
      const periodsPerYear = getPeriodsPerYear(liability);
      const periodsPerMonth = periodsPerYear / 12;
      schedule.timeline.forEach((row: any) => {
        const monthIndex = row.month - offset;
        if (monthIndex < 1) return;
        const paymentEntry = row.breakdown?.find((b: any) => b.liabilityId === liability.id);
        const pay = paymentEntry?.payment || 0;
        if (pay <= 0) return;

        const startPeriod =
          Math.floor((monthIndex - 1) * periodsPerMonth) + 1;
        let endPeriod = Math.floor(monthIndex * periodsPerMonth);
        if (endPeriod < startPeriod) {
          endPeriod = startPeriod;
        }
        const span = Math.max(1, endPeriod - startPeriod + 1);
        const perPeriodPayment = pay / span;

        for (let period = startPeriod; period <= endPeriod; period++) {
          planPaymentsMap[period] = (planPaymentsMap[period] || 0) + perPeriodPayment;
        }
      });
    }
  }

  return { extrasMapMerged, planPaymentsMap };
};

const persistAmortizationSchedule = async (
  liability: Liability,
  scopeId: string | number,
  userId: number
) => {
  const { extrasMapMerged, planPaymentsMap } = await buildAmortizationInputsForLiability(
    liability,
    scopeId,
    userId
  );
  const data = calculateIndividualAmortization(liability, extrasMapMerged, planPaymentsMap);
  const updatedAt = new Date().toISOString();

  const derivedBalance = getBalanceFromTimeline(data.timeline);

  await dbRunAsync(
    'DELETE FROM liability_amortization WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
    [liability.id, scopeId, userId]
  );
  await dbRunAsync(
    'DELETE FROM liability_amortization_summary WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
    [liability.id, scopeId, userId]
  );

  await dbRunAsync('BEGIN');
  try {
    for (const row of data.timeline) {
      const entryId = `${liability.id}:${row.month}`;
      await dbRunAsync(
        `INSERT OR REPLACE INTO liability_amortization
         (id, liability_id, period, payment, interest, principal, fees, remaining_balance, extra_payment, actual_date, is_historical, household_id, user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entryId,
          liability.id,
          row.month,
          row.payment,
          row.interest,
          row.principal,
          row.fees,
          row.remainingBalance,
          row.extraPayment || 0,
          row.actualDate || null,
          row.isHistorical ? 1 : 0,
          scopeId,
          userId,
          updatedAt,
        ]
      );
    }

    await dbRunAsync(
      `INSERT OR REPLACE INTO liability_amortization_summary
       (id, liability_id, is_infinite, total_interest, total_fees, months, household_id, user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${liability.id}:summary`,
        liability.id,
        data.isInfinite ? 1 : 0,
        data.totalInterest,
        data.totalFees,
        data.months,
        scopeId,
        userId,
        updatedAt,
      ]
    );

    await dbRunAsync('COMMIT');
  } catch (err) {
    await dbRunAsync('ROLLBACK');
    throw err;
  }

  if (Number.isFinite(derivedBalance ?? NaN)) {
    const { stored } = normalizeLiabilityForStorage({
      ...liability,
      balance: derivedBalance as number,
    });
    await dbRunAsync(
      'UPDATE liabilities SET content = ? WHERE id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
      [JSON.stringify(stored), liability.id, scopeId, userId]
    );
  }

  return { ...data, derivedBalance };
};

const persistAllLiabilitySchedules = async (scopeId: string | number, userId: number) => {
  const rows = await dbAllAsync(
    'SELECT content FROM liabilities WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)',
    [scopeId, userId]
  );
  for (const row of rows) {
    try {
      const liability = JSON.parse((row as any).content) as Liability;
      await persistAmortizationSchedule(liability, scopeId, userId);
    } catch {
      /* ignore bad rows */
    }
  }
};

const fetchScopeLiabilities = async (scopeId: string | number, userId: number) => {
  const rows = await dbAllAsync(
    'SELECT content FROM liabilities WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)',
    [scopeId, userId]
  );
  const liabilities: Liability[] = [];
  rows.forEach((row) => {
    try {
      liabilities.push(JSON.parse((row as any).content) as Liability);
    } catch {
      /* ignore bad rows */
    }
  });
  return liabilities;
};

const persistStrategySimulation = async (
  strategy: StrategyType,
  monthlyBudget: number,
  scopeId: string | number,
  userId: number
) => {
  const liabilities = await fetchScopeLiabilities(scopeId, userId);
  const normalizedLiabilities = await Promise.all(
    liabilities.map(async (liability) => {
      const schedule = await fetchStoredAmortization(liability, scopeId, userId);
      if (schedule) {
        const derivedBalance = getBalanceFromSchedule(schedule, liability);
        if (Number.isFinite(derivedBalance ?? NaN)) {
          return { ...liability, balance: derivedBalance as number };
        }
      }
      const fallbackBalance =
        (Number.isFinite(liability.balance ?? NaN) ? liability.balance : null) ??
        (Number.isFinite(liability.startingBalance ?? NaN) ? liability.startingBalance : null) ??
        0;
      return { ...liability, balance: fallbackBalance as number };
    })
  );
  const result: PayoffResult = calculatePayoff(
    normalizedLiabilities,
    monthlyBudget,
    strategy
  );
  const id = `${scopeId}_${strategy}_${monthlyBudget}`;
  const updatedAt = new Date().toISOString();

  await dbRunAsync(
    `INSERT OR REPLACE INTO strategy_simulations
     (id, strategy, monthly_budget, timeline, total_interest, months, household_id, user_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      strategy,
      monthlyBudget,
      JSON.stringify(result.timeline || []),
      result.totalInterestPaid,
      result.monthsToFreedom,
      scopeId,
      userId,
      updatedAt,
    ]
  );

  return result;
};

const fetchStoredAmortization = async (
  liability: Liability,
  scopeId: string | number,
  userId: number
) => {
  const summaryRow = await dbGetAsync(
    'SELECT is_infinite, total_interest, total_fees, months FROM liability_amortization_summary WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
    [liability.id, scopeId, userId]
  );

  if (!summaryRow) return null;

  const rows = await dbAllAsync(
    `SELECT period, payment, interest, principal, fees, remaining_balance, extra_payment, actual_date, is_historical
     FROM liability_amortization
     WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)
     ORDER BY period ASC`,
    [liability.id, scopeId, userId]
  );

  const timeline: AmortizationRow[] = rows.map((row: any) => ({
    month: row.period,
    payment: row.payment,
    interest: row.interest,
    principal: row.principal,
    fees: row.fees,
    remainingBalance: row.remaining_balance,
    extraPayment: row.extra_payment || undefined,
    actualDate: row.actual_date || undefined,
    isHistorical: row.is_historical ? true : undefined,
  }));

  const periodsPerYear = getPeriodsPerYear(liability);
  const maxPeriod = timeline.reduce((max, row) => (row.month > max ? row.month : max), 0);
  const computedMonths = maxPeriod > 0 ? Math.ceil((maxPeriod / periodsPerYear) * 12) : 0;

  const isInfinite = Number(summaryRow.is_infinite) === 1;
  const totalInterest = Number(summaryRow.total_interest) || 0;
  const totalFees = Number(summaryRow.total_fees) || 0;
  const months = Number(summaryRow.months);

  return {
    isInfinite,
    timeline,
    totalInterest,
    totalFees,
    months: Number.isFinite(months) && months > 0 ? months : computedMonths,
  };
};

const getBalanceFromSchedule = (
  schedule: { timeline: AmortizationRow[] },
  liability?: Liability
) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let latestDate: Date | null = null;
  let latestBalance: number | null = null;

  schedule.timeline.forEach((row) => {
    const parsed = parseLocalDate(row.actualDate ?? null);
    if (!parsed || parsed > today) return;
    if (!latestDate || parsed > latestDate) {
      latestDate = parsed;
      latestBalance = row.remainingBalance;
    }
  });

  if (latestBalance !== null) return latestBalance;

  const historicalRows = schedule.timeline.filter((row) => {
    if (!(row.isHistorical || row.month <= 0)) return false;
    const parsed = parseLocalDate(row.actualDate ?? null);
    return !parsed || parsed <= today;
  });
  if (!historicalRows.length) {
    if (!liability) return null;
    const startDate = parseLocalDate(liability.startDate ?? null);
    const nextDueDate = parseLocalDate(liability.nextDueDate ?? null);
    const anchor = startDate || nextDueDate;
    if (!anchor) return null;
    anchor.setHours(0, 0, 0, 0);

    const firstRow = schedule.timeline.reduce<AmortizationRow | null>(
      (acc, cur) => {
        if (cur.month <= 0) return acc;
        if (!acc || cur.month < acc.month) return cur;
        return acc;
      },
      null
    );

    if (anchor > today) {
      if (!firstRow) {
        if (Number.isFinite(liability.startingBalance ?? NaN)) {
          return liability.startingBalance as number;
        }
        return null;
      }
      const inferredStartingBalance =
        firstRow.remainingBalance + firstRow.principal - (firstRow.fees || 0);
      if (Number.isFinite(inferredStartingBalance) && inferredStartingBalance > 0) {
        return inferredStartingBalance;
      }
      if (Number.isFinite(liability.startingBalance ?? NaN)) {
        return liability.startingBalance as number;
      }
      return null;
    }

    const period = getPeriodIndexFromDate(liability, toLocalDateString(today));
    if (period !== null && period !== undefined) {
      const matchingRow = schedule.timeline.find((row) => row.month === period);
      if (matchingRow) return matchingRow.remainingBalance;
      const priorRow = schedule.timeline
        .filter((row) => row.month <= period && row.month > 0)
        .reduce<AmortizationRow | null>((acc, cur) => (!acc || cur.month > acc.month ? cur : acc), null);
      if (priorRow) return priorRow.remainingBalance;
    }

    if (firstRow) return firstRow.remainingBalance;
    return null;
  }
  const latestHistorical = historicalRows.reduce((acc, cur) =>
    cur.month > acc.month ? cur : acc
  );
  return latestHistorical.remainingBalance;
};

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

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const householdId = generateHouseholdId();
    db.run('INSERT INTO users (email, password, household_id) VALUES (?, ?, ?)', [email, hashedPassword, householdId], function (err) {
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

app.post('/api/reports/trigger-monthly', authenticateToken, async (req: AuthedRequest, res) => {
  const user = req.user!;
  try {
    const result = await triggerMonthlyReportForUser(db, user.id);
    if (result.success) {
      res.json({ success: true, message: 'Monthly report sent successfully' });
    } else {
      res.status(400).json({ error: result.error || 'Failed to send monthly report' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reports/trigger-transfer', authenticateToken, async (req: AuthedRequest, res) => {
  const user = req.user!;
  const { date } = req.body as { date?: string };
  try {
    const result = await triggerTransferReportForUser(db, user.id, date);
    if (result.success) {
      res.json({ success: true, message: result.message || 'Transfer report sent successfully' });
    } else {
      res.status(400).json({ error: result.error || 'Failed to send transfer report' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/available-cheques', authenticateToken, async (req: AuthedRequest, res) => {
  const user = req.user!;
  try {
    const dates = await getAvailableChequeDates(db, user.id);
    res.json(dates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/liabilities', authenticateToken, async (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;

  try {
    const rows = await dbAllAsync(
      'SELECT content FROM liabilities WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)',
      [scopeId, user.id]
    );
    const liabilities: Liability[] = [];
    rows.forEach((row) => {
      try {
        liabilities.push(JSON.parse((row as any).content) as Liability);
      } catch {
        /* ignore bad rows */
      }
    });

    const withDerivedBalances = await Promise.all(
      liabilities.map(async (liability) => {
        const hasStoredBalance = Object.prototype.hasOwnProperty.call(
          liability as any,
          'balance'
        );
        const { normalized, stored } = normalizeLiabilityForStorage(liability);

        if (hasStoredBalance || normalized.startingBalance !== liability.startingBalance) {
          await dbRunAsync(
            'UPDATE liabilities SET content = ? WHERE id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
            [JSON.stringify(stored), normalized.id, scopeId, user.id]
          );
        }

        let schedule = await fetchStoredAmortization(normalized, scopeId, user.id);
        if (!schedule) {
          try {
            const rebuilt = await persistAmortizationSchedule(normalized, scopeId, user.id);
            schedule = {
              isInfinite: rebuilt.isInfinite,
              timeline: rebuilt.timeline,
              totalInterest: rebuilt.totalInterest,
              totalFees: rebuilt.totalFees,
              months: rebuilt.months,
            };
          } catch {
            /* ignore rebuild errors */
          }
        }

        const derivedBalance = schedule ? getBalanceFromSchedule(schedule, normalized) : null;
        if (Number.isFinite(derivedBalance ?? NaN)) {
          return { ...normalized, balance: derivedBalance as number };
        }

        return { ...normalized, balance: normalized.balance || 0 };
      })
    );

    res.json(withDerivedBalances);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load liabilities' });
  }
});

app.post('/api/liabilities', authenticateToken, (req: AuthedRequest, res) => {
  const liability: Liability = req.body;
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  const scopeKey = typeof scopeId === 'number' ? String(scopeId) : scopeId;
  const payload: Liability = { ...liability, householdId: scopeKey };
  const { normalized, stored } = normalizeLiabilityForStorage(payload);
  db.run(
    'INSERT OR REPLACE INTO liabilities (id, content, user_id, household_id) VALUES (?, ?, ?, ?)',
    [liability.id, JSON.stringify(stored), user.id, scopeKey],
    (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      (async () => {
        try {
          const rebuilt = await persistAmortizationSchedule(normalized, scopeId, user.id);
          const derivedBalance = rebuilt?.derivedBalance ?? getBalanceFromTimeline(rebuilt.timeline);
          if (Number.isFinite(derivedBalance ?? NaN)) {
            normalized.balance = derivedBalance as number;
          }
        } catch (calcErr: any) {
          console.error('Failed to persist amortization schedule:', calcErr?.message || calcErr);
        }
        res.json(normalized);
      })();
    }
  );
});

app.delete('/api/liabilities/:id', authenticateToken, (req: AuthedRequest, res) => {
  const { id } = req.params as { id: string };
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  db.run('DELETE FROM liabilities WHERE id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)', [id, scopeId, user.id], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    db.run(
      'DELETE FROM liability_amortization WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
      [id, scopeId, user.id]
    );
    db.run(
      'DELETE FROM liability_amortization_summary WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
      [id, scopeId, user.id]
    );
    res.json({ id });
  });
});

app.get('/api/liabilities/:id/amortization', authenticateToken, async (req: AuthedRequest, res) => {
  const { id } = req.params as { id: string };
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const liability = await fetchLiabilityById(id, scopeId, user.id);
    if (!liability) {
      return res.status(404).json({ error: 'Liability not found' });
    }

    let schedule = await fetchStoredAmortization(liability, scopeId, user.id);
    if (!schedule) {
      const rebuilt = await persistAmortizationSchedule(liability, scopeId, user.id);
      schedule = {
        isInfinite: rebuilt.isInfinite,
        timeline: rebuilt.timeline,
        totalInterest: rebuilt.totalInterest,
        totalFees: rebuilt.totalFees,
        months: rebuilt.months,
      };
    }

    res.json({
      schedule: {
        liabilityId: liability.id,
        ...schedule,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch amortization schedule' });
  }
});

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
  const { id } = req.params as { id: string };
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
  const { id } = req.params as { id: string };
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

app.get('/api/budget/cheques', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  db.all(
    'SELECT cheque_date, expense_cheques, liability_cheques FROM budget_cheques WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)',
    [scopeId, user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const expenseChequesByCheque: Record<string, Record<string, boolean>> = {};
      const liabilityChequesByCheque: Record<string, Record<string, boolean>> = {};
      rows.forEach((row: any) => {
        if (row.expense_cheques) {
          try {
            expenseChequesByCheque[row.cheque_date] = JSON.parse(row.expense_cheques);
          } catch {
            /* ignore bad rows */
          }
        }
        if (row.liability_cheques) {
          try {
            liabilityChequesByCheque[row.cheque_date] = JSON.parse(row.liability_cheques);
          } catch {
            /* ignore bad rows */
          }
        }
      });
      res.json({ expenseChequesByCheque, liabilityChequesByCheque });
    }
  );
});

app.post('/api/budget/cheques', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  const { chequeDate, expenseCheques = {}, liabilityCheques = {} } = req.body as {
    chequeDate?: string;
    expenseCheques?: Record<string, boolean>;
    liabilityCheques?: Record<string, boolean>;
  };

  if (!chequeDate) {
    return res.status(400).json({ error: 'chequeDate is required' });
  }

  const id = `${scopeId}_${chequeDate}`;
  const updatedAt = new Date().toISOString();
  db.run(
    `INSERT OR REPLACE INTO budget_cheques (id, cheque_date, expense_cheques, liability_cheques, household_id, user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      chequeDate,
      JSON.stringify(expenseCheques || {}),
      JSON.stringify(liabilityCheques || {}),
      scopeId,
      user.id,
      updatedAt,
    ],
    (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, chequeDate });
    }
  );
});

app.get('/api/budget/schedule', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  db.get(
    `SELECT strategy, strategy_label, saved_at, monthly_budget, timeline
         FROM budget_schedule
         WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)
         ORDER BY updated_at DESC
         LIMIT 1`,
    [scopeId, user.id],
    (err, row: any) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.json({ schedule: null });
      }
      let timeline: any[] = [];
      try {
        timeline = JSON.parse(row.timeline || '[]');
      } catch {
        timeline = [];
      }
      res.json({
        schedule: {
          strategy: row.strategy as string,
          strategyLabel: row.strategy_label as string,
          savedAt: row.saved_at as string,
          monthlyBudget: row.monthly_budget as number,
          timeline,
        },
      });
    }
  );
});

app.post('/api/budget/schedule', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  const { strategy, strategyLabel, savedAt, monthlyBudget, timeline } = req.body || {};

  if (!strategy || !strategyLabel || !savedAt || !Array.isArray(timeline)) {
    return res.status(400).json({ error: 'strategy, strategyLabel, savedAt, and timeline are required' });
  }

  const id = `${scopeId}_schedule`;
  const updatedAt = new Date().toISOString();
  db.run(
    `INSERT OR REPLACE INTO budget_schedule (id, strategy, strategy_label, saved_at, monthly_budget, timeline, household_id, user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      strategy,
      strategyLabel,
      savedAt,
      monthlyBudget ?? 0,
      JSON.stringify(timeline || []),
      scopeId,
      user.id,
      updatedAt,
    ],
    (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      (async () => {
        try {
          await persistAllLiabilitySchedules(scopeId, user.id);
        } catch (calcErr: any) {
          console.error('Failed to persist amortization schedules:', calcErr?.message || calcErr);
        }
        res.json({
          schedule: {
            strategy: strategy as string,
            strategyLabel: strategyLabel as string,
            savedAt: savedAt as string,
            monthlyBudget: (monthlyBudget ?? 0) as number,
            timeline: timeline as any[],
          },
        });
      })();
    }
  );
});

app.delete('/api/budget/schedule', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  db.run(
    'DELETE FROM budget_schedule WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)',
    [scopeId, user.id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      (async () => {
        try {
          await persistAllLiabilitySchedules(scopeId, user.id);
        } catch (calcErr: any) {
          console.error('Failed to persist amortization schedules:', calcErr?.message || calcErr);
        }
        res.json({ success: true });
      })();
    }
  );
});

app.post('/api/strategy/simulations', authenticateToken, async (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  const { strategy, monthlyBudget } = req.body as { strategy?: StrategyType; monthlyBudget?: number };

  if (!strategy) {
    return res.status(400).json({ error: 'strategy is required' });
  }

  const parsedBudget = Number.isFinite(monthlyBudget) ? (monthlyBudget as number) : 0;

  try {
    const result = await persistStrategySimulation(strategy, parsedBudget, scopeId, user.id);
    res.json({ simulation: result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to build strategy simulation' });
  }
});

app.get('/api/budget/extra-payments', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  db.all(
    'SELECT id, liability_id, amount, cheque_date, is_checked, income_source_id FROM budget_extra_payments WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)',
    [scopeId, user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const extras = rows.map((row: any) => ({
        id: row.id,
        liabilityId: row.liability_id,
        amount: row.amount,
        chequeDate: row.cheque_date || null,
        isChecked: row.is_checked !== 0,
        incomeSourceId: row.income_source_id || undefined,
      }));
      res.json({ extras });
    }
  );
});

app.get('/api/liabilities/:id/extra-payments', authenticateToken, async (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  const { id } = req.params as { id: string };

  try {
    const liability = await fetchLiabilityById(id, scopeId, user.id);
    if (!liability) {
      return res.status(404).json({ error: 'Liability not found' });
    }

    db.all(
      'SELECT id, liability_id, amount, cheque_date, is_checked, income_source_id FROM budget_extra_payments WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
      [id, scopeId, user.id],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        const extras = rows.map((row: any) => ({
          id: row.id,
          liabilityId: row.liability_id,
          amount: row.amount,
          chequeDate: row.cheque_date || null,
          isChecked: row.is_checked !== 0,
          incomeSourceId: row.income_source_id || undefined,
        }));
        res.json({ extras });
      }
    );
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load liability extra payments' });
  }
});

app.post('/api/liabilities/:id/extra-payments', authenticateToken, async (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  const { id: routeLiabilityId } = req.params as { id: string };
  const { id, liabilityId, amount, chequeDate, isChecked, incomeSourceId } = req.body as {
    id: string;
    liabilityId?: string;
    amount: number;
    chequeDate?: string | null;
    isChecked?: boolean;
    incomeSourceId?: string;
  };

  if (!id || !Number.isFinite(amount)) {
    return res.status(400).json({ error: 'id and amount are required' });
  }

  const targetLiabilityId = liabilityId || routeLiabilityId;
  if (targetLiabilityId !== routeLiabilityId) {
    return res.status(400).json({ error: 'Route liability id must match payload liabilityId' });
  }

  try {
    const liability = await fetchLiabilityById(targetLiabilityId, scopeId, user.id);
    if (!liability) {
      return res.status(404).json({ error: 'Liability not found' });
    }

    const updatedAt = new Date().toISOString();
    const isCheckedInt = (isChecked === undefined || isChecked === true) ? 1 : 0;
    db.run(
      `INSERT OR REPLACE INTO budget_extra_payments (id, liability_id, amount, cheque_date, household_id, user_id, updated_at, is_checked, income_source_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, targetLiabilityId, amount, chequeDate || null, scopeId, user.id, updatedAt, isCheckedInt, incomeSourceId || null],
      (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        (async () => {
          try {
            await persistAmortizationSchedule(liability, scopeId, user.id);
          } catch (calcErr: any) {
            console.error('Failed to persist amortization schedule:', calcErr?.message || calcErr);
          }
          res.json({ success: true, id });
        })();
      }
    );
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to save liability extra payment' });
  }
});

app.delete('/api/liabilities/:liabilityId/extra-payments/:id', authenticateToken, async (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  const { liabilityId, id } = req.params as { liabilityId: string; id: string };
  if (!id || !liabilityId) return res.status(400).json({ error: 'liabilityId and id are required' });

  try {
    const liability = await fetchLiabilityById(liabilityId, scopeId, user.id);
    if (!liability) {
      return res.status(404).json({ error: 'Liability not found' });
    }

    db.run(
      'DELETE FROM budget_extra_payments WHERE id = ? AND liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
      [id, liabilityId, scopeId, user.id],
      (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        (async () => {
          try {
            await persistAmortizationSchedule(liability, scopeId, user.id);
          } catch (calcErr: any) {
            console.error('Failed to persist amortization schedule:', calcErr?.message || calcErr);
          }
          res.json({ success: true, id });
        })();
      }
    );
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to delete liability extra payment' });
  }
});

app.get('/api/budget/amortization-overrides', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  db.all(
    'SELECT id, liability_id, period, payment, purchase, interest, cheque_date FROM budget_amortization_overrides WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)',
    [scopeId, user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const overrides = rows.map((row: any) => ({
        id: row.id,
        liabilityId: row.liability_id,
        period: row.period,
        payment: row.payment,
        purchase: row.purchase ?? 0,
        interest: row.interest,
        chequeDate: row.cheque_date || null,
      }));
      res.json({ overrides });
    }
  );
});

app.post('/api/budget/amortization-overrides', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  const { id, liabilityId, period, payment, purchase, interest, chequeDate } = req.body as {
    id: string;
    liabilityId: string;
    period: number;
    payment: number;
    purchase?: number;
    interest: number;
    chequeDate?: string | null;
  };

  if (!id || !liabilityId || !Number.isFinite(period) || !Number.isFinite(payment) || !Number.isFinite(interest)) {
    return res.status(400).json({ error: 'id, liabilityId, period, payment, and interest are required' });
  }

  const updatedAt = new Date().toISOString();
  db.run(
    `INSERT OR REPLACE INTO budget_amortization_overrides (id, liability_id, period, payment, purchase, interest, cheque_date, household_id, user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, liabilityId, period, payment, purchase ?? 0, interest, chequeDate || null, scopeId, user.id, updatedAt],
    (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      (async () => {
        try {
          const liability = await fetchLiabilityById(liabilityId, scopeId, user.id);
          if (liability) {
            await persistAmortizationSchedule(liability, scopeId, user.id);
          }
        } catch (calcErr: any) {
          console.error('Failed to persist amortization schedule:', calcErr?.message || calcErr);
        }
        res.json({ success: true, id });
      })();
    }
  );
});

app.delete('/api/budget/amortization-overrides/:id', authenticateToken, (req: AuthedRequest, res) => {
  const user = req.user!;
  const scopeId = user.householdId || user.id;
  const { id } = req.params as { id: string };
  if (!id) return res.status(400).json({ error: 'id is required' });

  db.get(
    'SELECT liability_id FROM budget_amortization_overrides WHERE id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
    [id, scopeId, user.id],
    (fetchErr, row: any) => {
      if (fetchErr) {
        return res.status(500).json({ error: fetchErr.message });
      }
      const liabilityId = row?.liability_id as string | undefined;
      db.run(
        'DELETE FROM budget_amortization_overrides WHERE id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)',
        [id, scopeId, user.id],
        (err) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          (async () => {
            if (liabilityId) {
              try {
                const liability = await fetchLiabilityById(liabilityId, scopeId, user.id);
                if (liability) {
                  await persistAmortizationSchedule(liability, scopeId, user.id);
                }
              } catch (calcErr: any) {
                console.error('Failed to persist amortization schedule:', calcErr?.message || calcErr);
              }
            }
            res.json({ success: true, id });
          })();
        }
      );
    }
  );
});

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
  const { id } = req.params as { id: string };
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
          currencySymbol: '$',
          startDate: todayIso,
          monthlyIncomeMode: 'ANNUALIZED',
        };

      delete (settings as Partial<UserSettings> & { useSimpleTerms?: boolean }).useSimpleTerms;
      if (!settings.currencySymbol) settings.currencySymbol = '$';
      if (!settings.startDate) settings.startDate = todayIso;
      if (!settings.monthlyIncomeMode) settings.monthlyIncomeMode = 'ANNUALIZED';

      if (user.householdId) {
        settings.enablePartner = true;
        settings.householdId = user.householdId;
        settings.partnerLinked = true;
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
      currencySymbol: '$',
      startDate: settings.startDate || todayIso,
      monthlyIncomeMode: settings.monthlyIncomeMode || 'ANNUALIZED',
      ...settings,
    };
    delete (normalizedSettings as Partial<UserSettings> & { useSimpleTerms?: boolean }).useSimpleTerms;

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

app.post('/api/settings/test-email', authenticateToken, async (req: AuthedRequest, res) => {
  const user = req.user!;
  const { smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure, toEmail } = req.body;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !toEmail) {
    return res.status(400).json({ error: 'Missing required SMTP configuration or recipient email' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: smtpSecure || false,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    await transporter.verify();

    await transporter.sendMail({
      from: `"BacktoBlack" <${smtpUser}>`,
      to: toEmail,
      subject: 'BacktoBlack SMTP Test',
      text: 'This is a test email from your BacktoBlack instance using the configured SMTP settings.',
      html: '<p>This is a test email from your <strong>BacktoBlack</strong> instance using the configured SMTP settings.</p>',
    });

    res.json({ success: true, message: 'Test email sent successfully' });
  } catch (error: any) {
    console.error('SMTP Test Error:', error);
    res.status(500).json({ error: error.message || 'Failed to send test email' });
  }
});

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
      db.run('UPDATE users SET household_id = NULL WHERE household_id = ?', [householdId]);

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
          db.run(
            'INSERT OR REPLACE INTO settings (id, content, user_id, household_id) VALUES (?, ?, ?, NULL)',
            ['user_settings', JSON.stringify({ householdId: undefined, enablePartner: false, partnerLinked: false }), user.id]
          );
        }
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
