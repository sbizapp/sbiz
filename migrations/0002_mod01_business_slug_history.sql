-- [MOD01][DATA][START]
-- Preserve the lifecycle of business slugs so old URLs can later be resolved safely.
-- Apply only after reviewing the target D1 database and migration status.

CREATE TABLE IF NOT EXISTS business_slug_history (
  slug_history_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  changed_by_account_id TEXT,
  change_source TEXT NOT NULL DEFAULT 'system'
    CHECK (change_source IN ('registration', 'owner', 'admin', 'system')),
  FOREIGN KEY (business_id) REFERENCES businesses(business_id),
  FOREIGN KEY (changed_by_account_id) REFERENCES accounts(account_id)
);

CREATE INDEX IF NOT EXISTS idx_business_slug_history_business_time
  ON business_slug_history(business_id, valid_from);

CREATE INDEX IF NOT EXISTS idx_business_slug_history_slug
  ON business_slug_history(slug COLLATE NOCASE);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_slug_history_current
  ON business_slug_history(business_id)
  WHERE valid_to IS NULL;

INSERT INTO business_slug_history
  (slug_history_id, business_id, slug, valid_from, valid_to, changed_by_account_id, change_source)
SELECT lower(hex(randomblob(16))), business_id, current_slug, created_at, NULL, NULL, 'registration'
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM business_slug_history h
  WHERE h.business_id=b.business_id AND h.valid_to IS NULL
);
-- [MOD01][DATA][END]
