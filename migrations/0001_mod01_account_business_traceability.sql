-- [MOD01][DATA][START]
-- Business/account identity, registration, authentication, and traceability.
-- Apply with: npx wrangler d1 migrations apply sbiz-app-db --remote
-- D1 enforces foreign keys; no PRAGMA override is required.

CREATE TABLE IF NOT EXISTS business_id_sequence (
  sequence_name TEXT PRIMARY KEY CHECK (sequence_name = 'business'),
  next_value INTEGER NOT NULL CHECK (next_value BETWEEN 1 AND 1000000000)
);
INSERT OR IGNORE INTO business_id_sequence (sequence_name, next_value)
VALUES ('business', 1);

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT,
  email_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'locked', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);

CREATE TABLE IF NOT EXISTS businesses (
  business_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  current_slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  default_language TEXT NOT NULL
    CHECK (default_language IN ('en', 'vi', 'id', 'es', 'pt')),
  created_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  subscription_started_at TEXT,
  subscription_expires_at TEXT,
  data_deleted_at TEXT,
  registration_document_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  admin_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'locked', 'data_purged', 'closed')),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id)
);
CREATE INDEX IF NOT EXISTS idx_businesses_account_id ON businesses(account_id);
CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status);

CREATE TABLE IF NOT EXISTS business_memberships (
  business_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner', 'admin', 'member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (business_id, account_id),
  FOREIGN KEY (business_id) REFERENCES businesses(business_id),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id)
);

CREATE TABLE IF NOT EXISTS registration_requests (
  request_id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  requested_slug TEXT NOT NULL COLLATE NOCASE,
  default_language TEXT NOT NULL
    CHECK (default_language IN ('en', 'vi', 'id', 'es', 'pt')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  email_sent_at TEXT,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_registration_email ON registration_requests(email);
CREATE INDEX IF NOT EXISTS idx_registration_expiry ON registration_requests(expires_at);

CREATE TABLE IF NOT EXISTS email_change_requests (
  change_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  new_email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id),
  FOREIGN KEY (business_id) REFERENCES businesses(business_id)
);
CREATE INDEX IF NOT EXISTS idx_email_change_expiry ON email_change_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_change_account ON email_change_requests(account_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  reset_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id)
);
CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens(expires_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON auth_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS business_events (
  event_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_account_id TEXT,
  old_value TEXT,
  new_value TEXT,
  metadata_json TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(business_id)
);
CREATE INDEX IF NOT EXISTS idx_business_events_business_time
  ON business_events(business_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_business_events_type_time
  ON business_events(event_type, occurred_at);

CREATE TABLE IF NOT EXISTS email_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
);
-- [MOD01][DATA][END]
