# ACC-302: handoff to lane A (the screens, PR 2)

From lane B, 14 Nov. The plan is `backend/Plans/step-302-task-cover-routing.md`; SYSTEM-REFERENCE
§3.5 has the mechanism.

PR 1 (backend) is built and not yet merged. PR 2 reads what PR 1 returns, and decides nothing itself.

## 1. The picker's new field

`GET /tasks/assignees` and `GET /tasks/assignees/committee` return `IAssignableHolder[]`, as today.
Each row gains:

```ts
cover: { userId: string; name: string } | null;
```

- **Meaning:** who a NEW task for this person goes to now, because they are out of office with an
  active cover.
- **Null** when the task goes to them.
- **Decided on the server, by one rule:**
  - an ACTIVE cover in the same organisation;
  - one hop only (a cover who is away too gives `null`).
- **Filled for every caller the picker already serves** (Ahmad: the creator is always told).
- **Never sent:** dates and the reason. The screen must not compute "away" from anything; it has
  nothing to compute from.
- **Same field in Reassign** (`?taskId=`): Reassign routes the same way.

## 2. The dialog line (New task and Reassign)

**When it shows:** when the person who will get the task has a `cover`, under Person:
- the chosen person's row has a `cover`; or
- with no person chosen, the position is one-holder and its holder's row has one.

| | Wording |
| -- | -- |
| English | `{{name}} is out of office. This task will go to {{cover}}.` |
| Arabic (singular, gender-neutral) | `{{name}} خارج المكتب. ستُسنَد هذه المهمة إلى {{cover}}.` |

- **No dates.**
- **A pool** (a position with several people and nobody chosen) shows no line: pools are unchanged.
- **Create task stays enabled.** The line informs; it never blocks.
- **The server's answer at Create task is final.** If someone goes away between opening the dialog
  and pressing Create, the task follows the rule at that moment.

**Measure before building anything else** (Prompt 45, item 3):
- **What to measure:** New task and Reassign, both languages, with the line shown, against the 420px
  body cap. Include Reassign's tallest state (393 / 394px today, ACC-199).
- **How:** the layout spec, with `useLayoutFonts()` (ACC-305).
- **If it goes over, stop and tell Ahmad before stepping anything** (ACC-120: stepping answers a
  measured overflow only).

## 3. "✦ Suggest someone"

- **Hidden, not disabled,** for a covered person. Their row's `workload.canSuggest` is `false`
  whenever `cover` is set, so the existing "show the button when canSuggest" logic hides it with no
  change.
- **The endpoint refuses them too.** `POST /tasks/assignment/workload-hint` with a covered
  `chosenUserId` gives 409 `WORKLOAD_NO_SUGGESTION` (the existing code, already worded on screen),
  before any AI call and with no charge.
- **A suggestion already made, when the CHOSEN person turns out to be covered:**
  - The dialog's stored answer for that person (`TaskWorkloadHintStore`) must not be shown once their
    row has a `cover`.
  - Hide it with the button. PR 2 needs one condition here: no stored hint while the chosen row has a
    `cover`.
- **When the SUGGESTED person turns out to be covered at Create:**
  - The task goes to their cover, like any task.
  - The audit row is left without the `aiWorkloadHint` mark (the existing check needs the chosen
    person among the assignees), with one warning line.
  - The task is never blocked.
  - Suggestions never name someone away (the model is never shown them), so this takes someone going
    away between the hint and Create.

## 4. The task page qualifier

- **The data is already there.** `GET /tasks/:id/view` returns each assignee's `delegation`
  (`{ reason, contextId, contextLabelEn, contextLabelAr }` or null), resolved under ACC-101's rule,
  UNCHANGED:
  - the cover always sees whom they cover;
  - anyone else only with `users:view`.
- **To build:** draw it on the assignee line when `delegation?.reason === 'OUT_OF_OFFICE_COVERAGE'`:

  | | Wording |
  | -- | -- |
  | English | `covering for {{name}}` |
  | Arabic | `بالنيابة عن {{name}}` |

- **When it is absent** (null), draw nothing: no placeholder and no hatching (ACC-101).
- **List rows** (My tasks, the record panel, All tasks) are NOT in this ticket (Ahmad, Q8).

## 5. For ACC-165 (lane A): which `task.service.ts` methods PR 1 touches

- `create()`: the placement's cover stamps are merged into `delegations`.
- `prepareStageEntryTask()`: `delegations` comes from the placement.
- `announceCreated()`:
  - the audit field `outOfOfficeCover`;
  - the cover's notice suffix;
  - the `prepared` parameter's type widens to an optional `delegations`.
- `reassign()`:
  - a row receiving the task as a cover is stamped;
  - the audit field;
  - the notice suffix.
- **New:** `namesOfCovered()` (private) and `coveringSuffix()` (module function, end of file).
- **Not touched:** `reassignAllForUser()`. Whoever merges second merges `dev` in; never rebase.
