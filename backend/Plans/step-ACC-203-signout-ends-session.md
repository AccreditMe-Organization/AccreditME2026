# ACC-203 — sign-out ends the server session, even after an idle wait

Plan written 10 Oct 2026 (CC-75), before any code. Ahmad reproduced it three
times on `https://al-nakheel.accreditme.app`: after the idle rule signed Hessa
out, typing the address again signed her straight back in, with no password.

## Cause (read at dev `0d76047`)

1. **Sign-out needs the access cookie, and after an idle wait it is often
   gone.** `POST /auth/logout` sits behind `TenantGuard`
   (`auth.controller.ts:106-111`). The access cookie lives 15 minutes. A
   background tab the browser froze, or a laptop that slept, runs no timers, so
   nothing renews it. When the tab wakes, the idle clock fires first, the logout
   goes out with no access cookie, the guard answers 401 "Missing bearer token"
   (`tenant.guard.ts:127-129`), and nothing is revoked or cleared.
   `IdleService.signOut()` swallows that error by design
   (`idle.service.ts:193-204`) and clears only the in-memory user.
2. **The refresh cookie never reaches sign-out.** Its path is
   `/api/v1/auth/refresh` (`session-cookies.ts:36`), so the browser does not
   send it to `/api/v1/auth/logout`. `AuthService.logout()` reads
   `req.cookies.refresh_token` (`auth.service.ts:728-736`), which is therefore
   always empty, so **no sign-out has ever revoked a refresh-token row** — even
   a successful manual one. A manual sign-out still deletes the browser's copy
   (the clear's path matches), but the row stays valid for 7 days.
3. On the next boot, `restoreSession()` gets 401 from `/auth/me`, renews once
   (`frontend/.../auth.service.ts:196-222`), the surviving refresh cookie is
   accepted, and the user is signed in again.

## Decisions

### a. `/auth/logout` is public, idempotent, and always 200

No `TenantGuard`. It answers `200 { success: true }` whether or not any cookie
is present, and a second call does the same. It is still rate-limited: the
global guard counts a request with no valid session per address (ACC-129), so a
public sign-out cannot be used to flood anything.

### b. It revokes the presented refresh token, then clears both cookies

The revoke is ONE atomic statement — `updateManyAndReturn` on
`{ tokenHash, revokedAt: null }` — so it returns only the row THIS call revoked.
Two simultaneous sign-outs cannot both find the row and both audit it; the
second finds nothing to revoke and is a no-op. The lookup is by the token's
SHA-256 hash, which is unique (`RefreshToken.tokenHash @unique`); there is no
tenant to scope by before the token says whose it is, exactly as `refresh()`
already reads it.

### c. Audit identity — DECIDED: the access token if TenantGuard would accept it, else the revoked row

- **An access token that TenantGuard would accept**: signature, expiry,
  required claims, and the user existing in that organisation with the same
  `tokenVersion`. This goes through ONE shared helper,
  `verifySessionIdentity()`, which TenantGuard itself is refactored to call —
  so the guard and sign-out cannot drift apart. The guard keeps its own refusal
  messages (the specs pin them) and still applies the closed-organisation check
  and the permission lookup after the shared part. Sign-out deliberately does
  NOT apply the closed-organisation refusal: signing out of a closed
  organisation must still work, and still be audited.
- **Otherwise, the row this call revoked**: its `userId` and `organizationId`.
- **Neither**: no audit entry, still 200.
- A forged or stale access token (bad signature, expired, wrong
  `tokenVersion`) is NOT trusted for the audit; the revoked row is used instead
  if there is one.
- An impersonation token's identity is the impersonated user, as today.

### d. Refresh cookie path — DECIDED: `/api/v1/auth`, the default

`REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth'`. Everything else is unchanged:
httpOnly, Secure, `SameSite=Strict`, host-only on the API's host.

A narrower shared path (moving refresh and logout under
`/api/v1/auth/session/...`) was considered and **not** taken:

- It would move two public routes, which means frontend changes, the
  rate-limit table and docs, and a period where old clients call the old paths —
  a breaking API change, for a small gain.
- The gain really is small. Under `/api/v1/auth` the cookie additionally goes
  to the other auth routes (login, me, MFA, invitations, the password routes).
  All of them are our own API, over TLS, on the same host. None reads
  `refresh_token`, and nothing logs cookies (`http.config.ts`; the throttler's
  log line names `user:`/`ip:`/`email:` only). The cookie stays httpOnly, so no
  page script can read it at any path. A cookie's Path is not a security
  boundary anyway (RFC 6265 §8.6), so narrowing it buys defence in depth, not
  isolation.

So nothing here needs review before building.

### e. Change-over: the old path is cleared on every set AS WELL AS every clear

The prompt asks for the old path (`/api/v1/auth/refresh`) to be cleared on
every clear. **It must also be cleared on every SET**, and this is why:

- A browser that already holds the old-path cookie keeps it after the deploy.
  Its first refresh works (the old cookie is sent, the row rotates) and the
  response sets the NEW cookie at `/api/v1/auth`.
- Both cookies now match `/api/v1/auth/refresh`, and the browser sends both,
  **longer path first** (RFC 6265 §5.4). `cookie-parser` keeps the first value:
  the old one, whose row was just revoked by the rotation.
- So the NEXT refresh would read a revoked token and sign the person out — a
  surprise sign-out for every user, once, after the deploy.

Clearing the old path in `setSessionCookies()` too removes the old cookie on the
first refresh or sign-in after the deploy, so the duplicate never exists.
`clearSessionCookies()` (sign-out, and the only place session cookies are
cleared) clears both paths as well. Both carry a dated comment: removable once
7 days, the refresh-token life, have passed since the deploy.

One gap that remains, and is acceptable: a browser holding ONLY an old-path
cookie that signs out before its first refresh. The old cookie is not sent to
`/logout`, so its row is not revoked — but the clear deletes the cookie, so
nothing can present that token again, and the row expires within 7 days.

### f. Comments

`session-cookies.ts`'s header and the "scoped narrowly" comment in
`setSessionCookies()` are rewritten to say the cookie goes to refresh AND
sign-out, and why.

### Frontend

- `IdleService.signOut()` keeps "clear locally even if the server call fails":
  still right, because a network failure must not strand anyone in a session
  they have been told is over.
- Renewal: `/auth/logout` is already in the interceptor's `NO_RENEWAL_PATHS`,
  so a failed sign-out is never renewed or retried. Nothing changes; a spec pins
  it.

## Files

| File | Change |
|---|---|
| `backend/src/common/config/session-cookies.ts` (+ spec) | new path; legacy-path clear options; comments |
| `backend/src/common/guards/tenant.guard.ts` (+ spec) | `verifySessionIdentity()`, shared; the guard calls it |
| `backend/src/foundation/auth/auth.service.ts` (+ spec) | `logout()` rewritten; set and clear handle the old path |
| `backend/src/foundation/auth/auth.controller.ts` (+ spec) | no `TenantGuard` on logout |
| `frontend/src/app/core/services/idle.service.spec.ts` | the idle sign-out when logout errors |
| `frontend/src/app/core/interceptors/auth.interceptor.spec.ts` | logout is never renewed or retried |
| `SYSTEM-REFERENCE.md` | the session-cookie section (§15.14) and sign-out (§1) |

## Specs, each with a mutation that must go red

| Spec | Mutation |
|---|---|
| Logout with no access cookie and a live refresh cookie: 200, the row revoked, both cookies cleared, plus the old-path clear | drop the revoke; drop the old-path clear |
| Logout with no cookies: 200, no audit row, no throw | audit unconditionally |
| Logout with a valid access cookie: the audit uses its identity | use the row's identity first |
| Logout with only the refresh cookie: the audit uses the row's identity | ignore the row |
| A forged or stale access token is not trusted for the audit | skip the tokenVersion check |
| Refresh after logout with the same token: 401 | make logout not revoke |
| The controller's logout route has no `TenantGuard` | put the guard back |
| Cookie options: the new path on set; the old path cleared on set and on clear | revert the path; drop either legacy clear |
| TenantGuard's existing specs, unchanged, on the shared helper | — |
| Frontend: `IdleService.signOut()` still clears and goes to `/login?reason=idle` when logout errors | resolve only on success |
| Frontend: a 401 from `/auth/logout` is not renewed | remove logout from `NO_RENEWAL_PATHS` |

## Verification

1. Lint, typecheck and the affected specs; then the full backend and frontend
   suites, tenant isolation, and every `check:*` scan.
2. **Browser, locally only**, at `http://al-nakheel.localhost:4200` against the
   LOCAL API (never `api.accreditme.app`), as a seed user:
   - delete `access_token` only (the frozen tab), set
     `am.session.lastActivity` to 31 minutes ago, and confirm: lands on
     `/login?reason=idle`, logout answered 200, `refresh_token` is gone, typing
     the address shows sign-in, and the row's `revokedAt` is set in the local
     database;
   - a normal manual sign-out: the row is revoked, and the address then shows
     sign-in.
   No cookie values, tokens or passwords are printed.

No migration. No change to the deployed API until the PR merges.
