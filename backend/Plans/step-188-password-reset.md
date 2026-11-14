# Step 188 — Reset a forgotten password (ACC-188)

**Decided (14 Nov).** Ahmad answered §3, lane B reviewed the migration, and the
design is final. **§7 records every decision since the first draft, and where §7
and an earlier section differ, §7 wins.** The earlier sections are kept as the
reasoning that led there.

Read against `dev` at `b62c3a4` and `better-auth@1.6.22` (14 Nov). Every
statement about Better Auth below is taken from its installed source, with the
file named.

## 0. What stands from the ticket (not reopened)

- **The link is a TENANT link built by `buildTenantUrl()`**:
  `https://{slug}.accreditme.app/reset-password?token=…`. It is never Better
  Auth's `data.url`, which points at a handler this API does not mount
  (ACC-148), and never Better Auth's `/reset-password/:token` route.
- **Forgot password answers the same neutral 200 for a real address and an
  unknown one.**
- **The existing rate limits stay**: Forgot password allows 20 an hour per address
  plus 3 an hour per organisation + email, and Reset password allows 20 an hour
  per address.
- **ACC-99 (a support-initiated reset) stays separate.** This ticket is
  self-service only.
- **The "not yet filed" comment** at `auth.service.ts` (`forgotPassword()`)
  gets this ticket's number.

## 1. What is true today

| Piece | File | State |
|---|---|---|
| `POST /auth/forgot-password` | `auth.controller.ts`, `auth.service.ts` `forgotPassword()` | Accepts the body, does nothing, returns 200 |
| `POST /auth/reset-password` | same, `resetPassword()` | Calls `auth.api.resetPassword`; no token can exist, and its refusals are not mapped |
| `sendResetPassword` | `providers/auth/better-auth.config.ts` | Unreachable. If it were reached it would send `data.url` through `NotificationService` |
| Forgot password page | `frontend/…/forgot-password/forgot-password.component.ts` | A note, no form (`auth.forgotPasswordUnavailable`) |
| Reset page | — | Does not exist. `AuthService.forgotPassword()` / `resetPassword()` exist and nothing calls them |
| New-IP email | `auth.service.ts` `completeLogin()` | Says "reset your password immediately" with no link |

**A finding that changes how the email is sent.** Every email in the app is a
`Notification` row. `NotificationService.create()` stores the body, writes an
audit row whose `after` is the whole notification, and queues
`email-delivery`. The bell (`getForUser()`) lists every row whatever its
channel. So a reset link sent the usual way would sit **in the person's bell
and, for three years, in `AuditLog`**, the append-only table that ships in the
tenant's own export. The reset email therefore does not go through
`NotificationService` (see §2.3).

## 2. Better Auth, read from its source

### 2.1 Issuing — `better-auth/dist/api/routes/password.mjs`, `requestPasswordReset`

1. `findUserByEmail(email)`. Our AuthUser emails are namespaced
   (`AuthService.namespacedEmail(organizationId, email)`), so the caller must
   send the namespaced form.
2. **No user:** it runs `generateId(24)` and one `findVerificationValue("dummy…")`
   "to mitigate timing attacks", then returns `{ status: true }`. **A real
   user:** it creates a verification row and awaits `sendResetPassword`. The two
   paths do different work, so their timing is not equal (§2.4).
3. **The token** is `generateId(24)` (`@better-auth/core/dist/utils/id.mjs`):
   24 characters from `a-z A-Z 0-9`, about 143 bits.
4. **The stored row** is `{ identifier: "reset-password:<token>", value: <AuthUser
   id>, expiresAt }`. The lifetime is `emailAndPassword.resetPasswordTokenExpiresIn`,
   **default 3600 s (1 hour)**.
5. **The token is stored IN PLAIN by default.** `internal-adapter.mjs`
   `createVerificationValue` passes the identifier through `processIdentifier()`
   (`db/verification-token-storage.mjs`). With no `verification.storeIdentifier`
   option, which is our configuration, it is stored as written. The option
   accepts `'hashed'` (SHA-256, base64url) per prefix:
   `{ default: 'plain', overrides: { 'reset-password:': 'hashed' } }`.
6. **The callback receives `{ user, url, token }`** and is awaited through
   `runInBackgroundOrAwait()` (`context/create-context.mjs`), which **catches and
   only logs** any error. A failing callback still reads as success to the caller.

### 2.2 Consuming — same file, `resetPassword`

In this order:

1. Length checks: `PASSWORD_TOO_SHORT` (< 8) and `PASSWORD_TOO_LONG` (> 128).
2. **`consumeVerificationValue("reset-password:<token>")`**
   (`internal-adapter.mjs`). Inside a transaction and a lock it takes the newest
   row for the identifier, deletes every row for it, and **returns null if the
   row had expired**. It is atomic and single-use: of two simultaneous calls, only
   one gets the row. A used, an expired and an unknown token all end as the same
   `INVALID_TOKEN`, and nothing is left afterwards to tell them apart.
3. `password.hash(newPassword)`. **The breached-password check runs HERE**: the
   `haveIBeenPwned` plugin wraps `hash` for the path `/reset-password`
   (`plugins/haveibeenpwned/index.mjs`). **This is after the token has been
   consumed.** So a person who picks a breached password, or who submits while
   the check service is unreachable, loses their link. We must check the
   password before calling it (§2.5, step 4).
4. Update the credential account's password. Then `onPasswordReset` if
   configured, and `deleteUserSessions` if `revokeSessionsOnPasswordReset`. Those
   are Better Auth's own `authSession` rows, not our refresh tokens.
5. It returns `{ status: true }` and does not name the user.

Opportunistic cleanup: `findVerificationValue` deletes every expired
verification row in the table on each call. The two-factor plugin also keeps
challenges there (`two-factor-challenge.ts`), so expired rows vanish whenever
anything reads one. That is a second reason an "expired" outcome cannot be read
from Better Auth's table.

### 2.3 What follows

- **Better Auth stays the single-use authority** for the token and the writer of
  the password, through its public `auth.api` calls.
- **A small ledger of our own records each link's outcome** (`PasswordResetLink`,
  §6), because Better Auth keeps nothing once a token is used or expired. The
  ticket asks for a stated outcome for each.
- **The token never reaches a table of ours in plain text.** Better Auth's row is
  hashed by the `storeIdentifier` override, and the ledger holds a SHA-256 hash.
  The link exists only in the email that Resend sends.
- **The reset email is sent directly, not as a `Notification`.** No bell entry,
  no audit row carrying the link (§1).

### 2.4 Identical answers for a real and an unknown address

Doing the work inside the request cannot give identical timing: a real address
writes a row, resolves the user and the organisation, and sends mail, while an
unknown one does one dummy read. So **`POST /auth/forgot-password` only enqueues
a job and returns.**

- Both cases do the same work: DTO validation, the two throttlers and one Redis
  `add`.
- Both cases return the same `200 {}` (today's body, unchanged).
- Everything that depends on whether the account exists happens in the worker.

### 2.5 The flow, end to end

**Request (public, no session).**

1. **Forgot password page:** the restored form sends `POST /auth/forgot-password
   { organizationSlug, email }`. `organizationSlug` comes from the address, as
   today.
2. **`AuthController.forgotPassword`:** unchanged decorators. **`AuthService.forgotPassword()`**
   calls `PasswordResetRequestQueue.enqueue({ organizationSlug, email })`, with
   one attempt, `removeOnComplete: true` and `removeOnFail: { age: 7 days }`,
   because the job holds an email address. Then it returns. A failed `add` is
   logged with the error's kind only (ACC-297's rule) and still returns 200. The
   person asks again.
3. **`PasswordResetProcessor`** (new, queue `password-reset`, behind
   `workersEnabled()`) calls `PasswordResetService.issue()`:
   - **a.** Resolve the organisation by slug. If there is none, or it is not open
     (`isOrganizationOpen`), stop.
   - **b.** Find the User by `{ organizationId, email }`. Stop if there is none,
     if it is not ACTIVE, or if it has no `authUserId` (an INVITED person has
     nothing to reset: they accept their invitation instead).
   - **c.** Call `auth.api.requestPasswordReset({ body: { email: namespacedEmail } })`
     inside `resetTokenCapture.run(holder, …)`, an `AsyncLocalStorage`.
     **`sendResetPassword` becomes a capture**: it writes `{ authUserId, token }`
     into the holder and does nothing else. It never reads `url`. If the holder
     is still empty afterwards, stop and log the ids.
   - **d.** In one transaction:
     - end every open ledger row for this user with `endReason = 'replaced'`, and
       delete their Better Auth rows (§3.1: only the newest link works);
     - insert the ledger row `{ organizationId, userId, tokenHash, expiresAt }`;
     - write one audit row: `UPDATE` / `User`, metadata
       `{ event: 'password_reset_requested' }`. No token, no link.
   - **e.** `link = buildTenantUrl(org.slug, '/reset-password?token=' + token)`.
   - **f.** `TransactionalEmailService.send({ to: user.email, language, subject,
     body })`. The language is `resolveLanguage(user.language, organizationId)`,
     the same rule as sign-in. The body is rendered by `renderEmailHtml()`. The
     Resend call is extracted from `NotificationEmailProcessor` into this one
     service, so both use one sender and one `RESEND_FROM_EMAIL` rule (no
     fallback).

**Reset (public, no session).**

4. **The Reset password page** (`/reset-password?token=…`, new) reads the token
   once and replaces it out of the address bar, as Accept invitation does. It
   then sends `POST /auth/reset-password/lookup { token }` (new; POST so the
   token never lands in a URL or an access log).
5. **`PasswordResetService.lookup(token, origin)`** reads the ledger by
   `tokenHash`, joined to the user and the organisation. The answers:
   - **`{ state: 'open', expiresAt }`**;
   - **400 `RESET_LINK_EXPIRED`**;
   - **400 `RESET_LINK_USED`**;
   - **400 `RESET_LINK_REPLACED`**;
   - **400 `RESET_LINK_INVALID`** for everything else: no row, a malformed
     token, a void row, an inactive user, a closed organisation, or **an
     `Origin` that is not the token's organisation's address** (`isAtOwnAddress`,
     ACC-204's parsing).

   The four refusals tell the holder of a 143-bit token nothing they could use;
   a person with no token reaches only `INVALID`. It is read-only and changes
   nothing.
6. **The page shows a form only for `open`.** The person types a new password
   and confirms it. Then `POST /auth/reset-password { token, password }`.
7. **`PasswordResetService.reset(token, password, origin, ip)`:**
   - **a.** The same lookup as step 5. Anything but open is refused with its code
     before anything is consumed.
   - **b.** **The breached-password check, BEFORE consumption** (§2.2):
     `PasswordBreachCheckService.check(password)` makes the same k-anonymity
     request the plugin makes (SHA-1 prefix, `Add-Padding`). A breached password
     is `PASSWORD_COMPROMISED`, and an unreachable service is
     `PASSWORD_CHECK_UNAVAILABLE`, through the existing `PasswordRefusalException`.
     The token is untouched and the person can try another password.
   - **c.** `auth.api.resetPassword({ body: { token, newPassword } })`:
     - Its own refusals go through `passwordRefusalCode()`. Too short or too
       long happen before consumption, so the link survives.
     - **`INVALID_TOKEN`** means another request used it first. Answer
       `RESET_LINK_USED`.
     - **A password refusal AFTER our check passed** means the breach list
       answered differently a second later. The token is gone. Mark the ledger
       row `endReason = 'void'` and answer `RESET_LINK_INVALID`, so the person
       asks for a new link. This is rare, and is stated rather than engineered
       around.
   - **d.** In one transaction:
     - mark the ledger row used (`endedAt = now, endReason = 'used'` WHERE
       `endedAt IS NULL`);
     - `User.tokenVersion += 1`;
     - revoke every live refresh token of the user (`revokedAt = now`);
     - record a `LoginAttempt` `{ success: true, failureReason: 'password_reset' }`
       (§3.3);
     - write one audit row: `UPDATE` / `User`, `{ event: 'password_reset' }`.
   - **e.** After the commit, send a "your password was changed" email through
     `NotificationService` (`EMAIL`). It carries no link or secret, so a row in
     the bell is fine.
8. **The page goes to `/login`** with the navigation state
   `PASSWORD_RESET_NOTICE`: "Your password is changed. Sign in with it." It
   **never signs the person in** (§3.4).

**The new-IP email** (`completeLogin()`): the sentence links to
`buildTenantUrl(slug, '/forgot-password')` (§4.3). `completeLogin()`'s user read
adds `organization.slug` to its existing `select`, so there is no extra query.

### 2.6 Every file that changes

**Backend**
- `providers/auth/better-auth.config.ts`:
  - `sendResetPassword` becomes the capture;
  - `resetPasswordTokenExpiresIn: RESET_LINK_TTL_SECONDS`;
  - `revokeSessionsOnPasswordReset: true`;
  - `verification.storeIdentifier` override for `reset-password:`;
  - the factory no longer needs `NotificationService`.
- `foundation/auth/password-reset/` (new): `password-reset.service.ts` (`issue`,
  `lookup`, `reset`), `password-reset.processor.ts`, `reset-token-capture.ts`
  (the ALS), `password-breach-check.service.ts`, `reset-link-refusal.ts` (the
  four codes, one exception), `reset-link.config.ts` (`RESET_LINK_TTL_SECONDS =
  3600`).
- `foundation/auth/auth.service.ts`: `forgotPassword()` enqueues;
  `resetPassword()` delegates; `completeLogin()` changes the new-IP sentence; the
  "not yet filed" comment is replaced.
- `foundation/auth/auth.controller.ts`: `POST reset-password/lookup` (public,
  `@perAddress(RATE_LIMITS.resetPasswordLookup)`); the two existing routes keep
  their decorators.
- `foundation/auth/dto/reset-password.dto.ts`: add `@MaxLength(128)`. A
  `reset-link-lookup` DTO is NOT added: like `lookupInvitation()`, the body is
  shape-checked in the service, so a malformed body gets `RESET_LINK_INVALID`
  and not the pipe's own message.
- `foundation/notification/transactional-email.service.ts` (new, extracted from
  `notification-email.processor.ts`, which then calls it).
- `common/throttle/rate-limits.ts` and its spec: `resetPasswordLookup: { limit:
  30, ttl: MINUTE }`, mirroring `invitationLookup`.
- `common/queue/queue.module.ts` and `workers.config.ts`: register
  `password-reset` and add it to `WORKER_QUEUES`.
- `prisma/schema.prisma` and one migration (§6).

**Frontend**
- `foundation/auth/components/forgot-password/`: the form is restored.
- `foundation/auth/components/reset-password/` (new), and the route in
  `auth.routes.ts`.
- `core/services/auth.service.ts`: `lookupResetLink(token)`.
- `foundation/auth/components/login/`: shows `PASSWORD_RESET_NOTICE`.
- `assets/i18n/en.json` and `ar.json`: `auth.forgotPassword*` and `auth.reset.*`.
  `auth.forgotPasswordUnavailable` is deleted.

**Docs**
- CLAUDE.md: the Rate Limiting table (the lookup row), Background Jobs (the
  eighth queue), and the Token Management bullet "Forgot password sends
  nothing", which is rewritten.
- SYSTEM-REFERENCE.md §1.12 / §15.14: the flow.

## 3. The open questions — recommendations

### 3.1 How long a link lives, and how many

**Recommend: 1 hour, single-use, and only the newest link works.**

- **One hour** is Better Auth's default. It is what the old email already
  promised, and it is long enough for mail delayed by a hospital's filtering.
  Longer only widens the window for a link left in an inbox.
- **Single-use** is Better Auth's own behaviour (§2.2). We add nothing to it.
- **A new request replaces the old link** (§2.5, step 3d). With 3 requests an
  hour allowed, three live links for one account would make "which email do I
  use?" a real question, and two of the three would be spare keys. A replaced
  link gets its own outcome ("a newer link was sent"), not "invalid".

### 3.2 Does a reset end every other session?

**Recommend: yes, every one, at once.**

- The usual reason to reset is suspicion: the new-IP email literally says so.
  A reset that leaves an attacker's session alive answers nothing.
- The mechanism exists and is proved:
  - `tokenVersion += 1` is what `invalidateUserSessions()` does;
  - `TenantGuard` refuses a stale access token on the next request;
  - `refresh()` refuses a refresh token issued at another version (ACC-122).
- We also revoke the refresh rows themselves, in the same transaction. That way
  the effect does not rest on the version check alone, and the rows say what
  happened.
- `revokeSessionsOnPasswordReset: true` clears Better Auth's own sessions too.
- The person loses nothing: they are not signed in on the device they are
  resetting from.

### 3.3 Does a reset clear an account lock?

**Recommend: yes.** We record it as a `LoginAttempt` with `success: true,
failureReason: 'password_reset'`, which ends the streak exactly as a sign-in
does (`lockedUntil()` stops at the first success).

- **The common case is the person who locked themselves out by guessing.**
  Leaving the lock means they reset successfully and are then refused for up to
  15 minutes, with no way to know why.
- **Proving control of the inbox is stronger evidence than a password.** Anyone
  who can open the link already owns the account, so the lock protects nothing
  from them.
- **Nothing is deleted.** The failed rows stay as the record.
- `failureReason` is a free string, so this needs no migration. Its name keeps
  the row distinguishable from a real sign-in in any later report.
- **It does NOT clear the MFA code lock** (`twoFactorLockedUntil`). That one
  protects the second factor, which a reset must not touch (§3.4).

### 3.4 MFA on

**Recommend: a reset changes the password and nothing else; it never signs in.**

- The page sends the person to Sign in. Sign in asks for the password and then,
  with MFA on, the code, exactly as today.
- The reset does not read, change or turn off `AuthUser.twoFactorEnabled`.
- An email link therefore never stands in for the second factor.
- Someone who has lost their authenticator is not helped by this flow. That is
  ACC-164 and, for administrators, ACC-99. The Reset page does not mention MFA,
  because it cannot know whether the account has it without saying so to
  whoever holds the link.

### 3.5 Smaller calls, recommended

- **Inactive, invited, or in a closed organisation:** no link is issued, and the
  answer stays the neutral 200, decided in the worker. An open link stops
  working if the account is deactivated or the organisation closes meanwhile
  (`RESET_LINK_INVALID`).
- **The confirmation email after a reset:** yes, with no link (§4.2). It is the
  only signal an owner gets if someone else reset the password.
- **Mail delivery:** Resend's verified domain is `accreditme.app` (ACC-130,
  resolved). Nothing new is needed.

## 4. The emails

The Arabic follows the ACC-279 rule: singular address, no gendered verb about a
person, and «منشأة» for organisation. Instructions to the reader use the app's
existing imperative form («افتح», as «أدخل» and «اختر» elsewhere).
`{organisation}` is resolved with the bilingual rule: Arabic name, else English.

### 4.1 The reset link

| | English | Arabic |
|---|---|---|
| Subject | Reset your AccreditMe password | إعادة تعيين كلمة مرور AccreditMe |
| Body | We received a request to reset the password for your account at {organisation}. To choose a new password, open this link within 1 hour: {link}<br><br>The link works once. If you didn't ask for this, ignore this email; your password hasn't changed. | وصل طلب لإعادة تعيين كلمة المرور لحسابك في منشأة {organisation}. لاختيار كلمة مرور جديدة، افتح هذا الرابط خلال ساعة: {link}<br><br>يعمل الرابط مرة واحدة فقط. إذا لم يكن الطلب منك، فتجاهل هذه الرسالة؛ كلمة المرور لم تتغير. |

"1 hour" / «ساعة» comes from `RESET_LINK_TTL_SECONDS`, and a spec pins the two
together.

### 4.2 After a reset (no link)

| | English | Arabic |
|---|---|---|
| Subject | Your AccreditMe password was changed | تم تغيير كلمة مرور AccreditMe |
| Body | The password for your account at {organisation} was just changed, and you were signed out everywhere. If this wasn't you, contact your organisation's administrator now. | تم تغيير كلمة المرور لحسابك في منشأة {organisation} للتو، وتم تسجيل خروجك من كل الأجهزة. إذا لم يكن هذا منك، فتواصل مع مسؤول النظام في منشأتك الآن. |

There is no date: server-built text bypasses the formatting layer (ACC-95), and
"just" is true when it arrives.

### 4.3 The new-IP email's sentence

| | Today | After |
|---|---|---|
| EN | If this wasn't you, reset your password immediately. | If this wasn't you, reset your password now: {forgotLink} |
| AR | إذا لم يكن هذا أنت، فأعد تعيين كلمة المرور فورًا. | إذا لم يكن هذا منك، فأعد تعيين كلمة المرور الآن: {forgotLink} |

`{forgotLink}` is `buildTenantUrl(slug, '/forgot-password')`, the person's own
address. `renderEmailHtml()` already links product URLs only, and this is one.

## 5. Tests

### 5.1 Specs

**The link**
- `password-reset.service.spec`: the emailed link equals
  `buildTenantUrl(slug, '/reset-password?token=' + token)`, with the module
  mocked and the call asserted. It never contains Better Auth's `url`: the
  capture is handed a `url` of `https://api.example/SENTINEL`, and the body must
  not contain `SENTINEL` or `API_ORIGIN`.
- `better-auth.config.spec`: `sendResetPassword` writes the capture and calls
  nothing. Its source never names `data.url` / `.url` (a scan, like
  `check:ai-gateway`'s, so a future edit cannot quietly start sending it).
- No `Notification` row and no `AuditLog` row contains the token or `/reset-password?token`.

**The neutral answer**
- `forgot-password.neutral.spec`: through the real controller and
  `ValidationPipe`, a real active address, an unknown address, an INVITED one, an
  INACTIVE one and an unknown slug each give the same status, the same body
  (byte for byte), and the same sequence of calls in the request (exactly one
  `queue.add`, and no Prisma or Better Auth call). That sequence is the timing
  shape, made checkable. A failed `add` still gives the same 200.
- `password-reset.processor.spec`: only an active user in an open organisation
  gets a link; every other case issues nothing and sends nothing.

**Outcomes**
- `password-reset.lookup.spec`: open; expired (`expiresAt` passed, with a fixed
  clock per ACC-248); used; replaced; unknown; malformed body; inactive user;
  closed organisation; another organisation's `Origin`. Each has its own code,
  and the last six share `RESET_LINK_INVALID` byte for byte.
- `password-reset.reset.spec`:
  - A breached password is refused with the token untouched: Better Auth's
    `resetPassword` is NOT called.
  - Too short and too long leave the link usable.
  - A lost race (`INVALID_TOKEN`) answers `RESET_LINK_USED`.
  - A post-consumption refusal voids the row.
  - Success makes all five writes of §2.5, step 7d, in one transaction, and
    sends the confirmation after commit.
- **A used and an expired token, end to end:** a second `reset` with the same
  token answers `RESET_LINK_USED`; a token past its hour answers
  `RESET_LINK_EXPIRED`. They are different codes and different screens.
- **Sessions:** after a reset, `refresh()` with a refresh token issued before it
  is refused, and the access token's version is stale for `TenantGuard`.
- **The lock:** after five failures and a reset, `isLocked()` is false; the MFA
  code lock is unchanged.
- **MFA:** the reset never sets a cookie or returns a session; the
  `twoFactorEnabled` user's next `login()` still answers `mfaRequired`.

**Rate limits**
- `rate-limits.spec`: pins the new lookup row.
- `auth.controller.spec`: the three routes carry their throttler decorators, and
  forgot password keeps `LimitResetsPerEmail`. Existing throttler-guard specs
  cover counting.

**Better Auth contract** (`better-auth.contract.spec`, which reads the installed
source like its existing blocks). It pins:
- the identifier prefix `reset-password:`;
- the 3600 default;
- that `resetPassword` consumes BEFORE it hashes, so the pre-check stays
  necessary. If an upgrade moves the check earlier, this goes red and the
  pre-check can be reconsidered;
- that `storeIdentifier` overrides exist.

**Frontend**
- Forgot password: empty email, a malformed one, sending, the neutral sent
  state, 429, unreachable.
- Reset: the token leaves the address bar, the skeleton, the states of the
  brief, mismatch, the password refusal codes on the field, success going to
  Sign in with the notice.
- Both languages; `check:*` as usual.

### 5.2 Mutations (each must turn a named spec red)

1. Build the link from `data.url`.
2. Do the account lookup in the request instead of the worker.
3. Drop the breach pre-check.
4. Skip `tokenVersion += 1`.
5. Skip the refresh-row revoke. Only the rows assertion should go red; the
   version check still holds, which is the point of having both.
6. Treat `RESET_LINK_REPLACED` as open.
7. Remove the `Origin` check.
8. Drop the `storeIdentifier` override.
9. Remove `@perAddress` from the lookup.
10. Make `resetPassword` sign the person in.

## 6. Shared database, migration, deploy

- **One additive migration**, `acc188_password_reset_link`, adds
  `PasswordResetLink`:

  | Column | Type |
  |---|---|
  | `id` | |
  | `organizationId` | FK |
  | `userId` | FK |
  | `tokenHash` | unique |
  | `expiresAt` | |
  | `endedAt` | null |
  | `endReason` | `'used' \| 'replaced' \| 'void'`, null |
  | `createdAt` | |

  It is indexed on `(organizationId, userId, endedAt)`.
  - It is expand only: a new table nothing deployed reads, so it is safe
    against the running code when the pre-deploy step applies it.
  - Rows older than 30 days are deleted by `issue()` for that user. There is no
    new job.
- **No change to `AuthVerification`.** No reset rows exist (Forgot password has
  written none since CC-64, and any older one expired within its hour), and
  `consumeVerificationValue` also tries the plain identifier, so the hashing
  override needs no backfill.
- **No backfill, no new environment variable.** `RESEND_FROM_EMAIL`,
  `APP_BASE_DOMAIN` and `RUN_WORKERS` exist.
- **A new queue, `password-reset`.** Railway's worker picks it up from
  `WORKER_QUEUES`.
- **Locally, never enqueue.** Redis is shared with the deployed worker (the
  ACC-51 caveat). A local Forgot password press would be consumed by Railway's
  worker, which would issue a real link to a real seeded inbox. Verify issuing
  in-process (call `PasswordResetService.issue()` directly), as ACC-51 did.
- **The live proof runs after the deploy**, with an account whose inbox we
  control. Seeded addresses are not ours to mail.
- **The migration runs in the pre-deploy step on merge, never before.**

## 7. Decisions in (14 Nov) — these win over §0–§6

All are on Linear ACC-188.

### 7.1 Ahmad's four rules

1. **A link lasts 1 hour and works once, and only the newest works.** Asking
   again ends the earlier link (`REPLACED`).
2. **A successful reset signs the person out everywhere** (§7.4).
3. **A reset clears the wrong-password lock, but not the MFA code lock.**
   - The wrong-password lock is cleared with a `LoginAttempt` `{ success: true,
     failureReason: 'password_reset' }`; nothing is deleted.
   - `AuthTwoFactor.lockedUntil` and `failedVerificationCount` are not touched.
4. **A reset never bypasses MFA.** It never signs anyone in. Sign in asks for the
   password and then, with MFA on, the code.

### 7.2 Lane B's review of the migration

- **`endReason` is an enum**, `PasswordResetLinkEndReason { USED REPLACED VOID }`,
  with a one-line comment. Creating it together with the table is one deploy.
  Adding a value later takes two: add it, then write it (ACC-202).
- **The foreign keys use RefreshToken's and LoginAttempt's onDelete**: none
  stated, so the database default (`RESTRICT`), and tenant teardown works as it
  does for those tables.
- **One open link per user, under a lock.** The issuing transaction takes the
  User row `FOR UPDATE` (scoped by `id` and `organizationId`), ends every open
  link `REPLACED`, and creates the new one, all in that transaction (ACC-173's
  shape). Prisma can't express a partial unique index.
- **Retention: the transaction that creates a new link deletes that person's
  links that ended or expired more than 30 days ago.** There is no sweep. A
  person who never asks again keeps at most their last few rows, which hold only
  a hash and dates.
- **`tokenHash` is a plain SHA-256 (hex) of the token text.** The token is 32
  random bytes, base64url, which is 43 characters. **It is never written to a
  log, an audit row, a job or a notification.** It exists only in the email Resend
  sends and in the person's browser.
- **The migration is number 64**, after #290's 63:
  `20261114120000_acc188_password_reset_link`.

**What lane B's 32-byte token changes, and why.** Better Auth's
`requestPasswordReset` makes its own 24-character token (`generateId(24)`, §2.1),
so it cannot issue a 32-byte one. So:
- **We issue the token ourselves**, and write Better Auth's reset row in the same
  transaction as the ledger row.
- **Better Auth's row:** `identifier = reset-password:<token>`, `value = AuthUser
  id`, `expiresAt` as the ledger's. It is stored HASHED by the
  `verification.storeIdentifier` override for the `reset-password:` prefix.
- **Better Auth's `resetPassword` still consumes the token and sets the
  password** (argon2id, the credential account, Better Auth's own sessions).
- **The write sits in one contained module**, `password-reset-verification.ts`,
  behind `better-auth.contract.ts`. The contract spec pins the prefix, the value
  being the user id, the hasher (SHA-256, base64url, no padding), and that
  `resetPassword` consumes before it hashes.
- **`sendResetPassword` is removed from the Better Auth config.** With it gone,
  `requestPasswordReset` refuses (`RESET_PASSWORD_DISABLED`), so Better Auth's
  `data.url` cannot be sent by any path. This is a structural guarantee in place
  of the ALS capture in §2.5, step 3c.
- **A replaced link's Better Auth row is not deleted.** We hold only its token's
  hash, and Better Auth keys the row by a different hash. The ledger is the gate:
  `reset()` refuses a REPLACED link before Better Auth is called. The row expires
  within the hour and Better Auth's own cleanup removes it.

### 7.3 The queue

**`password-reset` stays its own queue.** Its job looks the account up and makes
the link; it is not only an email.
- It is registered behind `workersEnabled()`.
- It is in `worker-registration.spec`.
- It is added to `WORKER_QUEUES`.
- CLAUDE.md's queue list becomes eight.
- The job carries `{ organizationSlug, email }` and nothing else, with one
  attempt, `removeOnComplete: true` and `removeOnFail: { age: 7 days }`.

### 7.4 The ACC-164 correction, built here

- **The "password changed" notice is an `email-delivery` job named
  `security-notice`**, carrying `{ organizationId, userId, notice:
  'password_changed' }`. It is never a `Notification` row.
  - The processor reads the person and the organisation (both ids), resolves the
    language person → organisation → `en`, renders from one template table, and
    sends.
  - ACC-164 adds `mfa_reset` and `mfa_disabled` to the same table.
- **`endEverySessionInTx(tx, userId, authUserId)`** is in
  `foundation/auth/session-revocation.ts`. ACC-164 reuses it. It:
  - raises `User.tokenVersion` by 1;
  - revokes every live `RefreshToken` row (`revokedAt = now`);
  - deletes Better Auth's `authSession` rows.

  It never creates a refresh row (#290's write scan).
- **One Resend sender**, `TransactionalEmailService`, extracted from
  `NotificationEmailProcessor`, is used by the notification path, the security
  notice and the reset link.

### 7.5 Refusals are never 401

The app's interceptor answers a 401 by renewing the session and retrying. So:
- every link refusal is **400** with a code;
- the password refusals are `PasswordRefusalException`'s **400**;
- Forgot password answers 200 or the throttler's 429.

### 7.6 The design is final ("AccreditMe Sign-in Pages")

**Decided:**
- Retry shows only while the link is being checked. On the two forms, pressing
  the button again is the retry.
- "Back to sign in" sits under the button on Expired and Invalid.
- Sign in's success notice shows once. It is gone on refresh and after the next
  sign-in attempt.
- The email is never prefilled.
- 429 is counted the same whether or not the account exists.
- A mismatch is checked on submit only.
- Each password field has one show/hide.
- The email field keeps the page's direction.

**Where a drawing and the product's strings differ, the strings win:**
- the no-organisation note is `auth.openOrganisationAddress`;
- the link is `auth.forgotPassword` («هل نسيت كلمة المرور؟»);
- the email errors are `auth.signIn.emailRequired` and `emailInvalid`;
- the password lines (hint, required, too short, too long, breached) are the
  `auth.invitation.*` strings.

The design file is copied unchanged into `frontend/design-reference/`.

## 8. As built (14 Nov)

Built as §7 says. Mechanism: SYSTEM-REFERENCE §1.16; the rules: CLAUDE.md, Key
Architecture Decisions (ACC-188).

**Files.**
- **Backend:**
  - `foundation/auth/password-reset/`:
    - `password-reset.service.ts` (`request`, `issue`, `lookup`, `reset`);
    - `password-reset.processor.ts`;
    - `password-reset.module.ts`, which imports only Prisma and the queues, so
      it never loads Better Auth;
    - `password-reset-verification.ts`, the contained Better Auth write;
    - `password-breach-check.service.ts`;
    - `reset-link.config.ts`;
    - `reset-link-refusal.ts`;
    - `reset-email.ts`.
  - `foundation/auth/session-revocation.ts`.
  - `foundation/notification/transactional-email.service.ts` and
    `security-notice.ts`.
  - Edits:
    - the Better Auth config: no `sendResetPassword`,
      `revokeSessionsOnPasswordReset`, the `storeIdentifier` override;
    - `auth.service.ts`: forgot, lookup, reset, and the new-IP sentence;
    - `auth.controller.ts`: the lookup route;
    - the contract module and its spec;
    - the rate limits;
    - the queue, the workers list and its spec;
    - `prisma.service.ts`;
    - the schema and migration 64.
- **Frontend:**
  - `forgot-password` restored;
  - `reset-password` (new) and its route;
  - Sign in's one-time notice;
  - `AuthService.lookupResetLink()`;
  - `auth.forgot.*`, `auth.reset.*` and `auth.recovery.*` in both languages;
  - `auth.forgotPasswordUnavailable` removed;
  - the design file copied unchanged into `frontend/design-reference/`.

**Departures, each with its reason:**
1. **Better Auth's row for a REPLACED link is not deleted.** We hold only its
   token's SHA-256, and Better Auth keys the row by a different hash. The ledger
   refuses a replaced link before Better Auth is called, and the row expires
   within the hour (§7.2).
2. **The retention delete runs BEFORE the REPLACED update** in the issuing
   transaction. The other order gave a long-expired open link a fresh `endedAt`
   and kept it 30 more days. The spec caught it.
3. **"Breach check unavailable" uses the design's own sentence** ("…your link
   still works"), not Accept invitation's. Hint, required, too short, too long
   and breached are the `auth.invitation.*` strings, as decided.
4. **Sign in's notice sits above the title,** as the design draws it. The
   invitation notice keeps its place below the title.
5. **A failed or rate-limited link check shows its message with Retry.** This is
   the "Retry only while checking" rule; the design draws "unreachable" only on
   the forms.
6. **The migration was written with `prisma migrate diff --from-schema
   --to-schema`.** Prisma 7 renamed the `-datamodel` flags. The SQL is exactly
   the enum and the table.
7. **Not applied locally.** There is no `accreditme_a2` database, no `a2db.mjs`,
   no local Postgres and no Docker on this machine. The real-database spec
   (`password-reset-link.db-spec.ts`) runs in CI's `test:db` step, after CI's
   `prisma migrate deploy` applies migration 64.
8. **Screenshots on port 4202, not 4201.** Port 4201 was serving another
   checkout (`D:\Accredit-me-2`), which was left alone.
