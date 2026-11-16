# Step 175: a start before opening time counts that day

**Ticket:** [ACC-175](https://linear.app/accreditme/issue/ACC-175), "calculateDeadline skips the
rest of a working day for a start before opening time".

**Status:** plan only, 16 Nov. Branch `feature/ACC-175-deadline-before-opening`, from `origin/dev`
at `995f12a`. Code read on that commit. Shared-database facts are read-only counts, run from
`D:\Accredit-me-2\backend`.

---

## Ahmad's decisions (recommendation first)

1. **(b) Stored deadlines: forward-only. Nothing already stored is rewritten.**
   - **What stays:** every stored `dueAt`, `slaLimitAt`, `slaDueAt` (stage) and `poolEscalateAt`
     keeps its value. Only dates computed after the deploy use the new rule.
   - **Why:** rewriting would pull dates EARLIER by up to one working day, and could make a task
     or a stage overdue overnight with nobody having done anything. Forward-only never takes
     time away from anyone.
   - **On the shared database today** this touches **1 open task and 1 open stage entry** (§4).
     Every open task has its SLA start and limit stored, and 4 of 5 have a due date a person
     picked, so **nothing on screen changes until someone acts on a task.**
   - **What a person may notice:** on that 1 task, Edit's picker computes the OTHER priorities'
     windows live from the task's start, so they come out up to one day earlier than the stored
     ones. The current priority still shows the stored limit. A priority change, a reopen, or a
     new task uses the new rule.
2. **(c) Zero hours: keep the documented normalisation.** `calculateDeadline(x, 0)` returns the
   next working moment, unchanged in spirit:
   - **inside working hours:** `x` itself;
   - **before opening on a working day:** that day's opening. This is new: today it is the next
     day's opening. It's the same fix as (a).
   - **after closing, or on a day off:** the next working day's opening (unchanged).

   **Who passes 0:** only `TaskService.poolClock()`, when a priority's
   `managerEscalationAfterHours` is 0 (allowed, `@Min(0)`). No organisation has that today.
   - `TaskSlaService.shift()` returns its date unchanged for 0 and never calls the calendar.
   - A stage with 0 or no SLA hours gets no deadline.
   - The workload window passes `2 × hours per day`, which is never 0.

   For a pool task made after hours with 0 escalation hours, "escalate at the next opening" is
   right: escalation only fires in working hours anyway. No caller is harmed, so keep it.
3. **(a) The fix itself changes what people see**, but only for clocks that start before opening
   on a working day.
   - **Example:** a task created Monday 07:30 with a 2-hour SLA is due **Monday 10:00**, not
     Tuesday 10:00.
   - **How often:** 20 of the 46 tasks ever made on the shared database started before opening
     (Riyadh), so this is a common path, not an edge case.
   - **The screen already agrees:** the New task dialog's out-of-hours line ("the clock starts
     again at…", `DueDateService.resumeAfter()`) treats a before-opening time as that day's
     opening. The server will now agree with it.
4. **(d) No frontend change.** Every SLA date on screen comes from the server: the New task, Edit
   and Reopen pickers read `GET /tasks/sla-preview` and `GET /tasks/:id/sla-preview`. They show
   the new rule the moment the backend ships. The frontend's own `resumeAfter()` already treats
   a before-opening time as that day's opening.

---

## 1. The rule, and the defect

`WorkingCalendarService.calculateDeadline(start, hours, org)`
(`working-calendar.service.ts:280`):
1. puts `start` in the calendar's zone;
2. normalises it with `nextWorkingStart()`;
3. spends the rest of today, then whole days, then the remainder.

`nextWorkingStart()` (`:372`) keeps `dt` only when `isWorkingDay(dt) && dt >= opening &&
dt < closing`. **Everything else, including a moment before opening on a working day, jumps to
the NEXT working day's opening.** So a before-opening start loses that day's whole working day.

**The inverse already disagrees.** `workingHoursBetween(Mon 07:30, Mon 10:00)` is 2 (it counts
overlap with Monday's 08:00–16:00), but `calculateDeadline(Mon 07:30, 2)` is Tue 10:00. ACC-173's
hold relies on the two being inverses. The fix restores that.

**The fix (a):** in `nextWorkingStart()`, on a working day, a `dt` before opening returns that
day's opening. Every other branch is unchanged.

```ts
if (this.isWorkingDay(dt, calendar, holidays)) {
  if (dt < todayStart) return todayStart;          // ACC-175: the day is still ahead
  if (dt < todayEnd) return dt;
}
// otherwise: the next working day's opening, as today
```

`nextWorkingDayStart()`, `isWorkingDay()` and `workingHoursBetween()` don't change.

## 2. Every caller (grep, not memory)

`grep -rn "calculateDeadline\|workingHoursBetween" backend/src backend/prisma` on `995f12a`
(specs aside):

| # | Caller | Start passed | Before opening in practice? | What changes |
| -- | -- | -- | -- | -- |
| 1 | **Stage SLA:** `WorkflowService.computeSlaDueAt()` (`workflow.service.ts:1612`), from `startInstance()` (`:167`) and a stage change (`:1025`) | the entry's `enteredAt` (= now) | **Yes:** a record moved, or a committee created, before opening. Also any sweep move | `slaDueAt` up to one working day earlier. 0 / null hours: no deadline, never called |
| 2 | **Task priority SLA:** `TaskSlaService.windowFrom()` → `shift()` (`task-sla.service.ts:89`). Used by New task (`task.service.ts:272`), stage-entry tasks (`:382`, ACC-190), record tasks (`:428`), a priority change (`windowForPriority`, `:928`), reopen (`:1101`), `initialLimit()` | now, `enteredAt`, or the task's `slaStartAt` | **Yes:** tasks made, entered or reopened early. **20 of 46** tasks ever started before opening | `dueAt` and `slaLimitAt` up to one day earlier, for new computations only |
| 3 | **The pool clock (ACC-167):** `TaskService.poolClock()` (`task.service.ts:2401`), direct to `calculateDeadline` | `pooledAt` (now, `enteredAt`, a release, a departure) | **Yes** | `poolEscalateAt` up to one day earlier. The only caller that can pass **0** (§ decision 2) |
| 4 | **Hold at approval (ACC-173 / 174):** `TaskRequestService` (`task-request.service.ts:272–280`). `workingHoursBetween(now, holdUntil)`, then `shift()` of `dueAt`, `slaLimitAt` and `slaExtendedTo` by those hours | a stored due date / limit (any time a person picked) | **Yes, rarely:** a person-picked due date can sit before opening (1 open task's due date does) | The shifted date lands one day earlier for such a date. `workingHoursBetween` is unchanged. A zero shift is already skipped |
| 5 | **The SLA previews (ACC-174):** `TaskService.slaPreview()` (`:1190`) and `slaPreviewForTask()` (`:1201`, `restart` for Reopen) → `TaskSlaService.preview()` | now, or the task's `slaStartAt` | Yes, as #2 | The pickers show the new rule. **No frontend change** (decision 4) |
| 6 | **ACC-190 stage-entry deadlines:** stage tasks via #2 (`prepareStageEntryTask`, from `enteredAt`) and the stage via #1, both from the same `enteredAt` | `enteredAt` | Yes | Both move together, so the stage-deadline RULE (`StageTaskDefinitionService`, compared in working hours, not dates) is untouched. `moveStageDeadlineForTaskInTx()` (`stage-deadline.ts`) copies a task's `dueAt`, with no calendar |
| 7 | **Workload hint (ACC-199):** `TaskWorkloadService.dueSoonBefore()` (`task-workload.service.ts:167`) | now | **Yes:** the picker opened before opening | "Due within 2 working days" ends one day earlier, counting today. Read-only, nothing stored |
| 8 | **Backfill ACC-174:** `backfill-acc174-task-sla-limit.ts:208` | `slaStartAt` | n/a | **Executed; not re-run.** 0 open tasks have a null `slaLimitAt` or `slaStartAt` today |

**Not callers, checked:**
- `SlaMonitorProcessor.isWithinWorkingHours()` (`sla-monitor.processor.ts:898`) has its own
  "is it working time now" check, which is correct as it stands.
- `StageTaskDefinitionService`'s deadline rule compares working-hour counts, never dates.
- The frontend's `DueDateService` does no working-time arithmetic (its own comment); its
  `resumeAfter()` already treats before-opening as that day's opening.

## 3. Specs (`working-calendar.service.spec.ts`; calendar Sun–Thu, 08:00–16:00)

**Every case is in the tenant's zone, not UTC,** built with the spec's `riyadhDateTime()`. One
case uses a second, non-UTC zone with a different opening time, to show the rule follows the
calendar.

| Case | Start | Hours | Expected |
| -- | -- | -- | -- |
| Before opening, working day | Mon 07:30 | 2 | **Mon 10:00** (was Tue 10:00) |
| Before opening, spills over | Mon 07:30 | 10 | Tue 10:00 (8 h Monday + 2 h) |
| At opening | Mon 08:00 | 2 | Mon 10:00 |
| Mid-day | Mon 13:00 | 2 | Mon 15:00 |
| Exactly at closing | Mon 16:00 | 2 | Tue 10:00 |
| After closing | Mon 17:30 | 2 | Tue 10:00 |
| Weekend (Fri) | Fri 10:00 | 2 | Sun 10:00 |
| Weekend, before opening | Sat 07:00 | 2 | Sun 10:00 |
| Holiday | 07:30 on a holiday Monday | 2 | Tue 10:00 (the holiday is not counted, even before its opening) |
| Holiday eve | Sun 17:00, Monday a holiday | 2 | Tue 10:00 |
| Zero hours, in hours | Mon 13:00 | 0 | Mon 13:00 |
| Zero hours, before opening | Mon 07:30 | 0 | **Mon 08:00** (was Tue 08:00) |
| Zero hours, after closing | Thu 16:00 | 0 | Sun 08:00 (documented; unchanged) |
| Another zone | a calendar in `Asia/Dubai` (UTC+4, no DST), opening 09:00: Mon 08:30 local | 2 | Mon 11:00 local |
| Inverse | for each before-opening start above | h | `workingHoursBetween(start, calculateDeadline(start, h)) === h` |

**Callers, one case each:**
- `TaskSlaService.windowFrom()` before opening;
- `TaskService.poolClock()` with 0 hours after closing;
- the hold shift of a before-opening due date.

**Mutations, one per rule:**
1. Remove the `dt < todayStart → todayStart` branch: the before-opening cases go red, both the
   2-hour and the zero-hour one.
2. Return `dt` for any time before closing on a working day, opening ignored: "zero hours,
   before opening" goes red (expects 08:00, gets 07:30).
3. Drop `isWorkingDay` from the new branch: "holiday" and "weekend, before opening" go red.
4. Compare in UTC instead of the calendar's zone: "another zone" goes red.

## 4. Shared database (read-only, counts only, 16 Nov)

Every organisation is in `Asia/Riyadh`, with 0 holidays. There are 2 calendars across 3
organisations (the platform organisation has none and gets the default).

| | Before opening (working day) | In hours | After closing | Day off | Total |
| -- | -- | -- | -- | -- | -- |
| Open tasks, by SLA start | **1** | 3 | 1 | 0 | 5 |
| Open tasks, by due date | **1** | 4 | 0 | 0 | 5 |
| Pool tasks still waiting, by `pooledAt` | 0 | 0 | 0 | 0 | 0 |
| Open stage entries with a deadline, by entry | **1** | 1 | 0 | 0 | 2 |
| Every task ever, by SLA start | 20 | 17 | 3 | 6 | 46 |

- **Open tasks:** 0 have a null `slaLimitAt` or `slaStartAt`; 4 of 5 have `dueDateOverridden`.
- **Zero escalation:** no organisation has a priority with `managerEscalationAfterHours = 0`.

## 5. Out of scope (seen while reading; not this ticket)

- **Holiday dates and zones:** `isWorkingDay()` reads a holiday by
  `DateTime.fromJSDate(h.date).setZone(zone)`. In a zone west of UTC, a holiday stored at UTC
  midnight lands on the previous day. Every tenant is UTC+3 today. Worth its own ticket before
  the first such tenant.
- **Daylight saving:** `plus({ hours })` adds absolute hours, and GCC zones have no DST.
  Revisit with the first tenant in a DST zone.

## 6. The PR (one, backend only)

- **Code:** the `nextWorkingStart()` branch (§1) and the method's comment. That's one method;
  no caller changes.
- **Specs:** §3, with the mutations run and reported.
- **No migration, no backfill, no frontend.** Stored dates are kept (decision 1).
- **Docs:**
  - SYSTEM-REFERENCE: the working-calendar section, "a start before opening counts that day",
    and the zero-hours rule.
  - CLAUDE.md: "Task assigned outside working hours: SLA starts next working day" becomes
    "…starts at the next opening: the same day's, before opening".
- **Gate:** backend tsc, Jest, isolation, test:db, every `check:*`.

## 7. Progress

- [x] Plan: callers, measurements, specs, decisions (16 Nov)
- [ ] Ahmad's answers to the decisions at the top
- [ ] Build
