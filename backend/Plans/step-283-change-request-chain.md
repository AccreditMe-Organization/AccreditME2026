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
  committee's deciding seat where one exists.
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
  | { kind: 'SELF_FINAL' }   // R heads the root, and no step before it had anyone
  | { kind: 'NONE' };        // nobody at all: only a root that is already headless

interface ChainResult { step: ChainStep; deciderIds: string[] }
```

- **SELF_FINAL** is when the root step's only people were R. R is the final
  authority: the request is approved at once (§4.3).
- **NONE** can happen only when the root is already headless, a legacy state
  ACC-288 lets stand ("logs and passes"). The request waits, and Setup health
  says so (§5).

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
count for 1 request and for 20.

---

## 4. Who may do what to a request

### 4.1 At each request stage

| Request stage | Action | Who |
| -- | -- | -- |
| draft, returned | edit, submit | R, still holding `committees:edit_details` (unchanged) |
| draft, returned | withdraw | R; **or a current decider of that request** (was: a `committees:approve` holder; Q8) |
| under_review | approve, return, reject | **a current decider** (was: a `committees:approve` holder who is not R) |
| under_review | withdraw | R only (unchanged) |
| closed | nothing | unchanged |

The committee's stage rules (`committeeAllowsRequestMove()`) still apply on
top, unchanged: approve and return need C in force, reject and withdraw always
work.

### 4.2 Vacant steps and the requester

- **A vacant step** is skipped and the decision moves up (§3.1). Nothing is
  refused for it.
- **The requester** is never a decider, except at SELF_FINAL. If R presses
  approve, return or reject they get `CHANGE_REQUEST_OWN_DECISION`, as today.
- **A member of C** is skipped below the root. If they press, they get
  `CHANGE_REQUEST_NOT_DECIDER`, naming the step that decides.
- **NONE** (no decider at all): Submit still succeeds and the request waits
  under review (Q7). Nobody can approve it until a head exists. Setup health
  shows it (§5). Reject and withdraw stay possible: R withdraws, and once a
  decider exists, they decide.

### 4.3 SELF_FINAL: the root head's own request

- **When:** at Submit, after the submit transaction commits, the chain is
  resolved. If it is SELF_FINAL, the service runs the ordinary approve path
  for R at once, in its own transaction, with the same lock order and the
  same drift and reference checks (Q14).
- **What is recorded:** the request record keeps its old and new values; the
  APPROVE audit row names R, with `authority: { kind: 'SELF_FINAL' }`; the
  "Revise the terms of reference" task is created for R, as for any approval.
- **If that approve fails** (a reference check, say), the request stays under
  review with R as its only decider. R sees Approve, Return and Reject, and
  may try again. Nobody else can decide it, because nobody else is in the
  chain.

### 4.4 The decision's audit row

Approve, Return and Reject add `authority` to their audit metadata: the step
(`REPORTS_TO_SEAT` with committee and seat ids, `UNIT_HEAD` with the unit id
and `isRoot`, or `SELF_FINAL`). Ids only.

### 4.5 Reads and notices

- **`actions` on every response** come from the chain: `approve`, `return` and
  `reject` are true when the viewer is a current decider and the stages allow
  it. A response with several requests resolves them in one batch, for the
  requests under review only (at most one open request per committee).
- **The response says who decides, by step, never by person:**
  `awaitingDecisionBy: { kind: 'REPORTS_TO_SEAT', committee: { id, nameEn,
  nameAr }, seats: [{ id, labelEn, labelAr }] } | { kind: 'UNIT_HEAD', unit:
  { id, nameEn, nameAr } } | { kind: 'SELF_FINAL' } | { kind: 'NONE' }`, only
  under review. A screen says "Awaiting the Chairman of the Medical Executive
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
  (existence-neutral). Whether a decider also opens the committee page is Q6.
- **Submit tells the deciders** of the step that decides (not R). SELF_FINAL
  tells nobody; NONE tells nobody (Setup health holds it). Decisions still tell
  R. A re-route sends no notice (Q9).

---

## 5. Setup health: a request that waits

**Type `CHANGE_REQUEST_WITHOUT_DECIDER`**, `BLOCKING`.

- **Open while** a request is under review and its chain is NONE. That
  happens only when the root is already headless.
- **One row per request.** `objectId` is the request id. The subject names the
  committee (`nameEn`, `nameAr`) and the request number; the committee's name
  is shown to any `setup:view` holder, like ACC-286's.
- **Age:** "waiting since", `openedAt` = the request's `submittedAt`.
- **The Fix** opens the root unit's Headship panel, with the permissions that
  panel's save needs (the same pair as `ORG_UNIT_WITHOUT_HEAD`'s Fix). Without
  them, the permission line says what is needed.
- **Cost:** per organisation per hourly run, one query for the requests under
  review, then one `resolveDecisionChains()` call (at most 9 queries). None if
  there is no request under review.
- **Two deploys** (CLAUDE.md's enum rule, ACC-286's shape):
  - **PR 1** adds the enum value, every reader (the type list, `AGE_BASIS`,
    the row wording in both languages, the Fix target) and lists it in
    `DEFERRED_SETUP_CONDITION_TYPES`, so nothing writes it;
  - **PR 3** adds the detector, after a rollback check proving PR 1's code
    ignores rows of the new type.

**Not a condition:** a request that has simply waited a long time. A decider
exists and the awaiting list shows it to them; ageing is a deadline matter,
not a setup gap (ACC-82).

---

## 6. Refusal codes

**New:**

| Code | Status | When | Details |
| -- | -- | -- | -- |
| `CHANGE_REQUEST_NOT_DECIDER` | 403 | approve, return or reject by someone who may read the request but is not a current decider | `awaitingDecisionBy` (the step, as in §4.5) |
| `SEAT_ACTION_UNKNOWN` | 400 | a seat-action map names an action not in `SEAT_ACTIONS` | `actionKey` |
| `SEAT_ACTION_SEAT_UNKNOWN` | 400 | it names a seat that is not an active `committee_member_role` value of this organisation (another organisation's included) | `roleValueId` |

**Kept, with a new meaning:**

- `CHANGE_REQUEST_OWN_DECISION` (409): R pressing approve, return or reject,
  except at SELF_FINAL.
- `CHANGE_REQUEST_NOT_REQUESTER` (403): withdraw by someone who is neither R
  nor (for a draft or returned request) a current decider.
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

**SELF_FINAL** is two transactions in sequence, each in its own order: Submit's
(the request's instance, the committee read FOR SHARE, the request row), then
Approve's.

**Editing seat actions in Formation:** the committee's instance FOR SHARE,
then the committee row FOR UPDATE (with the `expectedUpdatedAt` check), then
the seat-action rows. This is ACC-286's member-write order, so an edit and a
transition cannot deadlock.

**Committee create** writes the copied defaults inside its own transaction,
which has no prior lock.

**The backfill:** per committee, the committee row FOR UPDATE, then insert
only if none exist; one transaction per organisation with `BACKFILL_TX`.

**Never:** the root-head advisory lock (ACC-288). The chain only reads
headship and never changes it.

---

## 8. Migration

**Yes, one, additive, in PR 1** (`acc283_committee_seat_actions`):

- the table `CommitteeSeatAction` (§2);
- the `SetupConditionType` value `CHANGE_REQUEST_WITHOUT_DECIDER`, deferred.

Both are safe against the deployed code: nothing it runs reads the new table,
and no row can hold the new value until PR 3 writes it.

**No other migration:**

- nothing stores the chain (§3.3);
- seat actions in a change request are a key in the existing `changes` and
  `fromValues` JSON (PR 5);
- retiring `committees:approve` is a data backfill, not a schema change.

---

## 9. PR split

| PR | What | Migration | After the deploy |
| -- | -- | -- | -- |
| **1** backend | Seat actions: the registry, the table, the lookup defaults (attribute schema plus the SYSTEM values), copy on create, `GET`/`PUT /committees/:id/seat-actions` (Formation only), `seatActionsFor()`; the Setup health enum value, deferred, with every reader. Nothing decides by seat actions yet. | yes | `backfill:acc283-seat-actions` (dry run, execute, dry run 0) |
| **2** backend | The chain: `change-request-chain.ts`, decide/withdraw/awaiting/actions/notices/read admission on it, `awaitingDecisionBy`, `CHANGE_REQUEST_NOT_DECIDER`, the route gates dropped. `committees:approve` is no longer read (still in the catalogue). Open requests re-route on their next read. | no | none; deploy after PR 1's backfill has run, so deciding seats exist |
| **3** backend | The Setup health detector, after the rollback check. | no | the next hourly run |
| **4** backend | Retire `committees:approve`: out of `COMMITTEES_PERMISSIONS` and the seed; `backfill:acc283-retire-committees-approve` (dry run first, refuses customers, after PR 2 deploys); a spec failing if any non-spec source names it (`retired-task-keys.spec.ts`'s shape); the sentence table. Terms Review's seed assignment for new organisations (§10). | no | the backfill |
| **5** backend | Seat actions as a change-request field (the whole map is one field, Q12): preview, drift check, apply on approval, labels. | no | none |
| **6** backend | Section 1 enforcement: on their committee, a member may add, remove, change a seat and request a change where their seat allows it OR their role does (Ahmad, 10 Nov, item 1), replacing ACC-281's interim write rule (Q1). | no | none |
| screens | One per backend PR, by lane: the seat-actions editor in Formation and its lookup defaults; Awaiting for everyone, "Awaiting …" on the request, the new codes in both languages; the Setup health row; the request dialog's seat-actions field. | — | — |

PRs 2, 3 and 4 can each ship on their own once PR 1 has. Screens follow their
backend PR.

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
  everywhere; R alone at the root → SELF_FINAL; R and a second root head →
  the second decides; root headless → NONE; P not in force → skipped; an
  inactive unit skipped.
- **`change-request-chain.db-spec.ts`** (real Postgres): the same against real
  rows; the query count for 1 and 20 requests; tenant isolation (another
  organisation's committee, seat holder, unit and head planted, none resolved).
- **`committee-change-request.db-spec.ts`**: decide as a Reports-to seat
  holder, a unit head, a cover, a member of C (refused), R (refused);
  SELF_FINAL approves at Submit and writes the task; awaiting-decision for a
  decider, a non-decider (three queries), the cap, isolation; a re-route after
  a head change; withdraw of a draft by a decider.
- **`committee-seat-actions.db-spec.ts`**: copy on create with an override;
  Formation edit, refusals, stale save; the backfill's idempotence.
- **Mutations**, each turning a spec red: drop the requester skip; drop the
  member skip; apply the member skip at the root; stop the walk before the
  root; let the chain read `committees:approve`; resolve per request in a
  loop (the query-count pin); drop the organisation from the ancestor query.

---

## 13. The performance rule

- Nothing on the per-request path (TenantGuard, PermissionGuard, ModuleGuard,
  the throttler, interceptors, middleware, `verifySessionIdentity()`).
- The chain is resolved only inside the change-request reads and writes and
  the hourly detector, at most 9 queries for any number of requests; never in
  a row loop.
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

**Q4. The root head raises a request on a committee owned by a unit below
them:**
- **Recommend:** the chain as written. The owning unit's head decides, even
  though the requester is senior. Authority follows the committee's place in
  the structure.
- Alternative: skip every head below the requester, so the request goes
  straight to SELF_FINAL.

**Q5. Out of office:**
- **Recommend:** heads and acting covers in force only. No out-of-office
  acting-user substitution (the cover IS the substitute for headship).
- Alternative: replace an away decider with their acting user, like the stage
  pool.

**Q6. What a decider may open:**
- **Recommend:** the request (`GET /committee-change-requests/:id`), the
  awaiting list (which carries the full diff and labels), and the committee
  page read-only, while the request awaits them. The submit notice opens the
  committee, where the banner is.
- Alternative: the request only, with the notice opening Awaiting my action.

**Q7. Submit when the chain is NONE:**
- **Recommend:** accept; it waits, and Setup health shows it.
- Alternative: refuse Submit with a new code.

**Q8. Withdrawing someone else's draft or returned request** (was: a
`committees:approve` holder):
- **Recommend:** a current decider of that request.
- Alternative: the requester only.

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

**Q14. SELF_FINAL timing:**
- **Recommend:** a second transaction right after Submit, the ordinary approve
  path. If it fails, the request waits with R as its only decider.
- Alternative: one transaction for both moves. The engine's
  `triggerSystemTransition` opens its own transaction, so this would need an
  engine change.

**Q15. Naming who decides:**
- **Recommend:** by step (the committee and seat, or the unit), never by
  person, so no `users:view` question arises.
- Alternative: also name the people.
