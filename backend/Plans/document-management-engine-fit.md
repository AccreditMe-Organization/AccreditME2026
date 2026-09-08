# Document Management vs. the Workflow Engine — Fit Review

**Investigation only.** No code, schema, configuration, or design proposals.
Scope is Document Management alone (`module-designs.md` §"Document Module (Step
17)"). **No `step-17` plan file exists** — `backend/Plans/` contains no
document-module plan, so `module-designs.md` is the only design source.

Informed by `workflow-task-model-review.md`. Findings are split into the three
requested categories, and within category 3 a distinction is kept between
*expressible* and *proven*: **zero `WorkflowApproval` rows have ever existed in
any tenant**, so every approval-dependent claim below is expressible-but-unproven
by definition.

---

## 1. Structurally impossible — the model has no way to express it

### 1.1 Cross-object workflow triggering

Three separate places in the design require one workflow to act on a *different
object's* lifecycle:

| Design requirement | Source |
|---|---|
| DOCUMENT_REQUEST "Approved (final) — **triggers Document workflow creation**" | Request Workflow, stage 4 |
| CHANGE_REQUEST "If approved → **opens new document revision cycle**" | Change Request Workflow |
| Merge: "When merged document reaches Published, **workflow action automatically moves source docs to Obsolete**" | Document Merge |

`WorkflowActionType` is a closed enum of six: `CREATE_TASK`,
`SEND_NOTIFICATION`, `GENERATE_PDF`, `LOCK_DOCUMENT`, `LOG_AUDIT`, `WEBHOOK`.
None starts an instance, and none transitions another instance. `startInstance()`
is called from exactly one place in the codebase (`committees.service.ts:87`) —
always by a module about its own object.

The merge case is the strongest of the three: it is described explicitly as *"a
workflow action"*, and no action type can do it.

### 1.2 No outbound hook for a consuming module to react to a stage change

This is the general form of 1.1 and the more consequential finding.
`performTransition()` writes `WorkflowInstanceStage`, updates the instance,
calls `fireTransitionActions()`, writes an audit row, and returns. It emits no
event, invokes no callback, and calls no consuming-module service.

So a document module cannot learn that a document reached `Published` except by:

- **`WEBHOOK`** — an HTTP call from the app back into its own API. Built and
  working, but an out-of-process round trip for an in-process state change.
- **Polling** its own documents' instances.

step-07 §8 records that the notification event bus was deliberately not built
(modules call `NotificationService` directly). The same absence here has a
different consequence: notifications target *users*, and there is no equivalent
direct-call path for targeting a *module*.

### 1.3 Conditional routing on object or approval state

Every advancement is an actor naming a `transitionId`. `SYSTEM_AUTOMATIC`
exists as a `WorkflowTriggerCondition` value and is **rejected on sight**
(`workflow.service.ts:217`, "This transition can only be fired by a system
process"); nothing anywhere fires one. There is no rule engine, no branch
predicate, and no field on `WorkflowTransition` expressing a condition other
than `validatorConfig` — which can only *block*, never *choose*.

Two Document requirements need choosing, not blocking:

- **"Majority abstained → Quality Officer escalates."** A distinct third
  outcome, selected by counting `ABSTAINED` decisions. `isApprovalThresholdMet()`
  returns a boolean; there is no third branch to route to.
- **"Publish Approval — configurable: SINGLE/COMMITTEE per doc type."** If read
  as *one* DOCUMENT template whose Publish stage varies by the document's type
  at runtime, this is impossible: `approvalMode` is a static column on
  `WorkflowStage`, evaluated identically for every instance of that template.
  (Read as *separate templates per doc type* it is expressible — see 3.6.)

### 1.4 `SEQUENTIAL` approver ordering

The known example, and it applies directly. `module-designs.md` does not name
`SEQUENTIAL` for Document, but the Lifecycle's three consecutive PARALLEL/ALL
review stages plus a Quality Officer consolidation step describe an ordered
review. No schema field carries approver sequence, so ordering is unrepresentable
rather than unimplemented.

### 1.5 `ABSTAINED` has no threshold semantics, and deadlocks under `ALL`

`ABSTAINED` is a real enum value and `SubmitApprovalDto` accepts it. But
`isApprovalThresholdMet()` counts only `APPROVED` and `APPROVED_WITH_COMMENTS`:

```ts
const approvedCount = approvals.filter(
  (a) => a.decision === 'APPROVED' || a.decision === 'APPROVED_WITH_COMMENTS',
).length;
...
if (threshold === 'ALL') return approvedCount >= poolSize;
```

Document specifies `ABSTAINED` as a first-class response ("cannot review, reason
mandatory") on stages configured `PARALLEL` / threshold `ALL`. Under `ALL`, an
abstention can never be satisfied — `approvedCount` can never reach `poolSize`
while one pool member has abstained. The stage is permanently stuck unless the
abstainer re-votes (the upsert on `workflowInstanceStageId_approverId` permits
re-voting).

Classified here rather than in §2 because the deadlock is not a missing feature
but the arithmetic of a threshold that has no representation for "this approver
is excluded from the denominator".

### 1.6 Not found: sub-workflows

No model nests one instance inside another. `WorkflowInstance` has no parent
reference. Document's design does not require sub-workflows, so this is noted as
checked and absent rather than as a gap.

---

## 2. Designed but not built — the concept exists, it does not work yet

### 2.1 `LOCK_DOCUMENT` and `GENERATE_PDF`

Both are real `WorkflowActionType` values and both return a fixed stub string.
Document needs both: locking during review, and PDF generation at publish.
`GENERATE_PDF` is already configured and `isEnabled=true` on `DOCUMENT/Publish`
in the seed — it has never run only because no DOCUMENT instance has ever
existed.

### 2.2 The three unenforced validators, and the object-snapshot mechanism

`requiredFields` and `minAttachments` are exactly the checks a document
lifecycle needs before submission ("has a title", "has an uploaded file"). Both
depend on the caller-supplied object snapshot that `TriggerTransitionDto` never
carried. The one `validatorConfig` in the entire seed is
`{"requiredFields":["title","content"]}` on `DOCUMENT/Drafting` — a Document
rule, already written, that does nothing.

`allPreviousStageTasksComplete` applies too: Document's review stages create
tasks, and "you cannot advance until this stage's tasks are done" is the rule
that would connect them. Per `workflow-task-model-review.md` §1.1, this one is
**not** blocked by the snapshot mechanism — the data is already on `Task`.

### 2.3 Periodic review has no scheduled workflow starter

"BullMQ scheduled job fires when `document.nextReviewDate` arrives → auto-creates
new `WorkflowInstance` starting at Drafting."

The BullMQ infrastructure exists (`sla-monitor` runs every 15 minutes), and
`startInstance()` would do the work. What does not exist is any scheduled caller
— `startInstance()` has exactly one call site, and it is user-initiated. This is
ordinary unbuilt work, not a model limit: nothing prevents a processor calling it.

---

## 3. Expressible today

For each: whether it is merely expressible, or actually proven.

### 3.1 Both workflow types and their stage counts — expressible, partly proven

`DOCUMENT_REQUEST` (6 stages) and `DOCUMENT` (7 stages) both exist as
`WorkflowObjectType` values with seeded templates. The seed matches the design's
stage lists. **Proven only as data** — both templates are among the seven with no
consuming module, so neither has ever run.

### 3.2 "If ANY reviewer returns → must go back to drafting" — expressible, unproven

Directly supported, and more precisely than expected.
`triggerTransition()`'s multi-approver path fires a non-approval-path transition
**immediately on a single vote**, with no threshold:

```ts
if (!transition.isApprovalPath) {
  // Any single non-approval-path vote fires immediately — no threshold
  // required to send something back
  return this.performTransition(..., 'REJECTED', ...);
}
```

This is the exact "ANY returns → back to drafting" rule. Unproven: no approval
has ever been recorded.

### 3.3 The four review response options — expressible via one path only, unproven

`SubmitApprovalDto` accepts all four (`APPROVED`, `APPROVED_WITH_COMMENTS`,
`RETURNED`, `ABSTAINED`), and `PENDING` is correctly excluded from the DTO while
present in the enum — matching "system-set only, never submitted by user".

**But two approval paths exist with different expressiveness:**

| Path | Decisions producible |
|---|---|
| `submitApproval()` | all four |
| `triggerTransition()` on a multi-approver stage | `APPROVED` or `RETURNED` only, derived from `isApprovalPath` |

Document needs the four-decision set, so it needs `submitApproval()`.
`submitApproval()` has never been called — see §1.5 for what `ABSTAINED` then
does to a threshold.

### 3.4 Published is non-terminal; Obsolete is terminal — expressible

`isFinal` is read in exactly one place (`status: toStage.isFinal ? 'COMPLETED' :
'IN_PROGRESS'`). Leaving Published non-final keeps the instance `IN_PROGRESS`
indefinitely, which is what "can move to Obsolete or new revision" requires.

### 3.5 Loops back to an earlier stage — expressible

A `WorkflowTransition` is an unconstrained `fromStageId → toStageId` pair.
Nothing forbids targeting an earlier stage, or the `isInitial` stage. "Return to
drafting" from any review stage, and Published → Drafting for a new revision, are
both ordinary transitions. Already used in the seed (e.g. CORRECTIVE_ACTION's
"Insufficient Investigation" returns to an earlier stage).

### 3.6 Per-document-type templates — expressible under one reading

`startInstance()` accepts an optional `templateId` and falls back to
`isDefault: true` only when it is omitted. `WorkflowTemplate` has **no unique
constraint** on `(organizationId, objectType)` — only indexes — so several
DOCUMENT templates can coexist, and a caller can choose.

So "SINGLE/COMMITTEE per doc type" is expressible **as separate templates**, and
impossible **as per-instance variation within one template** (§1.3).

### 3.7 Version-specific lifecycles with concurrent instances — expressible, unproven

The explicitly-flagged shape: a new version restarts a workflow while the
previous version stays live.

`WorkflowInstance` has **no unique constraint** on `(objectType, objectId)` —
only an index. Multiple concurrent instances for the same object are therefore
storable, and `startInstance()` performs no "already has an open instance" check.

Whether that is desirable is a design question, not an engine limit. Note the
consequence: with several open instances for one `objectId`, nothing in the
engine identifies which is current — every consumer would have to pick.

### 3.8 Stage-level SLA and assignee strategies — expressible

The design's per-stage SLAs (16h, 40h, 24h) map to `slaWorkingHours`, computed
through `WorkingCalendarService`. `SELF`, `ORG_UNIT_HEAD` and `ROLE` (for
`QUALITY_MANAGER`/`QUALITY_OFFICER`) all exist as `assigneeStrategy` values.

`ORG_UNIT_HEAD` carries a caveat: it reads `instance.orgUnitId` via a defensive
cast against a field no workflow-driven object has (ACC-63). Document Management
would be the first object able to carry one — until then the strategy resolves
to `[]`.

### 3.9 Access control and acknowledgement — outside the engine entirely

Access levels (`ORG_WIDE` / `DEPARTMENT` / `CONFIDENTIAL`), the staff portal,
`AcknowledgementRecord`, S3 versioning and revision numbering are document-module
concerns with no workflow involvement. No engine fit question arises.

---

## 4. Summary

**Five findings in category 1**, of which the general one (1.2, no outbound hook)
subsumes the three cross-object cases in 1.1: every place Document's design says
"reaching this stage causes something to happen to another object" needs a
mechanism the engine does not have, in any form, for any consumer.

The other three category-1 findings are narrower: no conditional routing (1.3),
no approver ordering (1.4), and `ABSTAINED` having no representation in threshold
arithmetic (1.5).

**Category 2 is ordinary unbuilt work** — two stubs, three validators, a snapshot
mechanism, and a scheduled starter. None indicates a model limit.

**Category 3 is larger than expected**, including two shapes the brief flagged as
doubtful: loops back to earlier stages are ordinary transitions, and concurrent
version-specific instances are unconstrained. But almost nothing in category 3 is
*proven*: the approval machinery has never executed once, and both Document
templates have never run.

**Not applicable:** parallel branches in the sense of a workflow splitting into
two concurrently-active stages. Document's design never asks for it — its
"PARALLEL" stages are parallel *approvers within one stage*, which the engine
supports. A single instance has exactly one `currentStageId`, so a genuine
fork-and-join would be structurally impossible, but no Document requirement
needs it.
