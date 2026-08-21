# AccreditMe — System Reference

## Purpose

A living, maintained technical inventory of every foundational
mechanism actually implemented in this codebase — what model/schema
shape it uses, exactly what its service methods do (and, just as
importantly, do **not** do), and which other modules currently consume
it.

This is distinct from the other two reference documents:

- **`CLAUDE.md`** — decisions and the build log: what was built, in
  what order, and why, plus the standing rules for how to build the
  next thing.
- **`backend/Plans/module-designs.md`** — business rules: workflow
  stages, approval logic, and domain requirements per functional
  module, largely independent of how the code implements them.
- **`SYSTEM-REFERENCE.md` (this document)** — the actual implemented
  shape of foundational, cross-cutting mechanisms, verified against the
  code, not the design intent.

**Why this document exists**: it exists because of a direct incident
in this project. ACC-28 ("resource-scoped role assignment") was
originally drafted as an entirely new, generic authorization system —
a new table, a new guard class, a new mapping table — without first
checking whether the existing workflow-engine assignee-resolution
machinery already solved most of the problem. A follow-up investigation
found that `resolveAssigneeRaw()`'s `COMMITTEE` case already resolved
correctly to one specific committee's members; it was one filter away
from the need, not absent. The plan was scrapped and rebuilt as a much
smaller extension of existing code. That investigation should have
happened *before* the first design was drafted, not after. This
document exists so it does: **before any new cross-cutting or
foundational mechanism is proposed, check this document first** — not
just to avoid re-investigating from scratch, but to catch exactly the
kind of premature-generalization mistake ACC-28 made the first time.

This document is maintained going forward — when a foundational
mechanism changes shape, this document is updated in the same PR, the
same way `CLAUDE.md` already is.

**Two distinct audit efforts — do not conflate them.** Every section
below includes a "Frontend Consumption" subsection: a **static,
grep-based** check of whether a frontend file actually calls each
documented backend endpoint/service method, done cheaply while writing
this document. This is **not** the separately-queued "backend-vs-
frontend coverage audit" (`backend/Plans/audit-backend-frontend-coverage.md`)
— that is a deep, **live-browser** audit, driven by Playwright MCP,
testing actual reachability and correct behavior per permission
persona. A grep confirming a frontend file *calls* an endpoint proves
a wired code path exists; it proves nothing about whether that path is
reachable through real navigation, renders correctly, or behaves
correctly for a given persona. Findings here should sharpen that later
audit's starting point, not be mistaken for having already done it.

---

## Table of Contents

1. Auth & Permission System — ✅ complete
2. Workflow Engine — ✅ complete
3. Task System — ✅ complete
4. Notification System — ✅ complete
5. OrgPosition — ✅ complete
6. Lookup System — ✅ complete
7. Organization Structure — ✅ complete
8. Multi-Tenancy Conventions — ✅ complete
9. i18n / RTL — ✅ complete
10. Frontend Design Patterns — ✅ complete
11. Known Cross-Cutting Gaps — ✅ complete
12. User Management — ✅ complete

---

## 1. Auth & Permission System

### 1.1 Models

```prisma
model Role {
  id             String       @id @default(cuid())
  organizationId String
  key            String?      // stable identifier for system roles (e.g.
                               // "TENANT_ADMIN"), null for tenant-custom roles
  nameEn         String
  nameAr         String
  description    String?
  isSystem       Boolean      @default(false)
  isActive       Boolean      @default(true)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@unique([organizationId, key])
  @@unique([organizationId, nameEn])
}

model Permission {
  id          String @id @default(cuid())
  module      String
  action      String
  description String?

  @@unique([module, action])   // permission string = "{module}:{action}"
}

model UserRole {
  id        String   @id @default(cuid())
  userId    String
  roleId    String
  createdAt DateTime @default(now())

  @@unique([userId, roleId])
}

model RolePermission {
  id           String @id @default(cuid())
  roleId       String
  permissionId String

  @@unique([roleId, permissionId])
}
```

`UserRole` has **exactly** these four columns — `id, userId, roleId,
createdAt`. No resource-scoping column of any kind (no `committeeId`,
no generic `resourceType`/`resourceId`). A user either holds a `Role`
tenant-wide, or does not hold it at all. This is the schema fact ACC-28
was originally built against.

### 1.2 Guard Composition

Three guards, always composed in this order via `@UseGuards(...)`:

```
TenantGuard                              — every guarded controller
TenantGuard, PermissionGuard             — every ordinary tenant-scoped controller
TenantGuard, PlatformGuard               — Super Admin Portal controllers only
```

**`TenantGuard`** (`backend/src/common/guards/tenant.guard.ts`) — runs
first on every guarded route. Reads the JWT (httpOnly `access_token`
cookie, falling back to `Authorization: Bearer` header), verifies
HMAC-SHA256 signature and expiry, checks `payload.tokenVersion` against
the live `User.tokenVersion` in the DB (lines 132–139; a mismatch
rejects immediately rather than waiting for natural 15-minute expiry).

**Correction — verified, not assumed**: `tenant.guard.ts`'s own header
comment (lines 19–25) claims a mismatch can come from "deactivation,
password-change, or role-change." That comment overstates what's
actually wired. `tokenVersion` is only ever incremented in one place —
`BetterAuthProvider.invalidateUserSessions()`
(`backend/src/providers/auth/better-auth.provider.ts:69–73`,
`prisma.user.update({ data: { tokenVersion: { increment: 1 } } } )`)
— and that method is only ever called from one place in application
code: `UserService.deactivate()`
(`backend/src/foundation/user/user.service.ts:242`), the departure
flow. Confirmed by direct grep:
- `invalidateUserSessions()`'s own code comment
  (`better-auth.provider.ts:64–68`) states password-change wiring is
  planned "in a later step" — **not yet implemented**.
- `RoleService.assignRoleToUser()`/`removeRoleFromUser()`
  (`role.service.ts:307–377`) contain zero reference to `tokenVersion`
  or `invalidateUserSessions` anywhere — confirmed via grep, zero
  matches. `UserService.assignRoleToUser()`/`removeRoleFromUser()`
  (`user.service.ts:305–320`) are pure pass-through delegations to
  those same methods, adding nothing.
- **Net effect: a user's existing JWT remains valid for up to 15
  minutes after their role is changed or their permissions are
  reassigned** — the access-control change does not take effect until
  natural token expiry, not immediately as the guard's own comment
  implies. Only deactivation forces immediate revocation today.

This is exactly the kind of doc-vs-code drift this document exists to
catch rather than repeat — the guard's own header comment was taken at
face value in an earlier draft of this section without checking the
actual call sites; corrected here after verification.

On success, `TenantGuard`
populates `request.tenantId`, `request.userId`, and
`request.userPermissions` (via `PERMISSION_RESOLVER` → see 1.3) —
**every downstream guard and service depends on these three fields
being set by `TenantGuard`, and nothing before it in the chain sets
them.**

**`PermissionGuard`** (`backend/src/common/guards/permission.guard.ts`)
— reads `@Permissions(...)` metadata via `Reflector.getAllAndOverride`
(method-level overrides class-level). If no metadata is present,
**passes through immediately** (`required.length === 0` → `true`) —
this no-op-when-absent behavior is what makes it safe to leave in a
controller's guard chain even for routes that opt out via a different
mechanism (see `WorkflowController.triggerTransition()`/
`submitApproval()` and, per ACC-28's revised plan,
`CommitteesController`'s four membership-mutation routes). When
metadata **is** present, checks `required.some(p => request.userPermissions.includes(p))`
— **OR** semantics across multiple listed permissions, but the whole
check is against the single flat `request.userPermissions` array.

**`PlatformGuard`** (`backend/src/common/guards/platform.guard.ts`) —
the only precedent in this codebase for composing a *second*,
independent authorization check after `PermissionGuard`. Requires
**both**, ANDed: `Organization.isPlatformOrg === true` (settable only
via direct DB access, no API path) **and** `platform:admin` present in
`request.userPermissions`. Neither alone is sufficient — closes a real
gap where a tenant admin self-assigning `PLATFORM_ADMIN` in their own
org would otherwise pass a naive permission-only check (`PLATFORM_ADMIN`
is seeded, harmlessly, into every tenant's own `Role` table).

**Important mechanical property, confirmed directly during the ACC-28
investigation**: NestJS's guard chain is **AND-composed** — every guard
in the list must independently return `true`; Nest short-circuits the
moment one returns `false`/throws. `PlatformGuard`'s pattern works
*because* its check is a second independent AND condition. It does
**not** generalize to an OR requirement ("permission via EITHER flat
roles OR some other grant") — two guards in sequence cannot express
that; the union has to be computed inside a single guard's (or
decorator-free service method's) own logic. This is exactly the
mistake the first draft of ACC-28 made in reverse — assuming
`PlatformGuard`'s composition pattern would work for an OR check it
structurally cannot express.

### 1.3 `getUserPermissions()` — Exact Resolution and Its Limitation

`RoleService.getUserPermissions()` (`backend/src/foundation/roles/role.service.ts:381–400`),
bound to `TenantGuard` via the `PERMISSION_RESOLVER` DI token
(`useExisting: RoleService`, in `roles.module.ts`). Verbatim behavior:

```ts
async getUserPermissions(userId: string, organizationId: string): Promise<string[]> {
  const userRoles = await this.prisma.userRole.findMany({
    where: { userId, role: { isActive: true, organizationId } },
    include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
  });

  const permissionSet = new Set<string>();
  for (const ur of userRoles) {
    for (const rp of ur.role.rolePermissions) {
      permissionSet.add(`${rp.permission.module}:${rp.permission.action}`);
    }
  }
  return Array.from(permissionSet);
}
```

Fetches every **active** `Role` the user holds in this organization,
unions every permission from every one of those roles into a flat
`Set`, and returns it as a flat string array. Called once per request,
inside `TenantGuard`, and cached only for the lifetime of that request
(`request.userPermissions`) — not cached across requests.

**Explicit limitation — no resource-context awareness of any kind.**
This is a pure `userId + organizationId → string[]` function. It has
no parameter for, and no way to answer, "does this user have this
permission *specifically for this committee/document/CAPA instance*."
The result is identical no matter what resource the caller is about to
act on. Every downstream consumer (`PermissionGuard`, `PlatformGuard`,
and every service that reads `request.userPermissions` directly, e.g.
`WorkflowService.triggerTransition()`'s `requiredPermission` check)
inherits this same flatness. **This is the exact fact ACC-28's revised
plan treats as a hard constraint — not reworked, extended additively
elsewhere.**

### 1.4 Other `RoleService` Methods — Behavior and Limitations

- **`createRole()`** — tenant admins can create entirely new,
  non-system roles (`isSystem: false`, `key: null`) with an arbitrary
  permission set from the moment of creation. No cap on how many custom
  roles a tenant can create.
- **`updateRole()`** — `nameEn`/`nameAr`/`description` only. Cannot
  change `key`, `isSystem`, or permissions (that's `assignPermissions()`
  below).
- **`assignPermissions()`** — **fully replaces** a role's entire
  permission set (`deleteMany` then `createMany`, not a merge/patch).
  **No `isSystem` guard** — this can be called against any system-seeded
  role (`QUALITY_MANAGER`, `AUDITOR`, even `TENANT_ADMIN`) exactly like
  a custom one; the backend places no restriction on editing a system
  role's permissions. The only restriction that exists is client-side
  (`role-permission-matrix.component.ts`'s `HIGH_IMPACT_ROLE_KEYS`
  warns on `TENANT_ADMIN`, hard-blocks navigating to the edit screen at
  all for `PLATFORM_ADMIN`) — a determined API caller could still
  reassign `PLATFORM_ADMIN`'s permissions directly. This confirms
  **roles are genuinely tenant-customizable in both directions** —
  new roles can be created, and any role's (including system roles')
  permissions can be fully replaced.
- **`deactivateRole()` / `removeRoleFromUser()`** — both carry a
  **last-`TENANT_ADMIN` lockout guard**: deactivating the `TENANT_ADMIN`
  role while it has active assignments is blocked; removing a user's
  `TENANT_ADMIN` role is blocked if they are the organization's only
  remaining holder of it. No equivalent lockout exists for any other
  role — `TENANT_ADMIN` (matched by `role.key === 'TENANT_ADMIN'`) is
  the only one hardcoded with this protection.
- **`getRoles()`** — filters `PLATFORM_ADMIN` out of the list for any
  non-platform organization (UX-only defense-in-depth; `PlatformGuard`
  is the real gate, not this filter).

### 1.5 Consumers

Every controller using `@UseGuards(TenantGuard, PermissionGuard)` at
class level (confirmed via direct grep across `backend/src`, not
assumed): `working-calendar`, `task`, `organization`, `org-position`,
`lookup`, `workflow-template`, `roles`, `committees`, `tenant`, `user`,
`workflow`.

**Three deliberate exceptions**, all confirmed and code-commented:

- **`AuthController`** — no class-level `@UseGuards()` at all (every
  endpoint is pre-authentication or self-service); `/auth/me` and
  `/auth/logout` etc. apply `@UseGuards(TenantGuard)` individually,
  never `PermissionGuard` (there is no meaningful permission to require
  before a user has even established a session).
- **`NotificationController`** — `@UseGuards(TenantGuard)` only, no
  `PermissionGuard`, no `@Permissions()` anywhere in the file. Every
  query is self-scoped to the caller's own `userId` — there is nothing
  to gate beyond authentication.
- **`WorkflowController.triggerTransition()` / `submitApproval()`** —
  no `@Permissions()` decorator (code-commented "Permission Model for
  Runtime Transitions"); `TenantGuard` authenticates only, and
  `WorkflowService` performs its own dynamic check against
  `transition.requiredPermission` (tenant-configured data, not a static
  decorator value) using `userPermissions` threaded in via
  `@CurrentUserPermissions()`. **Superseded note (ACC-28)**: an earlier
  revision of ACC-28's plan proposed reusing this exact pattern for
  `CommitteesController`'s four membership-mutation endpoints via a new
  `assertCommitteeAuthority()` service check (flat `committees:manage`
  OR active Chairman of the specific committee). That check was built,
  then rejected by direct product decision — a Chairman is often a
  figurehead who delegates actual system use to a Secretary, so a
  literal "are you the Chairman" check locks out the person doing the
  work. It was removed entirely and replaced with five new permission
  strings (`committees:create`/`edit_details`/`add_member`/
  `remove_member`/`change_member_role`) plus an ordinary
  `@Permissions()` decorator per method — see Section 1.1's
  `COMMITTEES_PERMISSIONS` update below. `CommitteesController` is no
  longer an exception to the class-level-guards-only pattern; this
  bullet's `WorkflowController` case remains the only real one.

**`PlatformGuard` consumers**: `platform-tenant.controller.ts` (every
route except `endImpersonation`, which is `TenantGuard`-only),
`platform-settings.controller.ts` (mutating routes only — reads are
`TenantGuard`-only), `plan.controller.ts` (every route), and
`lookup.controller.ts` (SYSTEM `LookupCategory` mutation only — see
Section 6).

### 1.6 Frontend Consumption (Static Check)

`frontend/src/app/foundation/roles/services/role.service.ts` — every
one of its 10 methods maps 1:1 to a `RoleController`/`UserController`
endpoint. Grepped for actual callers (not just the service definition):

| Method | Endpoint | Caller(s) found |
|---|---|---|
| `listRoles()` | `GET /roles` | `committee-form`, `committee-detail`, `workflow-transition-editor`, `workflow-stage-form`, `user-role-assignment`, `role-list` |
| `getRole()` | `GET /roles/:id` | `role-permission-matrix` |
| `listAllPermissions()` | `GET /roles/permissions` | `role-permission-matrix` |
| `createRole()` | `POST /roles` | `role-form` |
| `updateRole()` | `PATCH /roles/:id` | `role-form` |
| `assignPermissions()` | `PATCH /roles/:id/permissions` | `role-permission-matrix` |
| `deactivateRole()` | `POST /roles/:id/deactivate` | `role-list` |
| `activateRole()` | `POST /roles/:id/activate` | `role-list` |
| `getUserRoles()` | `GET /users/:id/roles` | `user-role-assignment` |
| `assignRoleToUser()` | `POST /users/:id/roles` | `user-role-assignment` |
| `removeRoleFromUser()` | `DELETE /users/:id/roles/:roleId` | `user-role-assignment` |

Every Role/Permission endpoint has at least one confirmed frontend
caller — no dead endpoints found in this system. `TenantGuard`/
`PermissionGuard`/`PlatformGuard` themselves are server-side middleware
with no direct frontend analog — "consumption" here means the
endpoints they gate, not the guards themselves. Auth endpoints
(`frontend/src/app/core/services/auth.service.ts`) confirmed similarly
wired: `/auth/me`, `/accept-invitation`, `/forgot-password`,
`/reset-password`, `/mfa/setup`, `/mfa/setup/verify`, `/mfa/disable`,
`/mfa/status` all have calling code in this one service file.

---

## 2. Workflow Engine

`backend/src/foundation/workflow/workflow.service.ts`. Custom,
database-driven — not XState (see CLAUDE.md, Architecture Rules →
Workflow Engine). Every field/enum below cited against
`schema.prisma` and `workflow.service.ts` directly.

### 2.1 Models (Core Shape)

```prisma
model WorkflowTemplate {
  id             String             @id @default(cuid())
  organizationId String
  nameEn         String
  nameAr         String
  objectType     WorkflowObjectType
  isDefault      Boolean            @default(false)
  isActive       Boolean            @default(true)
}

model WorkflowStage {
  id                 String                     @id @default(cuid())
  workflowTemplateId String
  nameEn, nameAr     String
  order              Int
  slaWorkingHours    Int?
  requiredPermission String?
  isInitial          Boolean                    @default(false)
  isFinal            Boolean                    @default(false)

  approvalMode       WorkflowApprovalMode       @default(SINGLE)
  parallelThreshold  WorkflowParallelThreshold?
  committeeId        String?

  assigneeStrategy   WorkflowAssigneeStrategy   @default(ROLE)
  assigneeUserId     String?
  assigneeRoleId     String?
  // ACC-28 — narrows the COMMITTEE assigneeStrategy case to members
  // holding this committee_member_role LookupValue (e.g. "chairman").
  // Only read when assigneeStrategy === COMMITTEE; null preserves the
  // pre-ACC-28 "every active member" behavior. See 2.5/2.6.
  assigneeCommitteeRoleValueId String?

  escalationConfig   Json?
}

model WorkflowTransition {
  id                 String                     @id @default(cuid())
  fromStageId        String
  toStageId          String
  labelEn, labelAr   String
  requiredPermission String?
  triggerCondition   WorkflowTriggerCondition   @default(ROLE_BASED)
  triggerUserId      String?
  triggerRoleId      String?
  validatorConfig    Json?
  isApprovalPath     Boolean                    @default(false)
}

model WorkflowInstance {
  id                 String                  @id @default(cuid())
  organizationId     String
  workflowTemplateId String
  objectType         WorkflowObjectType
  objectId           String
  status             WorkflowStatus          @default(PENDING)
  currentStageId     String?
}

model WorkflowInstanceStage {
  id                   String                        @id @default(cuid())
  workflowInstanceId   String
  stageId              String
  enteredAt            DateTime                      @default(now())
  exitedAt             DateTime?
  slaDueAt             DateTime?
  slaBreached          Boolean                       @default(false)
  outcome              WorkflowInstanceStageOutcome  @default(PENDING)
  actorId              String?
  comment              String?
  // ACC-28 Section 2.5 — set when, at stage-entry time or the periodic
  // SlaMonitorProcessor sweep, no one in this stage's resolved assignee
  // pool could ever fire an outgoing ASSIGNEE_POOL transition (empty
  // pool, or nobody holds the transition's requiredPermission). Cleared
  // symmetrically by the sweep if the pool becomes qualifying again. See
  // 2.13.
  isUnassigned         Boolean                       @default(false)
  unassignedAt         DateTime?
}

model WorkflowApproval {
  id                      String                    @id @default(cuid())
  workflowInstanceStageId String
  approverId              String
  decision                WorkflowApprovalDecision  @default(PENDING)
  comment                 String?
  decidedAt               DateTime?

  @@unique([workflowInstanceStageId, approverId])
}

model WorkflowTransitionAction {
  id                   String              @id @default(cuid())
  workflowTransitionId String
  actionType           WorkflowActionType
  order                Int                 @default(0)
  isEnabled            Boolean             @default(true)
  configJson           Json?
}

model WorkflowActionLog {
  id                         String                  @id @default(cuid())
  organizationId             String
  workflowTransitionActionId String
  workflowInstanceId         String
  actionType                 WorkflowActionType
  status                     WorkflowActionLogStatus @default(SUCCESS)
  attemptCount               Int                     @default(1)
  responseSummary            String?
  errorMessage               String?
}
```

### 2.2 Enums (Verbatim, `schema.prisma:59–137`)

```
WorkflowObjectType         DOCUMENT_REQUEST, DOCUMENT, CHANGE_REQUEST, INCIDENT,
                            AUDIT, CORRECTIVE_ACTION, MEETING, COMMITTEE
WorkflowApprovalMode        SINGLE, SEQUENTIAL, PARALLEL, COMMITTEE
WorkflowParallelThreshold   ALL, MAJORITY, ANY
WorkflowAssigneeStrategy    SPECIFIC_USER, ROLE, ORG_UNIT_HEAD, SELF, COMMITTEE, ROUND_ROBIN
WorkflowTriggerCondition    SPECIFIC_USER, ROLE_BASED, ANY_AUTHENTICATED, SYSTEM_AUTOMATIC,
                            ASSIGNEE_POOL (ACC-28)
WorkflowActionType          CREATE_TASK, SEND_NOTIFICATION, GENERATE_PDF, LOCK_DOCUMENT,
                            LOG_AUDIT, WEBHOOK
WorkflowApprovalDecision    PENDING, APPROVED, APPROVED_WITH_COMMENTS, RETURNED, ABSTAINED
WorkflowInstanceStageOutcome PENDING, APPROVED, REJECTED, SKIPPED
```

**Code comment worth preserving verbatim** (`workflow.service.ts:39–43`):
*"none of the 8 seeded workflows currently use SEQUENTIAL or COMMITTEE
approvalMode (only SINGLE and PARALLEL+ALL are exercised by real seed
data) — the logic below implements them per the plan's Business Rules,
but is unverified against real seed data until a functional module
actually configures one."* SEQUENTIAL and COMMITTEE approval-mode logic
exists and is unit-tested, but has never run against real production
seed data.

### 2.3 Instance Lifecycle

- **`startInstance(objectType, objectId, organizationId, actorId, templateId?)`**
  — resolves the tenant's default active `WorkflowTemplate` for the
  object type (or a specific `templateId`), finds the template's
  `isInitial` stage, creates the `WorkflowInstance` +
  `WorkflowInstanceStage`, computes SLA due date, and directly notifies
  the initial stage's resolved assignee(s) (the *only* place initial
  notification happens — no `WorkflowTransitionAction` fires on stage
  entry, only on transitions).
- **`cancelInstance()`** — administrative force-cancel. Bypasses
  `requiredPermission`/`triggerCondition`/`validatorConfig` entirely,
  closes every open `WorkflowInstanceStage` as `SKIPPED`, sets
  `status: CANCELLED`. Distinct from a modeled "Cancel" transition
  (which some seeded workflows have) — that goes through the normal
  `triggerTransition()` path with its normal gating.
- **`getInstanceById()` / `getInstancesByObject()`** — plain org-scoped
  reads. `getInstancesByObject()` returns **every** instance ever
  created for that object, plural — one object can accumulate multiple
  instances over its lifetime (e.g. a document's periodic review
  cycles each start a fresh instance).

### 2.4 `triggerTransition()` — Full Gating Trace (`workflow.service.ts:176–293`)

In order, exactly as executed:

1. Load `instance`, confirm `currentStageId` set.
2. Load the named `transition` (must have `fromStageId ===
   instance.currentStageId`, or 404).
3. `requiredPermission` check — flat: `userPermissions.includes(transition.requiredPermission)`.
4. `triggerCondition` gate:
   - `SYSTEM_AUTOMATIC` → hard-blocked, always.
   - `SPECIFIC_USER` → `transition.triggerUserId === actorId`.
   - `ROLE_BASED` (+ `triggerRoleId` set) → `userRole.findFirst({ userId: actorId, roleId: triggerRoleId })`
     — **tenant-wide**, no resource-instance filter of any kind.
   - `ANY_AUTHENTICATED` → no additional check performed anywhere in
     the method (any authenticated actor who passed steps 1–3 proceeds).
   - **`ASSIGNEE_POOL` (ACC-28)** — checked separately, immediately
     after `fromStage` loads in step 5 below (needs the full stage row,
     not just its id): `resolveAssignee(fromStage, instance,
     organizationId).includes(actorId)`, else `ForbiddenException`.
     **Uses the OOO-aware `resolveAssignee()` wrapper, not the raw
     `resolveAssigneeRaw()` (fixed ACC-40)** — previously checked the
     raw pool, so an out-of-office holder's acting user could not
     trigger a transition they'd effectively been delegated; see the
     new Tier 2 tracker entry below. Composes with `requiredPermission`
     as an ordinary AND, same as the other three conditions. The only
     `triggerCondition` value that actually consults assignee
     resolution — see the corrected 2.8 below.
5. Load `fromStage`, confirm the active `WorkflowInstanceStage` entry
   exists.
6. `checkValidatorConfig()` — see 2.10.
7. If `fromStage.approvalMode === 'SINGLE'` → transition fires
   immediately (`performTransition()`).
8. Otherwise (multi-approver): upserts a `WorkflowApproval` row for
   `actorId` on the current stage (`isApprovalPath` maps the named
   transition itself to `APPROVED`/`RETURNED` — naming a specific
   transition **is** the vote). A `RETURNED` vote fires the return
   transition immediately, no threshold needed. An `APPROVED` vote
   checks `isApprovalThresholdMet()` (2.7) before advancing.

**Only `ASSIGNEE_POOL` (ACC-28) checks whether `actorId` is a member of
the resolved assignee/approver pool for this stage — every other
`triggerCondition` still does not.** For a `ROLE`-assigned `SINGLE`
stage using `ROLE_BASED`/`ANY_AUTHENTICATED`/`SPECIFIC_USER`/
`SYSTEM_AUTOMATIC`, any tenant-wide holder of the required role/
permission can still fire the transition — whether or not they were
the user actually assigned the resulting task. `ASSIGNEE_POOL` is
opt-in per transition, not a change to the other four conditions'
existing behavior.

### 2.5 `resolveAssigneeRaw()` — All 6 Strategies (`workflow.service.ts:720–776`)

Used for `CREATE_TASK`/`SEND_NOTIFICATION` targeting and the initial-
stage notification. The raw resolver itself is never called directly
by `triggerTransition()`'s gating — but as of ACC-40, `triggerTransition()`'s
`ASSIGNEE_POOL` check now goes through the same OOO-aware
`resolveAssignee()` wrapper (2.5.1) that these other callers already
used, closing what had been a real behavioral split between "who gets
the task" and "who is allowed to trigger the transition" (see 2.8).

| Strategy | Exact logic | Exact limitation |
|---|---|---|
| `SPECIFIC_USER` | Returns `[stage.assigneeUserId]` if set, else `[]`. | None — fully resolved, static. |
| `ROLE` | `userRole.findMany({ roleId: stage.assigneeRoleId, user: { organizationId, status: ACTIVE } })` → all active tenant-wide holders. For `SINGLE` approvalMode, returns only `userIds[0]` (arbitrary — whatever order Prisma returns, no deterministic "least loaded" or "primary" selection). | **Zero resource-instance awareness** — resolves to every holder of the role anywhere in the tenant, with no connection to which committee/document/CAPA triggered the instance. |
| `ROUND_ROBIN` | **Identical code path to `ROLE`** (same `switch` case, `case 'ROLE': case 'ROUND_ROBIN':`). | No round-robin logic exists at all — no assignment-history tracking, no rotation. Falls back to `ROLE`'s "first active holder" behavior. Documented in-code as a known limitation, not an oversight. |
| `ORG_UNIT_HEAD` | **Throws an `Error`** unconditionally: `"ORG_UNIT_HEAD assignee resolution requires an orgUnitId from the calling module — not yet supported."` | **Not implemented at all.** Any stage configured with this strategy will throw at resolution time, not silently return empty. |
| `SELF` | Finds the instance's first-ever `WorkflowInstanceStage` (`orderBy: enteredAt asc`) and returns its `actorId` — i.e. whoever started the instance. | Only meaningful for the literal instance-creator; cannot express "self" at any stage other than by reference to who opened the workflow. |
| `COMMITTEE` | `committeeMember.findMany({ committeeId: stage.committeeId, organizationId, isActive: true, ...(stage.assigneeCommitteeRoleValueId ? { roleValueId: stage.assigneeCommitteeRoleValueId } : {}) })` → every active member, org-scoped, **optionally narrowed to one `committee_member_role` (ACC-28)**. | `assigneeCommitteeRoleValueId` defaults to `null` — every stage seeded before ACC-28 keeps returning every active member indiscriminately (Chairman, Secretary, Member, Observer, Advisor), unchanged. Only stages a tenant admin explicitly configures with a role filter narrow further. |

All results pass through `applyOutOfOfficeRouting()` (2.5.1) before
being returned by the public `resolveAssignee()` wrapper.

**2.5.1 `applyOutOfOfficeRouting()`** — Absence Management Pattern 1.
For each resolved user: if currently out-of-office
(`outOfOfficeFrom <= now <= outOfOfficeTo`) **and** `actingUserId` is
set, substitutes the acting user (notifies both, audit-logs the
substitution). If out-of-office with **no** acting user set, keeps the
original user assigned (does not remove them) and notifies all
`TENANT_ADMIN`s of the coverage gap.

### 2.6 `resolveApproverPool()` — Threshold Sizing Only (`workflow.service.ts:861–883`)

Deliberately separate from `resolveAssigneeRaw()` (needs a *stage*
only, not a full instance — not meaningful for `SELF`). Only handles
two strategies:

- `COMMITTEE` → identical query (including the ACC-28
  `assigneeCommitteeRoleValueId` filter) to `resolveAssigneeRaw()`'s
  `COMMITTEE` case — literally duplicated, not shared code, so a
  PARALLEL-mode stage using the role filter sizes its threshold against
  the same narrowed pool it assigns to.
- `ROLE` → identical query to `resolveAssigneeRaw()`'s `ROLE` case
  (all active tenant-wide holders), no `SINGLE`-mode truncation (pool
  sizing needs the full set).
- **Any other `assigneeStrategy` on a multi-approver stage returns
  `[]`** — treated as a seed/config error, "no well-defined pool to
  size a threshold against."

**As of ACC-40, the resolved pool (whichever branch produced it) is
routed through `applyOutOfOfficeRouting()` (2.5.1) before being
returned** — previously this method returned the raw pool untouched,
so an out-of-office approver's acting user could neither cast their
delegated vote nor count toward the threshold denominator; see the new
Tier 2 tracker entry below. Called from `isApprovalThresholdMet()`
(2.7, only when `approvalMode !== 'COMMITTEE'`) and directly from
`submitApproval()`'s own eligibility gate (2.8) — both callers get the
fix from this one change.

### 2.7 Approval Mode / Threshold Logic — `isApprovalThresholdMet()` (`workflow.service.ts:401–435`)

- **`COMMITTEE` approvalMode** (distinct enum from `assigneeStrategy:
  COMMITTEE`, though both key off the same `stage.committeeId`): if no
  `committeeId` set, any single approval passes
  (`approvedCount > 0`). If set: requires
  `approvals.length >= committee.quorumCount` **and**
  `approvedCount > approvals.length / 2` — a real quorum + majority
  vote check, org-scoped (re-validates `committeeId` belongs to the
  caller's tenant, closing the ACC-17 cross-tenant gap).
- **`SEQUENTIAL`** — "has no dedicated ordered-roster mechanism in the
  current schema" (verbatim code comment) — **treated identically to
  `PARALLEL` + `ALL` threshold** until a real sequencing concept exists.
  There is no enforcement of approval *order* anywhere.
- **`PARALLEL`** (and `SEQUENTIAL`, per above) — pool size from
  `resolveApproverPool()`, or `Math.max(approvals.length, 1)` if the
  pool resolves empty. `ALL` → `approvedCount >= poolSize`. `ANY` →
  `approvedCount >= 1`. `MAJORITY` → `approvedCount > poolSize / 2`.

### 2.8 The Assignee-Resolution / Trigger-Gating Disconnect (Closed, ACC-28 + ACC-33 — residual gap tracked in Section 11)

**Assignee-resolution and trigger-gating were, until ACC-28, two fully
disconnected code paths.** `resolveAssigneeRaw()`/`resolveApproverPool()`
were called only for `CREATE_TASK`/`SEND_NOTIFICATION` targeting and
for sizing the approval-threshold denominator — never to check who was
*allowed* to trigger a transition or submit an approval.
`triggerTransition()`'s own gating (`requiredPermission`,
`triggerCondition`) never called either resolution method.

**ACC-28 closed this for `triggerTransition()`, opt-in per transition**
— the new `ASSIGNEE_POOL` `triggerCondition` value (2.4) has
`triggerTransition()` check `actorId` against `resolveAssignee()`'s
own result for the current stage (the OOO-aware wrapper as of ACC-40 —
see 2.4/2.5), reusing rather than duplicating the resolution logic.
This is **not** a change to the other four
`triggerCondition` values' behavior (`SPECIFIC_USER`/`ROLE_BASED`/
`ANY_AUTHENTICATED`/`SYSTEM_AUTOMATIC` still never consult assignee
resolution) — it's a fifth option a tenant admin configures per
transition, closing the gap only where explicitly turned on.

**A related, narrower gap ACC-28 also closed**: neither
`WorkflowStage`/`WorkflowTransition` write path
(`workflow-template.service.ts`'s `addStage`/`updateStage`/
`addTransition`/`updateTransition`) validates that a transition's
`requiredPermission` is actually reachable by anyone in its stage's
resolved assignee pool — a tenant admin can still save an
unreachable combination, and nothing detects it at save time. What
ACC-28 added instead is **runtime detection**, not config-time
validation: `WorkflowInstanceStage.isUnassigned`/`.unassignedAt`,
checked at stage-entry time and re-checked by `SlaMonitorProcessor`'s
sweep, flags exactly this condition for `ASSIGNEE_POOL` transitions and
notifies every `TENANT_ADMIN` — see the new 2.13 below. Scoped to
`ASSIGNEE_POOL` only; the same underlying risk for `ROLE_BASED`
(nobody holds the configured role) and `SPECIFIC_USER` (the named user
was deactivated) is tracked, not fixed, in Section 11.

**A second, adjacent gap found in the same investigation — since
CLOSED (ACC-33), verified directly against both files**
(`workflow.controller.ts:56–65`, `workflow.service.ts:315–346`):

```ts
// Same deliberate exception as triggerTransition() above.
@Post('instance-stages/:id/approvals')
submitApproval(
  @Param('id') id: string,
  @Body() dto: SubmitApprovalDto,
  @CurrentTenant() tenantId: string,
  @CurrentUser() actorId: string,
): Promise<IWorkflowApproval> {
  return this.workflowService.submitApproval(id, dto, tenantId, actorId);
}
```

Precisely: the controller class carries `@UseGuards(TenantGuard,
PermissionGuard)` at class level (line 16), which **does** apply to
this method — so authentication (`TenantGuard`) is genuinely required,
and tenant isolation is genuinely intact (the service's own
`workflowInstanceStage.findFirst({ where: { id: instanceStageId,
workflowInstance: { organizationId } } })` means a `WorkflowInstanceStage`
id from another tenant simply won't resolve). Still no `@Permissions()`
decorator on this method (confirmed — none present, deliberately: same
pattern as `triggerTransition()`'s own `ASSIGNEE_POOL` condition
above — a static permission string can't express "must be in this
stage's resolved pool," so `PermissionGuard` no-ops here by design, not
by oversight) and still no flat-permission check inside the service.
**What ACC-33 added**: `submitApproval()` now calls
`resolveApproverPool()` (2.6 — the OOO-aware wrapper as of ACC-40) and
rejects an actor who isn't in the resolved pool with
`ForbiddenException`, mirroring `triggerTransition()`'s `ASSIGNEE_POOL`
pattern (2.4). **Confirmed residual scope, unchanged by ACC-33**:
`resolveApproverPool()` only resolves a concrete pool for `COMMITTEE`/`ROLE`
`assigneeStrategy` — any other strategy on a multi-approver stage still
returns `[]`, and `submitApproval()`'s own gate treats an empty pool as
"nothing to check against" (`approverPool.length > 0 && ...`), so that
combination remains ungated. This is a pre-existing seed/config-error
case (2.6's own documented fallback), not a gap ACC-33 introduced or
was expected to close. See Section 11 for the still-open, structurally
different `ROLE_BASED`/`SPECIFIC_USER` `triggerCondition` gaps.

### 2.9 Transition Actions — `fireTransitionActions()` (`workflow.service.ts:485–550`)

Fires in `order` after a successful transition. Per `actionType`:

- **`WEBHOOK`** — enqueued to BullMQ (`workflow-actions` queue) and
  returns immediately; the `WorkflowActionLog` row is written later by
  a separate processor once the attempt resolves, not inline here.
- **`CREATE_TASK`** — resolves `toStage`'s assignees via
  `resolveAssignee()` (full array, not just the first — an explicitly
  fixed prior bug), maps `instance.objectType` → `TaskSourceType` via
  `mapObjectTypeToTaskSourceType()`, calls `TaskService.create()`.
  **Confirmed gap**: `COMMITTEE` has **no valid `TaskSourceType`
  mapping** — the function returns `null` for it, and
  `executeCreateTask()` skips task creation with a logged reason rather
  than writing an invalid enum value. This is real and currently live:
  confirmed in `workflow.seed.ts:261`, the seeded `COMMITTEE` workflow's
  `formation → terms_review` transition is configured with
  `actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }]`
  — **`CREATE_TASK` is the only non-`LOG_AUDIT` action on this
  transition**, so this gap fires in production today, silently
  skipping task creation every time that transition occurs, with
  nothing else to compensate.

  **Correction to a prior draft of this section**: `formation →
  terms_review` does **not** configure a `SEND_NOTIFICATION` action at
  all (verified against `workflow.seed.ts:261` directly — only
  `CREATE_TASK`/`LOG_AUDIT`) — there is nothing to trace on that
  specific transition beyond what's already stated. Checked instead
  whether `SEND_NOTIFICATION` genuinely works for `COMMITTEE` object
  type on a transition that *does* configure it —
  `terms_review → active` ("Approve Committee",
  `workflow.seed.ts:262`: `actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }]`,
  and in fact every other seeded `COMMITTEE` transition follows this
  same `SEND_NOTIFICATION` + `LOG_AUDIT` shape — `CREATE_TASK` is
  configured on exactly one `COMMITTEE` transition, `formation →
  terms_review`). Traced `executeSendNotification()`
  (`workflow.service.ts:624–648`) directly: unlike `executeCreateTask()`,
  it never calls `mapObjectTypeToTaskSourceType()` — it resolves
  assignees the same way, then calls `NotificationService.create()`
  passing `objectType: instance.objectType` straight through. Confirmed
  in `schema.prisma:892–903`: `Notification.objectType` is a plain
  `String?`, **not** a closed Prisma enum the way `Task.sourceType` is
  — so `'COMMITTEE'` (or any string) is accepted without constraint.
  Also confirmed `NotificationService.create()`'s own tenant-scoping
  check (`notification.service.ts:36–41`, the ACC-17 fix) passes
  cleanly, since `resolveAssignee()`'s `COMMITTEE` case already returns
  only org-scoped user ids. **Conclusion: `SEND_NOTIFICATION` genuinely
  works correctly for `COMMITTEE` object type today** — this action
  type has no equivalent to `CREATE_TASK`'s enum-mismatch gap, because
  it was never coupled to `TaskSourceType` in the first place.
- **`SEND_NOTIFICATION`** — resolves assignees the same way, calls
  `NotificationService.create()` once per assignee.
- **`GENERATE_PDF`** / **`LOCK_DOCUMENT`** — both fully stubbed
  (`responseSummary` literal strings noting deferral) — no Document
  model exists yet for either to act on.
- **`LOG_AUDIT`** — the only action type exempt from `isEnabled`
  checking; always fires regardless of configuration.
- Every non-webhook action writes its own `WorkflowActionLog` row
  inline, synchronously, with `status: SUCCESS` — there is no failure
  path recorded for non-webhook actions (only webhook retries produce
  `FAILED`/`RETRYING` status via the separate processor).

### 2.10 Validator Config — `checkValidatorConfig()` (`workflow.service.ts:674–697`)

Only **one** of the four validator conditions CLAUDE.md documents is
actually enforced: `minApprovals` (checked against the transition's own
`WorkflowApproval` rows). `requiredFields`, `minAttachments`, and "all
previous stage tasks completed" are **not enforced anywhere** — the
code comment states this plainly: they "need a caller-supplied object
snapshot that `TriggerTransitionDto` does not carry — left unenforced
until a functional module needs them."

### 2.11 Consumers

**Exactly one real caller of `startInstance()` exists in application
code today**: `CommitteesService.createCommittee()`
(`committees.service.ts:87`), starting a `COMMITTEE`-type instance.
Confirmed via grep — every other reference to `startInstance()` in the
codebase is inside `workflow.service.spec.ts`. No Document, Incident,
Audit, CAPA, or Meeting instance has ever been created through this
engine by real application code, because none of those modules are
built yet. `WorkflowController` (generic, object-type-agnostic) is
reused as-is by Committee Management for all lifecycle transitions —
confirmed there is no committee-specific transition wrapper endpoint
(`committees.controller.ts`'s own header comment states this
directly).

### 2.12 Frontend Consumption (Static Check)

`frontend/src/app/foundation/workflow/services/workflow.service.ts`
defines 5 methods, one per `WorkflowController` endpoint. Grepped for
actual component callers, not just the service definition:

| Method | Endpoint | Caller(s) found |
|---|---|---|
| `getInstance()` | `GET /workflows/instances/:id` | **ZERO frontend callers found** |
| `getInstancesByObject()` | `GET /workflows/instances` | `committee-detail.component.ts:372` |
| `triggerTransition()` | `POST /workflows/instances/:id/transitions` | `workflow-transition-actions.component.ts:92` (the generic, reusable component — see Section 10) |
| `submitApproval()` | `POST /workflows/instance-stages/:id/approvals` | **ZERO frontend callers found** |
| `cancelInstance()` | `POST /workflows/instances/:id/cancel` | **ZERO frontend callers found** |

**Directly relevant to 2.8's `submitApproval()` finding**: the Angular
service method exists (a thin HTTP wrapper — its mere existence is not
itself "a caller," it doesn't invoke anything on its own), but grepping
for `.submitApproval(` across every component in the frontend returns
**zero matches**. No UI component wires a user action to this
endpoint. **Conclusion**: `submitApproval()`'s missing-authorization
gap (2.8) has no live browser-reachable path in this application
today — it narrows the practical risk (nothing in the shipped UI can
trigger it), but does **not** close it: the endpoint is still directly
callable by any authenticated user via a raw HTTP request (curl,
Postman, browser devtools), since the backend itself enforces nothing
beyond authentication. This is a backend-only risk today, not a
currently browser-exploitable one through this app's own screens.

Also notable: `getInstance()` (singular, fetch-by-id) and
`cancelInstance()` are both fully wired backend-to-frontend-service but
have no UI trigger anywhere — `getInstancesByObject()` (plural) is what
`committee-detail` actually uses to show workflow history, and no
"Cancel" button exists anywhere in the built UI yet.

### 2.13 Unassigned-Stage Detection — `isUnassigned`/`unassignedAt` (ACC-28)

Operational-safety mechanism, not a correctness fix — added after a
direct investigation found no config-time validation and no runtime
detection existed anywhere for a stage whose resolved assignee pool
can never actually reach a required transition (2.8's `ASSIGNEE_POOL`
addition makes this materially more likely: a single vacant Chairman
seat is a normal, plausible real-world event, not a rare
misconfiguration).

- **`resolveUnassignedBlockingTransitions(stage, instance,
  organizationId)`** (public on `WorkflowService`) — for every outgoing
  `WorkflowTransition` from `stage` where `triggerCondition ===
  'ASSIGNEE_POOL'`: resolves the pool via `resolveAssignee()` (the
  OOO-aware wrapper as of ACC-40 — previously used the raw
  `resolveAssigneeRaw()`, which could misreport a stage as blocked when
  its sole holder was out-of-office with a valid acting user set; see
  the new Tier 2 tracker entry below); if the
  pool is empty, the transition is blocking **regardless of
  `requiredPermission`** (nobody can ever satisfy
  `pool.includes(actorId)`); if the pool is non-empty and
  `requiredPermission` is set, checks whether *any* resolved person's
  `RoleService.getUserPermissions()` includes it. Returns every
  blocking transition found (not just the first).
- **Entry-time check** — `checkAndFlagUnassignedStage()` (private),
  called once right after a new `WorkflowInstanceStage` row is created
  (`startInstance()` for the initial stage, `performTransition()` for
  every subsequent one). If any blocking transition is found: sets
  `isUnassigned: true, unassignedAt: now()` on that row and calls
  `notifyTenantAdminsOfUnassignedStage()`.
- **`notifyTenantAdminsOfUnassignedStage()`** (public) — mirrors
  `notifyTenantAdminsOfCoverageGap()`'s own query shape (`Role.findFirst
  TENANT_ADMIN` → `UserRole.findMany` → one `NotificationService.create()`
  per admin), not a new mechanism. Names the specific transition
  (`labelEn`) and instance (`objectType`/`objectId`, plus the
  Committee's own `nameEn` resolved via a join when `stage.committeeId`
  is set).
- **Drift-after-entry re-check** — `SlaMonitorProcessor.sweepUnassignedStages()`
  (private), added to the existing 15-minute repeatable job alongside
  `sweepOverdueTasks()`, not a new queue. For every open (`exitedAt:
  null`) `WorkflowInstanceStage`: re-runs
  `resolveUnassignedBlockingTransitions()`, compares the freshly
  computed result against `isUnassigned` **as read at the top of this
  sweep pass** (`wasUnassigned`), and only writes + notifies on an
  explicit `wasUnassigned === false && isNowUnassigned === true`
  transition — skips the write entirely when nothing changed. This is
  what prevents a duplicate notification when the sweep re-evaluates a
  stage the entry-time check already flagged minutes earlier, and keeps
  recovery (e.g. a new Chairman appointed) silent — the row updates,
  nobody is paged.
- **Deliberately synchronous** at entry-time, consistent with
  `resolveAssigneeRaw()` already running inline for `CREATE_TASK`/
  `SEND_NOTIFICATION` elsewhere in this same file — BullMQ is reserved
  for genuinely slow/external work (PDF, AI, email, virus scan, and
  `WEBHOOK` specifically for its unpredictable external latency), not a
  handful of small Prisma queries against a committee-sized member
  list. The periodic re-check is already async by construction, living
  inside the existing `SlaMonitorProcessor` job.
- **Scoped to `ASSIGNEE_POOL` only** — `ROLE_BASED`/`SPECIFIC_USER`
  transitions can go unreachable the same way (nobody holds the
  configured role; the named user was deactivated) with the same lack
  of detection, deliberately not covered here. See Section 11, Tier 1.
- **Zero frontend consumers today** (confirmed via grep — no match for
  `isUnassigned`/`unassignedAt` anywhere in `frontend/src/app`). Nothing
  in the UI surfaces a flagged stage beyond the `TENANT_ADMIN`
  notification itself; there is no dashboard/badge reading this field.

---

## 3. Task System

`backend/src/foundation/task/task.service.ts` +
`backend/src/foundation/workflow/sla-monitor.processor.ts` (escalation
firing — a structural quirk explained in 3.4).

### 3.1 Models

```prisma
model Task {
  id                   String         @id @default(cuid())
  organizationId       String
  title                String
  description          String?
  sourceType           TaskSourceType
  sourceId             String
  sourceStageId        String?
  workflowInstanceId   String?
  meetingId            String?
  createdById          String
  status               TaskStatus     @default(PENDING)
  priority             TaskPriority   @default(MEDIUM)
  dueAt                DateTime?
  dueDateOverridden    Boolean        @default(false)
  slaBreachedAt        DateTime?
  completedAt          DateTime?
  completedById        String?
  escalationUserId     String?
  escalationAfterHours Int?
  escalatedAt          DateTime?
}

model TaskAssignee {
  id           String    @id @default(cuid())
  taskId       String
  userId       String
  assignedAt   DateTime  @default(now())
  assignedById String
  removedAt    DateTime?   // stamped, never deleted — permanent record of who was ever assigned

  @@unique([taskId, userId])
}

model TaskEvidence {
  id             String              @id @default(cuid())
  organizationId String
  taskId         String
  type           TaskEvidenceType    // TEXT | ATTACHMENT | LINK | INTERNAL_REFERENCE
  content        String?
  s3Key, fileName, fileSize, mimeType   // ATTACHMENT fields
  url, linkTitle                        // LINK fields
  refType        TaskEvidenceRefType?   // INTERNAL_REFERENCE fields — DOCUMENT, AUDIT,
  refId          String?                // INCIDENT, CAPA, MEETING, STANDARD,
  refDisplay     String?                // CORRECTIVE_ACTION, GAP
}
```

`TaskStatus`: `PENDING, IN_PROGRESS, COMPLETED, OVERDUE, CANCELLED,
DELEGATED, UNASSIGNED`. `TaskSourceType` (closed, 10 values):
`MEETING, DOCUMENT, AUDIT, CAPA, INCIDENT, CORRECTIVE_ACTION, STANDARD,
KPI, GAP, QUALITY_IMPROVEMENT_PLAN` — **note this list does not include
`COMMITTEE`**, the exact enum gap already documented in Section 2.9.

### 3.2 `TaskService` Methods — Exact Behavior

- **`create()`** — computes `dueAt` via `computeSlaDueAt()` (3.3) unless
  an explicit `dueDate` is given (`dueDateOverridden: true` in that
  case). Filters assignees through `filterActiveUsers()` — **status
  only** (`User.status === 'ACTIVE'`), see 3.5 for what this does and
  does not exclude. Zero eligible assignees → `status: UNASSIGNED` and
  every `TENANT_ADMIN` notified, not a rejected request. If
  `escalationUserId` is given, validates it via
  `OrgPositionService.validateEscalationTarget()` (3.4) **before**
  creating the task — an invalid escalation target rejects task
  creation outright.
- **`getMyTasks()`** — every task where the caller has an active
  (`removedAt: null`) `TaskAssignee` row. This is the literal backing
  query for a "My Tasks" view — see Section 11 for the still-missing
  Dashboard/Home page that would surface it.
- **`getForSource()`** — the module task-list query CLAUDE.md refers to
  ("tasks filtered by sourceType + sourceId").
- **`complete()`** — ANY-assignee-completes semantics: the first active
  assignee to call this stamps `removedAt` on every *other* active
  `TaskAssignee` row for the same task (not deleted — a permanent
  record of who was ever assigned) and sets the task `COMPLETED`.
  Rejects (404, not 403) if the caller isn't a currently-active assignee.
- **`reassign()`** — Pattern 2 (Manual Reassignment). Removes every
  current active assignee (`removedAt` stamped), creates new
  `TaskAssignee` rows for `dto.newAssigneeUserIds` (filtered through
  `filterActiveUsers()` again), notifies each new assignee with the
  given reason. Zero eligible new assignees → `UNASSIGNED`, same as
  `create()`.
- **`reassignAllForUser()`** — the bulk version, called from exactly one
  place: `UserService.deactivate()` (`user.service.ts:244`, the
  departure flow) — confirmed via grep, no other caller exists. For
  every task the departing user is still an active assignee on: if a
  valid `toUserId` (their `actingUserId`, resolved and re-validated by
  the caller) is given, reassigns to them; otherwise, if no other active
  assignee remains on that task, flags it `UNASSIGNED`. Every change
  audit-logged individually with `metadata: { event: 'departure_reassignment' }`.
- **`addEvidence()`** — `INTERNAL_REFERENCE` evidence sets
  `refDisplay: dto.refId` verbatim (the raw id, not a resolved display
  name) — code comment states plainly: *"no functional module exists
  yet to resolve a real display name from."* A real limitation, not
  cosmetic — the evidence list would show a raw cuid instead of e.g. a
  document title, until a functional module exists to resolve it.

### 3.3 SLA Computation

`computeSlaDueAt()` — reads `Organization.settings.taskSla` (tenant
override) per `priority`, falling back to platform defaults
(`CRITICAL: 4h, HIGH: 16h, MEDIUM: 40h, LOW: 80h`), then calls
`WorkingCalendarService.calculateDeadline()` — never its own date math,
consistent with CLAUDE.md's rule.

### 3.4 Escalation — `OrgPositionService.validateEscalationTarget()`

Called from **two** distinct points, not one:

1. **At task creation** (`TaskService.create()`) — validates an
   explicitly-supplied `escalationUserId` up front; an invalid target
   blocks task creation.
2. **At SLA-breach-escalation-fire time**
   (`SlaMonitorProcessor.fireTaskEscalation()`, 3.4.1 below) — re-
   validates the *same* target again, right before actually escalating.
   This is a genuine double-check, not redundant: an escalation target
   valid at task-creation time could become invalid later (grade
   change, org-unit reassignment, deactivation) before the SLA
   actually breaches — the second check catches that. If it fails at
   fire-time, escalation is skipped (not silently — an audit log entry
   with `escalationSkipped: true` and the failure reason is written),
   the task is not escalated to an invalid target.

**Exact logic** (`org-position.service.ts:154–194`): loads every
assignee's `User.position` (nullable), takes
`maxAssigneeGrade = Math.max(0, ...assignees.map(a => a.position?.grade ?? 0))`
(an assignee with no position counts as grade 0 — least restrictive).
Loads the target's own position; **rejects if `targetGrade < maxAssigneeGrade`**
(target must be equal-or-senior). Then `isInSameOrParentOrgUnit()`
walks `OrgUnit.parentId` upward from **each** assignee's
`primaryOrgUnitId`, checking whether the target's own
`primaryOrgUnitId` equals any of them or their ancestors — **rejects
if the target has no `primaryOrgUnitId` at all**, even if the grade
check passed. If no assignee has an org unit, this half of the check
passes unconditionally (nothing to violate).

### 3.4.1 SLA Monitor / Escalation Firing (`sla-monitor.processor.ts`)

**Structural note worth stating plainly**: this file lives in
`backend/src/foundation/workflow/`, not `backend/src/foundation/task/`,
even though roughly half its job (`sweepOverdueTasks()`,
`fireTaskEscalation()`) is Task-specific. This is deliberate, per its
own code comment — it reuses the existing 15-minute repeatable
`sla-monitor` BullMQ job (originally built for `WorkflowInstanceStage`
SLA breaches) rather than registering a second queue, matching
CLAUDE.md's Background Jobs list having exactly one SLA-sweep entry,
not one per entity type. A reader looking for Task escalation logic
inside `foundation/task/` will not find it there.

`sweepOverdueTasks()` runs every 15 minutes (same job as
`WorkflowInstanceStage` SLA checks, see Section 2): finds every `Task`
past `dueAt` not already `COMPLETED`/`CANCELLED`/`OVERDUE`/`UNASSIGNED`,
flips it to `OVERDUE` + stamps `slaBreachedAt`. If the task has both
`escalationUserId` and `escalationAfterHours` set, has **not** already
been escalated (`escalatedAt` null), and enough hours have passed since
`dueAt`, calls `fireTaskEscalation()` — but only if
`isWithinWorkingHours()` for the tenant's own calendar (CLAUDE.md:
"Escalation triggers only fire during working hours" — genuinely
enforced, not aspirational; re-implemented inline since no dedicated
"is now within working hours" method exists on
`WorkingCalendarService`, only `calculateDeadline()`'s internal logic,
which this duplicates rather than shares).

### 3.5 Out-of-Office Routing — A Real Limitation

**`TaskService.create()` does not apply out-of-office substitution at
all.** Confirmed by reading the full method: `filterActiveUsers()`
filters strictly on `User.status === 'ACTIVE'` (excludes
suspended/invited users) and never references `outOfOfficeFrom`,
`outOfOfficeTo`, or `actingUserId`. Out-of-office routing (Absence
Management Pattern 1) is implemented exactly once in the codebase —
`WorkflowService.applyOutOfOfficeRouting()` (Section 2.5.1) — which
runs **before** `WorkflowService.executeCreateTask()` calls
`TaskService.create()`, substituting acting users into the assignee
list upstream. **Net effect**: a task created via the workflow engine's
`CREATE_TASK` action gets correct out-of-office substitution. A task
created directly through `POST /tasks` (any user holding `tasks:create`,
manually) does **not** — if it's assigned to a user currently
out-of-office, no substitution happens, and no coverage-gap
notification fires either (that notification path,
`notifyTenantAdminsOfCoverageGap()`, also lives only inside
`WorkflowService`, not `TaskService`).

### 3.6 Permission Model

```
tasks:view       — TaskController: getMyTasks, getForSource, getById
tasks:create     — TaskController: create
tasks:complete   — TaskController: complete, addEvidence (both — evidence
                   upload is gated as a completion-adjacent action, not separately)
tasks:reassign   — TaskController: reassign
tasks:manage     — TaskController: getUnassigned (ACC-34) — its first
                   `@Permissions()` consumer. Previously seeded into
                   role permission sets (role.seed.ts) but not checked
                   anywhere, a currently-inert permission string; no
                   longer inert as of ACC-34.
```

### 3.7 Frontend Consumption (Static Check)

`frontend/src/app/foundation/tasks/services/task.service.ts` — 8
methods, one per `TaskController` endpoint:

| Method | Endpoint | Caller(s) found |
|---|---|---|
| `getMyTasks()` | `GET /tasks/my-tasks` | `my-tasks.component.ts:144` |
| `getForSource()` | `GET /tasks` | `task-list.component.ts:104` |
| `getUnassigned()` | `GET /tasks/unassigned` | `unassigned-tasks.component.ts` (ACC-34) |
| `getById()` | `GET /tasks/:id` | **ZERO frontend callers found** |
| `create()` | `POST /tasks` | `task-form.component.ts:124` (rendered from `task-list.component.ts`, confirmed referenced there) |
| `complete()` | `POST /tasks/:id/complete` | `my-tasks.component.ts:134` |
| `reassign()` | `POST /tasks/:id/reassign` | `unassigned-tasks.component.ts` (ACC-34) — was zero frontend callers, closed by this ticket |
| `addEvidence()` | `POST /tasks/:id/evidence` | **ZERO frontend callers found** |

**Two remaining gaps, static-check-confirmed**: there is no task-detail
view anywhere in the frontend (`getById()` unused) — "My Tasks", the
per-source task list, and the new Unassigned Tasks view all render list
rows only, nothing navigates to a single task. There is no
evidence-upload UI (`addEvidence()` unused) — `complete()` can be
called with zero evidence ever attached, even though `TaskEvidence`'s
schema (3.1) is fully built out for it. These are exactly the class of
finding the separately-queued live-audit exists to catch systematically
— flagged here as a cheap static signal, not a substitute for it.
`reassign()` was the third gap in this list until ACC-34's Unassigned
Tasks view gave it a real caller — Absence Management Pattern 2 now has
an operator-facing screen for Tasks, at least for the unassigned case
(a reassignment UI reachable from an assigned task's own detail view
still doesn't exist, since `getById()` still has zero callers).

---

## 4. Notification System

`backend/src/foundation/notification/notification.service.ts` +
`notification-email.processor.ts`.

### 4.1 Model

```prisma
model Notification {
  id             String              @id @default(cuid())
  organizationId String
  userId         String
  titleEn        String
  titleAr        String?
  bodyEn         String
  bodyAr         String?
  channel        NotificationChannel @default(IN_APP)   // IN_APP | EMAIL | BOTH | SMS
  status         NotificationStatus  @default(UNREAD)    // UNREAD | READ | DISMISSED
  objectType     String?             // plain string, NOT a Prisma enum — see 2.9
  objectId       String?
  sentAt         DateTime?
  readAt         DateTime?
}
```

### 4.2 `NotificationService` Methods

- **`create()`** — re-validates `dto.userId` belongs to `organizationId`
  before writing (**the ACC-17 fix**: code comment states this exists
  specifically because one call site —
  `WorkflowService`'s `SEND_NOTIFICATION` action resolving a
  `SPECIFIC_USER`-strategy stage's `assigneeUserId` — passes it
  unscoped, with no tenant check of its own; fixing it here protects
  every current *and future* caller at the layer boundary, rather than
  re-auditing each caller individually). If `channel` is `EMAIL` or
  `BOTH`, enqueues an `email-delivery` BullMQ job — **`SMS` is not**
  (see 4.4).
- **`getForUser()`** — the personal inbox query, always scoped to the
  *calling* user (`userId` parameter comes from `@CurrentUser()`, never
  a route param) — code comment states this explicitly: "regardless of
  any permission the caller holds," there is no permission that lets
  one user read another's notifications.
- **`getUnreadCount()`** — same self-scoping, count only.
- **`markRead()`** — **ownership check, not just tenant scope**: the
  `findFirst` filters on `{ id, userId, organizationId }` together — a
  notification belonging to a *different user in the same organization*
  is rejected exactly like a cross-tenant one (404, not silently
  no-op'd).
- **`markAllRead()`** — bulk `updateMany`, writes **one summary audit
  log entry** for the whole action (`metadata: { bulkMarkAllRead: true, count }`),
  not one per row — a deliberate exception to the usual per-row audit
  pattern, to avoid log bloat from a single click.

### 4.3 Controller — Deliberate Design, Not an Oversight

`@Controller('notifications') @UseGuards(TenantGuard)` — **no
`PermissionGuard`, no `@Permissions()` anywhere in the file.** Code
comment states the reasoning directly: a user's own notification inbox
"is not permission-gated content, it is intrinsically self-scoped."
`TenantGuard` alone still authenticates. **There is also deliberately
no `POST /notifications` endpoint** — notifications are always
system/workflow-generated (via direct `NotificationService.create()`
calls from other services), never user-authored; no controller route
exists to create one via the API at all.

### 4.4 Delivery Mechanics — What's Real vs. Aspirational

- **`IN_APP`** — a `Notification` row plus nothing else. **No
  WebSocket gateway exists anywhere in this codebase** — confirmed via
  grep across `backend/src` for `WebSocketGateway`/`@nestjs/websockets`/
  `socket.io`: zero matches. CLAUDE.md's "Real-time: NestJS WebSocket
  gateway (Socket.io)" and "Channels: in-app (WebSocket)" describe
  intent, not current implementation. Actual in-app delivery is plain
  HTTP polling: the frontend's `notification-bell.component.ts` polls
  `GET /notifications/unread-count` every 30 seconds via RxJS
  `interval(30000)` (confirmed, `POLL_INTERVAL_MS = 30000`) — matches
  module-designs.md's own note ("Bell component polls every 30s"), not
  CLAUDE.md's WebSocket claim.
- **`EMAIL`** — `NotificationEmailProcessor` (BullMQ `email-delivery`
  queue), the first real call to the `resend` package in the codebase
  (present in `package.json` since scaffold, unused until this).
  Selects Arabic subject/body if `user.language === 'ar'` **and** a
  bodyAr exists, else falls back to English. **Retry confirmed exactly
  as CLAUDE.md states**: `queue.module.ts` configures `attempts: 3,
  backoff: { type: 'exponential', delay: 5000 }` for this queue.
  Resend's SDK does not throw on an API-level failure (resolves
  `{ data: null, error }` instead) — the processor explicitly re-throws
  on `result.error`, which is what makes BullMQ's retry actually engage;
  without it, a failed send would silently register as a completed job.
  `Notification.sentAt` is stamped **only** on confirmed success — a
  null `sentAt` on an `EMAIL`/`BOTH` row whose job should have finished
  is the failure indicator (there is no separate execution-log table
  for email, unlike `WorkflowActionLog` for workflow actions).
- **`SMS`** — accepted as a valid DTO value
  (`create-notification.dto.ts`'s `NOTIFICATION_CHANNELS`), but
  **`create()`'s delivery branch only checks for `EMAIL`/`BOTH`** — a
  notification created with `channel: 'SMS'` would write a DB row and
  enqueue nothing, delivered via no channel at all except still
  appearing in the in-app inbox list (list/count queries don't filter
  by channel). Confirmed via grep that no caller in the codebase
  actually sets `channel: 'SMS'` today — a real but currently-dormant
  gap, matching CLAUDE.md's own "future: SMS, Teams, WhatsApp" framing
  for the *provider*, but the *channel value* is already live in the
  schema and DTO ahead of any provider existing.
- **Teams / WhatsApp** — not represented anywhere; `NotificationChannel`
  has no value for either.
- **Digest mode** — CLAUDE.md states "Digest mode available per
  notification type (user preference)." Grepped the entire
  `foundation/notification` directory and the wider backend for
  "digest": **zero matches** in any notification-relevant file. Not
  implemented at all — purely aspirational documentation today.

### 4.5 Consumers

`NotificationService.create()` is called from three services:

- **`WorkflowService`** — three call sites: `executeSendNotification()`
  (the `SEND_NOTIFICATION` transition action, Section 2.9),
  `resolveAndNotifyInitialAssignee()` (on `startInstance()`), and
  indirectly via `applyOutOfOfficeRouting()`'s coverage-gap /
  substitution notices (Section 2.5.1).
- **`TaskService`** — new-assignment notices (`create()`),
  unassigned-task alerts to every `TENANT_ADMIN`
  (`notifyTenantAdmins()`), reassignment notices (`reassign()`), and
  the departure-flow bulk-reassignment notice
  (`reassignAllForUser()`).
- **`SlaMonitorProcessor`** — `fireEscalation()` (`WorkflowInstanceStage`
  breaches) and `fireTaskEscalation()` (`Task` breaches), both in
  `foundation/workflow/sla-monitor.processor.ts` (Section 3.4.1).

No functional module (Documents/Standards/Incidents/CAPA/Gap/Audit/KPI)
calls it yet — none of those modules exist.

### 4.6 Frontend Consumption (Static Check)

`frontend/src/app/foundation/notification/services/notification.service.ts`
— 4 methods, all confirmed called, all from the same single component,
`notification-bell.component.ts`:

| Method | Endpoint | Caller |
|---|---|---|
| `list()` | `GET /notifications` | `notification-bell.component.ts:144` |
| `getUnreadCount()` | `GET /notifications/unread-count` | `notification-bell.component.ts:97` (the 30s poll) |
| `markRead()` | `PATCH /notifications/:id/read` | `notification-bell.component.ts:124` |
| `markAllRead()` | `POST /notifications/mark-all-read` | `notification-bell.component.ts:133` |

No dead endpoints. The entire Notification frontend surface is one
component — consistent with there being no dedicated "Notifications"
page/route anywhere in the app (only the topbar bell dropdown), which
is itself relevant to the still-missing Dashboard/Home page tracked in
Section 11.

---

## 5. OrgPosition, Unit Head, and Delegated Authority (ACC-40)

`backend/src/foundation/org-position/org-position.service.ts` (position
catalog) + `backend/src/foundation/organization/org-unit-head.service.ts`
(Head-management actions) + `backend/src/foundation/organization/organization.service.ts`
(derivation/vacancy — same module as ordinary `OrgUnit` CRUD).
**Rewritten in full for ACC-40** — the entire previous per-org-unit,
grade-cloned `OrgPosition` design (documented in this section before
ACC-40) is gone, replaced end to end. Full design rationale:
`backend/Plans/step-40-org-position-unit-head.md`. CLAUDE.md's note that
`OrgPosition` is **not** the same concept as `OrgUnit.type` (department
structure) still holds — `OrgPosition` describes a user's seniority and
authority, not a department.

### 5.1 Models

```prisma
model OrgPosition {
  id                 String   @id @default(cuid())
  organizationId     String
  nameEn             String
  nameAr             String?
  grade              Int
  isSingleAssignee   Boolean  @default(false)
  isUnitHeadPosition Boolean  @default(false)
  roleId             String?
  isActive           Boolean  @default(true)

  role       Role?              @relation(fields: [roleId], references: [id])
  users      User[]             // back-relation — User.positionId
  headEvents OrgUnitHeadEvent[]

  @@unique([organizationId, nameEn])
}
```

Org-wide catalog now — **no more `orgUnitId`**. A position title like
"Department Manager" is one catalog entry per tenant, not a per-unit
clone. `isSingleAssignee`/`isUnitHeadPosition` express what used to be
implied by per-unit scoping: whether more than one person may hold it
*within a given unit* at once, and whether holding it confers Head
authority. `isUnitHeadPosition: true` always implies
`isSingleAssignee: true` — enforced server-side
(`org-position.service.ts:233` `validateHeadFlagPairing()`), not
trusted to the frontend alone. `roleId` (nullable) is the position-to-
role mapping (5.9) — validated to reject `PLATFORM_ADMIN`/
`TENANT_ADMIN` (`org-position.service.ts:247`).

```prisma
model OrgUnit {
  // ...existing fields (Section 7) unchanged, plus:
  pendingHeadUserId                 String?    // open-handover cache (5.4)
  headHandoverEffectiveDate         DateTime?
  isHeadVacant                      Boolean   @default(false)  // vacancy cache (5.5)
  headVacantSince                   DateTime?
  isHeadFullyUnresolved             Boolean   @default(false)  // escalation-exhausted cache (5.5)
  headFullyUnresolvedLastRemindedAt DateTime?
  actingHeadUserId                  String?    // Acting Head (5.6) — independent of position-holding
}
```

**No `headUserId` field exists, deliberately** — "who is the Head" is
never stored; it's derived live from a query every time it's needed
(5.3). These six fields are all caches/logs of derivable state, not
sources of truth, kept in sync by `refreshOrgUnitHeadVacancy()` (5.5)
and the Head-management methods (5.4/5.6) — a bug in any of them can
make the cache wrong, but can never corrupt the underlying position-
holding facts that `resolveActingHeadForOrgUnit()` (5.3) re-derives
from scratch.

```prisma
model OrgUnitHeadEvent {
  id             String            @id @default(cuid())
  organizationId String
  orgUnitId      String
  userId         String
  positionId     String?           // null only for ACTING_* actions
  action         OrgUnitHeadAction
  effectiveDate  DateTime
  reason         String?
  approvedBy     String?
  createdAt      DateTime          @default(now())
}

enum OrgUnitHeadAction {
  ASSIGNED             // direct appointment, no handover
  HANDOVER_DECLARED    // incoming successor granted the same position; outgoing unchanged
  HANDOVER_COMPLETED   // outgoing holder's position cleared
  HANDOVER_CANCELLED   // incoming successor's grant reverted
  VACATED              // cleared, no successor declared
  ACTING_ASSIGNED      // does not touch position-holding
  ACTING_ENDED         // does not touch position-holding
}
```

Append-only ledger, modeled directly after `CommitteeMembershipEvent`
(Section — Committee Management) — same "who held this authority, when,
why" shape, same precedent reused rather than inventing a new one.

`User` additions: `actingOrgUnitId String?` + `actingOrgUnitUntil
DateTime?` (5.7 — user-level "acting for a unit," independent of Head
authority entirely). `UserRole` addition:
`grantedViaHeadPositionOrgUnitId String?` (alongside the pre-existing
`grantedViaHeadPositionId`) — the marker pair `RoleService` uses to
know a grant came from this mechanism and is therefore safe to
auto-revoke (5.9).

`User.positionId`/`User.primaryOrgUnitId` are unchanged in shape (both
still single, nullable relations) but are now **mandatory for every
newly-invited active user** (5.4) — `primaryOrgUnitId` conditionally,
only once the tenant has at least one active `OrgUnit`.

### 5.2 Position Catalog Service Methods (`OrgPositionService`)

- **`seedDefaultPositions()`** — upserts the 10 default positions for
  one tenant, called from `TenantService.bootstrap()`. Idempotent via
  `findFirst` + conditional `create`, same Prisma compound-unique
  generated-type workaround as before ACC-40.
- **`listPositions()`** (`:41`) — every position for the tenant, no
  `orgUnitId` parameter anymore (there is nothing left to scope by).
- **`createPosition()`/`updatePosition()`** (`:56`/`:90`) — validate
  the `isUnitHeadPosition` ⇒ `isSingleAssignee` pairing against the
  **resulting** state (existing row merged with the partial dto, not
  just whichever field this call happens to touch), and validate
  `roleId` when present (exists in tenant, not
  `PLATFORM_ADMIN`/`TENANT_ADMIN`).
- **`deactivatePosition()`** (`:128`) — idempotent soft-deactivate.
  Deactivating a position never clears its holders' own `positionId`
  (holders keep the FK), so this method now walks every *active*
  holder's `primaryOrgUnitId` and calls `refreshOrgUnitHeadVacancy()`
  for each — a position going inactive can silently make a unit's Head
  vacant, and this is the only place that gets recomputed.
- **`reactivatePosition()`** (`:167`) — **new in ACC-40, closes the
  Tier 2 gap this section previously documented** (deactivate-with-no-
  reactivate asymmetry vs. `Role`). Mirrors `RoleService.reactivateRole()`
  exactly.

### 5.3 "Who Is This Unit's Head" — Derived, Never Stored

`OrganizationService.resolveActingHeadForOrgUnit(orgUnitId, organizationId)`
(`organization.service.ts:74`) is the one real derivation query,
despite its name being written for its role as `ORG_UNIT_HEAD`'s
workflow-assignee resolver (5.8) — it answers "who currently has Head
authority here" generally, not just for workflow purposes:

1. At the given unit: find every `ACTIVE` user with
   `primaryOrgUnitId` = this unit and `position.isUnitHeadPosition: true`
   AND `position.isActive: true` (the `isActive` filter is a deliberate
   extension beyond the plan's own illustrative code — without it, a
   deactivated position's existing holder would count as "the Head"
   forever, since deactivation never clears `positionId`). Sized 1 in
   the normal case, 2 during an open handover (both outgoing and
   incoming genuinely hold the position at that moment — 5.4 — no
   special-casing needed, the query just returns what's true).
2. If empty, check this unit's own `actingHeadUserId` (5.6) — return it
   if set.
3. If still empty, walk to `parentId` and repeat from step 1 — this is
   the hierarchy escalation the plan's Pending Discussion #3 resolved
   as "escalation fully substitutes," not "vacant unit's actions get
   blocked."
4. Exhausted (`root.parentId` is `null` and step 1/2 both came up
   empty at every level) → `[]`, "fully unresolved."

No caching inside this method — every call re-walks from scratch.
`isHeadVacant`/`isHeadFullyUnresolved` (5.5) are a separate,
write-time-maintained cache of this query's outcome for cheap reads —
never a substitute for calling it when a real, current answer is
needed (every real consumer — Head-management methods, the workflow
engine's `ORG_UNIT_HEAD` cases, the delegation stamp — calls the live
query, never the cache).

### 5.4 Deliberate Handover (`OrgUnitHeadService`, `org-unit-head.service.ts`)

A handover is **not** a change to a separately-stored "who is Head"
fact — it is a declared, temporary, logged exception that grants the
incoming successor the same `isUnitHeadPosition` position the outgoing
holder already holds, before the outgoing holder's own holding ends.
During the open window, 5.3's derivation query genuinely returns both
users — this **is** the "declared dual-holder transition period," with
no special-casing anywhere else in the system.

- **`declareHandover()`** (`:81`) — validates: a Head currently exists
  to hand over from (else use direct assignment); the incoming
  successor is active, different from the outgoing holder, does not
  already hold a *different* head-conferring position (would silently
  orphan that other unit's audit trail otherwise), and already belongs
  to this unit (`primaryOrgUnitId` match — never silently moved as a
  side effect). Grants the incoming successor the same `positionId` via
  `UserService.validatePositionAssignment(..., isDeclaredHandoverBypass: true)`
  (`user.service.ts:390`) — the **only** call site in the codebase that
  ever passes `isDeclaredHandoverBypass: true`, deliberately violating
  both the single-assignee cap and the cross-position Head-uniqueness
  check, only for this one pair, only through this one path. Writes
  `HANDOVER_DECLARED`, refreshes vacancy, and — since the incoming
  successor genuinely holds the position from this moment — fires the
  role grant (5.9) immediately, not at completion.
- **`completeHandoverNow()`** (`:205`, explicit) and
  **`completeHandoverAutomatically()`** (`:288`, called by
  `SlaMonitorProcessor`'s `sweepDueHandovers()` for every open handover
  past its declared `effectiveDate`) both call the same private
  **`performHandoverCompletion()`** (`:299`): clears the outgoing
  holder's `positionId`, writes `HANDOVER_COMPLETED`, refreshes
  vacancy, revokes the outgoing holder's role grant. No behavioral
  difference between explicit-early and automatic beyond who (or
  what — `actorId: null` for the sweep) triggered it.
- **`cancelHandover()`** (`:219`) — reverts the incoming successor's
  grant only; the outgoing holder is unaffected. No stored history of
  what the incoming successor held before (schema deliberately carries
  none) — reverts to `null`, not a resurrected prior value.
- **`vacateHead()`** (`:465`) — **a deliberate divergence from
  `RoleService`'s last-`TENANT_ADMIN` lockout-protection precedent**: a
  Unit Head is NOT unconditionally protected — a unit can legitimately
  sit headless. Clearing writes `VACATED` and lets 5.5's escalation
  mechanism be the real safety net, not a hard block on the removal
  itself.

### 5.5 Vacancy Detection and Hierarchy Escalation

`OrganizationService.refreshOrgUnitHeadVacancy()` (`:117`) — the
entry-time check, called from every Head-management method above, from
`OrgPositionService.deactivatePosition()`, and from
`UserService.updateProfile()`/`deactivate()` whenever they touch a
user's `positionId`/`primaryOrgUnitId`. Re-runs the direct-holder count;
on a genuine `false→true` vacancy transition, runs 5.3's escalation
walk exactly once and sets `isHeadVacant`/`headVacantSince`/
`isHeadFullyUnresolved`. Only a **fully-exhausted** result (escalation
found nobody at any ancestor level either) notifies Tenant Admins
(`notifyTenantAdminsOfOrgUnitVacancy()`, `:179` — same
`Role.findFirst(TENANT_ADMIN)` → `UserRole.findMany()` →
`NotificationService.create()` chain as every other admin-notification
method in this codebase) — a partial vacancy covered by an ancestor's
Acting Head is silent, matching the plan's "partial vacancy never
blocks or notifies" resolution.

`SlaMonitorProcessor.sweepOrgUnitVacancies()`
(`sla-monitor.processor.ts:146`) is the drift-after-entry re-check —
same architectural role as `sweepUnassignedStages()` (Section 2.13),
one level deeper: `isHeadVacant` alone can't answer "is this STILL
fully-unresolved" (it captures only this unit's own direct-holder
count, not whether an ancestor's Acting Head now covers it), so
`isHeadFullyUnresolved` is checked separately and can flip
independently of `isHeadVacant`. Sends a reminder notification every 2
days (`headFullyUnresolvedLastRemindedAt`) while still fully
unresolved, silently clears both flags on recovery. Same processor's
`sweepDueHandovers()` (`:127`) fires 5.4's automatic handover
completion; `sweepExpiredActingOrgUnitAssignments()` (`:215`) clears
5.7's user-level acting-for-a-unit assignment on expiry (a pure scoping
fact with no follow-on vacancy/role effects, unlike everything else in
this section). All three run alongside the pre-existing SLA sweep, no
new BullMQ queue.

### 5.6 Acting Head — Coverage, Not Position-Holding

`assignActingHead()`/`clearActingHead()` (`org-unit-head.service.ts:525`/`:651`)
cover Head-of-unit **authority** during an absence or unresolved
vacancy — never a position grant (no `positionId` written anywhere in
either method, unlike `assignHead()`). Only assignable when the unit
genuinely has no real position-holder and no handover is in progress —
a real Head must always be assigned via `assignHead()`, never shadowed
by Acting Head coverage sitting alongside a real holder.

`AssignActingHeadDto.coveringForUserId` (optional) — when supplied,
`resolveCoveringPositionId()` (`:623`) resolves which head-conferring
position the acting user is covering for, checking in order: (a) the
named predecessor's own *current* `positionId`, if still an
`isUnitHeadPosition` position scoped to this unit (the absence case —
still nominally held, just personally away); (b) else, their most
recent `OrgUnitHeadEvent` for this unit that recorded a real
`positionId` (almost always `VACATED` — the departure case). The FINAL
grant decision (`isUnitHeadPosition`/`roleId`) is always re-checked
fresh against whichever id resolved — positions are mutable, a stale
historical id is never trusted blind. `coveringForUserId` omitted
entirely (pure vacancy, nobody's ever held the position) → Acting Head
grants workflow-eligibility only (via 5.3's derivation query), no role
grant — nothing identifies which role would even be relevant.

**Confirmed gap, found during this Phase 10 documentation pass, not
previously written down anywhere**: `assignActingHead()`/
`clearActingHead()` are real, correctly-implemented, and fully unit-
tested (`org-unit-head.service.spec.ts`) — including their role-grant/
revoke side effects — but have **zero HTTP surface**.
`OrgUnitHeadController` (`org-unit-head.controller.ts`) exposes
`getHeadStatus`/`assignHead`/`vacateHead`/`declareHandover`/
`completeHandoverNow`/`cancelHandover` only; no
`POST .../acting-head` or `.../acting-head/clear` route exists anywhere
in the codebase (confirmed via grep across every `@Controller` in
`organization/` and `org-position/`). The frontend
`OrgUnitHeadPanelComponent` matches this exactly — full assign/vacate/
handover UI, and a comment noting `actingHeadUserId` "stay[s] inert
until Phase 6/7" that is now stale (Phase 6/7 are done; the backend
resolvers are real) but was never followed up with actual Acting Head
UI. **The only way to reach `assignActingHead()`/`clearActingHead()`
today is a direct service call (e.g. from a test, or a future internal
caller) — no tenant admin can use this feature through the product.**
This is the same "wired, not yet reachable in practice" state
`ORG_UNIT_HEAD`'s workflow wiring (5.8) deliberately shipped in and
disclosed — the difference is this one was never disclosed anywhere
until now.

### 5.7 User-Level "Acting-For-A-Unit" (`User.actingOrgUnitId`)

Fully independent of everything above — a user can be flagged as
acting for an entire *different* org unit (`actingOrgUnitId` +
`actingOrgUnitUntil`), unrelated to Head authority, position-holding,
or role grants. Set via `UserService.updateProfile()`
(`user.service.ts:228`, no referential-integrity check against
`OrgUnit`, matching that block's existing `positionId`/
`primaryOrgUnitId`/`managerId` precedent), wired into
`user-profile.component.ts`. Cleared by
`sweepExpiredActingOrgUnitAssignments()` (5.5) on expiry, with a
courtesy notification to the user — no vacancy/role side effects,
since this axis feeds nothing in Head derivation (5.3) at all. Nothing
in the codebase currently reads `actingOrgUnitId` for any authorization
or assignment-resolution decision — it exists as a scoping fact only,
confirmed via grep to have no consumer beyond the sweep that clears it.

### 5.8 Wired Into the Workflow Engine — `ORG_UNIT_HEAD` Assignee Strategy

Cross-referenced from Section 2 (Workflow Engine), not duplicated here:
`WorkflowService.resolveAssigneeRaw()`'s and `resolveApproverPool()`'s
`ORG_UNIT_HEAD` cases (`workflow.service.ts:920`, `:1368`) both call
`OrganizationService.resolveActingHeadForOrgUnit()` (5.3) against
`instance.orgUnitId`. **Ships "wired, not yet reachable in practice,"
explicitly disclosed**: no workflow-driven object (`Committee`,
`Meeting`) has an `orgUnitId` field yet — both cases read it via a
defensive `(instance as { orgUnitId?: string | null })` cast against
the real Prisma type, tested only with a synthetic/test-only
`orgUnitId`, matching `ASSIGNEE_POOL`'s own multi-month dormant period
before ACC-28 gave it a real consumer.

### 5.9 The Unified Delegation-Reason Stamp

Cross-referenced from Section 2 (Workflow Engine — `resolveDelegationStamp()`,
`workflow.service.ts:1055`), not duplicated here: `WorkflowInstanceStage`,
`WorkflowApproval`, and `TaskAssignee` each carry a nullable
`delegationReason`/`delegationContextId` pair, stamped once at write
time, recording *why* an actor was eligible (`ACTING_HEAD` via 5.6, or
`OUT_OF_OFFICE_COVERAGE`, unrelated to this section) — never *who*
acted, which every affected table already recorded. Fully real,
end-to-end, backend-only as of ACC-40 Phase 9 — no frontend surface
exists yet to display it (see CLAUDE.md's Open/Deferred Items for the
cross-reference to exactly where this picks back up).

### 5.10 Position-to-Role Mapping — Real Position-Holding Grants a Role

`OrgPosition.roleId` (5.1) is the mapping; `UserService.syncHeadAuthorityRoleGrant()`
(`user.service.ts:331`) is the one shared sync point, called from
`invite()`, `updateProfile()`, and every Head-management method in 5.4/
5.6 that changes a `(positionId, orgUnitId)` pairing. Revokes against
the OLD pairing first (if ever granted via this mechanism), then grants
against the NEW one. Applies to **real position-holding only** —
`assignHead()`/`declareHandover()`/`vacateHead()`/`updateProfile()`/
`invite()` — Acting Head (5.6) grants separately, only when
`coveringForUserId` resolves to a real position. Org-wide
(`primaryOrgUnitId: null`) head-conferring positions are supported
without a carve-out — `RoleService.grantRoleViaHeadAuthority()`/
`revokeRoleViaHeadAuthority()` (`role.service.ts:409`/`:463`) key the
revoke off `grantedViaHeadPositionOrgUnitId` when unit-scoped, falling
back to `grantedViaHeadPositionId` only for the org-wide case (the one
case where matching on a null `orgUnitId` would be unsafe — it would
also match ordinary, independently-held rows). An independent grant
(a role assigned through the ordinary Roles UI, not through this
mechanism) is never overwritten or relabeled — a later revoke via this
mechanism correctly leaves it untouched.

### 5.11 Mandatory `positionId`/`primaryOrgUnitId` and Existing-Tenant Remediation

`InviteUserDto.positionId` is required for every new invitation from
the moment this shipped; `primaryOrgUnitId` is required only once the
tenant has at least one active `OrgUnit` (enforced in
`UserService.invite()`, not a blanket DTO decorator — a brand-new
tenant has zero units until an admin creates one).
**Existing active users are explicitly NOT retroactively blocked** —
no data migration forces this. Instead,
`UserService.notifyTenantAdminsOfIncompleteProfiles()`
(`user.service.ts:185`) is a remediation **report**, not a
transformation script (a real difference from every other
`backfill-*.ts` precedent in this codebase, where the target state
*was* programmatically derivable) — counts active users missing
`positionId` and/or (conditionally) `primaryOrgUnitId`, notifies Tenant
Admins once via the same admin-notification chain used throughout this
section. The actual fix happens through the already-wired
`user-profile.component.ts` edit form — no new UI needed for the fix
itself.

### 5.12 `validateEscalationTarget()` — Unchanged, Cross-Referenced to Section 3.4

ACC-40 did not touch task-escalation logic at all.
`OrgPositionService.validateEscalationTarget()` (`:187`) still gates
who a task's SLA-breach escalation target may be, using
`position.grade` (unaffected by the `isSingleAssignee`/
`isUnitHeadPosition` additions) and `primaryOrgUnitId` hierarchy — full
mechanics in Section 3.4. Confirmed via grep, still the only real
consumer of `OrgPositionService` outside its own controller — the code
comment's forward-looking "Committees/Meetings/Documents/CAPA/Audits"
list remains entirely unrealized, and `CommitteeMember.roleValueId`
and `OrgPosition` remain two disconnected concepts.

### 5.13 Permission Model

```
positions:view    — OrgPositionController: listPositions, getPositionById
positions:manage  — OrgPositionController: createPosition, updatePosition, deactivatePosition, reactivatePosition
org:view          — OrgUnitHeadController: getHeadStatus
org:manage        — OrgUnitHeadController: assignHead, vacateHead, declareHandover, completeHandoverNow, cancelHandover
```

Head-management actions are gated by `org:manage`, **not**
`positions:manage` — a deliberate split (`org-unit-head.controller.ts:13-20`):
`positions:manage` governs the tenant-wide position catalog itself;
Head-management doesn't edit the catalog, it changes who leads a
specific org unit, the same kind of OrgUnit-scoped action `org:manage`
already governs generally. `assignActingHead()`/`clearActingHead()`
have no permission mapping at all — no controller route exists for
them to gate (5.6).

### 5.14 Frontend Consumption (Static Check)

`frontend/src/app/foundation/org-position/services/org-position.service.ts`:

| Method | Endpoint | Caller(s) found |
|---|---|---|
| `listPositions()` | `GET /org-positions` | `position-list.component.ts`, `user-profile.component.ts`, `user-list.component.ts`, `invite-user.component.ts`, `org-unit-head-panel.component.ts` |
| `getById()` | `GET /org-positions/:id` | **ZERO frontend callers found** (unchanged from pre-ACC-40) |
| `create()` / `update()` | `POST` / `PATCH /org-positions/:id` | `position-form.component.ts` — form includes `isSingleAssignee`/`isUnitHeadPosition` (with the head-implies-single constraint mirrored client-side, unchecking one clears the other) /`roleId` |
| `deactivate()` / `reactivate()` | `POST /org-positions/:id/(de)activate` | `position-list.component.ts` |

`frontend/src/app/foundation/organization/services/org-unit-head.service.ts`
+ `org-unit-head-panel.component.ts` — `getHeadStatus`/`assignHead`/
`vacateHead`/`declareHandover`/`completeHandoverNow`/`cancelHandover`
all wired and reachable from an `OrgUnit` detail screen. **No
`assignActingHead`/`clearActingHead` methods exist on the frontend
service at all** — matches 5.6's backend-controller gap exactly; this
is one gap (no HTTP route, so naturally no frontend caller either), not
two independent ones.

`user-profile.component.ts` — `actingOrgUnitId`/`actingOrgUnitUntil`
(5.7) fully wired as an optional profile field, distinct from the
position/org-unit picker above it.

---

## 6. Lookup System

`backend/src/foundation/lookup/lookup.service.ts`. Two-layer model —
SYSTEM (shipped, `organizationId: null`) and TENANT
(`organizationId` set), per `LookupLayer` enum.

### 6.1 Models (Already Shown in Full in Section 1's Schema Excerpt — Restated Here for This Section's Own Completeness)

```prisma
model LookupCategory {
  id              String        @id @default(cuid())
  organizationId  String?       // null = SYSTEM category (shared, all tenants)
  key             String
  labelEn, labelAr String
  isSystem        Boolean       @default(false)
  isExtensible    Boolean       @default(true)   // gates whether addValue() is allowed at all
  attributeSchema Json?
  isActive        Boolean       @default(true)
  sortOrder       Int           @default(0)

  @@unique([key, organizationId])
}

model LookupValue {
  id              String       @id @default(cuid())
  organizationId  String?      // null = SYSTEM value; set = TENANT-layer row
  categoryId      String
  key             String
  labelEn, labelAr String
  layer           LookupLayer  @default(SYSTEM)   // SYSTEM | TENANT
  attributes      Json?
  isActive        Boolean      @default(true)
  isHidden        Boolean      @default(false)    // TENANT-layer only, in practice
  labelOverrideEn String?                          // TENANT-layer only, in practice
  labelOverrideAr String?
  sortOrder       Int          @default(0)

  @@unique([categoryId, key, organizationId])
}
```

**12 SYSTEM categories seeded** (`lookup.seed.ts`) — confirmed by direct
count, not from CLAUDE.md's own list, which under-states this by one:
`committee_type, committee_member_role, document_type,
document_section_type, incident_type, incident_severity, audit_type,
corrective_action_type, standard_body, gap_category, meeting_type,
org_unit_type`. **`org_unit_type` is not mentioned in CLAUDE.md's own
"System Lookup Categories" section** — a minor doc/code drift, noted
for completeness. **Exactly one category is `isExtensible: false`**:
`incident_severity` — every other seeded category allows tenant-added
values.

### 6.2 The Override Pattern — `getValues()`'s Exact Merge Algorithm

This is the mechanism CLAUDE.md's "Layer 2 — Tenant lookups... Tenant
admins add values, define attributes, reorder, activate/deactivate"
and "Can be hidden or label-overridden" actually resolves to at read
time (`lookup.service.ts:207–263`):

1. Fetch every active SYSTEM `LookupValue` for the category
   (`organizationId: null`).
2. Fetch every active TENANT `LookupValue` for the category
   (`organizationId: tenantId`), keyed by `key`.
3. For each SYSTEM value: if a TENANT row with the same `key` exists
   **and** `isHidden` is true → **excluded from the result entirely**.
   If a TENANT row exists and is not hidden → the SYSTEM value's
   `labelEn`/`labelAr` are **replaced** with
   `override.labelOverrideEn ?? sv.labelEn` /
   `override.labelOverrideAr ?? sv.labelAr` (falls back to the
   original if the override field itself is null), everything else
   about the SYSTEM value unchanged. If no TENANT row matches → the
   SYSTEM value passes through as-is.
4. Any TENANT row **not** matched to a SYSTEM value by key is a
   genuinely tenant-added value — included as-is.
5. Result re-sorted by `sortOrder`.

**One `LookupValue` row at `layer: 'TENANT'` therefore serves three
distinct, mutually exclusive purposes**, distinguished only by its
content and whether its `key` matches an existing SYSTEM value in the
same category — not by any separate type field:
(a) `isHidden: true` → suppresses a SYSTEM value,
(b) `labelOverrideEn`/`labelOverrideAr` set, `isHidden: false` → relabels
a SYSTEM value,
(c) `key` matches no SYSTEM value → a genuinely new tenant-defined value.
`hideSystemValue()`/`unhideSystemValue()`/`overrideLabel()` all
`upsert()` against the same `@@unique([categoryId, key, organizationId])`
constraint precisely to create/reuse the same underlying row for
purposes (a)/(b) rather than risk two conflicting TENANT rows for one
SYSTEM key.

### 6.3 Mutation Rules — What's Blocked and Why

- **`addValue()`** — checked against `category.isExtensible` first
  (`ForbiddenException` if false); creates a `layer: 'TENANT'` row.
- **`updateValue()` / `removeValue()`** — both explicitly reject if
  `value.layer === 'SYSTEM'` (`ForbiddenException`, pointing the caller
  at hide/override-label instead). `removeValue()` is a soft-delete
  (`isActive: false`), never a real `DELETE`.
- **`updateCategory()` / `deactivateCategory()`** — gated by
  `PlatformGuard` at **method level**, additive to the controller's
  class-level `@UseGuards(TenantGuard, PermissionGuard)` (NestJS
  combines class + method guards, it does not replace one with the
  other — confirmed against the actual guard-composition mechanics in
  Section 1.2). No `@Permissions()` decorator on either method, so
  `PermissionGuard` no-ops; `PlatformGuard` is the guard that actually
  filters anyone out — this is the ACC-17 fix (Section 1's
  `PlatformGuard` consumers list), closing the cross-tenant integrity
  gap where a SYSTEM category (shared across every tenant) could
  otherwise be mutated by any tenant holding `lookups:manage`.

### 6.4 AI Stub

`suggestValues()` — validates the category exists, then returns `[]`
unconditionally. Code comment marks it as a stub for the
`lookup.suggestValues` AI feature (CLAUDE.md's Foundation Layer AI
integration point: "Suggest missing lookup values based on industry
standards") — not wired to any `AiProvider` call yet.

### 6.5 Permission Model

```
lookups:view    — LookupController: getCategories, getCategoryByKey, getValues, suggestValues
lookups:manage  — LookupController: addValue, updateValue, removeValue,
                  hideSystemValue, unhideSystemValue, overrideLabel
(PlatformGuard, not a permission string) — updateCategory, deactivateCategory
```

### 6.6 Frontend Consumption (Static Check)

`frontend/src/app/foundation/lookup/services/lookup.service.ts` — 12
methods, one per `LookupController` endpoint:

| Method | Endpoint | Caller(s) found |
|---|---|---|
| `getCategories()` | `GET /lookups/categories` | `lookup-category-list.component.ts:113` |
| `getCategoryByKey()` | `GET /lookups/categories/:key` | `lookup-value-list.component.ts:352`, `lookup-value-form.component.ts:213` |
| `updateCategory()` | `PATCH /lookups/categories/:key` | **ZERO frontend callers found** |
| `deactivateCategory()` | `POST /lookups/categories/:key/deactivate` | **ZERO frontend callers found** |
| `getValues()` | `GET /lookups/categories/:key/values` | `committee-member-form`, `committee-list`, `committee-form`, `committee-detail` (×2), `lookup-value-list.component.ts:361` |
| `addValue()` | `POST /lookups/categories/:key/values` | `lookup-value-form.component.ts:191` |
| `suggestValues()` | `POST /lookups/categories/:key/suggest` | **ZERO frontend callers found** |
| `updateValue()` | `PATCH /lookups/values/:id` | `lookup-value-form.component.ts:184` |
| `removeValue()` | `DELETE /lookups/values/:id` | `lookup-value-list.component.ts:315` |
| `hideSystemValue()` | `POST /lookups/values/:id/hide` | `lookup-value-list.component.ts:298` |
| `unhideSystemValue()` | `DELETE /lookups/values/:id/hide` | `lookup-value-list.component.ts:306` |
| `overrideLabel()` | `POST /lookups/values/:id/override-label` | `lookup-value-list.component.ts:328` (`onSaveOverride()`, a dedicated `p-dialog` with `labelEn`/`labelAr` inputs) |

**Correction to an earlier pass of this section**: `overrideLabel()`
was initially flagged as having zero frontend callers — a false
negative from a single-line grep pattern that missed the call because
it's split across a line break
(`this.lookupService\n  .overrideLabel(...)`, same shape Section 3.7's
`task-form.component.ts` call already showed for `create()`). Re-checked
with a multiline-aware pattern and by reading the component directly:
`lookup-value-list.component.ts` has a full "Override label" `p-dialog`
(`labelEn`/`labelAr` inputs, save button wired to `onSaveOverride()`,
which calls `lookupService.overrideLabel()` and reloads the list on
success). **The override pattern (6.2) has real UI for both halves** —
hide and relabel are both wired, not just hide. Every other "zero
callers" finding in Sections 1–9 was re-checked with the same
multiline-aware pattern after this was found; none of the others
changed.

**Two real, precise gaps remain**: the `PlatformGuard`-gated
SYSTEM-category mutation endpoints (`updateCategory`/`deactivateCategory`,
the ACC-17 fix's whole subject) have **no UI anywhere, not even in the
Super Admin Portal** — a Platform Admin cannot rename or deactivate a
SYSTEM category through this app today, despite the backend fully
supporting it and despite that exact code path being the one ACC-17
specifically hardened. `suggestValues()` is consistent with 6.4 — it's
a stub returning `[]`, unsurprising that nothing calls it yet.

---

## 7. Organization Structure

`backend/src/foundation/organization/organization.service.ts`. Self-
referential `OrgUnit` tree — not the same concept as `OrgPosition`
(Section 5): `OrgUnit` is the department/unit structure, `OrgPosition`
is seniority within a unit.

### 7.1 Model

```prisma
model OrgUnit {
  id             String       @id @default(cuid())
  organizationId String
  parentId       String?
  nameEn         String
  nameAr         String?
  code           String
  type           String?      // free string, NOT a lookup FK — see 7.4
  description    String?
  isActive       Boolean      @default(true)
  isCodeLocked   Boolean      @default(false)   // see 7.3 — never actually set true today
  sortOrder      Int          @default(0)

  parent         OrgUnit?     @relation("OrgUnitHierarchy", fields: [parentId], references: [id])
  children       OrgUnit[]    @relation("OrgUnitHierarchy")

  @@unique([organizationId, code])
}
```

### 7.2 Service Methods

- **`getTree()`** — fetches every `OrgUnit` flat, then builds the tree
  in memory (`buildTree()`, recursive filter by `parentId`) — not a
  recursive SQL query. Fine at current expected scale, worth knowing if
  a tenant ever has a very large unit count.
- **`listFlat()`** — the same rows, unstructured, for pickers (this is
  what `OrgPosition`/User components actually consume — see 7.5).
- **`create()`** — validates a given `parentId` belongs to the same
  tenant; validates `code` uniqueness (`@@unique([organizationId, code])`).
- **`update()`** — **code-lock check**: rejects changing `code` if
  `unit.isCodeLocked` is true (7.3). Rejects `parentId === id`
  (self-parenting). **No cycle detection beyond that single-level
  check** — confirmed by reading the full method: setting unit A's
  `parentId` to one of A's own *descendants* (a deeper cycle, not just
  direct self-parenting) is not checked anywhere. A real, unexercised
  gap — nothing in the seeded data or tests currently creates one, but
  the guard rejecting it does not exist.
- **`deactivate()`** — idempotent. Blocker list is a real
  `ConflictException` on active child units (queried live), but **four
  of five documented blocker checks are TODO-commented-out, not
  implemented**: users assigned to the unit, active documents owned by
  it, open incidents referencing it, active workflow instances in it.
  **The Users check is stale, not just deferred**: its TODO comment
  reads `TODO(Step 9 — Users): check for active users assigned to this
  org unit` — but Users (`User.primaryOrgUnitId`, Section 5.1) has been
  built and shipped since ACC-12, well before this session. **Today,
  deactivating an `OrgUnit` with active users still assigned to it
  succeeds with no warning or block** — the one blocker check that
  could be wired against already-existing data isn't.

### 7.3 `isCodeLocked` — Schema Exists, Trigger Does Not

Grepped every reference to `isCodeLocked` across `backend/src`: it is
**read** by `update()`'s lock check (7.2) and **mapped** through to the
API response, but **never once set to `true` anywhere in application
code** — confirmed, zero write sites beyond the schema's own
`@default(false)`. This is consistent with CLAUDE.md's own intent
("Codes never reused — even after document obsolescence" for Document
Numbering), but the trigger for locking a unit's code — presumably
"the first time a document number is generated using this unit's
code" — doesn't exist because Document Management doesn't exist yet.
The field and its enforcement logic are both real and correctly wired;
only the thing that would ever flip it is missing.

### 7.4 `type` — Free String, Not a Lookup FK

`OrgUnit.type` is a plain nullable `String?`, **not** a foreign key
into `LookupValue`. The `org_unit_type` SYSTEM lookup category
(Section 6.1 — `department, division, unit, section, administration,
office`) exists and is seeded, but `OrgUnit.type` has no schema-level
relationship to it — confirmed via the model definition directly, no
`typeValueId`/`LookupValue` relation field exists on `OrgUnit`, unlike
`Committee.typeValueId` (Section 2, which *does* FK into
`committee_type`). Whether the frontend form still populates `type`
from the `org_unit_type` lookup values as free-text convention (soft
coupling, not enforced) is worth checking in the live-audit — this
static check can only confirm the schema itself doesn't enforce it.

### 7.5 Permission Model

```
org:view    — OrganizationController: getTree, listFlat, findById
org:manage  — OrganizationController: create, update, deactivate
```

Both fully wired, no inert permission string.

### 7.6 Frontend Consumption (Static Check)

`frontend/src/app/foundation/organization/services/org-unit.service.ts`
wraps only **5 of the 6** backend endpoints — `findById()`
(`GET /organization/units/:id`) has **no frontend method at all**, not
even an unused one; it was never wrapped, a step earlier in the gap
chain than the usual "wrapped but uncalled" pattern seen in every prior
section.

| Method | Endpoint | Caller(s) found |
|---|---|---|
| `getTree()` | `GET /organization/units` | `org-unit-tree.component.ts:179` |
| `getFlat()` | `GET /organization/units/flat` | `position-list`, `position-form`, `invite-user`, `org-unit-form`, `user-list`, `user-profile` |
| — (`findById()`) | `GET /organization/units/:id` | **not wrapped in the frontend service at all** |
| `create()` | `POST /organization/units` | `org-unit-form.component.ts:234` |
| `update()` | `PATCH /organization/units/:id` | `org-unit-form.component.ts:233` |
| `deactivate()` | `POST /organization/units/:id/deactivate` | `org-unit-tree.component.ts:170` |

`getFlat()` is the most widely reused endpoint found in this document
so far — six distinct components across three different modules
(Organization, Org Position, User) all depend on it for org-unit
pickers. No dead *wrapped* endpoints in this system — the one gap is
structurally different (never wrapped, not merely unused).

---

## 8. Multi-Tenancy Conventions

### 8.1 The Central Correction — CLAUDE.md's "Non-Negotiable" Rule Overstates Reality

CLAUDE.md's Architecture Rules state, verbatim: **"Prisma middleware
intercepts EVERY query and injects organizationId automatically."**
This is listed under "Multi-Tenancy — Non-Negotiable."

**Checked directly against `backend/src/prisma/prisma.service.ts` —
this is false.** The file's own top-of-file comment states the actual
rule plainly: *"All DB queries MUST include organizationId scoping —
enforced per service method."* The only `$extends()` call in the
entire file (Prisma 7's client-extension mechanism, the modern
replacement for the older `$use()` middleware API) does exactly one
thing: blocks `update`/`updateMany`/`upsert`/`delete`/`deleteMany` on
`AuditLog` to enforce its append-only guarantee (Section on Security
Configuration → Audit Trail). **There is no organizationId-injection
logic anywhere in this client, no query interceptor, no row-level
security policy** (confirmed via grep across every migration file for
`ROW LEVEL SECURITY`/`CREATE POLICY`: zero matches — Supabase supports
Postgres RLS, but this project uses none of it).

**What this actually means**: every single `organizationId` filter
documented throughout every section of this reference — every
`findFirst({ where: { id, organizationId } })`, every
`findMany({ where: { organizationId, ... } })` — is there because a
developer wrote it by hand in that specific service method, not
because a shared layer guarantees it. There is no structural safety
net between "a service method exists" and "that service method is
correctly tenant-scoped." This is the direct, confirmed mechanism
behind why ACC-17's gaps (dormant `committeeId` cross-tenant read,
`NotificationService.create()`'s originally-unscoped `userId` write —
both already documented in this reference, Sections 2 and 4) were able
to exist in the first place: nothing would have caught them except a
human noticing, or a test written specifically to check.

### 8.2 The Established Query Shape

The convention this codebase actually relies on, observed consistently
across every service documented in Sections 1–7: **single-record
lookups scope by `id` AND `organizationId` together in the same
`where` clause**, never `findUnique({ id })` followed by a separate
tenant check:

```ts
// The shape used everywhere in this codebase — a record from another
// tenant simply does not match this query and returns null/undefined,
// indistinguishable from "doesn't exist" (404, not 403 — deliberately,
// so a cross-tenant probe can't even confirm a record's existence).
const record = await this.prisma.someModel.findFirst({
  where: { id, organizationId },
});
if (!record) throw new NotFoundException(...);
```

List queries follow the same pattern
(`findMany({ where: { organizationId, ...otherFilters } })`). This
shape recurs in every service read while building this document —
`RoleService`, `WorkflowService`, `TaskService`, `NotificationService`
(with the added ownership check, Section 4.2), `OrgPositionService`,
`LookupService`, `OrganizationService` — without a single exception
found.

### 8.3 The Denormalization Rule

`organizationId` is stored directly on tables even when it could be
derived by joining through a parent relation — confirmed repeatedly
across sections already written: `CommitteeMember.organizationId`
(Section 2, explicitly commented "denormalized from
`Committee.organizationId`, set once at creation, never updated"),
`TaskEvidence.organizationId`, `WorkflowInstance.organizationId`,
`WorkflowActionLog.organizationId`. The reasoning, consistent
everywhere it's commented: it lets every query use the exact 8.2 shape
directly on the table being queried, without an extra `JOIN` (or a
Prisma nested-relation filter) just to establish tenant scope — and it
closes a class of bug where a developer forgets the join and
accidentally queries cross-tenant. The tradeoff, also consistent
everywhere: the denormalized value is written once at creation and
never updated — if a parent record could ever change tenant (it never
can, by design; `organizationId` is immutable on every parent too),
the denormalized copy would need its own migration to stay in sync.

### 8.4 What Actually Prevents a Cross-Tenant Query From Shipping

Given 8.1, the real (non-structural) safety net is **CI-enforced test
convention**, not a framework guarantee — and it's worth being precise
about how thin this actually is, not just naming it:

```yaml
# .github/workflows/ci.yml:113-135 — the "Tenant Isolation Tests" job, verbatim mechanism
run: npx jest --testNamePattern="should NOT return records belonging to a different tenant" --passWithNoTests
```

This is **not** a dedicated test suite or file — it's a `jest`
`--testNamePattern` filter that runs across the *entire* test suite,
matching any `it(...)`/`test(...)` block whose name is the **exact
literal string** `"should NOT return records belonging to a different
tenant"`, wherever it happens to live. `--passWithNoTests` means: if
*zero* tests anywhere match that exact string, the CI job still passes
green — there is no failure mode for "a module has no tenant-isolation
test at all," only for "a test with this exact name exists and fails."

**Confirmed via grep**: exactly **9** spec files currently carry a test
matching this name: `workflow-template`, `committees`, `tenant`,
`user`, `notification`, `lookup`, `role`, `working-calendar`,
`organization`. **Notably absent**: `task.service.spec.ts`,
`org-position.service.spec.ts`, and the main `workflow.service.spec.ts`
(only `workflow-template.service.spec.ts` has it) — three services this
document has independently confirmed *do* org-scope their queries
correctly by reading the code directly, but whose tenant-isolation
correctness is **not** verified by this specific CI gate, because no
test with the exact matching name exists in their spec files. This is
a real, precise, currently-true coverage gap in the isolation-test
convention itself, not a hypothetical one.

### 8.5 `TenantGuard`'s Actual Role in This Picture

Worth being precise, since it's easy to conflate: `TenantGuard`
(Section 1.2) authenticates the request and populates
`request.tenantId` from the verified JWT claim — it does **not**
itself enforce that any subsequent Prisma query uses that value. It
guarantees *where the correct `organizationId` comes from* (the JWT,
never the request body — CLAUDE.md's other, **accurate** Non-Negotiable
rule: "NEVER trust organizationId from the request body"), not *that
every query actually applies it*. That second half is entirely on each
service method, per 8.1.

---

## 9. i18n / RTL

`frontend/src/app/core/services/language.service.ts` (ACC-19). No
backend controller of its own — the mechanism is frontend-owned, with
one backend method it depends on (`AuthService.resolveLanguage()`,
9.2).

### 9.1 `LanguageService` — the Single Owning Mechanism

The entire file is 60 lines. Its own header comment states the reason
for its existence directly: *"Before this existed, `translate.use()`
was never called anywhere in the app... and the RTL CSS rules already
in `styles.scss`... were permanently inert since nothing ever set the
`dir` attribute on `<html>` — the same 'written, never wired' situation
ACC-15 found with Tailwind."* Three methods only:

```ts
use(lang: string): Observable<unknown>   // wraps TranslateService.use(), returns the load Observable
isRtl(): boolean                          // RTL_LANGUAGES.has(currentLang)
isArabic(): boolean                       // currentLang === 'ar'
```

Plus a constructor-registered `effect()` that re-runs on every language
change (reading `TranslateService.currentLang()`, confirmed to be a
real `Signal` against the installed `@ngx-translate/core` version, not
assumed) and sets `document.documentElement.dir`/`.lang` directly. This
`effect()`, not any call site, is what actually flips RTL — every
caller of `use()` triggers it indirectly by changing the signal
`TranslateService.use()` writes to.

`RTL_LANGUAGES` is a one-entry `Set(['ar'])` — RTL-ness is a lookup
against this set, not a property of the language string itself.

**PrimeNG needs no separate RTL configuration** — confirmed directly
against the installed PrimeNG v21.1.9's `PrimeNGConfigType` (no
rtl/direction option exists there at all): it activates automatically
via CSS logical properties the moment `<html dir="rtl">` is set, which
is exactly what `LanguageService`'s `effect()` does. CLAUDE.md's "PrimeNG
RTL mode enabled when Arabic active" is accurate in outcome, but there
is no explicit "enable PrimeNG RTL" call anywhere — it's a side effect
of the `dir` attribute, not a distinct wiring step.

### 9.2 Resolution Chain — Backend and Frontend, Precisely

**Backend** (`AuthService.resolveLanguage()`,
`backend/src/foundation/auth/auth.service.ts:612–623`) — matches
CLAUDE.md's documented order exactly, confirmed directly:

```ts
async resolveLanguage(userLanguage: string | null, organizationId: string): Promise<string> {
  if (userLanguage) return userLanguage;
  const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { language: true } });
  return org?.language ?? 'en';
}
```

`user.language` → `organization.language` → `'en'`, exactly as
documented. Called from `completeLogin()` (backing both `/auth/login`
and `/auth/mfa/verify`) and from `GET /auth/me`.

**Frontend — one precision worth stating, not a gap**: CLAUDE.md
describes the app initializer as chaining three concerns "session
restore → language resolution → platform/tenant permission loading."
Reading `app.config.ts`'s `initializeSession()` directly: it literally
chains only **two** top-level calls —
`authService.restoreSession() → navigationAccessService.loadAccess()`.
Language resolution is not a separate third step in that chain; it's
**nested inside `restoreSession()` itself**
(`auth.service.ts:149–165`, `switchMap` into
`languageService.use(response.language)` before the `currentUser`
signal is set). The *effective order* CLAUDE.md describes is still
correct — language does resolve before `loadAccess()` runs, since it's
part of the first promise in the chain — but structurally it's "two
steps, one of which internally does two things," not three flat
sequential steps. `AuthService.applyLoginResult()` is the second call
site (a fresh login, not a page-refresh), applying the just-returned
`result.language` immediately — its own comment states why: "without
this, a user with a saved Arabic preference would see English until
their next page refresh."

### 9.3 The Translate-Pipe-vs-Tenant-Editable-Data Distinction

Confirmed by grepping every `languageService.isArabic()` call site
across the frontend: it is used **exclusively for tenant-editable data
fields** (`labelEn`/`labelAr`, `nameEn`/`nameAr` pairs coming back from
the API), **never** as a substitute for `| translate` on static UI
copy. Every call site found:

- **Committee module** — committee `nameEn`/`nameAr`, lookup value
  `labelEn`/`labelAr` (type, member role), workflow stage
  `nameEn`/`nameAr` (`committee-detail.component.ts:389`'s
  `currentStageLabel` — this is the exact mechanism behind the
  `WorkflowStage`-has-no-stable-key decision already documented: plain
  bilingual text via `isArabic()`, not a colored badge keyed to a
  stage identity).
- **Lookup module** — category `labelEn`/`labelAr`, value
  `labelEn`/`labelAr` (both list components).
- **`WorkflowTransitionActionsComponent`** — transition
  `labelEn`/`labelAr` (`workflow-transition-actions.component.ts:84`) —
  the exact code CLAUDE.md's Key Architecture Decision refers to:
  "renders each transition's own `labelEn`/`labelAr` (never `|
  translate` — transition labels are tenant-editable data)," confirmed
  directly against the real call site, not just the decision log.
- **Notification bell** — one call site
  (`notification-bell.component.ts:114`) for direction only, not label
  selection (notifications don't carry bilingual fields — `titleAr`/
  `bodyAr` are read directly in the email processor server-side,
  Section 4.4, not selected client-side).

No call site found anywhere using `isArabic()`/`isRtl()` to conditionally
render static translated UI copy — that class of text uses
`| translate` throughout, consistent with the intended separation.

### 9.4 Translation File Parity — Static Check Only

`frontend/src/assets/i18n/en.json` and `ar.json` are both exactly **486
lines**. Suggestive of key parity, not a proof (a line-count match
doesn't guarantee identical key sets) — a real key-diff was not run for
this document; flagged as a cheap follow-up check, not claimed as
verified.

### 9.5 What's Explicitly Not Covered Here

The **full RTL visual audit** (icon mirroring, breadcrumb arrow
direction, table column order, form alignment across all ~15+ existing
screens) is already tracked as an explicit Open/Deferred Item in
CLAUDE.md, positioned before the demo milestone — not re-investigated
for this document. ACC-19 itself only verified the underlying mechanism
against a representative sample (nav shell, one form, one table), per
CLAUDE.md's own account, which this section's findings are consistent
with, not a contradiction of.

---

## 10. Frontend Design Patterns

`frontend/src/app/shared/components/` (3 components) +
`frontend/src/styles/tokens.scss` + established conventions from
`backend/Plans/step-15-design-foundation.md` (ACC-15).

### 10.1 Design Tokens (`tokens.scss`)

Colors only — CSS custom properties, `--am-*` naming. **Not** where
spacing/typography live (10.4). Four groups:

```css
--am-blue-primary, --am-green-accent, --am-charcoal, --am-sidebar-*,
--am-surface, --am-card, --am-border, --am-text-primary/secondary   /* brand */

--am-status-{draft,review,approved,rejected,published,archived}     /* 6 */
--am-severity-{critical,high,medium,low}                            /* 4 */
--am-account-{trial,active,suspended,cancelled,offboarding}         /* 5 */
--am-banner-info                                                    /* fixed, not a variant */
```

`--am-account-*` is deliberately its own token set, not folded into
`--am-status-*` — code comment states why directly: document-lifecycle
status (draft/review/approved/...) and tenant/organization lifecycle
status (trial/active/suspended/...) are different domains, and folding
them would be a category error. `--am-banner-info` is similarly kept
separate from `--am-severity-*` for the same reason — a fixed
informational banner (e.g. impersonation) isn't rating anything, so
borrowing a severity token for it was flagged during ACC-15 as its own
category error and given its own name instead.

### 10.2 `StatusBadgeComponent` — Generic by Variant, Not by Fixed Enum

`frontend/src/app/shared/components/status-badge/status-badge.component.ts`.
Deliberately generic — takes `variant: 'status' | 'severity' | 'account'`
and an arbitrary `value: string`, rather than one component per
vocabulary. Two computed bindings, both derived the same way:

```ts
colorVar   = `var(--am-${variant}-${value.toLowerCase()}, var(--am-text-secondary))`
labelKey   = `${variant}.${value.toLowerCase()}`   // rendered via | translate
```

Two deliberate safety properties, both stated directly in the code
comment: (1) **CSS's own `var()` fallback** handles an unmapped/typo'd
`value` — resolves to `--am-text-secondary` instead of an invisible or
broken badge, no JS-side existence check needed, the cascade handles
it. (2) An explicit warning to future callers: *"confirm en.json/ar.json
actually have a matching `{variant}.{value}` key — ngx-translate falls
back to rendering the raw key string otherwise, which must never reach
a real screen."*

**This is the correct, opposite half of the Section 9.3 distinction**:
`status`/`severity`/`account` values are fixed, non-tenant-editable
vocabularies (document lifecycle stages, severity levels, account
states — not lookup-driven, not per-tenant), so `| translate` is the
right mechanism here — consistent with, not contradicting, Section
9.3's finding that tenant-editable data (`labelEn`/`labelAr` pairs)
never uses `| translate`. `StatusBadgeComponent` is correctly *not*
used anywhere for `WorkflowStage`/`WorkflowTransition` names, which
use plain `isArabic()`-selected bilingual text instead (Section 9.3) —
confirmed no cross-contamination between the two patterns.

Confirmed consumers (grep): `committee-detail`, `committee-list`,
`tenant-list`, `tenant-detail` — 4 components, spanning both a
foundation module (Committee) and the Super Admin Portal.

### 10.3 `CardComponent` — Extracted From Duplication, Not Designed Upfront

`frontend/src/app/shared/components/card/card.component.ts`. Code
comment states its own origin directly: extracted from a pattern
"already duplicated inline in `settings-hub.component.ts`" — built
*after* the duplication existed, not speculatively ahead of it, per
this project's own stated discipline. One input, `linkable` (default
`false`), toggling a hover-border + pointer-cursor treatment for
clickable cards vs. static ones. Confirmed consumers: `settings-hub`
(its origin) and `ai-settings`. Narrower reuse than `StatusBadgeComponent`
— two consumers, both inside Admin Settings, not yet reused by any
foundation module's own list/detail screens.

### 10.4 Spacing / Typography Scale — Convention, Not a Token File

**Structurally different from color tokens (10.1)**: there is no
`--am-spacing-*`/`--am-font-*` CSS custom property file. The
spacing/typography scale is a **Tailwind utility-class convention**,
documented in `step-15-design-foundation.md` and applied directly in
component templates — e.g. body text is `text-sm` (14px) `font-normal`,
form labels are `text-sm font-medium`, captions/helper text are
`text-xs`. Enforced by convention and code review precedent (ACC-15's
own sweep across the nav shell, Super Admin Portal, and Tenant Admin
Settings), not by a shared variable or lint rule — a real, load-bearing
difference from how color consistency is enforced (10.1's CSS
variables are structurally hard to bypass; the typography scale is
not).

### 10.5 `EditDialogComponent` — the Required Add/Edit-Flow Pattern (ACC-29)

`frontend/src/app/shared/components/edit-dialog/edit-dialog.component.ts`.
Extracted from what this document previously described as "a
convention, not a shared component" — six-plus list components
(Lookup Values, Roles, Org Positions, Committees, Org Units, Workflow
Stages) each hand-rolling identical `p-dialog` + local-signal +
`*-form.component.ts` wiring independently. The duplication turned out
not to be merely cosmetic: ACC-29 found the hand-rolled convention was
the direct root cause of a real pre-fill bug on 4 of those screens
(`workflow-stage-form`, `lookup-value-form`, `public-holiday-form`,
`role-form`) — the list component rendered the form directly inside
`p-dialog` with no `@if` wrapping it, so the form's `ngOnInit()`-based
pre-fill only ever ran once, on first mount, and silently kept
showing stale data from whichever record was edited *first* on every
subsequent open. Full empirical writeup (including the throwaway
Angular TestBed specs that settled the mechanism before any component
code was written) in `backend/Plans/step-29-shared-edit-dialog.md`.

**Public API**: `visible` (input, required), `header` (input),
`content` (input, required — a `TemplateRef<unknown>`, not projected
`<ng-content>`), `width` (input, default `'560px'`), `visibleChange`
(output). Callers pass their form via a sibling `<ng-template #tpl>`
captured through `@ViewChild('tpl', { read: TemplateRef, static: true })`
— matching PrimeNG's own `<ng-template pTemplate="...">` idiom already
used throughout this codebase (e.g. `p-table`'s row templates), not a
new convention.

**Why `TemplateRef` + `ngTemplateOutlet`, not `<ng-content>`** — this
is the load-bearing correctness property and must not be "simplified"
away: content projection does **not** create a fresh instance of a
projected component when only a *wrapper's own* `@if` toggles
(confirmed empirically via a throwaway TestBed spec — the projected
component's view is instantiated by the *caller's* context, and a
wrapper's internal `@if` only controls whether the `<ng-content>` slot
renders, not whether the projected component exists). A shared dialog
built on `<ng-content>` would have silently reproduced the exact same
bug at the wrapper level, for every screen that adopted it.
`ngTemplateOutlet` re-attached inside the wrapper's own `@if(visible())`
does create a genuinely fresh embedded view (and a fresh component
instance, with `ngOnInit()` re-firing correctly) every time — also
confirmed empirically before any production code was written.

**Also built in, not left as a per-screen concern**:
- A scroll-discoverability affordance (`ResizeObserver`-driven
  bottom-edge fade + chevron) that appears only when a form's content
  actually exceeds the dialog's `max-h-[60vh]` scroll area, and stays
  correctly absent on short forms — free for every consumer, current
  and future.
- `overscroll-behavior: contain` on PrimeNG's own
  `.p-select-list-container` **and `.p-multiselect-list-container`**
  (ACC-36 widened the original single-selector rule after finding it
  left every `p-multiSelect`-in-dialog screen unprotected — confirmed
  directly against PrimeNG's source that the two components render
  their listbox under genuinely different class names), scoped via
  `:host ::ng-deep`. Fixes a separate but adjacent bug found during
  this component's own verification: PrimeNG's connected overlays
  (`p-select`, `p-multiselect`, etc.) hide themselves on *any* scroll
  of a scrollable ancestor of their trigger rather than repositioning;
  with `appendTo` defaulting to `'self'`, an open dropdown's own
  listbox lives inside this component's scroll area, so scrolling the
  listbox to its own boundary let the browser's native scroll-chaining
  bleed into the dialog's ancestor scroll and close the dropdown
  mid-scroll — matches a known, unresolved upstream issue
  (`primefaces/primeng#14519`).
  **The CSS rule alone is not fully sufficient** — ACC-36 live-measured
  a ~2px scroll leak reaching this component's scroll area on some
  wheel ticks even while the listbox had plenty of room left (nowhere
  near its own boundary), enough to fire a genuine native `scroll`
  event and trigger the close-on-scroll behavior anyway. A `(wheel)`
  handler on `#scrollArea` (`onWheel()`) closes the remaining gap:
  once a listbox has genuinely exhausted its own scroll room in the
  gesture's direction, `preventDefault()` on that specific tick stops
  the browser from doing anything with the leftover delta at all —
  every other (non-boundary) tick is left completely untouched.
  Root cause and fix confirmed via direct inspection of PrimeNG's
  `Overlay` source (`bindScrollListener()` listens to the native
  `scroll` event, not `wheel` bubbling — ruling out a `stopPropagation()`
  approach) and Angular's compiled `(wheel)` binding (not passive by
  default, so `preventDefault()` is never silently ignored). Live-
  verified with genuine, repeated mouse-wheel gestures (5 separate
  fresh gestures, not one — the leak is specifically a first-tick-of-
  a-gesture phenomenon), not a proxy.
- **`p-listbox`, not `p-multiselect`, is the REQUIRED pattern for any
  NEW inline multi-select-inside-a-dialog need** (ACC-36). This is
  structural immunity, not a style preference or an extra layer of
  mitigation on top of the two fixes above: confirmed via direct
  source inspection that `primeng-listbox.mjs` contains zero
  references to `Overlay`, `ConnectedOverlayScrollHandler`,
  `appendTo`, or any connected-overlay mechanism anywhere — `p-listbox`
  renders inline, as an ordinary part of the page's own DOM flow, not
  as a floating panel that can be told to hide itself on ancestor
  scroll. There is no scroll-triggered close-on-scroll logic to defeat
  in the first place, so the entire bug category above is structurally
  impossible for it, not merely patched. `UnassignedTasksComponent`'s
  Reassign dialog (originally `p-multiSelect`) was migrated to
  `p-listbox` (`[multiple]="true" [checkbox]="true"`) for exactly this
  reason. `p-multiselect`/`p-select` remain supported (the CSS fix
  above still covers them) for cases where a true collapsed-by-default
  dropdown is the right UX — `p-listbox` is always-expanded, which is
  not appropriate everywhere — but a new multi-select *inside a
  dialog* specifically should default to `p-listbox` unless a
  collapsed dropdown is a real requirement.

**Confirmed consumers (8 screens migrated ACC-29 Phases 2–3, one more
added ACC-36)**: `workflow-stage-list` (stage edit), `lookup-value-list`
(value add/edit — its separate override-label dialog, Section 6.6, is
untouched and correctly stays a plain `p-dialog`: it binds directly to
the parent list's own `overrideForm` object via `[(ngModel)]`, not a
`*-form.component.ts` with its own lifecycle, so it was never subject
to this bug), `public-holiday-list`, `role-list`, `position-list`,
`committee-list` (add-only), `committee-detail` (both its
committee-edit and add/edit-member dialogs), `org-unit-tree`, and
`unassigned-tasks` (its Reassign dialog — built ACC-34 as a standalone
`p-dialog` bypassing this component entirely, migrated ACC-36 after
that gap was found to be the precondition for the scroll-chaining bug
above).
`task-list`/`task-form` is **not** a consumer — confirmed create-only,
no edit-via-dialog flow exists there at all, so it was never subject
to the bug this component exists to fix and still hand-rolls its own
single-purpose add dialog.

**Required pattern going forward** — every future module's own
add/edit dialog (starting with Meeting Management, the next module in
the build sequence) must use `EditDialogComponent`, not a raw
`p-dialog` + manual `@if`. A new module reaching for the old pattern
would be re-deriving a bug this component already closed.

**Extended to `app-shell`'s own `<main>` (ACC-38)** — the CSS rule and
`onWheel()` boundary-guard above were originally scoped only to this
component's own scroll area, but PrimeNG's `ConnectedOverlayScrollHandler`
(`DomHandler.getScrollableParents()`) binds close-on-scroll to *every*
scrollable ancestor of a picker's trigger, not just a dialog's — and
`AppShellComponent`'s `<main class="flex-1 overflow-auto p-4">` wraps
every routed page in the app, sharing the identical precondition.
Confirmed live: `/working-calendar`'s `<main>` is genuinely scrollable
(853px content vs 788px viewport) with a 14-option `p-select` inside
it that needs internal scroll. `frontend/src/app/layout/app-shell/app-shell.component.ts`
now carries the exact same CSS rule and an `onWheel()` mirroring this
component's own, verbatim — not a redesign. Both layers coexist safely
when a dialog is opened on top of a page (confirmed via direct DOM
traversal + a dispatched boundary-condition `WheelEvent`): a bubbling
event passes through both handlers, both compute the same boundary
condition, and a redundant `preventDefault()` call is harmless by
construction. **Not fully proven end-to-end**: Playwright's synthetic
`mouse.wheel()` could not reproduce genuine browser-level scroll-chaining
reaching `<main>` either before or after this fix, so it could not
demonstrate a before/after difference — only a direct `WheelEvent`
dispatched straight at the list container confirmed the handler is
wired and computes the correct boundary condition. Real hardware
mouse/trackpad verification is still open.

### 10.6 `WorkflowTransitionActionsComponent` — the Generic Reuse Pattern

`frontend/src/app/foundation/workflow/components/workflow-transition-actions/`.
Already documented as a CLAUDE.md Key Architecture Decision (ACC-22);
this section confirms the claim directly against the component's own
code rather than restating the decision log.

- **Zero object-type-specific logic** — takes only a
  `WorkflowInstanceDto` as input; renders one `p-button` per transition
  available from the instance's *current* stage (resolved by loading
  the full `WorkflowTemplate` and finding the stage matching
  `instance.currentStageId`, not a separate "available transitions"
  endpoint).
- **Client-side permission filtering is explicitly UX-only** — code
  comment states it directly: *"just avoids showing a button that would
  403 on click"* — `WorkflowService.triggerTransition()` re-validates
  `requiredPermission` server-side regardless (Section 2.4, step 3 of
  the gating trace).
- **Transition labels use `isArabic()`, never `| translate`** — the
  exact call site Section 9.3 already cited (`transitionLabel()`,
  `.isArabic() ? transition.labelAr : transition.labelEn`), with the
  component's own comment giving the identical reasoning: transitions
  are tenant-editable data, not fixed app strings.
- **Known, self-documented limitation, restated from the code
  directly**: does not filter on `triggerCondition` — a
  `SYSTEM_AUTOMATIC` transition would render as a clickable button
  today if one were ever seeded (it would then fail server-side per
  Section 2.4's gating, just with a confusing UX rather than the button
  never appearing). The comment explicitly flags this as deferred, not
  forgotten, "since no shipped workflow seed uses anything but
  ROLE_BASED today."
- **Confirmed consumers**: exactly one —
  `committee-detail.component.ts` — consistent with Section 2.11's
  finding that Committee is the only module currently driving real
  `WorkflowInstance`s through the engine. The component is built
  generic and ready for reuse; nothing has reused it yet because
  nothing else needs to yet.

---

## 11. Known Cross-Cutting Gaps

**✅ Complete — built incrementally as each of Sections 1–10 above was
written, not compiled from memory at the end**, then fully re-verified:
every "zero frontend callers found" claim in this document was re-run
with a multiline-aware search after `overrideLabel()` was found to be a
false negative (see the methodology note in Tier 4) — nothing else
changed. Exists so a future plan can check "is this already a known
gap" before re-investigating from scratch — see this document's own
Purpose section, written directly in response to the ACC-28 incident.

### Tier 1 — Urgent, cheap, worth acting on before/alongside finishing this document

- **CLOSED (ACC-33)** — **CI tenant-isolation gate has a real blind spot** (Section 8.4) —
  `task.service.spec.ts` and `org-position.service.spec.ts` lack a test
  named exactly `"should NOT return records belonging to a different
  tenant"`, despite the CI job existing specifically to catch this.
  `--passWithNoTests` means a module with zero matching tests still
  passes green — silent, not loud, non-coverage. Both files turned out
  to already have genuinely correct, properly branching-mock isolation
  tests — just titled one word off (`"...tasks belonging to..."`,
  `"...positions from..."`) and so silently excluded from the gate.
  Renamed all 4 to the exact matching string rather than writing new
  tests, since the existing logic was already sound.
- **CLOSED (ACC-33)** — **Role/permission changes do not revoke an existing session**
  (Section 1.2 correction) — only `UserService.deactivate()` calls
  `invalidateUserSessions()`. A user stripped of a role (e.g.
  `TENANT_ADMIN`, `committees:approve`) keeps full old access on their
  existing JWT for up to 15 minutes. `tenant.guard.ts`'s own header
  comment claims this is covered; it isn't, confirmed via grep showing
  zero `tokenVersion`/`invalidateUserSessions` references anywhere in
  `role.service.ts`. `tenant.guard.ts`'s comment corrected to state the
  real behavior — documentation only, no behavior change.
- **CLOSED (ACC-33)** — **`CREATE_TASK` → `COMMITTEE` `TaskSourceType` mapping gap fires
  silently today, not theoretically** (Section 2.9) — the seeded
  `formation → terms_review` transition configures `CREATE_TASK` as its
  only non-audit action; `mapObjectTypeToTaskSourceType()` returns
  `null` for `COMMITTEE`, so task creation is skipped every time that
  transition fires, with nothing else to compensate. `COMMITTEE` added
  to `TaskSourceType` (migration), mapping wired, live-verified against
  the demo tenant. Two more hardcoded source-type lists found stale the
  same way while fixing this (`CreateTaskDto.TASK_SOURCE_TYPES`,
  `TaskController.getForSource()`'s query-param union type) — fixed too.
- **CLOSED (ACC-33)** — **`OrgUnit.deactivate()`'s Users blocker check is stale, not merely
  deferred** (Section 7.2) — its own TODO cites "Step 9 — Users" as the
  blocker; Users shipped at ACC-12. Deactivating a unit with active
  users assigned to it succeeds today with no warning. Wired against
  `User.primaryOrgUnitId` (the TODO's own stale draft used a
  nonexistent field name), live-verified against the demo tenant.
- **CLOSED (ACC-33)** — **CLAUDE.md's "Prisma middleware injects organizationId
  automatically" is false** (Section 8.1) — labeled a "Non-Negotiable"
  rule; no such mechanism exists anywhere in `prisma.service.ts`. Every
  tenant-scoping guarantee in this codebase is manual, per-service-method
  developer discipline, backed only by the Tier 1 CI gate above (itself
  confirmed to have real blind spots). CLAUDE.md corrected to describe
  the real mechanism.
- **CLOSED (ACC-33)** — **`ORG_UNIT_HEAD` assignee resolution throws an unconditional
  `Error`, not a graceful skip** (Section 2.5) — nothing in the
  frontend's unfiltered strategy dropdown prevents a tenant admin from
  selecting it; currently unexercised by any seed data (which is the
  only reason this is Tier 1-adjacent rather than a live incident), but
  the first tenant to configure it will crash that transition outright.
  `resolveAssigneeRaw()` now resolves to `[]` instead of throwing,
  matching every other case in the same switch; removed from the
  frontend's assignee-strategy dropdown until genuinely implemented.
  **Update (ACC-40)** — genuinely implemented now: `resolveAssigneeRaw()`
  and `resolveApproverPool()` both gained real `ORG_UNIT_HEAD` cases
  (Section 5.8) calling `OrganizationService.resolveActingHeadForOrgUnit()`
  (Section 5.3), and it's back in `workflow-stage-form.component.ts`'s
  dropdown. Still "wired, not yet reachable in practice" for every real
  tenant today — no workflow-driven object (`Committee`, `Meeting`) has
  an `orgUnitId` field yet, so both cases read it via a defensive cast
  against a field the real Prisma type doesn't carry — but the crash
  risk this entry originally flagged is fully closed: a tenant
  configuring this strategy today gets `[]` (an empty, correctly-handled
  pool), never a crash.
- **CLOSED (ACC-33)** — **Unassigned-transition detection (Section 2.13) covers `ASSIGNEE_POOL`
  only — `ROLE_BASED`/`SPECIFIC_USER` have the same underlying risk,
  undetected** (ACC-28, deliberately scoped out — see the plan's
  Pending Discussion #1). `ROLE_BASED` gating (nobody in the tenant
  holds `triggerRoleId`) and `SPECIFIC_USER` gating (the named
  `triggerUserId` was deactivated) can each make a transition
  permanently unreachable the same way an empty `ASSIGNEE_POOL` pool
  does — with zero notification to anyone. Not folded into ACC-28
  because each needs a structurally different check (`ROLE_BASED`'s
  equivalent is "does anyone hold this role," independent of the
  stage's `assigneeStrategy`/pool entirely — not a generalization of
  `resolveUnassignedBlockingTransitions()`), a real scope expansion
  rather than a cheap add-on. `resolveUnreachableTriggerConditionTransitions()`
  added as a genuinely separate resolver, combined with the existing
  one via array concatenation at both call sites (entry-time check,
  `SlaMonitorProcessor`'s periodic sweep) — verified as a real union
  (not one masking the other) with a dedicated two-transition test, and
  live-verified end-to-end against the demo tenant.

### Tier 2 — Real, confirmed gaps, not urgent, worth bundling into follow-up tickets

- **CLOSED (ACC-33)** — `submitApproval()` has zero authorization check beyond authentication
  (Section 2.8) — confirmed currently unreachable via any UI (Section
  2.12), so a backend-only risk today, not a live one through this
  app's own screens. Now reuses `resolveApproverPool()` — the same pool
  `isApprovalThresholdMet()` already trusts for this exact stage —
  rejecting an actor who isn't in a resolved COMMITTEE/ROLE pool,
  mirroring `triggerTransition()`'s existing `ASSIGNEE_POOL` pattern.
- Lookup `updateCategory()`/`deactivateCategory()` — the exact
  endpoints ACC-17 hardened with `PlatformGuard` — have zero UI
  anywhere, not even in the Super Admin Portal (Section 6.6).
- Task: no detail view, no evidence-upload UI (Section 3.7) — two
  remaining gaps, backend fully supports both (`getById()`,
  `addEvidence()` still zero frontend callers).
- **CLOSED (ACC-34)** — Task: no reassignment UI (Section 3.7) —
  `reassign()` had zero frontend callers despite `TaskController` fully
  supporting it. Closed by the new Unassigned Tasks view
  (`GET /tasks/unassigned`, gated by `tasks:manage` — also closing that
  permission's "currently inert" note below), which calls `reassign()`
  as-is, unmodified.
- **CLOSED (ACC-40)** — Three workflow-gating call sites checked the
  raw, non-OOO-substituted assignee/approver pool instead of the
  OOO-aware `resolveAssignee()`/`resolveApproverPool()` result already
  used for `CREATE_TASK`/`SEND_NOTIFICATION` targeting: `triggerTransition()`'s
  `ASSIGNEE_POOL` gate (2.4), `resolveApproverPool()` itself (2.6, which
  feeds both `submitApproval()`'s eligibility gate and
  `isApprovalThresholdMet()`'s pool-sizing calc), and
  `resolveUnassignedBlockingTransitions()` (2.13). Net effect before the
  fix: an out-of-office holder with a valid acting user set could still
  block the very transition/approval/task their coverage was supposed
  to unblock, and a stage could be misreported as unassigned even with
  working coverage in place. Found during ACC-40 planning (re-verifying
  backward compatibility against already-shipped ACC-28/33 code, not a
  new feature investigation); fixed by routing all three through the
  existing `applyOutOfOfficeRouting()` helper — no new mechanism.
- Task: out-of-office substitution is missing for tasks created
  directly via `POST /tasks` (Section 3.5) — only workflow-engine-driven
  `CREATE_TASK` gets it, because the substitution logic lives upstream
  in `WorkflowService`, not in `TaskService` itself. No coverage-gap
  notification fires for this path either, same reason.
- **CLOSED (ACC-40)** — `OrgPositionService.deactivatePosition()` had
  no `reactivatePosition()` counterpart (Section 5.2), unlike `Role`.
  Closed: `reactivatePosition()` now exists, mirroring
  `RoleService.reactivateRole()` exactly (Section 5.2).
- **`OrgUnitHeadService.assignActingHead()`/`clearActingHead()` have
  zero HTTP surface** (Section 5.6) — found during this Phase 10
  documentation pass, not previously written down anywhere. Both
  methods are real, correctly implemented, and unit-tested, including
  their role-grant/revoke side effects, but no controller route exposes
  either one (`OrgUnitHeadController` stops at `assignHead`/
  `vacateHead`/`declareHandover`/`completeHandoverNow`/`cancelHandover`)
  and the frontend `OrgUnitHeadService`/`OrgUnitHeadPanelComponent` have
  no Acting Head UI to match. No tenant admin can reach Acting Head
  coverage through the product today — the only path in is a direct
  service call. Straightforward to close (two routes + one DTO
  wire-up + a panel section mirroring the existing assign/vacate/
  handover forms) whenever Acting Head coverage is actually needed by a
  real workflow (most directly: once a workflow-driven object gains an
  `orgUnitId` field and `ORG_UNIT_HEAD`, Section 5.8, gets a real
  consumer — Acting Head coverage is what makes that consumer's vacant-
  unit case resolvable instead of fully-unresolved).
- **CLOSED (ACC-34)** — `tasks:manage` was seeded into role permission
  sets but never checked by any `@Permissions()` decorator anywhere in
  `task.controller.ts` (Section 3.6) — currently-inert permission
  string. Closed: now gates `TaskController.getUnassigned()`, its first
  real consumer.
- **User departure does not reassign or flag Committee memberships**
  (Section 12.3) — `UserService.deactivate()` calls
  `TaskService.reassignAllForUser()` only. module-designs.md's Absence
  and Departure Management design explicitly names "Committee seat
  replacement when member departs" as part of this flow; it isn't
  built. A departed user's active `CommitteeMember` rows (including a
  Chairman seat, once ACC-28 ships) are left exactly as they were —
  no notification, no flag, nothing surfaces it to a Tenant Admin.
- **AI provider selection is a confirmed 3-layer gap, not a UI-only
  gap** — no dedicated section exists for this yet (no Auth/Storage-
  style "AI Provider" section in 1–10 above), so documented here.
  Verified directly against the code and the live AI Settings page
  (`/admin-settings/ai-settings`, logged in as the demo tenant admin):
  (1) the only UI exposed is credit allocation/usage
  (`monthlyCredits`/`creditsRemaining`/`creditsUsed`/`overageEnabled`,
  read from `GET /tenant`'s `ai` field, written via `PATCH
  /tenant/ai-settings`) — no provider selector, no API key field
  anywhere in `ai-settings.component.ts`; (2) `Organization.aiProvider`
  (enum) is technically writable via the existing `PATCH /tenant` →
  `UpdateTenantDto.aiProvider`, but `Organization.aiConfig` (the
  actual credential blob `AnthropicAiProvider.resolveApiKey()` reads
  via `decryptTenantConfig()`) has zero write path in any DTO or
  controller anywhere in the backend — confirmed via grep; (3) even if
  both existed, the `AI_PROVIDER` NestJS DI token is bound once,
  platform-wide, in `tenant.module.ts` — `{ provide: AI_PROVIDER,
  useClass: AnthropicAiProvider }` — and nothing anywhere reads
  `org.aiProvider` at runtime to select between implementations; no
  `AzureOpenAiProvider`/`OpenAiProvider`/`OllamaProvider` class exists
  to select between in the first place.
  A real pricing-model design question this surfaced has now been
  resolved — full resolution in CLAUDE.md's "AI Providers Per Tenant"
  section and its Open/Deferred Items entry: tenant-facing "bring your
  own API key" was considered and explicitly rejected. A tenant admin
  SELECTS a provider, but AccreditMe's own platform-level key (one per
  provider) is used regardless of selection, for Tier 1/2 only — this
  keeps the existing AI credit system (`Organization.settings.ai`,
  `AiCreditPack`, `AiFeatureCost`) fully intact and in AccreditMe's
  control. Tier 3 is a separate, non-credit-metered annual-license
  model, so a Tier 3 platform admin configuring a self-hosted model
  (e.g. Ollama) doesn't conflict with this resolution. Still correctly
  deferred — build only when a real AI feature or the Tenant
  Onboarding wizard actually needs it (`AIProvider` has zero real
  consumers app-wide today) — but the design question itself is now
  settled, so the eventual build should not default back to a generic
  bring-your-own-key implementation. The full design also includes a
  quality-tier selection (Standard/Premium) with a conservative
  cross-provider pricing rule — see CLAUDE.md's "AI Providers Per
  Tenant" section for the complete resolution, not duplicated here.

### Tier 3 — Correctly deferred, no action needed now (listed for completeness)

- `SEQUENTIAL` approval mode is treated identically to `PARALLEL` +
  `ALL` — no ordered-roster mechanism exists in the schema (Section
  2.7). Matches the code's own documented acknowledgment.
- 3 of 4 documented validator conditions (`requiredFields`,
  `minAttachments`, "all previous stage tasks completed") are
  unenforced — only `minApprovals` is real (Section 2.10). Documented
  in-code as blocked on a caller-supplied object snapshot no functional
  module exists yet to provide.
- `isCodeLocked`'s enforcement is real but its trigger doesn't exist —
  blocked on Document Management (Section 7.3).
- `addEvidence()`'s `INTERNAL_REFERENCE` evidence shows a raw id
  instead of a resolved display name — blocked on a functional module
  existing to resolve one (Section 3.2).
- `SMS` notification channel and digest mode are both blocked on
  providers/mechanisms that don't exist yet (Section 4.4).
- WebSocket-vs-polling: CLAUDE.md describes real-time delivery that was
  never built; 30-second polling is the actual mechanism and works
  correctly (Section 4.4) — not broken, just aspirationally documented.
- `ROUND_ROBIN` assignee strategy is byte-identical code to `ROLE`,
  with no rotation/history logic at all (Section 2.5) — documented
  in-code as a known limitation; unexercised by any current seed data.
- `OrganizationService.update()`'s cycle detection only catches direct
  self-parenting (`parentId === id`), not a deeper multi-level cycle
  through a descendant (Section 7.2) — unexercised today, same shape as
  the rest of this tier.
- `User.status`'s `SUSPENDED` value is fully enforced at the login gate
  but never assigned anywhere (Section 12.2) — same dormant-value shape
  as `OrgUnit.isCodeLocked` and the `SMS` notification channel. Worth
  knowing if a future design assumes tenant admins can suspend (vs.
  fully deactivate) a user — that capability doesn't exist today.

### Tier 4 — Trivial doc/cleanup items

- `org_unit_type` is a real seeded SYSTEM lookup category (12 total,
  confirmed by direct count) but is missing from CLAUDE.md's own
  "System Lookup Categories" list, which only names 11 (Section 6.1).
- CLAUDE.md's "session restore → language resolution → platform/tenant
  permission loading" describes the app initializer as three flat
  sequential steps (Section 9.2). The actual code is two top-level
  calls (`restoreSession()` → `loadAccess()`), with language resolution
  nested inside the first. The effective order is correct — not a
  functional bug — just a structural imprecision in how CLAUDE.md
  phrases it.
- `en.json`/`ar.json` key parity was checked only by line count (486
  lines each, Section 9.4) — a real key-diff was not run. Cheap
  follow-up, not claimed as verified.
- **Methodology note — a near-miss worth keeping, not discarding now
  that it's resolved.** `overrideLabel()` (Section 6.6) was briefly and
  incorrectly flagged as having zero frontend callers, then corrected
  after a full re-verification pass across every "zero callers" claim
  in this document. Root cause, confirmed directly: the original grep
  pattern (`lookupService\.overrideLabel\(`) requires both tokens on
  the same line, and ripgrep matches per-line by default. The actual
  call site breaks the chain across lines —
  `this.lookupService` / `.overrideLabel(val.id, { ... })` — because
  the call takes a multi-line object-literal argument. Every other
  method checked in that same original pass happened to be written as
  a single-line chain, so only this one call site was missed; it was a
  formatting accident of that specific site, not a flaw specific to
  this method's meaning. The same shape produced a near-miss on
  `task-form.component.ts`'s `.create({` in Section 3.7 (caught at the
  time by widening the search after the method didn't appear where
  expected). **Standing rule for future updates to this document**: any
  "zero frontend callers found" claim must be verified with a
  multiline-aware grep (or by reading the component directly) before
  being written down — a single-line pattern is not sufficient on its
  own to conclude a method is unused.

---

## 12. User Management

`backend/src/foundation/user/user.service.ts` +
`backend/src/foundation/auth/auth.service.ts`. Two services, two
tables, deliberately split — 12.1 covers why.

### 12.1 The Two-Table Identity Split

AccreditMe's own business-data table is `User` — tenant-scoped, holds
everything the rest of the app cares about. Authentication identity
lives in a **separate set of tables Better Auth owns**, linked 1:1:

```prisma
model User {                          // "AppUser" — our own table
  id               String       @id @default(cuid())
  organizationId   String
  email            String
  name             String
  status           UserStatus   @default(INVITED)   // see 12.2
  tokenVersion     Int          @default(0)          // Section 1.2
  language         String?                            // Section 9.2
  positionId       String?                             // Section 5.1
  primaryOrgUnitId String?                             // Section 7.1
  outOfOfficeFrom  DateTime?
  outOfOfficeTo    DateTime?
  actingUserId     String?     // self-referential — Absence Pattern 1
  managerId        String?     // self-referential — org reporting line
  authUserId       String?     @unique   // FK to AuthUser, below
  invitationToken     String?  @unique
  invitationExpiresAt DateTime?

  @@unique([organizationId, email])
}

model AuthUser {                      // Better Auth's own identity table
  id               String    @id @default(cuid())
  email            String    @unique   // "{organizationId}:{email}" — see 12.1.1
  emailVerified    Boolean   @default(false)
  twoFactorEnabled Boolean   @default(false)
  appUser          User?     // back-relation to the FK above
  sessions         AuthSession[]
  accounts         AuthAccount[]       // password hash (Argon2id) lives here
  twoFactor        AuthTwoFactor?
}
```

`AuthSession`, `AuthAccount` (holds the Argon2id password hash for the
`credential` provider — OAuth-only fields present but unused, kept
because Better Auth's adapter needs the full generic schema
unconditionally), and `AuthTwoFactor` (TOTP secret + backup codes,
encrypted by the plugin itself with XChaCha20-Poly1305, not custom
encryption) all belong to Better Auth's side, not `User`. `User` has no
password field, no session table, no TOTP secret anywhere on it —
`authUserId` is the only bridge.

**12.1.1 — the namespacing trick**: `AuthUser.email` is globally unique
(Better Auth's own constraint, not tenant-aware), but the same person's
email must be able to exist independently across tenants. Resolved by
never storing the raw email in `AuthUser.email` — every call constructs
`"{organizationId}:{email}"` (`AuthService.namespacedEmail()`) before
touching Better Auth's API. `User.email` (our own table) stores the
real, unnamespaced address; the namespacing is entirely an
`AuthUser`-side implementation detail, invisible everywhere else.

### 12.2 `UserStatus` Lifecycle — One Value Is Real But Dormant

```prisma
enum UserStatus { ACTIVE, INACTIVE, INVITED, SUSPENDED }
```

- `INVITED` → set by `UserService.invite()`, the initial state.
- `ACTIVE` → set by `AuthService.acceptInvitation()` once signup
  completes.
- `INACTIVE` → set by `UserService.deactivate()`, the departure flow
  (12.3).
- **`SUSPENDED` is enforced but never set.** `AuthService.login()`
  (line 204) and `verifyMfa()` (line 365) both gate on
  `user.status !== 'ACTIVE'` — a suspended user genuinely could not log
  in, the check is real. But grepped every write to `User.status`
  across `backend/src`: only `INVITED`/`ACTIVE`/`INACTIVE` are ever
  assigned, by the three methods above. **No controller endpoint, no
  service method, sets `SUSPENDED`.** Structurally identical shape to
  `OrgUnit.isCodeLocked` (Section 7.3) and `Notification`'s `SMS`
  channel (Section 4.4) — a real, correctly-enforced value with no
  current trigger, not a bug, but worth knowing it's not reachable
  today if a design assumes tenant admins can suspend (vs. fully
  deactivate) a user.

### 12.3 `UserService` Methods

- **`invite()`** — enforces `Organization.maxUsers` (the seat-limit
  half of CLAUDE.md's Plan model) by counting `ACTIVE`+`INVITED` users
  together before allowing a new invite — `ConflictException` at the
  limit, matching CLAUDE.md's "Hard limits at 100%... no data
  corruption" pattern. Generates a 24-byte hex `invitationToken`, 7-day
  TTL (`INVITATION_TTL_MS`). Sends the invitation as an `EMAIL`-channel
  notification containing the raw accept-invitation URL with the token
  as a query param — the token itself is the only credential; anyone
  with the link can accept it (expected, matches the pattern of any
  email-based invitation flow).
- **`updateProfile()`** — the self-vs-admin split confirmed directly:
  `isSelf = actorId === id`, `isAdmin = actorPermissions.includes('users:manage')`,
  rejects if neither. Admin-only fields (`positionId`,
  `primaryOrgUnitId`, `managerId`) are **silently excluded from the
  update payload**, not rejected with an error, when a non-admin edits
  their own profile — confirmed via the `if (isAdmin) { ... }` block
  building the `data` object conditionally. A non-admin submitting a
  `positionId` change in their own profile edit gets a `200` with the
  field quietly ignored, not a `403` telling them why it didn't apply.
- **`updateOutOfOffice()`** — same self-vs-admin gate. Validates
  `actingUserId` (if given) resolves to an `ACTIVE` user in the same
  tenant before accepting it — this is the write side of Absence
  Management Pattern 1; `WorkflowService.applyOutOfOfficeRouting()`
  (Section 2.5.1) is the read side that actually substitutes it during
  assignee resolution.
- **`deactivate()`** — the full departure flow, and the ordering is
  explicitly non-negotiable per its own code comment: `tokenVersion`
  increments (via `authProvider.invalidateUserSessions()`) **before**
  `TaskService.reassignAllForUser()` runs, so the departing user's
  sessions are dead the instant the flow starts, not after it finishes.
  **Last-admin lockout**: queries the tenant's active `TENANT_ADMIN`
  holders **before** flipping status (ACC-16's fix — querying after
  would silently exclude the departing user from their own admin count
  and, in the exact last-admin scenario the check exists to catch,
  notify no one). Delegates task reassignment entirely to
  `TaskService.reassignAllForUser()` (Section 3.2) — this method itself
  does not touch `Task`/`TaskAssignee` rows directly. **What's
  confirmed NOT covered by this flow**: Committee memberships and
  workflow-stage assignments — module-designs.md's Absence and
  Departure Management design names both as needing reassignment on
  departure ("Committee seat replacement when member departs"), but
  `deactivate()` only calls `TaskService`. A departed user's active
  `CommitteeMember` rows are left exactly as they were.
- **`getUserRoles()`/`assignRoleToUser()`/`removeRoleFromUser()`** —
  pure pass-through delegations to `RoleService` (Section 1.4),
  confirmed by reading them directly: each is a single-line
  `return this.roleService.X(...)` with no added logic. Exist on
  `UserController` for URL-path convenience
  (`/users/:id/roles` reads better than a separate `/roles` sub-resource
  controller) — code comment states this migration happened in Step 9,
  same behavior, same underlying `RoleService` ownership.

### 12.4 Invitation Acceptance — `AuthService.acceptInvitation()`

Looks up the user by `invitationToken`, rejects generically ("Invalid
or expired invitation") if missing or past `invitationExpiresAt` —
**deliberately generic, code comment states why**: never reveal whether
a token was ever valid, standard anti-enumeration practice. On success:
calls Better Auth's `signUpEmail()` with the namespaced email (12.1.1),
links the resulting `AuthUser.id` as `User.authUserId`, flips
`status: ACTIVE`, clears the token/expiry. **The ACC-25 fix, confirmed
directly in the code comment**: unlike `login()` (which always returns
a generic message to avoid enumeration), this method lets a real Better
Auth `APIError` throw naturally — the global `HttpExceptionFilter`
(ACC-27) forwards its actual message app-wide, so a genuinely useful
error like the `haveIBeenPwned` plugin's password-compromised rejection
reaches the user instead of a generic "invalid token" message. This is
the literal ACC-25/ACC-26/ACC-27 chain CLAUDE.md's Build Sequence
documents, confirmed against the real code rather than restated from
the log.

### 12.5 Login, Lockout, and MFA — Brief, Cross-Referenced

- **`login()`** resolves the tenant from `organizationSlug`, checks
  `LoginAttemptService.isLocked()` **before** attempting
  authentication (locked attempts are themselves recorded as a failed
  `LoginAttempt` row, `failureReason: 'locked'`), then calls Better
  Auth's `signInEmail()`. A `twoFactorRedirect` response forwards
  Better Auth's own pending-2FA cookie to the browser and returns
  `{ mfaRequired: true }` rather than completing login. Every attempt
  — locked, invalid password, or success — is recorded in
  `LoginAttempt`, an append-only-by-convention table (not
  schema-enforced append-only like `AuditLog`, Section 1) that
  "powers account lockout (computed on read, no stored counter)" per
  its own schema comment — lockout state is derived by querying recent
  rows, not tracked as a running counter anywhere.
- **`verifyMfa()`** completes the login Better Auth's `signInEmail()`
  paused for 2FA, gating on the same `status !== 'ACTIVE'` check as
  `login()` itself (12.2).
- **MFA setup** (`setupMfa()`/`verifySetupMfa()`/`disableMfa()`) is a
  three-step flow, not a single call: `setupMfa()` re-verifies the
  caller's password (via a fresh `signInEmail()` — Better Auth's
  `enableTwoFactor()` requires a live session) and generates a TOTP
  secret, but **MFA is not active yet** — `verified` stays `false` on
  `AuthTwoFactor` and `AuthUser.twoFactorEnabled` stays `false` until
  `verifySetupMfa()` succeeds with a real code from the user's
  authenticator app. `disableMfa()` also re-verifies password before
  turning it off.

Full frontend-consumption detail for the Auth surface (`/auth/me`,
`/accept-invitation`, `/forgot-password`, `/reset-password`, the four
MFA routes) was already confirmed wired in Section 1.6 — not repeated
here.

### 12.6 Permission Model

```
users:view       — UserController: listUsers, getById
users:invite     — UserController: invite
users:manage     — checked INSIDE UserService for updateProfile/
                   updateOutOfOffice's self-vs-admin gate (12.3) — not
                   a @Permissions() decorator on those two routes,
                   which carry none, by design (self-service edits
                   must work without users:manage)
users:deactivate — UserController: deactivate. Deliberately separate
                   from users:manage — code comment ties this directly
                   to CLAUDE.md's "Forced logout on role change or
                   account suspension": a distinct, higher-stakes
                   action from editing a profile field, not folded
                   into the general management permission.
```

### 12.7 Frontend Consumption (Static Check)

`frontend/src/app/foundation/user/services/user.service.ts` — 6
methods, all confirmed with real callers via a multiline-aware search
from the start (per Section 11's standing rule):

| Method | Endpoint | Caller(s) found |
|---|---|---|
| `listUsers()` | `GET /users` | `committee-detail`, `committee-member-form`, `user-profile`, `user-list`, `invite-user` |
| `getById()` | `GET /users/:id` | `user-profile.component.ts:331` |
| `invite()` | `POST /users/invite` | `invite-user.component.ts:136` |
| `updateProfile()` | `PATCH /users/:id/profile` | `user-profile.component.ts:361` |
| `updateOutOfOffice()` | `PATCH /users/:id/out-of-office` | `user-profile.component.ts:394` |
| `deactivate()` | `POST /users/:id/deactivate` | `user-list.component.ts:180` |

**No dead endpoints in this system** — every method wired, and
`listUsers()` is reused across both User Management's own screens and
Committee Management's member-picker components, the same
cross-module-picker shape already seen for `OrgUnitService.getFlat()`
(Section 7.6) and `RoleService.listRoles()` (Section 1.6).
