# MODUL 01 — build and owner deployment checklist

**Branch:** `feature/mod01-business-traceability`  
**Status:** Source prepared; local checks and live Cloudflare deployment still required.  
**Production deployment is owner-controlled.** Do not run `wrangler deploy` until the owner has reviewed the changes and chosen to deploy.

## Files added/changed

- `migrations/0001_mod01_account_business_traceability.sql` — D1 tables for accounts, businesses, memberships, pending registration/email-change/reset tokens, sessions, per-cycle subscription history, event history, and rate limiting.
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
- `CF_ACCESS_TEAM_DOMAIN=<your-team>.cloudflareaccess.com`
- `CF_ACCESS_AUD=<Access application AUD tag>`

These two non-secret Worker vars are required by the Worker to validate Cloudflare Access JWTs. Add their actual values to `wrangler.jsonc` only after creating the Access self-hosted application. The Worker fails closed (503) for protected admin routes until both values are configured.

System administration is authorized by Cloudflare Access, not by a special SBiz account email or password. Configure a Cloudflare Access self-hosted application for `sbiz.app` and restrict it to the owner's approved identity (or an explicitly approved admin group). Protect both `/admin` and `/api/v1/admin/*`. The Worker independently verifies the `Cf-Access-Jwt-Assertion` signature, issuer, audience, expiry, and email claim. Do not rely on an email header supplied by the browser.

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
- `GET /admin` — protected by Cloudflare Access; currently a placeholder, not a complete admin dashboard.
- `GET /api/v1/admin/businesses?limit=50` — Cloudflare Access-only list of business IDs and verification-document status.
- `GET /api/v1/admin/businesses/{business_id}` — Cloudflare Access-only traceability record and event history.
- `PATCH /api/v1/admin/businesses/{business_id}` — Cloudflare Access-only manual entry/update of the HTTPS business-registration document URL; this action marks the business verified and records document-link and approval events. Audit records identify the Access email in event metadata; no SBiz admin account is required.
- `GET /health` — existing health check.

## Important known limits before production

1. The current first-pass UI uses English copy. The five language links are visible, but full translated UI strings and language-persistent routing are not yet implemented.
2. The admin document URL API is implemented; a complete admin dashboard/navigation is not.
3. Email sending uses Workers TCP sockets to Yandex SMTP. It must be tested in the actual Worker runtime with the secret configured. Do not assume SMTP works until a real test message is received and logs are checked.
4. Email-change verification and hourly cleanup of temporary tokens are implemented. Scheduled deletion of business data, subscription event ingestion, and a complete product slug history/redirect resolver are not implemented in this first source slice.
5. The SQL schema stores subscription timestamps and data-deletion timestamp, and records business events, but subscription billing and data purging are not implemented here.
6. Admin authorization depends on a correctly configured Cloudflare Access application, an owner-approved Access policy, and the matching `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` Worker vars. Do not treat the `/admin` placeholder as a complete dashboard.
7. No claim of production readiness, deployment success, or passing tests is made until checks and owner-side runtime verification are completed.

## Post-deploy verification

1. Open `/health` and confirm HTTP 200.
2. Open `/`, `/create`, and `/login`.
3. Confirm the Worker Cron Trigger is present (hourly at minute 17).
4. Submit a test registration using a controlled mailbox and a valid unique slug.
5. Confirm the email arrives, open the link within 30 minutes, set a password, and verify the account/business rows in D1.
6. Test duplicate email, duplicate slug, invalid slug, expired token, failed SMTP, wrong password, forgot-password neutral response, and one-time reset-token behavior.
7. Verify `/admin` and every `/api/v1/admin/*` endpoint are blocked without a valid Access JWT and work only with a valid JWT from the intended Access application. Test wrong issuer, wrong audience, expired token, and forged `x-sbiz-verified-access-email` header.
8. Verify Access-authorized access to the business traceability record and document URL update.
9. Verify event rows retain business creation, email verification, email changes, admin document-link changes and verification approval.
