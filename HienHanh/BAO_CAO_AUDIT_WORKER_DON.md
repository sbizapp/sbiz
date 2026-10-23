# SBiz — MOD01 Worker audit and implementation status

**Audit date:** 2026-10-23  
**Audited source:** `worker.js` on `cleanup/repository-organization-2026-10-23`  
**Starting source lineage:** `feature/mod01-single-file-worker`  
**Deployment:** owner-controlled Cloudflare Dashboard. No deployment or remote database migration was performed.

## 1. What is present in the current Worker

- Public home, Create, Login, email-verification/password-setup, forgot-password, reset-password, and email-change confirmation pages.
- Account registration, email verification, login/logout, session lookup, password reset, email change, business slug change, and event recording endpoints.
- Business ID allocation from a D1 sequence and account/business/membership/event writes.
- SMTP delivery through Workers TCP sockets; actual production mail delivery has not been verified.
- Cloudflare Access JWT signature, issuer, audience, expiry and email-claim validation for `/admin` and `/api/v1/admin/*`.
- A working admin dashboard page in source, with business list/search/status filtering, detail/history view, and registration-document-link update. The older checklist's statement that `/admin` is only a placeholder is stale and has been corrected separately.
- Health, robots, sitemap, R2 background image routes and scheduled cleanup of expired temporary records/sessions/rate limits.
- D1 migration `0001_mod01_account_business_traceability.sql` for accounts, businesses, memberships, registration requests, email-change requests, password-reset tokens, sessions, subscription history, events and rate limits.

## 2. Changes made in this audit pass

- Added `migrations/0002_mod01_business_slug_history.sql`. It creates slug-history records and backfills each existing business's current slug.
- Updated registration completion to create an initial slug-history record for newly verified businesses.
- Updated slug changes to close the previous current history row, append the new slug, and record actor/source in the event metadata.
- Added `qa/mod01-slug-history-contract.test.mjs` and wired it into `npm run check` and `npm run test:slug-history`.
- Fixed the admin detail panel so it is hidden until a business is selected.
- Corrected the admin verification filter to include the actual `unverified` and `rejected` states.
- Replaced the session-only dashboard with a responsive account/business overview that reads the authenticated email, business IDs, current slugs, L1, status, creation date and email-verification date from `/api/v1/me`.
- Added owner-only `PATCH /api/v1/businesses/{business_id}/language` and a dashboard control to update L1 among the five supported languages; the change is recorded in `business_events`.
- Added a unified `npm test` command for syntax checks, slug-history contract tests and Cloudflare Access tests.

These are code and repository changes only. The new migration has **not** been applied to the remote D1 database.

## 3. Current known gaps against MOD01 Part 1 V1.6

1. **Language:** changing a business's L1 is now implemented for its owner and recorded as an event. The account pages and dashboard are still largely English-only; query-string selection does not implement translated/persistent language routing.
2. **Slug history and redirects:** history storage is now implemented in code, subject to migration 0002. Public old-slug resolution/redirects are not implemented; there is not yet a complete public business-page resolver to redirect safely.
3. **Custom domain:** Cloudflare for SaaS ownership/DNS verification, lifecycle states, attach/detach and collision checks are not implemented.
4. **Product slug:** product IDs/slug history/redirect behavior are not implemented in this MOD01 Worker slice.
5. **Subscription lifecycle:** the schema can store subscription history, but verified purchase/renewal/expiry ingestion and lifecycle state transitions are not implemented. Paddle integration is absent.
6. **Data purge:** scheduled cleanup only removes expired temporary registrations, change/reset tokens, stale sessions and rate-limit records. It does not implement business operational-data purging or the required retained traceability policy.
7. **Dashboard completeness:** the logged-in dashboard now shows account/business identity, current slug, L1, status and key dates. It is still not the full planned control center: subscription term/status, L2 entitlement, verification workflow state, actionable alerts and navigation to the future product modules are missing.
8. **Admin authorization policy:** the Worker verifies the Access JWT, but it does not enforce a code-level owner-email allowlist. The Cloudflare Access application policy must restrict `/admin` and `/api/v1/admin/*` to the owner's approved identity/admin group. This policy has not been independently verified during this audit.
9. **SMTP/runtime:** credentials are not in Git, which is correct, but secret presence/validity and real delivery are not verified.
10. **Migration/runtime:** neither the new migration nor the current Worker has been deployed or verified against the live D1/runtime in this pass.

## 4. Verification status

- Source and configuration review: **performed**.
- Slug-history migration and code hooks: **added; migration/backfill and update SQL shape smoke-tested against a minimal local SQLite schema; not executed against D1**.
- Owner ran `npm test` on exact HEAD `3921c4bb8f1a6a484f1c7d1fe1d08e6ab785666f` on branch `cleanup/repository-organization-2026-10-23`. Reported result: syntax checks passed; slug-history tests 7/7; Cloudflare Access tests 17/17; SQLite-backed D1 behavior tests 10/10. **Total: 34/34 tests passed** across the four checks. The Node experimental-loader deprecation warning appeared but did not fail tests.
- Owner subsequently ran `npm test` on exact HEAD `153ece4889d0d13eb9340f79cd84fa7ceb708b7f` on branch `cleanup/repository-organization-2026-10-23`. Reported result: syntax checks passed; slug-history tests 7/7; Cloudflare Access tests 17/17; SQLite-backed D1 behavior tests 12/12. **Total: 36/36 tests passed** across the four checks. The experimental-loader deprecation warning did not fail tests.
- The D1 behavior suite now covers password-reset one-time-token/session revocation and email-change confirmation/event/replay in addition to registration, slug-history, language authorization and account lookup behaviors. This is owner-reported local test evidence at the exact HEAD above. It does not verify Cloudflare live runtime, SMTP delivery, remote D1 parity, migration application, or production deployment.
- Live SMTP, Cloudflare Access policy, D1 schema parity, R2, cron and HTTP runtime checks: **not verified**.
- Migration `0002_mod01_business_slug_history.sql` has **not** been applied to remote D1.
- Production readiness / MOD01 acceptance: **NOT ESTABLISHED**.

## 5. Safe next execution order

1. **Completed:** owner ran `npm test` on exact HEAD `153ece4889d0d13eb9340f79cd84fa7ceb708b7f`; all 36 tests passed.
2. Review migration history and the intended D1 target; apply migration 0002 only after the owner explicitly approves the remote migration. Do not deploy code that references `business_slug_history` before the table exists.
4. Expand the dashboard into the full subscription-aware control center only when the authoritative subscription/entitlement rules and corresponding approved segment scenario are ready.
5. Implement remaining MOD01 requirements in dependency order: language routing, safe slug resolver, custom-domain lifecycle, subscription history ingestion, and retention/purge behavior, without inventing unresolved product rules.
6. Owner verifies Cloudflare Access policy, secrets, bindings and live runtime. Deployment and remote migrations remain owner-controlled.

No production deployment, remote migration, Cloudflare resource change, or workflow run was performed.
