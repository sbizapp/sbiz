# SBiz.app

Smart Business — product and infrastructure workspace.

## Current organization
- `worker.js`: current single-file Worker source for owner-controlled Cloudflare Dashboard deployment.
- `wrangler.jsonc`, `package.json`, `migrations/`, `qa/`: configuration, scripts, database migrations, and verification assets; these remain at the root.
- `HienHanh/`: current working documents. Placement here does not mean all features are implemented or accepted.
- `LuuTru/`: old versions and drafts retained for history. Read its index before using archived material.

## Authority notes
- The master plan contents identify as V1.6 although the historical filename said V1.5. The plan has conflicting pricing statements. The approved plan text states USD 50/year with 1-, 2-, or 3-year terms; resolve the contradictory USD 5/month paragraph before implementation.
- MODUL 01 scenario V1.6 is the current candidate; V1.4 is retained under `LuuTru/`.
- Segment 01 action scenario is explicitly a draft, not implementation authority until approved.
- The current code organization standard records the single-file Worker approach. Production deployment remains owner-controlled.
- Never claim production readiness or feature acceptance without test and runtime evidence.

Keep secrets and credentials out of Git and chat. The Builder must not deploy, trigger CI, or change Cloudflare resources on the owner's behalf.
