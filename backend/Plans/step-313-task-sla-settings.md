# ACC-313 — Task SLA settings: the approved design, a warning before due, and the due-date-change switch

Plan only. Written for CC-291 on `feature/acc-313-task-sla-settings`, from `dev` at
`77ee7b7`. No code yet. Ahmad's scope is ACC-313 in Linear (17 Nov):

- limits stay in working hours;
- the chain stays assignee → manager → head;
- Warn before due: Off, 1h, 2h, 4h, 8h or 1 working day, one value for every priority;
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
| **Stale documentation:** SYSTEM-REFERENCE §4694-4706 calls the write a "non-clobbering merge" and cites old line numbers | to be corrected in PR 1 |

## 1. The screen

**Route and permission are unchanged:** `/admin-settings/task-sla`, `tenant:manage_config`, and the nav item stays `taskSla` in the console's "work" group. Every read and write on the page needs the same key, so no one has a view-only mode, and the design's read-only rendering (spec 8) is not needed.

**Header.**
- H1 "Task SLA & escalation" / «مهلة المهام والتصعيد».
- Purpose line: "How long work may sit, and who hears about it when it does not move" / «المدة التي يمكن أن يبقى فيها العمل، ومن يُبلَّغ حين لا يتقدم».
- Under it, the calendar page's meta line: "Last changed by {name} on {date}", with a **Change history** button.
- When nothing has ever been saved: "Nothing on this page has been changed yet."

### Layout

**At 1280:** one column, `max-width` 760, with the cards stacked in the drawn order:
1. Time limits
2. Notifications
3. Escalation per priority
4. Reset policy

**No table of contents.** With four sections the page fits at 1280 × 800 apart from the matrix, and no shipped settings screen has one; the Settings Screens file says section headings, Save and dirty state carry over, not the TOC. Dirty state therefore shows in two places, not three: the section header chip ("Unsaved" / «غير محفوظ») and the section footer. The leave guard (`leaveGuard`, ACC-120) asks once and names the dirty sections.

**At phone width (390):**
- **Time limits:** one field per row.
- **Escalation matrix:** each priority becomes its own block (priority chip, then label-over-control for its two fields). The design scrolls the matrix sideways below 640 px, because a CHAIN that wraps mid-step is worse than a scroll. Our row has no chain, only two numbers, so stacking loses nothing. Rows stay grouped under one header, problem count and Save.
- **No sideways page scroll.** Measured in the layout spec.

### Sections

| Section | Contents | Save model |
| -- | -- | -- |
| **Time limits** | The four `dueAfterHours` steppers (`p-inputNumber`, min 1, Latin digits, unit "working hours" in the helper); **Warn before due** select (PR 4) | Section Save: "Save time limits" / «حفظ حدود الوقت», plus Discard / «تجاهل» |
| **Notifications** | One switch: "Notify assignees when a due date changes" (PR 3) | Immediate; no footer |
| **Escalation per priority** | One row per priority: Priority, Limit (read-only, the saved due hours), Manager told after, Head told after | Section Save: "Save escalation" / «حفظ التصعيد», plus Discard |
| **Reset policy** | Danger-bordered, last; "Reset policy…" opens the confirm (PR 3) | Confirm dialog |
| **Change history** | Read only, from the header button | None |

**Time limits.**
- Helper: "Counted in working hours from the Working calendar, not clock hours." / «تُحسب بساعات العمل من تقويم العمل، لا بالساعات الفعلية.»
- Each stepper's helper: "working hours" / «ساعات عمل», plus "the default on new tasks" on Medium.
- Footer: "Applies to tasks created after saving — open tasks keep the limit they were created under."

**Stage-deadline conflicts stay on the due value.** An ACC-208 refusal still shows under the priority's Due after field: lead line, stage links, way out. It is cleared when that field changes.

**Save is never disabled** (Design System rule 5.2, ACC-238). The drawing's disabled "Save escalation" is not followed. Save reveals every field error, sets the header's problem count, and moves focus to the first offending field.

**Escalation matrix: how the design is adapted.**

| Design | Built |
| -- | -- |
| Working days | Working hours. The limits are hours; escalation is answered in Q1. |
| Up to four steps per priority, a drag handle, Add step / Remove, a target select | **Fixed columns: Manager → Head.** No handle, no add or remove, no target select: Ahmad, no configurable chains. |
| "Step 2 must be later than step 1" | Not needed. The head value is counted **after** the manager is told, so it is later by construction (0 = same pass). |
| Limit column reads the four time limits | Same, from the **saved** values, so an unsaved Time-limits edit does not show as policy. |
| An empty chain means "nobody else is told" | No empty state. Both steps always exist. |

The column headers carry the units:
- "Manager told after (hours overdue)" / «يُبلَّغ المدير بعد (ساعات التأخر)»;
- "Head told after (hours after the manager)" / «يُبلَّغ رئيس الوحدة بعد (ساعات بعد المدير)».

The word "working" appears only if Q1 answers "working hours".

**Notifications switch.**
- `p-toggleswitch`, readonly, with a click handler and a pending signal, ACC-286's pattern, so a refused press never shows the new state.
- Helper: "In the app. Takes effect at once, for every task." / «داخل التطبيق. يسري فورًا على كل المهام.»
- On failure the switch stays where it was, with a refusal line under it.

**Arabic.** Every counted string goes through `amCount`: "ساعة عمل واحدة" / "ساعتا عمل" / "4 ساعات عمل". Numbers stay LTR and Latin.

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
interface ITaskSlaNotices {
  warnBeforeDue: 'OFF' | 'H1' | 'H2' | 'H4' | 'H8' | 'WORKING_DAY';
  notifyOnDueChange: boolean;
}
```

- Defaults: `{ warnBeforeDue: <Q2, recommended 'OFF'>, notifyOnDueChange: true }`, read through `taskSlaNoticesFromSettings()` beside `taskSlaFromSettings()`. A missing key means the defaults, so existing organisations need **no backfill**.
- `bootstrap()` writes both keys for a new organisation.
- **Why a sibling key:** the four-tier object is the SLA's numbers, and a third key on each tier would be read by nothing that reads tiers.

**ACC-215: every write in this ticket is key-atomic and locked.**
- One transaction: `SELECT … FROM "Organization" WHERE id = $1 FOR UPDATE`, then `UPDATE "Organization" SET settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{taskSla}', $2::jsonb)` (or `'{taskSlaNotices}'`), then the audit row.
- The lock makes before and after exact, and stops two section saves losing each other's tier fields.
- `jsonb_set` means a stale copy of the rest of the settings is never written back by **our** code.

The other writers (`updateAiOverageSetting`, `bootstrap`, the platform settings and tenant writers) still spread the whole JSON, so they can still overwrite `taskSla`. That is ACC-215's remaining work and is out of scope here. The plan names it in SYSTEM-REFERENCE.

### 2.2 Routes

All are under `TenantController`, `@Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)`, and the services do the work.

| Route | Body / answer | Exists today? | PR |
| -- | -- | -- | -- |
| `GET /tenant/task-sla/policy` | `{ tiers: ITaskSlaSettings, notices: ITaskSlaNotices }` | No. `GET /tenant/task-sla` answers `tiers` only and stays, for its readers. | 1 |
| `PATCH /tenant/task-sla/limits` | `{ LOW..CRITICAL: { dueAfterHours } }`, plus `warnBeforeDue` from PR 4. Merged into the stored tiers under the lock. The stage-deadline check runs here, unchanged. | No. Today's PATCH takes all three values of all four tiers. | 1 (`warnBeforeDue` in 4) |
| `PATCH /tenant/task-sla/escalation` | `{ LOW..CRITICAL: { managerEscalationAfterHours, headEscalationAfterHours } }`, merged under the lock. No stage check: these hours do not move due dates. | No | 1 |
| `PATCH /tenant/task-sla/notices` | `{ notifyOnDueChange: boolean }` | No | 3 |
| `POST /tenant/task-sla/reset` | No body. Writes the defaults (§5). | No | 3 |
| `GET /tenant/task-sla/history?skip&take` | `{ rows: [{ id, changedAt, actorName, kind, before, after }], total }`, newest first; `take` 1–50, default 20 | No. `/working-calendar/history` is the pattern. | 1 |

- **Old `PATCH /tenant/task-sla` stays** through PR 2, so the old screen keeps working while PR 1 deploys. It is removed in PR 3, once nothing calls it, and gains the lock and the before/after audit in PR 1 so it is never the weaker path meanwhile.
- **Two section routes, not one PATCH:** the drawn page has two Saves, and a whole-object PATCH would write the other section's unsaved or stale values.

**Audit rows.**
- Every write in this ticket logs `objectType: 'TaskSlaPolicy'`, `objectId: <organizationId>`, `tenantId`, `actorId`.
- `before` / `after` hold only the part changed: the tiers' fields, or the notices.
- `metadata.event` is one of `task_sla_limits_updated`, `task_sla_escalation_updated`, `task_sla_notices_updated` or `task_sla_reset`.
- A save that changes nothing writes no row, as ACC-255's stage audit does.

**History read.**
- `where: { organizationId, OR: [{ objectType: 'TaskSlaPolicy', objectId: org }, { objectType: 'Organization', objectId: org, metadata: { path: ['event'], equals: 'task_sla_updated' } }] }`, ordered by `createdAt desc, id desc`. It is covered by the existing `(objectType, objectId)` index.
- **Legacy rows** (the second clause) have no values, so `kind: 'legacy'`. The screen says "Saved; the values were not recorded for this change." / «حُفظ؛ لم تُسجَّل القيم في هذا التغيير.»
- The `count` and the `findMany` run in parallel.
- **Paging:** `take` capped at 50 per page. The dialog asks 20 at a time with Load more. Ahmad asked for "every save", so this is a paged list, not the calendar's fixed cap of 20.

## 3. Warn before due (PR 4)

**Where it runs.** A new step in `SlaMonitorProcessor.process()`, `sweepDueWarnings`, behind `runIsolatedStep` like the others, every 15 minutes. It never runs on a request.

**Each pass:**
1. **One read** of the organisations with `settings->'taskSlaNotices'->>'warnBeforeDue'` set and not `'OFF'` (`$queryRaw`, id and the value only).
2. **For each such organisation:**
   - skip it unless `isWithinWorkingHours(org)`, so nobody is reminded at 02:00; a task due at 09:00 Sunday with a 1h warning is told at 08:00 Sunday;
   - `threshold = calculateDeadline(now, warnHours, org)`;
   - one candidate query: `organizationId`, `dueAt > now AND dueAt <= threshold`, `dueWarnedAt IS NULL`, `status IN (PENDING, IN_PROGRESS)` (so ON_HOLD, closed, UNASSIGNED and REJECTED are left out), and at least one active assignee (an unpicked pool task has none, so it is skipped until picked);
   - **short windows:** a task whose own window is no longer than the warning is skipped (Q4). The test is `dueAt <= calculateDeadline(slaStartAt ?? createdAt, warnHours, org)`, computed in memory against the calendar loaded once for the organisation (see the pure helper below);
   - **claim:** `UPDATE "Task" SET "dueWarnedAt" = $now WHERE id = ANY($ids) AND "dueWarnedAt" IS NULL RETURNING id`, so each task is claimed exactly once even with two workers;
   - **notify:** one `createInAppMany()` to the active assignees of the claimed tasks (not their acting users, the ACC-271 PR 4 rule).

**At-most-once.** The claim comes before the notice. A failed notice is logged with the ids and is not retried, because a missed reminder is better than two.

**What "1 working day" means.**
- The organisation's working hours per day, `workingHoursEnd − workingHoursStart` (8 for the GCC default), exposed once as `WorkingCalendarService.workingHoursPerDay(org)`. `task-workload.service.ts`'s private copy then calls it.
- `warnHours` is 1, 2, 4 or 8 for the hour options, and that number for `WORKING_DAY`.
- So "1 working day" is "due within the next working day's worth of working time", counted through `calculateDeadline`, holidays and weekends included.

**Pure helper.**
- `WorkingCalendarService` gains `loadCalendar(org)`, returning the calendar and holidays, and pure `deadlineWith(calendar, start, hours)` / `hoursBetweenWith(…)`.
- `calculateDeadline` and `workingHoursBetween` are re-expressed on these. Their specs are unchanged and must stay green.
- This keeps the short-window test from doing two database reads per task.

**The stamp: `Task.dueWarnedAt DateTime?`**
- Proposed migration, for lane B to agree and write: `ALTER TABLE "Task" ADD COLUMN "dueWarnedAt" TIMESTAMP(3);`.
- Additive and nullable, with no backfill and no index (the candidate query is bounded by `organizationId` and the `dueAt` range; `@@index([dueAt])` exists).
- It is safe against deployed code, because Prisma's older client never selects it.

**When the stamp clears.** The sweep can then warn again if the new due date falls inside the window.

| Path | Clears `dueWarnedAt` | File |
| -- | -- | -- |
| Edit that changes `dueAt` (a due date or a priority recompute) | when `dueAt` changes, unconditionally | `TaskService.update`, `task.service.ts:951-1034` |
| Approved extension | yes | `TaskRequestService.approve`, `task-request.service.ts:226-255` |
| Approved hold (the window moves at approval) | yes | same, `:256-300` |
| Resume (manual or swept) | no, `dueAt` does not change. The sweep skips ON_HOLD while held, and after resume it warns if the task is inside the window and not stamped. | `task-request.service.ts:425-455, 545-554` |
| Reopen | yes | `TaskService.reopen`, `task.service.ts:1123-1236` |
| Reassign | yes (Q5), so the new holder is reminded | `TaskService.reassign`, `task.service.ts:1478-1615` |

The rule is one constant, `DUE_WARNING_CLEARED = { dueWarnedAt: null }`, beside `ESCALATION_CLEARED`. It is not folded into `ESCALATION_CLEARED`, because that one is applied only when the new due date is ahead.

**Held and closed tasks.**
- **Held:** never warned while held. The window was moved at approval and the stamp cleared then.
- **Closed:** never warned. Completing a task does not clear its stamp; reopening does.

**The notice (in-app, Q3):**
- EN title "Task due soon"; body `"{title}" is due {date}.`
- AR title «اقترب موعد استحقاق مهمة»; body `يحين موعد استحقاق المهمة "{title}" في {date}.`
- `{date}` comes from `TaskSlaService.forPeople()`, in the tenant's zone, the same format as the due-change notice.
- `objectType: 'Task'`, `objectId`, so the bell opens the task page.

**The select (Time limits).** Its options:
- "Off" / «إيقاف»
- "1 working hour" / «ساعة عمل واحدة»
- "2 working hours" / «ساعتا عمل»
- "4 working hours" / «4 ساعات عمل»
- "8 working hours" / «8 ساعات عمل»
- "1 working day" / «يوم عمل واحد»

With six options it is an `OverlaySelectComponent`, which CLAUDE.md requires at five or more, not a `p-select`.

Helper: "Applies to every priority. Assignees are reminded once per task, in the app."

If a priority's saved limit is no longer than the warning, a second helper line names it: "Critical tasks are not reminded: their limit (4 working hours) is no longer than the warning." It is computed from the saved values, with no query.

## 4. The due-date switch (PR 3)

**Every path that tells assignees their due date moved:**

| Path | Tells whom | About | Governed by the switch? |
| -- | -- | -- | -- |
| `notifyAssigneesOfEdit` (`task.service.ts:2352-2387`), due-date clause "it is now due {date}" | active assignees except the actor | the due date | **Yes** |
| Same notice, priority clause "its priority is now {p}" (a priority change also recomputes the due date) | same | the priority | No (Q7). The priority notice still goes, and says the date only when the switch is on. |
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
- `taskSlaNotices = DEFAULT_TASK_SLA_NOTICES` (the switch on, the warning at its default);
- one audit row, `event: 'task_sla_reset'`, with `before` holding the whole policy and `after` the defaults.

**What it leaves alone.** No open task changes: an open task keeps the limit it was created with (ACC-174). The design's "recalculates due dates on 412 open tasks" is therefore NOT built; Ahmad decided new tasks only.

**Stage deadlines.** The stage-deadline check runs on the defaults. If they would break a stage deadline, the reset is refused with the same `TASK_SLA_EXCEEDS_STAGE_DEADLINES`. The confirm dialog shows the same stage list and way-out, and nothing changes (Q8).

**Confirm** (`am-confirm` through the confirm helper, ACC-120's `check:confirm-through-helper`):
- Header: "Reset task SLA policy?" / «إعادة ضبط سياسة مهلة المهام؟»
- Body:
  - EN: "Every value on this page goes back to the defaults a new organisation gets: Low 80, Medium 40, High 16 and Critical 4 working hours, their escalation hours, and both notices. Tasks created after this use them; open tasks keep the limits they were created with. Recorded in the change history with your name and the previous values."
  - AR: «تعود كل القيم في هذه الصفحة إلى القيم الافتراضية للمنشأة الجديدة: منخفضة 80 ومتوسطة 40 وعالية 16 وحرجة 4 ساعات عمل، وساعات التصعيد، والإشعاران. تُطبَّق على المهام التي تُنشأ بعد ذلك، وتحتفظ المهام المفتوحة بالحدود التي أُنشئت بها. يُسجَّل ذلك في سجل التغييرات باسمك والقيم السابقة.»
  - The numbers are read from the server's defaults, never hard-coded on the screen.
- Buttons: "Reset policy" (danger) / «إعادة ضبط السياسة», and "Cancel" / «إلغاء».

## 6. Tests, mutations, measurements, performance

### Backend specs

- **Settings:** the defaults for a missing `taskSlaNotices`.
- **Lock:** a db-spec saves limits and escalation at once (ten rounds) and keeps both sections' fields, and an AI overage write in between does not lose `taskSla`. That last part depends on ACC-215 and is pinned only where our write runs second.
- **Section routes:**
  - each merges only its fields;
  - the limits route still refuses on stage deadlines, with nothing written;
  - a no-op writes no audit row.
- **Audit:** before/after hold the changed part only.
- **History:**
  - newest first, paged, `take` capped;
  - legacy rows are `kind: 'legacy'`;
  - another organisation's rows never appear, under the isolation gate's test name;
  - the permission is checked.
- **Reset:** writes the defaults and one audit row; refuses on a stage conflict.
- **Switch:**
  - off with a due-only edit sends no notice;
  - off with a priority-and-due edit sends the priority clause only;
  - on is unchanged.
- **Warning sweep:**
  - Off sends nothing;
  - inside the window: one notice and the stamp set;
  - a second pass sends nothing;
  - outside working hours: nothing;
  - ON_HOLD, closed, unassigned and an unpicked pool task: nothing;
  - a short window: nothing;
  - `WORKING_DAY` uses the calendar's hours per day;
  - a db-spec has two workers claiming the same task, and exactly one notice results.
- **Stamp clearing:** each of the five clearing paths clears it; resume does not.
- **Pure calendar helpers:** match `calculateDeadline` and `workingHoursBetween` on the existing cases.

### Frontend specs

- **Sections:**
  - dirty chip and footer; Discard restores;
  - Save is never disabled; an invalid Save reveals errors, counts problems and focuses the first;
  - a stage-conflict refusal shows under its priority's due value;
  - each section saves only its own fields.
- **Switch:** immediate, pending, and reverts on failure.
- **History:** the meta line; the dialog pages with Load more; the legacy wording.
- **Reset:** the confirm, and a conflict refusal shown inside it.
- **Leave guard:** names the dirty sections.
- **Arabic:** the counted strings and the warning options.

### Mutations (each must turn a named spec red)

1. Remove `FOR UPDATE`, or go back to a spread write. The concurrent-sections db-spec goes red.
2. Make a section route write the whole tier.
3. Drop the before/after from the audit row.
4. Drop the legacy clause from the history read.
5. Let the switch silence the priority clause.
6. Drop `dueWarnedAt IS NULL` from the claim.
7. Remove the working-hours gate from the warning step.
8. Drop the stamp clear on the approved extension.
9. Let ON_HOLD into the candidates.
10. Disable Save on an invalid form.
11. Reset recalculating an open task's due date: a db-spec asserts it is unchanged.

### Measurements (layout specs, both languages)

- **Reset confirm:** the 420 px cap for its body, in EN and AR, with the longest (Arabic) body.
- **Stage-conflict state:** measured inside the confirm, which takes the dialog's own scroll rule if it cannot fit; to be measured, not assumed.
- **History:** opened in `am-list-dialog size="compact"` (720 × 560), the list precedent that is exempt from the cap (ACC-229), with Load more. Rows measured at 720 and as a full-screen sheet at 390.
- **Page:** no sideways scroll at 390 and 1280; the escalation blocks stacked at 390.

### Performance (the ACC-271 rule)

- No query is added to the guards, the interceptors or the per-request path.
- The page reads the policy and the first history page once on open, in parallel. Nothing polls.
- The due-change switch costs one Organization read only on an edit that moves a due date.
- The warning step costs one Organization query per pass, then per organisation with the warning on: two calendar reads, one candidate query, one claim and one batched notice write.

## 7. PR split

| PR | Contents | Needs | Deploy slot |
| -- | -- | -- | -- |
| **1 — backend: section routes and history** | `GET …/policy`; `PATCH …/limits` and `…/escalation` with the lock and before/after audit; the same lock and audit on the old PATCH; `GET …/history` with the legacy rows; SYSTEM-REFERENCE corrected (the "non-clobbering merge" claim, the routes) | — | yes (backend) |
| **2 — the screen on PR 1's routes** | Header, meta line and history dialog; Time limits (four steppers); the escalation matrix; Save never disabled; the leave guard; layout specs. No switch, warning or reset yet; their sections are absent, not disabled. | PR 1 live, so the screen never calls a route Railway has not served | no (frontend) |
| **3 — switch and reset** | `taskSlaNotices` with `notifyOnDueChange`; `PATCH …/notices`; `POST …/reset`; `notifyAssigneesOfEdit` reads the switch; the Notifications and Reset sections; the old `PATCH /tenant/task-sla` removed | PR 2. The screen's half could split as 3-be then 3-fe if Ahmad wants the backend live first, as ACC-255 PR 4b-be did. | yes |
| **4 — warn before due** | `warnBeforeDue` in `taskSlaNotices` and the limits route; `workingHoursPerDay()` and the pure calendar helpers; `sweepDueWarnings`; `DUE_WARNING_CLEARED` on the five paths; the select and the short-window line on the screen | **lane B's migration adding `Task.dueWarnedAt`, merged and live first** (the column must exist before any code writes it) | yes |

## 8. Open questions for Ahmad (each with a recommendation)

| | Question | Recommended answer |
| -- | -- | -- |
| Q1 | The escalation hours count CLOCK hours since due today, while the limits are working hours. Should escalation count working hours too? | Yes, in PR 4 with the other sweep work (one calendar load per organisation per pass); until then the labels say "hours". |
| Q2 | Warn before due's default, for existing and new organisations? | Off: no new notices nobody asked for. |
| Q3 | The warning's channel? | In the app only, like the due-change notice. |
| Q4 | Remind on a task whose whole limit is no longer than the warning (Critical 4h with an 8h warning)? | No; the screen names the priorities this skips. |
| Q5 | After a warning, does reassigning the task warn the new holder? | Yes, so reassign clears the stamp. |
| Q6 | Build the design's "cannot be switched off for escalated tasks"? | No; it is not in the decided scope. |
| Q7 | With the switch off, is a priority change still announced? | Yes, without the date. |
| Q8 | If the defaults would break a stage deadline, should Reset be refused (like a save) with the stage list? | Yes. |
| Q9 | The design's left table of contents? | Leave it out, as the shipped settings screens do; the page has four sections. |
