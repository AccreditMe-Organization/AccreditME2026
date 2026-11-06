# Step 279 — Home: build it to the App Shell design

Linear: [ACC-279](https://linear.app/accreditme/issue/ACC-279). Branch:
`feature/home-app-shell`, from `dev` at `833b1db`.

It covers:

- what we build from the two Home artboards in `frontend/design-reference/AccreditMe App
  Shell.dc.html`;
- the reads Home will make;
- the layout, and the state of each panel;
- the specs to add;
- the questions, and Ahmad's answers (6 Nov, §5.5). **Where an answer changed the plan, the
  section above it already says the decided version.**

**Ahmad's answers (6 Nov), in short:**

- Q1–Q5 and Q8–Q11: as recommended.
- Q6: as recommended, and the seats meta is left out when the organisation has no seat limit: no
  plan, or the plan's maximum not set. It never reads "of 0".
- Q7: changed. Home has **no header actions at all** for now, and no New task button. Tasks are
  created from a record's Tasks panel, where the record is known.
- Q12: as recommended, and the record picker is
  [ACC-280](https://linear.app/accreditme/issue/ACC-280) (High, related). It replaces the typed
  record id everywhere and adds New task to Home for people with `createTypes`. It is built right
  after this ticket.
- Q13: as recommended, and the counts service also loads once after sign-in, from the same
  existing reads. It refreshes after an action that changes a count (complete, pick up, decide,
  approve). No new endpoint and no polling. §2.5 names the reads.
- The Arabic greeting has two forms only: «صباح الخير» before noon and «مساء الخير» after, in the
  organisation's time zone. It stays singular and gender-neutral.
- Three Arabic fixes in `ar.json`, under the rule "singular address, and no gendered verb about a
  person" (§3.8).

**Ahmad's decisions (6 Nov) are not reopened here:**

- One Home for everyone, gated by permission and by module.
- The admin block sits on top.
- Notifications are removed from Home.
- Incidents, training and meetings wait for their modules.
- No "Configure this organization" cards.
- The rail's "My work" group is lane A's.

**Read for this plan:**

- the two artboards and the plan switch;
- `frontend/src/app/foundation/home/*`;
- SYSTEM-REFERENCE §1.8, §3.13, §3.14, §13 and §17.8;
- the CLAUDE.md entries for ACC-79, 82, 101, 198 and 230;
- the backend reads named in §2, at `833b1db`.

---

## 0. What Home is today, and what changes

`HomeComponent` (`foundation/home/home.component.ts`) renders, in order:

1. **The page header**: "Welcome back, {name}", with no purpose line (ACC-79).
2. **`app-home-briefing`**: only for `tenant:manage_config`, and only when the feature is available.
3. **`app-home-awaiting`**: shown only when there is at least one row. **Both of its reads fail
   silently into "nothing"** (`catchError(() => of(NOTHING))`), so a failure looks exactly like
   "nothing is waiting". That breaks the rule this ticket adopts, and §4 fixes it.
4. **A two-column grid**:
   - **My tasks.** This reads `GET /tasks/my-tasks`, which is **unbounded**: every task the person
     was ever on, filtered to open ones in the browser, showing five. Its failure is silent too.
     Two lines sit in the card: the decision line, which already says when it failed and offers
     Retry, and the available-to-pick line.
   - **Recent Notifications.** This is removed.

What changes, in one sentence: an admin block on top, then the personal tiles, three capped
panels, and the briefing, with no header actions. Every count reads a bounded endpoint, and every failure says
that it failed.

---

## 1. Every element of both artboards

**Key to the tables:**

- **Build:** built in this ticket.
- **Later:** built when its module or data exists. Nothing is drawn for it until then. The design's
  rule is "absent, not greyed", and "unbuilt ≠ unlicensed".
- **Dropped:** not built, with the reason.
- **Module:** the module gate. "—" means the element belongs to no module.
- **`committees`†:** follows the rail's Committees item exactly; see §1.4.

### 1.1 Page header (one header for everyone)

| Element | Decision | Data today | Permission | Module |
|---|---|---|---|---|
| Eyebrow "Home" (work home) | **Dropped.** The breadcrumb root is the organisation, and the H1 is the page. An eyebrow that repeats the rail item's name adds a line and says nothing (PageHeaderComponent: an eyebrow never repeats a crumb). | — | — | — |
| Eyebrow "Administration" (admin home) | **Dropped.** There is one Home, so the page is not "Administration". | — | — | — |
| H1 "Good morning, Layla" | **Build**, with a time-of-day greeting in the **organisation's** time zone and the user's `name`. English has three bands: morning before 12:00, afternoon before 17:00, evening after. Arabic has two forms only: «صباح الخير، {name}» before noon and «مساء الخير، {name}» after (Ahmad, 6 Nov). Both are singular and gender-neutral. See **Q1**. | `AuthService.currentUser().name`; the zone from `FormatService` | none | — |
| H1 "Organization status" | **Dropped.** One Home, one H1. | — | — | — |
| Purpose line (both artboards) | **Dropped.** See §1.6. | — | — | — |
| Action "Report an incident" | **Later** (Incidents). | — | — | incidents |
| Action "New task" | **Later: ACC-280** (Ahmad, Q7). Until the dialog picks its record instead of asking for a typed id, tasks are created from a record's Tasks panel, where the record is known. ACC-280 adds it here for people with `createTypes`. | — | — | — |
| Action "Invite user" | **Dropped.** See **Q7**. | — | — | — |
| Action "Setup health" | **Dropped.** The Needs fixing block's own "Open Setup health →" goes to the same place. See **Q7**. | — | — | — |

### 1.2 Admin block (top of the page, only for someone who may see a part of it)

The block renders when **at least one** of its parts renders, the same rule as the rail's
Administration group (ACC-79). Each part asks only for its own permission.

| Element | Decision | Data today | Permission | Module |
|---|---|---|---|---|
| "Needs fixing" header, count badge, "recomputed N min ago", "Open Setup health →" | **Build** | the open count and the freshness (`SetupConditionRun`) from the admin summary's `setup` part (§2.2) | `setup:view` | — |
| Up to 3 condition rows: severity chip, "Type — object", effect, "open N days", Fix | **Build.** The rows are built by **the same function as the Setup health page** (§3.6), so the page and Home cannot word a condition two ways. The Fix shows only when the viewer can use it; otherwise the page's "needs …" note shows (§13.6). It is never a disabled button. | the 3 top rows (`BLOCKS_WORK` first, then the oldest) from the `setup` part | `setup:view`; each Fix carries its own permissions, as on the page | — |
| "Keep this assignment" on a starting-assignment row | **Dropped from Home.** It is a confirmation step with its own dialog, and it stays on the page; the row's Fix still opens the stage. | — | — | — |
| Footnote "…disappears on the next 15-minute pass…" | **Build, with the copy corrected.** Setup health reconciles **hourly** (§13.5), so "15-minute" is false. New copy: "Each line is a live condition, not a message. It clears by itself on the next hourly check once the setup is fixed. There is nothing to dismiss." | — | `setup:view` | — |
| Tile "Open conditions" N, meta "n blocking" (danger) | **Build** | `setup.open` and `setup.blocksWork` | `setup:view` | — |
| Tile "Active users" 298, meta "of 400 seats" | **Build.** The meta is "{occupied} of {max} seats in use", where occupied is ACTIVE + INVITED, the count the invite refusal uses (`assertSeatAvailable`). **It is left out when there is no seat limit**: no plan, or the plan's `maxFullUsers` not set (Ahmad, 6 Nov). It never reads "of 0". See **Q6** and the finding under it. | `users.active`; `users.seats` (`null` when there is no limit) | `users:view`; the meta also needs `tenant:view` | — |
| Tile "Pending invites" 14, meta "3 over 30 days" | **Build, with the meta changed to "n expired".** An invitation lives **7 days** (`INVITATION_TTL_MS`), so "over 30 days" can never happen. An expired one is the actionable fact. See **Q5**. | `users.invited` and `users.invitedExpired` | `users:view` | — |
| Tile "Active committees" 22, meta "4 below quorum" | **Build as "Committees in force"**, because "Active" is not a committee status any more (ACC-256). Below quorum means in force, with an active-member count under `quorumCount` (and `quorumCount` above 0). See **Q4**. | `committees.inForce` and `committees.belowQuorum`, from ONE grouped query (§2.2) | `committees:view` | `committees`† |
| "Configure this organization" cards | **Dropped** (Ahmad): they repeat the rail, which is why ACC-79 removed the Admin Settings hub. | — | — | — |

### 1.3 Personal part (everyone)

| Element | Decision | Data today | Permission | Module |
|---|---|---|---|---|
| Tile "Open tasks" 7, meta "2 overdue" (danger) | **Build** | `GET /tasks/record-list?view=mine&status=PENDING,IN_PROGRESS,ON_HOLD&take=5` gives `matching`; the same with `&overdue=true&take=1` gives the overdue count (§2.4) | none (self-scoped) | — |
| Tile "Awaiting me" 2, meta "oldest 3d" | **Build.** The number is the stage total plus the change requests. The meta is the age of the oldest item, in whole days ("oldest 3 days"; under a day, "oldest today"). See **Q11**. | `GET /workflows/awaiting-me` (`total`, plus the new `oldestSince`, §2.3); `GET /committees/change-requests/awaiting-decision` for `committees:approve` holders | none; the change-request half needs `committees:approve`, as today | — |
| Tile "My committees" 3, meta "1 meeting this week" | **Build the number; the meta is Later** (Meetings). There is no other meta: a meta line is not required, and none is invented to fill it. | `GET /committees/mine` → `total` (§2.1) | none (self-scoped); see **Q2** | `committees`† |
| Tile "Training due" | **Later** (no training module) | — | — | training |
| Decision line and available line (in today's My tasks card) | **Build, moved to a strip under the tiles.** The capped panel has a fixed body and nowhere to put them. Their wording and their Retry stay. See **Q8**. | as today: `GET /tasks/requests/awaiting-decision`, `record-list view=created&status=REJECTED&take=1`, `GET /tasks/available` | none | — |
| AI briefing | **Build, unchanged, placed between the strip and the panels.** It summarises the person's own work, so it belongs to the personal part, not to the admin block. Its gate stays as it is (`tenant:manage_config` and the feature available, §17.8). Its own greeting line goes (Q1), so the page does not say "Good morning" twice. | `GET /ai/briefing` | `tenant:manage_config` | — |
| Panel "My tasks" (count, "2 overdue" alert chip, "All my tasks") | **Build** on `am-capped-panel` | the record-list call above: 5 rows plus `matching`. Rows: the title (`am-task-link`); line 2 is the record (named only for a viewer who may open it, ACC-228) · "6 days overdue" (late styling) / "due 24 Sep" / "On hold until …" | none | — |
| Panel "My committees" (count, "All committees") | **Build** on `am-capped-panel`. Line 1 is the committee's name and a status chip from `committeeListStatus()`. Line 2 is the person's seat · the current stage's name. "next 14 Sep" is **Later** (Meetings). "All committees" shows only with `committees:view`. | `GET /committees/mine` | none; see **Q2** | `committees`† |
| Panel "Awaiting my action" (count, "View all") | **Build** on `am-capped-panel`. Rows: the record, then "awaiting your approval"-style meta (today's wording) · "3 days waiting". It is now **always shown**, with an empty state (**Q9**). | `GET /workflows/awaiting-me` + change requests, as today | none | — |
| Panel "Incidents I raised" | **Later** (Incidents) | — | — | incidents |
| Panel "Recent Notifications" (today) | **Dropped** (Ahmad): the bell holds them | — | — | — |

### 1.4 The module gate

Every part names its module through **one helper**, `homeModuleOpen(key)`, which reads
`moduleKey` from **the rail's own nav item**:

- When the item carries a `moduleKey`, the helper asks `isModuleEnabled()`.
- When it carries none, the module is open.

Today Committees' nav item deliberately carries **no** `moduleKey`, because no tenant has
`settings.modules` switched on (`nav-items.ts`). Gating Home on it would empty every Home of
committees. So today the helper answers "open". The day the nav item gains `moduleKey:
'committees'`, Home follows **with no change here**. That is the whole point of reading the nav
model rather than keeping a second list (ACC-79: the nav model is the single source).

"Later" elements have no module key to read, so they are not drawn at all. That is "unbuilt ≠
unlicensed" from the design notes.

### 1.5 The plan switch (design only)

**Dropped as UI.** The artboard's starter / growth / enterprise toggle shows how the page changes by
plan. In the product, that is the module gate in §1.4, resolved by `resolveModuleEntitlements()`
(§1.8). It is not something the reader can switch.

### 1.6 The purpose line: **dropped**, by ACC-79's two tests

- **Work home** — "What is yours today — your tasks, your committees, and anything waiting on your
  action. Nothing here about configuring the system."
  - **Test 1** (says something the title and the page do not): **fails.** It lists the panels
    directly below it, which is the exact example PageHeaderComponent gives of a failing line
    ("Home — your open work and recent activity").
  - **Test 2** (a durable rule, not the contents): **fails.** "your tasks, your committees" goes
    stale the day Incidents or Training add panels.
  - Its second sentence is now **false**: one Home carries the admin block.
- **Admin home** — "King Fahad Medical City — what needs an administrator right now, then the
  configuration behind it." It fails test 1: the organisation's name is already the breadcrumb
  root, and the rest describes the block below. It is also false after the decisions: the
  configuration cards are dropped.

So Home keeps **no** purpose line, as it has today. The comment in `home.component.ts` that says so
stays, updated to cite these two lines.

---

## 2. Backend reads

**The performance rule, as it applies here:**

- Nothing in this ticket touches `TenantGuard`, `PermissionGuard`, `ModuleGuard`, the throttler,
  the interceptors, middleware or `verifySessionIdentity()`. **No query is on the per-request
  path.**
- No polling: Home reads once when it opens, and again on Retry or after the person acts.
- Independent reads go through `Promise.all` (or `allSettled`, §2.2).
- No query runs per row; every read below makes a fixed number of queries whatever the row count.

### 2.1 NEW — `GET /committees/mine` (the person's committees; self-scoped)

- **Route:** in `CommitteesController`, declared **before `':id'`** (a route-order spec pins it),
  with **no `@Permissions`**. It answers only for the caller's own memberships, so being a member
  is the entitlement (ACC-101's self-scoped exemption, like `my-tasks`). See **Q2**.
- **Service:** `CommitteesService.mine(organizationId, userId)`.
- **Shape:**
  ```ts
  interface IMyCommittees {
    total: number;                       // every active membership on an active committee
    rows: IMyCommitteeRow[];             // at most 5
  }
  interface IMyCommitteeRow {
    committeeId: string;
    nameEn: string; nameAr: string | null;
    isActive: boolean;
    seat: { id: string; labelEn: string; labelAr: string | null };
    stage: { nameEn: string | null; nameAr: string | null };
    stageRules: { flags: string[] };     // what committeeListStatus() reads
  }
  ```
- **Which rows count:** an active membership (`isActive: true`) on an **active** committee (see
  Q3).
- **Order:** by seat, in the tenant's `committee_member_role` order (Chair before Secretary before
  Member), then the longest-served first, then the committee id. This is the Members panel's order
  (ACC-230), it does not depend on the reader's language, and it puts first the seats that carry
  the most responsibility. See **Q3**.
- **Queries — 8, whatever the number of memberships:**

  | # | Query | Wave |
  |---|---|---|
  | 1 | `committeeMember.findMany({ where: { organizationId, userId, isActive: true, committee: { organizationId, isActive: true } }, select: id, roleValueId, joinedAt, committee { id, nameEn, nameAr, isActive }, take: 200 })` | 1 |
  | 2 | `committeeMember.count` (same `where`), which gives `total` | 1 |
  | 3–5 | `LookupService.getValues('committee_member_role', organizationId)`: category, system values, tenant values (3 sequential, all organisation-scoped). These are the seats as the tenant names and orders them. | 1 |
  | 6–8 | `committeeStagesAndCounts(prisma, organizationId, top5Ids)`: a grouped member count and the instances (parallel), then the stages | 2 |

  **Hard cap: 200 memberships read for sorting.** The total is the honest count from query 2 even
  past 200. Past 200, the five shown are the top five of the first 200 read, not of all; one
  person holding 200 seats is not a real case.

  The member count from `committeeStagesAndCounts` is not used here. It costs nothing extra: it is
  part of the helper, and reusing the helper keeps one source for a committee's stage facts.
- **Status is not computed on the server.** The row carries `stageRules.flags` and `isActive`, and
  the screen calls the **one** rule, `committeeListStatus()`. That function moves out of
  `committee-list.component.ts` into `foundation/committees/committee-status.ts` so the list and
  Home share it (§3.7).

### 2.2 NEW — `GET /home/admin-summary` (only the parts the caller may see)

- **Module:** a new `backend/src/foundation/home/` (`HomeModule`, `HomeController`,
  `HomeService`).
- **Route:** no `@Permissions`. The service decides each part from the caller's permissions, the
  shape `GET /tasks/views` already uses. A caller holding none of the three permissions gets every
  part `null`, and **no query runs** (a spec pins that Prisma is not called).
- **Each owning module computes its own part.** Modules are self-contained and own their Prisma
  calls (CLAUDE.md NestJS conventions), so `HomeService` composes three exported methods and
  queries nothing itself.
- **The parts run in `Promise.allSettled`**, so one failing part does not blank the others. A
  failed part answers `{ failed: true }` and logs one line (ids only). The response is still 200.
- **Shape:**
  ```ts
  interface IHomeAdminSummary {
    setup: null | { failed: true } | {
      open: number; blocksWork: number;
      top: ISetupCondition[];                  // at most 3, the page's own shape
      freshness: ISetupConditionFreshness[];   // for "recomputed N min ago" and the overdue/failed note
    };
    users: null | { failed: true } | {
      active: number; invited: number; invitedExpired: number;
      seats: null | { occupied: number; maxUsers: number };   // null without tenant:view, or with no seat limit
    };
    committees: null | { failed: true } | { inForce: number; belowQuorum: number };
  }
  ```

**The parts:**

- **`setup`** (`setup:view`): `SetupHealthService.getHomeSlice(organizationId)`, **3 queries**, in
  parallel:
  1. `setupCondition.groupBy({ by: ['severity'], where: { organizationId, type: { in: SETUP_CONDITION_TYPES }, clearedAt: null }, _count })`.
     This gives `open` and `blocksWork` in **one** query; `getSummary()` uses two for the same
     numbers.
  2. `setupCondition.findMany` (same `where`, `orderBy: [{ severity: 'asc' }, { openedAt: 'asc' }, { id: 'asc' }]`, `take: 3`).
     `BLOCKS_WORK` is declared before `AT_RISK`, so ascending puts it first. This matches the
     page's `SEVERITY_RANK`, and a spec asserts the two agree.
  3. `setupConditionRun.findMany({ where: { organizationId, type: { in } } })`, which feeds the
     existing `freshnessOf()`.
- **`users`** (`users:view`): `UserService.homeCounts(organizationId, { withSeats })`, **2 queries,
  or 3 with `tenant:view`**, in parallel:
  1. `user.groupBy({ by: ['status'], where: { organizationId, status: { in: ['ACTIVE', 'INVITED'] } }, _count })`.
  2. `user.count({ where: { organizationId, status: 'INVITED', invitationExpiresAt: { lt: now } } })`.
     It reads `invitationExpiresAt` as `open-invitation.ts` does.
  3. Only with `tenant:view`: `organization.findFirst({ where: { id: organizationId }, select: { maxUsers: true, plan: { select: { maxFullUsers: true } } } })`.
     That is one query with a join. `seats` is `null` unless the organisation has a plan whose
     `maxFullUsers` is set and above 0 (Ahmad, Q6). When it is shown, the limit is
     `Organization.maxUsers`, the number the invite refusal actually enforces.
- **`committees`** (`committees:view`, and the committees module open): `CommitteesService.homeCounts(organizationId)`, **1 grouped
  query** (`$queryRaw`, every value bound, `organizationId` on every table):
  ```sql
  WITH latest AS (                       -- newest instance wins, as committeeStagesAndCounts
    SELECT DISTINCT ON (wi."objectId") wi."objectId", wi."currentStageId"
    FROM "WorkflowInstance" wi
    WHERE wi."organizationId" = $1 AND wi."objectType" = 'COMMITTEE'
    ORDER BY wi."objectId", wi."createdAt" DESC
  ), members AS (
    SELECT cm."committeeId", count(*) AS n
    FROM "CommitteeMember" cm
    WHERE cm."organizationId" = $1 AND cm."isActive"
    GROUP BY cm."committeeId"
  )
  SELECT count(*) FILTER (WHERE 'IN_FORCE' = ANY(s.flags)
                           AND NOT 'DISSOLVING' = ANY(s.flags))                    AS in_force,
         count(*) FILTER (WHERE 'IN_FORCE' = ANY(s.flags)
                           AND NOT 'DISSOLVING' = ANY(s.flags)
                           AND c."quorumCount" > 0
                           AND COALESCE(m.n, 0) < c."quorumCount")                  AS below_quorum
  FROM "Committee" c
  JOIN latest l ON l."objectId" = c.id
  JOIN "WorkflowStage" s ON s.id = l."currentStageId"
  JOIN "WorkflowTemplate" t ON t.id = s."workflowTemplateId" AND t."organizationId" = $1
  LEFT JOIN members m ON m."committeeId" = c.id
  WHERE c."organizationId" = $1 AND c."isActive"
  ```
  `WorkflowStage.flags` is `String[]` (`text[]`), so `= ANY` applies directly. The status rule is
  `committeeListStatus()`'s: `DISSOLVING` is checked before `IN_FORCE`, so a stage flagged both
  counts as "being dissolved", not "in force". That is why both filters exclude `DISSOLVING`, and
  a db-spec pins the agreement with `committeeListStatus()`.
- **Total: at most 7 queries in one parallel wave** (3 + 3 + 1). A caller with one permission pays
  only that part's queries. None of them is on the per-request path.

### 2.3 ADDITIVE — `oldestSince` on `GET /workflows/awaiting-me`

`IWorkflowAwaitingMe` gains `oldestSince: Date | null`: the `enteredAt` of the oldest waiting
entry, or `null` at 0.

- **0 extra queries.** The entries are already read `orderBy: enteredAt asc`, so it is
  `rows[0]?.since` **before** the slice to 5.
- **Why a field rather than reading `rows[0]` on the screen:** the tile must not depend on the
  server returning its rows oldest first. That order is true today and is nowhere promised.
- **"Oldest" across both halves** is the earlier of `oldestSince` and the oldest change request's
  `submittedAt ?? createdAt`. That request list is already in the browser (approvers only),
  unbounded as it is today.

### 2.4 Existing reads Home makes, unchanged

| Read | Gate | Why Home calls it | Bounded? |
|---|---|---|---|
| `GET /tasks/record-list?view=mine&status=PENDING,IN_PROGRESS,ON_HOLD&take=5` | none (self) | My tasks rows + Open tasks number (`matching`) | yes, 5 rows. The row load has **no per-row query**: `createdBy` is preloaded and the covered-creators set is passed into `mayManage()` (checked at `833b1db`). No facets (`withFacets` only on the full list). |
| the same with `&overdue=true&take=1` | none | the "n overdue" chip and meta (`matching`) | yes |
| `GET /workflows/awaiting-me` | none | Awaiting panel + tile | yes, 5 rows + total (+ `oldestSince`) |
| `GET /committees/change-requests/awaiting-decision` | `committees:view` on the route; Home calls it only for `committees:approve` | the other half of Awaiting | as today |
| `GET /tasks/requests/awaiting-decision`, `record-list view=created&status=REJECTED&take=1`, `GET /tasks/available` | none | the decision and available lines | as today |
| `GET /ai/briefing` | `tenant:manage_config` (asked only by holders) | the briefing | yes |

**Removed from Home:**

- `GET /tasks/my-tasks`, which was unbounded. It stays for its other callers.
- `GET /notifications?take=5`.

My tasks moves from `my-tasks` to the record list's `mine` view. That is the same rule `/tasks`
My tasks already uses (an active assignee row; an unpicked pool task is not "mine"), so **Home's
count equals the /tasks page's**, and a spec asserts it.

The order is the record list's `due` order: open by soonest due (overdue first), then On hold.
That replaces Home's own sort in the browser.

### 2.5 `MyWorkCountsService`, which lane A's rail reads (built here, Q13)

**What it is.** A root service, `core/my-work/my-work-counts.service.ts`. It owns **the reads behind
Home's personal tiles and panels**, and holds each answer as a signal with its own state
(`loading` / `ready` / `failed`). Home renders from it, and lane A's rail reads the same signals.
The two can never disagree, and nothing is fetched twice.

**The existing reads it calls.** There is no new endpoint other than §2.1's:

| Signal | Read | Gives |
|---|---|---|
| `myTasks` | `GET /tasks/record-list?view=mine&status=PENDING&status=IN_PROGRESS&status=ON_HOLD&sort=due&take=5` | the five rows, and `matching` (the count of open tasks) |
| `myOverdue` | the same with `&overdue=true&take=1` | `matching` (overdue). The rail's alert tone comes from this. |
| `awaiting` | `GET /workflows/awaiting-me`, plus `GET /committees/change-requests/awaiting-decision`, the latter only for `committees:approve` | rows, `total` + the request count, and the oldest date. Either half failing makes the whole signal `failed`: a partial count is a wrong count. |
| `myCommittees` | `GET /committees/mine` (§2.1), only while the committees module is open (§1.4) | five rows and `total` |

**When it loads:**

- **Once after sign-in**: from the shell's initialisation, at the point where it already calls
  `NavigationAccessService.loadAccess()`. That covers a hard reload and a same-tab sign-in.
- **Cleared at sign-out**, like `SetupHealthService`'s summary.
- **Retry** re-runs only the failed read.

**When it refreshes.** After a successful action that changes a count. These frontend service
calls emit on a small root `MyWorkEvents.changed()` once their request succeeds:

- **Tasks:** complete, reject, pick up, release, reassign, cancel, reopen.
- **Task requests:** approve, decline.
- **Records:** a workflow move, a vote, and a change request's approve, return, reject or withdraw.

The service listens and reloads all its reads once, coalescing a burst of events into one reload.
This keeps `TaskService` free of a dependency on the counts service, which would be a cycle.

**No polling, no timer, no new endpoint.** A count the server changes on its own (a pool task
someone else picks up) is seen on the next sign-in, the next Home visit or the next action.

**Home also reloads it on entry**, so returning to Home is never stale.

---

## 3. Layout

### 3.1 Order, top to bottom

```
Page header: H1 greeting (no actions)
┌ Admin block (only if a part renders) ──────────────────────────┐
│ Needs fixing  (setup:view)                                     │
│ [Open conditions] [Active users] [Pending invites] [In force]  │
└────────────────────────────────────────────────────────────────┘
[Open tasks] [Awaiting me] [My committees]
decision line · available line (only when non-zero, or failed)
AI briefing (tenant:manage_config, feature available)
┌ My tasks ┐ ┌ My committees ┐ ┌ Awaiting my action ┐
```

The panel order follows the artboard: My tasks, My committees, Awaiting my action.

### 3.2 Widths

The content column is the shell's `<main>` with `p-4`: 16px each side, so content = viewport −
rail − 32.

| Viewport | Rail | Content | Tiles (`repeat(auto-fit, minmax(170px, 1fr))`, gap 12) | Panels (`repeat(auto-fit, minmax(min(330px, 100%), 1fr))`, gap 12) |
|---|---|---|---|---|
| 1280 | 260 open | 988 | 4 admin in one row; 3 personal stretch to a row | **2 columns**: My tasks + My committees, then Awaiting alone at half width (3 × 330 + 24 = 1014 > 988) |
| 1440 | 260 | 1148 | same | **3 columns**, one row |
| 1920 | 260 | 1628 | same (auto-fit collapses empty tracks, so the tiles stretch) | 3 columns, one row (auto-fit) |
| 1280, rail collapsed | 72 | 1176 | same | 3 columns |
| Phone (390) | sheet | 358 | **2 columns** (2 × 170 + 12 = 352) | 1 column |

- **The tiles and the panels use the design's own numbers** (170 / 190 and 330). The 330 minimum
  is the narrowest at which the longest English line 2 ("Antimicrobial Stewardship" · seat · stage)
  keeps its ellipsis readable.
- **Admin tiles and personal tiles are separate rows**, never mixed, so the block's edge is the
  boundary.
- **No horizontal scroll at any width.** Every cell has `min-inline-size: 0`, and long text uses an
  ellipsis with the whole text in a tooltip (ACC-234's rule).
- **The Needs fixing block** is a full-width card, not a capped panel. It holds up to 3 rows and
  needs no "See all": its header link is the full view. At phone width, the Fix moves under the row
  text instead of beside it.

### 3.3 Panels on `am-capped-panel`

- **All three panels use `am-capped-panel`**, inside a `data-fill-panels` grid. Its body is fixed
  at **294px English and 328px Arabic**, never grows and never scrolls. Panels in a row therefore
  share top and bottom edges **by construction**, whatever their row counts (ACC-230). Nothing on
  Home writes its own panel frame.
- **Rows:** `am-cp-row` with `am-cp-l1` (title and chip) and `am-cp-l2` (meta), 52 / 58px.
- **The header link** ("All my tasks", "All committees", "View all") goes in `[amPanelActions]`.
  The "2 overdue" alert chip sits before the link.
- **`offersSeeAll` is false on Home.** The header link is the full view, and a second link to the
  same place in the footer adds nothing. See **Q10**.
- **The design's per-row "⋯" is dropped on Home.** The task page and the record pages hold the
  actions, and a capped Home row is a way in, not a list to act from. The tiles have no menu.

### 3.4 English and Arabic

- **Every string is a translation key**, in both files.
- **Tenant data uses `LanguageService.bilingual()`**: committee names, seats, stage names, records.
- **Counted strings are plural objects** with Arabic's six categories ("{n} overdue", "{n}
  expired", "{n} below quorum", "oldest {n} days"). **No unit is glued onto a number**
  (`check:formatting`, ACC-265).
- **The greeting bands use the tenant zone**, the same rule as dates (ACC-94).
- **Digits are Latin in both languages.**
- **RTL:** the grids mirror on their own, and the chips and links use logical properties
  (`margin-inline-*`).

### 3.5 New task

Not on Home (Q7). [ACC-280](https://linear.app/accreditme/issue/ACC-280) adds it, together with
the record picker that replaces the typed record id, so that Home never opens a dialog asking for
an id. Nothing about the dialog changes in this ticket.

### 3.6 One row builder for Setup health

`toRow()` and `fixTargetFor()` move out of `SetupHealthPageComponent` into
`foundation/setup-health/setup-condition-row.ts`, as an injectable `SetupConditionRows` (it needs
translate, format, access and language). The page and Home's Needs fixing both call it.

### 3.7 One status rule for committees

`committeeListStatus()` moves to `foundation/committees/committee-status.ts`. The list, the record
page and Home import it. Its chip classes move with it.

### 3.8 Arabic fixes in `ar.json` (Ahmad, 6 Nov)

**The rule:** singular address, and no gendered verb about a person.

- `workflow.editor.meaningsNote` ends «يعود إليكم». It becomes «يعود إليك».
- **Every `committee.*` line that puts a masculine verb before a person's name** («قدّمه / بدأه /
  أعاده / اعتمده / سحبه / رفضه {{name}}») becomes a noun phrase: «قدّمه {{name}}» →
  «مقدَّم من {{name}}», and the same shape for each. The full list is found by grep at build time
  and named in the PR.
- **The add-member date hint** uses a gendered address. It is reworded gender-neutrally.

---

## 4. States: every element

**The rule, applied everywhere:**

- A count that has not loaded shows a skeleton.
- A count that failed shows "Couldn't load · Try again". **Never 0, and never "—" alone.** This is
  the decision line's existing behaviour, now applied to every count.
- A panel's states come from `am-capped-panel` (five skeleton rows; the error with Retry in the
  body only; the empty state).

| Element | Loading | Empty (loaded, 0) | Failed |
|---|---|---|---|
| Admin block | each part independently | — | each part independently, from its own `{ failed: true }`; a failed **request** fails every part, with one Retry that re-requests the summary |
| Needs fixing | header with the count as a skeleton; 3 skeleton rows | one line: "Nothing needs fixing." · "Checked {N ago}". This tells an admin the check ran. | "Setup health couldn't be loaded · Try again" |
| Needs fixing, a check FAILED / OVERDUE / NEVER_RUN | — | — | a note under the header: "Some checks haven't run recently. Open Setup health." The rows shown are still the last confirmed truth (§13.5: a failed check never clears a condition). |
| Admin tiles | skeleton number | "0", with a meta only where it is meaningful ("0 blocking" is not shown) | the number is replaced by "Couldn't load", with "Try again" |
| Open tasks / overdue | skeleton | "0", no meta | as above. The overdue call failing alone hides the meta and shows "overdue count couldn't load · Try again" in its place, never "0 overdue" |
| Awaiting me tile | skeleton | "0", no meta | as above. **Either** half failing is a failure: a partial number is a wrong number. |
| My committees tile | skeleton | "0" | as above |
| Decision and available lines | none drawn | no line | the decision line keeps today's "— waiting for your decision · Try again". The available line, which fails silently today, gets the same pattern. |
| Briefing | unchanged (`am-ai-assist`'s own states, §17.8) | | |
| My tasks panel | 5 skeleton rows | "You have no open tasks." | "Your tasks couldn't be loaded." + Retry |
| My committees panel | 5 skeleton rows | "You aren't on any committee." | "Your committees couldn't be loaded." + Retry |
| Awaiting my action panel | 5 skeleton rows | "Nothing is waiting for you." It is always shown now (**Q9**). | "This couldn't be loaded." + Retry. **This fixes today's silent failure.** |

**Retry** re-runs only that element's read, except where one read feeds a tile and a panel (My
tasks, Awaiting, My committees). Then Retry on either re-runs it once, and both update.

---

## 5. Specs, layout specs, and questions

### 5.1 Backend specs

- `home.service.spec.ts`:
  - each part appears only with its permission;
  - no permission → every part null and **zero Prisma calls**;
  - one part rejecting → that part `{ failed: true }`, the others intact, and one log line with no
    tenant data.
- `home.controller.spec.ts`: no `@Permissions` metadata on the handler (the pattern of
  `tenant.controller.spec.ts`).
- `setup-health.service.spec.ts`:
  - `getHomeSlice()`: `top` order equals `getHealth().open`'s first three for the same rows;
  - the groupBy counts equal `getSummary()`;
  - **"should NOT return records belonging to a different tenant"**.
- `user.service.spec.ts`:
  - `homeCounts()`: an expired invitation is counted, an unexpired one is not, ACTIVE and INVITED
    each counted;
  - no seats without `withSeats`;
  - the tenant-isolation test.
- `committees.home-counts.db-spec.ts` (real Postgres on 55432):
  - in force versus not;
  - the newest instance wins;
  - `quorumCount` 0 is never below;
  - an inactive committee is out;
  - a departed member is not counted;
  - DISSOLVING is out;
  - another organisation's committee, instance or members change nothing (named
    tenant-isolation test);
  - mutation-checked by removing `AND c."quorumCount" > 0` and the `organizationId` join, and
    watching it fail.
- `committees.mine.spec.ts` / `.db-spec.ts`:
  - only the caller's active memberships on active committees;
  - seat order, then joined date;
  - 5 rows and an honest total with 7 memberships;
  - tenant isolation;
  - the route declared before `:id` (`committees.route-order.spec.ts`, as `task.route-order.spec.ts`
    does);
  - **the query count is the same for 1 and 7 memberships** (a counting Prisma spy), so no query
    per row.
- `workflow-awaiting.service.spec.ts`: `oldestSince` is the oldest entry even when it is past the
  five returned; null at 0.

### 5.2 Frontend specs

- `home.component.spec.ts` (rewritten):
  - every part present and absent by its permission and by `homeModuleOpen()`, **absent, never
    disabled**;
  - no Notifications panel and no `/notifications` request;
  - no `my-tasks` request;
  - no header actions, and no `/tasks/views` request;
  - no role name is read anywhere (a source scan in the spec, like `role.seed.spec.ts`'s pins).
- `home.tiles.spec.ts`:
  - every count's failed state shows "Couldn't load" and Retry, never "0". **Mutation:** map the
    error to 0 and the spec goes red.
  - Retry re-requests only its read.
  - The awaiting tile fails when either half fails.
- `home-awaiting.component.spec.ts`: the error state with Retry, the empty state, and the oldest
  meta from `oldestSince` and the change requests.
- `home-my-committees.component.spec.ts`:
  - the chip comes from `committeeListStatus()`;
  - the link shows only with `committees:view`;
  - Arabic names fall back to English (`bilingual`).
- `home-needs-fixing.component.spec.ts`:
  - at most three rows;
  - the Fix and the "needs" note follow the viewer's permissions;
  - the footnote says hourly;
  - the freshness note;
  - **for one condition, the page and Home produce the identical row** (from the shared
    `SetupConditionRows`).
- `setup-health-page.component.spec.ts` stays green, unedited, which proves the extraction changed
  nothing.
- `committee-list.component.spec.ts` stays green after the `committeeListStatus()` move.
- `my-work-counts.service.spec.ts`:
  - it loads once from `init()` and never twice for repeated calls;
  - a burst of `changed()` events gives one reload;
  - a failed read is `failed`, never 0;
  - `clear()` empties it;
  - the change-request half is asked only with `committees:approve`;
  - `myCommittees` is not asked while the module is closed.
- A spec per wired action that a successful call emits `changed()` and a failed one does not.
- `ar.json` fixes (§3.8): a spec reads the file and asserts that none of the listed keys contains
  the old gendered verb forms.

### 5.3 Layout spec — `home.layout.spec.ts` (ChromeHeadless, real layout)

The shape follows `task-list-view.layout.spec.ts`. It runs at **1280, 1440 and 1920 with the rail
open, 1280 with the rail collapsed, and 390 × 844**, in **English and Arabic**.

- **The guard runs first:** the measured offsets are real, distinct and increasing. Without it,
  zeros from a layout-less run would pass every equality below (ACC-120's rule).
- The columns per row are exactly §3.2's table: the tiles and the panels, per width.
- Panels in one row share **top and bottom** edges. Each body is 294 (EN) / 328 (AR) with 1, 3
  and 5 rows.
- No element is wider than its track, and the page has no horizontal scroll (`scrollWidth <=
  clientWidth`) at every width.
- A tile's long meta and a committee's long Arabic name ellipsise inside their track.
- **Mutation checks**, each of which must turn the spec red:
  - `minmax(330px` changed to `minmax(200px`;
  - `data-fill-panels` removed;
  - the `min-inline-size: 0` dropped.

### 5.4 Gates

- `check:*`, discovered as `/ready-to-pr` does. `check:formatting`, `check:icon-labels` and
  `check:confirm-translated` are the ones these changes touch.
- Both test suites, the tenant-isolation pattern, and `ng build`.
- **No migration**: every read is over existing columns. Nothing has to wait for a deploy.

### 5.5 Questions, and Ahmad's answers (6 Nov)

1. **Greeting.** Use "Good morning / afternoon / evening, {name}" in the tenant's zone, as drawn,
   instead of "Welcome back"?
   **Recommended: yes**, reusing the briefing's three keys. The briefing card then drops its own
   greeting line, so a tenant admin is not greeted twice.
   **Decided: as recommended, with Arabic in two forms (§1.1).**
2. **My committees for someone without `committees:view`.** BASE_USER does not hold it, and most
   members only have BASE_USER.
   **Recommended:** show the panel and the tile to **every member**, with the committee's name in
   plain text, linked only for `committees:view`. Being a member is the entitlement (ACC-101's
   self-scoped rule, the same reasoning as a notification naming the record).
   *Alternative:* show the panel only with `committees:view`. Then most members see no committees
   on Home.
   **Decided: as recommended.**
3. **My committees: which rows, and in what order.**
   **Recommended:**
   - active memberships on **active** committees only (a deactivated committee is not live work);
   - ordered by seat (the tenant's role order), then longest-served.
   *Alternative:* in force first, by name.
   **Decided: as recommended.**
4. **"Active committees" becomes "Committees in force"** (in force and not dissolving, by stage
   flags), with "n below quorum": in force, quorum above 0, active members under it.
   **Recommended: yes.** "Active" is no longer a status anywhere (ACC-256).
   **Decided: as recommended.**
5. **Pending invites meta.** Invitations expire after 7 days, so "over 30 days" never happens.
   **Recommended: "n expired".**
   **Decided: as recommended.**
6. **Seats.** **Recommended:** "{active + invited} of {max} seats in use", the count the invite
   refusal enforces, shown only with `tenant:view` as well as `users:view`. `maxUsers` is already in
   `GET /tenant` for that permission.
   **Decided: as recommended, and left out when there is no seat limit (no plan, or `maxFullUsers` not set); never "of 0". Finding: setting a plan does not copy `Plan.maxFullUsers` into `Organization.maxUsers`, so the plan and the enforced limit can differ. The tile shows the enforced one. This is recorded in the PR, not fixed here.**
7. **Header actions.** **Recommended:** New task only.
   - Drop "Invite user": it is Users' own action, the same reason the Configure cards go.
   - Drop "Setup health": the Needs fixing link goes there.
   - "Report an incident" comes with Incidents.
   **Decided (changed): no header actions at all, and no New task, until ACC-280.**
8. **The decision and available lines.** **Recommended:** keep them as one strip under the personal
   tiles, shown only when non-zero or failed, with their wording and Retry unchanged.
   *Alternative:* fold task requests and rejected tasks into Awaiting my action as a third kind of
   row. That changes that panel's count and meaning, so it would be its own decision.
   **Decided: as recommended.**
9. **Awaiting my action when empty.** **Recommended:** always show it, with "Nothing is waiting for
   you." Today it disappears at 0, which also hid its failures.
   **Decided: as recommended.**
10. **Panel links.** **Recommended:** the header link only ("All my tasks" → `/tasks`; "All
    committees" → `/committees`; "View all" → `/tasks`), with no "Showing 5 of N · See all" footer
    on Home. The header count already says how many there are.
   **Decided: as recommended.**
11. **"Oldest 3d".** **Recommended:** whole calendar days through the duration formatter ("oldest 3
    days", and "oldest today" under a day). This is wording, not an SLA, and the tile's own tooltip
    gives the date.
   **Decided: as recommended.**
12. **New task's record id field.** Home inherits `/tasks`'s dialog unchanged, including typing a
    record id when no record is locked.
    **Recommended:** keep it the same here and open a separate ticket for a record picker, so Home
    does not fork the dialog.
   **Decided: as recommended; the picker is ACC-280 (High, related), built right after this ticket, and it adds New task to Home.**
13. **Rail counts.** **Recommended:** this ticket adds `MyWorkCountsService` (root signals, filled by
    Home, read by lane A's rail). No new endpoint and no polling; it refreshes on Home's load and
    after an action.

   **Decided: as recommended, and it loads once after sign-in and refreshes after an action (§2.5).**
---

## 6. Progress

- [x] Step 1: this plan (ACC-279), committed, not pushed
- [x] Ahmad's answers to §5.5 (6 Nov), and ACC-280 created
- [ ] Backend: `GET /committees/mine`, `GET /home/admin-summary`, `oldestSince`, with their specs
- [ ] Frontend: extractions (§3.6–3.7), `MyWorkCountsService`, the `ar.json` fixes (§3.8), then Home, then the specs and the layout spec
- [ ] Docs: SYSTEM-REFERENCE (Home section, §13.9's "out of scope" line, §17.8 placement); CLAUDE.md Key Architecture Decisions (ACC-279)
