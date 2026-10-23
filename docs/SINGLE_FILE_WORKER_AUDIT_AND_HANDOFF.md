# SBiz — Single-file Worker audit and owner handoff

**Prepared:** 2026-10-23  
**Source branch:** `feature/mod01-single-file-worker`  
**Base branch:** `feature/mod01-cloudflare-access-admin`  
**Base commit:** `ac411ea00ad5406b6378b145c4de22befec03641`  
**Deployment:** owner-controlled Cloudflare Dashboard. No deployment was performed.

## 1. Consolidation
`worker.js` now contains the existing SMTP mailer, Cloudflare Access JWT verification, MODUL 01 account/business logic, health endpoint, router/R2 image handling, Worker fetch entry point, and scheduled cleanup. The source is divided into identifiable sections. `/robots.txt` and `/sitemap.xml` are served directly by the Worker; the current sitemap contains only the canonical homepage and is not a complete sitemap for future public business pages.

## 2. Infrastructure inventory found in the repository
These values are copied from existing source/configuration and the infrastructure register. They are not proof that the current Cloudflare account still has the same resources; owner should verify in Dashboard before deployment.

| Item | Value | Status / note |
|---|---|---|
| Repository | `sbizapp/sbiz` | GitHub repository |
| Domain | `sbiz.app` | Owner-reported in infrastructure register |
| Cloudflare Account ID | `7568b3c0e09d949e021c486fa8199b63` | Recorded from owner; not independently verified through Cloudflare API |
| Zone ID | `e2b836a598a4e275aeaa000ece31bc28` | Recorded from owner; not independently verified through Cloudflare API |
| Worker name | `sbiz` | From Wrangler config on source branch |
| Workers.dev subdomain | `sbizapp.workers.dev` | Register entry; verify current routing in Dashboard |
| D1 binding | `SBIZ_APP_DB` | Database `sbiz-app-db`, ID `8106266b-a132-4ccc-bce8-b386c027a8f7` |
| KV binding | `SBIZ_APP_KV` | Namespace ID `f5c12871f3204a7588cd18b3dfca689a` |
| R2 binding | `SBIZ_APP_R2` | Bucket `sbiz-app-assets`; register says keep private |
| SMTP | `smtp.yandex.com:465` | Implicit TLS; delivery not runtime-verified |
| SMTP username | `no-reply@sbiz.app` | Non-secret configuration |
| SMTP secret name | `SMTP_PASSWORD_NOREPLY` | Secret value was not accessed or committed |
| Cloudflare Access team | `icy-brook-9346.cloudflareaccess.com` | From Wrangler config; confirm in Access Dashboard |
| Cron | `17 * * * *` | Scheduled cleanup, hourly at minute 17 |
| Compatibility date | `2026-10-22` | From Wrangler config |

## 3. Secrets and external APIs
- GitHub source/configuration does not provide access to Cloudflare Dashboard secret values. Existence and validity of SMTP app passwords or any Cloudflare API token are not verified.
- No Cloudflare API token, SMTP password, Paddle key, or webhook secret was copied into the Worker.
- Current MODUL 01 source has no Paddle API integration. Do not infer billing is configured.
- SMTP uses the Workers `cloudflare:sockets` API with implicit TLS. Actual delivery must be verified in the deployed runtime.
- Cloudflare Access verifies JWTs against the configured team and audience. Admin paths fail closed when Access configuration or token verification fails.
- The Worker uses the D1, KV and R2 bindings as configured. The SQL migration remains separate and must be applied to the intended D1 database by the owner; consolidating source does not create tables.

## 4. Scope limitations carried forward
The existing deployment checklist records that the MODUL 01 scenario V1.6 is not fully implemented. In particular, subscription history ingestion, data-purging workflow, complete slug history/redirect behavior, fully translated UI, and a complete admin dashboard are not delivered by this consolidation. Do not claim MODUL 01 acceptance or production readiness.

## 5. Verification and next action
- GitHub source files were read and consolidated into `worker.js`; no Cloudflare resource or secret was changed.
- Syntax/build and automated tests have **not yet been run** in this environment. This branch must not be marked PASS until checks are run against the consolidated file.
- Before deployment, run a local syntax check and the existing Cloudflare Access tests; add or adapt tests for `/robots.txt` and `/sitemap.xml`. Review the full source, confirm D1 migration status and secrets, then manually paste/save/deploy from Cloudflare Dashboard.
- After owner deployment, verify `/health`, `/robots.txt`, `/sitemap.xml`, normal account routes, protected admin routes, R2 image paths, scheduled cleanup, and a real SMTP delivery test.
