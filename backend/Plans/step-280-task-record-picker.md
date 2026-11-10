# Step 280 — New task picks its record, and New task on Home

Linear: [ACC-280](https://linear.app/accreditme/issue/ACC-280). Branch:
`feature/ACC-280-task-record-picker`, from `dev` at `cc0268c`. Lane B, with lane A's files
listed in §6. **Plan only; no code yet.**

**Read for this plan:**

- ACC-280;
- `backend/Plans/step-279-home-app-shell.md`: Q7 (Home has no header actions until this ticket)
  and Q12 (this ticket replaces the typed record id everywhere and adds New task to Home);
- SYSTEM-REFERENCE §3.19 (task keys per record type, `GET /tasks/views`, `create.types`), §1.9
  and §3.21 (who may see a committee since ACC-281);
- the task form, the `/tasks` shell, the committee page, Home, `task-record-types.ts`,
  `task-visibility.ts`, `TaskService.createForViewer()`;
- the stage editor's server-searched pickers (ACC-271 PR 5a), the pattern this plan reuses.

---

## Decisions (Ahmad, 9 Nov)

These override the recommendations below where they differ.

1. **The `POST /tasks` gap (§0) is fixed first, in its own PR**: `fix/ACC-280-create-task-key`.
   `createForViewer()` always requires the type's create key, then the record check.
2. **A member holding `committees:create_tasks` but not `committees:view` may create tasks on
   their own committees** (Q2 "Yes"). `create.types` gains the member branch of §2.
3. **One create type: no type field; the label names the type.** The decision comes from the
   server's `create.types`, never from a frontend list (`SOURCE_TYPES` stops deciding it).
4. **Allowed on a type, but no record of it:** a message in the field and in the list. No extra
   read on every page.
5. **The committee page's own New task moves onto the shared dialog** (`TaskNewDialogComponent`,
   with a locked record). §6 is updated.
6. **Home reads `create.types` when Home opens**: `GET /tasks/views`, once on entry.
7. **Inactive and dissolved committees are left out of the picker, and `POST /tasks` refuses
   them too, by the same server rule**, so the list and create always agree. **Dissolution
   Pending stays in.** "Dissolved" must be recognised from the stage's flags or rules, never its
   name or key.

   **DECIDED (Ahmad, 10 Nov): option (b).** A committee counts as **dissolved** when its CURRENT
   stage carries the `DISSOLVING` flag AND is a final stage (`isFinal`). **Inactive committees**
   (`Committee.isActive = false`) are left out too.
   - **One server helper, used by both the picker and `POST /tasks`:** a per-type entry in the
     task registry (`TASK_RECORD_TYPES`, `task-record-types.ts`), e.g. `acceptsTasksSql`, the one
     SQL condition "this record takes new tasks".
     - **For COMMITTEE:** `isActive`, and NOT (the newest instance's current stage has
       `DISSOLVING` in `flags` AND `isFinal`).
     - **The picker** puts it in its `WHERE`.
     - **`POST /tasks`** asks it of the one record, after the key and the record check. That is
       one indexed `EXISTS` query, inside the create request only.
     - So the list and create cannot disagree.
   - **Never a stage name or key.** A tenant that renames Dissolved, or adds its own final
     dissolving stage, is read by its flags and rules alone.
   - **Dissolution Pending stays in:** `DISSOLVING`, but not final.
   - **The refusal, proposed:** 409 with a code, `TASK_RECORD_CLOSED` ("This committee is
     dissolved or inactive, so it takes no new tasks."), said from the code on screen. A record
     the caller may not see keeps its 403/404, which the record check gives first.

   What the code held before the choice (9 Nov), kept for the reasoning:

   | | Dissolution Pending | Dissolved |
   | -- | -- | -- |
   | Flags (`WorkflowStage.flags`) | `DISSOLVING` | `DISSOLVING`: **the same** |
   | Final stage (`isFinal`) | no | yes |
   | Record actions allowed | add / remove / change seat | none |
   | `Committee.isActive`, `dissolvedAt` | unchanged | **unchanged**: nothing writes either when a committee reaches Dissolved |

   So only stage RULES differ (final, and allows nothing). Each is tenant-editable and means
   something else elsewhere: "final" is also a Rejected or Withdrawn stage, and "allows nothing"
   is a configuration choice. The options that were offered (Ahmad chose (b)):
   - (a) a new stage flag, e.g. `DISSOLVED` (or `CLOSED`), seeded on Dissolved and backfilled;
   - (b) `DISSOLVING` AND `isFinal`;
   - (c) Dissolved also sets `Committee.isActive = false` (and `dissolvedAt`), so "inactive" covers
     it. That needs an app move or a module write on the transition, plus a backfill for
     committees already Dissolved.


---

## 0. First: a gap ACC-281 opened in `POST /tasks` (decide before this ticket)

**Today a committee member may create a task on their own committee with no task key at all.**

- **Where:** `TaskService.createForViewer()` (`backend/src/foundation/task/task.service.ts:213-218`):

  ```ts
  if (seesRecordType(viewer.permissions, dto.sourceType) && !holdsTaskKey(…, 'CREATE')) throw 403;
  await this.objectVisibility.assertCanView(dto.sourceType, dto.sourceId, org, viewer.permissions, viewer.id);
  ```

- **The gap:** the key is checked only when the caller holds the type's VIEW permission
  (`committees:view`). Then the record check runs with the viewer's id:
  - **before ACC-281,** a caller without `committees:view` was refused there (403), so the
    missing key check never mattered;
  - **since ACC-281,** an active member is admitted by the member clause, so a member holding
    **neither** `committees:view` **nor** `committees:create_tasks` gets past both checks.
    `POST /tasks` with their committee's id succeeds.
- **What limits it:** no screen offers it. The record panel's `canCreate` and `/tasks`'
  `create.types` both need `committees:view` plus the key. It is reachable only through the API.
  Still, it is a write nobody granted.
- **Recommended (Q1 "Hotfix"):** a separate, small, High fix before this ticket. The key is
  checked whenever the type has one (`taskKeyOf(type, 'CREATE')`), whatever the caller's view
  permission, with today's 403 "Required permission: committees:create_tasks". Plus a db-spec:
  a member without the key is refused; with the key and the membership, created.

The rest of this plan assumes that fix, and §2 needs Q2.

---

## 1. Today: where the form opens without a record

**The form:** `TaskFormComponent` (`frontend/src/app/foundation/tasks/components/task-form/task-form.component.ts`).

- **The record inputs:** `lockedSourceType` / `lockedSourceId` / `lockedSourceLabel`.
  - **With them set,** step 2 shows "Source: \<record\>" read-only, with the "This task belongs to
    the record you opened it from" hint.
  - **Without them,** step 2 shows two fields side by side (`task-form.component.ts:281-295`):
    - **Record type:** an `app-overlay-select` over `SOURCE_TYPES`, filtered by
      `allowedSourceTypes` (`GET /tasks/views` → `create.types`). Only COMMITTEE has a task
      registry entry today, so it offers one type.
    - **"Source ID":** a plain `<input pInputText>`, **typed by hand.** Nobody knows a record's
      id, so this field is the defect.
  - **The defaults:** `sourceType` starts at `'DOCUMENT'` (line 935), then is moved to the first
    allowed type (line 996).

**Every place the form is opened:**

| Where | Record | Today |
| -- | -- | -- |
| `/tasks`, `TasksShellComponent` "New task" (`tasks-shell.component.ts:76-77, 156-183`) | **none** | the type and a **typed id**, `allowedSourceTypes = create.types` |
| A committee's Tasks panel → New task (`committee-detail.component.ts:433`) | locked to the committee | read-only "Source" |
| Edit (`task-edit-dialog`, from the task page and the row menu) | the task's own | not shown; the record never changes |
| Home | — | **no button** (ACC-279 Q7) |

**So `/tasks` is the only place a person types an id today; Home will be the second place
without a record.** The dialog shell for `/tasks` (the form, `task-form-steps`,
`task-form-footer` and `app-edit-dialog`) is assembled inline in `tasks-shell.component.ts`,
so Home cannot share it without a copy (§5).

---

## 2. The picker's data: which records it offers

**The rule.** A record is offered when the person may **see** it AND may **create tasks** on it:

- **See (ACC-281):** `committees:view`, or an active member of that active committee.
- **Create (ACC-244):** the type's CREATE key (`committees:create_tasks`).
- **Q2:** may a member who holds `committees:create_tasks` but not `committees:view` create
  tasks on their own committees?
  - **"Yes" (recommended):** it is ACC-281's interim write rule, "the action's own permission
    AND (`committees:view` OR a member of THAT committee)", applied to a task.
  - **"No":** keep today's `create.types`, which needs `committees:view`.

  **With "Yes":** `create.types` names COMMITTEE for such a member, and the picker lists only
  their own committees. `typesHolding(…, 'CREATE')` gains a member branch: one membership query,
  only for a caller holding the key without the view, inside `GET /tasks/views` (never on the
  per-request path).

**No existing read gives this:**

- **`GET /committees`:** it applies ACC-281's see rule but not the create key. It is not paged,
  carries the whole list row (stage rules, counts), and is committee-only.
- **`GET /workflow-templates/who-options/committees`:** it is paged and searched, but gated on
  `workflows:manage`.
- **`GET /committees/mine`:** five rows, the person's own memberships only.

**New endpoint: `GET /tasks/record-choices?type=&q=&skip=&take=`** (`TaskController`, before
`:id`; no `@Permissions`, the service decides, as `GET /tasks/views` does).

- **`type` must be in the caller's `create.types`.** Otherwise the answer is `{ total: 0,
  items: [] }`: a type you may not create on has no choices. That is existence-neutral, and
  nothing is read.
- **Which rows:**
  - with the type's view permission and its key, every active record of the type in the
    organisation;
  - with the key and membership only (Q2 "Yes"), the active records the caller is an active
    member of. That is one join on `CommitteeMember`, in the same query.
- **Search:** `q`, trimmed, case-insensitive `contains` on `nameEn` OR `nameAr`.
- **Order:** by the name in the reader's language, then `id`, so pages never repeat or skip.
  This is the who-options shape.
- **Paging and cap (the performance rule):** `take` from 1 to 50 (default 20), `skip` ≥ 0, and
  a 400 outside that. **At most two queries** (rows and a count, in `Promise.all`). No query per
  row.
- **Answer:** `{ total, items: [{ id, nameEn, nameAr }] }`. No other field; the dialog needs a
  name.
- **Isolation:** every `where` names `organizationId`, including the membership join. Another
  organisation's records never appear, pinned by a spec named for the gate (§7).

---

## 3. The control

**Never a typed id.** The pattern is the stage editor's (ACC-271 PR 5a): the field shows the
chosen value, and a search button opens a server-searched list **as its own layer** (ACC-111
case 2), so the dialog body keeps its height.

- **Record type:**
  - **One allowed type (COMMITTEE today):** no type select. The record field's label names it
    ("Committee *").
  - **Several types:** today's `app-overlay-select` stays, and changing it clears the chosen
    record. See **Q3**.
- **Record (`am-field`, required):**
  - **Before a choice:** a read-only line "Choose a committee", with a search button ("Find a
    committee").
  - **After a choice:** the record's name in the reader's language (`LanguageService.bilingual`),
    cut to one line with an ellipsis and its whole name in a tooltip, plus the same button to
    change it.
  - **The button** opens `am-list-dialog size="compact"` (720 × 560; a full-screen sheet below
    760 px) with `am-simple-list`: search, the live count, Load more by 50. It reads
    `GET /tasks/record-choices`.
  - **Picking a row** fills the field and closes the list. Escape closes only the list (the
    LayerStack rule).
- **Never `OverlaySelectComponent` for the record.** It has no search box (typeahead only,
  SYSTEM-REFERENCE §10.7), and a list that can grow pages on the server.

**Measured today** (`task-form.draft.layout.spec.ts`, real fonts, dialog body, step 2, record
not locked):

| State | English | Arabic |
| -- | -- | -- |
| idle | 279 px | 290 px |
| refusal with Try again (the tallest with the record row shown) | 365 px | 382 px |
| a draft suggestion (ACC-197 hides the record row while it shows) | 377 px | 410 px |

**The new row takes the place of today's type-and-id row**, at the same height (label, one
control row, the message slot), so the expected bodies are unchanged. **Arabic has 38 px of
room** under the 420 cap at its tallest.

The build adds layout cases to that spec, each asserting ≤ 420 with ACC-120's non-vacuity guard
first, in both languages:
- a chosen record with the longest seeded name;
- the "Choose a committee" error showing;
- one and several types.

**When the person may create on no record:**

- **No create type at all:** New task is hidden, on `/tasks` and Home, as today.
- **A create type but no record** (e.g. the key and no committee): the field reads "No
  committees you can add tasks to.", and the list dialog says the same.
  - Create shows "Choose a committee" under the field. Save is never disabled for an invalid
    form (Design System rule 5.2).
  - **Q4:** hide New task instead in that case? That would cost a records read on every page
    with the button.

---

## 4. A new record type is one registry line

**Backend:** `TASK_RECORD_TYPES` (`task-record-types.ts`) is already the per-type registry (the
four keys, the owning-unit SQL, the record-exists SQL). The picker's source joins it as one more
field, `choices`:

```ts
COMMITTEE: {
  keys: { … },
  ownerUnitSql: …,
  recordInOrgSql: …,
  // ACC-280 — what the record picker lists, and the member scope (§2).
  choices: { table: 'Committee', active: Prisma.sql`r."isActive"`, memberOf: Prisma.sql`…CommitteeMember…` },
},
```

`GET /tasks/record-choices` builds its query from that entry. A type without `choices` has no
choices (fail closed), and the frontend picker is generic in its type. **Adding Meetings or
Documents is that one entry**, plus its visibility rule (ObjectVisibilityService already has
MEETING), plus its two words in en/ar (§3 labels per type, because Arabic needs a noun of its own
gender, not "a {type}").

**Frontend:** no per-type component. `SOURCE_TYPES` keeps filtering by `create.types`, so a type
appears in the form the day the server names it.

---

## 5. Home's New task button, and ONE dialog

**One dialog.** Lane A extracts `TaskNewDialogComponent` (`tasks/components/task-new-dialog/`).
It holds what `tasks-shell` assembles inline today:
- `app-edit-dialog`, the form, `task-form-steps` and `task-form-footer`;
- the dirty and close handling.

**Its inputs and outputs:**
- inputs: `visible`, `createTypes`, and an optional `locked` record;
- outputs: `visibleChange`, `created`.

`tasks-shell` uses it in place of its inline copy, and Home uses the same component. **Not a
copy:** the inline markup is deleted from `tasks-shell`. Moving the committee page's own New
task (locked) onto it too is **Q5**.

**When Home shows it: exactly when `/tasks`' My tasks shows it,** that is `create.types.length >
0` from `GET /tasks/views`.
- **The read:** Home reads `GET /tasks/views` once on entry, through `TaskService.getViews()`,
  with no poll. That is one request, a few queries (the visibility context), not on the
  per-request path.
- **Failure:** if the read fails, the button is absent. Nothing is offered that the server might
  refuse.
- **Q6:** read it through `MyWorkCountsService` (loaded at sign-in), or on Home's entry only.

**Where:** Home's page header, in the `pageActions` slot, at the end (the right in English, the
left in Arabic):
- the same `p-button` as `/tasks`: "New task", `pi pi-plus`, primary;
- it wraps under the greeting on a phone, as `app-page-header` already does.

This reverses ACC-279 Q7's "no header actions" for this one button, as Q12 planned.

**After a task is created on Home:** `TaskService.create()` gains `tap(() => myWork.changed())`,
as complete and reject have, so Home's counts refresh. Today it is the only task write that does
not.

---

## 6. Lane A's files (`frontend/src/app/foundation/tasks/**`), to agree first

| File | Change |
| -- | -- |
| `components/task-form/task-form.component.ts` | the typed `sourceId` input becomes the record picker (§3); the type field shows only when the server's `create.types` names more than one type, and otherwise the label names the type (decision 3); `SOURCE_TYPES` stops deciding which types appear; the `'DOCUMENT'` default goes |
| `components/task-record-picker/task-record-picker.component.ts` (**new**) | the field, its search button and the list dialog (`am-list-dialog` + `am-simple-list`), generic in its type; the "no records" message in the field and the list (decision 4) |
| `components/task-record-picker/task-record-picker.component.spec.ts` (**new**) | §7 |
| `components/task-new-dialog/task-new-dialog.component.ts` (**new**) | the one New task dialog (§5), for `/tasks`, Home AND the committee page: a `locked` record input (type, id, label) for the committee page (decision 5) |
| `components/task-new-dialog/task-new-dialog.component.spec.ts` (**new**) | §7, including the locked case |
| `components/tasks-shell/tasks-shell.component.ts` | uses `TaskNewDialogComponent`; the inline dialog is deleted |
| `components/tasks-shell/tasks-shell.component.spec.ts` | follows |
| `components/task-form/task-form.component.spec.ts` | the typed-id cases (lines 251, 420-447) become picker cases |
| `components/task-form/task-form.draft.spec.ts` | follows the picker (the draft reads the chosen record) |
| `components/task-form/task-form.draft.layout.spec.ts` | the new measured cases (§3) |
| `components/task-form/task-draft.store.ts` | none expected; it already takes `sourceType` / `sourceId` |
| `services/task.service.ts` | `getRecordChoices()`; `create()` signals `myWork.changed()` |

**Lane B's own files:**
- the backend: `task-record-types.ts`, `task-visibility.ts`, `task.controller.ts`, a new
  `task-record-choices.service.ts`, a DTO, and specs;
- `foundation/home/home.component.ts` and its specs;
- `committees/components/committee-detail/committee-detail.component.ts`: its inline New task
  dialog (form, steps, footer, `app-edit-dialog`) is replaced by `TaskNewDialogComponent` with
  the committee locked (decision 5); and the committee-detail specs that open New task;
- `en.json` / `ar.json`, SYSTEM-REFERENCE §3.19 and §10.24, and CLAUDE.md.

---

## 7. Specs

**Backend:**

- **`task-record-choices.service.spec.ts`:**
  - a type not in `create.types` → empty, nothing read;
  - a view and key holder → every active committee;
  - a member with the key (Q2) → only their own;
  - a former member → none;
  - an inactive committee → never;
  - `q` searches both names;
  - `take` 0 / 51 / 1.5 → 400;
  - two queries for any page.
  - **`itEnforcesTenantIsolation('task record choices')`:** every `where` names the organisation.
- **`task-record-choices.db-spec.ts`** (real Postgres on 55432):
  - the same callers on real rows;
  - another organisation's committee with a matching name never appears;
  - the paging order is stable for equal names (pages 1 + 2 = the whole list).
- **The hotfix (§0):** a member without the key gets 403 on `POST /tasks`; with it and the
  membership, created; a non-member with the key gets the parent's refusal.
- **`task-visibility.spec.ts`:** `create.types` for a member holding the key (Q2), with one
  membership query only in that case.

**Frontend:**

- **`task-record-picker`:**
  - opens the list over the dialog, searches on the server, Load more;
  - picking fills and closes;
  - Escape closes only the list;
  - the empty and failed states;
  - the name in Arabic falls back to English (ACC-160);
  - no input ever accepts typed text as an id.
- **`task-new-dialog`:** one component for `/tasks` and Home; the payload carries the picked
  record.
- **`home.component.spec`:** New task shows exactly when `create.types` is non-empty, opens the
  shared dialog, is absent when the views read fails, and the counts reload after a create.
- **Layout:** the new measured cases (§3), ≤ 420 in both languages, with non-vacuity guards.
- **Mutation-checked:**
  - offer a type outside `create.types`;
  - drop the membership scope;
  - drop the organisation from the choices query;
  - show Home's button without `create.types`.

---

## 8. Questions for Ahmad (one word each; the recommendation is marked)

1. **The `POST /tasks` gap (§0).** **Hotfix** (recommended: a separate small High fix first) /
   Here (inside this ticket) / Accept.
2. **A member with `committees:create_tasks` but not `committees:view` creates tasks on their own
   committees.** **Yes** (recommended: ACC-281's write rule) / No.
3. **The record type field when only one type exists (COMMITTEE today).** **Hide** (recommended:
   the label names the type) / Show.
4. **The person may create on a type but has no record of it.** **Message** (recommended: the
   field and list say so; no extra read) / Hide (no New task; costs a read on every page).
5. **The committee page's own New task (locked) moves onto the shared dialog too.** **Yes**
   (recommended: one dialog everywhere) / No (`/tasks` and Home only).
6. **Where Home reads `create.types`.** **Entry** (recommended: on Home's entry only, one
   request) / Counts (with the work counts at sign-in).
7. **Inactive (dissolved) committees in the picker.** **Exclude** (recommended) / Include.

---

## 9. Progress

- [x] Plan (this file), committed, not pushed
- [x] Ahmad's answers to §8 (9 Nov, "Decisions" above)
- [ ] Lane A agrees §6
- [ ] The §0 fix, its own PR: `fix/ACC-280-create-task-key`
- [x] Decision 7: (b), DISSOLVING and a final stage, plus inactive (Ahmad, 10 Nov)
- [ ] Backend: `create.types` (Q2), `GET /tasks/record-choices`, the registry entry, specs
- [ ] Frontend: the record picker, the shared New task dialog, Home's button, specs
- [ ] Docs: SYSTEM-REFERENCE §3.19 and §10.24; CLAUDE.md Key Architecture Decisions (ACC-280)
