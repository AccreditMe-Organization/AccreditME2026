# Step 281 — Committee members open their own committees, and the paged Awaiting my action read

Linear: [ACC-281](https://linear.app/accreditme/issue/ACC-281). Branch:
`feature/ACC-281-member-committees`, from `dev` at `96e94cb`. Lane B. **Built; §13 says where the build departs from the plan.**

**Decided (Ahmad, 7 Nov):**

- A full user who is an ACTIVE member of an active committee may open that committee, even
  without `committees:view`. Being a member is the entitlement: ACC-101's rule for self-scoped
  reads, as Home's My committees (ACC-279) already applies it.
- Everyone else keeps today's rule, with the identical answer for a committee they may not see.

**Ahmad's answers (7 Nov, second round): they override the recommendations below where they
differ.**

- **`committees:view` stays as it is.** Any role holding it sees every committee, for
  oversight, and acts on any of them with each action's own permission. Membership adds access
  to a member's OWN committees for people without `committees:view`. A non-member without it
  sees none.
- **Members see ALL of their committee's details, read only:** the page, members,
  sub-committees, **Membership history and change requests** included. This changes Q3 and
  Q5.
- **Writes (§5):** a committee write is allowed when the caller holds **that action's own
  permission AND (holds `committees:view` OR is an active member of THAT committee)**.
  - The stage rules still apply on top.
  - A non-member without `committees:view` gets the identical refusal a missing committee gets.
  - **Deciding a change request** (approve, return, reject) is NOT opened to members. It stays
    exactly as today: `committees:view` and `committees:approve`, never the requester.
  - This is the interim rule until ACC-283 replaces it.
- **Q1, Q2 and Q6–Q10: as recommended.**
- **The "beyond the brief" items are in scope:**
  - the committee page stops loading what the viewer can't read;
  - the committee read names its parent and reports-to;
  - the list names each row's type. It already does (`typeValue`); the list page stops asking
    the lookup.
- **Q4: not here.** The follow-up is [ACC-282](https://linear.app/accreditme/issue/ACC-282)
  (High), built straight after this ticket and before ACC-280.
- **Governance** is [ACC-283](https://linear.app/accreditme/issue/ACC-283) (High). Seats decide
  what members may do, and the chain of authority decides changes. It replaces §5's interim
  rule.
- **Two small fixes ride this PR:**
  - `MyWorkCountsService.init()` does nothing for a platform admin;
  - `committee.memberForm.joinedHint` becomes «اليوم، ما لم يكن الانضمام قد تمّ قبل ذلك.»

**Read for this plan:**

- SYSTEM-REFERENCE §1.9 (parent visibility), §3.17 (committee edits), §3.19 (task visibility),
  and the committee page and list sections;
- `common/services/object-visibility.service.ts`;
- the committees controller and service, `committee-lists.service.ts`, and the change request
  controller and service;
- `workflow-awaiting.service.ts`, `task-visibility.ts`, `task-record-names.ts`;
- `core/navigation/nav-items.ts` (the Committees item) and `core/guards/permission.guard.ts`;
- `foundation/home/my-work-counts.service.ts`;
- the committee detail and list components.

---

## 0. What a member sees today, and why it breaks

- **Home is fine.** Home's My committees names the person's committees (ACC-279).
- **Everything past Home is closed.** The committee page, `GET /committees/:id` and every child
  read carry `@Permissions(committees:view)`. `BASE_USER`, the role every staff member holds,
  does not have it. So for most members:
  - Home names a committee they cannot open;
  - Awaiting my action never lists a committee stage that waits on them, even when they are in
    its pool. `awaitingMe()` first narrows to `recordTypesVisibleTo(permissions)`.
- **The frontend guard refuses before the server is asked.** `permissionGuard` reads
  `ROUTE_PERMISSIONS`, where `committees` needs `committees:view`, so a member never reaches
  `/committees/:id` at all.

---

## 1. The one membership rule

**Who counts as a member:**

- a `CommitteeMember` row with `isActive: true`;
- on a `Committee` with `isActive: true`;
- in the caller's organisation, matched by `{ committeeId, userId, organizationId }`.

A departed member (`leftAt` set) and a member of a dissolved, inactive committee are not
members. The user is ACTIVE by construction, because TenantGuard admits nobody else.

**Where the rule lives: one place**, `common/services/committee-membership.ts` (§13):

- `isActiveMember(client, committeeId, userId, organizationId): Promise<boolean>`: **one**
  `findFirst` on the `(committeeId, userId)` unique index.
- `memberCommitteeIds(client, userId, organizationId, among?: string[]): Promise<Set<string>>`:
  **one** `findMany`, for lists and batches. It is never called once per row.

### How it enters the parent rule

`ObjectVisibilityService` gains an optional member clause, for COMMITTEE only:

```ts
COMMITTEE: {
  permission: 'committees:view',
  exists: …,                                   // unchanged
  member: (id, organizationId, viewerId) => isActiveMember(this.prisma, id, viewerId, organizationId),
}
```

- **The new signature:** `assertCanView(type, id, org, permissions, viewerId?)` and
  `assertCanViewOrNotFound(…, viewerId?)`.
- **When the caller holds the permission:** exactly today's behaviour and today's queries.
- **When the caller lacks it and passes a `viewerId`:** one membership query.
  - **Member:** admitted. The active committee exists, by the query's own join.
  - **Non-member:** today's refusal, unchanged. `assertCanView` answers 403 naming
    `committees:view`. `assertCanViewOrNotFound` answers the caller's own 404.
  - **Still existence-neutral (ACC-101 clause a):** the membership query returns nothing both
    for a real committee the caller is not on and for an invented id, so the two answers are
    identical. See **Q1**.
- **Only the parent check gains the clause.** `COMMITTEE_CHANGE_REQUEST`'s rule stays
  `committees:view` (§2, row 8). `MEETING` is not built.
- **Every caller passes `viewer.id`.** That is the 8 call sites: task draft, task admission,
  record list, task create, workload, and the workflow service's 3. A call site that omits it
  keeps today's rule exactly, so forgetting one fails closed.

---

## 2. Every committee read, for a member without `committees:view`

**The ACC-101 check** in the last column: does the read show the member something about a
record they are party to, and nothing they would not learn by being on the committee?

| # | Read | Gate today | Member without `committees:view` | ACC-101 check |
|---|---|---|---|---|
| 1 | `GET /committees/:id`, the page's record | `@Permissions(committees:view)` | **Yes**, for their own committee | The committee they sit on. The record includes its type and owning unit (ACC-265). |
| 2 | `GET /committees`, the list | `committees:view` | **Yes, their own committees only** (§3) | Self-scoped, like `/committees/mine`. |
| 3 | `GET /committees/:id/members` and `/members/page`, the roster | `committees:view` | **Yes** | They sit on it with these people. The rows carry name, seat and joined date only (no email, no status). |
| 4 | `GET /committees/:id/sub-committees` | `committees:view` | **Yes; links only where the viewer may open the child** (see **Q2**) | The child committees are part of this committee's terms (who reports to it). A child's name is shown; its page opens only for its own members or `committees:view` holders. |
| 5 | Parent and Reports to, named on the record | the page reads `GET /committees` to name them | **Named by `GET /committees/:id` itself** (additive: `parent` and `reportsTo` as `{ id, nameEn, nameAr }`); **linked only where the viewer may open them** (see **Q2**) | Same reasoning as row 4. Reading every committee to name two would hand a member the whole list. |
| 6 | `GET /committees/:id/membership-events`, Membership history | `committees:view` | **Yes** (Ahmad, 7 Nov: a member sees all of their committee's details) | The roster's history on the committee they sit on, read only. |
| 7 | Stage history, the current instance, moves (`GET /workflows/instances?objectType=COMMITTEE&objectId=`, `/instances/:id/stage-history`, `/instances/:id/moves`) | `@Permissions(workflows:view)` + parent check | **The parent check admits members; the route keeps `workflows:view`** (see **Q4**) | Unchanged for the holders of `workflows:view` (QUALITY_MANAGER, VIEWER…). BASE_USER does not hold it, so in this ticket a BASE_USER member reads the current stage from row 1, not from the instance. |
| 8 | Change requests (`GET /committees/:id/change-requests`, `/open`, `GET /committee-change-requests/:id`) | `committees:view` | **Yes, read only** (Ahmad, 7 Nov) | Proposals to amend their own committee. A request by id is admitted when the viewer may see its committee. Anyone else gets "Change request not found", identical to a missing one. |
| 9 | Tasks panel (`GET /tasks/record-panel?sourceType=COMMITTEE&sourceId=`) and See all (`record-list`) | `assertCanView(COMMITTEE)` then `taskVisibleSql` | **Yes, through the parent check; the rows are their own tasks** (scope `own`, §4) | Each row is a task the member is on, created, or may pick up. Nothing else. |
| 10 | Files | Only tasks own files (`StoredFileOwnerType` is `TASK`); `TaskAdmissionService` | **Unchanged**: a task's files follow the task (ACC-231) | Committees have no files of their own. |
| 11 | `GET /committees/form-choices` | `committees:create` or `edit_details` | **No.** It is for writes. | — |
| 12 | `GET /committees/mine` | none (ACC-279) | unchanged | — |

**The committee page changes to match** (lane B, `committee-detail.component.ts`):

- **It loads only what this viewer may read:**
  - Membership history only with `committees:view`;
  - the instance and moves only with `workflows:view`;
  - the users list and the role lookup only for a viewer who can open a member dialog
    (`add_member` / `change_member_role`);
  - `GET /committees` no longer, since row 5 names the parent and Reports to.
- **A read the viewer may not make is not sent.** Its panel is absent, never a 403 drawn as an
  error.
- **`listMembers()` stays a load-blocking read.** It now succeeds for a member.

---

## 3. `GET /committees` for a member

- **The route loses its `@Permissions`.** The service decides, the shape `GET /tasks/views`
  uses:
  - **with `committees:view`:** today's list, every committee in the organisation, today's
    queries;
  - **without it:** only active committees the caller is an active member of. That is one
    extra condition on the same `findMany`
    (`members: { some: { userId, isActive: true, organizationId } }, isActive: true`). No
    query is added.
  - **A caller who is neither:** an empty list. It costs no 403, because the rail never shows
    Committees to them (§6).
- **Hard cap:** the list is bounded by the organisation's committees as today (one
  organisation's committees). A member's own list is bounded by their memberships. No paging
  is added: the list page pages in memory, as it does now.
- **The list's Type column and filter:** today they label types from
  `GET /lookups/committee_type` (`lookups:view`). The list read gains each row's `typeValue`
  label (additive, the same batch the detail read uses), and the filter takes its options
  from the rows. A member without `lookups:view` then sees type names.

---

## 4. Task visibility: no change to `taskVisibleSql`

**Recommendation: membership does NOT widen task visibility.** Relationships stay the only way
in for someone without a task key (ACC-244, Q1: creator, ever an assignee, in the pool while
it waits).

- **Why not.** A committee's tasks are work assigned to particular people. A member who is
  not on a task has no part in it. `committees:view_all_tasks` exists for that.
- **Where pools already reach members:** pools already include the members a committee role
  targets (`poolsOfUser`), so a member's pool tasks are visible today.
- **What changes for a member is only the parent check.** The record panel's
  `assertCanView(COMMITTEE)` admits them, and the rows are `taskVisibleSql` exactly as today:
  scope `own`.
- **`recordNamesOf()` names a member's committee:** a record's name is shown only to a viewer
  who may open it (ACC-228), and a member now may.
  - It gains an optional `viewerId`.
  - For committee ids the permission does not cover, **one** `memberCommitteeIds()` query,
    not one per row.
  - Its 7 callers pass the viewer.

---

## 5. Writes: the action's own permission, AND (`committees:view` OR membership of THAT committee)

**The interim rule (Ahmad, 7 Nov), until ACC-283 gives seats their actions.** A committee write
is allowed when the caller:

- holds **that action's own permission**, and
- **either** holds `committees:view`, **or** is an active member of the committee written to.

**The stage rules (ACC-255) still apply on top**, after this check, exactly as today. A
non-member without `committees:view` gets **the identical refusal a missing committee gets**:
404 "Committee not found", or "Change request not found" on a route that names a request.

**Every refusal code is kept.** A member who passes the access check meets today's checks in
today's order:

- `STAGE_ACTION_NOT_ALLOWED`;
- the change-request codes (`CHANGE_REQUEST_NOT_ALLOWED`, `CHANGE_REQUEST_NOT_REQUESTER`,
  `CHANGE_REQUEST_ALREADY_OPEN`, …);
- the reference checks;
- `COMMITTEE_CHANGED`.

| # | Write | The action's own permission (unchanged) | Opened to members of THAT committee | Then, as today |
|---|---|---|---|---|
| W1 | `PATCH /committees/:id`, edit details | `committees:edit_details` (route) | **Yes** | the stage allows `edit_details`; the reference checks; the stale-save check |
| W2 | `POST /committees/:id/members`, add a member | `committees:add_member` (route) | **Yes** | the stage allows `add_member` |
| W3 | `DELETE /committees/:id/members/:memberId`, remove a member | `committees:remove_member` (route) | **Yes** | the stage allows `remove_member` |
| W4 | `PATCH /committees/:id/members/:memberId`, change a seat | `committees:change_member_role` (route) | **Yes** | the stage allows `change_member_role` |
| W5 | `POST /committees/:id/change-requests`, create (draft or submit) | `committees:edit_details` (service) | **Yes** | one open request per committee; IN_FORCE |
| W5a | `PATCH /committee-change-requests/:id`, edit your own draft | `committees:edit_details` (service) | **Yes, as part of create** | the requester only; the stage allows `edit` |
| W5b | `POST /committees/:id/change-requests/preview`, what approving would do | none of its own (a read for Request a change) | **Yes** | — |
| W6 | `POST /committee-change-requests/:id/submit` | `committees:edit_details` (service) | **Yes** | the requester only; the stage allows `submit` |
| W7 | `POST /committee-change-requests/:id/withdraw` | the requester, or `committees:approve` where the stage lets others withdraw | **Yes** | the stage allows `withdraw` |
| D1 | `POST …/:id/approve` | `committees:view` (route) + `committees:approve` (service) | **NO, exactly as today** | never the requester |
| D2 | `POST …/:id/return` | as D1 | **NO** | as D1 |
| D3 | `POST …/:id/reject` | as D1 | **NO** | as D1 |
| — | `POST /committees`, create a committee | `committees:create` | n/a (there is no committee to be a member of yet) | unchanged |

**W5a is included deliberately.** Without it a member could create a draft but not finish it.
Editing a draft is the same `edit_details` action on their own request. Say if it should be left
out.

**How:**

- **The route-level `committees:view`** comes off W5–W7 and the change-request reads. D1–D3 keep
  it.
- **One assertion, `assertMayWriteCommittee(client, committeeId, org, viewer)`** (§13),
  runs before the committee's row is read or locked:
  - `committees:view` → nothing read;
  - otherwise one membership query;
  - otherwise 404 "Committee not found".
- **For a route that names a request**, the request's committee is read with the request (already
  done), then asserted, with "Change request not found" for a refusal.
- **The committee writes' services gain the caller's permissions** (they take only the actor id
  today).
- **A member who left is refused at once.** The check is live on every write, inside the request
  that writes.

## 6. The rail and the route guard (lane A's `nav-items.ts`)

`nav-items.ts` and `permission.guard.ts` are lane A's. This ticket provides the signal and
states the change. **It does not edit those files.**

**Provided by lane B:** `MyWorkCountsService.isCommitteeMember`, a `computed()`:

```ts
/** True once My committees has loaded with at least one committee; false otherwise. */
readonly isCommitteeMember = computed(() => {
  const c = this.myCommittees();
  return c.state === 'ready' && c.value.total > 0;
});
```

It needs no new query: `GET /committees/mine` is already read at sign-in (ACC-279).

**Lane A changes, exactly:**

1. **The Committees nav item gains an alternative to its permission.** Proposed shape:
   `orWhen: 'committeeMember'` beside `requiredPermission: 'committees:view'`.
   `isNavItemVisible()` shows it when the permission is held **or**
   `access.isCommitteeMember()` is true. `NavAccess` gains `isCommitteeMember(): boolean`,
   which `NavigationAccessService` answers from `MyWorkCountsService.isCommitteeMember`.
2. **`permissionGuard` admits a `committees` route the same way.** The required list stays
   `['committees:view']` in `ROUTE_PERMISSIONS`, so the map's meaning is unchanged. An entry
   whose item has `orWhen: 'committeeMember'` also passes when `isCommitteeMember()` is true.
   - **While My committees is still loading**, the answer is unknown, and unknown is not
     negative (the guard's own ACC-70 rule): it lets the navigation through and the server
     decides.
3. **Nothing else.** The guard is defence in depth. The server's §1 rule is the boundary, and
   a member of committee A opening committee B gets B's refusal from the API.

**Until lane A ships 1 and 2**, the server side of this ticket is complete. The links from
Home's My committees reach the page only once the guard admits members. See **Q6** on the
order.

---

## 7. `GET /workflows/awaiting-me?skip=&take=`

- **The DTO** (`AwaitingMeQueryDto`):
  - `skip`: an int ≥ 0, optional.
  - `take`: an int from 1 to 50, optional. Anything else, including a non-integer, is a 400
    from class-validator.
  - `skip` without `take` uses `take = 5`.
- **With no parameters:** today's response unchanged: `{ total, rows: oldest 5, oldestSince }`.
- **With them:** `rows = waiting.slice(skip, skip + take)`. `total` and `oldestSince` are as
  today, over everything waiting.
- **Order:** `enteredAt` ascending, then `instanceStageId` (today's `orderBy`, stated as a
  contract and pinned).
- **Membership:** today the types read are `recordTypesVisibleTo(permissions)`. A member
  without `committees:view` is in a committee stage's pool but never shown it. Recommended
  (**Q7**):
  - the candidates query also admits COMMITTEE entries whose record the viewer is an active
    member of, using one `memberCommitteeIds()` query before the candidates query;
  - the names step (`recordNamesOf()` with `viewerId`, §4) then names them.
- **Queries:** today's 4 (candidates; pools and votes in one `Promise.all`; names), plus one
  membership query when the viewer lacks `committees:view`. None runs per row.
- **Hard cap:** the candidates read is bounded today only by the organisation's open entries
  on converted, non-final stages. It gains `take: 1000`, the oldest 1,000 open entries (see
  **Q8**). Paging is applied after the pool and vote filters, which run in code by design
  (ACC-271: pools resolve at read time). So `skip` and `take` page the filtered list, and the
  cap bounds what is read.

---

## 8. `GET /committee-change-requests/awaiting-decision`: filtered in the query

**Today** it reads EVERY submitted request in the organisation, ever (decided ones included),
then their stage keys, then filters to `awaitsDecision()` in memory.

**Planned:**

1. **One grouped query: the ids of requests whose newest instance stands in an awaiting
   stage.**

   ```sql
   SELECT r.id
   FROM "CommitteeChangeRequest" r
   JOIN LATERAL (
     SELECT wi."currentStageId" FROM "WorkflowInstance" wi
     WHERE wi."organizationId" = $org AND wi."objectType"::text = 'COMMITTEE_CHANGE_REQUEST'
       AND wi."objectId" = r.id
     ORDER BY wi."createdAt" DESC LIMIT 1
   ) li ON TRUE
   JOIN "WorkflowStage" s ON s.id = li."currentStageId"
   WHERE r."organizationId" = $org
     AND r."submittedAt" IS NOT NULL
     AND r."requestedById" <> $viewer
     AND s.key = ANY($awaitingKeys)
   ORDER BY r."submittedAt" ASC, r.id ASC
   LIMIT 200
   ```

   `$awaitingKeys` is derived from the policy (`REQUEST_STAGE_POLICY` keys whose actions hold
   `approve`, today `['under_review']`), never written in SQL. The newest instance wins, as
   `requestStageKeys()` decides it.
2. **Then today's reads for just those rows:** the requests with `REQUEST_INCLUDE`, their stage
   keys, their committees' stage rules (in one batch), and the extras.
3. **The same response shape.** Hard cap: 200. `awaitsDecision()` still runs on the read rows,
   as a second guard that changes nothing when the query is right; a spec pins the two agree.

---

## 9. The performance rule

- **Nothing on the per-request path.** TenantGuard, PermissionGuard, ModuleGuard, the
  throttler, interceptors, middleware and `verifySessionIdentity()` are untouched.
- **How membership is checked without adding a query to every request:**
  - **only inside the reads in §2,** after the route is matched;
  - **only for a caller without `committees:view`** (a holder pays nothing);
  - **as one indexed query** (`CommitteeMember @@unique([committeeId, userId])`), or one batched
    `findMany` for a list.
  - The frontend reads membership from `MyWorkCountsService`, which already loads at sign-in.
    No new request.
- **No polling.**
- **`Promise.all` for independent reads:** the committee page's reads stay parallel, and the
  awaiting read's pools and votes stay together.
- **No query in a row loop:** `recordNamesOf()` and the awaiting read batch membership.
- **Hard caps:**
  - `awaiting-me`: 1,000 candidates, and `take` ≤ 50;
  - awaiting-decision: 200;
  - `GET /committees`: one organisation's committees, or the caller's.

---

## 10. Specs

**Required by Ahmad (7 Nov), on top of the list below:**

- **On EVERY committee read AND write (§2, §5): four callers.** An active member, a FORMER
  member (`leftAt` set), a non-member, and a `committees:view` holder. Each case includes the
  identical refusal for a real versus an invented id.
- **A member holding `committees:approve` but not `committees:view` still cannot decide** a
  change request: approve, return and reject are each refused exactly as today.
- **db-specs for the paging order and both caps:** 1,001 candidate entries read as 1,000, and
  201 awaiting requests read as 200.
- **Cross-tenant cases named for the isolation gate** on the membership rule, the reads, the
  writes and both awaiting reads.

**Backend:**

- **`committee-membership.spec.ts`:**
  - active member on an active committee → true;
  - departed member, inactive committee, another user → false;
  - the batch form makes one query.
  - **`itEnforcesTenantIsolation('committee membership')`:** a member of another
    organisation's committee with the same id gets nothing.
- **`object-visibility.service.spec.ts`:**
  - a member without the permission is admitted; a non-member gets the identical 403 (a real
    id and an invented one give the same status and body);
  - a holder makes no membership query;
  - `COMMITTEE_CHANGE_REQUEST` does not admit members;
  - no `viewerId` keeps today's rule.
- **`committee-member-access.db-spec.ts`** (real Postgres on 55432), for each of a member, a
  non-member and a `committees:view` holder:
  - `GET /committees/:id`, `/members/page`, `/sub-committees`, `/membership-events`, the
    record panel and `GET /committees` (own only);
  - the identical refusal for a real versus an invented id;
  - the cross-tenant case named for the gate.
- **`committees.controller.spec.ts`:** the read routes carry no `@Permissions`; every write
  route still does, with its exact key (pinned key by key).
- **Writes unchanged:** for each committee write and change-request route, a member without
  the key gets today's exact refusal.
- **`task-record-names.spec.ts`:** a member's committee is named; a non-member's is not;
  membership is one query for any number of rows.
- **`workflow-awaiting.service.spec.ts`:**
  - no params → today's response, byte for byte;
  - `take` 0 / 51 / 1.5 / "x" → 400;
  - `skip` past the end → `rows: []` with the same total;
  - the member clause (Q7).
- **`workflow-awaiting.db-spec.ts`:** paging order on real rows. Entries with equal
  `enteredAt` order by `instanceStageId`. Pages 1 + 2 + 3 equal the whole list, with no
  repeat or gap. The cap: 1,001 entries, then 1,000 read.
- **`change-request-awaiting.db-spec.ts`:**
  - the query returns exactly the requests `awaitsDecision()` would have kept, from a mix of
    draft, under review, returned, approved and withdrawn requests, newest instance wins, and
    the viewer's own excluded;
  - the cap of 200;
  - another organisation's requests are absent (the gate's name).

**Frontend:**

- **`committee-detail`:**
  - a member without `committees:view` sends no Membership history read, no
    `GET /committees`, no users or lookup read, and no instance read without
    `workflows:view`;
  - the panels it may see render; the absent ones are absent, not erroring.
- **`my-work-counts.service.spec.ts`:** `isCommitteeMember` is false while loading, after a
  failure, or with total 0; true with total ≥ 1.
- **Lane A's** nav and guard specs (theirs), against `isCommitteeMember`.

---

## 11. Questions, and Ahmad's answers (7 Nov)

Q1, Q2 and Q6–Q10: as recommended. Q3 and Q5: **members see them** (read only). Q4: **ACC-282**.


1. **The refusal for a non-member without `committees:view`.** Today it is 403 "Required
   permission: committees:view" on the named-parent reads, and the caller's own 404 on the
   read-first ones.
   **Recommended: keep exactly that.** It stays existence-neutral, because the membership
   query answers the same for an invented id. "Everyone else keeps today's rule" then holds
   literally, and nothing has to change for those callers.
   *Alternative:* 404 everywhere for them, which changes today's answer for every holder-less
   caller.
2. **Parent, Reports to and sub-committees for a member.**
   **Recommended:** named, as part of this committee's own record, and linked only where the
   viewer may open the other committee.
   *Alternative:* hidden for members.
3. **Membership history for a member.** **Recommended: no.** It stays with `committees:view`.
4. **The current instance, stage history and moves for a member without `workflows:view`.**
   **Recommended: not in this ticket.** The parent check admits members, but those routes keep
   `workflows:view`.
   - **The gap:** a BASE_USER member who is in a stage's pool sees the record in Awaiting my
     action (Q7) and opens it, but has no move buttons on the page.
   - **Proposed follow-up ticket:** the moves read admits whoever may see the record and is in
     the stage's pool. `triggerTransition` already enforces the pool (ACC-271).
5. **Change requests for a member.** **Recommended: no**, stays `committees:view`.
6. **Order with lane A.** **Recommended:** this ticket ships first. Lane A then ships the
   nav and guard change. Until then a member's committee links stop at the guard, exactly as
   today.
7. **Awaiting my action for a member without `committees:view`.** **Recommended: yes:**
   committee stages waiting on them appear, named, with one membership query.
8. **The cap on awaiting-me's candidates.** **Recommended:** 1,000 open entries, with a log
   line when it is hit. `total` counts within the cap. No new field, so the no-params response
   stays unchanged.
9. **`skip` without `take`.** **Recommended:** allowed, with `take = 5`.
10. **Former members.** **Recommended:** none. A member who left loses access at once,
    because the check is live on every read.

---

## 12. Progress

- [x] Plan (this file), committed, not pushed
- [x] Ahmad's answers to §11 (7 Nov); ACC-282 and ACC-283 created
- [x] Backend: membership rule, the parent clause, the reads (§2–3), the writes (§5), names
      (§4), awaiting-me paging (§7), awaiting-decision (§8), with their specs
- [x] Frontend: the committee page loads only what it may (§2), `isCommitteeMember` (§6),
      the platform-admin and `joinedHint` fixes
- [x] Docs: SYSTEM-REFERENCE §3.21 (new), with pointers from §1.9, §3.16–§3.19 and
      §10.24; CLAUDE.md Key Architecture Decisions (ACC-281)
- [x] /ready-to-pr (Ahmad)

---

## 13. As built (7 Nov)

Where the build departs from the plan text above, and why. Everything else is as planned.

- **The membership rule is `backend/src/common/services/committee-membership.ts`**, not
  under `committees/`. `ObjectVisibilityService` (in `common/`) needs it, and `common/`
  does not import from `foundation/`. It holds:
  - `isActiveMember()` and `memberCommitteeIds()`, one query each;
  - `seesEveryCommittee()` and `maySeeCommittee()`;
  - `assertMaySeeCommittee()`: a read refused is today's 403 "Required permission:
    committees:view";
  - `assertMayWriteCommittee()`: a write refused is 404 "Committee not found", or the
    caller's message ("Change request not found"). There is no `CommitteeAccessService`.
- **The change-request routes:**
  - `committee-change-requests/…` for a request by id (`GET`, `PATCH`, `submit`,
    `withdraw`, `approve`, `return`, `reject`) and for `awaiting-decision`;
  - `committees/:committeeId/change-requests` for a committee's (`GET`, `open`,
    `preview`, create).
  - The plan's earlier text said `committees/change-requests`; corrected above.
- **`GET /committee-change-requests/:id` for a non-holder** reads the request, then needs
  membership of its committee. A request they may not see, a missing one and another
  organisation's all get the same 403 "Required permission: committees:view", so the answer is
  identical for a real and an invented id.
- **Membership history is served by `CommitteeListsService.membershipEvents()`.** Each row
  names its person (`userName`), its approver (`approvedByName`) and its seat
  (`roleLabelEn`, `roleLabelAr`), from one user `findMany` and the seat lookup, in one
  `Promise.all`. So a member without `users:view` or `lookups:view` reads it.
- **The committee read also names the current stage** (`currentStageNameEn`,
  `currentStageNameAr`), so the page's header reads no committee list and no instance.
- **The page's user list is gated on `users:view`, and the seat lookup on
  `lookups:view`:** the reads' own permissions, rather than the member-dialog actions §2
  proposed. A viewer without `users:view` could not make that read anyway.
- **The committees list page, for a member:** a parent name may read "—". The list holds only
  their own committees, and a parent they are not on is not in it.
- **Awaiting decision** filters in SQL with `s.key = ANY(AWAITING_DECISION_KEYS)`, the keys
  derived from `awaitsDecision()` in `change-request-policy.ts`. The cap is
  `AWAITING_DECISION_CAP = 200`. Its cap spec adds 50 older withdrawn requests, so a query
  missing the stage filter fills its 200 with them and fails.
- **Awaiting-me** caps candidates at `AWAITING_ME_CANDIDATE_CAP = 1000`, oldest first, and
  logs a warning when the cap is reached.
