# ACC-316 — Meeting Management

Plan only. Rewritten on 18 Nov 2026 against the decided design, on branch
`docs/ACC-316-meetings-plan`. No code, no schema change, no migration, no
database write.

**The authority is the design thread, not this plan.** Where they disagree, the
design thread wins. Its files:

- **Ahmad's summary of every answer** (6 Oct – 10 Nov):
  `lane-b-bus/meetings-design/meetings-questions-and-answers.md`. Below it is
  called **Answers**.
- **The final design**, round 5, version `1794312240-6d54`:
  `frontend/design-reference/AccreditMe Meeting Screens.dc.html`, copied
  unchanged in `86cc3f3`. Below it is called **Design**.
- **The brief and the rounds**, all in `lane-b-bus/meetings-design/`:
  - the brief (6 Oct);
  - review 1 (6 Oct);
  - the decisions check (9 Nov);
  - rounds 3, 4 and 5;
  - the round 3 review (10 Nov).

**Lane B's decision on the one point the files don't cover (Prompt 124):**

- an attendee who joins online counts as **present**, including for quorum;
- attendance has **no separate online kind**.

**Measured on the shared database (17 Nov, read only):**

| Organisation | Meetings | Agenda items | Meeting instances | Meeting tasks | Meeting templates | Self-loop moves |
|---|---|---|---|---|---|---|
| al-manara | 0 | 0 | 0 | 0 | 1 | 1 |
| al-nakheel | 0 | 0 | 0 | 0 | 1 | 1 |
| platform | 0 | 0 | 0 | 0 | 0 | 0 |

No backfill below touches a meeting. Each touches configuration only: the
Meeting workflow template, seat defaults and roles.

---

## 0. What is decided (from the design thread)

A short index. Each line names its source.

**Owner and visibility**

- **A meeting belongs to one committee OR one org unit**, never both and never
  neither (Answers, lane B Q1; brief 1.1).
  - A unit meeting's invitees default to the unit's people.
  - It has a quorum only if the organiser sets one.
- **Who sees a meeting:** its committee's or unit's people, its guests, and
  anyone allowed to see all meetings (brief 1.12).
  - Nobody else sees it, in the list, on the record or by link.
  - The committee or unit panel shows a restricted line (Design, Meetings panel
    "Denied").

**Stages and moves (Answers, agenda naming)**

- **The flow:** Planned → Issue Agenda → Agenda Issued → Record Minutes →
  Minutes Draft → Distribute Minutes → Minutes Review → Approve Minutes →
  Minutes Approved.
- **The other moves:**
  - Return for Correction: Minutes Review → Minutes Draft;
  - Cancel Meeting: from Planned and from Agenda Issued.
- **The draft-to-draft loop is dropped.**
- **The stage IS the status** (brief 1.3).
- **Who works each stage** (Design, "Who works this stage"):
  - Planned, Agenda Issued and Minutes Draft: the Secretary;
  - Minutes Review: the Chair.
  - Present members review, but don't move the meeting.
- **What is editable when:** Design's "What is editable when · and by whom" table,
  copied in §3.8.

**Agenda**

- **Ordered items:** title, description, a presenter chosen from people,
  duration (with a running total), and papers (brief 1.4; Design).
- **Editable after issue**, and members are told again with what changed
  (Answers, round 1 Q1).
- **A presenter who is neither a member nor a guest** is added as a guest
  automatically (round 1 Q12). **Outside guests may present** (10 Nov).
- **Fixed sections:**
  - standing items a series copies in (brief 1.10; Design);
  - a fixed first section, "Open actions from the last meeting", read from
    their tasks, with a Secretary's note on each in Minutes Draft (round 3 B5).

**Attendance and quorum**

- **Present / Apologies / Absent per invitee**, saved on each tap. Online counts
  as present (lane B).
- **Quorum** is the committee's AS AT attendance, or the unit meeting's own
  (brief 1.5; Design).
- **Quorum not met:** the minutes are recorded as normal, the quorum line is
  printed, and every decision is marked "Taken without quorum" (Answers Q6, lane
  B Q8).

**Guests (Answers, round 4)**

- **A person in the organisation:**
  - told in the app and by email;
  - may own an action item (R3-7);
  - sees the minutes only after approval (round 1 Q9);
  - not counted toward quorum.
- **An outside guest:**
  - name and email required, organisation and role optional; the email's
    format is checked with the existing `storage.request.contactEmailInvalid`
    (R4-2);
  - emailed three times:
    - the invitation, when the agenda is issued, or at once if added in Agenda
      Issued ("Add and send invitation");
    - the reschedule (new time and reason);
    - the cancellation (reason).
    - The last two go only to those already invited.
  - No papers, no minutes, no link into AccreditMe. Not counted toward quorum;
    never owns an action item; may present.
  - "Told" counts list them on their own ("1 outside guest by email").
- **Emails are the product's plain subject plus one paragraph** (R4-3).

**Minutes and votes**

- **Minutes per agenda item:** discussion and decisions (lane B Q3).
- **A decision may record a vote as counts only:** For, Against, Abstain, which
  can't add up to more than the members present (lane B Q4; round 3 A5).

**Review (Answers, lane B Q5 and Q6; round 3 A2)**

- **Distribute Minutes asks for "Review by"**, defaulting to 5 working days
  ahead.
- **Present members answer** "No corrections" or "Suggest a correction…":
  - a suggestion is about one agenda item, or the minutes as a whole;
  - a member may suggest until the date, replacing their "No corrections"
    (R3-2);
  - the Chair answers as a present member too (R3-5).
- **Silence counts as no corrections.** One reminder goes one working day
  before the date.
- **The Secretary applies or declines each suggestion**, a decline with a
  reply. Applied changes are listed for reviewers. The date doesn't restart.
- **Return for Correction** (Secretary or Chair, optional reason, R3-4) sends
  the minutes back to Minutes Draft:
  - answers reset;
  - suggestions stay as history, marked with the earlier review's date (R3-3);
  - distributing again starts a new review with a new date.
- **Approve Minutes is the Chair's alone.** It is ready once:
  - the date has passed or every present member has answered; and
  - no suggestion is open; and
  - no draft action item is past due.

  Until then it is disabled, with its reason.

**Action items (Answers, lane B Q7; round 3 A3)**

- **Drafts in Minutes Draft:** what, owner (a person), due date, inside an
  agenda item.
  - No task exists yet, and the owner isn't told.
  - Reviewers may suggest corrections to them.
- **At Approve Minutes, each becomes a task about the meeting**, keeping "From
  item n", and the owners are told.
- **A draft whose due date has passed blocks approval**, naming the item.
- **After approval**, the meeting's Action items is the record's tasks panel.

**Series (Answers, Ahmad's own; round 3 A8–A9; round 4 point 5)**

- **Every** 1 or 2 weeks, or 1, 3, 6 or 12 months.
- **On:**
  - a weekday;
  - a day 1–31 (a missing day falls on the month's last day); or
  - "the first … fourth / last [weekday]".
- **Weekend and holiday moves** go to the next free working day.
- **The committee's frequency sets the starting pattern.**
- **Ends** on a date or after a number of meetings (Design step 2).
- **Titles:**
  - the subject plus the month ("· October 2026") or, for a weekly series, the
    date ("· 22 Oct 2026");
  - "5 of 12" is its own line;
  - each title is editable on its own, and rescheduling doesn't rename it;
  - a moved date keeps the pattern's month (R4-1).
- **Reschedule and cancel**, for one meeting or "this and all later":
  - a reason is required for reschedule, which then shows "Rescheduled from …";
  - a later meeting edited on its own keeps its own edit (round 1 Q10);
  - past meetings never change.
- **Clashes are a warning, never a block** (Answers; round 5; R5-1 to R5-7):
  - another non-cancelled AccreditMe meeting the invitee is invited to
    overlaps;
  - back-to-back is not a clash;
  - the same series counts;
  - outside guests aren't checked;
  - a meeting the scheduler can't open reads "another meeting".
  - Outlook rows only when Calendar availability is on (ACC-293, not here).

**Out of v1** (Answers):

- a meeting number (titles cover it);
- `.ics` invites;
- a PDF (a browser print page now, A4, English and Arabic);
- confidential agenda items;
- publishing to Document Management;
- e-signatures;
- a Hijri picker.

**Attachments** are plain: they open in the in-app file viewer (lane B Q12).

### Ahmad's decisions, 18 Nov (Prompt 128)

**Permissions and the unit tree**

- **Own unit.** `meetings:schedule` (new), `meetings:record_minutes` and
  `meetings:approve_minutes` count only for meetings of the holder's own unit
  (`primaryOrgUnitId`). `meetings:approve_minutes` is **kept, not retired**.
  `meetings:schedule` also counts for committees that unit owns
  (`Committee.orgUnitId`).
- **Seeing down the tree.** The head or acting head of a unit sees every
  meeting of the units below it, and of the committees those units own:
  - headship is read through `unit-headship.ts`;
  - sub-units come from `findUnitSubtreeIds`;
  - they appear in a separate "Sub-units' meetings" list;
  - the root head sees all.
  - `meetings:view` stays "see all".
- **Two new keys, `meetings:schedule_subunits` and
  `meetings:approve_subunits`.** Each needs the key AND being head or acting
  head of an ancestor unit.
  - "Schedule" covers edit, reschedule, agenda, guests, cancel and Issue Agenda.
  - "Approve" covers Approve Minutes and Return for Correction. Its holder reads
    the draft from Minutes Review on.
- **No "record sub-units" key.** A committee's minutes are approved only by its
  Chair (the seat), never by a head above; a head above may see and schedule
  them.
- **Committee meetings otherwise stay on seats.** `meetings:manage` stays a
  seed-time umbrella.
- **Minutes Review's pool for a unit meeting:** the own-unit
  `meetings:approve_minutes` holders, plus heads above who hold
  `meetings:approve_subunits` (§3.8).

**Answering the invitation**

- **The answers:** a user invitee answers "Attending" or "Can't attend", with an
  optional note. There is no Tentative.
  - They may change it until the meeting starts.
  - Outside guests don't answer.
- **"Can't attend" pre-fills attendance** as Apologies, and the Secretary still
  confirms on the day.
- **A change to "Can't attend" tells the scheduler in the app, at once**, with
  the note. It is flagged when it puts quorum at risk, or when the person is the
  Chair, the Secretary or a presenter.
  - There is no separate reschedule or cancel request; this is the request.
- **The scheduler sees "6 attending · 2 can't · quorum 5"**, with a warning when
  attending is below quorum.

### Lane B's decisions, 18 Nov (Prompt 128)

- **A unit's people** are its own active people, with no sub-units. The
  scheduler can add more.
- **Outside guest emails** are in the organisation's language.
- **A series is capped at 12 months ahead**, and all its meetings are created at
  once (brief 1.10).
- **Members read the minutes from Minutes Review on.**
- **(Prompt 124) Online counts as present.**

---

## 1. What exists today

### 1.1 Schema

- **`Meeting`** (`schema.prisma:2137-2161`) has these columns:
  - `committeeId` is **nullable**, and there is **no `orgUnitId`**;
  - `organizerId` and `title`;
  - `typeValueId` is a plain `String`, with **no relation**;
  - `scheduledAt`, with **no duration**;
  - `location` and `meetingUrl`;
  - **`status String @default("DRAFT")`**;
  - `minutesText` and `minutesApprovedAt`.
- **`AgendaItem`** (`:2163-2175`):
  - It has `title`, `description`, `order`, `duration` and **`presenter String?`**
    (text).
  - It has **no `organizationId`**, against the multi-tenancy rule.
- **`Task.meetingId`** (`:1521`, index `:1633`) has no relation, and nothing
  writes it.
- **Missing models:** there is **no series, invitee, attendance, decision,
  action item, review, suggestion or reschedule model**.
- **Files:** `StoredFileOwnerType` has `TASK` only (`:1795-1797`).
- **What committees give a meeting:**
  - `Committee.quorumCount` (`:1960`);
  - `Committee.meetingFrequency` (`:1961`; enum `:2009-2016` includes
    `BIANNUAL`);
  - `WorkflowObjectType.MEETING` (`:77`);
  - `TaskSourceType.MEETING` (`:189`).
- **`Notification`** (`:1852-1872`): `titleAr` and `bodyAr` are nullable, and
  `objectType`/`objectId` are free text.

### 1.2 The seeded MEETING workflow (`workflow.seed.ts:235-258`) against the decided flow

| Seed (key, line) | Decided |
|---|---|
| Planned (`planned`, `:241`), who CREATOR | Planned, the Secretary |
| Agenda Ready (`agenda_ready`, `:242`), CREATOR | **Agenda Issued** («الأجندة مُصدَرة»), the Secretary |
| Minutes Draft (`:243`), CREATOR | Minutes Draft, the Secretary |
| Minutes Review (`:244`), ALL, starting assignment | Minutes Review, **the Chair** |
| Minutes Approved (`:245`, final) | same |
| Cancelled (`:246`, final) | same |
| Move "Prepare Agenda" (`:249`) | **"Issue Agenda"** («إصدار الأجندة») |
| Cancel Meeting from Planned and Agenda Ready (`:250`, `:252`) | same, from Planned and Agenda Issued |
| Record Minutes (`:251`), Distribute Minutes (`:253`) | same |
| Approve Minutes (`:254`, `isApprovalPath: true`) | the Chair's; `isApprovalPath` dead since ACC-284 |
| Return for Correction, Review → Draft (`:255`) | same; Secretary or Chair |
| **Return for Correction, Draft → Draft (`:256`)** | **dropped** (the seed bug, live in both tenants) |

**No stage carries a record action or a flag.**

### 1.3 Permission keys

- `meetings:view`, `meetings:manage`, `meetings:record_minutes` and
  `meetings:approve_minutes` (`permissions.ts:124-129`).
- **Only `meetings:view` is in use** (`object-visibility.service.ts:15`). The
  other three are in `PERMISSIONS_NOT_YET_CHECKED` (`:247-249`).
- Role seed holders: `role.seed.ts:68, 76, 89, 123-124, 176, 194`.

### 1.4 The registries

| Registry | File:line | MEETING today |
|---|---|---|
| Visibility | `object-visibility.service.ts:93-100` | `meetings:view` + exists. **No member, unit or guest clause.** |
| `TASK_RECORD_TYPES` | `task-record-types.ts:61` | **absent** |
| `RECORD_ROUTES` | `stage-task-record-routes.ts:58-62` | the committee, and **the committee's unit** |
| `RECORD_ACTIONS` / `STAGE_FLAGS` / `RECORD_FIELDS` | `record-registry.ts:90`, `:102`, `:108` | **absent**. Flags are strings (`schema.prisma:1272`), so a new flag needs no migration. |
| `TRANSITION_PRECONDITIONS` | `transition-preconditions.ts:44` | **absent** |
| `PROTECTED_TEMPLATES` | `workflow-stage-keys.ts:63` | absent |
| `STAGE_ASSIGNEE_KINDS` | `stage-who.ts:28` | all five kinds |
| `SEAT_ACTIONS` | `seat-actions.ts:24-30` | **absent**; `:8-11` reserves `schedule_meeting` and `record_minutes` |
| `MEMBER_ACTIONS` | `member-actions.ts:25-52` | absent |
| Nav model | `nav-items.ts` (`:186`, `:209`) | **no Meetings item** |
| Home | `home.service.ts:40-54` | no meetings part |
| Links | `record-link.util.ts:9-15`; `notification-links.ts:8-13` | no MEETING |

### 1.5 Other code that names a meeting

- `mapObjectTypeToTaskSourceType` (`workflow.service.ts:1513`).
- `task-record-names.ts:51-62`.
- The committee page's empty Meetings panel (`committee-detail.component.ts:366-370`).
- The `meeting_type` lookup (`lookup.seed.ts:229-243`).
- `draft-record-context.ts:28-30`.
- `workflow-awaiting.service.ts:46`.
- **Seats:** `committee_member_role` has `chairman` and `secretary` with their
  attributes (`lookup.seed.ts:69-71`).

### 1.6 Where today's code disagrees with the decisions

| Decided | Today |
|---|---|
| Committee OR unit | only `committeeId` |
| The stage is the status | `Meeting.status` text too |
| Duration; series; titles per series | `scheduledAt` only; no series |
| Presenter is a person, or a guest | `presenter` text |
| Invitees, guests (in the organisation and outside), attendance | nothing |
| Minutes per item; decisions; votes as counts | one `minutesText` |
| Review by a date, answers, suggestions | nothing |
| Action items as drafts, tasks at approval | nothing; `Task.meetingId` unused |
| Attachments on the meeting and its items | `StoredFileOwnerType` TASK only |
| Stage names and moves (§1.2) | old names, a self-loop, CREATOR pools |

---

## 2. Dependencies

### 2.1 SYSTEM-REFERENCE §11 items still open

| Item | Line | Needed? | Why |
|---|---|---|---|
| Lookup category UI | 13215 | no | `meeting_type` is edited on the Lookups page |
| Task detail / INTERNAL_REFERENCE UI | 13218 | no | stale; action items need no record reference |
| (mostly fixed by ACC-302) | 13242 | no | — |
| Deactivation doesn't replace committee seats | 13266 | **no, but it shows here** | a departed Secretary or Chair empties a stage's pool (`STAGE_HAS_NO_ONE`); Setup health already lists `COMMITTEE_MISSING_REQUIRED_SEAT` |
| AI provider selection | 13274 | no | Meetings AI is out |
| SEQUENTIAL ordering | 13326 | **no, obsolete** | dropped in ACC-278 |
| Validators | 13329 | no | preconditions do the record checks |
| `isCodeLocked`, INTERNAL_REFERENCE raw id | 13334, 13336 | no | — |
| SMS / digest | 13339 | no | in-app and email |
| Polling vs WebSocket | 13341 | no | attendance saves on each tap; nothing live |
| ROUND_ROBIN | 13344 | **no, obsolete** | dropped |
| Cycle detection, SUSPENDED | 13347, 13351 | no | — |

### 2.2 The engine, committees and the rest

- **The vote path (ACC-284) is not needed.**
  - Minutes Review is worked by the Chair, Any one. Nobody votes on the minutes
    in the engine.
  - Lane B noted on 9 Nov that ACC-284 no longer blocks Meetings (decisions
    check, line 38).
  - Decision votes are counts typed by the Secretary, not engine votes.
- **Stage-assignee RELATIVE route: present.** "The record's committee" with a
  seat resolves through `RECORD_ROUTES` (`stage-task-record-routes.ts:58-62`).
  - MEETING's `unit()` must return the meeting's owning unit: its own
    `orgUnitId`, or its committee's. `committee()` returns null for a unit
    meeting.
  - That reads `Meeting.orgUnitId`, so it changes in PR 2, after PR 1's
    migration (§6).
- **The seat rule (ACC-283)** gives:
  - `SEAT_ACTIONS` with lookup defaults and `writeSeatActions()`;
  - `MEMBER_ACTIONS` and `assertMemberAction()` (`member-actions.ts:159`);
  - "either the seat or the role grants".

  It lacks the two meeting keys, their defaults and their backfill.
- **Working calendar:** `WorkingCalendarService` has `calculateDeadline()` and
  `workingHoursBetween()` (`working-calendar.service.ts:284`, `:333`). It has
  **no public "next working day" or "add N working days"** (the day test is
  private, `:357`).
  - The series' holiday moves and the review date (5 working days) need both.
  - They are added there, never computed in the module.
- **Email to a person with no account is new work** (round 3 review):
  - `TransactionalEmailService.send({ to, subject, body, direction })`
    (`transactional-email.service.ts:10-45`) is the one Resend sender, and it
    takes any address;
  - the `email-delivery` worker today sends only to users
    (`notification-email.processor.ts:58`, `:96`) and to security notices.
  - Outside guests get a named job on that queue, carrying the attendee id,
    never the address.
- **Files:** two new `StoredFileOwnerType` values (the meeting, and an agenda
  item). The file viewer, quota, recycle bin and evidence states are reused.
  - Virus scanning is still ACC-178. The design's "Checking…" state is the
    content check the upload already does.
- **Reference codes: not needed** (Answers: no meeting number).
- **Calendar availability (ACC-293)** draws the Outlook rows. Not here.

---

## 3. Design

### 3.1 The meeting record

- **Owner:** `committeeId` OR `orgUnitId`, exactly one, checked in the service.
  A Prisma migration can't express a CHECK, and migration files aren't edited by
  hand.
- **New columns on `Meeting`:**
  - `orgUnitId` (FK `OrgUnit`, nullable);
  - `durationMinutes`;
  - `unitQuorum` (Int?, unit meetings only, set when scheduling);
  - `quorumAtAttendance` (Int?, saved when attendance is first recorded, so a
    later quorum change doesn't rewrite history);
  - `seriesId?`, `seriesIndex?`;
  - `ownEdits String[]` (the fields this meeting changed "this meeting only",
    so "this and all later" keeps them);
  - (no reschedule columns: every reschedule is a `MeetingReschedule` row, and
    "Rescheduled from …" reads the newest one, §3.8.2);
  - `reviewBy` (Date?), `reviewRound` (Int, default 0);
  - `approvedById?`.
- **`typeValueId` gains its relation.** It is safe: there are 0 rows.
- **The state is the workflow stage.** The instance is created with the meeting
  in one transaction (`startInstance()` prepare/insert/finish, ACC-239).
  `status` is not read, and is dropped in the contract PR.
- **Location or link: at least one** (Design, step 1). The link stays LTR.
- **Times** are stored as UTC and shown in the organisation's zone (ACC-97),
  with Hijri beside them through the formatting layer.
- **A committee may be given a meeting only where its stage allows it:** a new
  COMMITTEE record action `schedule_meeting`, seeded on the In force stages.
- **Every new table carries `organizationId`**, and every query names it with
  the id in one `where`.

### 3.2 Series

- **`MeetingSeries` has these columns:**
  - `organizationId` and the owner (committee or unit, as on the meeting);
  - `subject`, `typeValueId`;
  - the time of day, `durationMinutes`, location and link;
  - `every`: WEEK_1, WEEK_2, MONTH_1, MONTH_3, MONTH_6 or MONTH_12;
  - `on`: a weekday, a day 1–31, or an ordinal (FIRST…FOURTH, LAST) plus a
    weekday;
  - `firstDate`;
  - the end: `endsOn` or `count`;
  - `standingAgenda` (JSON: title, presenter, duration);
  - `createdById` and `endedAt`.
- **Creation:** every meeting the series makes is created at once, in one
  transaction, each with its instance.
  - **The end is at most 12 months ahead** (lane B, 18 Nov; brief 1.10). A
    later end date, or a count that runs past it, is refused under the field.
- **Dates:**
  - the pattern runs in Gregorian, in the organisation's zone;
  - a missing day falls on the month's last day;
  - a weekend or holiday moves to the next free working day, from the working
    calendar. If that day already has a meeting of the same owner, it moves on
    (Design, step 2).
- **Titles:** `subject · October 2026` for monthly and longer, or
  `subject · 22 Oct 2026` for weekly. A move keeps the pattern's month (R4-1).
  The title is stored per meeting and edited on its own.
- **Editing "this and all later":**
  - only meetings still in Planned or Agenda Issued, and only those after this
    one, change;
  - a field in a meeting's `ownEdits` is kept, and the scope confirm says what
    it kept;
  - past and held meetings never change.
- **Cancel one** is that meeting's Cancel Meeting.
- **End series:**
  - cancels every later meeting still in Planned or Agenda Issued, each with
    the reason;
  - sets `endedAt`.
- **The standing agenda** is copied into each meeting it creates, as items
  marked `standing`.

### 3.3 Agenda and papers

- **`AgendaItem` gains:**
  - `organizationId` (NOT NULL: 0 rows, and no writer);
  - `presenterAttendeeId` (the presenter is an invitee: a member, an
    organisation guest, or an outside guest; `presenter` text stops being
    read);
  - `standing`;
  - `discussion` (the minutes for the item).
- **A presenter who is not yet an invitee is added as a guest in the same
  write.** An organisation person becomes an organisation guest. An outside
  guest is added through Add a guest first.
- **Papers** are files owned by the agenda item. General attachments are files
  owned by the meeting. Both open in the file viewer.
- **Open actions from the last meeting:**
  - a READ: the not-done tasks of the owner's previous meeting that reached
    Minutes Approved, with status from each task;
  - the Secretary's note on each is a `MeetingOpenActionNote` (`organizationId`,
    `meetingId`, `taskId`, `note`), writable in Minutes Draft.

### 3.4 Invitees, guests, attendance and quorum

- **`MeetingAttendee` has these columns:**
  - `organizationId` and `meetingId`;
  - `kind`: MEMBER, ORG_GUEST or OUTSIDE_GUEST;
  - `userId?`;
  - for an outside guest: `outsideName`, `outsideEmail`, and optional
    `outsideOrganisation` and `outsideRole`;
  - `seatValueId?` (a member's seat, a snapshot);
  - `attendance`: PRESENT, APOLOGIES or ABSENT, or null;
  - `invitedAt?` (when the invitation went out: the notice for a user, the email
    for an outside guest);
  - `addedAsPresenter` (Boolean).
- **Unique** on `(meetingId, userId)` where `userId` is set.
- **Invitees are filled in at scheduling:**
  - a committee's active members;
  - a unit's own active people (`primaryOrgUnitId`), with no sub-units (lane
    B, 18 Nov).

  The scheduler can add more, as organisation guests.
- **Keeping MEMBER invitees current (PR 3).**
  - **What changes:** members joining or leaving change the MEMBER invitees of
    meetings still in Planned or Agenda Issued, and not yet started. Held and
    cancelled meetings never change. Guests are never touched.
  - **One place does it:** `MeetingInviteeSync`, which recomputes the expected
    MEMBER rows for a committee, a unit or a user:
    - it adds the missing rows;
    - it removes the rows no longer expected (with their answers);
    - it refreshes a member's seat snapshot.
  - **Entry-time refreshes, after each writer commits:**
    - committee member add, and reactivate in place (`committees.service.ts:492`,
      the reuse branch at `:526`);
    - change of seat (`:577`);
    - removal (`:637`);
    - user transfer (`user.service.ts:487`);
    - a change of primary unit on the profile (`updateProfile()`, `:1149`, the
      write at `:1198`);
    - deactivation (`:1502`);
    - reactivation (`:1642`);
    - invitation accepted, a new ACTIVE person in a unit
      (`auth.service.ts:950`).
  - **The scheduled recomputer (ACC-82's rule):**
    `SlaMonitorProcessor.sweepMeetingInvitees()`, a new step in `process()`
    (`sla-monitor.processor.ts:133`), runs every 15 minutes.
    - It recomputes every open meeting, per organisation, in batches.
    - It is fault-isolated like the other steps.
    - Correctness rests on the sweep; the writer calls only make a change show
      sooner.
- **Answering the invitation (Ahmad, 18 Nov):**
  - **The columns** on `MeetingAttendee`: `answer` (ATTENDING or CANT_ATTEND,
    null = no answer yet), `answerNote?` and `answeredAt?`.
  - **Who answers:** a user invitee, any number of times, until the meeting's
    start time (record action `answer_invitation`, Planned and Agenda Issued).
    Outside guests don't answer. There is no Tentative.
  - **"Can't attend"** pre-selects Apologies in the attendance row. The
    attendance stays unrecorded until the Secretary taps it, so Distribute's
    "attendance for everyone" still needs the Secretary on the day.
  - **A change TO "Can't attend"** tells the scheduler (the organiser) in the
    app, at once, after commit, with the note. It is flagged when:
    - the members not marked "Can't attend" fall below the quorum, or
    - the person holds the Chair or Secretary seat, or presents an item.

    There is no separate reschedule or cancel request: the scheduler decides
    from this notice.
  - **The summary:** whoever may edit the meeting sees "6 attending · 2 can't ·
    quorum 5", counting MEMBER answers. A warning shows when attending is below
    the quorum; a unit meeting with no quorum shows no quorum words.
- **Online counts as present** (lane B). There is no fourth kind.
- **Quorum met** means MEMBER attendees PRESENT ≥ the quorum.
  - The quorum is `quorumAtAttendance` for a committee, or `unitQuorum` for a
    unit.
  - A unit meeting with no quorum shows "11 of 14 present" with no quorum
    words.
- **Attendance** opens at the start time in Agenda Issued, and stays open in
  Minutes Draft (Design table). It is saved on each tap.
- **Distribute Minutes needs attendance for every member and organisation
  guest.** It is disabled with its reason before that.

### 3.5 Minutes, decisions and votes

- **Per item:** `AgendaItem.discussion` and `MeetingDecision` rows. A decision
  has these columns:
  - `organizationId`, `meetingId`, `agendaItemId`;
  - `order` and `text`;
  - `votesFor`, `votesAgainst`, `votesAbstain`: Int?, all three or none.
- **The vote check:** the sum ≤ MEMBER attendees PRESENT, said under the fields
  in words. It is refused on save as `MEETING_VOTES_EXCEED_PRESENT`.
- **"Taken without quorum"** is computed from the meeting's quorum line, and
  frozen at approval with the rest.
- **The minutes are not a separate document** (brief 1.6). They are the items,
  the decisions, the attendance and the action items.

### 3.6 Review

- **Distribute Minutes takes `reviewBy`:**
  - default: 5 working days ahead, from the working calendar;
  - `reviewRound` goes up by 1;
  - the present members are told.
- **`MeetingReviewAnswer`** (`organizationId`, `meetingId`, `round`, `userId`,
  `answeredAt`): "No corrections".
  - A suggestion from the same member in the same round replaces it (R3-2).
- **`MeetingSuggestion`** has these columns:
  - `organizationId`, `meetingId`, `round`;
  - `agendaItemId?` (null for the minutes as a whole);
  - `authorId`, `text`;
  - `status`: OPEN, APPLIED or DECLINED;
  - `reply?`, `decidedById?`, `decidedAt?`.

  A suggestion counts as the member's answer.
- **Applied changes** are `MeetingReviewChange` rows (`organizationId`,
  `meetingId`, `round`, `agendaItemId?`, `what`), written by the Secretary's
  edits in Minutes Review. They feed "Changed during review: item 2, decision".
- **Who reviews:** members whose attendance is PRESENT, the Chair included
  (R3-5). Guests never review.
- **The review's state is worked out when the page is read** (decisions check,
  line 38), never by a job:
  - who answered;
  - who hasn't;
  - open suggestions;
  - whether the date has passed, in the organisation's zone.
- **The reminder** is the one scheduled part: the SLA sweep (`sla-monitor`, 15
  minutes) tells the members who haven't answered, once, on the working day
  before the date.
  - **The stamp is `MeetingAttendee.reviewRemindedRound` (Int?).** The sweep
    sends a reminder only through one conditional `UPDATE … SET
    reviewRemindedRound = round WHERE reviewRemindedRound IS DISTINCT FROM
    round RETURNING`, so a second sweep or worker sends nothing.
- **Return for Correction:**
  - closes the round;
  - answers reset;
  - suggestions stay, marked with that round's date (R3-3);
  - the optional reason is shown to present members and in the draft (R3-4).

### 3.7 Action items

- **`MeetingActionItem`** has these columns:
  - `organizationId`, `meetingId`, `agendaItemId`;
  - `title`, `ownerUserId`, `dueAt`;
  - `taskId?` (unique).

  The owner is any person in the organisation, guests included, and never an
  outside guest (R3-7).
- **Edits:**
  - drafts are edited in Minutes Draft;
  - in Minutes Review, only their dates are edited, by the Secretary.
- **At approval, each draft becomes a task** in the approve move's transaction
  (§3.8):
  - `sourceType MEETING`, `sourceId` the meeting, the owner as the only
    assignee;
  - built with `TaskService.prepareRecordTask()` (`task.service.ts:436`, which
    takes user ids, matching "owner: a person");
  - its due date is the draft's;
  - the item's `taskId` is set.
- **The approval check:** a draft whose due date has passed blocks approval
  (`MEETING_ACTION_PAST_DUE`, naming the item). So does a due date past the
  task's SLA limit (ACC-174), with the limit named (§8).
- **"From item n"** comes from the item's `agendaItemId`, joined through
  `taskId` on the tasks panel. No column is added to `Task`.
- **Frozen at approval:** the locked minutes and print show the items as at
  approval, with each task's live status (R3-8).

### 3.8 Stages, moves and the engine

**The seed and the PR 2 backfill:**

| Stage (seed key) | Name | Who works it | Record actions allowed | Flags |
|---|---|---|---|---|
| `planned` | Planned | Secretary | `edit_details`, `manage_agenda`, `manage_guests`, `reschedule` | — |
| `agenda_ready` | **Agenda Issued** | Secretary | the four above, plus `record_attendance` (from the start time) | `AGENDA_ISSUED` |
| `minutes_draft` | Minutes Draft | Secretary | `record_attendance`, `record_minutes` | — |
| `minutes_review` | Minutes Review | Chair | `apply_suggestions`, `change_action_dates`, `suggest_correction` | — |
| `minutes_approved` | Minutes Approved | — | none | `MINUTES_FINAL` |
| `cancelled` | Cancelled | — | none | `MEETING_CANCELLED` |

- **"Secretary" and "Chair" are pools that work for both kinds of meeting.**
  One Meeting template serves committee and unit meetings, so each stage lists
  entries for both. The entry for the other kind resolves to nobody:

  | Stage | Entries (Any one) |
  |---|---|
  | Planned | `MEETING_SCHEDULERS` |
  | Agenda Issued | `MEETING_SCHEDULERS` · `MEETING_RECORDERS` |
  | Minutes Draft | `MEETING_RECORDERS` |
  | Minutes Review | `COMMITTEE` + `chairman` seat · `MEETING_APPROVERS` |

  - **The pools read the same predicates as the buttons (round 4).** Scheduling
    is the configurable seat action `schedule_meeting`, so Planned's pool can't
    be the fixed `secretary` seat. A Chair who may schedule must also be able
    to press Issue Agenda.
  - `COMMITTEE` with no fixed committee is the meeting's committee, and nobody
    for a unit meeting. The Chair seat on Minutes Review stays fixed: approving
    a committee's minutes is the Chair's alone (Ahmad, 18 Nov), not a seat
    action.
- **The three new kinds (Ahmad's item 6).** Each is MEETING-only, has no field,
  and is read through `meeting-authority.ts` (§4.2):

  | Kind | Committee meeting | Unit meeting |
  |---|---|---|
  | `MEETING_SCHEDULERS` | the committee's active members whose seat has `schedule_meeting` · `meetings:schedule` holders of the committee's owning unit · heads above holding `meetings:schedule_subunits` | `meetings:schedule` holders of the unit · heads above holding `schedule_subunits` |
  | `MEETING_RECORDERS` | the committee's active members whose seat has `record_minutes` | `meetings:record_minutes` holders of the unit |
  | `MEETING_APPROVERS` | **nobody**: a committee's minutes are the Chair's alone (Ahmad, 18 Nov) | `meetings:approve_minutes` holders of the unit · heads above holding `meetings:approve_subunits` |

- **Why not an existing or generic kind:**
  - no existing kind reads a permission;
  - a generic "key holders in the record's unit" kind can't say "for unit
    meetings only", which Approvers needs: item 4 forbids a committee's owning
    unit from approving.
  - So: three enum values in PR 1's migration, with no new column. Their batched
    resolvers ship in PR 2, and only then does any row use them.
- **Each resolver is a batched read:**
  - the committee's active members whose seat allows the action (the seat
    action rows, `seat-actions.ts`'s one reader);
  - the active people of the owning units who hold the key through an active
    role;
  - the heads and acting heads of those units' ancestors who hold the
    sub-units key, through `unit-headship.ts`.

  One query per kind for any number of records, as `StagePoolService` does
  today.
- **MEETING becomes a keyed template (corrected in PR 2).** Its stages had no
  keys (it was not in `KEYED_SEED_TEMPLATES`), and `APP_MOVES` finds an app
  move by stage key. New organisations get the keys from the seed; the backfill
  gives existing stages the seed's key, matched by the old name while they
  have none. Keys are never shown.
- **The backfill:**
  - renames names and moves only where they are still the seed's;
  - sets `who` only where it is still the seed's;
  - deletes the self-loop.

**The moves:**

| Move | From → to | Mover | Why |
|---|---|---|---|
| Issue Agenda | Planned → Agenda Issued | PERSON | notices after commit, by entry effect (`AGENDA_ISSUED`) |
| Record Minutes | Agenda Issued → Minutes Draft | PERSON | — |
| Distribute Minutes | Minutes Draft → Minutes Review | **APP** | it takes `reviewBy` and opens a round: the meeting's endpoint, ACC-239's `inTx` |
| Approve Minutes | Minutes Review → Minutes Approved | PERSON | the Chair's pool; preconditions; entry effect (`MINUTES_FINAL`) |
| Return for Correction | Minutes Review → Minutes Draft | **APP** | Secretary OR Chair, and it resets the round: the meeting's endpoint, `inTx` |
| Cancel Meeting | Planned, Agenda Issued → Cancelled | PERSON | reason required (§3.8.2); notices by entry effect (`MEETING_CANCELLED`) |

- **An APP move's endpoint checks who may act:**
  - Distribute: the Minutes Draft pool (`InstanceAccess.assertMayAct()`,
    `instance-access.ts`), so the stage still owns who;
  - Return: the Minutes Review pool, OR `MEETING_RECORDERS` (whoever records
    the minutes).
- **An APP move shows read-only on the stages page,** with its `appMove` line
  (ACC-271 PR 5b). Its button on the meeting page is the module's own.

#### 3.8.1 Entry effects (`TRANSITION_EFFECTS`), kept from review round 1

- **Why `inTx` won't do:** `inTx` belongs to `triggerSystemTransition()`
  (`workflow.service.ts:928-937`), and `applyMove()` refuses it for a non-APP
  move (`:1180-1186`).
- **Every person's press lands in `performTransition()`** (`:1072-1092`):
  - Any one: `:678`;
  - RETURN or EXIT on a shared stage: `:699`;
  - the deciding vote: `:709`;
  - the vote screen: `:860`, `:866`.
- **`performTransition()` runs three steps:**
  - `prepareMove()` (`:1099`): reads;
  - `applyMove()` (`:1152-1225`): the instance lock `:1158`, the preconditions
    `:1177`, then the writes;
  - `finishMove()` (`:1228-1250`): after commit.
- **The registry:** `TRANSITION_EFFECTS`, beside `TRANSITION_PRECONDITIONS`.
  - It is per record type, FAIL OPEN, keyed by the flag entered.
  - `prepare` runs in `prepareMove()`, `apply` in `applyMove()` after the
    preconditions, and `finish` in `finishMove()`.
  - `ctx` is the precondition context (`transition-preconditions.ts:21-31`).
- **MEETING's effects:**
  - **`MINUTES_FINAL`:**
    - `prepare` prepares a task per action item;
    - `apply` locks the meeting row after the instance (ACC-255's order). It
      refuses `MEETING_CHANGED` if the items moved since `prepare`. Then it
      stamps `minutesApprovedAt` and `approvedById`, inserts the tasks
      (`insertPrepared()`, `task.service.ts:332`) and sets `taskId`;
    - `finish` announces the tasks (`announceCreated()`, `:342`) and writes the
      Meeting audit row.
  - **`AGENDA_ISSUED`:** `finish` tells the invitees and emails the outside
    guests, setting `invitedAt` for each.
  - **`MEETING_CANCELLED`:** `finish` tells the invited, quoting the move's
    comment.
- **It holds for every way of working a stage.** One press or a deciding vote,
  it runs once, on the move that fires.
- **ACC-190's rules hold:**
  - reads before the transaction;
  - lock order: instance, then the meeting row;
  - notices after commit.

#### 3.8.2 A move that needs a reason, kept from review round 1

- **Today:**
  - a press carries an optional `comment` (`trigger-transition.dto.ts:8-11`);
  - it is stored on the entry left (`:1191`; `schema.prisma:1399`) and shown in
    the stage history (`:509-511`);
  - the move buttons never send one (`workflow-transition-actions.component.ts:127`);
  - nothing makes one required.
- **Added:**
  - a per-record-type rule keyed by the flag entered. MEETING: into
    `MEETING_CANCELLED`, a comment is required, else 400 `REASON_REQUIRED`;
  - `needsReason` per move on `GET /workflows/instances/:id/moves`;
  - a reason dialog in the move buttons, for every module.
- **Reschedule is not a move.** Its required reason is the meeting endpoint's,
  stored on `MeetingReschedule`.

#### 3.8.3 Moves disabled with their reason

- **The design draws two moves disabled with a "Why?":** Distribute Minutes and
  Approve Minutes.
  - **Distribute** is the module's own button, so the meeting read says whether
    it is ready, and why not.
  - **Approve** is a PERSON move: the moves list gains `blockedBy` (the
    precondition's refusal code and its numbers) for an ADVANCE move.
    - It is computed by running the record's precondition read-only, only for
      the stage the viewer is in the pool of.
    - "Why?" opens the existing `CantMoveDialogComponent`.
- **MEETING's preconditions:**
  - **out of Minutes Draft:** attendance recorded for every member and
    organisation guest (`MEETING_ATTENDANCE_INCOMPLETE`);
  - **out of Minutes Review into `MINUTES_FINAL`:**
    - the review closed: the date passed, or every present member answered
      (`MEETING_REVIEW_OPEN`, naming who hasn't answered, or the date);
    - no OPEN suggestion (`MEETING_SUGGESTION_OPEN`);
    - no past-due draft (`MEETING_ACTION_PAST_DUE`);
    - no draft due after its task's SLA limit, MEDIUM counted from now (§3.7,
      ACC-174) (`MEETING_ACTION_PAST_SLA_LIMIT`, naming the item and the
      limit).
  - Inside the transaction, the meeting row is read FOR SHARE, as for
    committees.

### 3.9 Notices and emails

- **Every new notice is written in English and Arabic.** The specs check both.
- **No count in a stored notice.** ACC-95's `counted()` helper doesn't exist
  (no `counted` in `backend/src` or `frontend/src/app`; SYSTEM-REFERENCE
  10356–10360). The design's "Told" counts are screen text, through `amCount`.

| Event | Members and organisation guests (app + email) | Outside guests (email only) |
|---|---|---|
| Agenda issued | the invitation | the invitation |
| Outside guest added in Agenda Issued | — | the invitation, at once |
| Agenda edited after issue | told again, with what changed | — |
| Rescheduled | new time and reason | new time and reason, if invited |
| Cancelled | reason | reason, if invited |
| Distributed | present members: "Review the minutes by 1 Oct" | — |
| Reminder (day before) | present members who haven't answered | — |
| Suggestion declined | its author, with the reply | — |
| Returned for correction | present members, with the reason | — |
| Approved | action item owners, through the task notices | — |
| An invitee changes to "Can't attend" | the scheduler, in the app only, with the note, flagged (§3.4) | — |

- **An outside guest's email** is a named `email-delivery` job sent through
  `TransactionalEmailService`.
  - It carries no link into AccreditMe. The online meeting link is not ours,
    and it is allowed.
  - It is in the organisation's language (lane B, 18 Nov).
- **Home's "Awaiting my action"** gains a meeting review row ("Review the
  minutes by 1 Oct"). It comes from a self-scoped read: rounds open where the
  viewer is a present member with no answer. It is one more part in
  `MyWorkCountsService`, with no polling.
- **The list row's "Review" next step** (R3-9) reads the same fact.

### 3.10 Clash warning

- **The rule:** for each invitee with a user (members and organisation guests),
  other meetings they are invited to, not Cancelled, whose time strictly
  overlaps. Back-to-back is not a clash, and the same series counts.
- **`POST /meetings/clashes`** takes the owner or the invitee list, times (one,
  or the series' dates) and an excluded meeting. It answers per date and per
  person.
  - The other meeting's title is given only if the asker may open it; otherwise
    "another meeting".
  - It is one batched query, with the date list capped at the series' cap.
  - **Who may ask:** the caller must be able to schedule for the owner (a new
    meeting or a series), or to edit the meeting (`meeting-authority.ts`).
    Anyone else gets the refusal the schedule or edit endpoint gives. The
    answer names who is busy and when, so it is not open to every viewer.
- **Where it shows:** Schedule step 1, step 2's "Clash" chips, Reschedule, the
  scope confirm, and Add a guest (R5-5). Nowhere else (R5-7).

### 3.11 Print page

- **`/meetings/:id/print`**, Minutes Approved only:
  - A4 portrait, 18 mm margins, no app chrome;
  - English or Arabic, in the reader's language.
- **"Page 1 of 3"** needs CSS page margin boxes with `counter(pages)`. Those are
  in Chrome/Edge 131+ only, not Safari 16.4 or Firefox 115 ESR (the supported
  floor). The footer degrades to no page number where unsupported (§8).

---

## 4. Who sees and does what

**The owning unit.** Every rule below reads one unit, the meeting's **owning
unit**:

- a unit meeting: its `orgUnitId`;
- a committee meeting: its committee's `orgUnitId` (required since ACC-135).

### 4.1 Seeing

- **The parent rule (ACC-101) gains MEETING, the ACC-281 shape.** A viewer may
  see a meeting with any one of:
  - **`meetings:view`:** every meeting;
  - **for a committee meeting:** an active member of the committee
    (`committee-membership.ts`);
  - **for a unit meeting:** an active person whose `primaryOrgUnitId` is the
    unit. That is the unit's own people, with no sub-units (lane B, 18 Nov);
  - **an invitee with a user:** an attendee row with their id. That includes
    anyone the scheduler added;
  - **a head looking down (Ahmad, 18 Nov):** the head or acting head of a unit
    whose subtree contains the owning unit.
    - Headship comes from `unit-headship.ts` (`findUnitHeadedBy`,
      `findUnitsCoveredBy`), and the subtree from `findUnitSubtreeIds`, which
      includes the headed unit itself.
    - The root head's subtree is every unit, so they see all.
- **How it is checked:**
  - batched for lists: the viewer's headed units and their subtree are read
    ONCE per request, then matched in SQL with `= ANY`;
  - no query for a `meetings:view` holder;
  - nothing on the per-request path;
  - the refusals are as today: the 403 naming `meetings:view` when the request
    names the meeting, the identical 404 when only a row names it.
- **The minutes, by stage:**

  | Who | Reads the minutes from |
  |---|---|
  | whoever records them (Secretary seat, own-unit `meetings:record_minutes`) | Minutes Draft |
  | members of the committee or unit (lane B, 18 Nov) | Minutes Review |
  | Minutes Review's pool, and heads above holding `meetings:approve_subunits` | Minutes Review |
  | everyone else who may see the meeting, organisation guests included (round 1 Q9) | Minutes Approved |
  | outside guests | never: they have no access |

- **Lists:**
  - **"Sub-units' meetings"** (Ahmad, 18 Nov) is a separate list for a head: the
    meetings whose owning unit is in their subtree and that no other clause
    already gives them;
  - **"All meetings"** stays the `meetings:view` view;
  - the design's Mine, Past and Minutes I record are unchanged.
- **The committee or unit panel** shows the restricted line to someone who may
  open the record but not its meetings (Design "Denied").
- **The meeting's workflow** follows the record (`InstanceAccess`).
- **Files** follow the meeting's rule. Organisation guests see papers and
  attachments.
- **A guest who isn't a member** reaches the meeting through the bell, Home and
  the email. `/meetings/:id` has its own `permissionGuard` and no route
  permission, like `tasks.routes.ts:27-38`.

### 4.2 Doing

**"Head above"** means: the head or acting head of a unit whose subtree contains
the owning unit.

| Action | Committee meeting | Unit meeting |
|---|---|---|
| **Schedule; edit, reschedule, agenda, guests, cancel; Issue Agenda** | `MEETING_SCHEDULERS`' predicate: a seat with `schedule_meeting` (default Chair, Secretary), OR `meetings:schedule` held by a person of the committee's owning unit, OR `meetings:schedule_subunits` + head above | the same predicate: `meetings:schedule` held by a person of the unit, OR `meetings:schedule_subunits` + head above |
| **Attendance, minutes, decisions, votes, action items, open-action notes; apply or decline suggestions; change action dates** | `MEETING_RECORDERS`' predicate: a seat with `record_minutes` (default Secretary) | the same predicate: `meetings:record_minutes` held by a person of the unit |
| **Approve Minutes** | the Chair (seat) | `MEETING_APPROVERS`' predicate: `meetings:approve_minutes` held by a person of the unit, OR `meetings:approve_subunits` + head above |
| **Return for Correction** | the Chair (seat) OR `MEETING_RECORDERS` | `MEETING_APPROVERS` OR `MEETING_RECORDERS` |
| **Answer the invitation** | the invitee (a user) | the same |
| **No corrections / Suggest a correction** | a present member, in the open round | the same |
| **Print** | anyone who may read the approved minutes | the same |

Every action also needs its stage's record action (§3.8). A move also needs its
stage's pool (ACC-271).

- **Committee meetings have no "record sub-units" key** (Ahmad, 18 Nov). A head
  above never approves a committee's minutes.
- **Seat actions:** `schedule_meeting` and `record_minutes`, each with a
  `committee_member_role` default attribute and a backfill (ACC-283's way).
  `MEMBER_ACTIONS` gains both.
- **Keys:**
  - **added:** `meetings:schedule`, `meetings:schedule_subunits` and
    `meetings:approve_subunits`;
  - **out of `PERMISSIONS_NOT_YET_CHECKED`:** `meetings:record_minutes` and
    `meetings:approve_minutes`;
  - **`meetings:manage`** stays a seed-time umbrella that holds every meeting
    key (ACC-44);
  - **nothing is retired.**
  - The seed grants the new keys to the roles that hold `meetings:manage` today
    (`role.seed.ts`). The backfill only grants, never revokes (ACC-101), and
    reaches the frozen root role too.
- **One place decides:** `meeting-authority.ts` decides "may this viewer do X to
  this meeting", the ACC-283 `assertMemberAction()` shape. It joins the seat
  path, the own-unit key path and the head-above key path, read in one batch.
  - **Its three predicates ARE the three kinds' resolvers** (round 4): Planned
    is pressed by exactly who may schedule, Minutes Draft by exactly who may
    record. A pool and a button can't disagree.

### 4.3 Registries

- **Visibility:** MEETING with its member, unit-people, invitee and head-above
  clauses.
- **`TASK_RECORD_TYPES`:**
  - MEETING's four task keys;
  - the owning unit SQL is the owning unit above;
  - `acceptsTasksSql`: not on a `MEETING_CANCELLED` stage.
- **`RECORD_ROUTES`:**
  - MEETING's `unit()` returns the owning unit, and `committee()` the committee,
    or null for a unit meeting;
  - it needs `Meeting.orgUnitId`, so it changes AFTER the migration (§6).
- **`STAGE_ASSIGNEE_KINDS.MEETING`** gains three kinds, offered for MEETING only
  (§3.8): `MEETING_SCHEDULERS`, `MEETING_RECORDERS` and `MEETING_APPROVERS`.
- **`RECORD_ACTIONS`:** the nine MEETING actions in §3.8, plus `answer_invitation`
  (Planned and Agenda Issued, until the start time). COMMITTEE gains
  `schedule_meeting`.
- **`STAGE_FLAGS`:**
  - `AGENDA_ISSUED` and `MEETING_CANCELLED` (any number);
  - `MINUTES_FINAL` (exactly one).
- **`TRANSITION_PRECONDITIONS`:** MEETING (§3.8.3).
- **`TRANSITION_EFFECTS`:** new, MEETING (§3.8.1).
- **The move reason rule:** new, MEETING (§3.8.2).
- **Nav:** Meetings after Committees, with `moduleKey: 'meetings'`. It shows to
  `meetings:view` holders, committee members, people of any unit, and heads.
- **Home:**
  - the review row (§3.9);
  - "Answer the invitation" for meetings a user invitee hasn't answered, in the
    same self-scoped read;
  - "My committees · 1 meeting this week" (App Shell drawing).
- **Links:** `recordPageLink()` and `notificationLink()` gain MEETING.

---

## 5. Screens

**The design is in the repo now** (`86cc3f3`). Each screen is built from it.
These shared patterns are reused, none rebuilt:

| Screen (Design section) | Pattern |
|---|---|
| `/meetings` (1): saved views Mine (default), Past, Minutes I record, All meetings | `app-data-list`, `am-sort-header`, the row ⋯ menu (`am-row-menu`), grouped by week and month, paging past 50 |
| Meetings panel on Committee and Org unit records (2) | the next-meeting block plus `am-capped-panel` rows (7), restricted state |
| Schedule meeting (3): step 1, step 2 Repeat | `EditDialogComponent` stepped, New task's date-and-time control, `OverlaySelectComponent` |
| Meeting page (4–11) | `RecordPanel`, the stage indicator with "Who works this stage", panels not tabs |
| Attendance (tablet, coarse pointer) | a segmented radiogroup per row, saved on tap |
| Review banner, Suggest a correction, suggestions on items (12) | the banner as drawn, its two answers full-width on a phone |
| Approve Minutes and Distribute disabled + "Why?" | `CantMoveDialogComponent` |
| Action items after approval | the record tasks panel (ACC-229) with "From item n" |
| Add a guest, Reschedule, Cancel, scope confirm, End series | `EditDialogComponent`; the design measures each under 420 |
| Print (13) | its own route, print stylesheet |
| Phone (14, 16) | the phone layouts drawn; form dialogs as sheets (ACC-299) |

**Where the 18 Nov decisions differ from the design file** (a design pass,
not questions):

- **Invitation answers aren't drawn.** These need drawing:
  - the "Attending / Can't attend" control and its note;
  - the scheduler's "6 attending · 2 can't · quorum 5" line and its warning;
  - the flagged notice;
  - the pre-selected Apologies in attendance.
- **"Sub-units' meetings" isn't drawn.** The design's saved views are Mine,
  Past, Minutes I record and All meetings.
- **The restricted panel line** reads "Meetings are open to this committee's
  members and to people allowed to see all meetings". It now leaves out heads
  above.
- **Who works this stage for a unit meeting isn't drawn.** The design shows only
  the committee case: the Secretary, and "Approve Minutes is the Chair's
  alone". For unit meetings, the approvers are the own-unit holders and the
  heads above.
- **The panel note's "organiser roles (secretary, chair, or the permission to
  schedule)"** still holds for committees. The permission is now own-unit or
  head-above.
- **"Minutes I record"** was "for secretaries and anyone with minutes-recording".
  The key now counts for the holder's own unit only.

**Build notes from the thread, not questions:**

- **The list's minutes column reasoning still reads "3 of 6 approved · 1
  returned"** (Design, list reasoning). That is round 2's model. Build it with
  the Review card's words ("4 answered · 1 suggestion open").
- **R4-1, R4-2 and R4-3 still show as open in the file.** They were decided on
  10 Nov (round 3 review). R5-1 to R5-7 are decided too (Answers).
- **The invitation email is the product's plain email** (R4-3): subject plus one
  paragraph through `renderEmailHtml`. The drawn styling is beyond what's built.
- **Outlook rows and the failure line** wait for Calendar availability
  (ACC-293).

---

## 6. Slices

Each PR deploys before the next. Every migration is expand only. **Series is
its own PR, after the single meeting** (lane B, 9 Nov).

**Re-sliced on 18 Nov: the migration is now PR 1, and the workflow PR 2.** The
workflow PR needs things the migration creates:

- `RECORD_ROUTES` reads `Meeting.orgUnitId`;
- the seeded pools use the three new `StageAssigneeKind` values.

Under ACC-173's rule, no row may hold an enum value before the code that reads
it is deployed. So the values come first, unused, and the workflow PR writes
them together with their resolver.

1. **PR 1: the migration only** (round 4).
   - **No keys, seat actions, seed or backfill.** No code writes or reads any
     new enum value. Every new column is nullable or has a default, except
     `AgendaItem.organizationId` (0 rows, no writer).
   - **Dates:** a date-only value is a `DateTime` holding the day's UTC
     midnight, as `PublicHoliday.date` does (`schema.prisma:867`).
   - Migration `acc316_meetings_schema`. Every table and column, one per line:

   **New enums (new types):**
   - `MeetingSeriesEvery`: WEEK_1, WEEK_2, MONTH_1, MONTH_3, MONTH_6, MONTH_12
   - `MeetingSeriesOn`: WEEKDAY, DAY_OF_MONTH, ORDINAL_WEEKDAY
   - `MeetingSeriesOrdinal`: FIRST, SECOND, THIRD, FOURTH, LAST
   - `MeetingAttendeeKind`: MEMBER, ORG_GUEST, OUTSIDE_GUEST
   - `MeetingAttendance`: PRESENT, APOLOGIES, ABSENT
   - `MeetingInvitationAnswer`: ATTENDING, CANT_ATTEND
   - `MeetingSuggestionStatus`: OPEN, APPLIED, DECLINED
   - `MeetingEditScope`: THIS_ONLY, THIS_AND_LATER

   **New values in existing enums:**
   - `StoredFileOwnerType`: MEETING
   - `StoredFileOwnerType`: MEETING_AGENDA_ITEM
   - `StageAssigneeKind`: MEETING_SCHEDULERS
   - `StageAssigneeKind`: MEETING_RECORDERS
   - `StageAssigneeKind`: MEETING_APPROVERS

   **`Meeting`, new columns:**
   - `orgUnitId` String? → OrgUnit (index)
   - `durationMinutes` Int?
   - `unitQuorum` Int?
   - `quorumAtAttendance` Int?
   - `seriesId` String? → MeetingSeries (index)
   - `seriesIndex` Int?
   - `ownEdits` String[] default `[]`
   - `reviewBy` DateTime?
   - `reviewRound` Int default 0
   - `approvedById` String? → User
   - and a new FK: `typeValueId` → LookupValue (the column exists)

   **`AgendaItem`, new columns:**
   - `organizationId` String NOT NULL → Organization (index)
   - `presenterAttendeeId` String? → MeetingAttendee (on delete SET NULL)
   - `standing` Boolean default false
   - `discussion` String?

   **`MeetingSeries` (new table):**
   - `id` String cuid
   - `organizationId` String → Organization (index)
   - `committeeId` String? → Committee (index)
   - `orgUnitId` String? → OrgUnit (index)
   - `subject` String
   - `typeValueId` String → LookupValue
   - `startMinute` Int (minutes after midnight, the organisation's zone)
   - `durationMinutes` Int
   - `location` String?
   - `meetingUrl` String?
   - `every` MeetingSeriesEvery
   - `onKind` MeetingSeriesOn
   - `weekday` Int? (1–7, Monday first, as Luxon)
   - `dayOfMonth` Int? (1–31)
   - `ordinal` MeetingSeriesOrdinal?
   - `firstDate` DateTime
   - `endsOn` DateTime?
   - `count` Int?
   - `standingAgenda` Json default `[]`
   - `createdById` String → User
   - `createdAt` DateTime default now
   - `updatedAt` DateTime updatedAt
   - `endedAt` DateTime?
   - `endReason` String?

   **`MeetingAttendee` (new table):**
   - `id` String cuid
   - `organizationId` String → Organization (index)
   - `meetingId` String → Meeting (index; on delete CASCADE)
   - `kind` MeetingAttendeeKind
   - `userId` String? → User (index)
   - `outsideName` String?
   - `outsideEmail` String?
   - `outsideOrganisation` String?
   - `outsideRole` String?
   - `seatValueId` String? → LookupValue
   - `attendance` MeetingAttendance?
   - `attendanceRecordedAt` DateTime?
   - `attendanceRecordedById` String? → User
   - `answer` MeetingInvitationAnswer?
   - `answerNote` String?
   - `answeredAt` DateTime?
   - `invitedAt` DateTime?
   - `addedAsPresenter` Boolean default false
   - `reviewRemindedRound` Int?
   - `createdAt` DateTime default now
   - `createdById` String? → User
   - unique (`meetingId`, `userId`)

   **`MeetingDecision` (new table):**
   - `id` String cuid
   - `organizationId` String → Organization (index)
   - `meetingId` String → Meeting (index; CASCADE)
   - `agendaItemId` String → AgendaItem (index; CASCADE)
   - `order` Int
   - `text` String
   - `votesFor` Int?
   - `votesAgainst` Int?
   - `votesAbstain` Int?
   - `createdAt` DateTime default now
   - `updatedAt` DateTime updatedAt

   **`MeetingActionItem` (new table):**
   - `id` String cuid
   - `organizationId` String → Organization (index)
   - `meetingId` String → Meeting (index; CASCADE)
   - `agendaItemId` String → AgendaItem (index)
   - `title` String
   - `ownerUserId` String → User (index)
   - `dueAt` DateTime
   - `taskId` String? unique → Task (on delete SET NULL)
   - `createdById` String? → User
   - `createdAt` DateTime default now
   - `updatedAt` DateTime updatedAt

   **`MeetingOpenActionNote` (new table):**
   - `id` String cuid
   - `organizationId` String → Organization (index)
   - `meetingId` String → Meeting (CASCADE)
   - `taskId` String → Task
   - `note` String
   - `updatedById` String? → User
   - `createdAt` DateTime default now
   - `updatedAt` DateTime updatedAt
   - unique (`meetingId`, `taskId`)

   **`MeetingReviewAnswer` (new table):**
   - `id` String cuid
   - `organizationId` String → Organization (index)
   - `meetingId` String → Meeting (CASCADE)
   - `round` Int
   - `userId` String → User (index)
   - `answeredAt` DateTime default now
   - unique (`meetingId`, `round`, `userId`)

   **`MeetingSuggestion` (new table):**
   - `id` String cuid
   - `organizationId` String → Organization (index)
   - `meetingId` String → Meeting (index; CASCADE)
   - `round` Int
   - `agendaItemId` String? → AgendaItem
   - `authorId` String → User (index)
   - `text` String
   - `status` MeetingSuggestionStatus default OPEN
   - `reply` String?
   - `decidedById` String? → User
   - `decidedAt` DateTime?
   - `createdAt` DateTime default now

   **`MeetingReviewChange` (new table):**
   - `id` String cuid
   - `organizationId` String → Organization (index)
   - `meetingId` String → Meeting (index; CASCADE)
   - `round` Int
   - `agendaItemId` String? → AgendaItem
   - `what` String
   - `actorId` String → User
   - `createdAt` DateTime default now

   **`MeetingReschedule` (new table):**
   - `id` String cuid
   - `organizationId` String → Organization (index)
   - `meetingId` String → Meeting (index; CASCADE)
   - `fromAt` DateTime
   - `toAt` DateTime
   - `reason` String
   - `scope` MeetingEditScope
   - `actorId` String → User
   - `createdAt` DateTime default now

   - **Live after:** nothing a person sees. 0 rows anywhere.
2. **PR 2: keys, seats, the workflow, the registries and the pool kinds.**
   - **Keys (round 4: here, where they are first checked):**
     - `meetings:schedule`, `schedule_subunits` and `approve_subunits` added;
     - `record_minutes` and `approve_minutes` leave
       `PERMISSIONS_NOT_YET_CHECKED`, in this PR and not before, so a role
       screen never grants a key nothing checks;
     - the role seed.
   - **Seats:** `schedule_meeting` and `record_minutes`, with lookup defaults.
   - **The workflow:**
     - the seed (§3.8): names, the pools, movers, flags, record actions, and
       the self-loop deleted;
     - `RECORD_ACTIONS`, `STAGE_FLAGS` and `RECORD_FIELDS` MEETING;
     - COMMITTEE `schedule_meeting`;
     - the `RECORD_ROUTES` change;
     - `meeting-authority.ts`, and the three kinds' batched resolvers in
       `StagePoolService`, which first read the keys and seat actions.
   - **Backfills: all three run ONCE, after PR 3a deploys, not after PR 2**
     (lane B, Prompt 139, 18 Nov). PR 3a adds the four meeting task keys to
     `backfill:acc316-meeting-keys`, and the shared database has no meetings,
     so nothing depends on them sooner. Dry run, `-- --execute`, dry run 0.
     Each writes ONE audit row per organisation it changes (ACC-101):
     - `backfill:acc316-meeting-keys` (grants only);
     - `backfill:acc316-seat-defaults`;
     - `backfill:acc316-meeting-workflow`.
   - **No migration.**
   - **Live after:** the role screen shows the five keys; the seat screens show
     the two actions; the Workflow page shows the decided Meeting workflow.
3. **PR 3: one meeting, backend.** Split in two (lane B, Prompt 133, 18
   Nov): **3a** is the record (below, to "the working calendar"), **3b** the
   people and the agenda: invitees and `MeetingInviteeSync`, guests, answers,
   the agenda and papers, the clash check, outside guest emails. 3a as built:
   §6.1, below this slice.
   - Changes:
     - schedule, read, paged list with the saved views and "Sub-units'
       meetings";
     - edit, reschedule, cancel (with the reason rule and `needsReason`);
     - owner committee or unit;
     - visibility, with the head-above clause;
     - invitees (unit people, scheduler additions), `MeetingInviteeSync` with its
       writer calls and `sweepMeetingInvitees()` (§3.4);
     - guests of both kinds, the presenter rule;
     - **invitation answers:** answer and change until the start, the
       scheduler's notice with its flags, the summary line;
     - agenda, standing items, papers and attachments;
     - the clash check;
     - the `AGENDA_ISSUED` and `MEETING_CANCELLED` effects;
     - outside guest emails in the organisation's language;
     - `TASK_RECORD_TYPES`;
     - the working calendar's next-working-day and add-working-days.
   - **No migration.**
   - **Live after:** the API.
   - **6.1 PR 3a as built (18 Nov):**
     - `/meetings` (`foundation/meetings/`): `GET /`, `GET /:id`, `POST /`,
       `PATCH /:id`, `POST /:id/reschedule`. No route carries `@Permissions`:
       seeing is the parent rule, writing is `meeting-authority.ts`'s
       SCHEDULERS and the stage's rules, in the service. Cancel is the
       workflow's own move.
     - **Who sees a meeting** (`ObjectVisibilityService` MEETING,
       `common/services/meeting-membership.ts`): `meetings:view`, an active
       member of its active committee, an ACTIVE person of its unit, an
       invited attendee (`invitedAt` set), or (oversight, reads) a head or acting head of the owning
       unit or a unit above. Anyone else gets the identical 404.
     - **Who writes:** SCHEDULERS, on a meeting the viewer sees. Oversight
       counts for seeing it: a head above holding
       `meetings:schedule_subunits` may schedule it, so may edit it; without
       the key they read only (`MEETING_NOT_ALLOWED`).
     - **Lock order:** the meeting's instance FOR SHARE (`assertStageAllows`),
       then the meeting row FOR UPDATE. A committee's meeting is scheduled only
       while the committee's stage allows `schedule_meeting` (its instance FOR
       SHARE, in the transaction that writes the meeting, its instance and the
       audit row).
     - **Refusals by code** (`meeting-refusal.ts`): `MEETING_OWNER_REQUIRED`,
       `MEETING_OWNER_NOT_FOUND`, `MEETING_NOT_ALLOWED`, `MEETING_TYPE_UNKNOWN`,
       `MEETING_TIME_IN_PAST`, `MEETING_PLACE_REQUIRED`,
       `MEETING_QUORUM_UNIT_ONLY`, `MEETING_CHANGED`,
       `MEETING_RESCHEDULE_SAME_TIME`, `MEETING_TITLE_REQUIRED`; and the stage's own
       `STAGE_ACTION_NOT_ALLOWED`.
     - **The list:** views `mine`, `past`, `minutes`, `all` (`meetings:view`
       only, else 403) and `subunits` (overseen and not otherwise theirs);
       visibility in the WHERE before LIMIT; ordered by time, id last.
     - **Reschedule** writes a `MeetingReschedule` (THIS_ONLY) with its reason,
       and tells the invited after the commit.
     - **The engine gained two registries, keyed by record type:**
       - `TRANSITION_EFFECTS` (`transition-effects.ts`): prepare before, apply
         inside the move's transaction, finish after the commit; an effect
         runs when a move ENTERS its flag.
       - `MOVE_REASON_FLAGS` (`move-reasons.ts`): a move into a flagged stage
         refuses an empty comment (400 `REASON_REQUIRED`), on the press and the
         deciding vote; the moves list says `needsReason`.
       - MEETING: `AGENDA_ISSUED` stamps `invitedAt` on the user attendees not
         yet invited and tells them; `MEETING_CANCELLED` needs a reason and
         tells the invited with it. Never the actor.
     - **Tasks:** `TASK_RECORD_TYPES` MEETING, with four keys:
       `meetings:view_all_tasks`, `view_unit_tasks`, `create_tasks` and
       `manage_tasks`. QUALITY_MANAGER gets view_all, create and manage; the
       read-only admin the two view keys. They are added to
       `backfill:acc316-meeting-keys`, where the two view keys follow
       `meetings:view` (the read-only admin never holds `meetings:manage`) and
       the other two follow `meetings:manage`. A cancelled meeting takes no new tasks
       (`TASK_RECORD_CLOSED`, worded for a meeting).
     - **The working calendar:** `nextWorkingDay(day)` and
       `addWorkingDays(day, n)`, on `yyyy-MM-dd` days in the organisation's
       calendar.
     - `PrismaService` gained the getters for PR 1's tables (they were
       missing).
     - **No migration.** Proved by `meetings.db-spec.ts` (real Postgres) and
       `meetings.service.spec.ts` (the isolation gate).
   - **6.2 PR 3b as built (18 Nov):** SYSTEM-REFERENCE §18.8–§18.12.
     - **Invitees:** scheduling fills in the MEMBER rows (the committee's
       active members with their seats, or the unit's own people).
       `MeetingInviteeSync` keeps them current:
       - its entry points: committee, unit, person, sweep;
       - the writers call it after they commit, never failing the write;
       - `SlaMonitorProcessor.sweepMeetingInvitees()` is the scheduled
         recomputer;
       - "open" means the stage allows `manage_guests` and the meeting has not
         started;
       - each meeting changes in a transaction that takes its instance FOR
         SHARE first.
     - **Guests** (organisation and outside): added and removed by a
       scheduler. Once the agenda is issued, they are invited at once.
     - **Answers:** until the start time. A change to "Can't attend" tells the
       organiser, flagged (quorum, officer seat, presenter). The record carries
       the summary for a scheduler and `myAnswer` for an invitee.
     - **The agenda:** ordered items, presenters who are invitees (a person
       not yet invited is added as a guest), standing, and "Agenda changed"
       after issue.
     - **Papers and attachments:** files owned by the agenda item or the
       meeting, guarded by the meeting's visibility rule; restored to their
       record by the recycle bin.
     - **The clash check:** `POST /meetings/clashes`, strict overlap, cancelled
       meetings left out, one query.
     - **Outside-guest emails:** the `outside-email` job, in the
       organisation's language, at issue, reschedule and cancel.
     - **Deliberate omissions:**
       - "Open actions from the last meeting" reads action items, so it ships
         with PR 4's minutes;
       - "an outside guest never owns an action item" is PR 4's write rule;
       - the Home "Answer the invitation" row is the screens' (PR 6).
     - **§3.9 is out of date in one detail:** ACC-95's `counted()` now
       exists (`common/i18n/plural.ts`). Meeting notices still store no count.
     - **Lane B's review of #351 (Prompt 153), all built:**
       - a presenting member who leaves becomes an organisation guest;
       - a presenter added as a guest needs `manage_guests`;
       - agenda item locks keep no paper alive past its item;
       - the clash check names no meeting the asker can't open, and checks
         only invitees;
       - https-only meeting links, with escaping pinned;
       - the meeting row FOR UPDATE after the instance in every people,
         agenda and answer write;
       - the answer's clock after the locks;
       - the clash window prefilter;
       - DTO caps;
       - the sync importing its services' modules (`StageRulesModule`);
       - auth's call after the audit row.
     - **No migration.**
4. **PR 4: minutes and review, backend.**
   - Changes:
     - attendance (pre-filled from "Can't attend") and quorum;
     - per-item minutes, decisions and votes;
     - action item drafts;
     - open actions from the last meeting;
     - minutes read by stage (§4.1);
     - Distribute and Return (APP, `inTx`);
     - answers, suggestions, apply and decline, review changes;
     - the reminder in the sweep;
     - the preconditions and `blockedBy`;
     - `TRANSITION_EFFECTS` with `MINUTES_FINAL`;
     - Home's review and answer rows.
   - **No migration.**
   - **Live after:** the API.
   - **6.3 PR 4 as built (19 Nov):** SYSTEM-REFERENCE §18.13.
     - **Routes:**
       - `GET /meetings/:id/minutes` and `PUT /meetings/:id/attendance`;
       - `PUT …/agenda/:itemId/minutes`, and the decisions under
         `…/agenda/:itemId/decisions`;
       - action items under `…/agenda/:itemId/actions` and `…/actions/:id`;
       - `PUT …/open-actions/:taskId/note`;
       - `POST …/distribute` and `POST …/return`;
       - `PUT …/review/no-corrections`, `POST …/review/suggestions`, and
         `…/apply` or `…/decline` on a suggestion;
       - `GET /meetings/awaiting-me` (Home).
     - **Departures from the plan:**
       - **Attendance complete is Distribute's own check**, inside its `inTx`
         under the meeting row's lock, and in the minutes read's `distribute`
         block. It is not a `TRANSITION_PRECONDITIONS` entry: Minutes Draft
         carries no flag to key it on, and ACC-255 retired keys. Only the
         approval's four checks are the precondition.
       - **The minutes' `draft` phase includes Agenda Issued for whoever
         records them** (it allows `record_attendance` from the start), so
         attendance can be taken during the meeting and read back.
       - **Return clears `reviewBy`; answers are kept per round**, so "answers
         reset" needs no delete: the next distribution opens round n + 1.
       - **The reminder also goes on the review date itself** if the sweep
         missed the day before. Never after the date.
       - **Home's rows are their own read**, `GET /meetings/awaiting-me`, not a
         part of `workflows/awaiting-me`. `MyWorkCountsService` joins it in PR 7.
       - **A decline's reply is optional.** The author is told either way.
       - **The engine:**
         - `TransitionEffectDeps` gained `tasks`, and each part of an effect
           gets the deps;
         - preconditions take `PreconditionServices`;
         - the moves list's `blockedBy`;
         - `WorkflowService.currentStagePool()`.
     - **Answered by lane B (Prompt 164), §6a:**
       - **Minutes Draft stays readable by whoever records only.** 6.6's Chair
         view is read as Minutes Review.
       - **An AI action-item draft with an empty owner or due date** stays in
         ACC-322's own row. Both columns stay NOT NULL.
5. **PR 5: series, backend.**
   - Changes:
     - patterns, holiday moves, titles;
     - the 12-month cap;
     - this-only and this-and-later edit and reschedule, keeping own edits;
     - cancel one, end series, the standing agenda;
     - series clashes.
   - **No migration.**
   - **Live after:** the API.
   - **6.4 PR 5 as built (19 Nov):** SYSTEM-REFERENCE §18.14.
     - **Routes:**
       - `POST /meetings/series/preview` (dates and clashes, writes nothing);
       - `POST /meetings/series`;
       - `POST /meetings/series/:seriesId/end`;
       - `PATCH /meetings/:id` and `POST /meetings/:id/reschedule` take
         `scope: THIS_AND_LATER`;
       - `GET /meetings?seriesId=` lists one series;
       - the meeting read says `series` (index, total, ended).
     - **Departures from the plan:**
       - **"This and all later" never carries the title:** a title is each
         meeting's own (§3.2), so it changes only the meeting edited.
       - **A "this and all later" reschedule shifts each later meeting by the
         same amount,** from its time read under its lock, then places it as
         creation does (off the working week, past a day the owner already
         meets), at the same time of day.
       - **End series cancels each meeting by its own Cancel Meeting** (the
         reason rule and its notices), one after another. Before anything, the
         caller must be able to press Cancel on every one, or the call is
         refused (`MEETING_SERIES_CANNOT_CANCEL`). One that still fails is
         named in `failed`, and the series is ended only when none did.
         Running it again finishes what is left; on an ended series it writes
         nothing.
       - **Lane B's review of #360 (Prompt 170), all built:**
         - the wall-clock start across a clock change;
         - End's pre-check and conditional stamp;
         - create's notices after the commit, each on its own;
         - the create transaction's reads done once, and its writes batched;
         - the cancel move read scoped by organisation;
         - the reschedule's placement.
         - An edit sends no notice, as one meeting's edit sends none.
       - **The standing agenda is copied at creation.** Changing it later on
         the series reaches no meeting already made (every meeting is made at
         once).
       - **The clash check's cap is 53,** a series' most meetings (weekly for
         twelve months, both ends included); it was 52.
6. **PR 6: screens, part 1.**
   - The rail item, `/meetings` with "Sub-units' meetings", the committee and
     unit panels, Schedule (one meeting), the meeting page through Agenda
     Issued.
   - The invitation answer and the scheduler's summary (§5, not drawn).
   - Add a guest, Reschedule, Cancel (with the reason dialog in the move
     buttons), the bell and record links.
   - **Live after:** a meeting can be scheduled, answered, its agenda issued,
     and the meeting cancelled.
   - **6.5 PR 6 as built (19 Nov):** SYSTEM-REFERENCE §18.15.
     - **Backend, read-only additions:**
       - `GET /meetings/form-choices` (the organisation's `meeting_type`
         values, as `getValues()` offers them);
       - `GET /meetings/may-schedule?committeeId=|orgUnitId=`;
       - `GET /meetings/:id/guest-candidates?q=&skip=&take=`;
       - the list's `q` (the title, LIKE's wildcards matched literally);
       - each move in the moves list carries `toStageFlags`.
     - **Departures from the plan and the design:**
       - **Schedulers see what they schedule (Ahmad, 19 Nov).** §4.1 gains a
         SCHEDULER clause: whoever may schedule the owner's meetings by
         `MEETING_SCHEDULERS` sees them, and manages them with the writes a
         scheduler already passes. Before it, a person of a committee's owning
         unit holding `meetings:schedule` was a scheduler (§4.2) but not a
         viewer, and `schedule()` created their meeting, then answered 404.
         May-schedule asks SCHEDULERS, the committee's stage and the parent
         rule; `schedule()` asks the parent rule before it writes.
       - **The panels list by the plain rule** (`view=upcoming`), not Mine, and
         count the server's totals. **All meetings** follows the list's
         `canSeeAll`. **The start is the tenant's wall clock** (FormatService's
         `wallClock()` / `instantAt()`).
       - **The panels follow the meetings module** (`isNavModuleOpen`,
         ACC-279's rule), like the rail item. With the module off, the committee
         page keeps its old placeholder and the unit page has no panel.
       - **Schedule opens only from a panel**, with the owner fixed. /meetings
         has no Schedule: no read lists the owners a person may schedule for.
         One button, Schedule; "Next: repeats" is PR 8's.
       - **Optional fields are unmarked**, as everywhere in the app (required
         ones carry the asterisk): the design's " · optional" suffixes are not
         drawn.
       - **Schedule's save error is in the footer**, as the design draws it.
         Duration, Location and Online link declare `message="none"`.
       - **The list** has the views and a title search only: no Attendance or
         Minutes column, no groups, no row menu, no filters. The list read
         carries none of it.
       - **The page's agenda is read-only**, with no papers. Editing the agenda,
         papers, "Presents item" and the attachments panel are not built.
       - **Not built:** "Who works this stage" (no read names it), the panel's
         restricted line and "All N meetings", the clash line.
       - **Issue Agenda's confirm** says the design's lead without the counts
         ("Sent to: …", "Papers: …"), which no read gives.
   - **6.6 PR 7 as built (19 Nov):** SYSTEM-REFERENCE §18.16. The agenda
     editor, papers and attachments, and PR 6's review follow-ups. The
     attendance-to-minutes screens listed under PR 7 below move to the next
     PR.
     - **The agenda editor:** Add item and Edit open one dialog (Title,
       Description, Presenter, Duration; Remove item, with a confirm, when
       editing). Rows reorder by drag or by the handle's arrow keys, said
       aloud. A presenter is an invitee, or a person found by name, who is
       added as a guest. Papers attach to an item; attachments to the meeting.
       Every write answers with the whole agenda, and the page reads the
       invitees again after one.
     - **Review follow-ups (P189):**
       - **The answer:** the three buttons carry `aria-pressed`; the plain
         "Attending" line shows only once answering has closed.
       - **The invitees:** the summary reads "Members: …"; each row ends with
         its answer, the note under it; the remove button is a muted icon
         named "Remove {{name}}".
       - **The panel's See all** opens /meetings filtered to that committee or
         unit (Upcoming and Past, the owner named, with a link to clear it).
       - **Mine leaves out the SCHEDULER clause:** a scheduler's own
         unit's meetings are in Upcoming and open, but are not "mine" unless
         they are invited or organise it.
       - **The scheduler check is uncorrelated:** the viewer's scheduling unit
         is read once per query (an InitPlan), not once per meeting row.
       - **A skipped time moves forward:** `instantAt()` reads 02:30 on
         8 Mar 2026 in New York as 03:30.
       - **The earliest day** for Schedule and Reschedule is read again each
         time the dialog opens.
       - **Spec strings** use the seed's own Arabic («الأجندة مُصدَرة»,
         «اعتماد المحضر», «رئيس اللجنة»).
     - **Departures:**
       - **The guest email's subject and body keep their own keys**: the app
         shares a string by reusing its key directly, not through a meeting
         key, so nothing was moved.
       - **Add a guest has no "Presents item" field.** A presenter is set from
         the agenda item's own Presenter field, which also adds a person found
         by name as a guest; the agenda row names who presents.
     - **After lane B's review (P198) and the design thread's (P199):**
       - **No silent lost update:** an edit sends only the fields changed; a
         reorder sends the order seen (`expectedItemIds`) and is refused
         `MEETING_AGENDA_CHANGED` (409) when the agenda moved meanwhile. Two
         people changing the same field is ACC-323.
       - **Reload, never Retry,** for the three "agenda is stale" refusals, in
         the panel and the item dialog; a failed re-read says so, with Retry.
       - **Keyboard reorder keeps focus** (`aria-disabled` while saving).
       - **The presenter search** needs `may.manageGuests`.
       - **`instantAt()`** tries the offsets a day either side, so a repeated
         time east of UTC is its first occurrence (Berlin's spec found it).
       - **Invitee rows say a status** («حضور», «اعتذار»), and P199's Arabic
         wording.
       - **No seeded meeting type adds a standing item**; standing items come
         only from a series' own standing agenda.
7. **PR 7: screens, part 2.** Split (P201, 19 Nov): #374 shipped its agenda
   and invitee half (§6.6). The rest is PR 7b to 7d, which this item now names:
   - **PR 7b, the meeting held and its minutes drafted:**
     - "Open actions from the last meeting" / «الإجراءات المفتوحة من الاجتماع
       السابق», the agenda's fixed first section: read from the last
       meeting's tasks, never moved, edited or removed, no papers; the
       Secretary's note on each in Minutes Draft;
     - attendance (tablet), the quorum line, "Quorum not met" on decisions;
     - the minutes: each item's discussion, decisions with votes, action item
       drafts (Raise action item);
     - Distribute Minutes, with what still holds it.
     - **As built (P202, 19 Nov):** SYSTEM-REFERENCE §18.17.
       - **Open actions read:** `GET /meetings/:id/open-actions`, rows only for
         whoever may read the last meeting's minutes (the same rule), each task
         linked only where its page would open it (batched).
       - **`distribute.defaultReviewBy`** on the minutes read, so the screen
         does no working-day arithmetic; one helper, `reviewDayDefaults()`.
       - **Departures:** Distribute's confirm leaves out the design's "Told: 3
         others · 1 guest" (the server tells only the present members); the
         Action items summary card and the review card are 7c's.
       - **After lane B's review (P206):** answers shown only for the newest
         write; attendance taps queued; typed discussion kept; votes checked on
         the client; votes above the members present hold Distribute (one
         readiness check); "nothing to show" is `mayRead: false` both ways.
   - **PR 7c-1 as built (P212, 20 Nov):** SYSTEM-REFERENCE §18.18. The banner,
     the Review card, Suggest a correction, suggestions on their items with
     Edit to apply (the write first, then apply, Retry for apply alone) and
     Decline (the reply required on the server too,
     `MEETING_SUGGESTION_REPLY_REQUIRED`), Return for Correction. Approval,
     "Can't move yet" (one blocker at a time; all of them is ACC-326) and Home's
     review rows are 7c-2.
     - **After lane B's review (P220):** marking applied is safe to press twice
       and after a lost answer (`MEETING_SUGGESTION_DECIDED` reads as applied);
       an apply failure is said from its code (Retry only when unreachable,
       Reload when stale, else its own sentence); `MEETING_CHANGED` and the two
       suggestion codes offer Reload everywhere in the review; "No corrections"
       only before any answer; Return's refusal in the footer; Decline keeps its
       quote while closing; Suggest has no `about` input (no per-item Suggest
       is drawn).
   - **PR 7c-2 as built (P226, 20 Nov):** SYSTEM-REFERENCE §18.19. Approve
     Minutes held by its `blockedBy`, disabled with "Why?", opening "Can't move
     to Minutes Approved yet" (one blocker, said from its code; six lines then
     "and n more"); the Approve confirm; minutes to review counted on Home, the
     rail and `/awaiting` from one helper (`awaitingTotal()`), each row with
     `since` (the stage entry, a correlated subquery: the read stays 2 queries);
     the review writes and Distribute tell `MyWorkEvents`. Nothing on the
     per-request path.
   - **PR 7c, review and approval:** the review banner (No corrections /
     Suggest a correction), suggestions applied or declined, the Review card,
     Return for Correction, Approve Minutes with "Can't move to Minutes
     Approved yet" from `blockedBy`, and Home's Awaiting rows.
   - **PR 7d, print and phone:** the approved minutes on A4, and the phone
     (390) pass over every meeting screen.
     - **Answers to the slice plan (P229, 20 Nov):** (1) Print minutes is a
       button in the page header, approved minutes only, no row menu; (2) no
       sheet mode in 7d: each meeting dialog is checked to fit at 390, and
       sheets are raised separately (they change `EditDialogComponent` for the
       whole app); (3) Hijri on print follows the reader's preference (ACC-94
       D4); (4) artboard 16 (clash warnings) and the Repeat step go to the PRs
       that build those screens; (5) no phone-only print layout: the button
       stays at every width; (6) no task status on the print. `approvedBy` is
       read with the minutes, organisation-scoped, with the seat held at
       approval from the membership ledger (else the current seat).
     - **7d-1 as built:** SYSTEM-REFERENCE §18.20. **7d-2 as built:** §18.21,
       the phone by container queries: the meeting page's side cards above the
       agenda and 44px buttons, the banner's answers full-width with the
       primary first, and `/meetings` as cards.
   - **Live after 7d:** the whole single meeting, to approved minutes and tasks.
8. **PR 8: screens, part 3, series.**
   - Step 2 Repeat with its preview, the series line and view, the scope
     confirm, End series.
   - **Live after:** series.
   - **PR 8 slice plan (P235, 20 Nov).** Read against §3.2, §3.10,
     SYSTEM-REFERENCE §18.14 (the series backend as built) and the design's
     artboards 3, 10–11, 16 and their notes (A8, A9, R4-1, R5). Nothing is
     built yet. Each slice is reviewable alone and lands in this order.
     **Every dialog below is measured at the 420 body cap at 1280 and on a 390
     phone, in English and Arabic, as the PR 7 dialogs are.** Phones get
     dialogs that fit at 390, not sheets (P229).

     - **8a: Schedule, step 2 (Repeat), with its preview and clashes.**
       - **Screens:**
         - step 1 keeps Schedule (a one-off) and gains "Next: repeats";
         - the clash line under Starts ("2 of 11 invitees have another meeting
           then · Show who"), whose rows swap in for the step's body, with
           Starts and Duration kept so a change rechecks at once (artboard 16);
         - step 2: Repeats, Every, On (Day / The + Which + Weekday), the
           readback line, Ends (On a date / After n), the standing agenda
           line, and "Next dates and their titles" with the Moved, "No 31st ·
           last day" and Clash chips. A tapped Clash chip swaps the dates for
           that date's rows ("← All dates");
         - the button reads "Schedule n meetings".
       - **Reads:** `POST /meetings/clashes` (step 1), `POST
         /meetings/series/preview` (step 2: dates, moves and clashes in one
         read), and `POST /meetings/series` (create). The committee's
         `meetingFrequency` seeds Every (Q6).
       - **Measures:** step 1 with the clash line collapsed and with Show who
         (the design: 375 / 402 and 219 / 240); step 2 with both examples (402
         and 378); the Clash chip tapped (358 / 386). The tightest is step 2,
         Example 1 in Arabic (402 of 420).
     - **8b: The series on the meeting page, and the whole series.**
       - **Screens:** the header's series line ("Every month, the 4th
         Thursday · 4 of 12", with previous and next as links and "Whole
         series"); `/meetings?seriesId=` listing the series with its header,
         a cancelled meeting shown as Cancelled (A9).
       - **Reads:** `GET /meetings/:id` (its `series`, extended, Q1) and `GET
         /meetings?seriesId=` (built, PR 5).
       - **Measures:** the header at 1280 and 390, both languages (no dialog).
     - **8c: Which meetings change (edit and reschedule in a series).**
       - **Screens:**
         - Reschedule gains the clash line and rows in place (artboard 10–11,
           416 of 420 in Arabic: the tightest dialog of the PR);
         - in a series, Reschedule's button reads Next, and the scope confirm
           follows: "This meeting only" / "This and all later meetings", the
           range ("8 meetings, 22 Oct 2026 → 27 May 2027"), the kept line, and
           "2 of the 8 meetings have a clash · Show which" (192, 334 expanded);
         - **an Edit details dialog** (type, duration, place, link, quorum),
           which doesn't exist yet: `PATCH /meetings/:id` is built but only
           Reschedule has a screen (Q3). It asks the same scope.
       - **Reads:** `POST /meetings/:id/reschedule` and `PATCH /meetings/:id`
         (both with `scope`, built), `POST /meetings/clashes`, and a NEW
         scope preview (Q2).
       - **Measures:** Reschedule with its rows; the scope confirm collapsed and
         expanded; Edit details.
     - **8d: End series, and cancelling one meeting of a series.**
       - **Screens:** "End the monthly series?" (Last meeting, Cancelled n,
         Keep series / End series; 94 / 104), and Cancel Meeting's context
         reading "Only this meeting" for a series meeting.
       - **Reads:** `POST /meetings/series/:seriesId/end` (built), and the
         series list for the count.
       - **Measures:** both confirms.
     - **Not in PR 8:** the Outlook rows and the Outlook failure line
       (ACC-293); the list's row ⋯ menu and "Review" next step (B3, R3-9);
       sheets (P229).

     **Questions** (numbered; [T] technical, lane B decides; [A] changes what a
     person sees or can do, Ahmad decides). Each has my recommendation.

     1. **[T] The series line needs more than the read gives.** `MeetingDto.series`
        is `{ id, index, total, every, ended }`: no `on` for the readback, no
        previous or next meeting. *Recommendation:* extend it additively with
        `on`, `firstDate`, `endsOn`/`count`, and `previousId`/`nextId` (one
        indexed read of the series' meeting ids in order, only for a series
        meeting).
        **Decided by lane B (P236): yes. Built in PR 8-be (#388), with previousAt, nextAt and endedAfter added in 8b (#389, P240).**
     2. **[T] The scope confirm needs to know, before Apply, what "this and all
        later" would do:** the range, the meetings it reaches, what each kept,
        and each one's new time for its clashes. Today that's only computed
        inside the write (`scope.kept` comes back after). The new times can't
        be worked out on the screen: they move off non-working days and the
        owner's own meetings. *Recommendation:* `POST
        /meetings/:id/scope-preview` with the same body as the edit or the
        reschedule. It runs the write's own placement code read-only and
        answers `{ meetings: [{ id, title, startsAt }], kept: [...], clashes:
        [...] }`, organisation-scoped, under the same who-may-ask as the
        write. No migration.
        **Decided by lane B (P236): yes. Built in PR 8-be (#388): the write's own placement code, no write, no lock.**
     3. **[A] There's no screen to edit a meeting's details** (type, duration,
        place, link, quorum). The design's scope confirm is "Edit or reschedule
        in a series", and `PATCH /meetings/:id` is built, but only Reschedule
        has a screen. *Recommendation:* build Edit details in 8c, as Schedule
        step 1's fields without Starts, offered on `may.edit`, and asking the
        scope in a series.
        **Answered by Ahmad, 20 Nov: as recommended.**
     4. **[A] End series has no "Last meeting" choice.** The design ("Meetings
        after the one you choose are cancelled", Last meeting 22 Oct 2026)
        lets the person pick where the series stops. The built endpoint
        cancels every later meeting that hasn't started. *Recommendation:* add
        an optional `lastMeetingId` (the series keeps that meeting and those
        before it), defaulting to the next meeting held. So "End series" from
        a meeting's page means "after this one", as drawn.
        **Answered by Ahmad, 20 Nov: as recommended.**
     5. **[A] The standing agenda's "Edit…" in step 2 isn't drawn.**
        *Recommendation:* a swap view in step 2 (as Show who is), listing the
        items with title, presenter and duration, with Add and Remove, at most
        10 items. A presenter not yet invited becomes a guest, as built. The
        line reads "n items · Edit…", and "None · Add…" when empty.
        **Answered by Ahmad, 20 Nov: as recommended.**
     6. **[T] Every's starting value** comes from the committee's
        `meetingFrequency`: WEEKLY → every week, MONTHLY → every month,
        QUARTERLY → 3 months, BIANNUAL → 6 months, ANNUAL → 12 months.
        AS_NEEDED, and a unit (which has no frequency), start on "Doesn't
        repeat". *Recommendation:* that map, in one place on the screen, with
        the design's line "From the committee's frequency, Quarterly → every 3
        months".
        **Decided by lane B (P236): yes, one mapping in one place.**
     7. **[A] A long series' preview.** A weekly series has up to 53 dates;
        the design shows five and "+7 more dates" in the context line.
        *Recommendation:* the first five, then a line "n later dates · m moved
        · k have a clash · Show all", which swaps in the whole list (it
        scrolls inside itself). A Moved or Clash date beyond the fifth is then
        never hidden without a count.
        **Answered by Ahmad, 20 Nov: as recommended.**
     8. **[A] R5-4: the scope confirm with "This meeting only" chosen.**
        *Recommendation (the design's):* Reschedule's per-person line and rows
        for that one meeting.
        **Answered by Ahmad, 20 Nov: as recommended.**
     9. **[A] R5-5: Add a guest when the guest has a clash.** *Recommendation
        (the design's):* the same line for that person. The clash endpoint
        already takes `userIds`. It's a small part of 8c.
        **Answered by Ahmad, 20 Nov: as recommended.**
     10. **[A] R5-7: the warning anywhere else.** *Recommendation (the
         design's):* nowhere else in v1, not on the meeting page and not in
         notices.
         **Answered by Ahmad, 20 Nov: as recommended.**
     11. **[A] The series line after End series.** Not drawn.
         *Recommendation:* "Every month · ended after 4 of 12", with Whole
         series still a link.
         **Answered by Ahmad, 20 Nov: as recommended. Built in 8b (#389).**
     12. **[T] Already decided by the backend, recorded so they aren't
         reopened:**
         - R5-1: back-to-back isn't a clash;
         - R5-2: the same series counts;
         - R4-1: a moved meeting keeps the pattern's month in its title;
         - an outside guest is never checked.
         **Recorded by lane B (P236).**
9. **PR 9: contract.**
   - Drop `Meeting.status`, `Meeting.minutesText`, `AgendaItem.presenter` and
     `Task.meetingId`, after nothing reads them.

**Not in these slices:**

- Calendar availability and the Outlook rows (ACC-293);
- Meetings AI (ACC-322, §6a);
- `.ics` invites;
- a minutes PDF;
- confidential items;
- publishing to documents;
- e-signatures;
- meeting numbers.

---

## 6a. Meetings AI (ACC-322)

**Its own ticket, built after the nine PRs, not inside them.** The design is
`frontend/design-reference/AccreditMe AI for Users.dc.html`, section 6
(version 1795061547-1f3b, accepted as final by Ahmad on 19 Nov with build notes
1–4). The review is `design-review-meetings-ai-refresh-2026-11-19.md`. Every
surface uses `am-ai-assist` and `AiService.run()` (ACC-194), and only the
Secretary sees it.

**The six surfaces:**

- **6.1 Suggest agenda items (Planned):** from the committee's open tasks and
  pending approvals, each with its reason and source. Never one already in
  "Open actions from the last meeting". Ticked items are added as ordinary
  items.
- **6.2 Draft minutes (Minutes Draft):** from the Secretary's rough notes, a
  discussion and decisions per agenda item, each accepted, edited or discarded
  on its own. Votes are filled only when the notes state them.
- **6.3 Action items drafted with the minutes:** what, owner and due only.
  Accepting one adds a draft action item to its agenda item; no task until
  Approve Minutes.
- **6.4 Votes, quorum and attendance stay the Secretary's:** attendance is never
  AI. The quorum line and "Taken without quorum" come from attendance.
- **6.5 Summary for absent members (Minutes Approved):** beside Print minutes.
  It goes to the members attendance records as Apologies or Absent, never to
  guests.
- **6.6 Who is looking:** the Chair, members, guests and absent members see no
  trigger and no AI panel. Accepted text is ordinary minutes.

**M1–M10, as decided (Ahmad, 19 Nov: the designer's recommendations):**

- **M1:** Suggest agenda items in Planned only.
- **M2:** an undecided action-item suggestion does not hold Distribute Minutes.
  Its confirm says "3 AI suggestions undecided will be discarded", and they
  are.
- **M3:** the rough notes are seen by the writer only and deleted at Distribute
  Minutes. The history keeps "drafted with AI, accepted by …" per item.
- **M4:** added agenda items go before Any other business, in tick order.
- **M5:** Accept replaces what the Secretary typed in that item, with a line
  saying so. Edit is how to combine.
- **M6:** vote counts over the members present are copied as stated and
  flagged with the minutes' own error, never changed.
- **M7:** an action whose owner in the notes is an outside guest keeps an empty
  owner.
- **M8:** Draft again touches only items still empty or undecided.
- **M9:** no Draft minutes after Return for Correction in v1.
- **M10:** the trigger reads "Draft summary", with the aria-label "Draft a
  summary for absent members".

**What PRs 4–8 must not preclude.** Each hook is named with the PR it lands in.
None of the AI is built there:

| Hook | What ACC-322 needs | Lands in |
|---|---|---|
| Per-item minutes text an Accept can replace | `PUT /meetings/:id/agenda/:itemId/minutes` sets the item's whole `discussion`, never appends. Decisions are rows, each written on its own. So an Accept is one write per item. | PR 4 (API), PR 7 (the editor) |
| An action-item draft with an empty owner and an empty due date | **Not possible as built:** PR 1 made `MeetingActionItem.ownerUserId` and `dueAt` NOT NULL. So a suggestion with either one empty lives in ACC-322's own row, and Accept is offered only after Edit fills both, as the design draws for a past date. If ACC-322 stores a draft with them empty instead, that is an expand migration in ACC-322 making both nullable. The approval check (`minutesApprovalBlocks()`, PR 4) then gains `MEETING_ACTION_INCOMPLETE`, in the one place approval is checked. | PR 4 (the rule's one home), ACC-322 |
| A Distribute Minutes confirm that can carry a count line | The minutes read answers a `distribute` block (`ready`, `blockedBy`). ACC-322 adds its undecided count there. The confirm (PR 7) takes an optional extra line. Discarding happens inside Distribute's `inTx` (`MeetingReviewService.distribute()`), which ACC-322 extends. | PR 4 (the block, the `inTx`), PR 7 (the confirm) |
| A history entry naming who accepted an AI draft | Every minutes write records ONE Meeting audit row through one helper (`minutesAudit()`), with `metadata`. ACC-322 adds `aiDraft`, checked against the AI log as ACC-197 does. The history screen reads it. | PR 4 (the helper), PR 7 (the history) |
| Rough notes visible only to the writer, deleted at Distribute | ACC-322 stores them (its own table, read only by their writer), not PR 4. They are deleted in Distribute's `inTx`: the same hook as the count line. | ACC-322, on PR 4's `inTx` |

**Build notes for the screens PRs (6–8):**

- **The Secretary seat reads the lookup's label,** «أمين السر»
  (`lookup.seed.ts`), never a word written into a screen. That includes the
  attendance note («يسجّله أمين السر. …»). Both design files draw «أمينة السر».
- **The attendance card shows guests,** as Meeting Screens draws them: an
  organisation guest (Eng. Khalid Al-Shehri), and an outside guest with its
  "Outside guest" chip (Dr. Lina Mansour). 6.2's drawing lists the nine members
  only.
- **Arabic about a person stays neutral** (Ahmad, 6 Nov). Two of the design's
  strings are corrected in build note 1. The credits refusal says «لمنشأتك»,
  never «لمؤسستك», on every AI surface (build note 3).

- **The Chair doesn't read Minutes Draft** (lane B, Prompt 164). Minutes Draft
  is readable by whoever records the minutes only (§4.1). 6.6's "Minutes Draft ·
  seen by the Chair" is read as Minutes Review, where the Chair first reads the
  text, so PR 7's screens never draw the Chair in Draft.
- **An AI action-item draft with an empty owner or due date** stays in
  ACC-322's own suggestion row (lane B, Prompt 164). `ownerUserId` and `dueAt`
  stay NOT NULL, with no expand migration. Accept comes only after Edit fills
  both.

---

## 7. Open questions for Ahmad

None. The old Q1–Q5 are deleted:

- **Q1 (who works a unit meeting):** answered by Ahmad, 18 Nov (§0, §4.2).
- **Q2 to Q5:** decided by lane B, 18 Nov (§0).

Where the decisions differ from the design file is listed in §5 for a design
pass. That list is not questions.

---

## 8. Technical choices lane B decides (not asked)

- **The engine:**
  - the stage is the status;
  - entry effects keyed by flag (§3.8.1);
  - the reason rule (§3.8.2);
  - `blockedBy` on the moves list (§3.8.3);
  - Distribute and Return as APP moves (§3.8).
- **Three meeting-only assignee kinds, not a generic "key holders" kind** (§3.8).
- **One authority file, `meeting-authority.ts`,** read by the screens' flags, the
  writes and the pools.
- **MEETING is keyed from PR 2;** keys, names, who and movers are backfilled
  only where still the seed's.
- **The owner check is in the service, not a CHECK constraint.**
- **`ownEdits`** keeps a meeting's own edits through "this and all later".
- **"From item n"** comes through `MeetingActionItem.taskId`; no `Task` column.
- **An action item's due date** is checked against the MEDIUM task SLA limit
  from approval (ACC-174), when saved and again before approval.
- **"Quorum at risk" on a "Can't attend" notice:** the members who haven't said
  "Can't attend" fall below the quorum. The summary's warning is the stricter
  "attending < quorum" (Ahmad, 18 Nov).
- **People the scheduler adds** to a unit meeting are organisation guests.
- **"Page n of N" on print** degrades where CSS margin boxes are unsupported.
- **A series is created in one transaction:** 53 meetings at most, batched.
- **Every list pages on the server or states its cap.** No polling; nothing on
  the per-request path.

---

## 9. Review rounds

### Round 1 (Prompt 121, 17 Nov): what became of each point

| Point | Now |
|---|---|
| The approve hook | kept: §3.8.1. Approve stays PERSON for the Chair's pool. Distribute and Return became APP moves because they carry module writes. |
| Cancel's reason | kept: §3.8.2 |
| Q2's cost | settled by the design: the Chair approves. Neither "Everyone present" nor `MEETING_ATTENDEES` is needed, and nothing else in the design needs them. |
| `organizationId` everywhere | kept: §3.1 |
| No comments | replaced by the decided suggestions (§3.6) |
| Notices in both languages, no counts | kept: §3.9 |
| Guests' route | kept: §4.1 |

### Round 2 (Prompt 124, 18 Nov)

The plan is rewritten against the design thread. The old Q1–Q8 are deleted:
every one was answered between 6 Oct and 10 Nov (§0). The design file is in the
repo (`86cc3f3`).

### Round 3 (Prompt 128, 18 Nov)

- **Recorded in §0:**
  - Ahmad's decisions on the unit tree, the keys and invitation answers;
  - lane B's decisions on Q2–Q5.
- **Carried through:**
  - §3.4: answers;
  - §3.8: the pools and the three kinds;
  - §3.9: the notice;
  - §4: seeing down the tree, the action table, the keys;
  - §5: design differences;
  - §6: re-sliced, with the migration first;
  - §7: no questions.
- **`meetings:approve_minutes` is kept.** The round 2 plan had retired it.

### Round 4 (Prompt 129, 18 Nov)

1. **The pools read the same predicates as the buttons.**
   - Planned is `MEETING_SCHEDULERS`; Agenda Issued is `MEETING_SCHEDULERS` ·
     `MEETING_RECORDERS`; Minutes Draft is `MEETING_RECORDERS`.
   - Those kinds now include, for a committee meeting, the members whose seat
     has `schedule_meeting` or `record_minutes`.
   - Minutes Review keeps the fixed Chair seat (§3.8, §4.2).
2. **PR 1 is the migration only.**
   - Keys, seat actions and every backfill move to PR 2, where the pool
     resolvers first read them.
   - The keys leave `PERMISSIONS_NOT_YET_CHECKED` there.
   - Each backfill writes one audit row per organisation it changes (§6).
3. **Reschedules are rows of `MeetingReschedule` only.** No columns on
   `Meeting` (§3.1, §3.8.2).
4. **The reminder stamp is `MeetingAttendee.reviewRemindedRound`**, set by one
   conditional UPDATE (§3.6).
5. **§6 PR 1 lists every new table and column, one per line.**
6. **Invitee upkeep:** every writer is named, and
   `SlaMonitorProcessor.sweepMeetingInvitees()` is the scheduled recomputer
   (§3.4, PR 3).
7. **Approve's preconditions include the SLA limit,**
   `MEETING_ACTION_PAST_SLA_LIMIT` (§3.8.3).
8. **`POST /meetings/clashes`** is open only to whoever may schedule for the
   owner or edit the meeting (§3.10).
