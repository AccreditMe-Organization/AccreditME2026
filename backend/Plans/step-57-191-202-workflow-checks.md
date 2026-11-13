# ACC-57, ACC-191, ACC-202: workflow stage checks

One workflow PR. Branch `fix/workflow-stage-checks`, from `dev` at `9f35689`.
Decisions are Ahmad's 13 Nov comments on each ticket. This plan was written
before any code. Its open questions (§7) need answers before building.

---

## 1. Findings

### 1.1 ACC-57: a template's starting and final stages

**The rule (decided 13 Nov):** a stage save is refused, with a reason naming
the stage, when the template it leaves would have:
- no initial stage;
- two or more initial stages;
- a stage marked both initial and final.

**Every write path that can change `isInitial` / `isFinal` or remove a stage:**

| Path | File | What it can do today |
|---|---|---|
| `addStage()` | `workflow-template.service.ts` | Creates a stage with any `isInitial` / `isFinal`: a second initial stage, a first stage that is not initial, or one that is both. |
| `updateStage()` | same | Sets either flag freely: untick the only initial stage, tick a second one, or tick both. |
| `removeStage()` | same | Refuses the initial stage while others exist (a codeless 409). Any other stage deletes freely. |
| `applyWorkflowSeed()` | `workflow-seed-apply.ts` | Writes the seed's flags on create, AND on update of an existing stage. Reached on update only by `backfill-acc239-change-request-workflow` (the protected change request template). Bootstrap runs once per tenant (`bootstrap()` refuses a second run). |
| `committee-in-stage.ts` | `common/testing/` | Spec helper only; never runs in the app. |
| Backfills (`acc233`, `acc255`, `acc271`) | `prisma/` | Write `key`, `flags` and `whoMode` only, never the two flags. |

**No other paths exist:**
- there is no reorder endpoint (order goes through `updateStage`);
- there is no template copy or clone;
- `createTemplate()` makes an EMPTY template (0 stages).

**Where one check covers them all:** a single helper,
`assertStartAndEnd(tx, templateId, baseline)` in a new
`workflow-start-end.ts`.
- `addStage`, `updateStage` and `removeStage` call it inside the transaction
  each already opens, after their write, under the template row lock
  (`lockTemplate()`, the lock ACC-255's exactly-one flags already take).
- The lock is taken only when the save touches the shape: it adds or removes a
  stage, or SENDS a changed `isInitial` / `isFinal`. A rename takes no lock and
  runs no check.
- **The seed** is static data. A spec pins it (every `SYSTEM_WORKFLOW_SEED`
  template has exactly one initial stage and none that is both), so no runtime
  check is needed there. Today the seed spec checks neither flag.

**What "the template" means for an empty one:** a template with no stages is a
template not yet built. The rule applies once it has a stage. So the first stage
added must be initial, and removing the last stage (already allowed today)
stays allowed. See Q2 for the default-template half.

**Moving the starting stage (Q1, needs a decision):** "refuse two" plus
"refuse none" leaves no way to move the starting stage from A to B one save at a
time:
- untick A → none → refused;
- tick B → two → refused.

**Recommendation:** ticking Initial on B (add or update) MOVES it. A's
`isInitial` is cleared in the same transaction, under the template lock, and
both stages get audit rows. The panel says so after the save: "Formation is no
longer the starting stage." With that, "two initial stages" can only come from
data already in breach (§1.4), and its refusal stays as the defensive case.

**Protected templates:** the change request template cannot reach any of the
three states.
- `addStage` / `removeStage` are refused outright (`ADD_STAGE`, `REMOVE_STAGE`).
- `updateStage` refuses any changed field outside `PROTECTED_STAGE_EDITABLE`
  (names, description, deadline, escalation), and `isInitial` / `isFinal` are
  not in it.
- Its seed has one initial stage (`draft`) and three final ones, none both.
- The new seed spec pins that too.

### 1.2 ACC-191: deleting a stage or action that was used

**Foreign keys pointing at `WorkflowStage`** (read from the migrations' SQL and
`schema.prisma`):

| Child | Column | On delete | Effect on `removeStage` |
|---|---|---|---|
| `WorkflowInstanceStage` | `stageId` | **RESTRICT** | P2003, so a 500 today. **The ticket's case.** |
| `WorkflowTransition` | `fromStageId` | **RESTRICT** | Already refused first (codeless 409, "still referenced by a transition"). |
| `WorkflowTransition` | `toStageId` | **RESTRICT** | Same refusal. |
| `WorkflowStageRecordAction` | `stageId` | CASCADE | Goes with the stage. |
| `WorkflowStageAssignee` | `stageId` | CASCADE | Goes with the stage. |
| `WorkflowStageTaskDefinition` | `stageId` | CASCADE | Goes with the stage. `Task.stageTaskDefinitionId` is SET NULL, so tasks keep their snapshot. |
| `WorkflowInstance` | `currentStageId` | *no FK* | A loose id. Any instance pointing at a stage has an open entry there, so the `WorkflowInstanceStage` count covers it. |
| `Task` | `sourceStageId` | *no FK* | Loose. Only the engine sets it (`CreateTaskInternal`, never the HTTP body), always for a stage a record entered, so the same count covers it. |

**Foreign keys pointing at `WorkflowTransitionAction`:**

| Child | Column | On delete |
|---|---|---|
| `WorkflowActionLog` | `workflowTransitionActionId` | **RESTRICT**. The ticket's case. |

**And at `WorkflowTransition`** (reached by `removeTransition`):

| Child | Column | On delete | Effect |
|---|---|---|---|
| `WorkflowTransitionAction` | `workflowTransitionId` | RESTRICT | `removeTransition()` deletes the actions first. **That delete hits the action-log RESTRICT, so `removeTransition()` also 500s for any transition that has ever fired** (every seeded transition carries `LOG_AUDIT`, which always logs). Not named in the 13 Nov comment, but it is the same defect. Proposed in scope (Q3). |
| `WorkflowApproval` | `transitionId` | SET NULL | Harmless. A vote loses its move and counts as a pre-ACC-284 vote. |

**So three checks cover every RESTRICT that can fail a delete:**
1. `removeStage`: count of the stage's `WorkflowInstanceStage` rows.
2. `removeTransitionAction`: count of the action's `WorkflowActionLog` rows.
3. `removeTransition`: count of `WorkflowActionLog` rows over its actions.

The transition FKs on a stage are already checked.

**Inside the delete transaction (decided):** each check runs as:
1. lock the row being deleted (`SELECT … FOR UPDATE`);
2. count;
3. delete.

Why the lock first:
- An engine insert of a `WorkflowInstanceStage` (or a webhook processor's
  `WorkflowActionLog`) takes `FOR KEY SHARE` on the parent row, which blocks
  behind our `FOR UPDATE`.
- So a row committed before our lock is counted (READ COMMITTED reads per
  statement), and none can be committed between the count and the delete.
- `removeTransition()` today runs its two deletes with no transaction. It gains
  one.

**What is counted, and said:**
- **A stage:** the RECORDS that have entered it, i.e. distinct `objectId`
  across the instances with an entry there: "This stage is in use by 3
  records". A count of entry rows would over-count a record that returned
  through the stage.
- **An action or transition:** the runs, i.e. `WorkflowActionLog` rows:
  "This action has run 12 times".

**The P2003 safety net** in `http-exception.filter.ts`: **recommend out of
scope.**
- P2003 means two different things: a delete blocked by a child, and an
  insert or update naming a missing parent. A blanket 409 "in use" would
  mislabel the second kind, which is a defect (a 400/404, or a bug).
- Sentry is not wired (ACC-27), so an unexpected 500 is the only signal
  operators get. A generic 409 would hide a defect in exactly the place it
  should show.
- The filter is an explicit allowlist (ACC-27). Adding a broad Prisma mapping
  changes its character.
- If wanted later, it should be its own ticket: map P2003 only on DELETE, log
  at `error`, and keep a test that names every RESTRICT FK. Recorded as Q6.

### 1.3 ACC-202: the outcome a stage is left with

**Every writer of `WorkflowInstanceStage.outcome`:**

| Path | Where | Today |
|---|---|---|
| A person's move on an ANY_ONE stage (`decidesAlone`) | `triggerTransition()` → `performTransition(…, 'APPROVED')` | APPROVED for every kind. **The bug.** |
| A press that acts at once on ALL / COMMITTEE_VOTE (RETURN; EXIT on ALL) | `triggerTransition()` → `'REJECTED'` | REJECTED |
| A threshold met on a vote (ACC-284) | `triggerTransition()` → `moveOutcome(kind)` (`workflow-vote.ts`) | ADVANCE → APPROVED, else REJECTED |
| `submitApproval()` → `maybeAdvanceAfterApproval()` | return decision → `'REJECTED'`; approval → `'APPROVED'` | REJECTED / APPROVED |
| The app's moves (`triggerSystemTransition`, `options.outcome`) | `committee-change-request.service.ts` | submit (ADVANCE): APPROVED (default); approve (ADVANCE): APPROVED; return (RETURN): REJECTED; reject (EXIT): REJECTED; withdraw (EXIT): **SKIPPED** |
| `cancelInstance()` | `workflow.service.ts` | SKIPPED. Not a transition: an administrative cancel. **Unchanged.** |
| A new entry | `create` | PENDING (the column default). Unchanged. |

**Every `performTransition()` caller passes an outcome, and that is the one
choke point.**
- **Proposal:** `performTransition()` stops taking one and derives it from
  `transition.kind` through one function, `stageExitOutcome(kind)`
  (ADVANCE → APPROVED, RETURN → RETURNED, EXIT → EXITED), replacing
  `moveOutcome()`.
- `triggerSystemTransition()` loses `options.outcome`, and the change request
  service's four `outcome:` arguments are deleted.
- Then no caller can disagree with the kind. That is "the person path and the
  system path alike", made structural rather than remembered.

**Effect on the change request template's stored outcomes:** withdraw goes from
SKIPPED to EXITED; reject from REJECTED to EXITED; return from REJECTED to
RETURNED. Which EXIT it was (rejected or withdrawn) stays readable from the
stage entered next, as now.

**Every reader of `outcome`:**

| Reader | How | Effect of new values |
|---|---|---|
| `getStageHistory()` | Copies `visit.outcome` into the visit (`workflow.service.ts`) | Passes the string through. |
| `IWorkflowStageVisit.outcome`, `IWorkflowInstanceStage.outcome` | Typed `string` | No switch. |
| Frontend `WorkflowStageVisitDto.outcome` | `string`, **read by nothing** (grep: no component reads `visit.outcome`) | None. |
| SQL readers (`committee-home`, `task-record-types`, `committee-reference-checks`, setup-health detectors, change-request service) | Join `WorkflowStage` / instance; none filters on `outcome` | None. |
| Specs | `vote-on-advance.db-spec.ts` (4 × `REJECTED`), `workflow.service.spec.ts` (cancel SKIPPED, kept) | The 4 change on purpose to RETURNED / EXITED. |

**No exhaustive switch on `WorkflowInstanceStageOutcome` exists anywhere**,
backend or frontend.

**"Stage history shows Sent back / Ended" is new UI.** Nothing on screen shows
an outcome today. An outcome has the comment's shape: it is written on the row
being LEFT, but the history line it explains is the NEXT visit's, the one the
move entered (§2.14).
- So `getStageHistory()` adds one field per visit,
  `arrivedBy: 'RETURNED' | 'EXITED' | null`, from the PREVIOUS visit's outcome,
  exactly as `comment` is carried.
- `WorkflowStageIndicatorComponent`'s history line shows a chip, "Sent back" /
  «إعادة» or "Ended" / «إنهاء», beside the transition label.
- APPROVED, PENDING, REJECTED, SKIPPED and the first visit show nothing. So old
  rows (no backfill) look exactly as today.

**Deploy order and version skew** (ACC-173's rule: the values must not reach
the shared database before the code that knows them):
- **The migration runs in the pre-deploy step** while the old container
  serves. It only adds enum values. No row holds one until the NEW code writes
  it, and nothing is ever applied to the shared database by hand.
- **Old backend, new values:** the only window is Railway's overlap, after the
  new container serves a move and before the old one stops. The old code reads
  outcomes only in `getStageHistory()` / `getInstance()`, as a string. **To be
  verified, not assumed:** before merging, read a `RETURNED` row on
  `accreditme_wf` with the `dev` generated client (built from `origin/dev`'s
  schema) and confirm it returns the string rather than throwing (§5,
  verification).
- **New frontend, old backend:** `arrivedBy` is absent, so no chip appears.
- **Old frontend, new backend:** it reads no outcome and ignores the extra
  field.

### 1.4 Shared database, read-only (13 Nov)

Run from `D:\Accredit-me-2\backend`, inside `BEGIN TRANSACTION READ ONLY`, then
rolled back. Counts only.

| Question | Count |
|---|---|
| Templates checked | 18, in 2 organisations |
| 0 initial stages (with stages) | **0** |
| No stages at all | **0** |
| 2 or more initial stages | **0** |
| A stage both initial and final | **0** |
| Stages with `WorkflowInstanceStage` rows | 8 of 120 |
| Transition actions with `WorkflowActionLog` rows | 9 of 244 |
| Transitions with at least one logged action | 7 |
| Entries left by a RETURN, stored APPROVED | **4** |
| Entries left by a RETURN, stored REJECTED | 1 |
| Entries left by an EXIT, stored SKIPPED | 2 (change request withdrawals) |
| Entries left by an ADVANCE, stored APPROVED | 13 |
| All entries by outcome | APPROVED 17, PENDING 10, REJECTED 1, SKIPPED 2 |

The move kind was inferred from (left stage → next entry's stage), as stage
history does. No pair was ambiguous, and no exited entry lacks a following one.

**No template breaks rule 1 today, so no slug is listed.** The check is still
built baseline-tolerant (§2.1), for the same reason ACC-120's root-role
invariant is: data can be in breach later (a script, a restore), and a save
that does not make it worse must not be refused.

---

## 2. Design

### 2.1 ACC-57

`workflow-start-end.ts`:
- `startEndViolations(stages)` is pure. It returns the violations as
  `{ kind: 'NO_INITIAL' } | { kind: 'MULTIPLE_INITIAL', stageIds } |
  { kind: 'INITIAL_AND_FINAL', stageIds }`, and none for a template with no
  stages.
- `assertStartAndEnd(tx, templateId, before)`:
  1. reads the template's stages (id, names, flags) after the write;
  2. refuses when the save made it WORSE than `before` (the same read, taken
     under the lock before the write): a violation kind that was not there, or
     more stages in it.
  3. On a template already in breach, a save that leaves the breach as it was
     passes. A save that removes it passes. A save that adds to it is refused.

Order inside each transaction: lock template → read `before` → write (and, for
a tick of Initial, clear it on the other stage, Q1) → `assertStartAndEnd`.

### 2.2 ACC-191

`removeStage`, `removeTransitionAction` and `removeTransition` each:
1. look the row up scoped by organisation (unchanged; another organisation's
   row is the same 404);
2. open a transaction;
3. lock the row `FOR UPDATE`;
4. count;
5. refuse or delete.

`removeStage`'s existing codeless refusals get codes in the same change:
- "referenced by a transition" becomes `STAGE_HAS_TRANSITIONS`;
- "the initial stage while others exist" becomes ACC-57's
  `STAGE_INITIAL_REQUIRED`, since that IS the rule.

### 2.3 ACC-202

- **The migration** `acc202_stage_outcome_returned_exited`:
  `ALTER TYPE "WorkflowInstanceStageOutcome" ADD VALUE 'RETURNED'` and
  `ADD VALUE 'EXITED'`. Additive only; nothing is removed or renamed.
- **The outcome:** `stageExitOutcome(kind)` in `workflow-vote.ts`, replacing
  `moveOutcome()`. `performTransition()`'s `outcome` parameter and
  `triggerSystemTransition()`'s `options.outcome` are removed.
- **History:** `getStageHistory()` adds `arrivedBy`. The frontend DTO and the
  indicator show the chip.

---

## 3. Refusal codes and bodies

Each body has the shape the other workflow refusals use:
`{ statusCode, message, error, code, …details }`. Where a refusal names
stages, it carries `stageIds` and `stageNames: [{ nameEn, nameAr }]` in the same
order, as `STAGE_FLAG_EXACTLY_ONE` does.

| Code | Status | Details | English message (server; screens never show it) |
|---|---|---|---|
| `STAGE_INITIAL_REQUIRED` | 409 | `stageIds`, `stageNames`: the stage the save would leave the template without (unticked or removed) | "A workflow needs a starting stage. Mark another stage as the starting stage instead." |
| `STAGE_INITIAL_NOT_UNIQUE` | 409 | `stageIds`, `stageNames`: every initial stage after the save | "Only one stage can be the starting stage." |
| `STAGE_INITIAL_AND_FINAL` | 400 | `stageIds`, `stageNames`: the stage | "A stage can't be both the starting stage and a final stage." |
| `STAGE_HAS_TRANSITIONS` | 409 | `transitionCount` | "Remove the transitions into and out of this stage first." |
| `STAGE_IN_USE` | 409 | `recordCount` | "Records have entered this stage, so it can't be removed. You can rename it." |
| `TRANSITION_ACTION_IN_USE` | 409 | `runCount` | "This action has run, so it can't be removed. You can turn it off." |
| `TRANSITION_IN_USE` | 409 | `runCount` | "This transition has been used, so it can't be removed. You can rename it." |

**How the screens say them** (frontend `workflow-refusal.ts`):
- **`PLAIN_REFUSAL_KEYS`** gains all seven, as plain sentences:
  - `workflow.refusal.initialRequired`;
  - `…initialNotUnique`;
  - `…initialAndFinal`;
  - `…stageHasTransitions`;
  - `…stageInUse`;
  - `…actionInUse`;
  - `…transitionInUse`.

  So any screen that only calls `plainWorkflowRefusalKey()` already says
  something true in both languages.
- **New readers** `startEndRefusal(err)` → `{ code, stages: [{ id, nameEn,
  nameAr }] }` and `inUseRefusal(err)` → `{ code, count }`, alongside
  `flagExactlyOne()`.
- **The stage editor panel** shows ACC-57's three under their box, as it does
  `STAGE_TASK_ON_FINAL_STAGE`, focusing it:
  - `INITIAL_REQUIRED` under Initial: "{{stage}} is the only starting stage.
    Mark another stage as the starting stage instead." /
    «{{stage}} هي مرحلة البداية الوحيدة. يمكن جعل مرحلة أخرى مرحلة البداية
    بدلاً منها.»;
  - `NOT_UNIQUE` under Initial, naming and linking the other stage (the
    `flagOnOther` pattern);
  - `INITIAL_AND_FINAL` under Final: "A stage can't be both the starting
    stage and a final stage." / «لا يمكن أن تكون المرحلة مرحلة بداية ومرحلة
    نهائية معاً.».
  - The stage name is picked in the reader's language
    (`LanguageService.bilingual`).
- **Counted refusals** use plural objects with every Arabic category (ACC-94),
  rendered through `FormatService.count`:
  - `plural.workflow.stageInUse`: "This stage is in use by {{count}} records.
    It can't be removed, but you can rename it.";
  - `plural.workflow.actionInUse`: "…has run {{count}} times. Turn it off
    instead.";
  - `plural.workflow.transitionInUse`.

  They are used by the stage list's Remove, the action configurator's Remove,
  and the transition panel and editor's Remove. These screens store the
  RESOLVED sentence in their error signal (today a key).
- **The Q1 move note:** `workflow.editor.initialMoved`, "{{stage}} is no
  longer the starting stage." / «لم تعد {{stage}} مرحلة البداية.».
- **ACC-202 labels:**
  - `workflow.history.arrivedBy.RETURNED`: "Sent back" / «إعادة»;
  - `workflow.history.arrivedBy.EXITED`: "Ended" / «إنهاء».

  Through `workflow-labels.ts`, so `check:workflow-enum-display` covers them.

Arabic wording follows the 6 Nov rule (no gendered verb about a person; these
are about stages and records, and «المرحلة» is grammatically feminine).

---

## 4. Files

**Backend**
- `prisma/schema.prisma`: two enum values.
- `prisma/migrations/<ts>_acc202_stage_outcome_returned_exited/migration.sql`:
  new, generated by `prisma migrate dev` against `accreditme_wf` only.
- `src/foundation/workflow/workflow-start-end.ts`: new. Violations, the
  assertion, the move of Initial.
- `src/foundation/workflow/workflow-template.service.ts`: `addStage`,
  `updateStage`, `removeStage`, `removeTransition`, `removeTransitionAction`.
- `src/foundation/workflow/workflow-refusal.ts`: the seven codes, statuses and
  messages.
- `src/foundation/workflow/workflow-vote.ts`: `stageExitOutcome()` replaces
  `moveOutcome()`.
- `src/foundation/workflow/workflow.service.ts`: `performTransition` derives
  the outcome; the callers' arguments go; `triggerSystemTransition` loses
  `options.outcome`; `getStageHistory` adds `arrivedBy`.
- `src/foundation/workflow/interfaces/workflow-stage-history.interface.ts`:
  `arrivedBy`.
- `src/foundation/committees/change-requests/committee-change-request.service.ts`:
  the four `outcome:` arguments removed.

**Frontend**
- `foundation/workflow/workflow-refusal.ts`: codes, plain keys, the two readers.
- `foundation/workflow/components/stage-editor-panel/stage-editor-panel.component.ts`:
  three field refusals, the move note.
- `…/workflow-stage-list`, `…/workflow-action-configurator`,
  `…/transition-panel`, `…/workflow-transition-editor`: counted sentences.
- `foundation/workflow/services/workflow.service.ts`: `arrivedBy` on the DTO.
- `foundation/workflow/components/workflow-stage-indicator/…`: the chip.
- `foundation/workflow/workflow-labels.ts`: the arrivedBy labels.
- `assets/i18n/en.json`, `ar.json`: keys and plural objects.

**Docs (same PR)**
- **SYSTEM-REFERENCE.md:**
  - a new §2.20 (start and end, in-use deletes, outcomes);
  - §2.14 gains `arrivedBy`;
  - the ACC-284 "outcome stored" line is superseded;
  - §2.2's enum list.
- **CLAUDE.md:** a Key Architecture Decisions entry (ACC-57, ACC-191,
  ACC-202).

---

## 5. Specs: each with the mutation that must turn it red

| Spec | What it proves | Mutation that must turn it red |
|---|---|---|
| `workflow-start-end.spec.ts` (unit) | Each violation, none for an empty template, the "worse than before" comparison | Drop any one violation branch; compare `after` only, ignoring `before` |
| `workflow.seed.spec.ts` (added case) | Every seed template: exactly one initial stage, none both | Mark a second seed stage initial |
| `workflow-start-end.db-spec.ts` (real Postgres) | First stage not initial refused; untick the only initial refused; Initial + Final refused; remove initial while others exist → `STAGE_INITIAL_REQUIRED`; tick Initial on B moves it from A (one initial after, two audit rows); rename on a template put in breach by direct SQL passes, a worsening save is refused; protected template unchanged | Remove the assertion call from any one path; skip the Q1 clear; drop the template lock (see note) |
| `workflow-delete-in-use.db-spec.ts` (real Postgres) | Entered stage → 409 `STAGE_IN_USE`, `recordCount` = distinct records (a record that returned counts once), stage still there; unused stage deletes; action with logs → `TRANSITION_ACTION_IN_USE` with `runCount`; transition with a logged action → `TRANSITION_IN_USE`, nothing deleted; another organisation's id → the same 404 | Remove each check (the test meets Prisma's P2003, not a 409); count entry rows instead of records |
| `vote-on-advance.db-spec.ts` (updated) | RETURN on ALL → RETURNED; EXIT on ALL → EXITED; committee vote EXIT → EXITED; ADVANCE → APPROVED | Restore `moveOutcome()`'s REJECTED |
| `pool-member-moves.db-spec.ts` (added cases) | A person's RETURN and EXIT on ANY_ONE → RETURNED / EXITED. **The ticket's case.** | Pass `'APPROVED'` from `decidesAlone` again |
| `committee-change-request.db-spec.ts` (added cases) | submit / approve → APPROVED, return → RETURNED, reject / withdraw → EXITED | Put an `outcome` option back on any call |
| `workflow.service.spec.ts` | `cancelInstance` still SKIPPED; `getStageHistory` `arrivedBy` from the PREVIOUS visit, null on the first and for APPROVED | Read the visit's own outcome |
| Frontend `stage-editor-panel.component.spec.ts` (added) | Each start/end refusal under its box, naming the stage in both languages, focus moved; the move note | Map the codes to the plain key only |
| Frontend `workflow-refusal.spec.ts` / screens spec (added) | The counted sentences in both languages on the four Remove paths | Drop `inUseRefusal()` (falls back to the plain key) |
| Frontend `workflow-stage-indicator.component.spec.ts` (added) | Chip for RETURNED / EXITED, nothing for APPROVED or a missing field, both languages | Show the visit's own outcome |

**Note on the lock mutations (honest):** a race between two saves, or a delete
and an entry, is not deterministic in Jest. Each lock is checked by a db-spec
that holds the lock in one transaction and shows the second waits
(`committee-stage-writes.db-spec.ts`'s pattern). Where that cannot be made
reliable, the PR will say the lock was reviewed, not mutation-tested.

**Verification beyond specs:**
- the version-skew read (§1.3), with the `dev` client against a RETURNED row on
  `accreditme_wf`;
- the full backend and frontend gate on `accreditme_wf`;
- a live check of the panel's three refusals, Remove, and the history chip,
  locally.

---

## 6. Runbook

1. **The migration** runs in Railway's pre-deploy step with the deploy. Never
   before, never by hand on the shared database.
2. **No backfill** (decided): old RETURN rows stay APPROVED.
3. Nothing else to run after the deploy.

---

## 7. Questions, answered (Ahmad, 13 Nov, Prompt 24)

**Q1. Moving the starting stage: YES, it moves.** Ticking Initial on another
stage (add or update) moves the starting stage to it in the same save, under
the template lock. The old starting stage is cleared, and both stages are
audited.

**Q2. A template with no starting stage as the default: fix `setDefault()`
here,** through the same helper (`STAGE_INITIAL_REQUIRED`). "Creating a
template as default leaves two defaults" is OUT of this PR and gets its own
ticket.

**Q3. `removeTransition()`: YES.** A transition that has run is refused with
409 `TRANSITION_IN_USE`, counted inside the delete's transaction under the row
lock, like the others.

**Q4. `removeStage()`'s existing refusals: YES.** They get codes
(`STAGE_HAS_TRANSITIONS`, and the initial-stage one becomes
`STAGE_INITIAL_REQUIRED`), and the screens say them from the code in both
languages.

**Q5. What the counts count: the recommendation stands.** A stage counts
RECORDS (distinct records that entered it); an action or transition counts
RUNS (log rows).

**Q6. The P2003 safety net: the recommendation stands.** There is no blanket
mapping in this PR. If wanted, it is its own ticket (§1.2).

**Q7. YES.** Withdraw and reject record EXITED.

**Q8. Chip wording:**
- English: "Sent back" and "Ended".
- Arabic: nouns, never verbs: «إعادة» and «إنهاء».
- Checked before writing (ar.json, 13 Nov): no chip shows a stage outcome
  today. The nearest chips, the transition kinds, are nouns: «إعادة» (Send
  back) and «إنهاء السجل» (End the record). The words match them.
- One verb does exist nearby, but it is not an outcome chip: the stage
  indicator's "revisited ×N" line, «أُعيدت ×N». It is left as it is.

**P2003:** no blanket safety net in this PR.

**Rules for the build (Prompt 24):**
- The migration is applied to `accreditme_wf` on 55432 only. No RETURNED or
  EXITED row reaches the shared database before the deploy.
- The current `dev` backend is proved, locally, to read both new values (the
  rollback case).
- Every on-screen refusal goes through `plainWorkflowRefusalKey()`.
- Each new refusal and the outcome rule are mutation-checked.
