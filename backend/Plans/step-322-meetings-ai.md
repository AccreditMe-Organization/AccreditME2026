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
- **Revised after lane B's review of #383 (P225).** Section 9 lists what
  changed.
- **Ahmad answered §6's five questions on 20 Nov, all as recommended.** The
  answers are carried through the plan.

The four features in the ticket become **three AI calls**:
- Action items are drafted in the same call as the minutes (design 6.2/6.3), so
  they have no separate price.
- 6.4 (votes, quorum and attendance) and 6.6 (who is looking) are rules, not
  calls.

---

## 0. What the design settles, and where it overrides the ticket

- **Who presses (decided, P225):**
  - **Suggest agenda items follows whoever may write the agenda**
    (`meeting.may.manageAgenda`). The suggestion only adds what that person
    could add by hand.
  - **Draft minutes and Draft summary follow whoever records the minutes.**
  - With the seeded seats, both are the Secretary, which is what 6.6 draws.
  - The ticket's wider wording ("whoever may open the meeting") is replaced.
  - Nobody else sees a trigger, a suggestion, the rough notes or an undecided
    count. That covers the Chair, members, guests and absent members, unless
    one of them also writes the agenda or records the minutes.
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
  - **M8:** Draft again touches only what is empty or undecided.
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

**Open to every organisation with AI** (Ahmad, 20 Nov, §6 answer 2), like task
drafting: each cost row is unrestricted.

**One gateway.** Every call goes through `AiService.run()` (ACC-194):
- credits are reserved first, then the call is made;
- a failed call, or an answer refused by `accept()`, is refunded into the same
  period;
- the log keeps no customer text. Its description is written by our code, ids
  and counts only (for example "Meeting cmv… minutes draft, 5 items").

**The model chooses; our code writes every word around the choice**, as
ACC-198 and ACC-199 do:
- **The answer is JSON**, and it refers to inputs only by the labels we sent
  (`S1`, `A2`, `P3`).
- **Our code drops an unknown label**, a duplicate, or anything over its cap.
- **Our code writes:** every source line, reason line, date, link, recipient
  list and refusal.
- **The model writes only:** the free text the design shows as AI text (an
  agenda item's title and reason, an item's discussion and decisions, an
  action's "what", and the summary).

**Language.** Each call is written in the presser's interface language.
- The request names it (`en` | `ar`), as ACC-193 does, and it is stored on the
  suggestion.
- Names and codes stay as they are (design pattern note "Reader's language";
  Q8 in section 1 of the drawing).

**Names (the ticket's rule, and P224, P225).** One file, `meeting-ai-names.ts`,
runs over **every customer text sent in all three calls**, before sending:
- the rough notes;
- agenda item titles and descriptions;
- task titles;
- existing action item titles;
- the approved minutes' discussions, decisions and actions.

**What it replaces:**
- **Every invitee's full name** (members, organisation guests, outside guests)
  becomes a label: `[P1]`, `[P2]`, ….
- **Each of an invitee's name words of three or more letters** becomes the same
  label when it belongs to exactly one invitee.
- **Every outside guest's name words of three or more letters ALWAYS become the
  guest's label**, even when another person shares the word. Over-replacing is
  the safe direction.
- **The full name of every ACTIVE person in the organisation who is not an
  invitee** becomes a label.
- **Every email address** becomes `[email]`.

**How it matches:**
- whole words only, ignoring case;
- Arabic normalised: alef forms, alef maqsura and ya, ta marbuta and ha,
  tatweel and diacritics;
- honorifics (Dr., Eng., د., م.) kept outside the label.

**Nothing from our records is sent:** no attendee name, owner, presenter,
author, seat holder, email or person id.

**The model answers with labels.** Our code maps each label back to a person,
and writes the names back into the suggestion text. So:
- **An outside guest's name, as recorded on the meeting, never reaches the
  model.**
- An owner is resolved exactly, by label, never by guessing at a name.

**What it cannot catch:** a name the matching doesn't recognise, such as a
misspelling, or someone who is neither an invitee nor a user, is sent as
written. So the notes line says the notes go to the AI provider (Ahmad, 20 Nov,
§6 answer 5).

**Who and when are read live on every press, and again inside the save
transaction** (§4).
- The screens render flags; they never re-derive a rule.
- **No access to the meeting:** the identical 404 a missing meeting gets
  (`MeetingAccess.seeing`).
- **Access, but not the person who writes the agenda or records the minutes:**
  that write's existing refusal (`MEETING_NOT_RECORDER`, or the agenda's
  writing refusal).
- **The wrong stage:** 409 `MEETING_AI_NOT_OFFERED`, with the stage's names.
  The trigger is absent there anyway; this is the backstop.

**Fitting the input cap (P225).** The gateway estimates input as UTF-8 bytes
divided by 3 (`estimateTokens()`), so an Arabic character costs about two
thirds of a token.
- **Each call has fixed caps** (below), and trims its longer texts with
  `cutAtBoundary()` (`foundation/ai/text-cut.ts`) to fit the feature's
  `inputTokenCap`.
- **If it is still over, the call is refused before reserving anything:**
  - 409 `MEETING_AI_TOO_LONG`, with `{ feature }`;
  - said in both languages, one sentence per feature;
  - no charge.
- **Each call gets a worst-case Arabic spec, as `draft-answer.spec.ts` does:**
  every field at its cap, in Arabic, estimated under the cap.

**One run at a time per meeting and feature.**
- A claim row is taken with `INSERT … ON CONFLICT … WHERE` before any call,
  and is stale after 3 minutes (ACC-198's shape).
- A second press is 409 `MEETING_AI_IN_PROGRESS`, before any credit is
  reserved.
- **The claim is released on every exit:** success, refusal, failure, or a
  meeting that moved on. This is the briefing's `release()`, in a `finally`.

**Saving the answer.**
- The answer is saved in a transaction that takes the minutes' lock order: the
  instance FOR SHARE, then the meeting row FOR UPDATE.
- That transaction re-checks the stage and the person.
- If the meeting moved on during the call, nothing is saved, the call is still
  charged (the provider was paid, design Q2), and the refusal is
  `MEETING_CHANGED`.

**Leaving the page: charged AND saved (P225, as ACC-193 Q2).**
- The server does not stop when the screen stops waiting. It finishes the
  call and saves the suggestions.
- The suggestions show when the person returns, and are counted as undecided.

### 1.1 Suggest agenda items (6.1)

**Where and who:**
- On the Agenda panel's header, for whoever may write the agenda
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
   decision.
   - A committee meeting only.
   - Only after the presser's own read of the committee passes
     (`ObjectVisibilityService.assertCanView('COMMITTEE', …, viewerId)`, with
     ACC-281's member clause).
   - If it fails, the source is left out, silently: the presser can't see it.
3. **Excluded before sending:**
   - every task already in "Open actions from the last meeting". It uses the
     same read the agenda's fixed first section uses, `openActions()`, today
     a private method of `MeetingMinutesService`, exported as a module
     function in PR 3;
   - anything already on this meeting's agenda, matched by the new
     `AgendaItem.sourceTaskId` / `sourceChangeRequestId` (§2). Never read back
     from audit rows.
4. **A cap of 30 candidates:** overdue first, then by due date, then the
   newest.

**Sent to the model:**
- **For each task:** label `S1`–`S30`, its title (names replaced, cut to 120
  characters), its status, its due date, whether it is overdue, and its
  origin's type and date.
- **For the change request:** exactly "Change request {n}" (its position in
  this call), "awaiting a decision", and the names of the fields it changes
  (for example "quorum, meeting frequency"). Our code writes those words in
  the presser's language. No values, no requester, no reason text.
- **The current agenda's item titles** (names replaced, each cut to 120
  characters), so it doesn't repeat them.
- The meeting's title (names replaced) and type.

**Never sent:**
- the assignee, creator, owner or requester;
- any name from our records;
- task descriptions or evidence;
- a change request's values.

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
- `meeting_agenda_generation`: 3 credits (CLAUDE.md's price list; Ahmad, 20
  Nov).
- STANDARD tier, effort `low`, `maxTokens` 2,000, `inputTokenCap` 6,000.
- **Worst case:** 30 Arabic titles at 120 characters, plus 20 agenda titles,
  is about 3,300 tokens.

**Refunded (not charged):**
- **Before any call:**
  - no candidate after the exclusions: `MEETING_AI_NO_SOURCES`, "No open
    tasks or approvals to suggest from.";
  - over the cap: `MEETING_AI_TOO_LONG`.
- **Through `accept()`:** an empty, cut-short or unparseable answer, and an
  answer with no usable pick.

**Accepted, edited or discarded:**
- **Ticked, then "Add n items".** This goes through
  `MeetingAgendaService.addItems()`, beside the private `lockAgenda()` it
  takes. The added items are ordinary agenda items with no AI marks:
  - each carries its `sourceTaskId` or `sourceChangeRequestId`;
  - each is audited CREATE with `aiDraft`;
  - **"Before Any other business" is keyed on the agenda's trailing `standing`
    items** (M4). They are placed before the first item of that trailing run,
    in tick order, renumbered in the same transaction.
  - **Outside a series there are no standing items**, so they append.
- **Unticked suggestions are discarded with the add.**
- **"Suggest again"** replaces every undecided agenda suggestion.
- **Discard** removes one suggestion.
- **Editing happens on the added item**, through the ordinary agenda dialog.
  The suggestion itself has no edit, as drawn.

### 1.2 Draft minutes, with the action items (6.2, 6.3, 6.4)

**Where and who:**
- A Rough notes box with "Draft minutes" at the top of Agenda & minutes.
- **Its line adds a sentence** (Ahmad, 20 Nov, §6 answer 5): "Draft minutes
  sends these notes to AccreditMe's AI provider." / «ترسل «صياغة المحضر» هذه
  الملاحظات إلى مزوّد الذكاء الاصطناعي لدى AccreditMe.»
- For whoever records the minutes (`minutes.may.recordMinutes`), while:
  - the minutes are in their `draft` phase;
  - the stage allows `record_minutes` (seeded on Minutes Draft);
  - the meeting has never been returned (`reviewRound === 0`).
- **M9 needs no new column:** Return leaves `reviewRound` at its round, so a
  returned meeting in Minutes Draft always has `reviewRound ≥ 1`.

**The rough notes:**
- One box per writer, **at most 18,000 characters** (P225: about 12,000
  tokens in Arabic).
- Saved as they are typed (debounced) by `PUT /meetings/:id/ai/notes`.
  - **That route has the Draft minutes gate** (the same person, stage and M9
    check), so notes can't be written where no draft can be made.
- Read only by their writer.

**What is drafted, per item and per kind (M8, P225):**
- **The first press** drafts every item, in agenda order.
- **Afterwards, each item has two parts that are decided on their own:**
  - **its minutes** (discussion and decisions) are drafted again only if the
    item has no discussion and no decision, or still has an undecided minutes
    suggestion;
  - **its actions** are drafted again only if the item has undecided
    action-item suggestions, or its minutes part is being drafted.
  - An item whose minutes were accepted but whose actions are undecided is
    sent, and gets **only actions back**: its minutes part is ignored.
  - An item with nothing undecided and its minutes settled is not sent.
- **At most 6 items per call.** The rest wait for Draft again, which continues
  in agenda order (M8 makes that natural).

**Sent to the model:**
- **The writer's notes,** with names replaced (§1.0), between markers, as data
  and never as instructions (ACC-197's rule).
- **The items to draft,** as `A1`–`A6`, each with:
  - its title (cut to 120 characters);
  - its description (cut to 300 characters);
  - which parts are wanted: minutes, actions, or both.
- **The titles of each item's action items already recorded** (each cut to
  140 characters), so they are not suggested twice.
- **The meeting's date and today's date,** both in the organisation's zone, so
  the model can resolve "by next month" or "15 Sep".

**Never sent:**
- attendance;
- seats;
- the quorum;
- any name from our records;
- an outside guest's name, as recorded.

**Answer:**

```json
{ "items": [{ "item": "A2",
    "discussion": "…" | null,
    "decisions": [{ "text": "…", "votes": { "for": 5, "against": 1, "abstain": 0 } | null }],
    "actions": [{ "what": "…", "owner": "P3" | null, "due": "2026-11-30" | null, "time": "14:00" | null }] }] }
```

Caps:
- the discussion is at most 1,200 characters;
- at most 3 decisions, each at most 300 characters;
- at most 4 actions per item, each "what" at most 140 characters.

**The output budget (P225), stated:**
- **The worst case:** 6 items × (1,200 + 3 × 300 + 4 × 140 = 2,660 Arabic
  characters ≈ 1,780 tokens, plus about 120 tokens of JSON) is about 11,400
  tokens.
- **`maxTokens` is 16,000,** which leaves about 4,600 for thinking at effort
  `medium` (thinking counts against `max_tokens`).
- **An answer cut short** is refused by `accept()` and refunded.
- **PR 1 measures thinking on the worst-case fixture.** If it doesn't fit, the
  effort drops to `low` before items per call drop.

**Our code, on the answer:**
- **Votes (6.4, M6):**
  - **Copied only when all three counts are present.** Otherwise the vote is
    empty, with "Vote: not in your notes · left empty".
  - **Never changed.** A total above the members present is kept.
  - **The suggestion shows the minutes' own flag before Accept** ("These add
    up to 7, more than the 6 members present.").
  - "Taken without quorum" stays the attendance's, outside the suggestion.
- **An owner label is mapped to its person.**
  - **An outside guest** (`OUTSIDE_GUEST`) gives an empty owner with build
    note 1's reason: «لا يُقترح ضيف من الخارج مسؤولًا (د. لينا منصور). اختر
    شخصًا في المنشأة.» (M7).
  - **A user who is not ACTIVE, an unknown label, or no owner** gives an empty
    owner with Ahmad's reason (20 Nov, §6 answer 4): "No one in the
    organisation matches “Omar”. Choose a person." /
    «لا يطابق أحدٌ في المنشأة «عمر». اختر شخصًا.»
    With no name in the notes at all, the owner is simply empty, with no
    reason line.
  - **An organisation guest** who is staff may own an action, as drawn.
- **Due dates (P225):**
  - The model's day, and its time when the notes state one, become an instant
    **in the organisation's zone**, as the action-item dialog's
    `meetingStart()` makes one.
  - With no time stated, the time is the end of that day's working hours from
    `WorkingCalendarService`. The inline Edit row shows it, and it can be
    changed there.
  - A day in the past, or not a day, gives an empty due date with "The date in
    your notes, 15 Sep, has passed. Choose a due date." The date is checked by
    `futureDue()`'s rule.
- **An item answered as "nothing"** gives "Nothing in your notes for this
  item."
- **An answer where EVERY item is "nothing"** is refused by `accept()` and
  refunded. It is said as `MEETING_AI_NOTHING_SUGGESTED`: "AI couldn't
  suggest anything from these notes. Add more detail and try again." This is
  `DRAFT_NOTHING_TO_SUGGEST`'s shape, and the design's Empty outcome.

**Key, credits and effort:**
- `minutes_drafting`: 8 credits, action items included (CLAUDE.md's price
  list; Ahmad, 20 Nov).
- **The action items are part of this call and cost nothing extra.**
- STANDARD tier, effort `medium`, `maxTokens` 16,000, `inputTokenCap` 20,000.
- **Worst-case input:** 18,000 Arabic characters of notes (about 12,000
  tokens), plus 6 items and their actions (about 1,700), plus the system text,
  is under 20,000. Longer agenda texts are cut first.

**Refunded (not charged):**
- **Before any call:**
  - no notes: `MEETING_AI_NO_NOTES`, "Add notes first.";
  - nothing left to draft under M8: `MEETING_AI_NOTHING_TO_DRAFT`. The trigger
    is absent then; this is the backstop;
  - over the cap: `MEETING_AI_TOO_LONG`.
- **Through `accept()`:** an empty, cut-short or unparseable answer, an answer
  with no usable item, and an all-"nothing" answer. A draft cut short is never
  shown half (design "Partial").

**Accepted, edited or discarded, one suggestion at a time:**
- **The minutes suggestion for an item:**
  - **Accept replaces the item's discussion and its decisions (M5),** in ONE
    transaction, through `MeetingMinutesService.applyAiDraft()` (§3).
    - **The line says what it replaces:** "Accepting replaces the discussion
      you typed." (drawn), and two new lines for decisions alone and for both
      (§8).
    - **Votes: `applyAiDraft()` keeps `checkVotes()`'s all-three-or-none rule
      and SKIPS its total-versus-present refusal.** That is M6's one exception
      to the ordinary decision write, which refuses 409
      `MEETING_VOTES_EXCEED_PRESENT`, even while attendance is unrecorded.
    - **Distribute's readiness check then holds the minutes** with
      `MEETING_VOTES_EXCEED_PRESENT` until the Secretary corrects the count,
      as drawn.
  - **Edit does the same** and moves focus into the discussion field. Later
    changes are ordinary minutes writes.
  - **Discard** removes the suggestion.
- **An action-item suggestion:**
  - **Accept** is offered only when the owner and the due date are both set.
  - **Edit** opens round 3's inline row, prefilled, to choose what is missing.
    Saving it accepts the suggestion with those values.
  - **What Accept checks:** the same rules as `addActionItem()`: a title, an
    owner who is a person in the organisation, and a due date in the future.
    These are extracted into one function both call.
  - **Accept adds an ordinary draft action item** reading "Becomes a task when
    the minutes are approved". Approve Minutes makes the task, through
    `MINUTES_FINAL`'s existing effect.
  - **Discard** removes the suggestion.
- **Draft again** replaces only the undecided suggestions of the parts it
  drafts. It never touches accepted text.
- **The undecided count:**
  - It is shown in the minutes header and the Action items card (design).
  - It counts every undecided minutes suggestion and action-item suggestion.
  - **The minutes read answers it as `distribute.aiUndecided`.**
- **At Distribute Minutes (M2):**
  - The confirm says "3 AI suggestions undecided will be discarded".
  - **Distribute's `inTx` deletes them, and the notes.** It counts the rows it
    deletes in the same transaction as the delete, under the meeting row's
    lock, and records that count on its audit row.
  - **No suggestion can be saved after that:** a run's save re-checks the
    stage inside the same lock.
  - **The count never holds Distribute.**
  - **PR 2 re-measures the confirm's 420 layout** with the line (the design's
    M2 note: +21 EN, +24 AR).

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
- **Every text has names replaced** (§1.0).
- **Discussions are cut with `cutAtBoundary()`, longest first,** until the
  input fits.

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
- New key `absent_member_summary`: 5 credits (Ahmad, 20 Nov).
- STANDARD tier, effort `low`, `maxTokens` 3,000, `inputTokenCap` 15,000.

**Refunded (not charged):**
- **Before any call:**
  - nobody recorded absent: `MEETING_AI_NO_ABSENT`;
  - still over the cap after cutting: `MEETING_AI_TOO_LONG`.
- **Through `accept()`:** an empty, cut-short or unparseable answer.

**Accepted, edited or discarded:**
- **The text is editable in the panel.** Edit moves focus into it.
- **Send (confirm 420, measured 90 / 103 in the design):**
  - It sends the text as shown, at most 2,000 characters.
  - The recipients are recomputed on the server from attendance: MEMBERS
    recorded Apologies or Absent who are ACTIVE users. Never guests.
  - **The notice (P225):**
    - in-app and by email, with a link to the approved minutes and no reply
      path (design Q9);
    - **the title names the Secretary**, in both languages;
    - **both bodies (`bodyEn` and `bodyAr`) carry the summary as written**, in
      the Secretary's language. The body stays under 2,000 characters.
- **Recorded on the meeting:**
  - `absentSummarySentAt` and `absentSummarySentById`;
  - one audit row naming the recipients' ids and `aiDraft`.
- **It is sent once** (Ahmad, 20 Nov, §6 answer 3). After it is sent, the
  trigger is replaced by "Summary sent 25 Sep to 3 members", and there is no
  Send again. A draft or send after it is refused with 409
  `MEETING_AI_SUMMARY_SENT`, checked before any credit is reserved and again
  under the meeting's row lock (`absentSummarySentAt` already set). It is in
  `RELOAD_CODES`.
- **Discard** removes the suggestion.
- **Draft again** replaces it.

---

## 2. What is stored, and when it is deleted

**Two migrations, both additive:**
- **PR 1's `acc322_meetings_ai`:**
  - two new enums;
  - three new tables;
  - two nullable columns on `AgendaItem`: `sourceTaskId` and
    `sourceChangeRequestId`, with an index on `(meetingId, sourceTaskId)`.
- **PR 5's `acc322_absent_summary_sent`:** two nullable columns on `Meeting`,
  `absentSummarySentAt` and `absentSummarySentById`. It ships with its only
  reader.

No existing enum gains a value, so ACC-173's rule is met by construction: no
row exists before the code that reads it. **The agenda columns are written only
by `addItems()`**, and read only by the agenda's exclusion.

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

// PR 1, on AgendaItem, both nullable:
//   sourceTaskId          String?
//   sourceChangeRequestId String?
// PR 5, on Meeting, both nullable:
//   absentSummarySentAt   DateTime?
//   absentSummarySentById String?
```

Every table carries `organizationId`, and every read scopes by it with the
row's id. Each relation to `Meeting` is `onDelete: Cascade`.

**Why the suggestions are stored, not only shown:**
- The undecided count must survive a reload, and reach Distribute's confirm.
- A run the person left still saves (§1.0).
- Accept reads the suggestion from the server. So the accepted text is the
  text the model wrote, and `aiDraft` is proved by construction: the row was
  written by our code from a charged call.
- This is stronger than ACC-197's claim check, which is not needed here.

**`aiDraft` (nit, P225):**
- It records `{ kind, interactionId }`.
- `AiService` returns `interactionId: null` when its log row could not be
  written. Then `aiDraft` records `interactionId: null`, and still records
  that the text came from an AI suggestion, because the suggestion row is the
  proof.
- The history reads "drafted with AI, accepted by …" either way.

**When each thing is deleted:**

| What | Deleted |
|---|---|
| Rough notes | At Distribute Minutes (inside `MeetingReviewService.distribute()`'s `inTx`, M3); on entering a `MEETING_CANCELLED` stage (the existing `cancelled` effect gains this part); with the meeting |
| `ITEM_MINUTES` and `ACTION_ITEM` suggestions | On Accept or Discard; replaced by Draft again; at Distribute (counted in its confirm, M2); at cancel; with their agenda item |
| `AGENDA_ITEM` suggestions | On "Add n items" (ticked and unticked), on Discard; replaced by Suggest again; on entering the `AGENDA_ISSUED` stage (the existing `agendaIssued` effect gains this part); at cancel |
| `ABSENT_SUMMARY` suggestion | On Send or Discard; replaced by Draft again |
| `MeetingAiRun` | Never; one small row per meeting and feature. A claim is released on every exit, and is stale after 3 minutes |

**The record after Accept is the Meetings record.** The history keeps
"drafted with AI, accepted by …" (M3, design Q10) through `minutesAudit()`'s
`after.minutes.aiDraft`. The agenda's CREATE audit carries the same field.
**No text is in the audit or the AI log.**

---

## 3. The hooks from Meetings PRs 4–8

Read on dev `5ae3667`, against step-316 §6a. **Refreshed on dev `d09f226` for
PR 1 (P248):** Meetings PRs 7c, 7d and 8-be and #380 have merged since, and
PR 1 built its rows. The "On dev?" column says which.

| Hook | On dev? | Where | What ACC-322 does with it |
|---|---|---|---|
| An item's discussion is replaced whole, never appended | **Yes** | `MeetingMinutesService.setItemMinutes()` (PR 4) | Accept replaces it (M5) |
| Decisions are rows, written one at a time | **Yes** | `addDecision` / `updateDecision` / `removeDecision` (PR 4) | Accept replaces the item's rows in the same transaction |
| A way to make several minutes writes in ONE transaction, with the lock order, the stage rule, the review-change record and one audit row | **Built in PR 1**: `applyAiDraft()` (was missing: `write()` is private) | `meeting-minutes.service.ts` | PR 1 adds `MeetingMinutesService.applyAiDraft()`, beside the writes it reuses, so the minutes keep one owner |
| `checkVotes()`'s total-versus-present refusal | **Yes**, and it refuses while attendance is unrecorded | `meeting-minutes.service.ts` (PR 4) | `applyAiDraft()` keeps the all-three-or-none check and skips this one (M6). Distribute's readiness check holds the minutes instead |
| The action-item rules (a title, an owner who is a person, a future date) | **Extracted in PR 1**: `actionItemFields()`, `assertActionOwner()` | PR 4 | Extracted to one function that `addActionItem()` and the AI accept both call |
| `minutesAudit()` takes free `after` metadata | **Yes** | PR 4 | `aiDraft` is added there |
| The minutes read's `distribute` block | **Yes**; `aiUndecided` added in PR 1 | PR 4, 7b | Gains `aiUndecided: number` |
| Distribute's `inTx` | **Yes**; the delete and `aiDiscarded` added in PR 1 | `MeetingReviewService.distribute()` (PR 4) | Deletes the notes and the undecided minutes suggestions, counting what it deletes |
| The Distribute confirm | **Yes**, but with no extra line | `meeting-distribute-dialog` (PR 7b) | It already takes `minutes`, so it reads `distribute.aiUndecided` and adds the M2 line itself; no new input. Its 420 layout is re-measured |
| The entry effects for `AGENDA_ISSUED` and `MEETING_CANCELLED` | **Yes**; the cancel delete added in PR 1, the agenda's in PR 3 | `meeting-effects.ts` | Each gains a delete |
| Approve makes the tasks from the action items | **Yes** | `MINUTES_FINAL` effect | Unchanged: accepted AI drafts are ordinary action items |
| "Open actions from the last meeting" | **Yes**, but private | `MeetingMinutesService.openActions()` (PR 7b) | PR 3 exports it as a module function, so the minutes read and the agenda's exclusion read one rule |
| The agenda's lock | **Yes**, but private | `MeetingAgendaService.lockAgenda()` | PR 3 adds `addItems()` to the same service, so it takes the lock where it lives |
| An add that goes before Any other business | **Missing**: `create()` appends at `max(order) + 1` | `meeting-agenda.service.ts` | PR 3's `addItems()` places items before the trailing `standing` run, renumbering in the same transaction |
| Which task or change request an agenda item came from | **Missing**: `AgendaItem` has no source column | `schema.prisma` | PR 1 adds `sourceTaskId` and `sourceChangeRequestId`; PR 3 writes them |
| `MEETING_CHANGED` offers Reload | **Yes**: #380 merged (`RELOAD_CODES`) | `frontend/…/meetings/meeting-refusal.ts` | PR 2's wait is met |
| The meeting history screen that reads `aiDraft` | **Still missing** after 7c and 7d | — | The audit is written from PR 1; the "drafted with AI, accepted by …" line shows when the history screen exists |
| The approved page: the locked line, Print minutes | **Yes**: 7c and 7d merged | — | PR 6's wait on 7d is met |
| The phone pass | **Yes**: 7d-2 merged | — | Each ACC-322 screen PR lays its own panel out at 390, as the design draws |
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
  - `available` per feature;
  - any run in progress.
- **Availability for all three features is read in one batch.**
  `aiFeatureAvailability()` (`foundation/ai/ai-availability.ts`) gains a
  batched form for several keys: one organisation read and one
  `openAiFeatures`. The single-key form calls it.
- **Everyone who sees the meeting gets an answer.** A viewer who neither
  writes the agenda nor records the minutes gets every flag false and no
  content: no error, like `mayRead: false` (P206).
- **The number of queries is fixed, whatever the meeting's size.** Nothing is
  added to the per-request path (ACC-271's performance rule).

**Writes:**
- `PUT /meetings/:id/ai/notes`, with the Draft minutes gate
- `POST /meetings/:id/ai/agenda`, `…/agenda/add`
- `POST /meetings/:id/ai/minutes`
- `POST /meetings/:id/ai/suggestions/:sid/accept` (action values in the body)
  and `…/discard`
- `POST /meetings/:id/ai/summary` and `…/summary/send`

**Refusal codes:**
- **New codes:**
  - `MEETING_AI_NOT_OFFERED`
  - `MEETING_AI_IN_PROGRESS`
  - `MEETING_AI_NO_SOURCES`
  - `MEETING_AI_NO_NOTES`
  - `MEETING_AI_NOTHING_TO_DRAFT`
  - `MEETING_AI_NOTHING_SUGGESTED`
  - `MEETING_AI_NO_ABSENT`
  - `MEETING_AI_TOO_LONG`
  - `MEETING_AI_SUGGESTION_GONE`: a suggestion already decided by someone
    else, or replaced by Draft again. It is in `RELOAD_CODES`.
  - `MEETING_AI_SUMMARY_SENT`: the absent-member summary was already sent
    (§6 answer 3). It is in `RELOAD_CODES`.
- **`MEETING_CHANGED`'s Reload comes from #380** (§3).
- **Each is said from its code, in both languages:**
  - through `meeting-refusal.ts` on the meetings screens;
  - through `core/ai/ai-refusal.ts` for the gateway's own refusals (credits,
    provider, not enabled), with «منشأتك» (build note 3).

**Rate limit:** `perUser()`, 10 a minute, on the three call routes (ACC-197's
tier).

**Tests:**
- **db-specs against the test Postgres for:**
  - each stage gate and M9, including `PUT /ai/notes`;
  - each 404 for another organisation;
  - Accept's one-transaction write;
  - **votes above the members present:**
    - Accept stores them through `applyAiDraft()`, even with attendance
      unrecorded;
    - the ordinary decision write still refuses them;
    - Distribute then refuses `MEETING_VOTES_EXCEED_PRESENT`;
  - Draft again by part: an item with accepted minutes gets only actions;
  - Distribute discarding, with the deleted count on its audit row;
  - cancel and issue deleting;
  - a claim refusing a second press, and released after a failure;
  - a meeting that moved on during a call: nothing saved, charged;
  - a run the person left: saved, and counted;
  - the agenda's exclusion by `sourceTaskId`;
  - the change request left out for a presser who can't read the committee.
- **Pure specs for:**
  - the name replacement: Arabic normalisation, a shared first name, an
    outside guest's shared word always replaced, emails;
  - the answer parsers;
  - the due-date instant in the organisation's zone;
  - **the worst-case Arabic input for each call** under its cap, and the
    minutes' worst-case answer under its `maxTokens` estimate.
- **Mutation-checked:**
  - the M9 check;
  - the M6 skip, restored so it refuses;
  - the outside-guest owner;
  - the past-date rule;
  - the Distribute delete;
  - the writer-only notes read;
  - the batched availability.
- **The live proof runs after the deploy and the seed,** on al-nakheel, with
  credits used staying used (ACC-236).

---

## 5. Order and PRs

**The suggested order holds: minutes draft and action items first.** The code
agrees:
- **Almost every hook it needs is on dev** (PR 4 and 7b). The missing ones,
  `applyAiDraft()` and the extracted action-item rules, are additions beside
  the writes they reuse.
- **It is the feature the design spends most on**, and the one with the most
  rules to prove (M2, M3, M5, M6, M7, M8, M9).
- **The agenda suggestions come next.** They need the new source columns
  (PR 1's migration) and `addItems()`, and their screen exists (#374).
- **The summary comes last.** Its backend needs nothing unmerged:
  `MINUTES_FINAL` and attendance are on dev. Its screen sits beside Print
  minutes under the approved page's locked line, and those arrive with
  Meetings PRs 7c and 7d.

| PR | What | Waits for |
|---|---|---|
| **1. Minutes, backend** | The migration (§2, including the `AgendaItem` source columns); the notes; `minutes_drafting` in `ai.config.ts`; the seed line (seeded **after** the deploy); `GET /meetings/:id/ai` with batched availability; the draft, accept and discard routes; `applyAiDraft()` with the M6 skip; the extracted action-item rules; Distribute's discard and `aiUndecided`; the cancel effect's delete; SYSTEM-REFERENCE §17.12 and CLAUDE.md's ACC-322 entry | dev as it is |
| **2. Minutes, screens** | The Rough notes box; Draft minutes and Draft again; the suggestion inside each item, with the votes flag; the action-item suggestions and their inline Edit; the undecided count in the header and the Action items card; the Distribute confirm's M2 line, re-measured at 420; Arabic per build notes; phone 390 for this panel | PR 1 deployed (#380 has merged) |
| **3. Agenda, backend** | `meeting_agenda_generation`; the sources and exclusions; `openActions()` exported; `addItems()` with the source columns and the trailing-`standing` placement; the `AGENDA_ISSUED` effect's delete | PR 1 (the tables and columns) |
| **4. Agenda, screen** | The trigger on the Agenda panel's header, the suggestions in flow, "Add n items", Suggest again, the "Approvals couldn't be checked." partial | PR 3 deployed |
| **5. Summary, backend only** | `absent_member_summary`; the draft and send routes; the notice; the two `Meeting` columns in their own additive migration | PR 1 (the tables); not Meetings 7c |
| **6. Summary, screen** | Draft summary beside Print minutes, the panel under the locked line, the Send confirm, the sent line | PR 5 deployed (Meetings PR 7d has merged) |

**Each PR deploys before the next. Every migration is expand only.** Each AI
key's cost row is seeded after its PR deploys (`npm run
seed:ai-feature-costs`), never before, unrestricted (§6 answer 2). Each live
proof follows its seed.

---

## 6. Answered by Ahmad, 20 Nov

All five as recommended.

1. **Credits.**
   - Suggest agenda items (`meeting_agenda_generation`): **3**.
   - Draft minutes (`minutes_drafting`), action items included: **8**.
   - The summary for absent members, new key `absent_member_summary`: **5**.
2. **Open to every organisation with AI**, like task drafting. Not restricted:
   each cost row has `restricted: false`.
3. **The absent-member summary is sent once,** then "Summary sent {date} to {n}
   members" replaces the trigger. There is no Send again.
4. **An owner nobody matches** (not in the organisation, or no longer active):
   "No one in the organisation matches “Omar”. Choose a person." /
   «لا يطابق أحدٌ في المنشأة «عمر». اختر شخصًا.»
5. **The notes line adds:** "Draft minutes sends these notes to AccreditMe's AI
   provider." / «ترسل «صياغة المحضر» هذه الملاحظات إلى مزوّد
   الذكاء الاصطناعي لدى AccreditMe.»

---

## 7. Decided here (technical, not asked)

**Calls and storage:**
- **Three calls, not four.** Action items come from the minutes call: the
  design draws them drafted with the minutes, and one call reads the notes
  once.
- **Suggestions are stored until decided,** and deleted when decided. The
  record after Accept is the minutes and the audit. No "accepted suggestions"
  table is kept.
- **A run the person left is saved and charged** (ACC-193 Q2). A run whose
  meeting moved on is charged and not saved (design Q2).
- **No migration on `MeetingActionItem`.** An empty owner or due date lives in
  the suggestion (Prompt 164).
- **An agenda item's source is a column, written at add.** It is never
  reconstructed from audit rows (ACC-133's rule).

**Names and caps:**
- **Names are replaced by labels on our side, in every text, both ways.** This
  keeps an outside guest out of the model (the ticket's rule), and makes an
  owner exact.
- **Inputs are cut to fit, then refused if they still don't,** before any
  credit is reserved.

**Accept and Draft again:**
- **M5's "replace" covers the item's decisions too.** The line names what is
  replaced. Edit is the way to combine.
- **M6 is the one place the minutes accept votes above the members present.**
  Distribute holds them.
- **M8 is decided per item and per part (minutes, actions),** at most 6 items
  a call.

**Detecting state:**
- **M9 reads `reviewRound`.** No column: a returned meeting in Minutes Draft
  has a round of 1 or more.
- **M1 reads the `AGENDA_ISSUED` flag,** never a stage key (ACC-255).
- **The summary's "sent" state is a column on `Meeting`,** never read back from
  the audit trail (ACC-133's rule).

---

## 8. New strings (EN / AR), beyond the design's table

The Arabic is neutral about a person, and uses «المنشأة».

- "Accepting replaces the decision you typed." / «القبول يستبدل القرار الذي
  كتبته.»
- "Accepting replaces the discussion and decisions you typed." / «القبول
  يستبدل النقاش والقرارات التي كتبتها.»
- "AI couldn't suggest anything from these notes. Add more detail and try
  again." / «تعذّر على الذكاء الاصطناعي اقتراح شيء من هذه الملاحظات. أضف
  تفاصيل أكثر وحاول مجددًا.»
- "Summary sent {date} to {n} members" / «أُرسل الملخص {date} إلى {n} أعضاء»,
  with plurals through `amCount`.
- The summary notice's title, naming the Secretary: "Summary of {meeting},
  {date}, from {name}" / «ملخص {meeting}، {date}، من {name}».
- The refusal sentences for the new codes in §4, written with the PR that
  adds each. `MEETING_AI_TOO_LONG` has one sentence per feature.
- The owner nobody matches (§6 answer 4): "No one in the organisation
  matches “Omar”. Choose a person." /
  «لا يطابق أحدٌ في المنشأة «عمر». اختر شخصًا.»
- The notes line's added sentence (§6 answer 5): "Draft minutes sends these
  notes to AccreditMe's AI provider." / «ترسل «صياغة المحضر» هذه الملاحظات
  إلى مزوّد الذكاء الاصطناعي لدى AccreditMe.»

---

## 9. Changes after lane B's review (P225, 20 Nov)

**Errors:**
- **M6 against `checkVotes()`:** `applyAiDraft()` skips the
  total-versus-present refusal. Distribute holds the minutes instead. A
  db-spec covers it.
- **Agenda exclusion:** the new `AgendaItem.sourceTaskId` and
  `sourceChangeRequestId` columns, in PR 1's migration, written by
  `addItems()`.
- **The agenda trigger** follows `may.manageAgenda` (§0).
- **§2 and §5 agree on the migrations:** PR 1 adds the enums, the tables and
  the agenda columns; PR 5 adds the two `Meeting` columns.
- **Input caps:**
  - the notes are at most 18,000 characters;
  - texts are cut with `cutAtBoundary()`;
  - `MEETING_AI_TOO_LONG` refuses before any charge;
  - each call has a worst-case Arabic spec.

**Warnings:**
- **The minutes output budget:** 6 items a call; `maxTokens` 16,000 against a
  worst case of about 11,400.
- **Draft again per part:** accepted minutes with undecided actions get only
  actions back.
- **Names:** replaced in every customer text of all three calls; an outside
  guest's words are always replaced; "as recorded"; the notes question (§6,
  answer 5) agrees with §1.0.
- **The change request:** gated on the presser's own read of the committee,
  and sent as "Change request {n}" with its field names.
- **`GET /ai`:** batched availability; the number of queries is fixed.
- **Due dates:** an instant in the organisation's zone; the meeting's date is
  sent with today's.
- **Leaving the page:** charged and saved.
- **`MEETING_CHANGED`:** PR 2 relies on #380.

**Nits:**
- `openActions()` is exported, and `addItems()` sits beside `lockAgenda()`.
- `aiDraft` with a null `interactionId`.
- The summary notice's title and bodies.
- The all-"nothing" answer is refunded.
- The notes route has the Draft minutes gate.
- The claim is released on every exit.
- The Distribute count is read in the delete's own transaction, and its
  confirm is re-measured.
- "Before Any other business" is keyed on trailing `standing` items.
- PR 5 is backend only, and doesn't wait for 7c.

---

## 10. PR 1 as built (P248, 20 Nov)

**Unchanged from the plan:** the slice, the gate, the order of a press, the
caps, the lock order and the deletes. What the build settled, or added:

- **Owner and date reasons are stored as codes with names**, and the screen
  writes each sentence (PR 2):
  - `{ code: 'OUTSIDE_GUEST', name }`;
  - `{ code: 'NO_MATCH', name }`;
  - `{ code: 'DATE_PASSED', day }`.

  A name the notes give without a label comes back as `ownerName`, the field
  the prompt names for it.
- **At most the 5 newest recorded actions per item are sent**, each cut to
  140 characters. The plan sent all of them. This bounds the worst-case input:
  about 17,300 tokens against the 20,000 cap, pinned by
  `minutes-draft-answer.spec.ts`.
- **The largest answer is about 11,300 tokens** against `maxTokens` 16,000,
  leaving at least 4,000 to think. It is pinned by the same spec. The
  thinking actually used is measured in the live proof after the seed: it
  needs the platform key, which only Railway holds.
- **Accepting a "nothing" suggestion is `MEETING_AI_NOT_OFFERED`.** It can
  only be discarded.
- **`GET /meetings/:id/ai` returns:**
  - `minutes: { may, available, creditCost, running }`, and PR 3 and PR 5 add
    `agenda` and `summary` beside it;
  - each minutes suggestion's `replaces: { discussion, decisions }`, for the
    line M5 needs;
  - each decision's `abovePresent`, for the M6 flag.
- **The `AgendaItem` source columns carry foreign keys** (`SET NULL`).
- **The call may take 300 s** (P249, lane B's review). That is
  `AiFeatureCallConfig.timeoutMs`, passed by the gateway to the provider; any
  feature that sets none keeps 120 s. The claim goes stale 60 s after the
  timeout. The live proof records the call's real duration next to the
  thinking it used.
- **Each press reads every ACTIVE person** for the name table. That read is
  capped by the seat limit.
- **The rate limit is `RATE_LIMITS.meetingAi`,** 10 a minute per user. PR 3
  and PR 5 reuse it.
- **The AI credits page names the feature** "Minutes drafts" /
  «صياغة المحاضر». An unknown key would read "Another AI feature".
- **Mutation-checked:**
  - the M9 check;
  - the M6 skip;
  - the outside-guest owner;
  - the Distribute delete;
  - the cancel delete;
  - the writer-only notes read;
  - the past-date rule;
  - the batched availability.

---

## 11. PR 2 as built (P261, 21 Nov)

**The screens, as §5's table says:**
- **Rough notes and Draft minutes** sit at the top of Agenda & minutes.
- **Each item's suggestions** sit under its minutes. The votes are flagged
  (M6), and a line names what Accept replaces (M5).
- **The action-item suggestions** have Accept, an inline Edit and Discard.
- **The undecided count** is in the panel header and the Action items card.
- **The Distribute confirm** has the M2 line.

What the build settled, or added:

- **One additive field on the AI read:** `leftToDraft`, the items a press
  would still draft.
  - It uses the same M8 rule the press uses, `draftPartsOf()`, extracted from
    `itemsToDraft()`.
  - It is computed from rows the read already loads, so it adds no query.
  - The trigger is absent at 0, as §1.2 says. The press's
    `MEETING_AI_NOTHING_TO_DRAFT` stays as the backstop.
  - The working line names the number: "Drafting minutes for 5 agenda items
    from your notes…", at most 6.
- **The Action items card did not exist.** The Meetings plan left it to PR
  7c, which didn't build it. PR 2 builds it as 6.2 draws it, while the minutes
  are a draft:
  - every draft action item, "From item n";
  - for whoever records the minutes, "3 AI suggestions undecided · items 2,
    4" and "Not action items until accepted."
- **One state for the page: `MeetingMinutesAi`.** The meeting page provides
  it, beside `MinutesWriteOrder`.
  - It holds the AI read, and the newest read wins.
  - An accept is a minutes write in the page's order (P206).
  - A draft or a discard makes the page read the minutes again, so the
    Distribute confirm's count is current (M2).
  - The AI read is made only while the minutes are a draft the viewer
    records. Anyone else makes no request.
- **The notes are saved 800 ms after typing stops.**
  - The stored value is never written back into the box.
  - A press saves any unsaved text first, because the server drafts from the
    saved notes.
  - Notes that can't be saved stop the press, and the notes line says so.
- **The press waits 330 s** (`DRAFT_MINUTES_WAIT_MS`), longer than the
  server's 300 s call.
  - A client timeout or a lost connection reads `GET …/ai`. A run still
    going shows "Minutes are being drafted…" with Check again. A run that
    finished shows its suggestions.
  - Retry is offered only when the run ended with nothing saved: the call
    failed and was refunded, so nothing is in flight.
  - `MEETING_AI_IN_PROGRESS` is shown the same way.
  - **Cancel** stops waiting and says the draft still finishes and is
    charged (ACC-193 Q2). The screen never polls.
- **`am-ai-assist` gained three opt-in inputs, off by default:**
  - `quiet`: a saved suggestion drawn on load takes no focus and is not
    announced. The notes box announces a fresh draft and moves focus to its
    first suggestion.
  - `acceptLabel`: "Accept into minutes".
  - `busy`: while one of Accept, Edit and Discard is in flight, a press on
    any of them emits nothing, in the component itself. The three stay
    enabled, so focus and their names are kept (lane A's review, P263); the
    one pressed is marked `aria-busy`.
- **Edit on a minutes suggestion accepts it, then moves focus into that
  item's discussion box.**
- **Edit on an action suggestion opens the three fields inline:** what,
  owner and due, prefilled. Saving accepts with those values.
  - The owners are Raise action item's: invitees who are people. That rule
    is now one function, `actionOwnerOptions()`.
  - The suggested owner is offered too when they are a person of the
    organisation who wasn't invited.
- **Refusals, each from its code:**
  - the gateway's through `core/ai/ai-refusal.ts`;
  - the seven Draft minutes codes through `meeting-refusal.ts`.
    `MEETING_AI_TOO_LONG` is said for its `feature`.
  - `MEETING_AI_SUGGESTION_GONE` and `MEETING_AI_NOT_OFFERED` offer Reload.
    Draft minutes is absent where it isn't offered, so that refusal means the
    page is stale.
- **Strings:** §8's and the design's, in both languages. Arabic about a
  person is neutral (build note 1), and the organisation is «المنشأة».
  Counted strings are plural objects with all six Arabic forms.
- **Measured (`meeting-page.ai.layout.spec.ts`,
  `meeting-distribute-dialog.layout.spec.ts`):**

  | | EN 1280 | AR 1280 | EN 390 | AR 390 |
  |---|---|---|---|---|
  | Rough notes block | 247 | 274 | 281 | 308 |
  | Item 2's minutes suggestion | 281 | 284 | 390 | 386 |
  | Three action suggestions | 583 | 619 | 705 | 718 |
  | The inline Edit row | 306 | 321 | 332 | 344 |
  | Action items card | 229 | 227 | 229 | 247 |
  | Distribute confirm body, with the M2 line (cap 420) | 177 (243 to spare) | 190 (230) | 177 (243) | 190 (230) |
  | Distribute confirm body, refused | 207 (213) | 222 (198) | 207 (213) | 222 (198) |

  - Each part stays inside its column, with nothing wider than its own box,
    in both languages at both widths. The Edit row is measured open on the
    outside-guest suggestion.
  - On the phone every button in the notes and the suggestions is at least
    44px tall. The page's phone rule now reaches the AI pattern's own
    buttons (`.am-ai button`), which are not PrimeNG buttons.
  - No dialog was added. The Distribute confirm is the only dialog this PR
    changes, and it keeps 198px or more of its 420.
- **Mutation-checked:**
  - the notes written back;
  - a 120 s wait;
  - a lost wait offering Retry;
  - Accept without an owner (M7);
  - `quiet` ignored;
  - the M2 line removed;
  - the 44px rule removed;
  - `am-ai-assist` emitting a press while `busy`.
- **No migration.**
