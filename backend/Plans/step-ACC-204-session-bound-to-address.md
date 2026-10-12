# ACC-204 — a session only works at its own organisation's address

Plan written 12 Oct 2026 (CC-76), before any code, on top of ACC-203 (merged as
`ed8e885`). Ahmad, 10 Oct: signed in as Yasser at
`https://al-nakheel.accreditme.app`, then opened `https://platform.accreditme.app`
in a new tab of the same browser, and the app showed Yasser signed in under the
platform address.

## Cause (read at dev `0d76047`, unchanged since)

Every address calls ONE API host, and the session cookies are host-only on it,
so a browser holds one session for every address. Nothing compares the
session's organisation with the address it is used from:

- `TenantGuard` trusts the token's `organizationId` alone (`tenant.guard.ts`).
- `refresh()` trusts the refresh-token row alone (`auth.service.ts`).
- The frontend reads the address only for sign-in and forgot-password
  (`tenant-host.ts`), and never checks the session against it.

Data stays scoped to the token's organisation, so this is not a data leak. It is
a session showing at the wrong address. It also contradicts two existing
comments that say "do not add a comparison" (`tenant-host.ts`, CLAUDE.md
Subdomain Routing). ACC-204 is the decision to add one; both are updated, and
impersonation keeps working (decision e).

## The address a request comes from: its Origin

Browsers send `Origin` on every CORS request. In production the app at
`{slug}.accreditme.app` calls `api.accreditme.app`, which is a different origin,
so every call carries it, GET included, and a page cannot forge it.

The one browser request to the API that is not CORS is a top-level navigation,
and the only one the app makes is a download (`files.service.ts`
`document.location.assign`). It goes to `/files/stream/:token`, which uses no
cookie and no guard, so it is unaffected. The ACC-189 file viewer fetches with
`withCredentials: false` against signed or token URLs, so it is unaffected too.

**This is a correctness guard, not a security boundary.** A non-browser client
holding the cookie can send any `Origin` it likes. What it stops is a browser
using one organisation's session at another organisation's address, which is the
reported bug. Data isolation remains `organizationId` scoping, as before.

### Locally, same-origin GETs carry no Origin

Locally the dev server proxies `/api`, so app and API are the same origin. A
browser sends no `Origin` on a same-origin GET or HEAD, so with a strict rule
every local GET would be refused. **The dev proxy adds a faithful `Origin`** when
the browser sent none: `http://{the Host the browser asked for}`, which is
exactly what production's cross-origin requests carry (`proxy.conf.js`,
`configure`). It is dev-only, and the backend's rule stays strict everywhere.

## Decisions

### a. One shared Origin → label helper

`labelFromOrigin(origin, baseDomain, devOrigin)` in `common/config/cors.config.ts`
returns the one DNS label in front of the base domain, or null. It is the same
parsing `isAllowedOrigin()` already does, extracted rather than copied:

- **Production:** `https://{one label}.{APP_BASE_DOMAIN}`, https, no port, nothing
  after the origin.
- **Local:** only when `APP_LINK_ORIGIN` (the dev link override) is set:
  `{its protocol}//{one label}.localhost{its port}`.

`isAllowedOrigin()` calls it with no dev origin, so CORS behaves exactly as
before. Apex, `www`, two labels, a path, a port in production, `null`, junk:
null, or a label no organisation has (`www` is reserved, so it can never match).

### b. TenantGuard: a cookie session must be used at its organisation's address

- The check applies only when the token came from the `access_token` **cookie**.
  Bearer-header requests are unchanged: they are API clients, not browser tabs.
- **Expected label:**
  - an ordinary token: its organisation's `slug`;
  - an **impersonation** token (decision e): the platform organisation's,
    `platform`.
- The slug comes from the organisation join `verifySessionIdentity()` already
  makes. One more selected column, **no extra query**.
- **Mismatch, or a cookie session with no usable Origin:** 401
  `SESSION_OTHER_ORGANIZATION` (`AuthRefusalException`, a new row in the 9b
  table): "This session belongs to another organisation's address".
- `verifySessionIdentity()` itself stays address-free, so ACC-203's sign-out
  identity is unaffected. The check sits in the guard, beside the
  closed-organisation check.

### c. refresh(): the same check, BEFORE the rotation — DECIDED: refuse without revoking or rotating

- The address check runs against the refresh-token row's organisation, after the
  row is found and **before** it is rotated.
- **A mismatched refresh refuses with `SESSION_OTHER_ORGANIZATION` and leaves the
  presented token untouched**: not revoked, not rotated. Revoking it would let a
  tab at the wrong address sign the person out at their own address. The session
  at its own address keeps working.
- To have the slug before the rotation, the user lookup (with the organisation
  joined) moves ahead of the rotation. Query count unchanged. The ACC-168
  inactive-user and closed-organisation refusals still come after the rotation,
  so those still revoke, exactly as today.
- An impersonation session's refresh cookie is the platform admin's own
  (impersonation sets only the access cookie), so its row's organisation is
  `platform`, and refreshing from `platform.…` passes.

### d. The platform address — CONFIRMED

Read on the shared dev database, 12 Oct: the platform organisation's slug is
**`platform`** (`isPlatformOrg = true`, the only one). `platform` is the platform
sign-in label in `reserved-slugs.ts` (`PLATFORM_SIGN_IN_LABELS`), so
`https://platform.accreditme.app` → `platform`, and locally
`http://platform.localhost:4200` → `platform`. A spec pins it.

### e. Impersonation keeps working, bound to the platform address

A platform admin impersonates from `platform.…`. Their token carries the
TENANT's `organizationId` plus `impersonatedBy`, and the app stays at the
platform address. Without an exception every impersonated request would be
refused. So an impersonation token is expected at the platform address.
Impersonation is still due to be removed (ACC-99); this keeps it working until
then rather than breaking it in passing.

### f. Sign-out stays address-free

ACC-203's `POST /auth/logout` is public and checks no address, so signing out
always works.

**Known consequence:** one browser holds one session, so a sign-out in a tab at
another address still ends it. That is the shared cookie, not a new behaviour.

### Frontend

- `SESSION_OTHER_ORGANIZATION` means **"not signed in at this address"**:
  - **`restoreSession()`** treats it, from `/auth/me` or from the renewal, as not
    signed in. It does NOT renew on it, and keeps ACC-24's rule (no redirect at
    start-up).
  - **The interceptor** never renews on it. An ordinary request refused with it
    ends the local session the way a failed renewal does (to `/login`). It
    clears only in memory: it does not call `/logout`, which would end the
    session the other address is using.
  - **The renewal service** records it when the refresh is refused with it.
- **The record is a small shared signal**, `SessionAddressState`, which the
  sign-in page reads to show ONE line in English and Arabic:
  - "You're signed in to another organisation in this browser. Signing in here
    will sign you out there."
  - "أنت مسجّل الدخول إلى مؤسسة أخرى في هذا المتصفح. تسجيل الدخول هنا سيُخرجك من هناك."

  A successful sign-in clears it.
- `refusalCode()` (`core/http/refusal.ts`) reads the code; no second copy.

## Files

| File | Change |
|---|---|
| `backend/src/common/config/cors.config.ts` (+ spec) | `labelFromOrigin()`; `isAllowedOrigin()` uses it |
| `backend/src/common/guards/tenant.guard.ts` (+ spec) | the cookie source; the slug in the identity; the address check |
| `backend/src/foundation/auth/auth-refusal.ts` | `SESSION_OTHER_ORGANIZATION` |
| `backend/src/foundation/auth/auth.service.ts` (+ spec) | `refresh()` checks before rotating |
| `backend/src/foundation/auth/closed-organisation.spec.ts` | the guard's one query now selects the slug too |
| `frontend/proxy.conf.js` | the dev Origin shim |
| `frontend/src/app/core/auth/session-address-state.ts` (+ spec) | the shared signal |
| `frontend/src/app/core/services/auth.service.ts` (+ spec) | `restoreSession()`; clear on sign-in |
| `frontend/src/app/core/services/session-renewal.service.ts` (+ spec) | records the refusal |
| `frontend/src/app/core/interceptors/auth.interceptor.ts` (+ spec) | no renewal on the code |
| `frontend/src/app/foundation/auth/components/login/` | the note |
| `frontend/src/assets/i18n/en.json`, `ar.json` | the note's text |
| `frontend/src/app/core/tenant/tenant-host.ts` | the "do not add a comparison" comment |
| `CLAUDE.md`, `SYSTEM-REFERENCE.md` | Subdomain Routing / §15.13, §1.12's refusal table |

## Specs, each with a mutation that must go red

| Spec | Mutation |
|---|---|
| Guard: a matching Origin passes | compare against the wrong field |
| Guard: another organisation's Origin → `SESSION_OTHER_ORGANIZATION` | drop the check |
| Guard: a cookie session with no Origin → refused | treat a missing Origin as a pass |
| Guard: a Bearer request with no Origin passes | apply the check to Bearer too |
| Guard: an impersonation token passes at `platform`, is refused at the tenant's address | expect the token's own organisation |
| Guard: still one query | — |
| Refresh: matching passes | — |
| Refresh: a mismatch is refused, the token neither revoked nor rotated | check after the rotation |
| The platform address → the platform organisation | — |
| `labelFromOrigin()`: production, localhost, apex, `www`, two labels, a path, a port, http in production, `null`, junk | accept any port; accept http |
| CORS unchanged: `isAllowedOrigin()`'s existing specs | — |
| Frontend: restore on the code stays on the page, does not renew, sets the note | renew anyway |
| Frontend: the interceptor does not renew on the code | remove the check |
| Frontend: the renewal service records the code | — |
| Frontend: the sign-in page shows the note only when set | always show |

## Verification

1. Lint, typecheck and the affected specs, then the full backend and frontend
   suites, tenant isolation and every `check:*` scan.
2. **Browser, locally only** (never `api.accreditme.app`):
   - sign in at `http://al-nakheel.localhost:4200` as a seed user;
   - in a new tab open `http://al-manara.localhost:4200`, then
     `http://platform.localhost:4200`: each shows its sign-in page with the note;
   - the al-nakheel tab still works after a reload.

   No cookie values, tokens or passwords are printed.

No migration.
