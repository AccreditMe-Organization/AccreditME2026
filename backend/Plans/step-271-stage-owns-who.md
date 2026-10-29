# Step 271 — Workflow engine step 2: the stage owns "who", transitions have no people

**Ticket:** ACC-271 (decisions confirmed by Ahmad, 27 Oct). Folds in ACC-268.
**Drawing:** `frontend/design-reference/AccreditMe Workflow Setup.dc.html`
(27 Oct 14:05 export, rounds 4 and 5, accepted), sections 8–12, copied
unchanged as this branch's first commit.
**Status:** PLAN ONLY. No code, no migration. Questions for Ahmad at §13.

Out of scope, by the ticket: Share in turn (ACC-270), the History card
(ACC-267), "Who works the current stage" on the record page, and the step 2
condition builder and automatic exits (drawing sections 1, 4–7). The
transition editor's "Show this button only when" (section 9) is drawn on top
of the condition builder and waits with it.

---

## 1. The decisions, as the build reads them

| # | Decision (ACC-271) | What it means in code |
|---|---|---|
| 1 | Transitions say nothing about who | `triggerCondition`, `triggerRoleId`, `triggerUserId` and `requiredPermission` stop being read for human moves. Whoever works the from-stage (its pool, out-of-office aware) may press. |
| 2 | App-run transitions stay, read-only | A new marker separates APP (the module's own code, today `SYSTEM_AUTOMATIC`, 8 seeded) from PERSON, and reserves AUTOMATIC for tenant-made conditional exits (step 2, not built). |
| 3 | A stage has several assignees, joined by "or" | A new `WorkflowStageAssignee` table. Kinds: Specific user, Fixed position (position in a unit), Org unit head, Creator, Committee (role filter). Role and Round robin are gone as kinds. |
| 4 | Approval: Any one / All / Committee vote | A new `whoMode` on the stage. SINGLE and PARALLEL ANY → Any; PARALLEL ALL → All; COMMITTEE → Committee vote (only with exactly one Committee entry). Sequential and Majority are removed. |
| 5 | Seeded stages start assigned to the tenant admin | A Specific user entry marked `isStartingAssignment`. Setup health: "Workflow stage still on its starting assignment" (At risk), with Review stage and Keep this assignment. |
| 6 | Closed-task notices, in-app only | Three wordings: someone else in the pool acted, the record was sent back, the record ended. |
| 7 | A leaver drops out of "All of them" | And the stage history records it. |
| 8 | The transition editor becomes a page panel | Like the stage editor (ACC-255 PR 4b). ACC-268 folds in. |

---

## 2. What is there today (measured)

### 2.1 The shared dev database, 28 Oct (read-only, counts only)

Three organisations; only **al-nakheel** and **al-manara** have workflows
(9 templates each, the seed). The platform organisation has none. The two
are identical:

| Stages by `assigneeStrategy` (per organisation) | |
|---|---|
| ROLE | 46 (QUALITY_MANAGER 34, QUALITY_OFFICER 11, BASE_USER 1) |
| SELF | 12 (COMMITTEE_CHANGE_REQUEST 6, MEETING 3, DOCUMENT_REQUEST 1, DOCUMENT 1, CHANGE_REQUEST 1) |
| ORG_UNIT_HEAD | 2 (DOCUMENT_REQUEST 1, CHANGE_REQUEST 1) |
| SPECIFIC_USER, POSITION_FIXED, COMMITTEE, ROUND_ROBIN | 0 |

| Stages by `approvalMode` + `parallelThreshold` | |
|---|---|
| SINGLE | 56 |
| PARALLEL / ALL | 4 (DOCUMENT 3, MEETING 1, all ROLE) |
| SEQUENTIAL, COMMITTEE, PARALLEL MAJORITY / ANY | 0 |

| Transitions by `triggerCondition` | count | with `requiredPermission` | with `triggerRoleId` | with `triggerUserId` |
|---|---|---|---|---|
| ROLE_BASED | 65 | 65 | 0 | 0 |
| ANY_AUTHENTICATED | 2 | 0 | 0 | 0 |
| SYSTEM_AUTOMATIC | 8 | 0 | 0 | 0 |

`requiredPermission` values in use (per organisation): meetings:manage 7,
capa:investigate 7, audits:execute 6, committees:manage 6, documents:approve 6,
capa:approve 5, org:manage 4, documents:review 4, audits:report 3, and 1–2
each of audits:close, audits:create, capa:close, committees:approve,
documents:manage_templates, documents:publish, documents:submit,
incidents:close, incidents:investigate, incidents:manage,
meetings:approve_minutes.

**Every ROLE_BASED transition has no trigger role**, so today it is a
permission check only: ROLE_BASED and ANY_AUTHENTICATED behave the same
apart from the permission (workflow.service.ts:542).

**Live work:**

| | al-nakheel | al-manara |
|---|---|---|
| Open instances | 5 committees, all on ROLE stages | 3 committees, all on ROLE stages |
| Completed instances | 2 (withdrawn change requests) | 0 |
| Open stage entries, by mode | 5 SINGLE | 3 SINGLE |
| Open stage tasks | 0 | 0 |
| WorkflowApproval rows | 0 | 0 |

No customer organisation exists, so every backfill below runs against seeded
fixtures only. Re-measure before each backfill's execute.

### 2.2 Readers and writers (the code survey)

File references are to this branch (d8a7af4 + the drawing). WS =
`foundation/workflow/workflow.service.ts`, WTS =
`workflow-template.service.ts`, TS = `foundation/task/task.service.ts`,
TED / SEP = the frontend transition editor / stage editor panel.

- **`triggerCondition`** — written by the seed (workflow.seed.ts types it
  without ASSIGNEE_POOL), `workflow-seed-apply.ts:138`, WTS:700/753; read by
  `triggerTransition` (WS:536 SYSTEM_AUTOMATIC refused, :539 SPECIFIC_USER,
  :542 ROLE_BASED, :563 ASSIGNEE_POOL), `triggerSystemTransition` (WS:886),
  the in-transaction write (WS:1034), unassigned-stage detection (WS:1794,
  1844–1856), TED, `workflow-labels.ts`, `check:workflow-enum-display`.
  **The create/update DTO refuses ASSIGNEE_POOL** (ACC-268 item 3).
- **`triggerRoleId`** — seed (never set), WTS:702/755 (not tenant-checked);
  read WS:542, WS:1851; TED's Add form only (Edit can't change it).
- **`triggerUserId`** — WTS:701/754 only; read WS:539, WS:1856. The UI never
  sends it, so a Specific user transition from the screen is unfireable and
  never flagged (ACC-268 item 1).
- **`requiredPermission`** (transition) — seed, WTS:699/752 (grantability
  checked, WTS:1012), the permission warning (WTS:1030–1070); enforced only by
  `triggerTransition` (WS:532), and by the ASSIGNEE_POOL "nobody holds it"
  check (WS:1809). **`submitApproval` never checks it.** Read by
  `workflow-transition-actions` (hides the button), TED, and two backfills
  (ACC-244, retire-tasks-complete) that refuse to run on retired keys.
- **`assigneeStrategy` / `assigneeRoleId`** — seed (SELF, ROLE,
  ORG_UNIT_HEAD only), WTS:379/497, SEP; read by `resolveAssigneeRaw`
  (WS:1476), the delegation stamp (WS:1672), `resolveApproverPool`
  (WS:1904–1986). SEP never clears `assigneeRoleId` on a strategy change.
- **`approvalMode` / `parallelThreshold`** — seed, WTS, SEP; read by the
  SINGLE fast path (WS:587, 599), `isApprovalThresholdMet` (WS:921–968),
  the quorum snapshot (WS:1145), SINGLE narrowing (WS:1492, 1558) and
  `committee-change-request.service.ts:687`.
- **ROUND_ROBIN** shares the ROLE branch ("first active holder", WS:1481);
  `resolveApproverPool` has no branch for it (pool []). **SEQUENTIAL** is
  forced to ALL (WS:963), with no ordering. **MAJORITY** is
  `approved > pool/2` (WS:967). None is seeded or used.
- **The other stage fields** — `assigneeUserId` and `committeeId` are never
  sent by the UI ("picker unavailable" notes in SEP);
  `assigneeCommitteeRoleValueId`, `assigneePositionId`/`assigneeOrgUnitId`
  are (POSITION_FIXED with a no-holder warning).

### 2.3 The ROLE "broadcast" uses CLAUDE.md names, and what replaces each

| Today | Where | Replaced by |
|---|---|---|
| `MEETING.minutes_review`: ROLE `BASE_USER`, PARALLEL ALL — "every user in the tenant must approve" | workflow.seed.ts:248 | Meetings are unbuilt. Seed: the tenant admin starting assignment, All of them. When Meetings are built, the natural setup is a **Committee entry for the record's committee** with Committee vote or All of them (§13 Q4). |
| `BASE_USER` as the pool for that stage | role.seed.ts | Gone with Role as a kind. **Today's mismatch disappears too:** BASE_USER does not hold `meetings:approve_minutes`, so the pool could vote through `submitApproval` but not press the approval transition. |
| `PARALLEL` / `ALL` (4 stages per organisation) | DOCUMENT ×3, MEETING ×1 | All of them. |
| ROLE QUALITY_MANAGER / QUALITY_OFFICER (45 stages) | everywhere else | The tenant admin starting assignment (§13 Q1). |

### 2.4 Gaps the plan closes or calls out

1. **ORG_UNIT_HEAD resolves to an empty pool for every real caller.** WS:1512
   reads `orgUnitId` off the `WorkflowInstance` row through a cast;
   WorkflowInstance has no such column (the same cast at WS:1675 and
   WS:1976). Committee has a required `orgUnitId`, but nothing here reads it.
   **Closed:** an Org unit head entry names its unit, or (Q3) "the record's
   unit" resolved through `RECORD_ROUTES` (the ACC-190 stage-task route
   registry, which fails closed).
2. **RETURN / EXIT cancellations notify nobody.** `cancelStageExitTasksInTx`
   (TS:1243) cancels and `auditStageExitCancellation` (TS:1273) writes audit
   rows only; `cancelForInstance` (TS:1304) likewise. A pool member's
   completion (TS:708) closes the others' rows silently. **Closed** by the
   three notices (§7).
3. **An empty pool lets anyone vote** (WS:719) and **satisfies ALL with the
   first approval** (WS:960). **Closed:** an empty pool refuses every human
   action; the stage is flagged unassigned (existing condition).
4. **COMMITTEE pools keep deactivated users** (WS:1570, 1917 filter only
   `committeeMember.isActive`), so a leaver can block a vote. **Closed** by the
   leaver rule (§8).
5. **A COMMITTEE stage configured from the screen has no `committeeId`**
   (the UI can't set it), so one approval suffices (WS:941). **Closed:** a
   Committee entry names its committee (or the record's committee).
6. **`approvedCount` counts votes from people no longer in the pool.**
   Called out: §8 decides what an earlier vote by a leaver means (Q6).
7. **ACC-268's four defects** (no user picker, no role picker in Edit,
   ASSIGNEE_POOL refused, System offered to tenants) disappear with the
   fields; the fifth (a Position trigger) is answered by the stage's Fixed
   position entry.

---

## 3. Schema (additive only)

One migration, `acc271_stage_assignees`. Nothing is dropped or renamed; the
old columns stay until a later contracting cleanup (§11, PR 6).

```prisma
enum StageAssigneeKind {
  SPECIFIC_USER
  POSITION_IN_UNIT     // "Fixed position": a position in a named unit
  ORG_UNIT_HEAD        // the head (or acting head) of a unit
  CREATOR              // today's SELF
  COMMITTEE            // a committee's members, optionally one member role
}

enum StageWhoMode {
  ANY_ONE              // "Any one of them": the first to act decides
  ALL                  // "All of them"
  COMMITTEE_VOTE       // only with exactly one COMMITTEE entry
}

enum TransitionMover {
  PERSON               // pressed by whoever works the from-stage
  APP                  // run by the module's own code ("Done by the app")
  AUTOMATIC            // reserved: a tenant's conditional exit (step 2)
}

model WorkflowStageAssignee {
  id                   String            @id @default(cuid())
  organizationId       String
  stageId              String
  order                Int
  kind                 StageAssigneeKind
  userId               String?           // SPECIFIC_USER
  positionId           String?           // POSITION_IN_UNIT
  orgUnitId            String?           // POSITION_IN_UNIT, ORG_UNIT_HEAD (null = the record's unit, Q3)
  committeeId          String?           // COMMITTEE (null = the record's committee, Q3)
  committeeRoleValueId String?           // COMMITTEE role filter
  isStartingAssignment Boolean           @default(false)
  createdAt            DateTime          @default(now())
  createdById          String?

  organization Organization  @relation(...)
  stage        WorkflowStage @relation(fields: [stageId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([stageId])
  @@index([organizationId, userId])         // the leaver sweep and "stages I work"
  @@index([organizationId, isStartingAssignment])
}

model WorkflowStage {
  ...
  whoMode     StageWhoMode?   // null until the stage is converted (§6)
  assignees   WorkflowStageAssignee[]
}

model WorkflowTransition {
  ...
  mover       TransitionMover?   // null until backfilled; read as PERSON, or APP when SYSTEM_AUTOMATIC
}

// §8 — the stage history's record of a pool member dropping out.
model WorkflowInstanceStageEvent {
  id                     String   @id @default(cuid())
  organizationId         String
  workflowInstanceStageId String
  kind                   String   // 'POOL_MEMBER_LEFT' (enum in the migration)
  userId                 String
  reason                 String   // 'DEACTIVATED' | 'LEFT_POSITION' | 'LEFT_COMMITTEE' ...
  at                     DateTime @default(now())

  @@index([organizationId])
  @@index([workflowInstanceStageId])
}

enum SetupConditionType { ... STAGE_ON_STARTING_ASSIGNMENT }
```

- **Duplicates** ("This entry is already in the list", drawing section 8) are
  refused by the service, not a unique index: Prisma has no partial index
  and the nullable columns would make a composite unique index ineffective.
- **Tenant scoping:** every entry carries `organizationId`; every referenced
  id (user, position, unit, committee, role value) is checked against it on
  save, as `validateAssigneeUserId` and friends do today.
- **Enum values must not reach the shared database before the deploy**
  (ACC-173's rule): no `STAGE_ON_STARTING_ASSIGNMENT` row, and no entries,
  until the code that reads them is live. The migration runs after the merge.

---

## 4. The engine

**The performance rule (Ahmad, 28 Oct, standing until go-live):** no query is added to TenantGuard, PermissionGuard, ModuleGuard, the throttler, the global interceptors, middleware or `verifySessionIdentity()`. `StagePoolService` resolves pools **in batches**: one query per assignee kind for many stages and instances, never one per row or per stage in a loop (unassigned detection, lists, Setup health). Independent reads go through `Promise.all`. No new polling. A new list endpoint pages on the server, or (a small setup list) has a hard cap noted in its PR description. Anything that touches the per-request path is named in the PR description.

### 4.1 One pool resolver

`StagePoolService.resolve(stage, instance, tx?)` replaces the two resolvers
(`resolveAssigneeRaw`, `resolveApproverPool`) for converted stages. Each
entry resolves to ACTIVE users, then the results are joined ("or"), deduped,
and routed through out-of-office acting users (today's `routeOutOfOffice`):

| Kind | Resolves to |
|---|---|
| SPECIFIC_USER | that user, if ACTIVE |
| POSITION_IN_UNIT | the holder rule: `positionId` + `primaryOrgUnitId` + ACTIVE (ACC-167's rule) |
| ORG_UNIT_HEAD | `resolveActingHeadForOrgUnit(unit)`; unit = the entry's, or the record's own unit through `RECORD_ROUTES` (Q3). **Closes gap 1.** |
| CREATOR | whoever moved the record into its first stage (today's SELF, WS:1517) |
| COMMITTEE | ACTIVE members of the committee (the entry's, or the record's through `RECORD_ROUTES`), narrowed by the role filter; **user status ACTIVE now required** (closes gap 4) |

The pool is resolved **at read time**, never stored (ACC-167's rule: no
membership table needs a recomputer).

### 4.2 Who may press a human transition

`triggerTransition` for a PERSON transition: the actor must be in the
from-stage's pool (directly, or as an out-of-office member's acting user).
That single check replaces `requiredPermission`, `triggerCondition`,
`triggerRoleId` and `triggerUserId`. Unchanged around it:

- the stage's **record actions** (ACC-255) still narrow what may be done to
  the record — they gate record writes, not moves;
- the mandatory-task gate and `TRANSITION_PRECONDITIONS` (quorum out of
  Formation) still run, in the same order;
- **an empty pool refuses everyone** (409 `STAGE_HAS_NO_ONE`, a new refusal
  code worded from the stage) and the stage is flagged unassigned (closes
  gap 3);
- **platform administrators get no bypass** (they don't work stages).

The refusal for someone outside the pool is 403 `NOT_IN_STAGE_POOL`
("Only whoever works {stage} can do this."), worded from the code.

### 4.3 Approvals

| `whoMode` | Decides when |
|---|---|
| ANY_ONE | the first pool member to act (approve, or a RETURN / EXIT) decides; the others' tasks close and they are told (§7) |
| ALL | every **current** pool member has approved; a non-approval from anyone sends it back or ends it at once (today's behaviour) |
| COMMITTEE_VOTE | the committee's own quorum and majority, against the quorum saved at stage entry (ACC-239's snapshot) |

- `submitApproval` and the multi-approver branch of `triggerTransition` both
  require the actor in the pool, and an empty pool refuses (gap 3).
- "Current pool" is resolved at each decision, so a leaver drops out (§8).
- `COMMITTEE_VOTE` is accepted only when the stage has exactly one COMMITTEE
  entry: refused on save otherwise (`COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE`).

### 4.4 App-run transitions and the marker

- `mover = APP` is what `triggerSystemTransition` looks for (instead of
  `triggerCondition = SYSTEM_AUTOMATIC`) and what allows the module's
  in-transaction write (WS:1034). The manual endpoint refuses APP moves, as
  it refuses SYSTEM_AUTOMATIC today.
- APP transitions **can't be created, edited or removed** by a tenant
  (`TRANSITION_RUN_BY_APP`, 409). Only seeds and backfills write them.
- `AUTOMATIC` is reserved: the DTO refuses it until step 2's conditional
  exits exist, so a tenant cannot make a move nothing ever fires (ACC-268
  item 4's shape).

### 4.5 Unassigned detection, rewritten on the pool

`checkAndFlagUnassignedStage` and the 15-minute sweep flag a stage entry
whose pool is empty (resolved as in §4.1). The two old detectors
(ASSIGNEE_POOL transitions; a trigger role or user with nobody active) go
with the fields. Setup health's `STAGE_WITHOUT_ASSIGNEE` keeps its meaning
and its Fix.

### 4.6 The transition window

Until every stage is converted, the engine reads **entries when the stage has
any, and the old columns otherwise** (one branch, `stage.whoMode !== null`).
The backfill converts every stage; PR 6 deletes the old branch once a scan
shows no unconverted stage anywhere.

---

## 5. The seed: tenant-admin starting assignments

- **`workflow.seed.ts`** gains `who` per stage: `{ mode, entries }`. CREATOR
  stages (today's SELF) seed a CREATOR entry; **every other seeded stage
  seeds no entry and is marked `startingAssignment: true`**.
- **The tenant admin does not exist when the seed runs.**
  `PlatformTenantService.createTenant` calls `bootstrap()` (which seeds the
  workflows) and only then invites the first admin. So a new step,
  `WorkflowTemplateService.assignStartingAssignments(orgId, adminUserId)`,
  runs right after the invite, in the same flow, and writes one
  SPECIFIC_USER entry with `isStartingAssignment: true` on every stage the
  seed marked. Re-running it is a no-op.
- **The admin is INVITED until they accept**, so until then those stages
  resolve to nobody and are flagged unassigned. Accepted (§13 Q5) rather
  than counting INVITED users in pools, which would break ACC-43's rule that
  holding something is not being able to act.
- **Protected templates (COMMITTEE_CHANGE_REQUEST):** their six stages stay
  CREATOR (the requester drives; every move is APP). `PROTECTED_STAGE_EDITABLE`
  does not gain the entries: a protected template's "who" is fixed.
- **Approval modes in the seed:** SINGLE → ANY_ONE; PARALLEL ALL → ALL.

---

## 6. Backfills for existing organisations

Each is a `backend/prisma/backfill-acc271-*.ts` script, run **after the
deploy**: dry run, `-- --execute`, dry run reporting 0. Each writes inside
`BACKFILL_TX` (`{ maxWait: 10_000, timeout: 60_000 }`), takes the stage's
template row lock, writes one audit row per organisation in that
organisation's trail (ACC-101's rule), refuses a customer organisation
(ACC-101), and refuses on any unexpected count.

### 6.1 `backfill-acc271-stage-assignees` — stages

| Today's `assigneeStrategy` | Becomes | al-nakheel / al-manara |
|---|---|---|
| SPECIFIC_USER | SPECIFIC_USER entry (same user) | 0 |
| POSITION_FIXED | POSITION_IN_UNIT entry (same position + unit) | 0 |
| ORG_UNIT_HEAD | ORG_UNIT_HEAD entry for **the record's unit** (Q3), or the starting assignment if Q3 says no relative unit | 2 |
| SELF | CREATOR entry | 12 |
| COMMITTEE | COMMITTEE entry (`committeeId`, `assigneeCommitteeRoleValueId`; null committee = the record's committee) | 0 |
| ROLE | **the tenant admin starting assignment** (Q1) | 46 |
| ROUND_ROBIN | as ROLE (Q1); ACC-270 brings "Share in turn" back later | 0 |

| Today's approval | `whoMode` |
|---|---|
| SINGLE | ANY_ONE |
| PARALLEL / ANY | ANY_ONE |
| PARALLEL / ALL | ALL |
| PARALLEL / MAJORITY | ALL (Q7) — none exist; reported, not guessed |
| SEQUENTIAL | ALL (what the engine already does) — none exist |
| COMMITTEE | COMMITTEE_VOTE if the stage now has exactly one COMMITTEE entry, else ANY_ONE (reported) — none exist |

"The tenant admin" for a backfill is the organisation's earliest-assigned
ACTIVE holder of TENANT_ADMIN (ACC-120's invariant guarantees one); the dry
run names how many stages each organisation would put on them, by count.

### 6.2 `backfill-acc271-transition-movers` — transitions

| Today | `mover` | al-nakheel / al-manara |
|---|---|---|
| SYSTEM_AUTOMATIC | APP | 8 |
| ROLE_BASED, ANY_AUTHENTICATED, SPECIFIC_USER, ASSIGNEE_POOL | PERSON | 67 |

`requiredPermission`, `triggerRoleId` and `triggerUserId` are left in place
and stop being read (Q2). The dry run lists, per organisation, how many
PERSON transitions carried a permission (65), by permission key.

### 6.3 Live records

The 8 open committee entries (all on ROLE stages, SINGLE) move to ANY_ONE
with the tenant admin. Nothing in flight is re-decided: there are no open
stage tasks and no approval rows (measured). A backfill that finds either
reports it and refuses (Q8).


### 6.4 The shared dev database before PR 2 (measured 28 Oct, read-only, counts only)

Measured from `D:\Accredit-me-2\backend` with a READ ONLY transaction,
after PR 1 deployed (`a580a00`). **The plan's "60 stages" was per
organisation; PR 1's 120 is the two together.** The platform organisation has
no workflows. Both organisations are identical, so each backfill's expected
counts are these numbers per organisation, and anything else refuses.

| | al-nakheel | al-manara |
|---|---|---|
| Templates | 9 | 9 |
| Stages | 60 | 60 |
| — ROLE | 46 | 46 |
| — SELF (Creator) | 12 | 12 |
| — ORG_UNIT_HEAD | 2 (Document request, Change request) | 2 |
| — SPECIFIC_USER, POSITION_FIXED, COMMITTEE, ROUND_ROBIN | 0 | 0 |
| — with a committee, user or position set | 0 | 0 |
| SINGLE / PARALLEL ALL | 56 / 4 | 56 / 4 |
| PARALLEL MAJORITY or ANY, SEQUENTIAL, COMMITTEE | 0 | 0 |
| Multi-person stages: forward moves / already on the approval path | 4 / 4 | 4 / 4 |
| Transitions | 75 | 75 |
| — ROLE_BASED (all with a permission) | 65 | 65 |
| — ANY_AUTHENTICATED | 2 | 2 |
| — SYSTEM_AUTOMATIC | 8 | 8 |
| Open records (all COMMITTEE, on ROLE stages, SINGLE) | 5 | 3 |
| Open stage entries (incl. final stages of completed records) | 7 | 3 |
| Open stage tasks | 0 | 0 |
| Approval rows | 0 | 0 |
| ACTIVE TENANT_ADMIN holders / INVITED | 1 / 0 | 1 / 0 |
| Stage assignees, converted stages, movers | 0 | 0 |

**What each backfill therefore expects, per organisation:**

- **Stages** (`backfill-acc271-stage-assignees`): 60 stages converted; 48
  starting assignments (the 46 ROLE stages and the 2 ORG_UNIT_HEAD ones), 12
  CREATOR entries, 0 "head of the record's unit" entries; 56 Any one of them
  and 4 All of them; 0 approval-path marks (the 4 are already marked); 0
  approvals reset and 0 tasks cancelled. **Changed 29 Oct (Ahmad):** an Org
  unit head stage becomes "the head of the record's unit" only where its
  record type has a unit route in `RECORD_ROUTES`; the two here (Unit Manager
  Review, on document requests and change requests) have none, so they start
  on the tenant admin, exactly as the seed gives a new organisation. It was
  46 / 12 / 2 before.
- **Transitions** (`backfill-acc271-transition-movers`): 75 marked, 8 APP and
  67 PERSON; 65 of the PERSON moves carry a permission, listed by key.

**Finding against PR 1's note:** the seeded committee moves are not on the
approval path, but that does not matter: every committee stage is SINGLE and
becomes Any one of them, which never reads the approval path. The rule is
still enforced in the seed spec and the backfill, for the four multi-person
stages and any a tenant adds.

---

## 7. The three closed-task notices (in-app only)

One `TaskClosedNoticeService`, called **after the stage-change transaction
commits** (the engine's rule since ACC-190), never inside it. One notice per
person whose task closed, with "Open record". Arabic is passive and
gender-neutral, as drawn.

| Cause | English (drawing section 12) | Arabic |
|---|---|---|
| Someone else in the pool acted (ANY_ONE decided; or a pool task completed by another member) | Your task "{task}" is closed. {actor} approved {record}, so it moved to {stage}. | أُغلقت مهمتك «{task}»: انتقلت «{record}» إلى «{stage}» باعتماد من {actor}. |
| Sent back (a RETURN) | Your task "{task}" is closed. {record} was sent back to {stage} by {actor}. | أُغلقت مهمتك «{task}»: أُعيدت «{record}» إلى «{stage}» بقرار من {actor}. |
| Ended (an EXIT) | Your task "{task}" is closed. {record} was ended ({transition}) by {actor}. | أُغلقت مهمتك «{task}»: أُنهيت «{record}» («{transition}») بقرار من {actor}. |

- **Who is told:** every active assignee of a task closed by
  `cancelStageExitTasksInTx` on RETURN or EXIT, and of the optional tasks
  closed on ADVANCE by another member's action; and the other members of an
  ANY_ONE stage whose open work closed. Not the actor.
- **The ADVANCE case today is silent by design** (ACC-68, "Ahmad 9 Oct G")
  for engine-made optional tasks. Q9 asks whether the first wording now
  covers them too (recommended yes: the drawing's first notice is exactly
  that case).
- **Record names are shown only to someone who may open the record**
  (ACC-228's rule); otherwise the record type alone.
- **APP moves** (a change request decided on the committee's Changes tab)
  word the actor as the person who decided there.
- Notifications are free-text rows (there is no NotificationType enum); the
  wording is built from the code and both languages are stored, as the
  existing task notices do (TS:1016).

---

## 8. The leaver rule (decision 7)

- A pool member **deactivated, or no longer resolving** (left the position,
  the committee or the unit headship) mid-stage drops out of the stage's
  current pool. For ALL, the remaining members still decide.
- **Recorded:** the deactivation flow (`UserService.deactivate` →
  `reassignAllForUser`) writes a `WorkflowInstanceStageEvent`
  (`POOL_MEMBER_LEFT`, reason DEACTIVATED) for every **open** stage entry
  whose pool included the user, inside its transaction; the stage history
  shows "{person} left the stage's pool · {date}". Leaving a position or a
  committee is recorded by the 15-minute sweep, which compares each open
  ALL entry's pool with the entry's earlier events (one recomputer, ACC-82's
  rule).
- **An earlier approval by someone who has since left** — Q6 (recommended:
  it still counts; it was a valid decision when made).
- **If the pool becomes empty**, the stage is flagged unassigned and Setup
  health lists it; nothing waits silently.

---

## 9. Setup health

- **New condition `STAGE_ON_STARTING_ASSIGNMENT`**, severity **At risk**,
  grouped by workflow (drawing section 11): "Workflow stage still on its
  starting assignment" — "Workflow: {wf} · Stage: {stage} · Its work goes to
  {admin} until someone replaces this assignment."
- **One condition per stage** that still has an `isStartingAssignment`
  entry. The hourly reconciler is its only writer (ACC-82); a stage's
  condition clears on the next run after the entry is removed or kept.
- **Review stage** opens the stages page with that stage in the panel
  (`?stage=<id>`, the existing Fix link). **Keep this assignment** asks the
  drawn confirm ("Keep {admin} on {stage}?" · "Setup health will stop
  flagging it." · Keep) through `AmConfirmService.ask()`, then
  `POST /workflow-templates/stages/:id/keep-starting-assignment`
  (`workflows:manage`), which clears the flag, audits it (no reason, Q12
  decided) and lets the next reconcile close the condition. The confirm body
  measures 21 / 24 of 420 (drawn).
- **Without `workflows:manage`** the actions are replaced by the existing
  "Fixing this needs permission to manage workflows." line.
- `STAGE_WITHOUT_ASSIGNEE` stays, now driven by the pool (§4.5).

---

## 10. The UI, by drawing section

### Section 8 — Stage editor · Who works this stage

The stage editor panel's assignee card becomes a section:
- **A list of entries** (artboard-11 repeating group: handle, ordinal,
  named Remove "Remove assignee 2", "+ Add another"), each a Kind select and
  its fields in a fixed slot (artboard 10): Specific user (person picker),
  Fixed position (position + unit, with the existing no-holder warning per
  row), Org unit head (unit, or "the record's unit" per Q3), Creator (no
  fields), Committee (committee, or "the record's committee"; role filter).
  The kinds come from a server list per record type (no frontend copy).
- **"When there are several people"** (shown for 2+ entries, or a single
  Committee entry): Any one of them / All of them / Committee vote (the
  third only for exactly one Committee entry), each with its drawn help line.
  "How new records are given out" (Share in turn) is **not built** (ACC-270).
- **The read-back sentence** under the section ("Any one of: the head of
  Quality Department, or whoever holds Team Leader in …"), built by the
  server and returned with the template read, so the words and the engine
  can't disagree, and announced politely.
- **The starting assignment chip** ("Starting assignment" / «إسناد أولي»)
  and its note; replacing or removing the entry clears it.
- **Errors in their slots** ("A stage needs at least one assignee.", "This
  entry is already in the list.", "Choose a position."), Save never
  disabled (Design System rule 5.2).
- **Protected templates:** the section renders read-only.
- Phone: one entry per row, Kind ▾ over its value, Remove as ✕ (drawn).

### Section 9 — Transition editor · no people

The transition editor leaves its dialog for a **page panel** beside / under
the stage editor (decision 8), with: names, From (read-only), To, Kind,
"How it moves" (A person only, for now: "Pressed by whoever works {stage}",
the stage a link that opens its editor), and the automatic actions.
**Removed:** "Who can trigger", its kinds, Required permission and the
permission warning. "Show this button only when" waits for the condition
builder (step 2).

### Section 10 — Transitions the app runs

In the transitions list: a "Done by the app" / «يُنفّذها النظام» chip, no
Edit, no ⋯; clicking opens the panel read-only with the drawn banner ("Runs
when the change request is approved on the committee's Changes tab." /
"The app runs this move itself, so it can't be changed here.") and Close.
The one-line trigger text is per APP transition: a key from a registry of
app-run moves (`APP_MOVES`, server-side, served with the template), never a
frontend copy.

### Section 11 — Setup health

As §9, on the existing page and list component (grouped by workflow).

### Section 12 — Notifications

The existing in-app list renders the stored text with "Open record". No new
UI beyond the wording.

---

## 11. The split into PRs (backend first; each deployable alone)

| PR | Contents | Migration | Deploy notes |
|---|---|---|---|
| **1 — schema + pool engine (read path)** | The migration (§3); `StagePoolService`; the engine reads entries when a stage has them, old columns otherwise (§4.6); `mover` read with SYSTEM_AUTOMATIC fallback; the empty-pool refusals; the leaver event table written by deactivation. No screen change. | yes, additive | Behaviour unchanged for every unconverted stage. |
| **2 — the backfills** | `backfill-acc271-stage-assignees`, `backfill-acc271-transition-movers`, and the seed + `assignStartingAssignments` for new tenants. | no | Run after PR 1 deploys: dry run, execute, dry run 0. After it, every stage is converted. |
| **3 — the APIs** | Stage save takes `who: { mode, entries }` (validated, tenant-checked, audited field by field like ACC-255's stage audit); the template read returns entries, the read-back sentence, the kinds per record type and `APP_MOVES`; transition save drops the people fields: **an old-screen save of a field the engine no longer reads for a converted stage is refused with a translated sentence, never silently ignored** (Ahmad, 28 Oct, condition b); `keep-starting-assignment`; Setup health's new condition and reconciler. | no (enum value from PR 1) | Old screens still work against it. |
| **4 — the notices** | `TaskClosedNoticeService` and the three wordings, wired into stage exit, ANY_ONE decisions and pool completion. | no | Independent of the screens. |
| **5 — the screens** | Section 8 in the stage editor panel; the transition editor as a page panel (sections 9, 10); Setup health's row and confirm (section 11). Both languages, phone. | no | Reads PR 3. ACC-268 closes here. |
| **6 — contract cleanup (later)** | Drop the old branch in the engine and, in a later release, the old columns and enum values (`triggerCondition`, `triggerRoleId`, `triggerUserId`, `requiredPermission` on transitions, `assigneeStrategy`, `assigneeRoleId`, `approvalMode`, `parallelThreshold`, ROLE/ROUND_ROBIN/SEQUENTIAL/MAJORITY). | contracting | Only after a scan shows nothing reads them; its own ticket. |

PRs 3 and 4 can be built in parallel after 2. Only PR 5 changes what a tenant
admin sees.

### 11.1 PR 1 as built (28 Oct)

Commits on `feature/ACC-271-stage-owns-who`: the migration
(`acc271_stage_assignees`, additive only); `StagePoolService` (+
`StagePoolModule`, `workflow-pool.ts`, batched `RECORD_ROUTES` lookups);
the engine's converted branch; the leaver events in `UserService.deactivate()`;
a real-database spec; the two refusals worded in English and Arabic. Full
mechanism: SYSTEM-REFERENCE §2.19.

**Departures from the plan, each small, each Ahmad's to overrule:**

1. **Org unit head, both forms, has no walk up to a parent and reads the period
   table.** §4.1 named `resolveActingHeadForOrgUnit()`, which walks up the
   tree and reads the `actingHeadUserId` cache. Q3's "no walk up" is applied
   to a named unit as well as the record's unit, and the head is the unit's
   head holders plus its acting cover in force (ACC-173's rule: the period
   table, never the cache), so it can be batched. A walk for a named unit is a
   one-place change if wanted.
2. **An away member may still act themselves**, beside their acting user. The
   pool's `members` has the acting user in their place (what All of them waits
   for); `direct` keeps the person, and the trigger accepts either. An acting
   user's place in All of them is filled by their own approval or the absent
   member's.
3. **The refusals say "this stage", not its name, on screen.** The record
   page's transition buttons show a translation key with no parameters, so the
   sentence is "Only whoever works this stage can do this." The response
   carries `stageNameEn`/`stageNameAr` for PR 5 to name it.
4. **The pool's notices carry no out-of-office routing notices.** A converted
   stage's initial-assignee and SEND_NOTIFICATION notices go to the pool's
   members; the old "routed to your acting user" notices were sent on every
   resolution, and a pool is resolved on every decision.
5. **Leaving a position or committee mid-stage is not recorded yet** (§8 gives
   it to the sweep). PR 1 records deactivation only, as §11's row says; the
   sweep's comparison belongs with PR 2 or PR 4.

**Two things PR 2 must do before it converts any stage, or behaviour changes:**

- **Mark the forward move of every stage converted to All of them or Committee
  vote as its approval path** (`isApprovalPath`). The seeded committee moves
  are not, and on a multi-person stage a press of a move that is not on the
  approval path sends the record on at once. Today's SINGLE stages never asked.
- **Stop `WorkflowTransitionActionsComponent` hiding a button by
  `requiredPermission` on a converted stage.** The engine no longer reads it
  there, so a pool member without the permission would be refused nothing and
  shown nothing.

**Mutation checks (all caught):** drop the ACTIVE filter (unit 2, db 2); let an
empty pool pass (unit 2, db 1); read `requiredPermission` again on a converted
stage (unit 1); All of them met by any approval (unit 1, db 1); resolve each
converted entry on its own in the sweep (unit 1); read the leaver's pools after
the status flip (unit 1 — the db-spec cannot see it: that read sits outside the
uncommitted flip); committee members read without the organisation (unit 4);
an unconverted stage asks for a pool (unit 66).


### 11.2 PR 2 as built (28 Oct)

The seed's `who` per stage; `assignStartingAssignments()` after the first
admin's invite; `GET /workflows/instances/:id/moves` and the transition
buttons reading it (PR 1's second must-do); the two backfills, with plan §6.4's
counts as their expected ones. SYSTEM-REFERENCE §2.19.

**Departures, each Ahmad's to overrule:**

1. **Org unit head (settled 29 Oct, Ahmad): "the head of the record's unit"
   only where the record type has a unit route.** On a record type with none
   (today the two Unit Manager Review stages, on document requests and change
   requests) the backfill gives the tenant admin's starting assignment, as the
   seed does for a new organisation. So an existing organisation now ends
   exactly where a new one starts: the seed spec checks the mapping against
   all 60 seeded stages with no exception. A record type that gains a unit
   route later keeps its Org unit head stages as "the record's unit".
2. **The seed writes each move's `mover` too** (not asked for in item 1), by
   the same rule as the backfill, so a new organisation is consistent from the
   start.
3. **"Marked for a starting assignment" is not stored.** It is a converted
   stage with no entry, which is exactly what the seed leaves; a re-run finds
   none.
4. **`createTenant()` reaches `assignStartingAssignments()` through
   `TenantService`** (`assignWorkflowStartingAssignments()`), the path it
   already uses for `bootstrap()`, rather than a new PlatformModule →
   WorkflowModule edge.
5. **The approval-path worry did not apply to committees** (§6.4): every
   committee stage becomes Any one of them. The backfill still enforces the
   rule and expects 0 marks; the seed spec pins the four multi-person stages.
6. **Reset tasks are cancelled like the engine's own cancels**: status
   CANCELLED with a time, no reason, no notice. Expected count 0.
7. **The moves read is a new endpoint** (one stage's moves, no paging, not on
   the per-request guard path).

**Between this deploy and PR 3:** a new organisation (and every existing one
once the backfill runs) has converted stages, while the old stage and
transition editors still show and save the old fields, which the engine no
longer reads for them. PR 3 refuses such a save with a translated sentence
(condition b).


### 11.4 PR 4 as built (29 Oct)

The closed-task notices (§7) and the sweep half of the leaver rule (§8).
SYSTEM-REFERENCE §2.19.

**Ahmad's two answers (29 Oct), recorded here as asked:**

1. **A 4th wording**, for a task completed by another assignee with no stage
   move: "Your task "{task}" on {record} is closed: {actor} completed it." /
   «أُغلقت مهمتك «{task}» في «{record}»: أُنجزت من قِبل {actor}.» Same rules as
   the other three. For a reader who may not open the record it reads "on the
   committee" / «في اللجنة»; with no record type to say, the "on …" part is
   dropped. The first wording ("approved … moved to {stage}") is used only for
   a stage decision that moved the record.
2. **Leavers follow §8, not the earlier instruction**: leaving a position or a
   committee (or an acting cover ending) is recorded by the 15-minute sweep;
   deactivation stays in its own transaction (PR 1). **No lane A code was
   touched** (no position-assignment file). The mutation checks are "the sweep
   records a leaver twice" and "the sweep misses an acting cover that ended",
   in place of "skip the leaver event on a position change".

**Departures and decisions, each Ahmad's to overrule:**

1. **One additive migration**, `acc271_pool_member_joined`: §8's sweep needs to
   know who WAS in the pool to see who left, and nothing stored that. An
   entry's own events now do: POOL_MEMBER_JOINED at stage entry and when the
   sweep first sees someone, POOL_MEMBER_LEFT when they go. Only "All of them"
   entries are tracked, as §8 says.
2. **The notice text is stored as the title as well as the body**, because the
   bell shows titles only.
3. **The bell was touched** (`notification-bell.component.ts`): a
   notification about a committee links to its page, with "Open record" under
   it. A change request links to its committee's page (its own page needs the
   committee id); meetings have no page yet, so no link.
4. **Arabic record words**: for a reader who may not open the record, the
   committee reads «اللجنة», which agrees with the table's feminine verbs. A
   module whose record is a masculine noun (meetings, documents) needs its own
   verb forms when it first sends these notices.
5. **`recordPoolChanges()` checks the entries are the organisation's own**
   (one batched read), so a wrong pairing writes nothing rather than events
   under the wrong organisation.

---

## 12. Tests per PR

- **PR 1:**
  - unit: each kind's resolution, the "or" join and dedupe, out-of-office
    routing, ACTIVE-only (including committee members, gap 4);
  - `triggerTransition`: in-pool allowed, out-of-pool refused, empty pool
    refused, APP refused on the manual endpoint, record actions still
    narrow; approvals for ANY_ONE / ALL / COMMITTEE_VOTE; the old branch for
    unconverted stages unchanged (the existing specs keep passing);
  - **db-spec (real Postgres):** a pool resolved for an Org unit head of the
    record's unit (gap 1); a deactivation writing `POOL_MEMBER_LEFT` and ALL
    deciding without the leaver; tenant isolation (another organisation's
    user, position, committee or unit never resolves; the gate name);
  - mutation checks: drop the ACTIVE filter; let an empty pool pass; read
    `requiredPermission` again.
- **PR 2:** dry run writes nothing; execute writes exactly the §6 mapping
  with one audit row per organisation; a second dry run plans 0; a customer
  organisation and an unexpected count are refused; the seed spec pins
  every stage's `who`; a new tenant gets starting assignments after the
  invite (db-spec).
- **PR 3:** DTO validation (kinds, duplicate entries, Committee vote with
  one Committee entry only, tenant-checked ids); field-by-field audit;
  protected templates refuse a changed `who`; the read-back sentence per
  combination in both languages; Setup health's reconciler as the only
  writer, Keep clearing it; `workflows:manage` gates.
- **PR 4:** each wording in both languages; who is and isn't told (not the
  actor, not removed assignees); record name only for viewers who may open
  it; sent after commit (a rolled-back move sends nothing).
- **PR 5:** layout specs at 1280, 1440, 1920 and 390 in both languages (the
  ACC-255 panel spec's rules, including CI's wide-input case); keyboard and
  focus for the entry list; no frontend copy of kinds or rules
  (`check:workflow-enum-display` widened to the new enums); the app-run
  panel read-only; Setup health's confirm through `AmConfirmService.ask()`.

---

## 13. Questions for Ahmad

1. **What do existing stages assigned to a Role or Round robin become?**
   46 per organisation today (QUALITY_MANAGER 34, QUALITY_OFFICER 11,
   BASE_USER 1), and every open committee sits on one.
   **Recommended: the tenant admin starting assignment**, exactly like a new
   tenant's seed, so Setup health lists every one for the admin to replace.
   (Alternative: one Specific user entry per current holder of the role — a
   snapshot that silently goes stale as people change roles.)
2. **Do transitions that carry a `requiredPermission` keep any check?**
   65 per organisation; every human move but the two "submit" ones.
   **Recommended: no.** Decision 1 removes it; the pool is the check, and the
   stage's record actions still narrow record writes. The column stays
   unread until the cleanup PR. Consequence to accept: until an admin
   replaces the starting assignments, the tenant admin (and only they) can
   press every human move, including today's `committees:approve` ones.
3. **Org unit head and Committee entries: also offer "the record's unit" /
   "the record's committee"?** **Recommended: yes**, through `RECORD_ROUTES`
   (the stage-task registry, fail closed), with no walk up to a parent unit
   (your 9 Oct rule for stage tasks). It is what makes the two seeded
   ORG_UNIT_HEAD stages and Meetings' minutes approval meaningful.
4. **`MEETING.minutes_review`** (ROLE BASE_USER, All): **recommended:** seed
   it like every other stage (tenant admin, All of them) now, and seed "the
   record's committee, Committee vote" when Meetings are built.
5. **The tenant admin is INVITED when the starting assignments are written.**
   **Recommended:** leave pools ACTIVE-only, so those stages show as
   unassigned until the admin accepts (Setup health says so).
6. **An approval given by someone who later leaves:** **recommended:** it
   still counts toward All of them; only their missing approval stops being
   waited for.
7. **PARALLEL MAJORITY** (none exist): **recommended:** backfill to All of
   them, reported by the dry run; never silently to Any one.
8. **A backfill that finds an open stage task or an approval in flight:**
   **recommended:** refuse and report (none exist today), rather than
   converting a stage mid-decision.
9. **The ADVANCE case of the closed-task notice:** today optional engine
   tasks close silently when the record moves on (ACC-68). **Recommended:**
   the first wording now covers them too, as drawn.
10. **Platform administrators impersonating** (ACC-99 removes impersonation
    before the first customer): **recommended:** no bypass of the pool.
11. **The transition editor as a page panel:** **recommended:** it opens below
    the stage editor (stacked, like the expanded row since PR 4a), not
    side by side, so both keep the ~660 px each needs.
12. **When does PR 6 (dropping the old columns) happen?** **Recommended:** its
    own ticket, after one release in which a scan shows nothing reads them.

### 13.1 Ahmad's answers (28 Oct)

**All twelve recommendations are accepted, with two changes:**

- **Q7 (changed): PARALLEL MAJORITY** becomes **Committee vote** on a stage
  assigned to a committee, and **All of them** on any other stage — never
  Any one. The dry run reports each.
- **Q8 (changed): a backfill that finds an open stage task or an approval in
  flight** resets that stage's in-flight approvals and tasks and reports it,
  instead of refusing (this is a development environment). Nothing else is
  cleared or deleted: the 8 open committees and their instances stay and are
  converted.

**Two extra conditions:**

- **(a) The performance rule** (standing until go-live), recorded at the top
  of §4: nothing added to the per-request guards, interceptors or middleware;
  pools resolved in batches (one query per kind); `Promise.all` for
  independent reads; no new polling; new lists paged on the server or capped
  and noted.
- **(b) PR 3:** an old-screen save of a field the engine no longer reads for a
  converted stage is refused with a translated sentence, not silently
  ignored (recorded in §11's PR 3 row).
