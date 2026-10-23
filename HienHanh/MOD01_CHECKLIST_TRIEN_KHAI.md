# MODUL 01 — build and owner deployment checklist

> **Single-file update (2026-10-23):** The canonical deployment source for the owner Dashboard workflow is now root `worker.js` on `feature/mod01-single-file-worker`. The earlier `src/...` file list below is historical context from the modular implementation and is superseded; those runtime source files have been consolidated and removed from this branch. The D1 migration, `wrangler.jsonc`, QA files, and documentation remain separate. No production deployment has been performed.

**Canonical handoff branch:** `feature/mod01-single-file-worker`  
**Prior modular branch:** `feature/mod01-cloudflare-access-admin`  
**Status (2026-10-23):** Source contains account/authentication flows and an admin business dashboard. This branch also adds slug-history migration/code/tests, but automated tests have not yet been run in this environment and migration 0002 has not been applied remotely. Live runtime/production parity remains unverified; owner-controlled migration/deployment and runtime verification are still required.  
**Production deployment is owner-controlled.** Do not run `wrangler deploy` until the owner has reviewed the changes and chosen to deploy.

## Files added/changed

- `migrations/0001_mod01_account_business_traceability.sql` — D1 tables for accounts, businesses, memberships, pending registration/email-change/reset tokens, sessions, per-cycle subscription history, event history, and rate limiting.
- `migrations/0002_mod01_business_slug_history.sql` — initial and changed business slug history; **must be applied to the intended D1 database before deploying the Worker version that uses it**.
- `src/shared/smtp-mailer.js` — SMTP over Workers TCP sockets using implicit TLS on port 465.
- `src/shared/cloudflare-access.js` — cryptographic Cloudflare Access JWT verification.
- `src/modules/mod01.js` — minimal Create/Login/verification/password-reset pages and account/business traceability API.
- `src/router.js` — route integration.
- `wrangler.jsonc` — Worker name `sbiz`, existing D1/KV/R2 bindings, migration directory, non-secret SMTP settings, and the confirmed Cloudflare Access team domain/AUD.
- `package.json` — Wrangler and basic syntax-check/migration scripts.

## Required secrets and bindings

The Wrangler config declares D1 binding `SBIZ_APP_DB` and database `sbiz-app-db`. The existing database ID is retained. Do not run remote migrations for this Access/runtime investigation; migration requires separate explicit owner approval.

Set the SMTP password as a Cloudflare Worker secret; never put the value in Git or chat:

```bash
npx wrangler secret put SMTP_PASSWORD_NOREPLY
```

The code expects:
- `SMTP_HOST=smtp.yandex.com`
- `SMTP_PORT=465`
- `SMTP_USER_NOREPLY=no-reply@sbiz.app`
- Secret `SMTP_PASSWORD_NOREPLY`
- `CF_ACCESS_TEAM_DOMAIN=icy-brook-9346.cloudflareaccess.com`
- `CF_ACCESS_AUD=046996a2416371ba21fbc44bdea84b36d2383213e664de6274d41c19f0172e9c`

These two non-secret Worker vars are required by the Worker to validate Cloudflare Access JWTs and are now recorded in `wrangler.jsonc` using the values confirmed in Cloudflare Zero Trust. Keep the config synchronized if the Access application is recreated. The Worker fails closed (503) for protected admin routes until both values are configured in the deployed runtime.

System administration is authorized by Cloudflare Access, not by a special SBiz account email or password. Configure a Cloudflare Access self-hosted application for `sbiz.app` and restrict it to the owner's approved identity (or an explicitly approved admin group). Protect both `/admin` and `/api/v1/admin/*`. The Worker independently verifies the `Cf-Access-Jwt-Assertion` signature, issuer, audience, expiry, and email claim. Do not rely on an email header supplied by the browser.

## Cloudflare Access setup for the admin area

Before deploying this branch, configure the Access application in the Cloudflare Zero Trust dashboard:

1. Open **Access → Applications** and add a **Self-hosted** application for the SBiz admin area.
2. Protect hostname `sbiz.app` with path coverage for `/admin`, `/admin/*`, `/api/v1/admin`, and `/api/v1/admin/*`. If the dashboard accepts path patterns, ensure both the exact paths and nested paths are covered.
3. Create an **Allow** policy restricted to the owner's exact identity or an explicitly approved admin group. Do not use a broad `Everyone` allow policy.
4. Copy the Access application's **AUD tag** and the team's `<team-name>.cloudflareaccess.com` domain.
5. The confirmed team domain and AUD are now recorded in `wrangler.jsonc`; keep them aligned with the Access application if the application is recreated.
6. Keep the application fail-closed until both values are set. The Worker independently validates the Access JWT, so direct requests to the Worker cannot bypass the Access policy merely by supplying an email header.
7. Confirm the Access application is configured before owner-authorized deployment. This branch does not create or modify the Access application in Cloudflare.

## Owner-run preparation

From a clean checkout of this branch:

```bash
npm install
npm run check
npm run test:access
# Do not run remote migrations for this Access/runtime check. Run only after explicit owner approval and database review.
```

Review the target database/account before the remote migration. The migration is intended to create tables and indexes; do not run it against an unintended database.

Then, after reviewing the source and confirming secrets:

```bash
npx wrangler deploy
```

The owner must run deployment. The builder does not deploy or trigger workflows.

## Implemented endpoints

- `GET /` — entry page with Create and Login.
- `GET /create`, `GET /login`, `GET /verify?token=...`, `GET /forgot-password`, `GET /reset-password?token=...`.
- `POST /api/v1/register` — validates email, 13–32 character slug and default language; creates a temporary request and sends verification email.
- `POST /api/v1/register/verify` — validates a 30-minute one-time token, accepts the password on the verification page, then creates account, business ID, owner membership and audit events.
- `POST /api/v1/login`, `GET /api/v1/logout`, `GET /api/v1/me`.
- `POST /api/v1/password/forgot`, `POST /api/v1/password/reset`.
- `POST /api/v1/businesses/{business_id}/email` and `POST /api/v1/email/confirm` — email-change request and confirmation to the new email.
- Hourly scheduled cleanup for expired pending registrations, email-change requests, password-reset tokens, stale sessions and old rate-limit records.
- `PATCH /api/v1/businesses/{business_id}/slug` — owner/admin slug update; short slugs (12 characters or fewer) require system admin.
- `GET /admin` — protected by Cloudflare Access; source contains a business list/search/filter, detail/history view and document-link verification workflow. Runtime behavior is not yet verified.
- `GET /api/v1/admin/businesses?limit=50` — Cloudflare Access-only list of business IDs and verification-document status.
- `GET /api/v1/admin/businesses/{business_id}` — Cloudflare Access-only traceability record and event history.
- `PATCH /api/v1/admin/businesses/{business_id}` — Cloudflare Access-only manual entry/update of the HTTPS business-registration document URL; this action marks the business verified and records document-link and approval events. Audit records identify the Access email in event metadata; no SBiz admin account is required.
- `GET /health` — existing health check.

## Important known limits before production

1. The current first-pass UI uses English copy. The five language links are visible, but full translated UI strings and language-persistent routing are not yet implemented.
2. The admin dashboard is implemented in the current source, but remains a first-pass MOD01 admin surface; live behavior and all error states still require testing.
3. Email sending uses Workers TCP sockets to Yandex SMTP. It must be tested in the actual Worker runtime with the secret configured. Do not assume SMTP works until a real test message is received and logs are checked.
4. Email-change verification and hourly cleanup of temporary tokens are implemented. Scheduled deletion of business data, subscription event ingestion, and a complete product slug history/redirect resolver are not implemented in this first source slice.
5. The SQL schema stores subscription timestamps and data-deletion timestamp, and records business events, but subscription billing and data purging are not implemented here.
6. Admin authorization depends on a correctly configured Cloudflare Access application, an owner-approved Access policy, and the matching `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` Worker vars. The Worker verifies the JWT but does not enforce a code-level owner-email allowlist; the external Access policy must restrict access to the approved owner/admin identity.
7. No claim of production readiness, deployment success, or passing tests is made until checks and owner-side runtime verification are completed.

## Post-deploy verification

1. Open `/health` and confirm HTTP 200 with `service: "sbiz"` and `phase: "mod01"`.
2. Open `/`, `/create`, and `/login`.
3. Confirm the Worker Cron Trigger is present (hourly at minute 17).
4. Submit a test registration using a controlled mailbox and a valid unique slug.
5. Confirm the email arrives, open the link within 30 minutes, set a password, and verify the account/business rows in D1.
6. Test duplicate email, duplicate slug, invalid slug, expired token, failed SMTP, wrong password, forgot-password neutral response, and one-time reset-token behavior.
7. Verify `/admin` returns the admin dashboard (not `Not Found`) and `/api/v1/admin/businesses?limit=50` returns `{\"businesses\": [...]}` with valid Access; verify both are blocked without a valid Access JWT. Test wrong issuer, wrong audience, expired token, and forged `x-sbiz-verified-access-email` header. Test wrong issuer, wrong audience, expired token, and forged `x-sbiz-verified-access-email` header.
8. Verify Access-authorized access to the business traceability record and document URL update.
9. Verify event rows retain business creation, email verification, email changes, admin document-link changes and verification approval.


## Slug-history change (2026-10-23)

- New contract test: `qa/mod01-slug-history-contract.test.mjs`.
- Run `npm run check`, `npm run test:slug-history`, and `npm run test:access` on the exact branch HEAD before accepting the change.
- The owner must review and apply `migrations/0002_mod01_business_slug_history.sql` to the intended D1 database before deploying the updated Worker. Do not apply remote migrations without owner approval.
- Slug history is recorded; public old-slug redirects remain a separate gap until the public business-page resolver exists.
