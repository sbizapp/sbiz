-- [MOD01][DATA][START]
-- Custom-domain lifecycle for Cloudflare for SaaS.
-- This migration creates state only; it does not configure DNS, Cloudflare for SaaS,
-- certificates, or production routing. The Worker may mark a hostname active only
-- after Cloudflare's API reports both hostname and SSL status active.

CREATE TABLE IF NOT EXISTS business_custom_domains (
  domain_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  hostname TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'pending_dns'
    CHECK (status IN (
      'pending_dns',
      'pending_provider',
      'pending_validation',
      'pending_issuance',
      'pending_deployment',
      'active',
      'error',
      'removing',
      'removed'
    )),
  verification_token_hash TEXT NOT NULL,
  verification_created_at TEXT NOT NULL,
  verification_expires_at TEXT NOT NULL,
  verified_at TEXT,
  provider_hostname_id TEXT UNIQUE,
  provider_status TEXT,
  ssl_status TEXT,
  last_provider_check_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(business_id),
  CHECK (status IN ('pending_dns', 'removed') OR verified_at IS NOT NULL),
  CHECK (status <> 'active' OR (verified_at IS NOT NULL AND provider_hostname_id IS NOT NULL AND provider_status = 'active' AND ssl_status = 'active'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_custom_domains_live_hostname
  ON business_custom_domains(hostname COLLATE NOCASE)
  WHERE status <> 'removed';

CREATE INDEX IF NOT EXISTS idx_business_custom_domains_business_status
  ON business_custom_domains(business_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_business_custom_domains_provider_status
  ON business_custom_domains(status, last_provider_check_at);

-- [MOD01][DATA][END]
