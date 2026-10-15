# Step 228 — The task page, the record Tasks panel, and capped record panels (ACC-228, ACC-229, ACC-230)

**Status: APPROVED 14 Oct (Ahmad), with the recommended answers to Q1–Q13 except Q5 (§4). PR 1 is being built; PRs 2 and 3 wait until PR 1 is merged and proven live.**

Lane B. Three PRs, in this order, one plan:

| PR | Ticket | What | Branch |
|---|---|---|---|
| 1 | ACC-228 | The task page at `/tasks/:id`; every place that opens a task reaches it; attachments open in the viewer; the workload-hint AI log summary drops the chosen person's user id | `feature/ACC-228-task-page` (this branch) |
| 2 | ACC-229 | The shared record Tasks panel (5 rows, fixed height) and the "All tasks" popup | `feature/ACC-229-record-tasks-panel` |
| 3 | ACC-230 | Members and Sub-committees panels capped at 5, with a plain search popup | `feature/ACC-230-capped-record-panels` |

**Drawings**
- `frontend/design-reference/AccreditMe Task Screens.dc.html` §1 — the task page. The working copy differs from the committed file only in line endings (verified with `git diff --ignore-cr-at-eol`), so there is nothing to commit for it.
- `frontend/design-reference/AccreditMe Record Tasks Panel.dc.html` — new, untracked (copied in by Ahmad). It is committed on this branch as its own commit, unedited.

**Drawn defaults built as drawn (Ahmad):** 5 rows; the popup is the only full view; the popup does not remember filters; no own-tasks-first ordering; on hold ranks after open; Members and Sub-committees capped too.

---

## 0. What exists today (measured, 14 Oct, on `44a68dd`)

These facts shape all three PRs. Each was read in the code, not assumed.

**Opening a task**

1. **There is no task page.** Nothing links to a single task by address.
   - Frontend `TaskService.getById()` (`frontend/src/app/foundation/tasks/services/task.service.ts:529`) has no caller.
   - The places that point at a task today:
     - The committee page's `?task=<id>`, which highlights a row (`committee-detail.component.ts:812-855`).
     - `CantMoveDialogComponent`'s links, which use that same query parameter.
     - The Home briefing, which links to `/tasks?task=` and `/tasks?request=` (`home-briefing.component.ts:281-287`).
     - My tasks, which reads both parameters and highlights the row (`my-tasks.component.ts:557-598`).
     - The Setup health Fix, which goes to `/tasks/unassigned?reassign=<id>`.
   - Task titles are plain text everywhere: My tasks, the committee panel, Unassigned and `/tasks/all`.
   - **The notification bell navigates nowhere.** A click only marks the item read (`notification-bell.component.ts:122-130`), although every task notification carries `objectType: 'Task' | 'TaskRequest'` and `objectId`.
   - No email links to a task: task notifications are in-app only.
2. **`GET /tasks/:id` needs `tasks:view`** (`task.controller.ts:328-338`), which `BASE_USER` lacks. So an ordinary assignee cannot read their own task through it.
   - It returns the raw Prisma row: no names, no open request, no `canManage`, and removed assignees are included.
3. **Evidence uses a different, broader rule** (`task-evidence.service.ts:261-278`). It allows:
   - anyone ever on the task;
   - `mayManage`;
   - or anyone who can see the source record — **with no `tasks:view` required**.

   This differs from `GET /tasks/:id`. See Q5.
4. **No task history endpoint exists.** Audit rows exist:
   - `objectType 'Task'`, keyed by the task id;
   - `'TaskRequest'`, keyed by the request id, with `metadata.taskId`;
   - `'TaskEvidence'`, keyed by the evidence id, with the task id on add.

   `AuditLog` is indexed on `(objectType, objectId)`.
5. **The in-app viewer** is `FileViewerService.open()` (`shared/files/viewer/`). Its one caller is `TaskEvidenceListComponent`, whose file name and eye icon already open the viewer; a separate icon downloads.
   - Link evidence opens in a new tab.
   - Record-reference evidence is plain text.
   - The list is hosted only by the evidence dialog, and its header comment says it was built to be hosted unchanged by "the future task page".

**The committee record page**

6. **The panels.** All six panels use `RecordPanelComponent`, whose body has a **min-height (214) and no max**, so each panel grows with every row.
   - **Members:** inline Change role and Remove icons.
   - **Tasks:**
     - Shown only with `tasks:view`.
     - Rows in server order, `createdAt desc`. The client does not sort.
     - Seven inline icons: Reassign, Edit, Cancel, Reopen, Add evidence, View evidence, Complete.
     - **No** Start, Reject, Release, Pick up, request or decide action. Those exist only in My tasks.
   - **Sub-committees:** no header action.
7. **Today a committee viewer without `tasks:view` sees no Tasks panel at all.** There is no own-tasks variant. See Q1.
8. **Data loading.**
   - `GET /tasks?sourceType&sourceId` returns **every** task, unpaged.
   - `GET /committees/:id/members` returns a bare unpaged array, ordered by `joinedAt asc`.
   - **Sub-committees have no endpoint.** The page filters all of `GET /committees` in the browser (`committee-detail.component.ts:801`).
9. **Meetings and Standards have no page and no module.** See Q2.
   - The committee page's Meetings panel is a hard-coded empty placeholder.
   - `Meeting` and `AgendaItem` are a dormant schema.
   - There is no Standards model.
   - The visibility registry knows only COMMITTEE (`committees:view`) and MEETING (`meetings:view`).
10. **Shared building blocks.**
    - `EditDialogComponent` has sizes `confirm` / `form` / `picker` only, with a 420 body cap. **There is no list size.**
    - The only "⋯" menus are PrimeNG `p-menu [popup]` (Roles, Users), which `my-tasks.component.ts:77-82` already rejects inside scrolling lists. **There is no CDK row menu.**
    - `DataListComponent`'s `panel` variant has no consumer.
    - **No "See all" translation key exists.**

**The AI log summary**

11. The workload-hint AI log summary (`workload-hint.service.ts:94`) is:

    `workload hint · {type} {recordId} · {COMMITTEE_ROLE|POSITION} · {n} eligible · chosen {userId}`

    It holds one count, "n eligible", not per-person counts. See Q3.

---

## 1. PR 1 — the task page (ACC-228)

### 1.1 What the user sees

`/tasks/:id`, drawn as Task Screens §1: a small record page, template 2. It scrolls as the document, with no tabs and no panel grid.

- **Breadcrumb.** The task's record as ancestry, as drawn ("Committees / Infection Prevention & Control"). When the viewer cannot see the record, "My tasks". The breadcrumb stops at the parent (ACC-79), so the drawn trailing "Tasks" crumb is not rendered (Q11).
- **Header.**
  - The kicker "Task", then the title as the H1. The tab title reads the H1.
  - **Status**, worded and with its dot. **Overdue** as the flag pill beside the status, in words, never colour alone. An on-hold task is never flagged.
  - **Priority** with its glyph.
  - **Due** as date-time, in the tenant's zone, through `amDateTime`. The zone offset is an isolated LTR run.
  - Its **provenance** where it applies: "moved from 8 Oct · more time approved 3 Oct", or "moved by hold".
- **Action group** at the inline end.
  - The one primary next-step button, then secondaries, then "⋯" for the rest. The same per-viewer rule as the panel row (§2.4), with page-sized buttons.
  - Rendered only after the task loads, because it depends on the viewer's relationship to the task.
  - It reuses today's dialogs unchanged: request, decision, reassign, edit, cancel, reopen, reject, release, add evidence, and the Complete confirm.
- **Four relation cells.**
  - **About:** the record, linked when the viewer may open it, with its type and the stage for workflow records.
  - **With:** the assignee(s), or "Waiting for {position}, {unit} · n can pick up", or Unassigned; plus "picked up from pool {date}" when it applies.
  - **Created by:** the creator, with "by hand" or "by the workflow when the record entered {stage}".
  - **Evidence:** "Required · n added", "Required · none yet" in warning ink, or "Not required · n added"; and whether Complete is available.
- **Left column.**
  - **Description.**
  - **Evidence:** `TaskEvidenceListComponent` hosted unchanged. **Every attachment opens in the in-app viewer** (§1.4). Add evidence appears for an active assignee while the task is open.
- **Right column.**
  - **Open request**, only when one is open. It shows the asked change, what approval does, who asked and when, who decides, and the reason. Its actions:
    - the decider: Approve and Decline…, using today's decision dialog;
    - the asker: Withdraw request;
    - everyone else: none.
  - **Rejected, Cancelled or Reopened**, each with its reason, where it applies.
  - **History:** oldest first, every event with its actor and time.

**Outcomes**, as drawn in §1:

| State | What shows |
|---|---|
| Loading | A header skeleton at the final heights |
| Denied | The identical not-found page (Q4) |
| Error | A whole-page error with Retry and the error id |
| History fails | History has its own request; it shows Retry and the page stands |
| Empty panels | Evidence says "None yet" |

### 1.2 Endpoints

| Endpoint | Purpose | Rule |
|---|---|---|
| `GET /tasks/:id/view` **(new)** | The page's view model: the task, names, record label and link, pool label, assignees (active and past, marked), creator, open request, rejected, cancelled and reopened fields, `evidence: {required, count}`, and **`actions`** (§2.4) | The task-page rule (Q4); otherwise the identical 404 |
| `GET /tasks/:id/history` **(new)** | `{ when, actorName, event, detail }[]`, oldest first | Same rule |
| `GET /tasks/:id/evidence` (exists) | The evidence list | Its own rule, unchanged (Q5) |
| `GET /tasks/:id` (exists) | Unchanged; nothing in the frontend calls it today | `tasks:view` + parent, unchanged |

- **No `@Permissions` on the two new routes.** Like every task action endpoint, they are relationship-scoped in the service, and checked before any read of the payload.
- **The task-page rule (Q4)** is the union of what the app already exposes today, with nothing new:
  - (a) the viewer is or was on the task (any `TaskAssignee` row);
  - (b) `mayManage` — the creator, anyone acting for them, or `tasks:reassign` while the creator is inactive;
  - (c) a pool member of an open, unpicked pool task — today's Available list;
  - (d) a decider of its open request — `tasks:reassign` or `canActForCreator`, today's "Waiting for your decision";
  - (e) `tasks:view` **and** the source record is viewable — today's `GET /tasks/:id`.

  Anyone else gets the identical 404, and the refusal is logged (ACC-101 clause b).
- **Route ordering.** `:id/view` and `:id/history` are declared after the literal routes (`available`, `my-tasks`, ...), as today.
- **Organisation scope.** Every query uses `where: { id, organizationId }`.
- **History query.** Three bounded reads:
  1. the task's audit rows: `objectType 'Task'`, `objectId = id`;
  2. its `TaskRequest` rows, then their audit rows: `objectType 'TaskRequest'`, `objectId IN (...)`;
  3. its `TaskEvidence` rows (soft-deleted included), then their audit rows.

  All three use the existing `(objectType, objectId)` index. Events are worded in the frontend from `action` plus `metadata.event`, never from stored English. An event the page does not know renders "Changed" with its time and actor, never the raw code.
- **Isolation tests.** Each new query gets a test named `should NOT return records belonging to a different tenant`.

### 1.3 Every place that opens a task reaches the page

| Place | Today | After PR 1 |
|---|---|---|
| Committee Tasks panel row title | Plain text | Link to `/tasks/:id` (PR 2 rebuilds the row; PR 1 links today's title) |
| My tasks: My tasks / Available / Awaiting rows | Plain text | Title links to `/tasks/:id` |
| `/tasks/unassigned`, `/tasks/all` rows | Plain text | Title links to `/tasks/:id` |
| Home briefing task item | `/tasks?task=` (My tasks, highlighted) | `/tasks/:id` (Q8) |
| Home briefing request item | `/tasks?request=` | `/tasks/:id` — the Open request panel is where the decision is made |
| Notification bell, `objectType` Task or TaskRequest | Marks read, no navigation | Marks read and opens `/tasks/:id` (the request's task) — Q9 |
| CantMoveDialog task links | Record `?task=` highlight | Unchanged: it is about the record's step, so the row on the record stays the target (decided in ACC-208, D2); the row's title then links to the page |
| Setup health Fix (TASK_WITHOUT_OWNER) | `/tasks/unassigned?reassign=` | Unchanged: the Fix is "reassign it", which that screen does |

- `?task=` and `?request=` keep working on My tasks and on the committee page, so old links in the bell and in stored briefings still land somewhere.
- **Briefings.** Saved briefings store items with a target, not a URL (`briefing-groups.ts`). The link is built in `home-briefing.component.ts`, so the change reaches today's saved briefings too.

### 1.4 Every attachment opens in the in-app viewer

- **On the page.** `TaskEvidenceListComponent` is hosted on the page unchanged, so ATTACHMENT evidence opens `FileViewerService.open()` exactly as in the evidence dialog: name click or eye icon, with Summarize where AI is available.
- **Download stays** as its own labelled icon. The page adds no second route to the file.
- **Not attachments.** Link evidence keeps opening in a new tab, and record references stay text. Neither is an attachment.
- **Spec.** It pins that a file row's name is a button that calls `FileViewerService.open` with that evidence, not a download link.

### 1.5 The workload-hint AI log summary (Q3)

- **Before:** `workload hint · COMMITTEE {recordId} · COMMITTEE_ROLE · 1 eligible · chosen {userId}`
- **After (recommended):** `workload hint · COMMITTEE {recordId} · COMMITTEE_ROLE · 1 eligible · chosen 5 open, 0 overdue`

The chosen person's user id goes. The record id and the eligible count stay, and the chosen person's own counts are added: numbers only, which the model already receives under a label.

- **Spec.** `workload-hint.service.spec.ts:152` changes, plus a spec asserting no candidate's user id appears in `description`.
- **Rows already written** keep their old text. AI log rows are append-only in spirit, and they are the company's own log, not a tenant export.

### 1.6 Routes, guard and navigation

- **Route.** `tasks/:id` is a child in `tasks.routes.ts`, declared **after** `all` and `unassigned`.
- **Guard.** It carries its own `canActivate` (CLAUDE.md, ACC-79). It is a route any signed-in user may open: the server decides, and a refused id renders the not-found page. So it carries **no permission entry**, which is correct for a page whose entitlement is a relationship. A spec pins the guard choice.
- **Rail.** My tasks stays the highlighted item. Its exact-match rule (`sidebar.component.ts:360`) is widened to `/tasks/:id`.

### 1.7 Translations (English and Arabic, both files)

New keys under `taskPage.*`:
- `kicker`, `about`, `with`, `createdBy`, `evidence`, `description`, `openRequest`, `history`
- `evidenceRequiredCount` (a plural object), `evidenceNone`, `completeAvailable`, `completeNeedsEvidence`
- `byHand`, `byWorkflow`, `pickedUpOn`, `waitingForPool`
- `movedFrom`, `moreTimeApproved`, `movedByHold`
- `historyRetry`, `notFound.title`, `notFound.body`, `error.title`
- `history.event.*` — one per audit event: created, assigned, picked, released, started, completed, rejected, reassigned, delegated, cancelled, reopened, request made / withdrawn / approved / declined, hold resumed, evidence added / removed, edited

Count strings go in the `plural` section, with all six Arabic categories (ACC-94).

### 1.8 Heights

A page, not a dialog, so there is no 420 cap. The drawn figures that a layout spec asserts in both languages:
- Title line 28/34 English, 29/40 Arabic.
- The relation strip: four cells at ≥ 220 px wide, wrapping below 880.
- The two columns: ≥ 420 px each, stacking below 852.

**Measured at merge, not before:**
- the header block height at 1280 and at 390 width, in both languages;
- that the page has no horizontal scroll at 390 (ACC-206 is the known Arabic phone-width defect; this page must not add to it).

### 1.9 Accessibility

- **Structure.** One H1, with each panel heading an H2. The relation cells are a `dl`.
- **Status and overdue** are words, with the flag a text pill, never colour alone.
- **The disabled Complete** carries "Add evidence first" in its tooltip and its accessible description (`aria-describedby`).
- **"⋯"** has the accessible name "More actions for {title}", and its menu items are words.
- **Focus.** After loading, focus goes to the H1. After an action, focus returns to the button that opened its dialog.
- **History** is an ordered list with `time` elements.
- **Arabic.** Dates, times and the offset are isolated LTR runs.

### 1.10 Tests (PR 1)

- **Backend**
  - The rule's five grants, each alone, and a stranger getting the identical 404 (status and body equal to a missing id).
  - Another tenant's task: 404, with a test named for the isolation gate.
  - History: ordering; events from requests and evidence included; another task's rows excluded; another tenant's rows excluded (isolation-named).
  - `actions` (§2.4) contract tests, shared with PR 2.
  - The AI log description.
- **Frontend**
  - The page's six outcomes.
  - Each viewer's action group: assignee, pool member, creator, decider, reader.
  - A file row opens the viewer.
  - The title link in My tasks, Unassigned, All and the committee panel.
  - The bell opens the task for Task and TaskRequest, and does nothing new for other types.
  - The briefing builds `/tasks/:id`.
  - The route is declared after `all` and `unassigned` (a spec reads the config).
- **Live, after deploy.** On al-nakheel with seeded personas: the assignee without `tasks:view` opens their task; a committee reader with `tasks:view` opens one; a stranger gets not-found; an attachment opens in the viewer. Both languages.

### 1.11 Migration

**None.** Two read endpoints, a frontend page, link changes and one log string.

---

## 2. PR 2 — the record Tasks panel and the All tasks popup (ACC-229)

### 2.1 What the user sees — the panel

One shared component, `am-record-tasks-panel`. Its inputs are exactly the drawing's:
- the record (`sourceType`, `sourceId`);
- its title for the popup;
- the header action (New task, or Request evidence);
- the panel title key (Tasks, or Action items);
- an optional source line ("From item n").

**First and only consumer in this PR: the committee record page** (Q2).

- **Header.** Title, the **total** count (every task the viewer can see on the record, never the 5 shown), and New task when `tasks:create`. Nothing else: search, sort and scope live in the popup.
- **Body.** Exactly 5 row slots, at a fixed **294 px English / 328 px Arabic**, including the footer. It never grows and never scrolls. With fewer rows it keeps its height, and the space below is quiet.
- **Order.**
  1. Open tasks (Assigned, In progress, waiting to be picked up, Unassigned, Rejected), overdue first — the most overdue first — then soonest due; no due date last.
  2. Then On hold.
  3. If fewer than 5 are open or on hold, the most recently closed (Completed or Cancelled) fill the rest.

  One order for everyone, with no own-tasks-first.
- **Row** (two lines, fixed height 52 English / 58 Arabic).
  - Line 1: the title as a link to `/tasks/:id` (PR 1), the Required or Optional tag (stage tasks only), then at the inline end the one next-step button and "⋯".
  - Line 2: the due label first — "⚠ 4 days overdue · 8 Oct", "Due tomorrow · 15 Oct", "⏸ On hold to 20 Oct · due 27 Oct", "✓ Completed 2 Oct", "Cancelled 1 Oct" — then "· {assignee or pool} · {status}", plus one changing fact (request, pick-up, rejection), plus "From item n" when given. **Only the tail ellipsises**, so the due label is never cut.
- **Footer.** "Showing 5 of 16 · See all", only when the total is more than 5.
- **Deep link `?task=`.**
  - If the task is among the five: highlighted and focused in the panel, as today.
  - If not: the popup opens scrolled to it, highlighted, with a chip "Opened from a link · {title}".
- **Outcomes** (`RecordPanelComponent`'s opt-in `[outcome]`, ACC-120 slice 5):

| State | What shows |
|---|---|
| Loading | Five skeleton rows; count "—" |
| Empty | "No tasks yet. Tasks about this committee will be listed here." with New task when allowed |
| Error | "Couldn't load this committee's tasks. Retry", in the body only |
| Denied | The own-tasks variant (Q1) |

  **This absorbs ACC-217** (the error never cleared): the panel's load state and an action's failure become separate. An action error sits under its row with Try again, and never blanks the panel.

### 2.2 What the user sees — the "All tasks" popup

- **Size and title.**
  - A new **list** size on the dialog shell: **1040 × 760**, or the window less 96 px each way.
  - Below 760 px wide, a **full-screen sheet**.
  - Titled "All tasks · {record name}"; for a meeting, "All action items · …".
- **Fixed parts.** Header, toolbar, chip row, column header and footer stay put. **Only the list scrolls.** The 420 cap does not apply: it is a list, not a form (drawn decision 4).
- **Toolbar.** All filters are the shared overlay-select or toggle buttons, never a raw PrimeNG popup:
  - search (title and assignee);
  - Status (Unassigned, Assigned, In progress, On hold, Rejected, Completed, Cancelled);
  - "Overdue only";
  - Assignee or pool;
  - Required or Optional;
  - Due (This week, Later, No due date);
  - "Assigned to me";
  - Sort: due date (default, open first), created, last updated, status or title, either way.
- **Chips.** One per active filter with ✕, plus Clear all. The result count is a polite live region: "3 tasks match".
- **Columns.** Task (≥ 200, with tag and reason sub-line), Status, Assignee or pool (≥ 140, with position sub-line), Due, Created by, Updated, button, ⋯.
  - The minimum row is 1032 px. Narrower than that, the list and its sticky header scroll sideways together.
  - Phone rows are two lines, with the due date at the end.
- **Load more.** The first 50, then "Load more" adds 50. Filters run on the server. Each load-more fetches the next page, so loaded rows stay.
- **Never remembered.** It opens on the defaults every time (drawn Q3).
- **Acting in place.** An action from ⋯ updates its row where it is. The panel behind refreshes when the popup closes.
- **Keyboard.**
  - Focus starts in search.
  - Tab reaches the filters, sort, rows and ⋯.
  - Escape closes the top layer only (`LayerStackService`).
  - Focus returns to See all.
  - A deep link focuses the highlighted row.
- **Outcomes.**
  - Loading: 10 skeleton rows and "Loading tasks".
  - No match: "No tasks match '…'" with Clear.
  - Error in the list area: Retry, and the toolbar stays usable.
  - Load more fails: the rows stay, and the footer reads "Couldn't load more · Retry".
  - Without `tasks:view`: titled "Your tasks on this committee" (Q1).

### 2.3 Endpoints and queries

| Endpoint | Returns | Rule |
|---|---|---|
| `GET /tasks/record-panel?sourceType&sourceId` | `{ total, scope: 'all'\|'own', rows: (≤5) }` | (Q1) `scope 'all'`: `tasks:view` + `assertCanView`, exactly as `GET /tasks?sourceType&sourceId` today. `scope 'own'`: the record is viewable and the rows are only tasks the viewer is or was on — the My tasks rule |
| `GET /tasks/record-list?sourceType&sourceId&q&status[]&overdue&assignee&pool&required&due&mine&sort&dir&take(≤50)&skip&around` | `{ items, total, matching, facets? }` | Same as the panel; `facets` (assignee and pool options) only when `skip=0` |

- **Old endpoint kept.** `GET /tasks?sourceType&sourceId` stays for now (the committee page's other uses). It is removed in a later change once nothing calls it.
- **Ordering in SQL, not in the browser.** One `$queryRaw` with every value parameterised and `organizationId` in the `WHERE`:

  ```
  ORDER BY rank, sortKey, id
  ```
  - `rank`: 0 for open, 1 for On hold, 2 for closed.
  - `sortKey`: for open and On hold, `dueAt ASC NULLS LAST`; for closed, `COALESCE(completedAt, cancelledAt) DESC`.
  - The panel takes 5.
  - The popup's other sorts replace `sortKey`, and the "open first" rank stays only for the due-date sort.
- **"Overdue" is computed** (`dueAt < now()` and open and not On hold), never a status (ACC-163).
- **"This week" runs in the tenant's zone**, through `WorkingCalendarService`'s timezone (ACC-94 D3). The browser's zone is never used.
- **Search** is `ILIKE` on title and titleAr, plus the active assignees' names, with the term escaped.
- **Counts.** `total` counts everything visible; `matching` counts what the filters match.
- **`around=<taskId>`.** The server computes that task's position under the current sort, so the popup can load up to its page (decision 7).
- **Per-row `actions`.** Computed by **one** `TaskActionsService.forViewer(task, viewer)` (§2.4).
- **Performance.** Batched per page: one query for assignee names, one for open requests, one for evidence counts, and the viewer's pool memberships resolved once per request. Never per row.
- **Indexes.** `Task(sourceType, sourceId)` exists and carries both queries. **No new index.**
- **Isolation tests.** Both endpoints, named for the gate.

### 2.4 Row actions — exactly the app's existing actions and rules

**The rule.** The server already decides every action in the service, by relationship. So the server returns, per row, which actions this viewer may take. Each flag reads **the same helper the action's endpoint uses**, so a button can never offer what the endpoint would refuse.

**What the flags replace.** Today's frontend predicates differ by screen: the committee page's seven icons versus My tasks' fourteen. The flags supersede both, and My tasks moves onto them later (not in this ticket).

| Action | Endpoint's rule today (source) | Shown as |
|---|---|---|
| Start | an active assignee, status Assigned (`task.service` start) | **Button** for Assigned |
| Complete | an active assignee, open, not on hold; evidence if required (`complete`) | **Button** for In progress, disabled with "Add evidence first" when evidence is missing. **Menu** item for Assigned (Q6) |
| Resume | an active assignee, `tasks:reassign`, or `canActForCreator` (`task-request.service.ts:424-431`) | **Button** for On hold |
| Pick up | a member of the open pool, not taken (`pick`) | **Button**; menu: Open task only |
| Review request | `tasks:reassign` or `canActForCreator`, never the asker (`task-request.service.ts:518-529`) | **Button** — opens today's decision dialog |
| Add evidence | an active assignee, task open or on hold (ACC-177) | Menu |
| View evidence (n) | the evidence rule (§0.3) | Menu |
| Request more time…, Request a hold… | an active assignee of an Assigned or In progress task, with no open request | Menu |
| Withdraw request | the asker | Menu |
| Reject… | an active assignee chosen directly (ACC-167) | Menu, with the sub-line "Hand back with a reason" |
| Release | the person who picked it from a pool | Menu |
| Reassign… | the creator, `canActForCreator`, or `tasks:reassign` (ACC-163) | Menu |
| Edit… | `mayManage`, open (ACC-174) | Menu |
| Cancel… | `mayManage`, open; not a workflow task, except an optional stage-definition task (ACC-190 K) | Menu, worded danger |
| Reopen… | `mayManage`, Completed, in the same stage entry (ACC-174/190) | Menu |
| Open task | always | Menu, always last |

- **One button, then the menu.** The single button follows the drawn precedence: Review request, then Pick up, then the status's own step (Start, Complete or Resume). Rows with no main action show no button.
- **Menu order.**
  - Assignee items first.
  - Then a divider and the creator's items, when the viewer is both.
  - Actions the viewer cannot take are absent, not disabled. The one exception is Complete waiting for evidence.
- **The menu itself.** A new shared `am-row-menu` on the CDK overlay with the **reposition** scroll strategy, the same mechanism as `OverlaySelectComponent`.
  - In the build I'll check `@angular/cdk/menu`'s trigger in its source before relying on it. If it doesn't reposition, the menu is built on `Overlay` directly, like the select.
  - It works with the keyboard (arrow keys, Home/End, Escape via `LayerStackService`), uses `role="menu"`, and aligns to the inline end (left in Arabic).
- **One question needs your call: Q6.** The drawing omits Complete for an Assigned task, but the app allows completing one today.

### 2.5 Heights (both languages)

The drawn figures. Each sum was re-added here, and the build asserts each one in a layout spec, in both languages, in the app's own font (IBM Plex Sans Arabic for both). The drawing renders English in Helvetica, so the English heights are re-measured, not trusted.

| Part | English | Arabic | Arithmetic |
|---|---|---|---|
| Panel header | 42 | 46 | fixed |
| Panel row | 52 | 58 | English: padding 4+4 + line 1 26 + line 2 18 = 52. Arabic: 4+4 + 26 + 22 = 56 ≤ 58 |
| Panel footer | 34 | 38 | fixed |
| **Panel body, fixed** | **294** | **328** | 5 × 52 + 34; 5 × 58 + 38 |
| Panel total | 336 | 374 | + header |
| Popup | 1040 × 760 | 1040 × 760 | or the window − 96 |
| Popup header / toolbar / chips / column header / footer | 64 / 52 / 36 / 30 / 44 | 68 / 56 / 40 / 32 / 48 | |
| Popup list area at 760 | 534 = 10.3 rows | 516 = 8.9 rows | 760 − the fixed parts |
| Phone row | 60 | 64 | |

**Equal panels.** The committee page puts Members, Tasks and Sub-committees in one row (`minmax(320px, 1fr)`). Until PR 3, Members and Sub-committees still grow. After PR 3 all three hold the same fixed body.

**Specs.** A layout spec (`record-tasks-panel.layout.spec.ts`), with a non-vacuity guard first (heights real and non-zero), asserts:
- the body is exactly 294 / 328 with 5, 2 and 0 rows;
- a long Arabic title and a long assignee name do not change the row height;
- the due label is never truncated;
- the popup's list area is the only element whose `scrollHeight > clientHeight`.

### 2.6 Translations

New keys:
- **`recordTasks.*`:**
  - `seeAll` "See all" / «عرض الكل»
  - `showing` "Showing {{shown}} of {{total}}"
  - `ownTitle` "Your tasks on this committee"
  - `ownNote`
  - `empty`, `error`, `retry`
  - `popupTitle` "All tasks · {{record}}"
  - `actionItems.*` (meeting wording, kept for its consumer)
- **`taskList.filter.*`:** `status`, `overdueOnly`, `assignee`, `required`, `due.thisWeek`, `due.later`, `due.none`, `mine`
- **`taskList.sort.*`:** `due`, `created`, `updated`, `status`, `title`, plus the direction
- **`taskList.chip.*`:** chip wording and `clearAll`
- **`taskList.live.*`:** `match` (plural), `loading`, `loadMore`, `loadMoreFailed`
- **`taskList.noMatch`**, `taskList.clearSearch`
- **`taskList.due.*`:** `overdueDays` (plural), `tomorrow`, `inDays`, `onHoldTo`, `completedOn`, `cancelledOn`
- **`taskActions.*`:** every menu and button label, plus `addEvidenceFirst`, `rejectSub` and `moreActionsFor`

Day counts use `duration` / `relative` (ACC-94), never a plural object. The Arabic strings are taken from the drawing where it gives them.

### 2.7 Accessibility

- **Panel.** A `ul` of rows. Each row's link is the title. The button's accessible name includes the task ("Start Renew the terms of reference signatures"), and the ⋯ menu is named "Actions for {title}".
- **Popup.** A `dialog` with `aria-labelledby` the title. The list is a `table`, or a grid of `role="row"` items, with the sticky column header. The live region is polite. Chips are buttons named "Remove filter: Overdue only".
- **Never colour alone.** Overdue is ⚠ plus words, On hold ⏸ plus words.
- **Focus order and return** as §2.2.
- **Touch targets.** The row button is 26 px high inside a 52 px row, so the row's own padding gives the 44 px target band. Phone rows are 60 / 64.
- **Reduced motion.** No animation on highlight.

### 2.8 Tests (PR 2)

- **Backend.**
  - Ordering (overdue, soonest, no date, On hold, recently closed).
  - The total versus the five.
  - Every filter and sort.
  - Search on assignee names.
  - `around`.
  - Load more pages.
  - The own scope (Q1).
  - Isolation (named).
  - **`actions` contract:** for each action and viewer, the flag's value equals "the endpoint does not refuse with 404 or 403 for relationship". Each pair runs the real endpoint method in the spec, so a drifted helper turns red.
- **Frontend.**
  - The six panel outcomes.
  - The fixed height (layout spec).
  - The footer present only above 5.
  - `?task=` inside and outside the five.
  - Popup filters, chips, live region, Load more, the failure outcomes, opening on the defaults.
  - Acting in place.
  - The menu per viewer (the five drawn viewers).
  - The reposition behaviour: scroll the list with the menu open, and the menu stays with its row.
  - The phone sheet below 760.
- **Mutation checks.** Remove the panel's height cap; flip the rank order; drop a filter's server clause. Each must turn a spec red, and is named in the PR.
- **Live.** Infection Control on al-nakheel, in both languages, as a creator, an assignee, a pool member and a reader. All `[test]` tasks are cancelled afterwards.

### 2.9 Migration

**None.**

---

## 3. PR 3 — Members and Sub-committees capped (ACC-230)

### 3.1 What the user sees

The same capped panel shape (the "Compact List Panel"):
- 5 fixed-height rows, the same body height as Tasks (294 / 328);
- the header count is the total;
- "Showing 5 of N · See all".

**Members**
- **Rows:** name (linked to the user record when the viewer may open it, else plain), then the seat and since.
- **Order:** by seat (the `committee_member_role` lookup order: Chair, Secretary, Member, …), then since.
- **Actions:** Add member in the header. Change role and Remove move from inline icons into a worded ⋯ menu per row — the same permissions as today (`committees:change_member_role`, `committees:remove_member`).

**Sub-committees**
- **Rows:** name, linked, then "{Status} · n members".
- **Order:** name.
- **No header action** (as today).

**See all** opens a plain list popup: **720 × 560**, with search only and no filters.
- **Members** sort by Seat, Name or Since, with the columns Member, Seat and Since.
- **Sub-committees** sort by Name, Status or Members.
- Phone: the same sheet as PR 2.

### 3.2 Endpoints

| Endpoint | Returns | Rule |
|---|---|---|
| `GET /committees/:id/members/page?q&sort&dir&take&skip` **(new)** | `{ items, total }` | `committees:view`, as `GET /committees/:id/members`; active members only |
| `GET /committees/:id/sub-committees?q&sort&dir&take&skip` **(new)** | `{ items: {id, nameEn, nameAr, stageLabel, memberCount}, total }` | `committees:view`; the parent read with `{ id, organizationId }` first; the identical 404 for another tenant's id |

- **Existing endpoints untouched.** `GET /committees/:id/members`, a bare array, stays for its other callers. The page stops filtering `GET /committees` for sub-committees.
- **Indexes.** `CommitteeMember(committeeId)` and `Committee(parentCommitteeId)` exist. **No new index.** Search is `ILIKE` on the names, escaped.
- **Isolation tests** for both, named.

### 3.3 Translations

- `record.seeAll` (shared with PR 2), `record.showing`
- `committee.membersPopupTitle` "All members · {{committee}}", `committee.subCommitteesPopupTitle`
- `committee.searchMembers`, `committee.searchSubCommittees`
- `committee.sort.seat`, `.name`, `.since`, `.status`, `.members`
- `committee.memberActionsFor`

### 3.4 Heights

| Part | English | Arabic |
|---|---|---|
| Panel body, fixed | 294 | 328 |
| Popup | 720 × 560 | 720 × 560 |
| Popup row | 44 | 44 + Arabic re-measure |

The members rows' avatar, name, seat and since must fit 52 / 58. Measured in the layout spec, both languages.

### 3.5 Accessibility, tests, migration

- **Accessibility.** As PR 2: list semantics, a named ⋯ menu, the live result count, focus return to See all.
- **Tests:**
  - order by seat;
  - the cap and the fixed height;
  - the footer only above 5;
  - search and sort on the server;
  - the menu shows only the actions the viewer's permissions allow (the same predicates as today's icons);
  - isolation (named);
  - the layout spec.
- **Migration: none.**

### 3.6 Lane A work on committee pages (checked 14 Oct)

- **Open PRs:** none (`list_pull_requests`, state open: empty).
- **Remote branches:** six unmerged-by-hash branches touch committee files: `ACC-120-field-reveal`, `ACC-167`, `ACC-173`, `ACC-174`, `ACC-177` and `acc-135`. All are squash-merged work whose tickets are Done. A content diff shows `dev` **ahead** of every one of them on those files, so none carries committee-page work missing from `dev`.
- **Open tickets that touch the same page:**
  - **ACC-120 slice 4 — Committees** (In Progress ticket; slice not started): `/committees` list, Add/edit committee, Add committee member. It touches the committee **form** and the **Add member dialog**, not the record page's panels. PR 3 keeps Add member opening today's dialog unchanged, so slice 4 can restyle it independently. **Coordination point:** if slice 4 starts first, PR 3 rebases onto it.
  - **ACC-217** (Todo): "the Tasks panel's error is never cleared". Absorbed by PR 2, which closes it.
  - **ACC-205 / ACC-153** (Backlog): NG0100 on the committee page from `ListRowDirective`'s tabindex. The Members panel uses `amListRow`. PR 3 replaces those rows, so it either fixes the cause or keeps the directive and reports whether the error remains. Measured in the browser console, not assumed.
  - **ACC-104** (Backlog): panel-level request outcomes. PRs 2 and 3 use `RecordPanelComponent`'s opt-in `[outcome]`, and are its first full consumers on the committee page.

---

## 4. Questions and decisions

**Decided 14 Oct (Ahmad): every recommendation below is approved, except Q5.**

**Q5 is decided differently:** the evidence rule is a bug, filed as **ACC-231** (lane B, High, Bug, related to ACC-228). The fix must change the single file entitlement — `assertCanSeeEvidence()` behind `fileForViewer()` — which download, the in-app viewer and the AI summary all use. It must keep the same 404. **It is not built in this work.** Until it is, the task page shows the evidence list through the existing rule, unchanged.

**One consequence for PR 1.** A person admitted to the page only as a pool member (c) or a decider via `tasks:reassign` (d), who also cannot see the record, gets the evidence list's 404. The page then says that the evidence is shown to the people on the task; it never shows an error for it. The evidence count in the page's own view model still shows.

The table keeps the recommendations as they were approved:

| # | Question | Recommendation |
|---|---|---|
| **Q1** | The drawing's **own-tasks variant**: a viewer who can see the committee but lacks `tasks:view` sees "Your tasks on this committee". Today that viewer sees **no Tasks panel at all**. | **Build it.** Every row it shows is already visible to that person in My tasks (the self-scoped rule, ACC-101), on a record they can already open. So it discloses nothing new, and the count is only their own. **If you read "same visibility rules as today" as "no panel without `tasks:view`"**, the panel stays hidden for them and the variant is dropped; say which. |
| **Q2** | **Meetings and Standards have no page or module**, and Standards has no model. The panel is drawn on three record types. | Build the component generic (record, title, header action, title key, source line). Ship it on **committees only**. Meetings and Standards adopt it in their own tickets: they pass the inputs, and add one visibility-registry line for STANDARD. Nothing is built for pages that do not exist. |
| **Q3** | "Keep the record id and the counts": the summary holds one count today ("n eligible"), not per-person counts. | Drop `chosen {userId}`; keep the record id and "n eligible"; **add the chosen person's counts as numbers** ("chosen 5 open, 0 overdue"). No other person is described. |
| **Q4** | Who may open `/tasks/:id`? | The **union of today's exposures** (§1.2 a–e): on it now or before, may manage it, a pool member while open, a decider of its open request, or `tasks:view` + the record. Anyone else gets the identical 404. Nothing becomes visible that is not visible somewhere today. |
| **Q5** | The **evidence rule is broader** than the task read: a committee viewer **without** `tasks:view` can list evidence today. | **Decided: a High bug, ACC-231**, fixed in the single file entitlement with the same 404. Not built here. |
| **Q6** | The drawing gives an **Assigned** task only Start, but the app lets an assignee complete a task from Assigned today. | **Keep it: "Complete" in the ⋯ menu for Assigned**, with Start as the button — "exactly the actions the app applies today". The alternative is to require Start first, which is a behaviour change. |
| **Q7** | `GET /tasks?sourceType&sourceId` (unpaged). | Keep it until nothing calls it; remove it in a later change. |
| **Q8** | Home briefing **task** items go to My tasks highlighted today. | Send them to `/tasks/:id`. My tasks still honours `?task=` for older links. |
| **Q9** | The **notification bell does not navigate** today. "Every place that opens a task" doesn't strictly include it. | **Include it in PR 1:** a task or request notification opens `/tasks/:id`. It is the drawing's first reason for the page ("a task needs an address a notification can open"), and the change is small. Other notification types are unchanged. |
| **Q10** | `/tasks/all` and `/tasks/unassigned` title links. | Link them too (one line each). Their own redesign stays ACC-120 slice 3. |
| **Q11** | The drawn breadcrumb ends with a "Tasks" crumb that has no destination page. | Ancestry only, "Committees / {record}" (ACC-79: the breadcrumb stops at the parent). Falls back to "My tasks" when the viewer cannot open the record. |
| **Q12** | Should Change role and Remove leave the Members rows for a ⋯ menu? | Yes: the drawn row has no inline icons, and the capped row has no room for two. Same permissions as today. |
| **Q13** | Popup sort persistence. | None (drawn Q3, confirmed): the defaults every time. |

---

## 5. Order of work and commits

**This branch first, before PR 1's code:**
1. `chore(design): the record tasks panel drawing, as exported [ACC-228]` — the new `.dc.html` only. Unedited, staged by path.
2. `docs(plan): the task page, record tasks panel and capped panels [ACC-228]` — this file.

**PR 1, then:**
- backend view and history endpoints, and the shared actions service (PR 2 reuses it);
- the log summary;
- the frontend page;
- the links (My tasks, Unassigned, All, committee panel, briefing, bell);
- translations;
- tests;
- the docs: SYSTEM-REFERENCE §3 for the task page, its rule and the history read, and a CLAUDE.md entry for the decisions.

**PRs 2 and 3** follow on their own branches from `dev` after PR 1 merges.

Each PR runs `/ready-to-pr`: both suites, tenant isolation, every `check:*`, `ng build`, and the live proof after deploy.

## 5b. PR 1 as built (14 Oct)

### Heights, measured (`task-page.layout.spec.ts`, real theme, IBM Plex Sans Arabic, both languages)

| Measure | English | Arabic |
|---|---|---|
| Title line (one line) | **34 px** at 28 px type | **40 px** at 29 px type |
| Header block at 1240 | 77 px | 88 px |
| Relations at 1240 | 4 in one row, 310 px each (≥ 220) | 4 in one row, 310 px each |
| Columns at 1240 | side by side, 614 / 614 px (≥ 420) | side by side, 614 / 614 px |
| Whole page at 1240 | 604 px | 658 px |
| At 390, longest seeded title | title 136 px (wraps), header 228 px, page 1254 px | title 120 px, header 220 px, page 1312 px |
| Sideways scroll at 390 | none (scrollWidth 390 / 390) | none (390 / 390) |

### Where the build differs from the plan

1. **The briefing's saved decision items keep their old link.** §1.3 said the
   change reached saved briefings too. It does for TASK items (the link is
   built on screen from a stored task id), but a saved DECISION item stores the
   REQUEST's id, not the task's, so it keeps `/tasks?request=`, which My tasks
   still honours. New briefings link decisions to the task page
   (`briefing-groups.ts` now emits `{ target: 'task', id: req.task.id }`).
2. **The rail no longer uses `RouterLinkActive`.** To light My tasks on
   `/tasks/:id` (`NavItem.alsoActiveFor`), the rail decides "current" itself.
   The spec for that found that `RouterLinkActive` removes `aria-current` after
   the template sets it, so no rail item has ever kept `aria-current="page"`.
   Fixed in passing, with a regression spec.
3. **The evidence list gains a "not shown" state** for its 404 (decided in §4
   with Q5): a pool member or a decider the page admits but the evidence rule
   refuses reads "Evidence is shown to the people on this task.", not an error.
4. **Not drawn data the server does not hold, left out rather than guessed:**
   the header's "moved from 8 Oct · more time approved 3 Oct" (History says it),
   and the request's "waiting for {decider}" (the decider is a rule, not a
   stored person).
5. **The page's H1 is its own, not `PageHeaderComponent`'s 22 px**, at the drawn
   28/34 and 29/40; the tab title is registered with `registerPageName`.
6. **`/tasks/all`'s title links exist but are unreachable**: that stopgap route
   never loads rows (it has no record — CLAUDE.md, Open/Deferred Items).
7. **The committee panel's title link is not covered by a rendering spec**: its
   specs replace the template. It is covered by the live check, and PR 2
   rebuilds the row with its own spec.

### Mutation checks (each turned a spec red, then restored)

| Mutation | Spec that went red |
|---|---|
| (e) without `tasks:view` | task-page.service — the record without tasks:view gets the 404 |
| (c) without "still waiting" | task-page.service — not once someone has picked it up |
| (a) removed | task-page.service — 6 specs |
| a 404 rendered as an error | task-page.component — the identical not-found state |

## 5c. PR 2 as built (14 Oct)

### `/tasks/all` — included in this PR (assessed first, as asked)

**Why it showed no rows:** `TaskListComponent` asked for ONE record's tasks
(`getForSource(sourceType, sourceId)`), and the route supplies no record, so
`loadTasks()` returned before it ever called the server. Every visit read "No
tasks", whatever the data.

**The change was small, so it is in this PR.** `GET /tasks/record-list` takes
its record as optional: without one it lists the organisation's tasks, for
`tasks:view` holders only, limited to the record types the viewer may see
(`ObjectVisibilityService.viewableTypes()`, the same rules as `assertCanView`,
failing closed). `/tasks/all` keeps its page header and New task and hosts the
same `TaskListViewComponent` the popup uses — search, filters, sort, chips,
Load more by 50 — with each row naming its record. No Linear ticket was needed.

### Heights, measured (`record-tasks-panel.layout.spec.ts`, real theme, IBM Plex Sans Arabic)

| Measure | English | Arabic |
|---|---|---|
| Panel header | **42** | **46** |
| Panel body with 0, 3, 5 and 16 tasks | **294** every time, never overflows | **328** every time, never overflows |
| Panel row (long title, long assignee, every row kind) | **52** | **58** |
| Panel footer (16 tasks), flush with the body's bottom | **34** | **38** |
| Due label | never cut (scrollWidth ≤ clientWidth) | never cut |
| Popup body at 1040 × 760 (less the dialog's header, 64 / 68) | toolbar 109, chips 36, column header 30, **list 507**, footer 44 | toolbar 113, chips 36, column header 30, **list 495**, footer 48 |
| Only the list scrolls; the column header stays put as it scrolls | yes | yes |
| Phone rows at 390 (12 rows of every kind) | 60 | 64 |
| Sideways scroll on a phone | none | none |

### Where the build differs from the plan

1. **The popup's toolbar is two rows, not one** (109 / 113 against the drawn
   52 / 56). Search, five filters, two toggles and Sort do not fit 1008px in
   the app's controls without cutting their labels; the list area is 507 / 495
   against the drawn 534 / 516 — about half a row less. Measured and reported
   rather than squeezed.
2. **A list-dialog shell, `am-list-dialog`, not a "list size" on
   EditDialogComponent.** EditDialog's 420 cap and its form behaviour (dirty
   question, footer slot) are wrong for a list; a separate shell keeps both
   rules intact. It listens for Escape in the CAPTURE phase, because the CDK
   menu closes on Escape before the event bubbles (pinned by spec).
3. **The panel draws its own frame**, not `RecordPanelComponent`'s: that
   body has a floor, not a fixed height, and its header is a different height.
4. **The actions contract (§2.8)** is a real-database spec that requires every
   row's actions to equal the task page's, for a creator, a direct assignee, a
   pool member with and without `tasks:view`, and a reader with
   `tasks:reassign` (`task-record-list.actions.db-spec.ts`). PR 1's
   `task-actions.spec.ts` pins each flag against its endpoint's rule; the list
   reuses the same function, so what could drift is the facts, and that is
   what this spec checks.
5. **Q1's own variant includes the tasks the viewer CREATED** (Ahmad, 14 Oct,
   after the first build). §2.3 said "the tasks the viewer is or was on — the
   My tasks rule", which left a creator without `tasks:view` seeing none of
   the tasks they created on that panel. It is now the tasks they are or were
   on, or created — every one a task whose page already admits them, as an
   assignee (Q4 a) or as its manager (Q4 b), so it discloses nothing new.
   Nothing else about the variant changed. Pinned in the unit spec (the
   statement and the count), the record db-spec (a created task the viewer is
   not on is listed) and the actions db-spec (a creator without `tasks:view`
   sees all nine, with the page's own actions).
6. **Status is a single-choice filter** (the server accepts several).
7. **Complete from a row is confirmed first**, as the committee panel always
   did ("this finishes it for every assignee"); the task page's button is not.
8. **No source line ("From item n")**: it belongs to meeting action items,
   which have no page (Q2). The component takes it when meetings adopt it.
9. **`OverlaySelectComponent` gained an opt-in `ariaLabel`**, because a
   toolbar filter has no visible label: the trigger reads as a button named
   "Status: In progress". Unset, nothing changes for its other consumers.
10. **Removed**: the committee page's own task rows, seven inline icons and
    their client-side rule copies (`committee-detail.tasks.spec.ts`,
    `task-due-summary.ts` and its spec). `GET /tasks?sourceType&sourceId`
    stays (Q7); the frontend no longer calls it from the committee page.

### ACC-217 — fixed

The committee panel set `tasksError` on an action's failure and never cleared
it. The panel's load state and an action's failure are now separate signals:
a failure is said in its own row with Try again, the panel re-reads itself and
keeps its rows (`record-tasks-panel.component.spec.ts`, "an action that fails
says so IN ITS ROW and never blanks the panel").

### Mutation checks (each turned a spec red, then restored)

| Mutation | Spec that went red |
|---|---|
| The panel body's fixed height removed | layout spec — the body is exactly 294px (3 cases) |
| The popup's Escape listener moved to the bubble phase | list-dialog spec — Escape with the row menu open closes the MENU, not the popup |
| On hold ranked before open, and the overdue filter's open/not-on-hold clause dropped | db-spec — 5 tests (order, panel five, Load more, deep link, overdue) |
| The search escape of `%` `_` `\` removed | db-spec — a typed % is a percent sign |
| The list told the viewer is never in a pool | actions db-spec — a pool member with tasks:view |
| The organisation scoping dropped from the statement | unit spec — should NOT return records belonging to a different tenant |

## 6. Progress

- [x] Tickets ACC-228, ACC-229, ACC-230 (lane B), chained 228 → 229 → 230
- [x] Lane A check (§3.6)
- [x] Ahmad approves this plan (14 Oct): Q1–Q13 as recommended, except Q5 → ACC-231
- [x] PR 1 built on `feature/ACC-228-task-page` (14 Oct) — §5b; waiting for /ready-to-pr
- [x] PR 1 merged (`e9aaed7`, PR #178) and proven live
- [x] PR 2 built on `feature/ACC-229-record-tasks-panel` (14 Oct) — §5c, with `/tasks/all` included; waiting for /ready-to-pr
- [ ] PR 3
