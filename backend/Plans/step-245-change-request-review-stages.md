# ACC-245 — Added review stages in committee change requests (plan)

Status: **PLAN ONLY**. No code until Ahmad answers §9.

Branch: `feature/acc-245-plan`, from dev `a398ea5`.

## 1. Why the ticket's design needs reconciling

ACC-245 was designed on 18 Oct, before ACC-271 and ACC-283. Three of its assumptions no longer hold:

| ACC-245 (18 Oct) said | Since then |
|---|---|
| Approving in an added stage needs `committees:approve` AND a place in that stage's approver pool. | `committees:approve` is retired (ACC-283 PR 4). Who acts on a stage is its `who` pool (ACC-271; Ahmad's 28 Oct note on this ticket: "Build this on the stage pool"). |
| Under review is decided by holders of `committees:approve`. | Under review is decided by the **chain of authority** (`change-request-chain.ts`, ACC-283 PR 2): the Reports-to committee's deciding seats, else the owning unit's head and upwards. It is resolved live and never stored. |
| Each added stage has its own approvers "from its assignee strategy". | Assignee strategies are gone (ACC-278). A stage has `whoMode` + entries, read only through `StagePoolService`. |

What still holds from the ticket:
- **Approve moves one step forward.** Only the last review stage applies the change.
- **Adding a stage creates its system-fired moves and re-points the previous Approve.** Removing it reverses that.
- **A stage a request has used can't be removed** (`STAGE_IN_USE`).
- **An added stage has no key.**
- **Return, Reject and Withdraw work from any review stage.**
- **Nobody decides their own request.**

## 2. What is built today (dev `a398ea5`)

### The template
- `COMMITTEE_CHANGE_REQUEST` is in `PROTECTED_TEMPLATES` (`workflow-stage-keys.ts`).
- **Refused:** add stage, remove stage, any transition edit, stage tasks, and any stage field outside `PROTECTED_STAGE_EDITABLE` (`nameEn`, `nameAr`, `description`, `slaWorkingHours`, `escalationConfig`). `who` is refused too.
- **Six keyed stages:** draft → under_review → approved, with returned, rejected and withdrawn. All `whoMode` ANY_ONE with a CREATOR entry; the pool is not what decides today.
- **Eight APP moves**, all fired by the service through `WorkflowService.triggerSystemTransition(instanceId, toStageKey, …)`. The engine finds the move **by its target stage's KEY** (`prepareSystemTransition`).

### The service
- **`REQUEST_STAGE_POLICY`** (`change-request-policy.ts`) is keyed by stage key.
  - An unkeyed stage gets `UNKEYED_REQUEST_STAGE`: open, withdraw only.
  - `AWAITING_DECISION_KEYS` = `['under_review']`, used in the awaiting-decision SQL filter (ACC-281).
- **Approve** targets the one stage flagged `APPLIES_APPROVED_CHANGE` and applies the change inside the engine's transaction. Lock order: request instance, committee instance, hierarchy, committee row, request row.
- **Decider:** `loadDecision()`, from the chain, only while `awaitsDecision(key)`.
- **Approve now** (ACC-283 Q4): the root head on their own request.

### The requester's task
- "Finish or withdraw" is created on create and on Return, completed on Submit, and cancelled on Withdraw (`finishTaskId`).

### Deactivation (ACC-283 PR 2b)
- `ChangeRequestDepartureService` withdraws the leaver's requests in draft and returned only (`DEPARTURE_WITHDRAWS_FROM`).
- A request awaiting a decision is left to its deciders. An unkeyed stage is skipped, because it "cannot be told apart from one under review".

### Data (shared database, read-only, 19 Nov; counts and slugs only)

| | al-manara | al-nakheel |
|---|---|---|
| Change request templates | 1 | 1 |
| Stages / unkeyed | 6 / 0 | 6 / 0 |
| Moves | 8 | 8 |
| Requests, by current stage | none | **2, both `withdrawn`** |

**No open request exists, so no request has to be moved when a stage is added.** Every change request stage is `ANY_ONE` in both organisations.

## 3. How an added review stage fits the chain

The question: who approves in an added stage, and where the chain's decider sits.

### 3.1 Where the chain's decider sits

**Option A — the chain decides FIRST (Under review stays first; added stages follow).**
- Submit → Under review (chain) → added stage 1 (pool) → … → Approved.
- The ticket's literal order.
- **Against:** the chain's Approve no longer applies anything. The last pool member's Approve does, so the change is applied on the say-so of someone outside the chain of authority. That reverses ACC-283's rule that the chain decides a change request.

**Option B — the chain decides LAST (added stages come before Under review). RECOMMENDED.**
- Submit → added stage 1 (pool) → … → Under review (chain) → Approved.
- Under review keeps its key, its meaning ("the decision") and its decider. Only the chain applies a change, as today.
- Added stages are **reviews before the decision**: Legal, Quality and so on.
- With no added stage it is exactly today's flow.
- **Cost:** Submit no longer always goes to `under_review`. It goes to the first review stage. The editor draws added stages between Draft and Under review, not after it.

**Option C — both, in every added stage** (pool AND chain).
- Over-constrained: the chain is often one person, who would approve the same request several times.

**Recommendation: B.** It keeps ACC-283's invariant (the chain alone applies a change) and adds review, not authority.

### 3.2 Who approves in an added stage

**Option P1 — the stage's own `who` pool, the requester excluded. RECOMMENDED.**
- Ahmad's 28 Oct note. `StagePoolService` resolves it in batches, ACTIVE only (ACC-271).
- The stage's `whoMode` decides the vote:
  - ANY_ONE: one press decides.
  - ALL: every member.
  - COMMITTEE_VOTE: quorum and majority (ACC-284).
- The requester is removed from the pool for their own request. "Nobody decides their own" is the change request's rule, kept from ACC-283.

**Option P2 — the pool, also excluding the committee's own members** (the chain's below-root rule).
- Stricter, but a tenant that picks "the committee's secretary reviews first" would be refused by its own setting.

**Option P3 — the chain for every stage.**
- That is not a review stage.

**Recommendation: P1.** P2 is offered as a question (§9 Q3).

### 3.3 Who a pool can name

- `RECORD_ROUTES` has no `COMMITTEE_CHANGE_REQUEST` entry. An added stage could therefore name only fixed people, positions in fixed units, and fixed committee seats.
- A review stage nearly always wants **the request's committee's seats** (its secretary) or **its owning unit's head**.
- **Recommended:** add the registry entry, with the request's `committeeId` and the committee's `orgUnitId`. It is one line per route, and it fails closed for anything else (ACC-190).
- See §9 Q4.

## 4. Engine changes (backend PR 1)

### 4.1 A system move that does not need a key

`prepareSystemTransition(instanceId, toStageKey)` finds the APP move by target **key**, and an added stage has none.

**Approve's move, recommended:** a new `prepareSystemAdvance(instanceId, …)`. It takes the current stage's **single APP move of kind ADVANCE**.
- Every review stage has exactly one by construction (§4.2).
- None, or more than one, is 409 `TRANSITION_NOT_AVAILABLE`, with the ids logged.

**The other moves:** Return, Reject and Withdraw still target keyed stages (`returned`, `rejected`, `withdrawn`), so they keep the key lookup unchanged.

**Submit:** draft → first review stage, and returned → first review stage. These are also "the single APP ADVANCE out of draft/returned", so Submit uses `prepareSystemAdvance` too. `ACTION_TARGET_STAGE.submit` goes.

**Alternative:** give each added stage a generated key (`review_<id>`). This is rejected: the ticket and ACC-233 make a key a fixed meaning, never per-tenant data.

### 4.2 Adding a review stage on the protected template

`POST /workflow-templates/:id/stages` stops refusing `ADD_STAGE` for `COMMITTEE_CHANGE_REQUEST`, but only for a **review stage**.

**What the request must carry:**
- `who` (required, as for every stage);
- names, description and SLA;
- `afterStageId`: the review stage it follows, or `draft` for "first".

**What the request may not set:** actions, flags, `isInitial`, `isFinal` and `order`. The server sets them: non-initial, non-final, no flags, and the order between its neighbours.

**What it does, in ONE transaction:**
1. **Lock the template** (`lockTemplate`, as every stage save does).
2. **Lock every OPEN instance currently in the stage whose ADVANCE is re-pointed** (FOR UPDATE, sorted by id). With "first", that is draft and returned.
   - Lock order is **template, then instances**. The engine takes the instance only, never the template, so there is no cycle.
   - Today this set is empty (§2), but a later re-point may meet open requests.
3. **Create the stage**, ordered between its neighbours.
4. **Create its four APP moves**, each with `LOG_AUDIT`, as the seed does:
   - ADVANCE → the next review stage (or Under review);
   - RETURN → `returned`;
   - EXIT → `rejected`;
   - EXIT → `withdrawn`.
5. **Re-point the previous stage's ADVANCE** to the new stage. For "first", that is the draft → … and returned → … Submit moves.
6. **One audit row** names the stage and every move created or re-pointed.

**`applyMove` gains one re-check.** Under the instance lock, an APP move's `toStageId` is re-read. If a concurrent re-point changed it, the move is refused (409 `TRANSITION_NOT_AVAILABLE`, "reload"), never sent to a stale stage.

**What stays refused on the protected template:**
- Hand edits of any move: `TRANSITION`, unchanged.
- A non-review stage, and keyed stages' fields: unchanged.
- Stage tasks: `STAGE_TASKS`, unchanged.

### 4.3 Removing an added stage

`DELETE /workflow-stages/:id` stops refusing `REMOVE_STAGE` for an **unkeyed** stage of the protected template. A keyed stage is still refused.

In one transaction:
1. **Lock the template, then the stage row** (today's order).
2. **Refuse if any record ever entered it:** `STAGE_IN_USE`, `recordsThatEntered`. `WorkflowInstanceStage.stageId` is RESTRICT, so this also covers a request sitting in it.
3. **Lock the open instances** in the stage whose ADVANCE is re-pointed.
4. **Re-point the previous stage's ADVANCE past it**, and delete its four moves. `STAGE_HAS_TRANSITIONS` does not apply here: these moves are the system's, not the tenant's.
5. **One audit row.**

### 4.4 Editing an added stage

`PROTECTED_STAGE_EDITABLE` is extended **for an unkeyed stage only**:
- `who` is editable, which is the point of the stage.
- `order` is not editable. To move a stage, remove it and add it again. §9 Q6.

`editableStageFields` on the template read says so per stage. The screen reads it and keeps no copy.

## 5. The change request service (backend PR 2)

**Stage policy.**
- An **unkeyed stage of this template is a review stage**: open, and allows approve, return, reject and withdraw.
- `UNKEYED_REQUEST_STAGE` becomes that policy. On this protected template an unkeyed stage can only have been added through §4.2.
- **`awaitsDecision`** is true for it. The awaiting SQL filter becomes `key = ANY(AWAITING_DECISION_KEYS) OR key IS NULL`, still derived from the policy.

**Who decides.** `loadDecision()` branches on the stage:
- **Under review:** the chain, unchanged.
- **An added stage:** its pool, through `StagePoolService` in batches (ACC-271 rule), minus the requester.
- Both give the same refusal codes:
  - `CHANGE_REQUEST_OWN_DECISION` for the requester;
  - `CHANGE_REQUEST_NOT_DECIDER` with `awaitingDecisionBy` for a reader who isn't a decider. For an added stage it is the stage's name, not a chain step.
  - The 404 for anyone who can't read the request.

**Approve.**
- **In an added stage:** `prepareSystemAdvance` moves the request on, with no apply, no drift check and no "Revise the terms of reference" task. A vote stage (ALL or COMMITTEE_VOTE) records the vote and moves only on its threshold (ACC-284).
- **In Under review:** exactly today's apply.

**Return, Reject, Withdraw from an added stage.** These are today's moves, keyed targets, and today's side effects:
- **Return** writes `returnNote` and creates a new "Finish or withdraw" task. Submit again goes to the **first** review stage, so the review starts over (§9 Q5).
- **Reject** is final.
- **Withdraw** cancels the finish task if one exists. There is none while in review, as today.

**Deactivation (ACC-283 PR 2b) is unchanged.**
- `DEPARTURE_WITHDRAWS_FROM` stays draft and returned. A request in an added stage, like one under review, is left to its deciders.
- The skip of unkeyed stages is now explicit: an unkeyed stage is a review stage, so it awaits a decision.
- **A pool member's deactivation** leaves the stage to the rest of its pool. ACC-271 records `POOL_MEMBER_LEFT`, and ALL stops waiting for them.
- **An emptied pool** stalls the request. It is visible on Setup health (`STAGE_WITHOUT_ASSIGNEE`, the existing condition for an instance stage nobody can act on) and in the request's "awaiting" line, and the requester can still withdraw. §9 Q2.

**Approve now (root head, own request).** Recommended: it **skips** added review stages and applies at once, as today. It is the root head's own final decision (ACC-283 Q4). §9 Q1.

**Notices.**
- On entering an added stage, its pool is told: the same in-app notice the chain's deciders get on Submit.
- On leaving it, nobody new is told.
- Reviewers' tasks: none. The protected template has no stage tasks, which is unchanged.

**`actions` flags and `awaitingDecisionBy`** are computed in the same batch, with one pool resolution per page, never per row (ACC-271 performance rule).

## 6. What the screens show (frontend, PR 3)

### The stages page (`/workflows`, Committee Change Request)
- **The flow strip** draws Draft → [added stages] → Under review → Approved, with Returned, Rejected and Withdrawn off the review path.
- **"Add review stage"**, between Draft and Under review (option B), on the protected template only:
  - names, description, deadline, and the who section (`am-stage-who`, the server's `assigneeKinds`);
  - "after" picks among the review stages.
  - Dialog or page panel: measured against the 420 px cap, stepped only if it overflows (ACC-120).
- **An added stage's panel:** names, SLA and who editable; Remove; no actions or flags.
  - A refusal is said from its code: `STAGE_IN_USE` gives the record count and "rename it instead" (existing wording).
- **Keyed stages** stay read-only except names and SLA, as today.

### The request page and the committee's Change requests panel
- **A stage timeline** in order, with added stages by name and "now" on the current one.
- **The awaiting line:**
  - in Under review: the chain's step, as today;
  - in an added stage: "Awaiting {stage}: {names}" for a viewer who may see names (ACC-228 rule), else the stage name alone.
- **Buttons**, from the server's `actions` only:
  - "Approve" in an added stage (moves on);
  - "Approve and apply" in Under review (today's label);
  - Return and Reject in every review stage.
- **Status words:** an added stage shows its own name. The `committee.changeRequest.status.unknown` fallback goes, because a review stage is now known.

## 7. PR split

| PR | Scope | Migration |
|---|---|---|
| **1 — engine** (backend) | `prepareSystemAdvance`; add, remove and edit a review stage on the protected template (§4.2–4.4), with the template-then-instance locks; `applyMove`'s re-check; the `COMMITTEE_CHANGE_REQUEST` record routes (if Q4 is yes); `editableStageFields` per stage. | **None.** An added stage is an ordinary unkeyed stage with ordinary moves. |
| **2 — the request** (backend) | Policy for unkeyed review stages; the pool decider beside the chain; Approve forward without apply; Submit by ADVANCE; awaiting-decision SQL; notices; `actions` and `awaitingDecisionBy`; Approve now per Q1. | None |
| **3 — screens** (frontend) | The stages page (add, remove, the who of an added stage, the strip) and the request page (timeline, awaiting line, button labels). | None |

PR 1 deploys before PR 2 reads its shape. The engine change is behaviour-neutral until a stage is added, because no organisation has one.

## 8. Test plan

### Real-database specs (`npm run test:db`), PR 1
- **Add a review stage:**
  - its four moves are created;
  - the previous ADVANCE (or both Submit moves, for "first") is re-pointed;
  - the audit row names them;
  - adding a second stage after the first chains them correctly.
- **Remove:**
  - a stage nobody entered goes, and the ADVANCE is re-pointed past it;
  - a stage a request entered is `STAGE_IN_USE`, with nothing changed;
  - a keyed stage is still `REMOVE_STAGE`.
- **Refusals stay:** a hand edit of a system move (`TRANSITION`); an added stage's actions, flags or order (`STAGE_FIELD`); stage tasks (`STAGE_TASKS`).
- **Concurrency:** an Approve prepared before a re-point, applied after it, is refused, never sent to the old target. Template edits and moves take their locks in order (two connections).
- **Isolation (gate-named):** another organisation's template, stage and instance are untouched and not found.

### Real-database specs, PR 2
- **Through two added stages and Under review:** each Approve moves one step. Only Under review applies, makes the "Revise" task and runs the drift check.
- **The pool rule:**
  - a pool member decides; a non-member reader gets `NOT_DECIDER` naming the stage; an outsider gets the 404;
  - the requester in the pool gets `OWN_DECISION`;
  - an ALL stage waits for everyone;
  - a deactivated member stops being waited for.
- **Return, Reject and Withdraw from an added stage:**
  - Return creates the finish task;
  - Submit again goes to the first review stage;
  - Reject is final;
  - Withdraw needs no task.
- **Deactivation:** the leaver's request in an added stage is NOT withdrawn; one in draft is (unchanged).
- **Awaiting-decision lists** include requests in added stages for their pool members only. The batched pool resolution is pinned (query count).
- **Approve now** per Q1.

### Mutations, one per rule
- the ADVANCE not re-pointed;
- the re-check removed;
- the requester left in the pool;
- the apply run in an added stage;
- unkeyed treated as withdraw-only;
- `STAGE_IN_USE` skipped.

### Frontend
- Specs for the strip, the add/remove panel and its refusals, and the request page's awaiting line and buttons.
- Layout specs at 1280 and 390, in both languages, for the added-stage panel and the timeline.

## 9. Questions only Ahmad can answer

**Q1. Approve now (the root head's own request) when review stages exist**
- (a) Skip them and apply at once, as today.
- (b) Go through them first.
- **Recommend (a):** it is the root head's own final decision, and ACC-283 Q4 made it immediate.

**Q2. An added stage whose pool is empty (nobody left)**
- (a) The request waits. It shows on Setup health (`STAGE_WITHOUT_ASSIGNEE`); the requester can withdraw, and an admin can fix the pool.
- (b) The stage is skipped automatically.
- (c) The chain decides it instead.
- **Recommend (a):** the engine fails closed everywhere else, and silently skipping a review defeats it.

**Q3. May a member of the request's committee review it in an added stage?**
- (a) Yes: the pool is what the tenant set; only the requester is excluded.
- (b) No: the chain's below-root rule applies here too.
- **Recommend (a).**

**Q4. May an added stage name "the request's committee's seats" and "its owning unit's head"?**
- This is a `COMMITTEE_CHANGE_REQUEST` record route.
- (a) Yes.
- (b) Fixed people, positions and committees only.
- **Recommend (a):** otherwise a tenant must set up one stage per committee.

**Q5. Submit again after a Return from an added stage goes to**
- (a) the first review stage, so the review starts over;
- (b) the stage that returned it.
- **Recommend (a):** one Submit move, no remembered position, and every reviewer sees the revised request.

**Q6. Reordering added stages**
- (a) Not in v1: remove and re-add (only while unused).
- (b) Drag to reorder, re-pointing moves.
- **Recommend (a).**

**Q7. The order itself: option B in §3.1 (reviews before the chain's decision), or the ticket's literal A (after it)**
- **Recommend B:** only the chain applies a change.
