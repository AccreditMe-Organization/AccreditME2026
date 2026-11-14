# Step 164 — Turn two-step sign-in off, and the administrator reset (ACC-164)

**Decisions are in (14 Nov), and §0b records them.** Where §0b and a later
section disagree, §0b wins; the later sections are kept as they were planned.
§12 is the as-built record.

Read against `origin/dev` at `9b49be0` and `better-auth@1.6.22` (14 Nov). Every
statement about Better Auth quotes the installed file and line. "Two-step
sign-in" («التحقق بخطوتين») is what the screens already call MFA, and this plan
uses that wording for anything a person reads.

## 0. The decision that stands (Ahmad)

**Both routes:**
- A person turns two-step sign-in off themselves, with their password AND a
  current authenticator code.
- An administrator can reset it for ANOTHER person in their organisation.

`allowPasswordless` stays off, and impersonation is out (ACC-99).

## 0b. Decisions in (14 Nov) — from ACC-164 on Linear

### Ahmad's four rules (answers to §11)

1. **Nobody in the organisation resets the account owner's two-step sign-in.**
   409 `ACCOUNT_OWNER_PROTECTED`, through ACC-221's `assertNotAccountOwner()`.
   The owner is reset by AccreditMe support (ACC-99).
2. **`users:reset_mfa` may be given to other roles.** Only Organization
   Administrator gets it by default. It is not root-only.
3. **Turning it off yourself ends no other sessions.**
4. **The status shows only on the user's record page, to people allowed to
   reset it.** The users list gets no field and no mark. (§8's list half and
   §9.2's row-menu action are dropped.)

### Lane B's floor (because rule 2 is "grantable")

- **A holder without Organization Administrator can't reset someone who has
  it.** 409 `MFA_RESET_HIGHER_ACCOUNT`.
- **Where it runs:** after the 404 and before any write, as single reads: the
  tenant's root role (`key: TENANT_ADMIN`, `isActive: true`) joined to the
  target's role rows, the target being ACTIVE (`hasActiveRootRole()`), and the
  same for the actor.
  - An inactive root role grants nothing (`getUserPermissions()` reads
    `role: { isActive: true }`), so it doesn't count either side.
  - "Holds" means an ACTIVE user with the role: an INACTIVE target is not
    above anyone, which matches ACC-120's "holding a role is not being able to
    act".
- **The same rule hides the action.** `GET /users/:id` answers
  `twoStep: { enabled, mayReset } | null`, built from the service's ONE
  function, `mfaResetBlock()`, which the reset route also calls. So the screen
  never offers a reset the server refuses.
  - `null` (no panel at all, never "Off") unless the viewer holds
    `users:reset_mfa`, the record is someone else's, it is not the account
    owner's, and the floor passes. That is rule 4: only people allowed to reset
    it see the status.
  - `mayReset` is `enabled` and not impersonating. The impersonation refusal
    stays as the fallback.
  - Your own record keeps reading `GET /auth/mfa/status`, unchanged, and gets
    `null` here.
- A mutation-checked spec pins it.

### Lane B's permission conditions

- **`users:reset_mfa`** in the Users group, beside Deactivate/Reactivate,
  with §5's sentences. Checked from day one, so NOT on
  `PERMISSIONS_NOT_YET_CHECKED`.
- **CLAUDE.md's key list goes from 74 to 75.**
- **The seed gives it to Organization Administrator only.** (Platform
  Administrator's set is "every key" by construction and is frozen; it is inert
  in a tenant, and `PlatformGuard` is its real gate. No other seeded role gets
  it.)
- **Backfill, grant-only, in ACC-83's shape:**
  `npm run backfill:acc164-reset-mfa-permission`
  (`prisma/backfill-acc164-reset-mfa-permission.ts`).
  - It upserts the Permission row and writes the RolePermission directly
    (`assignPermissions()` refuses the frozen root role).
  - It writes one audit row per organisation (one grant each).
  - It is idempotent: a dry run by default, `-- --execute` AFTER the deploy,
    then a dry run reporting 0.
  - **The platform organisation is skipped**, and the header says so: nobody
    holds Organization Administrator there (ACC-120 measured 0), and its people
    hold Platform Administrator.

### The design is final

`frontend/design-reference/AccreditMe Two-step Sign-in.dc.html` (copied
unchanged), with the build notes in
`design-review-mfa-off-reset-2026-11-14.md`. What changed from §9:
- **Turn off is a 420 confirm-size dialog** with two fields. Focus goes to
  Password on open. A wrong password is cleared and focused; the code is kept.
- **"Already off" and the owner refusal show only Close.** The owner refusal
  replaces the paragraph.
- **While sending,** Cancel is disabled, and Escape and the backdrop are
  ignored, on both dialogs.
- **Reset is hidden while impersonating**; the refusal stays as the fallback.
- **A success toast after Turn off:** "Two-step sign-in is off." | «تم إيقاف
  التحقق بخطوتين.» (and the design's "Two-step sign-in was reset." after Reset).
- **Arabic:** «تطبيقك» in the code lines; «إعادة ضبط» is two-step sign-in's
  reset word, «إعادة تعيين» the password's.
- **`{{when}}`** comes from `relative()`, with a no-time sentence, as Sign in.
- **New plural keys** for attempts left.
- Existing keys are reused where the notes name them
  (`userRecord.twoStep.off`, `userRecord.twoStep.setUp`).

### The two open calls, decided

**(1) "Code expired" is not a real answer on this route.**
- Each press makes its own sign-in challenge and spends it at once, so a
  challenge can't time out or run out of tries between the person typing and
  the server checking.
- An authenticator code that has gone stale fails Better Auth's TOTP check,
  which answers `INVALID_CODE`. A stale code is therefore a wrong code, and it
  counts as one (Better Auth counts it; we can't tell it apart).
- So the route never sends `MFA_EXPIRED`. Better Auth answering
  `INVALID_TWO_FACTOR_COOKIE` or `TOO_MANY_ATTEMPTS_…` here is a fault (500),
  because nothing a person types can cause it. The design's "That took too
  long" state is not built.

**(2) Wrong passwords and wrong codes do NOT share a counter.**
- A wrong password counts towards the sign-in lock (`LoginAttempt`, five in
  fifteen minutes, per organisation and email), exactly as a sign-in does.
  This form checks the same password; if it had its own counter, it would be a
  side door around that lock.
- A wrong code counts towards Better Auth's per-person two-step lock (ten
  failures, fifteen minutes), exactly as a sign-in code does.
- Merging them would need a new counter that neither lock reads.
- **Attempts left** is sent only with a wrong code: the codes left before the
  two-step lock (`TWO_FACTOR_MAX_FAILURES_PER_USER − failedVerificationCount`).
  The per-challenge five is not in it, because every press has a fresh
  challenge. The screen shows it only for 1 or 2, as Sign in does. A wrong
  password sends no count.

## 1. Measured on the shared database (14 Nov, read-only, counts only)

| What | 5 Oct (ticket) | 14 Nov |
|---|---|---|
| `AuthUser` with `twoFactorEnabled = true` | 0 | **1** (a tenant user, not the platform organisation) |
| `AuthTwoFactor` rows | 0 | **1** (verified) |
| Audit `mfa_enabled` events | 0 | **1** |
| Audit `mfa_disabled` events | 0 | **0** |
| `trust-device-*` verification rows | — | 0 |

**Someone now has two-step sign-in on and cannot turn it off.** The defect has
stopped being hypothetical. Nobody is locked out, since they can still sign in
with their code. But if they lose their phone, the only way back today is a
database edit. That is the case the administrator reset exists for, and it is
why this ticket should not wait.

## 2. Shared with ACC-188 (password reset) — stated once

**(a) Ending every session.**

| | |
|---|---|
| The helper | `endEverySessionInTx(tx, userId, authUserId)` in `foundation/auth/session-revocation.ts`, used by both tickets |
| Called | Inside the caller's transaction |
| Our access tokens | `User.tokenVersion += 1`, so `TenantGuard` refuses every access token on its next request |
| Our refresh tokens | Every live row is revoked (`revokedAt = now` WHERE `revokedAt IS NULL`). The rows say what happened instead of relying on the version check alone (ACC-122) |
| Better Auth's own sessions | `authSession` rows for `authUserId` are deleted |

- The helper only revokes. It never creates a refresh row, so PR #290's
  `refresh-token-writes.scan.spec.ts` (one create site) is untouched.
- `AuthProvider.invalidateUserSessions()` keeps its one caller (deactivation).
  Moving that caller onto this helper is a later tidy-up, not in this ticket.

**(b) How a security notice is emailed.**
- **A security notice is an email only, never a `Notification` row.**
  - A row sits in the bell, where anyone holding the person's session can read
    it and mark it read. On the self-service route that session is not ended.
  - `NotificationService.create()` also writes the whole body into `AuditLog`,
    beside the event's own audit row, so the event is recorded twice.
- **The shape:** the request enqueues an `email-delivery` job named
  `security-notice`, with `{ organizationId, userId, notice }`.
  - `notice` is one of `mfa_reset` | `mfa_disabled` | `password_changed`.
  - The job carries no text and no secret. It is set to `removeOnComplete: true`.
  - The processor reads the user and the organisation (scoped by both ids),
    resolves the language person → organisation → `en`
    (`AuthService.resolveLanguage()`'s rule), renders from one fixed template
    table, and sends through the Resend sender extracted from
    `NotificationEmailProcessor` (`TransactionalEmailService`, ACC-188 §2.5).
- ACC-188's reset-LINK email is the one exception. Its worker sends directly,
  so the token never sits in Redis.
- **This supersedes one line of the ACC-188 plan.** Its §2.5 step 7e and §3.5
  send "password changed" through `NotificationService`. When ACC-188 is built,
  that becomes the `password_changed` notice above. The ACC-188 branch is left
  as it is for now; the correction is recorded here and goes into that plan when
  its build starts.

**Once PR #290 (ACC-126) lands:** nothing in this plan changes.
- Both routes only revoke refresh rows. Neither signs anyone in, so neither
  writes a `sessionStartedAt`.
- A revoked row is refused before #290's 12-hour check is reached.

## 3. The self-service route (3a)

`POST /auth/mfa/disable` (TenantGuard, signed in), body `{ password, code }`:
`DisableMfaDto` gains `code`, six digits. `AuthService.disableMfa()` is
rewritten. **Every Better Auth answer is read as a returned Response
(`asResponse: true`), never as a rejected promise**, as `login()` and
`verifyMfa()` do since slice 9b. Nothing here writes Better Auth's tables
directly; the only exception is clearing a challenge we created, through
`two-factor-challenge.ts`'s existing `clearChallenge()`.

| # | Call | Answer → outcome |
|---|---|---|
| 0 | `loginAttemptService.isLocked(org, email)` | locked → `ACCOUNT_LOCKED` + `lockedUntil`, nothing called |
| 1 | `auth.api.signInEmail({ email: namespaced, password }, asResponse)` | 401 `INVALID_EMAIL_OR_PASSWORD` → record a failed `LoginAttempt` (`invalid_password`, so it counts towards the lock exactly like a sign-in) → `INVALID_CREDENTIALS`. Any other non-OK → a fault (500), nothing recorded |
| 2 | 200 **without** `twoFactorRedirect` | Two-step sign-in is not on → 409 `MFA_NOT_ENABLED`. The Better Auth session that sign-in made is ended with `auth.api.signOut(asResponse)` |
| 3 | 200 with `twoFactorRedirect` | Read the challenge identifier with `challengeIdentifierFromSetCookies()` (it verifies the signature). None readable → a fault |
| 4 | `auth.api.verifyTOTP({ code }, headers: challenge cookie, asResponse)` | `INVALID_CODE` → `MFA_INVALID` + `attemptsRemaining`; `INVALID_TWO_FACTOR_COOKIE` / `TOO_MANY_ATTEMPTS_…` → `MFA_EXPIRED`; `ACCOUNT_TEMPORARILY_LOCKED` → `ACCOUNT_LOCKED` + `twoFactorLockedUntil()`. After any refusal the challenge is cleared (`clearChallenge()`): every press starts its own. 200 → Better Auth made a session (`verify-two-factor.mjs:31`, `valid()`) |
| 5 | `auth.api.disableTwoFactor({ password }, headers: that session's cookie, asResponse)` | 200 → done (`two-factor/index.mjs:163-170`: `twoFactorEnabled = false`, row deleted). Non-OK → a fault: the password was proved in step 1, so a refusal here is a race or a defect, not the person's mistake |
| 6 | `auth.api.signOut(headers: the session cookie `disableTwoFactor` set, asResponse)` | Ends the Better Auth session that `disableTwoFactor` re-issued (`index.mjs:174-178`), so none is left behind. A failure is logged and not surfaced: the change is already made |
| 7 | Audit `UPDATE` / `User`, `{ event: 'mfa_disabled' }`, actor = object = the person (unchanged) | Then the `mfa_disabled` security notice (§2b), after the audit |

**Refactor needed for step 4:** `mfaRefusal()` reads the challenge from the
request's cookie. It gains an identifier parameter, so sign-in and this route
share one mapping and no second copy of the switch exists.

**Refusal status: the 9b CODES, as 400, not 401.** This route is behind
TenantGuard, and the app's interceptor answers any 401 on it by renewing the
session and retrying the request (`auth.interceptor.ts`, ACC-122). A wrong
password would then be submitted twice, counting two failures and spending a
code twice. So `MfaChangeRefusalException extends BadRequestException` carries
the same `code` and `details` as `AuthRefusalException`. The four codes keep
their meaning, and §1.12's table gains a "status on the signed-in routes" note.
`setupMfa()`'s "Invalid password" 401 has the same retry defect. It moves to the
same 400 `INVALID_CREDENTIALS` and gets the same lock check and failure record,
in one line each, because it is the same form family.

**Sessions on self-service:** none are ended. The person proved both the
password and the code, and is turning a protection off, not answering a
compromise. The notice email is what tells them if it was not them (§11 Q3
offers the stricter choice).

## 4. The administrator reset (3b)

### 4.1 What the source says

**`disableTwoFactor` cannot serve an administrator.**
- It needs the target's own session: `sensitiveSessionMiddleware`,
  `api/routes/session.mjs:328-335`.
- It needs the target's password: `shouldRequirePassword()` returns true
  whenever `allowPasswordless` is unset (`utils/password.mjs:26-27`), and the
  check is at `two-factor/index.mjs:156-161`.
- An administrator has neither.

**The leftover-row question, answered from the source.** "What does a later
`enableTwoFactor` do with a leftover `AuthTwoFactor` row?"
- **`plugins/two-factor/index.mjs:106-128`:** it reads the existing row, deletes
  it, and creates the new one with
  `verified: existingTwoFactor != null && existingTwoFactor.verified !== false`.
  **A leftover verified row makes the NEW secret born `verified: true`**, before
  the person has proved they scanned it.
- **`plugins/two-factor/totp/index.mjs:158-161`:** `verifyTOTP` turns
  `twoFactorEnabled` on only inside `if (twoFactor.verified !== true)`.
- **The consequence:** after a reset that leaves the row, the person's next
  set-up "succeeds". The code verifies, our `verifySetupMfa()` writes
  `mfa_enabled`, and the screen says it is on. But **`twoFactorEnabled` stays
  false, and sign-in never asks for a code.** It is silently off, and recorded
  as on.
- **So any reset MUST delete the `AuthTwoFactor` row, exactly as
  `disableTwoFactor` does** (`index.mjs:164-170`).

### 4.2 The options

| Option | Verdict |
|---|---|
| **A. `admin/update-user` with `twoFactorEnabled: false`** (`plugins/admin/routes.mjs:228-317`) | **Rejected.** (1) It leaves the `AuthTwoFactor` row, which is the §4.1 defect. (2) `adminMiddleware` needs a Better Auth admin SESSION, whose user has an admin `role` (`routes.mjs:244-249`). Our administrators have no Better Auth session and no `role`, so we would sign them in to Better Auth and give AuthUser a role. (3) Enabling the plugin adds `role`, `banned`, `banReason`, `banExpires` and `session.impersonatedBy` (`plugins/admin/schema.mjs`), which is a migration. (4) It puts `impersonateUser` into `auth.api` (`admin.mjs` endpoints), which ACC-99 forbids reaching production. |
| **B. Better Auth's internal adapter** (`(await auth.$context).internalAdapter.updateUser` + `adapter.delete`, the same two calls `disableTwoFactor` makes) | **Considered, not chosen.** It goes through Better Auth's adapter, but `$context` is no more public than the tables. It cannot join our transaction, so a half-done reset is possible. A flag still on with no row is a person who cannot sign in at all: `verifyTOTP` answers `TOTP_NOT_ENABLED`, `totp/index.mjs:135`. |
| **C. A contained write in `two-factor-reset.ts`, beside `two-factor-challenge.ts`, behind `better-auth.contract.ts`, pinned by its spec** | **Recommended.** |
| **D. Make the user sign in again (a password reset)** | Not a substitute. It changes the password, not the second factor, and ACC-188 is separate. |
| **E. `allowPasswordless`, or a session minted for the target** | Ruled out: global and weakening (the ticket), and minting a session for someone else is impersonation. |

### 4.3 The recommendation (option C)

**`resetTwoFactorInTx(tx, authUserId)`** does exactly what `disableTwoFactor`
writes, and nothing more, inside OUR transaction:
1. `authUser.update({ twoFactorEnabled: false })`, as `index.mjs:163` does.
2. `authTwoFactor.deleteMany({ userId: authUserId })`, as `index.mjs:164-170`
   does. This avoids the §4.1 defect.
3. Delete any open sign-in challenge of that user: the `2fa-*` rows whose value
   is the `authUserId` (`index.mjs:240-244`), and their `2fa-attempts-*`
   counters. This is the same deletion `clearChallenge()` already makes, keyed by
   user instead of by cookie.
4. The trust-device rows are not touched. We never send `trustDevice`, and none
   exist (§1). The contract spec pins that `verifyMfa()` sends no `trustDevice`,
   so this stays true.

**The precedent:** `clearChallenge()` already deletes Better Auth rows through
Prisma, from the one module that is allowed to.

**The pins** in `better-auth.contract.ts` and its spec. Each fails CI on an
upgrade that changes it:
- `disableTwoFactor`'s writes are exactly the flag and the row;
- `enableTwoFactor`'s carry-over of `verified`, which is why the row must go;
- the `verified !== true` gate in `verifyTOTP`;
- the sign-in hook reads `user.twoFactorEnabled` (`index.mjs:197`), so the flag
  alone decides whether a code is asked;
- the challenge row's `value` is the user id;
- the table names `authUser` and `authTwoFactor`.

A scan spec, in the shape of `check:ai-gateway`, fails any `authTwoFactor` write,
or `twoFactorEnabled` write, outside these two modules.

### 4.4 The route

`POST /users/:id/mfa/reset`, `@Permissions(USERS_PERMISSIONS.RESET_MFA)`.
`UserService.resetMfa(id, organizationId, actorId, request)`. The checks run in
this order:
1. `findFirst({ id, organizationId })`, joined to `authUser.twoFactorEnabled`.
   Missing or another organisation → the identical 404 `User not found`, the
   same body as an invented id.
2. `id === actorId` → 409 `MFA_RESET_SELF`: "You can't reset your own two-step
   sign-in here. Turn it off on your profile with your password and a code."
   Without this, an administrator could skip their own code check.
3. `request.impersonatedBy` set → 409 `MFA_RESET_IMPERSONATING`. A reset made
   inside an impersonation session would be recorded against the impersonated
   administrator (ACC-99's evidence).
4. The account owner → see §11 Q1. Recommended: 409 `ACCOUNT_OWNER_PROTECTED`
   (ACC-221's helper).
5. No `authUserId` (INVITED), or `twoFactorEnabled` false → 409
   `MFA_NOT_ENABLED`, with nothing written. That makes a repeated press harmless.
6. One transaction:
   - lock the User row (`SELECT … FOR UPDATE`, ACC-163's shape), so two
     administrators pressing at once do one reset and one 409;
   - re-read the flag under the lock;
   - `resetTwoFactorInTx()`;
   - `endEverySessionInTx()` (§2a).
7. After the commit:
   - one audit row, through `AuditLogService.log()`. It takes no transaction
     client, and no writer in the codebase audits inside one, so this follows
     the convention;
   - then the `mfa_reset` security notice (§2b), never inside the transaction.

The target may be ACTIVE or INACTIVE: an inactive account's second factor can
still be cleared for when it returns.

## 5. Who may reset, and the permission (3c) — **needs lane B review**

**Recommend a new key, `users:reset_mfa`** (ACC-44's rule: an action-specific
string, not `users:manage`).
- Clearing someone's second factor is a security act. It is not editing a
  profile field, and a tenant may well grant "edit profiles" more widely than
  this.
- **Sentence (EN):** "Reset another person's two-step sign-in".
- **Sentence (AR):** «إعادة ضبط التحقق بخطوتين لشخص آخر».

**What the new key touches:**
- `common/constants/permissions.ts`: `USERS_PERMISSIONS.RESET_MFA =
  'users:reset_mfa'`. It is not in `PERMISSIONS_NOT_YET_CHECKED`, because the
  route checks it from day one.
- **The seed:** `permission.seed.ts` seeds the catalogue, so the Permission row
  comes from the constant. `TENANT_ADMIN`'s set is "every key but `platform:*`",
  so new organisations get it with no seed edit. No other seeded role gets it.
- **A backfill for existing organisations**,
  `prisma/backfill-acc164-users-reset-mfa.ts`, in the shape of
  `backfill-acc83-users-reactivate-permission.ts`:
  - it upserts the Permission row (ACC-83 found it missing on the shared
    database once);
  - it grants the key to every organisation's `TENANT_ADMIN`, writing the
    RolePermission directly, because `assignPermissions()` refuses the frozen
    root role;
  - dry run first, `--execute` after the deploy, then a dry run reporting 0;
  - it writes each organisation's audit trail (ACC-101's backfill rule).
- **`check:permission-sentences`:** `roles.matrix.sentence["users:reset_mfa"]`
  in en.json and ar.json.
- **The permission screen:** the frontend groups table
  (`permission-groups.ts`) places it in the Users section beside
  Deactivate/Reactivate.
- **Not root-only:** it is not added to `ROOT_ROLE_ONLY_PERMISSIONS`. A tenant
  may give it to, say, an IT lead role (§11 Q2).
- CLAUDE.md's permission list (the regenerated block).

**Who sees the action:**
- a holder of `users:reset_mfa` and `users:view` (to open the person at all,
  ACC-101's parent-first rule);
- on someone else, never on themselves;
- only while that person's two-step sign-in is on.

## 6. Migration (3d)

**None.**
- The admin plugin is not enabled, so it has no schema fields.
- The reset writes existing columns.
- The new permission is a catalogue row plus grants (a backfill, §5), not schema.
- `prisma migrate diff` is therefore not needed. If lane B prefers the admin
  plugin despite §4.2, its five columns would be a separate, additive migration,
  and this plan advises against it.

## 7. What each route records and sends (3e)

| | Self-service off | Administrator reset |
|---|---|---|
| Audit | `UPDATE` / `User`, actor = object = the person, `{ event: 'mfa_disabled' }` (unchanged) | `UPDATE` / `User`, actor = the administrator, object = the person, `{ event: 'mfa_reset' }` (new) |
| Sessions | Unchanged (§3) | All ended (§2a) |
| Email | `mfa_disabled` notice | `mfa_reset` notice |
| Lock | Wrong passwords count towards the sign-in lock | — |

**The notices**, in the person's language. The Arabic is singular and
gender-neutral, with «منشأة» for organisation, and gives no gendered verb about a
person (ACC-279).

| | English | Arabic |
|---|---|---|
| `mfa_disabled` subject | Two-step sign-in was turned off | تم إيقاف التحقق بخطوتين |
| body | Two-step sign-in was turned off for your account at {organisation}. Signing in now needs only your password. If this wasn't you, change your password and contact your organisation's administrator now. | تم إيقاف التحقق بخطوتين لحسابك في منشأة {organisation}. يكفي الآن إدخال كلمة المرور لتسجيل الدخول. إذا لم يكن هذا منك، فغيّر كلمة المرور وتواصل مع مسؤول النظام في منشأتك الآن. |
| `mfa_reset` subject | Your two-step sign-in was reset | تمت إعادة ضبط التحقق بخطوتين لحسابك |
| body | An administrator at {organisation} reset two-step sign-in for your account, and you were signed out everywhere. Sign in with your password, then set two-step sign-in up again from your profile. If you didn't ask for this, contact your organisation's administrator now. | أعاد مسؤول في منشأة {organisation} ضبط التحقق بخطوتين لحسابك، وتم تسجيل خروجك من كل الأجهزة. سجّل الدخول بكلمة المرور، ثم أعد إعداد التحقق بخطوتين من ملفك الشخصي. إذا لم يكن الطلب منك، فتواصل مع مسؤول النظام في منشأتك الآن. |

The administrator's name is not in the email. The audit row names them, and an
email naming a colleague travels further than the record does. There is no date
(ACC-95).

## 8. Who has two-step sign-in on: the read (3f)

**The field:** `twoStepEnabled: boolean | null`.
- It is added to `GET /users` (`listUsers()`) and `GET /users/:id`
  (`getByIdForViewer()`).
- It is read **in the same query each already makes**:
  `include: { authUser: { select: { twoFactorEnabled: true } } }`, beside the
  existing `ownedOrganizations` and `position` includes. One join, no query per
  row, nothing on the per-request path.
- It never travels as a separate mapper field; `toSafeUser()` stays the
  allowlist.

**Who sees it (ACC-101, parent first):**
- The list and the record already need `users:view` (or self, for the record).
  That gate runs first, unchanged.
- **The value is filled only for a viewer who holds `users:reset_mfa`, or for
  the person themselves. Otherwise it is `null`.**
- Whether someone has a second factor tells an attacker which accounts are
  softer. It is a security fact, and only the people who can act on it need it.
- `null` means "not shown to you", and the screen draws nothing. It never reads
  as "off".
- `GET /auth/mfa/status` (self) is unchanged.

## 9. Screens, for the design thread (3g)

1. **Turn off two-step sign-in** (the existing dialog, `two-step-off-dialog`):
   - it gains **Code from your authenticator app** below Password;
   - the refusals sit under their field: wrong password under Password; wrong
     code under Code, with "N attempts left"; locked and expired as a message
     above the buttons;
   - it is a form dialog, so the **420px body cap applies**. Two fields and one
     line of intro fit with room; the build measures it in both languages.
2. **Reset two-step sign-in**, on another person's user record page:
   - the Two-step panel, today drawn only for yourself, is drawn for a holder of
     `users:reset_mfa` with the status and a **Reset** button, only while it is
     on;
   - the same action in the users list row's ⋯ menu (`am-row-menu`), only for
     rows showing it on;
   - **Reset opens a confirm**: what happens (signed out everywhere, set it up
     again, the person is emailed) and Cancel / Reset. No fields, well under the
     420px cap;
   - the refusals (self, owner, already off, impersonating) are worded from their
     codes.
3. **The list:** a small "Two-step on" mark on rows where `twoStepEnabled` is
   true, for those who receive it. The design thread decides whether the list
   shows it at all, or only the record page.

## 10. Tests and mutations (3h)

### 10.1 Specs

Every Better Auth answer is modelled as the Response it really returns (status,
JSON body with `code`, `Set-Cookie` headers), never as a rejected promise.
`sign-in-outcomes.spec.ts` already builds these; the new specs reuse its
builders.

**`mfa-disable.spec`** (self-service):
- locked before anything is called;
- wrong password: one `invalid_password` attempt recorded, `INVALID_CREDENTIALS`
  as 400, `verifyTOTP` never called;
- `MFA_NOT_ENABLED` when sign-in answers without a challenge, and the stray
  session is signed out;
- the challenge cookie is unreadable or unsigned (a fault);
- each `verifyTOTP` code → its refusal, with `attemptsRemaining` and
  `lockedUntil` read from the rows, and the challenge cleared;
- `disableTwoFactor` refused (a fault, and no audit row);
- success: the calls in order, with the right cookies passed between them;
  `signOut` called with `disableTwoFactor`'s cookie; one `mfa_disabled` audit
  row; one `security-notice` job;
- a refusal never answers 401 (the interceptor contract).

**`mfa-reset.spec`** (administrator):
- 404 for another organisation's user, byte-identical to an invented id, with no
  write;
- `MFA_RESET_SELF`;
- `MFA_RESET_IMPERSONATING`;
- the owner refusal;
- `MFA_NOT_ENABLED` for INVITED and for off;
- success writes, in ONE transaction:
  - flag false;
  - the `AuthTwoFactor` row gone;
  - the open challenge rows gone;
  - `tokenVersion + 1`;
  - live refresh rows revoked;
  - Better Auth sessions deleted;
- after the commit: one audit row (administrator actor, person object,
  `mfa_reset`), then the notice. Neither is written on a rolled-back
  transaction;
- two concurrent resets → one success and one `MFA_NOT_ENABLED` (a db-spec
  against local Postgres, ACC-194's `test:db`).

**The leftover-row proof:** after a reset, `setupMfa()` + `verifySetupMfa()` end
with `twoFactorEnabled = true`. This is the §4.1 defect, proved absent.

**Sessions:** after a reset, `refresh()` with a pre-reset refresh token is
refused, and `TenantGuard` refuses the pre-reset access token.

**`better-auth.contract.spec`:** each §4.3 pin, read from the installed source.

**The scan spec:** no `authTwoFactor` / `twoFactorEnabled` write outside the two
contained modules.

**Tenant isolation:** `resetMfa` and the list field each get a test named
"should NOT return records belonging to a different tenant" (CI's gate pattern).

**The list and record read:**
- `twoStepEnabled` is filled for a reset-key holder and for self, and `null`
  for a `users:view`-only viewer;
- the number of queries is the same as before (asserted on the Prisma mock).

**Permissions:**
- `permissions.ts` has the key;
- the backfill's db-spec: dry run counts, execute, re-run 0, audit row per
  organisation;
- `check:permission-sentences` passes with the sentence and fails without it;
- `role.seed.spec` pins `TENANT_ADMIN` holding it and `QUALITY_MANAGER` not.

**Frontend:**
- the off dialog's two fields and each refusal under its field;
- Reset shown only with the key, on someone else, while on;
- the confirm;
- each refusal code worded in both languages;
- `null` draws nothing.

### 10.2 Mutations (each must turn a named spec red)

1. Read `disableTwoFactor`'s answer as a thrown error (drop `asResponse`).
2. Skip the `AuthTwoFactor` delete in the reset. The leftover-row proof goes red.
3. Drop the self check.
4. Query by `id` alone (no `organizationId`).
5. Skip `tokenVersion += 1`.
6. Send the notice or write the audit row before the commit.
7. Return 401 from the self-service refusals.
8. Fill `twoStepEnabled` for a `users:view`-only viewer.
9. Add a per-row `authUser` query.
10. Remove the key from the backfill's grant.
11. Write `twoFactorEnabled` from a third file. The scan goes red.

## 11. Questions for Ahmad (answered 14 Nov, §0b)

1. **May an administrator reset the ACCOUNT OWNER's two-step sign-in?**
   **Recommend no** (409 `ACCOUNT_OWNER_PROTECTED`, ACC-221's helper). The owner
   is the account's last line. An owner who loses their phone is helped through
   support (ACC-99's support-initiated path), not by an administrator they may
   not trust.
2. **Is `users:reset_mfa` grantable to roles other than Organization
   Administrator, or root-only like `workflows:manage` (ACC-258)?**
   **Recommend grantable.** Larger hospitals put this with IT. It is seeded to
   Organization Administrator only, so nobody else holds it until a tenant
   decides.
3. **Does turning it off YOURSELF also end your other sessions?**
   **Recommend no.** The person proved both factors, and the notice email covers
   the "wasn't me" case. Choosing yes means re-issuing the current device's
   session after the version bump. That is a little more work and a stricter
   answer.
4. **Should the users LIST show who has it on, or only the record page?**
   **Recommend the record page only**, for key holders. The list mark is a
   convenience that widens where the fact appears. (The design thread can answer
   this one if Ahmad prefers.)

## 12. As built (14 Nov)

Branch `feature/acc-164-mfa-off`, with `origin/feature/acc-188-password-reset`
(#293) merged in for `endEverySessionInTx()` and the security-notice path. No
migration.

### 12.1 Backend

- **`POST /auth/mfa/disable { password, code }`** — `AuthService.disableMfa()`,
  §3's table with §0b's two decisions: no `MFA_EXPIRED` here (a missing or spent
  challenge is a fault), and `attemptsRemaining` is the codes left before the
  two-step lock (`attemptsBeforeLock()` in `two-factor-challenge.ts`).
  Refusals are `MfaChangeRefusalException` (400). `setupMfa()` gained the lock
  check, the failure record and the 400.
- **The sign-in mapping was not shared.** §3 planned one `mfaRefusal()` with an
  identifier parameter. The two routes answer differently (sign-in has
  `MFA_EXPIRED` and the per-challenge count; this route has neither, by §0b), so
  this route has its own small `disableMfaCodeRefusal()` and sign-in's is
  unchanged.
- **`POST /users/:id/mfa/reset`** — `UserMfaResetService` (new, in
  `foundation/user/mfa-reset/`, so `user.service.ts` gains one join and nothing
  else). The order is §4.4's with the floor added after the owner check;
  `mfa-reset-rule.ts` is the one rule the route and the record read share.
- **The floor counts the root role while the ROLE is active, whatever the
  person's status.** §0b said "the target being ACTIVE". Built otherwise, on
  purpose: an inactive Organization Administrator who is reactivated is an
  administrator again, so their second factor stays above a non-administrator.
  The conservative reading of lane B's "the target's ACTIVE roles".
  **Lane B OK'd this departure (CC-265)**, and asked for the spec that pins it:
  `user-mfa-reset.service.spec.ts`, "counts an INACTIVE Organization
  Administrator". A holder of `users:reset_mfa` below the floor gets 409
  `MFA_RESET_HIGHER_ACCOUNT` for her, and an administrator can still reset her.
  The test double now honours a status filter, so a floor that counted only
  ACTIVE holders turns it red (mutation run: 1 failing test, then restored).
- **`GET /users/:id` answers `twoStep`** from `twoFactorEnabled`, read in the
  record's own query; `twoStepFor()` reads the root role only when the floor
  could apply (one indexed read for the person, one for the viewer).
- **`two-factor-reset.ts`**, `resetTwoFactorInTx()`: §4.3 as planned.
- **Security notices**: `mfa_disabled` and `mfa_reset` were added to
  `security-notice.ts`'s table (its header said "ACC-164 adds its two notices
  here"). The enqueue path, the job and the processor are #293's, unchanged.
  `SecurityNoticeService` is provided in `AuthModule` and `UserModule`, which
  now import `QueueModule`.
- **Permission**: `USERS_PERMISSIONS.RESET_MFA`; the catalogue is 75 keys, 36 in
  use. The backfill is `prisma/backfill-acc164-reset-mfa-permission.ts`
  (`npm run backfill:acc164-reset-mfa-permission`).

### 12.2 Frontend

- `two-step-off-dialog.component.ts` rebuilt to screen 1;
  `two-step-reset-dialog.component.ts` (new) to screen 2;
  `two-step-message.component.ts` (new) for the message above the buttons;
  `two-step-refusal.ts` (new) words every code.
- The record page draws someone else's panel only from `twoStep`; its success
  lines use the page's existing success message (the design's dark toast was a
  stand-in, and the product has no toast).
- **Users is split into two groups** in the role permissions list: "People and
  profiles" (view, invite, manage, transfer) and "Account access" (deactivate,
  reactivate, reset two-step sign-in). The seventh key took Users over the
  six-key threshold (ACC-272), so a split was required, not chosen.
- Copy is the design's. Not drawn, so written here: `resetHigher`, `resetSelf`
  (fallbacks the panel never offers), `offFailed` and `resetFailed` (a refusal
  with no code). "Code expired" is not built.

### 12.3 Verified

- Backend: every spec, including `mfa-disable.spec.ts`,
  `user-mfa-reset.service.spec.ts`, the contract pins and the write scan. The
  real-database specs (`user-mfa-reset.db-spec.ts`, the backfill's db-spec) run
  in CI's `test:db`: there is no local database on this machine.
- Nine mutations, each turning a named spec red (the report lists them).
- Playwright on port 4202, every call mocked, 0 unmocked, 0 external: 27
  states × EN/AR × 1280/390 (108 screenshots). The tallest dialog body is 337 px
  (Turn off, locked, English, phone), under the 420 cap; none scrolls.
