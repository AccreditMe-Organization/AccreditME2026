# Step 231 — Task files follow the task page's rule (ACC-231)

Lane B, Bug, High. Branch `fix/ACC-231-task-files-follow-task-page` from `dev` at
`23a5649`. Found while planning ACC-228 (`step-228-record-tasks-panel.md` §0.3,
Q5), filed by Ahmad on 14 Oct.

**Status: built (16 Oct), waiting for `/ready-to-pr`.** Ahmad decided all five
questions on 16 Oct, as picked (§6). §8 records where the build differs.

## 1. The two rules today

**The task page** — `TaskPageService.admit()` (private, `task-page.service.ts:231`),
ACC-228's Q4. A viewer is admitted when any of these holds:

| | Who |
|---|---|
| (a) | anyone **ever** on the task (an assignee row, removed or not) |
| (b) | whoever **may manage** it: `TaskService.mayManage()`, i.e. the creator, whoever acts for the creator (`canActForCreator()`: an out-of-office delegate, or the acting head appointed for the creator's absence), or a `tasks:reassign` holder while the creator is no longer active |
| (c) | a **member of its pool while it waits** (a pool target, no active assignee, a pickable status) |
| (d) | whoever **may decide its open request** (`tasks:reassign`, or acting for the creator), while a request is pending |
| (e) | **`tasks:view` AND** permission to see the task's record (`ObjectVisibilityService.assertCanView`) |

Everyone else gets the identical 404 ("Task not found"), and a warning log line
naming the viewer and task. The read is scoped `{ id, organizationId }`, so
another organisation's task is the same 404.

**Task files** — `TaskEvidenceService.assertCanSeeEvidence()`
(`task-evidence.service.ts:261`). It admits:

| | Who |
|---|---|
| (a) | anyone ever on the task |
| (b) | whoever may manage it |
| (R) | anyone who can see the task's record, **with no `tasks:view` check** |

There is no (c), no (d), and (R) is wider than (e). Everyone else gets the
identical 404 ("Task not found"), logged by `assertCanViewOrNotFound()`.

## 2. Every path that reads, lists, shows or hands out a task's files

`StoredFileOwnerType` has one value, `TASK`: every stored file in the product is
task evidence. Evidence also includes links and record references, which hold no
file but are listed with the files.

### 2.1 Paths that read or hand out evidence

| # | Path | What it gives | Who it admits today |
|---|---|---|---|
| 1 | `GET /tasks/:id/evidence` — `TaskEvidenceService.list()` | every live evidence row: file name, type, size, uploader, links, references; `canAdd`, `closed` | `assertCanSeeEvidence()`: (a), (b), (R) |
| 2 | `GET /tasks/:id/evidence/:evidenceId/download` — `download()` → `fileForViewer()` | a download link (§3), logged | (a), (b), (R) |
| 3 | `GET /tasks/:id/evidence/:evidenceId/view` — `openView()` → `fileForViewer()` | the in-app viewer's link (§3), logged | (a), (b), (R) |
| 4 | `GET /tasks/:id/evidence/:evidenceId/summary` — `getSummary()` → `fileForViewer()` | the saved AI summary in the reader's language, and whether Summarize is offered | (a), (b), (R) |
| 5 | `POST /tasks/:id/evidence/:evidenceId/summary` — `makeSummary()` → `fileForViewer()` | makes the AI summary (the server reads the file's text) | (a), (b), (R) |
| 6 | `GET /files/stream/:token` — `FilesController.stream()` | the bytes, for a local-folder or SharePoint file | **the token holder** — no session; the token is minted only by #2/#3 (§3) |
| 7 | An S3 / MinIO pre-signed URL (`StoredFileService.openDownload/openView`) | the bytes, straight from the bucket | **the URL holder**, minted only by #2/#3 (§3) |
| 8 | `GET /tasks/:id` — `TaskService.getByIdForViewer()` | the task **with its evidence rows** (`include: { evidence }`: links, references, `storedFileId`, the legacy `fileName`/`s3Key` columns) | **its own rule**: `@Permissions(tasks:view)` + the record (= (e) only) — and **nothing in the app calls it** (the frontend's `getById()` has no caller) |
| 9 | `GET /tenant/recycle-bin` — `RecycleBinService.list()` | **deleted** evidence files: name, size, who deleted it, the task's title. Restore and purge; a deleted file can never be opened | `tenant:manage_config` |

### 2.2 Paths that show only that evidence exists (a count or a kind, never a file)

| # | Path | What it shows | Who sees it today |
|---|---|---|---|
| 10 | Task page — `TaskPageService.view()` | `evidenceCount`, and whether Complete needs evidence | `admit()` |
| 11 | Task history — `TaskPageService.history()` | "evidence added / removed" with its type (file, link, reference) and who; never a file name | `admit()` |
| 12 | The record's Tasks panel and All tasks — `TaskRecordListService` | per row `evidenceCount`, and the "View evidence (n)" menu item, which opens #1 | `tasks:view` + the record, or (Q1 of ACC-228) only tasks the viewer is or was on, or created; every such row's task is one `admit()` admits |
| 13 | My tasks — `TaskService.getMyTasks()` | `evidenceCount`; its evidence dialog opens #1 | the viewer's own tasks: (a) |
| 14 | Pool tasks to pick — `getAvailableToPick()` | `evidenceCount` | the viewer's waiting pool tasks: (c) |
| 15 | `GET /tasks?sourceType&sourceId` — `getForSource()` | `evidenceCount` | `tasks:view` + the record: (e) |
| 16 | Complete — `TaskService.complete()` | refuses "Evidence is required…" when there is none | an active assignee: (a) |

### 2.3 Paths that write evidence (not reads; unchanged)

- `POST /tasks/:id/evidence` (a link or a reference, `TaskService.addEvidence()`) and `POST /tasks/:id/evidence/file` (`addFile()`): an **active** assignee, task open or on hold (`lockOpenForActiveAssignee()`).
- `DELETE /tasks/:id/evidence/:evidenceId` (`remove()`): the person who added it, while still an active assignee and the task open.
- Recycle bin restore and purge: `tenant:manage_config`.

### 2.4 Paths checked and found not to touch a task's files

| Path | Finding |
|---|---|
| The committee page | No files of its own. Its Tasks panel is #12. |
| The AI briefing (ACC-198) | Reads tasks and requests; no evidence, no file. |
| AI task drafting (ACC-197), the workload hint (ACC-199) | Read the record and counts; no file. |
| Notifications | No notification names a piece of evidence or a file. |
| The audit log | `TaskEvidence` rows carry the file's name and hash. The only reader is the task history (#11), which returns kinds, never the stored values. There is no audit log screen or endpoint. |
| Search, exports, data export | None exist. |
| Setup health (`STORAGE_ALMOST_FULL`), storage settings, the purge job | Byte totals and counts; no names. |
| The AI interaction log | Records "StoredFile … summary" by id, never the text. |

## 3. A link already issued

- **It lives 15 minutes** (`DOWNLOAD_TTL_SECONDS`, `download-token.ts`). Both kinds:
  - a local-folder or SharePoint file gets a signed token for `GET /files/stream/:token`;
  - an S3 / MinIO file gets a pre-signed URL from the bucket.
- **It is minted only after the entitlement check** (#2, #3), bound to one file in
  one organisation.
- **The stream route re-checks only that the file still exists, undeleted, in that
  organisation.** It does not ask who is holding the token, by design (ACC-177):
  the token is the entitlement, like a pre-signed URL.
- **So someone who loses access keeps a link they already opened for at most 15
  minutes.** A pre-signed S3 URL cannot be revoked at all.

**Pick: no change.** 15 minutes was ACC-177's decision. Narrowing it means either
re-checking the viewer on every stream (the route has no session, and a
pre-signed URL never reaches our API), or shorter links, which break a large file
mid-download. Recorded as question Q3 in case Ahmad wants otherwise.

## 4. The rule, and how it is built

**Every task-file path admits exactly whoever `admit()` admits, through one shared
check — never a copy of the rule.**

1. **`admit()` moves out of `TaskPageService`** into a new
   `TaskAdmissionService` (`foundation/task/task-admission.service.ts`), with:
   - **`load(taskId, organizationId)`**: the task row with exactly the includes
     `admit()` needs (assignees, the open request, the pool target, the
     creator's status), scoped `{ id, organizationId }`;
   - **`admit(row, viewer, organizationId)`**: the same five clauses, the same
     facts returned (`mayManage`, `mayDecide`, `inPool`, `recordVisible`), the
     same refusal log line. The code moves verbatim; the log line gains the
     route's name.
2. **`TaskPageService.view()` and `history()` call it.** Behaviour unchanged.
3. **`TaskEvidenceService.assertCanSeeEvidence()` is deleted.** `list()` and
   `fileForViewer()` call `load()` + `admit()`. Every refusal is the same 404 as
   today ("Task not found"), and a missing or deleted piece of evidence on an
   admitted task stays "Evidence not found". So a refused viewer gets the same
   answer for a real file, an invented one, and another organisation's.
   `fileForViewer()` stays the one entitlement behind download, view and both
   summary routes.
4. **Path #8, `GET /tasks/:id`, stops returning evidence rows** — see Q1. Evidence
   then has exactly one reader.
5. **The write paths (§2.3) are unchanged.** Adding and removing evidence stay
   with the active assignee.

**No migration.** No frontend change, except Q4's dead state.

## 5. Who gains, who loses — and a real-database spec for each

**`task-files-access.db-spec.ts`** (npm run test:db). Real rows: an organisation,
a committee, a task with a file, a link and a reference. It uses the real
`TaskEvidenceService` and `TaskAdmissionService`; storage and AI are stubs
reached only after admission. Each viewer kind is asserted on ALL FIVE routes
(#1–#5): admitted gets 200 from each, refused gets the identical 404 body from
each.

| Viewer kind | Today | After | |
|---|---|---|---|
| An active assignee, without `tasks:view` | in | in | same |
| A former assignee (removed, or the task closed) | in | in | same |
| The creator | in | in | same |
| The creator's out-of-office delegate | in | in | same |
| The acting head appointed for the creator's absence | in | in | same |
| A `tasks:reassign` holder, creator no longer active | in | in | same |
| `tasks:view` + can see the record | in | in | same |
| **A pool member while the task waits**, who cannot see the record | **404** | **in** | **gains** |
| **A `tasks:reassign` holder while a request is open**, who cannot see the record, creator active | **404** | **in** | **gains** |
| **Can see the record, without `tasks:view`**, not otherwise related (seeded today: Fahad, al-manara's "Committee Observer", `committees:view` only) | **in** | **404** | **loses** |
| **A pool member after someone picked it**, who can see the record without `tasks:view` | **in** | **404** | **loses** |
| **A `tasks:reassign` holder with no open request**, creator active, record visible, no `tasks:view` | **in** | **404** | **loses** |
| `tasks:view` but cannot see the record | 404 | 404 | same |
| No relation and no permission | 404 | 404 | same |
| **Another organisation's user, or another organisation's task id** | 404 | 404 | same — the **named isolation test** for the gate |

In the seeded roles, every role with `committees:view` also has `tasks:view`.
So the "loses" rows reach only custom roles (Fahad's) and the cases with no
`tasks:view`.

**Also:**
- **Unit specs:** `task-admission.service.spec.ts`, each clause on its own (moved
  from `task-page.service.spec.ts`, not rewritten); `task-evidence.service.spec.ts`,
  that every route goes through the shared check.
- **Mutation checks** (each must turn specs red, then restored):
  - **A copy of the old rule left in the evidence service.** The record-viewer
    clause without `tasks:view` must turn the "loses" spec red.
  - **The pool clause removed from `admit()`.** Both the page's spec and the
    files' spec must go red, proving they share one rule.
  - **The organisation scope removed from `load()`.** The isolation test must go
    red.
- **Docs:** SYSTEM-REFERENCE §3.12 (the page and its admission rule, now shared)
  and §16 (file evidence); CLAUDE.md ACC-228's entry ("the evidence rule is
  broader… until ACC-231") updated, and an ACC-231 entry.

## 6. Questions — DECIDED by Ahmad on 16 Oct, all five as picked

- **Q1 — `GET /tasks/:id` returns evidence rows under its own rule, and the app
  never calls it.** Pick: **stop returning `evidence` there** and leave the route
  otherwise unchanged (`tasks:view` + the record). Evidence then has exactly one
  reader. The alternative is to send its evidence through `admit()` too. That
  keeps a second, unused way to read files, and still behind a `tasks:view` gate
  that `admit()` does not require.
- **Q2 — the recycle bin (#9)** shows a deleted file's name and its task's title
  to whoever holds `tenant:manage_config`, regardless of the task rule. It can
  restore or purge, never open. Pick: **leave it outside the task rule.** It is
  the administrator's storage tool, a deleted file can never be viewed, and today
  every role with `manage_config` also has `tasks:view`. Recorded so it reads as a
  decision.
- **Q3 — a link already issued lives 15 minutes and cannot be withdrawn** (§3).
  Pick: **no change.**
- **Q4 — the "Evidence is shown to the people on this task" note.** ACC-228 added
  it for page viewers the evidence rule refused. Once the rules match, nothing
  can reach it: every path that opens the evidence list is one `admit()` already
  admitted. Pick: **remove the state and its translation key.** A 404 there would
  then show the list's ordinary load error, which is what a task that changed
  hands mid-visit deserves.
- **Q5 — access follows the task's state, as the page does.** A pool member loses
  the files once someone picks the task; a decider loses them once the request is
  decided. Pick: **exactly as the page** (no extra "was once admitted" clause).
  Anything else would be a second rule.

- **Q1 → `GET /tasks/:id` no longer returns `evidence`.**
- **Q2 → the recycle bin stays outside the task rule.**
- **Q3 → the 15-minute link stays.**
- **Q4 → the "Evidence is shown to the people on this task" note is removed**,
  with its key.
- **Q5 → access follows the task's state, exactly as the page does.**

## 7. Progress

- [x] Branch, this plan, the path inventory (§2)
- [x] Ahmad answers §6 (16 Oct, all five as picked)
- [x] `TaskAdmissionService` (moved, not copied); the page and the files use it
- [x] Q1 / Q4 as decided
- [x] Specs, `test:db` per viewer kind, the isolation test, mutation checks
- [x] SYSTEM-REFERENCE and CLAUDE.md

## 8. As built (16 Oct)

### Where the build differs from the plan

1. **The per-clause unit specs stayed in `task-page.service.spec.ts`** (§5 said
   they would move to a `task-admission.service.spec.ts`). They now build the
   real `TaskAdmissionService` and pass it to the page. The page's clauses are
   therefore tested against the one shared rule, and the evidence spec builds
   the same real service over its mocks. A separate copy of those tests would
   have been a second place to keep in step.
2. **Q4's 404 says the list's own sentence.** With the note gone, a 404 from the
   evidence list shows "The evidence couldn't be loaded." (`task.evidence.loadError`),
   never the server's English "Task not found", which the generic error path
   would otherwise have shown. Other errors are unchanged.
3. **`TaskPageService` now takes three dependencies** (Prisma, the delegation
   labels, the admission service), down from five. The refusal log line names
   the route: `task page`, `task history`, `task files`.
4. **The acting head and the out-of-office delegate are proved through one
   creator** who is both away and a unit head, with an ABSENCE appointment
   on the unit.

### Mutation checks (each turned specs red, then restored)

| Mutation | Red |
|---|---|
| **M1:** the old evidence rule copied back into the evidence service (on it, may manage, or sees the record) | unit, 1 (the record-without-`tasks:view` 404); db-spec, 6: both "gains", all three "loses" (Fahad included) and the isolation test |
| **M2:** the pool clause removed from the shared `admit()` | unit, the page's "(c) a member of its pool opens it"; db-spec, the files' "pool member while the task waits". One rule, both red. |
| **M3:** the organisation scope removed from `load()` | unit, all four of the evidence service's isolation tests; db-spec, the named isolation test |
| **M4:** the old "can see the record" clause brought back into `admit()` | unit, the evidence 404 and the page's "record without `tasks:view`"; db-spec, the Fahad case, the other two "loses" and the isolation test |
