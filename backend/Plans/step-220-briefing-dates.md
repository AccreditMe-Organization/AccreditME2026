# Step 220 — AI briefing: the model's text shows raw timestamps

Linear: **ACC-220** (lane B, Medium, Bug; related to ACC-198 and ACC-219).
Branch: `fix/ACC-220-briefing-dates`, from `origin/dev` at `df16243`.
Status: **APPROVED as written (Ahmad, 13 Oct), including the recommendations on
Q1, Q2 and Q3 (§6). Built; waiting for Ahmad to push.**

**Scope:**
- **What changes:** what we send the model, what we tell it, and how we read its answer.
- **What does not change:**
  - no migration;
  - the price (5), model, effort and output limit stay as they are;
  - no frontend change.
- **Also out of scope:**
  - al-nakheel's credits are not touched; the live re-test comes in a later prompt;
  - structured output stays with ACC-219.

---

## 1. What is wrong, and why

Seen in ACC-198's live proof (13 Oct, al-nakheel):

| Where | What the model wrote |
|---|---|
| English focus reason | "Overdue since **2026-09-23T13:00:00.000Z**, the only item past its due date." |
| English focus reason | "Most recent new sign-in, arrived **2026-10-13T04:28:47.536Z**, …" |
| English lead | "… is overdue and has been since **2026-09-23**." |
| Arabic lead and reason | "**2026-09-23**", which displays as "23-09-2026" inside right-to-left text (the bidi algorithm reorders the digit runs) |

**What is already correct:** every date our own code renders, such as the item rows' "due 23 Sep 2026, 16:00" and "7 minutes ago".

**The cause** is `briefingPrompt()` in `backend/src/foundation/ai-briefing/briefing-answer.ts`. It sends machine strings:
```
Now: 2026-10-13T04:35:37.000Z
- T1 | Test Task | due 2026-09-23T13:00:00.000Z
- R1 | … | asks for more time to 2026-10-26T09:00:00.000Z
- N1 | … | arrived 2026-10-13T04:28:47.536Z
```
The system prompt only says "no dates the list does not give". The list does give them, so the model copies them faithfully.

---

## 2. The fix, in three layers

### 2.1 The prompt sends no machine dates at all

**Every item's timing becomes wording that our code works out.** The working is done in the **tenant's zone**, the same zone `buildBriefingGroups()` already receives from `calendar.getEffectiveTimeZone()` in `AiBriefingService.make()`. It is never the server's zone and never UTC.

**Signature change:** `briefingPrompt(groups, language, now, zone)`. The service passes the `zone` it already holds, so no extra query is needed.

**One helper, `timingPhrase(item, zone, now)`, exported for its tests.** It uses Luxon, which `briefing-groups.ts` already uses.

**Day counts are CALENDAR days in the tenant's zone**, comparing local dates, not 24-hour blocks. This is display wording, not an SLA calculation, so it does not go through `WorkingCalendarService`. It matches what the card itself shows, since the frontend's `relative` format is calendar-based too, and "overdue by 3 days" means calendar days to a reader.

| Item | Situation (tenant's local dates) | Wording sent |
|---|---|---|
| TASK (mine or pool) | due earlier today | `overdue since 09:00 today` |
| | due yesterday | `overdue by 1 day` |
| | due N ≥ 2 days ago | `overdue by 20 days` |
| | due later today | `due today at 15:00` |
| | due tomorrow | `due tomorrow at 10:00` |
| | due 2+ days ahead | `due Mon 26 Oct` (the year is added only when it is not this year: `due Sun 3 Jan 2027`) |
| | no due date (pool) | `no due date` |
| TASK_REQUEST, extension | date asked for | `asks for more time until Mon 26 Oct` |
| TASK_REQUEST, hold | date asked for | `asks to pause it until Mon 26 Oct` |
| TASK_REQUEST, either | date asked for already passed | `… until Mon 12 Oct, which has passed` |
| TASK_REQUEST, either | no date | `asks for more time (no date given)` / `asks to pause it (no date given)` |
| NOTIFICATION | under 1 minute | `arrived just now` |
| | under 1 hour | `arrived 25 minutes ago` (`1 minute ago` singular) |
| | otherwise (the window is 24 h) | `arrived 3 hours ago` (`1 hour ago` singular) |

**"Overdue since 09:00 today"** covers an item due earlier today. It is in the Overdue group (past its time) but zero calendar days late; "overdue by 0 days" would read wrong.

**The `Now:` line becomes today's date written out in the tenant's zone:** `Today: Tuesday 13 October 2026`. There is no clock time and no zone name. The greeting is our code's (D6), so the model needs only the day.

**Day and month names are English (`setLocale('en')`), for BOTH briefing languages.** The prompt's scaffolding (group labels, instructions) is already English, and the model writes the briefing in the requested language; it already does this with the English group labels today. Building Arabic phrases would add a second wording table to test, for no gain the model doesn't already give. **(Q1)**

**Times use 24 hours (`HH:mm`)**, matching the card's format (ACC-94).

### 2.2 The system prompt forbids dates

The line `'No lists, links, markdown or dates the list does not give.'` is replaced by:

> Never write a date, a clock time or a timestamp of your own, and never copy one. When timing matters, reuse the list's wording ("overdue by 20 days", "due today at 15:00", "arrived 3 hours ago"), said naturally in the briefing's language. No lists, links or markdown.

The list's own wording may still contain a clock time ("due today at 15:00"). Saying that back naturally is allowed, because it is a time a person reads, not a machine timestamp. The guard below only targets machine dates.

### 2.3 A guard in `parseBriefingAnswer()`

**`hasMachineDate(text, groups)`** is true when the text contains, after the titles we sent are removed from it (see below):

| Pattern | Examples caught |
|---|---|
| ISO date, optionally with time and zone | `2026-09-23`, `2026-09-23T13:00`, `2026-09-23T13:00:00.000Z`, `2026/09/23` |
| Day-first numeric date with a 4-digit year | `23-09-2026`, `23/09/2026` |
| An ISO-style clock with seconds | `13:00:00` |

**The digits can be Western (0–9) or Arabic-Indic (٠–٩)**, because the model could write either in Arabic.

**Titles we sent are removed first.** The system prompt says "keep record names exactly as given". A task titled "Audit report 2026-09-30", quoted faithfully, must not trip the guard. So every item title in the groups (English, and the Arabic notification title where present) is cut out of the text before testing. A date the model writes itself is still caught.

**What happens when the guard finds a date:**

| Where | Action |
|---|---|
| The lead (JSON path or the plain-text path) | Use **our** lead, `codeLead()`, and set `fallback: true`. **Valid focus picks are KEPT (Q2)**: they are validated separately, so one bad sentence shouldn't cost the reader the picks. |
| A focus reason | **Drop that pick.** The other picks survive. If none survive, the section is not shown, as D13 already says. |

**It never throws.** Malformed JSON, a missing lead, a non-string reason and every other case behave exactly as today. The guard is a pure function over a string.

**Logging, counts only:** the service's existing warning line names how many picks were dropped for dates, and whether the lead fell back for a date. It logs no text (ACC-194 D5). `IBriefingAnswer` gains `datesFound: { lead: boolean; droppedPicks: number }` so the service can say this; the API response does not change.

---

## 3. Files

| File | Change |
|---|---|
| `briefing-answer.ts` | `timingPhrase()`, `todayLine()`, the new `briefingPrompt()` signature, the system-prompt line, `hasMachineDate()`, the guard in `parseBriefingAnswer()` |
| `ai-briefing.service.ts` | pass `zone` into `briefingPrompt()`; the warning line names the date drops |
| `briefing-answer.spec.ts` | the tests in §4 |
| `ai-briefing.service.spec.ts` | `briefingPrompt` is called with the tenant's zone |
| `SYSTEM-REFERENCE.md` §17.8 | one bullet: the model gets wording, never machine dates, and the guard |
| this plan | progress and any differences |

No frontend, migration, config or i18n change.

---

## 4. Tests

All are unit tests in `briefing-answer.spec.ts` unless noted. **The zone is `Asia/Riyadh` (UTC+3)** throughout, so a UTC-based implementation would visibly fail.

**The prompt contains no machine date: one test per item type.**
- A prompt built from groups holding an overdue task, a due-today task, a pool task (future, and no date), an extension request, a hold request and a notification.
- It contains no match for the ISO pattern and no `Z`-suffixed timestamp; the test asserts with the same `hasMachineDate()` and also with a literal `/\d{4}-\d{2}-\d{2}/`.
- The `Today:` line reads `Today: Tuesday 13 October 2026` for the chosen `now`.

**The wording:**
- **Overdue:** due 20 days ago → `overdue by 20 days`; yesterday → `overdue by 1 day`; earlier today → `overdue since 09:00 today`.
- **Due today:** `due today at 15:00`, the time in Riyadh, not UTC.
- **Requests:** `asks for more time until Mon 26 Oct`; hold → `asks to pause it until …`; a passed date → `…, which has passed`; no date → `(no date given)`.
- **Arrived:** `arrived just now`, `arrived 1 minute ago`, `arrived 25 minutes ago`, `arrived 1 hour ago`, `arrived 3 hours ago`.
- **Crossing midnight, both directions:**
  - now is 23:30 Riyadh on 13 Oct (20:30Z) and the task is due 00:30 Riyadh on 14 Oct (21:30Z, still 13 Oct in UTC) → `due tomorrow at 00:30`, NOT "due today";
  - now is 08:00 Riyadh on 13 Oct (05:00Z) and the task was due 01:00 Riyadh on 13 Oct (22:00Z on 12 Oct in UTC) → `overdue since 01:00 today`, NOT "overdue by 1 day".
- **The year:** a date in the next year gets its year (`due Sun 3 Jan 2027`).

**The guard:**
- A lead containing `2026-09-23` → our lead, `fallback: true`, and the valid picks are kept.
- The same for `2026-09-23T13:00:00.000Z`, `23/09/2026` and `٢٠٢٦-٠٩-٢٣`.
- A reason containing a timestamp → that pick is dropped and the others are kept. With every reason dated → `focus: []`.
- **No false alarm:** a lead quoting a sent title "Audit report 2026-09-30" verbatim is kept; "due today at 15:00" and "overdue by 20 days" are kept.
- The plain-text path (no JSON) with a date → our lead.
- Malformed answers still never throw; the existing tests stay as they are.

**The service** (`ai-briefing.service.spec.ts`): `make()` passes the zone from `getEffectiveTimeZone()` into the prompt. A test asserts that the prompt sent to `AiService.run` contains `Today:` and no ISO date.

**Mutation checks before reporting:**
- sending `item.dueAt` raw again makes the prompt test red;
- removing the guard makes the guard tests red;
- computing "today" in UTC makes the midnight tests red.

**Then the usual gates:** backend lint on the added lines, typecheck, the full Jest suite, the tenant-isolation pattern, `test:db` (unchanged, run anyway) and every backend `check:*`.

---

## 5. The live re-test, after the merge (a later prompt)

On the LIVE site, al-nakheel, as its Organization Administrator, by the page-side sign-in:

1. **English press:**
   - the lead and every focus reason contain no machine date (no `2026-…`, no `T…Z`);
   - where the model mentions timing, it reads like "overdue by 20 days" or "arrived 25 minutes ago";
   - the item rows are unchanged.
2. **Arabic press:** the same checks on the Arabic text, and no reversed "23-09-2026" anywhere.
3. **The database (read-only):**
   - 5 credits per run and one text-free log row per run, as before;
   - the stored lead and reasons hold no ISO date.
4. **Railway logs for the two runs:** whether the guard acted. A guard firing on the live model means the prompt is still leaking somewhere and would be reported, not hidden.
5. **Clean-up:** al-nakheel's used credits back to 0, keeping the 2,000 allocation.

Note for that day: **briefings saved before this fix keep their text.** The guard runs when a briefing is made, not when it is read. Today's saved Arabic briefing expires at the end of the day in Riyadh (D3), so nothing needs cleaning.

---

## 6. Questions for Ahmad

| # | Question | Recommendation |
|---|---|---|
| **Q1** | Timing wording in the prompt: English for both languages, or a second Arabic wording table? | **English for both** (recommended). The scaffolding is already English and the model writes in the requested language. Arabic phrases would double the wording table and its tests, for no visible gain. |
| **Q2** | When the guard rejects the lead, keep the valid focus picks, or drop them too (as the current "fallback" does for a malformed answer)? | **Keep them** (recommended): they are validated separately, and one dated sentence shouldn't cost the reader the picks. A malformed answer still gives no picks, as today. |
| **Q3** | Should the guard also catch a bare clock time like "15:00"? | **No** (recommended): the list's own wording contains times a person reads ("due today at 15:00"), and repeating them is fine. The bug is machine dates, and the guard targets exactly that. |

---

## 7. Build order (one commit each)

**Progress:**

- [x] 0. `docs(plans)`: this plan (`c554ce4`)
- [x] 1. `fix(ai-briefing)`: the prompt sends wording, not machine dates; the system-prompt rule; the guard; specs (`111fabc`)
- [x] 2. `docs`: SYSTEM-REFERENCE §17.8, and this plan's progress (this commit)
- [x] STOP: lint, typecheck, unit tests, `test:db`, the `check:*` scans; report. Ahmad pushes and runs /ready-to-pr. (Done 13 Oct: backend 3,149 tests, isolation 182, `test:db` 12; frontend 1,526; every `check:*` 0.)
- [ ] After the deploy (a later prompt): the live re-test in §5

---

## 8. Where the build differs from the plan

- **`timingPhrase()` also takes the item's GROUP**, i.e.
  `timingPhrase(item, kind, zone, now)`, not `(item, zone, now)` as in §2.1.
  - **Why:** a held task due earlier today sits in DUE TODAY, because a held
    task is never overdue (ACC-173). From the date alone it would have been
    worded "overdue since 06:00 today".
  - **Now:** a past due time is worded overdue only outside DUE TODAY, and a
    test pins it.
- **`IBriefingAnswer.datesFound` is `{ lead, droppedPicks }`**, as planned.
  The existing answer tests compare whole objects, so they now include it.
- **The service's warning line splits in two:**
  - "the lead held a machine date; ours was used" (or the old "no usable
    lead"), and
  - "N focus pick(s) dropped for holding a machine date".

  Both are counts only; a test checks that no date text reaches the log.
- **Mutation checks, as planned in §4** (each restored afterwards; 70 tests in
  the briefing specs):
  1. sending the raw `dueAt` again: **12 red**, including every
     prompt-carries-no-date test and both midnight tests;
  2. removing the guard: **13 red**, every guard test and the service's
     dated-lead test;
  3. working out "today" and item dates in UTC: **9 red**, including both
     midnight tests, the request crossing midnight, and the Wednesday-in-Riyadh
     "today" test.
