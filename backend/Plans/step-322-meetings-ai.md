# ACC-322 — Meetings AI

Agenda suggestions, a minutes draft with its action items, and a summary for
absent members.

**Sources:**
- **The design (final, Ahmad, 19 Nov):** "AccreditMe AI for Users.dc.html",
  section 6, version 1795061547-1f3b, in `frontend/design-reference/`.
- **The review:** `design-review-meetings-ai-refresh-2026-11-19.md`, with
  M1–M10 and build notes 1–4.
- **The Meetings plan:** `backend/Plans/step-316-meeting-management.md` §6a
  lists the hooks that PRs 4–8 leave for this ticket.
- **The code:** read against dev `5ae3667` (20 Nov), which has Meetings PRs 1
  to 7b (#343 to #376). PRs 7c, 7d, 8 and 9 are not merged yet.

The four features in the ticket become **three AI calls**:
- Action items are drafted in the same call as the minutes (design 6.2/6.3), so
  they have no separate price.
- 6.4 (votes, quorum and attendance) and 6.6 (who is looking) are rules, not
  calls.

---

## 0. What the design settles, and where it overrides the ticket

- **Only the person who works the stage presses** (6.6): the Secretary in
  Planned and in Minutes Draft, and whoever records the minutes on the
  approved meeting. The ticket's wider wording ("whoever may open the
  meeting") is replaced by the design.
  - The Chair, members, guests and absent members never see a trigger, a
    suggestion, the rough notes or an undecided count.
- **The agenda never re-suggests the last meeting's open actions** (6.1). They
  already appear in the agenda's fixed first section. The ticket's "the last
  meeting's open action items" as a source is therefore an exclusion, not an
  input.
- **M1–M10 as decided:**
  - **M1:** Suggest agenda items in Planned only.
  - **M2:** undecided suggestions are named in the Distribute Minutes confirm,
    then discarded.
  - **M3:** the rough notes are seen by their writer only, and deleted at
    Distribute Minutes.
  - **M4:** added agenda items go before Any other business, in tick order.
  - **M5:** Accept replaces what the Secretary typed, and says so.
  - **M6:** vote counts are copied as stated and flagged, never changed.
  - **M7:** an outside guest is never suggested as an owner; the owner is left
    empty.
  - **M8:** Draft again touches only items that are empty or undecided.
  - **M9:** Draft minutes is not offered after Return for Correction.
  - **M10:** the trigger reads "Draft summary", with an aria-label.
- **Build notes 1–4:**
  1. Arabic about a person stays neutral.
  2. The Secretary seat reads the lookup's «أمين السر».
  3. The credits refusal says «منشأتك».
  4. Attendance shows guests.

---

## 1. The three features

### 1.0 Rules common to all three

- **One gateway.** Every call goes through `AiService.run()` (ACC-194):
  - credits are reserved first, then the call is made;
  - a failed call, or an answer refused by `accept()`, is refunded into the
    same period;
  - the log keeps no customer text. Its description is written by our code,
    ids and counts only (for example "Meeting cmv… minutes draft, 5 items").
- **The model chooses; our code writes every word around the choice**, as
  ACC-198 and ACC-199 do:
  - **The answer is JSON**, and it refers to inputs only by the labels we sent
    (`S1`, `A2`, `P3`).
  - **Our code drops an unknown label**, a duplicate, or anything over its cap.
  - **Our code writes:** every source line, reason line, date, link, recipient
    list and refusal.
  - **The model writes only:** the free text the design shows as AI text (an
    agenda item's title and reason, an item's discussion and decisions, an
    action's "what", and the summary).
- **Language.** Each call is written in the presser's interface language.
  - The request names it (`en` | `ar`), as ACC-193 does, and it is stored on
    the suggestion.
  - Names and codes stay as they are (design pattern note "Reader's
    language"; Q8 in section 1 of the drawing).
- **Names (ticket rule, and P224).**
  - **Nothing from our records is sent:** no attendee name, owner, presenter,
    author, seat holder, email or person id.
  - **The rough notes are the Secretary's own text, and are sent.** Before
    sending, our code replaces in the notes:
    - every invitee's name (members, organisation guests, outside guests)
      with a label `[P1]`, `[P2]`, …;
    - the full name of every ACTIVE person in the organisation who is not an
      invitee with a label as well;
    - **every email address** with `[email]`.
  - **The model answers with labels.** Our code maps each label back to a
    person, and writes the names back into the suggestion text.
    - So **an outside guest's name never reaches the model**, which is the
      ticket's rule.
    - And an owner is resolved exactly, by label, never by guessing at a
      name.
  - **How the replacement matches, in one file (`meeting-ai-names.ts`):**
    - the full name, and each name word of three or more letters when it
      belongs to exactly one invitee;
    - whole words only, ignoring case;
    - Arabic normalised: alef forms, alef maqsura and ya, ta marbuta and ha,
      tatweel and diacritics;
    - honorifics (Dr., Eng., د., م.) kept outside the label.
  - **What it cannot catch:** a name the Secretary misspells, or a person who
    is neither an invitee nor a user, stays as written. That is the
    Secretary's own text about their own meeting, and the notes line says the
    notes are used for drafting (Question 5).
- **Who and when are read live on every press, and again inside the save
  transaction** (§4).
  - The screens render flags; they never re-derive a rule.
  - **No access to the meeting:** the identical 404 a missing meeting gets
    (`MeetingAccess.seeing`).
  - **Access, but not the person who works the stage:** that write's existing
    refusal (`MEETING_NOT_RECORDER`, or the agenda's writing refusal).
  - **The wrong stage:** 409 `MEETING_AI_NOT_OFFERED`, with the stage's names.
    The trigger is absent there anyway; this is the backstop.
- **One run at a time per meeting and feature.**
  - A claim row is taken with `INSERT … ON CONFLICT … WHERE` before any call,
    and is stale after 3 minutes (ACC-198's shape).
  - A second press is 409 `MEETING_AI_IN_PROGRESS`, before any credit is
    reserved.
- **Saving the answer.**
  - The answer is saved in a transaction that takes the minutes' lock order:
    the instance FOR SHARE, then the meeting row FOR UPDATE.
  - That transaction re-checks the stage and the person.
  - If the meeting moved on during the call, nothing is saved, the call is
    still charged (the provider was paid, design Q2), and the refusal is
    `MEETING_CHANGED`, which offers Reload.
- **Leaving cancels.** The screen aborts the request when the person leaves
  (design pattern "Leaving cancels"). A request the provider already answered
  is charged and is not saved, as ACC-193 Q2.

### 1.1 Suggest agenda items (6.1)

**Where and who:**
- On the Agenda panel's header, for whoever may manage the agenda
  (`meeting.may.manageAgenda`), while the stage allows `manage_agenda` and is
  **not** flagged `AGENDA_ISSUED`.
  - That is Planned only (M1), read from flags, never a stage key.
- The suggestions open in the page's flow, above "+ Add agenda item".

**Sources, all gathered by our code:**
1. **Open tasks on the owner record that the presser may see.** "May see" is
   `taskVisibleSql()` in the `WHERE` before `LIMIT`, so the model never sees a
   task the presser could not open.
   - A committee meeting: tasks whose source is the committee, and tasks from
     the committee's earlier meetings.
   - A unit meeting: tasks from the unit's earlier meetings.
2. **Pending approvals:** the committee's open change request awaiting a
   decision (a committee meeting only; ACC-281 already lets a member read it).
3. **Excluded before sending:**
   - every task already in "Open actions from the last meeting" (the same
     `openActions()` read the agenda's fixed first section uses);
   - anything already on this meeting's agenda, matched by task id.
4. **A cap of 40 candidates:** overdue first, then by due date, then the
   newest.

**Sent to the model:**
- For each candidate: label `S1`–`S40`, its kind (task or change request), its
  title, status, due date, whether it is overdue, and its origin's type and
  date.
- The current agenda's item titles, so it doesn't repeat them.
- The meeting's title and type.

**Never sent:** assignee, creator, owner, requester, any person's name,
evidence or descriptions.

**Answer:** `{ picks: [{ source: "S4", title, reason }] }`, at most 3.
- The title is at most 80 characters, and the reason at most 140.

**Our code:**
- drops an unknown or repeated label;
- drops a pick whose source is excluded;
- writes the source line ("Open task · from IPC, 27 Aug 2026") and the link
  (`mayOpen`, the open-actions shape);
- writes the line "Not suggested again: the 3 open actions from 24 Sep, …";
- writes the footer "2 of 3 ticked · added before Any other business".

**Partial:** if the change-request read fails, the call goes ahead from the
tasks and the panel says "Approvals couldn't be checked." (design outMeet).

**Key, credits and effort:**
- `meeting_agenda_generation`: 3 credits (CLAUDE.md's price list).
- STANDARD tier, effort `low`, `maxTokens` 2,000, `inputTokenCap` 6,000.

**Refunded (not charged):**
- **Before any call:** no candidate after the exclusions
  (`MEETING_AI_NO_SOURCES`, "No open tasks or approvals to suggest from.").
- **Through `accept()`:** an empty, cut-short or unparseable answer, and an
  answer with no usable pick.

**Accepted, edited or discarded:**
- **Ticked, then "Add n items".** The added items are ordinary agenda items
  with no AI marks:
  - placed before the first of the agenda's trailing standing items (Any other
    business, M4), in tick order;
  - each audited CREATE with `aiDraft`.
- **Unticked suggestions are discarded with the add.**
- **"Suggest again"** replaces every undecided agenda suggestion.
- **Discard** removes one suggestion.
- **Editing happens on the added item**, through the ordinary agenda dialog.
  The suggestion itself has no edit, as drawn.

### 1.2 Draft minutes, with the action items (6.2, 6.3, 6.4)

**Where and who:**
- A Rough notes box with "Draft minutes" at the top of Agenda & minutes.
- For whoever records the minutes (`minutes.may.recordMinutes`), while:
  - the minutes are in their `draft` phase;
  - the stage allows `record_minutes` (seeded on Minutes Draft);
  - the meeting has never been returned (`reviewRound === 0`).
- **M9 needs no new column:** Return leaves `reviewRound` at its round, so a
  returned meeting in Minutes Draft always has `reviewRound ≥ 1`.

**The rough notes:**
- One box per writer, at most 30,000 characters.
- Saved as they are typed (debounced) by
  `PUT /meetings/:id/ai/notes`.
- Read only by their writer.

**Sent to the model:**
- The writer's notes, with names and emails replaced (§1.0), between markers,
  as data and never as instructions (ACC-197's rule).
- **The agenda items to draft,** as `A1`–`An`, each with its title and
  description.
  - **The first press** sends every item.
  - **Draft again (M8)** sends only the items still empty (no discussion and
    no decision) or with an undecided suggestion.
  - Nothing else is touched.
- **The titles of each item's action items already recorded**, so they are not
  suggested twice.
- **Today's date in the organisation's zone**, so the model can write a date
  that the notes give relative to the meeting.

**Never sent:**
- attendance;
- seats;
- the quorum;
- any name from our records;
- an outside guest's name, even when the Secretary typed it.

**Answer:**

```json
{ "items": [{ "item": "A2",
    "discussion": "…" | null,
    "decisions": [{ "text": "…", "votes": { "for": 5, "against": 1, "abstain": 0 } | null }],
    "actions": [{ "what": "…", "owner": "P3" | null, "due": "2026-11-30" | null }] }] }
```

Caps:
- the discussion is at most 1,500 characters;
- at most 5 decisions, each at most 400 characters;
- at most 6 actions per item, each "what" at most 140 characters.

**Our code, on the answer:**
- **Votes are copied only when all three counts are present** (6.4).
  - Otherwise the vote is empty, with "Vote: not in your notes · left empty".
  - **Counts are never changed (M6).** Votes above the members present are
    kept, and flagged by the minutes' own existing check
    (`MEETING_VOTES_EXCEED_PRESENT` holds Distribute).
  - "Taken without quorum" stays the attendance's, outside the suggestion.
- **An owner label is mapped to its person.**
  - **An outside guest** (`OUTSIDE_GUEST`) gives an empty owner with build
    note 1's reason: «لا يُقترح ضيف من الخارج مسؤولًا (د. لينا منصور). اختر
    شخصًا في المنشأة.» (M7).
  - **A user who is not ACTIVE, an unknown label, or no owner** gives an empty
    owner with a reason (Question 4).
  - **An organisation guest** who is staff may own an action, as drawn.
- **A due date in the past, or not a date,** gives an empty due date with "The
  date in your notes, 15 Sep, has passed. Choose a due date." The date is
  checked by the same rule as `futureDue()`.
- **An item answered as "nothing"** gives "Nothing in your notes for this
  item."

**Key, credits and effort:**
- `minutes_drafting`: 8 credits (CLAUDE.md's price list).
- **The action items are part of this call and cost nothing extra.**
- STANDARD tier, effort `medium`, `maxTokens` 8,000, `inputTokenCap` 20,000.
- The 30,000-character notes cap keeps an Arabic note under the input cap.

**Refunded (not charged):**
- **Before any call:**
  - no notes: `MEETING_AI_NO_NOTES`, "Add notes first.";
  - nothing left to draft under M8: `MEETING_AI_NOTHING_TO_DRAFT`. The trigger
    is absent then; this is the backstop.
- **Through `accept()`:** an empty, cut-short or unparseable answer, and an
  answer with no usable item. A draft cut short is never shown half (design
  "Partial").

**Accepted, edited or discarded, one suggestion at a time:**
- **The minutes suggestion for an item:**
  - **Accept replaces the item's discussion and its decisions (M5),** in one
    transaction. The line says what it replaces:
    - "Accepting replaces the discussion you typed." (drawn);
    - two new lines for decisions alone, and for both (§8).
  - **Edit does the same** and moves focus into the discussion field. Later
    changes are ordinary minutes writes.
  - **Discard** removes the suggestion.
- **An action-item suggestion:**
  - **Accept** is offered only when the owner and the due date are both set.
  - **Edit** opens round 3's inline row, prefilled, to choose what is missing.
    Saving it accepts the suggestion with those values.
  - **What Accept checks:** the same rules as `addActionItem()`: a title, an
    owner who is a person in the organisation, and a due date in the future.
  - **Accept adds an ordinary draft action item** reading "Becomes a task when
    the minutes are approved". Approve Minutes makes the task, through
    `MINUTES_FINAL`'s existing effect.
  - **Discard** removes the suggestion.
- **Draft again** replaces the undecided suggestions of the items it drafts.
  It never touches accepted text, or an item that no longer has an undecided
  suggestion (M8).
- **The undecided count:**
  - It is shown in the minutes header and the Action items card (design).
  - It counts every undecided minutes suggestion and action-item suggestion.
  - **At Distribute Minutes (M2):** the confirm says "3 AI suggestions
    undecided will be discarded", and Distribute deletes them, inside its
    `inTx`.
  - The count never holds Distribute.

### 1.3 Draft summary for absent members (6.5)

**Where and who:**
- "Draft summary" beside Print minutes, with the aria-label "Draft a summary
  for absent members" (M10). The panel opens under the locked line.
- For whoever records the minutes, while the stage is flagged `MINUTES_FINAL`,
  and at least one MEMBER is recorded Apologies or Absent.
  - With nobody recorded absent, there is no trigger: nobody would receive the
    summary.

**Sent to the model:**
- **The approved minutes:**
  - each item's title, discussion and decisions, with votes and "taken without
    quorum";
  - its action items, with the owner as a label and the due date.
- Names inside the minutes are replaced by labels, as in §1.0. The summary
  goes to the meeting's own members, but the rule that no name from our
  records is sent still holds.

**Never sent:** the recipients, the attendance, or any guest.

**Answer:** `{ summary }`, at most 1,500 characters, written in the
Secretary's language (design: "in the Secretary's language"). Labels are mapped
back to names by our code.

**Our code writes:**
- "To · 3 members recorded absent";
- the guests line, with build note 1's text: «من سجل الحضور. لا يشمل الضيوف:
  م. خالد الشهري، ود. لينا منصور (ضيف من الخارج). لا يصل المحضر إلى الضيوف من
  الخارج.»;
- "What they'll receive";
- "No replies";
- the Send confirm.

**Key, credits and effort:**
- New key `absent_member_summary`, at the credits in Question 1.
- STANDARD tier, effort `low`, `maxTokens` 3,000, `inputTokenCap` 15,000.

**Refunded (not charged):**
- **Before any call:** nobody recorded absent (`MEETING_AI_NO_ABSENT`).
- **Through `accept()`:** an empty, cut-short or unparseable answer.

**Accepted, edited or discarded:**
- **The text is editable in the panel.** Edit moves focus into it.
- **Send (confirm 420, measured 90 / 103 in the design):**
  - It sends the text as shown, at most 2,000 characters.
  - The recipients are recomputed on the server from attendance: MEMBERS
    recorded Apologies or Absent who are ACTIVE users. Never guests.
  - It goes as an in-app notification and an email, in the Secretary's
    language, from the Secretary, with a link to the approved minutes and no
    reply path (design Q9).
- **Recorded on the meeting:**
  - `absentSummarySentAt` and `absentSummarySentById`;
  - one audit row naming the recipients' ids and `aiDraft`.
- **After it is sent,** the trigger is replaced by "Summary sent 25 Sep to 3
  members" (Question 3).
- **Discard** removes the suggestion.
- **Draft again** replaces it.

---

## 2. What is stored, and when it is deleted

One migration, `acc322_meetings_ai`. It is **additive**: two new enums, three
new tables, and two nullable columns. No existing enum gains a value, so
ACC-173's rule is met by construction: no row exists before the code that
reads it.

```prisma
enum MeetingAiKind {
  AGENDA_ITEM
  ITEM_MINUTES
  ACTION_ITEM
  ABSENT_SUMMARY
}

enum MeetingAiRunKind {
  AGENDA
  MINUTES
  ABSENT_SUMMARY
}

/// The rough notes: one per writer, read only by that writer (M3).
model MeetingAiNotes {
  id             String   @id @default(cuid())
  organizationId String
  meetingId      String
  writerId       String
  text           String
  updatedAt      DateTime @updatedAt
  @@unique([meetingId, writerId])
  @@index([organizationId])
}

/// An UNDECIDED suggestion. Accept and Discard delete the row; nothing decided is kept here.
model MeetingAiSuggestion {
  id              String        @id @default(cuid())
  organizationId  String
  meetingId       String
  agendaItemId    String?       // null for AGENDA_ITEM and ABSENT_SUMMARY; onDelete: Cascade
  kind            MeetingAiKind
  order           Int
  language        String        // 'en' | 'ar'
  payload         Json          // the parsed, checked suggestion, names already written back
  aiInteractionId String?       // the call that made it (AiInteractionLog), for aiDraft
  createdById     String
  createdAt       DateTime      @default(now())
  @@index([organizationId])
  @@index([meetingId, kind])
}

/// The one-run-at-a-time claim, and the last finished run.
model MeetingAiRun {
  organizationId String
  meetingId      String
  kind           MeetingAiRunKind
  claimedById    String?
  claimedAt      DateTime?
  lastDoneAt     DateTime?
  @@id([meetingId, kind])
  @@index([organizationId])
}

// On Meeting, both nullable:
//   absentSummarySentAt   DateTime?
//   absentSummarySentById String?
```

Every table carries `organizationId`, and every read scopes by it with the
row's id. Each relation to `Meeting` is `onDelete: Cascade`.

**Why the suggestions are stored, not only shown:**
- The undecided count must survive a reload, and reach Distribute's confirm.
- Accept reads the suggestion from the server. So the accepted text is the
  text the model wrote, and `aiDraft` is proved by construction: the row
  carries its `aiInteractionId`.
- This is stronger than ACC-197's claim check, which is not needed here.

**When each thing is deleted:**

| What | Deleted |
|---|---|
| Rough notes | At Distribute Minutes (inside `MeetingReviewService.distribute()`'s `inTx`, M3); on entering a `MEETING_CANCELLED` stage (the existing `cancelled` effect gains this part); with the meeting |
| `ITEM_MINUTES` and `ACTION_ITEM` suggestions | On Accept or Discard; replaced by Draft again; at Distribute (counted in its confirm, M2); at cancel; with their agenda item |
| `AGENDA_ITEM` suggestions | On "Add n items" (ticked and unticked), on Discard; replaced by Suggest again; on entering the `AGENDA_ISSUED` stage (the existing `agendaIssued` effect gains this part); at cancel |
| `ABSENT_SUMMARY` suggestion | On Send or Discard; replaced by Draft again |
| `MeetingAiRun` | Never; one small row per meeting and feature. A claim is stale after 3 minutes |

**The record after Accept is the Meetings record.** The history keeps
"drafted with AI, accepted by …" (M3, design Q10) through `minutesAudit()`'s
`after.minutes.aiDraft = { interactionId, kind }`. The agenda's CREATE audit
carries the same field. **No text is in the audit or the AI log.**

---

## 3. The hooks from Meetings PRs 4–8

Read on dev `5ae3667`, against step-316 §6a.

| Hook | On dev? | Where | What ACC-322 does with it |
|---|---|---|---|
| An item's discussion is replaced whole, never appended | **Yes** | `MeetingMinutesService.setItemMinutes()` (PR 4) | Accept replaces it (M5) |
| Decisions are rows, written one at a time | **Yes** | `addDecision` / `updateDecision` / `removeDecision` (PR 4) | Accept replaces the item's rows in the same transaction |
| A way to make several minutes writes in ONE transaction, with the lock order, the stage rule, the review-change record and one audit row | **Missing**: `write()` is private | `meeting-minutes.service.ts` | ACC-322 PR 1 adds `MeetingMinutesService.applyAiDraft()`, beside the writes it reuses, so the minutes keep one owner |
| The action-item rules (a title, an owner who is a person, a future date) | **Yes**, but inside `addActionItem()` | PR 4 | Extracted to one function that `addActionItem()` and the AI accept both call |
| `minutesAudit()` takes free `after` metadata | **Yes** | PR 4 | `aiDraft` is added there |
| The minutes read's `distribute` block | **Yes**: `ready`, `blockedBy`, `defaultReviewBy` | PR 4, 7b | Gains `aiUndecided: number` |
| Distribute's `inTx` | **Yes** | `MeetingReviewService.distribute()` (PR 4) | Deletes the notes and the undecided minutes suggestions |
| The Distribute confirm | **Yes**, but with no extra line | `meeting-distribute-dialog` (PR 7b) | It already takes `minutes`, so it reads `distribute.aiUndecided` and adds the M2 line itself; no new input |
| The entry effects for `AGENDA_ISSUED` and `MEETING_CANCELLED` | **Yes** | `meeting-effects.ts` | Each gains a delete |
| Approve makes the tasks from the action items | **Yes** | `MINUTES_FINAL` effect | Unchanged: accepted AI drafts are ordinary action items |
| "Open actions from the last meeting" | **Yes** | `MeetingMinutesService.openActions()` (PR 7b) | The agenda's exclusions |
| An add that goes before Any other business | **Missing**: `create()` appends at `max(order) + 1` | `meeting-agenda.service.ts` | ACC-322 PR 3 adds `addItems(…, { beforeTrailingStanding })` in the agenda service, under `lockAgenda`, renumbering in the same transaction |
| The meeting history screen that reads `aiDraft` | **Missing** (PR 7c or later) | — | The audit is written from PR 1; the "drafted with AI, accepted by …" line shows when the history screen exists |
| The approved page: the locked line, Print minutes | **Missing** (PR 7c, PR 7d) | — | The summary (PRs 5–6) waits for 7d |
| The phone pass | **Missing** (PR 7d) | — | Each ACC-322 screen PR lays its own panel out at 390, as the design draws |
| Action items with an empty owner or due date | **Decided: not stored** (lane B, Prompt 164) | — | Kept in the suggestion's payload; Accept only once both are set. No migration on `MeetingActionItem` |

**Series (PR 8) and contract (PR 9) touch nothing here.** A series copies
standing items, which M4 already places items before.

---

## 4. Locks, queries and tests

**Lock order: the minutes', unchanged.** The instance FOR SHARE, then the
meeting row FOR UPDATE, then the agenda item.
- `applyAiDraft()` and the action accept go through it.
- The agenda add goes through `lockAgenda`.
- Distribute's delete is inside a transaction that already holds the meeting
  row.

**Reads:**
- **`GET /meetings/:id/ai`** is one read for the page:
  - the viewer's notes;
  - the undecided suggestions by kind;
  - `may: { suggestAgenda, draftMinutes, draftSummary }`;
  - `available` per feature, from `openAiFeatures` (ACC-194), as ACC-193's
    `available`;
  - any run in progress.
- **Everyone who sees the meeting gets an answer.** A viewer who works no
  stage gets every flag false and no content: no error, like `mayRead: false`
  (P206).
- **At most 5 queries, whatever the size.** Nothing is added to the
  per-request path (ACC-271's performance rule).

**Writes:**
- `PUT /meetings/:id/ai/notes`
- `POST /meetings/:id/ai/agenda`, `…/agenda/add`
- `POST /meetings/:id/ai/minutes`
- `POST /meetings/:id/ai/suggestions/:sid/accept` (action values in the body)
  and `…/discard`
- `POST /meetings/:id/ai/summary` and `…/summary/send`

**Refusal codes:**
- **New codes:** `MEETING_AI_NOT_OFFERED`, `MEETING_AI_IN_PROGRESS`,
  `MEETING_AI_NO_SOURCES`, `MEETING_AI_NO_NOTES`,
  `MEETING_AI_NOTHING_TO_DRAFT`, `MEETING_AI_NO_ABSENT`, and
  `MEETING_AI_SUGGESTION_GONE`.
  - `MEETING_AI_SUGGESTION_GONE` is a suggestion already decided by someone
    else, or replaced by Draft again. It is in `RELOAD_CODES`.
- **Each is said from its code, in both languages:**
  - through `meeting-refusal.ts` on the meetings screens;
  - through `core/ai/ai-refusal.ts` for the gateway's own refusals (credits,
    provider, not enabled), with «منشأتك» (build note 3).

**Rate limit:** `perUser()`, 10 a minute, on the three call routes (ACC-197's
tier).

**Tests:**
- **db-specs against the test Postgres for:**
  - each stage gate and M9;
  - each 404 for another organisation;
  - Accept's one-transaction write;
  - Draft again touching only empty or undecided items;
  - Distribute discarding, with a count that matches the confirm;
  - cancel and issue deleting;
  - a claim refusing a second press;
  - a meeting that moved on during a call: nothing saved, charged.
- **Pure specs for:**
  - the name replacement: Arabic normalisation, a shared first name, emails,
    an outside guest;
  - the answer parsers.
- **Mutation-checked:**
  - the M9 check;
  - the outside-guest owner;
  - the past-date rule;
  - the Distribute delete;
  - the writer-only notes read.
- **The live proof runs after the deploy and the seed,** on al-nakheel, with
  credits used staying used (ACC-236).

---

## 5. Order and PRs

**The suggested order holds: minutes draft and action items first.** The code
agrees:
- **Every hook it needs is on dev** (PR 4 and 7b). The only missing one,
  `applyAiDraft()`, is an addition beside the writes it reuses.
- **It is the feature the design spends most on**, and the one with the most
  rules to prove (M2, M3, M5, M6, M7, M8, M9).
- **The agenda suggestions come next.** They need one missing hook (insertion
  before Any other business), and their screen exists (#374).
- **The summary comes last, because it cannot come earlier.** It sits beside
  Print minutes under the approved page's locked line, and both arrive with
  Meetings PRs 7c and 7d.

| PR | What | Waits for |
|---|---|---|
| **1. Minutes, backend** | The migration (§2); the notes; `minutes_drafting` in `ai.config.ts`; the seed line (seeded **after** the deploy); `GET /meetings/:id/ai`; the draft, accept and discard routes; `applyAiDraft()`; the extracted action-item rules; Distribute's discard and `aiUndecided`; the cancel effect's delete; SYSTEM-REFERENCE §17.12 and CLAUDE.md's ACC-322 entry | dev as it is |
| **2. Minutes, screens** | The Rough notes box; Draft minutes and Draft again; the suggestion inside each item; the action-item suggestions and their inline Edit; the undecided count in the header and the Action items card; the Distribute confirm's M2 line; Arabic per build notes; phone 390 for this panel | PR 1 deployed |
| **3. Agenda, backend** | `meeting_agenda_generation`; the sources and exclusions; the agenda add before Any other business; the `AGENDA_ISSUED` effect's delete | PR 1 (the tables) |
| **4. Agenda, screen** | The trigger on the Agenda panel's header, the suggestions in flow, "Add n items", Suggest again, the "Approvals couldn't be checked." partial | PR 3 deployed |
| **5. Summary, backend** | `absent_member_summary`; the draft and send routes; the two Meeting columns (a second additive migration, kept out of PR 1 so it ships with its only reader) | Meetings PR 7c |
| **6. Summary, screen** | Draft summary beside Print minutes, the panel under the locked line, the Send confirm, the sent line | Meetings PR 7d |

**Each PR deploys before the next. Every migration is expand only.** Each AI
key's cost row is seeded after its PR deploys (`npm run
seed:ai-feature-costs`), never before. Each live proof follows its seed.

---

## 6. Questions for Ahmad

1. **Credits per feature.**
   - **Suggest agenda items:** 3 credits, per CLAUDE.md's price list.
   - **Draft minutes:** 8 credits, per CLAUDE.md's price list, with the action
     items included at no extra cost.
   - **The summary for absent members has no price yet.** I suggest 5 credits,
     the same as a briefing run.

   Are 3, 8 and 5 right?
2. **Which organisations is it open to?**
   - Open to every organisation with AI, like task drafting.
   - Or restricted to al-nakheel for demos first, like the briefing.
3. **Can the absent-member summary be sent more than once?** The plan sends it
   once, and then shows "Summary sent 25 Sep to 3 members" in place of the
   trigger. The alternative is to allow sending again, which notifies the same
   members a second time.
4. **What should an action read when its owner in the notes matches nobody?**
   This covers someone not in the organisation, or no longer active. The
   design gives reasons only for an outside guest and for a past date. I
   suggest: "No one in the organisation matches “Omar”. Choose a person." /
   «لا يطابق أحدٌ في المنشأة «عمر». اختر شخصًا.»
5. **Should the notes line say the notes are sent to the AI provider?** The
   drawn line is "Seen only by whoever writes the minutes. Paste or type;
   nothing here is in the minutes until you accept it." Our code removes
   outside guests' names and emails before sending, but staff names the
   Secretary types are sent as written. I suggest adding: "Draft minutes sends
   these notes to AccreditMe's AI provider." / «ترسل «صياغة المحضر» هذه
   الملاحظات إلى مزوّد الذكاء الاصطناعي لدى AccreditMe.»

---

## 7. Decided here (technical, not asked)

**Calls and storage:**
- **Three calls, not four.** Action items come from the minutes call: the
  design draws them drafted with the minutes, and one call reads the notes
  once.
- **Suggestions are stored until decided,** and deleted when decided. The
  record after Accept is the minutes and the audit. No "accepted suggestions"
  table is kept.
- **No migration on `MeetingActionItem`.** An empty owner or due date lives in
  the suggestion (Prompt 164).

**Names:**
- **Names are replaced by labels on our side, both ways.** This is what keeps
  an outside guest out of the model (the ticket's rule). It also makes an
  owner exact.

**Accept:**
- **M5's "replace" covers the item's decisions too.** The line names what is
  replaced. Edit is the way to combine.
- **M8 is decided per item:** an item is drafted again only if it has no
  discussion and no decision, or has an undecided suggestion.

**Detecting state:**
- **M9 reads `reviewRound`.** No column: a returned meeting in Minutes Draft
  has a round of 1 or more.
- **M1 reads the `AGENDA_ISSUED` flag,** never a stage key (ACC-255).
- **The summary's "sent" state is a column on `Meeting`,** never read back from
  the audit trail (ACC-133's rule).

**Charging:**
- **A meeting that moves on during a call is charged and not saved.** The
  provider was paid (design Q2).

---

## 8. New strings (EN / AR), beyond the design's table

The Arabic is neutral about a person, and uses «المنشأة».

- "Accepting replaces the decision you typed." / «القبول يستبدل القرار الذي
  كتبته.»
- "Accepting replaces the discussion and decisions you typed." / «القبول
  يستبدل النقاش والقرارات التي كتبتها.»
- "Summary sent {date} to {n} members" / «أُرسل الملخص {date} إلى {n} أعضاء»,
  with plurals through `amCount`.
- The refusal sentences for the seven codes in §4, written with PR 1 and PR 3.
- Question 4's line and Question 5's line, if Ahmad agrees.
