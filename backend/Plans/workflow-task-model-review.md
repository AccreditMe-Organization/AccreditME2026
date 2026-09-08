# Workflow Engine and Task Model — Structural Review

**Investigation only.** No code, schema, or configuration was changed. Every
claim below cites real code or live data; where a plan's own claim disagrees
with the code, the code is treated as authoritative and the disagreement is
named.

Live data quoted throughout is the freshly seeded database (ACC-62, 2026-09-07):
3 organizations, 8 workflow templates per tenant, 54 stages, 67 transitions.

---

## 1. Designed but not built

### 1.1 Three of four validator conditions — and one is not blocked by what the code says blocks it

step-06 §8 defines four validators on `WorkflowTransition.validatorConfig`:
`requiredFields`, `minAttachments`, `allPreviousStageTasksComplete`,
`minApprovals`. `checkValidatorConfig()` (`workflow.service.ts:860`) reads
**one**:

```ts
const config = transition.validatorConfig as { minApprovals?: number } | null;
if (!config?.minApprovals) return;
```

Its comment gives a single reason for all three omissions:

> `requiredFields`/`minAttachments`/`allPreviousStageTasksComplete` need a
> caller-supplied object snapshot that `TriggerTransitionDto` does not carry

**That reason is correct for two of the three and wrong for the third.**
`requiredFields` and `minAttachments` genuinely describe the *business object*
(a document's title, its attachments), which the engine never sees.
`allPreviousStageTasksComplete` describes **the engine's own data**:

- `Task.workflowInstanceId` — FK to `WorkflowInstance` (`schema.prisma:1044`)
- `Task.sourceStageId` — set by `executeCreateTask()` to `toStage.id`
  (`workflow.service.ts:767`)
- `Task.status` — `COMPLETED` on `TaskService.complete()`

So "are this stage's tasks done?" is answerable with one query the engine can
already make — exactly as self-contained as `minApprovals`, which is enforced.
It was grouped with the snapshot-dependent two and deferred with them.

**What depends on it:** nothing, and that is the point. There is no other
mechanism anywhere connecting task completion to stage advancement (see §4).

**Live data:** exactly **2 of 134** transitions across all tenants carry any
`validatorConfig` at all, and both are `{"requiredFields":["title","content"]}`
on `DOCUMENT/Drafting`. **Every validator ever configured in this system is one
of the three that does nothing.** `minApprovals` — the only enforced one — has
never been configured anywhere.

### 1.2 The object-snapshot mechanism itself

step-06 §8 specifies that validators are "checked against a caller-supplied
*current object snapshot* passed alongside `TriggerTransitionDto`", and calls
this step's job "defining the *mechanism*" while functional modules supply
values.

The mechanism was never built. `TriggerTransitionDto` carries `transitionId`
and `comment`. This is the enabling dependency for 1.1's other two validators,
and it is a design item with no partial implementation — not a stub, not a
TODO in the DTO, simply absent.

### 1.3 `SEQUENTIAL` — no ordered roster, and no halt

step-06 §8 specifies: *"a `WorkflowApproval` row is created per approver **in
order**; a `REJECTED` decision **immediately halts the chain** (the instance
stays at the current stage; no further approvals are solicited)."*

`isApprovalThresholdMet()` (`workflow.service.ts:515-517`) states the opposite
in its own comment and behaves accordingly:

```ts
// SEQUENTIAL has no dedicated ordered-roster mechanism in the current
// schema — treated as PARALLEL+ALL until a real sequence concept exists.
const threshold = fromStage.approvalMode === 'SEQUENTIAL' ? 'ALL' : ...
```

Two distinct designed behaviours are absent:

- **Ordering.** No schema field expresses approver sequence, so "in order" is
  unrepresentable, not merely unimplemented.
- **The halt.** A `REJECTED` decision is simply not counted toward
  `approvedCount`. Nothing marks the chain dead and nothing stops further
  approvals being submitted. The instance does stay at the current stage — but
  because the threshold is never reached, not because anything halted.

### 1.4 `WEBHOOK` — built, contrary to first appearance

Recorded because the natural reading of the code is wrong. The action switch
(`workflow.service.ts:642`) has no `WEBHOOK` case, so it appears to fall
through to `default: 'Audit entry recorded'`. It does not: `WEBHOOK` is handled
**before** the switch (line 621) and `continue`s — enqueued to the
`workflow-actions` BullMQ queue, executed by `WorkflowActionProcessor` with a
real `fetch`, retries, and a `WorkflowActionLog` row per attempt.

It is fully built and **never configured**: 0 `WEBHOOK` actions exist in any
tenant. This belongs in §3, not here.

### 1.5 `GENERATE_PDF` and `LOCK_DOCUMENT` — deliberate stubs

Both return a fixed string and are labelled as deferred to Step 17 in-code.
Designed as real actions in step-06, deliberately unbuilt pending Document
Management. Distinct from 1.1–1.3 in that the deferral is stated at the point
of implementation rather than discoverable only by comparison with the plan.

**Live data:** `GENERATE_PDF` **is** configured and `isEnabled=true` on
`DOCUMENT/Publish` in the seed. It has never run only because no `DOCUMENT`
instance has ever existed.

### 1.6 step-07's event bus — deferred honestly at design time

CLAUDE.md specifies *"modules emit events, NotificationService subscribes."*
step-07 §8 states plainly that it implements the second half literally and the
first half pragmatically — direct injected-service calls, not a pub/sub bus —
and flags it as an open question. The code matches that description.

Listed for completeness. Unlike 1.1–1.3, the plan and the code agree; there is
no gap between what was designed and what exists, only between CLAUDE.md's
prose and both.

---

## 2. Built but narrower than modelled

### 2.1 `approvalMode` has two unrelated jobs, and only one is exit-gating

Every read in the engine:

| Line | Read as | Purpose |
|---|---|---|
| 260 | `fromStage.approvalMode === 'SINGLE'` | fire immediately vs. record an approval |
| 500 | `fromStage.approvalMode === 'COMMITTEE'` | quorum + majority path |
| 517 | `fromStage.approvalMode === 'SEQUENTIAL'` | threshold selection |
| **951** | `stage.approvalMode === 'SINGLE'` | **narrow the ROLE assignee pool to one** |
| **1017** | `stage.approvalMode === 'SINGLE'` | **narrow the POSITION_FIXED pool to one** |

The first three take `fromStage` and govern **exit**. The last two take the
stage being *resolved for assignment* — which for `CREATE_TASK` is the
**destination** stage. So `approvalMode` also decides whether a task created on
entry goes to one person or all of them.

The premise "`approvalMode` is meaningless on a final stage" is therefore
**half right**. Exit-gating is dead there; pool-narrowing is not. Live data
confirms this is not hypothetical: **2 final stages (`MEETING/Minutes
Approved`) are entered by a `CREATE_TASK` transition**, so their `approvalMode`
genuinely determines assignment.

### 2.2 Transitions out of a final stage are unused, not impossible

`isFinal` is read exactly once in the engine
(`workflow.service.ts:569`): `status: toStage.isFinal ? 'COMPLETED' :
'IN_PROGRESS'`.

`triggerTransition()` checks `instance.currentStageId` and that the transition
belongs to it. **It does not check `instance.status`.** (`cancelInstance()`
does, at line 164 — a different method.) Since entering a final stage leaves
`currentStageId` pointing at it, an outgoing transition from a final stage
would fire and set the instance back to `IN_PROGRESS`.

**Live data:** 24 final stages, **0** with outgoing transitions. So this is
absent from seed data, not prevented by the engine. A tenant admin adding one
through the transition editor would create a re-openable "completed" instance.

### 2.3 `assigneeStrategy` is meaningful in exactly two situations

1. **On the initial stage** — `startInstance()` calls
   `resolveAndNotifyInitialAssignee()`, which resolves the strategy and
   notifies. This is the one case where a stage's own strategy acts without any
   transition.
2. **On a destination stage whose inbound transition carries `CREATE_TASK` or
   `SEND_NOTIFICATION`** — resolved as `toStage`.

Outside those two, a configured `assigneeStrategy` is inert. It is not
"assignment for this stage"; it is an input other things read. Live data: 26 of
67 transitions carry `CREATE_TASK`, so a majority of stage entries resolve no
assignee at all.

### 2.4 `parallelThreshold` is read only under two of four approval modes

Read at line 517, reached only when `approvalMode` is not `SINGLE` (line 260
returns first) and not `COMMITTEE` (line 500 returns first). `SEQUENTIAL`
overrides it to `ALL` regardless of its configured value.

So `parallelThreshold` is honoured **only for `PARALLEL`**. It remains settable
on any stage. Live data: 4 stages have it set, all `PARALLEL`, all `ALL`.

### 2.5 `COMMITTEE` approval mode is configurable and unsatisfiable

`isApprovalThresholdMet()` requires `fromStage.committeeId` to resolve a real
committee, then enforces `approvals.length >= committee.quorumCount` and a
majority — exactly as designed. But **`committeeId` has no UI control**
anywhere (the stage form shows an info message), so it can only be set via the
raw API.

Live data: **0 of 54 stages have `committeeId` set.** With it null, the code
falls back to `return approvedCount > 0` — silently degrading a formal quorum
vote into "any one approval".

### 2.6 Structurally impossible vs. merely unused

| Combination | Status |
|---|---|
| `SEQUENTIAL` with a genuine approver order | **Impossible** — no schema field expresses order |
| `COMMITTEE` approval mode via the UI | **Impossible via UI** — `committeeId` has no control; possible via API |
| Transition out of a final stage | **Possible, unused** — engine permits it, 0 configured |
| `parallelThreshold` on `SINGLE`/`COMMITTEE`/`SEQUENTIAL` | **Possible, inert** — stored, never read |
| `assigneeStrategy` on a non-initial stage with no inbound `CREATE_TASK`/`SEND_NOTIFICATION` | **Possible, inert** |
| `approvalMode` on a final stage | **Half-inert** — exit-gating dead, pool-narrowing live |

---

## 3. What Committee Management actually exercises

Committee is the only `WorkflowObjectType` with a real consumer:
`startInstance()` has exactly one caller,
`committees.service.ts:87`.

**Its own template, as seeded and as currently configured:**

| Dimension | Value |
|---|---|
| Stages | 6, **all `approvalMode: SINGLE`** |
| Assignee strategies | `ROLE` ×4, `POSITION_FIXED` ×2 |
| Transitions | 8, **all `ROLE_BASED`**, **all with `triggerRoleId` null** |
| Actions | `LOG_AUDIT` ×8, `SEND_NOTIFICATION` ×7, `CREATE_TASK` ×1 |
| Final stages | 1 (`Dissolved`), `SINGLE`, no inbound `CREATE_TASK` |

The two `POSITION_FIXED` stages are current configuration, not the seeded
default — `workflow.seed.ts` seeds `ROLE` for every Committee stage; these
reflect ACC-54/ACC-55 live testing.

**Never exercised by anything real, anywhere:**

- **`WorkflowApproval`: 0 rows have ever existed** in any tenant. Therefore
  `submitApproval()` has never been called, and the `SEQUENTIAL`, `PARALLEL`
  and `COMMITTEE` approval paths have never executed once.
- `committeeId` on a stage: 0 of 54.
- `WEBHOOK` actions: 0 configured (§1.4 — built, unused).
- `LOCK_DOCUMENT`: 0 configured. `GENERATE_PDF`: 1, in a template that never runs.
- Trigger conditions `SPECIFIC_USER`, `SYSTEM_AUTOMATIC`, `ASSIGNEE_POOL`: 0
  configured. `ANY_AUTHENTICATED`: 2, both in non-running templates.
- Assignee strategies `SPECIFIC_USER`, `ROUND_ROBIN`, `COMMITTEE`: 0 anywhere.
  `SELF` ×6 and `ORG_UNIT_HEAD` ×2 exist only in templates that never run.
- `minApprovals`: never configured.

**Total transitions ever fired in the current database: 1** — the
`WorkflowActionLog` holds one `CREATE_TASK` and one `LOG_AUDIT` entry.

The engine offers 4 approval modes, 7 assignee strategies, 5 trigger conditions
and 6 action types. The one real consumer uses **1 approval mode, 2 assignee
strategies, 1 trigger condition and 3 action types** — and reaches none of the
approval machinery at all.

---

## 4. The workflow/task seam

### 4.1 What the code does

**One direction only.** `WorkflowService` → `TaskService` via
`executeCreateTask()`. `TaskService` has **no workflow dependency at all** —
confirmed by import grep: no `WorkflowService`, no workflow types.

`executeCreateTask()` stamps the task with:

- `sourceStageId: toStage.id` — the **destination** stage
- `workflowInstanceId: instance.id`
- `sourceType` mapped from `objectType`, `sourceId: instance.objectId`
- assignees from `resolveAssignee(toStage, ...)`, `dueAt` from the stage SLA

`TaskService.complete()` sets `status: 'COMPLETED'`, `completedAt`,
`completedById`, and clears other assignees' `removedAt`. It reads and writes
nothing in the workflow.

`triggerTransition()` reads permissions, trigger condition, `validatorConfig`
and approvals. It never reads task state.

### 4.2 What each plan assumed

**step-06** assumed the gate exists: `allPreviousStageTasksComplete` is one of
its four validators, and §8 describes checking it at transition time. It owns
the concept.

**step-08** never mentions it. Its Business Rules cover two creation paths, the
`sourceType`/`sourceId` constraint, multi-assignee ANY-completes semantics, the
`executeCreateTask()` assignee-dropping bug, and escalation validation. A
search for "complete" near "transition/advance/stage/gate/block" returns
**nothing**. Task completion is modelled as terminal — the end of a unit of
work, not an input to anything.

### 4.3 Where they disagree

They do not contradict each other; **neither owns the link**. step-06 designed
it and deferred it to a snapshot mechanism it also never built (§1.1, §1.2).
step-08 did not model it at all, so nothing on the task side was ever built to
support it — no completion hook, no event, no dependency.

The result is exactly the behaviour observed in testing: a user completes a
task *and* separately presses a transition, with nothing connecting the two and
nothing preventing advancement while the task is still open.

### 4.4 What already exists that the missing link would need

- `Task.workflowInstanceId` — populated on every workflow-created task
- `Task.sourceStageId` — populated with the stage the task belongs to
- `Task.status` — `COMPLETED` is authoritative and set in one place
- `checkValidatorConfig()` — already the correct call site, already invoked
  before every transition, already reads `validatorConfig`

The data and the call site both exist. What is absent is the check.

---

## 5. Cross-reference — the 12 untracked assessment findings

| # | Finding | Classification |
|---|---|---|
| A | `createTemplate()` has zero callers; no "New Template" button | **Independent** — UI/scope gap, unrelated to §1/§2 |
| B | `startInstance()` has one caller; 7 of 8 templates inert | **Independent** — module coverage. Root cause of most of §3's "never exercised" |
| C | Stage `Description` stored, read by nothing | **Independent** — a field with no consumer, not a narrowed one |
| E | Stage `order` is display-only | **Independent, and arguably correct** — step-06's design is explicit that flow comes from transitions, so `order` was never meant to drive it. The defect is that the UI implies otherwise |
| F | `COMMITTEE` mode needs a `committeeId` no form can set | **Symptom of §2.5** — the UI half of a mode that is configurable-but-unsatisfiable |
| G | `SPECIFIC_USER` has no user picker | **Independent** — missing UI for a built strategy |
| J | ROLE_BASED role picker mislabelled "Assignee Role" | **Independent** — mislabelling, but see K |
| K | `ROLE_BASED` with no role silently means "no role check"; all 8 templates are in this state | **Symptom of §2** — a field that is conditionally meaningful, where the condition is invisible. Live data: **0 of 67** transitions set `triggerRoleId`, so the role check is skipped system-wide |
| L | Transition endpoints immutable after creation | **Independent, deliberate** |
| M | `CREATE_TASK` on the inbound transition is what makes a stage's assignee mean anything | **Symptom of §2.3 and §4** — the most direct UI expression of the seam's one-directional shape |
| N | `GENERATE_PDF`/`LOCK_DOCUMENT` are stubs offered as ordinary choices | **Symptom of §1.5** — deliberate deferrals with no UI marking |
| O/P | 11 undiscoverable facts; "engine with an admin debugging surface attached" | **Aggregate** — largely the sum of §1 and §2 surfaced through a UI that exposes the full model uniformly |

**Summary:** 4 of 12 (F, K, M, N) are UI symptoms of the two structural
categories rather than independent problems. 1 (E) is a UI expectation
mismatch against a deliberate design decision. The remaining 7 are genuine
independent gaps, of which B is the largest and explains most of §3.

---

## 6. Summary of what is and is not the case

- **The model is not wrong.** Every concept in §1 and §2 is coherently
  designed; the gaps are between design and implementation, or between what a
  field means universally and where it is actually read.
- **One designed link is missing and its stated blocker does not apply to it**
  (§1.1). That single absence explains the observed
  complete-and-then-advance-with-nothing-connecting-them behaviour.
- **Neither plan owns the workflow/task link** (§4.3), which is why nothing
  partial exists to build on — but the data needed to close it is already
  populated on every workflow-created task.
- **Two fields carry a second, undocumented job** — `approvalMode` narrows
  assignee pools, and `assigneeStrategy` is an input other things read rather
  than a property of its own stage.
- **The approval machinery has never executed.** Zero `WorkflowApproval` rows
  have ever existed, so `SEQUENTIAL`, `PARALLEL` and `COMMITTEE` remain
  entirely untested against real use, and the one real consumer uses only
  `SINGLE`.
