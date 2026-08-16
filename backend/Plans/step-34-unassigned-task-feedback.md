# Step 34 — Unassigned Task Feedback (ACC-34 design)

Planning document only — awaiting review. Investigation-only pass,
no code changes made. Four related pieces, investigated separately
below, followed by one proposed ordered commit plan.

---

## 1. Actor Feedback

### Current response path, traced exactly

`WorkflowController.triggerTransition()` → `WorkflowService.triggerTransition()`
→ (SINGLE approval mode, which is what every seeded Committee stage
uses) → `performTransition()` → `fireTransitionActions()` (currently
`Promise<void>`, return value discarded) → returns
`this.mapInstance(updatedInstance)`.

`mapInstance()` (`workflow.service.ts`) builds the `IWorkflowInstance`
shape returned over HTTP — `id`, `organizationId`, `workflowTemplateId`,
`objectType`, `objectId`, `status`, `currentStageId`, `createdAt`,
`updatedAt`. Nothing about fired-action outcomes is in this shape
today.

Frontend: `WorkflowService.triggerTransition()`
(`frontend/.../workflow.service.ts`) POSTs and returns the identical
`WorkflowInstanceDto` shape (byte-for-byte mirror of the backend
interface). `WorkflowTransitionActionsComponent.onTrigger()` is the
actual button handler:

```ts
this.workflowService.triggerTransition(instanceId, { transitionId: transition.id }).subscribe({
  next: (updated) => {
    this.triggeringId.set(null);
    this.transitioned.emit(updated);   // only this — no toast, no message
  },
  error: (err: unknown) => {
    this.triggeringId.set(null);
    this.error.set(extractErrorMessage(err, 'workflow.errorTransition'));
  },
});
```

It already renders an `error()` signal via `<p-message severity="error">`
on the failure path. There is no equivalent on the success path today.

### Is there an existing mechanism not being used?

Yes and no. `WorkflowActionLog.responseSummary` already captures the
right text (`executeCreateTask()` returns
`` `Task created as ${task.status} — no eligible assignee` `` when
`assigneeIds.length === 0`) — but it's written to a table with zero
frontend readers anywhere in the app (confirmed, no
`WorkflowActionLog` references in `frontend/src/`). Reusing it would
mean either a new read endpoint + an extra round-trip, or restructuring
the whole action-logging flow. That's disproportionate to the actual
need.

### Does any seeded transition fire more than one `CREATE_TASK`?

Checked directly — grepped every `transitions:` array across all 8
seeded object types (`DOCUMENT_REQUEST`, `DOCUMENT`, `INCIDENT`,
`AUDIT`, `CORRECTIVE_ACTION`, `MEETING`, `COMMITTEE`,
`CHANGE_REQUEST`) in `workflow.seed.ts`. **Confirmed: every single
transition's `actions` array contains at most one `CREATE_TASK`
entry today.** But `WorkflowTransitionAction` rows are
tenant-editable data (the workflow builder lets a tenant admin add
as many actions of any type as they want to a transition) — nothing
in the schema or the builder UI prevents a tenant from configuring
two `CREATE_TASK` actions on one transition. A design that silently
drops a second warning would be a latent bug waiting for the first
tenant who does this, the same class of "unexercised by seed data
today, still a real code-level risk" issue already flagged
repeatedly elsewhere in this codebase (`ORG_UNIT_HEAD`, `ROLE_BASED`/
`SPECIFIC_USER` stuck-detection). Building it correctly now costs
one field going from `string | null` to `string[]` — cheap enough
to not defer.

### Proposed minimal-risk change (array-shaped, not single-value)

Enrich the existing response the frontend already fully receives,
rather than adding a new endpoint or a new read path:

1. `fireTransitionActions()` changes from `Promise<void>` to
   `Promise<string[]>` — collects one warning message per
   `CREATE_TASK` action whose `executeCreateTask()` call resolves
   zero assignees (pushed onto an array as the `for` loop over
   `actions` runs), returns the array (`[]` when nothing warrants a
   warning — never `null`, so callers never need a null-check).
   (Single call site — only `performTransition()` calls it — so
   this is a contained change.)
2. `performTransition()` threads that array into `mapInstance()`.
3. `mapInstance()` gains an optional second parameter
   `unassignedTaskWarnings: string[] = []`, included in the returned
   object (defaults to `[]` — every other existing call site of
   `mapInstance()` is unaffected, and the "always an array" contract
   means the frontend never has to distinguish "no field" from
   "field present but empty").
4. `IWorkflowInstance` / frontend `WorkflowInstanceDto` both gain
   `unassignedTaskWarnings: string[]`.
5. `WorkflowTransitionActionsComponent` adds a `warnings` signal
   (`string[]`, default `[]`) set from `updated.unassignedTaskWarnings`
   in the `next` callback, rendered via
   `@for (w of warnings(); track w) { <p-message severity="warn" [text]="w" /> }`
   — one message per warning, so a future multi-`CREATE_TASK`
   transition renders every distinct outcome instead of one message
   silently overwriting another. Mirrors the component's own
   existing `error()`/`<p-message severity="error">` pattern in
   spirit (same severity-coded `p-message` convention), not
   inventing a new UI convention.

Multi-approver paths (threshold not yet met) return `mapInstance(instance)`
directly without calling `performTransition()`/`fireTransitionActions()`
at all — correctly `[]` (via the default parameter), since nothing
fired yet. No special-casing needed there.

Out of scope, flagged not expanded: `startInstance()`'s
`resolveAndNotifyInitialAssignee()` has a parallel empty-pool scenario
for a stage's *initial* assignee, but it's a notification-only path
(no `CREATE_TASK`, no Task row) and a structurally separate call —
not touched here.

---

## 2. Committee-Name Resolution

### Confirmed: the target join, and where it currently fails silently

`notifyTenantAdminsOfUnassignedStage()` already has the exact pattern
to mirror:

```ts
let subjectLabel = `${instance.objectType} ${instance.objectId}`;
if (stage.committeeId) {
  const committee = await this.prisma.committee.findFirst({
    where: { id: stage.committeeId, organizationId },
    select: { nameEn: true },
  });
  if (committee) subjectLabel = `${committee.nameEn} (${instance.objectType})`;
}
```

**New finding, not in the original ticket text**: this existing
resolution is dead code in practice today. `grep`ing
`workflow.seed.ts` for `committeeId` returns zero matches — no seeded
stage, across any object type including Committee's own workflow,
ever sets `stage.committeeId` (Committee's stages all use
`assigneeStrategy: 'ROLE'`). This matches the exact live evidence
already captured during ACC-33's Phase 2 test: the real notification
body read `"In "Terms Review" for COMMITTEE cmsun8hsl..."` — the
generic fallback, not a resolved name — because `stage.committeeId`
was null. So this bug already exists live today; item 2 isn't just
adding a new capability, it's also fixing a currently-broken one.

`stage.committeeId` is the wrong key for "which object does this
instance represent" — it means something different (which committee's
*membership* a `COMMITTEE`-assigneeStrategy stage draws its pool
from). `instance.objectId` is the correct, always-populated key: for
`objectType === 'COMMITTEE'`, it *is* the committee's own id.

### Proposed change

Add one shared private helper:

```ts
private async resolveObjectSubjectLabel(
  instance: PrismaWorkflowInstance,
  organizationId: string,
): Promise<string> {
  if (instance.objectType === 'COMMITTEE') {
    const committee = await this.prisma.committee.findFirst({
      where: { id: instance.objectId, organizationId },
      select: { nameEn: true },
    });
    if (committee) return committee.nameEn;
  }
  return instance.objectType;
}
```

Two call sites:

1. `executeCreateTask()` — replace
   `` `${transition.labelEn} — ${instance.objectType}` `` with
   `` `${transition.labelEn} — ${await this.resolveObjectSubjectLabel(instance, organizationId)}` ``.
2. `notifyTenantAdminsOfUnassignedStage()` — replace the inline
   `stage.committeeId`-keyed block above with a call to the same
   helper, fixing the dead-in-practice resolution at the same time
   (one shared, correctly-keyed implementation instead of two, one of
   which never fires).

Other object types keep the current generic fallback (`instance.objectType`
alone) until those modules exist to resolve against — unchanged
behavior, matching the precedent already established for every other
partial-resolution case in this codebase.

---

## 3. `WorkflowActionLog.status`

### Confirmed current enum and its real semantics

```prisma
enum WorkflowActionLogStatus {
  SUCCESS
  FAILED
  RETRYING
}
```

Written from exactly two places:

- `fireTransitionActions()` — hardcodes `status: 'SUCCESS'`
  unconditionally for every non-`WEBHOOK` action type (`CREATE_TASK`,
  `SEND_NOTIFICATION`, `GENERATE_PDF`, `LOCK_DOCUMENT`).
- `WorkflowActionProcessor.logAttempt()` (the `WEBHOOK` BullMQ
  consumer) — the only place `FAILED`/`RETRYING` are ever written,
  and only for genuine delivery failures (HTTP error, timeout,
  network error) feeding BullMQ's real retry mechanism.

**Confirmed `FAILED`/`RETRYING` are not reusable for this case.** They
mean "the action's own execution errored," tied to a real retry
mechanism. A created-but-unassigned task is not an error — the action
executed successfully (a real `Task` row was created); it's an
outcome-quality signal, a fundamentally different axis. Reusing
`FAILED` would be actively wrong (nothing to retry — retrying
`CREATE_TASK` again wouldn't make an eligible assignee appear), and
leaving `status: 'SUCCESS'` as-is is the literal current bug the
ticket names.

### Proposed change

Add a fourth enum value, `SUCCESS_UNASSIGNED` (Prisma migration
required — same `ALTER TYPE ... ADD VALUE` shape as ACC-33's
`TaskSourceType` addition). `fireTransitionActions()`'s `CREATE_TASK`
branch sets `status: assigneeIds.length === 0 ? 'SUCCESS_UNASSIGNED' : 'SUCCESS'`
instead of the current unconditional `'SUCCESS'`. Every other action
type (`SEND_NOTIFICATION`, `GENERATE_PDF`, `LOCK_DOCUMENT`, `WEBHOOK`)
is unaffected — the new value is additive, not a behavior change to
anything already working.

(`fireTransitionActions()` already computes `assigneeIds.length === 0`
indirectly via `executeCreateTask()`'s return string — item 1's change
already threads that same per-action signal up through
`unassignedTaskWarnings`, so this reuses that plumbing rather than
adding a second one.)

---

## 4. Unassigned Tasks View

### Confirmed: no existing endpoint covers this

`TaskController` has exactly three `GET` routes:

- `GET /tasks/my-tasks` — scoped to `assignees: { some: { userId, removedAt: null } }`.
  **An unassigned task has no assignees by definition — it can never
  appear here, regardless of the `status` filter.** Not reusable.
- `GET /tasks?sourceType=&sourceId=` — scoped to one source object.
  Not tenant-wide.
- `GET /tasks/:id` — single task.

**A genuinely new endpoint is required.** Proposed:
`GET /tasks/unassigned` on `TaskController`, calling a new
`TaskService.listUnassigned(organizationId)` (`findMany({ where: { organizationId, status: 'UNASSIGNED' } })`,
ordered by `createdAt` or `dueAt`).

### Permission

Proposing `TASKS_PERMISSIONS.MANAGE` (`'tasks:manage'`) rather than
`TASKS_PERMISSIONS.VIEW`. Additional finding: `tasks:manage` is
already seeded into role permission sets but currently checked by
**zero** `@Permissions()` decorators anywhere in `task.controller.ts`
(matches SYSTEM-REFERENCE.md Section 3.6, "currently inert"). A
tenant-wide unassigned-task view is exactly the kind of broader,
admin-adjacent capability that permission was seeded for — using it
here activates a dormant permission string as a natural side effect,
not a new authorization scheme.

### `reassign()` — confirmed signature

`POST /tasks/:id/reassign`, gated by `TASKS_PERMISSIONS.REASSIGN`
(`'tasks:reassign'`, already checked). Body:
`ReassignTaskDto { newAssigneeUserIds: string[] (min 1), reason: string (required, max 1000) }`.
Service-level: removes all current active assignees, resolves new
ones through `filterActiveUsers()`, sets `status: PENDING` (or stays
`UNASSIGNED` if the new list also resolves to zero eligible users —
no special handling needed, existing logic already correct for this
view's use case), audit-logs as `DELEGATE`, notifies each new
assignee. No changes needed to `reassign()` itself — call as-is.

### Frontend placement

**Not** reusing `TaskListComponent` (`/tasks/all`) — that component is
purpose-built and source-scoped (`sourceType`/`sourceId` inputs
required; its own header comment says "meant to be dropped into a
future module's detail page"). Separate finding, not fixed here:
`/tasks/all`'s route never actually supplies those inputs, so that
page is currently dead/perpetually-empty in practice — pre-existing,
unrelated to this ticket, not touched.

Proposed: a new standalone component, `UnassignedTasksComponent`, new
route `/tasks/unassigned`, new sidebar nav entry
(`{ labelKey: 'nav.unassignedTasks', icon: 'pi pi-exclamation-triangle', route: '/tasks/unassigned', requiredPermission: 'tasks:manage' }`,
matching the existing flat top-level nav-entry shape used by every
other sidebar item — no new IA pattern invented). Table of unassigned
tasks (title, source type, created date) with an inline reassign
action per row (opens a small form: multi-user picker + required
reason, matching `ReassignTaskDto` exactly).

Built with an eye toward the Dashboard-widget future (per CLAUDE.md's
Sequence step 3 principle: permission-gated by the same
`tasks:manage` check, not hardcoded to a role) — the component itself
stays a plain, self-contained, embeddable unit; no dashboard
infrastructure exists yet to actually host it as a widget, so it ships
as its own routed page for now, same "temporary standalone, built
reusable" precedent `TaskListComponent`'s own header comment already
documents for itself.

---

## 5. Proposed Ordered Commit Plan

Backend first, frontend after, tests alongside each unit (not
batched at the end), translations last — matching this repo's
established baby-step convention.

1. **`fix(workflow): add SUCCESS_UNASSIGNED to WorkflowActionLogStatus [ACC-34]`**
   — Prisma migration + enum addition only. (Item 3, schema.)
2. **`fix(workflow): resolve real committee names in CREATE_TASK titles and stuck-stage notifications [ACC-34]`**
   — `resolveObjectSubjectLabel()` + both call sites + tests
   (including a regression test proving
   `notifyTenantAdminsOfUnassignedStage()`'s dead `stage.committeeId`
   path is now actually reachable via `instance.objectId`). (Item 2.)
3. **`fix(workflow): fireTransitionActions() reports unassigned-task and status outcomes [ACC-34]`**
   — `fireTransitionActions()` return-type change (`Promise<void>` →
   `Promise<string[]>`), `SUCCESS_UNASSIGNED` wiring (item 3's enum,
   now used), `performTransition()`/`mapInstance()` threading,
   `IWorkflowInstance.unassignedTaskWarnings: string[]` + tests
   (including one asserting multiple `CREATE_TASK` actions on one
   transition produce multiple distinct entries in the array, not
   one overwriting another). (Items 1 backend half + 3 wiring —
   grouped because `fireTransitionActions()`'s single return-type
   change is what both depend on; splitting further would leave an
   intermediate commit with an unused enum value or a half-wired
   return type.)
4. **`feat(tasks): add GET /tasks/unassigned, activate tasks:manage [ACC-34]`**
   — `TaskService.listUnassigned()`, controller route, DTO/interface
   additions, tests including the mandatory tenant-isolation test.
   (Item 4 backend.)
5. **`feat(workflow): surface unassigned-task warnings on transition trigger [ACC-34]`**
   — frontend `WorkflowInstanceDto.unassignedTaskWarnings: string[]`,
   `WorkflowTransitionActionsComponent`'s new `warnings` signal +
   `@for`-rendered `<p-message severity="warn">` block, component
   test (including the multiple-warnings-render-as-multiple-messages
   case). (Item 1 frontend half.)
6. **`feat(tasks): add Unassigned Tasks view [ACC-34]`**
   — `UnassignedTasksComponent`, route, sidebar nav entry, reassign
   form wiring, component test(s). (Item 4 frontend.)
7. **`chore(i18n): add translation keys for unassigned-task feedback and the Unassigned Tasks view [ACC-34]`**
   — `en.json`/`ar.json` (real Arabic, not placeholder) for the new
   warning message, nav label, and view's own strings.

Standard verification after each commit (or at minimum after each
backend/frontend pair): `tsc` (backend + frontend) + full jest suite +
tenant-isolation gate + `ng test`. Live manual pass before PR, per
this ticket's own established pattern: trigger a transition that
results in an unassigned task and confirm the warning renders; open
the new Unassigned Tasks view and confirm reassignment works
end-to-end.

---

## 6. Completion Checklist

Every item starts unchecked. Checked off commit-by-commit as
implementation actually proceeds, grouped by the same commit
boundaries as Section 5 — not inferred after the fact.

### Commit 1 — `SUCCESS_UNASSIGNED` enum

- [x] `WorkflowActionLogStatus` gains `SUCCESS_UNASSIGNED` in `schema.prisma`
- [x] Prisma migration generated and committed (`ALTER TYPE ... ADD VALUE`)
- [x] `npx prisma generate` run, generated client committed/ignored per convention

### Commit 2 — Committee-name resolution

- [x] `resolveObjectSubjectLabel()` private helper added to `WorkflowService`
- [x] `executeCreateTask()` uses the helper instead of the raw `instance.objectType` literal
- [x] `notifyTenantAdminsOfUnassignedStage()`'s inline `stage.committeeId`-keyed block replaced with a call to the same helper
- [x] Test: `executeCreateTask()` resolves a real committee name for `COMMITTEE`-type instances
- [x] Test: `executeCreateTask()` falls back to the generic format for non-`COMMITTEE` object types (unchanged behavior)
- [x] Test: `notifyTenantAdminsOfUnassignedStage()`'s committee-name resolution now genuinely fires (regression test proving the previously-dead `stage.committeeId` path is reachable via `instance.objectId`)
- [x] Tenant isolation test for the helper's `committee.findFirst()` query

### Commit 3 — `fireTransitionActions()` warnings + status wiring

- [x] `fireTransitionActions()` return type changed from `Promise<void>` to `Promise<string[]>`
- [x] `fireTransitionActions()`'s `CREATE_TASK` branch sets `status: 'SUCCESS_UNASSIGNED'` when `assigneeIds.length === 0`, `'SUCCESS'` otherwise
- [x] `performTransition()` captures `fireTransitionActions()`'s returned array and threads it into `mapInstance()`
- [x] `mapInstance()` gains `unassignedTaskWarnings: string[] = []` parameter, included in the returned object
- [x] `IWorkflowInstance` interface gains `unassignedTaskWarnings: string[]`
- [x] Test: a `CREATE_TASK` action with zero eligible assignees produces one entry in the returned array and logs `SUCCESS_UNASSIGNED`
- [x] Test: a `CREATE_TASK` action with eligible assignees produces `[]` and logs `SUCCESS`
- [x] Test: multiple `CREATE_TASK` actions on one transition (simulated) each contribute their own distinct entry — proves the array doesn't drop or overwrite
- [x] Test: multi-approver path (threshold not met) returns `unassignedTaskWarnings: []` without calling `fireTransitionActions()`
- [x] Test: every other action type (`SEND_NOTIFICATION`, `GENERATE_PDF`, `LOCK_DOCUMENT`, `WEBHOOK`) still logs `status: 'SUCCESS'`/existing behavior, unaffected by the new branch

### Commit 4 — `GET /tasks/unassigned` + `tasks:manage`

- [x] `TaskService.listUnassigned(organizationId)` added
- [x] `TaskController`'s new `GET /tasks/unassigned` route added, gated by `@Permissions(TASKS_PERMISSIONS.MANAGE)`
- [x] Response DTO/interface reuses `ITask` (or documents why a new shape is needed)
- [x] Test: `listUnassigned()` returns only `status: 'UNASSIGNED'` tasks
- [x] Test: `listUnassigned()` returns tasks tenant-wide, not scoped to the calling user's own assignments
- [x] MANDATORY tenant isolation test: `listUnassigned()` does not return another tenant's unassigned tasks
- [x] Controller test: route delegates to `TaskService.listUnassigned()` with the correct `organizationId`

### Commit 5 — Frontend actor-feedback rendering

- [x] `WorkflowInstanceDto` (frontend) gains `unassignedTaskWarnings: string[]`
- [x] `WorkflowTransitionActionsComponent` gains a `warnings` signal (`string[]`, default `[]`)
- [x] `onTrigger()`'s `next` callback sets `warnings` from `updated.unassignedTaskWarnings`
- [x] Template renders `@for (w of warnings(); track w) { <p-message severity="warn" [text]="w" /> }`
- [x] Component test: a response with one warning renders one `p-message`
- [x] Component test: a response with multiple warnings renders one `p-message` per entry
- [x] Component test: a response with `unassignedTaskWarnings: []` renders nothing new (no regression to existing success behavior)

### Commit 6 — Unassigned Tasks view (frontend)

- [x] `UnassignedTasksComponent` created
- [x] New route `/tasks/unassigned` added to `tasks.routes.ts`
- [x] New sidebar nav entry added, gated by `requiredPermission: 'tasks:manage'`
- [x] Frontend `TaskService` gains a method calling `GET /tasks/unassigned`
- [x] Table renders title, source type, created date per unassigned task
- [x] Inline reassign action per row: multi-user picker + required reason field, calling `POST /tasks/:id/reassign`
- [x] Empty state shown when no unassigned tasks exist
- [x] Loading state shown during the API call
- [x] Error state handled and displayed (no silent failure)
- [x] Component test: list renders fetched unassigned tasks
- [x] Component test: reassign action calls the service with the correct `ReassignTaskDto` shape and refreshes the list on success

### Commit 7 — Translations

- [x] `en.json`/`ar.json`: unassigned-task warning message — N/A on reflection, not a translation key. The warning text is `WorkflowActionLog.responseSummary`, generated server-side as a plain English string (`` `Task created as ${task.status} — no eligible assignee` ``) with no Arabic counterpart today — rendered via raw `[text]`, deliberately not `| translate`, same precedent as transition `labelEn`/`labelAr` (dynamic data, not a fixed app string). Localizing it would require the backend to generate a language-aware message, out of scope for this ticket.
- [x] `en.json`: key for the new nav entry label
- [x] `en.json`: keys for the Unassigned Tasks view's own strings (headings, table columns, reassign form labels, empty state)
- [x] `ar.json`: matching keys, real Arabic translations (not placeholders)

### Cross-cutting (verify before PR, not tied to one commit)

- [x] Backend TypeScript: zero errors
- [x] Frontend TypeScript: zero errors
- [x] Full backend jest suite passing (674/674)
- [x] Tenant isolation gate passing, count matches new Prisma queries added (23/23 — 22 pre-existing + 1 new for `listUnassigned()`)
- [x] Frontend `ng test` passing (48/48)
- [ ] Live manual pass: trigger a transition resulting in an unassigned task, confirm the warning renders in the UI
- [ ] Live manual pass: open the Unassigned Tasks view, reassign a task, confirm it disappears from the list and the assignee is notified
- [ ] SYSTEM-REFERENCE.md updated if this PR's changes touch a section it already documents (Section 3.6's `tasks:manage` "currently inert" note, Section 3.7's `reassign()` "zero frontend callers" note — both closed by this ticket)
