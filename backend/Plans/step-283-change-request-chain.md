# ACC-283 — the chain of authority decides committee change requests

Plan only, 16 Nov 2026, branch `feature/ACC-283-change-request-chain` from dev
`c9f51f5`. No code yet. Ahmad's decisions are in the ticket's description
(7 and 10 Nov); the ticket has no comments.

Read for this plan: ACC-283; CLAUDE.md's ACC-239, ACC-281, ACC-282, ACC-286
and ACC-288 entries; SYSTEM-REFERENCE §2.19 (and §2.19.1), §3.18, §3.21
(and §3.21.4), §5.15.2 and §5.15.6; the change request service, policy and
refusal files; `unit-headship.ts`; `committee-seat-rules.ts`; the committee
workflow seed.

---

## 0. Scope

ACC-283 has two halves: **seats decide what a member may do** (section 1 of
the ticket) and **the chain of authority decides changes** (section 2). This
plan is about the chain. The chain's first step needs one seat action, "decide
changes of committees that report to us", so the plan also covers **storing
seat actions** (all of them, because they are one table and one set of
defaults). Enforcing the other four seat actions (replacing ACC-281's interim
write rule) is the last PR here; Q1 asks whether it should be a ticket of its
own.

**Decided by Ahmad, and not reopened here:**

- The chain is for change requests only. Terms Review is a normal stage
  assignment, set on the stage panel.
- The chain ends at the root unit's head (head or acting head). The
  Organization Administrator never decides.
- Either the seat or the role grants an action; the seat never takes away.
- The root head's own request is approved at once, after a Reports-to
  committee's deciding seat where one exists. *(Refined 16 Nov, Q4: the root
  head chooses Send for decision or Approve now, §4.3.)*
- Requests already open when this ships are re-routed to the chain.
- `committees:approve` is retired, the ACC-244 way.
- Meeting seat actions are the Meetings ticket's.
- Seat defaults are edited by `lookups:manage` holders on the seat lookup;
  changing a default never reaches existing committees.

---

## 1. What the chain replaces

`committees:approve` is read in five places, all in
`committee-change-request.service.ts`, plus three route gates and the
frontend:

| Where | Today |
| -- | -- |
| `submit()` notices | every ACTIVE holder of the key but the requester is told |
| `withdraw()` | a holder may withdraw someone else's draft or returned request (`othersMayWithdraw`) |
| `awaitingDecision()` | the key is required, then the SQL list of requests under review not raised by the viewer |
| `loadDecision()` (approve, return, reject) | the key, never the requester (`CHANGE_REQUEST_OWN_DECISION`) |
| `toDto()` `actions` | `approve`/`return`/`reject` true for a holder who is not the requester |
| Controller | `awaiting-decision`, `approve`, `return`, `reject` carry `@Permissions(committees:view)` |
| Frontend | Home's Awaiting, the Awaiting page and `MyWorkCountsService` ask for change requests only with the key; the role matrix and "A user's permissions" list it |

After this ticket none of them reads the key. Each asks the chain.

---

## 2. Seat actions: what the chain needs stored

**The fixed list** (`SEAT_ACTIONS` in a new
`foundation/committees/seat-actions.ts`, a registry like
`record-registry.ts`'s, failing closed):

| Key | Action |
| -- | -- |
| `add_member` | add a member |
| `remove_member` | remove a member |
| `change_member_seat` | change a member's seat |
| `request_change` | request a change |
| `decide_reporting_changes` | decide changes of committees that report to this one |

Meetings add `schedule_meeting` and `record_minutes` later (Ahmad, 10 Nov,
item 2). The key is stored as **text**, like `WorkflowStageRecordAction.actionKey`,
so a new action needs no enum migration.

**Per committee:** a new table `CommitteeSeatAction` (`organizationId`,
`committeeId`, `roleValueId`, `actionKey`, `createdAt`; unique on
`(committeeId, roleValueId, actionKey)`; indexed on `organizationId` and on
`(committeeId, actionKey)`). A row means the seat allows the action on that
committee. A seat with no row allows nothing.

**Defaults per organisation:** one boolean attribute per action on the
`committee_member_role` lookup's attribute schema (`seatAddsMember`,
`seatRemovesMember`, `seatChangesSeat`, `seatRequestsChange`,
`seatDecidesReportingChanges`). The attribute machinery has only boolean,
number and string types (`lookup.service.ts`), so booleans fit without a new
type (Q11). The SYSTEM values carry the defaults, rewritten by
`seedSystemData()` on every deploy, exactly like ACC-286's `required`. An
organisation changes a default through its override row
(`PATCH /lookups/values/:id/attributes`, `lookups:manage`), merged key by key.
Proposed defaults are Q10.

**Copied into a committee when it is created**, inside `createCommittee()`'s
transaction, from the seat values `getValues()` returns (the override merge
included). **Changing a default never reaches an existing committee.**

**Edited per committee only where the committee's stage allows
`edit_details`** (seeded: Formation): `PUT /committees/:id/seat-actions`
(`committees:edit_details`, plus ACC-281's view-or-membership rule). It sends
the whole map with `expectedUpdatedAt`, writes one audit row (before, after)
and refuses with `STAGE_ACTION_NOT_ALLOWED` elsewhere. After Formation the map
changes only through an approved change request (§9, PR 5).

**Existing committees** get their organisation's defaults from
`npm run backfill:acc283-seat-actions` (dry run, `-- --execute` after the
deploy, dry run 0). It writes rows only for a committee that has none, and
refuses a customer organisation.

**A read for the chain and the screens:** `seatActionsFor(client,
organizationId, committeeIds, actionKey?)` in `seat-actions.ts`, one query.
It is the only reader; never a second copy.

---

## 3. The chain

### 3.1 The steps

For a request on committee **C**, raised by **R**:

1. **The Reports-to step.** If C has a Reports-to committee **P**, and P is in
   force (active, its newest instance's stage flagged `IN_FORCE`: ACC-286's
   rule, so Suspended counts), the deciders are the ACTIVE holders of every
   seat of P whose actions include `decide_reporting_changes`.
2. **The unit steps.** C's owning unit, then its parent, and so on up to the
   root. At each unit, the deciders are its head holders (`headHolderWhere()`)
   and its acting cover in force (`runningActingCoverWhere(now)`), read only
   through `unit-headship.ts`. The cover's user must be ACTIVE (the helper
   does not check status, so the chain does, like the stage pool).

**Skipped at every step:**

- R, the requester;
- every ACTIVE member of C, except at the root (Ahmad: at the root, only
  being the requester skips the root head);
- a vacant step: no seat set, the seat empty, P not in force, a unit with no
  head and no cover, or an inactive unit.

**The first step with someone left decides.** Its people are the deciders, and
any one of them decides (one decision, like ACC-239 today; no vote).

If C's owning unit IS the root, step 2 is the root step at once, so C's
members are not skipped there.

### 3.2 The result

```ts
type ChainStep =
  | { kind: 'REPORTS_TO_SEAT'; committeeId: string; seatIds: string[] }
  | { kind: 'UNIT_HEAD'; unitId: string; isRoot: boolean }
  | { kind: 'NONE' };        // nobody but R (see below), or a root that is already headless

interface ChainResult {
  step: ChainStep;
  deciderIds: string[];
  /** R is a head holder of the root unit, or its acting cover in force (Q4, §4.3). */
  requesterHeadsRoot: boolean;
}
```

- **No automatic SELF_FINAL any more** (Ahmad, 16 Nov, Q4). When R heads the
  root, R CHOOSES: "Send for decision" or "Approve now" (§4.3). The chain itself
  only reports who else could decide.
- **NONE has two causes**, told apart by `requesterHeadsRoot`:
  - **R heads the root and nobody else is left** (no Reports-to seat holder,
    no head below, R the only root head): Send for decision is not offered,
    only Approve now (§4.3). A Submit sent anyway is refused with
    `CHANGE_REQUEST_NO_DECIDER` carrying `approveNow: true`, with no log line.
  - **The root is already headless** (a legacy state ACC-288 lets stand):
    Submit is refused with 409 `CHANGE_REQUEST_NO_DECIDER`, and a log line is
    written (Q7, §16). No Setup health condition.

### 3.3 Resolved live, in batches, never stored

**Live.** The chain is resolved when it is needed and never stored, like
the stage pool. A new head, a new Reports-to seat holder or a cover starting
re-routes every open request on the next read; that is how "open requests are
re-routed" is met with no backfill. The step that decided is recorded in the
decision's audit row (§4.4).

**One function, `resolveDecisionChains(client, organizationId, requests:
{ id, committeeId, requesterId }[])`** in
`change-requests/change-request-chain.ts`, returning `Map<requestId,
ChainResult>`. The skip-and-pick walk is a pure function over the loaded
facts, so its cases are unit-tested without a database.

Queries, **whatever the number of requests**. Each read is skipped when its
input is empty; independent ones run in `Promise.all`:

| # | Read | Scoped by |
| -- | -- | -- |
| 1 | the requesting committees: `orgUnitId`, `reportingToCommitteeId` | id AND organisation |
| 2 | their ACTIVE members (the skip set) | organisation, committee ids, `user.status` ACTIVE |
| 3 | which Reports-to committees are in force (newest instance, `IN_FORCE` flag, active) | organisation on the committee, instance and stage |
| 4 | the deciding seats of those committees (`seatActionsFor(…, 'decide_reporting_changes')`) | organisation |
| 5 | their holders (`seatHoldersFor()`, ACC-286's batch reader; only ACTIVE users fill a seat) | organisation |
| 6 | every owning unit's ancestors, in one recursive query with a depth guard | organisation at every step (like `findUnitSubtreeIds`) |
| 7 | head holders of all those units (`findCurrentHeadHoldersForUnits`) | organisation |
| 8 | covers in force (`findRunningActingCoversForUnits`) | organisation |
| 9 | the covers' users' status | organisation |

**At most 9 queries**, never one per request, step or unit. A spec pins the
count for 1 request and for 20. `requesterHeadsRoot` costs nothing more: the
root is the last unit of every walk, so reads 7 and 8 already hold its heads and
cover.

---

## 4. Who may do what to a request

### 4.1 At each request stage

| Request stage | Action | Who |
| -- | -- | -- |
| draft, returned | edit | R, still holding `committees:edit_details` (unchanged) |
| draft, returned | submit ("Send for decision") | R, still holding `committees:edit_details`, when the chain has someone (§3.2) |
| draft, returned | **approve now** | **R only, when R heads the root** (head holder or acting cover in force), holding `committees:edit_details` (Q4, §4.3) |
| draft, returned | withdraw | **R only** (Q8: nobody else withdraws another person's draft; was: a `committees:approve` holder) |
| under_review | approve, return, reject | **a current decider** (was: a `committees:approve` holder who is not R) |
| under_review | approve now | R, only to retry a failed Approve now (§4.3) |
| under_review | withdraw | R only (unchanged) |
| closed | nothing | unchanged |

The committee's stage rules (`committeeAllowsRequestMove()`) still apply on
top, unchanged: approve and return need C in force, reject and withdraw always
work.

### 4.2 Vacant steps and the requester

- **A vacant step** is skipped and the decision moves up (§3.1). Nothing is
  refused for it.
- **The requester** is never a decider. If R presses approve, return or reject
  they get `CHANGE_REQUEST_OWN_DECISION`, as today. The root head's own final
  decision is a separate action, Approve now (§4.3).
- **A member of C** is skipped below the root. If they press, they get
  `CHANGE_REQUEST_NOT_DECIDER`, naming the step that decides.
- **NONE** (no decider at all): Submit is refused, 409
  `CHANGE_REQUEST_NO_DECIDER`, and logged (ids only). The request stays a
  draft, so R can withdraw it or submit again once the root is headed (§16,
  Q7).

### 4.3 The root head's own request: Send for decision, or Approve now (Ahmad, 16 Nov, Q4)

**Who:** R is a head holder of the root unit, or its acting cover in force,
read through `unit-headship.ts` (`ChainResult.requesterHeadsRoot`). Nobody
else is ever offered Approve now.

**Two moves on a draft or returned request:**

- **"Send for decision"** is the ordinary Submit. The chain runs as written,
  with R skipped as the requester: a Reports-to seat holder, then the owning
  unit's head and upwards, then a second root head or the root's cover if
  there is one.
- **"Approve now"** applies the request at once as R's own final decision:
  `POST /committee-change-requests/:id/approve-now`.
  - It is Submit's transaction (storing `fromValues`), then Approve's
    transaction, back to back, each in its own lock order (§7) with the same
    drift and reference checks.
  - The reference checks also run once before the first transaction, read
    only, so a request that would fail is refused while it is still a draft.
  - The APPROVE audit row has `authority: { kind: 'ROOT_HEAD_OWN' }`. The
    "Revise the terms of reference" task is created for R, as for any
    approval. Nobody is notified: it is R's own decision.

**THE EDGE CASE: nobody but R.** When the chain, with R skipped, finds nobody
(no Reports-to seat holder, no head below the root, R the root's only head
and no cover), there is no step above the root. Send for decision is NOT
offered, only Approve now:

- the response's `actions.submit` is false and `actions.approveNow` true;
- a Submit sent anyway is 409 `CHANGE_REQUEST_NO_DECIDER` with `approveNow:
  true` (no log line: this is not the headless root).

**If Approve now's approve transaction fails** after its submit transaction
has committed (rare: the checks ran first), the request is under review.
- If the chain has deciders, they decide it as usual.
- If it has nobody but R, R keeps Approve now on the under-review request and
  may retry, or withdraw it.

Once R has chosen Send for decision and someone else is in the chain, Approve
now is not offered again for that request.

**Actions flags:** every response's `actions` gains `approveNow`, true exactly
when the viewer is R, R heads the root, and the stages allow it (the same
stage rules as `submit`). `submit` is false in the edge case above.

### 4.4 The decision's audit row

Approve, Return and Reject add `authority` to their audit metadata: the step
(`REPORTS_TO_SEAT` with committee and seat ids, or `UNIT_HEAD` with the unit
id and `isRoot`). Approve now writes `{ kind: 'ROOT_HEAD_OWN' }`. Ids only.

### 4.5 Reads and notices

- **`actions` on every response** come from the chain: `approve`, `return` and
  `reject` are true when the viewer is a current decider and the stages allow
  it. A response with several requests resolves them in one batch, for the
  requests under review only (at most one open request per committee).
- **The response says who decides, by step, never by person:**
  `awaitingDecisionBy: { kind: 'REPORTS_TO_SEAT', committee: { id, nameEn,
  nameAr }, seats: [{ id, labelEn, labelAr }] } | { kind: 'UNIT_HEAD', unit:
  { id, nameEn, nameAr } }`, only under review. A request whose chain is NONE
  never reaches review, except through a failed Approve now (§4.3). A screen says "Awaiting the Chairman of the Medical Executive
  Committee" or "Awaiting the head of Cardiology" (Q15).
- **`GET /committee-change-requests/awaiting-decision`** loses its route gate
  and is answered for everyone:
  - **Cheap first:** in one `Promise.all`, the units the viewer heads
    (`findUnitHeadedBy`), the units they cover (`findUnitsCoveredBy`) and the
    deciding seats they hold. If all three are empty: `[]`, three queries.
  - **Otherwise:** the requests under review in the organisation, by today's
    SQL (newest instance, `AWAITING_DECISION_KEYS`, not the viewer's own),
    capped at 200 and logged when the cap is hit (one open request per
    committee bounds it by the committee count). Then one
    `resolveDecisionChains()` call, kept where the viewer is a decider.
- **Reading a request as its decider:** `GET /committee-change-requests/:id`
  also admits a current decider of that request, through one function,
  `isCurrentDecider()`. Anyone else who may not read it gets today's 403
  (existence-neutral).
- **Opening the committee (Q6, PR 2a, §4.6):** every unit-step decider heads
  the owning unit or a unit above it, so the headship clause already lets them
  open the committee, read only. A Reports-to seat holder who heads none of
  those units gets the request only, through `isCurrentDecider()`.
- **Submit tells the deciders** of the step that decides (not R). Approve now
  tells nobody. Decisions still tell R. A re-route sends no notice (Q9).

### 4.6 Heads see the committees of their units (Ahmad, 16 Nov, Q6; PR 2a)

**The rule:** a unit's head holders and its acting cover in force see, READ
ONLY, every committee owned by that unit or any unit below it. It is one new
clause in the committee parent rule, beside ACC-281's member clause:
`committees:view`, OR an active member of the committee, OR a head or cover in
force of its owning unit or an ancestor of it.

- **Read only.** It covers the page, members, sub-committees, Membership
  history, change requests (list, open, preview, by id) and, through
  `InstanceAccess`, the workflow reads. Every write keeps ACC-281's rule
  (`committees:view` or membership), unchanged.
- **One place, `unit-headship.ts` only:** the units the viewer heads
  (`findUnitHeadedBy`) and covers (`findUnitsCoveredBy`, `now` explicit), then
  `findUnitSubtreeIds()` over them. A new function, `committeeOversightUnitIds(
  client, organizationId, viewerId, now)`, beside the membership functions in
  `common/services/committee-membership.ts`, returns that set. Never a second
  copy.
- **Order and cost:**
  - for a `committees:view` holder: no query, as today;
  - for anyone else, membership is asked first (one indexed query);
  - only a non-member costs the headship reads: two in `Promise.all`, then the
    subtree walk only if they lead anything, then the committee's owning unit
    (read with the committee where the read already loads it).
  - A stranger now costs 3 queries where they cost 1.
  - Nothing on the per-request path.
- **Lists:**
  - `GET /committees` for a non-holder adds one condition to the same
    `findMany`: active member OR `orgUnitId` in the set (active committees
    only, as for members);
  - the `mayOpen` flags (parent, Reports to, sub-committee rows) and task-row
    record names use the same set, read once per response.
- **Refusals are unchanged:** today's 403 "Required permission:
  committees:view" for a read, existence-neutral.
- **Task visibility is unchanged** (`taskVisibleSql`): ACC-244's unit scope
  already governs which tasks a head sees.
- **Specs** (§12): a head, a cover in force, a cover not yet started and one
  ended, a head of a sibling unit, a head of a CHILD unit (does not see its
  parent's committees), a former head, the platform organisation, writes
  still refused, and isolation (another organisation's units, heads and covers
  planted).
- **Mutations:** drop the subtree walk (own unit only); drop the cover clause;
  drop the organisation from the headship read.

### 4.7 Unfinished drafts (Ahmad, 16 Nov, Q8; PR 2, the departure part PR 2b)

- **A task for the requester:** when a request is created (a draft), and again
  when it is returned, R gets a task:
  - **title** "Finish or withdraw the change request", Arabic «إكمال طلب
    التغيير أو سحبه» (a singular, gender-neutral noun phrase; lane A checks it);
  - **description** in English, naming the request number and the committee;
  - `sourceType` COMMITTEE, the committee; assignee R; creator R; priority
    MEDIUM, so the normal priority SLA and escalation apply
    (`prepareRecordTask()` / `insertPrepared()`, as the terms task does).
- **It is linked to the request** by a new nullable column,
  `CommitteeChangeRequest.finishTaskId`, like `termsTaskId`. That is an
  additive migration in PR 2 (§8).
- **It completes on Submit and on Approve now**, inside the submit
  transaction, completed by R. **It is cancelled on Withdraw**, inside the
  withdraw transaction (an engine-style cancel, reason null). A Return creates
  a new one.
- **The departure (PR 2b):** when R is deactivated, R's open draft or returned
  request is withdrawn automatically INSIDE `UserService.deactivate()`'s
  transaction, its task cancelled, audited `{ decision: 'WITHDRAWN', cause:
  'departure' }`.
  - **This needs an engine entry point that runs a system move inside a
    caller's transaction.** `triggerSystemTransition()` always opens its own,
    so today it cannot run inside the deactivation.
  - The leaver's requests are found through the existing `(organizationId,
    requestedById)` index.
  - A request R already sent for decision is not withdrawn: it is under review,
    and its deciders still decide it.
- **Nobody else withdraws another person's draft.** `othersMayWithdraw` is
  removed from `REQUEST_STAGE_POLICY`, and `CHANGE_REQUEST_NOT_REQUESTER`
  keeps its old meaning.
- **Known edge:** R may complete the task by hand without submitting. Nothing
  breaks, and no new task is made until the next Return. Refusing a manual
  Complete on this task would need a task kind that does not exist; not
  proposed.

#### PR 2b, the proposed diff (for lane A's review, 16 Nov; NOT built)

Lane A's three conditions, and where each is met:
- **Inside the same transaction** as `assertNotAccountOwner` and the
  tenant-administrator invariant: the withdrawal is one call inside
  `deactivate()`'s existing `$transaction`.
- **After the root-head lock and before the leaver's task reassignment:** it is
  the last call in the transaction, after `captureRootHeadBaseline` (the lock)
  and the invariants. `reassignAllForUser()` runs after commit, so it comes later
  in any case.
- **Nothing is notified inside the transaction:** the in-transaction part writes
  rows only. Audit rows and the engine's after-commit work run after commit.

**1. `backend/src/foundation/user/user.service.ts` (lane A's file): three
calls, an injection and one metadata field.**

```diff
@@ constructor(
+    // ACC-283 PR 2b — the leaver's unfinished change requests (plan §4.7).
+    private readonly changeRequestDeparture: ChangeRequestDepartureService,
   ) {}

@@ async deactivate(
     const leftPoolEntryIds = await this.stagePool.openEntriesWithMember(organizationId, id);
 
+    // ACC-283 PR 2b — the leaver's open DRAFT or RETURNED change requests, read
+    // while they are still ACTIVE: ONE indexed query, and nothing else when
+    // there are none. A request already sent for decision is left alone.
+    const departure = await this.changeRequestDeparture.prepare(organizationId, id, actorId);
+
     await this.prisma.$transaction(async (tx) => {
       // ACC-288 — the root-head lock first, then whether the root is headed.
       const rootHeaded = await captureRootHeadBaseline(organizationId, tx);
       // ACC-221 — the account owner is never deactivated inside the tenant.
       await assertNotAccountOwner(tx, organizationId, id);
       const baseline = await captureAdministratorBaseline(organizationId, tx);
       await tx.user.update({ where: { id }, data: { status: 'INACTIVE' } });
       await assertTenantRetainsAnActiveAdministrator(organizationId, tx, baseline);
       // ACC-288 — the root's last head can't be deactivated without a successor or a cover.
       await assertRootUnitRetainsAHead(organizationId, tx, rootHeaded);
       await this.stagePool.recordPoolMemberLeftInTx(tx, organizationId, leftPoolEntryIds, id, 'DEACTIVATED');
+      // ACC-283 PR 2b — withdrawn with the flip, after every lock above and
+      // before any task row is written (instance, then task: ACC-190).
+      await this.changeRequestDeparture.withdrawInTx(tx, departure);
-    });
+    }, DEACTIVATION_TX);
 
     await this.authProvider.invalidateUserSessions(id);
+    // After commit: the audit rows (no notice: nobody waits on a draft).
+    const withdrawnChangeRequests = await this.changeRequestDeparture.finish(departure);
 
@@
-      metadata: { event: 'deactivated', reassignedCount, unassignedCount },
+      metadata: { event: 'deactivated', reassignedCount, unassignedCount, withdrawnChangeRequests },
```

with, at the top of the file:

```ts
import { ChangeRequestDepartureService } from '../committees/change-requests/departure/change-request-departure.service';

// ACC-283 PR 2b — Prisma's default interactive timeout is 5 s; the stage
// change's own budget (STAGE_CHANGE_TX), since a withdrawal is one.
const DEACTIVATION_TX = { maxWait: 10_000, timeout: 20_000 } as const;
```

and `ChangeRequestDepartureModule` added to `UserModule`'s imports. Three
choices here are lane A's to accept or drop:
- `DEACTIVATION_TX`;
- the `withdrawnChangeRequests` count in the User audit metadata;
- where `finish()` sits after commit. Anywhere after commit works; it is
  placed before the session and task work so the audit rows sit next to the
  move.

**2. The engine: a system move inside a caller's transaction.**
`triggerSystemTransition()` stays, unchanged in behaviour. Its body is split
into three methods, and it, `performTransition()` and the new entry point all
run the SAME transaction body, so there is no second copy of the move.

```ts
/** Every read a move needs, made before any transaction (performTransition()'s reads). */
export interface PreparedSystemMove {
  instance: PrismaWorkflowInstance;
  currentInstanceStage: PrismaWorkflowInstanceStage; // the open entry being left
  transition: PrismaWorkflowTransition;             // mover APP only
  fromStage: PrismaWorkflowStage;
  toStage: PrismaWorkflowStage;
  enteredAt: Date;
  slaDueAt: Date | null;
  delegationStamp: { delegationReason: 'ACTING_HEAD' | 'OUT_OF_OFFICE_COVERAGE'; delegationContextId: string } | null;
  entryTasks: PreparedStageEntryTasks;
  exitScope: { workflowInstanceId: string; stageId: string; workflowInstanceStageId: string };
  quorumCount: number | null;
  organizationId: string;
  actorId: string;
  comment?: string;
}

/** What the transaction wrote, for the after-commit half. */
export interface AppliedSystemMove {
  prepared: PreparedSystemMove;
  newInstanceStage: PrismaWorkflowInstanceStage;
  updatedInstance: PrismaWorkflowInstance;
  cancellation: StageExitCancellation;
  createdTasks: { task: ITask; prepared: PreparedTask }[];
}

// WorkflowService, public:

/** triggerSystemTransition()'s reads, plus performTransition()'s. No lock, no write. */
async prepareSystemTransition(
  instanceId: string,
  toStageKey: string,
  organizationId: string,
  actorId: string,
  options?: { comment?: string },
): Promise<PreparedSystemMove>;

/**
 * The move, inside the CALLER's transaction. The instance's row lock is taken
 * FIRST in this call (lockWorkflowInstance). After that come: the "still open"
 * check, the gate (ADVANCE only), the preconditions, `inTx`, the exit, the
 * stage-exit task cancel, the new entry with its tasks, and the instance update.
 * It writes no notice and no audit row.
 *
 * `ifMoved: 'skip'` returns null, writing nothing, when the entry was closed
 * between prepare and lock. The default, 'refuse', keeps today's 409.
 */
async systemTransitionInTx(
  tx: EngineTx,
  prepared: PreparedSystemMove,
  options?: { inTx?: (tx: EngineTx) => Promise<void>; ifMoved?: 'refuse' | 'skip' },
): Promise<AppliedSystemMove | null>;

/**
 * After the caller's commit, today's after-commit half: the stage-exit audit and
 * notices, the entry tasks' announcements, the unassigned check, the
 * transition's actions and the WorkflowInstance audit row.
 */
async finishSystemTransition(applied: AppliedSystemMove): Promise<IWorkflowInstance>;
```

`triggerSystemTransition()` becomes `prepare`, then
`$transaction(tx => systemTransitionInTx(tx, p, { inTx }), STAGE_CHANGE_TX)`,
then `finish`. `performTransition()` (a person's move or a vote) calls the
same private transaction body and the same finish.

**3. A small module, so there is no cycle:
`committees/change-requests/departure/`.**
- `ChangeRequestDepartureModule` imports `PrismaModule`, `WorkflowModule` and
  `forwardRef(() => TaskModule)`, plus `AuditLogService` (as ACC-297's module
  provides its own).
- It exports one service. It neither imports `UserModule` nor is imported by
  anything `UserModule` pulls in, so `UserModule` imports it with no
  `forwardRef` (ACC-297's shape).

```ts
interface DepartureWithdrawal { requestId: string; committeeId: string; fromStageKey: 'draft' | 'returned'; move: PreparedSystemMove }
export interface PreparedDeparture { organizationId: string; leaverId: string; actorId: string; withdrawals: DepartureWithdrawal[] }

prepare(organizationId, leaverId, actorId): Promise<PreparedDeparture>
withdrawInTx(tx, prepared): Promise<void>        // stores what it closed on `prepared` for finish()
finish(prepared): Promise<number>               // after commit; returns how many were withdrawn
```

- **`prepare`** runs one `$queryRaw`, every value bound:
  ```sql
  SELECT r.id, r."committeeId", s.key
    FROM "CommitteeChangeRequest" r
    JOIN LATERAL (SELECT i.id, i."currentStageId", i.status FROM "WorkflowInstance" i
                   WHERE i."objectType" = 'COMMITTEE_CHANGE_REQUEST' AND i."objectId" = r.id
                     AND i."organizationId" = r."organizationId"
                   ORDER BY i."createdAt" DESC LIMIT 1) i ON true
    JOIN "WorkflowStage" s ON s.id = i."currentStageId"
   WHERE r."organizationId" = $org AND r."requestedById" = $leaver
     AND i.status <> 'CANCELLED' AND s.key IN ($withdrawableUnsent)
   ORDER BY r.id
  ```
  - The driving index is `(organizationId, requestedById)`, and the lateral
    join uses `(objectType, objectId)`.
  - `$withdrawableUnsent` is derived from `REQUEST_STAGE_POLICY`: the open
    stages that allow `withdraw` and are not `awaitsDecision`. Today that is
    draft and returned. A stage with no key is skipped, since it cannot be told
    apart from one under review.
  - **No rows means no other query**: `withdrawals: []`, and `withdrawInTx` and
    `finish` return at once.
  - For each row, `prepareSystemTransition(instanceId, 'withdrawn', org,
    actorId, { comment: undefined })`.
- **`withdrawInTx`**, per withdrawal in id order:
  - `systemTransitionInTx(tx, move, { ifMoved: 'skip', inTx })` takes the
    instance lock. A request that moved meanwhile (the leaver pressed Send a
    moment before) is skipped, so the deactivation is never refused for it.
  - In `inTx`: the request row
    `update { withdrawnAt: now, withdrawnById: actorId }`. Then, if
    `finishTaskId`, `TaskService.closeRecordTaskInTx(tx, finishTaskId, org,
    actorId, 'CANCELLED')`, which locks the task row last.
  - The committee's stage rules are not read: `committeeAllowsRequestMove()`
    always allows `withdraw`, so the read would be dead.
- **`finish`**, after commit, per withdrawal applied:
  - `finishSystemTransition(applied)`;
  - the CommitteeChangeRequest audit row (below);
  - `auditRecordTaskClosure(closure, org, actorId,
    'CHANGE_REQUEST_WITHDRAWN_ON_DEPARTURE')`.

**Lock order inside the deactivation**, in full:
1. The root-head advisory lock (ACC-288).
2. The account-owner read, the administrator baseline, the user row (the flip).
3. The invariant reads and the pool-left inserts.
4. Then, per withdrawal in request-id order: its instance FOR UPDATE, its
   request row, its finish-task row.

No request path takes the root-head lock or a user row, so this cannot
deadlock against Submit, Withdraw or Approve. Those paths take the request's
instance first, then the committee's instance FOR SHARE (Submit only), the
request row, and the task row. The new path takes no committee lock, so there
is no committee-before-request inversion either.

**The audit row** (one per withdrawn request, after commit):
`{ action: 'UPDATE', objectType: 'CommitteeChangeRequest', objectId, actorId:
<the deactivating admin>, metadata: { decision: 'WITHDRAWN', cause: 'departure',
leaverId, from: 'draft' | 'returned' } }`.
- `withdrawnById` is the deactivating actor, not the leaver: the leaver did
  not withdraw it, and the record must not say so.
- The engine also writes its WorkflowInstance audit row (stage before and
  after), and the task closure writes its own, with reason
  `CHANGE_REQUEST_WITHDRAWN_ON_DEPARTURE`.

**Notices after commit: none.**
- The leaver is INACTIVE.
- A draft was never sent, so nobody awaits it. A returned request's deciders
  have already let it go.
- The withdraw move's only action is LOG_AUDIT.
- The finish-task closure sends no notice (as on a person's Withdraw).
- The departure notice to the tenant admins (`notifyTenantAdminsOfDeparture`)
  is unchanged. Adding "and n change requests were withdrawn" to it is lane A's
  call; it is not proposed.

**A pre-existing edge, found while writing this (not caused by PR 2b):** a
FINAL stage's entry keeps `exitedAt` null. Once its pool empties, the entry is
flagged `isUnassigned`, by `checkAndFlagUnassignedStage()` at entry or by the
15-minute sweep. Setup health's `stagesWithoutAssignee` then lists it.
- Change requests' Withdrawn, Approved and Rejected stages are worked by
  `CREATOR`. So once any requester leaves, their closed requests can show up as
  "stage without an assignee".
- PR 2b makes it immediate for the withdrawn request, because the leaver is
  already INACTIVE when the entry is made. Today it appears at the next sweep.
- Read from the code, not measured.
- Proposed separately (a small engine fix, both places): a final stage is never
  flagged unassigned, and the sweep resolves no pool for one.

---

## 5. Setup health: none (removed, Ahmad, 16 Nov, Q7)

This section planned a Setup health condition, `CHANGE_REQUEST_WITHOUT_DECIDER`,
for a request under review that nobody could decide. **Ahmad ruled it out**:
ACC-288 keeps the root unit headed, so the chain always ends with a decider.
PR 1 no longer adds the enum value or any reader. The one case left (a root
that was already headless) is refused at Submit with
`CHANGE_REQUEST_NO_DECIDER` (§6, §16).

---

## 6. Refusal codes

**New:**

| Code | Status | When | Details |
| -- | -- | -- | -- |
| `CHANGE_REQUEST_NOT_DECIDER` | 403 | approve, return or reject by someone who may read the request but is not a current decider | `awaitingDecisionBy` (the step, as in §4.5) |
| `CHANGE_REQUEST_NO_DECIDER` | 409 | Submit, when the chain finds nobody: a legacy headless root (a log line is written, Q7), or R heads the root and nobody else is left (§4.3, no log line) | `approveNow: true` in the second case |
| `CHANGE_REQUEST_APPROVE_NOW_NOT_ALLOWED` | 403 | Approve now by anyone who is not R heading the root, or on a request R already sent to other deciders (§4.3) | none |
| `SEAT_ACTION_UNKNOWN` | 400 | a seat-action map names an action not in `SEAT_ACTIONS` | `actionKey` |
| `SEAT_ACTION_SEAT_UNKNOWN` | 400 | it names a seat that is not an active `committee_member_role` value of this organisation (another organisation's included) | `roleValueId` |

**Kept, with a new meaning:**

- `CHANGE_REQUEST_OWN_DECISION` (409): R pressing approve, return or reject
  (Approve now is its own action).
- `CHANGE_REQUEST_NOT_REQUESTER` (403): **its old meaning (Q8)**, withdraw by
  anyone but R.
- `CHANGE_REQUEST_NOT_ALLOWED` (403): still the refusal for a missing
  `committees:edit_details` on create, edit and submit. It is no longer sent
  with `permission: committees:approve`.

**Kept unchanged:** every other `CHANGE_REQUEST_*` code, `STAGE_ACTION_NOT_ALLOWED`
(seat actions edited outside Formation), `COMMITTEE_CHANGED` (a stale
seat-action save), and the 404 "Change request not found" for someone who may
not read the request at all.

**Removed:** none. Each new code gets an English and Arabic sentence in the
screens' refusal file (lane A's wording, as in ACC-286).

---

## 7. Lock order

**The chain takes no lock.** It is a read, resolved before the transaction,
like the permission checks it replaces. A head change that commits a moment
after the check does not undo a decision already being made; the audit row
records which step decided.

**Approve is unchanged from ACC-239:** the request's instance (the engine's),
the committee's instance, the hierarchy lock (only if parent or Reports-to
changes), the committee row, the request row. When PR 5 lets a request change
seat actions, those rows are written after the committee row lock and before
the request row.

**Approve now** (Q4) is two transactions in sequence, each in its own order:
Submit's (the request's instance, the committee read FOR SHARE, the request
row, then the finish task's row), then Approve's (unchanged).

**The finish task (Q8)** is always locked LAST, after the request row:
- Submit and Withdraw: the request's instance, the request row, then the task
  row (`lockTaskRow()`). That is the engine's "instance, then task" order
  (ACC-190).

**The departure withdrawal (Q8, PR 2b)** joins the deactivation's existing
order:
- the root-head advisory lock (ACC-288, already first);
- the user writes;
- then, per open draft, in id order: its instance FOR UPDATE, its request row,
  its finish task's row.
- **It must run BEFORE the deactivation's own task-row writes** (reassigning
  the leaver's tasks). A task row locked before a request instance would invert
  "instance, then task".
- No request path takes the root-head lock or a user row, so the new order
  cannot deadlock against Submit, Withdraw or Approve.

**Editing seat actions in Formation:** the committee's instance FOR SHARE,
then the committee row FOR UPDATE (with the `expectedUpdatedAt` check), then
the seat-action rows. This is ACC-286's member-write order, so an edit and a
transition cannot deadlock.

**Committee create** writes the copied defaults inside its own transaction,
which has no prior lock.

**The backfill:** per committee, the committee row FOR UPDATE, then insert
only if none exist; one transaction per organisation with `BACKFILL_TX`.

**Never in the chain:** the root-head advisory lock (ACC-288). The chain only
reads headship and never changes it. (The departure withdrawal runs under that
lock only because the deactivation already holds it.)

**The headship read clause (Q6)** takes no lock: it is a read.

---

## 8. Migration

**Yes, one, additive, in PR 1** (`acc283_committee_seat_actions`):

- the table `CommitteeSeatAction` (§2).

Safe against the deployed code: nothing it runs reads the new table. (It also
carried a Setup health enum value until §16 removed it.)

**PR 2 adds one additive migration** (Q8): the nullable column
`CommitteeChangeRequest.finishTaskId`. It is safe against the deployed code,
because nothing deployed reads it.

**No other migration:**

- nothing stores the chain (§3.3) or the headship clause (§4.6);
- seat actions in a change request are a key in the existing `changes` and
  `fromValues` JSON (PR 5);
- retiring `committees:approve` is a data backfill, not a schema change.

---

## 9. PR split

| PR | What | Migration | After the deploy |
| -- | -- | -- | -- |
| **1** backend | Seat actions: the registry, the table, the lookup defaults (attribute schema plus the SYSTEM values), copy on create, `GET`/`PUT /committees/:id/seat-actions` (Formation only), `seatActionsFor()`. Nothing decides by seat actions yet. | yes | `backfill:acc283-seat-actions` (dry run, execute, dry run 0) |
| **2a** backend | **[x] Built** (branch `feature/ACC-283-pr2a-head-oversight`). Heads see the committees of their units (Q6, §4.6): `committeeOversightUnitIds()`, the clause in the parent rule (opt-in `{ oversight: true }`, reads only) and the committee reads; writes unchanged. Isolation tests and the three mutations. | no | none |
| **2** backend | **[x] Built** (branch `feature/ACC-283-pr2-chain`). The chain: `change-request-chain.ts`, decide/withdraw/awaiting/actions/notices/read admission on it, `awaitingDecisionBy`, `CHANGE_REQUEST_NOT_DECIDER`, the route gates dropped. Approve now (Q4, §4.3): the endpoint, `actions.approveNow`, `CHANGE_REQUEST_APPROVE_NOW_NOT_ALLOWED`. The finish task (Q8, §4.7) and only-R-withdraws. `committees:approve` is no longer read (still in the catalogue). Open requests re-route on their next read. | yes: `finishTaskId` | none; deploy after PR 1's backfill has run, so deciding seats exist |
| **2b** backend | **[x] Built** (branch `feature/ACC-283-pr2b-departure`, lane A's conditions, Prompt 86). The departure withdrawal (Q8, §4.7): the engine's in-transaction system move, and one guarded call in `UserService.deactivate()` (lane A's file), before its task-row writes. As built, one change from the proposal: the departure module's WorkflowModule and TaskModule edges, and UserModule's edge to it, are `forwardRef()`, because WorkflowModule reaches UserModule through TenantModule. No constructor needs one. | no | none |
| **3** backend | **Dropped** (§16, Q7): there is no Setup health condition. Numbers are kept so the later PRs keep their names. | — | — |
| **4** backend | Retire `committees:approve`: out of `COMMITTEES_PERMISSIONS` and the seed; `backfill:acc283-retire-committees-approve` (dry run first, refuses customers, after PR 2 deploys); a spec failing if any non-spec source names it (`retired-task-keys.spec.ts`'s shape); the sentence table. Terms Review's seed assignment for new organisations (§10). | no | the backfill |
| **5** backend | Seat actions as a change-request field (the whole map is one field, Q12): preview, drift check, apply on approval, labels. | no | none |
| **6** backend | Section 1 enforcement: on their committee, a member may add, remove, change a seat and request a change where their seat allows it OR their role does (Ahmad, 10 Nov, item 1), replacing ACC-281's interim write rule (Q1). | no | none |
| screens | One per backend PR, by lane: the seat-actions editor in Formation and its lookup defaults; Awaiting for everyone, "Awaiting …" on the request, the new codes in both languages; "Send for decision" and "Approve now" for a root head; heads opening their units' committees (the list and the page read only); the request dialog's seat-actions field. | — | — |

Order: PR 1, then 2a, then 2, then 2b; 4, 5 and 6 after 2. 2a ships on its own
once PR 1 has. Screens follow their backend PR.

---

## 10. Terms Review in the seed

Ahmad's proposal (10 Nov), for **new organisations only**: the committee
template's `terms_review` stage gets `who: { mode: 'ANY_ONE', entries: [{
kind: 'ORG_UNIT_HEAD' }] }` with no unit, which means the committee's own unit
(`RECORD_ROUTES`), instead of the starting assignment.

- **Existing organisations keep what they set.** No backfill.
- **A vacant owning unit head means an empty pool**: the stage pool does not
  walk up to a parent (§2.19). The entry is flagged unassigned and Setup
  health shows it, as for any stage. That is the stage rule, not the chain
  (Q13).
- `workflow.seed.spec.ts` pins the change; `assignStartingAssignments()`
  writes nothing for this stage, because it now has an entry.

---

## 11. The shared database (read-only, 16 Nov, counts and slugs only)

| Organisation | Requests | Open | Under review | Committees | No Reports-to | …of those, owned by the root unit | Roles with `committees:approve` | Active people holding it |
| -- | -- | -- | -- | -- | -- | -- | -- | -- |
| al-manara | 0 | 0 | 0 | 3 | 2 | 2 | 3 | 2 |
| al-nakheel | 2 | 0 | 0 | 5 | 4 | 2 | 3 | 2 |

- **No open request anywhere**, so "re-route open requests" changes nothing on
  this database today. It still works for any request opened before PR 2
  deploys, because the chain is live.
- **6 of 8 committees have no Reports-to.** Their requests go straight to the
  unit steps; 4 of those are owned by the root, so the root head decides
  (members of the committee included, Ahmad's root rule).
- PR 4's backfill would take the key off 3 roles in each organisation.

---

## 12. Specs and mutation checks

- **`change-request-chain.spec.ts`** (pure walk): Reports-to seat decides;
  seat vacant → owning unit; owning unit vacant → parent; a cover decides; a
  member of C skipped below the root and not at the root; R skipped
  everywhere; R alone at the root → NONE with `requesterHeadsRoot`; R and a
  second root head → the second decides; root headless → NONE without it; P
  not in force → skipped; an inactive unit skipped; R heads the root and a
  Reports-to seat holder exists → that seat decides.
- **`change-request-chain.db-spec.ts`** (real Postgres): the same against real
  rows; the query count for 1 and 20 requests; tenant isolation (another
  organisation's committee, seat holder, unit and head planted, none resolved).
- **`committee-change-request.db-spec.ts`**: decide as a Reports-to seat
  holder, a unit head, a cover, a member of C (refused), R (refused);
  awaiting-decision for a decider, a non-decider (three queries), the cap,
  isolation; a re-route after a head change.
  - **Approve now (Q4):**
    - the root head applies their request with authority `ROOT_HEAD_OWN` and
      the terms task;
    - anyone else, and R once someone else decides, is refused;
    - the edge case: `submit` false, Submit refused with `approveNow: true`;
    - a failed approve leaves it under review with Approve now to retry.
  - **The finish task (Q8):** made on create and on Return, completed on
    Submit and Approve now, cancelled on Withdraw; a withdraw by anyone but R
    is `CHANGE_REQUEST_NOT_REQUESTER`.
- **`committee-oversight.db-spec.ts`** (PR 2a): §4.6's cases and isolation.
- **`user-departure-change-request.db-spec.ts`** (PR 2b):
  - deactivating R withdraws R's draft and cancels its task in the same
    transaction, with the `departure` audit;
  - a refused deactivation (the root role or the root head) leaves the draft
    as it was;
  - a request already under review is untouched.
- **`committee-seat-actions.db-spec.ts`**: copy on create with an override;
  Formation edit, refusals, stale save; the backfill's idempotence.
- **Mutations**, each turning a spec red: drop the requester skip; drop the
  member skip; apply the member skip at the root; stop the walk before the
  root; let the chain read `committees:approve`; resolve per request in a
  loop (the query-count pin); drop the organisation from the ancestor query;
  offer Approve now to a head who is not the requester; complete the finish
  task outside the submit transaction; plus PR 2a's three (§4.6).

---

## 13. The performance rule

- Nothing on the per-request path (TenantGuard, PermissionGuard, ModuleGuard,
  the throttler, interceptors, middleware, `verifySessionIdentity()`).
- The chain is resolved only inside the change-request reads and writes, at
  most 9 queries for any number of requests; never in a row loop.
- The headship clause (Q6) costs a non-member, non-holder up to 3 more queries
  per committee read; a `committees:view` holder or a member pays nothing more.
- The departure withdrawal (Q8) adds one indexed query to a deactivation, and
  a little work per open draft (at most one per committee).
- Awaiting decision costs three queries for someone who decides nothing.
- Hard caps: 200 candidates under review; the ancestor walk's depth guard.

---

## 14. Open questions (recommendation first)

**Q1. Section 1 enforcement in this ticket?**
- **Recommend:** yes, as PR 6, after the chain. It needs the same table and
  defaults.
- Alternative: its own ticket, keeping ACC-283 to the chain plus storage.

**Q2. The Reports-to step yields nobody** (no deciding seat, the seat empty,
everyone skipped):
- **Recommend:** fall to C's own owning-unit steps (§3.1). The chain is then
  always the same shape and always ends at the root.
- Alternatives: P's owning unit, or P's own Reports-to.

**Q3. A Reports-to committee that is not in force** (being dissolved, or
inactive):
- **Recommend:** treat it as vacant and move on. Suspended counts as in force
  (ACC-286's rule).
- Alternative: still let its deciding seat decide.

**Q4. The root head's own request: CLOSED (Ahmad, 16 Nov, §16).** The root
head chooses "Send for decision" (the chain as written) or "Approve now" (their
own final decision, `ROOT_HEAD_OWN`). When nobody else is in the chain, only
Approve now is offered. §4.3.

**Q5. Out of office:**
- **Recommend:** heads and acting covers in force only. No out-of-office
  acting-user substitution (the cover IS the substitute for headship).
- Alternative: replace an away decider with their acting user, like the stage
  pool.

**Q6. What a decider may open: CLOSED, wider (Ahmad, 16 Nov, §16).** A
unit's heads and covers in force see every committee owned by their unit or
below, read only (PR 2a, §4.6). A Reports-to seat holder who is not such a head
gets the request only, through `isCurrentDecider()`.

**Q7. Submit when the chain is NONE:** **CLOSED (Ahmad, 16 Nov, §16).** Not a
valid case: ACC-288 keeps the root headed. In PR 2, Submit is refused with 409
`CHANGE_REQUEST_NO_DECIDER` and a log line is written. No Setup health.
- (Recommended was: accept; it waits, and Setup health shows it.)

**Q8. Unfinished drafts: CLOSED (Ahmad, 16 Nov, §16).** Nobody else withdraws
another person's draft. Instead:
- the requester gets a "Finish or withdraw the change request" task;
- a departing requester's draft is withdrawn inside the deactivation.

§4.7.

**Q9. A notice when a request is re-routed** (new head, new seat holder):
- **Recommend:** none. The awaiting list is live.
- Alternative: tell the new deciders on the next hourly run.

**Q10. Seat defaults:**
- **Recommend:** Chairman, all five; Secretary, add, remove, change seat and
  request change; every other seat, none.
- Alternative: Chairman `decide_reporting_changes` only, everything else
  unticked.

**Q11. How defaults are stored on the lookup:**
- **Recommend:** one boolean attribute per action (the attribute schema has no
  list type).
- Alternative: a new list attribute type.

**Q12. Seat actions in a change request:**
- **Recommend:** the whole seat-action map is one field. It drifts, previews
  and applies as one.
- Alternative: one field per seat.

**Q13. Terms Review's seed** (new organisations):
- **Recommend:** `ORG_UNIT_HEAD` with no unit, as Ahmad proposed; a vacant
  owning unit leaves the stage unassigned, shown on Setup health.
- Alternative: keep the starting assignment.

**Q14. SELF_FINAL timing:** *(now Approve now's timing, §4.3; the
recommendation stands: Submit's transaction, then Approve's.)*
- **Recommend:** a second transaction right after Submit, the ordinary approve
  path. If it fails, the request waits with R as its only decider.
- Alternative: one transaction for both moves. The engine's
  `triggerSystemTransition` opens its own transaction, so this would need an
  engine change.

**Q15. Naming who decides:**
- **Recommend:** by step (the committee and seat, or the unit), never by
  person, so no `users:view` question arises.
- Alternative: also name the people.

---

## 15. Review (lane B, 16 Nov)

**Approved for PR 1** (Prompt 65, lane B).

**Decided by lane B, as recommended:** Q2, Q3, Q5, Q9, Q11, Q12, Q13, Q14 and
Q15.

**With Ahmad (business):** Q1, Q4, Q6, Q7, Q8 and Q10. PR 1 depends only on
Q10, and only for seed values: PR 1 ships Q10's recommendation (Chairman, all
five; Secretary, the four member actions; every other seat, none). If Ahmad
decides otherwise, the SYSTEM values change in a later PR. That reaches new
committees only; existing ones keep their copy, by design.

**PR 1 additions:**

- **a. Attribute names:** each new attribute on the `committee_member_role`
  schema carries `labelEn` and `labelAr` (ACC-310's shape, #305). The
  wording, with the Arabic awaiting lane A's check:

  | Attribute | English | Arabic |
  | -- | -- | -- |
  | `seatAddsMember` | Add members | إضافة أعضاء |
  | `seatRemovesMember` | Remove members | إزالة أعضاء |
  | `seatChangesSeat` | Change a member's seat | تغيير مقعد عضو |
  | `seatRequestsChange` | Request a change | طلب تغيير |
  | `seatDecidesReportingChanges` | Decide changes of committees that report to it | البتّ في تغييرات اللجان التابعة لها |

- **b. The migration's timestamp** is later than `20261115000000`. Coder 1's
  ACC-278 PR B has its own migration; whichever merges second must carry the
  later timestamp. A folder nothing has applied may be renamed.
- **c. ~~`CHANGE_REQUEST_WITHOUT_DECIDER`** is in
  `DEFERRED_SETUP_CONDITION_TYPES`, and a spec proves nothing writes it.~~
  Removed from PR 1 by §16 (Q7).
- **d. The backfill:** a dry run by default; refuses a customer organisation;
  `BACKFILL_TX`; writes only for committees with no rows. Run only against
  the local test database, never the shared one.
- **e. `PUT /committees/:id/seat-actions`:**
  - `committees:edit_details` at the route, plus ACC-281's rule
    (`committees:view` or membership of that committee);
  - the stage rule (`edit_details`) with the instance lock first;
  - `expectedUpdatedAt`;
  - one audit row;
  - isolation tests named to the tenant-isolation filter's exact pattern.

**Proofs required:**

- `prisma migrate diff` empty;
- the specs from §12 that apply to PR 1;
- three mutations, each turning a spec red:
  - drop the organisation scope in `seatActionsFor()`;
  - drop the stage check;
  - copy the defaults without the override merge.

**Corrections to this plan, found while building PR 1:**

- *(Three corrections about the Setup health condition, its severity, its
  reported type list and its Fix, are moot: §16 removed the condition.)*
- **A seat-action save touches the committee's `updatedAt`.** Seat actions are
  part of the terms of reference, so a save of either is stale against the
  other.

---

## 16. Ahmad's answers (16 Nov)

- **Q1:** as recommended. Section 1 (seats granting members their committee
  actions) is PR 6.
- **Q10:** as recommended. The seeded defaults stand: Chairman all five,
  Secretary the four member actions, every other seat none.
- **Q4** (the root head's request): Ahmad wants an option. The final wording
  comes in a later prompt; it does not touch PR 1. *(Answered below.)*
- **Q6 and Q8:** still being discussed; they do not touch PR 1. *(Answered
  below.)*
- **Q7 ("nobody can decide"): CLOSED. Not a valid case.** ACC-288 keeps the
  root unit headed, so the chain always ends with a decider.
  - There is **no Setup health condition and no deferred type** for it.
    `CHANGE_REQUEST_WITHOUT_DECIDER` is removed from PR 1 entirely: the enum
    value (the migration creates only `CommitteeSeatAction`), the deferred
    list entry, the screens' wording, Fix and subject fields, and their specs.
  - **In PR 2,** if the chain ever finds nobody (a legacy headless root),
    Submit is refused with **409 `CHANGE_REQUEST_NO_DECIDER`**, and a log line
    is written (ids only).
  - PR 3 (the detector) is dropped; the PR numbers are kept.

### 16.1 The remaining answers (16 Nov, through lane B's Prompt 68)

- **Q4, the root head's own request** (§4.3). When the requester is the root
  unit's head (a head holder, or the acting cover in force), there are two
  moves:
  - **"Send for decision":** the ordinary chain.
  - **"Approve now":** applied at once as their own final decision, in the
    same approve transaction, locks, drift and reference checks, with audit
    authority `{ kind: 'ROOT_HEAD_OWN' }`.
  - Nobody else gets Approve now, and the actions flags say whether the viewer
    may.
  - **The edge case:** when the chain, with the root head skipped as the
    requester, finds nobody, there is no step above the root, so Send for
    decision is not offered, only Approve now.
- **Q6, wider** (§4.6, **PR 2a**, before the chain). A unit's heads and acting
  covers in force see, read only, every committee owned by their unit or any
  unit below it. It is:
  - one clause in the committee parent rule, beside ACC-281's member clause,
    through `unit-headship.ts` only;
  - batched, organisation-scoped, and on nothing in the per-request path;
  - read only: writes are unchanged.

  It replaces "a decider may open the committee while it awaits them". A
  Reports-to seat holder who is not such a head gets the request only,
  through `isCurrentDecider()`.
- **Q8, unfinished drafts** (§4.7):
  - **The task:** a draft or returned request gives its requester a task,
    "Finish or withdraw the change request" / «إكمال طلب التغيير أو سحبه»
    (sourceType COMMITTEE, the committee; normal priority SLA and
    escalation). It completes on Submit and is cancelled on Withdraw.
    Carried by **PR 2**.
  - **The departure:** a deactivated requester's open draft or returned
    request is withdrawn inside the deactivation, audited with cause
    `departure`. Carried by **PR 2b**, because it needs an engine entry
    point for a system move inside a caller's transaction and touches lane
    A's `user.service.ts`.
  - **Nobody else** may withdraw another person's draft;
    `CHANGE_REQUEST_NOT_REQUESTER` keeps its old meaning.
