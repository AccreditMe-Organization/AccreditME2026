# ACC-313 — Task SLA settings: the approved design, a warning before due, and the due-date-change switch

Written for CC-291 on `feature/acc-313-task-sla-settings`, from `dev` at `77ee7b7`. Updated
for CC-294 with Ahmad's answers (17 Nov, §8).

Ahmad's scope is ACC-313 in Linear (17 Nov):

- limits stay in working hours;
- the chain stays assignee → manager → head;
- **Warn before due, per priority** (Off, 1h, 2h, 4h, 8h or 1 working day), each shorter than that priority's own limit;
- the due-date-change switch, on by default and immediate;
- the change history from the audit trail;
- Reset to the new-organisation defaults, for new tasks only.

Out of scope: the daily digest and "notify the committee chair".

## 0. What is there today (measured on `77ee7b7`)

| Fact | Where |
| -- | -- |
| Shape: four tiers of `{ dueAfterHours, managerEscalationAfterHours, headEscalationAfterHours }` | `tenant/interfaces/tenant.interface.ts:81-97` |
| Defaults: Critical 4/2/4, High 16/8/16, Medium 40/24/48, Low 80/48/96 | `tenant/task-sla-settings.ts:6-11` (`DEFAULT_TASK_SLA_SETTINGS`) |
| Stored at `Organization.settings.taskSla`; read through `taskSlaFromSettings()` (whole object or the defaults, no per-tier merge) | `task-sla-settings.ts:19-22` |
| Routes: `GET` / `PATCH /tenant/task-sla`, both `tenant:manage_config`; PATCH takes all four tiers | `tenant.controller.ts:119-133`, `dto/update-task-sla.dto.ts` |
| Write: reads the whole settings JSON, spreads it, writes it back. No transaction, no lock (the ACC-215 race) | `tenant.service.ts:383-409` |
| Audit on save: `UPDATE` / `Organization` / org id, `metadata: { event: 'task_sla_updated' }`, **no before or after** | `tenant.service.ts:401-408` |
| Stage-deadline refusal: `TASK_SLA_EXCEEDS_STAGE_DEADLINES` (409, `stages[]`), checked on every save against `dueAfterHours` | `stage-deadline-rule.ts`, `tenant.service.ts:389-394` |
| The screen shows that refusal under the priority's Due after field (`taskSlaStageConflicts()`) | `task-sla-settings.component.ts:63-83` |
| Sweep: `sweepOverdueTasks` stamps `slaBreachedAt`, then `managerEscalatedAt` / `headEscalatedAt` | `sla-monitor.processor.ts:612-661` |
| **The escalation thresholds count CLOCK hours since `dueAt`** (`DateTime.diff(...,'hours')`), not working hours. Only firing waits for working hours. | `sla-monitor.processor.ts:642-659` |
| The head threshold is cumulative: manager hours + head hours after due | same lines |
| Due-change notice: `TaskService.notifyAssigneesOfEdit()`, in-app, "Task updated", to active assignees except the actor | `task.service.ts:2352-2387` |
| No "due soon" reminder and no stamp for one exist. Notifications have no type enum; `createInAppMany()` writes many in-app notices in one statement | `notification.service.ts:96-121` |
| Working calendar: `calculateDeadline(start, hours, org)` and `workingHoursBetween(from, to, org)` exist, forward only; hours per day are computed privately in two places | `working-calendar.service.ts:284-355`, `task-workload.service.ts:189-195` |
| Settings-history precedent: `GET /working-calendar/history` (20 newest audit rows, before/after) and the calendar page's "Last changed by" line plus its Change history dialog | `working-calendar.service.ts:46-78`, `calendar-config.component.ts:148-170` |
| The SLA clock starts at creation or assignment, a pool included, never at pick-up. **Confirmed by Ahmad; not changed here.** | `TaskSlaService`, `task.service.ts:389-424` |
| **Stale documentation:** SYSTEM-REFERENCE §4694-4706 calls the write a "non-clobbering merge" and cites old line numbers | corrected in PR 1 |

## 1. The screen

**Route and permission are unchanged:** `/admin-settings/task-sla`, `tenant:manage_config`, and the nav item stays `taskSla` in the console's "work" group. Every read and write on the page needs the same key, so no one has a view-only mode, and the design's read-only rendering (spec 8) is not needed.

**Header.**
- H1 "Task SLA & escalation" / «مهلة المهام والتصعيد».
- Purpose line: "How long work may sit, and who hears about it when it does not move" / «المدة التي يمكن أن يبقى فيها العمل، ومن يُبلَّغ حين لا يتقدم».
- Under it, the calendar page's meta line: "Last changed by {name} on {date}", with a **Change history** button.
- When nothing has ever been saved: "Nothing on this page has been changed yet."

### Layout

**At 1280:** one column, `max-width` 760, with the cards stacked in this order:
1. Time limits
2. Notifications
3. Reminders and escalation per priority
4. Reset policy

**No table of contents** (Ahmad, Q9). Dirty state therefore shows in two places: the section header chip ("Unsaved" / «غير محفوظ») and the section footer. The leave guard (`leaveGuard`, ACC-120) asks once and names the dirty sections.

**At phone width (390):**
- **Time limits:** one field per row.
- **Matrix:** each priority becomes its own block (priority chip, then label-over-control for its three fields). The design scrolls a chain sideways below 640 px because a chain that wraps mid-step is worse than a scroll. Our row has no chain, only three fixed values, so stacking loses nothing. Rows stay grouped under one header, problem count and Save.
- **No sideways page scroll.** Measured in the layout spec.

### Sections

| Section | Contents | Save model |
| -- | -- | -- |
| **Time limits** | The four `dueAfterHours` steppers (`p-inputNumber`, min 1, Latin digits, unit "working hours" in the helper) | Section Save: "Save time limits" / «حفظ حدود الوقت», plus Discard / «تجاهل» |
| **Notifications** | One switch: "Notify assignees when a due date changes" (PR 3) | Immediate; no footer |
| **Reminders and escalation per priority** | One row per priority: Priority, Limit (read-only, the saved due hours), **Warn before due** (PR 4), Manager told after, Head told after | Section Save: "Save reminders and escalation" / «حفظ التذكير والتصعيد», plus Discard |
| **Reset policy** | Danger-bordered, last; "Reset policy…" opens the confirm (PR 3) | Confirm dialog |
| **Change history** | Read only, from the header button | None |

**Time limits.**
- Helper: "Counted in working hours from the Working calendar, not clock hours." / «تُحسب بساعات العمل من تقويم العمل، لا بالساعات الفعلية.»
- Each stepper's helper: "working hours" / «ساعات عمل», plus "the default on new tasks" on Medium.
- Footer: "Applies to tasks created after saving — open tasks keep the limit they were created under."

**Stage-deadline conflicts stay on the due value.** An ACC-208 refusal still shows under the priority's Due after field (lead line, stage links, way out), and is cleared when that field changes.

**A Time-limits save that lowers a limit to its warning or below is refused** (§3.1). The refusal shows under that priority's field and names the warning.

**Save is never disabled** (Design System rule 5.2, ACC-238). The drawing's disabled "Save escalation" is not followed. Save reveals every field error, sets the header's problem count, and moves focus to the first offending field.

### The matrix: how the design is adapted

| Design | Built |
| -- | -- |
| Working days | Working hours, for the limits and, from PR 4, for escalation too (Q1) |
| Up to four steps per priority, a drag handle, Add step / Remove, a target select | **Fixed columns: Warn before due → Manager → Head.** No handle, no add or remove, no target select: Ahmad, no configurable chains. |
| "Step 2 must be later than step 1" | Not needed. The head value is counted **after** the manager is told, so it is later by construction (0 = same pass). |
| Warn before due: one select for every priority, in Time limits | **One select per priority, in the matrix** (Q2). It sits beside the Limit it must stay under. |
| Limit column reads the four time limits | Same, from the **saved** values, so an unsaved Time-limits edit does not show as policy. |
| An empty chain means "nobody else is told" | No empty state. Both escalation steps always exist; a warning of Off is a value, shown as "Off". |

**Column headers, with units:**
- "Warn before due" / «التذكير قبل الاستحقاق»;
- "Manager told after (working hours overdue)" / «يُبلَّغ المدير بعد (ساعات العمل بعد التأخر)»;
- "Head told after (working hours after the manager)" / «يُبلَّغ رئيس الوحدة بعد (ساعات العمل بعد المدير)».

Until PR 4 makes escalation count working hours, the two escalation headers say "hours" without "working". PR 4 changes the words and the sweep together.

**Widths at 1280** (in the 760 column), measured in EN and AR in the layout spec before the screen PR is called done:

| Column | Width |
| -- | -- |
| Priority | 106 |
| Limit | 80 |
| Warn before due | 200 (an `OverlaySelectComponent`, six options) |
| Manager | 150 |
| Head | 150 |

That is about 690 px plus gaps. The Arabic option labels are the longest («يوم عمل واحد»), and the select is measured with them.

**The warning select's options:**
- "Off" / «إيقاف»
- "1 working hour" / «ساعة عمل واحدة»
- "2 working hours" / «ساعتا عمل»
- "4 working hours" / «4 ساعات عمل»
- "8 working hours" / «8 ساعات عمل»
- "1 working day" / «يوم عمل واحد»

An option at or past that priority's **saved** limit is shown but cannot be chosen (`cdkOptionDisabled`, as `groupsSelectable` uses). Its reason sits beside it: "Not shorter than the 4-hour limit" / «ليس أقصر من حد 4 ساعات عمل».

"1 working day" compares the calendar's hours per day with the limit. The policy read returns `workingHoursPerDay` so the screen needs no calendar read.

**Notifications switch.**
- `p-toggleswitch`, readonly, with a click handler and a pending signal, ACC-286's pattern, so a refused press never shows the new state.
- Helper: "In the app. Takes effect at once, for every task. A change of priority is still announced." / «داخل التطبيق. يسري فورًا على كل المهام. يبقى تغيير الأولوية مُعلَنًا.»
- On failure the switch stays where it was, with a refusal line under it.

**Arabic.** Every counted string goes through `amCount`. Numbers stay LTR and Latin. Copy is singular address with no gendered verb about a person (the ACC-279 rule).

### 1.1 Each section answers for itself (the design's Six outcomes)

- **Loading:** section shells and titles render at once, each with skeleton rows.
- **Error:** a failed read keeps the section frame with Retry. One section failing never blocks another.
- **Failed save:** returns into the section with the values intact.
- **History failure:** only the meta line says "History couldn't be loaded", with Retry.

## 2. API

### 2.1 Settings shape

`settings.taskSla` **keeps its exact shape**. Six readers use it (§0), and none of them changes.

The new values go in a sibling key, **`settings.taskSlaNotices`**:

```ts
type WarnBeforeDue = 'OFF' | 'H1' | 'H2' | 'H4' | 'H8' | 'WORKING_DAY';
interface ITaskSlaNotices {
  warnBeforeDue: Record<TaskPriority, WarnBeforeDue>; // per priority (Q2)
  notifyOnDueChange: boolean;
}
```

- **Defaults:** `{ warnBeforeDue: { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'OFF', CRITICAL: 'OFF' }, notifyOnDueChange: true }`, read through `taskSlaNoticesFromSettings()` beside `taskSlaFromSettings()`. A missing key means the defaults, so existing organisations need **no backfill**: all four start Off everywhere (Ahmad).
- `bootstrap()` writes both keys for a new organisation.
- **Why a sibling key:** the four-tier object is the SLA's numbers, read by six places that should not learn about reminders.

**ACC-215: every write in this ticket is key-atomic and locked.**
- One transaction: `SELECT settings FROM "Organization" WHERE id = $1 FOR UPDATE`, then `UPDATE "Organization" SET settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{taskSla}', $2::jsonb)` (or `'{taskSlaNotices}'`).
- The audit row is written after the commit, the codebase's convention: `AuditLogService` has no transaction form.
- The lock makes before and after exact, and stops two section saves losing each other's fields.
- `jsonb_set` means a stale copy of the rest of the settings is never written back by **our** code.

The other writers (`updateAiOverageSetting`, `bootstrap`, the platform settings and tenant writers) still spread the whole JSON, so they can still overwrite `taskSla`. That is ACC-215's remaining work and is out of scope here; SYSTEM-REFERENCE says so.

### 2.2 Routes

All are under `TenantController`, `@Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)`. The work is done in a new `TaskSlaPolicyService` (`foundation/tenant/task-sla-policy.service.ts`), which needs only Prisma and the audit log, so a db-spec can build it.

| Route | Body / answer | Exists today? | PR |
| -- | -- | -- | -- |
| `PATCH /tenant/task-sla/limits` | `{ LOW..CRITICAL: { dueAfterHours } }` → the saved tiers. Merged into the stored tiers under the lock. The stage-deadline check runs here, unchanged. From PR 4 it also refuses a limit at or under its warning (§3.1). | No. Today's PATCH takes all three values of all four tiers. | 1 |
| `PATCH /tenant/task-sla/escalation` | `{ LOW..CRITICAL: { managerEscalationAfterHours, headEscalationAfterHours } }` → the saved tiers, merged under the lock. No stage check: these hours do not move due dates. From PR 4 the body also takes `warnBeforeDue` per priority. | No | 1 (warnings in 4) |
| `GET /tenant/task-sla/history?skip&take` | `{ rows: [{ id, changedAt, actorName, kind, before, after }], total }`, newest first; `take` 1–50, default 20 | No. `/working-calendar/history` is the pattern. | 1 |
| `GET /tenant/task-sla/policy` | `{ tiers, notices, workingHoursPerDay }` | No. `GET /tenant/task-sla` answers `tiers` only and stays, for its readers. | 3 (`workingHoursPerDay` in 4) |
| `PATCH /tenant/task-sla/notices` | `{ notifyOnDueChange: boolean }` | No | 3 |
| `POST /tenant/task-sla/reset` | No body. Writes the defaults (§5). | No | 3 |

- **Old `PATCH /tenant/task-sla` stays** through PR 2, so the old screen keeps working while PR 1 deploys. In PR 1 it gains the same lock, key-atomic write and before/after audit, so it is never the weaker path meanwhile. It is removed in PR 3, once nothing calls it.
- **Two section routes, not one PATCH:** the drawn page has two Saves, and a whole-object PATCH would write the other section's unsaved or stale values.
- **Answer:** `limits` and `escalation` answer the saved tiers, so the screen shows what was stored.

**Audit rows.**
- Every write in this ticket logs `objectType: 'TaskSlaPolicy'`, `objectId: <organizationId>`, `tenantId`, `actorId`.
- `before` / `after` hold only the part changed: the tiers' fields, or the notices.
- `metadata.event` is one of:
  - `task_sla_limits_updated`, `task_sla_escalation_updated`, `task_sla_updated` (the old PATCH);
  - from PR 3: `task_sla_notices_updated`, `task_sla_reset`.
- A save that changes nothing writes nothing (no update, no row), as ACC-255's stage audit does.

**History read.**
- `where: { organizationId, OR: [{ objectType: 'TaskSlaPolicy', objectId: org }, { objectType: 'Organization', objectId: org, metadata: { path: ['event'], equals: 'task_sla_updated' } }] }`, ordered by `createdAt desc, id desc`. It is covered by the existing `(objectType, objectId)` index.
- **Legacy rows** (the second clause) have no values, so `kind: 'legacy'`. The screen says "Saved; the values were not recorded for this change." / «حُفظ؛ لم تُسجَّل القيم في هذا التغيير.»
- The `count` and the `findMany` run in parallel.
- **Paging:** `take` capped at 50 per page. The dialog asks 20 at a time with Load more. Ahmad asked for "every save", so this is a paged list, not the calendar's fixed cap of 20.

## 3. Warn before due (PR 4)

### 3.1 Per priority, and always shorter than the limit (Q2)

- **Each priority has its own warning**, stored in `taskSlaNotices.warnBeforeDue`.
- `warnHours(option, hoursPerDay)` is 0 for Off, 1, 2, 4 or 8 for the hour options, and `hoursPerDay` for `WORKING_DAY`.
- **Rule:** for every priority that is not Off, `warnHours < tiers[priority].dueAfterHours`. It is checked from both sides, under the same row lock:
  - **saving a warning** at or past its priority's saved limit is refused: 400 `TASK_SLA_WARNING_NOT_BEFORE_DUE` `{ priority, warning, limitHours }`;
  - **saving a limit** at or under its priority's saved warning is refused: 400 `TASK_SLA_LIMIT_NOT_AFTER_WARNING` `{ priority, warning, limitHours }`. It names the warning: "Critical's warning is 4 working hours; the limit must be longer than that.";
  - nothing is written either way.
- **Both codes go in `workflow-refusal.ts`'s style** (a code, numbers, a sentence per language on screen), said from the code, never the server's English.
- **A calendar change can break the rule** without a save here. Shortening the working day changes what "1 working day" means. The sweep then treats such a warning as Off for that priority, and the screen marks the select invalid with the same reason. The working calendar save is not refused: its own screen should not have to know about reminders.

### 3.2 Where it runs

A new step in `SlaMonitorProcessor.process()`, `sweepDueWarnings`, behind `runIsolatedStep` like the others, every 15 minutes. It never runs on a request.

**Each pass:**
1. **One read** of the organisations whose `settings->'taskSlaNotices'->'warnBeforeDue'` has any value that is not `'OFF'` (`$queryRaw`, id and the object only).
2. **For each such organisation:**
   - skip it unless `isWithinWorkingHours(org)`, so nobody is reminded at 02:00; a task due at 09:00 Sunday with a 1h warning is told at 08:00 Sunday;
   - load the calendar once (`loadCalendar(org)`);
   - for each priority with a warning, `threshold = deadlineWith(calendar, now, warnHours)`;
   - **one candidate query** for all those priorities: `organizationId`, `OR` per priority of `{ priority, dueAt > now AND dueAt <= threshold }`, `dueWarnedAt IS NULL`, and `status IN (PENDING, IN_PROGRESS)` (so ON_HOLD, closed, UNASSIGNED and REJECTED are left out);
   - the candidates are tasks with an active assignee **or** tasks still waiting in a pool (a pool target and no active assignee);
   - **claim:** `UPDATE "Task" SET "dueWarnedAt" = $now WHERE id = ANY($ids) AND "dueWarnedAt" IS NULL RETURNING id`, so each task is claimed exactly once even with two workers;
   - **notify:** one `createInAppMany()` with:
     - an assigned task: its active assignees (not their acting users, the ACC-271 PR 4 rule);
     - a waiting pool task: the pool's current members, resolved in one batch by the task pool's own membership rule (ACC-167: position holders in the unit, or members holding the committee seat; ACTIVE only).

**At-most-once.** The claim comes before the notice. A failed notice is logged with the ids and is not retried, because a missed reminder is better than two.

**What "1 working day" means.**
- The organisation's working hours per day, `workingHoursEnd − workingHoursStart` (8 for the GCC default), exposed once as `WorkingCalendarService.workingHoursPerDay(org)`. `task-workload.service.ts`'s private copy then calls it.
- So "1 working day" is "due within the next working day's worth of working time", counted through the calendar, holidays and weekends included.

**Pure helpers.**
- `WorkingCalendarService` gains `loadCalendar(org)`, returning the calendar and holidays, and pure `deadlineWith(calendar, start, hours)` / `hoursBetweenWith(…)`.
- `calculateDeadline` and `workingHoursBetween` are re-expressed on these. Their specs are unchanged and must stay green.
- The same helpers serve Q1's working-hours escalation, so the sweep loads each calendar once per organisation per pass.

### 3.3 The stamp: is one enough? Yes

`Task.dueWarnedAt` means "the people on this task have been reminded about its **current** due time". The per-priority setting changes only which window applies; it does not need its own stamp.

**The column**, written by us as its own migration PR, reviewed by lane B (§7):
- `ALTER TABLE "Task" ADD COLUMN "dueWarnedAt" TIMESTAMP(3);`
- Additive and nullable, with no backfill and no index (the candidate query is bounded by `organizationId` and the `dueAt` range; `@@index([dueAt])` exists).
- It is safe against deployed code, because Prisma's older client never selects it.

**When the stamp clears**, so the sweep can remind again if the new due time falls inside the window:

| Path | Clears `dueWarnedAt` | File |
| -- | -- | -- |
| Edit that changes `dueAt` or `priority` (a priority change re-arms it even if a person kept the same due date, because the window changed) | yes | `TaskService.update`, `task.service.ts:951-1034` |
| Approved extension | yes | `TaskRequestService.approve`, `task-request.service.ts:226-255` |
| Approved hold (the window moves at approval) | yes | same, `:256-300` |
| Resume (manual or swept) | no, `dueAt` does not change. The sweep skips ON_HOLD while held, and after resume it reminds if the task is inside the window and not stamped. | `task-request.service.ts:425-455, 545-554` |
| Reopen | yes | `TaskService.reopen`, `task.service.ts:1123-1236` |
| Reassign | **only when `dueAt` is still ahead** (Q5), so the new holder is reminded on the next pass inside the window | `TaskService.reassign`, `task.service.ts:1478-1615` |
| Pick from a pool | **no** (Q5: whoever picks it up after the pool was reminded gets no second reminder) | `TaskService.pick` |
| Release back to the pool | no; the pool was already reminded for this due time | `TaskService.release` |

The rule is one constant, `DUE_WARNING_CLEARED = { dueWarnedAt: null }`, beside `ESCALATION_CLEARED`. It is not folded into `ESCALATION_CLEARED`, because that one is applied only when the new due date is ahead.

**"Nobody still on the task is reminded twice"** holds:
- since ACC-167 a task has one holder or waits in a pool;
- the only re-arming events are a new due time, a new priority, a reopen or a new holder;
- a picker never re-arms it.

**One edge, stated rather than hidden.** A → B → A by two reassigns reminds A again for the same due time, because the second reassign hands it to a holder who is new to the task at that moment. A per-assignee stamp would avoid it, at the cost of a second column on `TaskAssignee` and a pool rule that stamps the picker. I recommend accepting it, and I note it for Ahmad below.

**Held and closed tasks.**
- **Held:** never reminded while held. The window was moved at approval and the stamp cleared then.
- **Closed:** never reminded. Completing a task does not clear its stamp; reopening does.

**The notice (in-app only, Q3):**
- EN title "Task due soon"; body `"{title}" is due {date}.`
- AR title «اقترب موعد استحقاق مهمة»; body `يحين موعد استحقاق المهمة "{title}" في {date}.`
- `{date}` comes from `TaskSlaService.forPeople()`, in the tenant's zone, the same format as the due-change notice.
- `objectType: 'Task'`, `objectId`, so the bell opens the task page.
- The pool's reminder uses the same words: the task page tells a pool member they can pick it up.

### 3.4 Escalation in working hours (Q1)

`sweepOverdueTasks` replaces the clock `DateTime.diff` with `hoursBetweenWith(calendar, dueAt, now)` on the organisation's calendar, loaded once per organisation per pass. The task query itself stays one query.

- The manager fires at `managerEscalationAfterHours` **working** hours overdue, and the head at `manager + head` working hours, still cumulative.
- **Behaviour change for open overdue tasks:** after the deploy, a task overdue across a weekend is escalated later than before. Nothing already fired is undone. The PR description says so.

## 4. The due-date switch (PR 3)

**Every path that tells assignees their due date moved:**

| Path | Tells whom | About | Governed by the switch? |
| -- | -- | -- | -- |
| `notifyAssigneesOfEdit` (`task.service.ts:2352-2387`), due-date clause "it is now due {date}" | active assignees except the actor | the due date | **Yes** |
| Same notice, priority clause "its priority is now {p}" (a priority change also recomputes the due date) | same | the priority | No (Q7). The priority notice still goes, without the date when the switch is off. |
| Reopen, "Task reopened … now due {date}" (`:1216-1231`) | returning assignees | reopening | No. Reopening is the news. |
| Extension approved (`task-request.service.ts:357-366`) | the requester only | their request | No |
| Hold approved (`:367-372`) | the requester only | their request | No |
| Resume (`:577-596`) | assignees and creator | the hold ending; the due date is unchanged | No |

**Mechanics.**
- `TaskService.update` reads `taskSlaNoticesFromSettings` only when `dueChanged`, one Organization read on an edit (not on the per-request path).
- With the switch off: a due-date-only edit sends nothing; an edit that also changes priority sends the priority clause alone.
- **Immediate:** the next edit after the switch moves reads the new value.
- The design's "Cannot be switched off for escalated tasks" is not built (Q6).

## 5. Reset (PR 3)

**What it writes.** One locked transaction:
- `taskSla = DEFAULT_TASK_SLA_SETTINGS`;
- `taskSlaNotices = DEFAULT_TASK_SLA_NOTICES` (the switch on, every warning Off).

After the commit, one audit row: `event: 'task_sla_reset'`, with `before` holding the whole policy and `after` the defaults.

**What it leaves alone.** No open task changes: an open task keeps the limit it was created with (ACC-174). The design's "recalculates due dates on 412 open tasks" is therefore NOT built; Ahmad decided new tasks only.

**Stage deadlines (Q8).** The stage-deadline check runs on the defaults. If they would break a stage deadline, the reset is refused with the same `TASK_SLA_EXCEEDS_STAGE_DEADLINES`, naming the stages. The confirm dialog shows the same stage list and way-out, and nothing changes.

**Confirm** (`am-confirm` through the confirm helper, ACC-120's `check:confirm-through-helper`):
- Header: "Reset task SLA policy?" / «إعادة ضبط سياسة مهلة المهام؟»
- Body:
  - EN: "Every value on this page goes back to the defaults a new organisation gets: Low 80, Medium 40, High 16 and Critical 4 working hours, their escalation hours, every reminder off, and due-date notices on. Tasks created after this use them; open tasks keep the limits they were created with. Recorded in the change history with your name and the previous values."
  - AR: «تعود كل القيم في هذه الصفحة إلى القيم الافتراضية للمنشأة الجديدة: منخفضة 80 ومتوسطة 40 وعالية 16 وحرجة 4 ساعات عمل، وساعات التصعيد، وإيقاف كل التذكيرات، وتشغيل إشعارات تغيّر موعد الاستحقاق. تُطبَّق على المهام التي تُنشأ بعد ذلك، وتحتفظ المهام المفتوحة بالحدود التي أُنشئت بها. يُسجَّل ذلك في سجل التغييرات باسمك والقيم السابقة.»
  - The numbers are read from the server's defaults, never hard-coded on the screen.
- Buttons: "Reset policy" (danger) / «إعادة ضبط السياسة», and "Cancel" / «إلغاء».

## 6. Tests, mutations, measurements, performance

### Backend specs

- **Settings:** the defaults for a missing `taskSlaNotices` (all four Off, the switch on).
- **Lock (db-spec, real Postgres in CI):**
  - a limits save and an escalation save run at once (ten rounds); both sections' fields survive;
  - an unrelated settings key written beside them survives.
- **Section routes:**
  - each merges only its own fields;
  - the limits route still refuses on stage deadlines, with nothing written;
  - a no-op writes nothing and logs no row;
  - another organisation is never read or written, under the isolation gate's test name.
- **Audit:** before/after hold the changed part only; the event names the section.
- **History:**
  - newest first, paged, `take` capped;
  - legacy rows are `kind: 'legacy'`;
  - another organisation's rows never appear, under the isolation gate's test name;
  - the route carries `tenant:manage_config`.
- **Warning rule (PR 4):** both refusals, from both sides, write nothing; `WORKING_DAY` against the calendar's hours.
- **Reset (PR 3):** writes the defaults and one audit row; refuses on a stage conflict.
- **Switch (PR 3):**
  - off with a due-only edit sends no notice;
  - off with a priority-and-due edit sends the priority clause only;
  - on is unchanged.
- **Warning sweep (PR 4):**
  - all Off sends nothing;
  - inside a priority's window: one notice and the stamp set;
  - a second pass sends nothing;
  - outside working hours: nothing;
  - ON_HOLD, closed and unassigned: nothing;
  - a waiting pool task reminds its members once, and a pick afterwards does not re-arm;
  - a reassign while the due time is ahead re-arms; after the due time, it does not;
  - `WORKING_DAY` uses the calendar's hours per day;
  - a warning made invalid by a calendar change is treated as Off;
  - a db-spec has two workers claiming the same task, and exactly one notice results.
- **Stamp clearing (PR 4):** each clearing path in §3.3 clears it; resume, pick and release do not.
- **Working-hours escalation (PR 4):** a task overdue across a weekend escalates by working hours.
- **Pure calendar helpers (PR 4):** match `calculateDeadline` and `workingHoursBetween` on the existing cases.

### Frontend specs (PRs 2–4)

- **Sections:**
  - dirty chip and footer; Discard restores;
  - Save is never disabled; an invalid Save reveals errors, counts problems and focuses the first;
  - a stage-conflict refusal shows under its priority's due value;
  - each section saves only its own fields.
- **The warning select:** options at or past the saved limit are disabled with their reason; both warning refusals are said from their code.
- **Switch:** immediate, pending, and reverts on failure.
- **History:** the meta line; the dialog pages with Load more; the legacy wording.
- **Reset:** the confirm, and a conflict refusal shown inside it.
- **Leave guard:** names the dirty sections.
- **Arabic:** the counted strings and the warning options.

### Mutations (each must turn a named spec red)

PR 1:
1. Remove `FOR UPDATE`. The concurrent-sections db-spec goes red.
2. Go back to a whole-settings spread write. The unrelated-key db-spec goes red.
3. Make the escalation route write the whole tier, dropping the merge. A merge spec goes red.
4. Drop the before/after from the audit row.
5. Log a row on a no-op save.
6. Drop the legacy clause from the history read.
7. Drop `organizationId` from the history `where`. The isolation spec goes red.
8. Lift the `take` cap.

PRs 3–4:

9. Let the switch silence the priority clause.
10. Drop `dueWarnedAt IS NULL` from the claim.
11. Remove the working-hours gate from the warning step.
12. Drop the stamp clear on the approved extension.
13. Let ON_HOLD into the candidates.
14. Let a pick re-arm the stamp.
15. Accept a limit at its warning.
16. Disable Save on an invalid form.
17. Reset recalculating an open task's due date: a db-spec asserts it is unchanged.

### Measurements (layout specs, both languages)

- **Reset confirm:** the 420 px cap for its body, in EN and AR, with the longest (Arabic) body.
- **Stage-conflict state:** measured inside the confirm, which takes the dialog's own scroll rule if it cannot fit; to be measured, not assumed.
- **History:** opened in `am-list-dialog size="compact"` (720 × 560), the list precedent that is exempt from the cap (ACC-229), with Load more. Rows measured at 720 and as a full-screen sheet at 390.
- **Matrix:** its five columns at 1280 in EN and AR (the widths in §1), with the warning select open on its longest option, and the stacked blocks at 390.
- **Page:** no sideways scroll at 390 or 1280.

### Performance (the ACC-271 rule)

- No query is added to the guards, the interceptors or the per-request path.
- The page reads the policy and the first history page once on open, in parallel. Nothing polls.
- The due-change switch costs one Organization read only on an edit that moves a due date.
- The warning step costs one Organization query per pass, then per organisation with any warning on: two calendar reads, one candidate query, one claim, one batched pool-membership read and one batched notice write.

## 7. PR split

| PR | Contents | Needs | Deploy slot |
| -- | -- | -- | -- |
| **1 — backend: section routes and history** | `TaskSlaPolicyService`; `PATCH …/limits` and `…/escalation` with the lock, key-atomic write and before/after audit; the same on the old PATCH; `GET …/history` with the legacy rows; SYSTEM-REFERENCE corrected (the "non-clobbering merge" claim, the routes) | — | yes (backend) |
| **2 — the screen on PR 1's routes** | Header, meta line and history dialog; Time limits; the matrix with Limit, Manager and Head (the warning column arrives in PR 4); Save never disabled; the leave guard; layout specs. The switch and Reset sections are absent, not disabled. | PR 1 live, so the screen never calls a route Railway has not served | no (frontend) |
| **3 — switch and reset** | `taskSlaNotices` (`notifyOnDueChange`, and `warnBeforeDue` stored all Off); `GET …/policy`; `PATCH …/notices`; `POST …/reset`; `notifyAssigneesOfEdit` reads the switch; the Notifications and Reset sections; the old `PATCH /tenant/task-sla` removed | PR 2. The screen's half may split as 3-be then 3-fe if Ahmad wants the backend live first, as ACC-255 PR 4b-be did. | yes |
| **M — the migration** | One additive migration, `20261117xxxxxx_acc313_task_due_warned_at` (a timestamp after `20261116160000`): `Task.dueWarnedAt TIMESTAMP(3)`, nullable, and the schema line. Nothing reads or writes it yet. Lane B reviews it; we send a before-notice before it merges. | — (any time before PR 4) | yes (the pre-deploy step runs it) |
| **4 — reminders, and escalation in working hours** | `warnBeforeDue` per priority on the escalation route, both warning refusals, `workingHoursPerDay` on the policy read; the pure calendar helpers; `sweepDueWarnings` with the pool reminder; `DUE_WARNING_CLEARED` on the paths in §3.3; working-hours escalation (Q1); the warning column and the escalation headers' "working" on the screen | **PR M merged and live** (the column must exist before any code writes it) | yes |

## 8. Ahmad's answers (17 Nov)

| | Question | Answer |
| -- | -- | -- |
| Q1 | Escalation in working hours, like the limits? | **Yes**, in PR 4 with the sweep work (§3.4). |
| Q2 | Warn before due's default? | **Changed:** the warning is set **per priority** (Off, 1h, 2h, 4h, 8h, 1 working day), and each must be shorter than that priority's own limit. Options at or past the limit show but can't be chosen, with the reason beside them. A save that lowers a limit to its warning or below is refused, naming the warning. All four start Off for every organisation. (§1, §3.1) |
| Q3 | The warning's channel? | **In the app only.** |
| Q4 | Remind on a task whose limit is shorter than the warning? | **Replaced by Q2's validation:** such a warning cannot be saved. There is no "the screen names the priorities" note. |
| Q5 | Does a reassign remind the new holder? | **Yes, if the due time is still ahead.** A task still waiting in a pool when its warning time comes reminds the pool's members, once; whoever picks it up afterwards gets no second reminder. Nobody still on the task is reminded twice. (§3.3) |
| Q6 | "Can't be switched off for escalated tasks"? | **Skip it.** |
| Q7 | With the switch off, is a priority change still announced? | **Yes, without the date.** |
| Q8 | Refuse Reset when the defaults would break a stage deadline? | **Yes**, naming the stages (`TASK_SLA_EXCEEDS_STAGE_DEADLINES`). |
| Q9 | The table of contents? | **Leave it out.** |
| — | When the SLA clock starts | **Confirmed:** at creation or assignment, a pool included, never at pick-up. Not changed. |
| — | Reset | Applies to **new tasks only**. |

**One point for Ahmad, from §3.3:** with one stamp per task, A → B → A by two reassigns reminds A twice for the same due time. I recommend accepting it, because a per-assignee stamp costs a second column and a pool rule for a rare case.
