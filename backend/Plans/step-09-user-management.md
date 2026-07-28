# Step 9 — User Management
# ACC-12: real Better Auth-backed authentication, security hardening,
# invitation flow, user profile, and departure/bulk-reassignment

---

## HEALTH CHECK — Run Before Starting

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AccreditMe Health Check — 2026-07-28
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ERRORS:  None ✅
ERRORS:           None ✅
WARNINGS:         None ✅

DETAILED RESULTS

Check 1  Git State              PASS — on feature/ACC-12-user-management, clean
Check 2  Branch vs dev          INFO — branched from dev at cd75b96, 0 drift
Check 7  Migration Status       PASS — 18 migrations, database up to date
Check 8  Schema Validation      PASS — schema.prisma is valid

OVERALL STATUS: 🟢 HEALTHY — ready to start ACC-12
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

Every foundation module since Step 1 has assumed a real, authenticated `User`
exists — `TenantGuard`, `AuditLogService`, `WorkflowService`'s out-of-office
routing (Step 8), `TaskService`'s escalation model, `OrgPositionService` — but
no real authentication has ever existed. What's actually in the codebase today
(verified this session, not assumed):

- `TenantGuard` hand-parses a manually HMAC-signed JWT via its own private
  `verifyJwt()` function — it does not call any provider.
- `BetterAuthProvider` (`providers/auth/better-auth.provider.ts`) is a
  same-shaped duplicate of that exact parsing logic, registered on
  `AUTH_PROVIDER` in `TenantModule`, but **never injected or called by
  anything** — dead code with the same "registered but unused" shape CLAUDE.md
  warns about elsewhere.
- The `better-auth` npm package (`^1.6.22`) is a `package.json` dependency but
  is not imported anywhere in `src/`.
- Login is `npm run seed:demo` printing a token to paste into
  `/dev/login` (`DemoLoginComponent` + `DemoAuthService`, both explicitly
  dev-only, both with `⚠️ DEVELOPMENT ONLY` headers).
- `TenantGuard` itself carries a live TODO: *"validate payload.tokenVersion
  against User.tokenVersion in DB to enforce forced-logout on role change"* —
  i.e. forced logout does not work yet even though `User.tokenVersion` exists
  and is incremented nowhere.
- `BetterAuthProvider.invalidateUserSessions()` is an empty stub with a
  matching TODO, also never called.
- `RoleController` hosts `/users/:userId/roles*` (3 endpoints) with an explicit
  header comment: *"temporary... until Step 9's Users module exists to own
  them."*
- `UserRoleAssignmentComponent` (Angular) already exists, fully built, with
  its own header comment: *"minimal stopgap until Step 9 ships a proper user
  profile page... Step 9 will embed this component... into the user detail
  page it builds."*
- `User.positionId`, `primaryOrgUnitId`, `outOfOfficeFrom`, `outOfOfficeTo`,
  `actingUserId` **already exist** — added ahead of schedule in Step 8's
  migration (that step's Pending Discussion #1), because Step 8's own
  acceptance criteria needed out-of-office routing to be testable immediately.
  Step 9 does not add these fields — it builds the UI and departure logic that
  actually use them.
- `Organization.authConfig` (encrypted `String?`, AES-256-GCM via
  `tenant-config-crypto.ts`, same helper already used for `storageConfig`/
  `aiConfig`) **already exists** and is already decrypted/re-encrypted by
  `TenantService`. Step 9 is the first step to actually write meaningful data
  into it.

This step:

1. **Wires real Better Auth** — email/password provider, Argon2id hashing,
   HaveIBeenPwned check, TOTP MFA, all via Better Auth's own official plugins
   rather than hand-rolled equivalents (see Section 2 for why, and the exact
   integration boundary with `TenantGuard`).
2. **Adds login security hardening**: account lockout, login-attempt logging
   (IP + device), new-IP login email notification.
3. **Builds the invitation flow**: invite-by-email, Resend delivery, accept-
   invitation page that sets a real password.
4. **Builds the user profile UI**: position, primary org unit, manager,
   out-of-office + acting-user settings, embedding the already-built
   `UserRoleAssignmentComponent`.
5. **Migrates `/users/:userId/roles*` off `RoleController`** onto the new
   `UserController` (same paths — zero change to the frontend `RoleService`
   that already calls them).
6. **Builds the departure flow**: deactivate → `tokenVersion` increment (all
   JWTs revoked) → bulk-reassign every open `Task` the user is an active
   assignee on, to their `actingUser` if set, else flag `UNASSIGNED` and
   notify the Tenant Admin (Absence and Departure Management Pattern 3).
7. **Replaces `dev/demo-login`** with a real Angular login page (MFA-challenge
   aware). `demo-seed.ts` is kept, but only as the dev database-seeding
   script it always was — its JWT-printing behavior is removed since real
   login now exists.

### Why Better Auth's Own Plugins, Not Hand-Rolled Equivalents

The ticket's hardest acceptance criteria — HaveIBeenPwned checking and TOTP
MFA — are both **official Better Auth plugins**
(`haveIBeenPwned`, `twoFactor`), not things this step should reimplement from
scratch. Argon2id hashing is Better Auth's own default password hasher.
Account lockout / rate-limiting has an official plugin too. Using Better
Auth for real (its own tables, its own request lifecycle for the
`/api/auth/*` surface) gets all four "security hardening" acceptance criteria
essentially for free, configured rather than built. Hand-rolling any of these
instead would be reinventing what the dependency already exists to provide —
rejected.

### The One Real Architectural Tension — Multi-Tenancy vs. Better Auth's Global User Model

Better Auth's `user` table assumes **one global row per email address**.
AccreditMe's own `User` model deliberately does not — its uniqueness
constraint is `@@unique([organizationId, email])`, because two different
tenants (two different hospitals, say) may both have a `quality@theirdomain`
address, and CLAUDE.md's multi-tenancy rule is non-negotiable. Pointing Better
Auth's adapter directly at the existing `User` table (via `additionalFields`)
would silently break the moment two tenants share an email — rejected as a
real correctness risk, not a style preference.

**Resolution (see Section 2 and Pending Discussion #1 for the exact
mechanism):** Better Auth gets its **own** identity tables (`AuthUser`,
`AuthAccount`, `AuthSession`, `AuthVerification`, `AuthTwoFactor` — Prisma
models, generated via Better Auth's own CLI schema generator, not hand-typed
from memory), completely separate from AccreditMe's business `User` table,
linked 1:1 via `User.authUserId`. Better Auth's internal global-email
uniqueness is satisfied by storing a **tenant-namespaced** value
(`"{organizationId}:{email}"`) as `AuthUser.email`, while the real,
human-readable email lives only on AccreditMe's own `User.email` (unchanged).
This keeps Better Auth's plugins working exactly as documented (they only
ever see their own namespaced identity space) while leaving AccreditMe's
existing tenant-scoped `User` model completely untouched in shape.

### Where Better Auth's Session Ends and TenantGuard's JWT Begins

Per the user's own decision ("Better Auth sits before TenantGuard —
TenantGuard unchanged"): Better Auth's own session mechanism is used
**only** for the `/api/auth/*` surface (login, MFA challenge, password
reset, accept-invitation) — the exact same request lifecycle its plugins
expect. The moment Better Auth confirms a session is valid, a small bridge
step (`AuthController`, Commit 3) mints AccreditMe's own existing
hand-signed HMAC JWT (`sub`, `organizationId`, `tokenVersion`, `exp` — the
exact shape `TenantGuard.verifyJwt()` already parses).

**That JWT is never returned in a response body.** Per Section 12,
Discussion 4's resolution, `POST /auth/login` sets it as an httpOnly
`access_token` cookie (plus a separate httpOnly `refresh_token` cookie) and
returns only `{ success: true, user: { id, email, nameEn } }` — the Angular
client never sees, stores, or handles the token itself. Every other API call
in the app continues to be authorized by that same JWT exactly as it does
today, just carried automatically by the browser as a cookie instead of
attached manually as a `Bearer` header — **`TenantGuard`'s verification
logic is unchanged; only where it reads the raw token string from changes**
(see Section 12, Discussion 4's `TenantGuard` update, and Section 3's
Commit 3 for the exact file change). This is the literal reading of
"TenantGuard unchanged" this plan commits to: the parsing/verification
mechanism is untouched — the transport it arrives over, and the one
`tokenVersion` DB check layered on top (Discussion 1), are the only two
changes.

### Explicit Scope Boundary — Invitation, Not Public Registration

CLAUDE.md's Onboarding section ("Self-service signup... 14-day free trial")
describes creating a brand-new **tenant** plus its first admin user — that is
Step 14's job, not this one. Step 9 only builds **invitation-based** user
creation *within an already-onboarded tenant* (an existing Tenant Admin
invites a new colleague) plus login/password-reset/MFA for those already-
invited users. There is no public "sign up" page in this step.

### Scaffold Already in Place (from Steps 1–8 — do not blindly recreate)

```
Organization.authProvider (AuthProvider enum, default LOCAL)  — EXISTS, unchanged
Organization.authConfig (encrypted String?)                  — EXISTS, unused until now
tenant-config-crypto.ts (encrypt/decryptTenantConfig)         — EXISTS, reused as-is
AUTH_PROVIDER token + AuthProvider interface                  — EXISTS — MODIFY (real implementation)
BetterAuthProvider (providers/auth/)                          — EXISTS, stub — REPLACE internals
TenantGuard.verifyJwt()                                       — EXISTS — UNCHANGED (see above)
User.positionId/primaryOrgUnitId/outOfOfficeFrom/To/actingUserId — EXISTS (Step 8) — UI only, no schema change
User.tokenVersion                                             — EXISTS, never incremented — MODIFY (real writer)
USERS_PERMISSIONS { VIEW, MANAGE, INVITE }                    — EXISTS in permissions.ts — ADD more (Section 3)
RoleController's /users/:userId/roles*                        — EXISTS — MOVE to UserController (same paths)
UserRoleAssignmentComponent (Angular)                         — EXISTS, unembedded — EMBED in user detail page
OrgPositionService.listPositions() (Angular + backend)        — EXISTS (Step 8) — reused for position picker
OrgUnitService (Angular)                                      — EXISTS (Step 2) — reused for org-unit picker
NotificationService (@Global(), Step 7)                       — EXISTS — reused for invite/new-IP-login emails
AuditLogService (ipAddress field already supported)           — EXISTS — reused for login-attempt/departure logging
dev/demo-login, dev/demo-auth.service.ts                      — EXISTS — REMOVE (route + component), demo-seed.ts KEPT
```

### Explicit Non-Goals / Sequencing Notes

- **No public tenant signup / onboarding wizard** — Step 14.
- **No Azure AD / LDAP / SAML / OAuth** — Phase 3, per CLAUDE.md's Auth
  Providers Per Tenant section (`authProvider` enum already has room for
  this; only `LOCAL` is implemented now).
- **No committee-seat or CAPA-ownership reassignment on departure** — those
  modules don't exist yet (Steps 10/18). This step's departure flow only
  reassigns `Task` (via `TaskAssignee`) — the only assignable-work model that
  exists today.
- **No `Staff` member (portal-only) accounts** — Step 17b, per CLAUDE.md's
  User Types distinction. This step is Full Users only.
- **Better Auth's own `organization` plugin is deliberately NOT used** —
  AccreditMe already has a complete, mature multi-tenancy model
  (`Organization`, `TenantGuard`, `organizationId` scoping everywhere).
  Adopting Better Auth's parallel tenancy concept would create two competing
  sources of truth for "what tenant does this user belong to." Multi-tenancy
  is handled entirely by the tenant-namespaced-email mechanism above, not by
  Better Auth's plugin.
- **AI Coverage Gap Detection** (Absence and Departure Management's AI point)
  remains deferred — module-designs.md already scopes it as needing real
  historical data, and this step is what finally lets tenants populate
  `outOfOfficeFrom`/`actingUserId` with real values, but the AI job itself
  stays a documented stub (same precedent as Steps 6–8).

---

## 2. PRISMA SCHEMA CHANGES

### New Models — Better Auth's Own Identity Space (Commit 1)

**Do not hand-type these from memory.** Run Better Auth's own schema
generator against the configured `auth()` instance (with
`emailAndPassword`, `twoFactor`, and `haveIBeenPwned` plugins enabled) —
e.g. `npx @better-auth/cli generate` — and reconcile its output field-for-
field with the sketch below before writing the final `schema.prisma` block.
Exact column names/types can differ by Better Auth version and enabled
plugin; the generator is authoritative, this sketch is not.

```prisma
// Better Auth's own identity tables — separate from AccreditMe's business
// User model. Linked 1:1 via User.authUserId. AuthUser.email is a
// tenant-namespaced synthetic value ("{organizationId}:{email}"), never
// shown to a human — the real email lives only on User.email.
model AuthUser {
  id            String    @id @default(cuid())
  email         String    @unique   // "{organizationId}:{email}" — see above
  emailVerified Boolean   @default(false)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  appUser       User?     @relation(fields: [appUserId], references: [id])
  appUserId     String?   @unique

  accounts      AuthAccount[]
  sessions      AuthSession[]
  twoFactor     AuthTwoFactor?
}

model AuthAccount {
  id           String    @id @default(cuid())
  authUserId   String
  providerId   String              // "credential" for email/password
  accountId    String              // == AuthUser.email for credential provider
  password     String?             // Argon2id hash — Better Auth manages this
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  authUser     AuthUser  @relation(fields: [authUserId], references: [id])

  @@index([authUserId])
}

model AuthSession {
  id           String    @id @default(cuid())
  authUserId   String
  token        String    @unique
  expiresAt    DateTime
  ipAddress    String?
  userAgent    String?
  createdAt    DateTime  @default(now())

  authUser     AuthUser  @relation(fields: [authUserId], references: [id])

  @@index([authUserId])
}

model AuthVerification {
  id         String   @id @default(cuid())
  identifier String             // namespaced email or purpose-scoped key
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  @@index([identifier])
}

model AuthTwoFactor {
  id          String   @id @default(cuid())
  authUserId  String   @unique
  secret      String             // encrypted at rest — see Section 8
  backupCodes String             // encrypted at rest — see Section 8

  authUser    AuthUser @relation(fields: [authUserId], references: [id])
}
```

### AccreditMe `User` Model Additions (Commit 1)

```prisma
model User {
  // ...existing fields unchanged...
  authUserId    String?  @unique       // ADD — link to Better Auth's identity row
  managerId     String?                // ADD — net new, direct-manager reference
  invitationToken       String? @unique   // ADD
  invitationExpiresAt   DateTime?         // ADD

  authUser      AuthUser? @relation(fields: [authUserId], references: [id])
  manager       User?     @relation("UserManager", fields: [managerId], references: [id])
  directReports User[]    @relation("UserManager")

  @@index([managerId])
  @@index([invitationToken])
}
```

**Why `invitationToken`/`invitationExpiresAt` live on `User`, not a separate
`UserInvitation` model:** the invited `User` row is created (status
`INVITED`) at invite time — there is exactly one live invitation per user at
any moment, never a history of past invitations worth querying separately.
A dedicated model would only ever have a 1:1 relationship with `User` for its
entire useful lifetime (cleared on acceptance) — two nullable columns is the
simpler, sufficient design. Flagged for confirmation in Pending Discussion #2
since it's a real design choice, not the only valid one.

### New Model — `LoginAttempt` (Commit 1)

```prisma
model LoginAttempt {
  id             String   @id @default(cuid())
  organizationId String
  email          String             // as typed — may not resolve to a real user
  success        Boolean
  failureReason  String?            // "invalid_password" | "locked" | "no_such_user" | "mfa_failed"
  ipAddress      String?
  userAgent      String?
  createdAt      DateTime @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id])

  @@index([organizationId, email, createdAt])
  @@index([ipAddress])
}
```

**Append-only, same shape as `AuditLog`** — no `UPDATE`/`DELETE` needed or
permitted. Used for three things at once: (1) account-lockout counting —
"locked if 5+ consecutive failures for this email with no success since,
within a rolling window," computed on read rather than a stored mutable
counter, same reasoning as `AuditLog`'s append-only design; (2) new-IP-login
detection — compare the current successful login's IP against this user's
prior successful attempts; (3) the audit trail itself (IP + device per
attempt, per the ticket's explicit acceptance criterion).

### New Model — `RefreshToken` (Commit 1)

Added per Pending Discussion #4's resolution — httpOnly cookie session
storage requires a server-side refresh-token record to validate against and
rotate (a bare stateless JWT refresh token would be unrevocable).

```prisma
model RefreshToken {
  id             String    @id @default(cuid())
  userId         String
  organizationId String
  tokenHash      String    @unique   // SHA-256 hash of the raw token — never store it plain
  expiresAt      DateTime
  createdAt      DateTime  @default(now())
  revokedAt      DateTime?
  deviceInfo     String?             // browser/device string, for security audit
  ipAddress      String?

  user           User         @relation(fields: [userId], references: [id])
  organization   Organization @relation(fields: [organizationId], references: [id])

  @@index([userId])
  @@index([organizationId])
}
```

Requires matching reverse relations: `User.refreshTokens RefreshToken[]` and
`Organization.refreshTokens RefreshToken[]`. Append-only in spirit —
rows are never deleted, only `revokedAt`-stamped, same pattern as
`AuditLog`/`LoginAttempt`, giving a full device/session history per user for
free.

### `Organization.authConfig` — What Gets Stored (No Schema Change)

`authConfig` already exists (`String?`, encrypted). This step is the first to
give it real shape:

```json
{
  "mfaEnabled": false,
  "mfaEnforcedForRoles": [],
  "lockoutThreshold": 5,
  "lockoutWindowMinutes": 15,
  "passwordMinLength": 10
}
```

Decrypted/re-encrypted via the existing `tenant-config-crypto.ts` helpers —
no new crypto code needed. Falls back to the platform defaults shown above
when absent, same pattern as Step 8's `Organization.settings.taskSla`.

### Migration Name

```
add_better_auth_tables_and_user_management_fields
```

```bash
cd backend && npx prisma migrate dev --name add_better_auth_tables_and_user_management_fields
```

Purely additive — six new models (`AuthUser`, `AuthAccount`, `AuthSession`,
`AuthVerification`, `AuthTwoFactor`, `RefreshToken`), four new
nullable/optional columns on `User`. No data-loss risk (unlike Step 8's Task
redesign).

---

## 3. FILES TO CREATE / MODIFY (BACKEND)

All new paths relative to `backend/src/foundation/user/` unless noted.

### Commit 1 — Schema (standalone commit before any code)
```
backend/prisma/schema.prisma                                            MODIFY
backend/prisma/migrations/YYYYMMDDHHMMSS_.../                          GENERATED
```

---

### Commit 2 — Better Auth configuration + provider wiring
```
src/providers/auth/better-auth.config.ts                                CREATE
src/providers/auth/better-auth.provider.ts                               MODIFY
src/providers/auth/auth.provider.ts                                      MODIFY
```

**`better-auth.config.ts`** — the actual `betterAuth({...})` instance:
Prisma adapter pointed at the `AuthUser`/`AuthAccount`/`AuthSession`/
`AuthVerification`/`AuthTwoFactor` models (Commit 1), `emailAndPassword: {
enabled: true, password: { hash: argon2idHash, verify: argon2idVerify } }`
(Better Auth's own Argon2id — no separate `argon2` call site needed
elsewhere), `plugins: [haveIBeenPwned(), twoFactor()]`. Email-namespacing
(`"{organizationId}:{email}"`) applied at the call sites in `AuthController`
(Commit 3), not inside this config file, so the config stays a pure Better
Auth instance with no AccreditMe-specific business logic leaking into it.

**`auth.provider.ts`** — `AuthProvider` interface gains one method (kept
named `AuthProvider`, not renamed to `IAuthProvider` — matches this
codebase's existing convention where pluggable-provider interfaces are never
`I`-prefixed, unlike data-shape interfaces like `IOrgPosition`/`ITask`):

```typescript
export interface AuthProvider {
  validateToken(token: string): Promise<AuthUser | null>;   // unchanged signature
  invalidateUserSessions(userId: string): Promise<void>;    // NOW REAL, see below
}
```

**`better-auth.provider.ts`** — `validateToken()` is unchanged (still parses
AccreditMe's own JWT — this class's name predates this step and remains
slightly misleading, but renaming it is out of scope for this ticket).
`invalidateUserSessions(userId)` gets its first real implementation: `await
this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: {
increment: 1 } } })`. This is the method the departure flow (Commit 6) and
password-change flow both call — finally giving this long-TODO'd stub a real
caller.

---

### Commit 3 — AuthController + TenantGuard update (the Better Auth ↔ AccreditMe JWT bridge)
```
src/foundation/auth/auth.controller.ts                                  CREATE
src/foundation/auth/auth.controller.spec.ts                              CREATE
src/foundation/auth/auth.service.ts                                     CREATE
src/foundation/auth/auth.service.spec.ts                                CREATE
src/foundation/auth/dto/login.dto.ts                                    CREATE
src/foundation/auth/dto/accept-invitation.dto.ts                        CREATE
src/foundation/auth/dto/verify-mfa.dto.ts                               CREATE
src/foundation/auth/dto/forgot-password.dto.ts                          CREATE
src/foundation/auth/dto/reset-password.dto.ts                           CREATE
src/common/guards/tenant.guard.ts                                       MODIFY
src/common/guards/tenant.guard.spec.ts                                  MODIFY
src/main.ts                                                             MODIFY
```

**`tenant.guard.ts` — the two changes flagged in Section 12, Discussions 1
and 4, land in this same commit** (not a separate one) because they are
tightly coupled to the cookie-based login this commit introduces — a guard
change with nothing yet setting the cookies it reads (or vice versa) would
leave the app in a broken half-state between commits:

1. **Token source:** read the raw token string from the `access_token`
   cookie first; fall back to the `Authorization: Bearer` header only if no
   `access_token` cookie is present (keeps the door open for future non-browser
   API clients, e.g. a Phase 3 public API, without requiring them to hold
   cookies). The verification logic applied to whichever string is found —
   `verifyJwt()` — is completely unchanged.
2. **`tokenVersion` check:** after `verifyJwt()` succeeds, one additional DB
   read — `User.tokenVersion` by `payload.sub` — compared against the
   token's own `tokenVersion` claim. Mismatch → `UnauthorizedException`,
   same as any other invalid-token case. This is what makes the departure
   flow's "all JWTs immediately revoked" guarantee (Commit 6) real instead of
   theoretical.

**`main.ts` — CORS update (per Pending Discussion #4):** httpOnly cookies
require `credentials: true` on both the CORS config and every Angular
`HttpClient` request (Commit 8) — a wildcard CORS origin (`*`) is rejected by
browsers whenever `credentials: true` is set, so `origin` must become an
exact configured value:

```typescript
app.enableCors({
  origin: process.env['FRONTEND_URL'],   // exact origin — no wildcard with credentials
  credentials: true,
});
```

**New environment variable:** `FRONTEND_URL` (e.g. `http://localhost:4200`
in dev, the real tenant-facing domain in production) — replaces the
existing `CORS_ORIGIN`/localhost-fallback with an explicit required
variable, since a silently-wrong CORS origin would silently break
cookie-based login entirely rather than fail loudly.

```
POST /auth/login                 — no guard (public) — email+password, resolves
                                    organizationId from subdomain (see note below),
                                    calls Better Auth's signInEmail against the
                                    namespaced email, logs LoginAttempt, checks
                                    lockout BEFORE calling Better Auth. On success
                                    (and no MFA required): sets the access_token +
                                    refresh_token httpOnly cookies (Section 12,
                                    Discussion 4), returns
                                    { success: true, user: { id, email, nameEn } } —
                                    NO token in the response body. If MFA is
                                    required: sets NEITHER cookie yet, returns
                                    { mfaRequired: true, challengeToken } instead
POST /auth/mfa/verify            — no guard (public) — TOTP code + challengeToken
                                    from /login; on success, sets the same two
                                    httpOnly cookies /login would have set,
                                    returns { success: true, user: {...} } —
                                    same response shape as a non-MFA login
POST /auth/refresh                — no guard (public — authenticated by the
                                    refresh_token cookie itself, not TenantGuard) —
                                    reads refresh_token cookie, validates its hash
                                    against RefreshToken, rejects if expired/revoked,
                                    rotates it (old row revokedAt set, new row +
                                    new cookie issued), reissues the access_token
                                    cookie, returns { success: true } — no body token
POST /auth/accept-invitation     — no guard (public) — token + chosen password,
                                    creates AuthUser/AuthAccount via Better Auth,
                                    links User.authUserId, sets status ACTIVE
POST /auth/forgot-password       — no guard (public) — triggers Better Auth's
                                    password-reset email (Resend, via Better Auth's
                                    own email-sending hook wired to NotificationService)
POST /auth/reset-password        — no guard (public) — token + new password
POST /auth/logout                — @UseGuards(TenantGuard) — clears both the
                                    access_token and refresh_token cookies AND sets
                                    RefreshToken.revokedAt = now() for the presented
                                    refresh token (a real server-side revocation now
                                    that refresh tokens are stateful — Discussion 4 —
                                    not the "client just discards it" no-op this
                                    endpoint would have been under a pure-stateless-JWT
                                    design), returns { success: true }; also logs
                                    the LOGOUT AuditAction, same as before
```

**Subdomain → organizationId resolution:** every one of these public
endpoints needs to know which tenant it's operating in *before* it can look
up the namespaced `AuthUser` email. `req.headers.host` (or an explicit
`X-Tenant-Slug` header the Angular app already sends — whichever the
frontend interceptor sends today; verify against the existing `dev/login`
flow before Commit 3, since local dev doesn't use real subdomains) resolves
to `Organization.slug` → `Organization.id`, exactly the mechanism CLAUDE.md's
Subdomain Routing section describes. This lookup does not go through
`TenantGuard` (these routes are pre-authentication) — it is a small private
helper in `AuthService` reused by every public endpoint above.

**No business logic in the controller** — `AuthController` only wires
guards/DTOs, `AuthService` does everything, per CLAUDE.md's NestJS
Conventions.

---

### Commit 4 — UserService + UserController (CRUD, invite, profile)
```
interfaces/user.interface.ts                                            CREATE
dto/invite-user.dto.ts                                                  CREATE
dto/update-user-profile.dto.ts                                          CREATE
dto/update-out-of-office.dto.ts                                        CREATE
user.service.ts                                                        CREATE
user.service.spec.ts                                                   CREATE
user.controller.ts                                                     CREATE
user.controller.spec.ts                                                CREATE
```

**`user.service.ts`** methods:

```typescript
listUsers(organizationId: string, filters?: { status?, orgUnitId?, search? }): Promise<IUser[]>

getById(id: string, organizationId: string): Promise<IUser>   // includes position, primaryOrgUnit, manager

// Creates the User row (status: INVITED), generates invitationToken +
// invitationExpiresAt (7 days), sends invite email via NotificationService
// (channel: EMAIL). Enforces Organization.maxUsers seat limit — throws if
// at capacity (per CLAUDE.md's "Hard limits at 100% — uploads blocked, no
// data corruption" pattern, applied here to seats instead of storage).
invite(dto: InviteUserDto, organizationId: string, actorId: string): Promise<IUser>

updateProfile(id: string, dto: UpdateUserProfileDto, organizationId: string, actorId: string): Promise<IUser>

updateOutOfOffice(id: string, dto: UpdateOutOfOfficeDto, organizationId: string, actorId: string): Promise<IUser>

// Pattern 3 support — validates actingUserId is a real, ACTIVE user in this
// tenant before allowing it to be set (mirrors OrgPositionService's own
// validation style).

// Departure flow — see Section 8 for full sequence.
deactivate(id: string, organizationId: string, actorId: string): Promise<{ reassignedCount: number; unassignedCount: number }>

// Migrated from RoleController — same three methods, same URL paths
getUserRoles(userId: string, organizationId: string): Promise<IRole[]>
assignRoleToUser(userId: string, dto: AssignRoleDto, organizationId: string, actorId: string): Promise<void>
removeRoleFromUser(userId: string, roleId: string, organizationId: string, actorId: string): Promise<void>
```

**`user.controller.ts`**:
```
GET    /users                       @Permissions(USERS_PERMISSIONS.VIEW)
GET    /users/:id                   @Permissions(USERS_PERMISSIONS.VIEW)
POST   /users/invite                @Permissions(USERS_PERMISSIONS.INVITE)
PATCH  /users/:id/profile           @Permissions(USERS_PERMISSIONS.MANAGE) — or self, see note
PATCH  /users/:id/out-of-office     @Permissions(USERS_PERMISSIONS.MANAGE) — or self, see note
POST   /users/:id/deactivate        @Permissions(USERS_PERMISSIONS.MANAGE)
GET    /users/:userId/roles         @Permissions(ROLES_PERMISSIONS.VIEW)      — MOVED from RoleController
POST   /users/:userId/roles         @Permissions(ROLES_PERMISSIONS.MANAGE)    — MOVED
DELETE /users/:userId/roles/:roleId @Permissions(ROLES_PERMISSIONS.MANAGE)    — MOVED
```

**"Or self" note:** a user editing their own out-of-office settings or basic
profile fields shouldn't need `users:manage` — that permission is for editing
*other* users. This needs a small self-or-permission check (`actorId === id
|| hasPermission('users:manage')`) inside the service, not a second
decorator — flagged in Pending Discussion #3 since it's the one place this
plan introduces an authorization rule slightly more complex than a single
`@Permissions()` check.

**`role.controller.ts`**: remove the three migrated endpoints and the
"temporary home" header comment. `role.service.ts`: the three methods stay —
`UserService` calls into `RoleService` (already exported from `RolesModule`)
rather than duplicating the logic, matching CLAUDE.md's "every module is
self-contained" alongside "reuse existing services" precedent (same relationship
`TaskService` has with `WorkingCalendarService`).

---

### Commit 5 — Login attempt logging, lockout, new-IP notification
```
src/foundation/auth/login-attempt.service.ts                            CREATE
src/foundation/auth/login-attempt.service.spec.ts                       CREATE
```

**`login-attempt.service.ts`** — small, focused service `AuthService`
(Commit 3) calls around every login attempt:

```typescript
record(entry: { organizationId, email, success, failureReason?, ipAddress?, userAgent? }): Promise<void>

// Reads Organization.authConfig.lockoutThreshold/lockoutWindowMinutes
// (falls back to platform defaults 5 / 15 if authConfig absent).
// Counts consecutive failures for this (organizationId, email) since the
// last success, within the window. No stored counter — computed on read.
isLocked(organizationId: string, email: string): Promise<boolean>

// True if this IP has no prior SUCCESSFUL LoginAttempt for this user.
isNewIp(organizationId: string, userId: string, ipAddress: string): Promise<boolean>
```

`AuthService.login()` calls `isLocked()` **before** calling into Better Auth
at all (a locked account should never even reach Better Auth's own password
check — cheaper and avoids Better Auth's own rate-limiting semantics needing
to agree with this one). On a successful login, calls `isNewIp()` and, if
true, `NotificationService.create()` with `channel: EMAIL` before returning
the bridged JWT.

---

### Commit 6 — Departure flow (bulk task reassignment)
```
foundation/user/user.service.ts                                        MODIFY (deactivate() body)
foundation/task/task.service.ts                                        MODIFY (new method)
```

**`TaskService` gains one new method** (the only assignable-work model that
exists today — see Section 1's Non-Goals):

```typescript
// Bulk version of the existing reassign() — every Task where userId has an
// active (removedAt: null) TaskAssignee row. If toUserId is given (the
// departing user's actingUserId), reassigns each; if null, sets each Task's
// status to UNASSIGNED instead (reusing the exact status Step 8 already
// added for role-vacancy fallback — same meaning: "no eligible assignee").
// Every change logged individually via AuditLogService, same as the
// existing single-task reassign(). Returns counts for UserService.deactivate()
// to report back to the caller and to the Tenant Admin notification.
reassignAllForUser(fromUserId: string, toUserId: string | null, organizationId: string, actorId: string): Promise<{ reassignedCount: number; unassignedCount: number }>
```

**`UserService.deactivate()` full sequence** (Section 8 has the business-rule
narrative):
```
1. Load the user, confirm same-tenant (NotFoundException otherwise)
2. Set status: INACTIVE
3. Call authProvider.invalidateUserSessions(id) → tokenVersion += 1
4. Call taskService.reassignAllForUser(id, user.actingUserId ?? null, ...)
5. NotificationService.create() → Tenant Admin, summarizing counts
6. AuditLogService.log() — action UPDATE, objectType 'User', before/after status
```

---

### Commit 7 — Module wiring, permissions, app.module.ts
```
src/foundation/auth/auth.module.ts                                     CREATE
src/foundation/user/user.module.ts                                     CREATE
src/foundation/roles/role.controller.ts                                MODIFY (remove 3 endpoints)
src/foundation/roles/role.module.ts                                    MODIFY (export RoleService if not already)
src/app.module.ts                                                     MODIFY
src/common/constants/permissions.ts                                   MODIFY
```

**`permissions.ts`** — `USERS_PERMISSIONS` gains:
```typescript
export const USERS_PERMISSIONS = {
  VIEW:       'users:view',
  MANAGE:     'users:manage',
  INVITE:     'users:invite',
  DEACTIVATE: 'users:deactivate',   // ADD — separate from MANAGE per CLAUDE.md's
                                      // "Forced logout on role change or account
                                      // suspension" being a distinct, higher-stakes
                                      // action than editing a profile field
} as const;
```

**`auth.module.ts`**: no `TenantGuard`/`PermissionGuard` on its controller at
all (every endpoint on `AuthController` is deliberately pre-authentication or
self-service by design, per Commit 3). Imports `PrismaModule`,
`forwardRef(() => TenantModule)` (for `AuditLogService`),
`forwardRef(() => NotificationModule)` is not needed — `NotificationModule`
is `@Global()`.

**`user.module.ts`**: imports `PrismaModule`, `forwardRef(() => TenantModule)`,
`forwardRef(() => TaskModule)` (for `reassignAllForUser`), `RolesModule`
(for the migrated role-assignment delegation — direct import, not
`forwardRef`, since `RolesModule` does not import `UserModule` back).
`app.module.ts` — add `AuthModule`, `UserModule`.

**Circular-dependency verification:** `UserModule → forwardRef TaskModule`
closes the same transitive-cycle shape Step 8's own `TaskModule →
forwardRef TenantModule` already established — verify with a real
`start:dev` boot, not just `tsc`/`jest`, same standing rule every step has
followed since Step 6.

---

## 4. FILES TO CREATE (FRONTEND)

All paths relative to `frontend/src/app/` unless noted.

### Commit 8 — Real AuthService, authGuard, login page (replaces dev/demo-login)
```
core/services/auth.service.ts                                          CREATE
core/guards/auth.guard.ts                                              CREATE
core/interceptors/auth.interceptor.ts                                  MODIFY (real AuthService, not DemoAuthService)
foundation/auth/components/login/login.component.ts                    CREATE
foundation/auth/components/accept-invitation/accept-invitation.component.ts  CREATE
foundation/auth/components/forgot-password/forgot-password.component.ts CREATE
foundation/auth/auth.routes.ts                                         CREATE
app.routes.ts                                                         MODIFY (add authGuard to every protected route, add public 'login'/'accept-invitation'/'forgot-password' routes)
dev/demo-login/                                                       DELETE
dev/demo-auth.service.ts                                               DELETE
```

**`auth.service.ts`** — `login(email, password)` (handles the
`mfaRequired` branch, prompting the login component to show a TOTP-code
step), `verifyMfa(challengeToken, code)`, `logout()`, `acceptInvitation(...)`,
`forgotPassword(email)`, `resetPassword(token, newPassword)`.

**No token storage in Angular at all** — per Section 12, Discussion 4's
resolution, the httpOnly `access_token`/`refresh_token` cookies are the only
place the token exists, and Angular code can never read them (that's the
point of `httpOnly`). `HttpClient` is configured with `withCredentials:
true` (`app.config.ts`'s `provideHttpClient(withInterceptors([...]),
withFetch())` — style call gains the credentials option) so the browser
sends/receives those cookies automatically on every request; the interceptor
no longer attaches any `Authorization` header at all — there is no token
value for it to read or attach. `auth.service.ts` does keep one small
piece of in-memory UI state — a `currentUser` signal holding `{ id, email,
nameEn }` — populated from the `user` object every successful
login/mfa-verify response already returns, and cleared on logout/401. This
is display state (whose name/email to show in the top bar), **not** a
token or credential, and does not by itself grant any access — the cookie
is what the backend actually checks on every request.

**`auth.interceptor.ts`** — on any `401` response, clears `currentUser` and
navigates to `/login`. This — not a synchronous local check — is the real
source of truth for "session expired," since there is no local token to
inspect ahead of time.

**`auth.guard.ts`** — `CanActivateFn` redirecting to `/login` when no
`currentUser` is set. **This is the first route guard in the entire
frontend** — today literally nothing stops an unauthenticated user from
navigating to `/organization` etc. in the Angular router (only the backend
API calls 401). `app.routes.ts` needs `canActivate: [authGuard]` added to
every existing feature route, not just new ones.

**`login.component.ts`** — email + password form, MFA-code step shown
conditionally after a `mfaRequired` response, "Forgot password?" link.

---

### Commit 9 — Angular user management (list + invite) + global ConfirmationService + window.confirm() payoff
```
foundation/user/services/user.service.ts                               CREATE
foundation/user/components/user-list/user-list.component.ts            CREATE
foundation/user/components/invite-user/invite-user.component.ts        CREATE
foundation/user/user.routes.ts                                        CREATE
app.routes.ts                                                         MODIFY
app.config.ts                                                         MODIFY
app.component.html                                                     MODIFY
foundation/roles/components/role-list/role-list.component.ts           MODIFY
foundation/organization/components/org-unit-tree/org-unit-tree.component.ts MODIFY
foundation/lookup/components/lookup-value-list/lookup-value-list.component.ts MODIFY
foundation/org-position/components/position-list/position-list.component.ts MODIFY
foundation/workflow/components/workflow-template-list/workflow-template-list.component.ts MODIFY (if it uses window.confirm)
```

**Per Pending Discussion #5's resolution — pays down every outstanding
`window.confirm()` TODO in the codebase, not just this step's own new UI:**

- `ConfirmationService` added to `app.config.ts`'s providers (once, app-wide).
- `<p-confirmDialog>` added once to `app.component.html` (the app shell root,
  not per-feature).
- Every existing component with a `// TODO: replace with PrimeNG
  ConfirmationService dialog` comment (found by grepping `window.confirm(`
  across `frontend/src/app` at the start of this commit — the list above is
  the known set as of this plan; the grep is authoritative, not this list)
  is converted to `ConfirmationService.confirm({...})`.

`user-list.component.ts` — `p-table`: name, email, status tag, position, org
unit, last login; "Invite User" button opens `invite-user.component.ts` in a
`p-dialog` (same pattern as `position-list.component.ts`/
`task-list.component.ts`'s create dialogs); row click navigates to the
profile page (Commit 10). Deactivate action per row opens a
`ConfirmationService` dialog (not a bare `window.confirm` — user
deactivation is the highest-stakes action in the platform so far) showing:
the user's name, an impact summary ("Sessions will be revoked. N open tasks
will be reassigned to {actingUser} / flagged as unassigned."), a clearly
labeled danger-styled confirm button, and a loading state on the dialog
while `deactivate()` is in flight.

---

### Commit 10 — Angular user profile page
```
foundation/user/components/user-profile/user-profile.component.ts       CREATE
app.routes.ts                                                         MODIFY
```

Sections: basic info (read-only email, editable name/language), position +
primary org unit pickers (reusing `OrgPositionService.listPositions()` /
`OrgUnitService`, same picker pattern as `position-form.component.ts`),
manager picker (a user picker — **first real user-listing UI in the
codebase**, backed by `UserService.listUsers()` from Commit 9, so no
`p-message` stopgap is needed here unlike Step 8's task-form, which had no
user list to reuse yet), out-of-office date range + acting-user picker
(same user picker), and an embedded `<app-user-role-assignment [userId]="...">`
(Commit 6 in Step 6's original build, wired up for real for the first time).

---

### Commit 11 — Translation keys
```
frontend/src/assets/i18n/en.json     MODIFY
frontend/src/assets/i18n/ar.json     MODIFY
```

`"auth"` namespace: `login`, `email`, `password`, `mfaCode`,
`forgotPassword`, `resetPassword`, `acceptInvitation`, `errorInvalidCredentials`,
`errorLocked`, `errorMfaRequired`. `"user"` namespace: `title`, `invite`,
`inviteEmail`, `status.*` (active, inactive, invited, suspended), `profile`,
`position`, `primaryOrgUnit`, `manager`, `outOfOffice`, `actingUser`,
`deactivate`, `deactivateConfirm`, `noUsers`, `errorLoad`.

---

## 5. COMMIT SEQUENCE

All commits on branch `feature/ACC-12-user-management`.
Format: `{type}({scope}): {description} [ACC-12]`

```
Commit 1:  chore(prisma): add Better Auth tables and user management fields [ACC-12]
Commit 2:  feat(auth): configure Better Auth instance, wire AuthProvider [ACC-12]
Commit 3:  feat(auth): add AuthController and AuthService (login/mfa/invite-accept/password-reset) [ACC-12]
Commit 4:  feat(user): add UserService and UserController [ACC-12]
Commit 5:  feat(auth): add login attempt logging, lockout, new-IP notification [ACC-12]
Commit 6:  feat(user): add departure flow with bulk task reassignment [ACC-12]
Commit 7:  chore(user): register AuthModule/UserModule, migrate role endpoints, update permissions [ACC-12]
Commit 8:  feat(auth): add Angular login page, auth guard, real AuthService [ACC-12]
Commit 9:  feat(user): add Angular user list and invite UI [ACC-12]
Commit 10: feat(user): add Angular user profile page [ACC-12]
Commit 11: feat(i18n): add auth and user translation keys [ACC-12]
```

Run `npx tsc --noEmit` before every commit. Run `npx jest --passWithNoTests`
before commits 2–7. Real `start:dev` boot check required after Commit 7
(new `AuthModule`/`UserModule` edges into `TenantModule`/`TaskModule`).

**Commit 1 carries no data-loss risk** — purely additive.

**Do not push until all 11 commits are done and verified**, matching the
standing instruction from Step 8.

---

## 6. ACCEPTANCE CRITERIA

- [ ] Better Auth activated with email/password provider
- [ ] Argon2id password hashing (Better Auth's own default — not bcrypt)
- [ ] HaveIBeenPwned password check on registration (Better Auth's official plugin)
- [ ] Account lockout after 5 failed attempts (tenant-configurable via
      `Organization.authConfig.lockoutThreshold`)
- [ ] Login attempt logging with IP and device info (`LoginAttempt`, append-only)
- [ ] Email notification on new-IP login via Resend (`NotificationService`)
- [ ] TOTP MFA support, optional, tenant admin enables
      (`Organization.authConfig.mfaEnabled`)
- [ ] User invitation flow via Resend email
- [ ] Full user profile: positionId, primaryOrgUnitId, managerId,
      outOfOffice fields — all readable/writable from the Angular profile page
- [ ] Role assignment UI — `UserRoleAssignmentComponent` embedded in the
      profile page
- [ ] Out-of-office settings with acting-user designation
- [ ] User departure flow: deactivate + tokenVersion increment + bulk
      reassignment (or UNASSIGNED flagging) of every open Task assignment
- [ ] Angular login page replaces `dev/demo-login` (route + component deleted)
- [ ] Angular user management (list + invite) UI
- [ ] Angular user profile page
- [ ] `/users/:userId/roles*` served by `UserController`, not `RoleController`
- [ ] `TenantGuard` changed ONLY as scoped in Commit 3 (cookie-first token
      read, `tokenVersion` DB check) — verified by diff; `PermissionGuard`
      fully unmodified
- [ ] `AuthProvider.invalidateUserSessions()` has a real implementation and a
      real caller (departure flow)
- [ ] Translation keys in en.json and ar.json
- [ ] Backend TypeScript: zero errors
- [ ] Frontend TypeScript: zero errors
- [ ] All tests passing including tenant isolation
- [ ] PR merged to dev with green CI

---

## 7. DEPENDENCIES

### What This Step Requires from Steps 1–8

| Requirement | Where It Comes From |
|---|---|
| `Organization.authConfig` (encrypted) + `tenant-config-crypto.ts` | Step 1 |
| `AUTH_PROVIDER` token, `AuthProvider` interface (stub) | Step 1 |
| `User.tokenVersion`, `TenantGuard`'s JWT parsing | Step 1 |
| `User.positionId/primaryOrgUnitId/outOfOfficeFrom/To/actingUserId` | Step 8 (added ahead of schedule) |
| `OrgPositionService`, `OrgUnitService` (pickers) | Step 8 / Step 2 |
| `TaskService.reassign()` (single-task version, extended this step) | Step 8 |
| `RoleController`'s `/users/:userId/roles*` (moved, not rebuilt) | Step 5 |
| `UserRoleAssignmentComponent` (built, unembedded) | Step 6 |
| `NotificationService` (`@Global()`) | Step 7 |
| `AuditLogService` (`ipAddress` field already supported) | Step 1 |

### What Future Steps Will Require from Step 9

| Future Step | What It Needs |
|---|---|
| Step 10 — Committees | Committee-seat replacement on departure extends this
      step's departure-flow pattern (`reassignAllForUser`-style bulk operation)
      to `CommitteeMember` |
| Step 12 — Super Admin Portal | Tenant Admin's user-management view is this
      step's `UserController` reused, plus impersonation (new, Step 12's own concern) |
| Step 14 — Onboarding | The tenant-signup wizard's "create first admin user"
      step reuses `AuthService`'s Better Auth sign-up call, not `UserService.invite()`
      (no invitation token needed for the very first user) |
| Every later module needing "who can act on this" | `User.managerId` and
      `positionId` become available inputs to approval-authority chains
      (Steps 17–19, per Step 8's own `OrgPosition` cross-module usage table) |

---

## 8. BUSINESS RULES

### Invitation Token Lifecycle

`invite()` generates a cryptographically random token (not a JWT — a plain
opaque token, since it's single-use and short-lived), stores it directly on
`User.invitationToken` with a 7-day `invitationExpiresAt`. `accept-invitation`
validates both before allowing `AuthUser`/`AuthAccount` creation; on success,
clears both fields (`null`) and sets `status: ACTIVE`. An expired or already-
used invitation returns a generic error — never reveals whether the token
was ever valid (avoids enumeration).

### Login Sequence (full path, for `AuthService.login()`)

```
1. Resolve organizationId from subdomain/tenant header
2. Compute namespacedEmail = `${organizationId}:${email}`
3. loginAttemptService.isLocked(organizationId, email) → if true, record a
   failed attempt (failureReason: 'locked') and return 423 Locked — WITHOUT
   calling Better Auth at all
4. Call Better Auth's signInEmail(namespacedEmail, password)
5. On failure: loginAttemptService.record(..., success: false, failureReason: 'invalid_password')
   → generic "invalid credentials" response (never reveal which field was wrong)
6. On success, check Organization.authConfig.mfaEnabled AND AuthTwoFactor exists
   for this user → if both true, return { mfaRequired: true, challengeToken }
   WITHOUT yet minting the AccreditMe JWT
7. If MFA not required (or after /auth/mfa/verify succeeds): loginAttemptService.record(success: true),
   isNewIp() check → notify if new, mint AccreditMe JWT (sub, organizationId,
   tokenVersion, exp), update User.lastLoginAt/lastLoginIp, return JWT
```

### Departure Flow — Full Narrative

Per `module-designs.md`'s Absence and Departure Management, "User Departure
Flow (Critical)": deactivating a user is treated with the same seriousness
as any other business-ending-risk operation in this codebase. The sequence
in Commit 6 is not reorderable — `tokenVersion` increments *before* bulk
reassignment starts, so that even if reassignment takes noticeable time (many
open tasks), the departing user's existing sessions are already dead the
instant the operation begins, not after it finishes.

### Why `AuthUser.email` Is Namespaced, Not `AuthUser.appUserId` Alone

An earlier draft of this design considered leaving `AuthUser.email` as the
real email and relying on `appUserId`'s own uniqueness to prevent confusion.
Rejected: Better Auth's internal sign-in flow looks up `AuthUser` **by
email**, not by `appUserId` — if two tenants share a real email address,
Better Auth's own lookup would silently resolve to the wrong tenant's
`AuthUser` row. Namespacing the field Better Auth actually queries by is the
only fix that doesn't require patching Better Auth's own internals.

### TOTP Secret / Backup Codes at Rest

`AuthTwoFactor.secret`/`backupCodes` are stored encrypted at rest — same
`ENCRYPTION_KEY`/AES-256-GCM helper as `tenant-config-crypto.ts`, applied at
the point Better Auth's `twoFactor` plugin persists them (a plugin storage
hook, not a schema-level Prisma encryption — Prisma has no native
column-level encryption). Flagged in Pending Discussion #6 — confirm Better
Auth's `twoFactor` plugin actually exposes a hook for this before Commit 2,
rather than assuming it does.

---

## 9. AI INTEGRATION POINTS

**None.** Neither CLAUDE.md's AI Integration Points section nor
`module-designs.md` defines any AI touchpoint for user management or
authentication — correctly so; login/security flows are exactly the kind of
path CLAUDE.md's "AI is assistive, never autonomous" principle would keep AI
away from entirely. The Absence and Departure Management section's
"Coverage Gap Detection" AI job (mentioned in Step 8's plan) remains a
documented stub — this step supplies the real data (`outOfOfficeFrom`/
`actingUserId` now actually settable through UI) that job would eventually
read, but building the job itself is still out of scope here.

---

## 10. QUEUE SUMMARY (Cross-Reference with Steps 6–8)

```
workflow-actions   — Step 6 — unchanged
sla-monitor        — Step 6, extended Step 8 — unchanged
email-delivery     — Step 7 — reused as-is for invite / new-IP-login /
                      password-reset emails; no new queue registered
```

No new BullMQ queue in Step 9.

---

## 11. FRONTEND — WHY STILL NO SHARED LAYOUT MODULE

Same situation as Steps 7–8: no `frontend/src/app/layout/` app shell exists
yet. Unlike those steps, though, this one finally adds the first **route
guard** (`authGuard`) — every existing route in `app.routes.ts` gains
`canActivate: [authGuard]` as part of Commit 8, even though none of those
modules' own code changes. This is the one cross-cutting frontend change
this step makes outside its own feature folder.

---

## 12. PENDING DISCUSSIONS — ALL RESOLVED

All six discussions below were open questions in this plan's first draft.
Each is now resolved with a concrete decision. Nothing in this section is
still pending confirmation — it is a decision record, not a question list.

### Discussion 1 — RESOLVED: `TenantGuard` gains exactly one change

`TenantGuard` gains **one additional change only**: a `tokenVersion` DB read
(`User.tokenVersion` by `payload.sub`) and one comparison against the
token's own `tokenVersion` claim. Everything else in `TenantGuard` is
unchanged.

"TenantGuard unchanged" in the ticket means the JWT **parsing mechanism**
stays (`TenantGuard` keeps its own hand-rolled `verifyJwt()` rather than
switching to call `AUTH_PROVIDER`/Better Auth for verification) — it does
not mean this pre-existing TODO is blocked. Without this check, the
departure flow's JWT revocation guarantee (Commit 6) is meaningless: a
deactivated user's still-valid-for-up-to-15-minutes JWT would keep working
until natural expiry regardless of `tokenVersion` having been incremented.

*(See Discussion 4 below for how this interacts with the cookie-based
session model — `TenantGuard` now has two possible token sources to check,
not one, but the `tokenVersion` comparison itself is identical either way.)*

### Discussion 2 — RESOLVED: two nullable columns, no `UserInvitation` model

```prisma
invitationToken     String?
invitationExpiresAt DateTime?
```

on the `User` model directly. No dedicated `UserInvitation` model.

**Rationale:** invitation is a one-time event per user — there is never a
history of past invitations worth querying separately, and `AuditLog`
already covers the audit trail of who invited whom and when. A dedicated
model would only ever hold a 1:1, transient relationship with `User` for its
entire useful lifetime (cleared the moment the invitation is accepted).

### Discussion 3 — RESOLVED: service-level self-or-admin check

```typescript
const isSelf = actorId === targetUserId;
const isAdmin = userPermissions.includes('users:manage');
if (!isSelf && !isAdmin) {
  throw new ForbiddenException();
}
```

Admin-only fields (`roleIds`, `positionId`, `primaryOrgUnitId`) are stripped
from the DTO before it reaches the update path whenever `isSelf && !isAdmin`
— a user editing their own profile can change their own name/language/
out-of-office settings, but cannot promote themselves into a different
position or org unit without an admin doing it.

**This is the first instance in the codebase where a permission check
happens outside a single `@Permissions()` decorator** — documented here
explicitly so it isn't mistaken for an oversight or copied inconsistently
by a later module. `UserService.updateProfile()`/`updateOutOfOffice()` are
the two call sites.

### Discussion 4 — RESOLVED: production-ready httpOnly cookie session storage

**Not** in-memory (that was a demo-only pattern, matching `DemoAuthService`'s
own explicit "throwaway dev credential, not a session mechanism" comment —
never intended to be load-bearing for a real login).

**Auth endpoints (supersedes the response-shape description in Section 3's
Commit 3 — those endpoints still exist, their response contract changes):**

```
POST /api/v1/auth/login
  Sets two httpOnly cookies:
    access_token:  15 min,  SameSite=Strict, Secure=true in production
    refresh_token: 7 days,  path=/api/v1/auth/refresh only
  Returns: { success: true } — NO token in the response body

POST /api/v1/auth/refresh
  Reads the refresh_token cookie
  Validates it against the RefreshToken table (tokenHash — never plain)
  Issues a new access_token cookie
  Rotates the refresh token (old row revokedAt set, new row issued)

POST /api/v1/auth/logout
  Clears both cookies
  Sets RefreshToken.revokedAt = now() for the presented refresh token
```

**Schema** — see Section 2's `RefreshToken` model (added there directly,
not repeated here).

**`TenantGuard` update:** reads the access token from the `access_token`
cookie first, falling back to the `Authorization` header second (for
non-browser API clients that can't hold cookies — e.g. future public-API
consumers in Phase 3). Both paths still run Discussion 1's `tokenVersion`
validation identically — the cookie-vs-header choice only changes where the
raw token string comes from, not how it's verified afterward.

**Angular update:**
- `DemoAuthService` removed entirely.
- `dev/demo-login` component removed entirely.
- The `dev/login` route removed from `app.routes.ts`.
- Every `HttpClient` request configured with `withCredentials: true` (so the
  browser sends/receives the httpOnly cookies automatically).
- `auth.interceptor.ts`: no longer attaches any bearer token (there is none
  to attach — the browser handles the cookie automatically); on a `401`
  response, navigates to `/login`.
- **No token storage anywhere in Angular** — not in a signal, not in
  `localStorage`, not anywhere. The httpOnly cookie is the only place the
  token exists, and Angular code can never read it (that's the point of
  `httpOnly`).

**CORS update in `main.ts`** and **new `FRONTEND_URL` environment
variable** — see Section 3's Commit 3 update for the exact code.

*(Reconciled: Section 1's "Where Better Auth's Session Ends and TenantGuard's
JWT Begins," Section 3's Commit 3 endpoint table, and Section 4's Commit 8
`auth.service.ts` description have all been updated to match this
resolution — no response body ever carries the token, and Angular never
stores one.)*

### Discussion 5 — RESOLVED: pay down every `window.confirm()` TODO in this step

User deactivation is the highest-stakes destructive action in the platform
so far (bulk task reassignment + full session revocation) — a bare
`window.confirm()` is inadequate for it. Rather than add a fourth instance
of the same deferred TODO, this step pays down all of them at once:

- `ConfirmationService` added to `app.config.ts`'s providers (app-wide, once).
- `<p-confirmDialog>` added once to `app.component.html` (the app shell root).
- Every existing component currently using `window.confirm()` is converted
  to `ConfirmationService.confirm({...})` — `role-list.component.ts`,
  `org-unit-tree.component.ts`, `lookup-value-list.component.ts`,
  `position-list.component.ts`, `workflow-template-list.component.ts` (if it
  has one), and any other component a fresh `window.confirm(` grep turns up
  at the start of this commit.

**The user-deactivation confirmation dialog specifically must show:**
- The name of the user being deactivated.
- An impact summary: sessions revoked, and the exact count of tasks that
  will be reassigned vs. flagged `UNASSIGNED`.
- A clearly labeled danger-styled confirm button.
- A loading state on the dialog while the deactivation request is in flight.

See Section 4's Commit 9 for the full file list this touches.

### Discussion 6 — RESOLVED AT BUILD TIME

At the **start of Commit 2**, before any MFA code is written: read Better
Auth's `twoFactor` plugin source/docs and check whether it exposes a storage
hook for encrypting `secret`/`backupCodes` before persistence.

- **If yes:** use that hook directly.
- **If no:** wrap the Prisma adapter with AES-256-GCM encryption at the
  point of write/read — same pattern already used for
  `authConfig`/`aiConfig`/`storageConfig` via `tenant-config-crypto.ts`.

Whichever branch applies, **report the finding before writing any MFA code**
— this determines Commit 2's actual scope and cannot be decided from
documentation alone (the installed `better-auth@^1.6.22` API is the source
of truth, not this plan's assumption).

---

*Plan created: 2026-07-28*
*Section 12 resolved: 2026-07-28*
*Branch created: feature/ACC-12-user-management*
*Depends on: ACC-11 (merged to dev ✅)*
