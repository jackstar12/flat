CREATE TABLE IF NOT EXISTS laundry_rotation (
  household_id TEXT PRIMARY KEY,
  rotation_index INTEGER NOT NULL DEFAULT 0,
  last_completed_at TEXT,
  last_completed_by TEXT,
  updated_at TEXT NOT NULL
) STRICT;
