CREATE TABLE finance_transactions (
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
  receipt_source_ref TEXT,
  CHECK (
    (type = 'expense' AND paid_by IS NOT NULL AND from_roommate_id IS NULL AND to_roommate_id IS NULL)
    OR
    (type = 'settlement' AND paid_by IS NULL AND from_roommate_id IS NOT NULL AND to_roommate_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_finance_transactions_household_paid_at ON finance_transactions(household_id, paid_at DESC);
CREATE UNIQUE INDEX idx_finance_transactions_household_receipt_source
  ON finance_transactions(household_id, receipt_source_ref) WHERE receipt_source_ref IS NOT NULL;

CREATE TABLE finance_splits (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
  roommate_id TEXT NOT NULL,
  owed_cents INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_finance_splits_transaction ON finance_splits(transaction_id);

CREATE TABLE finance_receipt_items (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents != 0),
  assignment_reason TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  normalized_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Sonstiges'
) STRICT;
CREATE INDEX idx_finance_receipt_items_transaction_order ON finance_receipt_items(transaction_id, sort_order);
CREATE INDEX idx_finance_receipt_items_category ON finance_receipt_items(category);
CREATE INDEX idx_finance_receipt_items_normalized_name ON finance_receipt_items(normalized_name);

CREATE TABLE finance_receipt_item_splits (
  id TEXT PRIMARY KEY,
  receipt_item_id TEXT NOT NULL REFERENCES finance_receipt_items(id) ON DELETE CASCADE,
  roommate_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_finance_receipt_item_splits_item ON finance_receipt_item_splits(receipt_item_id);

CREATE TABLE finance_receipt_uploads (
  transaction_id TEXT PRIMARY KEY REFERENCES finance_transactions(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  content BLOB NOT NULL,
  uploaded_at TEXT NOT NULL
) STRICT;

CREATE TABLE chores (
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
CREATE INDEX idx_chores_household_due_date ON chores(household_id, is_active, next_due_date);

CREATE TABLE rotations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  participant_ids TEXT NOT NULL,
  rotation_index INTEGER NOT NULL DEFAULT 0,
  last_completed_at TEXT,
  last_completed_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX rotations_household_created_idx ON rotations(household_id, created_at, id);

CREATE TABLE receipt_assignment_rules (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('category', 'item')),
  match TEXT NOT NULL,
  shares TEXT NOT NULL CHECK (json_valid(shares)),
  extra_description TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, target, match)
) STRICT;
CREATE INDEX idx_receipt_assignment_rules_household_order ON receipt_assignment_rules(household_id, sort_order);

INSERT INTO rotations (
  id, household_id, title, description, participant_ids, rotation_index,
  last_completed_at, last_completed_by, created_by, created_at, updated_at
)
VALUES
  ('rotation-waesche', 'wg-main', 'Wäsche', 'Wäsche waschen und aufhängen.', '["kran","stadlmann","mitter"]', 0, NULL, NULL, 'kran', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rotation-pfand', 'wg-main', 'Pfand', 'Leergut zurückbringen.', '["kran","stadlmann","mitter"]', 0, NULL, NULL, 'kran', datetime('now', '+1 second'), CURRENT_TIMESTAMP);

INSERT INTO receipt_assignment_rules
  (id, household_id, target, match, shares, extra_description, sort_order, created_at, updated_at)
VALUES
  ('rule-obst', 'wg-main', 'category', 'Obst', '{"kran":50,"stadlmann":50,"mitter":0}', NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-milchprodukte', 'wg-main', 'category', 'Milchprodukte', '{"kran":40,"stadlmann":30,"mitter":30}', 'Umfasst unter anderem Milch, Skyr, Joghurt, Topfen, Kase, Feta, Butter, Obers, Cremefine und Milchreis. Passende Artikelregeln haben Vorrang.', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-gemuese', 'wg-main', 'category', 'Gemüse', '{"kran":100,"stadlmann":0,"mitter":0}', 'Umfasst unter anderem Zucchini, Spinat, Salat, Paprika, Tomaten, Gurken, Kraut und anderes Gemüse. SPAR BIOERDNUSS GROB, Erdnüsse, Nüsse und Nussmus sind keine Gemüseartikel. Passende Artikelregeln haben Vorrang.', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-beeren', 'wg-main', 'item', 'Beeren', '{"kran":65,"stadlmann":35,"mitter":0}', 'Umfasst Beerenmix, Himbeeren, Heidelbeeren, Waldbeeren und Waldfruchte.', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-bier', 'wg-main', 'item', 'Bier', '{"kran":10,"stadlmann":30,"mitter":60}', NULL, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-griechischer-joghurt', 'wg-main', 'item', 'Griechischer Joghurt', '{"kran":100,"stadlmann":0,"mitter":0}', 'Griechischer Joghurt ist eine besondere Milchprodukt-Ausnahme und gehort vollstandig Kran.', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-schinken', 'wg-main', 'item', 'Schinken', '{"kran":0,"stadlmann":50,"mitter":50}', NULL, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-karotten', 'wg-main', 'item', 'Karotten', '{"kran":50,"stadlmann":50,"mitter":0}', NULL, 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-eier', 'wg-main', 'item', 'Eier', '{"kran":33,"stadlmann":33,"mitter":34}', 'S-Budget Eier: 15 Stk pro Packung; default: 10 per pack; BH GR. M ist Eier', 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-goldhirse', 'wg-main', 'item', 'Goldhirse', '{"kran":100,"stadlmann":0,"mitter":0}', NULL, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-basis-muesli', 'wg-main', 'item', 'Basis Müsli', '{"kran":100,"stadlmann":0,"mitter":0}', NULL, 21, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-knaeckebrot', 'wg-main', 'item', 'Knäckebrot', '{"kran":100,"stadlmann":0,"mitter":0}', 'Gilt auch fur KNAECKEBROT.', 22, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-hummus', 'wg-main', 'item', 'Hummus', '{"kran":100,"stadlmann":0,"mitter":0}', NULL, 23, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-nuesse-nussmus', 'wg-main', 'item', 'Nüsse und Nussmus', '{"kran":100,"stadlmann":0,"mitter":0}', 'Umfasst Nussmus, Mandelmus, Cashewmus, Erdnusse, Nussmischungen und Nussriegel. Diese Artikel sind nicht Gemuse.', 24, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-lachs-fisch', 'wg-main', 'item', 'Lachs und Fisch', '{"kran":100,"stadlmann":0,"mitter":0}', NULL, 25, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-zimt', 'wg-main', 'item', 'Zimt', '{"kran":100,"stadlmann":0,"mitter":0}', NULL, 26, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-tomatenmark', 'wg-main', 'item', 'Tomatenmark', '{"kran":100,"stadlmann":0,"mitter":0}', NULL, 27, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-tortilla', 'wg-main', 'item', 'Tortilla', '{"kran":100,"stadlmann":0,"mitter":0}', NULL, 28, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-airwaves', 'wg-main', 'item', 'Airwaves', '{"kran":100,"stadlmann":0,"mitter":0}', NULL, 29, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-milchreis', 'wg-main', 'item', 'Milchreis', '{"kran":0,"stadlmann":0,"mitter":100}', 'Diese Position gehort Mitter.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-rama-cremefine', 'wg-main', 'item', 'Rama Cremefine', '{"kran":40,"stadlmann":30,"mitter":30}', 'Als einzelne Ausnahme weiterhin aufteilen.', 31, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-haushaltsartikel', 'wg-main', 'item', 'Haushaltsartikel', '{"kran":33,"stadlmann":33,"mitter":34}', 'Gleichmaßig teilen. Umfasst Lovely Topa Gelb (Toilettenpapier), Mullsacke, Waschmittel und andere Haushaltsartikel.', 32, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-olivenoel', 'wg-main', 'item', 'Olivenöl', '{"kran":33,"stadlmann":33,"mitter":34}', 'Centgenau so gleichmaßig wie moglich teilen.', 33, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-darbo-honig', 'wg-main', 'item', 'Darbo Natur Honig', '{"kran":33,"stadlmann":33,"mitter":34}', 'DARBO NATURR ist Honig und wird centgenau gleichmaßig geteilt.', 34, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-pfand-leergut', 'wg-main', 'item', 'Pfand und Leergut', '{"kran":33,"stadlmann":33,"mitter":34}', 'Positive Pfandpositionen und negative Leergut-Gutschriften als eigene Positionen centgenau gleichmaßig teilen.', 35, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-coupons', 'wg-main', 'item', 'App-Gutschein und App-Joker', '{"kran":33,"stadlmann":33,"mitter":34}', 'Immer als eigene negative Position erfassen und centgenau gleichmaßig teilen; nicht mit dem rabattierten Artikel verrechnen.', 36, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule-skyr', 'wg-main', 'item', 'Skyr', '{"kran":100,"stadlmann":0,"mitter":0}', 'Skyr ist eine besondere Milchprodukt-Ausnahme und gehort vollstandig Kran.', 37, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
