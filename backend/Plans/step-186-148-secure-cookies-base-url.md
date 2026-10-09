# ACC-186 + ACC-148 — session cookies always Secure, and Better Auth's base URL from server config

Plan written 8 Oct 2026 (CC-63), approved with the answers below in CC-64. One
branch, because both decide Better Auth's cookie and URL settings. No migrations
and no database writes.

## ACC-148 — the exposure, verified first

**There is no forged-`Host` exposure today**, for three independent reasons:

1. **Better Auth never derives an origin from our requests.**
   - Its HTTP handler is never mounted: there is no `toNodeHandler` or
     `auth.handler` anywhere in `backend/src`.
   - The request-derived fallback exists only inside that handler
     (`better-auth/dist/auth/base.mjs:20`).
   - Every call we make is a direct `auth.api.*` call (`auth.service.ts:407, 551,
     870, 932, 941, 962, 997, 1033, 1063, 1077`). They pass at most a `cookie`
     header, never `Host` or `X-Forwarded-Host`, and `requestPasswordReset`
     (`:932`) passes no headers at all.
   - Dynamic resolution applies only when `baseURL` is configured as an object
     (`api/to-auth-endpoints.mjs:15-27`). Ours is unset, so a direct call gets
     `ctx.baseURL = ""` (`context/create-context.mjs:131`).
2. **Railway's edge drops a forged `Host`.** `GET /api/v1/health` with
   `Host: evil.example` or `Host: acme.accreditme.app` returned Railway's own
   `404 {"message":"Application not found"}` with `x-railway-fallback: true`; the
   real host returned 200 (8 Oct).
3. **Our code builds no URL from the request.** There is no `req.hostname`,
   `req.protocol` or `host` header use in `backend/src`. Tenant links come from
   configuration (`buildTenantUrl`, `app-url.config.ts`).

**What Better Auth builds from its origin, for our config:** only the reset link,
`` `${ctx.baseURL}/reset-password/${token}?callbackURL=` `` (`api/routes/password.mjs:72`).
Today it is the relative `/reset-password/{token}?callbackURL=`, to a handler
that is not mounted. There is no email verification, social sign-in, change-email
or magic link configured. No Better Auth base-URL variable is set, on Railway or
locally, including `BASE_URL`, which Better Auth also reads (`utils/url.mjs:71`).

## The fix

### Better Auth's base URL is the API's own origin, from server-owned config

- **`API_ORIGIN`**, validated at boot by `resolveApiOrigin()`, in the same
  throw-rather-than-default style as `resolveFrontendOrigin()`. It must be
  exactly an origin — https, or http only for `localhost`. Missing or malformed
  refuses the boot.
- It is passed explicitly as `betterAuth({ baseURL })`, a STRING, so Better Auth
  uses the static path and never re-resolves per request.
- Values: `https://accreditme2026-production.up.railway.app` now;
  `https://api.accreditme.app` after ACC-130. Locally `http://localhost:3000`
  (lane B: `http://localhost:3001`).
- **Why one static value:** Better Auth's `baseURL` means where Better Auth
  itself lives, and the API is one host for every tenant. Tenant-facing links
  stay with `buildTenantUrl` (`{slug}.accreditme.app`); Better Auth never builds
  them. A dynamic `allowedHosts` config would bring request-derived resolution
  back for nothing.
- **The boot warning goes away**: it is emitted only when `baseURL` resolves to
  nothing (`create-context.mjs:64`).

### ACC-186 — the cookies are always Secure

- **One helper** (`common/config/session-cookies.ts`) owns the options:
  `httpOnly`, `secure: true`, `sameSite: 'strict'`, and the path of each cookie
  (`/` for `access_token`, `/api/v1/auth/refresh` for `refresh_token`). The two
  setters use it (`auth.service.ts:237` `setSessionCookies()`,
  `platform-tenant.service.ts:369` `setAccessTokenCookie()`). So do the two
  clearers, with the same attributes (`auth.service.ts:259`
  `clearSessionCookies()` — which today sends no `secure` — and `:595`
  `cancelMfa()`), so a clear can always overwrite what was set.
- **`advanced.useSecureCookies: true`** in Better Auth's config. Its relayed
  challenge cookie (`auth.service.ts:484-487`) becomes
  `__Secure-better-auth.two_factor`, which `two-factor-challenge.ts:38-41`
  already reads.
- `NODE_ENV` on Railway is untouched.
- **Fallback, only if Ahmad's browser check fails:** `SESSION_COOKIE_SECURE`,
  default `true`; only exactly `false` turns it off, with a boot warning. It would
  drive both the helper and `useSecureCookies`. Not built unless needed.

### Forgot password stops at the source (answer 3)

`POST /auth/forgot-password` keeps its route, its rate limits and its neutral
200, but no longer calls `requestPasswordReset`. No token, no `AuthVerification`
row, no notification, no email. A comment names the future password-reset
ticket. `sendResetPassword` stays in the Better Auth config, unreachable, for
that ticket.

### appName (answer 5)

`appName: 'AccreditMe'`, so authenticator apps label the account "AccreditMe"
rather than "Better Auth".

## Files

| File | Change |
| -- | -- |
| `common/config/api-origin.config.ts` + spec | NEW. `resolveApiOrigin()` |
| `common/config/session-cookies.ts` + spec | NEW. The cookie options, one place |
| `common/config/boot.config.ts` + spec | `apiOrigin` in the boot config |
| `providers/auth/better-auth.config.ts` (+ spec) | `baseURL`, `useSecureCookies`, `appName` |
| `foundation/auth/auth.service.ts` | the setters and clearers use the helper; `forgotPassword()` no longer calls Better Auth |
| `platform/tenant/platform-tenant.service.ts` | the impersonation setter uses the helper |
| `foundation/auth/better-auth.contract.ts` + spec | the Better Auth facts relied on |
| `backend/.env.example` | `API_ORIGIN` |
| `.railway/railway.ts` | `API_ORIGIN: preserve()` |
| `.github/workflows/ci.yml` | `API_ORIGIN` wherever the app or boot config runs |
| CLAUDE.md, SYSTEM-REFERENCE.md | below |

## Tests — each with a mutation that must go red

- **Every Set-Cookie is Secure.** Each setter and clearer is captured with
  `NODE_ENV=development`, so the old code would fail. Mutations: `NODE_ENV ===
  'production'` back in either setter; drop `secure` from a clearer.
- **The clearers match the setters** — name, path, attributes. Mutation: change
  the refresh clear's path.
- **Better Auth's options**: `useSecureCookies: true`, a STRING `baseURL` equal to
  `API_ORIGIN`, `appName: 'AccreditMe'`. Mutations: remove each; a dynamic
  `{ allowedHosts: ['*'] }` instead of the string.
- **`resolveApiOrigin()`** throws on missing, blank, a path, `http://` for
  anything but localhost, and garbage; accepts `https://api.accreditme.app` and
  `http://localhost:3000`. Mutations: accept non-localhost http; default instead
  of throw.
- **A forged `Host` cannot influence a generated auth URL**, as a contract on the
  installed dist source: the request fallback lives only in the unmounted handler;
  a static `baseURL` is never re-resolved on a direct call; the reset URL is built
  from `ctx.baseURL`. Plus a spec that no `auth.api` call passes `request`, `host`
  or `x-forwarded-host`. Mutation: add `host` to one call.
- **Forgot password** returns the same 200 for a real and an unknown email;
  `requestPasswordReset` and the notification service are never called.
  Mutation: call it again.
- **The boot warning is gone**: Better Auth's resolved base URL is non-empty with
  the boot config. Mutation: unset it.

## Docs

- **CLAUDE.md**: Token Management (always Secure, one helper); the Environment
  Variables block (`API_ORIGIN`); Forgot password sends nothing.
- **SYSTEM-REFERENCE**: a §15 section on the cookies and Better Auth's base URL,
  with ACC-148's verified non-exposure and its evidence; §1.12, the `__Secure-`
  cookie name and Forgot password's change.

## Shared database

Nothing is written by this change. Forgot password now writes LESS: no
`AuthVerification` row and no `Notification`.

## Review answers (CC-64)

1. **Name: `API_ORIGIN`**, validated by `resolveApiOrigin()`.
2. **Required at boot.** Order: (a) on the branch, `API_ORIGIN: preserve()` in
   `.railway/railway.ts` and the `.env.example` entry; (b) before the PR opens,
   `railway variable set API_ORIGIN=https://accreditme2026-production.up.railway.app`
   — no `railway config apply`; if it redeploys the current dev commit, wait for
   SUCCESS and check `/api/v1/health`; (c) `API_ORIGIN=http://localhost:3000` in
   Ahmad's local `backend/.env` — lane B's checkout is not touched; (d) CI gets
   `API_ORIGIN` wherever the app or boot config runs.
3. **Reset email stopped at the source.** The endpoint keeps its route, rate
   limits and neutral 200, and no longer calls `requestPasswordReset`. A comment
   names the future reset ticket. `sendResetPassword` is kept, unreachable.
   Specs: same 200 for real and unknown emails; `requestPasswordReset` and the
   notification path never called. Mutation: call it again.
4. **ACC-148** gets a comment with the verified non-exposure and its evidence,
   and closes with this merge.
5. **`appName: 'AccreditMe'`**, with a spec and a mutation.
6. **Read-only report**: Railway's `PLATFORM_ADMIN_EMAIL` (domain part only) and
   every reader of it in `backend/src` and the seed. No change.
