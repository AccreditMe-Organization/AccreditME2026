# Step 8 — Task Management
# ACC-11: cross-module task management — multi-assignee, evidence,
# tenant-configurable SLA, and absence/departure-aware assignment routing

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

Check 1  Git State              PASS — on feature/ACC-11-task-management, clean
Check 2  Branch vs dev          INFO — branched from dev at dc7f1b8/e327ab0, 0 drift
Check 3  Backend TypeScript     PASS — npx tsc --noEmit → zero errors
Check 5  Test Suite             PASS — 270/270 tests passing (16 suites)
Check 7  Migration Status       PASS — 12 migrations, database up to date
Check 8  Schema Validation      PASS — schema.prisma is valid

OVERALL STATUS: 🟢 HEALTHY — ready to start ACC-11
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

Step 8 implements cross-module **Task Management** — the service every foundation
and functional module already assumes exists (`Task.workflowInstanceId` has sat
scaffolded and unused since Step 1; `WorkflowService.executeCreateTask()` has
directly created bare single-assignee `Task` rows since Step 6, exactly like the
two notification stubs Step 7 retired). This step:

1. **Redesigns the scaffolded `Task` model** from single-assignee (`assigneeId`)
   to multi-assignee (`TaskAssignee` junction, ANY-completes semantics), and
   from loosely-typed `objectType`/`objectId` to the CLAUDE.md-mandated
   `sourceType` (typed `TaskSourceType` enum) / `sourceId` (mandatory — "no
   standalone tasks").
2. **Adds `TaskEvidence`** — multi-item completion evidence (text, attachment,
   link, or an internal reference to another AccreditMe record).
3. **Makes task SLAs tenant-configurable** via a new `Organization.settings`
   JSON field (`taskSla: { CRITICAL, HIGH, MEDIUM, LOW }`, hours), computed
   through `WorkingCalendarService.calculateDeadline()` — never a module's own
   date math, per CLAUDE.md's non-negotiable rule.
4. **Ships the Task-facing half of Absence and Departure Management**
   (`module-designs.md`'s cross-cutting section, added this session): acting-user
   routing, manual reassignment with audit trail, and `UNASSIGNED` fallback when
   no eligible assignee exists.
5. **Migrates `WorkflowService.executeCreateTask()`** off its direct-Prisma stub
   onto the real `TaskService`, fixing a real bug along the way — the current
   stub only ever assigns `assigneeIds[0]`, silently dropping every other
   resolved assignee for `PARALLEL`/`COMMITTEE` stages (see Section 8).

### Why This Step Redesigns Existing Scaffold, Not Just Adds To It

Unlike Steps 6–7 (which extended partial-but-directionally-correct scaffolds),
Step 8's existing `Task` model scaffold (Step 1) needs **renaming and removing
fields**, not just adding to them:

```
Task.objectType (String?)   → RENAME to sourceType, RETYPE to TaskSourceType (required)
Task.objectId (String?)     → RENAME to sourceId, make required (no standalone tasks)
Task.assigneeId (String)    → REMOVE — replaced entirely by TaskAssignee junction
Task.delegatedToId (String?)→ REMOVE — replaced by TaskAssignee reassignment +
                               WorkflowService out-of-office routing, not a
                               task-level field
TaskStatus.DELEGATED        → KEPT, unused — removing enum values requires a
                               destructive migration; left in place harmlessly,
                               same precedent as NotificationChannel.SMS staying
                               unused after Step 7 added BOTH
```

This is a genuinely destructive-shaped migration (column drops), not additive —
flagged explicitly per `/prisma-change`'s Golden Rules, and safe only because no
functional module has created a real `Task` row yet (only `WorkflowService`'s
stub has, and only in local/dev testing — confirm zero production-meaningful
rows exist before dropping columns, per Section 2).

### Scaffold Already in Place (from Step 1 / Step 6 — do not blindly recreate)

```
Task model                 — EXISTS, partial — MODIFY (rename + remove fields, see above)
TaskStatus enum             — EXISTS (PENDING, IN_PROGRESS, COMPLETED, OVERDUE,
                               CANCELLED, DELEGATED) — MODIFY, add UNASSIGNED
TaskPriority enum           — EXISTS (LOW, MEDIUM, HIGH, CRITICAL) — no changes needed
TaskSourceType enum         — DOES NOT EXIST — CREATE
TaskEvidenceRefType enum    — DOES NOT EXIST — CREATE
TaskAssignee model          — DOES NOT EXIST — CREATE
TaskEvidence model          — DOES NOT EXIST — CREATE
Organization.settings       — DOES NOT EXIST — CREATE (Json?, houses taskSla)
TASKS_PERMISSIONS           — EXISTS in common/constants/permissions.ts, STALE —
                               currently { VIEW, MANAGE, DELEGATE } — MODIFY to
                               { VIEW, CREATE, REASSIGN, COMPLETE, MANAGE } per
                               this session's CLAUDE.md update (DELEGATE removed)
WorkflowService.executeCreateTask() — EXISTS, direct-Prisma stub exactly like
                               Step 6/7's notification stubs — MODIFY to call
                               TaskService.create(), fixing the assigneeIds[0]
                               truncation bug (see Section 8)
WorkingCalendarService.calculateDeadline() — EXISTS — reused as-is
AuditLogService              — EXISTS — AuditAction.DELEGATE already covers
                               "reassignment" semantics, no new enum value needed
OrgUnit.parentId             — EXISTS — reused for escalation org-unit-hierarchy check
NotificationService          — EXISTS (Step 7, @Global()) — reused directly
```

### Explicit Non-Goals / Sequencing Notes for This Step

- **No Subtasks** — deferred to Phase 3 per `module-designs.md`. Multi-assignee
  covers most real use cases.
- **Committee seat replacement on departure** (Absence and Departure
  Management's Pattern 2 for committees) is Step 10's responsibility, not this
  step's — Step 8 only builds the Task-side and `WorkflowService`-side pieces.
- **Out-of-office settings UI and departure bulk-reassignment UI** are Step 9's
  responsibility. See Section 12 (Pending Discussions) for the one schema
  question this creates for Step 8.
- **AI features** (Smart Task Creation, Workload Balancing, Evidence
  Suggestion, Overdue Pattern Analysis, Task Description Drafting, Coverage Gap
  Detection) all ship as documented stubs this step, matching the exact
  precedent Steps 6–7 set for `suggestWorkflowConfig()` — see Section 9.

---

## 2. PRISMA SCHEMA CHANGES

### NEW Model — `OrgPosition` (Commit 0a)

*Defines organizational hierarchy of positions/grades — used for escalation
validation (this step), and later by delegation authority, committee chair
authority, document approval authority, and audit team authority (see Section
7). Not the same as `OrgUnit.type` — `OrgUnit.type` describes department
structure; `OrgPosition` describes a user's seniority within their unit.*

```prisma
model OrgPosition {
  id             String       @id @default(cuid())
  organizationId String
  orgUnitId      String?                                       // null = org-wide position
  nameEn         String
  nameAr         String?
  grade          Int                                            // 1 = lowest, 10 = highest
  isActive       Boolean      @default(true)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization   Organization @relation(fields: [organizationId], references: [id])
  orgUnit        OrgUnit?     @relation(fields: [orgUnitId], references: [id])
  users          User[]                                         // reverse of User.positionId

  @@index([organizationId])
  @@index([orgUnitId])
  @@unique([organizationId, orgUnitId, nameEn])
}
```

Add to **User model**:
```prisma
positionId       String?
position         OrgPosition? @relation(fields: [positionId], references: [id])
primaryOrgUnitId String?                                        // ADD — see Section 12, item 5:
                                                                  // required for validateEscalationTarget()'s
                                                                  // org-unit check; independent of position,
                                                                  // since org-wide positions have no orgUnitId
                                                                  // of their own to fall back on
primaryOrgUnit   OrgUnit?     @relation(fields: [primaryOrgUnitId], references: [id])
```

Add to **OrgUnit model** (reverse relations):
```prisma
positions OrgPosition[]
users     User[]           // reverse of User.primaryOrgUnitId
```

**Migration name (Commit 0a):**
```
add_org_position_and_user_position_id
```
```bash
cd backend && npx prisma migrate dev --name add_org_position_and_user_position_id
```
Purely additive — new model, new nullable FK column on `User`, new reverse
relation on `OrgUnit`. No data-loss risk, unlike Commit 1's Task redesign
below.

---

### Task Schema Changes (Commit 1)

### New Enums

```prisma
enum TaskSourceType {
  MEETING
  DOCUMENT
  AUDIT
  CAPA
  INCIDENT
  CORRECTIVE_ACTION
  STANDARD
  KPI
  GAP
  QUALITY_IMPROVEMENT_PLAN
}

enum TaskEvidenceType {
  TEXT
  ATTACHMENT
  LINK
  INTERNAL_REFERENCE
}

enum TaskEvidenceRefType {
  DOCUMENT
  AUDIT
  INCIDENT
  CAPA
  MEETING
  STANDARD
  CORRECTIVE_ACTION
  GAP
}
```

### `TaskStatus` — Add `UNASSIGNED`

```prisma
enum TaskStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  OVERDUE
  CANCELLED
  DELEGATED    // kept, unused — see Section 1
  UNASSIGNED   // ADD — role-based fallback, Absence and Departure Management Pattern 3
}
```

**Why this reconciles two module-designs.md sections that briefly disagreed:**
the Task Management Module's own Data Models list (`status: PENDING |
IN_PROGRESS | COMPLETED | OVERDUE | CANCELLED`) predates the Absence and
Departure Management section added later the same session, which explicitly
lists "UNASSIGNED task status when no eligible assignee" as a Step 8
deliverable. `UNASSIGNED` is added here to make both sections consistent —
worth updating module-designs.md's Task Management Data Models list to include
it too in a documentation follow-up (not blocking this step).

### What `Task` Currently Has

```prisma
model Task {
  id                 String            @id @default(cuid())
  organizationId     String
  title              String
  description        String?
  objectType         String?
  objectId           String?
  workflowInstanceId String?
  assigneeId         String
  createdById        String
  status             TaskStatus        @default(PENDING)
  priority           TaskPriority      @default(MEDIUM)
  dueAt              DateTime?
  slaBreachedAt      DateTime?
  completedAt        DateTime?
  delegatedToId      String?
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  organization       Organization      @relation(fields: [organizationId], references: [id])
  assignee           User              @relation("TaskAssignee", fields: [assigneeId], references: [id])
  createdBy          User              @relation("TaskCreator", fields: [createdById], references: [id])
  workflowInstance   WorkflowInstance? @relation(fields: [workflowInstanceId], references: [id])

  @@index([organizationId])
  @@index([assigneeId])
  @@index([status])
  @@index([dueAt])
  @@index([objectType, objectId])
}
```

### What `Task` Must Have After Migration

```prisma
model Task {
  id                   String            @id @default(cuid())
  organizationId       String
  title                String
  description          String?
  sourceType           TaskSourceType                              // RENAME from objectType, RETYPE, now required
  sourceId             String                                       // RENAME from objectId, now required
  sourceStageId        String?                                      // ADD — which WorkflowStage created this task
  workflowInstanceId   String?
  meetingId            String?                                      // ADD — cross-meeting tracking (module-designs.md)
  createdById          String
  status               TaskStatus        @default(PENDING)
  priority             TaskPriority      @default(MEDIUM)
  dueAt                DateTime?
  dueDateOverridden    Boolean           @default(false)             // ADD — was dueAt manually set vs. SLA-computed
  slaBreachedAt        DateTime?
  completedAt          DateTime?
  completedById        String?                                       // ADD — which assignee actually completed it
  escalationUserId     String?                                       // ADD — soft ref → User.id (creator-set escalation target)
  escalationAfterHours Int?                                          // ADD
  createdAt            DateTime          @default(now())
  updatedAt            DateTime          @updatedAt

  organization         Organization      @relation(fields: [organizationId], references: [id])
  createdBy            User              @relation("TaskCreator", fields: [createdById], references: [id])
  workflowInstance     WorkflowInstance? @relation(fields: [workflowInstanceId], references: [id])
  assignees            TaskAssignee[]                                // ADD — reverse relation to new junction
  evidence             TaskEvidence[]                                // ADD — reverse relation to new model

  @@index([organizationId])
  @@index([status])
  @@index([dueAt])
  @@index([sourceType, sourceId])
  @@index([meetingId])
}
```

**Removed:** `assigneeId` (+ its `assignee` relation, `@@index([assigneeId])`),
`delegatedToId`. **Why `sourceId` has no `@@index` change beyond the compound
one:** the compound `[sourceType, sourceId]` index already serves both
"tasks for this exact source" queries and, combined with a separate
`organizationId` index, the module task-list use case from `module-designs.md`
("Module task lists — tasks filtered by sourceType + sourceId").

**On `User.tasksAssigned` (`@relation("TaskAssignee")`) and
`User.tasksCreated`:** the old `"TaskAssignee"` relation name on `User` is
removed along with `Task.assigneeId` (no collision with the new `TaskAssignee`
**model** — Prisma relation names and model names are independent namespaces —
but keeping a relation literally named `"TaskAssignee"` once a same-named model
exists would be confusing, so it's removed, not renamed). `User.tasksCreated`
(`@relation("TaskCreator")`) is unchanged.

### NEW Model — `TaskAssignee`

*Junction table — multi-assignee support. No `organizationId` of its own,
consistent with `WorkflowInstanceStage`'s existing precedent — tenant scoping
is always transitive through `taskId → Task.organizationId`.*

```prisma
model TaskAssignee {
  id           String    @id @default(cuid())
  taskId       String
  userId       String
  assignedAt   DateTime  @default(now())
  assignedById String
  removedAt    DateTime?                       // set when task completed by a DIFFERENT assignee

  task         Task      @relation(fields: [taskId], references: [id])
  user         User      @relation("TaskAssigneeUser", fields: [userId], references: [id])
  assignedBy   User      @relation("TaskAssigneeAssignedBy", fields: [assignedById], references: [id])

  @@unique([taskId, userId])
  @@index([taskId])
  @@index([userId])
}
```

Add to **User model**:
```prisma
taskAssignments TaskAssignee[] @relation("TaskAssigneeUser")
taskAssignmentsMade TaskAssignee[] @relation("TaskAssigneeAssignedBy")
```

### NEW Model — `TaskEvidence`

```prisma
model TaskEvidence {
  id             String              @id @default(cuid())
  organizationId String
  taskId         String
  type           TaskEvidenceType
  content        String?                                      // for TEXT
  s3Key          String?                                      // for ATTACHMENT
  fileName       String?
  fileSize       Int?
  mimeType       String?
  url            String?                                      // for LINK
  linkTitle      String?
  refType        TaskEvidenceRefType?                          // for INTERNAL_REFERENCE
  refId          String?
  refDisplay     String?                                       // cached display name at creation time
  uploadedById   String
  uploadedAt     DateTime            @default(now())

  organization   Organization        @relation(fields: [organizationId], references: [id])
  task           Task                @relation(fields: [taskId], references: [id])
  uploadedBy     User                @relation(fields: [uploadedById], references: [id])

  @@index([organizationId])
  @@index([taskId])
}
```

### `Organization.settings` — New Tenant-Configurable JSON

```prisma
model Organization {
  // ...existing fields unchanged...
  settings Json?   // ADD — { taskSla: { CRITICAL, HIGH, MEDIUM, LOW } } (hours), extensible for future tenant-level config
}
```

**Why a generic `settings` blob, not a dedicated `taskSla` column set:**
matches the existing `authConfig`/`storageConfig`/`aiConfig` encrypted-JSON
pattern already on `Organization` — a single extensible JSON field avoids a
new column for every future tenant-configurable number, while `taskSla` is the
one key this step actually reads/writes. **Not encrypted** (unlike
auth/storage/AI config) — SLA hours are not a secret, no `ENCRYPTION_KEY`
round-trip needed for this field.

**Default when `settings.taskSla` is absent:** `TaskService` falls back to the
CLAUDE.md/`module-designs.md` platform defaults (`CRITICAL: 4, HIGH: 16,
MEDIUM: 40, LOW: 80`) baked into code, not a second schema-level default —
keeps `Organization.settings` genuinely optional/tenant-overridable.

### Migration Name

```
redesign_task_multi_assignee_evidence_and_org_settings
```

```bash
cd backend && npx prisma migrate dev --name redesign_task_multi_assignee_evidence_and_org_settings
```

**Data migration note — this is the one genuinely destructive-shaped migration
in this step:** dropping `Task.assigneeId`/`delegatedToId` and retyping
`objectType`→`sourceType` loses data if any real `Task` rows exist. Per
`/prisma-change`'s Step 1 ("does any existing data need to be migrated?"):
confirm via `npx prisma studio` that the only `Task` rows in the dev database
(if any) are from `WorkflowService`'s stub in prior local testing, not anything
a real user depends on, before applying. If real rows exist, write a data
migration script (`backend/src/scripts/`) that backfills one `TaskAssignee` row
per existing `assigneeId` before the column is dropped — do not skip this
silently.

---

## 3. FILES TO CREATE / MODIFY (BACKEND)

All new paths relative to `backend/src/foundation/task/` unless noted.
**Commit 0 (0a–0g) builds the full `OrgPosition` module first** — Task
Management's escalation validation (Commit 3 onward) depends on it.

### Commit 0a — Schema and migration
```
backend/prisma/schema.prisma                                            MODIFY
backend/prisma/migrations/YYYYMMDDHHMMSS_.../                          GENERATED
```
Edit `schema.prisma` with `OrgPosition` + `User.positionId` (Section 2).
Migration: `add_org_position_and_user_position_id`. Run `npx prisma generate`
after.

---

### Commit 0b — Interfaces and DTOs
```
src/foundation/org-position/interfaces/org-position.interface.ts           CREATE
src/foundation/org-position/dto/create-org-position.dto.ts                 CREATE
src/foundation/org-position/dto/update-org-position.dto.ts                 CREATE
```

**`org-position.interface.ts`**:
```typescript
export interface IOrgPosition {
  id: string;
  organizationId: string;
  orgUnitId: string | null;
  nameEn: string;
  nameAr: string | null;
  grade: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

**`create-org-position.dto.ts`**:
```typescript
export class CreateOrgPositionDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  nameEn!: string;

  @IsString() @IsOptional() @MaxLength(100)
  nameAr?: string;

  @IsString() @IsOptional()
  orgUnitId?: string;

  @IsInt() @Min(1) @Max(10)
  grade!: number;
}
```

**`update-org-position.dto.ts`**: `PartialType(CreateOrgPositionDto)`.

---

### Commit 0c — OrgPositionService + spec
```
src/foundation/org-position/org-position.service.ts                       CREATE
src/foundation/org-position/org-position.service.spec.ts                   CREATE
```

**`org-position.service.ts`** methods:

```typescript
// Upserts 10 org-wide default positions (orgUnitId: null). Idempotent — safe
// to call repeatedly. Called from TenantService.bootstrap().
seedDefaultPositions(organizationId: string): Promise<void>

// Org-wide positions + unit-specific ones when orgUnitId is given; only
// org-wide when it's omitted.
listPositions(organizationId: string, orgUnitId?: string): Promise<IOrgPosition[]>

getPositionById(id: string, organizationId: string): Promise<IOrgPosition>   // NotFoundException if missing or cross-tenant

// Validates orgUnitId belongs to this org (if provided) before creating.
createPosition(dto: CreateOrgPositionDto, organizationId: string, actorId: string): Promise<IOrgPosition>

updatePosition(id: string, dto: UpdateOrgPositionDto, organizationId: string, actorId: string): Promise<IOrgPosition>

deactivatePosition(id: string, organizationId: string, actorId: string): Promise<void>   // idempotent

// THE CORE METHOD — used by TaskService (and, in later steps, Committees/
// Meetings/Documents/CAPA/Audits per Section 7).
//
// 1. Fetch all assignees with their position.grade + primaryOrgUnitId
// 2. maxAssigneeGrade = max(assignee grades); unpositioned assignees = grade 0
// 3. Fetch escalation target with position.grade + primaryOrgUnitId
// 4. Grade check: throw BadRequestException if target.grade < maxAssigneeGrade
// 5. Org-unit check: throw BadRequestException if target's org unit is not
//    the same as or a parent of any assignee's org unit
// Edge cases: assignee with no position → grade 0 (any target passes the
// grade check); target with no position → grade 0 (fails if any assignee has
// a position); target with no primaryOrgUnitId → fails the org-unit check
// unconditionally.
validateEscalationTarget(assigneeIds: string[], escalationUserId: string, organizationId: string): Promise<void>

// Private — traverses OrgUnit.parentId upward from targetOrgUnitId; true if
// it equals any assigneeOrgUnitId or any of their ancestors.
private isInSameOrParentOrgUnit(targetOrgUnitId: string | null, assigneeOrgUnitIds: string[], organizationId: string): Promise<boolean>
```

**Note on `primaryOrgUnitId`:** added to `User` in Commit 0a (Section 2) as
part of this update — it did not exist anywhere in the schema before this
plan revision (see Section 12, item 5, for why it's independent of
`positionId` rather than derived from it).

**Spec must cover** (per the test groups already specified for this commit):
`seedDefaultPositions` (creates 10, idempotent, tenant-isolated),
`listPositions` (org-wide + unit-specific filtering, tenant-isolated),
`getPositionById` (found / not-found / cross-tenant), `createPosition`
(org-unit validation, audit log), `updatePosition` (before/after audit log,
cross-tenant rejection), `deactivatePosition` (idempotent, cross-tenant
rejection), and `validateEscalationTarget`'s full matrix: valid
higher-grade-same-unit, valid equal-grade-parent-unit, invalid lower-grade
(throws), invalid different-branch org unit (throws), assignee-with-no-position
edge case, target-with-no-position edge case, target-with-no-org-unit edge
case, plus a dedicated tenant-isolation test confirming
`validateEscalationTarget` never resolves users from another tenant.

---

### Commit 0d — OrgPositionController + spec
```
src/foundation/org-position/org-position.controller.ts                    CREATE
src/foundation/org-position/org-position.controller.spec.ts               CREATE
```

```
GET    /org-positions              @Permissions(POSITIONS_PERMISSIONS.VIEW)    — ?orgUnitId= optional filter
GET    /org-positions/:id          @Permissions(POSITIONS_PERMISSIONS.VIEW)
POST   /org-positions              @Permissions(POSITIONS_PERMISSIONS.MANAGE)
PATCH  /org-positions/:id          @Permissions(POSITIONS_PERMISSIONS.MANAGE)
POST   /org-positions/:id/deactivate @Permissions(POSITIONS_PERMISSIONS.MANAGE)
```

`@Controller('org-positions')`, `@UseGuards(TenantGuard, PermissionGuard)` at
class level. Spec: one delegation test per endpoint, guards mocked.

---

### Commit 0e — Module wiring
```
src/foundation/org-position/org-position.module.ts                        CREATE
src/foundation/tenant/tenant.module.ts                                    MODIFY
src/foundation/tenant/tenant.service.ts                                   MODIFY
src/foundation/tenant/tenant.service.spec.ts                              MODIFY
src/app.module.ts                                                        MODIFY
src/common/constants/permissions.ts                                      MODIFY
```

**`org-position.module.ts`**:
```typescript
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule)],
  controllers: [OrgPositionController],
  providers: [OrgPositionService],
  exports: [OrgPositionService],
})
export class OrgPositionModule {}
```
Not `@Global()` — modules that need `validateEscalationTarget()` (this step's
`TaskModule`, and Steps 10/11/17/18/19 later) import it explicitly, same
reasoning as `TaskModule` and `WorkflowModule`.

**`tenant.module.ts`** — add `forwardRef(() => OrgPositionModule)` to imports
(same edge shape as the existing `LookupModule`/`RolesModule`/`WorkflowModule`
entries — verified pattern, not a new risk class).

**`tenant.service.ts`** — inject `OrgPositionService` via
`@Inject(forwardRef(() => OrgPositionService))`; in `bootstrap()`, add
**after root org unit creation, before `seedSystemData()`** (per the actual
current bootstrap order — see the contradiction-check findings earlier in
this conversation; positions are org-unit-aware so must follow root-unit
creation, and nothing later in bootstrap depends on positions existing first):

```typescript
await this.orgPositionService.seedDefaultPositions(id);
await this.lookupService.seedSystemData();
await this.roleService.seedSystemRoles(id);
await this.workflowTemplateService.seedDefaultWorkflows(id);
// TODO(Step 8 — Tasks): register default task SLA settings
```

Also clean up the stale `// TODO(Step 7 — Notifications)` comment while this
method is being touched (already shipped in ACC-10, never removed).

**`tenant.service.spec.ts`** — add a mocked `OrgPositionService` provider.

**`app.module.ts`** — add `OrgPositionModule` to imports.

**`permissions.ts`** — add:
```typescript
export const POSITIONS_PERMISSIONS = {
  VIEW:   'positions:view',
  MANAGE: 'positions:manage',
} as const;
```

**Circular-dependency verification:** this closes the same shape of transitive
cycle as Step 7's `NotificationModule` did (`TenantModule → forwardRef
OrgPositionModule → forwardRef TenantModule`), except `OrgPositionModule` is
NOT `@Global()`, so it's a direct two-module cycle, not a three-module
transitive one — simpler than Step 7's case, but still requires a real
`start:dev` boot check, not just `tsc`/`jest`, per the established rule.

---

### Commit 0f — Angular frontend
```
frontend/src/app/foundation/org-position/services/org-position.service.ts              CREATE
frontend/src/app/foundation/org-position/components/
  position-list/position-list.component.ts                                            CREATE
  position-form/position-form.component.ts                                            CREATE
frontend/src/app/foundation/org-position/org-position.routes.ts                        CREATE
frontend/src/app/app.routes.ts                                                        MODIFY
```

**`org-position.service.ts`** — `IOrgPositionDto`, `CreateOrgPositionDto`,
`UpdateOrgPositionDto` interfaces; `listPositions(orgUnitId?)`, `getById(id)`,
`create(dto)`, `update(id, dto)`, `deactivate(id)`.

**`position-list.component.ts`** — `p-table`: nameEn/nameAr, grade (badge),
org unit (name or "Org-Wide"), isActive status; add/edit/deactivate actions;
filter-by-org-unit dropdown; signals for state; RTL-safe.

**`position-form.component.ts`** — Reactive Form: nameEn (required), nameAr
(optional), grade (number 1–10, required), orgUnitId (`p-dropdown` sourced
from the existing org-unit service, with a "Org-Wide" null option). `input()`
for the editing position, `output()`s for saved/cancelled.

**`org-position.routes.ts`**: `''` → `PositionListComponent`. Register
`path: 'org-positions'` in `app.routes.ts`.

---

### Commit 0g — Translation keys
```
frontend/src/assets/i18n/en.json     MODIFY
frontend/src/assets/i18n/ar.json     MODIFY
```

`"orgPosition"` namespace: `title`, `addPosition`, `editPosition`, `nameEn`,
`nameAr`, `grade`, `gradeHint`, `orgUnit`, `orgWide`, `isActive`, `deactivate`,
`noPositions`, `systemBadge`, `customBadge`, `errorLoad` — real Arabic
translations for all of them, not placeholders.

---

### Commit 1 — Schema (standalone commit before any code)
```
backend/prisma/schema.prisma                                            MODIFY
backend/prisma/migrations/YYYYMMDDHHMMSS_.../                          GENERATED
```

---

### Commit 2 — Interfaces and DTOs
```
interfaces/task.interface.ts                                            CREATE
interfaces/task-assignee.interface.ts                                   CREATE
interfaces/task-evidence.interface.ts                                   CREATE
dto/create-task.dto.ts                                                  CREATE
dto/update-task.dto.ts                                                  CREATE
dto/reassign-task.dto.ts                                                CREATE
dto/complete-task.dto.ts                                                CREATE
dto/add-task-evidence.dto.ts                                            CREATE
```

**`create-task.dto.ts`** — `title` (required), `description` (optional),
`sourceType` (`@IsEnum`, required — never optional, per "no standalone tasks"),
`sourceId` (required), `sourceStageId`/`meetingId` (optional), `assigneeUserIds`
(`string[]`, at least one required), `priority` (`@IsEnum`, optional — default
`MEDIUM`), `dueDate` (optional — explicit due date overrides SLA computation,
sets `dueDateOverridden: true`), `escalationUserId`/`escalationAfterHours`
(optional pair — both-or-neither validated in the service, not the DTO, since
cross-field validation needs the org-structure lookup covered in Section 8).

**`reassign-task.dto.ts`** — `newAssigneeUserIds: string[]`, `reason: string`
(required — every reassignment requires a documented reason per Absence and
Departure Management Pattern 2's audit-trail requirement).

**`complete-task.dto.ts`** — no body needed for the completion itself
(`POST /tasks/:id/complete`); evidence is added via the separate
`add-task-evidence.dto.ts` endpoint, before or after completion.

---

### Commit 3 — TaskService + spec
```
task.service.ts                                                         CREATE
task.service.spec.ts                                                    CREATE
```

**`task.service.ts`** methods:

```typescript
// Creates the Task row + one TaskAssignee row per assigneeUserId. Computes
// dueAt via WorkingCalendarService.calculateDeadline() using
// Organization.settings.taskSla[priority] (falling back to platform defaults)
// UNLESS dto.dueDate is explicitly given (then dueDateOverridden: true).
// If assigneeUserIds resolves to an empty list (see resolveEligibleAssignees
// note in Section 8), creates the task with status: UNASSIGNED and notifies
// the Tenant Admin instead of any assignee.
create(dto: CreateTaskDto, organizationId: string, actorId: string): Promise<ITask>

// "My Tasks" — every task where the calling user has an active
// TaskAssignee row (removedAt: null)
getMyTasks(userId: string, organizationId: string, status?: TaskStatus): Promise<ITask[]>

// Module task lists — CLAUDE.md's "tasks filtered by sourceType + sourceId"
getForSource(sourceType: string, sourceId: string, organizationId: string): Promise<ITask[]>

getById(id: string, organizationId: string): Promise<ITask>   // includes assignees[] + evidence[]

// ANY-completes semantics: sets status COMPLETED, completedAt, completedById;
// sets removedAt on every OTHER active TaskAssignee row for this task (task
// disappears from every other assignee's "My Tasks" list, per module-designs.md)
complete(id: string, userId: string, organizationId: string): Promise<ITask>

// Pattern 2 (Manual Reassignment) — adds new TaskAssignee row(s), sets
// removedAt on the previous assignee row(s), logs full before/after audit
// trail including dto.reason
reassign(id: string, dto: ReassignTaskDto, organizationId: string, actorId: string): Promise<ITask>

addEvidence(taskId: string, dto: AddTaskEvidenceDto, organizationId: string, actorId: string): Promise<ITaskEvidence>

// Throws NotFoundException if the referenced INTERNAL_REFERENCE record
// doesn't exist in this tenant — refDisplay is resolved and cached here,
// not trusted from the client
```

**Spec must cover:**
- `create()` computes `dueAt` from `Organization.settings.taskSla[priority]`
  when no explicit due date given; respects platform defaults when
  `settings.taskSla` is absent
- `create()` with an empty resolved assignee list creates status `UNASSIGNED`
  and does NOT create any `TaskAssignee` rows
- `complete()` marks the task `COMPLETED` when called by ANY active assignee,
  and sets `removedAt` on every other assignee's row (ANY-completes semantics)
- `reassign()` requires `reason`, creates new `TaskAssignee` rows, removes old
  ones, and logs a full before/after audit entry
- `getMyTasks()` only returns tasks where the calling user has an active
  (`removedAt: null`) `TaskAssignee` row
- Tenant isolation test: org B's `getMyTasks()`/`getForSource()` never returns
  org A's tasks; org B cannot `reassign()` a task belonging to org A

---

### Commit 4 — TaskController + spec
```
task.controller.ts                                                      CREATE
task.controller.spec.ts                                                 CREATE
```

```
GET    /tasks/my-tasks                    @Permissions(TASKS_PERMISSIONS.VIEW)
GET    /tasks?sourceType=&sourceId=       @Permissions(TASKS_PERMISSIONS.VIEW)
GET    /tasks/:id                         @Permissions(TASKS_PERMISSIONS.VIEW)
POST   /tasks                             @Permissions(TASKS_PERMISSIONS.CREATE)
POST   /tasks/:id/complete                @Permissions(TASKS_PERMISSIONS.COMPLETE)
POST   /tasks/:id/reassign                @Permissions(TASKS_PERMISSIONS.REASSIGN)
POST   /tasks/:id/evidence                @Permissions(TASKS_PERMISSIONS.COMPLETE)
```

`@UseGuards(TenantGuard, PermissionGuard)` at class level. `@CurrentTenant()`/
`@CurrentUser()` throughout — never `request.body.organizationId`. Zero
business logic — full delegation to `TaskService`.

---

### Commit 5 — TaskModule + AppModule + TASKS_PERMISSIONS update
```
task.module.ts                                                          CREATE
app.module.ts                                                          MODIFY
common/constants/permissions.ts                                        MODIFY
```

**`task.module.ts`**:
```typescript
@Module({
  imports: [PrismaModule, WorkingCalendarModule, forwardRef(() => TenantModule)],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
```

Not `@Global()` — matches `WorkflowModule`'s reasoning, not `NotificationModule`'s:
future functional modules that generate tasks will import `TaskModule` directly
(they already import `WorkflowModule` for the same reason), rather than every
module needing ambient access the way notifications do.

**`permissions.ts`** — `TASKS_PERMISSIONS` becomes:
```typescript
export const TASKS_PERMISSIONS = {
  VIEW:      'tasks:view',
  CREATE:    'tasks:create',
  REASSIGN:  'tasks:reassign',
  COMPLETE:  'tasks:complete',
  MANAGE:    'tasks:manage',
} as const;
```
(`DELEGATE` removed, matching this session's CLAUDE.md update.)

**Circular-dependency check:** `TaskModule` imports `TenantModule` via
`forwardRef()` (for `AuditLogService`) — same single edge shape as
`WorkflowModule`'s own `TenantModule` import, not a new transitive cycle (unlike
Step 7's `NotificationModule`, `TaskModule` is not `@Global()` and
`WorkflowModule` will import it directly rather than through `TenantModule`'s
graph — verify with a real `start:dev` boot anyway, since Commit 6 changes
`WorkflowModule`'s own imports).

---

### Commit 6 — Migrate WorkflowService.executeCreateTask() off its stub
```
foundation/workflow/workflow.service.ts                                MODIFY
foundation/workflow/workflow.service.spec.ts                            MODIFY
foundation/workflow/workflow.module.ts                                  MODIFY
```

This retires the third and last direct-Prisma task/notification stub in
`WorkflowService` (the other two were retired in Step 7).

**Current bug being fixed, not just refactored away:** `executeCreateTask()`
does `const primaryAssignee = assigneeIds[0]` and creates a task for that one
user only — every other resolved assignee (e.g. all members of a `PARALLEL`
stage) is silently dropped. The migrated version passes the full
`assigneeIds` array to `TaskService.create()`'s `assigneeUserIds`.

```typescript
private async executeCreateTask(
  transition: PrismaWorkflowTransition,
  instance: PrismaWorkflowInstance,
  organizationId: string,
  actorId: string,
): Promise<string> {
  const toStage = await this.prisma.workflowStage.findFirst({ where: { id: transition.toStageId } });
  if (!toStage) return 'Skipped — target stage not found';

  const assigneeIds = await this.resolveAssignee(toStage, instance, organizationId);

  const task = await this.taskService.create(
    {
      title: `${transition.labelEn} — ${instance.objectType}`,
      sourceType: instance.objectType,
      sourceId: instance.objectId,
      sourceStageId: toStage.id,
      assigneeUserIds: assigneeIds,
      priority: 'MEDIUM',   // TODO(future step): derive from source object urgency, not a fixed default
    },
    organizationId,
    actorId,
  );

  return assigneeIds.length > 0
    ? `Task created for ${assigneeIds.length} assignee(s)`
    : 'Task created as UNASSIGNED — no eligible assignee';
}
```

`workflow.module.ts` — add `TaskModule` to `imports`.

---

### Commit 7 — SLA monitor extended to sweep overdue Tasks
```
foundation/workflow/sla-monitor.processor.ts                           MODIFY
```

**Design decision (flagged in Section 12): extend the existing `sla-monitor`
job rather than register a new queue.** CLAUDE.md's Background Jobs list has
exactly one entry for this concern (`sla-monitor: Every 15 minutes — check SLA
breaches, trigger escalations`), with no separate "task-overdue" job named
anywhere — read as one generic SLA sweep covering every SLA-bearing entity in
the platform, not workflow-stages-only.

`SlaMonitorProcessor.process()` gains a second sweep alongside its existing
`WorkflowInstanceStage` one:
- Query every `Task` with `dueAt: { lt: now }`, `status: { notIn: [COMPLETED,
  CANCELLED, OVERDUE] }` → set `status: OVERDUE`, `slaBreachedAt: now`
- For each newly-overdue task with `escalationUserId` set and
  `escalationAfterHours` elapsed since `dueAt`: validate the escalation target
  (Section 8's org-structure + permission-level check) and, if valid,
  `NotificationService.create()` to the escalation target; if invalid, log via
  `AuditLogService` and skip (never silently escalate to an invalid target)
- Same working-hours gate as the existing `WorkflowInstanceStage` escalation
  path (Step 6) — task escalations only dispatch during the tenant's working
  hours

No new BullMQ queue — reuses the existing `sla-monitor` repeatable job
registered in Step 6.

---

## 4. FILES TO CREATE (FRONTEND)

All paths relative to `frontend/src/app/foundation/tasks/` unless noted.

### Commit 8 — Angular task service + list + my-tasks + form
```
services/task.service.ts                                                CREATE
components/
  task-list/task-list.component.ts                                     CREATE
  my-tasks/my-tasks.component.ts                                        CREATE
  task-form/task-form.component.ts                                     CREATE
tasks.routes.ts                                                        CREATE
```

**`task.service.ts`** — `getMyTasks(status?)`, `getForSource(sourceType,
sourceId)`, `getById(id)`, `create(dto)`, `complete(id)`,
`reassign(id, dto)`, `addEvidence(taskId, dto)`.

**`my-tasks.component.ts`** — the primary landing view (CLAUDE.md's "My Tasks
view — all tasks across all modules for a user"): `p-table`, status filter
tabs (Pending/In Progress/Overdue/Completed), each row shows source badge
(`sourceType` tag), priority pill, due date, complete button.

**`task-list.component.ts`** — embeddable list filtered by `sourceType` +
`sourceId`, meant to be dropped into a future module's detail page (e.g. an
Incident detail page showing its tasks) — no functional module exists yet to
embed it in, so this ships as a standalone routed page for now, same
"temporary standalone, built reusable" pattern Step 7 used for the
notification bell.

**`task-form.component.ts`** — Reactive Form: title, description, priority
select, multi-select assignee picker (reuses `RoleService`/a plain user list —
flag if no user-listing endpoint exists yet at build time, matching Step 6's
precedent of a `p-message` stopgap when a picker's backing data isn't ready),
optional explicit due date, optional escalation user + hours.

**`tasks.routes.ts`**: `''` → `MyTasksComponent`, `'all'` → `TaskListComponent`.
Register `path: 'tasks'` in `app.routes.ts`.

---

### Commit 9 — Translation keys
```
frontend/src/assets/i18n/en.json     MODIFY
frontend/src/assets/i18n/ar.json     MODIFY
```

`"task"` namespace: `title`, `myTasks`, `allTasks`, `status.*` (pending, in
progress, overdue, completed, cancelled, unassigned), `priority.*` (critical,
high, medium, low), `complete`, `reassign`, `reassignReason`, `addEvidence`,
`evidenceType.*` (text, attachment, link, internalReference), `noTasks`,
`errorLoad`.

---

## 5. COMMIT SEQUENCE

All commits on branch `feature/ACC-11-task-management`.
Format: `{type}({scope}): {description} [ACC-11]`

```
Commit 0a: chore(prisma): add OrgPosition and User.positionId/primaryOrgUnitId [ACC-11]
Commit 0b: feat(org-position): add org position interfaces and DTOs [ACC-11]
Commit 0c: feat(org-position): add OrgPositionService [ACC-11]
Commit 0d: feat(org-position): add OrgPositionController [ACC-11]
Commit 0e: chore(org-position): register OrgPositionModule, wire into bootstrap [ACC-11]
Commit 0f: feat(org-position): add Angular position list and form [ACC-11]
Commit 0g: feat(i18n): add org position translation keys [ACC-11]
Commit 1: chore(prisma): redesign Task for multi-assignee, evidence, org settings [ACC-11]
Commit 2: feat(task): add task interfaces and DTOs [ACC-11]
Commit 3: feat(task): add TaskService [ACC-11]
Commit 4: feat(task): add TaskController [ACC-11]
Commit 5: chore(task): register TaskModule, update TASKS_PERMISSIONS [ACC-11]
Commit 6: fix(workflow): migrate executeCreateTask off single-assignee stub [ACC-11]
Commit 7: feat(workflow): extend SLA monitor to sweep overdue tasks and escalate [ACC-11]
Commit 8: feat(task): add Angular task list, my-tasks, and form [ACC-11]
Commit 9: feat(i18n): add task translation keys [ACC-11]
```

Run `npx tsc --noEmit` before commits 0a, 0c, 0d, 0e, 0f, 1, 3, 4, 5, 6, 7, 8.
Run `npx jest --passWithNoTests` before commits 0c, 0d, 0e, 3, 4, 5, 6, 7.

**Commit 0a carries no data-loss risk** — purely additive (new model, two new
nullable columns on `User`). **Commit 1 carries real data-loss risk** (see
Section 2's migration note) — confirm no depended-upon `Task` rows exist
before applying, same seriousness level as any schema change that drops
columns.

**Commit 0e's `start:dev` boot check must pass before Commit 1 begins** —
`TenantModule`'s new `OrgPositionModule` edge changes its dependency graph
before Task Management's own module (Commit 5) adds anything further to it.

**Commit 6 is the actual point of this step from CLAUDE.md's perspective** —
same framing as Step 7's Commit 7: the module isn't done until the thing that
was stubbing it gets migrated, even though `TaskService` is independently
functional without it.

---

## 6. ACCEPTANCE CRITERIA

- [ ] Task model with multi-assignee via TaskAssignee junction
- [ ] TaskEvidence model: TEXT, ATTACHMENT, LINK, INTERNAL_REFERENCE
- [ ] ANY-completes semantics for multi-assignee tasks — verified by test:
      completing via one assignee removes the task from every other
      assignee's active list
- [ ] Priority SLA from Organization.settings.taskSla, falling back to
      platform defaults when unset
- [ ] Due dates computed via WorkingCalendarService.calculateDeadline() —
      no module-local date math
- [ ] Out-of-office routing to actingUser when set — see Section 12 for the
      one open question this creates (User fields don't exist until Step 9
      per module-designs.md's own Build Sequence — resolve before Commit 6)
- [ ] UNASSIGNED status set when no eligible assignee found; Tenant Admin
      notified
- [ ] Task reassignment requires a reason, logs full before/after audit trail
- [ ] SLA monitor (extended, not a new queue) detects overdue tasks and fires
      configured escalations
- [ ] Escalation target validated against org-unit hierarchy AND
      OrgPosition.grade via OrgPositionService.validateEscalationTarget()
- [ ] NotificationService called for assignment, reassignment, escalation,
      and UNASSIGNED-alert
- [ ] Angular: my-tasks view, task list (by source), task form
- [ ] Translation keys in en.json and ar.json
- [ ] WorkflowService.executeCreateTask() calls TaskService.create() with
      the FULL resolved assigneeIds array (bug fix, not just refactor)
- [ ] No remaining direct this.prisma.task.create() in workflow code
- [ ] TASKS_PERMISSIONS updated to { VIEW, CREATE, REASSIGN, COMPLETE, MANAGE }
      — DELEGATE removed, matching CLAUDE.md
- [ ] OrgPosition model with grade 1-10 hierarchy
- [ ] 10 default positions seeded on bootstrap
- [ ] listPositions filters by orgUnitId correctly
- [ ] validateEscalationTarget enforces grade AND org unit
- [ ] Tenant isolation: positions never leak cross-tenant
- [ ] User.positionId links to OrgPosition
- [ ] Angular position management UI complete
- [ ] Translation keys in en + ar
- [ ] Backend TypeScript: zero errors
- [ ] Frontend TypeScript: zero errors
- [ ] All tests passing including tenant isolation
- [ ] PR merged to dev with green CI

---

## 7. DEPENDENCIES

### What This Step Requires from Steps 1–7

| Requirement | Where It Comes From |
|---|---|
| `Task`/`TaskStatus`/`TaskPriority` (partial) | Scaffolded in Step 1 |
| `WorkingCalendarService.calculateDeadline()` | Built in Step 2 |
| `AuditLogService`, `AuditAction.DELEGATE` (reused for reassignment) | Step 1 |
| `TenantGuard`/`PermissionGuard` | Step 4/5 |
| `WorkflowService.resolveAssignee()`, `executeCreateTask()` stub | Step 6 |
| `SlaMonitorProcessor`, `sla-monitor` queue | Step 6 |
| `NotificationService` (`@Global()`) | Step 7 |
| `OrgUnit.parentId` | Step 2 — reused for escalation hierarchy check |

### What Future Steps Will Require from Step 8

| Future Step | What It Needs |
|---|---|
| Step 9 — Users | Adds `User.outOfOfficeFrom/outOfOfficeTo/actingUserId` +
      settings UI + departure bulk-reassignment flow — completes what this
      step's `WorkflowService` routing hook only partially can without those
      fields (see Section 12) |
| Step 10 — Committees | Committee seat replacement (Absence and Departure
      Management Pattern 2 for committees) builds on this step's reassignment
      audit-trail pattern |
| Step 11 — Meetings | Cross-meeting task chain (`Task.meetingId`, carried-forward
      open action items) depends on this step's `Task` model directly |
| Every Phase 2 functional module | `TaskService.create()` is the only path to
      a lifecycle-linked task — same structural-blocker relationship
      `WorkflowService` has to Phase 2 |

### OrgPosition Is Used By

| Step | Usage |
|---|---|
| Step 8 — Tasks | `validateEscalationTarget()` — immediate, this step |
| Step 9 — Users | `User.positionId` assignment in the profile UI |
| Step 10 — Committees | Chair authority |
| Step 11 — Meetings | Meeting chair authority |
| Step 17 — Documents | Approval authority chain |
| Step 18 — CAPA | Ownership and escalation |
| Step 19 — Audits | Audit team authority |

---

## 8. BUSINESS RULES

### Task Creation — Two Paths, Same Constraint

Per this session's CLAUDE.md update: tasks are created (1) automatically via
workflow `CREATE_TASK` action, or (2) manually by a user holding
`tasks:create`. **Both paths require `sourceType`/`sourceId`** — there is no
"standalone" task creation path, and `CreateTaskDto` enforces this at the DTO
level (both fields non-optional), not just as a service-layer convention.

### Multi-Assignee, ANY-Completes

A task with N assignees is a single unit of work — the first assignee to call
`complete()` finishes it for everyone. `TaskService.complete()` sets
`removedAt` on every other active `TaskAssignee` row so the task vanishes from
their "My Tasks" lists, while the `TaskAssignee` rows themselves are never
deleted — they remain the permanent record of who was ever assigned and who
actually finished it (module-designs.md: "Record of who completed it kept in
TaskAssignee").

### The `executeCreateTask()` Bug Being Fixed

Documented in Sections 1 and 3, Commit 6 — the current implementation silently
drops every assignee past the first. This was invisible until now because no
seeded workflow stage currently uses a multi-approver mode
(`PARALLEL`/`COMMITTEE`) that also fires `CREATE_TASK` — Step 6's own
acceptance criteria explicitly flagged `PARALLEL`+`ALL` and `COMMITTEE` as
"implemented but dedicated tests deferred, no seed data uses them" for
multi-assignee-relevant paths. This step's Commit 6 spec must add the test
case that would have caught it.

### Escalation Validation — Org Structure and Position Grade

Per `module-designs.md`'s Absence and Departure Management: an
`escalationUserId` must be (1) in the same org unit or a parent org unit of the
assignee(s), and (2) hold equal-or-higher seniority than the assignee(s). Both
conditions are now resolved via `OrgPositionService.validateEscalationTarget()`
(Commit 0c) rather than a `Role`-level ranking concept (`Role` has none — see
Section 12's superseded discussion #2): (1) is checked via `OrgUnit.parentId`
traversal against the target's `primaryOrgUnitId`; (2) is checked via
`OrgPosition.grade` comparison (target's grade must be `>=` the max grade among
the assignee(s), with unpositioned users treated as grade 0).
`SlaMonitorProcessor`'s escalation sweep (Commit 7) and `TaskService.create()`'s
escalation-pair validation both call this one method — no duplicated logic.

### Out-of-Office Routing — What This Step Can and Cannot Do Yet

`module-designs.md`'s Absence and Departure Management assigns
`User.outOfOfficeFrom/outOfOfficeTo/actingUserId` to Step 9, but this step's
own Linear ticket (ACC-11) lists "out-of-office routing to actingUser" as an
acceptance criterion. These two statements are in tension — resolved in
Section 12 with a concrete recommendation (pull the three fields into this
step's own migration), not left unresolved.

### Audit Log

`AuditLogService.log()` on every mutation:
- `create()` — `action: 'CREATE'`, `objectType: 'Task'`
- `complete()` — `action: 'UPDATE'`, includes which assignee completed it
- `reassign()` — `action: 'DELEGATE'` (reusing the existing `AuditAction` enum
  value — its name predates this session's permission-string cleanup but its
  semantics, "responsibility moved from one user to another," fit reassignment
  exactly; no new `AuditAction` value needed)
- `addEvidence()` — `action: 'CREATE'`, `objectType: 'TaskEvidence'`

---

## 9. AI INTEGRATION POINTS

Per `module-designs.md`'s Task Module AI Integration Points (5) plus the
Absence and Departure Management section's Coverage Gap Detection (1) — **all
6 ship as documented stubs this step**, same precedent as Step 6's
`suggestWorkflowConfig()` and Step 7's personalized-notification-text stub:

1. **SMART_TASK_CREATION** — stub only; `TaskService.create()` accepts
   caller-supplied title/dueDate/priority as-is, no `AI_PROVIDER` call.
   Status: stub in Step 8, activate in Step 17+ (per module-designs.md).
2. **WORKLOAD_BALANCING** — not built. Requires cross-user task-count
   aggregation the "My Tasks" view doesn't need for itself; deferred.
3. **EVIDENCE_SUGGESTION** — stub only; `addEvidence()`'s
   `INTERNAL_REFERENCE` path requires the caller to supply `refType`/`refId`
   directly, no AI-suggested candidates.
4. **OVERDUE_PATTERN_ANALYSIS** — explicitly deferred to Phase 3 per
   module-designs.md ("needs data history").
5. **TASK_DESCRIPTION_DRAFTING** — explicitly deferred to Phase 3 per
   module-designs.md.
6. **Coverage Gap Detection** (Absence and Departure Management) — not built;
   structurally blocked on Step 9's `outOfOfficeFrom` field existing with real
   tenant data to analyze (even if Section 12 pulls the column into this
   step's schema, no admin UI exists yet to populate it meaningfully until
   Step 9).

**Pattern: AI suggests → human reviews → human approves → system records**
(once any of the above is activated in a later step).

---

## 10. QUEUE SUMMARY (Cross-Reference with Steps 6–7)

```
workflow-actions   — Step 6 — webhook firing on transitions
sla-monitor        — Step 6 — EXTENDED this step to also sweep overdue Tasks
                      (no new queue — see Section 3, Commit 7)
email-delivery     — Step 7 — async Resend send per EMAIL/BOTH-channel Notification
```

No new BullMQ queue registered in Step 8 — deliberate, see Commit 7.

---

## 11. FRONTEND — WHY STILL NO SHARED LAYOUT MODULE

Same situation as Step 7 (Section 11 of that plan): no `frontend/src/app/
layout/` app shell exists yet anywhere in this codebase. `MyTasksComponent`
ships as its own routed page (`/tasks`), not embedded in a topbar/sidebar,
consistent with every foundation module built so far.

---

## 12. PENDING DISCUSSIONS

Flagged for confirmation before building starts:

1. **Pull `User.outOfOfficeFrom`/`outOfOfficeTo`/`actingUserId` forward into
   this step's own migration, ahead of Step 9.** `module-designs.md`'s Build
   Sequence explicitly assigns these three fields to Step 9, but this step's
   Linear ticket (ACC-11) lists "out-of-office routing to actingUser when set"
   as an acceptance criterion — impossible to satisfy without the fields
   existing. **Recommendation:** add all three to `User` in this step's
   Commit 1 migration (small, additive, no UI attached yet — Step 9 still owns
   building the settings screen that lets a user actually populate them).
   `WorkflowService.resolveAssignee()` gains the out-of-office check
   immediately and is fully testable now via direct DB writes in specs, even
   though no admin-facing way to set these fields exists until Step 9.
   Confirm before Commit 1.

2. **RESOLVED — escalation ranking now comes from `OrgPosition.grade`, not
   `Role`.** This discussion originally proposed either adding a `Role.level`
   field or approximating seniority via the `tasks:manage` permission, since
   `Role` has no ranking concept. Superseded: `OrgPosition` (Commit 0,
   inserted ahead of Task Management in this plan) provides a real
   1–10 `grade` per position, independent of the RBAC permission system, and
   `OrgPositionService.validateEscalationTarget()` is the concrete
   implementation this discussion was missing. `Role` itself is untouched —
   no schema change to a model outside this step's domain was needed after
   all, resolving the original recommendation's own goal a different way.

3. **`sla-monitor` extension vs. a dedicated task-overdue queue** — proposed
   in Section 3, Commit 7: extend the existing job rather than register a new
   one, since CLAUDE.md's Background Jobs list has exactly one SLA-sweep
   entry, not one per entity type. Confirm this reading before Commit 7.

4. **`TaskStatus.UNASSIGNED` vs. `WorkflowInstanceStage.isUnassigned`** — the
   Absence and Departure Management section describes role-vacancy fallback
   using an `isUnassigned: Boolean` flag on `WorkflowInstanceStage` (a Step 6
   enhancement, scheduled for "during Step 9") but a `UNASSIGNED` **status
   value** on `Task` (this step). These are two different mechanisms for two
   different models — confirm that's intentional (a workflow stage can be
   unassigned while still "in progress" structurally, whereas a task's status
   enum already has room for a fourth terminal-ish state) rather than an
   oversight expecting the same mechanism twice.

5. **RESOLVED IN THIS REVISION — `validateEscalationTarget()`'s spec assumes
   a `User.primaryOrgUnitId` field that did not exist anywhere in the schema
   before this update.** Every read of the actual `User` model this session
   (Step 7's build, the earlier contradiction check, and this update) confirmed
   it had no org-unit assignment field at all — not `orgUnitId`, not
   `primaryOrgUnitId`, nothing. `OrgPosition.orgUnitId` only tells you a
   *position's* org unit, and a user holding an org-wide position
   (`orgUnitId: null`) would otherwise have no derivable org-unit affiliation,
   silently breaking the org-unit-hierarchy half of the escalation check for
   exactly the most senior users (Director, Deputy Director — the org-wide
   defaults from Commit 0c's seed). **Resolution applied:** `User
   .primaryOrgUnitId: String?` added directly to Section 2's Commit 0a schema,
   independent of `positionId` — a user's org-unit membership shouldn't be
   conflated with which position they hold, especially for org-wide positions
   that have no unit of their own to fall back on. Still worth a final
   confirmation before Commit 0a is actually applied, since it's a new field
   beyond what was literally requested for this update.

---

*Plan created: 2026-07-28*
*Branch created: feature/ACC-11-task-management*
*Depends on: ACC-10 (merged to dev ✅)*
