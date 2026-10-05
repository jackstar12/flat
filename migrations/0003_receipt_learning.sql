-- Learning metadata only. Financial rows, IDs and balances are unchanged.
CREATE TABLE receipt_learning_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
) STRICT;
INSERT INTO receipt_learning_settings (id) VALUES (1);

CREATE TABLE receipt_analysis_drafts (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  items_json TEXT NOT NULL,
  source_key TEXT NOT NULL,
  attachment_hash TEXT,
  created_at TEXT NOT NULL,
  transaction_id TEXT UNIQUE,
  payload_hash TEXT,
  finalized INTEGER NOT NULL DEFAULT 0,
  invalidated INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE receipt_learning_products (
  product_key TEXT PRIMARY KEY,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1))
) STRICT;

CREATE TABLE receipt_corrections (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  ratio_json TEXT NOT NULL,
  source_key TEXT NOT NULL,
  UNIQUE (transaction_id, product_key),
  UNIQUE (source_key, product_key)
) STRICT;
CREATE INDEX receipt_corrections_product ON receipt_corrections(product_key, sequence DESC);
