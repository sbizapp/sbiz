# SBiz Code Organization and Deployment Standard

**Status:** Approved working standard  
**Applies to:** SBiz.app source code and Cloudflare Worker deployment  
**Repository:** `sbizapp/sbiz`  
**Purpose:** Keep source code traceable and easy for the owner to manage and deploy from the Cloudflare Dashboard.

**Current owner-approved mode (2026-10-23):** The canonical deployable application source is the self-contained root `worker.js`. The previous multi-file source layout is superseded for this phase. Do not add imports from repository-local files to `worker.js`; keep SQL migrations, Cloudflare configuration records, QA and product documents separate. All future runtime code changes must be reflected in the complete `worker.js` file.

## 1. Source of truth and runtime

- GitHub is the canonical source for application code and deployment configuration.
- Cloudflare Worker is the runtime for the deployed version; it is not the canonical editing location.
- Source code may contain multiple files. Wrangler bundles the entry point and its imported modules for deployment.
- The owner manually controls production deployment. The Builder must not deploy, trigger CI workflows, or change Cloudflare resources on the owner's behalf.
- Never claim a deployment or runtime result without observable evidence.

## 2. Current source layout

```text
sbiz/
├── worker.js                 # Single deployable application source; contains modules, routing, SEO endpoints and Worker entry
├── wrangler.jsonc            # Non-secret bindings/configuration reference; Dashboard settings must be checked separately
├── package.json              # Low-cost syntax/test scripts
├── migrations/               # D1 schema migrations; remain separate from runtime code
├── qa/                       # Automated checks
└── docs/                     # Product authority, infrastructure register and deployment handoff
```

Do not split runtime code into repository-local imports unless the owner explicitly changes this decision. SQL migrations, secrets, Cloudflare bindings, and authoritative product documents are not embedded in `worker.js`.

## 3. Module boundaries and section markers

- Group source files by product module and responsibility.
- Keep the Worker entry point small: initialize routing and connect the runtime to the application.
- Keep frontend assets/UI separate from server-side backend logic. A comment does not turn browser code into Worker code.
- Separate validation, business orchestration, persistence, and response handling when they have distinct responsibilities.
- Every substantial section must have a stable module/section ID and explicit START/END markers. Use consistent identifiers, for example:

```js
/* [REGISTER][BACKEND][START]
 * Purpose: Handle registration requests on the server.
 * Responsibility: Orchestrate approved registration behavior.
 */

// Section implementation.

/* [REGISTER][BACKEND][END] */
```

Suggested IDs include `REGISTER-FRONTEND`, `REGISTER-BACKEND`, `REGISTER-VALIDATION`, and `REGISTER-DATA`. Use only sections that are actually needed. Do not duplicate a section's responsibility across files without a clear reason.

- Keep functions and imports organized inside each section; section markers complement modular code and do not replace it.
- Do not make unrelated changes while editing a module. If a necessary dependency requires another module to change, identify the dependency and scope explicitly.
- Do not overwrite or remove working code without understanding its role and checking the affected callers.

## 4. Static website resources and SEO files

- Keep public static resources in a dedicated asset directory and configure their serving/binding through the supported Cloudflare Workers static-assets approach.
- `robots.txt` and `sitemap.xml` are website resources, not business modules. Serve them at their intended public paths (normally `/robots.txt` and `/sitemap.xml`).
- Do not publish placeholder sitemap URLs or directives that block required content. Generate or update these files when canonical URLs and public page routes are defined.
- Keep favicon, images, stylesheets, browser JavaScript, and other static resources separate from server-side Worker code.
- Confirm the exact asset configuration against the selected Wrangler/Workers configuration before first implementation; do not guess binding names or config syntax.

## 5. Build and deployment workflow

1. Read the approved product requirements and the relevant existing source before editing.
2. Change only the required files/modules and provide a concise change summary.
3. Perform focused, low-cost checks that catch basic blockers (syntax, unresolved imports, and essential configuration errors). Do not create long, repetitive test campaigns or test reports without a concrete need.
4. Prepare the Wrangler command and explain what it will deploy. Use a dry run only when it materially helps diagnose the bundle/configuration; do not require it as a ritual on every small change.
5. Commit the source and deployment configuration to GitHub.
6. The owner runs the deployment command or otherwise explicitly performs the deployment.
7. The owner uses the deployed application and provides observed behavior or screenshots. The Builder diagnoses and fixes the specific issue.
8. Do not call a feature complete solely because the code was written or a build succeeded; distinguish source completion, deployment, and owner-confirmed behavior.

Example deployment command, once Wrangler configuration and local project setup are verified:

```bash
npx wrangler deploy
```

Do not run this command on the owner's behalf. Do not present it as ready to use until the repository's actual Wrangler configuration, assets, and bindings have been checked.

## 6. Secrets and infrastructure safety

- Never commit passwords, app passwords, API tokens, or other secrets.
- Use Cloudflare secrets/configuration for sensitive values; never request secrets in chat.
- Do not change DNS, domain routes, bindings, database schemas, storage exposure, or production resources without explicit authorization.
- Keep R2 private unless public access is separately approved.
- Changes involving authentication, authorization, personal/customer data, payments, or destructive operations require focused safety checks before deployment, even when the overall workflow prioritizes speed.

## 7. Reporting and evidence

For each meaningful change, report:
- Files and section IDs changed.
- The behavior intended to change.
- Focused checks actually performed and their real results.
- Git commit and branch, when available.
- Exact deployment action for the owner.
- What the owner should open or do to verify behavior.

Never report a check as passed if it was not run, and never claim Cloudflare has the latest code until the owner confirms deployment or runtime evidence establishes it.

## 8. Product authority

This document governs code organization and deployment mechanics only. It does not authorize the Builder to invent or alter product, pricing, permission, business workflow, API contract, or data-retention decisions. Follow the master product plan and require owner approval for unresolved product decisions.
