# Step 281 — Committee members open their own committees, and the paged Awaiting my action read

Linear: [ACC-281](https://linear.app/accreditme/issue/ACC-281). Branch:
`feature/ACC-281-member-committees`, from `dev` at `96e94cb`. Lane B. **Plan only; no code yet.**

**Decided (Ahmad, 7 Nov):**

- A full user who is an ACTIVE member of an active committee may open that committee, even
  without `committees:view`. Being a member is the entitlement: ACC-101's rule for self-scoped
  reads, as Home's My committees (ACC-279) already applies it.
- Everyone else keeps today's rule, with the identical answer for a committee they may not see.

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

**Where the rule lives: one place**, `committees/committee-membership.ts`:

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
| 6 | `GET /committees/:id/membership-events`, Membership history | `committees:view` | **No, stays `committees:view`** (see **Q3**) | It is the roster's audit trail: who approved whom, when, and why people left. That is more than a member needs to work the committee. |
| 7 | Stage history, the current instance, moves (`GET /workflows/instances?objectType=COMMITTEE&objectId=`, `/instances/:id/stage-history`, `/instances/:id/moves`) | `@Permissions(workflows:view)` + parent check | **The parent check admits members; the route keeps `workflows:view`** (see **Q4**) | Unchanged for the holders of `workflows:view` (QUALITY_MANAGER, VIEWER…). BASE_USER does not hold it, so in this ticket a BASE_USER member reads the current stage from row 1, not from the instance. |
| 8 | Change requests (`GET /committees/:id/change-requests`, `/open`, `/change-requests/:id`) | `committees:view` | **No, stays `committees:view`** (see **Q5**) | A change request is a proposal to amend the committee. Today it is decided by `committees:approve` and raised by `committees:edit_details` holders, all of whom hold `committees:view`. |
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

## 5. Writes: unchanged

Every write keeps its own permission and the stage rules (ACC-255):

- **On the committee itself:** create (`committees:create`); edit (`edit_details` plus the
  stage's `edit_details`); add, remove and change member (each its own key plus its stage
  action).
- **Change requests:** every route keeps `@Permissions(committees:view)`, with the service's
  `edit_details` / `approve` on top.
- **Workflow moves:** the stage pool decides (ACC-271), unchanged.
- **Task create:** `committees:create_tasks`.

**A spec pins it:** a member without these keys gets each write's refusal exactly as today
(§9).

---

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

## 8. `GET /committees/change-requests/awaiting-decision`: filtered in the query

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

## 11. Questions for Ahmad (each with a recommended answer)

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
- [ ] Ahmad's answers to §11
- [ ] Backend: membership rule, the parent clause, the reads (§2–3), names (§4), awaiting-me
      paging (§7), awaiting-decision (§8), with their specs
- [ ] Frontend: the committee page loads only what it may (§2), `isCommitteeMember` (§6)
- [ ] Docs: SYSTEM-REFERENCE §1.9, §3.17, §3.19 and §10.24; CLAUDE.md Key Architecture
      Decisions (ACC-281)
