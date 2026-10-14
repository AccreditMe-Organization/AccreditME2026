# ACC-226 — serve a 404 for missing app files

Plan written 14 Oct 2026 (CC-99). Branch `fix/ACC-226-framework-null`.
Related: ACC-223.

**Read "Outcome" at the end first.** The cause and the expected result below
were wrong: `"framework": null` shipped and a missing file still gets the page.

## The defect

On production, `GET /chunk-DOESNOTEXIST.js` answers **200, `text/html`** (the
app's page) with `Cache-Control: public, max-age=31536000, immutable`. PR 171
narrowed the SPA rewrite in `frontend/vercel.json` so that it no longer matches
asset paths, and that alone did not change this.

## Cause

**WRONG — see "Outcome".** The route comes from the static builder, which
detects Angular from package.json whatever `framework` says.

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
| Default routes | files first, then `/(.*)` → `/index.html` | **WRONG — not lost; see "Outcome"** (the static builder appends them anyway). Written as: **lost, on purpose**: this is the catch-all that answers a missing file with the page. Our own rewrite in vercel.json is then the only fallback, and it does not match asset paths |
| Build cache pattern | none (the Angular entry has no `cachePattern`) | **not needed**: nothing to lose. `node_modules` is cached by the build step itself, with or without a framework |
| Environment-variable prefix | none (no `envPrefix`) | **not needed** |
| Framework name in the build manifest and the dashboard ("Angular", its version) | — | **lost, cosmetic**: the project shows "Other" |
| Speed Insights / Web Vitals handling | only for Next, Nuxt and Gatsby | **not needed** |

Nothing that matters is lost. The one thing lost that has an effect is the
default routes, which is the change. **WRONG — they were not lost; see
"Outcome".**

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
**it will also go on the answer for a missing chunk** (written as "the 404";
on production that answer is the page, 200 — see "Outcome"). That is accepted, and the
header rule is NOT changed: a chunk's name is a hash of its content, and a
missing hash never comes back.

## Checks after the production deploy (the merge prompt's step 6)

Anonymous GETs against the app's address, no cookies, each reporting status,
content type and Cache-Control:

- **a.** `/chunk-DOESNOTEXIST.js` and `/assets/does-not-exist.png` return 404.
  **Did not pass, and is no longer expected** — both return the page, 200
  (see "Outcome").
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

## Outcome (14 Oct, CC-101a and CC-102)

**The premise of this plan was wrong.** After it shipped (cd5c381, the project
showing Framework "Other"), production still answered every missing file with
the page: `/chunk-<missing>.js`, `/assets/<missing>.png`, `/<missing>.txt` and
`/<missing>` all 200 `text/html`, byte-identical to `/`, and the `.js` one with
`Cache-Control: public, max-age=31536000, immutable`. The claims above that
`"framework": null` makes a missing file a 404 are WRONG and are marked so;
they are kept, not deleted, so the reasoning that led here stays readable.

### The real cause

- Our vercel.json alone, compiled with `@vercel/routing-utils` 6.6.0's
  `getTransformedRoutes()` (the version vercel 64.0.2 pins), gives no route
  that answers a missing asset: after `handle: filesystem`, the only rewrite is
  ours, and it declines asset paths.
- `@vercel/fs-detectors` 7.9.7 gives the builder `{ zeroConfig: true,
  installCommand, buildCommand, outputDirectory }` — no `framework` key.
- `@vercel/static-build` 21.0.0 (pinned by vercel 64.0.2) then calls
  `getFramework()`. With no framework configured it falls back to
  `frameworkList.find()` by dependency over dependencies and devDependencies,
  matches `@angular/cli`, and returns Angular. Because the build output has no
  routes of its own, it appends Angular's `defaultRoutes`:
  `{ handle: 'filesystem' }`, then `/(.*)` → `/index.html`.
- `mergeRoutes()` puts that route after ours, so a missing file misses the
  file check, misses our rewrite, and is answered by the builder's catch-all.
  The immutable header on a missing `.js` comes from our `"/(.*)\\.(js|css)"`
  header rule, which matches by path before the file check.

So the dashboard preset was never the source of that route. The builder adds
it whatever `framework` says, as long as `@angular/cli` is in package.json.

### Options

- **A. An explicit `builds` entry** (`@vercel/static-build` on `package.json`,
  `distDir: dist/frontend/browser`). Without `zeroConfig`, `getFramework()`
  returns nothing and no Angular route is added. Cost: the legacy build path —
  the dashboard build settings stop applying, the install becomes the builder's
  own instead of our `npm ci`, and it can only be proved on production.
- **B. Legacy `routes` with a 404 rule** after `handle: filesystem` (checked
  with `mergeRoutes()`: it lands before the builder's catch-all). Cost:
  `routes` cannot sit beside `headers` or `rewrites`, so the CSP and cache
  headers move into `continue: true` routes and `check:vercel-config` is
  rewritten.
- **C. Accept it.** Cost: a missing file answers 200 with the page, and a
  missing `.js` or `.css` carries the year-long cache.

### Decision: C (Ahmad, 14 Oct)

The defect ACC-223 reported, a tab that stops following links after a release,
is closed by the router's reload handler: an HTML answer for a chunk still
fails as a module load, which is exactly what the handler catches. What is left
is cosmetic — a 200 where a 404 belongs, and a year-long cache on a chunk name
that is a hash of its content and never comes back. Neither A nor B is worth a
change that can only be tried on production. `"framework": null` stays: it keeps
the build settings the explicit ones in vercel.json and the dashboard preset
out, and `check:vercel-config` rule 8 still pins it, with its reason corrected.

### When to revisit

Only if branch previews are enabled for the frontend project, so option A can
be tried on a preview deployment before it reaches production.
