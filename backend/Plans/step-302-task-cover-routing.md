# Step 302: a new task for someone out of office goes to their cover

**Ticket:** [ACC-302](https://linear.app/accreditme/issue/ACC-302), "tasks: a new task for someone who
is out of office goes to their cover". Ahmad's decisions, 13 Nov, are in the ticket.

**Status:** plan only, no code. Branch `feature/ACC-302-task-cover-routing` from `origin/dev` at
`287ac36`.

**Recommendation:**
- **One file, `common/services/out-of-office-cover.ts`,** holds the window test and the cover rule.
- **Three callers:**
  - `TaskAssignmentService.resolvePlacement()`, for New task and Reassign;
  - `StageTaskDefinitionService`, at stage entry;
  - the assignee picker, so the dialog can say where a task will go before Create task.
- **What the rule changes:** only a placement's DIRECT people (a chosen person, or a one-holder
  position's holder). Pools never.
- **Size:** no migration. Two PRs: backend first, then the screens.

Measured on 14 Nov:
- **Code:** dev at `287ac36`.
- **Shared database:** read-only counts, from `D:\Accredit-me-2\backend`.

---

## 0. The count (shared database, 14 Nov, read-only)

| Organisation | Out of office now | …with an ACTIVE cover in the same organisation | Any out-of-office field set |
| -- | -- | -- | -- |
| al-manara | 0 | 0 | 1 |
| al-nakheel | 0 | 0 | 1 |
| platform | 0 | 0 | 0 |

Nobody is out of office now. One user in each tenant has a field set, but no window covers now.

**So shipping this changes nobody's tasks today.** The live proof sets a window and a cover on a seed
persona, then clears both (§8).

## 1. One cover rule, in one file

**Today the window test has three copies, each written the same way:**
- `workflow/stage-pool.service.ts:289` (inline);
- `task/task-authority.service.ts:187` (`isOutOfOffice`, a private function);
- `task/workload/task-workload.ts:108` (`isOutOfOffice`, exported).

In each, "away" means both dates set and now inside them, inclusive.

**New file: `backend/src/common/services/out-of-office-cover.ts`.**

- **`isOutOfOffice(user, now)`** is the window test, moved here. All three copies import it and the
  copies are deleted, so there is ONE copy. Behaviour is unchanged.
- **`activeCoverOf(user, organizationId, now)`:**
  - the person is out of office;
  - `actingUserId` is set;
  - the acting user is ACTIVE and in the same organisation.

  This is exactly StagePoolService's test today. StagePoolService calls it instead of its inline copy,
  with **no behaviour change for pools** (§7).
- **`routeToCovers(client, organizationId, directUserIds, now)`** is the task rule. One `user.findMany`,
  scoped by organisation, reads the direct people, their acting user, and the acting user's own window.
  It returns:
  - `userIds`: the people the task goes to;
  - `delegations: Map<coverId, { delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: awayId }>`.

  The rules:
  - **An ACTIVE direct person who is away with an active cover** is replaced by the cover.
  - **One hop only (§2).** If the cover is away too, the task stays with the original person.
  - **No double rows:** a cover who is already a direct person is not added twice, and gets no stamp.
    They are there in their own right, as in StagePoolService's `coveringFor`.
  - **Anyone else stays as they are.** `filterActiveUsers()` still runs afterwards, as today.

**Who calls `routeToCovers()`:**

- **`TaskAssignmentService.resolvePlacement()`.** On the two non-pool returns (a chosen person, and a
  one-holder position) it calls the rule and puts its result on the placement:
  `ResolvedPlacement.delegations`, new and optional. A pooled placement is returned untouched.
  - New task (`TaskService.create()`) and Reassign (`TaskService.reassign()`) both get it through this
    one call.
- **`StageTaskDefinitionService`.**
  - `placementAtEntry()` keeps resolving the target and its direct people.
  - `prepareEntryTasks()` then calls `routeToCovers()` ONCE for every definition of the entry, on the
    union of their direct people: one read per stage entry, not one per definition.
  - Each prepared task gets its own `userIds` and `delegations`. `PreparedTask.delegations` already
    exists, and `insertPrepared()` already writes it to the `TaskAssignee` rows; it is empty today.
  - This places the call one level above `placementAtEntry()` so it can be batched. The rule is still
    the same single function.
- **The rule is not applied where nothing is chosen:**
  - the legacy named-people path (`assigneeUserIds`, `newAssigneeUserIds`);
  - `prepareRecordTask()` (ACC-239's "Revise the terms of reference" task for the requester).

  See Q2.

## 2. One hop only

`routeToCovers()` reads the cover's own `outOfOfficeFrom` / `outOfOfficeTo` in the same query. If the
cover is away now, there is no routing: the task goes to the original person, with no stamp. Never a
chain, never a loop (A covers B, B covers A).

**StagePoolService does not have this check today.** A stage pool routes to an away cover. Changing
that changes who may press a stage's moves, which the ticket leaves alone, so it stays (Q7).

## 3. What is recorded

- **The cover's `TaskAssignee` row:** `delegationReason = OUT_OF_OFFICE_COVERAGE`, and
  `delegationContextId` = the away person's id. Both columns exist (ACC-40); no migration.
- **Reassign.** Today a returning row's delegation is cleared, on purpose: "a manual reassignment
  carries no delegation" (`task.service.ts`, `reassign()`).
  - A row that receives the task AS A COVER gets the stamp from the rule.
  - Every other row keeps today's clear.
- **The audit row:**
  - The CREATE (or DELEGATE, for reassign) row already includes the task with its assignees, stamps
    included.
  - It also gains `metadata.outOfOfficeCover: [{ forUserId, coverUserId }]`, so an auditor reads why
    without decoding the rows.
  - Ids only, as every audit row.
- **The task's target is kept** (the unit and position, or the committee seat), as today. A release or a
  departure therefore still knows where the task came from.
- **"Covering for {name}"** is shown under ACC-101's qualifier rule, unchanged
  (`DelegationLabelService`):
  - the cover always sees whom they cover;
  - anyone else sees it only with `users:view`;
  - a suppressed qualifier is absent.
- **On screen:**
  - The task page's API already returns each assignee's `delegation`, resolved under that rule
    (`TaskPageService`).
  - The task page does not draw it yet. PR 2 draws it on the assignee line, from `delegation`, with a
    task key, "covering for {{name}}".
  - The list rows (My tasks, a record's Tasks panel, All tasks) don't carry a delegation today.
    Adding it is Q8.

## 4. Notices

- **The cover** gets the existing "New task assigned" notice (`announceCreated()` loops over the
  assignees). Its text adds who they cover: "You have been assigned: "{title}" (covering for {name})"
  (Q5).
  - The cover may always know whom they cover (ACC-101), so this discloses nothing new to them.
  - Server-built text is English today (ACC-95). That is unchanged.
- **The away person: nothing** (recommendation). They are away; a notice they can't act on only lands in
  the bell when they return, and the task isn't theirs.
- **The creator** is told before Create task (§5), not by a notice.
- **A reassign** sends the same notice the same way.

## 5. The creator is told before Create task, and the server decides

**Where:** the assignee picker, not the SLA preview. The SLA preview is about the due date; the picker
is where the creator chooses the person.

**What the server returns:**
- `GET /tasks/assignees` and `GET /tasks/assignees/committee` return `IAssignableHolder[]`.
- Each holder gains, additively, `cover: { userId, name } | null`: who a new task for them goes to NOW,
  from the same `activeCoverOf()` plus the one-hop check.
- One extra batched read per list: the holders' window and acting user, in the query that already reads
  the holders. The workload service's existing window read (`people()`) uses the same function.

**What the dialog shows (PR 2):**
- **A chosen person with a `cover`:** a line under Person, "{name} is out of office. This task will go to
  {cover}." It says no dates (Q3).
- **A one-holder position:** the line names its holder the same way. The holder list is already loaded
  for the position.
- **No rule in the screen.** The screen only reads `cover`; it never re-derives "away" from dates.
  - A spec pins it: a holder with an away window but `cover: null` shows no line.
- **The server's answer at Create task is final.** If someone goes away between opening the dialog and
  pressing Create, the created task reflects the rule at that moment.
- **Reassign uses the same picker** (`?taskId=`), so it shows the same line and gets the same routing.

## 6. Draft with AI and the workload hint

- **Draft with AI (ACC-197): unchanged.** It reads the record and the note, never a person
  (`ai-task-draft/` names no assignee).
- **Workload counts:** unchanged. Each holder's row keeps their OWN open and overdue counts on the
  record. The rule decides who receives the task, not whose row it is.
- **"✦ Suggest someone" (ACC-199):**
  - Already compares only against people who are not out of office (`canSuggestFor()`), and the model's
    candidates leave them out.
  - **Recommendation (Q6): `canSuggest` is false for a holder with a `cover`.** The task won't go to
    them, so "suggest someone instead of X" answers the wrong question.
  - **Edge case, verified and left:** the suggested person could go away between the hint and Create
    task. The task then goes to their cover, and `verifiedAiWorkloadHint()` (which needs the chosen
    person among the assignees) leaves it unmarked with its existing warning line. It never blocks the
    task.

## 7. Unchanged, deliberately

- **Tasks already held** stay with the person. Nothing moves when someone goes away or returns
  (ACC-132, Canceled). There is no sweep and no backfill.
- **Pools** (a position or committee seat with several people) leave covers out, as decided on 6 Oct.
  `resolvePoolMemberIds()` and the pick rule are untouched. A pooled task picked by someone is theirs;
  no cover routing at pick.
- **StagePoolService** behaves exactly as today. It calls the shared `activeCoverOf()`, which is the
  same test as its inline copy. Its stage pools still include an away member's cover (Q7).
- **`canActForCreator()` and `decisionRecipients()`** (ACC-173) behave as today, on the shared window
  test.
- **The ACC-101 qualifier rule** is unchanged (Q4).

## 8. Performance, specs, PR split, migration

**Performance:**
- New task and Reassign: one extra `user.findMany` (the direct people, usually one).
- A stage entry: one for all its definitions.
- The picker: one per list.
- Every read is scoped by organisation, selects five fields, and is batched by ids.
- **Nothing on the per-request path** (no guard, interceptor or middleware), and no polling.

**Specs:**
- **`out-of-office-cover.spec.ts` (unit):**
  - the window: both dates required, inclusive ends;
  - the cover is ACTIVE and in the same organisation;
  - one hop;
  - no double row;
  - pools untouched.
- **`task-cover-routing.db-spec.ts` (real Postgres, 55432):**
  - New task to a chosen away person: the cover's row is stamped, the cover is notified, the away person
    is not, and the audit metadata is right;
  - a one-holder position;
  - a stage entry, two definitions, one read;
  - Reassign;
  - an away cover, an inactive cover and a cover in another organisation each leave the task with the
    person. The last is an `itEnforcesTenantIsolation` case;
  - a pool is unchanged;
  - a task already held is unchanged when its holder goes away.
- **Picker:** `cover` on holders, and `canSuggest` false for a covered holder.
- **PR 2 (frontend):** the dialog line from `cover` only; the task page's qualifier; both languages.

**Mutation checks, each must turn a named spec red:**
1. remove the one-hop check;
2. remove the ACTIVE check;
3. remove the call from the stage path;
4. remove the call from `resolvePlacement()`;
5. let the screen derive "away" from dates.

**PR split:**
1. **PR 1, backend**, all additive:
   - the shared file; the three window-test copies replaced;
   - both paths and Reassign;
   - stamps, audit metadata and the notice;
   - the picker's `cover` field and `canSuggest`;
   - SYSTEM-REFERENCE §3.5 rewritten (it still describes the retired
     `WorkflowService.applyOutOfOfficeRouting()` and CREATE_TASK), plus §3.9's cross-reference.
2. **PR 2, screens:** the dialog line (New task and Reassign), and the task page's "covering for" line.

**Migration:** none. The delegation columns exist.

**Live proof (after PR 1 deploys):**
- Set a window and a cover on one seed persona.
- Create one task to them, check where it went, then cancel it.
- Clear the window. A reassign check uses the same task before it is cancelled.
- The report names nobody.

## 9. Questions for Ahmad (recommendation first)

1. **A chosen committee member** (committee → seat → person on a committee's own task): same rule?
   *Recommendation: yes.* It is a chosen person like any other, and the rule lives in
   `resolvePlacement()`, where both routes end. A committee seat without a chosen person stays a pool.
2. **The legacy named-people path and `prepareRecordTask()`** ("Revise the terms of reference" for the
   requester): apply the rule? *Recommendation: no, not in this ticket.* Neither is a New task route,
   and the ticket names only those. A follow-up can decide the requester's case.
3. **What the dialog says:** "{name} is out of office. This task will go to {cover}." *Recommendation:
   name both, no dates.* The ticket asks for "away" and "who receives it". Dates would tell anyone with
   Create tasks when a colleague is away, which the picker doesn't disclose today.
4. **The creator on the task page:** under ACC-101 they see "covering for" only with `users:view`.
   *Recommendation: keep ACC-101 as it is.* The dialog has already told them at Create time, and widening
   the qualifier rule is its own decision.
5. **The cover's notice names whom they cover.** *Recommendation: yes.* The cover may always know it.
6. **"✦ Suggest someone" off for a holder who is covered.** *Recommendation: yes* (§6).
7. **Stage pools keep routing to an away cover** (no one-hop check there). *Recommendation: leave it,
   and open a ticket if you want the same rule there.* It changes who may press a stage's moves.
8. **"Covering for" on the list rows** (My tasks, the record panel, All tasks). *Recommendation: not in
   this ticket.* The task page shows it (PR 2); the rows need a batched label read per page, sized on
   its own.

### 9.1 Ahmad's answers (14 Nov)

1. **Yes:** a chosen committee member follows the same rule.
2. **Leave as is:** the named-people path and `prepareRecordTask()` are unchanged.
3. **No dates:** the dialog names the person and the cover only.
4. **Keep ACC-101** as it is.
5. **Yes:** the cover's notice names whom they cover.
6. **Yes:** a covered person is never suggested against. The suggest-someone endpoint refuses or skips
   them, so the screen does not decide.
7. **Leave stage pools,** with no ticket yet.
8. **Not in this ticket:** "covering for" on list rows.

**Who builds what:** lane A decides who builds PR 2 (the screens). This branch builds PR 1 only. The
merge waits for lane A's #293.

## 10. Progress

- [x] Plan: counts, the three window copies, both placement paths, notices, picker, hint (14 Nov)
- [x] Ahmad's answers to §9 (14 Nov, §9.1)
- [x] PR 1 (backend) built (14 Nov): the shared rule, both paths, Reassign, the picker's `cover`, the
  suggest-someone refusal, stamps, audit and notice; five mutations checked. Handoff for lane A:
  `step-302-handoff-lane-a.md`
- [ ] PR 2 (screens)
- [ ] Live proof
