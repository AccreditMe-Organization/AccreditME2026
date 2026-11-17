# ACC-86 — an open task with no current ACTIVE assignee is ownerless (plan)

**Prompt 110 (lane B), 17 Nov. Plan only: nothing is built.**
- **Branch:** `fix/ACC-86-ownerless-tasks`, from dev `ed468db` (#321 included; #329 merging).
- **Line numbers:** against that commit.

The ticket was written during ACC-82, before pools (ACC-167), the departure branches (ACC-165's `departure_returned_to_pool` / `departure_left_with_others`) and the visibility rule (ACC-244). This plan checks it against today's code first.

---

## 1. `reassignAllForUser()` still counts remaining assignees without their status

**Yes.** In `backend/src/foundation/task/task.service.ts`:

| Line | What it does |
| -- | -- |
| `:1782` | `reassignAllForUser()` runs `departTaskInTx()` once per task, each in its own transaction under the task's row lock (ACC-165) |
| `:1898-1900` | `remainingActiveOthers = task.assignees.filter((a) => a.id !== leaving.id && a.removedAt === null)`. Despite its name, it never looks at the other users' `status` |
| `:1921` | **pool task:** it returns to its pool only when `remainingActiveOthers.length === 0`; otherwise it is `left_with_others`. So a pool task whose only remaining row belongs to an INACTIVE user stays "with others" and is **never returned to its pool** |
| `:1967` | **non-pool task, no acting user:** UNASSIGNED only when `remainingActiveOthers.length === 0`. A task whose other row is an INACTIVE user's stays PENDING / IN_PROGRESS / ON_HOLD (the ticket's case) |

**The same `removedAt`-only "anyone else on it?" check makes three other decisions:**
- `reject()` `:891`, `othersRemain`: decides REJECTED (back to the creator) versus "the task carries on with the others". A task whose only other row is an INACTIVE user's carries on with nobody.
- `release()` `:1708`, `othersRemain`: decides back-to-pool versus "carries on". Same failure.
- `pick()` `:1643`: refuses "already picked up" while any current row exists. So a pool task whose only current row is an INACTIVE user's can never be picked.

**Not ownership decisions, so out of scope:**
- `complete()` `:808` and `activeAssigneeIds()` `:2549` only list whom to tell.
- The closed-task notices already send only to ACTIVE row holders (ACC-271 PR 4).

## 2. Every path that can leave an open task with no current ACTIVE assignee

"Open" means not COMPLETED and not CANCELLED (`OPEN_STATUS_FILTER`, `task.service.ts:101`).

| Path | How | Caught today? |
| -- | -- | -- |
| **Created with nobody**: no assignee chosen, or a single-holder position with no holder | status UNASSIGNED | yes: UNASSIGNED |
| **Pool task waiting for a pick**: no current row, the pool has an ACTIVE member | the pool owns it | **not ownerless, correctly**: it shows in Available for the pool's members (`waitingInPoolWhere()`, `task-pool.ts:99`) |
| **Pool task waiting, nobody in the pool** | no current row, no ACTIVE holder or member | yes: `findEmptyPoolTasks()` (§3) |
| **A departure, the last ACTIVE assignee leaving while another current row belongs to an INACTIVE user** | §1, `:1898` | **no**: the task keeps its status, and a pool task is not returned to its pool |
| **A departure that stopped partway** | `UserService.deactivate()` commits the status flip first (`user.service.ts:1546`) and runs `reassignAllForUser()` after, per task, outside that transaction. A failure leaves the INACTIVE user's remaining rows current | **no** |
| **Reject or release with an INACTIVE co-assignee** | §1, `:891`, `:1708` | **no** |
| **An assignee made non-ACTIVE some other way** | none exists. `deactivate()` is the only writer of INACTIVE (`user.service.ts:1546`); SUSPENDED is set by nothing (`user.service.ts:1653`). INVITED users are never assigned (`filterActiveUsers()` `:2534`, and the pool and holder rules require ACTIVE). Only seeds and scripts writing straight to the database could | n/a, but the live check (§5) covers it |

**How a pool task waiting for a pick counts:** owned while its pool has an ACTIVE member, ownerless while it has none. That is what `findEmptyPoolTasks()` already decides; the plan keeps it, and only changes what "nobody on it" means (current AND ACTIVE).

**The other readers that share the blind spot**, because they test "no current row" without the user's status:
- `UNOWNED_SQL`, `task-visibility.ts:141`: the Unassigned view, and what Manage tasks reaches (ACC-244);
- `WAITING_IN_POOL_SQL`, `task-visibility.ts:132`;
- `waitingInPoolWhere()`, `task-pool.ts:104`: Available, `findEmptyPoolTasks()`;
- the unpicked-pool escalation sweep, `sla-monitor.processor.ts:720`.

## 3. What Setup health's ownerless detector matches today

In `backend/src/foundation/setup-health/setup-condition.detectors.ts`:
- **`TASK_WITHOUT_OWNER`** (`:119`) → `tasksWithoutOwner()` (`:417`), the union of two sets:
  - `status: 'UNASSIGNED'` (`:423`);
  - `findEmptyPoolTasks()` (`task-pool.ts:231`): open pool tasks in PENDING / OVERDUE that are "waiting" by `waitingInPoolWhere()` (no row with `removedAt` null, whoever holds it), whose position has no ACTIVE holder in the unit or whose committee role has no active member.
- **It misses** every row in §2 marked "no": a PENDING / IN_PROGRESS / OVERDUE / ON_HOLD task whose only current rows are INACTIVE users', pool or not.

## 4. The shared database (read-only, 17 Nov, counts and slugs only)

Run from `D:\Accredit-me-2\backend` inside `BEGIN READ ONLY`. No id, name or title was printed.

| Organisation | Open tasks | With no current ACTIVE assignee | Current rows held by non-ACTIVE users on open tasks |
| -- | -- | -- | -- |
| al-nakheel | 3 | **0** | 0 |
| al-manara | 1 | **0** | 0 |

Nothing to split by status or pool: both are zero. As in ACC-82's check, the fix is ahead of the data, and **no backfill or repair is needed**.

## 5. The fix (recommendation)

**ACC-82's rule:** "ownerless" is DERIVED, so it is read live. No writer has to maintain a status for it, and no column is added. **No schema change:** `User.status` and `TaskAssignee.removedAt` already state the fact.

### 5.1 One definition, in one file

In `task-pool.ts`, beside the pool rule:

- **`CURRENT_ACTIVE_ASSIGNEE`** (Prisma): `{ removedAt: null, user: { status: 'ACTIVE' } }`.
- **`currentActiveAssigneeSql(alias)`** (raw SQL):
  `EXISTS (SELECT 1 FROM "TaskAssignee" x JOIN "User" xu ON xu.id = x."userId" WHERE x."taskId" = t.id AND x."removedAt" IS NULL AND xu.status::text = 'ACTIVE')`.
  - The user is joined by id. `TaskAssignee` has no `organizationId`; the task's own `organizationId` is in every caller's `WHERE`, and an assignee is always in the task's organisation (`filterActiveUsers()`).

Everything below reads these two; never a third copy.

### 5.2 The readers resolve it live

| Reader | Change |
| -- | -- |
| `waitingInPoolWhere()` (`task-pool.ts:104`) | `assignees: { none: CURRENT_ACTIVE_ASSIGNEE }`. Available, Pick's pool and `findEmptyPoolTasks()` then treat a pool task held only by INACTIVE users as waiting in its pool |
| `WAITING_IN_POOL_SQL` (`task-visibility.ts:132`) | `NOT currentActiveAssigneeSql('t')` |
| `UNOWNED_SQL` (`task-visibility.ts:141`) | adds the general case below; the Unassigned view and Manage tasks follow |
| `tasksWithoutOwner()` (`setup-condition.detectors.ts:417`) | adds the general case below, from the same definition as `UNOWNED_SQL`. It may simply run `UNOWNED_SQL`, scoped by organisation, so the screen and Setup health cannot disagree |
| the unpicked-pool sweep (`sla-monitor.processor.ts:720`) | `none: CURRENT_ACTIVE_ASSIGNEE` |

**The general case, "ownerless":** status PENDING, IN_PROGRESS, OVERDUE or ON_HOLD, with no current ACTIVE assignee, and either no pool or a pool with no ACTIVE member.
- UNASSIGNED stays in as today.
- REJECTED stays out: it is the creator's to reassign, and a departed creator is already Manage tasks' clause (ACC-244).
- A pool task with an ACTIVE pool member is waiting in its pool, not ownerless.

### 5.3 The writers count only ACTIVE others

All decided under the task's row lock (ACC-163), so the statuses read are the locked snapshot's:

- **`departTaskInTx()`:** `remainingActiveOthers` filters `a.removedAt === null && <user ACTIVE>`. The task read at `:1883` includes `assignees: { include: { user: { select: { status: true } } } }`, the same query with one join, no extra round trip. Then:
  - a pool task returns to its pool;
  - a non-pool task becomes UNASSIGNED.
- **`reject()` `:891` and `release()` `:1708`:** `othersRemain` counts only ACTIVE others. Their locked reads (`lockOpenForActiveAssignee()` and its siblings) gain the same `user.status` select.
- **`pick()` `:1643`:** "already picked up" only when a current ACTIVE row exists. When it takes a task whose only current rows are INACTIVE users', it **ends those rows in the same transaction** (`removedAt = now`), so the new picker is the only current row. Recorded in the pick's audit metadata (`endedInactiveRows: n`, ids only).
- **Q-1:** should the departure also end the other INACTIVE users' stale rows when it returns a task to its pool or makes it UNASSIGNED?

### 5.4 Not changed

- **No `UNASSIGNED` write is added for a task that becomes ownerless by someone else's departure being interrupted.** The live readers above already show it, and ACC-82 forbids a status kept true by writers alone.
- **`sweepOverdueTasks()`** keeps excluding UNASSIGNED only. An ownerless PENDING task can still be marked overdue and escalated, which is the right outcome: someone is told.

## 6. Specs

**`task.service.spec.ts` (unit):**
- `departTaskInTx()`: a task with one other current row held by an INACTIVE user becomes UNASSIGNED; a pool task in the same shape returns to its pool.
- `reject()` and `release()`: the same shape rejects or returns to the pool.
- `pick()`: a pool task whose only current row is an INACTIVE user's can be picked, and that row is ended.

**`ownerless-tasks.db-spec.ts` (new, test:db).** One organisation; every case is the real services on real rows, plus two concurrency cases.
- An interrupted departure (the user flipped INACTIVE, the reassignment never run): the task is in `tasksWithoutOwner()` and in the Unassigned view (`UNOWNED_SQL`), whatever its status.
- A pool task held only by an INACTIVE user, with an ACTIVE pool member: in Available, pickable, not ownerless.
- The same pool task with nobody in the pool: ownerless.
- A task with one ACTIVE and one INACTIVE current row: not ownerless.
- The departure, reject and release cases end to end.
- Two departures of a task's two assignees at once (one task lock): it ends UNASSIGNED exactly once, ten times over.
- **`should NOT return records belonging to a different tenant`** (named exactly): an ownerless task and an INACTIVE user in another organisation never appear in this organisation's detector, Unassigned view or Available, and are not counted.

**Also:**
- `setup-condition.detectors.spec.ts` (unit): the detector's query carries `organizationId` and the definition from 5.1.
- **Mutations, each must go red:**
  1. `remainingActiveOthers` back to `removedAt` only;
  2. `waitingInPoolWhere()` back to `removedAt` only;
  3. the detector back to `status: 'UNASSIGNED'` plus empty pools;
  4. `UNOWNED_SQL` without the general case;
  5. pick not ending the inactive rows.

## 7. Docs

- **SYSTEM-REFERENCE §3:** the task model, the departure branches, pools and the visibility rule's `UNOWNED_SQL`.
- **SYSTEM-REFERENCE §13.2:** `TASK_WITHOUT_OWNER` matches "no current ACTIVE assignee and no staffed pool", whatever the status.
- **CLAUDE.md:** no entry is needed unless lane B wants the rule recorded under ACC-82's.

## 8. Performance

- **Detector and Unassigned view:** one `EXISTS` with a join on `TaskAssignee (taskId)` and `User` by primary key, inside queries that already scan the organisation's open tasks. No new query.
- **Writers:** one extra selected column on reads they already make.
- **Per-request path:** nothing.
- **Polling:** none.

## 9. Open questions (recommendation first)

**Q-1. Should a departure that returns a task to its pool, or makes it UNASSIGNED, also end the OTHER INACTIVE users' current rows?**
- **Recommend:** yes, in the same transaction, with the count in the departure's audit metadata. It leaves the task in the shape every `removedAt`-based reader already expects, and those rows belong to people who have already left.
- **Alternative:** leave them. The readers above are correct either way, because they ask ACTIVE.

**Q-2. Is an ON_HOLD task with no ACTIVE assignee ownerless?**
- **Recommend:** yes. Nobody can resume it, and ACC-173 already ends a hold when a departure leaves nobody.
- **Alternative:** no, until its hold ends.

**Q-3. Should the screens say *why* a task is ownerless** ("its assignee has left" versus "nobody was assigned")?
- **Recommend:** not in this ticket. The Unassigned view lists it, and the reason can come with the screens later.
