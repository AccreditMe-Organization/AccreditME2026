# ACC-126 — a session ends 12 hours after sign-in

**Decided (Ahmad, 13 Nov 2026):** every session ends 12 hours after sign-in, however
active the person is. The rule is the same for everyone, and nothing is set per
organisation. The 30-minute idle sign-out (ACC-122) stays as it is.

**Status: plan only.** Nothing here is built. This plan was written against dev
`c6b09c5`.

---

## 0. How sessions work today (read, not assumed)

| Piece | Where | Today |
|---|---|---|
| Access token | `signAccessToken()` in `auth.service.ts` | An HS256 JWT `{ sub, organizationId, tokenVersion, impersonatedBy?, exp }`. `exp` is now + 15 min (`ACCESS_TOKEN_TTL_SECONDS`, which a local override can only shorten). It is sent as the `access_token` cookie, with `maxAge` 15 min. |
| Refresh token | `issueRefreshToken()` | Random, stored as a SHA-256 hash in a `RefreshToken` row with a 7-day `expiresAt`. Sent as the `refresh_token` cookie, path `/api/v1/auth` (ACC-203), `maxAge` 7 days. |
| Sign-in | `completeLogin()` | The one tail for both the no-MFA path (line 521) and the post-MFA path (line 581). It mints the JWT, issues the row and sets both cookies. |
| Renewal | `refresh()` | Finds the row by hash, refuses revoked or expired rows, checks the address (ACC-204), revokes the row, checks status, organisation and `tokenVersion` (ACC-122), then mints a new JWT and a new row. **Nothing links the rows of one session.** Each rotation writes an unrelated row with a fresh 7-day life, so an active session never ends. That is ACC-126. |
| Every request | `verifySessionIdentity()` in `tenant.guard.ts` | `verifyJwt()` checks the signature and `exp` in memory, then ONE user query (`tokenVersion`, organisation status and slug). |
| Sign-out | `logout()` | Public, one atomic revoke (ACC-203). |
| Impersonation | `PlatformTenantService.start/endImpersonation()` | Replaces only the access cookie with a JWT carrying `impersonatedBy`. The platform admin's own refresh row is untouched, so a refresh mid-impersonation returns them to their own identity. |
| Frontend | `authInterceptor`, `SessionRenewalService`, `AuthService.restoreSession()`, `IdleService`, the login page | A 401 means "renew once, then retry". A failed renewal calls `endSession()`, which navigates to `/login?returnUrl=…` and carries no reason. The idle rule signs out with `reason=idle`, and that reason is broadcast to other tabs. |

---

## a. Where the session's start is kept

**One nullable column on `RefreshToken`, copied unchanged on every rotation.** The
schema line goes after `tokenVersion`:

```prisma
  // ACC-126 — when this session signed in. Copied UNCHANGED onto every row a
  // rotation writes, so it is the session's start, not the row's. Nullable for
  // the rows written before this column existed (plan §c).
  sessionStartedAt DateTime?
```

**Migration:** `acc126_refresh_token_session_started_at`. It is purely additive (one
nullable column, no default, no index), so it is the expand half and has no contract
half:

```sql
ALTER TABLE "RefreshToken" ADD COLUMN "sessionStartedAt" TIMESTAMP(3);
```

There is no index because the column is only ever read from a row already found by
its unique `tokenHash`.

**The JWT carries the start as well**, as a claim `sst` (sign-in time, in epoch
seconds). The claim is signed, so it cannot be moved. It is what lets the access
token and impersonation follow the cap with no database read (§b, §d).

**One file holds the rule:** `backend/src/foundation/auth/session-limit.ts`.

```ts
export const SESSION_MAX_LENGTH_SECONDS = 12 * 60 * 60;
export function sessionEndsAt(start: Date): Date;
/** min(now + access TTL, start + 12h), in epoch seconds. */
export function accessTokenExp(now: Date, start: Date): number;
/** min(now + 7 days, start + 12h). */
export function refreshRowExpiresAt(now: Date, start: Date): Date;
```

**Where the start is written:**
- **`completeLogin()`** sets it to `new Date()`: the moment the session is issued,
  after every check, and after the MFA code when there is one.
- **`refresh()`** copies the presented row's start.
- **`issueRefreshToken()` and `signAccessToken()` take the start as a REQUIRED
  parameter.** A minting path that forgets it then fails the type check instead of
  shipping an uncapped session. Nothing defaults it.

---

## b. Where the cap is enforced

### `refresh()` refuses past 12 hours, with a code of its own

**Code: `SESSION_TIME_LIMIT`.** It is a 401, like every `AuthRefusalCode`, so the
frontend's existing 401 handling ends the session. Its one message is: *"This session
has reached its 12-hour limit. Sign in again."*

The check runs right after the row is found and found unrevoked, and before anything
else:

```text
start = existing.sessionStartedAt ?? existing.createdAt      (§c)
if now >= start + 12h:
    revoke the row   (updateMany { id, revokedAt: null } → revokedAt = now)
    clear both cookies
    throw AuthRefusalException('SESSION_TIME_LIMIT')
```

Why it goes first:
- **It comes before the `expiresAt` check.** Each new row's `expiresAt` is now
  `min(now + 7 days, start + 12h)`, so after the cap the generic "Invalid or expired
  refresh token" would otherwise answer first, and the person would get no reason.
- **It comes before the user query and the ACC-204 address check.** It needs only
  the row, so a refused refresh costs no second query. A session past its cap is
  dead at any address, so revoking it from another address takes nothing the
  person still has. That differs from the ACC-204 refusal, which must not revoke.

A refresh that passes writes the new row with:
- `sessionStartedAt`: the old row's start, unchanged;
- `expiresAt`: `refreshRowExpiresAt(now, start)`.

The refresh cookie's `maxAge` matches that `expiresAt`. A dead session's cookie then
disappears with it.

### The access token's expiry is `min(15 minutes, start + 12h)`: yes, at no cost

`signAccessToken()` sets `exp = accessTokenExp(now, start)` and adds `sst`. The
access cookie's `maxAge` is `exp - now`.

**This adds no database query on the per-request path.** `verifyJwt()` already
refuses an expired `exp` in memory, before the one user query it has always made.
Without this, someone refreshed at 11h59m would keep working until 12h14m.

**TenantGuard changes by one assignment, not one query.** It copies the verified
`sst` onto the request (`request.sessionStartedAt`), next to `impersonatedBy`. Two
places read it:
- `/auth/me`, to return `sessionEndsAt`;
- impersonation (§d).

Per ACC-271's performance rule, the PR must name this as touching the per-request
path: one claim read, no query.

`verifyJwt()` gets **no** separate `sst + 12h` check. Every minting path caps `exp`
itself (the start is a required parameter), so a second check would only repeat it.

### What the frontend is told

`sessionEndsAt` (ISO-8601) is returned by:
- `POST /auth/login` (the no-MFA path);
- `POST /auth/mfa/verify`;
- `GET /auth/me`.

All three are additive fields. `/auth/me` reads the start from the claim, so it adds
no query. It returns `null` for an access token minted before the deploy, which has
no `sst`; that only lasts until its next renewal.

---

## c. Sessions already in flight at deploy (rows with no start)

**What they get: the row's own `createdAt` stands in for the start.** On their next
refresh that value is copied onto the new row, so from then on they are capped like
any other session.

**Why `createdAt`:**
- **It is a lower bound on the session's start.** A row created at T belongs to a
  session that began at or before T. So the fallback never ends anyone EARLY; at
  worst it is generous.
- **For an active session it means "about now".** An active session rotates at
  least every 15 minutes, so its last row is at most 15 minutes old. Everyone using
  the app at deploy keeps working, with 12 hours counted from about the deploy.
  **Nobody is signed out by the deploy.**
- **A dormant row is past the cap already.** This is a closed tab whose last
  rotation was more than 12 hours ago. Its next refresh gets `SESSION_TIME_LIMIT`,
  which is exactly the new rule: that session is more than 12 hours old.
- **It is per session and deterministic, so it can be tested.**

**Alternatives rejected:**
- **Refuse every null.** This signs out everyone at the moment of the deploy, for no
  security gain (ACC-122 rejected the same choice for `tokenVersion`).
- **Treat null as "starts now".** This gives a week-old dormant session a fresh 12
  hours, which is not the rule.
- **Leave null uncapped**, as ACC-122's `tokenVersion` "unknown" did. An active
  legacy session would rotate forever with no cap, which is the defect this ticket
  exists to close.
- **`User.lastLoginAt`.** It belongs to the user, not the session. A later sign-in
  on another device would move it, and every session of that user would read it.

**The deploy itself:**
- The migration runs in the pre-deploy step while the OLD code still serves. The old
  code writes rows without the column, and those rows take the fallback.
- The old code ignores `sst`. A capped `exp` is just a shorter token, which it
  verifies as before.

**Nulls die out on their own.** After the deploy no null is written, and old null
rows expire within 7 days. Making the column `NOT NULL` and removing the fallback is
an optional later contract step, safe from 7 days after the deploy. It is not needed
for correctness.

**A session running at the deploy is measured from its last rotation, not its real
sign-in (accepted, Ahmad, 13 Nov).**
- The row it presents first after the deploy was written by its last rotation
  before the deploy. Its `createdAt` is that rotation, not the sign-in, and nothing
  else records the sign-in.
- So such a session can run up to 12 hours past the deploy, however long it had
  already been open. A session signed in at 08:00 and still active at a 16:00
  deploy is measured from about 16:00, not 08:00.
- Every session that signs in after the deploy is measured from its real sign-in.

**The later contract step (NOT NULL, fallback removed) DELETES the remaining null
rows. It never backfills them.**
- **Run it only after a check finds no live null row.** "Live" means unexpired and
  unrevoked:
  `SELECT count(*) FROM "RefreshToken" WHERE "sessionStartedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > now()`
  must be 0. That is true from 7 days after the deploy (a pre-ACC-126 row lives at
  most 7 days).
- **Then the migration does two things in one step:**
  - it deletes every row whose `sessionStartedAt` is null, all of which are by then
    expired or revoked;
  - it sets the column `NOT NULL`.
- **The same PR removes the `?? createdAt` fallback** from `sessionStartOf()`.
- **Why delete, not backfill:**
  - **Nothing can use these rows.** `refresh()` refuses a revoked or expired row
    before it reads its start, so a backfilled start would be read by nothing.
  - **A backfill would write a false fact into a security record.** The only
    available value is `createdAt`, which is the row's last rotation, not the
    session's sign-in. Stored as `sessionStartedAt`, it would claim the session
    began then, in the column the code treats as the truth.
  - **Deleting them loses no record anyone relies on.** Sign-ins are recorded in
    `AuditLog` (`LOGIN`) and `LoginAttempt`, not in refresh-token rows.
- **It is safe while the old container serves:** at that point the running code
  already handles a null by its fallback, and no null rows remain.

---

## d. Impersonation and MFA

**MFA follows the same rule, with no special case.** Both sign-in paths end in
`completeLogin()`, so the start is the moment the session is issued: after the code
is accepted.
- The 5-minute two-factor challenge before that is not a session and is unaffected.
- `pendingMfaSetupSessions` (MFA setup) holds Better Auth's own 5-minute session. It
  is never the app's session, so it is unaffected too. The person setting up MFA is
  already inside their own capped session.

**Impersonation follows the platform admin's own session. It neither resets nor
extends the cap.**
- **`startImpersonation()`** copies the admin's `request.sessionStartedAt` (from
  their verified JWT) into the impersonation token's `sst`. So its `exp` is
  `min(15 min, the admin's start + 12h)`.
- **`endImpersonation()`** copies the same `sst` back into the admin's restored
  token.
- **A refresh mid-impersonation** still renews the admin's own row (unchanged
  behaviour), and that row carries the same start.

Without this, starting an impersonation would mint a token with no start and a
fresh 15 minutes.

**Fallback for an admin token minted before the deploy (no `sst`):** use the time of
the request.
- That impersonation token still lives at most 15 minutes.
- The refresh that follows is capped by the admin's row.
- So the most this can add is 15 minutes, and only in the first 15 minutes after
  the deploy.

Impersonation is due to be removed before the first customer (ACC-99), so no more
than this is proposed.

---

## e. What the person sees

The server enforces the cap either way (§b). This decision is only about the screen.

### Option A — a warning 10 minutes before, then the sign-out (RECOMMENDED)

- **The deadline:** a new `SessionLimitService` keeps `sessionEndsAt` from sign-in
  and `/auth/me`.
- **The warning:** it reuses the idle warning's shell (`EditDialogComponent`,
  `role="alertdialog"`, deferred in the app shell with
  `@defer (on idle; when limitWarningVisible())`, as ACC-90 did for the idle
  warning). It shows once, 10 minutes before the end. The sign-out time comes from
  `FormatService.timeOfDay()` in the tenant's zone.
- **Buttons:** "Continue working" (Escape does the same: it dismisses the warning)
  and "Sign out now". **There is no "Stay signed in"**, because nothing can extend
  the session.
- **At the deadline:** `IdleService.signOut('limit')`, the existing path. It calls
  `POST /auth/logout`, clears locally and goes to `/login?reason=limit`. The reason
  is broadcast, so every tab says the same thing. `SignOutReason` gains `'limit'`.

| | English | Arabic |
|---|---|---|
| Title | Your session ends soon | تنتهي الجلسة قريبًا |
| Body | For security, a session lasts 12 hours. You'll be signed out at {{time}}. Save your work, then sign in again. | لأغراض الأمان، تمتد الجلسة 12 ساعة، وسيتم تسجيل الخروج عند {{time}}. يُرجى حفظ العمل ثم تسجيل الدخول من جديد. |
| Button | Continue working | متابعة العمل |
| Button | Sign out now (the existing `session.idle.signOutNow`) | تسجيل الخروج الآن (the existing key) |
| Sign-in page, `reason=limit` | You were signed out because a session ends 12 hours after sign-in. Sign in again to continue. | تم تسجيل الخروج لأن الجلسة تنتهي بعد 12 ساعة من تسجيل الدخول. يُرجى تسجيل الدخول من جديد للمتابعة. |

### Option B — a plain sign-out, with a message on the sign-in page

- There is no warning and no client-side deadline.
- The session ends when the server refuses it. That is the first request after the
  capped access token expires: its renewal is refused with `SESSION_TIME_LIMIT`.
- The person lands on `/login?reason=limit`.
- **Text:** only the sign-in page row from the table above, in both languages.

### Plumbing both options need

**A server refusal must reach the sign-in page as `reason=limit`.** This is the only
path in Option B, and in Option A it covers a tab asleep through the deadline.
- `authInterceptor`'s renewal `catchError` today discards the refresh error and
  calls `endSession(error)` with no reason. It passes the refusal code through
  instead, and `SESSION_TIME_LIMIT` adds `reason: 'limit'`.
- `restoreSession()` (start-up) never navigates (ACC-24), so it records the code in
  a small state the login page reads. This is the same shape as ACC-204's
  `SessionAddressState`.

### Recommendation: Option A

**Why:**
- **Someone reaching the cap is, by construction, active.** The idle rule would
  otherwise have signed them out first. An active person is likely to be in the
  middle of a form, and a sign-out with no notice loses that work. Avoiding exactly
  that is why ACC-122 added the idle warning.
- **10 minutes, not the idle warning's 2.** The person cannot extend the session.
  They need time to finish and save, not one click.
- **The cost over B is one small service and one deferred dialog.** Both copy
  patterns that already exist.

**Arabic copy:** singular address and gender-neutral throughout. It uses the
passive or noun form («يُرجى», «سيتم تسجيل الخروج»), never a gendered verb about the
person. Digits are Latin (ACC-94).

---

## f. Tests

Backend tests use `useFixedClock()` per test (ACC-248). Each must be watched failing
under its mutation.

**`session-limit.spec.ts`:**
- `SESSION_MAX_LENGTH_SECONDS` is exactly 12 × 3600, pinned by reading it.
- `accessTokenExp`: 15 minutes when the cap is far away; exactly start + 12h when
  closer than that; never later than start + 12h.
- `refreshRowExpiresAt`: the same, against 7 days.

**`auth.service.spec.ts`, `refresh()`:**
- **Under 12 hours is not refused:**
  - a refresh at start + 11h59m succeeds;
  - the new JWT's `exp` is start + 12h (1 minute away, not 15);
  - the new row's `expiresAt` is start + 12h.
- **Rotation keeps the start:** the new row's `sessionStartedAt` equals the old
  row's, and the new JWT's `sst` equals it too. Not "now".
- **Continuously active past 12 hours is refused.** A loop rotates every 14 minutes
  from a sign-in at T0, each time presenting the token the previous refresh issued:
  - every refresh before T0 + 12h succeeds;
  - the first at or after T0 + 12h gets `SESSION_TIME_LIMIT`;
  - that row is revoked, no new row is written, and both cookies are cleared.
  This is the test that proves activity does not extend the session.
- **The boundary:** exactly start + 12h is refused (`>=`).
- **The cap is checked first:** the refusal names `SESSION_TIME_LIMIT`, not the
  generic expiry. It is given even at another organisation's address, and with no
  user query.
- **Legacy null rows:**
  - created 11 hours ago: refresh succeeds, and the new row is stamped with that
    `createdAt`;
  - created 13 hours ago: refused with `SESSION_TIME_LIMIT`.

**`auth.service.spec.ts`, sign-in:**
- Both paths (no MFA, and after MFA verification) stamp `sessionStartedAt` = now on
  the row and `sst` = now in the JWT.
- Both paths return `sessionEndsAt` = now + 12h.

**`verifyJwt` / TenantGuard:**
- A token minted at start + 11h55m is refused at start + 12h + 1s.
- `sst` is copied onto the request.
- **The query count is unchanged:** the guard makes the same single user query as
  before, pinned like ACC-168's count test.

**`platform-tenant.service.spec.ts`:**
- The impersonation token's `sst` is the admin's, and its `exp` is capped by it.
- Ending impersonation restores the admin's `sst`.
- With no `sst`, the start is the time of the request.

**`auth-refusal.spec.ts`:** the new code and its one message.

**`auth.controller.spec.ts`:** `/auth/me` returns `sessionEndsAt` from the claim, or
`null` without one.

**Frontend:**
- **Interceptor:** a renewal refused with `SESSION_TIME_LIMIT` navigates with
  `reason=limit`. Any other refusal navigates without a reason, as today.
- **`restoreSession()`:** the same refusal records the reason and does not navigate
  (ACC-24).
- **Login page:** `reason=limit` shows the message, in both languages.
- **Option A only:**
  - the warning appears at T − 10 min and not before;
  - Continue and Escape dismiss it;
  - at T: `logout()`, `clearSession()` and `/login?reason=limit`;
  - the broadcast carries `'limit'` to other tabs;
  - the deferred block loads when due (ACC-90's pattern).
- **Arabic copy:** the new keys are pinned (as `home-arabic.spec.ts` does).

**Mutations, each of which must go red:**
1. `12 * 60 * 60` → `13 * 60 * 60`: the constant spec and the boundary test.
2. `refresh()` stamps `new Date()` instead of copying the start: rotation-keeps-start
   and continuously-active.
3. The cap check is removed from `refresh()`: continuously-active (the 12h refresh
   would succeed, or fail with the generic message) and the code test.
4. `exp` is minted as now + 15 min with no `min()`: the access-token cap test.
5. The `?? existing.createdAt` fallback becomes `?? now`: the 13-hour legacy test.
6. Impersonation mints with the request time instead of the admin's `sst`: the
   impersonation test.

---

## g. Files that change, and the shared database and deploy

**Backend:**
- `prisma/schema.prisma`: one line (§a).
- The migration `acc126_refresh_token_session_started_at`.
- **New:** `foundation/auth/session-limit.ts` and its spec.
- `foundation/auth/auth.service.ts`:
  - `signAccessToken` and `mintAccessToken` take the start and cap `exp`;
  - `issueRefreshToken` takes the start and caps `expiresAt`;
  - `completeLogin` and `refresh` (the check, the copy, the cookie lifetimes);
  - the login and MFA results carry `sessionEndsAt`.
- `foundation/auth/auth-refusal.ts`: the code and its message.
- `foundation/auth/auth.controller.ts`: `/auth/me` returns `sessionEndsAt`.
- `common/guards/tenant.guard.ts`: `JwtPayload.sst`, and the request field. No query.
- `common/decorators/`: a `@SessionStartedAt()` decorator, or the request read in
  place.
- `platform/tenant/platform-tenant.service.ts` and `.controller.ts`: pass the start.
- The specs in §f.

**Frontend:**
- `core/services/auth.service.ts`: `sessionEndsAt` from login, MFA and `/auth/me`.
- `core/interceptors/auth.interceptor.ts` and `restoreSession()`: carry the reason
  through.
- `core/services/idle.service.ts`: `'limit'` as a reason.
- `foundation/auth/components/login/login.component.ts`: the message.
- `assets/i18n/en.json` and `ar.json`.
- The specs.
- **Option A also:**
  - a `SessionLimitService` and a `session-limit-warning` component under
    `core/components/`;
  - `layout/app-shell/app-shell.component.ts`: one `@defer` block.

**Docs:**
- `SYSTEM-REFERENCE.md` §1.11 (renewal and the rule) and §1.12 (the new refusal
  code).
- `CLAUDE.md` Token Management: the line "Absolute session length — NOT BUILT …
  ACC-126" becomes a description of the rule.

**The shared database and the deploy:**
- **One additive migration.** The pre-deploy step runs it on merge (ACC-127), never
  by hand before. Additive, so it is safe while the old container serves (§c).
- **No backfill and no data script.** Null rows are handled by the fallback.
- **No database writes while building or verifying.** Live proof would need a
  12-hour session, so a local run uses `AUTH_ACCESS_TOKEN_TTL_SECONDS` and the fixed
  clock in specs. There is no override for the 12 hours: a variable that could
  lengthen it on a deployed environment would be the ACC-122 trap.
- **No Railway variable, no `railway config apply`, no frontend hosting change.**
- **At the deploy:**
  - nobody active is signed out;
  - a tab closed more than 12 hours ago is refused at its next renewal, and its
    person signs in again;
  - from then on, every session ends 12 hours after sign-in.

**Known and out of scope:** `refresh()`'s rotation is read-then-update, not atomic,
so two concurrent refreshes of the same token can both succeed. The frontend
serialises refreshes (`SessionRenewalService`), and both resulting rows carry the
same start, so the cap still holds. It is noted here, not fixed.

---

## h. As built (CC-253, 13 Nov)

Ahmad's decisions: Option A, with a 10-minute warning, "Continue working" and "Sign
out now", and no "Stay signed in". Sessions open at the deploy use the row's
`createdAt`.

**Where the build differs from §a–g:**
- **Impersonation creates no `RefreshToken` row.** It replaces the access cookie
  only, so "every path that creates a row sets the start" covers sign-in, after
  MFA, and refresh.
  - Impersonation start and end carry the platform admin's start in the token's
    `sst` (§d).
  - `refresh-token-writes.scan.spec.ts` pins that `issueRefreshToken()` is the only
    place a row is created (no second `create`, `createMany`, `upsert` or raw
    `INSERT` under `src/` or `prisma/`). Its start is a required `Date`, and its
    create writes it.
- **`signAccessToken()` returns `{ token, expiresAt }`** so each cookie's `maxAge`
  is the credential's own life.
- **The frontend splits the state from the timer:**
  - `SessionLimitState` (no dependencies) holds the deadline and the refusal note.
  - `SessionLimitService` holds the once-a-second clock and the warning, and signs
    out through `IdleService.signOut('limit')`.
  - Putting the state in a service that injects `IdleService` would close the
    injection cycle AuthService → … → IdleService → AuthService.
- **The clock runs outside Angular's zone.** A timer that never ends kept the zone
  from ever being stable; the sign-out goes back into the zone to navigate.
- **The phone-shell and workflow-scroll specs stub the limit warning**, as they
  already stub the idle warning. Not stubbed, the real dialog shell's document
  Escape listener (attached at construction) read its required `visible` input
  in the instant between a deferred block creating the component and binding its
  inputs.
  - That gap is the shared dialog shell's, on dev too.
  - It is noted here, not changed.

**Performance:** no query is added to TenantGuard or any per-request path. The
guard copies the already-verified `sst` claim onto the request. Specs pin the guard
at its one user query, and `refresh()` at no user query when it refuses at the
limit.
