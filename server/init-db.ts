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
    CREATE TABLE IF NOT EXISTS budget_cheques (
      id TEXT PRIMARY KEY,
      cheque_date TEXT,
      expense_cheques TEXT,
      liability_cheques TEXT,
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
      cheque_date TEXT,
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
      cheque_date TEXT,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS strategy_simulations (
      id TEXT PRIMARY KEY,
      strategy TEXT,
      monthly_budget REAL,
      timeline TEXT,
      total_interest REAL,
      months INTEGER,
      household_id TEXT,
      user_id INTEGER,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS liability_amortization (
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
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS liability_amortization_summary (
      id TEXT PRIMARY KEY,
      liability_id TEXT,
      is_infinite INTEGER,
      total_interest REAL,
      total_fees REAL,
      months INTEGER,
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
