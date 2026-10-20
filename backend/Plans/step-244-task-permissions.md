# ACC-244 — task permissions per record type, plus unit scope (plan)

**Status: PLAN, answered by Ahmad on 20 Oct (§10). PR 1 built (§9); the shared headship work moved to PR 2.** Branch
`feature/ACC-244-task-permissions`, cut from `origin/dev` at `8fa444e`.
Every database read behind this plan was read-only (`BEGIN READ ONLY`, then
`ROLLBACK`). Nothing was granted, revoked or written.

Ticket: ACC-244 in Linear. Drawing: `frontend/design-reference/AccreditMe Task
Screens.dc.html`: decision 3, the "Unassigned and All tasks" note, and the
"Decided · round 3" supersedes line. The rules this plan builds are the
ticket's five; §10 lists what they leave open.

---

## 1. Today's paths

Every task read and action, the gate it checks today, and whether that gate is
**shared** (it calls the one rule) or **copied** (it restates part of a rule).
Line numbers are on `8fa444e`.

### 1.1 Reads

| Path | Where | Checks today | Shared or copied |
|---|---|---|---|
| My tasks `GET /tasks/my-tasks` | `task.controller.ts:116`, `task.service.ts:522` | none (self-scoped: active assignee) | own rule, correct as is |
| Available to pick `GET /tasks/available` | `task.controller.ts:134`, `task.service.ts:584` | none (self-scoped: the caller's pools) | own rule, correct as is |
| Waiting for your decision `GET /tasks/requests/awaiting-decision` | `task.controller.ts:279`, `task-request.service.ts:463` | covered creators, plus **`tasks:reassign`** for an inactive creator (`:473`) | **copied** (the reassign half) |
| Record Tasks panel `GET /tasks/record-panel` | `task.controller.ts:294`, `task-record-list.service.ts:62` | record visible, then **`tasks:view`** for all of it, else "own" = creator or ever-assignee (`:101-119`) | **copied**: "own" is narrower than `admit()`; it leaves out pool members, cover and deciders |
| All tasks `GET /tasks/record-list` (no record) | `task-record-list.service.ts:120-130` | **`tasks:view`**, then the record types the viewer may see | **copied**: a second statement of "who sees a task" |
| All tasks on a record (See all) | same, with a record | as the panel | **copied** |
| Unassigned `GET /tasks/unassigned` | `task.controller.ts:316-317`, `task.service.ts:704` | **`tasks:manage`**, organisation-wide, no record check | **copied**, and ignores record visibility |
| Legacy source list `GET /tasks?sourceType=` | `task.controller.ts:324`, `task.service.ts:627` | `tasks:view` + record | **copied**; **no frontend caller** |
| Legacy single task `GET /tasks/:id` | `task.controller.ts:361`, `task.service.ts:752` | `tasks:view` + record | **copied**; **no frontend caller** |
| Task page `GET /tasks/:id/view` and `/history` | `task-page.service.ts:84`, `:173` | `TaskAdmissionService.admit()` | **shared** (the one rule) |
| Files: list, download, viewer, AI summary GET and POST | `task-evidence.service.ts:265` (`admission.load`) | `admit()` | **shared** (ACC-231) |
| Picker counts "12 open · 3 overdue" | `workload/task-workload.service.ts:82-87` (`assertMayCount`) | **`tasks:view`** + record | **copied** |
| Picker "Suggest someone" | `workload-hint.service.ts` → `assertMayCount` | same | **copied** (by the same function) |
| Notifications | the bell opens `/tasks/:id`, so the page rule applies | `admit()` | **shared** |
| Decision notices | `task-authority.service.ts:77` `decisionRecipients()` → `reassignHolderIds()` `:152` | **`tasks:reassign`** holders when the creator is not ACTIVE | **copied** |
| Home briefing | `ai-briefing.service.ts:210-212` | My tasks, available, awaiting decision | **shared** (it calls the three above) |
| Search | there is no global search. The only search is All tasks' `q=` (`task-record-list.service.ts:164`), inside the list's scope | the list's scope | inherits whatever the list does |

### 1.2 Actions

| Action | Where | Checks today | Shared or copied |
|---|---|---|---|
| Create `POST /tasks` | `task.controller.ts:450`, `task.service.ts:204` | **`tasks:create`**. **The record is never checked**: `create()` neither confirms the source record exists in the organisation nor that the caller may see it | **gap** (see §4) |
| SLA preview for New task, Draft with AI | `task.controller.ts:146-168` | **`tasks:create`**; the draft also checks the record (`task-draft.service.ts:81`) | **copied** |
| Picker lists (units, positions, holders, committee roles) | `task-assignment.service.ts:63-79` `assertMayAssign()` | **`tasks:create`**, or `workflows:manage` with no task, or **`tasks:reassign`** or acting-for-creator with `?taskId` | **copied** |
| Edit, cancel, reopen, row `canManage` | `task.service.ts:2210` `mayManage()` | creator or acting-for-creator, or **`tasks:reassign`** while the creator is not ACTIVE (`:2222`) | **shared** (the one copy, as ACC-174 intended) |
| Reassign | `task.service.ts:1448`, gate at `:1468` | **`tasks:reassign`** outright, or acting-for-creator | **copied**: a broader rule than `mayManage()`'s |
| Decide a request, resume a hold | `task-request.service.ts:430`, `:525` | **`tasks:reassign`** outright, or acting-for-creator | **copied** (twice) |
| `mayDecide` on the page and on list rows | `task-admission.service.ts:100`, `task-record-list.service.ts:195`, `:259` | **`tasks:reassign`** or covered | **copied** (twice) |
| Start, complete, reject, release, pick, evidence | `task.service.ts` | active assignee or pool member; no permission | own rules, correct as is |

### 1.3 Frontend gates on the old keys

`nav-items.ts:125` (All Tasks, `tasks:view`), `nav-items.ts:262` (Unassigned,
`tasks:manage`), `committee-detail.component.ts:565` (New task,
`tasks:create`), `task-list.component.ts:101` (`tasks:create`),
`unassigned-tasks.component.ts:94` (Reassign, `tasks:reassign`),
`setup-health-page.component.ts:95` (TASK_WITHOUT_OWNER's Fix,
`tasks:manage` + `tasks:reassign`), and `permission-columns.ts:38`
(`tasks:reassign` → Edit).

### 1.4 The headship reads (for §3.3)

| Reader | Where | Reads |
|---|---|---|
| Acting-for-creator, decision notices, covered creators | `task-authority.service.ts:39`, `:77`, `:120`; window `absenceCoverNow()` `:190`; holder rule `substantiveHeadUnit()` `:183` | **period table** (ABSENCE only), holder rule **without** `position.isActive` |
| Head status GET | `org-unit-head.service.ts:61-80` | holder rule, plus `actingHeadUserId` **cache** |
| Overlap refusal | `org-unit-head.service.ts:567` | open ACTING periods |
| Setup health "open-ended acting head" | `setup-condition.detectors.ts:449` | the period table |
| Vacancy recomputer, escalation, workflow head routing | `sla-monitor.processor.ts:283-300`, `organization.service.ts:103-153`, `workflow.service.ts:1615-1626` | holder rule **with** `position.isActive`, plus the **cache** |

The holder rule is written out in at least six places, and two of them
disagree on `position.isActive`. ACC-244 shares only the "who heads this unit
NOW, for authority" read (§3.3). The cache readers are routing and escalation,
recomputed by the SLA sweep under ACC-82's rule, and stay out of scope.

---

## 2. The permission model

### 2.1 Names

**No per-type permission exists in the codebase yet.** The pattern to follow
already exists, written down twice:

- `permission-columns.ts` (ACC-120 slice 5) was built for this rework: its
  header says "`*:view_all_tasks` reads as View, `*:create_tasks` as Create,
  and `*:manage_tasks` as a whole-row grant". The matrix plan
  (`step-120-5-permission-matrix.md:74-76`) says the same.
- `{module}:{action}` with action-specific strings (ACC-44's required pattern).

So, keyed by the **record's own module**:

| Ticket's name | Key (Committees) | Matrix column |
|---|---|---|
| View all tasks | `committees:view_all_tasks` | View (by rule) |
| Create tasks | `committees:create_tasks` | Create (by rule) |
| Manage tasks | `committees:manage_tasks` | whole row (by rule) |
| View unit tasks | `committees:view_unit_tasks` | View (by rule) |

They live in their own constants group, `COMMITTEE_TASKS_PERMISSIONS`, not
inside `COMMITTEES_PERMISSIONS`. The reason: QUALITY_MANAGER is seeded with
`...Object.values(COMMITTEES_PERMISSIONS)`, and the ACC-28 umbrella rule
("`committees:manage` holds every committee string") is about committee CRUD,
not task reach. A separate group keeps each grant deliberate. Its name ends in
`_PERMISSIONS`, so `ALL_PERMISSIONS` seeds it with nothing else to edit.

Each type's four keys come from one registry, never written per call site
(§3.1).

### 2.2 Which record types have tasks

| Type | Tasks today (shared database) | In the visibility registry | Owning unit |
|---|---|---|---|
| COMMITTEE | al-nakheel 42 (32 cancelled, 6 completed, 4 pending); al-manara 2 (cancelled) | yes, `committees:view` | `Committee.orgUnitId`, required since ACC-135 |
| MEETING | 0 (0 `Meeting` rows) | yes, `meetings:view` | none of its own (`committeeId` is nullable) |
| the other 9 `TaskSourceType` values | 0 | no | — |

**Recommendation:** define the four keys for COMMITTEE only. MEETING gets its
four when Meeting Management ships. Until then, a type with no entry fails
closed: relationships still work, and no permission reaches it (ACC-101's
shape: a forgotten type costs a visible gap, never a disclosure).

---

## 3. One rule

### 3.1 The shape

There is one predicate, **`taskVisibleSql(ctx)`**, in a new
`TaskVisibilityService` (`foundation/task/task-visibility.service.ts`).
**Every** answer is computed from it:

- the panel, All tasks, the unit view and Unassigned add their own filters to
  it in SQL, before `ORDER BY … LIMIT`;
- `TaskAdmissionService.admit(task)` asks it for one row
  (`SELECT EXISTS (… WHERE t.id = $1 AND t."organizationId" = $2 AND <predicate>)`)
  instead of today's JavaScript union.

So the list and the page agree **by construction**, and counts, facets and
`Load more` are computed from the same `WHERE` as the rows. `admit()` keeps
computing the facts the actions need (`mayManage`, `mayDecide`, `inPool`). It
stops deciding admission on its own.

`ctx` is built once per request by `TaskVisibilityService.contextFor(viewer,
organizationId, now)`. Every array is bound as a parameter:

```
coveredCreatorIds   creatorsCoveredBy(viewer) + viewer        (2–3 indexed reads)
pools               poolsOfUser(viewer)                        (2 indexed reads)
recordTypes         ObjectVisibilityService.viewableTypes()    (no read)
viewAllTypes        types where the viewer holds view_all_tasks AND sees the record type
manageTypes         types where the viewer holds manage_tasks  AND sees the record type
unitTypes           types that have an owning unit, the viewer sees the type, and either
                    the viewer heads a unit OR holds view_unit_tasks on it
unitIds             the subtree of every unit in scope        (one recursive CTE, §3.4)
now                 a bound instant, never SQL now()
```

The predicate, written out:

```
-- 2. a relationship: always counts, needs no permission
   t."createdById" = ANY(coveredCreatorIds)
OR EXISTS (SELECT 1 FROM "TaskAssignee" a WHERE a."taskId" = t.id AND a."userId" = viewerId)
OR (<waiting in a pool> AND (<pool match 1> OR <pool match 2> …))
OR (<has an open request> AND t."createdById" = ANY(coveredCreatorIds))
-- 1 + 3. the record first, then View all tasks
OR t."sourceType"::text = ANY(viewAllTypes)
-- 1 + 3. Manage tasks: deciding, and a departed creator's work
OR (t."sourceType"::text = ANY(manageTypes) AND (<has an open request> OR <creator not ACTIVE>))
-- 1 + 4. unit scope
OR (t."sourceType"::text = ANY(unitTypes) AND <owning unit of the record> = ANY(unitIds))
```

The registry that maps a type to its four keys and its owning-unit SQL is
`foundation/task/task-record-types.ts`:

```ts
COMMITTEE: {
  module: 'committees',               // keys: committees:view_all_tasks, …
  ownerUnitSql: sql`(SELECT c."orgUnitId" FROM "Committee" c
                      WHERE c.id = t."sourceId" AND c."organizationId" = t."organizationId")`,
}
```

A spec pins that every entry is also a type `ObjectVisibilityService` knows,
and that every key it derives is in `ALL_PERMISSIONS`.

### 3.2 Rule 1 and relationships

The record comes first for every **permission-based** way in: View all, Manage
and unit scope. That is what `ANY(viewAllTypes)` etc. encode, because those
arrays only hold types whose records the viewer can see.

**Relationships** (assignee, creator, acting-for-creator, pool member while
waiting, decider while open) are **not** behind record visibility today, and
this is deliberate. ACC-101's exemption says being the recipient is the
entitlement, and ACC-228 Q4 shows the page to anyone ever on the task. The
drawing's permission wall also assumes it ("links to the record if the viewer
can open that"), and the page already shows only the record's type to someone
who cannot open the record. The ticket's rule 1 says "nothing below overrides
that", and rule 2 says a relationship "always counts". Read literally, the two
conflict. **Q1 (§10)**; the predicate above is the recommended answer.

Record visibility today is permission-only (`object-visibility.service.ts:42-69`),
so it is a type test in SQL. When a type gains per-record visibility
(confidential documents), its registry entry gains a `recordVisibleSql`. The
predicate's shape does not change.

### 3.3 One "current head or acting head" function

**ACC-133 has not merged, and has not copied anything yet.**
`feature/ACC-133-headship-panel` is one commit ahead of `6e93a52`: `1e337d8`,
a plan file only (`backend/Plans/step-133-headship-panel.md`). Its worktree has
no uncommitted changes, and the branch is not on `origin`. The plan stopped on
a data gap and is waiting for Ahmad (its options A, B and C). Option A is where
it would read the open ACTING period for the cover row.

**Proposal:** one module of plain functions taking a client, the same style as
`task-pool.ts`, so neither module imports the other's service:
`foundation/organization/unit-headship.ts`.

```ts
/** An ACTING period in force at `now`: started, not ended, open or not yet over. UTC instants. */
export function actingInForceWhere(now: Date, reason?: OrgUnitActingReason): Prisma.OrgUnitHeadAssignmentWhereInput
/** An ACTING period not ended and not over: in force, or starting later (ACC-133's cover row). */
export function actingOpenWhere(now: Date): Prisma.OrgUnitHeadAssignmentWhereInput
/** The unit a user heads substantively by the holder rule, or null. */
export function substantiveHeadUnit(user: HolderFields): string | null
/** Who heads these units now: holders, and acting heads in force (both reasons). */
export function unitHeadsNow(client, organizationId, orgUnitIds, now): Promise<UnitHeadNow[]>
/** The units a person heads now, substantively or acting. ACC-244's unit scope. */
export function unitsHeadedBy(client, organizationId, userId, now): Promise<string[]>
```

- **`task-authority.service.ts`** moves its `absenceCoverNow()` and
  `substantiveHeadUnit()` here unchanged and calls `actingInForceWhere(now,
  'ABSENCE')`. Its specs stay as they are; a mutation proves they still guard.
- **ACC-244** calls `unitsHeadedBy()` for unit scope (both reasons: "an acting
  head while appointed").
- **ACC-133** (option A) calls `unitHeadsNow()` for the holders and
  `actingOpenWhere()` for the cover row, and adds its own reads for event
  dates.
- **Merge order:** the extraction ships in **ACC-244's first PR** (§9). It is
  small, changes no behaviour and needs no answer from Ahmad. ACC-133 rebases
  onto it. If ACC-133 resumes and merges first, ACC-244 extracts from whatever
  copy it added instead, and the rule is the same: two callers, no third copy.
- **One behaviour decision rides on it:** the holder rule with or without
  `position.isActive` (§1.4). **Q8.**

### 3.4 The sub-unit tree

There is no descendants helper today. The only recursive CTEs are the committee
loop checks (`committee-reference-checks.ts:118`). A new
`orgUnitSubtreeIds(client, organizationId, rootIds)` goes in
`foundation/organization/org-unit-tree.ts`:

```sql
WITH RECURSIVE s(id) AS (
  SELECT id FROM "OrgUnit" WHERE "organizationId" = $1 AND id = ANY($2) AND "isActive"
  UNION
  SELECT u.id FROM "OrgUnit" u JOIN s ON u."parentId" = s.id WHERE u."organizationId" = $1
) SELECT id FROM s
```

- **Cost:** one query per request, walking `OrgUnit(parentId)` (indexed) and
  touching only the subtree. Today that is 19–22 units, depth 3. `UNION`
  rather than `UNION ALL` stops on a cycle even though update refuses one
  (`organization.service.ts:505`).
- **Roots must be active; descendants are walked whether active or not.** A
  unit can be deactivated only with no active children, users or committees
  (`organization.service.ts:599-623`). So an inactive descendant holds only
  history, and its parent's head should still see it.
- **Why ids first, then the task query:** the panel needs the answer for one
  record ("does this record's unit fall in scope?") to pick its title, and a
  bound array keeps the task query plain. An inline CTE would save one round
  trip. Measure with `EXPLAIN` in PR 2 before choosing it.

### 3.5 The tests that make it "one rule"

A real-database spec runs, for every viewer kind in §8: the set of ids
All tasks lists, plus the unit view and Unassigned within their own filters,
equals the set of task ids `admit()` accepts on the record types concerned.
Counts and facets equal the row counts. Deleting the shared predicate from
either side turns it red.

---

## 4. Manage, Create, Unassigned

| Today | After |
|---|---|
| `mayManage()` override: `tasks:reassign` while the creator is not ACTIVE (`task.service.ts:2222`) | `manage_tasks` on the task's type, while the creator is not ACTIVE. Still the one line ACC-174 kept. |
| `reassign()` `:1468`, deciding `:525`, resume `:430`, awaiting-decision `:473`, `mayDecide` (page, rows), `assertMayAssign(?taskId)`, `reassignHolderIds()` | `manage_tasks` on **that task's** type, through one helper, `TaskVisibilityService.mayManageType(task, ctx)`. One rule, where today there are six copies. |
| `tasks:create` on `POST /tasks`, the SLA preview, Draft, `assertMayAssign()` with no task | `create_tasks` on **the record's type**, and the record visible and in the organisation. **This closes the gap in §1.2:** `create()` will refuse a record it cannot find with the identical 404. Route-level `@Permissions(tasks:create)` goes; the service decides, because the type is in the body. With no record (the SLA preview, the draft's availability, the picker without a task): `create_tasks` on at least one type. |
| `GET /tasks/unassigned`, `tasks:manage`, organisation-wide | `view=unassigned` on the list: UNASSIGNED tasks and empty-pool tasks, where `sourceType = ANY(manageTypes)`. The old route stays until lane A's slice 3 stops calling it, then goes. |
| `assertMayCount` (`tasks:view` + record) | "may see every task on this record": View all on its type, **or** the record's owning unit in scope. |

The behaviour of Manage stays exactly today's `tasks:reassign`: reassign and
decide outright, and edit, cancel and reopen only for a departed creator. A
Manage holder editing an ACTIVE creator's task would be new. **Q4.**

---

## 5. Seed and backfill

### 5.1 No customer tenant exists (read-only count)

| Organisation | Platform | Status | Created |
|---|---|---|---|
| al-manara | no | TRIAL | 2026-09-21 (fixture) |
| al-nakheel | no | TRIAL | 2026-09-21 (fixture) |
| platform | yes | — | 2026-09-21 |

That is 2 non-platform organisations, both seed fixtures. **Revoking is
allowed.** The backfill re-checks this the way ACC-162's does
(`backfill-retire-tasks-complete.ts`: every organisation is the platform org or
a fixture slug, or `--execute` refuses).

More read-only counts:

- no workflow transition requires a `tasks:*` permission;
- no custom role holds one (3 custom roles exist, none with `tasks:*`);
- the catalogue holds exactly `tasks:view`, `tasks:create`, `tasks:reassign`,
  `tasks:manage`;
- no ACTING period exists in either tenant, open or closed;
- every active user has a primary unit.

### 5.2 Recommended grants

| Role | `committees:view` today | view_all_tasks | create_tasks | manage_tasks | view_unit_tasks | Old task keys today |
|---|---|---|---|---|---|---|
| TENANT_ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ | all four |
| QUALITY_MANAGER | ✓ | ✓ | ✓ | ✓ | — (redundant beside view_all) | all four |
| QUALITY_OFFICER | **✗** | — | — | — | — | view, manage |
| AUDITOR | **✗** | — | — | — | — | view |
| BASE_USER | ✗ | — | — | — | — | none |
| VIEWER | ✓ | **— (recommended)** | — | — | — | view |
| READ_ONLY_ADMIN | ✓ | ✓ (its `view_*` regex) | — | — | ✓ (same regex) | view |
| PLATFORM_ADMIN | inert in tenants | ✓ | ✓ | ✓ | ✓ | all four |
| Head positions (`OrgPosition.roleId`) | — | — | — | — | — | unit scope is **automatic**, no grant |

Why each line:

- **QUALITY_OFFICER and AUDITOR** hold `tasks:view` today and reach **no**
  committee task with it: they cannot see committees, so their All tasks is
  empty. Granting committee task keys would be inert. Whether they should see
  committees at all is a separate decision. **Q6.**
- **VIEWER** is the defect Ahmad found. The hospital fixture maps Unit Head →
  VIEWER (`hospital.fixture.ts:75`), and VIEWER's `tasks:view` plus
  `committees:view` opens every committee task. Taking view-all away from
  VIEWER closes it for every tenant that copies the fixture's mapping. The
  alternative (VIEWER keeps it; the fixture maps heads to something else) fixes
  only our fixture. **Q2.**
- **QUALITY_MANAGER:** spread its new group explicitly, without
  `view_unit_tasks` (it adds nothing beside view-all), or spread all four for
  simplicity. Either is harmless; the plan takes the explicit three.
- **What `OrgPosition.roleId` actually reaches:** 7 active Unit Head holders in
  al-nakheel have VIEWER as their position's role, but only 1 of them (Fatima)
  holds VIEWER. Saving a position's role does not reach current holders
  (ACC-84). So "most heads see every task" is true of that one head and the
  VIEWER persona (Nasser), not of all seven.

### 5.3 `tasks:view`, `tasks:create`, `tasks:reassign`, `tasks:manage`

**All four are retired.** Each is replaced by its per-type key, and nothing
reads the old ones after PR 2. They leave the constants, so
`seedPermissions()` stops recreating them. Then the PR 2 backfill deletes
every grant of them, and the catalogue rows, after the deploy (ACC-162's order
and shape: one transaction, one audit row per organisation with each affected
role's set before and after, actor null, script and ticket in metadata).
`role.seed.spec.ts:64` ("keeps tasks:view on …") is rewritten to pin each
system role's exact task-key set.

### 5.4 Dry run: tasks each user can open, today and after

Computed read-only by `acc244-dryrun.cjs` (scratchpad, outside the repo).

- **Today** is `admit()`'s union: relationships, `tasks:reassign` cases, and
  `tasks:view` plus a visible record.
- **After** is §3's predicate under §5.2's grants.
- **List** counts the All tasks or unit view rows (today: `tasks:view` and a
  visible record; after: view-all and unit scope).

Only users with a non-zero count are shown; every other active user is 0 → 0.

**al-manara** (2 tasks, 22 active users)

| User | Roles | Position | Open today → after | List today → after |
|---|---|---|---|---|
| Prof. Adel Al-Mansoori | TENANT_ADMIN | Rector (head of root) | 2 → 2 | 2 → 2 |
| Dr. Hind Al-Dhaheri | QUALITY_MANAGER | Director | 2 → 2 | 2 → 2 |
| Prof. Salma Al-Falasi | READ_ONLY_ADMIN | Dean | 2 → 2 | 2 → 2 |
| **Prof. Badr Al-Marzooqi** | VIEWER | Dean | **2 → 0** | **2 → 0** |
| 18 others | | | 0 → 0 | 0 → 0 |

**al-nakheel** (42 tasks, 24 active users)

| User | Roles | Position | Open today → after | List today → after |
|---|---|---|---|---|
| Dr. Hessa Al-Dosari | TENANT_ADMIN | CEO (head of root) | 42 → 42 | 42 → 42 |
| Dr. Yasser Al-Amri | QUALITY_MANAGER | Director (head of Quality) | 42 → 42 | 42 → 42 |
| Noura Al-Ghamdi | READ_ONLY_ADMIN | Director | 42 → 42 | 42 → 42 |
| **Fatima Al-Anazi** | VIEWER (via Unit Head) | Unit Head | **42 → 0** | **42 → 0** |
| **Nasser Al-Qassimi** | VIEWER | Director | **42 → 0** | **42 → 0** |
| Mohammed Al-Otaibi | — | Head of Section | 11 → 11 | 0 → 0 |
| Dr. Sara Al-Mutairi | — | Unit Head | 9 → 9 | 0 → 0 |
| Mohammed Al-Otaibi | BASE_USER | Specialist | 4 → 4 | 0 → 0 |
| Dr. Faisal Al-Qahtani | — | Chief Medical Officer | 1 → 1 | 0 → 0 |
| Haya Al-Marri | QUALITY_OFFICER | Head of Section | 1 → 1 | 0 → 0 |
| 14 others | | | 0 → 0 | 0 → 0 |

What it shows:

- **Exactly the three VIEWER holders change**, and each goes to zero, because
  no unit they head owns a committee.
- **Nobody gains**, and nobody with a relationship loses one.
- **Unit scope adds nothing on today's data.** Every committee is owned by
  either the root unit (al-manara, and al-nakheel's three) or Quality & Patient
  Safety (al-nakheel's two proof committees). Their heads are the tenant admin
  and the Quality Manager, who see everything already.
- So unit scope is proved by the specs' own fixtures (§8), and live only on a
  committee owned by a deeper unit, which this plan does not create. **Q7.**
- With VIEWER keeping view-all (Q2's alternative), the table is unchanged from
  today for every user.

---

## 6. What lane A's slice 3 needs from the API

**`GET /tasks/views`** (new, no `@Permissions`, self-scoped) answers which saved
views this viewer gets, so the screen never re-derives a rule:

```ts
{
  mine: true,                                     // My tasks, always
  all: { types: ['COMMITTEE'] } | null,           // View all tasks on ≥1 type
  unassigned: { types: ['COMMITTEE'] } | null,    // Manage tasks on ≥1 type
  unit: { types: ['COMMITTEE'], units: [{ id, nameEn, nameAr, via: 'HEAD' | 'ACTING' | 'PERMISSION' }] } | null,
  create: { types: ['COMMITTEE'] },               // New task, and the panel's button
}
```

**`GET /tasks/record-list?view=all|unit|unassigned`**, alongside today's
record mode:

- every view keeps today's filters, sorts and `Load more`;
- `all` adds a Record type facet;
- `unit` adds a Unit facet (the units in scope, sub-units included).

**`GET /tasks/record-panel`** keeps its contract. `scope: 'all'` now also
means "the record's unit is in your scope", and the panel gains `canCreate`,
so the committee page stops reading `tasks:create`.

Which record types each view covers: today, COMMITTEE only (§2.2).

**The unit view's name** is owed by the designer. Proposed default: **"Unit
tasks"** / **"مهام الوحدة"**, with a Unit filter whenever the viewer's scope
holds more than one top-level unit (a head who is also acting elsewhere).
**Q9.**

The frontend key swaps listed in §1.3 ship in PR 2 (§9), before the revocation
runs, so no button disappears in between. Lane A then builds slice 3 (one
`/tasks` list, rail items removed) on this API.

---

## 7. Edge cases

| Case | Behaviour |
|---|---|
| **Head of a parent unit** | sees every task on records owned by any unit below theirs (the subtree). The head of the root sees every committee task. |
| **Acting period starting or ending today** | compared as UTC instants against a bound `now`: `validFrom <= now`, and `validTo` null or `> now`, with `endedAt` null. Never SQL `now()` (the columns are `timestamp without time zone`, ACC-236), never a date string. The dialog sends the browser's local midnight as an instant (`set-acting-head-dialog.component.ts:789-790`). So a cover "from today" starts at that instant (21:00Z the day before, in Riyadh) and ends at the instant `validTo` names. Specs pin one millisecond either side of both edges. |
| **Future-dated acting appointment** | no scope until `validFrom`. The `actingHeadUserId` cache, which is set before it starts, is never read (the spec mutates to it and goes red). |
| **Ended early** (`endedAt` set) | no scope from that instant. |
| **Both an absent head and an ABSENCE acting head** | both see the unit. |
| **Handover in progress** | the incoming successor holds the position, so by the holder rule both are heads. **Q5.** |
| **No `primaryOrgUnitId`** | `view_unit_tasks` gives nothing; nobody can be a substantive head (the holder rule needs it). An acting head still gets the unit they act for. Today: 0 such active users. |
| **Record type with no owning unit** (MEETING; future types without one) | unit scope never applies to it. View all and relationships do. The registry says `ownerUnitSql: null`. |
| **Deactivated unit** | not a root (an appointment over it gives nothing). Walked through as a descendant, so its history stays with the parent's head (§3.4). |
| **Pool tasks** | a pool member sees the task while it waits (relationship). Unit scope keys on the **record's** unit, never the pool's (`assignedOrgUnitId`): a Cardiology head does not see a Quality committee's task pooled to a Cardiology position, unless they are in that pool. **Q3.** |
| **Another organisation's tasks** | every read is scoped `organizationId`: the predicate, the subtree CTE, the head reads, and the owning-unit subquery (`c."organizationId" = t."organizationId"`). `admit()` and every refusal answer the identical 404 "Task not found". Create refuses another organisation's record id with the same 404. |

---

## 8. Tests

**Real-database specs** (`npm run test:db`, after the migrations in CI):

1. `task-visibility.db-spec.ts`. One fixture tree, root → department → ward,
   with committees owned at each level and tasks of every shape: assigned,
   pool waiting, pool picked, open request, departed creator, cancelled. The
   viewers, each asserting the exact id set across All tasks, the unit view,
   Unassigned, the panel and `admit()`:
   - **relationship only** (assignee, creator, out-of-office delegate, pool
     member, decider), with no permissions;
   - **View all tasks** on COMMITTEE with `committees:view`, then the same key
     without `committees:view` (sees nothing permission-based: rule 1);
   - **substantive head** of the department: sees department and ward, not a
     sibling;
   - **acting head**, VACANCY and ABSENCE, each in force, future, ended early,
     and past `validTo`, with the boundary instants;
   - **View unit tasks holder**: their primary unit and below, not the parent;
   - **nobody**: a user with no roles sees only My tasks' own rows;
   - **Manage tasks**: Unassigned limited to its types; reassign, decide and
     departed-creator edit allowed, active-creator edit refused (Q4 as
     recommended).
2. **Tenant isolation**, named exactly `should NOT return records belonging to
   a different tenant` (CI's gate). A second organisation with the same tree
   shape: none of its tasks, units or heads appear in any answer, and its record
   id on `POST /tasks` is the identical 404.
3. **Agreement:** list ids = `admit()` ids, and `total` / `matching` / facets =
   row counts, per viewer (§3.5).
4. `task-record-list.actions.db-spec.ts` stays (row actions = page actions),
   re-seeded on the new keys.
5. **Unit specs:** `unit-headship.ts`, using `useFixedClock()` (ACC-248), and
   the `task-authority` specs unchanged; `role.seed.spec.ts` pins each role's
   exact task keys; the registry spec (§3.1); `create()` refusing an invented,
   foreign or invisible record.

**Mutations to run, each expected to turn a named spec red:**

- drop the record-type test from the view-all clause;
- walk only the root (no subtree);
- read `actingHeadUserId` instead of the period table;
- `validTo >= now` for `> now`;
- drop `organizationId` from the CTE, then from the owning-unit subquery;
- leave `mayManage()` on `tasks:reassign`;
- filter after `LIMIT` (count ≠ rows);
- restore `admit()`'s JavaScript union beside the predicate.

---

## 9. Migrations and PRs

**No schema migration.** Permissions are catalogue rows. Unit scope reads
existing tables, and the indexes it needs exist: `Committee(orgUnitId)`,
`OrgUnit(parentId)`, `Task(sourceType, sourceId)`, `TaskAssignee(userId)`, and
the pool indexes. If PR 2's `EXPLAIN` at realistic volume shows a scan, an
additive `Task(organizationId, sourceType)` index is the candidate; it is not
added blind.

**Three PRs, expand then contract:**

1. **PR 1, expand. AS SHIPPED (20 Oct): the keys, the create check and the
   grant script.**
   - `COMMITTEE_TASKS_PERMISSIONS` (the four keys) and the seed grants for new
     organisations, the old flat keys kept beside them. The four keys sit on
     `PERMISSIONS_NOT_YET_CHECKED` (ACC-120's R2): the matrix hides them and
     the API refuses to grant them by hand until PR 2 reads them. Their English
     and Arabic sentences are in place.
   - **The create check:** `POST /tasks` calls `createForViewer()`, which
     requires the record to exist in the caller's organisation and be visible
     to them (403 naming the permission, or the identical 404), before
     `create()`. It still reads `tasks:create`.
   - `backfill:acc244-grant-task-keys`: dry run first, then `-- --execute`
     after the deploy. It upserts the catalogue rows and grants §5.2's keys to
     existing system roles, only where the role holds the flat key the new one
     replaces; one audit row per grant; revokes nothing; idempotent.

   Nothing reads the new keys, so this is safe at any point.
2. **PR 2, switch.** It STARTS with the shared headship work, after ACC-133
   merges (moved from PR 1 on 20 Oct, because ACC-133 creates the file):
   - rebase onto ACC-133 and, in its `unit-headship.ts`, reuse
     `findCurrentHeadHolders` and `findRunningActingCover` as they are; add the
     reverse (the units a user heads or covers now, from the same rules) and
     the sub-unit query (§3.4);
   - move `task-authority.service.ts` onto `findRunningActingCover` with no
     change in behaviour, always passing an explicit `now`;
   - the headship specs (head, acting head inside, before and after its
     period, an inactive position, a handover with two holders, sub-units) and
     the §8 mutations that apply to them.

   Then the switch itself:
   - the registry (§3.1), `TaskVisibilityService` and every path in §1 onto it;
   - Create on the record's type replaces `tasks:create` (the record check is
     already in place from PR 1); `GET /tasks/views`; `view=` on the list;
     `canCreate` on the panel;
   - the four keys off `PERMISSIONS_NOT_YET_CHECKED`;
   - the two caller-less legacy routes removed (Q10);
   - the §1.3 frontend key swaps;
   - the old constants removed.

   Then `backfill:acc244-task-permissions-revoke`, dry run first, then
   `--execute` **after** PR 2 is deployed. It deletes the grants and catalogue
   rows of the four old keys, with the audit trail. Between the deploy and the
   revocation, nothing reads the old keys, so there is no access gap.
3. **Lane A, slice 3:** one `/tasks` list with saved views, on PR 2's API.

SYSTEM-REFERENCE.md (§3.12, §3.13, §5) and CLAUDE.md are updated in PR 2.

---

## 10. Questions for Ahmad

### Answers (Ahmad, 20 Oct)

| Q | Answer |
|---|---|
| 1 | **Open**, on a card. PR 1 is built as if "keep today's way": relationships do not need the record. |
| 2 | **Yes.** VIEWER loses View all tasks. |
| 3 | **Records owned**, as the ticket says. |
| 4 | **No.** Manage edits only a departed creator's work. |
| 5 | **Yes.** The incoming successor gets unit scope during a handover. |
| 6 | **No change.** |
| 7 | **No live data.** The specs prove unit scope. |
| 8 | **Yes.** The shared head rule requires an active head position. |
| 9 | **"Unit tasks" / "مهام الوحدة"**, pending the designer. |
| 10 | **Remove both** legacy routes in PR 2. |

**Changes to the plan these answers and the PR 1 brief make:**

- **Shared headship (§3.3) is ACC-133's file, and the work is the start of
  PR 2** (moved from PR 1, 20 Oct). Lane A's ACC-133 merges first
  and creates `foundation/organization/unit-headship.ts` with
  `findCurrentHeadHolders(prisma, organizationId, orgUnitId)` and
  `findRunningActingCover(prisma, organizationId, orgUnitId, now)`. ACC-244
  reuses both unchanged. It adds only the reverse (the units a user heads or
  covers now, from the same rules) and the sub-unit query, and moves
  `task-authority.service.ts` onto `findRunningActingCover` with no change in
  behaviour. ACC-244 does not create the file itself.
- **The create check (§4) moves into PR 1.** `POST /tasks` checks that the
  record exists in the caller's organisation and is visible to them, from PR 1
  on. It still reads `tasks:create`; the per-type key replaces it in PR 2.
- **PR 1's grant script is `backfill:acc244-grant-task-keys`.** It grants
  §5.2's new keys, one audit row per grant, and revokes nothing.

### The questions as asked

Each had a recommended answer; the plan assumed it.

1. **Does a relationship need the record to be visible?** Today it does not:
   an assignee opens their task even without `committees:view`, and the page
   shows the record's type only. **Recommended: keep that.** Rule 1 governs
   every permission-based way in (View all, Manage, unit scope); relationships
   stand on their own, as ACC-101 and ACC-228 decided.
2. **VIEWER and View all tasks.** **Recommended: VIEWER loses it.** VIEWER
   keeps reading every record, but sees only its own tasks. That fixes the head
   defect for any tenant that maps heads to VIEWER, and READ_ONLY_ADMIN keeps
   organisation-wide task reading for surveyors. The cost: Nasser (the VIEWER
   persona) and Badr go to 0 tasks, as the dry run shows.
3. **Unit scope covers records owned by the unit, not work assigned into it.**
   A head does not see a Quality committee's task pooled to their own unit's
   position. **Recommended: as the ticket says (records owned).** "What my
   staff are working on" is a different view; ticket it separately if wanted.
4. **May Manage tasks edit, cancel and reopen an ACTIVE creator's task?**
   **Recommended: no, keep today's line.** Manage reassigns and decides
   outright, and edits only a departed creator's work.
5. **Does the incoming successor get unit scope during a handover?**
   **Recommended: yes.** They hold the position by the holder rule, and ACC-133
   draws "Head access since" for exactly that state.
6. **Should QUALITY_OFFICER and AUDITOR see committees?** Their `tasks:view`
   reaches nothing today. **Recommended: no change here.** Give them their own
   types' task keys when Audit and the other modules ship.
7. **A live proof of unit scope needs a committee owned by a deeper unit**, and
   none exists. **Recommended:** prove it on the real-database specs, and live
   only on al-nakheel with one test committee if you approve creating it. No
   data is created otherwise.
8. **Holder rule and `position.isActive`.** `task-authority` ignores it; the
   vacancy and escalation code requires it. **Recommended: require it** in the
   shared function. A deactivated head position confers nothing; on today's
   data no active head holds an inactive head position.
9. **The unit view's name.** **Recommended default: "Unit tasks" / "مهام
   الوحدة"**, with a Unit filter when more than one unit is in scope, pending
   the designer's addendum.
10. **Remove `GET /tasks?sourceType=` and `GET /tasks/:id`?** Neither has a
    frontend caller, and both answer from a third copy of the rule.
    **Recommended: remove them in PR 2.** There is no public API yet.
