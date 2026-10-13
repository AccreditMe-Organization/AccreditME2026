# ACC-223 — links keep working after a release, without a hard refresh

Plan written 13 Oct 2026 (CC-96). Branch `feature/ACC-223-stale-chunks`.

## The defect

A tab opened before a release still runs the old `main` bundle, which asks for
the old lazy-chunk file names. After the release those files are gone. Clicking
a sidebar link to a screen not yet loaded does nothing, until a hard refresh.

## Cause (confirmed in the code)

1. `frontend/vercel.json` rewrites EVERY path with no matching file to
   `/index.html`: `"rewrites": [{ "source": "/(.*)", ... }]`. That includes a
   missing `chunk-XXXX.js`, so the browser gets the HTML page, status 200, where
   it asked for a script.
2. Its header rule `"/(.*)\\.(js|css)"` then marks that response
   `Cache-Control: public, max-age=31536000, immutable` — the HTML page, cached
   for a year under the chunk's address.
3. The dynamic `import()` fails, the router raises a navigation error, and
   nothing handles it: `app.config.ts` is `provideRouter(routes)` with no
   `withNavigationErrorHandler`, and nothing in `frontend/src` handles a failed
   chunk.

## The fix

- **F1 — `vercel.json`: the SPA rewrite does not match asset requests.** Its
  source excludes `/assets/…`, `/media/…` and any path ending in a static file
  extension (js, mjs, css, map, json, fonts, images, wasm). A missing asset is
  a 404. Every real route still rewrites to `/index.html`.
- **F2 — the page itself revalidates.** An explicit header rule on the same
  non-asset paths: `Cache-Control: public, max-age=0, must-revalidate`, so
  `index.html` is never cached long, whatever the platform default is.
- **F3 — `check:vercel-config`** asserts both: sample asset paths are NOT
  rewritten, sample routes ARE, the page's cache rule exists, and no long-cache
  rule can apply to a rewritten path.
- **F4 — `app.config.ts`: `provideRouter(routes, withNavigationErrorHandler(…))`.**
  When the error is a failed lazy chunk or dynamic import, ONE full page load
  of the target URL — the fresh page brings the new bundle and its chunk names.
  A `sessionStorage` marker with a timestamp guards it: a second chunk failure
  within 60 seconds does not reload again, and the error behaves as it does
  today. Any other navigation error is untouched: the handler returns nothing,
  and the router does with it exactly what it does with no handler (verified in
  `@angular/router` 21.2 — it emits `NavigationError` and rejects either way).

## Reproduce, before and after (local only)

1. Build the frontend. Serve `dist/frontend/browser` with a small static server
   that applies `vercel.json`'s own rewrites and headers (files first, then the
   rewrites), proxying `/api` to the local backend.
2. Open it at `al-nakheel.localhost`, sign in on the local backend, stay on
   Home.
3. Change one lazy screen trivially and rebuild into the same folder: the old
   chunk files are gone.
4. In the old tab, click that screen's sidebar link.
   - Before the fix: nothing happens.
   - After: the page loads.
5. Revert the trivial change. Nothing is deployed, and the deployed app and API
   are not used.

## Tests

- Specs: a chunk failure reloads once, to the target URL; a repeat within the
  window does not reload; a failure after the window reloads again; a non-chunk
  error never reloads.
- `check:vercel-config` with a mutation per rule.
- Every frontend gate and every scan.
