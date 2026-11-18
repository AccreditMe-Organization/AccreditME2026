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
  - For unit meetings, MEETING's `unit()` must return the meeting's own
    `orgUnitId`, and `committee()` null.
  - Today it returns the committee's unit; that changes in PR 1 (§3.8).
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
  - `rescheduledFromAt?`, `rescheduleReason?`;
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
  transaction, each with its instance (§7, Q4 for the horizon).
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
  - a unit's people (§7, Q2).

  Members joining or leaving later change the invitees of meetings still in
  Planned or Agenda Issued only.
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
  before the date. It is stamped per member and round, so it never repeats.
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

**The seed and the PR 1 backfill:**

| Stage (key unchanged) | Name | Who works it | Record actions allowed | Flags |
|---|---|---|---|---|
| `planned` | Planned | Secretary | `edit_details`, `manage_agenda`, `manage_guests`, `reschedule` | — |
| `agenda_ready` | **Agenda Issued** | Secretary | the four above, plus `record_attendance` (from the start time) | `AGENDA_ISSUED` |
| `minutes_draft` | Minutes Draft | Secretary | `record_attendance`, `record_minutes` | — |
| `minutes_review` | Minutes Review | Chair | `apply_suggestions`, `change_action_dates`, `suggest_correction` | — |
| `minutes_approved` | Minutes Approved | — | none | `MINUTES_FINAL` |
| `cancelled` | Cancelled | — | none | `MEETING_CANCELLED` |

- **"Secretary" and "Chair" mean:**
  - for a committee meeting: the `COMMITTEE` entry with no fixed committee (the
    meeting's committee) and the `secretary` or `chairman` seat;
  - for a unit meeting: see §7, Q1.
- **The stage keys stay.** They are never shown, and keeping them avoids a key
  backfill.
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
  - Return: the Minutes Review pool, OR `record_minutes` (seat or role) for the
    Secretary.
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
    - no past-due draft (`MEETING_ACTION_PAST_DUE`).
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

- **An outside guest's email** is a named `email-delivery` job sent through
  `TransactionalEmailService`.
  - It carries no link into AccreditMe. The online meeting link is not ours,
    and it is allowed.
  - Its language is §7 Q3.
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

### 4.1 Seeing

- **The parent rule (ACC-101) gains MEETING, the ACC-281 shape.** A viewer may
  see a meeting with any one of:
  - `meetings:view` (see all);
  - for a committee meeting: an active member of the committee
    (`committee-membership.ts`);
  - for a unit meeting: an active person of the unit (§7 Q2);
  - an invitee with a user (an attendee row with their id).
- **Batched** for lists. No query is run for a `meetings:view` holder. The
  refusals are as today: the 403 naming `meetings:view` when the request names
  the meeting, the identical 404 when only a row names it.
- **Minutes visibility:**
  - organisation guests see the minutes only after approval (round 1 Q9);
  - outside guests have no access at all;
  - members, §7 Q5.
- **The committee or unit panel** shows the restricted line to someone who may
  open the record but not its meetings (Design "Denied").
- **The meeting's workflow** follows the record (`InstanceAccess`).
- **Files** follow the meeting's rule. An organisation guest sees papers and
  attachments.
- **An organisation guest who isn't a member** reaches the meeting through:
  - the bell (`notificationLink()` MEETING);
  - Home;
  - the email.

  `/meetings/:id` has its own `permissionGuard` and no route permission, like
  `tasks.routes.ts:27-38`.
- **No query on the per-request path.**

### 4.2 Doing

| Action | Who |
|---|---|
| Schedule (one or a series) | committee: seat `schedule_meeting` (default Chair and Secretary, Design panel note) or `meetings:schedule`; unit: §7 Q1 |
| Edit, reschedule, agenda, guests, cancel | the stage's record action (§3.8), AND the same who as Schedule |
| Attendance, minutes, decisions, action items, open-action notes | `record_minutes` (seat default Secretary) or `meetings:record_minutes` |
| Apply or decline a suggestion, change action dates | the same as minutes |
| No corrections / Suggest a correction | a present member, in the open round |
| Issue Agenda, Record Minutes, Approve Minutes, Cancel Meeting | the stage's pool (ACC-271) |
| Distribute Minutes, Return for Correction | §3.8's APP moves |
| Print | anyone who may read the approved minutes |

- **Seat actions:** `schedule_meeting` and `record_minutes`, each with a
  `committee_member_role` default attribute and a backfill (ACC-283's way).
  `MEMBER_ACTIONS` gains both.
- **Keys:**
  - `meetings:schedule` is added;
  - `meetings:record_minutes` comes out of `PERMISSIONS_NOT_YET_CHECKED`;
  - `meetings:manage` becomes a seed-time umbrella (ACC-44);
  - `meetings:approve_minutes` is retired the ACC-244 way, because the stage
    pool approves.

### 4.3 Registries

- **Visibility:** MEETING with its member, unit and invitee clauses.
- **`TASK_RECORD_TYPES`:**
  - MEETING's four task keys;
  - the owning unit: the unit, or the committee's unit;
  - `acceptsTasksSql`: not on a `MEETING_CANCELLED` stage.
- **`RECORD_ROUTES`:** MEETING's `unit()` returns the meeting's `orgUnitId`
  (null for a committee meeting), and `committee()` its committee. This changes
  today's committee's-unit answer, which nothing reads yet: 0 meetings.
- **`RECORD_ACTIONS`:** the nine MEETING actions in §3.8. COMMITTEE gains
  `schedule_meeting`.
- **`STAGE_FLAGS`:** `AGENDA_ISSUED` and `MEETING_CANCELLED` (any number),
  `MINUTES_FINAL` (exactly one).
- **`TRANSITION_PRECONDITIONS`:** MEETING (§3.8.3).
- **`TRANSITION_EFFECTS`:** new, MEETING (§3.8.1).
- **The move reason rule:** new, MEETING (§3.8.2).
- **Nav:** Meetings after Committees, with `moduleKey: 'meetings'`. It shows to
  `meetings:view` holders, committee members and unit people.
- **Home:** the review row (§3.9). "My committees · 1 meeting this week" comes
  from the App Shell drawing.
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

1. **PR 1: the workflow and the registries** (backend).
   - Changes:
     - the seed and `backfill:acc316-meeting-workflow` (§3.8): names, who,
       movers, flags, record actions, and the self-loop deleted;
     - `RECORD_ACTIONS`, `STAGE_FLAGS` and `RECORD_FIELDS` MEETING;
     - COMMITTEE `schedule_meeting`;
     - the `RECORD_ROUTES` change.
   - **No migration.**
   - **Live after:** the Workflow page shows the decided Meeting workflow.
2. **PR 2: schema and keys.**
   - Migration `acc316_meetings`:
     - every new table in §3;
     - the new `Meeting` and `AgendaItem` columns;
     - the `typeValueId` FK;
     - `StoredFileOwnerType` MEETING and MEETING_AGENDA_ITEM. No row of either
       before PR 3 deploys (ACC-173's rule).
   - The seat actions and their defaults (`backfill:acc316-seat-defaults`).
   - `meetings:schedule`, and `approve_minutes` retired
     (`backfill:acc316-retire-approve-minutes`).
   - **Live after:** the seat screens show the two actions.
3. **PR 3: one meeting, backend.**
   - Changes:
     - schedule, read, paged list with the saved views, edit, reschedule,
       cancel (with the reason rule and `needsReason`);
     - owner committee or unit;
     - visibility;
     - invitees, guests (both kinds, presenter rule);
     - agenda, standing items, papers and attachments;
     - the clash check;
     - the `AGENDA_ISSUED` and `MEETING_CANCELLED` effects;
     - outside guest emails;
     - `TASK_RECORD_TYPES`;
     - the working calendar's next-working-day and add-working-days.
   - **No migration.**
   - **Live after:** the API.
4. **PR 4: minutes and review, backend.**
   - Changes:
     - attendance and quorum;
     - per-item minutes, decisions and votes;
     - action item drafts;
     - open actions from the last meeting;
     - Distribute and Return (APP, `inTx`);
     - answers, suggestions, apply and decline, review changes;
     - the reminder in the sweep;
     - the preconditions and `blockedBy`;
     - `TRANSITION_EFFECTS` with `MINUTES_FINAL`;
     - Home's review row.
   - **No migration.**
   - **Live after:** the API.
5. **PR 5: series, backend.**
   - Changes:
     - patterns, holiday moves, titles;
     - this-only and this-and-later edit and reschedule, keeping own edits;
     - cancel one, end series, the standing agenda;
     - series clashes.
   - **No migration** (the series table is in PR 2).
   - **Live after:** the API.
6. **PR 6: screens, part 1.**
   - The rail item, `/meetings`, the committee and unit panels, Schedule (one
     meeting), the meeting page through Agenda Issued, Add a guest, Reschedule,
     Cancel (with the reason dialog in the move buttons), the bell and record
     links.
   - **Live after:** a meeting can be scheduled, its agenda issued, and the
     meeting cancelled.
7. **PR 7: screens, part 2.**
   - Attendance (tablet), minutes, votes, action item drafts, open actions, the
     review banner and suggestions, the Review card, Approve and Return, Home's
     review row, print, phone.
   - **Live after:** the whole single meeting, to approved minutes and tasks.
8. **PR 8: screens, part 3, series.**
   - Step 2 Repeat with its preview, the series line and view, the scope
     confirm, End series.
   - **Live after:** series.
9. **PR 9: contract.**
   - Drop `Meeting.status`, `Meeting.minutesText`, `AgendaItem.presenter` and
     `Task.meetingId`, after nothing reads them.

**Not in these slices:**

- Calendar availability and the Outlook rows (ACC-293);
- Meetings AI;
- `.ics` invites;
- a minutes PDF;
- confidential items;
- publishing to documents;
- e-signatures;
- meeting numbers.

---

## 7. Open questions for Ahmad

Only what the files leave open. Each says which files were checked. Each takes
one word, and **(recommended)** marks the suggestion.

**Q1. In a unit meeting, who schedules it, records the minutes and approves them?**

- Head **(recommended)**: the unit's head or acting head schedules and approves,
  and the organiser records.
- Organiser: whoever scheduled it does all three.

*Checked:*
- brief 1.1 and 1.12: unit meetings exist, with an optional quorum;
- Design: "Who works this stage" and the panel note name only the Secretary and
  Chair seats of a committee;
- Answers: lane B Q1 keeps unit meetings, with no rule for who.

**Q2. Who are "the unit's people", for invitees and for who may see a unit meeting?**

- Unit **(recommended)**: active people whose own unit is this unit.
- Subunits: the unit and every unit under it.

*Checked:* brief 1.1 ("the people in that unit"); Design, panel "Denied"
("this unit's people").

**Q3. Which language is an outside guest's email in?**

- Organisation **(recommended)**: the organisation's language.
- Both: English and Arabic in one email.

*Checked:* round 4 point 2 and Design section 12 draw it in both languages, but
say nothing about which one is sent. R4-3 fixes only the format.

**Q4. Can a series run more than 12 months ahead?**

- Cap **(recommended)**: the end is at most 12 months ahead, and every meeting
  is created at once.
- Roll: any end; meetings are created 12 months ahead, and a job adds more as
  time passes.

*Checked:* brief 1.10 ("created up to 12 months ahead"); Design step 2 ("Ends:
On a date / After"). Neither says what happens beyond 12 months.

**Q5. Can members read the minutes while the Secretary is still drafting them?**

- Review **(recommended)**: members read them from Minutes Review on; until
  then only whoever records minutes sees the draft.
- Draft: members read the draft as it is written.

*Checked:* round 1 Q9 settles guests only (after approval); brief 1.6 and 3.7;
Design's stage table lists who EDITS, not who reads.

---

## 8. Technical choices lane B decides (not asked)

- **The engine:**
  - the stage is the status;
  - entry effects keyed by flag (§3.8.1);
  - the reason rule (§3.8.2);
  - `blockedBy` on the moves list (§3.8.3);
  - Distribute and Return as APP moves (§3.8).
- **The stage keys stay;** names, who and movers are backfilled only where
  still the seed's.
- **The owner check is in the service, not a CHECK constraint.**
- **`ownEdits`** keeps a meeting's own edits through "this and all later".
- **"From item n"** comes through `MeetingActionItem.taskId`; no `Task` column.
- **An action item's due date is checked against the task SLA limit** (ACC-174)
  of the default priority, MEDIUM, counted from approval. It is checked when
  the draft is saved, and again before approval. A date past the limit blocks
  approval with the limit named.
- **"Page n of N" on print** degrades where CSS margin boxes are unsupported.
- **A series is created in one transaction** under the Q4 cap. With 12 months
  weekly, that is 53 meetings at most, each with its instance and invitees,
  batched.
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
