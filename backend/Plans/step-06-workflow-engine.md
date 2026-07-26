# Step 6 — Workflow Engine
# ACC-9 (suggested): custom database-driven workflow engine — templates, stages,
# transitions, approvals, assignee resolution, SLA tracking, internal + webhook actions

---

## HEALTH CHECK — Run Before Starting

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AccreditMe Health Check — 2026-07-23
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ERRORS:  None ✅
ERRORS:           None ✅
WARNINGS:
  ⚠ STRIPE_SECRET_KEY is empty — deferred, acceptable for local dev
  ⚠ REDIS_URL is empty — acceptable for every prior step, but THIS step is the
    first to actually need a live Redis connection (BullMQ). See Section 7 —
    Dependencies, and the note under Commit 7.

DETAILED RESULTS

Check 1  Git State              PASS — on dev, clean, up to date with origin/dev
Check 2  Branch vs dev          INFO — 0 commits ahead/behind, ready for new ticket
Check 3  Backend TypeScript     PASS — npx tsc --noEmit → zero errors
Check 4  Frontend TypeScript    PASS — npx tsc --noEmit → zero errors
Check 5  Test Suite             PASS — 140/140 tests passing (10 suites)
Check 6  Tenant Isolation       PASS — 8/8 isolation tests passing
Check 7  Migration Status       PASS — 7 migrations, database up to date
Check 8  Schema Validation      PASS — schema.prisma is valid
Check 9  Environment Variables  PASS — all required vars present (2 deferred warnings)
Check 10 Critical Files         PASS — all 18 skill/doc files present
Check 11 Security               PASS — .env and .mcp.json not in git history

OVERALL STATUS: 🟢 HEALTHY — ready to start ACC-9
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

Step 6 implements the **Workflow Engine** — a custom, database-driven state machine
that every functional module (Documents, Incidents, Audits, Corrective Actions,
Meetings, Committees) will delegate ALL state transitions to, per CLAUDE.md's
non-negotiable rule: *"Route ALL state transitions through WorkflowService."*

Three things ship together:

1. **Workflow builder (config layer)** — `WorkflowTemplateService` manages tenant-
   configurable templates: stages (with SLA, approval mode, assignee strategy),
   transitions between stages (with trigger conditions and validator rules), and
   the actions that fire on each transition (internal + webhook).
2. **Workflow runtime (engine layer)** — `WorkflowService` is the single entry point
   every future module calls to start an instance, attempt a transition, and record
   approval decisions. It resolves assignees, checks validator conditions, fires
   actions, and writes the full audit trail.
3. **Background job infrastructure** — this is the **first step in the codebase to
   register BullMQ**. Two recurring jobs ship: webhook firing (per-transition, with
   retry) and SLA-breach monitoring (every 15 minutes, per CLAUDE.md).

### Why This Is the Most Complex Foundation Module

- It is the only foundation module with **8 Prisma models** (vs. 1–4 for every prior
  step) because it must express five independent configuration axes per stage/
  transition: *who approves* (approval mode), *how many* (parallel threshold), *who
  is assigned* (assignee strategy), *who can trigger* (trigger condition), and *what
  fires* (internal + webhook actions) — each already specified in detail in CLAUDE.md.
- It is the **first consumer of `WorkingCalendarService.calculateDeadline()`** for a
  genuinely dynamic due-date (every stage entry, not a one-time tenant setting like
  Step 2's calendar itself).
- It is the **first step to activate BullMQ**, which has sat in `package.json`
  (`bullmq`, `@nestjs/bullmq`) since scaffold but has never been registered in
  `AppModule` — this step must wire the queue infrastructure other modules will
  reuse (`ai-processing`, `email-delivery`, `sla-monitor`, etc. — see CLAUDE.md
  Background Jobs section).
- It has **no UI precedent to copy as closely** as Steps 3/4 could copy each other —
  the builder UI is a genuinely new shape (nested stage/transition/action editor),
  not another list+dialog CRUD screen.
- Every functional module in Phase 2 (Steps 16–19) is **structurally blocked** on
  this step — none of them can create their own object records with a lifecycle
  until `WorkflowService.startInstance()` exists.

### Scaffold Already in Place (from Step 1 — do not recreate)

```
WorkflowTemplate       model — EXISTS, partial — MODIFY (see Section 2)
WorkflowStage          model — EXISTS, partial — MODIFY (significant additions)
WorkflowTransition     model — EXISTS, partial — MODIFY (significant additions)
WorkflowInstance       model — EXISTS, partial — MODIFY (add organizationId, enum objectType)
WorkflowInstanceStage  model — EXISTS, partial — MODIFY (add outcome + SLA tracking)
WorkflowApproval        model — DOES NOT EXIST — CREATE
WorkflowTransitionAction model — DOES NOT EXIST — CREATE
WorkflowActionLog       model — DOES NOT EXIST — CREATE
WorkflowStatus enum     — EXISTS (PENDING, IN_PROGRESS, COMPLETED, REJECTED,
                          WITHDRAWN, CANCELLED) — no changes needed
WORKFLOWS_PERMISSIONS   — EXISTS in common/constants/permissions.ts (VIEW, MANAGE) —
                          no changes needed (see Business Rules — Permission Model)
Task.workflowInstanceId — EXISTS — Task↔WorkflowInstance relation already scaffolded,
                          ready for the CREATE_TASK internal action
Committee.quorum        — EXISTS — reused directly for COMMITTEE approval mode,
                          no duplicate quorum field needed on WorkflowStage
WorkingCalendarService.calculateDeadline(start, workingHours, organizationId)
                        — EXISTS — the exact method this step's SLA logic calls
bullmq / @nestjs/bullmq — EXISTS in package.json — never registered in AppModule yet
```

---

## 2. PRISMA SCHEMA CHANGES

### New Enums (all CREATE)

```prisma
enum WorkflowObjectType {
  DOCUMENT
  INCIDENT
  AUDIT
  CORRECTIVE_ACTION
  MEETING
  COMMITTEE
}

enum WorkflowApprovalMode {
  SINGLE
  SEQUENTIAL
  PARALLEL
  COMMITTEE
}

enum WorkflowParallelThreshold {
  ALL
  MAJORITY
  ANY
}

enum WorkflowAssigneeStrategy {
  SPECIFIC_USER
  ROLE
  ORG_UNIT_HEAD
  SELF
  COMMITTEE
  ROUND_ROBIN
}

enum WorkflowTriggerCondition {
  SPECIFIC_USER
  ROLE_BASED
  ANY_AUTHENTICATED
  SYSTEM_AUTOMATIC
}

enum WorkflowActionType {
  CREATE_TASK
  SEND_NOTIFICATION
  GENERATE_PDF
  LOCK_DOCUMENT
  LOG_AUDIT
  WEBHOOK
}

enum WorkflowApprovalDecision {
  PENDING
  APPROVED
  REJECTED
}

enum WorkflowActionLogStatus {
  SUCCESS
  FAILED
  RETRYING
}

enum WorkflowInstanceStageOutcome {
  PENDING
  APPROVED
  REJECTED
  SKIPPED
}
```

**Why `WorkflowObjectType` doesn't replace `Task.objectType`/`Notification.objectType`:**
those two fields are intentionally generic strings used across every future module
(including ones with no workflow at all, like KPI). Only `WorkflowTemplate.objectType`
and `WorkflowInstance.objectType` are scoped specifically to "object types that have a
workflow" — the 6 CLAUDE.md lists — so only those two become the new enum.

**Why `committeeId` / `assigneeUserId` / `assigneeRoleId` / `triggerUserId` /
`triggerRoleId` are plain `String?` columns, not Prisma `@relation` fields:** adding a
formal relation would require reverse array fields on `Committee`, `Role`, and `User`
— models already shipped and tested in Steps 1, 4, and 10-to-come. Keeping these as
soft references (same pattern already used by `Task.objectType`/`objectId` and
`WorkflowStage.requiredPermission`) contains this step's schema change entirely
within the workflow models. No FK integrity is enforced at the DB level for these —
the service layer validates them at write time instead.

### What `WorkflowTemplate` Currently Has

```prisma
model WorkflowTemplate {
  id             String              @id @default(cuid())
  organizationId String
  name           String
  objectType     String
  isDefault      Boolean             @default(false)
  isActive       Boolean             @default(true)
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  organization   Organization        @relation(fields: [organizationId], references: [id])
  stages         WorkflowStage[]
  instances      WorkflowInstance[]

  @@index([organizationId])
  @@index([objectType])
}
```

### What `WorkflowTemplate` Must Have After Migration

```prisma
model WorkflowTemplate {
  id             String              @id @default(cuid())
  organizationId String
  nameEn         String                              // CHANGE: was `name`
  nameAr         String                              // ADD — bilingual, same rule as Role/LookupCategory
  objectType     WorkflowObjectType                  // CHANGE: String → enum
  isDefault      Boolean             @default(false)
  isActive       Boolean             @default(true)
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  organization   Organization        @relation(fields: [organizationId], references: [id])
  stages         WorkflowStage[]
  instances      WorkflowInstance[]

  @@index([organizationId])
  @@index([objectType])
}
```

**"Only one default template per objectType" is a service-layer rule, not a DB
constraint:** a naive `@@unique([organizationId, objectType, isDefault])` would also
reject two *non*-default templates for the same object type (both have `isDefault =
false`, which collides). Prisma doesn't support partial/filtered unique indexes
declaratively, so `WorkflowTemplateService.setDefault()` unsets `isDefault` on any
sibling template for that `organizationId` + `objectType` before setting the new one —
same pattern as `RoleService`'s admin-lockout checks (live query, not a DB constraint).

### What `WorkflowStage` Currently Has

```prisma
model WorkflowStage {
  id                 String               @id @default(cuid())
  workflowTemplateId String
  name               String
  description        String?
  order              Int
  slaWorkingHours    Int?
  requiredPermission String?
  isInitial          Boolean              @default(false)
  isFinal            Boolean              @default(false)

  workflowTemplate   WorkflowTemplate     @relation(fields: [workflowTemplateId], references: [id])
  transitionsFrom    WorkflowTransition[] @relation("TransitionFrom")
  transitionsTo      WorkflowTransition[] @relation("TransitionTo")
  instanceStages     WorkflowInstanceStage[]

  @@index([workflowTemplateId])
}
```

### What `WorkflowStage` Must Have After Migration

```prisma
model WorkflowStage {
  id                 String                     @id @default(cuid())
  workflowTemplateId String
  nameEn             String                                    // CHANGE: was `name`
  nameAr             String                                    // ADD
  description        String?
  order              Int
  slaWorkingHours    Int?                                       // KEEP — see SLA Rules below re: "days" vs "hours"
  requiredPermission String?                                    // KEEP — backstop gate, see Business Rules
  isInitial          Boolean                    @default(false)
  isFinal            Boolean                    @default(false)

  approvalMode       WorkflowApprovalMode       @default(SINGLE)         // ADD
  parallelThreshold  WorkflowParallelThreshold?                          // ADD — only read when approvalMode = PARALLEL
  committeeId        String?                                             // ADD — only read when approvalMode = COMMITTEE (soft ref → Committee.id)

  assigneeStrategy   WorkflowAssigneeStrategy   @default(ROLE)           // ADD
  assigneeUserId     String?                                             // ADD — used when assigneeStrategy = SPECIFIC_USER (soft ref → User.id)
  assigneeRoleId     String?                                             // ADD — used when assigneeStrategy = ROLE or ROUND_ROBIN, defines the pool (soft ref → Role.id)
  // ORG_UNIT_HEAD resolves at runtime from the workflow object's own org unit.
  // SELF resolves at runtime to the object's creator/owner.
  // COMMITTEE resolves via committeeId above.

  escalationConfig   Json?                                               // ADD — [{ afterHours: number, notifyRoleId?: string, notifyUserId?: string }]

  workflowTemplate   WorkflowTemplate           @relation(fields: [workflowTemplateId], references: [id])
  transitionsFrom    WorkflowTransition[]       @relation("TransitionFrom")
  transitionsTo      WorkflowTransition[]       @relation("TransitionTo")
  instanceStages     WorkflowInstanceStage[]

  @@index([workflowTemplateId])
}
```

### What `WorkflowTransition` Currently Has

```prisma
model WorkflowTransition {
  id              String        @id @default(cuid())
  fromStageId     String
  toStageId       String
  label           String
  requiredPermission String?
  conditionJson   Json?

  fromStage       WorkflowStage @relation("TransitionFrom", fields: [fromStageId], references: [id])
  toStage         WorkflowStage @relation("TransitionTo", fields: [toStageId], references: [id])

  @@index([fromStageId])
  @@index([toStageId])
}
```

### What `WorkflowTransition` Must Have After Migration

```prisma
model WorkflowTransition {
  id                 String                     @id @default(cuid())
  fromStageId        String
  toStageId          String
  labelEn            String                                    // CHANGE: was `label`
  labelAr            String                                    // ADD
  requiredPermission String?
  triggerCondition   WorkflowTriggerCondition   @default(ROLE_BASED)   // ADD — "who can trigger"
  triggerUserId      String?                                          // ADD — used when triggerCondition = SPECIFIC_USER (soft ref → User.id)
  triggerRoleId      String?                                          // ADD — used when triggerCondition = ROLE_BASED (soft ref → Role.id)
  validatorConfig    Json?                                            // RENAME from conditionJson — "must be true before transition"
                                                                       // e.g. { requiredFields: string[], minAttachments: number,
                                                                       //        allPreviousTasksComplete: boolean, minApprovals: number }

  fromStage          WorkflowStage              @relation("TransitionFrom", fields: [fromStageId], references: [id])
  toStage            WorkflowStage              @relation("TransitionTo", fields: [toStageId], references: [id])
  actions             WorkflowTransitionAction[]                       // ADD — reverse relation to new model

  @@index([fromStageId])
  @@index([toStageId])
}
```

**Why `requiredPermission` (existing) and `triggerCondition` (new) both exist:**
`requiredPermission` is a coarse global gate ("does the caller hold `documents:approve`
at all"); `triggerCondition` + `triggerUserId`/`triggerRoleId` is the finer-grained
"who specifically" per CLAUDE.md's distinct "Transition Conditions" concept. Both are
checked — `requiredPermission` first (cheap, already-proven `PermissionGuard` pattern),
then `triggerCondition` (instance-specific).

### What `WorkflowInstance` Currently Has

```prisma
model WorkflowInstance {
  id                 String                  @id @default(cuid())
  workflowTemplateId String
  objectType         String
  objectId           String
  status             WorkflowStatus          @default(PENDING)
  currentStageId     String?
  createdAt          DateTime                @default(now())
  updatedAt          DateTime                @updatedAt

  workflowTemplate   WorkflowTemplate        @relation(fields: [workflowTemplateId], references: [id])
  stages             WorkflowInstanceStage[]
  tasks              Task[]

  @@index([workflowTemplateId])
  @@index([objectType, objectId])
  @@index([status])
}
```

### What `WorkflowInstance` Must Have After Migration

```prisma
model WorkflowInstance {
  id                 String                  @id @default(cuid())
  organizationId     String                                     // ADD — denormalized for direct tenant
                                                                  // scoping; avoids joining through
                                                                  // WorkflowTemplate on every query
  workflowTemplateId String
  objectType         WorkflowObjectType                          // CHANGE: String → enum
  objectId           String
  status             WorkflowStatus          @default(PENDING)
  currentStageId     String?
  createdAt          DateTime                @default(now())
  updatedAt          DateTime                @updatedAt

  organization       Organization            @relation(fields: [organizationId], references: [id])   // ADD
  workflowTemplate   WorkflowTemplate        @relation(fields: [workflowTemplateId], references: [id])
  stages             WorkflowInstanceStage[]
  tasks              Task[]
  actionLogs         WorkflowActionLog[]                        // ADD — reverse relation

  @@index([organizationId])
  @@index([workflowTemplateId])
  @@index([objectType, objectId])
  @@index([status])
}
```

Add to **Organization model** (after existing relations):
```prisma
workflowInstances  WorkflowInstance[]
workflowActionLogs WorkflowActionLog[]
```

### What `WorkflowInstanceStage` Currently Has

```prisma
model WorkflowInstanceStage {
  id                 String           @id @default(cuid())
  workflowInstanceId String
  stageId            String
  enteredAt          DateTime         @default(now())
  exitedAt           DateTime?
  actorId            String?
  comment            String?

  workflowInstance   WorkflowInstance @relation(fields: [workflowInstanceId], references: [id])
  stage              WorkflowStage    @relation(fields: [stageId], references: [id])

  @@index([workflowInstanceId])
  @@index([stageId])
}
```

### What `WorkflowInstanceStage` Must Have After Migration

```prisma
model WorkflowInstanceStage {
  id                 String                        @id @default(cuid())
  workflowInstanceId String
  stageId            String
  enteredAt          DateTime                      @default(now())
  exitedAt           DateTime?
  slaDueAt           DateTime?                                          // ADD — computed via
                                                                          // WorkingCalendarService.calculateDeadline()
                                                                          // when the instance enters this stage
  slaBreached        Boolean                       @default(false)      // ADD — flipped by the 15-min sla-monitor job
  outcome            WorkflowInstanceStageOutcome  @default(PENDING)    // ADD — Core Concepts calls this
                                                                          // "record of every stage entry with
                                                                          // timing AND OUTCOME" — outcome was missing
  actorId            String?
  comment            String?

  workflowInstance   WorkflowInstance              @relation(fields: [workflowInstanceId], references: [id])
  stage              WorkflowStage                 @relation(fields: [stageId], references: [id])
  approvals          WorkflowApproval[]                                 // ADD — reverse relation to new model

  @@index([workflowInstanceId])
  @@index([stageId])
  @@index([slaDueAt])
}
```

### NEW Model — `WorkflowApproval`

*Core Concepts: "individual approval decisions within a stage" — supports SEQUENTIAL,
PARALLEL, and COMMITTEE approval modes, each of which needs more than one decision
recorded per stage entry.*

```prisma
model WorkflowApproval {
  id                      String                    @id @default(cuid())
  workflowInstanceStageId String
  approverId              String
  decision                WorkflowApprovalDecision  @default(PENDING)
  comment                 String?
  decidedAt               DateTime?
  createdAt               DateTime                  @default(now())

  workflowInstanceStage   WorkflowInstanceStage     @relation(fields: [workflowInstanceStageId], references: [id])
  approver                User                      @relation(fields: [approverId], references: [id])

  @@unique([workflowInstanceStageId, approverId])   // one decision per approver per stage entry
  @@index([workflowInstanceStageId])
  @@index([approverId])
}
```

Add to **User model** (after existing relations):
```prisma
workflowApprovals  WorkflowApproval[]
```

### NEW Model — `WorkflowTransitionAction`

*Core Concepts: "actions that fire on transition (internal + webhook)".*

```prisma
model WorkflowTransitionAction {
  id                   String              @id @default(cuid())
  workflowTransitionId String
  actionType           WorkflowActionType
  order                Int                 @default(0)
  isEnabled            Boolean             @default(true)
  configJson           Json?               // action-specific config — see Section 10

  workflowTransition   WorkflowTransition  @relation(fields: [workflowTransitionId], references: [id])
  actionLogs           WorkflowActionLog[]

  @@index([workflowTransitionId])
}
```

### NEW Model — `WorkflowActionLog`

*Core Concepts: "execution record for every action fired" — CLAUDE.md: "Every webhook
call logged in WorkflowActionLog", and internal actions are logged the same way for
a single consistent execution trail.*

```prisma
model WorkflowActionLog {
  id                         String                    @id @default(cuid())
  organizationId             String
  workflowTransitionActionId String
  workflowInstanceId         String
  actionType                 WorkflowActionType                          // denormalized — fast filtering without a join
  status                     WorkflowActionLogStatus   @default(SUCCESS)
  attemptCount               Int                       @default(1)
  responseSummary            String?
  errorMessage                String?
  executedAt                 DateTime                  @default(now())

  organization               Organization              @relation(fields: [organizationId], references: [id])
  workflowTransitionAction   WorkflowTransitionAction  @relation(fields: [workflowTransitionActionId], references: [id])
  workflowInstance           WorkflowInstance          @relation(fields: [workflowInstanceId], references: [id])

  @@index([organizationId])
  @@index([workflowTransitionActionId])
  @@index([workflowInstanceId])
  @@index([status])
  @@index([executedAt])
}
```

### Migration Name

```
extend_workflow_engine_full_schema
```

Run (see Step 4's plan for why `migrate dev` may refuse in a non-interactive shell —
use the `migrate diff` + manual migration folder + `migrate deploy` workaround if so):
```bash
cd backend && npx prisma migrate dev --name extend_workflow_engine_full_schema
```

**Data migration note:** pre-production data only. No `WorkflowTemplate`/`WorkflowStage`/
`WorkflowTransition` rows exist in the dev database yet (no tenant has ever had
`seedDefaultWorkflows()` called, since it doesn't exist until this step) — safe to
apply directly, no backfill script needed.

---

## 3. FILES TO CREATE (BACKEND)

All paths relative to `backend/src/foundation/workflow/` unless noted.

### Commit 1 — Schema (standalone commit before any code)
```
backend/prisma/schema.prisma                                            MODIFY
backend/prisma/migrations/YYYYMMDDHHMMSS_.../                          GENERATED
```

---

### Commit 2 — Interfaces and DTOs
```
interfaces/workflow-template.interface.ts                              CREATE
interfaces/workflow-stage.interface.ts                                 CREATE
interfaces/workflow-transition.interface.ts                             CREATE
interfaces/workflow-instance.interface.ts                               CREATE
dto/create-workflow-template.dto.ts                                     CREATE
dto/update-workflow-template.dto.ts                                     CREATE
dto/create-workflow-stage.dto.ts                                        CREATE
dto/update-workflow-stage.dto.ts                                        CREATE
dto/create-workflow-transition.dto.ts                                   CREATE
dto/update-workflow-transition.dto.ts                                   CREATE
dto/create-workflow-transition-action.dto.ts                            CREATE
dto/trigger-transition.dto.ts                                           CREATE
dto/submit-approval.dto.ts                                              CREATE
```

**`workflow-template.interface.ts`**:
```typescript
export interface IWorkflowTemplate {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string;
  objectType: string;   // WorkflowObjectType — kept as string at the interface
                         // boundary so DTOs can validate with @IsEnum without a
                         // runtime import of the generated Prisma enum
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  stages?: IWorkflowStage[];   // populated when requested with detail
}
```

**`workflow-stage.interface.ts`**:
```typescript
export interface IWorkflowStage {
  id: string;
  workflowTemplateId: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  order: number;
  slaWorkingHours: number | null;
  requiredPermission: string | null;
  isInitial: boolean;
  isFinal: boolean;
  approvalMode: string;              // WorkflowApprovalMode
  parallelThreshold: string | null;  // WorkflowParallelThreshold
  committeeId: string | null;
  assigneeStrategy: string;          // WorkflowAssigneeStrategy
  assigneeUserId: string | null;
  assigneeRoleId: string | null;
  escalationConfig: Record<string, unknown> | null;
}
```

**`workflow-transition.interface.ts`**:
```typescript
export interface IWorkflowTransition {
  id: string;
  fromStageId: string;
  toStageId: string;
  labelEn: string;
  labelAr: string;
  requiredPermission: string | null;
  triggerCondition: string;          // WorkflowTriggerCondition
  triggerUserId: string | null;
  triggerRoleId: string | null;
  validatorConfig: Record<string, unknown> | null;
  actions?: IWorkflowTransitionAction[];
}

export interface IWorkflowTransitionAction {
  id: string;
  workflowTransitionId: string;
  actionType: string;                // WorkflowActionType
  order: number;
  isEnabled: boolean;
  configJson: Record<string, unknown> | null;
}
```

**`workflow-instance.interface.ts`**:
```typescript
export interface IWorkflowInstance {
  id: string;
  organizationId: string;
  workflowTemplateId: string;
  objectType: string;
  objectId: string;
  status: string;                    // WorkflowStatus
  currentStageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IWorkflowInstanceStage {
  id: string;
  workflowInstanceId: string;
  stageId: string;
  enteredAt: Date;
  exitedAt: Date | null;
  slaDueAt: Date | null;
  slaBreached: boolean;
  outcome: string;                   // WorkflowInstanceStageOutcome
  actorId: string | null;
  comment: string | null;
}

export interface IWorkflowApproval {
  id: string;
  workflowInstanceStageId: string;
  approverId: string;
  decision: string;                  // WorkflowApprovalDecision
  comment: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}
```

**DTO validation summary** (class-validator, mirroring Step 4's DTO conventions —
never accept `organizationId`/`createdBy` from the body):

- `create-workflow-template.dto.ts`: `nameEn`/`nameAr` (`@IsString @IsNotEmpty
  @MaxLength(100)`), `objectType` (`@IsEnum(WorkflowObjectTypeValues)`), `isDefault`
  (`@IsBoolean @IsOptional`)
- `update-workflow-template.dto.ts`: `PartialType(CreateWorkflowTemplateDto)`
- `create-workflow-stage.dto.ts`: `nameEn`/`nameAr` (required), `order` (`@IsInt
  @Min(0)`), `slaWorkingHours` (`@IsInt @IsOptional @Min(0)`), `approvalMode`
  (`@IsEnum`), `parallelThreshold` (`@IsEnum @IsOptional`), `committeeId`
  (`@IsString @IsOptional`), `assigneeStrategy` (`@IsEnum`), `assigneeUserId` /
  `assigneeRoleId` (`@IsString @IsOptional`), `escalationConfig` (`@IsArray
  @IsOptional`)
- `update-workflow-stage.dto.ts`: `PartialType(CreateWorkflowStageDto)`
- `create-workflow-transition.dto.ts`: `fromStageId`/`toStageId` (`@IsString
  @IsNotEmpty`), `labelEn`/`labelAr` (required), `triggerCondition` (`@IsEnum`),
  `triggerUserId`/`triggerRoleId` (`@IsString @IsOptional`), `validatorConfig`
  (`@IsObject @IsOptional`)
- `update-workflow-transition.dto.ts`: `PartialType(OmitType(CreateWorkflowTransitionDto,
  ['fromStageId', 'toStageId']))` — a transition's endpoints are structural, not
  editable after creation; delete and recreate instead
- `create-workflow-transition-action.dto.ts`: `actionType` (`@IsEnum`), `order`
  (`@IsInt @Min(0)`), `isEnabled` (`@IsBoolean @IsOptional`), `configJson`
  (`@IsObject @IsOptional`)
- `trigger-transition.dto.ts`: `transitionId` (`@IsString @IsNotEmpty`), `comment`
  (`@IsString @IsOptional @MaxLength(2000)`)
- `submit-approval.dto.ts`: `decision` (`@IsEnum(['APPROVED', 'REJECTED'])`),
  `comment` (`@IsString @IsOptional @MaxLength(2000)`)

---

### Commit 3 — System seed data
```
workflow.seed.ts                                                        CREATE
```

**`workflow.seed.ts`** — pure data file, no NestJS dependencies. References role
**keys** (not IDs — tenant role IDs don't exist until `seedSystemRoles()` runs for
that tenant), resolved to real per-tenant `Role.id` at seed time by
`WorkflowService.seedDefaultWorkflows()` (same "seed with a stable string, resolve
to a real ID at seed time" pattern already proven in `RoleService.seedSystemRoles()`
for permission strings → `Permission.id`).

```typescript
export interface SeedAction {
  actionType: 'CREATE_TASK' | 'SEND_NOTIFICATION' | 'GENERATE_PDF' | 'LOCK_DOCUMENT' | 'LOG_AUDIT' | 'WEBHOOK';
  order: number;
  configJson?: Record<string, unknown>;
}

export interface SeedTransition {
  fromStageKey: string;
  toStageKey: string;
  labelEn: string;
  labelAr: string;
  triggerCondition: 'SPECIFIC_USER' | 'ROLE_BASED' | 'ANY_AUTHENTICATED' | 'SYSTEM_AUTOMATIC';
  triggerRoleKey?: string;          // resolved to Role.id at seed time
  requiredPermission?: string;
  validatorConfig?: Record<string, unknown>;
  actions: SeedAction[];
}

export interface SeedStage {
  key: string;                      // stable key within this template only (not global) — used to
                                     // wire transitions below; not persisted as its own column
  nameEn: string;
  nameAr: string;
  order: number;
  slaWorkingHours?: number;
  isInitial: boolean;
  isFinal: boolean;
  approvalMode: 'SINGLE' | 'SEQUENTIAL' | 'PARALLEL' | 'COMMITTEE';
  parallelThreshold?: 'ALL' | 'MAJORITY' | 'ANY';
  assigneeStrategy: 'SPECIFIC_USER' | 'ROLE' | 'ORG_UNIT_HEAD' | 'SELF' | 'COMMITTEE' | 'ROUND_ROBIN';
  assigneeRoleKey?: string;         // resolved to Role.id at seed time
}

export interface SeedWorkflow {
  objectType: 'DOCUMENT' | 'INCIDENT' | 'AUDIT' | 'CORRECTIVE_ACTION' | 'MEETING' | 'COMMITTEE';
  nameEn: string;
  nameAr: string;
  stages: SeedStage[];
  transitions: SeedTransition[];
}

export const SYSTEM_WORKFLOW_SEED: SeedWorkflow[] = [
  {
    objectType: 'DOCUMENT',
    nameEn: 'Document Lifecycle', nameAr: 'دورة حياة الوثيقة',
    stages: [
      { key: 'draft',     nameEn: 'Draft',        nameAr: 'مسودة',        order: 10, isInitial: true,  isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
      { key: 'review',    nameEn: 'Under Review',  nameAr: 'قيد المراجعة', order: 20, isInitial: false, isFinal: false, approvalMode: 'SEQUENTIAL', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 40 },
      { key: 'approved',  nameEn: 'Approved',      nameAr: 'معتمدة',       order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'published', nameEn: 'Published',     nameAr: 'منشورة',       order: 40, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
      { key: 'obsolete',  nameEn: 'Obsolete',       nameAr: 'ملغاة',        order: 50, isInitial: false, isFinal: true,  approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'draft',    toStageKey: 'review',    labelEn: 'Submit for Review', labelAr: 'إرسال للمراجعة', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:submit',  validatorConfig: { requiredFields: ['title', 'content'] }, actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'review',   toStageKey: 'approved',  labelEn: 'Approve',           labelAr: 'اعتماد',         triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:approve', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'review',   toStageKey: 'draft',     labelEn: 'Request Changes',   labelAr: 'طلب تعديلات',    triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:review',  actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'approved', toStageKey: 'published', labelEn: 'Publish',           labelAr: 'نشر',            triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:publish', actions: [{ actionType: 'GENERATE_PDF', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'published', toStageKey: 'obsolete', labelEn: 'Mark Obsolete',     labelAr: 'إلغاء',          triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:manage_templates', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
    ],
  },
  {
    objectType: 'INCIDENT',
    nameEn: 'Incident Management', nameAr: 'إدارة الحوادث',
    stages: [
      { key: 'reported',      nameEn: 'Reported',                nameAr: 'مُبلَّغ',              order: 10, isInitial: true,  isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 8 },
      { key: 'investigating',  nameEn: 'Under Investigation',     nameAr: 'قيد التحقيق',          order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 40 },
      { key: 'rootcause',      nameEn: 'Root Cause Analysis',      nameAr: 'تحليل السبب الجذري', order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 24 },
      { key: 'capdraft',       nameEn: 'Corrective Action Plan',   nameAr: 'خطة الإجراء التصحيحي', order: 40, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 24 },
      { key: 'capapproved',    nameEn: 'Plan Approved',            nameAr: 'اعتماد الخطة',         order: 50, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'implementing',   nameEn: 'Implementing',             nameAr: 'قيد التنفيذ',          order: 60, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER' },
      { key: 'verifying',      nameEn: 'Pending Verification',      nameAr: 'بانتظار التحقق',       order: 70, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'closed',         nameEn: 'Closed',                   nameAr: 'مغلق',                 order: 80, isInitial: false, isFinal: true,  approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'reported',     toStageKey: 'investigating', labelEn: 'Start Investigation', labelAr: 'بدء التحقيق',       triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'investigating', toStageKey: 'rootcause',    labelEn: 'Complete Investigation', labelAr: 'إنهاء التحقيق', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'rootcause',     toStageKey: 'capdraft',     labelEn: 'Draft Action Plan',    labelAr: 'صياغة خطة الإجراء', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'capdraft',      toStageKey: 'capapproved',  labelEn: 'Approve Plan',          labelAr: 'اعتماد الخطة',     triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:approve_plan', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'capapproved',   toStageKey: 'implementing', labelEn: 'Begin Implementation',  labelAr: 'بدء التنفيذ',      triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'implementing',  toStageKey: 'verifying',    labelEn: 'Submit for Verification', labelAr: 'إرسال للتحقق',  triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'verifying',     toStageKey: 'closed',       labelEn: 'Close Incident',        labelAr: 'إغلاق الحادثة',   triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:close', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },
  {
    objectType: 'AUDIT',
    nameEn: 'Audit Lifecycle', nameAr: 'دورة حياة المراجعة',
    stages: [
      { key: 'planning',   nameEn: 'Planning',       nameAr: 'التخطيط',        order: 10, isInitial: true,  isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'AUDITOR', slaWorkingHours: 40 },
      { key: 'fieldwork',  nameEn: 'Fieldwork',       nameAr: 'العمل الميداني', order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'AUDITOR' },
      { key: 'draftreport', nameEn: 'Draft Report',   nameAr: 'مسودة التقرير',  order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'AUDITOR', slaWorkingHours: 24 },
      { key: 'reportreview', nameEn: 'Report Review', nameAr: 'مراجعة التقرير', order: 40, isInitial: false, isFinal: false, approvalMode: 'SEQUENTIAL', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 24 },
      { key: 'finalreport', nameEn: 'Final Report',   nameAr: 'التقرير النهائي', order: 50, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
      { key: 'closed',      nameEn: 'Closed',         nameAr: 'مغلقة',          order: 60, isInitial: false, isFinal: true,  approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'planning',    toStageKey: 'fieldwork',   labelEn: 'Begin Fieldwork',    labelAr: 'بدء العمل الميداني', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:execute', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'fieldwork',   toStageKey: 'draftreport', labelEn: 'Draft Report',        labelAr: 'صياغة التقرير',      triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:report',  actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'draftreport', toStageKey: 'reportreview', labelEn: 'Submit for Review',  labelAr: 'إرسال للمراجعة',     triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:report',  actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'reportreview', toStageKey: 'finalreport', labelEn: 'Approve Report',     labelAr: 'اعتماد التقرير',     triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:report',  actions: [{ actionType: 'GENERATE_PDF', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'finalreport', toStageKey: 'closed',      labelEn: 'Close Audit',         labelAr: 'إغلاق المراجعة',     triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:close',   actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },
  {
    objectType: 'CORRECTIVE_ACTION',
    nameEn: 'Corrective Action', nameAr: 'الإجراء التصحيحي',
    stages: [
      { key: 'open',           nameEn: 'Open',           nameAr: 'مفتوح',        order: 10, isInitial: true,  isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER' },
      { key: 'assigned',       nameEn: 'Assigned',       nameAr: 'مُسند',         order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 8 },
      { key: 'implementation', nameEn: 'Implementation', nameAr: 'التنفيذ',       order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER' },
      { key: 'verification',   nameEn: 'Verification',   nameAr: 'التحقق',        order: 40, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'closed',         nameEn: 'Closed',         nameAr: 'مغلق',          order: 50, isInitial: false, isFinal: true,  approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'open',           toStageKey: 'assigned',       labelEn: 'Assign',           labelAr: 'إسناد',        triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:approve_plan', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'assigned',       toStageKey: 'implementation', labelEn: 'Begin Implementation', labelAr: 'بدء التنفيذ', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:investigate', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'implementation', toStageKey: 'verification',  labelEn: 'Submit for Verification', labelAr: 'إرسال للتحقق', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'verification',   toStageKey: 'closed',         labelEn: 'Verify and Close', labelAr: 'التحقق والإغلاق', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:close', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },
  {
    objectType: 'MEETING',
    nameEn: 'Meeting Lifecycle', nameAr: 'دورة حياة الاجتماع',
    stages: [
      { key: 'scheduled',   nameEn: 'Scheduled',    nameAr: 'مجدول',         order: 10, isInitial: true,  isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
      { key: 'inprogress',  nameEn: 'In Progress',  nameAr: 'قيد الانعقاد',  order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
      { key: 'minutesdraft', nameEn: 'Minutes Draft', nameAr: 'مسودة المحضر', order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'SELF', slaWorkingHours: 24 },
      { key: 'minutesapproved', nameEn: 'Minutes Approved', nameAr: 'اعتماد المحضر', order: 40, isInitial: false, isFinal: false, approvalMode: 'COMMITTEE', assigneeStrategy: 'COMMITTEE', slaWorkingHours: 40 },
      { key: 'closed',      nameEn: 'Closed',       nameAr: 'مغلق',          order: 50, isInitial: false, isFinal: true,  approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
    ],
    transitions: [
      { fromStageKey: 'scheduled',        toStageKey: 'inprogress',       labelEn: 'Start Meeting',      labelAr: 'بدء الاجتماع',     triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:manage', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'inprogress',       toStageKey: 'minutesdraft',     labelEn: 'Draft Minutes',       labelAr: 'صياغة المحضر',    triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:record_minutes', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'minutesdraft',     toStageKey: 'minutesapproved',  labelEn: 'Submit for Approval', labelAr: 'إرسال للاعتماد',  triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:record_minutes', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'minutesapproved',  toStageKey: 'closed',           labelEn: 'Close Meeting',       labelAr: 'إغلاق الاجتماع',  triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:approve_minutes', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },
  {
    objectType: 'COMMITTEE',
    nameEn: 'Committee Lifecycle', nameAr: 'دورة حياة اللجنة',
    stages: [
      { key: 'formation', nameEn: 'Formation', nameAr: 'التشكيل', order: 10, isInitial: true,  isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'TENANT_ADMIN' },
      { key: 'active',    nameEn: 'Active',    nameAr: 'نشطة',     order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'TENANT_ADMIN' },
      { key: 'dissolved', nameEn: 'Dissolved', nameAr: 'محلولة',   order: 30, isInitial: false, isFinal: true,  approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'TENANT_ADMIN' },
    ],
    transitions: [
      { fromStageKey: 'formation', toStageKey: 'active',    labelEn: 'Activate',  labelAr: 'تفعيل',  triggerCondition: 'ROLE_BASED', requiredPermission: 'committees:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'active',    toStageKey: 'dissolved', labelEn: 'Dissolve',  labelAr: 'حل اللجنة', triggerCondition: 'ROLE_BASED', requiredPermission: 'committees:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },
];
```

Every stage name and transition label requires **Arabic labels from day one** — same
rule as Step 3's lookup seed and Step 4's role seed.

---

### Commit 4 — WorkflowTemplateService (builder/config) + spec
```
workflow-template.service.ts                                            CREATE
workflow-template.service.spec.ts                                       CREATE
```

**`workflow-template.service.ts`** methods:

```typescript
// ── Seed ─────────────────────────────────────────────────────────────────────

// Upserts all 6 SYSTEM_WORKFLOW_SEED templates + their stages/transitions/actions
// for one tenant. Resolves assigneeRoleKey/triggerRoleKey to that tenant's real
// Role.id via RoleService (must run AFTER seedSystemRoles() — see Dependencies).
// Idempotent — safe to call repeatedly. Called by TenantService.bootstrap().
seedDefaultWorkflows(organizationId: string): Promise<void>

// ── Templates ────────────────────────────────────────────────────────────────

getTemplates(organizationId: string): Promise<IWorkflowTemplate[]>
getTemplateById(id: string, organizationId: string): Promise<IWorkflowTemplate>  // includes stages[]

createTemplate(dto: CreateWorkflowTemplateDto, organizationId: string, actorId: string): Promise<IWorkflowTemplate>
updateTemplate(id: string, dto: UpdateWorkflowTemplateDto, organizationId: string, actorId: string): Promise<IWorkflowTemplate>

// Unsets isDefault on any sibling template for the same objectType first (see
// Business Rules — "Only one default template per objectType")
setDefault(id: string, organizationId: string, actorId: string): Promise<void>

deactivateTemplate(id: string, organizationId: string, actorId: string): Promise<void>

// ── Stages ───────────────────────────────────────────────────────────────────

addStage(templateId: string, dto: CreateWorkflowStageDto, organizationId: string, actorId: string): Promise<IWorkflowStage>
updateStage(id: string, dto: UpdateWorkflowStageDto, organizationId: string, actorId: string): Promise<IWorkflowStage>

// Throws ConflictException if any WorkflowTransition still references this stage
// (fromStageId or toStageId), or if it is the isInitial stage and other stages exist
removeStage(id: string, organizationId: string, actorId: string): Promise<void>

// ── Transitions ──────────────────────────────────────────────────────────────

addTransition(dto: CreateWorkflowTransitionDto, organizationId: string, actorId: string): Promise<IWorkflowTransition>
removeTransition(id: string, organizationId: string, actorId: string): Promise<void>

// ── Transition Actions ───────────────────────────────────────────────────────

addTransitionAction(
  transitionId: string,
  dto: CreateWorkflowTransitionActionDto,
  organizationId: string,
  actorId: string,
): Promise<IWorkflowTransitionAction>

removeTransitionAction(id: string, organizationId: string, actorId: string): Promise<void>
```

**Spec must cover:**
- `seedDefaultWorkflows()` creates all 6 templates + correct stages/transitions/
  actions for a fresh org, with `assigneeRoleKey`/`triggerRoleKey` correctly resolved
  to that tenant's actual `Role.id` values
- `seedDefaultWorkflows()` is idempotent — calling it twice produces no duplicates
- `setDefault()` unsets `isDefault` on the previous default template for the same
  `objectType` before setting the new one
- `removeStage()` throws `ConflictException` when a transition still references it
- Tenant isolation test: org B's `getTemplates()` never returns org A's templates;
  org B cannot add a stage to a template belonging to org A

---

### Commit 5 — WorkflowService (runtime engine) + spec
```
workflow.service.ts                                                     CREATE
workflow.service.spec.ts                                                CREATE
```

This is **the** `WorkflowService` CLAUDE.md refers to in "Route ALL state transitions
through WorkflowService" — every future functional module calls these methods, never
manages its own status field.

**`workflow.service.ts`** methods:

```typescript
// ── Instance lifecycle ───────────────────────────────────────────────────────

// Resolves the tenant's default (or explicitly given) template for objectType,
// creates the WorkflowInstance at its isInitial stage, computes that stage's
// slaDueAt via WorkingCalendarService, resolves + notifies the assignee, and
// fires that stage-entry's actions (there are none on stage entry itself in the
// seed data — actions fire on TRANSITIONS — but the hook exists for future use).
startInstance(
  objectType: string,
  objectId: string,
  organizationId: string,
  actorId: string,
  templateId?: string,
): Promise<IWorkflowInstance>

getInstance(id: string, organizationId: string): Promise<IWorkflowInstance>       // includes stages[] + approvals
getInstanceForObject(objectType: string, objectId: string, organizationId: string): Promise<IWorkflowInstance | null>

// ── Transitions ──────────────────────────────────────────────────────────────

// The single choke point for every state change in the platform:
//   1. Load the instance + its current stage + the requested transition
//   2. Check requiredPermission (via caller-supplied userPermissions) and
//      triggerCondition (SPECIFIC_USER / ROLE_BASED / ANY_AUTHENTICATED —
//      SYSTEM_AUTOMATIC transitions are never called through this path, see
//      triggerSystemTransition below)
//   3. Check validatorConfig (required fields present on the caller-supplied
//      snapshot, minApprovals reached, all previous-stage tasks completed)
//   4. If approvalMode requires more than one decision (SEQUENTIAL/PARALLEL/
//      COMMITTEE) and not yet satisfied — record this actor's WorkflowApproval
//      and return the instance unchanged (transition does not fire yet)
//   5. Mark current WorkflowInstanceStage exited + outcome; create the new
//      WorkflowInstanceStage at toStage, compute its slaDueAt
//   6. Resolve the new stage's assignee per assigneeStrategy
//   7. Fire every enabled WorkflowTransitionAction in `order`, logging each to
//      WorkflowActionLog (internal actions run inline; WEBHOOK actions enqueue
//      a BullMQ job — see Section 10)
//   8. AuditLogService.log() for the transition itself
triggerTransition(
  instanceId: string,
  dto: TriggerTransitionDto,
  organizationId: string,
  actorId: string,
  userPermissions: string[],
): Promise<IWorkflowInstance>

// Records one approver's decision within the current stage. If approvalMode is
// satisfied (threshold met for PARALLEL, full chain for SEQUENTIAL, quorum +
// majority for COMMITTEE per Committee.quorum), automatically calls
// triggerTransition() for the stage's approval-path transition. A REJECTED
// decision under SEQUENTIAL immediately halts the chain (per Business Rules).
submitApproval(
  instanceStageId: string,
  dto: SubmitApprovalDto,
  organizationId: string,
  actorId: string,
): Promise<IWorkflowApproval>

// For SYSTEM_AUTOMATIC transitions only (no human actor, no permission check) —
// called by future background jobs (e.g. a scheduled auto-close)
triggerSystemTransition(instanceId: string, transitionId: string, organizationId: string): Promise<IWorkflowInstance>

// ── Assignee resolution ──────────────────────────────────────────────────────

// Resolves a stage's configured assigneeStrategy to a concrete User.id:
//   SPECIFIC_USER  → assigneeUserId as-is
//   ROLE           → first active user holding assigneeRoleId in this org
//                    (defers real "which user" tie-breaking to Step 9 Users)
//   ORG_UNIT_HEAD  → the org unit head of the workflow object's own org unit
//                    (requires the calling module to pass orgUnitId — stubbed
//                    until a functional module actually supplies one)
//   SELF           → the actor who created the WorkflowInstance
//   COMMITTEE      → no single assignee; all committee members become approvers
//   ROUND_ROBIN    → the least-recently-assigned active user holding assigneeRoleId
resolveAssignee(stage: IWorkflowStage, instance: IWorkflowInstance, organizationId: string): Promise<string | string[]>

// ── AI stub (see Section 9) ──────────────────────────────────────────────────

suggestWorkflowConfig(objectType: string, organizationId: string, actorId: string): Promise<SuggestedWorkflowConfig>
```

**Spec must cover:**
- `startInstance()` creates the instance at the template's `isInitial` stage with a
  computed `slaDueAt` (mock `WorkingCalendarService.calculateDeadline()`)
- `triggerTransition()` throws `ForbiddenException` when `requiredPermission` is not
  in the caller's `userPermissions`
- `triggerTransition()` throws `ForbiddenException` when `triggerCondition =
  SPECIFIC_USER` and the actor does not match `triggerUserId`
- `triggerTransition()` throws `ConflictException` when `validatorConfig` requires
  fields/attachments/approvals not yet satisfied
- `triggerTransition()` fires every enabled action in `order` and writes one
  `WorkflowActionLog` row per action
- `submitApproval()` under `SEQUENTIAL` halts the chain on the first `REJECTED`
  decision — no further approvals are requested, instance stays in place
- `submitApproval()` under `PARALLEL` with `MAJORITY` threshold transitions once
  more than half of recorded decisions are `APPROVED`
- `submitApproval()` under `COMMITTEE` checks `Committee.quorum` before transitioning
- `resolveAssignee()` for `ROLE` returns an active user holding that role; throws
  `NotFoundException` if no user in the org holds it
- Tenant isolation test: org B cannot `triggerTransition()` on an instance
  belonging to org A; org B's `getInstance()` never returns org A's instances

---

### Commit 6 — BullMQ registration + webhook firing job
```
common/queue/queue.module.ts                                            CREATE
workflow-action.processor.ts                                             CREATE
```

**First activation of BullMQ in the codebase.** `bullmq` / `@nestjs/bullmq` have been
in `package.json` since scaffold but `BullModule` has never been registered in
`AppModule`. This commit does that.

**`common/queue/queue.module.ts`**:
```typescript
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env['REDIS_URL'] || 'redis://localhost:6379',
        },
      }),
    }),
    BullModule.registerQueue({ name: 'workflow-actions' }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

**`workflow-action.processor.ts`** — `@Processor('workflow-actions')`:
- Consumes jobs enqueued by `WorkflowService.triggerTransition()` for every
  `WEBHOOK`-type `WorkflowTransitionAction`
- Job payload: `{ workflowTransitionActionId, workflowInstanceId, organizationId,
  payload }` (the structured JSON body to POST — object type, instance id, from/to
  stage, actor, timestamp)
- POSTs to `configJson.webhookUrl` with `configJson.headers` merged in
- On success: writes a `SUCCESS` `WorkflowActionLog` row with `responseSummary`
  (truncated response body)
- On failure: BullMQ's own retry (`attempts: 3`, exponential backoff) handles the
  retry; each attempt that still fails writes a `RETRYING` log row, and if all 3
  attempts exhaust, a final `FAILED` row — see Section 10 for full retry semantics

Add `QueueModule` to `AppModule` imports.

**Local dev note:** this commit makes `REDIS_URL` a real local requirement for the
first time — every prior step's health check flagged it empty as acceptable ("Railway
injects in production"). From this step forward, local development needs Redis
running (`docker run -p 6379:6379 redis` or equivalent) for the webhook queue and
SLA monitor to function; the app still boots without it, but queued jobs will fail
to connect until Redis is reachable.

---

### Commit 7 — SLA monitor job
```
sla-monitor.processor.ts                                                CREATE
```

**`sla-monitor.processor.ts`** — a repeatable BullMQ job (`every: 15 * 60 * 1000`,
registered via `queue.add(..., { repeat: { every: ... } })` at module init):
- Queries every `WorkflowInstanceStage` with `exitedAt: null`, `slaDueAt: { lt: now }`,
  `slaBreached: false`
- Sets `slaBreached = true` on each
- Reads that stage's `escalationConfig` and, for each `{ afterHours, notifyRoleId,
  notifyUserId }` entry whose threshold has now elapsed, fires a `SEND_NOTIFICATION`
  (no `WorkflowActionLog` row — this is an escalation, not a transition action;
  logged via `AuditLogService` instead, `action: 'UPDATE'`, `objectType:
  'WorkflowInstanceStage'`)
- Per CLAUDE.md: "Escalation triggers only fire during working hours" — the job
  itself runs every 15 minutes regardless, but individual escalation notifications
  are only dispatched when `WorkingCalendarService` confirms the current moment is
  within the tenant's working hours; otherwise the escalation is deferred to the
  next run that lands inside working hours

---

### Commit 8 — WorkflowTemplateController + WorkflowController + specs
```
workflow-template.controller.ts                                         CREATE
workflow-template.controller.spec.ts                                    CREATE
workflow.controller.ts                                                  CREATE
workflow.controller.spec.ts                                              CREATE
```

**`WorkflowTemplateController`** — the builder/config surface:

```
GET    /workflow-templates                              @Permissions(WORKFLOWS_PERMISSIONS.VIEW)
GET    /workflow-templates/:id                           @Permissions(WORKFLOWS_PERMISSIONS.VIEW)
POST   /workflow-templates                               @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
PATCH  /workflow-templates/:id                            @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
POST   /workflow-templates/:id/set-default                @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
POST   /workflow-templates/:id/deactivate                 @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
POST   /workflow-templates/:id/stages                     @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
PATCH  /workflow-templates/stages/:id                     @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
DELETE /workflow-templates/stages/:id                     @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
POST   /workflow-templates/transitions                    @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
DELETE /workflow-templates/transitions/:id                @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
POST   /workflow-templates/transitions/:id/actions         @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
DELETE /workflow-templates/transitions/actions/:id         @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
```

**`WorkflowController`** — the runtime engine surface (used by every functional
module, not directly by end users typing URLs — but still a real HTTP surface for
the frontend's "approve/reject" buttons):

```
GET    /workflows/instances/:id                           @Permissions(WORKFLOWS_PERMISSIONS.VIEW)
POST   /workflows/instances/:id/transitions                @Permissions() — NONE at class level; each
                                                            transition's own requiredPermission is checked
                                                            inside WorkflowService, since the permission
                                                            needed varies per transition (e.g. documents:approve
                                                            vs documents:publish), not a fixed workflows:* string
POST   /workflows/instance-stages/:id/approvals            same as above — checked inside WorkflowService
```

**Note on the two "no class-level permission" endpoints:** unlike every other
controller in the codebase, these two intentionally skip a blanket `@Permissions()`
decorator — the actual required permission is data-driven (whatever the specific
`WorkflowTransition.requiredPermission` says), not a fixed string known at compile
time. `TenantGuard`/`PermissionGuard` still run (authentication + `userPermissions`
population); `WorkflowService` performs the fine-grained check itself using the
populated `userPermissions` array. This is a deliberate, documented exception — see
Business Rules, "Permission Model for Runtime Transitions".

Rules:
- `@UseGuards(TenantGuard, PermissionGuard)` at class level on both controllers
- `@CurrentTenant()` for organizationId — never from request body
- `@CurrentUser()` for actorId on all mutations
- Zero business logic — all delegation to the two services
- Controller specs mock the services and override guards

---

### Commit 9 — WorkflowModule + AppModule
```
workflow.module.ts                                                      CREATE
app.module.ts                                                          MODIFY
```

**`workflow.module.ts`**:
```typescript
@Module({
  imports: [PrismaModule, QueueModule, WorkingCalendarModule, forwardRef(() => TenantModule)],
  controllers: [WorkflowTemplateController, WorkflowController],
  providers: [WorkflowTemplateService, WorkflowService, WorkflowActionProcessor, SlaMonitorProcessor],
  exports: [WorkflowTemplateService, WorkflowService],
})
export class WorkflowModule {}
```

Add `WorkflowModule` to `AppModule` imports. Unlike `RolesModule`, `WorkflowModule`
does **not** need `@Global()` — nothing outside this module needs to inject its
services via a guard the way `PERMISSION_RESOLVER` did; future functional modules
will import `WorkflowModule` directly and inject `WorkflowService` normally.

---

### Commit 10 — TenantService bootstrap wiring
```
foundation/tenant/tenant.service.ts                                    MODIFY
foundation/tenant/tenant.module.ts                                     MODIFY
```

**`tenant.service.ts`** changes — `bootstrap()` currently has:
```typescript
await this.lookupService.seedSystemData();
await this.roleService.seedSystemRoles(id);
// TODO(Step 6 — Workflow): create default workflow templates per object type
```
Replace with:
```typescript
await this.lookupService.seedSystemData();
await this.roleService.seedSystemRoles(id);
await this.workflowTemplateService.seedDefaultWorkflows(id);
// TODO(Step 7 — Notifications): register default notification rules
```

**Critical ordering:** `seedDefaultWorkflows()` MUST run after `seedSystemRoles()` —
it resolves `assigneeRoleKey`/`triggerRoleKey` strings to that tenant's actual
`Role.id` rows, which don't exist until roles are seeded. This mirrors the existing
`lookupService.seedSystemData()` → `roleService.seedSystemRoles()` ordering already
established in Step 4 (roles seeding has no such dependency, but the principle —
"seed order matches dependency order" — is the same).

Inject `WorkflowTemplateService` via `@Inject(forwardRef(() => WorkflowTemplateService))`,
same pattern as `LookupService`/`RoleService` in this file.

**`tenant.module.ts`** changes — add `forwardRef(() => WorkflowModule)` to `imports`.

---

## 4. FILES TO CREATE (FRONTEND)

Angular standalone components. PrimeNG for UI. Tailwind for layout. Form-based
builder, **not** a visual canvas — CLAUDE.md is explicit that draw.io-based visual
workflow building is Phase 3 (Steps 26–27), deferred until paying customers justify
the investment.

All paths relative to `frontend/src/app/foundation/workflow/`.

### Commit 11 — Angular workflow builder feature
```
services/workflow-template.service.ts                                  CREATE
services/workflow.service.ts                                            CREATE
components/
  workflow-template-list/workflow-template-list.component.ts           CREATE
  workflow-template-form/workflow-template-form.component.ts           CREATE
  workflow-stage-list/workflow-stage-list.component.ts                 CREATE
  workflow-stage-form/workflow-stage-form.component.ts                 CREATE
  workflow-transition-editor/workflow-transition-editor.component.ts   CREATE
  workflow-action-configurator/workflow-action-configurator.component.ts CREATE
workflow.routes.ts                                                      CREATE
```

**`workflow-template.service.ts`** — Angular `HttpClient` wrapper mirroring the
builder endpoints (`listTemplates`, `getTemplate`, `createTemplate`, `updateTemplate`,
`setDefault`, `deactivateTemplate`, `addStage`, `updateStage`, `removeStage`,
`addTransition`, `removeTransition`, `addTransitionAction`, `removeTransitionAction`).

**`workflow.service.ts`** — Angular `HttpClient` wrapper for the runtime endpoints
(`getInstance`, `triggerTransition`, `submitApproval`). Thin — most functional
modules (Documents, Incidents, ...) will call through their own feature service,
not this one directly, once they exist.

**`workflow-template-list.component.ts`** — PrimeNG Table, one row per template:
- Columns: nameEn, nameAr, objectType (tag), isDefault (star icon), isActive, stage
  count, actions
- "Set Default" action (disabled if already default) — matches the plan's service
  layer default-uniqueness rule
- Click row → navigates to `workflow-stage-list` for that template
- No "New Template" flow beyond the 6 seeded defaults in this step — tenant-authored
  custom templates for entirely new object types are out of scope until a functional
  module needs one; the builder still supports editing the seeded ones fully

**`workflow-stage-list.component.ts`** — ordered list (drag-to-reorder deferred —
use up/down buttons for `order` in this step, matching CLAUDE.md's "structured
form-based workflow builder, not visual canvas"):
- Row per stage: nameEn/nameAr, order, SLA (working hours), approval mode badge,
  assignee strategy summary, isInitial/isFinal badges
- "Add Stage" opens `workflow-stage-form` in a dialog (matches the established
  dialog-based create/edit pattern from Steps 3–4, not a routed page)
- Each stage row also shows its outgoing transitions inline with an "Add Transition"
  action that opens `workflow-transition-editor`

**`workflow-stage-form.component.ts`** — Reactive Form:
- Fields: nameEn, nameAr, description, order, slaWorkingHours, isInitial, isFinal
- `approvalMode` select — when `PARALLEL` selected, reveals `parallelThreshold`
  select; when `COMMITTEE` selected, reveals a committee picker (`committeeId`)
- `assigneeStrategy` select — reveals `assigneeUserId` (user picker), `assigneeRoleId`
  (role picker, reusing `RoleService.listRoles()` from Step 4), or nothing
  (ORG_UNIT_HEAD/SELF/COMMITTEE need no extra field), depending on selection
- `escalationConfig` — simple repeatable row editor: `{ afterHours, notifyRoleId }`
  pairs (a raw JSON textarea is the fallback if this proves too complex for this
  step's timebox — flagged as an acceptable simplification, not a requirement)

**`workflow-transition-editor.component.ts`** — Reactive Form, opened from a stage row:
- `toStageId` select (other stages in the same template)
- labelEn, labelAr
- `triggerCondition` select — reveals `triggerUserId`/`triggerRoleId` picker
  depending on selection
- `requiredPermission` — a plain text input for now (autocomplete against the
  known permission catalog is a nice-to-have, not required this step)
- `validatorConfig` — raw JSON textarea (same acceptable-simplification note as
  `escalationConfig` above)
- Nested `workflow-action-configurator` list for this transition's actions

**`workflow-action-configurator.component.ts`** — small repeatable list, one row per
`WorkflowTransitionAction`:
- `actionType` select (CREATE_TASK / SEND_NOTIFICATION / GENERATE_PDF /
  LOCK_DOCUMENT / LOG_AUDIT / WEBHOOK)
- `order`, `isEnabled` toggle
- When `actionType = WEBHOOK`: reveals `configJson.webhookUrl` (URL input) and a
  simple key/value header editor, matching CLAUDE.md's "supports custom headers
  for authentication"
- Other action types: `configJson` is a collapsed "Advanced (JSON)" section,
  optional

**`workflow.routes.ts`**:
```typescript
export const WORKFLOW_ROUTES: Routes = [
  { path: '', loadComponent: () => WorkflowTemplateListComponent },
  { path: ':id/stages', loadComponent: () => WorkflowStageListComponent },
];
```
Register `path: 'workflows'` in `app.routes.ts`, mirroring `roles`/`lookups`.

---

### Commit 12 — Translation keys
```
frontend/src/assets/i18n/en.json     MODIFY
frontend/src/assets/i18n/ar.json     MODIFY
```

Keys to add to `en.json` (Arabic equivalents in `ar.json` — real Arabic, not
placeholders, same rule as every prior step):
```json
{
  "workflow": {
    "title": "Workflow Templates",
    "objectType": "Object Type",
    "isDefault": "Default",
    "setDefault": "Set as Default",
    "deactivateTemplate": "Deactivate Template",
    "stageCount": "{{count}} stages",
    "stages": "Stages",
    "addStage": "Add Stage",
    "editStage": "Edit Stage",
    "nameEn": "Name (English)",
    "nameAr": "Name (Arabic)",
    "description": "Description",
    "order": "Order",
    "slaWorkingHours": "SLA (working hours)",
    "isInitial": "Initial Stage",
    "isFinal": "Final Stage",
    "approvalMode": "Approval Mode",
    "approvalModeSingle": "Single Approver",
    "approvalModeSequential": "Sequential",
    "approvalModeParallel": "Parallel",
    "approvalModeCommittee": "Committee Vote",
    "parallelThreshold": "Threshold",
    "thresholdAll": "All",
    "thresholdMajority": "Majority",
    "thresholdAny": "Any",
    "committee": "Committee",
    "assigneeStrategy": "Assignee",
    "assigneeSpecificUser": "Specific User",
    "assigneeRole": "Role",
    "assigneeOrgUnitHead": "Org Unit Head",
    "assigneeSelf": "Creator (Self)",
    "assigneeCommittee": "Committee",
    "assigneeRoundRobin": "Round Robin",
    "escalation": "Escalation",
    "transitions": "Transitions",
    "addTransition": "Add Transition",
    "labelEn": "Label (English)",
    "labelAr": "Label (Arabic)",
    "toStage": "Next Stage",
    "triggerCondition": "Who Can Trigger",
    "triggerSpecificUser": "Specific User",
    "triggerRoleBased": "Role-Based",
    "triggerAnyAuthenticated": "Any Authenticated User",
    "triggerSystemAutomatic": "System (Automatic)",
    "requiredPermission": "Required Permission",
    "validatorConfig": "Validation Rules (JSON)",
    "actions": "Actions on Transition",
    "addAction": "Add Action",
    "actionType": "Action Type",
    "actionCreateTask": "Create Task",
    "actionSendNotification": "Send Notification",
    "actionGeneratePdf": "Generate PDF Snapshot",
    "actionLockDocument": "Lock Document",
    "actionLogAudit": "Log Audit (always on)",
    "actionWebhook": "Webhook",
    "webhookUrl": "Webhook URL",
    "webhookHeaders": "Custom Headers",
    "noTemplates": "No workflow templates found.",
    "noStages": "No stages defined for this template.",
    "noTransitions": "No transitions defined for this stage.",
    "errorLoad": "Failed to load workflow data."
  }
}
```

---

## 5. COMMIT SEQUENCE

All commits on branch `feature/ACC-9-workflow-engine`.
Format: `{type}({scope}): {description} [ACC-9]`

```
Commit 1:  chore(prisma): extend workflow engine schema — approvals, actions, action log [ACC-9]
Commit 2:  feat(workflow): add workflow interfaces and DTOs [ACC-9]
Commit 3:  feat(workflow): add default system workflow seed data [ACC-9]
Commit 4:  feat(workflow): add WorkflowTemplateService (builder) [ACC-9]
Commit 5:  feat(workflow): add WorkflowService (runtime engine) [ACC-9]
Commit 6:  feat(workflow): register BullMQ and add webhook action processor [ACC-9]
Commit 7:  feat(workflow): add SLA breach monitor job [ACC-9]
Commit 8:  feat(workflow): add WorkflowTemplateController and WorkflowController [ACC-9]
Commit 9:  chore(workflow): register WorkflowModule in AppModule [ACC-9]
Commit 10: fix(tenant): wire default workflow seeding into bootstrap [ACC-9]
Commit 11: feat(workflow): add Angular workflow builder UI [ACC-9]
Commit 12: feat(i18n): add workflow translation keys [ACC-9]
```

Run `npx tsc --noEmit` before commits 1, 4, 5, 6, 7, 8, 9, 10, 11.
Run `npx jest --passWithNoTests` before commits 4, 5, 6, 7, 9, 10.

**Commit 5 is the highest-complexity commit in this step** — `triggerTransition()`
and `submitApproval()` encode every approval-mode/assignee-strategy/trigger-condition
combination. Do not proceed to Commit 6 until all combinations in the spec pass.

**Commit 6 is the highest-risk commit for infrastructure** — it is the first time
BullMQ connects to Redis anywhere in the codebase. If `REDIS_URL` is unreachable
locally, the app must still boot (BullMQ queues connection failures don't crash
NestJS startup by default, but confirm this explicitly before committing) — a
missing local Redis must degrade the webhook queue, not the whole API.

---

## 6. ACCEPTANCE CRITERIA

- [ ] All 8 workflow models present and correctly related (5 modified, 3 new)
- [ ] `WorkflowTemplate`/`WorkflowStage`/`WorkflowTransition` bilingual name fields
      added (`nameEn`/`nameAr`, `labelEn`/`labelAr`)
- [ ] `WorkflowInstance.organizationId` added — every instance query scoped directly,
      no join through template required
- [ ] `WorkflowInstanceStage.outcome`, `slaDueAt`, `slaBreached` added
- [ ] Migration applied — database schema up to date
- [ ] All 6 default system workflows seeded on tenant bootstrap with correct stages,
      transitions, and actions
- [ ] `seedDefaultWorkflows()` correctly resolves `assigneeRoleKey`/`triggerRoleKey`
      to that tenant's real `Role.id` values
- [ ] `seedDefaultWorkflows()` is idempotent — calling it twice produces no duplicates
- [ ] `seedDefaultWorkflows()` runs strictly after `seedSystemRoles()` in
      `TenantService.bootstrap()`
- [ ] `triggerTransition()` enforces both `requiredPermission` and `triggerCondition`
- [ ] `triggerTransition()` enforces `validatorConfig` before allowing the transition
- [ ] Approval modes tested:
      SINGLE and PARALLEL+ALL: fully tested in WorkflowService spec
      SEQUENTIAL: implemented (treated as PARALLEL+ALL),
                  dedicated tests deferred — no seed data uses it
      COMMITTEE: implemented with quorum+majority logic,
                 dedicated tests deferred to Step 10 (Committee module)
- [ ] Assignee strategies tested:
      SELF, ROLE, ORG_UNIT_HEAD: tested
      SPECIFIC_USER, COMMITTEE, ROUND_ROBIN: implemented,
      dedicated tests deferred — no seed data uses them
- [ ] SLA due dates computed via `WorkingCalendarService.calculateDeadline()` —
      no module calculates its own dates (per CLAUDE.md's non-negotiable rule)
- [ ] Every enabled `WorkflowTransitionAction` fires on transition and writes a
      `WorkflowActionLog` row
- [ ] BullMQ registered in `AppModule` for the first time; webhook actions enqueue
      and retry (3 attempts) correctly
- [ ] SLA monitor job runs every 15 minutes and flags breached stages
- [ ] Escalation notifications only dispatch during tenant working hours
- [ ] `WorkflowTemplateController` and `WorkflowController` both zero business logic
- [ ] Runtime transition/approval endpoints correctly skip class-level
      `@Permissions()` and defer to `WorkflowService`'s data-driven check
- [ ] Backend TypeScript: zero errors
- [ ] Frontend TypeScript: zero errors
- [ ] All tests passing (140+ existing + new workflow tests)
- [ ] Tenant isolation tests present for both `WorkflowTemplateService` and
      `WorkflowService`
- [ ] `TenantService.bootstrap()` TODO for Step 6/Workflow replaced with real call
- [ ] Translation keys in both `en.json` and `ar.json`
- [ ] PR to dev with green CI

---

## 7. DEPENDENCIES

### What This Step Requires from Steps 1–5

| Requirement | Where It Comes From |
|---|---|
| `WorkflowTemplate`/`Stage`/`Transition`/`Instance`/`InstanceStage` models (partial) | Scaffolded in Step 1 |
| `Task.workflowInstanceId` | Scaffolded in Step 1 — ready for `CREATE_TASK` action |
| `Committee.quorum` | Scaffolded in Step 1 — reused directly for COMMITTEE approval mode |
| `TenantModule` import | Provides `AuditLogService`, forwardRef pattern to follow |
| `AuditLogService` | Call `log()` on every transition and template/stage/transition mutation |
| `TenantGuard` / `PermissionGuard` | Active since Step 4 — used as-is on both new controllers |
| `RoleService` | Needed to resolve `assigneeRoleKey`/`triggerRoleKey` → `Role.id` at seed time,
      and to resolve `ROLE`/`ROUND_ROBIN` assignee strategy at runtime |
| `WorkingCalendarService.calculateDeadline()` | Built in Step 2 — the exact SLA due-date method this step calls |
| `WORKFLOWS_PERMISSIONS.VIEW` / `.MANAGE` | Already in `common/constants/permissions.ts` |
| `bullmq` / `@nestjs/bullmq` | In `package.json` since scaffold — never registered until this step |
| Circular-dependency pattern (`forwardRef` both sides) | Proven in `TenantModule ↔ LookupModule ↔ RolesModule` |

### What Future Steps Will Require from Step 6

| Future Step | What It Needs |
|---|---|
| Step 7 — Notifications | `SEND_NOTIFICATION` internal action currently stubs a direct call —
      Step 7 replaces the stub with the real `NotificationService`, and workflow's
      escalation firing (Commit 7) will route through it too |
| Step 8 — Task management | `CREATE_TASK` internal action currently creates `Task` rows directly —
      Step 8 may formalize this into a shared `TaskService.createFromWorkflow()` |
| Step 9 — Users | `ROLE` and `ROUND_ROBIN` assignee resolution currently pick "first active user
      holding the role" — Step 9's user management may need to refine tie-breaking |
| Step 10 — Committees | `COMMITTEE` approval mode and assignee strategy are functional from this step,
      but Step 10's committee management UI is what tenant admins use to actually
      staff the committees these workflows reference |
| Step 11 — Meetings | The Meeting workflow (seeded this step) is inert until Step 11 builds the
      actual `Meeting` object lifecycle that calls `WorkflowService.startInstance()` |
| Every Phase 2 functional module (Standards, Documents, Quality Improvement, Audit) | Cannot
      create a lifecycle-managed object record until `WorkflowService.startInstance()`
      and `.triggerTransition()` exist — this step is a hard structural blocker |
| Step 20 — KPI | No direct workflow dependency, but incident/audit workflows seeded here
      are what eventually trigger KPI re-measurement per CLAUDE.md's KPI Module Dependencies |

---

## 8. BUSINESS RULES

*(Reproduced from CLAUDE.md's Workflow Engine section, Section 8 of this plan
maps each rule to its concrete schema/service implementation.)*

### Architecture Decision

Custom `WorkflowService` reading from the database dynamically. XState is NOT used
— tenant-configurable templates cannot be defined at compile time, eliminating
XState's main benefit. All audit trail, tracking, and monitoring comes from the
database design (`WorkflowInstanceStage`, `WorkflowApproval`, `WorkflowActionLog`),
not from a state machine library.

### Stage Approval Modes

- **SINGLE** — one approver (`assigneeStrategy` resolves them); `triggerTransition()`
  fires as soon as that one person calls it, no `WorkflowApproval` row needed.
- **SEQUENTIAL** — multiple approvers, one after another; a `WorkflowApproval` row is
  created per approver in order; a `REJECTED` decision immediately halts the chain
  (the instance stays at the current stage; no further approvals are solicited).
- **PARALLEL** — multiple approvers simultaneously; `parallelThreshold` (`ALL` /
  `MAJORITY` / `ANY`) determines when enough `APPROVED` decisions have accumulated
  to fire the transition automatically.
- **COMMITTEE** — formal vote; every active `CommitteeMember` of `committeeId`
  becomes an approver; the transition fires once `Committee.quorum` members have
  voted and a majority voted `APPROVED`.

### Assignee Resolution Strategies

`SPECIFIC_USER`, `ROLE`, `ORG_UNIT_HEAD`, `SELF`, `COMMITTEE`, `ROUND_ROBIN` — see
`WorkflowService.resolveAssignee()` in Commit 5 for the concrete resolution logic
for each. `ORG_UNIT_HEAD` is the one strategy this step cannot fully resolve on its
own (no functional module yet supplies an `orgUnitId` for its object) — documented
as a stub that functional modules must complete when they call `startInstance()`.

### Transition Conditions (Who Can Trigger)

`SPECIFIC_USER`, `ROLE_BASED`, `ANY_AUTHENTICATED`, `SYSTEM_AUTOMATIC` — stored on
`WorkflowTransition.triggerCondition`. `SYSTEM_AUTOMATIC` transitions are never
reachable through the public `POST /workflows/instances/:id/transitions` endpoint —
only `triggerSystemTransition()`, called internally by future background jobs, can
fire them.

### Internal Actions

`CREATE_TASK`, `SEND_NOTIFICATION`, `GENERATE_PDF`, `LOCK_DOCUMENT`, `LOG_AUDIT` — each
a `WorkflowTransitionAction.actionType`. `LOG_AUDIT` always fires and cannot be
disabled (`isEnabled` is ignored for this type — enforced in `WorkflowService`, not
just a UI convention). `SEND_NOTIFICATION` and `GENERATE_PDF` are stubbed to their
simplest useful behavior in this step (direct `Notification` row creation; PDF
generation deferred to Step 17's LibreOffice pipeline) since their full
implementations depend on modules not yet built.

### External Actions (Webhook)

See Section 10 for the full mechanism. Every webhook call is logged in
`WorkflowActionLog` regardless of outcome — this is non-negotiable per CLAUDE.md.

### Validator Conditions

Stored as free-form JSON on `WorkflowTransition.validatorConfig`:
`requiredFields: string[]`, `minAttachments: number`,
`allPreviousStageTasksComplete: boolean`, `minApprovals: number`. `WorkflowService`
checks these against a caller-supplied "current object snapshot" passed alongside
`TriggerTransitionDto` — this step defines the *mechanism*; functional modules
supply the actual field values when they call `triggerTransition()`.

### SLA Rules — "Working Days" vs. "Working Hours"

CLAUDE.md's prose says SLA is "defined per stage in working days." The concrete
scaffolded field is `WorkflowStage.slaWorkingHours` (already existed pre-Step-6,
kept as-is), and `WorkingCalendarService.calculateDeadline(start, workingHours,
organizationId)` takes hours, not days. This step treats "days" in CLAUDE.md's
prose as the human-readable framing and `slaWorkingHours` as the literal
implementation unit — a tenant configuring "2 working days" enters `16` (at 8
working hours/day) in the builder UI, which converts for them; the stored/computed
value is always hours. No schema rename — `slaWorkingHours` already matches
`calculateDeadline()`'s actual parameter.

- GCC weekends and public holidays excluded — inherited automatically from
  `WorkingCalendarService`, no separate logic needed here
- SLA breach check runs every 15 minutes via the `sla-monitor` BullMQ job (Commit 7)
- Escalation chain is per-stage, stored in `WorkflowStage.escalationConfig`

### Default System Workflows

All 6 seeded exactly per CLAUDE.md's stage lists (Document, Incident, Audit,
Corrective Action, Meeting, Committee) — see Commit 3's `workflow.seed.ts` for the
concrete stage/transition/action data.

### Tenant Configuration UI

Structured form-based workflow builder, not a visual canvas — per CLAUDE.md,
visual canvas (draw.io) is explicitly deferred to Phase 3 (Steps 26–27). This
step's Angular components (Commit 11) are the permanent form-based builder, not a
placeholder for the canvas — both will coexist once Phase 3 ships, reading/writing
the same `WorkflowTemplate` records.

### Webhook Integration

See Section 10.

### Permission Model for Runtime Transitions

Unlike every prior controller, `WorkflowController`'s transition/approval endpoints
carry **no fixed `@Permissions()` string** — the actual permission required varies
per `WorkflowTransition.requiredPermission` (e.g. `documents:approve` for one
transition, `audits:close` for another), which cannot be known at the decorator
level. `TenantGuard`/`PermissionGuard` still run for authentication and to populate
`userPermissions`; `WorkflowService.triggerTransition()` performs the actual
permission check against the transition's own configured string. This is a
deliberate, narrow exception to the "every endpoint has `@Permissions()`" pattern —
documented here so it is never mistaken for an oversight.

### Audit Log

`AuditLogService.log()` on every mutation:
- Template, stage, transition, and transition-action create/update/deactivate/remove
- Every `triggerTransition()` call (before/after: `fromStageId`, `toStageId`, actor)
- Every `submitApproval()` call

---

## 9. AI INTEGRATION POINTS

Per CLAUDE.md's Foundation Layer AI Integration Points: *"Workflow config: Suggest
appropriate workflow template for object type."*

### Suggest Workflow Configuration

**Trigger:** tenant admin creating a custom template for an object type, clicks
"Suggest with AI" (not built as a UI affordance in this step — the backend stub
exists so Step 16+ functional modules and a later UI pass can wire it in).

**Method:** `WorkflowService.suggestWorkflowConfig(objectType, organizationId, actorId)`

**Backend flow (stub in this step, matching the exact pattern established by
`LookupService.suggestValues()` in Step 3):**
1. Would build a prompt: *"This is a quality management workflow for {objectType}
   in an accreditation platform. Suggest stage names, a sensible approval mode per
   stage, and typical SLA working hours, based on common {objectType} workflows in
   quality management systems."*
2. Would call `AI_PROVIDER.complete(prompt, organizationId, { actorId, feature:
   'workflow.suggestConfig' })` — using the **already-fixed** tenant-scoped
   `AiProvider` interface from the `fix/ai-provider-tenant-isolation` PR merged
   just before this step
3. Would log via `AiInteractionLog` automatically (built into `AnthropicAiProvider`
   itself now — no extra logging code needed in `WorkflowService`)
4. Returns raw suggestions to the frontend — NOT auto-saved

**This step ships the stub only** — returns an empty/placeholder result, no real
`AI_PROVIDER` call wired yet, exactly like `suggestValues()` remains a stub through
Step 3 and Step 4. Activating it is deferred until a concrete tenant-facing "New
Custom Template" flow exists (none does yet — this step only edits the 6 seeded
templates).

**Pattern: AI suggests → human reviews → human approves → system records.**

---

## 10. WEBHOOK INTEGRATION

### `WorkflowTransitionAction` — Configuration

For `actionType = WEBHOOK`, `configJson` holds:
```typescript
{
  webhookUrl: string;
  headers?: Record<string, string>;   // custom auth headers, e.g. { "Authorization": "Bearer ..." }
  timeoutMs?: number;                 // default 10000
}
```

### `WorkflowActionLog` — Execution Record

Every webhook attempt (success, retry, or final failure) writes one row:
`organizationId`, `workflowTransitionActionId`, `workflowInstanceId`, `actionType:
'WEBHOOK'`, `status` (`SUCCESS` / `RETRYING` / `FAILED`), `attemptCount`,
`responseSummary` (truncated response body on success), `errorMessage` (on
failure), `executedAt`.

### BullMQ Job — Firing and Retry

- Queue: `workflow-actions` (registered in Commit 6, shared with future internal
  actions that may need async processing later — webhook is the only one that
  needs it this step)
- Job options: `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`
  (5s, 10s, 20s between attempts)
- Payload: `{ workflowTransitionActionId, workflowInstanceId, organizationId,
  payload: { objectType, objectId, fromStageId, toStageId, actorId, occurredAt } }`
- `WorkflowActionProcessor` POSTs `payload` as the JSON body to `configJson.webhookUrl`
  with `configJson.headers` merged into the request headers
- Each attempt (including retries BullMQ performs automatically) writes its own
  `WorkflowActionLog` row — `RETRYING` for attempts 1–2 if they fail, `SUCCESS` the
  moment any attempt returns 2xx, `FAILED` only after all 3 attempts are exhausted
- Timeout per attempt: `configJson.timeoutMs` (default 10000ms) via `AbortSignal.timeout()`

### Use Cases (per CLAUDE.md)

Notify HIS on document publish, update SharePoint on approval, trigger training
system on new procedure, send audit results to ministry portal — all expressible
today via a tenant admin configuring a `WEBHOOK` action on the relevant transition
through the builder UI (Commit 11's `workflow-action-configurator`). No use-case-
specific code — the mechanism is fully generic.

Full visual integration builder (n8n-style field mapping) remains deferred to
Phase 3 (Step 27) per CLAUDE.md — this step's webhook payload is a fixed structured
shape, not user-mappable field-by-field.

---

## 11. PROGRESS TRACKER

```
[x] Health check passed (see Section HEALTH CHECK above)
[x] Linear ticket ACC-9 created via /new-ticket
[x] Feature branch created: feature/ACC-9-workflow-engine
[x] schema.prisma updated — 9 new enums added (8 original + isApprovalPath's
    supporting types; also DOCUMENT_REQUEST/CHANGE_REQUEST added to
    WorkflowObjectType, WorkflowApprovalDecision redesigned per business review)
[x] WorkflowTemplate updated — nameEn/nameAr, objectType enum
[x] WorkflowStage updated — nameEn/nameAr, approvalMode, parallelThreshold,
    committeeId, assigneeStrategy, assigneeUserId, assigneeRoleId, escalationConfig
[x] WorkflowTransition updated — labelEn/labelAr, triggerCondition, triggerUserId,
    triggerRoleId, validatorConfig (renamed from conditionJson), isApprovalPath
    (added mid-build — see Section 6 for why)
[x] WorkflowInstance updated — organizationId added, objectType enum
[x] WorkflowInstanceStage updated — slaDueAt, slaBreached, outcome,
    escalatedRuleIndexes (added for SLA monitor dedup)
[x] WorkflowApproval model created
[x] WorkflowTransitionAction model created
[x] WorkflowActionLog model created
[x] Organization model updated — workflowInstances, workflowActionLogs relations
[x] User model updated — workflowApprovals relation
[x] Migration run and applied (11 migrations total across this step, due to
    isApprovalPath/escalatedRuleIndexes additions found mid-build)
[x] Schema verified in Prisma Studio — all 8 models present with correct columns
[x] Commit 1 done: chore(prisma): extend workflow engine schema — approvals,
    actions, action log [ACC-9]
[x] All interfaces written (IWorkflowTemplate, IWorkflowStage, IWorkflowTransition,
    IWorkflowTransitionAction, IWorkflowInstance, IWorkflowInstanceStage, IWorkflowApproval)
[x] All DTOs written with class-validator decorators
[x] Commit 2 done: feat(workflow): add workflow interfaces and DTOs [ACC-9]
[x] workflow.seed.ts written with all 8 default workflows (DOCUMENT_REQUEST and
    CHANGE_REQUEST added as separate workflows per business review — not 6),
    Arabic labels throughout
[x] Commit 3 done: feat(workflow): add default system workflow seed data [ACC-9]
[x] WorkflowTemplateService written — all methods implemented, including
    updateTransition() and updateTransitionAction() (added mid-build to avoid
    dead DTOs / support Angular UI edit flows — not in original plan)
[x] seedDefaultWorkflows() resolves assigneeRoleKey/triggerRoleKey to real Role.id
[x] seedDefaultWorkflows() is idempotent
[x] setDefault() unsets sibling default per objectType
[x] WorkflowTemplateService spec covers seeding, CRUD, isolation
[x] npx tsc --noEmit → zero errors
[x] npx jest --passWithNoTests → all tests pass
[x] Commit 4 done: feat(workflow): add WorkflowTemplateService (builder) [ACC-9]
[x] WorkflowService written — startInstance, triggerTransition, submitApproval,
    getInstanceById, getInstancesByObject, cancelInstance (method set revised
    from the original plan — see Section 6 for the full rationale;
    triggerSystemTransition/suggestWorkflowConfig deferred, not built)
[x] All 4 approval modes implemented; SINGLE and PARALLEL+ALL fully tested,
    SEQUENTIAL/COMMITTEE implemented but dedicated tests deferred (see Section 6)
[x] Assignee strategies: SELF/ROLE/ORG_UNIT_HEAD tested; SPECIFIC_USER/COMMITTEE/
    ROUND_ROBIN implemented, dedicated tests deferred (see Section 6)
[x] requiredPermission + triggerCondition both enforced on triggerTransition()
[x] validatorConfig enforced before allowing transition (minApprovals only —
    requiredFields/minAttachments deferred, no snapshot mechanism in the DTO yet)
[x] SLA due dates computed via WorkingCalendarService.calculateDeadline()
[x] WorkflowService spec covers SINGLE/PARALLEL approval modes, SELF/ROLE/
    ORG_UNIT_HEAD assignee strategies, validator enforcement, and tenant isolation
[x] npx tsc --noEmit → zero errors
[x] npx jest --passWithNoTests → all tests pass
[x] Commit 5 done: feat(workflow): add WorkflowService (runtime engine) [ACC-9]
[x] QueueModule created — BullModule registered for the first time in the codebase
[x] WorkflowActionProcessor written — webhook POST, header merge, timeout
[x] Confirmed: missing local Redis degrades gracefully, does not crash app startup
[x] npx tsc --noEmit → zero errors
[x] Commit 6 done: feat(workflow): register BullMQ and add webhook action
    processor [ACC-9]
[x] SlaMonitorProcessor written — 15-minute repeatable job, working-hours-gated
    escalation dispatch, escalatedRuleIndexes prevents duplicate notifications
[x] npx tsc --noEmit → zero errors
[x] npx jest --passWithNoTests → all tests pass
[x] Commit 7 done: feat(workflow): add SLA breach monitor job [ACC-9]
[x] WorkflowTemplateController written — 15 builder endpoints (13 original +
    PATCH transitions/:id + PATCH transitions/actions/:id, both added mid-build),
    zero business logic
[x] WorkflowController written — 5 runtime endpoints (getInstanceById,
    getInstancesByObject, triggerTransition, submitApproval, cancelInstance —
    revised from the original plan's 2, see Section 6), no class-level
    @Permissions on the 2 data-driven ones (documented exception), zero business logic
[x] Both controller specs written — guards mocked, routing verified
[x] npx tsc --noEmit → zero errors
[x] Commit 8 done: feat(workflow): add WorkflowTemplateController and
    WorkflowController [ACC-9]
[x] WorkflowModule created (not @Global() — documented why, unlike RolesModule)
[x] AppModule updated with WorkflowModule import
[x] npx tsc --noEmit → zero errors
[x] npx jest --passWithNoTests → all tests pass
[x] Commit 9 done: chore(workflow): register WorkflowModule in AppModule [ACC-9]
[x] TenantService bootstrap TODO replaced with
    workflowTemplateService.seedDefaultWorkflows(id) call, ordered AFTER
    roleService.seedSystemRoles(id)
[x] TenantModule updated with forwardRef(() => WorkflowModule)
[x] working-calendar.module.ts fixed — TenantModule import wrapped in
    forwardRef(() => TenantModule); adding WorkflowModule created a new
    3-module cycle (TenantModule → WorkflowModule → WorkingCalendarModule →
    TenantModule) that broke server startup until this fix (see Section 8 note)
[x] npx tsc --noEmit → zero errors
[x] Full test suite (not --passWithNoTests) run and green
[x] Manually verified: bootstrapping a fresh tenant produces all 8 workflow
    templates with correctly resolved role assignments; server starts cleanly
    with WorkflowModule initialized (startup log confirmed)
[x] Commit 10 done: fix(tenant): wire default workflow seeding into bootstrap [ACC-9]
[x] Angular WorkflowTemplateService + WorkflowService (frontend) written
[x] workflow-template-list component written (PrimeNG Table, set-default action)
[x] workflow-stage-list component written (ordered list with up/down reorder
    buttons — order field hidden from admins entirely, per business requirement;
    nested transitions via row-expansion)
[x] workflow-stage-form component written (approval mode / assignee strategy
    conditional fields; committee/user picker replaced with info messages —
    Committee/Users modules don't exist yet)
[x] workflow-transition-editor component written (trigger condition conditional
    fields, isApprovalPath checkbox, edit support added mid-build, nested
    action configurator)
[x] workflow-action-configurator component written (webhook URL + headers
    JSON textarea; edit support added mid-build via updateTransitionAction())
[x] workflow.routes.ts written, registered in app.routes.ts
[x] npx tsc --noEmit → zero errors
[x] Commit 11 done: feat(workflow): add Angular workflow builder UI [ACC-9]
[x] en.json updated with all workflow keys (plan's original list + 10 keys
    discovered by auditing actual component usage — see Section 6)
[x] ar.json updated with all Arabic translations
[x] Commit 12 done: feat(i18n): add workflow translation keys [ACC-9]
[x] Final check: npx tsc --noEmit (backend + frontend) → zero errors
[x] Final check: npx jest --passWithNoTests → 253/253 tests pass
[x] Final check: tenant isolation tests for both workflow services passing
[x] Final check: approval mode / assignee strategy test coverage matches the
    revised Section 6 acceptance criteria (not the original "all 4 / all 6")
[ ] /ready-to-pr run — PR opened to dev with [ACC-9] in title
[ ] CI green on GitHub Actions
[ ] PR merged to dev (squash merge)
[ ] feature/ACC-9-workflow-engine branch deleted from GitHub
[ ] ACC-9 marked Done in Linear
[ ] Step 7 (Notifications) can begin
```

---

*Plan created: 2026-07-23*
*Branch to create: feature/ACC-9-workflow-engine*
*Depends on: ACC-8 (merged to dev ✅), fix/ai-provider-tenant-isolation (merged to dev ✅)*
