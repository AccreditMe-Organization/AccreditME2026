# ACC-316 — Meeting Management

Plan only, 17 Nov 2026, branch `docs/ACC-316-meetings-plan` from dev
`1e47283`. No code, no schema change, no migration, no database write.

Read for this plan: `module-designs.md` (Meeting Module, lines 755–867);
CLAUDE.md's Sequence to Meeting Management (item 7), and the ACC-101, ACC-190,
ACC-244, ACC-255, ACC-271, ACC-281, ACC-282, ACC-283 and ACC-284 entries;
SYSTEM-REFERENCE §1.9, §2.19, §2.19.1, §3.13, §3.21 and §11; the schema, the
workflow seed, every registry named in §4, and `frontend/design-reference/`.

**Measured on the shared database (17 Nov, read only):**

| Organisation | Meetings | Agenda items | Meeting instances | Meeting tasks | Meeting templates | Self-loop moves |
|---|---|---|---|---|---|---|
| al-manara | 0 | 0 | 0 | 0 | 1 | 1 |
| al-nakheel | 0 | 0 | 0 | 0 | 1 | 1 |
| platform | 0 | 0 | 0 | 0 | 0 | 0 |

So no backfill in this plan touches a meeting. Each backfill touches
configuration only: the Meeting workflow template, seat defaults and roles.

---

## 1. What exists today

### 1.1 Schema

- **`Meeting`** (`schema.prisma:2137-2161`) has these columns:
  - `committeeId` is **nullable**.
  - `organizerId` and `title`.
  - `typeValueId` is a plain `String`, with **no relation** to `LookupValue`.
  - `scheduledAt`. There is **no end time and no duration**.
  - `location` and `meetingUrl`.
  - **`status String @default("DRAFT")`**.
  - `minutesText` and `minutesApprovedAt`.
  - Indexes on organisation, committee and `scheduledAt` (`:2158-2160`).
- **`AgendaItem`** (`schema.prisma:2163-2175`):
  - It has `title`, `description`, `order`, `duration` and **`presenter String?`**. The presenter is text, not a user.
  - It has **no `organizationId`**. That breaks the multi-tenancy rule ("every table holding tenant data MUST have an organizationId").
- **`Task.meetingId`** (`:1521`, indexed `:1633`) has **no relation**, and nothing writes it. A task reaches its record through `sourceType`/`sourceId`.
- **Missing models:** there is **no attendee, attendance, decision, vote, action item or reschedule model**.
- **Files:** `StoredFileOwnerType` has `TASK` only (`:1795-1797`, comment `:1792`). A meeting can hold no file.
- **What committees give a meeting:**
  - `Committee.quorumCount` (`:1960`);
  - `Committee.meetingFrequency` (`:1961`, enum `:2009-2016`);
  - `WorkflowObjectType.MEETING` (`:77`);
  - `TaskSourceType.MEETING` (`:189`).
- **Workflow voting today:**
  - `WorkflowApproval` (`:1445-1469`, decisions `:111-117`);
  - `WorkflowInstanceStage.quorumCount` (`:1408-1412`).

### 1.2 The seeded MEETING workflow (`workflow.seed.ts:235-258`)

| Stage (key) | Line | Final | Who |
|---|---|---|---|
| Planned (`planned`, initial) | `:241` | no | ANY_ONE, CREATOR |
| Agenda Ready (`agenda_ready`) | `:242` | no | ANY_ONE, CREATOR |
| Minutes Draft (`minutes_draft`, 16h) | `:243` | no | ANY_ONE, CREATOR |
| Minutes Review (`minutes_review`, 16h) | `:244` | no | **ALL, starting assignment** |
| Minutes Approved (`minutes_approved`, 8h) | `:245` | yes | ANY_ONE, starting assignment |
| Cancelled (`cancelled`) | `:246` | yes | ANY_ONE, starting assignment |

The transitions (`:249-256`) are all `mover: 'PERSON'`:

- Prepare Agenda; Cancel Meeting (EXIT) from Planned and from Agenda Ready; Record Minutes; Distribute Minutes.
- Approve Minutes (`:254`, `isApprovalPath: true`) and Return for Correction (`:255`, RETURN to Minutes Draft).
- **`:256`: Minutes Draft → Minutes Draft, "Return for Correction", RETURN.** This is a **seed bug**:
  - a stage sends itself back;
  - it is a duplicate label of `:255`;
  - it exists once in each tenant (table above).

Other facts about the seed:

- **No stage carries a record action or a flag.**
- `isApprovalPath` on `:254-255` has been dead since ACC-284.
- Minutes Review **used to be** ROLE `BASE_USER`, PARALLEL, ALL (`task.controller.ts:456`): every user in the tenant. Since ACC-271 PR 2 it is the first admin's starting assignment.

### 1.3 Permission keys

- `meetings:view`, `meetings:manage`, `meetings:record_minutes` and `meetings:approve_minutes` (`permissions.ts:124-129`).
- **Only `meetings:view` is in use**: `object-visibility.service.ts:15`. The other three are in `PERMISSIONS_NOT_YET_CHECKED` (`permissions.ts:247-249`), so no role can gain them.
- Role seed holders: `role.seed.ts:68, 76, 89, 123-124, 176, 194`.

### 1.4 The registries

| Registry | File:line | MEETING today |
|---|---|---|
| Visibility (`ObjectVisibilityService`) | `object-visibility.service.ts:93-100` | `meetings:view` + exists. **No member clause, no attendee clause.** COMMITTEE's has one (`:61-91`). |
| `TASK_RECORD_TYPES` | `task-record-types.ts:61` | **absent**. Only relationships reach a meeting's tasks. |
| `RECORD_ROUTES` | `stage-task-record-routes.ts:39`, MEETING `:60` | **present**: the meeting's committee, and the committee's unit. |
| `RECORD_ACTIONS` | `record-registry.ts:90` | **absent** (COMMITTEE only) |
| `STAGE_FLAGS` | `record-registry.ts:102` | **absent** |
| `RECORD_FIELDS` | `record-registry.ts:108` | **absent** |
| `TRANSITION_PRECONDITIONS` | `transition-preconditions.ts:44` | **absent** (COMMITTEE quorum `:54`, `:58-71`) |
| `PROTECTED_TEMPLATES` | `workflow-stage-keys.ts:63` | **absent** (change requests only) |
| `STAGE_ASSIGNEE_KINDS` | `stage-who.ts:28` | all five kinds |
| `SEAT_ACTIONS` | `seat-actions.ts:24-30` | **absent**. `:8-11` reserves `schedule_meeting` and `record_minutes` for this ticket (Ahmad, 10 Nov). |
| `MEMBER_ACTIONS` | `member-actions.ts:25-52`, assert `:159` | **absent** |
| Nav model | `nav-items.ts` (quality group `:186`, committees `:209`, `moduleKey` `:108`, `:475`) | **no Meetings item** |
| Home | `home.service.ts:40-54` | **no meetings part** |
| Module keys | `plan.service.ts:55-57` | `'meetings'` known. `ModuleGuard` has no consumers (`module-entitlements.ts:5-9`). |

### 1.5 Other code that already names a meeting

- `mapObjectTypeToTaskSourceType` (`workflow.service.ts:1513`).
- Task record names and search (`task-record-names.ts:51-62`).
- `record-link.util.ts:3`: "a meeting, today" is named without a link, because it has no page.
- The committee page's empty Meetings panel (`committee-detail.component.ts:366-370`).
- The `meeting_type` lookup (`lookup.seed.ts:229-243`).
- The AI draft context (`draft-record-context.ts:28-30`).
- The awaiting-me list (`workflow-awaiting.service.ts:46`).

### 1.6 Where schema and spec disagree

| Spec (`module-designs.md`) | Today |
|---|---|
| State is PLANNED … CANCELLED (`:764-810`) | `Meeting.status` text **and** a workflow stage: two places for one fact |
| Rescheduling keeps `rescheduleHistory` (`:764-769`, `:812-817`) | nothing |
| Attendance: present / absent / excused, quorum (`:779-788`) | nothing |
| Decisions with vote records (`:835-839`) | nothing |
| Action items become tasks at approval (`:797-804`) | nothing; `Task.meetingId` unused |
| Minutes reviewed by all attendees, PARALLEL ALL (`:790-795`) | seed: ALL on a starting assignment (one admin) |
| The chair approves (`:797-804`) | seed: Approve Minutes is a press on the review stage; the final stage has nobody |
| The secretary drafts the minutes (`:779-788`) | seed: CREATOR on the first three stages |
| Previous open tasks loaded into the agenda (`:771-777`, `:819-833`) | nothing |
| The presenter is a person | `AgendaItem.presenter` is text |
| — | no end time, no `organizationId` on `AgendaItem`, no FK on `typeValueId` |

The spec has **no recurring meetings and no calendar**.

---

## 2. Dependencies

### 2.1 SYSTEM-REFERENCE §11 items still open

| Item | Line | Needed? | Why |
|---|---|---|---|
| Lookup category UI | 13215 | no | `meeting_type` values are edited on the Lookups page |
| Task detail / INTERNAL_REFERENCE UI | 13218 | no | stale (the task page exists, ACC-228); action items need no record reference |
| (mostly fixed by ACC-302) | 13242 | no | — |
| Deactivation doesn't replace committee seats | 13266 | **no, but it shows here** | a departed Secretary empties the Minutes Draft pool: `STAGE_HAS_NO_ONE`, the stage is flagged unassigned, and Setup health already lists `COMMITTEE_MISSING_REQUIRED_SEAT` |
| AI provider selection | 13274 | no | Meetings AI is out of these slices |
| **SEQUENTIAL ordering** | 13326 | **no, obsolete** | dropped with the old who fields (ACC-278, SYSTEM-REFERENCE 3917–3919). Minutes review is one pool, Any one or All. |
| Validators | 13329 | no | `TRANSITION_PRECONDITIONS` does the record checks |
| `isCodeLocked` | 13334 | no | — |
| INTERNAL_REFERENCE raw id | 13336 | no | — |
| SMS / digest | 13339 | no | in-app and email only |
| Polling vs WebSocket | 13341 | no | votes are recorded by the secretary (Q4); a page reloads after each action |
| **ROUND_ROBIN** | 13344 | **no, obsolete** | dropped, as for SEQUENTIAL |
| Cycle detection | 13347 | no | — |
| SUSPENDED never set | 13351 | no | — |

### 2.2 The engine and the committee pieces

- **Stage-assignee RELATIVE mode: needed, and already built.** "The record's committee" (COMMITTEE with no fixed committee) and "the record's unit" (ORG_UNIT_HEAD with no fixed unit) resolve through `RECORD_ROUTES` (SYSTEM-REFERENCE 3379, 3381, 3499–3509; `stage-pool.service.ts:357`). MEETING has its entry (`stage-task-record-routes.ts:60`). So a meeting stage can say "the meeting's committee, Secretary seat" with no new code.
- **The vote path (ACC-284): not used for meeting decisions.**
  - A workflow committee vote decides **a move of the record**, by members' presses, against a quorum saved at stage entry (`workflow.service.ts:1043-1066`, `:1307-1320`; `workflow-vote.ts:21-25`, `:58-62`).
  - A meeting decision is **a topic voted on in the room**, recorded by the secretary.
  - The two are kept apart (§3.4). The engine is used only if Ahmad picks "Vote" for minutes approval (Q2).
- **Reference codes: not built and not needed** (CLAUDE.md 5432–5440, SYSTEM-REFERENCE 11809–11811). Q7 asks only about a per-committee meeting number, which is not the cross-module code.
- **What the committee seat rule (ACC-283) gives:**
  - the shape: `SEAT_ACTIONS` + lookup defaults + `writeSeatActions()` as the one writer;
  - `MEMBER_ACTIONS` + `assertMemberAction()` (`member-actions.ts:159`), "either the seat or the role grants" (step-283 §0);
  - the reserved keys `schedule_meeting` and `record_minutes` (`seat-actions.ts:8-11`).
- **What the committee seat rule lacks:**
  - the two meeting keys, their seat defaults and their backfill;
  - any rule for **who votes**: nothing says an Observer seat does not vote. §3.3 adds a seat attribute.
  - `assertMemberAction` takes a committee, so a meeting action resolves the meeting's committee first.
- **Task creation (ACC-280):** `acceptsTasksSql` and `create.types` need a MEETING line in `TASK_RECORD_TYPES` (§4.3).
- **Files and PDF:**
  - a signed minutes file needs `StoredFileOwnerType.MEETING`;
  - a minutes PDF needs `GENERATE_PDF`, which is a stub.
  - Both are left for later (§6).

---

## 3. Design (proposal)

### 3.1 The meeting record

- **A meeting belongs to one committee** (Q1, recommended). `committeeId` stays nullable in the schema, and the service requires it.
- **Its state is its workflow stage**, as for change requests (ACC-239):
  - the instance is created in the same transaction as the meeting (`startInstance()` prepare/insert/finish);
  - `Meeting.status` is no longer read, and is dropped in the contract PR.
- **New columns:**
  - `endsAt` (DateTime, required by the service after it is added);
  - `quorumRequired` (Int?: the committee's quorum, saved when attendance is first recorded);
  - `sequenceNo` (Int?, only if Q7 is Yes).
- **`typeValueId` gains its relation** to `LookupValue`. That is safe because 0 rows exist.
- **Times** are stored as UTC and shown in the organisation's zone (ACC-97) through `amDateTime`.
- **A committee may be given a meeting only where its stage allows it.** That is a new committee record action, `schedule_meeting`, seeded on the In force stages only, so a committee in Formation or Dissolved gets none.
- **Rescheduling** writes a `MeetingReschedule` row (from, to, reason, who, when) and tells the invitees after commit. Rescheduling is allowed only in Planned and Agenda Ready.
- **Cancel** is the seeded EXIT. It takes a reason, which the invitees read.

### 3.2 Agenda

- `AgendaItem` gains:
  - `organizationId` (NOT NULL is safe: 0 rows, and no code writes the table);
  - `presenterUserId` (FK User, nullable);
  - `presenter` stays, for a guest by name.
- `order` stays. The screen moves an item up or down; there is no drag.
- **Follow-up of earlier meetings (spec `:771-777`, `:819-833`)** is a READ, not a copy: open tasks whose record is an earlier meeting of the same committee, listed on the agenda. Nothing is written into the agenda.
- The agenda may be edited in Planned and Agenda Ready only (record action `manage_agenda`).

### 3.3 Attendance and quorum

- **`MeetingAttendee`** has these columns:
  - `organizationId` and `meetingId`;
  - `userId?` or `guestName?`, exactly one of the two;
  - `kind`: MEMBER or GUEST;
  - `seatValueId?`: the seat when invited, a snapshot;
  - `votes` (Boolean);
  - `attendance`: PRESENT, ONLINE, ABSENT, EXCUSED, or null for not recorded yet.
- It is unique on `(meetingId, userId)`.
- **Invitees are filled in at scheduling** from the committee's active members. Guests are added by hand (Q6).
- **Who votes** is a new seat attribute on `committee_member_role`, "votes in meetings". It defaults to true, and to false for Observer. Guests never vote.
- **Quorum met** means voting attendees PRESENT or ONLINE (Q3) ≥ `quorumRequired`. It is computed when read and saved on each decision when the decision is recorded.
- **Leaving Minutes Draft requires attendance recorded for every invitee.** This is a `TRANSITION_PRECONDITIONS` MEETING entry (`MEETING_ATTENDANCE_INCOMPLETE`), run early and inside the stage-change transaction like the committee quorum rule.

### 3.4 Decisions and vote records

- **`MeetingDecision`** has these columns:
  - `organizationId`, `meetingId` and `agendaItemId?`;
  - `order`, `topic` and `text`;
  - `voteType`: NONE (noted or consensus), OPEN or SECRET;
  - `votesFor`, `votesAgainst` and `abstentions` (Int?);
  - `quorumMet` (Boolean, a snapshot);
  - `outcome`: APPROVED, REJECTED, DEFERRED or NOTED.
- **`MeetingVote`** (`decisionId`, `attendeeId`, `choice` FOR, AGAINST or ABSTAIN; unique per decision and attendee) holds **who voted**, for OPEN votes only.
  - The counts on the decision are written from these rows in the same transaction.
  - A SECRET vote stores counts only, and no names.
- **The secretary records the votes** (Q4, recommended). Members do not vote in the app in these slices.
- **Votes are checked on save:**
  - the counts add up to at most the voting attendees present;
  - only voting attendees who are present may have a vote row.
- **Kept apart from the workflow's committee vote.** A meeting decision writes no `WorkflowApproval`, and a workflow vote writes no `MeetingDecision`. They answer different questions: "do we move this record?" and "what did the meeting decide on this topic?". The engine's threshold code (`workflow.service.ts:1043-1066`) is not reused for topics.

### 3.5 Minutes

- **Draft (Minutes Draft):**
  - attendance, decisions, action items and the narrative (`minutesText`) are edited;
  - this needs the record action `record_minutes`, plus the seat action `record_minutes` or the role key `meetings:record_minutes`.
- **Review (Minutes Review):**
  - the seeded stage changes to Q2's answer;
  - recommended: **the meeting's committee, Chair seat, Any one**, with Approve Minutes (ADVANCE) and Return for Correction (RETURN to Minutes Draft);
  - attendees read the draft and comment on the page.
- **Approved (Minutes Approved, final):**
  - no record action is allowed, so everything is read-only;
  - `minutesApprovedAt` is stamped in the move's transaction;
  - action items become tasks (§3.6).
- **What the seeded workflow becomes** (seed + `backfill:acc316-meeting-workflow`):
  - **remove the self-loop at `:256`.** No approval refers to it, because there are 0 instances.
  - Planned and Agenda Ready: the meeting's committee, Chair and Secretary seats, Any one.
  - Minutes Draft: the meeting's committee, Secretary seat, Any one.
  - Minutes Review: per Q2.
  - `isApprovalPath` is no longer sent.
  - Record actions and flags as in §4.2.
  - The backfill changes a stage's who **only while it is still the seed's**: CREATOR, or a starting assignment. A tenant's own edit is left alone and reported.

### 3.6 Decisions and action items as tasks

- **`MeetingActionItem`** (`organizationId`, `meetingId`, `decisionId?`, `agendaItemId?`, title, description, the assignment target with the New task cascade, priority, `taskId?`) is the **draft** of a task.
- **At approval (Q5, recommended)**, each item becomes one task in the approve move's transaction (`triggerTransition` `inTx`, ACC-239's hook):
  - `sourceType MEETING`, `sourceId` the meeting;
  - the creator is the approver;
  - its due date comes from `TaskSlaService` (ACC-174), never computed in the module.
- **Afterwards** the item shows its task's link and status. The task, not the item, is the work.
- **Ordinary tasks on a meeting** (New task with the meeting as the record) are allowed while the meeting is not cancelled (§4.3).
- `Task.meetingId` stays unused and is dropped in the contract PR.

---

## 4. Who sees and does what

### 4.1 Seeing

- **The parent rule (ACC-101, §1.9 869, 884–889)** gains a MEETING rule of the ACC-281 shape. A viewer may see a meeting with **any one** of:
  - `meetings:view` (oversight: every meeting);
  - an **active member of the meeting's committee** (`committee-membership.ts`, one indexed query, never for a `meetings:view` holder);
  - an **invitee of that meeting** (an attendee row with their user id, Q6).
- A refusal is 403 "Required permission: meetings:view" where the request names the meeting, and the identical 404 where it is known only from a row, as today.
- **A meeting list under a committee** also needs the committee to be visible (clause a).
- **The meeting's workflow** follows the record (`InstanceAccess`, `instance-access.ts:52-93`). Nothing new is needed beyond the visibility rule.
- **No query is added to the per-request path.** Every check is in the service, after the guard.

### 4.2 Doing

| Action | Who | Stage gate (`RECORD_ACTIONS` MEETING) |
|---|---|---|
| Schedule (create) | seat `schedule_meeting` on that committee, or `meetings:schedule` (new key) | the committee's stage allows `schedule_meeting` |
| Edit details, reschedule | the same | `edit_details` (Planned, Agenda Ready) |
| Edit agenda | the same | `manage_agenda` (Planned, Agenda Ready) |
| Record minutes, attendance, decisions, action items | seat `record_minutes`, or `meetings:record_minutes` | `record_minutes` (Minutes Draft) |
| Move the meeting | the stage's pool (ACC-271), never a key | — |
| Approve minutes | Minutes Review's pool (Q2) | — |

- **Two seat actions** (`seat-actions.ts`):
  - `schedule_meeting`, by default Chair and Secretary;
  - `record_minutes`, by default Secretary.
  - Each has a `committee_member_role` default attribute and a backfill that copies the defaults onto existing committees, the ACC-283 way.
- **`MEMBER_ACTIONS`** gains the same two (`member-actions.ts:25-52`), so `assertMemberAction()` stays the one check.
- **Keys:**
  - `meetings:schedule` is added;
  - `meetings:record_minutes` comes out of `PERMISSIONS_NOT_YET_CHECKED`;
  - `meetings:manage` becomes a seed-time umbrella (ACC-44);
  - **`meetings:approve_minutes` is retired** the ACC-244 way (catalogue, seed, then a backfill on roles that hold it). The stage pool decides approval, so the key would check nothing.
- **Stage flags** (`STAGE_FLAGS` MEETING, strings, no enum migration):
  - `MEETING_CANCELLED` on Cancelled;
  - `MINUTES_FINAL` on Minutes Approved (exactly one).
  - Screens and rules read the flags, never the key.
- **`RECORD_FIELDS` MEETING:** `typeValueId`, for step 2's conditions. It is defined and not read.

### 4.3 Registries, one line each

- **`ObjectVisibilityService`:** the MEETING rule above, with a batched form for lists.
- **`TASK_RECORD_TYPES`** gains MEETING:
  - the four keys `meetings:view_all_tasks`, `view_unit_tasks`, `create_tasks` and `manage_tasks`;
  - the owning unit SQL is the committee's `orgUnitId`;
  - record-exists SQL;
  - `acceptsTasksSql`: not on a stage flagged `MEETING_CANCELLED`.
- **`RECORD_ROUTES`:** already present (`:60`). No change.
- **`RECORD_ACTIONS`:** MEETING `edit_details`, `manage_agenda` and `record_minutes`, each with its `permissionKey`. COMMITTEE gains `schedule_meeting`.
- **`TRANSITION_PRECONDITIONS`:** MEETING, attendance recorded to leave Minutes Draft (§3.3).
- **`PROTECTED_TEMPLATES`:** unchanged. The meeting workflow stays tenant-editable.
- **`STAGE_ASSIGNEE_KINDS`:** unchanged.
- **Nav model:** a Meetings rail item after Committees, with `moduleKey: 'meetings'`. It shows to `meetings:view` holders and to committee members (`MyWorkCountsService.isCommitteeMember`, as ACC-281).
- **Home:** "My next meetings": self-scoped (invited, next 14 days, cap 5), one read added to Home's wave, no polling.

---

## 5. Screens

**There is no Meeting Screens design.** Five drawings cite one ("Meeting Screens round 5"):

- AI for Users `:25`, `:595`, `:613`;
- Administration `:25`;
- File Viewer `:25`;
- Record Tasks Panel `:24`;
- Storage Settings `:24`.

No such file is in `frontend/design-reference/` (Q8).

**Drawings that already exist:**

- Schedule meeting dialog: Design System `:786`, `:819`, `:1787`.
- Action items on a record: Record Tasks Panel `:445-451`, `:470`.
- The committee page's Meetings panel: Committee Record `:217`, `:224`, and Compact List Panel `:219`, `:227`, `:413`.
- Hijri dates: Design System `:1412`, `:1753`, `:1808-1810`.
- Meetings AI (AI for Users `:229-230`, `:473-613`) and calendar availability (Administration `:272-498`) are out of these slices.

**Shared patterns reused, none rebuilt:**

| Screen | Pattern |
|---|---|
| `/meetings` list | `app-data-list` + `am-sort-header` (§10.20), filters for committee, stage and date |
| Committee page Meetings panel | `am-capped-panel` (five, See all → `am-list-dialog`), replacing the empty panel `committee-detail.component.ts:366-370` |
| Meeting page | `RecordPanel` (§10.8), the moves from `GET /workflows/instances/:id/moves`, the Tasks panel (§3.13), Stage history |
| Schedule / Edit / Reschedule / Cancel | `EditDialogComponent`. **Measure against the 420 cap first, in both languages** (ACC-120); step only if over. |
| Agenda editor | a panel on the page; up/down to reorder; presenter via `OverlaySelectComponent` |
| Attendance | a panel, one row per invitee, a segmented choice per row |
| Decision dialog | `EditDialogComponent`; with OPEN votes, likely over 420 → stepped on its seam (the decision, then the votes) |
| Action item dialog | the New task cascade (ACC-280's `TaskNewDialogComponent` fields), saved as a draft item |
| Minutes narrative | a text panel, read-only after Minutes Draft |
| "Can't move yet" | `CantMoveDialogComponent` (ACC-208) for `MEETING_ATTENDANCE_INCOMPLETE` |
| Home | a capped panel |

Every date goes through the formatting layer. Every refusal is said from its code, in both languages.

---

## 6. Slices

Each PR deploys before the next. Every migration is expand only.

1. **PR 1: the seeded workflow and the meeting registries** (backend).
   - Changes:
     - seed fix (§3.5) and `backfill:acc316-meeting-workflow` (dry run, `-- --execute`, dry run 0);
     - `RECORD_ACTIONS`, `STAGE_FLAGS` and `RECORD_FIELDS` MEETING;
     - COMMITTEE `schedule_meeting`.
   - **No migration.**
   - **Live after:** the Workflow page shows the corrected Meeting workflow with its actions and flags; the self-loop is gone.
2. **PR 2: the schema and the keys.**
   - Migration `acc316_meeting_records`:
     - `MeetingAttendee`, `MeetingDecision`, `MeetingVote`, `MeetingActionItem`, `MeetingReschedule`;
     - `AgendaItem.organizationId` and `presenterUserId`;
     - `Meeting.endsAt`, `quorumRequired` and `sequenceNo`;
     - the `typeValueId` FK.
   - The seat actions `schedule_meeting` and `record_minutes` and the "votes in meetings" attribute, with lookup defaults and `backfill:acc316-seat-defaults`.
   - `meetings:schedule` added; `approve_minutes` retired with `backfill:acc316-retire-approve-minutes`.
   - **Live after:** the seat screens show the two new actions; nothing else is visible.
3. **PR 3: meetings, backend.**
   - Changes:
     - schedule (meeting + instance in one transaction), read, paged list, edit, reschedule, cancel;
     - agenda;
     - the visibility rule;
     - `TASK_RECORD_TYPES` MEETING;
     - invitee notices after commit.
   - **No migration.**
   - **Live after:** the API (no screen).
4. **PR 4: minutes, backend.**
   - Changes:
     - attendance and quorum; decisions and votes; action items; the narrative;
     - the attendance precondition;
     - the approve hook that creates tasks;
     - the earlier-meetings follow-up read.
   - **No migration.**
   - **Live after:** the API (no screen).
5. **PR 5: meeting screens, part 1** (after the design, Q8).
   - The rail item, `/meetings`, the committee page panel, the Schedule/Edit/Reschedule/Cancel dialogs, and the meeting page with agenda, moves, Tasks panel and history.
   - **Live after:** a committee can schedule and run a meeting up to Minutes Draft.
6. **PR 6: meeting screens, part 2.**
   - Attendance, decisions and votes, action items, minutes, review and approve; Home's "My next meetings".
   - **Live after:** the whole meeting, to approved minutes and tasks.
7. **PR 7: contract.**
   - Drop `Meeting.status` and `Task.meetingId`, after nothing reads them.
   - **Live after:** no change a person sees.

**Not in these slices:** calendar availability (ACC-293), Meetings AI, recurring meetings, files on a meeting (`StoredFileOwnerType.MEETING`), a minutes PDF (`GENERATE_PDF`), members voting in the app, the cross-module reference code.

---

## 7. Questions for Ahmad

Each takes one word. **(recommended)** marks my suggestion.

**Q1. Must every meeting belong to a committee?**
- Yes **(recommended)**
- No

*Every rule here (who schedules, who sees, quorum) comes from the committee. A meeting with no committee would need rules of its own.*

**Q2. Who approves the minutes?**
- Chair **(recommended)**
- Everyone present
- Vote

*"Everyone present" means one person who never answers holds the minutes up. "Vote" makes it a committee vote in the app.*

**Q3. Do members who join online count toward the quorum?**
- Yes **(recommended)**
- No

**Q4. Who records the votes?**
- Secretary **(recommended)**
- Members

*With "Secretary", members vote in the room and the secretary writes down each vote. "Members" means each member votes in the app, which is a later slice.*

**Q5. When do action items become tasks?**
- Approval **(recommended)**
- Recording

*At approval, a correction during review can't leave a wrong task behind. That is what the spec says.*

**Q6. May a meeting invite guests who are not committee members?**
- Both **(recommended)**: app users, and outside people by name
- Users: app users only
- No

*Guests never vote. An app user who is a guest may open that meeting.*

**Q7. Show a meeting number per committee and year (for example "Meeting 3, 2026")?**
- Yes **(recommended)**
- No

*This is not the cross-module reference code, which stays a separate decision.*

**Q8. Is there a "Meeting Screens" design to add to the repo?** Five drawings cite one, but no such file is there.
- Yes **(recommended)**: export it before PR 5
- No: draw it first

---

## 8. Technical choices lane B decides (not asked)

- The meeting's state is its stage; `Meeting.status` is dropped later (§3.1).
- Meeting votes are their own tables, separate from `WorkflowApproval` (§3.4).
- The "votes in meetings" seat attribute (§3.3).
- `meetings:approve_minutes` is retired, and `meetings:schedule` added (§4.2).
- The stage flags are `MEETING_CANCELLED` and `MINUTES_FINAL`, as strings with no enum migration (§4.2).
- Follow-up of earlier meetings is a read, not a copy (§3.2).
- The backfill leaves a tenant's own edits to the Meeting workflow alone (§3.5).
- `AgendaItem.organizationId` is NOT NULL from the start (0 rows, no writer).
- Seat defaults: `schedule_meeting` for Chair and Secretary, `record_minutes` for Secretary (§4.2).
- Every list pages on the server or has a stated cap; no query on the per-request path; no polling.
