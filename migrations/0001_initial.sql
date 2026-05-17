CREATE TABLE IF NOT EXISTS finance_transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense', 'settlement')),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_by TEXT,
  from_roommate_id TEXT,
  to_roommate_id TEXT,
  paid_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (type = 'expense' AND paid_by IS NOT NULL AND from_roommate_id IS NULL AND to_roommate_id IS NULL)
    OR
    (type = 'settlement' AND paid_by IS NULL AND from_roommate_id IS NOT NULL AND to_roommate_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS finance_splits (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
  roommate_id TEXT NOT NULL,
  owed_cents INTEGER NOT NULL CHECK (owed_cents >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_finance_transactions_household_paid_at
  ON finance_transactions(household_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_splits_transaction
  ON finance_splits(transaction_id);

CREATE TABLE IF NOT EXISTS chores (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  participant_ids TEXT NOT NULL,
  rotation_index INTEGER NOT NULL DEFAULT 0,
  frequency_unit TEXT NOT NULL CHECK (frequency_unit IN ('day', 'week', 'month')),
  frequency_interval INTEGER NOT NULL CHECK (frequency_interval > 0),
  next_due_date TEXT NOT NULL,
  last_completed_at TEXT,
  last_completed_by TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_chores_household_due_date
  ON chores(household_id, is_active, next_due_date);
