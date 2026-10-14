# Step 199 — AI workload hint when assigning a task (ACC-199)

**Status: APPROVED 14 Oct 2026 with Ahmad's changes (Q2, Q4, Q10, Q12). Building.**
Branch: `feat/ACC-199-workload-hint`, from `origin/dev` at `74bab36`.

Sources read:
- ACC-199 in Linear.
- `module-designs.md`, Task Module AI, point 2 (WORKLOAD_BALANCING).
- The design reference `frontend/design-reference/AccreditMe AI for Users.dc.html`: the two step-1 artboards, the "Reasoning · draft and workload" notes, the six outcomes, the measures, the changes list, and Q5.
- How ACC-197 and ACC-198 use `AiService.run()`, `aiFeatureAvailability()` and the AI log.
- The assignment picker as built (`TaskAssignmentService`, `TaskAssigneePickerComponent`, the Reassign dialog).

---

## 1. What the design says, and what Ahmad changed

The design draws two separate things:
1. **counts, not AI** ("12 open · 3 overdue" at the end of every person row, AI on or off, rows not growing);
2. **a hint, AI**, in the line under the picker:

   > ✦ AI · Goes to Nora Al-Otaibi, who has 12 open tasks, 3 overdue. Sara Al-Mutairi (Quality Officer, Cardiology) has 4 open.
   > **Assign Sara instead** · **Keep Nora**

   It is shown when the chosen person has 50% more open tasks than the least-loaded eligible person. It only ever suggests people the same assignment rules allow, and never appears for a pool or a single-holder position.

**Ahmad's changes (14 Oct):**
- **Q2 — never charged on choosing a person.** When the chosen person is past the threshold and AI is available, a small **"✦ Suggest someone"** button appears under the picker. Only a press calls the model.
  - The answer shows as the drawn hint, with "Assign … instead" and "Keep …".
  - It is kept for that person for the rest of the dialog, so a second press for the same person costs nothing.
  - A refused or empty pick is refunded.
  - With AI off, the counts show and the button does not.
- **Q4 — the counts are for the CURRENT RECORD only.** They count the open tasks on the committee or meeting the dialog was opened from, and only tasks the user could already see in that record's task list. No extra permission.
  - With no record (New task from the Tasks page), there are no counts and no button.
  - The model receives these record-only counts.
  - The hint says so ("on this committee").
- **Q10 — `workload_balancing`, 1 credit, open to every organisation with AI**, seeded the way the other feature rows were (§8).
- **Q12 — every final English and Arabic sentence, including the button, goes in the build report** for Ahmad to read.
- **Q1, Q3, Q5–Q9, Q11 as recommended.**

---

## 2. What the user sees, and where

### 2.1 Counts in the picker

**Where:** the Person list of **New task, step 1** and **Reassign**, when the dialog has a record and the user can see that record's task list. Not on Stage tasks settings. Not on New task from the Tasks page (no record).

**What a person row shows:** the name and position lines as today, and at the row's end edge, counted on THIS record only:

| Case | English | Arabic |
|---|---|---|
| Open and overdue | `12 open · 3 overdue` (overdue amber, 600) | `12 مفتوحة · 3 متأخرة` |
| Open, none overdue | `4 open` | `4 مفتوحة` |
| Nothing open | `0 open` | `0 مفتوحة` |

- Digits are Latin in both languages, and the counted words are plural objects (ACC-94).
- **The rows do not grow:** a layout spec compares row height with and without counts.

**Where the counts come from:** the same request that lists the people (`GET /tasks/assignees`, `GET /tasks/assignees/committee`). It gains optional `sourceType` + `sourceId`, and each person gains `workload: { openCount, overdueCount, canSuggest } | null`.
- `null` when no record was named, or when the caller cannot see that record's task list.
- Never an error: the picker always works, and only the counts are withheld.

### 2.2 "✦ Suggest someone" and the hint

| State | What shows under the picker (New task: the outcome line; Reassign: the person field's hint) |
|---|---|
| A person chosen, **not** past the threshold, or AI off | the plain outcome, as today: "Goes to Nora Al-Otaibi." |
| A person chosen, past the threshold, AI available | the plain outcome, with **✦ Suggest someone** at its end edge |
| Pressed, waiting | the plain outcome, with **◌ Suggesting…** (disabled, busy) in the button's place |
| The answer | the hint, marked "✦ AI ·" with a dashed inline-start rule, then **Assign … instead** · **Keep …** |
| A refusal | one line in the same place: the reason, worded by code (§7) |

- **Assign … instead** sets Person, and the outcome follows. The new person is the least loaded, so no button shows for them.
- **Keep …** returns the plain outcome, with the button again.
- **The answer is kept per person for the dialog:** pressing again for the same person shows the kept answer with no call. "Nobody clearly better placed" is an answer too, and is kept. A failed call is not kept, so Try again calls again.
- **Never on dialog open, never for a pool, never for a single-holder position.**

---

## 3. Our code, and the model

| Part | Who |
|---|---|
| Who is eligible: active holders of the position in the unit, or active members of the committee role | **our code**: ACC-167's holder rule, exactly as the picker lists them |
| The counts | **our code** (§5) |
| Whether the button shows (the threshold) | **our code**, in the server's `canSuggest`, re-checked on the press |
| Which eligible person to suggest | **the model**: one label it was given, or none |
| Every word, name and number shown | **our code**, from translations and the counts |

The model writes no words that are shown (ACC-198 D13).

---

## 4. The threshold (Q3)

- `chosen` is the person picked.
- `others` are the eligible people except `chosen`, leaving out anyone out of office today (Q6).
- `least` is the smallest open count among `others`.
- **Past the threshold when `others` is not empty, `chosen.open ≥ 1.5 × least`, and `chosen.open − least ≥ 3`.**
- The server computes `canSuggest` per person in the list, and computes it again on the press. A press that is no longer past the threshold gets `WORKLOAD_NO_SUGGESTION` with no call and no charge.

---

## 5. The counts (record-only, computed live)

**Scope: tasks on THE record** (`sourceType` + `sourceId` of the dialog), and only if the caller may see that record's task list. That is exactly `GET /tasks?sourceType=&sourceId=`'s rule: `tasks:view` AND `ObjectVisibilityService` on the record (ACC-101). That list shows every task on the record, so "tasks the user could already see" is all of them, or none.

| Count | Definition (per person, on this record) |
|---|---|
| `openCount` | active assignee row (`removedAt: null`); task not COMPLETED or CANCELLED (ACC-65's open; ON_HOLD is open) |
| `overdueCount` | of the open: not ON_HOLD, `dueAt` before now (ACC-163/173) |
| due soon (model only) | of the open: not ON_HOLD, due within the next 2 working days by the tenant's calendar (`WorkingCalendarService.calculateDeadline`) |
| urgent (model only) | of the open: HIGH or CRITICAL |
| on hold (model only) | of the open: ON_HOLD |

- **An unpicked pool task counts for nobody.**
- **In Reassign, the task being reassigned is left out.**
- **One query** for the listed people: `taskAssignee.findMany` with `task: { organizationId, sourceType, sourceId, status open }`, summed in code. `TaskAssignee` has no `organizationId`, so the tenant scope goes through the task.
- **Nothing is stored**, so nothing needs a recomputer (ACC-82).

---

## 6. What the model receives

**No names, no user ids, no titles, no record name, no unit or position name.** Opaque labels in a shuffled order, the record's TYPE, the task's priority, and the record-only counts:

```
The task: priority HIGH. Counts are for open tasks on this committee only.
Currently chosen: P3 — open 12, overdue 3, due within 2 working days 2, high or critical 4, on hold 0.
Others who could take it:
P1 — open 4, overdue 0, due within 2 working days 1, high or critical 0, on hold 0.
```

- **At most 15 others**, the least loaded first. `inputTokenCap: 1500`, pinned by a spec.
- **Answer:** `{"pick":"P1"}` or `{"pick":null}`.
- **What is refused, and refunded:**
  - a label we did not send, or the chosen person's own label: refunded, `AI_PROVIDER_FAILED`;
  - empty, unreadable or cut short: refunded, `AI_PROVIDER_FAILED`;
  - `null`: refunded, `WORKLOAD_NO_SUGGESTION` ("nobody clearly better placed").

---

## 7. The endpoints

**`GET /tasks/assignment/workload-hint/availability`** → `{ available }`. Whether to show the button at all; nothing about the balance.

**`POST /tasks/assignment/workload-hint`:**
- Body: `{ orgUnitId + positionId | committeeId + roleValueId, chosenUserId, sourceType, sourceId, priority?, taskId? }`.
- Answer: `{ interactionId, chosen: { userId, openCount, overdueCount }, suggestion: { userId, name, positionNameEn, positionNameAr, openCount, overdueCount } }`.
- **No `@Permissions`, like every picker route.** In order:
  1. `assertMayAssign()` (and `committees:view` for a committee);
  2. the record's task list must be visible to the caller (`tasks:view` → 403 naming it; `ObjectVisibilityService` → 403 / 404);
  3. the target exists; a committee role only on that committee's own record (as `resolvePlacement()`);
  4. eligible people; `chosenUserId` must be one (400);
  5. the counts and the threshold → `WORKLOAD_NO_SUGGESTION` if not met, no call;
  6. `aiFeatureAvailability()` → `AI_NOT_ENABLED`;
  7. `AiService.run('workload_balancing', …, { accept })`;
  8. the label is mapped back to the person.
- **Refusal codes:** `WORKLOAD_NO_SUGGESTION` (409, not charged); the gateway's own (`AI_NOT_ENABLED`, `AI_CREDITS_EXHAUSTED`, `AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_FAILED`, `AI_FEATURE_NOT_PRICED`); `RATE_LIMITED`.
- **Log description, ids and counts only:** `workload hint · COMMITTEE <id> · POSITION · 4 eligible · chosen <userId>`.
- **Rate limit:** `RATE_LIMITS.workloadHint` = 20 / min per user (`perUser()`), Q11.

---

## 8. Credit cost, and the price row

**`workload_balancing`, 1 credit, open to every organisation with AI** (Q10). There is no row today.

**How it is seeded — the same way as the other three:**
1. The row is one more entry in `AI_FEATURE_COST_SEED` (`foundation/ai/ai-feature-cost.seed.ts`), unrestricted.
2. **After the deploy**, run `npm run seed:ai-feature-costs` (a dry run: it prints `create workload_balancing = 1 credits, open to every organisation` and `keep` for the three existing rows).
3. Then run `npm run seed:ai-feature-costs -- --execute`. It creates only missing rows, never overwrites an edited one, and writes one audit row in the platform organisation's trail.

**Until the row exists,** the availability route answers `{ available: false }` (`aiFeatureAvailability()` treats an unpriced feature as unavailable), so the counts show and the button does not.

`ai.config.ts`: `workload_balancing: { tier: 'STANDARD', effort: 'low', maxTokens: 1000, inputTokenCap: 1500 }`.

**Charged only for a suggestion shown.** A press below the threshold, or a `null` or unusable pick, costs nothing. A dialog closed after the provider was reached is charged (the drawing's Q2).

---

## 9. Arabic and English

The model's answer is a label only, so it has no language. Every sentence is ours, from translations, and **every final sentence is listed in the build report for Ahmad** (Q12):
- The record phrase: "on this committee" / "on this meeting".
- Gender-free Arabic: the platform stores no gender, so the Arabic is worded to need none.
- Names are shown as stored (`User.name` has no Arabic form). Position names go through `LanguageService.bilingual()`.

---

## 10. Dialog height against the 420 px cap

Measured for this plan in the real dialog shell (a throwaway spec, deleted; no task created). New task, step 1, a person chosen:
- today: **317 / 328**;
- with the drawn hint (two lines) and its actions on their own line: **370 / 386**.

**The button sits at the end edge of the outcome line**, so "button showing" and "working" add a line only when the outcome text and the button cannot share one.

**Reassign** (tallest state 358 / 371 today):
- the hint's actions sit at the end of the hint's own text instead of on a line of their own;
- if its worst Arabic state still does not fit, **Reassign ships counts only** and the results say so.

**The layout spec measures, in both languages, with no task created:**
- New task and Reassign, each in every state: counts only, button showing, working, hint, refusal (the longest);
- picker row height with and without counts.

---

## 11. Audit (Q9)

- **Only a FOLLOWED suggestion is recorded,** on the task's CREATE row (New task) or its reassign row: `metadata.aiWorkloadHint: { interactionId, suggestedUserId }`.
- **The server checks it** against the AI log before writing it:
  - a successful `workload_balancing` call by this actor, in this organisation, within 24 hours;
  - and the task really went to that person directly.
- As with ACC-197's `aiDraft`, the call is verified and the rest is the dialog's claim.
- A claim that does not check out leaves the task created or reassigned and unmarked, with one warning line. It never blocks the work.
- Keep, or a hint ignored, writes nothing.

---

## 12. What gets built

**Backend**

| File | Change |
|---|---|
| `foundation/task/workload/task-workload.ts` (new) | the record-only counts and the threshold |
| `foundation/task/workload/workload-hint-answer.ts` (new) | the prompt and the parse |
| `foundation/task/workload/workload-hint.service.ts`, `workload-refusal.ts` (new) | the press, in the order of §7 |
| `foundation/task/task-assignment.service.ts` | `listHolders()` / `listCommitteeMembers()` add `workload` when a record is named and visible |
| `foundation/task/task.controller.ts`, `dto/` | the two routes (static, before `:id`); `sourceType` / `sourceId` on the people queries |
| `foundation/task/task.service.ts`, `dto/` | `aiWorkloadHint` on create and reassign, verified, onto the audit row |
| `foundation/ai/ai.config.ts`, `ai-feature-cost.seed.ts` | the feature, and its seeded price (1) |
| `common/throttle/rate-limits.ts` | `workloadHint` 20 / min per user |

**Frontend**

| File | Change |
|---|---|
| `task-assignee-picker.component.ts` | counts at the end of person rows; the button, working state, hint and refusal under the picker; the per-person kept answer; `hintFollowed` output |
| `task-workload-hint.component.ts` (new) | the line: ✦, the "AI" words, the dashed inline-start rule, no card (Q8), the actions inline or on their own line |
| `task-form.component.ts`, `task-reassign-dialog.component.ts` | pass the priority; send `aiWorkloadHint` on save when the suggestion was followed |
| `tasks/services/task.service.ts` | the new fields and calls |
| `assets/i18n/en.json`, `ar.json` | `task.workload.*` and plural objects |

**Docs:** SYSTEM-REFERENCE §17 and §3.9, the rate-limit table; CLAUDE.md "Key Architecture Decisions (ACC-199)", the Rate Limiting table, the AI price list.

---

## 13. Migration

**None.**
- The counts are computed live.
- The marker is `AuditLog.metadata`.
- The price row is seeded data, after the deploy.
- The new fields are response fields, not columns.

---

## 14. Tests

**Backend**
- **Counts:**
  - record-only;
  - open includes ON_HOLD and excludes COMPLETED, CANCELLED and removed rows;
  - overdue excludes ON_HOLD;
  - unpicked pool tasks count for nobody;
  - Reassign leaves its own task out;
  - due soon goes through `WorkingCalendarService`;
  - `should NOT return records belonging to a different tenant`.
- **Who sees counts:**
  - no record → `null`;
  - no `tasks:view` → `null`;
  - the record not visible → `null`;
  - the picker still answers in every case.
- **Threshold:** a table of cases (1 vs 0, 2 vs 1, 3 vs 0, 6 vs 4, 12 vs 4, out of office left out).
- **Prompt:**
  - no names, user ids, titles, record, unit or position names — asserted against the fixture's real strings;
  - shuffled labels;
  - at most 15 others;
  - worst case under `inputTokenCap`.
- **Parse:** a pick; `null`; an unknown label; the chosen person's own label; empty or unreadable or cut short.
- **Service order:**
  - may-assign and record visibility before any count;
  - a committee only on its own record;
  - below the threshold, no call;
  - `AI_NOT_ENABLED` before the call;
  - the log description is ids and counts only.
- **Routes:** static before `:id`; no `@Permissions`; the 20 / min tier (a real 21st request gets 429).
- **Audit marker:** written only when verified; the tenant-isolation-named case.

**Frontend**
- **Rows:** counts in both languages; overdue styled and worded; none with no record, on stage tasks, or when `workload` is `null`.
- **Button and hint:**
  - the button only when `canSuggest` and AI is available;
  - one call per person per dialog;
  - Assign instead and Keep;
  - every refusal worded;
  - the claim sent on save only when followed.
- **Layout spec** (both languages, real shell, no task created): every state of §10, and row height with and without counts.

**Mutation checks (each must turn a named test red):**
- drop the threshold re-check;
- drop `task: { organizationId }` from the counts;
- drop the record filter;
- count ON_HOLD as overdue;
- send names to the model;
- accept an unknown label;
- trust the audit claim without the lookup;
- show counts with no record;
- call on choosing a person rather than on a press.

---

## 15. Decisions (14 Oct)

| Q | Decision |
|---|---|
| Q1 | The model picks from anonymous labels, counts and priority only; our code writes everything shown. |
| Q2 | Never charged on choosing. "✦ Suggest someone" appears past the threshold with AI available; only a press calls; the answer is kept per person for the dialog; refused or empty picks are refunded; AI off → counts only. |
| Q3 | 50% more open tasks AND at least 3 more than the least-loaded eligible person. |
| Q4 | Counts only for open tasks on the dialog's record, and only if the user can see that record's task list; no record → no counts, no button; the model gets these counts; the hint says "on this committee". |
| Q5 | ACC-65's open, ACC-173's overdue; unpicked pool tasks count for nobody; Reassign leaves its own task out. |
| Q6 | Out of office today: never suggested; still listed with counts. |
| Q7 | Reassign too, with the actions inline; counts only if the hint cannot fit. |
| Q8 | A dedicated hint component carrying the AI marks; no card. |
| Q9 | Only a followed suggestion is recorded, verified against the AI log. |
| Q10 | `workload_balancing`, 1 credit, open to every organisation with AI, seeded after the deploy (§8). |
| Q11 | 20 a minute per user. |
| Q12 | Gender-free Arabic; every final sentence in the build report. |

---

## 16. Progress

- [x] Ahmad approves the plan (14 Oct, with changes to Q2, Q4, Q10, Q12)
- [ ] Counts on the picker endpoints, with specs
- [ ] The press: prompt, parse, service; the routes, DTO and rate tier
- [ ] The audit marker on create and reassign
- [ ] Frontend: row counts, the button and hint, New task and Reassign wiring, i18n
- [ ] Layout spec in both languages; mutation checks
- [ ] SYSTEM-REFERENCE and CLAUDE.md
- [ ] The gate, then stop before pushing
- [ ] After the merge: the price seed, then the live proof
