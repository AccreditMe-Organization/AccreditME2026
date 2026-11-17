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
- **Rescheduling** writes a `MeetingReschedule` row (`organizationId`, `meetingId`, from, to, reason, who, when) and tells the invitees after commit. Rescheduling is allowed only in Planned and Agenda Ready.
- **Cancel** is the seeded EXIT, a person's press. Its reason is the press's own `comment`, made REQUIRED for a move into a stage flagged `MEETING_CANCELLED` (§9.2). The invitees read it.
- **Every new table carries `organizationId`**, and every query scopes by it with the id in the same `where` (CLAUDE.md, Multi-Tenancy).

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
- **`MeetingVote`** (`organizationId`, `decisionId`, `attendeeId`, `choice` FOR, AGAINST or ABSTAIN; unique per decision and attendee) holds **who voted**, for OPEN votes only.
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
  - attendees **read the draft only**. No comment feature exists, and none is built in these slices (§9.5).
- **Approved (Minutes Approved, final):**
  - no record action is allowed, so everything is read-only;
  - `minutesApprovedAt` is stamped, and the action items become tasks (§3.6), **in the press's own stage-change transaction**, through a per-record-type registry of entry effects keyed by the `MINUTES_FINAL` flag (§9.1).
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
- **At approval (Q5, recommended)**, each item becomes one task inside the stage-change transaction of the move that enters `MINUTES_FINAL`, through the entry-effects registry (§9.1). It is NOT ACC-239's `inTx`, which only an APP move takes:
  - `sourceType MEETING`, `sourceId` the meeting;
  - the creator is whoever made the move happen: the approver, or on "Everyone present" or "Vote" the deciding voter;
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
- **An invited guest who is not a member** has no Meetings rail item, and needs none. They reach the meeting by the bell, Home's "My next meetings" and the invitation email, each linking to `/meetings/:id`. That route carries its own `permissionGuard` and no route permission, as the task page does (`tasks.routes.ts:27-38`), so the server's rule decides (§9.7).

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
- **Entry effects (new, §9.1):** `TRANSITION_EFFECTS`, beside `TRANSITION_PRECONDITIONS`, per record type and keyed by the flag entered. MEETING: entering `MINUTES_FINAL` stamps `minutesApprovedAt` and creates the action items' tasks.
- **A move that needs a reason (new, §9.2):** a per-record-type rule keyed by the flag entered. MEETING: a move into `MEETING_CANCELLED` needs a `comment`. The moves list says so per move (`needsReason`).
- **Links:** `recordPageLink()` (`record-link.util.ts:9-15`) and the bell's `notificationLink()` (`notification-links.ts:8-13`) each gain `MEETING → ['/meetings', id]`.
- **Notices:** every new notification is written in English and Arabic (`Notification.titleAr`/`bodyAr` are nullable, so this is a rule, not a constraint). No count in a stored notice (§9.6).

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
     - the `typeValueId` FK;
     - **only if Q2 is "Everyone present":** the `StageAssigneeKind` value `MEETING_ATTENDEES` (§9.3). No row may hold it before PR 4 deploys (ACC-173's enum rule).
   - The seat actions `schedule_meeting` and `record_minutes` and the "votes in meetings" attribute, with lookup defaults and `backfill:acc316-seat-defaults`.
   - `meetings:schedule` added; `approve_minutes` retired with `backfill:acc316-retire-approve-minutes`.
   - **Live after:** the seat screens show the two new actions; nothing else is visible.
3. **PR 3: meetings, backend.**
   - Changes:
     - schedule (meeting + instance in one transaction), read, paged list, edit, reschedule, cancel;
     - agenda;
     - the visibility rule;
     - `TASK_RECORD_TYPES` MEETING;
     - the move-needs-a-reason rule (§9.2): `REASON_REQUIRED` on a cancel with no comment, and `needsReason` on the moves list;
     - invitee notices after commit, in English and Arabic.
   - **No migration.**
   - **Live after:** the API (no screen).
4. **PR 4: minutes, backend.**
   - Changes:
     - attendance and quorum; decisions and votes; action items; the narrative;
     - the attendance precondition;
     - `TRANSITION_EFFECTS` (§9.1): entering `MINUTES_FINAL` stamps `minutesApprovedAt` and creates the action items' tasks, in the press's own transaction, for Any one, All of them and a committee vote alike;
     - only if Q2 is "Everyone present": the `MEETING_ATTENDEES` pool resolver (§9.3);
     - the earlier-meetings follow-up read.
   - **No migration.**
   - **Live after:** the API (no screen).
5. **PR 5: meeting screens, part 1** (after the design, Q8).
   - The rail item, `/meetings`, the committee page panel, the Schedule/Edit/Reschedule/Cancel dialogs, and the meeting page with agenda, moves, Tasks panel and history.
   - `/meetings/:id` with its own `permissionGuard` and no route permission (§9.7); the bell and `recordPageLink()` lines.
   - The move buttons (`WorkflowTransitionActionsComponent`) ask for a reason when the server says `needsReason` (§9.2), for every module.
   - **Live after:** a committee can schedule and run a meeting up to Minutes Draft.
6. **PR 6: meeting screens, part 2.**
   - Attendance, decisions and votes, action items, minutes, review and approve; Home's "My next meetings".
   - Only if Q2 is "Everyone present" or "Vote": a vote progress line on the review stage (§9.3).
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

*What each answer costs to build is in §9.3. Chair needs nothing new.*

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
- Approval's writes go through an engine registry of entry effects, not `inTx` (§9.1).
- A move into a cancelled stage needs a reason, and the move buttons ask for it (§9.2).

---

## 9. Review round 1 (Prompt 121, 17 Nov)

Lane B's eight points. §3, §4, §6 and Q2 are corrected to match. Ahmad's
answers to Q1–Q8 are not in yet; nothing here waits for them.

### 9.1 The approve hook

**What the first draft got wrong.** It said the tasks are created through
`triggerTransition`'s `inTx`. There is no such thing:

- `inTx` belongs to `triggerSystemTransition()` (`workflow.service.ts:928-937`).
- `applyMove()` refuses it for anything but an APP move (`:1180-1186`).
- Approve Minutes is a PERSON move, pressed by the stage's pool.

**How a person's press reaches the database today:**

- **Every way a press lands goes through one method, `performTransition()`**
  (`:1072-1092`):
  - Any one: `:678`;
  - a RETURN or EXIT on a stage decided together: `:699`;
  - the deciding vote of All of them, or of a committee vote: `:709`;
  - the vote screen's path through `maybeAdvanceAfterApproval()`: `:860`, `:866`.
- **`performTransition()` runs three steps:**
  - `prepareMove()` (`:1099`): every read, before the transaction;
  - `applyMove()` (`:1152-1225`), under `STAGE_CHANGE_TX`. It takes the
    instance row lock (`:1158`), re-checks the entry, runs the gate and the
    preconditions (`:1177`), then exits, cancels, enters and inserts the entry's
    tasks (`:1191-1215`);
  - `finishMove()` (`:1228-1250`): after commit, it audits, notices, announces
    the tasks (`:1240`) and fires the transition actions (`:1246`).

**(a) Entry effects, keyed by the flag entered. Recommended.**

- **The registry:** `TRANSITION_EFFECTS` (`transition-effects.ts`, beside
  `transition-preconditions.ts`), `Partial<Record<WorkflowObjectType, …>>`.
  - It is FAIL OPEN: a type with no entry has no effect, as for preconditions.
  - Each entry has three parts:
    - `prepare(prisma, ctx)`: reads only, run in `prepareMove()`;
    - `apply(tx, prepared, ctx)`: writes only, run in `applyMove()` after the
      preconditions and before the exit;
    - `finish(prepared, applied, ctx)`: audits and notices, run in
      `finishMove()`.
  - `ctx` carries the record id, the organisation, the actor, the move's kind,
    and **both stages' flags**, the shape `TransitionPreconditionContext`
    already has (`transition-preconditions.ts:21-31`).
- **MEETING's entry:**
  - it fires when `toStageFlags` includes `MINUTES_FINAL` and `fromStageFlags`
    does not;
  - `prepare` reads the action items and builds one prepared task each, with
    `TaskService.prepareRecordTask()` (`task.service.ts:436`, ACC-239's
    record-task path). That gives the SLA window and the assignees, all before
    the transaction;
  - `prepareRecordTask()` takes assignee user ids only. An action item that
    targets a unit, a position or a committee seat (the New task cascade) needs
    it to accept that target, and to make a pool task as `create()` does
    (ACC-167). That is a PR 4 change;
  - `apply` locks the meeting row FOR UPDATE and checks that the action items
    did not change since `prepare`, by count and the newest `updatedAt`
    (`MEETING_CHANGED`, 409, nothing written). It then stamps
    `minutesApprovedAt`, inserts the tasks (`insertPrepared()`, `:332`) and
    writes each item's `taskId`;
  - `finish` announces the tasks (`announceCreated()`, `:342`) and writes one
    Meeting audit row.
- **It is the same for Any one, All of them and a committee vote**, because all
  three land in `performTransition()`:
  - the effect runs once, on the move that actually fires;
  - a vote that does not reach its threshold never gets there (`:702-706`);
  - the actor, and so the tasks' creator, is the presser, or the deciding voter.
- **ACC-190's rules hold:**
  - every read is in `prepare`, before the transaction;
  - lock order is the instance (`:1158`), then the meeting row, then no task
    lock (the tasks are new rows). That is ACC-255's order: instance, then the
    record row;
  - notices go out in `finish`, after the commit.
- **Correctness does not depend on `prepare` being current:**
  - Minutes Review allows no `record_minutes` action, so nobody can edit an
    action item while the meeting sits there;
  - a RETURN and a fresh edit between `prepare` and the lock are caught twice:
    the entry re-check (`:1159-1167`) and the action-item check in `apply`.
- **The `inTx` rule stays as it is:** a caller still cannot hand a PERSON move
  a write of its own. The effect is declared per record type in the engine's
  registry, like a precondition, and every caller's press runs it. That is not
  a module's ad-hoc write.
- **Costs:** three calls in the engine, behind a cheap `hasTransitionEffect()`
  check (as `hasTransitionPrecondition()` does), so other record types pay
  nothing.

**(b) Approve as the module's own endpoint firing an APP move.**

- It works only for **Any one**, for these reasons:
  - `triggerSystemTransition()` records no vote and checks no threshold;
  - with All of them or a committee vote, the module would have to rebuild the
    vote path (`recordVote()`, `isApprovalThresholdMet()`, the quorum snapshot);
  - an APP move is never offered to the pool (`getMovesForViewer()` lists
    PERSON moves only, `:351`). So the review stage's buttons would come from
    the module, not from the server's moves list, which breaks ACC-271's "the
    buttons show what the server says".
- It also makes Approve a move a tenant cannot reshape on the stages page,
  because the app runs it.

**Decision: (a).** It is the only one of the two that holds for all three
answers to Q2.

### 9.2 Cancel's reason

**Today:**

- A press carries an OPTIONAL `comment` (`trigger-transition.dto.ts:8-11`, at
  most 2,000 characters; on a vote, `submit-approval.dto.ts:17`).
- It is stored on the entry being left (`applyMove()` `:1191`, column
  `WorkflowInstanceStage.comment`, `schema.prisma:1399`). A vote's comment is
  stored on the vote (`:798`).
- The stage history shows it as the reason for the move into the next visit
  (`:509-511`).

**What is missing:**

- **The buttons never send one.** `WorkflowTransitionActionsComponent` posts
  `{ transitionId }` only (`workflow-transition-actions.component.ts:127`).
- **Nothing can make a reason required for a move.** No field, registry or
  refusal exists for it (a grep for `requiresComment`, `needsReason` and
  `REASON_REQUIRED` finds nothing).
- **The seeded transition actions don't pass the comment** to the notified
  people.

**Proposed:**

- **A per-record-type rule, keyed by the flag entered**, read in
  `triggerTransition()` and `submitApproval()` before anything is recorded.
  MEETING: a move into a stage flagged `MEETING_CANCELLED` needs a non-blank
  comment. A press without one gets 400 `REASON_REQUIRED`, naming the move in
  both languages.
- **The moves list** (`GET /workflows/instances/:id/moves`) gains
  `needsReason: boolean` per move.
- **The move buttons** open a small reason dialog for such a move. That is one
  change, for every module: a committee's Dissolve can use it later.
- **The meeting reads the reason** from its stage history. The invitees'
  cancellation notice quotes it, after commit.
- **Not a new column:** `Meeting` gets no `cancelReason`. The entry's comment
  is the one place it lives.

### 9.3 What each answer to Q2 costs

**Chair (recommended): nothing new.**

- **The stage's who:** `{ mode: 'ANY_ONE', entries: [{ kind: 'COMMITTEE',
  committeeRoleValueId: <the chairman seat> }] }`.
  - No `committeeId` means the meeting's committee, through `RECORD_ROUTES`
    (`stage-task-record-routes.ts:60`). The kinds are in `stage-who.ts:47-54`.
  - The seed resolves the `chairman` value per organisation (`lookup.seed.ts:69`).
- **The screen:** the chair sees Approve Minutes and Return for Correction.
  Everyone else who may open the meeting reads the draft, with no buttons.

**Everyone present: a new assignee kind.**

- **The stage's who:** `{ mode: 'ALL', entries: [{ kind: 'MEETING_ATTENDEES' }] }`.
- **New:**
  - the `StageAssigneeKind` value `MEETING_ATTENDEES` (an enum migration, under
    ACC-173's rule);
  - its `KIND_FIELDS` entry (`stage-who.ts:47`), with no fields;
  - `STAGE_ASSIGNEE_KINDS.MEETING` only (`stage-who.ts:28`), so no other record
    type offers it;
  - a batched `StagePoolService` resolver: present or online attendees with a
    user, active only;
  - its sentence on the stage panel, in both languages.
- **The screen:**
  - each present attendee sees Approve Minutes, which is a vote (ACC-284), and
    Return for Correction;
  - **new:** a progress line on the meeting page ("3 of 7 have approved").
    Today the moves list says only which moves a viewer may press, not how far
    a vote has got (`getMovesForViewer()` `:319-360`).
- **The risk:** one present attendee who never answers holds the minutes up.
  The stage's SLA escalates, and a leaver is already handled
  (`POOL_MEMBER_LEFT`, ACC-271 PR 4).

**Vote: no new kind.**

- **The stage's who:** `{ mode: 'COMMITTEE_VOTE', entries: [{ kind: 'COMMITTEE' }] }`
  (`MODE_ONLY_WITH_SINGLE`, `stage-who.ts:66`).
  - The quorum is the committee's, saved when the stage is entered
    (`quorumSnapshot()`, `:1307-1320`).
  - **Every active member** votes, present at the meeting or not. Observers
    vote too, because a committee vote takes no seat narrowing.
- **The screen:** each member sees Approve Minutes (a vote) and Return for
  Correction, and needs the same progress line as Everyone present.

### 9.4 `organizationId` on every new table

`MeetingVote` and `MeetingReschedule` now list it (§3.4, §3.1). §3.1 states the
rule for every new table. All five new tables carry it:

- `MeetingAttendee`;
- `MeetingDecision`;
- `MeetingVote`;
- `MeetingActionItem`;
- `MeetingReschedule`.

### 9.5 No comments on the minutes

No comment feature exists anywhere in the app. In these slices, attendees **read
the draft only** (§3.5 corrected). Asking for a correction is the Minutes Review
pool's Return for Correction, with its reason (§9.2).

### 9.6 Notices

- **Every new notification has English and Arabic** (`titleEn`/`titleAr`,
  `bodyEn`/`bodyAr`). The Arabic columns are nullable (`schema.prisma:1852-1860`),
  so this is a rule the meeting notices keep, checked by their specs.
- **The new notices:**
  - invited;
  - rescheduled (with the new time);
  - cancelled (with the reason);
  - minutes ready for review;
  - minutes approved.
  - The action items' tasks use the existing task notices
    (`announceCreated()`).
- **`counted()` does not exist.** ACC-95 is not built: a search of `backend/src`
  and `frontend/src/app` finds no `counted` helper. SYSTEM-REFERENCE
  10356–10360 records server-built text as ACC-95's open gap.
- The one backend plural is English-only (`briefing-answer.ts:69`).
- **So no meeting notice carries a count.** Each is worded without a number
  (for example "The minutes of {meeting} are ready for your review", not "3
  decisions to review"). A count in a stored notice waits for ACC-95's helper,
  and uses it then.

### 9.7 An invited guest who is not a committee member

- **No rail item, by design.** The Meetings item shows to `meetings:view`
  holders and committee members (§4.3).
- **They reach the meeting by:**
  - **the bell:** the invitation notice carries `objectType MEETING`, and
    `notificationLink()` gains `MEETING → ['/meetings', id]`
    (`notification-links.ts:8-13`);
  - **Home's "My next meetings":** self-scoped, so it lists meetings they are
    invited to whatever their keys;
  - **the invitation email's link.**
- **The route:** `/meetings/:id` carries its own `permissionGuard` and no route
  permission, as the task page does (`tasks.routes.ts:27-38`). The list path
  `/meetings` keeps the rail item's gate. The server's visibility rule admits
  the guest by their attendee row (§4.1), and anyone else gets the page's
  not-found state.
- **What a guest sees:** the meeting page read-only. They see no Tasks panel
  unless they are on a task, because task visibility is unchanged.

### 9.8 Prompt 117's counts

These are in the outbox report, not the plan.
