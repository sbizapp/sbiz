# sbiz.app

Smart Business — product and infrastructure workspace.

## Project status (2026-10-23)

- MODUL 01 account/business traceability source has been implemented in a single deployable root file, `worker.js`, on branch `feature/mod01-single-file-worker`.
- The branch is a source handoff for owner review; **production deployment and runtime acceptance have not been confirmed**.
- D1 schema migration remains separate and must be checked/applied by the owner to the intended database.
- Cloudflare bindings, Access application policy, and SMTP secrets must be verified in the Dashboard before deployment.
- MODUL 01 scenario V1.6 has acceptance requirements not all covered by the current source; see `docs/SINGLE_FILE_WORKER_AUDIT_AND_HANDOFF.md` and `docs/MOD01_DEPLOYMENT_CHECKLIST.md`.
- Product pricing recorded in the project plan: USD 5/month or USD 50/year.
- Paddle international subscription billing remains planned; this MODUL 01 source does not implement Paddle API integration.

## Working principles

1. Preserve approved product decisions.
2. Keep the canonical application runtime in `worker.js` for the current owner-approved Dashboard deployment workflow.
3. Keep D1 migrations, non-secret Cloudflare configuration records, QA, and product authority documents separate.
4. Do not mark setup, tests, production deployment, or acceptance complete without observable evidence.
5. Keep secrets, API tokens, payment credentials, and private business documents out of source control.
6. The owner performs production deployment; the Builder does not deploy or trigger CI on the owner's behalf.
