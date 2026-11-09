# Step 282 — A committee member in the stage's pool sees and presses their moves, and votes

Linear: [ACC-282](https://linear.app/accreditme/issue/ACC-282). Branch:
`feature/ACC-282-pool-member-moves`, from `dev` at `64f7113` (ACC-281). Lane B. **Built; §10 says where the build departs
from the plan.**

**What Ahmad asked (8 Nov):** a committee member in the current stage's pool can see and press
their moves, and vote, without `workflows:view`.

**Ahmad's answers (8 Nov, second round). They override §2–§4 where they differ:**

1. **Read, not Empty.** Anyone who may open the record by ACC-281's rule (`committees:view`,
   or an active member of that committee) may READ its workflow: the instance list,
   `GET /instances/:id` and stage history. The committee page's Lifecycle card and Stage
   history show for them.
   - **Moves stay pool-only:** the moves read lists moves only for someone in the current
     stage's pool, and an empty list for anyone else who may open the record.
   - **Anyone who may not open the record** gets exactly the refusal a missing record gets,
     as today.
2. **Stage history:** open by the rule in 1.
3. **Yes.** Pressing a move and voting also check that the caller may open the record, in the
   same place as the pool check, with the identical not-found refusal.
4. **Yes.** `GET /instances/:id` follows the same rule.
5. **Yes.** The moves read carries each move's label and the next stage's name, and the
   buttons stop reading `GET /workflow-templates/:id`.
6. **Yes.** The four by-id reads are scoped by organisation in the same `where`.
7. **Live, including pressing.** After the deploy: a temporary committee-role pool entry on
   one al-nakheel committee's current stage, then three personas without `workflows:view`
   (a pool member, a member outside the pool, a non-member), a vote if a committee sits on a
   voting stage, and the entry removed afterwards.

**Read for this plan:**

- ACC-282;
- `backend/Plans/step-281-member-committees.md` (Q4);
- SYSTEM-REFERENCE §2.19 (stage pools), §1.9 (parent visibility), §3.21 (members);
- `foundation/workflow/workflow.controller.ts`, `workflow.service.ts` and `stage-pool.service.ts`;
- `workflow-template.controller.ts`;
- the committee page, `workflow-transition-actions` and `workflow-stage-indicator`.

---

## 0. What a pool member gets today, and one fact about the live data

**Today a member without `workflows:view` gets no buttons.** Since ACC-281 the page sends the
instance read only with `workflows:view`, so `currentInstance()` stays null and the buttons
component never renders.

**The services already admit members; only the routes stop them.**
`getInstanceByIdForViewer()`, `getInstancesByObject()` and `getStageHistory()` all pass
`viewerId` to the parent check (ACC-281), so a member already passes it. What refuses them is
the route-level `@Permissions(workflows:view)`.

**Live, no committee member is in any committee stage's pool yet.** Read-only, 8 Nov:

| Organisation | Template | Pool entries |
| -- | -- | -- |
| al-manara | COMMITTEE | 6, all `SPECIFIC_USER`, all the seeded starting assignment |
| al-nakheel | COMMITTEE | 6, all `SPECIFIC_USER`, all the seeded starting assignment |
| both | COMMITTEE_CHANGE_REQUEST | 6 `CREATOR` (moves there are the app's own) |

The starting assignment is the first tenant admin (ACC-271 PR 2), who holds `workflows:view`.
**So this ticket changes nothing a person sees until a tenant puts a COMMITTEE (or other) entry
on a committee stage.** It is still the right change, because the stage editor offers exactly
that today. The live proof needs one such entry (Q7).

---

## 1. Every route the page calls to show and press a move, and to vote

| Route | Gate today | Called by | A pool member needs it? |
| -- | -- | -- | -- |
| `GET /workflows/instances?objectType=COMMITTEE&objectId=` | route `workflows:view`; service: parent check, before any read (clause a) | committee page, `loadCurrentStage()` (`committee-detail.component.ts:885`) | **Yes**: it is how the page gets the instance the buttons hang on |
| `GET /workflows/instances/:id` | route `workflows:view`; service: read, then parent check, else 404 (clause b) | **nobody** (no frontend caller) | No. It gets the same rule for consistency (Q4). |
| `GET /workflows/instances/:id/moves` | route `workflows:view`; service: as `/:id`, then the current stage's pool (`workflow.service.ts:283-319`) | `workflow-transition-actions.component.ts:178` | **Yes**: which buttons to draw |
| `GET /workflows/instances/:id/stage-history` | route `workflows:view`; service: as `/:id` | `workflow-stage-indicator.component.ts:193`: the Lifecycle card and the Stage history panel | **No** (§4) |
| `POST /workflows/instances/:id/transitions` | no route permission; service: the pool (`workflow.service.ts:586-587`) | `workflow-transition-actions.component.ts:127` | **Yes**: pressing a move. **It is also the vote**: on an ALL or COMMITTEE_VOTE stage, naming the move IS the vote (`workflow.service.ts:636-668`). |
| `POST /workflows/instance-stages/:id/approvals` | no route permission; service: the pool (`workflow.service.ts:735-736`) | **nobody** (`submitApproval()` has no frontend caller, ACC-208) | Not by the page. It keeps working for an API caller in the pool. |
| `GET /workflow-templates/:id` | route `workflows:view` (`workflow-template.controller.ts:270-277`) | `workflow-transition-actions.component.ts:177`: the move labels, and the to-stage name for "Can't move yet" | **Yes, today**, which is why the page should stop calling it (below) |

**The page can stop calling `GET /workflow-templates/:id` from the buttons**, for everyone.
The moves read returns, additively, what the buttons draw (Q5):

```ts
{
  transitionIds: string[],
  moves: { id, labelEn, labelAr, kind, toStageId, toStageNameEn, toStageNameAr }[],
}
```

That costs **no extra query**: the transitions are already read (`workflow.service.ts:298-302`).
The select gains the labels, `kind`, and `toStage { nameEn, nameAr }`.

**The page stops calling `stage-history` for a viewer without `workflows:view`** (§4, §6).

---

## 2. The rule, and where it lives

**The rule.** A viewer may read the record's instance, and its moves, when they hold
`workflows:view` (exactly today's rule), **or** when both of these are true:

- **they may see the record** by ACC-281's rule (`ObjectVisibilityService.assertCanView(…,
  viewerId)`: `committees:view`, or active membership of THAT committee);
- **they are in the current stage's pool** (`StagePoolService`, `mayActInStagePool()`).

**Anyone else gets exactly the refusal a missing record gets:**
- **Read-first routes** (`/:id`, `/:id/moves`): 404 "Workflow instance not found", the same as
  an invented id. The cause goes in the refusal log line, as today (ACC-101 clause b).
- **The named-parent route** (`GET /instances?objectType=&objectId=`):
  - if the viewer may not see the record, the parent check's 403, identical for a hidden record
    and an invented one (ACC-101 clause a, unchanged);
  - if they may see it but are in no pool, **an empty list**. That is the answer a visible
    record with no workflow gets, so nothing tells them a workflow exists (Q1).

**Where: ONE place, `foundation/workflow/instance-access.service.ts`** (a new
`InstanceAccessService`, provided by `WorkflowModule`). It uses `ObjectVisibilityService` and
`StagePoolService`, both already injected next door.

| Method | Use |
| -- | -- |
| `admitOne(instance, org, viewer)` | the read-first routes. Returns the pool it resolved, so the moves read does not resolve it twice. Otherwise throws the 404. |
| `readable(instances, org, viewer)` | the list route. Keeps only the in-progress instances whose current stage's pool holds the viewer, with **one** `resolveMany()` for all of them. |

`WorkflowService` keeps no copy. The three read routes lose `@Permissions(workflows:view)`, and
each calls the service, which asks `InstanceAccessService`. The controller stays routing only.

**Batching and cost:**

- **A `workflows:view` holder:** today's path and today's queries. Nothing is added.
- **Anyone else, on the list route:**
  - the parent check: one indexed membership query, or one exists query for a
    `committees:view` holder;
  - the instances: today's `findMany`;
  - **one** `resolveMany()` for the in-progress instances' current stages. A record has one in
    progress, and the pool is resolved by kind, never per person.
- **Anyone else, on the moves route:**
  - the instance read, the parent check, and the stage and transitions (parallel, as today);
  - **one pool resolution, shared** by the access check and the moves answer.
- **No query on the per-request path.** TenantGuard, PermissionGuard, ModuleGuard, the
  throttler, interceptors, middleware and `verifySessionIdentity()` are untouched. The check
  runs inside these routes only, and only for a caller without `workflows:view`.
- **No polling. No query in a row loop. The answers stay small**: the list is one record's
  instances, and the moves are one stage's.

---

## 3. Someone who may see the record but is NOT in the pool

**Recommendation: they get nothing workflow-shaped (Q1 "Empty"):**
- the list returns `[]`;
- `/:id` and `/:id/moves` return the 404.

**Why:**
- **It keeps one rule** ("in the pool, or `workflows:view`"), with no second tier of what a
  record-viewer may read.
- **It discloses nothing new.** The stage they need is already on the committee read
  (`currentStageNameEn/Ar`, ACC-281), so the header still says where the committee stands.
- **It matches the page**: no instance, so no buttons, no Lifecycle card and no extra request.

**The alternative ("Read"):** admit the instance read for anyone who may see the record, with
moves `[]`. That gives the instance's status and current stage id, which the page has no use
for without `workflows:view` (§4). It would also make `GET /instances` a record-level read,
for no screen that needs it.

---

## 4. Stage history

**Recommendation: it stays `workflows:view` only (Q2 "Keep").**

- **It is the richest of the reads:** who acted at every stage, their delegation labels and
  their comments, across every past visit (ACC-76, ACC-101). A pool member needs to act on the
  stage they are in now; the history is oversight, which is what `workflows:view` is for.
- **The page follows:** without `workflows:view` it renders neither the Lifecycle card
  (`show="sequence"`) nor the Stage history panel (`show="history"`), both of which read it. The
  header still shows the stage name and the buttons.
- **The alternative ("Open"):** admit pool members to it as well (same `admitOne()`). Then the
  page shows them the Lifecycle card and history. That widens what a pool member learns about
  past stages they were not part of.

---

## 5. Pressing a move and voting already enforce the pool

**Confirmed, from the code:**

- **`triggerTransition()`, which is also the vote** on a multi-approver stage:
  - `workflow.service.ts:576-583`: the move must be a person's (`MOVE_HAS_NO_MOVER`, or 403 for
    an app move);
  - **`workflow.service.ts:586-587`**: `stagePool.resolve()`, then `assertInStagePool()`.
    `STAGE_HAS_NO_ONE` for an empty pool, `NOT_IN_STAGE_POOL` for anyone outside it;
  - the deciding vote is gated (`:598-620`), and the vote is recorded (`:645`);
  - `performTransition()` checks again under the instance lock.
- **`submitApproval()`**: **`workflow.service.ts:735-736`**, the same two calls, before the vote
  is recorded (`:740`, `assertDecidingVoteMayAdvance`).
- **The rule itself** is `mayActInStagePool()` (`stage-pool.service.ts:63-65`), the one copy.

**Two gaps, both small, recommended here (Q3, Q6):**

1. **Neither POST checks that the caller may see the record.** A pool entry can name anyone (a
   `SPECIFIC_USER`, a position holder, a unit head), so someone outside the committee without
   `committees:view` may press a move on a record they cannot open. That includes a *former*
   member still named in a `SPECIFIC_USER` entry.
   - **Recommended (Q3 "Yes"):** the same parent check (with `viewerId`) runs first. A refusal
     is 404 "Workflow instance not found", identical to an invented id.
   - **No live effect:** every pool is the tenant admin today (§0).
2. **Four by-id reads in those two methods name no organisation:**
   - `workflowTransition.findFirst({ id, fromStageId })` (`:564-566`);
   - `workflowStage.findFirst({ id })` (`:571`, `:722`);
   - `workflowInstance.findFirst({ id })` (`:727-729`).

   Each is reached through an organisation-scoped read, so none leaks today. But CLAUDE.md's
   rule is the query shape, not the reachability. **Recommended (Q6 "Yes"):** scope all four,
   each with a cross-tenant spec.

---

## 6. The record page, for a member

- **The instance read is sent for every viewer the page admits** (the record already loaded,
  so the viewer may see it). Only the answer differs:

  | Viewer | `GET /instances` answers | The page shows |
  | -- | -- | -- |
  | `workflows:view` holder | as today | as today: buttons, Lifecycle card, Stage history |
  | pool member without it | the in-progress instance | **buttons only**, in the header, from the moves read |
  | anyone else | `[]` | no buttons, no Lifecycle, no history: the header's stage name only |

- **The buttons read the moves read only** (Q5): labels, kind and the to-stage name for "Can't
  move yet". No template read.
- **The Lifecycle row and Stage history render only with `workflows:view`** (Q2). Without it
  the page sends no `stage-history` request.
- **After a press**, the page reloads the committee and the instance, as today. If the next
  stage's pool does not hold the member, the list comes back `[]` and the buttons go. Nothing
  stale stays clickable (ACC-54's rule).
- **Nothing the server would refuse is shown or sent.** Every button is a move the server
  listed for this viewer, and every request is one the rule admits.
- **Unchanged:**
  - The change-request page still reads its instance only with `workflows:view`. The
    `COMMITTEE_CHANGE_REQUEST` parent rule stays view-only (ACC-281), and that page's moves are
    the app's own. A member opening it gets no stepper and no history, as today.
  - Home's Awaiting my action already lists a member's committee stages (ACC-281). This ticket
    is what lets them act once they open the record.

---

## 7. Specs

**Required (Ahmad, 8 Nov):** a pool member, a non-pool member who may see the record, a former
member, a `workflows:view` holder, and another organisation's record, named for the isolation
gate.

**Backend, `instance-access.service.spec.ts`** (unit):

| Case | Expected |
| -- | -- |
| holder | today's path; no pool resolved (the call count is 0) |
| pool member | admitted; one `resolveMany()` for any number of instances |
| record-viewer outside the pool | the 404 for one instance; `[]` for the list |
| former member | refused by the parent check, before any pool is read |
| `itEnforcesTenantIsolation('instance access')` | another organisation's instance gets the identical 404; every query names the organisation |

**Backend, `pool-member-moves.db-spec.ts`** (real Postgres on 55432):
- **Setup:** a committee on a converted stage with a COMMITTEE pool entry.
- **Five callers:** a member in the pool; a member outside the pool (the entry narrowed to a
  seat they do not hold); a former member; a `workflows:view` holder; and another
  organisation's member.
- **Each caller against:** `GET /instances`, `/:id`, `/:id/moves`, `/:id/stage-history`,
  `POST /transitions` and `POST /approvals`.
- **Assertions:**
  - the identical refusal for a real and an invented id;
  - a pool member's press advances an ANY_ONE stage;
  - on an ALL stage, a member's press records a vote and moves the record only on the last
    one;
  - stage history refuses everyone without `workflows:view`;
  - the cross-tenant case is named for the gate.

**Backend, the rest:**
- **Existing specs updated:** `workflow.controller.spec.ts` (the three read routes carry no
  `@Permissions`; stage-history and cancel keep theirs, pinned by key) and the moves read's
  added fields.
- **Q3, Q6:** a POST by a pool member who may not see the record gets the 404. The four by-id
  reads assert the organisation in their `where`.
- **Mutation-checked:** drop the pool clause; drop the parent check; count a former member; let
  stage history admit a pool member.

**Frontend:**
- **`committee-detail`:** a pool member without `workflows:view` sees the buttons and sends no
  `stage-history` or template request. A non-pool member sees no buttons and sends no moves
  request. A holder is unchanged.
- **`workflow-transition-actions`:** labels and "Can't move yet" come from the moves read; no
  template request.

---

## 8. Questions for Ahmad (one word each; the recommendation is marked)

1. **Someone who may see the record but is not in the pool.** **Empty** (recommended: `[]` and
   the 404, §3) / Read.
2. **Stage history.** **Keep** (recommended: `workflows:view` only, §4) / Open.
3. **Pressing and voting also check that the caller may see the record** (the 404 otherwise,
   §5). **Yes** (recommended) / No.
4. **`GET /instances/:id`** (no frontend caller) takes the same rule as the other two reads.
   **Yes** (recommended: one rule) / No (stays `workflows:view`).
5. **The moves read carries the labels and to-stage names**, so the buttons stop reading the
   template, for everyone (§1). **Yes** (recommended) / No.
6. **Scope the four by-id reads in the two POSTs by organisation** (§5). **Yes** (recommended).
7. **The live proof:** a temporary COMMITTEE pool entry on one al-nakheel committee stage,
   added and removed through the stage editor (both audited), or the db-spec only.
   **Live** (recommended: §0, nothing live exercises it otherwise) / Specs.

---

## 9. Progress

- [x] Plan (this file), committed, not pushed
- [x] Ahmad's answers to §8 (8 Nov)
- [x] Backend: `InstanceAccess`, the four reads, the moves' labels, the POSTs (Q3, Q6), the
      change request's member clause, specs
- [x] Frontend: the page's instance read for everyone it admits, the buttons from the moves
      read, specs
- [x] Docs: SYSTEM-REFERENCE §2.19.1 (new) and §3.21; CLAUDE.md Key Architecture Decisions
      (ACC-282)
- [x] /ready-to-pr (Ahmad)
- [ ] The live check (Q7), after the deploy

---

## 10. As built (8 Nov)

Where the build departs from the plan text above (§2–§6 predate Ahmad's answers), and why.

- **The rule is `InstanceAccess`, a plain class in `foundation/workflow/instance-access.ts`**,
  not an injectable `InstanceAccessService`. `WorkflowService` builds it in its constructor
  from the two services it already injects (`ObjectVisibilityService`, `StagePoolService`).
  - A new constructor argument would have broken the six db-specs that build
    `WorkflowService` by hand, for no gain.
  - It is still the one place the rule lives.
- **Reading is the parent rule alone** (Ahmad's answer 1), so the batched
  `readable(instances, …)` and the list's pool filter of §2 were not built. The list returns
  every instance of a record the viewer may open. The only pool read is the moves read's
  (and a press's), one each.
- **A change request's workflow admits members of its committee.** The parent rule for
  `COMMITTEE_CHANGE_REQUEST` gained a member clause: one query on the membership, its
  committee and the request together.
  - This follows answer 1, because a member may open a change request (ACC-281).
  - Without it, the change-request page's stepper and history would stay hidden from the
    members who may open it.
- **The "Can't move yet" line's stage name comes from the page** (`stageLabel`), because
  the buttons no longer read the template.
- **A seed quirk found, not changed:** the committee template's Approve moves are not
  approval-path moves (`isApprovalPath` false), so on an ALL stage a single press of one
  fires at once. Committee stages are ANY_ONE in the seed, so nothing live is affected. The
  db-spec's vote case marks Approve as the approval path.
