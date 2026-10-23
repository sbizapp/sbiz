# MODUL 01 — build and owner deployment checklist

**Branch:** `feature/mod01-business-traceability`  
**Status:** Source prepared; local checks and live Cloudflare deployment still required.  
**Production deployment is owner-controlled.** Do not run `wrangler deploy` until the owner has reviewed the changes and chosen to deploy.

## Files added/changed

- `migrations/0001_mod01_account_business_traceability.sql` — D1 tables for accounts, businesses, memberships, pending registration, reset tokens, sessions, event history, and rate limiting.
- `src/shared/smtp-mailer.js` — SMTP over Workers TCP sockets using implicit TLS on port 465.
- `src/modules/mod01.js` — minimal Create/Login/verification/password-reset pages and account/business traceability API.
- `src/router.js` — route integration.
- `wrangler.jsonc` — Worker name, existing D1/KV/R2 bindings, migration directory and non-secret SMTP/admin settings.
- `package.json` — Wrangler and basic syntax-check/migration scripts.

## Required secrets and bindings

The Wrangler config declares the existing D1 binding as `SBIZ_APP_DB`. Verify that the D1 database ID matches the intended Cloudflare account before running migrations.

Set the SMTP password as a Cloudflare Worker secret; never put the value in Git or chat:

```bash
npx wrangler secret put SMTP_PASSWORD_NOREPLY
```

The code expects:
- `SMTP_HOST=smtp.yandex.com`
- `SMTP_PORT=465`
- `SMTP_USER_NOREPLY=no-reply@sbiz.app`
- Secret `SMTP_PASSWORD_NOREPLY`
- `ADMIN_EMAIL=admin@sbiz.app`

The configured admin email must correspond to a verified account. Do not configure an admin address that is not controlled by the owner.

## Owner-run preparation

From a clean checkout of this branch:

```bash
npm install
npm run check
npx wrangler d1 migrations apply sbiz-app-db --remote
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
- `GET /api/v1/admin/businesses?limit=50` — admin-only list of business IDs and verification-document status.
- `GET /api/v1/admin/businesses/{business_id}` — admin-only traceability record and event history.
- `PATCH /api/v1/admin/businesses/{business_id}` — admin-only manual entry/update of the HTTPS business-registration document URL, recorded in event history.
- `GET /health` — existing health check.

## Important known limits before production

1. The current first-pass UI uses English copy. The five language links are visible, but full translated UI strings and language-persistent routing are not yet implemented.
2. The admin document URL API is implemented; a complete admin dashboard/navigation is not.
3. Email sending uses Workers TCP sockets to Yandex SMTP. It must be tested in the actual Worker runtime with the secret configured. Do not assume SMTP works until a real test message is received and logs are checked.
4. Email-change verification and hourly cleanup of temporary tokens are implemented. Scheduled deletion of business data, subscription event ingestion, and a complete product slug history/redirect resolver are not implemented in this first source slice.
5. The SQL schema stores subscription timestamps and data-deletion timestamp, and records business events, but subscription billing and data purging are not implemented here.
6. The admin is identified by the verified account matching `ADMIN_EMAIL`. Ensure that email is owner-controlled before enabling this feature.
7. No claim of production readiness, deployment success, or passing tests is made until checks and owner-side runtime verification are completed.

## Post-deploy verification

1. Open `/health` and confirm HTTP 200.
2. Open `/`, `/create`, and `/login`.
3. Confirm the Worker Cron Trigger is present (hourly at minute 17).
4. Submit a test registration using a controlled mailbox and a valid unique slug.
5. Confirm the email arrives, open the link within 30 minutes, set a password, and verify the account/business rows in D1.
6. Test duplicate email, duplicate slug, invalid slug, expired token, failed SMTP, wrong password, forgot-password neutral response, and one-time reset-token behavior.
7. Verify admin-only access to the business traceability record and document URL update.
8. Verify event rows retain business creation, email verification, email changes and admin document-link changes.
