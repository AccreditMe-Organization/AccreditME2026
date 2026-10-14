# ACC-226 — serve a 404 for missing app files

Plan written 14 Oct 2026 (CC-99). Branch `fix/ACC-226-framework-null`.
Related: ACC-223.

## The defect

On production, `GET /chunk-DOESNOTEXIST.js` answers **200, `text/html`** (the
app's page) with `Cache-Control: public, max-age=31536000, immutable`. PR 171
narrowed the SPA rewrite in `frontend/vercel.json` so that it no longer matches
asset paths, and that alone did not change this.

## Cause

`frontend/vercel.json` has `"framework": "angular"`. Vercel's Angular preset
appends its own routes AFTER ours: real files first, then `/(.*)` →
`/index.html`. So a path our rewrite declines is still answered with the page
by the preset's catch-all. Nothing in `vercel.json` can see or override it.

## What Vercel's Angular preset contributes

Read from Vercel's published framework definitions
(`vercel/vercel`, `packages/frameworks/src/frameworks.ts`, the `angular` entry)
and from how its static build uses a framework
(`packages/static-build/src/index.ts`), on 14 Oct 2026.

| What the preset supplies | Value | With `"framework": null` |
|---|---|---|
| Install command | none (a placeholder only) | **explicit in vercel.json**: `npm ci` |
| Build command | `ng build` | **explicit in vercel.json**: `npm run build` |
| Output directory, and its detection (`dist`, or `dist/<one folder>[/browser]`) | `dist` | **explicit in vercel.json**: `dist/frontend/browser` |
| Dev command | `ng serve --port $PORT` | **not needed**: only `vercel dev` uses it, and we never run it |
| Detection (`@angular/cli` in package.json) | — | **not needed**: the framework is stated, not detected |
| Default routes | files first, then `/(.*)` → `/index.html` | **lost, on purpose**: this is the catch-all that answers a missing file with the page. Our own rewrite in vercel.json is then the only fallback, and it does not match asset paths |
| Build cache pattern | none (the Angular entry has no `cachePattern`) | **not needed**: nothing to lose. `node_modules` is cached by the build step itself, with or without a framework |
| Environment-variable prefix | none (no `envPrefix`) | **not needed** |
| Framework name in the build manifest and the dashboard ("Angular", its version) | — | **lost, cosmetic**: the project shows "Other" |
| Speed Insights / Web Vitals handling | only for Next, Nuxt and Gatsby | **not needed** |

Nothing that matters is lost. The one thing lost that has an effect is the
default routes, which is the change.

## The change

- `frontend/vercel.json`: `"framework": null`. Nothing else in the file.
- `frontend/scripts/check-vercel-config.mjs`: fails unless `framework` is
  exactly `null`, saying a framework preset adds routes this check cannot see.
  CI runs it: the frontend job discovers and runs every `check:*` script.
- Docs: `SYSTEM-REFERENCE.md` §15.15 and `step-223-stale-chunks.md` said a
  missing asset is a 404. That was true of vercel.json's own rules and not of
  production; both are corrected.

## A known side effect, accepted

The header rule `"/(.*)\\.(js|css)"` marks every `.js` and `.css` response
`Cache-Control: public, max-age=31536000, immutable`. It matches by path, so
**it will also go on the 404 for a missing chunk.** That is accepted, and the
header rule is NOT changed: a chunk's name is a hash of its content, and a
missing hash never comes back.

## Checks after the production deploy (the merge prompt's step 6)

Anonymous GETs against the app's address, no cookies, each reporting status,
content type and Cache-Control:

- **a.** `/chunk-DOESNOTEXIST.js` and `/assets/does-not-exist.png` return 404.
- **b.** `/`, `/roles` and `/users/00000000-0000-0000-0000-000000000000` return
  200 `text/html`, `max-age=0, must-revalidate`.
- **c.** The real `main-*.js` named in the served index returns 200 JavaScript,
  `immutable`.
- **d.** `/` still carries the Content-Security-Policy and the other security
  headers.

**If b, c or d fails, the app may be down.** Stop at once and use Vercel's
Instant Rollback to the `2ea914e` deployment.

## Why this cannot be proved before the deploy

The preset's routes exist only on Vercel. The local reproduction for ACC-223
served the build with vercel.json's own rules and so showed a 404 that
production did not give; the same gap applies here. `check:vercel-config` can
assert that no preset is named, which is the cause, but only the checks above
show the effect.
