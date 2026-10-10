# Step 190 — Task definitions on workflow stages (ACC-190, CF-07)

**Status: PLAN ONLY.** No code and no migration until Ahmad approves.
- Branch: `feature/ACC-190-stage-task-definitions`, from `origin/dev` at `b9d76d3`.
- Backend only. §11 lists what the settings screen must show, for the design
  thread.

**Ahmad's model (settled):**
1. Stages carry task definitions.
2. Each definition becomes a real Task when a record enters the stage (a
   snapshot).
3. Mandatory tasks gate forward transitions.
4. A stage's deadline is at least its longest task.
5. The seeded `CREATE_TASK` actions go.
6. Reopen stays limited to the current stage.

---

## 1. What exists today, measured on `b9d76d3` and the shared dev database (9 Oct)

| Fact | Where | Consequence for this plan |
|---|---|---|
| **The engine has no transaction anywhere.** `performTransition()` (`workflow.service.ts:737-833`) closes the old stage row, cancels tasks, computes the SLA, creates the new stage row, updates the instance, then fires actions. Every step is a separate auto-committed write. `startInstance()` (78-138) is the same. | `workflow.service.ts` | There is no "existing transaction" to work inside. **This plan introduces one** (§4.1), because creating a stage's tasks and checking the gate must be atomic with the stage change. |
| **Nothing happens when a record enters a stage.** Actions hang off transitions; `startInstance()` runs none. | `workflow.service.ts:118-120` | The initial stage never gets tasks today, and neither does a stage re-entered by a return transition. |
| **A task gate exists but is opt-in, and nobody opts in.** `assertStageTasksComplete()` (1235-1265) runs only when a transition's `validatorConfig` has `allPreviousStageTasksComplete`. **0 of 134 transitions** set it. It counts EVERY open task stamped with the stage, manual ones included. | `workflow.service.ts` | The new gate replaces it (§6, Q6). |
| **The approval path skips every validator.** `submitApproval()` → `maybeAdvanceAfterApproval()` → `performTransition()` never calls `checkValidatorConfig()`. | 641-698 | The new gate must sit where both paths pass, not in `checkValidatorConfig()`. |
| **No transition records its direction.** `WorkflowTransition` has only `isApprovalPath`, which means "advance vs return" on multi-approver stages only. Stage `order` is display-only by design (763-765). In the seed, order disagrees with meaning: Committee "Reactivate" goes 40 → 30 and is not a return, while Reject and Cancel go to final stages with a higher order. | schema 1205-1224 | **Today's data cannot tell forward from backward.** This is flagged; §3.3 adds an explicit `kind`. |
| **No task points at its stage ENTRY.** The only links are `workflowInstanceId` and `sourceStageId`, which is the template stage id with no foreign key. Reopen, `cancelForStage` and the old gate all compare template stage ids, so a record that left a stage and came back looks "still in that step". | schema 1340-1454 | A new `Task.workflowInstanceStageId` (§3.2). |
| **`TaskService.create()` cannot join a caller's transaction.** It writes on `this.prisma`. The SLA clock starts at `new Date()`, not at stage entry. | `task.service.ts:145-261` | A transaction-capable core (§4.2). |
| **ACC-174's interim rule** is `origin === 'engine'` in `create()` (task.service.ts:171-174). When a stage SLA is longer than the priority SLA, it raises `slaLimitAt` through `slaExtendedTo`. Its only caller is `executeCreateTask()`, which hard-codes `priority: 'MEDIUM'`. | | It is removed with `CREATE_TASK` (§7.2). |
| **Seed:** 26 `CREATE_TASK` actions per tenant, all on forward transitions, all `{ actionType, order: 10 }` with no config. | `workflow.seed.ts` | |
| **Live:** 52 `CREATE_TASK` actions (al-manara 26, al-nakheel 26). **One has a `WorkflowActionLog` row** (al-nakheel), and that foreign key is RESTRICT. **One** engine-created task exists, already CANCELLED. All 6 committee instances (3 per tenant) sit in **Formation**. | dev DB | §8 (backfill), §10 (live proof). |
| `Committee.orgUnitId` is **required** since ACC-135. CLAUDE.md's "Committee has no orgUnitId" is out of date. | schema | "The record's unit" has a real consumer today. |
| Stage SLA is `WorkflowStage.slaWorkingHours Int?`. The priority SLA is `taskSla[priority].dueAfterHours`, in working hours. Defaults: CRITICAL 4, HIGH 16, MEDIUM 40, LOW 80. Both are working hours counted from entry. | `task-sla-settings.ts` | The deadline rule compares two plain numbers (§5.1). |
| `removeStage()` relies on a RESTRICT foreign key once a stage has been used. Prisma's P2003 is not mapped, so the user gets a **500**. | `workflow-template.service.ts:456-492` | Live proof avoids new stages (§10). Mapping P2003 to a 409 is an unrelated defect, noted for a small ticket. |

---

## 2. Q — How the engine tells forward from backward

**With today's data it can't**, and it shouldn't guess.
- `order` is display-only, and the seed contradicts it both ways.
- `isApprovalPath` covers multi-approver stages only.
- Labels are tenant-editable text.

**Proposal:** an explicit `WorkflowTransition.kind`, set in the seed and the
backfill and editable in settings:

| kind | Meaning | Gate | On leaving the stage |
|---|---|---|---|
| `ADVANCE` (default) | The stage's work is done; move on. | **Refused while a mandatory task of this entry is open.** | Open optional tasks are cancelled. |
| `RETURN` | Send back for rework: Revise Terms, Return for Revision, Dispute Findings. | Never gated. | All open tasks of this entry are cancelled. |
| `EXIT` | End the record early: Reject, Cancel, Withdraw. | Never gated. | All open tasks of this entry are cancelled. |

**The default is `ADVANCE` (fail closed).** A transition nobody classified is
gated, so a mis-set reject shows up as a visible "finish these tasks first" with
a fix: set its kind. A mis-set advance never silently skips mandatory work.

---

## 3. Data model (one additive migration)

### 3.1 New table `WorkflowStageTaskDefinition`

| Field | Type | Notes |
|---|---|---|
| id | String cuid | |
| organizationId | String → Organization | Tenant scope; every query uses `id` + `organizationId`. |
| stageId | String → WorkflowStage | `onDelete: Cascade`. A deleted stage takes its definitions; the tasks already created keep their snapshot. |
| order | Int | Display and creation order. |
| titleEn | String | Required. |
| titleAr | String? | `trimToNull` (ACC-160). |
| description | String? | ≤ 2000, like a task. |
| isMandatory | Boolean | |
| requiresEvidence | Boolean | |
| priority | TaskPriority | Sets the SLA and the due date. |
| assignKind | `StageTaskAssignKind` | `POSITION`, `RECORD_UNIT_POSITION`, `COMMITTEE_ROLE`, `RECORD_COMMITTEE_ROLE`. **No ROLE value exists**, so ROLE cannot be chosen. |
| orgUnitId | String? → OrgUnit | `POSITION` only. |
| positionId | String? → OrgPosition | `POSITION` and `RECORD_UNIT_POSITION`. |
| userId | String? → User | `POSITION` only. Optional: a person in that position means direct assignment. |
| committeeId | String? → Committee | `COMMITTEE_ROLE` only (a fixed committee). |
| committeeRoleValueId | String? → LookupValue | Both committee kinds. |
| createdById, updatedById | String | |
| createdAt, updatedAt | DateTime | |

- Indexes: `[organizationId]`, `[stageId, order]`.
- Foreign keys to unit, position, user, committee and role: `onDelete: Restrict`.
  Units and positions are deactivated, never deleted, so this mirrors the stage
  assignee columns.

**What each assignment kind resolves to:**
- **POSITION:** the fixed unit and position.
  - A chosen user → a direct assignment.
  - No user and a single-holder position → its holder.
  - No user and a multi-holder position → a pool.
  - No holder → `UNASSIGNED`, keeping its target.
  - These are exactly ACC-167's rules, reused through `resolvePlacement()`.
- **RECORD_UNIT_POSITION:** the record's own unit, through a per-object-type
  resolver registry: COMMITTEE → `committee.orgUnitId`, MEETING →
  `meeting.committee.orgUnitId`. **There is no walk up to the parent unit when
  the position is vacant** (Q-C). A vacant unit gives `UNASSIGNED`, shown
  through Setup health's existing "Task with no actionable owner".
- **COMMITTEE_ROLE:** a fixed committee plus a role. It always pools, unless one
  day a user is allowed (not in this ticket).
- **RECORD_COMMITTEE_ROLE:** the record's committee plus a role. COMMITTEE → the
  committee itself; MEETING → `meeting.committeeId`.
- **The registry fails closed** (the ACC-101 shape). An object type with no
  resolver refuses the relative kinds at save: `STAGE_TASK_ROUTE_NOT_AVAILABLE`,
  naming the type. Documents, Incidents and the rest each add one line when
  built.

### 3.2 Task — four new nullable or defaulted columns

| Field | Type | Why |
|---|---|---|
| `workflowInstanceStageId` | String? → WorkflowInstanceStage | **The stage ENTRY the task belongs to.** It is what the gate, the stage-exit cancel, reopen and the deadline move key on. Null for legacy and manual tasks. |
| `stageTaskDefinitionId` | String? → WorkflowStageTaskDefinition, `onDelete: SetNull` | Provenance only. Deleting a definition never touches tasks. |
| `isMandatory` | Boolean `@default(false)` | **A snapshot**, so editing the definition never re-gates a running entry. |
| `titleAr` | String? | The definition's Arabic title, snapshotted. It is shown through `bilingual(title, titleAr)` (ACC-160). Every existing task keeps null, so it falls back to `title`. |

- Indexes: `[workflowInstanceStageId, status]` for the gate, and
  `[workflowInstanceId, sourceStageId]`, which the legacy queries already filter
  on but which has no index today.
- `sourceStageId` stays set (to the stage) for compatibility.

### 3.3 WorkflowTransition

- `kind WorkflowTransitionKind @default(ADVANCE)`, with the new enum `ADVANCE`,
  `RETURN`, `EXIT`.

**Why this migration is safe on the shared database before deploy:** new
tables, nullable columns, defaulted columns and new enum types. The deployed
client selects none of them. **No row of a new enum value can exist in a column
the deployed client reads.** ACC-173's enum rule holds, because the new enums
live only in new columns.

---

## 4. Engine changes

### 4.1 One transaction per stage change, under an instance lock

`performTransition()` and `startInstance()` become:

```
$transaction(async tx => {
  SELECT … FROM "WorkflowInstance" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE   // the first engine row lock
  re-read the open WorkflowInstanceStage; refuse 409 if it is no longer the one the caller saw
  if transition.kind = ADVANCE: gate (§4.3) — authoritative, under the lock
  close the old entry (exitedAt, outcome)
  cancel this entry's open tasks (§4.4) — the tx-capable core of cancelForStage
  create the new entry (enteredAt = T, slaDueAt = calculateDeadline(T, stage.slaWorkingHours))
  create one Task per definition of the new stage (§4.2), all with slaStartAt = T
  update the instance (currentStageId, status)
})
after commit: unassigned-stage flagging, remaining transition actions (SEND_NOTIFICATION, WEBHOOK enqueue, LOG_AUDIT),
              task notifications and pool notices, audit rows — the same "notify after commit" rule TaskService already follows
```

- **T is read once** inside the transaction, so the stage row and its tasks
  share one clock.
- **The lock serialises two people pressing transitions at once.** Today both
  can pass the "open stage" read and close the same row twice.
- **Lock order is always instance, then task.** The extension approval (§5.2)
  takes the instance lock first when the task is a stage task, so the two can't
  deadlock.

### 4.2 Creating tasks at entry: the snapshot

- `TaskService` gains `createInTx(tx, input)`. It is the same placement and SLA
  logic as `create()`, taking a transaction client and returning the
  after-commit work (assignee notifications, pool notice, audit row). `create()`
  becomes `createInTx` plus running that work, so manual tasks behave
  identically.
- **Per definition, in `order`:**

| Task field | Value |
|---|---|
| title | `titleEn` |
| titleAr | `titleAr` |
| description, priority, requiresEvidence, isMandatory | Copied from the definition. |
| sourceType, sourceId | As today, from `mapObjectTypeToTaskSourceType()` and `objectId`. |
| sourceStageId | The stage. |
| workflowInstanceId | The instance. |
| workflowInstanceStageId | The new entry. |
| stageTaskDefinitionId | The definition. |
| placement | `resolvePlacement()` with the resolved unit or committee. The engine path keeps ACC-167's bypass of the "role only on its own committee" check, because a fixed committee may differ from the record. |
| **createdById** | **The person who moved the record into the stage**: the transition's actor, the deciding approver on the approval path, or whoever started the instance. |
| **slaStartAt** | **T, the stage entry.** |
| dueAt, slaLimitAt | `TaskSlaService.windowFrom(T, priority)`, exactly ACC-174's computation. |
| slaExtendedTo | Null. **No interim stage-SLA extension.** |

- **Snapshot:** after this, the definition is never read for that task again.
  Edits affect future entries only.
- **When:** every entry creates them — the initial stage at `startInstance()`,
  a forward move, a return to an earlier stage, and a self-transition (the old
  entry's tasks are cancelled first, then the new entry's are created).
- **No tasks on a final stage:** saving a definition on an `isFinal` stage is
  refused (`STAGE_TASK_ON_FINAL_STAGE`). The instance completes on entry, so
  such a task could gate nothing.

### 4.3 The gate

**Refuse an `ADVANCE` transition while any task of the CURRENT entry is
mandatory and open.**
- Open means `isMandatory` and status not COMPLETED or CANCELLED. So PENDING,
  IN_PROGRESS, UNASSIGNED, REJECTED and ON_HOLD all block. That is ACC-65's
  predicate, kept identical.
- Refusal: **409 `STAGE_TASKS_OPEN`**. The body lists `{ id, title, titleAr,
  status }` for the open mandatory tasks, so the screen can link each one.
- **Where it runs:**
  1. In `triggerTransition()`, **before** any approval vote is written. A
     multi-approver stage refuses the deciding vote instead of recording a vote
     that can't take effect.
  2. Again inside §4.1's transaction, under the lock. That one is authoritative
     and covers the approval path, which skips validators today.
- **Completing tasks never moves the record.** A person still presses the
  transition.
- **Manual tasks attached to a stage never gate.** They are not mandatory and
  carry no entry id; they are cancelled on exit as today.

### 4.4 Leaving a stage

| How it leaves | What happens to this entry's tasks |
|---|---|
| ADVANCE (the gate passed) | Open **optional** tasks are cancelled. Mandatory ones are already closed. |
| RETURN, EXIT, or an administrative instance cancel | **Every** open task of this entry is cancelled. |

- Cancellation is today's engine cancel, keyed by `workflowInstanceStageId`
  inside the transaction. It sets CANCELLED, clears any hold, cancels pending
  requests, writes audit rows after commit, and leaves the reason null.
- **Legacy tasks** with no entry id keep today's key
  (`workflowInstanceId` + `sourceStageId`), so the one existing engine task
  and manual stage tasks behave exactly as now.

### 4.5 Other task rules that change

- **Reopen (ACC-174, kept):** allowed only while the record is in **this entry**
  (`task.workflowInstanceStageId` is the instance's open entry). A task from an
  earlier entry can't be reopened, even when the record has come back to the
  same stage, because that entry has its own fresh tasks. A reopened mandatory
  task blocks the gate again. Legacy tasks keep the template-stage check.
- **Manual cancel** (ACC-174 refuses every stage task today):
  - an **optional** definition task may be cancelled by whoever may manage it
    (`mayManage()`);
  - a **mandatory** one still refuses, with "This task is required for its
    workflow step";
  - legacy stage tasks are unchanged.
- **SLA sweep:**
  - definition tasks are ordinary tasks for the overdue, escalation and pool
    sweeps;
  - `recoverUnassignedStageTasks()` must **exclude** tasks with a definition id.
    It attaches the *stage's* assignee, which is wrong for a task with its own
    target. Definition tasks stay with their target, like manual pool tasks.

---

## 5. The stage deadline rule (Ahmad, 6 Oct)

### 5.1 At configuration time: refused, with clear codes

Every comparison is in **working hours from entry**: the stage deadline is
`slaWorkingHours`, and a task's due time is `taskSla[priority].dueAfterHours`.
A stage with **no** SLA has no deadline, so nothing can break it (Q-D).

| Save | Refused when | Code (409) |
|---|---|---|
| Create or update a definition | `dueAfterHours(def.priority) > stage.slaWorkingHours` | `STAGE_TASK_DUE_AFTER_STAGE_DEADLINE`, with `{ taskHours, stageHours, priority }` |
| Update a stage's SLA | the new value is below any definition's due hours | `STAGE_DEADLINE_BEFORE_TASKS`, with `{ stageHours, longestTaskHours, definitionIds }` |
| `PATCH /tenant/task-sla` (a priority's hours raised) | any stage with a definition of that priority would be exceeded | `TASK_SLA_EXCEEDS_STAGE_DEADLINES`, listing `{ templateName, stageName, stageHours }`. This third path is easy to miss, and without it the rule would be breakable from the settings screen. |

### 5.2 At run time: the stage deadline follows an approved extension

- **Where:** in `TaskRequestService.approve()`, EXTENSION branch, inside its
  existing transaction (`task-request.service.ts:209`, under the task row
  lock). For a task whose entry is
  still open and **mandatory** (Q-E):
  - if `requestedDueAt > entry.slaDueAt`, set `entry.slaDueAt = requestedDueAt`;
  - if the new deadline is in the future, clear `slaBreached` and
    `escalatedRuleIndexes`, so the breach sweep judges the new deadline afresh;
  - write an audit row on `WorkflowInstanceStage`,
    `event: 'stage_deadline_extended'`, naming the task and the request.
- **Lock order:** when the task has an entry, approve takes the instance lock
  first (§4.1).
- **ON_HOLD approvals** move the task's due date too. By the same invariant
  ("the stage deadline is never before a mandatory task's due date"), a hold
  that pushes a mandatory task past the stage deadline moves the deadline
  likewise (Q-E). This also closes ACC-173's stated limitation that a hold
  never paused the stage.

### 5.3 What replaces ACC-174's interim rule

- **Definition tasks never use `slaExtendedTo` for the stage SLA.** Their window
  is the priority SLA from entry, and the stage deadline is made to fit them
  (§5.1), not the other way round.
- **The interim code** (`origin === 'engine'` and the `slaExtendedTo` raise) has
  one caller, `executeCreateTask()`, and goes with it (§7.2). The `origin`
  parameter is removed.
- **Existing stage tasks:** exactly **one** exists live, already CANCELLED. Any
  that remain anywhere keep their stored `slaLimitAt` and `slaExtendedTo`
  untouched. Their limit was already written as a raised floor, so they behave
  as before. No data change.

---

## 6. Q6 — `allPreviousStageTasksComplete`

**The new gate replaces it.**
- It is unused (0 of 134 transitions).
- It counts manual tasks.
- It is skipped on the approval path.
- It answers "are all tasks done", where the model's question is "are the
  mandatory ones done".

Proposal:
- Configuring it is refused (`VALIDATOR_RETIRED`, 400).
- The engine ignores it, with a warning log if a stored config still has it
  (none does).
- `ValidatorConfig` drops the key.
- SYSTEM-REFERENCE §2.10.1 is rewritten to point at the gate.

---

## 7. API for definitions, and the CREATE_TASK question

### 7.1 Endpoints

All under `workflow-templates`, with `TenantGuard` and `PermissionGuard`.

| Route | Permission | |
|---|---|---|
| `GET /stages/:stageId/task-definitions` | `workflows:view` | In order, each with its resolved unit, position, person, committee and role names, and `dueAfterHours`. |
| `POST /stages/:stageId/task-definitions` | `workflows:manage` | Returns the definition plus a non-blocking `warning` (ACC-55 contract): `POSITION_HAS_NO_HOLDER` or `POOL_EMPTY`. |
| `PATCH /task-definitions/:id` | `workflows:manage` | Partial update, same validations and warning. |
| `DELETE /task-definitions/:id` | `workflows:manage` | Hard delete. Tasks already created keep their snapshot (FK SetNull). |
| `POST /stages/:stageId/task-definitions/order` | `workflows:manage` | `{ ids: [...] }`, all of the stage's, refused otherwise. |
| `GET /:id` (template) | existing | Each stage gains `taskDefinitionCount` and `longestTaskHours`. |

- **Permission:** the existing `workflows:manage`, the same as editing stages
  and transitions (Q-F).
- **Audit:** every create, update, delete and reorder writes **full before and
  after**, unlike `updateStage()`'s thin name-only audit.
- **Validation,** each a tenant-scoped lookup on `id` + `organizationId`. A
  foreign id is the same 404 as a missing one.

**Refusal codes** (`{ statusCode, message, error, code }`, the storage-refusal
shape):

| Code | Status | When |
|---|---|---|
| `STAGE_TASK_ROUTE_INCOMPLETE` | 400 | A field the kind needs is missing (POSITION without unit or position), or one it forbids is present (a user on a relative kind). |
| `STAGE_TASK_ROUTE_NOT_AVAILABLE` | 400 | A relative kind on an object type with no resolver yet. |
| `STAGE_TASK_UNIT_NOT_FOUND`, `STAGE_TASK_POSITION_NOT_FOUND`, `STAGE_TASK_COMMITTEE_NOT_FOUND`, `STAGE_TASK_ROLE_NOT_FOUND` | 404 | |
| `STAGE_TASK_USER_NOT_IN_POSITION` | 400 | The chosen person doesn't hold that position in that unit (ACC-167's `isPoolMember`). |
| `STAGE_TASK_ON_FINAL_STAGE` | 400 | |
| `STAGE_TASK_DUE_AFTER_STAGE_DEADLINE`, `STAGE_DEADLINE_BEFORE_TASKS`, `TASK_SLA_EXCEEDS_STAGE_DEADLINES` | 409 | §5.1 |
| `STAGE_TASKS_OPEN` | 409 | A transition (§4.3). |
| `ACTION_TYPE_RETIRED` | 400 | Adding a `CREATE_TASK` action (§7.2). |
| `VALIDATOR_RETIRED` | 400 | §6 |

- **Transition `kind`** joins `addTransition` and `updateTransition`'s DTOs and
  responses.

### 7.2 Does `CREATE_TASK` stay as an action type?

**No: retire it.**
- **It duplicates definitions badly:** one task per transition rather than per
  stage, a fixed MEDIUM priority, a title from the transition label, assignment
  through the stage's approver strategy (which is where ROLE comes from), and
  no snapshot of mandatory or evidence.
- **Expand now:**
  - adding one is refused (`ACTION_TYPE_RETIRED`);
  - the engine skips any that remain, with a warning log and a
    `WorkflowActionLog` row `FAILED` "retired";
  - `executeCreateTask()` and the interim SLA rule are deleted;
  - the action configurator stops offering it.
- **Contract later:** a separate migration removes the enum value once no row
  holds it. That is after the backfill, which deletes every seeded action and
  its log rows (§8).

---

## 8. Seed change and backfill

**Seed (`workflow.seed.ts`):**
- Remove all 26 `CREATE_TASK` entries.
- Set `kind` on every transition: the 14 returns listed in the research become
  `RETURN`; Reject, Cancel and Withdraw into a rejected or cancelled final stage
  become `EXIT`; everything else stays `ADVANCE`, including Committee
  "Reactivate".
- **The seed ships no task definitions.** Nothing is hard-coded per module;
  tenants configure them.
- `seedDefaultWorkflows()` upserts only, so the backfill is what changes
  existing tenants.

**Backfill `backfill-acc190-stage-tasks.ts`** (`npm run backfill:acc190-stage-tasks`):
- **Pattern:** `backfill-retire-tasks-complete.ts` (a plain PrismaClient with
  PrismaPg, no queues, and a customer-tenant guard) plus
  `backfill-acc174-task-sla-limit.ts`'s dry run and `--execute`. One
  transaction per organisation that re-reads its scope and throws "The
  database changed since the dry run" on drift.
- **(1) `CREATE_TASK` actions**, only on transitions that match a seeded
  `CREATE_TASK` transition by `(template objectType, from stage nameEn, to
  stage nameEn)`: **every one is DELETED** (Ahmad, 9 Oct, answer B).
  - An action with `WorkflowActionLog` rows has **those log rows deleted
    first**, then the action, because the key is RESTRICT. Live, that is 1
    action with 1 log row (al-nakheel).
  - Ahmad's reason: that history is test data, not real.
  - **Nothing is disabled.**
  - A `CREATE_TASK` on a non-seeded transition is **reported, not touched**.
    None exist live.
- **(2) Transition `kind`** for the seeded RETURN and EXIT transitions, matched
  the same way. A transition whose stage names a tenant has edited is
  **reported** with "set its kind in workflow settings", not guessed.
- **Already-created tasks are left alone**, as the brief requires. The script
  never touches the Task table.
- **Audit:** one row per tenant in that tenant's own audit trail, in the same
  transaction. It lists every action removed and every log row removed, with
  the log's action type, status and time, and every kind set (ACC-101's rule
  for vendor changes).
- **Order:** run **after** the deploy, dry run first. Before it runs, the old
  actions are inert anyway, because the deployed code that reads them is
  replaced by code that skips them.

---

## 9. Tests

**Unit and service specs:**
- **Definitions API:**
  - every refusal code;
  - tenant isolation via `itEnforcesTenantIsolation` for list, create, update,
    delete and reorder, checking the `id` + `organizationId` pair;
  - a foreign unit, position, committee or role is the same 404 as a missing
    one;
  - full before and after audit rows;
  - the `POSITION_HAS_NO_HOLDER` warning.
- **Deadline rule:**
  - definition save at, under and over the stage hours;
  - stage SLA lowered below a definition; a stage with no SLA accepts anything;
  - `PATCH /tenant/task-sla` refused when it would break a stage;
  - mutation-tested: dropping any of the three checks fails a spec.
- **Snapshot at entry:**
  - entering creates one task per definition, in order, with
    `slaStartAt = entry.enteredAt`, `dueAt = windowFrom(enteredAt, priority)`,
    `slaExtendedTo = null`, `createdById = the mover`, and `isMandatory`,
    `requiresEvidence`, `titleAr` copied;
  - editing the definition afterwards changes nothing on the task;
  - deleting the definition leaves the task with `stageTaskDefinitionId = null`.
- **Pools from definitions:**
  - a single-holder position goes direct;
  - a multi-holder position pools with its target;
  - a chosen person goes direct;
  - a vacant position becomes `UNASSIGNED` with its target;
  - a committee role on the record's committee and on a fixed committee;
  - the record's unit for COMMITTEE;
  - an object type with no resolver is refused at save.
- **The gate:**
  - ADVANCE is refused with `STAGE_TASKS_OPEN` for each blocking status
    (pinned list);
  - optional and manual tasks never block;
  - RETURN and EXIT pass and cancel every open task of the entry;
  - ADVANCE cancels optional tasks only;
  - the approval path is gated, and the deciding vote is refused before it is
    recorded;
  - re-entry creates fresh tasks and the old entry's tasks don't count;
  - mutation-tested.
- **Transaction:**
  - a failure while creating tasks leaves the old stage open and no new entry
    (rollback);
  - two concurrent transitions: one wins, the other gets 409.
- **Run-time deadline move:**
  - an extension past the stage deadline moves it, clears `slaBreached` and is
    audited;
  - an extension within the deadline leaves it;
  - an optional task never moves it;
  - an exited entry is never moved;
  - the hold case;
  - lock order instance → task, pinned.
- **Reopen:** allowed in the same entry, refused after leaving and coming back;
  reopening a mandatory task re-blocks the gate.
- **Cancel:** optional allowed, mandatory refused.
- **Retired action and validator:**
  - adding `CREATE_TASK` gives `ACTION_TYPE_RETIRED`;
  - a stored `CREATE_TASK` is skipped and logged FAILED "retired";
  - `allPreviousStageTasksComplete` gives `VALIDATOR_RETIRED`.
- **Sweep:** `recoverUnassignedStageTasks` ignores definition tasks.
- **Backfill:**
  - the dry run writes nothing and lists the deletes, disables and kinds;
  - `--execute` deletes actions without logs, disables the one with logs, sets
    kinds, writes one audit row per tenant;
  - drift between the dry run and execute throws;
  - an edited stage name is reported, not matched;
  - the Task table is untouched (asserted).
- **Seed:** no `CREATE_TASK` remains; every return and exit has its kind (a
  spec reads the seed).
- **Tenant isolation gate:** each new query path gets a test under the exact
  gate name.

---

## 10. Live proof without creating test stages

**Constraint:** a stage an instance has entered can't be deleted, so **no new
stages**. Definitions are deletable, so they are the only configuration added.
**After the deploy**, like ACC-185. Before it, the deployed SLA monitor's
`recoverUnassignedStageTasks()` (old code) would attach the stage's ROLE
assignee to an `UNASSIGNED` definition task on the shared database.

On **al-nakheel's COMMITTEE template**, existing stages only (Formation →
Terms Review → Active):
1. Add two definitions to **Terms Review** (SLA 40 h):
   - mandatory "Check the terms", HIGH (16 h), to the record's unit's Quality
     Officer position;
   - optional "Collect member CVs", MEDIUM (40 h), to the record's committee's
     Secretary role.
2. Try a LOW definition (80 h > 40 h). Expect 409
   `STAGE_TASK_DUE_AFTER_STAGE_DEADLINE`.
3. Move one existing committee **Formation → Terms Review** ("Submit for
   Approval"). Expect two tasks, `slaStartAt` equal to the entry's `enteredAt`,
   due dates from HIGH and MEDIUM, the creator being the mover, and the pool
   or holder as the unit's data says.
4. Press **Approve Committee**. Expect 409 `STAGE_TASKS_OPEN` naming the
   mandatory task.
5. **Revise Terms** (RETURN) back to Formation. Expect both tasks CANCELLED.
6. Submit again. Expect two **new** tasks; the cancelled ones stay with the old
   entry.
7. Request more time on the mandatory task past the stage deadline and approve
   it. Expect the entry's `slaDueAt` moved, with an audit row.
8. Complete the mandatory task, then press Approve. Expect it to pass and the
   optional task to be CANCELLED (Q-G).
9. **Clean up:** delete both definitions. The tasks keep their snapshot. The
   committee is left where step 8 put it.

---

## 11. The settings screen (for the design thread)

**Where:** inside a stage's expanded row in workflow settings, a **"Tasks on
entry"** section beside the transitions.

**The list, per definition, in order:**
- the title (Arabic under it when set);
- Mandatory or Optional;
- Evidence required (yes or no);
- the priority and its due time ("High · due in 16 working hours");
- the assignment in words: "Quality Officer, Cardiology", "Quality Officer in
  the record's unit", "Secretary of the record's committee", or "Secretary of
  the Quality Assurance Committee", plus the person when one is chosen;
- a warning chip when the position has no holder or the pool is empty;
- actions: Edit, Delete (with a confirmation saying tasks already created stay),
  and Move up / Move down (or drag), with a keyboard path.

**The stage header line:** "Stage deadline: 40 working hours · longest task: 16"
- shown in a danger state if a deadline edit is being refused;
- "No deadline" when the stage has none;
- an empty state: "No tasks are created when a record enters this stage."

**The add and edit dialog** (EditDialogComponent; measure it against the 420 px
cap and step it on a real seam if needed — ACC-120):
- Title in English (required) and Arabic (optional);
- Description;
- Mandatory or Optional, with a one-line explanation of each ("blocks moving
  forward until done" / "never blocks; cancelled when the record leaves");
- Evidence required;
- Priority, showing its due time;
- **Assignment**, reusing `task-assignee-picker`'s cascade:
  - "A unit you choose" → unit → position → optional person;
  - "The record's own unit" → position;
  - "A committee you choose" → committee → role;
  - "The record's committee" → role;
  - relative choices are absent for object types without a resolver;
- inline refusals for the deadline rule, naming both numbers and the way out
  ("raise the stage deadline to at least 80 hours, or choose a higher
  priority").

**Transition editor:** a **Kind** field (Advance / Send back / End the record)
with one-line help. Advance says "Blocked while required tasks of this stage
are open".

**Record page** (later, record-facing): when a transition is refused with
`STAGE_TASKS_OPEN`, the refusal lists the open required tasks as links. The
stage's task list already exists in the committee page's embedded task list.

Everything in English and Arabic, right to left, and keyboard reachable.

---

## 12. Docs that change

- **CLAUDE.md:**
  - Workflow Engine (`CREATE_TASK` retired; validators);
  - Task System ("two creation paths" becomes three: stage entry, manual, and
    legacy engine);
  - ACC-64's "resolve to CREATE_TASK plus task-completion gating" becomes
    definitions plus the gate;
  - ACC-173/174's interim stage-SLA note marked superseded;
  - "Committee has no orgUnitId" corrected (ACC-135);
  - a new **Key Architecture Decisions (ACC-190)**.
- **SYSTEM-REFERENCE.md:**
  - §2.1 (models, `kind`, the definition table);
  - §2.3 (entry creates tasks, the transaction);
  - §2.4 (the gating trace, including the approval path);
  - §2.9 (`CREATE_TASK` retired);
  - §2.10 / §2.10.1 (the validator retired, pointing to the gate);
  - a new §2.15, stage task definitions;
  - §3.1 (Task columns);
  - §3.2 (`cancelForStage`, reopen, cancel);
  - §3.10 (extension and hold move the stage deadline);
  - §3.11 (the interim rule removed);
  - §13.2 (the vacant record-unit position appearing as "Task with no
    actionable owner").
- **`module-designs.md`:** "SMART_TASK_CREATION (when workflow fires
  CREATE_TASK)" points at stage entry instead.

---

## 13. Open questions for Ahmad

| # | Question | Recommendation |
|---|---|---|
| Q-A | Telling forward from backward: add `WorkflowTransition.kind` (ADVANCE / RETURN / EXIT), defaulting to ADVANCE (gated)? | **Yes.** Today's data can't tell (§2). |
| Q-B | Retire `CREATE_TASK` (refuse new ones, skip old ones, drop the enum value in a later contract step)? | **Answered (9 Oct): yes, and DELETE every seeded action, including the one with log rows (its logs are deleted first; test data). Nothing disabled.** |
| Q-C | "The record's unit" with a vacant position: `UNASSIGNED` (shown on Setup health), or walk up to the parent unit? | **UNASSIGNED, no walk-up.** It is visible and matches manual tasks. Walking up silently hands work to a different unit. |
| Q-D | A stage with no SLA: any task priority allowed? | **Yes.** No deadline, nothing to break. |
| Q-E | Which tasks move the stage deadline: mandatory only, and holds as well as extensions? | **Mandatory only, both.** An optional task never holds the stage; the invariant is "never before a mandatory task's due date". |
| Q-F | Permission for definitions: the existing `workflows:manage`, or a new `workflows:manage_stage_tasks` (ACC-44 pattern)? | **`workflows:manage`.** It is the same screen and the same people who edit stages and transitions. |
| Q-G | Optional tasks still open when the record advances: cancelled silently (engine-style, an audit row only), or with a notice to the assignee? | **Silently**, like today's stage-exit cancel (ACC-68). The work was optional and the step is decided. |
| Q-H | Show `titleAr` on task screens now, or backend only and lane A wires `bilingual()` later? | **Backend returns it now**; the screens follow under lane A's task-screen work. |
| Q-I | Live proof step 8 leaves one al-nakheel committee **Active**. Acceptable, or prove the gate lifting in specs only? | **Acceptable.** Ahmad picks which committee. |
| Q-J | The approval path is gated too, refusing the deciding vote rather than recording it. Agreed? | **Yes.** A vote that can't take effect shouldn't be stored. |
| Q-K | Optional definition tasks may be cancelled by hand by whoever manages them; mandatory ones may not. Agreed? | **Yes.** |

**Ahmad's answers (9 Oct):**
- **A:** yes.
- **B:** changed, see the row above and §8.
- **C:** unassigned, shown on Setup health, never passed up.
- **D:** yes.
- **E:** required tasks only, by holds and approved extensions.
- **F:** `workflows:manage`, and `workflows:view` to read.
- **G:** silently.
- **H:** API only, no task-screen changes.
- **I:** acceptable; the build picks the committee and names it.
- **J:** yes.
- **K:** yes.

## 14. Progress

- [x] Ticket ACC-190 and branch
- [x] Research: engine, tasks, SLA, seed, live counts
- [x] Plan written
- [x] Ahmad's answers to Q-A … Q-K (9 Oct, above)
- [x] Migration `20261009180000_acc190_stage_task_definitions`, generated by
      `prisma migrate diff`, additive only. All 51 migrations apply cleanly to a
      fresh PostgreSQL (PGlite). **Not applied to the shared database before
      merge** — the pre-deploy step applies it; nothing needs it earlier,
      because the live proof runs after the deploy.
- [x] Engine: one transaction per stage change under the instance lock (also
      `startInstance`), the gate (both paths), entry snapshot, after-commit
      side effects.
- [x] Definitions API and the deadline rule (definition, stage, tenant SLA).
- [x] Run-time deadline move (extension and hold), instance-then-task locks.
- [x] CREATE_TASK and the validator retired; seed; backfill
      (`npm run backfill:acc190-stage-tasks`).
- [x] Specs:
  - backend 125 suites / 2,853 tests; isolation 171; `check:worker-gate` 0;
  - 13 guards mutation-tested, every one caught (the gate under the lock, the
    early gate, the approval-path gate, mandatory-only gating, the three
    deadline-rule sides, mandatory-only deadline moves, the lock order,
    mandatory cancel refused, reopen by entry, recovery exclusion,
    CREATE_TASK refused);
  - the real `AppModule` resolves with workers off (the forwardRef cycle).
- [x] Docs: CLAUDE.md (Workflow Engine, Task System, ACC-64/174 notes, the
      stale `Committee.orgUnitId` line, Key Architecture Decisions ACC-190),
      SYSTEM-REFERENCE §2.1/2.3/2.4/2.9/2.10.1, new §2.15, §3.1/3.2/3.10/3.11,
      §13.2; module-designs.md.
- [ ] After the deploy: backfill dry run (report, then STOP), execute on
      Ahmad's go, then the live proof (§10).
  - Deployed 10 Oct (`5f775d3`, Railway `cedf7638`); dry run as planned.
  - First `--execute`: al-manara done (26 actions, 22 kinds, 1 audit row);
    al-nakheel's transaction passed Prisma's default 5-second timeout
    (5.3 s) and rolled back whole — confirmed by a fresh dry run. Fixed on
    `fix/ACC-190-backfill-timeout` (`BACKFILL_TX`, 120 s); al-nakheel is
    re-run after that deploys.

**Where the build differs from the plan:**
- Stage tasks get no out-of-office routing: they follow the manual route,
  which never had it (CREATE_TASK's engine path did).
- `fireTransitionActions()` no longer returns warnings; ACC-34's
  `unassignedTaskWarnings` now come from the entry's tasks.
- A chosen person who has left the position falls back to the position's
  rules at entry, rather than making the task UNASSIGNED.
- Making a stage with definitions FINAL is refused too
  (`STAGE_TASK_ON_FINAL_STAGE`), the stage side of the final-stage rule.
- `STAGE_TASK_ORDER_MISMATCH` added for the reorder route.
