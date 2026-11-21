# ACC-245 — Added review stages in committee change requests (plan)

Status: **DECIDED (19 Nov), PR 1 BUILT**. §10 says who decided what; §11 says what PR 1 built.

Plan written on `feature/acc-245-plan` (dev `a398ea5`, PR #370, closed unmerged); it merges with PR 1 (`feature/acc-245-review-stages`).

## 1. Why the ticket's design needs reconciling

ACC-245 was designed on 18 Oct, before ACC-271 and ACC-283. Three of its assumptions no longer hold:

| ACC-245 (18 Oct) said | Since then |
|---|---|
| Approving in an added stage needs `committees:approve` AND a place in that stage's approver pool. | `committees:approve` is retired (ACC-283 PR 4). Who acts on a stage is its `who` pool (ACC-271; Ahmad's 28 Oct note on this ticket: "Build this on the stage pool"). |
| Under review is decided by holders of `committees:approve`. | Under review is decided by the **chain of authority** (`change-request-chain.ts`, ACC-283 PR 2): the Reports-to committee's deciding seats, else the owning unit's head and upwards. It is resolved live and never stored. |
| Each added stage has its own approvers "from its assignee strategy". | Assignee strategies are gone (ACC-278). A stage has `whoMode` + entries, read only through `StagePoolService`. |

What still holds from the ticket:
- **Approve moves one step forward.** Only Under review's Approve, by the chain of authority, applies the change (option B, §3.1): an added stage's Approve applies nothing.
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

## 10. Decided (19 Nov)

**Ahmad decided:** organisations may add review stages, and the order is **option B (Q7)**: Draft → [added stages, each decided by its own pool, never the requester] → Under review (the chain decides and applies) → Approved. The chain decides LAST and is the only thing that applies a change. (An earlier note placed added stages "between Under review and Approved"; that was a slip, corrected here.)

**Taken as recommended by lane B, not Ahmad's decisions; he can change any of them:**
- **Q1 (a) (lane B, as recommended):** Approve now skips added stages and applies at once.
- **Q2 (a) (lane B, as recommended):** a stage nobody can decide waits; the requester can withdraw, and an admin can fix the pool.
- **Q3 (a) (lane B, as recommended):** committee members may be reviewers; only the requester is excluded.
- **Q4 (a) (lane B, as recommended):** a pool may name the request's committee's seats and its owning unit's head.
- **Q5 (a) (lane B, as recommended):** Submit again after a Return goes to the first review stage.
- **Q6 (a) (lane B, as recommended):** no reordering; remove and add again, while unused.

## 11. As built (PR 1)

PR 1 holds the engine (§4) and the service rules its real-database specs needed (§5): an added stage's Approve, the pool decider, Submit by ADVANCE, Approve now. The awaiting-decision lists are left for PR 2. No migration.

- **The API.** `POST /workflow-templates/:id/stages` on the protected template takes names, description, SLA, escalation, `who`, and `reviewAfterStageId` (Draft's id or a review stage's; omitted: after the last). Anything else a stage carries is `ADD_STAGE`. At most 9 review stages (`REVIEW_STAGE_LIMIT`); a position that is not Draft or a review stage of this template is `REVIEW_STAGE_POSITION`. One place: `foundation/workflow/review-stages.ts`.
- **"Any one of them" only, in this version** (`REVIEW_STAGE_ANY_ONE`, on add and on a `who` edit). ALL and COMMITTEE_VOTE stay for a later PR: the request's Approve is a single app move, not a vote.
- **The template read** marks each added stage `reviewStage: true`, with `editableFields` (the protected set plus `who`).
- **The record comes first (ACC-282).** A pool member who cannot open the committee (`committees:view`, an active seat, or oversight as a head or cover in force: the committee read rule) gets the 404 a missing request gets, before anything moves. **So such a member cannot decide:** a stage whose pool has nobody who can open the committee waits, exactly like Q2's empty pool, and the requester can withdraw.
- **Notices name the committee only to readers.** The "to review" notice goes only to the pool members who may open the committee: `committeeReadersAmong()`, one batch, with the committee read rule's three clauses in its order (the role query, the seat query, then the overseers). **One copy of each piece:** the seat predicate is `activeSeatWhere()`, shared with `activeSeatOf()` and `memberCommitteeIds()`; oversight is `committeeOverseersAmong()`, which the single check (`overseesCommittee()`, behind `mayReadCommittee()`) reads too, built on `findUnitAncestorIds()` (the active-unit rule in SQL) and `findUnitLeadersAmong()` in `unit-headship.ts`. A parity db-spec (`committee-readers.db-spec.ts`) holds the batch equal to the single check, person by person. Cost: the single check for a non-member who leads nothing is now 5 queries (it was 3); an overseer's is 5, as before.
- **A decision is made in the stage ENTRY it was admitted for.** Approve, Return and Reject re-read the request's open stage entry (`WorkflowInstanceStage`) under the instance lock and refuse with `CHANGE_REQUEST_CHANGED` if it is not the one the decider was admitted on. Without it, a second member of R1's pool could move the request out of R2; and comparing the template stage instead would let a decider admitted before a Return and a new Submit decide the revised request on its next visit to R1 without having read it.
- **The CREATOR kind is refused on an added stage** (`REVIEW_STAGE_NO_CREATOR`): the requester is taken out of every pool, so it would name nobody.
- **Lock order.** Add: the template, then the open records standing in the re-pointed stages, then the moves. Remove: the template, then those records, then the stage row, then `STAGE_IN_USE` again (a request that was entering the stage is counted, never met by the RESTRICT key). Locking the stage row before the records deadlocks with a request entering it, which holds its instance lock and key-share-locks the stage row; a spec proved it. The engine takes the instance lock and never the template's, so neither path holds something the engine needs while waiting on something the engine holds.
- **`applyMove` re-reads the move's target under the instance lock**, so a move prepared before a re-point is refused (`TRANSITION_NOT_AVAILABLE`).
- **The record routes:** `COMMITTEE_CHANGE_REQUEST` names the request's committee and that committee's owning unit (Q4).
- **The awaiting-decision gap: CLOSED by PR 2** (below). **PR 3:** the screens, and the app-move texts for re-pointed moves.

## 12. As built (PR 2)

A request in an added review stage reaches its reviewers. No migration, nothing on the per-request path.

- **`GET /committee-change-requests/awaiting-decision`** reads EACH ARM WITH ITS OWN CAPPED QUERY (`awaiting-decision-candidates.ts`), merges them oldest submitted first and caps again at 200, so rows one arm cannot keep never use up the other's cap.
  - **The chain arm** (`chainCandidates`): requests Under review, a page at a time (keyset on submittedAt, id), each page's chains resolved in one batch and kept where the viewer decides, until 200 are kept or 5 pages are read (P203: older requests the viewer does not decide never hide theirs). Only for someone the gate says may be in a chain.
  - **The review arm** (`reviewCandidates`): FIRST, without reading a request, where the viewer can be in a pool at all: the organisation's added stages and their entries (one query); each stage's pool resolved WITHOUT a record through `StagePoolService` (the record-independent entries, out-of-office routed; batched, one query per kind present, at most 9 stages); and, only when a stage names the request's committee or the request's unit's head, whom the viewer covers while they are away (one query), then the committees those people sit on and the units they lead (`findUnitsLedBy()`, two reads together). Nothing: `[]` there. Otherwise the requests standing where the viewer may be in a pool, filtered by that scope IN SQL, a page of 200 at a time (at most 5 pages), each page checked exactly: the pool (one batched read) and `readableCommitteeIds()`. A review row is kept only where the viewer IS in its pool AND may open the committee. The requester is never in a pool.
- **The gate is still ONE query** (`awaitingDecisionGate()`, which `mayDecideAnyChangeRequest()` now reads): its three chain arms, plus whether any submitted request's NEWEST instance stands in an added review stage. Neither: `[]` after that one query, as before.
- **Paging, both arms (`pageCandidates`):** `AWAITING_PAGE_SIZE` (200) a page, `AWAITING_PAGES` (5) at most, a warning when the page limit is reached, and another when the merged list is cut to the 200 cap. The page size is the service's `awaitingPageSize` field, so a spec can page through a few rows.
- **Query counts, pinned by `committee-change-request.db-spec.ts` ("PR 2 cost" and P203):** a non-decider in an organisation with no request in an added stage, 1; a non-reviewer and non-decider while one does, 4 (the gate, the stages, their entries, the pool's users), and no request is read; a reviewer with one request, 16; a chain decider with one request, 14 (the review arm never runs); a chain decider whose request is on the second page, 21 (the gate, two pages of 7, the response).
- **Every organisation predicate in the two candidate queries is load-bearing:** two gate-named db-specs hold them against deliberately corrupt cross-organisation rows (an instance filed under the other organisation, a stage of the other's template, the other's request with our instance, our request on the other's committee), and dropping any one turns them red.
- **Home's work counts** read the same API (`MyWorkCountsService`), so they follow. `GET /workflows/awaiting-me` never lists a review stage (its moves are the app's, so it is no decision point), so nothing is counted twice.
- **`awaitingDecisionBy`** gains `{ kind: 'REVIEW_STAGE', stage: { id, nameEn, nameAr } }`: in the list, on a request's read, and in a `CHANGE_REQUEST_NOT_DECIDER` refusal. The screens do not read it yet (PR 3).
- **A cover gives reach only while its person is ACTIVE** (a separate commit): `findUnitsCoveredBy()` and `findUnitLeadersAmong()` now require it, as a head holder always did, and so does the gate's cover arm, which a db-spec holds equal to `findUnitsCoveredBy()` person by person. `findRunningActingCoversForUnits()`, which SHOWS a unit's cover in force, is unchanged.

## 13. As built (PR 3a, the reads the screens need)

Decided for PR 3 (19 Nov): two PRs, 3a (backend) then 3b (screens). The awaiting line names the stage only, never a person. The who section reads `reviewStages.who`.

- **`reviewStages` on the template read (G1)**, on the protected change request template only (absent elsewhere): `{ canAdd, max, count, after: [{ id, nameEn, nameAr }], who: { modes, assigneeKinds } }`. `canAdd` is `reviewStageFits()`, the same function `addReviewStageInTx()` refuses `REVIEW_STAGE_LIMIT` by; `who` comes from `REVIEW_STAGE_WHO_MODES` and `REVIEW_STAGE_REFUSED_KINDS`, the same constants the save refuses `REVIEW_STAGE_ANY_ONE` and `REVIEW_STAGE_NO_CREATOR` by. `after` is Draft, then each review stage, in order.
- **App-move lines for every review-stage move (G2)**, in both languages: the template read gives an added review stage the move key `REVIEW_STAGE_MOVE_KEY` (through `isReviewStage()`, on the protected template only), and `APP_MOVES` has an entry for each of the seven moves `review-stages.ts` creates or re-points.
- **Setup health (G3): already right.** An added stage whose pool is empty is flagged on entry (`checkAndFlagUnassignedStage()`) and listed by `STAGE_WITHOUT_ASSIGNEE`; a db-spec now holds it. No change. (A pool whose only member is the requester, or only people who cannot open the committee, was not covered here; ACC-325 covers it: see SYSTEM-REFERENCE §3.18.1.)
- **G4: not needed.** The request page already reads the instance's stages.
- **Rewording**, both languages: `ADD_STAGE` ("Only review stages can be added…, after a request is drafted and before it is decided": no stage named, since a tenant may rename them) and `CHANGE_REQUEST_NOT_UNDER_REVIEW` ("…waiting for a decision…").
- **The read and the save share one shape check** (`shapeOf()` in `review-stages.ts`): all five seeded keyed stages, so `canAdd` is never true where the save refuses `ADD_STAGE` (P209).

## 14. As built (PR 3b, the screens)

Built from the accepted drawings (Workflow Setup §3 and §13, Committee Changes §5; design review 21 Nov) and the copy in the design notes (19 Nov, §1.6 for the refusals, P265). No backend change, no migration.

**The stages page (Committee change request).**
- **"Add review stage"** sits in the page header, where Add Stage sits on other workflows, while the server's `reviewStages.canAdd` holds. At the maximum (`count ≥ max`) one muted line takes its place, counted from the server's `max`. Add Stage never shows here (`isProtected`).
- **The panel's review mode** (the stage editor panel, a page panel, uncapped: Q14):
  - **Adding:** Name (English) required; Name (Arabic), Description and the deadline marked "· optional"; **Goes after**, required, with the server's `reviewStages.after` (Draft, then each review stage, in order), starting on the last.
  - **An existing review stage:** what may change is its own `editableFields`. Goes after is read only (the stage before it in `after`), with "To move it, remove it and add it again…".
  - **Never shown on a review stage:** Initial and Final, What can be done here, What this stage means, and the protected banner.
  - **Who:** `am-stage-who` with the template's kinds and modes narrowed to `reviewStages.who` (so never "Who started the record", never a vote). The mode choice is replaced by two read-only lines: "Any one of them decides. Nobody decides on their own request." and "Only people who can open the committee can decide." (`am-stage-who`'s new opt-in `decides` input).
  - **The add sends** names, description, deadline, `who` and `reviewAfterStageId` (`order` too, which the DTO requires and the server ignores), and nothing else.
  - **Remove stage** is in the footer, apart, in red. Its confirm reads "Requests will go from {prev} straight to {next}": `prev` is the stage before it in `after`, `next` the target of its own ADVANCE move. A refusal (`STAGE_IN_USE`, counted) stands in the panel above the footer, keeping what was typed.
  - **Refusals from their codes:** `REVIEW_STAGE_LIMIT` with the server's `max`; `REVIEW_STAGE_POSITION`, `REVIEW_STAGE_NO_CREATOR`, `REVIEW_STAGE_ANY_ONE`, `ADD_STAGE`, `STAGE_FIELD` and `WORKFLOW_TEMPLATE_PROTECTED` through the existing map, with the notes' texts.
- **The list:** an added stage carries the "Review stage" chip and, under its name, who works it in the server's `whoSentence`.
- **The strip:** an added stage carries the chip. A move the app makes (`mover` APP) is drawn in the "Done by the app" style, and the legend names it when the strip has one. Three review stages scroll sideways in the strip's own frame, as before.
- **Found while measuring:** the panel's Description box (`rows="2"`) scrolled inside the panel once its text passed two lines. It now grows with its text (`autoResize`), for every stage.

**The request (Committee Changes §5).** A request in an added review stage has `status` null. The server names the stage for every reader in `awaitingDecisionBy` (`REVIEW_STAGE`), and that name is its status everywhere (`reviewStageOf()`, `ChangeRequestText.stageOf()` / `toneOf()`):
- **The page's chip:** the stage's name, in Under review's tone. The "Open" fallback no longer shows for a review stage.
- **The requester's line:** "Waiting for {stage} since {date}. You can withdraw it until it's decided."
  - `{date}` is the open visit's entry, from the stage history the indicator already reads (its new `historyLoaded` output), never a third request.
  - Under review keeps its own line.
- **A reviewer's buttons** are the server's `actions`, as before. The drift marker covers a review stage too.
- **The committee's banner:** "Change request {n} is in {stage}: {fields}", with the body `bodyUnderReview` (Q8). It names the requester, never a reviewer.
- **The Change requests panel:** Status is the stage's name; who and when reads "submitted".
- **Home:** every change request row reads "From {name} · {stage}" (`home.awaitingChangeMetaStage`). Under review shows by its status word.
- **The Approve confirm's review variant (P266):** "Approve and send it on to {next}?" with "Nothing is applied yet. The changes apply only when {decision} approves them.", the same change list, no task line, the Approve button.
  - **The server names both** (an additive backend change in this PR): `awaitingDecisionBy.REVIEW_STAGE` gains `next` (the target of the stage's single app ADVANCE, found as `triggerSystemAdvance()` finds it, never the next by order) and `decision` (the template's deciding stage, by `AWAITING_DECISION_KEYS`). Either is null when the template does not say.
  - **Read in `nameSteps()`'s existing wave:** its stage read widened to the template's stages (at most 6 + 9), and one transition read added beside it. Never a query per request.
  - **Query counts:** the awaiting list for a reviewer with one request, 16 before and 17 after; one request read (`getOne`) in a review stage by a chain decider, 14 before and 15 after. Unchanged when no request stands in a review stage. Both pinned in `committee-change-request.db-spec.ts`.
  - **In the last review stage** `next` and `decision` are both Under review: "Approve and send it on to Under review? Nothing is applied yet. The changes apply only when Under review approves them." In Arabic: «اعتماد الطلب وإرساله إلى «قيد المراجعة»؟» and «لم يُطبَّق شيء بعد. ولا تُطبَّق التغييرات إلا عند اعتمادها في «قيد المراجعة».»
  - **An API from before PR 3b** sends neither field (Vercel and Railway deploy apart): the confirm keeps the plain Approve wording (`reviewStepsOf()` returns null unless both are present).

**Measured** (the real theme, font and translations; `stage-editor-panel.review.layout.spec.ts`), with three review stages on the strip:

| | 1280 EN | 1280 AR | 390 EN | 390 AR |
|---|---|---|---|---|
| Panel, adding (page panel, uncapped) | 662 | 678 | 1170 | 1191 |
| Panel, editing (page panel, uncapped) | 700 | 737 | 1276 | 1274 |
| Remove stage confirm, body (cap 420) | 41 (room 379) | 44 (room 376) | 41 (room 379) | 44 (room 376) |
| Approve in a review stage, six changes, body (cap 420; `change-request-dialogs.layout.spec.ts`) | 267 (room 153) | 292 (room 128) | 277 (room 143) | 304 (room 116) |

Nothing inside the panel scrolls at either width, nothing passes the page's edge, and only the strip scrolls sideways, in its own frame.

**Specs and mutations.** `change-request-review-stage.spec.ts`, `stage-editor-panel.review.spec.ts`, `workflow-stage-list.review.spec.ts`, the layout spec above, and two new cases in `awaiting-rows.spec.ts`. Each of these mutations turned a named test red:
- **The change request screens:**
  - reviewStageOf ignoring the kind;
  - stageOf / toneOf reading the key;
  - the banner, panel and Home falling back;
  - the waiting date taken from a closed visit;
  - the drift marker limited to Under review.
- **The stages page:**
  - the add button ignoring `canAdd`;
  - the limit line shown below the maximum;
  - the list and strip chips;
  - the strip's app style;
  - the who template not narrowed;
  - the two lines missing;
  - Goes after starting on the first entry, or not required;
  - an add or save sending start and end;
  - Remove's next read from the RETURN move;
  - a removal refusal titled as a failed save;
  - the limit said without the server's max.
- **The layout:** without `autoResize` the layout spec goes red on the scrolling textarea.
- **The Approve confirm (P266):**
  - `next` always the deciding stage (backend): the two-review-stage database spec goes red;
  - `reviewStepsOf()` accepting a missing field: the older-API spec goes red;
  - `approve()` ignoring the steps: both review-wording specs go red.
