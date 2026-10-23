# SBiz Light/Dark Background Setup

Owner-approved background pair (2026-10-23):

- `background-light.jpg` — Light Mode
- `background-dark.jpg` — Dark Mode

The Worker serves these fixed keys from the existing `SBIZ_APP_R2` binding:

- `assets/background-light.jpg` → `/assets/background-light.jpg`
- `assets/background-dark.jpg` → `/assets/background-dark.jpg`

## Upload the assets

The optimized image files are provided as `sbiz-background-assets.zip` alongside this handoff. Extract them into the local repository root or another temporary directory, then run from the repository:

```powershell
npx wrangler r2 object put sbiz-app-assets/assets/background-light.jpg --file=.ackground-light.jpg --content-type=image/jpeg
npx wrangler r2 object put sbiz-app-assets/assets/background-dark.jpg --file=.ackground-dark.jpg --content-type=image/jpeg
```

If the files were extracted into an `assets` directory, use `--file=.assets\background-light.jpg` and `--file=.assets\background-dark.jpg` instead.

## Verify before any production deployment

```powershell
npm run check
npm run test:access
npx wrangler deploy --dry-run --name sbiz
```

After the Owner authorizes deployment, verify:

```powershell
curl.exe -I https://sbiz.app/assets/background-light.jpg
curl.exe -I https://sbiz.app/assets/background-dark.jpg
curl.exe -s https://sbiz.app/health
```

Both asset URLs should return HTTP 200 with `Content-Type: image/jpeg`. The health endpoint should continue to report `status: ok`. Check the site with both OS appearance settings and at desktop and mobile widths.

## Status boundary

Source changes in this branch add the R2-backed asset route and use the paired URLs in the public account pages and Admin page. The live feature is **not complete** until the two R2 objects have been uploaded and the Owner has authorized and completed a deployment. Do not claim live visual verification before those checks pass.
