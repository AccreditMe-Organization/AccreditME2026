# Step 208 — Stage Tasks settings screen (ACC-208)

**Status: PLAN — awaiting approval (11 Oct). No code yet.**
- Branch: `feature/ACC-208-stage-tasks-screen`, from `origin/dev` at `048c887`.
- Lane B, High. This is the frontend for ACC-190's task definitions
  (`step-190-stage-task-definitions.md` §11).

**The drawing.** `AccreditMe Stage Tasks.dc.html` was accepted on 10 Oct, but
it is **not in `frontend/design-reference/` on this branch yet**: only
`AccreditMe Task Screens.dc.html` is there. This plan is written against the
brief and ACC-190 §11. Once the drawing is copied in, I read it in full before
building. On anything visual the drawing wins; anything in it that contradicts
§8 below comes back to Ahmad before it is built.

---

## 1. What exists today, measured on `048c887`

| Piece | Where | State |
|---|---|---|
| Stage list, expanded row | `foundation/workflow/components/workflow-stage-list/` | The row owns its disclosure. The expanded panel holds only `app-workflow-transition-editor`, which refreshes the whole template on `changed`. The page and reorder are gated by `workflows:manage` (`canManage`). A `?stage=<id>` fix-link expands that stage. |
| Transition editor | `.../workflow-transition-editor/` (871 lines) | Two unstepped `app-edit-dialog`s, Add and Edit, `width="560px"`. Their actions sit **in the body**, not the footer. No `am-field`. **Never measured against the 420px cap.** It already follows the ACC-55 pattern (`refreshPending`, `notifyParent()`). |
| Stage form | `.../workflow-stage-form/` | Unstepped; actions in a sticky in-body footer; never measured. The SLA field is `slaWorkingHours` (`p-inputNumber`). Positions come from `OrgPositionService.listPositions()`, units from `OrgUnitService.getFlat()`, committee roles from `LookupService.getValues('committee_member_role')`. So the workflow screens already rely on `org:view` and `lookups:view`. |
| Frontend workflow DTOs | `foundation/workflow/services/workflow-template.service.ts` | **No `kind` on any transition interface.** No `taskDefinitionCount` / `longestTaskHours` on the stage DTO. No definition methods. |
| Backend transition DTO | `create-workflow-transition.dto.ts` | `kind?: ADVANCE \| RETURN \| EXIT`, optional and defaulting to ADVANCE. Update inherits it, so Edit can change it. |
| Backend template read | `GET /workflow-templates/:id` | Each stage carries `taskDefinitionCount` and `longestTaskHours`. |
| Definition routes | `workflow-template.controller.ts` | All five exist (§3). Create and update return `{ definition, warning }`. **The list returns no warning.** |
| Assignee cascade | `foundation/tasks/components/task-assignee-picker/` (ACC-167) | Writes into an `AssignGroup` (`scope`, `target`, `userId`); used by task-form and task-reassign. Data comes from `/tasks/assignment/*` and `/tasks/assignees*`. Committee scope is offered only for a committee's own task, and only that committee. **Committee roles with no active member are not returned.** |
| Assignment gate | `TaskAssignmentService.assertMayAssign()` | `tasks:create`, or a `?taskId=` the caller may reassign. **A caller holding only `workflows:manage` gets a 403.** |
| Relative-route registry | `backend/.../stage-task-record-routes.ts` | Has COMMITTEE and MEETING only, and fails closed. **Not exposed by any endpoint.** |
| Refusal handling | `core/http/refusal.ts` (`refusalCode`, `refusalBody`) | Used only by auth. The workflow, committee and task-SLA code all use `extractErrorMessage()`, which shows the server's English `message` and ignores `code` and details. |
| Transition failure on a record | `workflow-transition-actions` | A `STAGE_TASKS_OPEN` refusal shows today as one English sentence. The `tasks[]` list is dropped. |
| Task SLA screen | `admin-settings/.../task-sla-settings/` | Any save error shows as the generic `adminSettings.errorSave`. Read and write both need `tenant:manage_config`. |
| Step precedent | `position-form` + `position-list` | Uses `am-step-strip` via `headerExtra`, `step` signal, `next()` → `revealAndFocusFirstInvalid()`, and an invalid submit goes back to step 1. |
| Task detail page | — | **None exists.** Tasks are opened from a list row: the embedded list on a record page, My tasks, or All tasks. |

---

## 2. Backend gaps — the smallest additive changes

There is no migration, no new enum value and no new permission. Each change
adds a field or widens a gate, and each gets its own spec.

**B1 — The list carries each row's warning.**
- `GET /stages/:stageId/task-definitions` items gain
  `warning: 'POSITION_HAS_NO_HOLDER' | 'POOL_EMPTY' | null`, computed by the
  existing `warningFor()`.
- Without this the chip can only appear straight after a save, and it vanishes
  on reload. The drawing puts the chip on the list.
- Cost: at most one pool query per row. A stage has a handful of definitions.
  The order route returns the list too, so it gets the same field.

**B2 — The template says which relative routes its record type has.**
- `GET /workflow-templates/:id` gains `recordRoutes: { unit: boolean; committee: boolean }`.
  It is read from `RECORD_ROUTES[objectType]`, so the frontend never keeps a
  second copy of the registry.
- A type with no entry gets `false/false`, so the registry still fails closed
  in one place. Today COMMITTEE and MEETING are true/true; everything else is
  false/false.

**B3 — The template carries the tenant's priority due times.**
- `GET /workflow-templates/:id` gains
  `taskDueHours: { LOW, MEDIUM, HIGH, URGENT }`, the same `dueHoursFor()`
  numbers the definitions use.
- The dialog shows "High · due in 16 working hours" for every priority before
  saving, and it can catch the deadline rule before the round trip.
- Today the only reader is `GET /tenant/task-sla`, which needs
  `tenant:manage_config`. A custom role with `workflows:manage` alone would see
  no hours.

**B4 — The assignment pickers admit a workflow configurer.**
- `assertMayAssign()` gains one more passing condition: **`workflows:manage`,
  with no `taskId`.** Configuring where a stage's tasks go is choosing a
  target, the same as `tasks:create`. The data is the same: unit names,
  position names, holder names.
- The committee variants still need `committees:view` (ACC-101 clause (a)), as
  they do today.
- Every system role that holds `workflows:manage` (TENANT_ADMIN) already holds
  `tasks:create`. This only matters for custom roles. **→ Q1.**

**B5 — Committee roles can be listed as the whole catalogue.**
- `GET /tasks/assignment/committee-roles` gains `catalogue=true`. With it:
  - every active `committee_member_role` value is returned, including roles
    with no members;
  - `memberCount` is filled in when a `committeeId` is given, and is `null`
    without one;
  - `committeeId` becomes optional, but only with `catalogue`.
- Without the flag, behaviour is unchanged. The task picker hides empty roles
  deliberately, because a task sent to an empty pool reaches nobody.
- Configuration needs the opposite:
  - an empty role is a legitimate target, and its warning chip says so;
  - "the record's committee" names no committee, so it needs the catalogue.
- The stage form gets the catalogue from `LookupService` (`lookups:view`). Using
  the picker's own endpoint means the cascade has one data source and one gate.

**B6 — Refusal details a screen can render in both languages.**
- `TASK_SLA_EXCEEDS_STAGE_DEADLINES.stages[]` gains `workflowTemplateId`,
  `stageNameAr` and `templateNameAr`. Today it carries only English names and
  nothing to link with.
- `STAGE_DEADLINE_BEFORE_TASKS`, `STAGE_TASK_DUE_AFTER_STAGE_DEADLINE` and
  `STAGE_TASKS_OPEN` already carry what the screen needs: both numbers, the
  priority, the definition ids, and the task ids with `title`/`titleAr`.

**Not a gap:**
- `STAGE_TASK_ON_FINAL_STAGE` is thrown both when adding a definition to a
  final stage and when marking a stage final while it has definitions
  (`{ taskDefinitionCount }`). The screen uses both as they are.

---

## 3. Every API call the screen makes

| Call | Permission | Used by | Change |
|---|---|---|---|
| `GET /workflow-templates/:id` | workflows:view | stage list | + B2, B3; frontend DTO gains `taskDefinitionCount`, `longestTaskHours`, `kind` |
| `GET /workflow-templates/stages/:stageId/task-definitions` | workflows:view | "Tasks on entry", loaded when the row expands | + B1 |
| `POST /workflow-templates/stages/:stageId/task-definitions` | workflows:manage | dialog, Add | returns `{definition, warning}` |
| `PATCH /workflow-templates/task-definitions/:id` | workflows:manage | dialog, Edit | same |
| `DELETE /workflow-templates/task-definitions/:id` | workflows:manage | Delete, after confirmation | — |
| `POST /workflow-templates/stages/:stageId/task-definitions/order` `{ids}` | workflows:manage | Move up / down | + B1 (returns the list) |
| `POST /workflow-templates/transitions`, `PATCH /transitions/:id` | workflows:manage | Kind field | sends `kind` |
| `PATCH /workflow-templates/stages/:id` | workflows:manage | stage form | maps `STAGE_DEADLINE_BEFORE_TASKS`, `STAGE_TASK_ON_FINAL_STAGE` |
| `GET /tasks/assignment/units`, `/positions?orgUnitId`, `/tasks/assignees?orgUnitId&positionId` | B4 | cascade: a unit you choose → position → person | — |
| `GET /org-positions` (existing `listPositions()`) | org:view | cascade: the record's own unit → position | — |
| `GET /committees` (existing `listCommittees()`) | committees:view | cascade: a committee you choose | — |
| `GET /tasks/assignment/committee-roles?catalogue=true[&committeeId]` | B4 + committees:view | cascade: role (both committee routes) | B5 |
| `PATCH /tenant/task-sla` | tenant:manage_config | task SLA screen | maps `TASK_SLA_EXCEEDS_STAGE_DEADLINES` (+ B6) |
| `POST /workflows/instances/:id/transition` (existing) | per transition | committee page | maps `STAGE_TASKS_OPEN` |

**Missing permissions hide only their part.**
- Without `committees:view`, the two committee routes are absent and a one-line
  note says why. This is the picker's existing behaviour.
- Without `org:view`, "the record's own unit" is absent the same way.

---

## 4. Components and where they live

All of these live under `frontend/src/app/foundation/workflow/` unless stated.

**4.1 `components/stage-task-list/` — "Tasks on entry"**
- It sits in the expanded row beside the transition editor, under a header of
  its own.
- Inputs: `stage` (deadline, `isFinal`), `templateId`, `recordRoutes`,
  `taskDueHours`, `canManage`.
- It loads the definitions itself when the row expands. It does not refresh the
  whole template, so a definition change does not rebuild the expanded row
  (the ACC-55 trap: a parent refresh destroys an open dialog). After a change
  it emits `summaryChanged`. The parent patches that stage's
  `taskDefinitionCount` and `longestTaskHours` in place, with no reload.
- **Header line:**
  - "Stage deadline: 40 working hours · longest task: 16";
  - "No deadline · longest task: 16";
  - with no definitions, the empty sentence "No tasks are created when a record
    enters this stage."
  - Hours are plural objects (§6).
- **Row:**
  - the title, with Arabic under it when set (`bilingual()`, `dir` isolated);
  - Mandatory or Optional;
  - Evidence required;
  - "High · due in 16 working hours";
  - the assignment in words (§4.4);
  - the warning chip from B1.
  - The actions are Edit, Delete, Move up and Move down, gated together by
    `canManage` (check:action-gating).
- **Reorder keyboard path:**
  - The Move up and Move down buttons are real buttons in tab order.
  - After a move, focus follows the moved row's same button, so pressing
    Enter again keeps moving it. If that button is now disabled (the row
    reached the top or bottom), focus goes to the other one.
  - A polite live region announces "Moved to position 2 of 4".
  - No drag. The drawing names a keyboard path, and buttons give pointer and
    keyboard the same path.
  - While the order call is in flight, the buttons disable.
  - A `STAGE_TASK_ORDER_MISMATCH` (someone else edited the list) reloads the
    list and says so.
- **Delete confirmation:** "Delete “{{title}}”? Tasks already created from it
  stay as they are." (`check:confirm-translated`).
- **Final stage:** the section shows "A final stage can't create tasks — the
  record is complete when it arrives", with no Add. **→ D4.**

**4.2 `components/stage-task-definition-form/` — the two-step dialog**
- It is hosted by `EditDialogComponent`:
  - `headerExtra` holds `am-step-strip`;
  - the actions are in the `footer` template, with Back, Next and Save;
  - `dirty` and `saving` are passed through;
  - density is compact.
- **Step 1, "The task":**
  - title EN (required) and AR (optional, stored as NULL when empty);
  - description;
  - Mandatory / Optional as a two-option radio, each with its one-line help:
    "Holds the record here until it's done" / "Never holds the record;
    cancelled when it leaves the stage";
  - Evidence required.
- **Step 2, "When and who":**
  - priority, with each option showing its due time from B3;
  - then the assignment (§4.3).
- Next reveals step 1's errors (`revealAndFocusFirstInvalid`). An invalid
  submit returns to the step holding the first error.
- **Deadline rule before the round trip:**
  - When the chosen priority's hours exceed the stage deadline, step 2 shows
    the refusal inline under Priority, naming both numbers and the way out:
    "High tasks are due in 16 working hours, but this stage's deadline is 8.
    Choose a lower priority, or raise the stage deadline to at least 16."
  - Save stays enabled, and the server's 409 is mapped to the same sentence.
  - Hours can change between load and save, so the server's answer is the one
    that counts.
- **Warning after save (ACC-55):**
  - The dialog stays open on its warning:
    - "Nobody holds this position in Cardiology yet — the task will wait
      unassigned until someone does."
    - "Nobody is in this committee role yet."
  - A create switches to edit, so pressing Save again cannot create a second
    definition.
  - The list refreshes when the dialog closes, not before.
- **The 420px rule (ACC-120).**
  - The drawing settles two steps. The rule says stepping answers a
    **measured** overflow.
  - I measure the single-step form in both languages, with `am-field` in place,
    compact density, and the actions in the footer. I record the numbers here
    before building the steps.
  - Expected: well over 420px. Step 1 alone is five blocks plus two help lines;
    step 2 is the priority plus up to four cascade fields and an outcome line.
  - If it somehow fits, I stop and ask rather than step it.

**4.3 Assignment — reusing the task picker's cascade**
- A choice of four routes comes first ("Where does the task go?"), as an
  `OverlaySelectComponent` or a radio group, whichever the drawing shows:
  - **A unit you choose** → unit → position → optional person.
    `TaskAssigneePickerComponent` is reused unchanged in its unit path, bound to
    the same `AssignGroup` (`createAssignGroup` / the scope-target-user
    controls). Its outcome line ("goes to a pool of 3…", "nobody holds this…")
    is the preview of the chip.
  - **The record's own unit** → position, from the org-wide catalogue (no
    holder count, because no unit is known yet). One line of help: "Whoever
    holds it in the unit of the record that enters this stage."
  - **A committee you choose** → committee (`listCommittees()`) → role (B5,
    with member counts). No person: the backend refuses `userId` on this route.
  - **The record's committee** → role (B5 catalogue).
- The two relative routes **are not rendered** when `recordRoutes` says the
  record type has none. They are absent, not disabled.
- ROLE is never an option.
- **The picker change:** one new input, `rolesCatalogue` (default `false`). When
  true, the role call sends `catalogue=true` and the picker shows empty roles
  with a "nobody yet" note instead of hiding them. Its committee scope comes
  from a `committees` input rather than only `sourceId`.
  - The task form and the reassign dialog keep today's behaviour by default,
    and their specs pin it.
- A small adapter, `toDefinitionRoute(kind, group)`, maps the group to the DTO's
  five route fields, sending exactly the fields each kind needs. This is the
  mirror of the backend's `ROUTE_FIELDS`.

**4.4 The assignment in words** (`stage-task-route-label.ts`, a pure function with its own spec)
- "Quality Officer, Cardiology", and when a person is chosen, "— Sara Al-Harbi";
- "Quality Officer in the record's unit";
- "Secretary of the Quality Assurance Committee";
- "Secretary of the record's committee".
- Names come from the definition's resolved objects through `bilingual()`, so a
  missing Arabic name falls back to English (ACC-160).

**4.5 Transition editor — the Kind field**
- Add and Edit gain **Kind**: Advance / Send back / End the record, as a radio
  group with a one-line help under each:
  - "Moves the record on. Blocked while required tasks of this stage are open."
  - "Returns the record to an earlier step. Open tasks here are cancelled."
  - "Ends the record. Open tasks here are cancelled."
- Add always starts at Advance, even when the target stage is earlier.
  **Kind is never inferred from stage order** (ACC-190: Reject goes forward,
  Reactivate goes back). Edit shows the stored value.
- The transition table gains a Kind column (or a tag beside the label, as drawn).
- The DTOs gain `kind`.
- Both dialogs are measured with the field added. If either goes over 420, the
  compaction list applies first: actions move to the footer, then compact
  density. They are not stepped unless they are still over.
- **→ D5** (the `isApprovalPath` checkbox on Add).

**4.6 Stage form — a deadline lowered below its tasks**
- `STAGE_DEADLINE_BEFORE_TASKS` shows inline under the SLA field: "This stage
  has a task due in 16 working hours. Keep the deadline at 16 or more, or lower
  that task's priority first."
- The field is marked invalid (`aria-invalid`) and receives focus.
- `STAGE_TASK_ON_FINAL_STAGE`, when Final is ticked, shows under the Final
  checkbox: "This stage creates 2 tasks on entry. Remove them before making it
  final."
- Errors are read from the code, never from `message`.

**4.7 Task SLA settings — `TASK_SLA_EXCEEDS_STAGE_DEADLINES`**
- An inline error names the stages that would break, from B6. Each line reads
  "Committee workflow — Terms Review: deadline 8, its longest task would be due
  in 16", with the stage name linking to `/workflows/:templateId/stages?stage=<id>`,
  the existing fix-link, which expands it.
- The way out is named: "Lower the hours, or raise those stages' deadlines
  first."
- Nothing is saved.

**4.8 Committee page — "Can't move yet"**
- `WorkflowTransitionActionsComponent` maps `STAGE_TASKS_OPEN` to a panel:
  - the heading "Can't move yet";
  - the sentence "Finish these required tasks first:";
  - one link per open task: its title through `bilingual(title, titleAr)` and
    its status label.
- The panel replaces the error line and clears on the next attempt.
- **→ D2:** where a task link goes.

**4.9 Frontend refusal mapping (`foundation/workflow/workflow-refusal.ts`)**
- `workflowRefusal(err)` returns `{ code, key, params } | null` from
  `refusalCode` / `refusalBody`. Each screen renders its own key, and
  `extractErrorMessage` stays as the fallback for unknown codes.
- Keys live under `workflow.refusal.<CODE>`, with parameters for the numbers.
- Every `WorkflowRefusalCode` gets a key. The definition dialog's not-found and
  route codes become field-level errors where a field exists, and dialog-level
  errors otherwise.

---

## 5. Docs that change

- **SYSTEM-REFERENCE.md:**
  - §2.15 gains the screen and B1–B3;
  - §3.9 gains the B4 gate and the B5 catalogue;
  - §10.5 records the two measurements and the new dialog consumer.
- **CLAUDE.md:** a short **Key Architecture Decisions (ACC-208)** for B4 and
  for the rule "relative routes come from the template, never a frontend copy".

---

## 6. i18n

- Every string is in `en.json` and `ar.json`.
- **Counted hours are plural objects** with all six Arabic categories
  (ACC-94): `plural.workflow.workingHours` ("{{count}} working hours" /
  "ساعة عمل" forms) and `plural.workflow.stageTasks` (the final-stage count).
  `check:formatting` and the translation-keys spec cover them.
- Tenant data (titles, unit, position, committee and role names) goes through
  `bilingual()`, never `| translate`.
- Specs that switch to Arabic call `preserveDocumentLanguage()`.

---

## 7. Tests

**Backend (Jest):**
- B1: list rows carry each warning kind, and `null` for relative routes and for
  a chosen person.
- B2: COMMITTEE true/true, DOCUMENT false/false.
- B3: hours equal the tenant's task SLA.
- B4: `workflows:manage` without a taskId passes; without either permission it
  is still a 403 naming `tasks:create`; with a taskId it is unchanged.
  Committee variants still need `committees:view`.
- B5: the catalogue includes empty roles; `memberCount` is null without a
  committee; without the flag behaviour is unchanged; a missing `committeeId`
  without the flag is still a 400.
- B6: the conflict carries the template id and the Arabic names.
- **Tenant isolation:** B1 and B5 get a "should NOT return records belonging to
  a different tenant" spec named exactly that way for the gate (CLAUDE.md:
  mislabeled tests are invisible to CI).

**Frontend (Karma):**
- **stage-task-list:**
  - each header state: deadline, no deadline, empty, final stage;
  - a row's words for all four routes;
  - the chip from each warning;
  - actions hidden without `workflows:manage`;
  - delete confirmation text;
  - **keyboard reorder**: Enter on Move down sends the new order, focus stays
    on the moved row's button, the live region speaks, and the ends are
    disabled;
  - order mismatch reloads.
- **definition-form:**
  - Next blocked with the title empty and focus on it;
  - relative routes absent when `recordRoutes` is false;
  - ROLE never offered;
  - each route sends exactly its fields;
  - the inline deadline sentence before saving, and the 409 mapped to the same
    sentence;
  - warning keeps the dialog open and switches to edit;
  - an invalid submit returns to step 1.
- **Parent + child integration** (the `workflow-stage-list.integration.spec.ts`
  shape): saving a definition with a warning does not destroy the open dialog.
- **Picker:** `rolesCatalogue` shows empty roles; the default still hides them
  (both existing hosts pinned).
- **Transition editor:** Add defaults to ADVANCE whatever the target's order;
  Edit sends the chosen kind; help lines render.
- **Stage form, task SLA screen, transition actions:** each refusal renders
  its numbers and its way out, and the server's English is never shown.
- **Arabic:** each new component rendered in Arabic, asserting `dir`, the
  Arabic plural for 1, 2, 3 and 11 hours, and the English fallback for a
  definition with no Arabic title.
- **Measurements:** the definition form's and the two transition dialogs' body
  heights, in both languages, with a non-vacuity guard first (ACC-120): the
  offsets must be real before "under 420" means anything.
- All `check:*` scripts are discovered and run (`action-gating`,
  `confirm-translated`, `formatting`, `field-control`, `contrast`, …).

---

## 8. Live proof — al-nakheel, Terms Review (local 3001 / 4201, shared dev DB)

Sign in as al-nakheel's tenant admin by the page-side method; no password ever
appears in a tool call.

1. Workflows → Committee workflow → expand **Terms Review**. Expect the header
   line with its real deadline, and the empty state.
2. Add **D1**, mandatory: "Check terms against the template" — a unit you
   choose (Quality) → a position with a holder → nobody. It saves with no
   chip.
3. Add **D2**, optional — a position with **no holder**. Expect the dialog to
   stay open with the warning, and the chip on the row after closing.
4. Add **D3** — the record's committee → Secretary. Check its words.
5. Priority over the deadline: expect the inline sentence before saving and the
   same sentence from the 409. Nothing is saved.
6. Keyboard only: move D3 to the top and back. The order persists after a
   reload.
7. Stage form: lower the deadline below the longest task. Expect it refused
   inline, with nothing saved.
8. Task SLA settings: raise that priority past the deadline. Expect the stage
   named and linked, with nothing saved. Reload the screen to confirm the
   stored hours are unchanged (the screen has no reset; a refused save writes
   nothing).
9. Transition editor: open Terms Review's Approve. Expect Kind = Advance from
   the backfill. Open Add, check it shows Advance, then cancel.
10. Committee page: create a test committee and submit it into Terms Review.
    Press Approve and expect "Can't move yet" listing D1 as a link. Complete D1
    and approve: it moves. D2 and D3 are cancelled as optional (ACC-190's G).
11. Repeat steps 1–4 and 10 in **Arabic**, keyboard only.
12. **Clean up:**
    - delete D1–D3 (the tasks they created keep their snapshot);
    - name the committee left Active, as ACC-190's proof did;
    - restore any stage SLA or task SLA touched (none should have changed);
    - clear `.playwright-mcp/`.

The backend half runs locally against the shared DB. No migration and no enum
value is involved, so nothing new exists on the shared DB before the deploy.

---

## 9. Decisions for Ahmad

| # | Question | Recommendation |
|---|---|---|
| **Q1** | B4: may `workflows:manage` use the assignment pickers without `tasks:create`? It sees unit, position and holder names, which it already sees for POSITION_FIXED stage assignees. | **Yes**: one extra passing condition, no taskId. |
| **D2** | The drawing links open required tasks, but there is **no task page**. Where does a link go? | The committee page's own task list: `?task=<id>` scrolls to the row, focuses it and highlights it. The rows gain an anchor, and the fix-link helper already exists. |
| **D3** | Relative routes cannot be checked until a record enters. Show no chip, or a quiet "checked when a record enters" note? | A quiet note in the dialog only, with no chip on the row. |
| **D4** | Does the drawing cover a **final** stage? The backend refuses definitions there. | Show the sentence in §4.1 with no Add. |
| **D5** | The Add-transition dialog shows an "Approval path" checkbox that create never sends (the backend sets it only on edit). It is a silent drop in a dialog this ticket edits. | Hide it on Add, keep it on Edit. One line, its own commit. |
| **D6** | B5 changes a task endpoint for configuration's sake. The alternative is `LookupService` + `lookups:view`, as the stage form does now. | B5, so the cascade keeps one data source and one gate. |

---

## 10. Build order (each a commit)

1. Backend B1–B6 + specs.
2. Frontend DTOs + `workflow-refusal.ts` + i18n keys.
3. Picker `rolesCatalogue` / `committees` inputs + specs.
4. `stage-task-list` + `stage-task-route-label` + specs.
5. `stage-task-definition-form` (measure first, record numbers here) + specs.
6. Transition Kind (+ D5) + specs.
7. Stage form, task SLA, transition-actions refusals + specs.
8. Docs.
9. Live proof and cleanup.

## Progress

- [ ] 1 Backend B1–B6
- [ ] 2 DTOs, refusal map, i18n
- [ ] 3 Picker inputs
- [ ] 4 Tasks on entry list
- [ ] 5 Definition dialog (measurements recorded)
- [ ] 6 Transition Kind
- [ ] 7 Refusal states
- [ ] 8 Docs
- [ ] 9 Live proof, test definitions deleted
