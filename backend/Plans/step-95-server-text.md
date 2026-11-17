# ACC-95 PR 1 — server-built notification text: Arabic, counts, raw values (plan)

**Prompt 120 (lane B), 17 Nov. Plan only: no code.**
- **Branch:** `fix/ACC-95-server-text`, from dev `1e47283`.
- **Line numbers:** against that commit.

**Decided by lane B, from the ACC-95 check (Prompt 118):**
- Stored text stays (no key + parameters), and old rows are left as they are.
- Due dates in text stay absolute.
- Counts use Node's `Intl.PluralRules`, with every category the language has, in one small server helper. No "(s)".
- Dates get one helper on lane A's `peopleDateIn()` after #334 merges. **Not in this PR.**
- Hijri in server text comes later, with its own ticket.

## 1. Scope of PR 1

| Group | What | Sites |
| -- | -- | -- |
| English-only texts | add the Arabic | 10 |
| "(s)" counters | the plural helper | 3 places in 2 texts: `task.service.ts:1877`; `user.service.ts:1102–1105` and `:1894–1895` (the departure summary, part of the English-only text at `:1901`) |
| Raw values shown to a person | words instead | `workflow.service.ts:1540` `${instance.objectType}`; `sla-monitor.processor.ts:881` "escalation rule ${ruleIndex}"; and `user.service.ts:1894` "flagged as UNASSIGNED" (inside the departure summary) |

Nothing else changes. Bilingual texts that are already right are not touched, and neither are the dates (they wait for `peopleDateIn()`).

**Arabic rules:**
- Singular address, gender-neutral, and no gendered verb about a person. A passive verb or a verbal noun is used where an imperative or a third-person verb would mark gender.
- «منشأة» for the organisation.
- A record type uses the screens' own words (`workflow.objectTypeName.*`).
- Tenant data (task title, stage name, transition label) shows its Arabic name when there is one, else its English one, never blank (ACC-160).
- Digits are Latin.

## 2. The wording table

"Today's EN" is quoted as written. "New EN" appears only where today's is wrong; a dash means unchanged. `{t}` = task title (Arabic text: `titleAr ?? title`), `{who}` = a person's name, `{n}` = a count.

| # | File:line | Today's EN | New EN | Proposed AR |
|---|---|---|---|---|
| 1 | `task.service.ts:570` (create) title | New task assigned | — | مهمة جديدة مُسندة إليك |
| | body | You have been assigned: "{t}"{covering} | — | أُسندت إليك المهمة "{t}"{covering} |
| 2 | `task.service.ts:2140` (engine attaches assignees) title / body | as #1 | — | as #1 (no covering) |
| 3 | `task.service.ts:1604` (reassign) title | Task reassigned to you | — | أُعيد إسناد مهمة إليك |
| | body | "{t}" has been reassigned to you{covering}. Reason: {reason} | — | أُعيد إسناد المهمة "{t}" إليك{covering}. السبب: {reason} |
| — | `coveringSuffix()` `task.service.ts:2603` | " (covering for {who})" | — | « (نيابةً عن {who})» |
| 4 | `task.service.ts:1876` (departure, to the acting user) title | Tasks reassigned to you | one: **Task reassigned to you**; other: Tasks reassigned to you | the plural forms below |
| | body | {n} task(s) have been reassigned to you following a colleague's departure. | one: **1 task has been reassigned to you because a colleague left.** other: **{n} tasks have been reassigned to you because a colleague left.** | the plural forms below |
| 5 | `user.service.ts:1102` (missing position) title | {n} active user(s) missing position or org unit | one: **1 active user is missing a position or org unit**; other: **{n} active users are missing a position or org unit** | the plural forms below |
| | body | {n} active user(s) in your organization have no assigned position and/or org unit. Update each user's profile to complete their record. | one: **1 active user in your organization has no position or org unit.** other: **{n} active users…have no position or org unit.** + "Update each profile to complete the record." | the plural forms below, + «يلزم تحديث ملف كل منهم لإكمال بياناته.» (not the imperative «حدّث») |
| 6 | `user.service.ts:1901` (departure, to the admins) title | {who} has been deactivated | — | أُلغي تفعيل حساب {who} |
| | body | {who}'s account was deactivated. {summary} | — | أُلغي تفعيل حساب {who}. {summary} |
| | summary `:1894` | {n} task(s) reassigned, {m} task(s) flagged as UNASSIGNED and need manual reassignment. / {n} task(s) reassigned. | **{n} tasks reassigned.** plus, when m > 0: **{m} tasks are unassigned and need someone assigned by hand.** (each counted) | the plural forms below |
| 7 | `sla-monitor.processor.ts:396` title | Acting-unit assignment ended | — | انتهى التكليف المؤقت بوحدة أخرى |
| | body | Your acting assignment to another org unit has ended. | — | انتهى تكليفك المؤقت في وحدة تنظيمية أخرى. |
| 8 | `sla-monitor.processor.ts:832` title | Task SLA breach escalation | — | تصعيد مهمة تجاوزت مهلتها (Q-1) |
| | body | A task has breached its SLA and has been escalated to you. | **"{t}" is past its SLA and has been escalated to you.** (names the task, no extra read: `task` is in scope) | تجاوزت المهمة "{t}" مهلتها، وصُعِّدت إليك. |
| 9 | `sla-monitor.processor.ts:880` title | SLA breach escalation | — | تصعيد لتجاوز المهلة |
| | body | A workflow stage has breached its SLA and requires attention (escalation rule {i}). | **The "{stage}" stage is past its SLA and needs attention.** (Q-2: one read of the stage's names) | تجاوزت مرحلة «{stage}» مهلتها وتحتاج إلى متابعة. |
| 10 | `workflow.service.ts:1539` (a transition's people) title | {transition.labelEn} | — | `labelAr ?? labelEn` |
| | body | {OBJECT_TYPE} moved to {stage} | **{Type}: moved to {stage}** (e.g. "Committee: moved to Terms Review") | «{نوع}: الانتقال إلى مرحلة «{stage}»» (a verbal noun, so no verb agrees with the type) |
| 11 | `workflow.service.ts:1562` (first stage) title | New workflow assignment | — | تكليف جديد في سير العمل |
| | body | You have been assigned to {stage} | — | تم تكليفك بمرحلة «{stage}» |

**Plural forms for the counted texts:**

| Text | English `one` / `other` | Arabic |
|---|---|---|
| #4 title | Task reassigned to you / Tasks reassigned to you | **zero:** لم يُعَد إسناد أي مهمة إليك<br>**one:** أُعيد إسناد مهمة إليك<br>**two:** أُعيد إسناد مهمتين إليك<br>**few:** أُعيد إسناد {n} مهام إليك<br>**many / other:** أُعيد إسناد {n} مهمة إليك |
| #4 body | as in the table above | the title's forms + «بعد مغادرة أحد أعضاء المنشأة.» |
| #5 title | 1 active user is missing… / {n} active users are missing… | **zero:** لا يوجد مستخدم نشط ينقصه المسمى الوظيفي أو الوحدة التنظيمية<br>**one:** مستخدم نشط واحد ينقصه…<br>**two:** مستخدمان نشطان ينقصهما…<br>**few:** {n} مستخدمين نشطين ينقصهم…<br>**many:** {n} مستخدمًا نشطًا ينقصهم…<br>**other:** {n} مستخدم نشط ينقصهم… |
| #6 summary | 1 task reassigned / {n} tasks reassigned; 1 task is unassigned and needs someone assigned by hand / {m} tasks are unassigned and need… | «أُعيد إسناد {مهمة واحدة / مهمتين / {n} مهام / {n} مهمة}.» and «{مهمة واحدة / مهمتان / {m} مهام / {m} مهمة} بلا مسؤول وتحتاج إلى إسناد يدوي.» (zero is never sent: each clause is omitted at 0) |

## 3. The plural helper

**Where:** `backend/src/common/i18n/plural.ts`, beside the other server-wide helpers. It imports nothing from the frontend, and no frontend file is read at run time.

**Shape:**

```ts
export type EnglishForms = Readonly<Record<'one' | 'other', string>>;
export type ArabicForms = Readonly<Record<'zero' | 'one' | 'two' | 'few' | 'many' | 'other', string>>;

/** Both languages for a count. `{count}` is replaced with Latin digits. */
export function counted(count: number, forms: { en: EnglishForms; ar: ArabicForms }): { en: string; ar: string };
```

- **Built on `Intl.PluralRules`:** `'en'` and `'ar'`, one instance each, cached.
- **The types force every Arabic category,** so a writer cannot forget one. The compiler fails a missing `few`.
- **`{count}`** is formatted with `Intl.NumberFormat('en')`, so digits are Latin in both languages.
- **No fallback form:** a missing key is a type error, never a blank.

**How a writer uses it:** the forms sit next to the writer, as a `const` object, and the writer calls `counted(n, FORMS)` and puts `.en` / `.ar` into the four fields.

## 4. The workflow texts (`workflow.service.ts:1539`, `:1562`)

- **Transition label (title of #10):** `labelAr ?? labelEn`. Stored Arabic names are NULL when empty (ACC-160's `trimToNull`), so `??` is the whole fallback; never `''`.
- **Stage name (#9, #10, #11):** `nameAr ?? nameEn`, the same rule.
- **Record type (#10):** a new server map, `WORKFLOW_OBJECT_TYPE_WORDS`, for all 9 `WorkflowObjectType` values. Its words are copied from the screens' `workflow.objectTypeName.*`, e.g. COMMITTEE → Committee / لجنة.
  - A parity spec reads `frontend/src/assets/i18n/en.json` and `ar.json` **at test time only**, and fails when the two differ.
  - A type missing from the map is a type error (`Record<WorkflowObjectType, …>`).

## 5. Collisions with lane A (#330, #332, #334)

The lines here are dev `1e47283`'s; lane A's hunks are mapped to them by content.

| File | My lines | #330 | #332 | #334 |
|---|---|---|---|---|
| `task.service.ts` | 570–571 (create notice) | — | — | no |
| | 1604–1605 (reassign notice) | — | — | adds `DUE_WARNING_CLEARED` to reassign's **task update, ~40 lines above** this loop: a separate hunk |
| | 1876–1877 (departure notice) | — | — | no |
| | 2140–2141 (engine attach notice) | — | — | no |
| | 2603 `coveringSuffix()` | — | — | no |
| | (an import line for `counted`) | adds an import at the top | — | adds imports at the top: **adjacent import lines, a trivial merge** |
| | — | edits the task-updated notice (`changed.dueChanged` near the "Task updated" text, ~2360–2390) | — | same edit as #330 |
| `sla-monitor.processor.ts` | 396–397, 832–833, 880–881 | — | — | imports and constructor (top), one sweep step (~148), the overdue sweep (~639–653). **None within 150 lines of mine** |
| `user.service.ts` | 1102–1105, 1892–1903 | — | — | — |
| `workflow.service.ts` | 1539–1540, 1562–1563 | — | — | — |

#332 touches only `task-record-list.service.ts` and its spec, so there is no collision. **I recommend this PR goes after #334**, to rebase onto its `task.service.ts` imports. The overlap is cosmetic either way.

**I will NOT touch the "Task updated" notice** that #330 and #334 edit, or #334's new due-soon text.

## 6. Specs, mutations and the gate

**Specs:**
- **`common/i18n/plural.spec.ts`:**
  - every Arabic category with its boundary counts: 0, 1, 2, 3, 10, 11, 99, 100, 101;
  - English `one` / `other`;
  - Latin digits for a 4-digit count;
  - forms are returned exactly.
- **Per writer, in its existing service spec:** the `notificationService.create` call carries the exact `titleAr` and `bodyAr`.
  - #4 and #5 are checked at counts 1, 2, 3 and 11, in both languages.
  - #10 is checked with a stage that has no Arabic name: it uses the English one, never blank.
  - #10's type is a word, never `COMMITTEE`.
- **`workflow-object-type-words.spec.ts`:** the server map equals the screens' `workflow.objectTypeName.*` (reads the JSON at test time).
- **`notification-arabic.scan.spec.ts`** (new): every object literal with a `titleEn` passed to `notificationService.create` / `createInAppMany` in `backend/src` also has `titleAr` and `bodyAr`, and no notification string contains "(s)".
  - Non-vacuity: it reads more than 20 such literals, and its matcher catches a planted example of each shape.

**Mutations (each must go red):**
1. Drop `titleAr` from one writer.
2. `counted()` always picks `other`.
3. Put `${instance.objectType}` back.
4. Put "(s)" back in one text.
5. The stage name without its English fallback (`nameAr` alone).

**Gate:** tsc both sides, Jest, isolation, `test:db` on a fresh database, `ng build`, Karma, and every `check:*`. There is no frontend change, so Karma should be unchanged.

**No migration.** Old rows are left as they are, as decided.

## 7. Questions (one word each; recommendation ★)

1. **"SLA" in the Arabic task-escalation text:** the screens use three words: «مهلة المهام» (rail), «مدة الإنجاز» (workflow), «اتفاقية مستوى الخدمة» (task due). Use «مهلة»? — ★ **Yes** (short, and what the rail calls task SLA)
2. **Should the stage escalation (#9) name the stage?** It costs one indexed read per escalation. — ★ **Yes**
3. **Should the workflow "moved" notice (#10) name the record** (e.g. the committee's name)? It needs a per-type name lookup. — ★ **Later** (not PR 1)
4. **Arabic text uses the task's Arabic title when it has one** (`titleAr ?? title`), as the closed-task notices do? — ★ **Yes**
