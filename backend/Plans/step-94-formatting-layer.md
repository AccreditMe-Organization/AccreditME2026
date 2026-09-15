# ACC-94 — One Formatting Layer for Dates, Numbers and Plurals

**Status: PLAN APPROVED by Ahmad on 2026-09-15, with conditions (§0).** The commit
sequence (§10) is proposed and awaiting approval. No implementation has started.
Branch: `feature/ACC-94-formatting-layer` (from `dev` at `fc8adcb`).

This sets a rule every future module copies (Documents and Meetings first), so
the decisions below matter more than the code. Every claim here was checked on
2026-09-15 against the code or by running it, not assumed. Where something was
measured, the number and method are given.

---

## 0. Decisions — approved by Ahmad, 2026-09-15

All five as recommended, with the conditions Ahmad attached:

| # | Decision | Approved, with |
| -- | -- | -- |
| D1 | **Built-in plurals** (`Intl.PluralRules` + `Intl` unit formatters), not ICU | *"unsafe-eval is the stronger reason than the 75.7 kB."* **Conditions:** (a) the layer's API must make it **impossible** to use a plural key through the plain translate pipe (design in §3); (b) **every counted string gets all six Arabic categories**, not only the two English needs. |
| D2 | **Add `timeZone` and `hijriDisplay` to `GET /auth/me`** | *"No API contract changes" meant no reshaping and no stored-data changes; two additive read-only fields follow the precedent `language` set in ACC-19.* |
| D3 | **The working calendar's time zone** is the tenant's | **Record in SYSTEM-REFERENCE which of the two fields is authoritative.** *"Two fields holding one fact is what produced the stale vacancy flag."* Follow-up: ACC-97. |
| D4 | **Hijri first, Gregorian in brackets** | **For display only.** Anything a person types or picks stays Gregorian, and so does anything machine-readable. Gregorian UTC is the record (CLAUDE.md). |
| D5 | **24-hour** in both languages | — |

### Four additions, approved with the plan

1. **Date picker display format is in scope** (`mm/dd/yy` and English month names
   in an Arabic session are the same defect). How a picked day becomes a stored
   instant stays out: **ACC-96**.
2. **The layer owns the empty-value convention** (§4), so components stop
   inventing one.
3. **"overdue 0d" is fixed in the relative formatter** (§4); it is visible to
   users today.
4. **Out-of-scope items are real Backlog tickets, not notes:** ACC-95
   (server-built notification and email text, including the working-days trap),
   ACC-96 (picked day to stored instant), ACC-97 (duplicate time-zone fields) and
   ACC-98 (no screen sets the Hijri preference).

---

## 1. What drives what

Three things are conflated today, and each is currently decided by the wrong
source, or by nothing at all.

### The rule

| Aspect of a displayed value | Driven by | Source | Today (verified) |
| -- | -- | -- | -- |
| **Text language** (month names, "ago", words around numbers) | UI language | `TranslateService.currentLang()` via `LanguageService` | Ignored by every `\| date` call: no locale is registered, so it is always `en-US` |
| **Digits** | Fixed: Latin, always (§2) | The layer, not any locale | Correct only by accident (see §2) |
| **Time zone** (which calendar day an instant falls on) | **The tenant** | The tenant's effective time zone, see D3 | The **browser's** time zone. Nothing on the frontend reads the tenant's |
| **Calendar** (Gregorian / Hijri) | **The user's own preference** | `User.hijriDisplay` | Not read anywhere: the field exists only in the schema |
| Plural form of a counted word | UI language + the number | `Intl.PluralRules(lang)` | An English-shaped one/other branch, or none |

**Recommendation: this table becomes the rule in CLAUDE.md.** The reason for the
time-zone row in particular: the day an instant belongs to is a property of *where
the organisation works*, not of *where a reader happens to be*. The SLA engine
already decides "due" in the tenant's time zone (`WorkingCalendarService`, Luxon
`setZone(calendar.timezone)`). If the screen decides "today" in the browser's time
zone, the two disagree for anyone outside it: a platform admin, a traveller, a
tester, and **CI, whose runner is UTC**.

### The failure it prevents, with a real instant

Instant `2026-09-15T21:30:00Z` (probed in Chrome 152 and Node 22):

| Rendered in | Reads as |
| -- | -- |
| Tenant time zone `Asia/Riyadh` | **16 Sep 2026, 00:30** |
| A UTC browser (CI, a platform admin in London) | **15 Sep 2026, 21:30** |

A task due at that instant is "due tomorrow" to one reader and "due today" to
another. Once past due, it can still read "due today" in the second view. This
machine's browser is itself in `Asia/Riyadh`, which is exactly why the defect is
invisible here: tests must pin a *different* tenant time zone to catch it (§8).

### D3 — the tenant has two time-zone fields

Verified:

* `Organization.timezone` (default `Asia/Riyadh`) is edited through the tenant /
  Organization Profile DTOs, **and read by nothing that computes a due date.**
* `WorkingCalendar.timezone` (default `Asia/Riyadh`) is edited in Working Calendar.
  **`WorkingCalendarService.calculateDeadline()` and
  `SlaMonitorProcessor.isWithinWorkingHours()` use this one**, through
  `WorkingCalendarService.getOrCreate()`. When a tenant has no calendar row,
  `getOrCreate()` **creates** one from a hard-coded `GCC_DEFAULT`
  (`Asia/Riyadh`), ignoring `Organization.timezone`.
* On dev they agree today: all `Asia/Riyadh`, and al-manara has no calendar row
  yet. Nothing keeps them in agreement.

**Approved (D3): display uses the time zone the SLA engine uses.** Resolved on the
backend by a new **read-only** `WorkingCalendarService.getEffectiveTimeZone(organizationId)`:
the calendar row's `timezone` if the row exists, otherwise `GCC_DEFAULT.timezone`,
which is exactly what `getOrCreate()` would store. It **never creates a row**,
since `GET /auth/me` must not write. Then "due" on screen and "due" in the engine
cannot disagree by construction. SYSTEM-REFERENCE records `WorkingCalendar.timezone`
as authoritative and `Organization.timezone` as read by nothing that computes a
date. **Merging or retiring the duplicate is ACC-97.**

### D2 — the frontend cannot currently see either value

* `GET /auth/me` returns `id, email, name, language, impersonatedBy`. No time
  zone, no Hijri flag.
* `GET /tenant` needs `tenant:view` (TENANT_ADMIN only), and `GET /working-calendar`
  needs `org:view`. A non-admin, who is most of the users reading due dates, can
  read neither.
* `User.hijriDisplay` is read by no endpoint and set by no endpoint or screen.

So "time zone follows the tenant" and "calendar follows the user" **cannot be
honoured without the frontend receiving two values it does not receive today.**
Scope item 6 says no API contract changes.

**Approved (D2): one additive, read-only change** — `GET /auth/me` gains
`timeZone: string` (resolved as in D3) and `hijriDisplay: boolean`. Existing
fields are unchanged, nothing is stored or migrated, and older clients ignore the
new fields. It follows the precedent of `language` (ACC-19), which is resolved
server-side and returned on the same response for the same reason.

During impersonation, `/auth/me` already describes the impersonated user, so the
display follows that user's tenant and preference. That is correct: the
platform admin is looking at the tenant as its admin sees it. Before sign-in no
date is displayed; the layer's default time zone is `Asia/Riyadh`, the same
`GCC_DEFAULT` the backend uses.

---

## 2. Digits — Latin everywhere (decided by Ahmad)

### How Arabic-Indic digits get in (verified)

| Route | Verified behaviour | Today |
| -- | -- | -- |
| Literal digits typed into `ar.json` | Rendered as typed | **3 keys** contain "٧" (§7g) |
| `Intl` / `toLocale*String` with an Arabic locale | Depends on the **region**, not the language: `ar` and `ar-AE` → Latin; **`ar-SA` and `ar-EG` → Arabic-Indic** (`١٦‏/٠٩‏/٢٠٢٦`, `١٬٢٣٤٫٥`). Same in Chrome 152 and Node 22 (ICU 76, CLDR 46) | The 3 `toLocaleDateString` sites pass bare `'ar'`, so they are Latin **by luck**. A future change to `'ar-SA'` (the obvious choice for a Saudi tenant) silently flips them |
| JS number-to-string interpolation (`{{count}}`) | Always Latin | Safe |
| Angular `DatePipe` / `formatDate` | Latin (Angular's formatter does not substitute numbering systems) | Safe, but the pipe goes away (§4) |

### Rule and enforcement

1. **The layer is the only place that constructs `Intl.DateTimeFormat`,
   `Intl.NumberFormat`, `Intl.RelativeTimeFormat` or `Intl.PluralRules`,** and it
   always passes `numberingSystem: 'latn'`, whatever locale it uses.
2. **A build-time source scan** (a small Node script, run as a step in CI's
   frontend job) fails the build on any of these outside the layer's own folder:
   `| date`, `DatePipe`, `formatDate(`, `toLocaleDateString(`,
   `toLocaleTimeString(`, `toLocaleString(`, `new Intl.`. It has to be a build
   step: Karma specs run in a browser with no filesystem and cannot scan source.
   `translation-keys.spec.ts` already records that limitation.
3. **A spec over `ar.json` and `en.json`** (extending `translation-keys.spec.ts`,
   which already imports both) fails on any Arabic-Indic (U+0660–U+0669) or
   Extended Arabic-Indic (U+06F0–U+06F9) digit anywhere in a value.
4. **Fix the three strings:** `setupHealth.cleared.window`, `cleared.none` and
   `cleared.note` change "٧" to "7". Their English siblings already say 7.

What this does not catch: a digit typed inside a tenant's own data (a committee
named "لجنة ٣"). That is data, not UI, and is left as entered.

---

## 3. Plurals

### The problem, measured

`Intl.PluralRules('ar')` has six categories: `zero, one, two, few, many, other`
(0→zero, 1→one, 2→two, 3–10→few, 11–99→many, 100→other; verified). ngx-translate
v18 interpolation has no plural rules at all. Every counted string today is one
fixed form. **English is wrong too:** "1 open conditions" was seen in the rail's
badge label, and "1 permissions", "1 members", "in stage 1 days" and "task(s)" are
live (§7e).

### Options (sizes measured on 2026-09-15)

Method: packages installed into a scratch directory, not the repo, bundled with
the frontend's own esbuild (`--bundle --minify`, Angular / ngx-translate / RxJS
external, since the app already ships those). Angular's budget counts the
uncompressed size, so the "min" column is the one that counts against ACC-90.

| Option | Adds (min) | Adds (gzip) | Notes |
| -- | -- | -- | -- |
| **A.** `ngx-translate-messageformat-compiler` 7.3.0 + `@messageformat/core` 3.4.0 (full ICU) | **75.7 kB** | 22.1 kB | Real ICU: plural, select, nesting. Supports ngx-translate v18 (peer dep checked). **About 40% of the ~187 kB left before the 1 MB error budget** (ACC-90). Compiles messages at runtime with `new Function` (verified in `messageformat.js`), so any future Content-Security-Policy on the frontend host needs `unsafe-eval`. Every placeholder in all 48 interpolating keys changes syntax (`{{x}}` → `{x}`), and literal apostrophes and braces across 667 keys become ICU escapes. |
| **B.** `Intl.PluralRules` key selection | **~0.1 kB** (the selection itself; the layer's own code adds a few kB) | ~0.1 kB | A plural key's value becomes an object of categories (`{"one": "…", "two": "…", "few": "…", "many": "…", "other": "…"}`), and the layer picks one with `Intl.PluralRules(lang).select(n)`, falling back to `other`. No syntax change to the other keys. Handles plural, not ICU `select` or nesting. |
| **C.** `Intl.NumberFormat` style `unit` / `Intl.RelativeTimeFormat` / `Intl.DurationFormat` | 0 kB | 0 kB | Verified correct in Chrome 152 for Arabic time quantities: "يوم / يومان / 3 أيام / 7 أيام / 11 يومًا / 100 يوم" and "قبل 3 أيام / قبل 11 يومًا". Covers days, hours and minutes only — not "members" or "permissions". |

### D1 — approved: B + C, not A

* **C for every time quantity** (ages, "overdue N days", "in stage N days",
  "N minutes ago"): the platform already pluralises these correctly in both
  languages, at no cost.
* **B for every other counted noun** (members, permissions, assignees, tasks,
  conditions, open items).
* **Not A**, for three reasons: it spends 40% of the remaining budget before any
  functional module lands; it adds a CSP `unsafe-eval` dependency to a product
  whose own security configuration (CLAUDE.md, Helmet) treats CSP as required; and
  nothing in the inventory needs ICU `select` or nesting today.
* **Revisit A** when a real sentence needs a gender or select branch (Arabic verb
  agreement with a feminine noun is the likely first case), at which point its
  cost is weighed against that sentence, not against a hypothetical one.

### Condition (a) — a plural key cannot reach the plain translate pipe

"Discouraged by a rule" is not "impossible", so the design keeps plural strings
**out of ngx-translate's store entirely**:

* Both translation files gain one top-level section, `"plural"`, holding every
  counted string as a category object, for example
  `"plural": { "role": { "permissions": { "zero": "…", "one": "…", "two": "…", "few": "…", "many": "…", "other": "…" } } }`.
* A **custom translation loader** wraps the existing HTTP loader. It fetches each
  language file once, **removes the `plural` section before ngx-translate sees
  it**, and hands that section to the layer's own `PluralCatalog`.
* So `'plural.role.permissions' | translate`, or `translate.instant('plural.…')`,
  **finds no such key** in ngx-translate. There is no object to render as
  "[object Object]"; the worst a mistake can produce is the key text itself,
  which is visible in review and in any browser pass, not a silently wrong
  sentence.
* Counted strings are reachable **only** through the layer: the `amCount` pipe
  (`{{ n | amCount: 'role.permissions' }}`) or `FormatService.count(key, n, params)`.
  The key argument is typed as `PluralKey`, a union of dotted paths derived at
  compile time from the English file's `plural` section, so a typo fails `ng build`.
  The reference is **type-only** (`typeof import('…/en.json')`, with
  `resolveJsonModule` already on in `tsconfig.json`), so the JSON is not pulled
  into the bundle.
* Belt and braces: the build-time scan (§2) also fails on any `plural.` string
  passed to `translate` or `instant(`.

### Condition (b) — all six Arabic categories, every counted string

* A spec over `ar.json`: every leaf object under `plural` defines **exactly**
  `zero, one, two, few, many, other`. A missing category fails; there is no
  silent runtime fallback to `other` for Arabic. `en.json` defines exactly
  `one, other`. Each language's set is taken from `Intl.PluralRules(lang)` at test
  time rather than hard-coded, so the spec follows CLDR.
* A spec over both files: **no value outside `plural` interpolates a counted
  number.** The rule is by placeholder: `count`, `days`, `hours`, `minutes` and
  `total` may appear only inside `plural`. Two keys carry numbers with **no
  counted noun** and are the only exceptions, listed in the spec with the reason:
  `list.panelRange` ("1–25 of 120") and `workflow.stageIndicator.revisited`
  ("×3"). This is a small maintained list, and it is weaker than the rest for
  that reason. It is kept to two entries, and adding one needs a justification
  in the spec.
* **Time quantities never need a plural object at all.** They go through
  `Intl.NumberFormat` units (option C), which pluralise correctly in both
  languages by construction.

### Parity

The existing parity spec flattens nested objects, so a six-category Arabic object
beside a two-category English one would read as four missing English keys. Parity
therefore compares **non-plural keys flat, and plural keys as units** (same key
paths in both files), with category completeness checked by condition (b).

---

## 4. Date and time formats

**One format per meaning.** Call sites name the meaning, never an Angular format
string.

| Meaning | English | Arabic | Built from |
| -- | -- | -- | -- |
| `date` | **15 Sep 2026** | **15 سبتمبر 2026** | `formatToParts`, assembled day → month → year |
| `dateTime` | **15 Sep 2026, 14:05** | **15 سبتمبر 2026، 14:05** | the same, plus `hour: '2-digit', minute: '2-digit', hourCycle: 'h23'` |
| `relative` (how long ago) | **3 days ago** / just now / 5 min ago | **قبل 3 أيام** / الآن / قبل 5 دقائق | `Intl.RelativeTimeFormat`, `numeric: 'always'` |
| `duration` (how long something has been open) | **7 days** (inside "Open {{duration}}") | **7 أيام** (inside "قائمة منذ {{duration}}") | `Intl.NumberFormat` style `unit`, `unitDisplay: 'long'` |

Every format uses Latin digits and the tenant's time zone, and follows the
user's calendar preference (§5).

### Why these exact shapes

* **Month as a word, never a numeric month/day order.** "9/15/26" is read as
  9 October by a GCC reader, and "15/09/2026" is misread in the other direction by
  anyone American. A month name is unambiguous to both.
* **English is assembled rather than taken from a locale default.** `en-GB` now
  writes **"15 Sept 2026"** (CLDR 38+, verified), and `en` writes "Sep 15, 2026"
  (US order). Taking the month name from `en` and ordering the parts ourselves
  gives "15 Sep 2026" and is stable across ICU updates.
* **D5 — 24-hour.** 12-hour needs AM/PM in English and ص/م in Arabic, which is two
  more strings to misread across a language switch. The Working Calendar already
  edits hours in 24-hour (`hourFormat="24"`), and a compliance record ("approved
  at 14:05") reads better without a suffix.
* **Year always shown in `date`.** Committee records and audit history span years.
  The one place that omits it today (the Committee record's task due summary)
  would show the year too; its row width was checked visually in ACC-76 and must
  be re-checked.

### Absolute or relative — the rule

* **Absolute** for anything a person acts on or cites: due dates, effective
  dates, closure dates, last sign-in, created dates.
* **Relative or duration** only for recency and age *summaries* (Setup health
  ages, "checked 5 min ago", time in stage), **always with the absolute value
  reachable** (a tooltip), as Setup health already does for `openedAt`.
* Relative thresholds keep today's Setup health behaviour, now in one place:
  under 1 minute "just now"; under 60 minutes, minutes; under 48 hours, hours;
  otherwise days.

### The empty value — owned by the layer (addition 2)

* **A missing value renders as "—"** (U+2014 em dash), in both languages. This is
  already the app's convention: 41 uses, and the one `'-'` found is slug
  generation, not display. The layer makes it the only one.
* "Missing" means `null`, `undefined` or an empty string. **An unparseable value
  also renders "—"**, never the raw string: showing whatever the API sent is the
  defect behind the three raw-date sites (§7c). The layer's spec covers both
  cases.
* Components stop writing `x ? (x | date) : '—'`. They pass the value, possibly
  null, straight to the layer.
* Where "—" would be misleading, the component keeps its own wording through a
  translation key, and the layer is not asked. For example, a task with no due
  date could read "No due date"; that is a sentence, not a formatting fallback.

### Overdue and elapsed time — no more "0 days" (addition 3)

* **Elapsed time uses the same thresholds everywhere,** as a duration: under
  1 minute "less than a minute"; under 60 minutes, minutes; under 48 hours,
  hours; otherwise whole days.
* So a task 5 hours late reads **"Overdue 5 hours"** / **"متأخرة منذ 5 ساعات"**,
  never "overdue 0d". `task.overdueBy` becomes a sentence around the layer's
  duration ("Overdue {{duration}}"), and the compact "6d" form goes: Arabic has no
  plural-correct abbreviation, and both languages should read the same.
* **Cost:** "Overdue 6 days" is wider than "overdue 6d" in the Committee record's
  task summary row. It is re-checked in the browser in both languages, since that
  row's width was a deliberate choice in ACC-76.
* "In stage N days" (the stage indicator) uses the same duration, which also
  settles the comment-versus-code disagreement in §7d: **elapsed 24-hour periods,
  not calendar days.** Calendar days would depend on the time zone for no reader
  benefit, and the SLA engine counts working time rather than calendar days anyway.

### Instants versus calendar dates

Every date column in the schema is a `DateTime` instant (checked: no `@db.Date`
anywhere), including values that mean a *calendar day* (public holiday dates,
effective dates chosen with a date picker). Displaying those in the tenant's time
zone is correct as long as they were stored from a picker running in that time
zone. **How a picker converts a picked day into an instant is input semantics,
which this ticket does not change** (§6). It is recorded as a follow-up.

---

## 5. Hijri

### Findings (report before deciding, as asked)

* **`Intl.DateTimeFormat` with `calendar: 'islamic-umalqura'` works in Chrome 152
  and Node 22:** "5 Rabiʻ II 1448 AH" and "5 ربيع الآخر 1448 هـ", with
  `resolvedOptions().calendar === 'islamic-umalqura'` and
  `Intl.supportedValuesOf('calendar')` including it.
* **Accuracy spot check:** 18 Feb 2026 → **1 Ramadan 1447 AH**, matching the Umm
  al-Qura calendar. One reference date is a spot check, not a validation;
  implementation should compare a year of month starts against the official Umm
  al-Qura table before calling it verified.
* **Latin digits and the tenant time zone apply unchanged** (`-u-ca-islamic-umalqura-nu-latn`, `timeZone`).
* **`moment-hijri` (and `moment`) are declared in `frontend/package.json` but
  imported nowhere, so they are not in the bundle** (checked against the last
  production build: no match in `dist/`). **Dropping them removes a dependency
  but saves 0 kB, so it does not help ACC-90.** Recommendation: drop them anyway;
  an unused date library invites the next person to use it.
* **The preference is unreachable.** `User.hijriDisplay` is read and written by
  nothing (§1 D2), and there is no toggle on the profile page.

### Recommendation

* Hijri support lives inside the same layer: a `calendar` input, driven by the
  exposed `hijriDisplay` (D2), with no separate pipe and no library.
* **D4 (approved) — what the user sees:** for `date` and `dateTime`, **Hijri
  first, Gregorian in brackets**: "5 Rabiʻ II 1448 AH (16 Sep 2026)". `relative` and
  `duration` are calendar-free and unchanged.
* **Display only, and the boundary is explicit:**
  * **Gregorian always:** date picker inputs and their displayed value (a person
    picks or types a Gregorian date), anything sent to or received from the API,
    stored values, anything machine-readable (a `datetime` attribute, a query
    parameter, a future export).
  * **Hijri-first when the preference is on:** text a person reads — table cells,
    record panels, notification timestamps, Setup health dates.
  * The layer enforces this by construction: pickers never go through the
    display formats, and the only functions that emit Hijri are the display ones.
* **The profile toggle that sets the preference is out of scope** (it writes a
  stored value). Until it exists, every user is Gregorian and the Hijri path is
  exercised only by tests. That is said plainly in the PR, not implied done.

---

## 6. Scope

**In scope — display only:** how existing values are rendered, in both languages,
everywhere in the inventory (§7).

**No stored value changes. No migrations. No reshaping of existing API fields.**

**One approved addition (D2):** two additive, read-only fields on `GET /auth/me`.

**Date pickers (approved, addition 1):** their **display** is in scope — the input's
shown format ("15 Sep 2026", not `mm/dd/yy`), and month and day names in the popup
per UI language (§7h). Their value stays Gregorian (D4).

**Out of scope — opened as Backlog tickets on 2026-09-15:**

| Item | Why out | Ticket |
| -- | -- | -- |
| Server-built notification and email text: 21 `bodyEn`/`bodyAr` template literals, at least one interpolating a count (`${reassignedCount} task(s)`), several with no `bodyAr`. Relative wording like "due in 2 days" would disagree with an SLA counted in **working** days — the same screen-versus-engine trap as D3 | Stored text; needs its own decision on relative versus absolute wording | **ACC-95** |
| How a picked day becomes a stored instant (browser time zone at the day boundary; a Dubai admin's holiday lands a day early in a Riyadh calendar) | Changes what is stored | **ACC-96** |
| `Organization.timezone` vs `WorkingCalendar.timezone` (and `getOrCreate()` seeding from `GCC_DEFAULT`, not the organisation's field) | Stored-field decision; D3 settles only which one is read | **ACC-97** |
| No screen or endpoint sets `User.hijriDisplay` | Writes a stored value | **ACC-98** |

---

## 7. Inventory

A component missed now stays wrong, so this is everything the survey found,
including sites outside the ticket's original list of 10 components.

### 7a. `| date` pipe — 12 call sites in 10 components (all move to the layer)

| File:line | Field | Format today | Meaning |
| -- | -- | -- | -- |
| `committees/…/committee-detail.component.ts:451` | membership `effectiveDate` | `dd MMM y` | `date` |
| `home/home.component.ts:72` | task `dueAt` | `mediumDate` | `date` (or `dateTime` if a time is meaningful; SLA due dates carry one) |
| `home/home.component.ts:108` | notification `createdAt` | `short` | `dateTime` |
| `notification/…/notification-bell.component.ts:68` | notification `createdAt` | `short` | `dateTime` |
| `setup-health/…/setup-health-page.component.ts:209` | condition `openedAt` (tooltip) | `medium` | `dateTime` |
| `setup-health/…/setup-health-page.component.ts:262` | condition `clearedAt` | `medium` | `dateTime` |
| `tasks/…/my-tasks.component.ts:59` | task `dueAt` | `short` | `dateTime` |
| `tasks/…/task-list.component.ts:79` | task `dueAt` | `short` | `dateTime` |
| `tasks/…/unassigned-tasks.component.ts:62` | task `createdAt` | `short` | `dateTime` |
| `user/…/user-list.component.ts:215` | user `lastLoginAt` | `short` | `dateTime` |
| `workflow/…/workflow-stage-indicator.component.ts:130` | visit `enteredAt` | `dd MMM y` | `date` |
| `platform/…/tenant-detail.component.ts:62` | tenant `createdAt` | `mediumDate` | `date` |

The due date appears in three views with two different formats (`mediumDate` on
Home, `short` in task lists). One meaning is chosen for all three.

### 7b. Hand-written `toLocaleDateString` — 3 sites (not in the ticket's list)

| File:line | Shows | Today |
| -- | -- | -- |
| `committee-detail.component.ts:605` | task due summary | `'ar'` / `'en-GB'`, day and month only → "16 Sept", no year |
| `user-profile.component.ts:436` | `actingOrgUnitUntil` | `'ar'` / `'en-GB'` → "16 Sept 2026" |
| `workflow-stage-indicator.component.ts:237` | first entry into a stage | `'ar'` / `'en-GB'` → "16 Sept 2026" |

All three use the browser time zone and bare `'ar'` (Latin by luck, §2).

### 7c. Dates rendered raw, with no formatting — 3 sites (not in the ticket's list)

| File:line | Field | Renders |
| -- | -- | -- |
| `working-calendar/…/public-holiday-list.component.ts:74` | `holiday.date` | the raw API string |
| `working-calendar/…/calendar-config.component.ts:230` | AI-suggested holiday `s.date` | the raw string, plus a hard-coded English " · Recurring" |
| `organization/…/org-unit-head-panel.component.ts:55` | `headHandoverEffectiveDate` | the raw API string |

### 7d. Hand-rolled elapsed-time arithmetic — 4 sites (moved into the layer)

| File:line | Computes | Note |
| -- | -- | -- |
| `committee-detail.component.ts:602` | days overdue, `floor(ms / 86_400_000)` | shows **"overdue 0d"** for a task less than 24 hours late |
| `workflow-stage-indicator.component.ts:212` | days in stage | its comment says "calendar days"; the code counts 24-hour periods — the layer settles which |
| `setup-health-page.component.ts:509` | condition age in days | the English-shaped branch behind defect 1 |
| `setup-health-page.component.ts:530` | relative "checked" time | thresholds move into the layer unchanged |

`committee-detail.component.ts:593`'s `isOverdue` compares instants and is correct
in any time zone; it stays.

### 7e. Translation keys carrying a number — 19 (the ticket said 14; it counted only `{{count}}`)

| Key | Call site | English today | Arabic today |
| -- | -- | -- | -- |
| `roles.permissionCount` | `role-list.component.ts:155` | "**1 permissions**" | "{{count}} صلاحية" — one form for all |
| `workflow.stageIndicator.inStageDays` | `workflow-stage-indicator.component.ts:216` | "in stage **1 days**" | "يوماً" — one form |
| `workflow.stageIndicator.revisited` | `workflow-stage-indicator.component.ts:233` | "revisited ×N" — no noun, fine | fine |
| `committee.quorumOf` | `committee-detail.component.ts:574` | "{{quorum}} of {{total}} members" | "عضواً" — one form |
| `committee.memberCount` | `committee-detail.component.ts:700` | "**1 members**" | "أعضاء" — one form |
| `task.overdueCount` | `committee-detail.component.ts:586` | "{{count}} overdue" | "متأخرة" — needs agreement forms |
| `task.overdueBy` | `committee-detail.component.ts:603` | "overdue {{days}}d" | "متأخرة {{days}} يوم" — one form |
| `task.assigneeCount` | `committee-detail.component.ts:618` | "{{count}} assignees" | one form |
| `user.deactivateSummary` | `user-list.component.ts:523` | "**task(s)**" twice | "مهمة" — one form |
| `list.panelRange` | `data-list.component.ts:592` | "{{first}}–{{last}} of {{total}}" — no noun | fine; numbers only |
| `shell.badge.setupHealth` | `sidebar.component.ts:126, 282` | "**1 open conditions**" (seen live) | "حالة قائمة" — one form |
| `setupHealth.consequence.stageMany` (+ `stageOne`) | `setup-health-page.component.ts:502` | English one/other branch | "عناصر" — one form |
| `setupHealth.age.openDays` (+ `openOneDay`, `openToday`) | `setup-health-page.component.ts:512` | branch | "**يومًا**" for every count ≥ 2 — **defect 1** |
| `setupHealth.age.detectedDays` (+ `detectedOneDay`, `detectedToday`) | same | branch | same |
| `setupHealth.relative.minutes` | `setup-health-page.component.ts:532` | "{{count}} min ago" | "دقيقة" — one form |
| `setupHealth.relative.hours` | `…:534` | "{{count}} h ago" | "ساعة" — one form |
| `setupHealth.relative.days` | `…:535` | "{{count}} days ago" | "يومًا" — one form |
| `workflow.stageCount` | **no call site** | — | — |
| `notification.unreadCount` | **no call site** | — | — |

The last two are dead keys: removed in this ticket, since the enforcement spec
would otherwise demand plural forms for text nobody sees. The five `…One…` and
`…Today` sibling keys exist only to feed English-shaped branches; each is either
folded into a plural object or kept where it is genuinely different wording
("Opened in the last 24 hours" is a sentence, not a count).

### 7f. Translation keys carrying a date or time — 5

`workflow.stageIndicator.since` (`date`), `setupHealth.checked` (`when`),
`setupHealth.freshness.failed` and `.overdue` (`when`), `setupHealth.cleared.at`
(`date`). Their placeholders receive layer output instead of pipe output.

### 7g. Literal digits in translations

* **Arabic-Indic, to fix:** `setupHealth.cleared.window`, `cleared.none`, `cleared.note` ("٧" → "7").
* Latin, legitimate prose (kept, and allowed by the §2 spec, which rejects only
  Arabic-Indic digits): `orgPosition.gradeHint` ("1 = lowest, 10 = highest", both
  files), `setupHealth.age.openToday` / `detectedToday` ("24 hours", both files),
  `setupHealth.age.openOneDay` / `detectedOneDay` and `consequence.stageOne` (en
  only; these fold into plural objects per 7e).

### 7h. Date inputs — PrimeNG `p-datepicker`, 7 fields in 5 components

`org-unit-head-panel` (effectiveDate), `task-form` (dueDate, with time),
`user-profile` (actingOrgUnitUntil, outOfOfficeFrom, outOfOfficeTo),
`calendar-config` (two working-hours time pickers), `public-holiday-form` (date,
`dateFormat="yy-mm-dd"`).

Verified in `primeng-config.mjs`: **no PrimeNG translation is configured
anywhere**, so the default applies — **input display `mm/dd/yy`** (US, the same
ambiguity as defect 3) and English month and day names in an Arabic session.
**Proposed in scope, display only:** set PrimeNG's translation per UI language
(month and day names, `dateFormat: 'dd M yy'` → "15 Sep 2026", `firstDayOfWeek: 0`
since the GCC week starts on Sunday). Input *semantics* stay out (§6).

### 7i. Also found, adjacent

* `calendar-config.component.ts:230` — hard-coded English " · Recurring" (already
  listed under CLAUDE.md's workstream-5 display defects, fixed here since the line
  is touched).
* PrimeNG paginator `list.range` in `data-list.component.ts:351` substitutes numbers
  itself (Latin); it stays.

---

## 8. Tests

### Three that fail against current code, one per defect

Each is written first, run and **seen failing** against `dev` at `fc8adcb` before
any fix, with the failure output recorded in the PR.

1. **Arabic plural** — `setup-health-page.component.spec.ts`, using the real
   `ar.json` rather than the existing hand-written English stub. A condition opened
   7 days before `loadedAt`, in Arabic, renders **"قائمة منذ 7 أيام"**, and the same
   spec covers 2 → "يومين" and 11 → "11 يومًا". **Fails today:** renders "قائمة منذ 7
   يومًا".
2. **Digits** — `translation-keys.spec.ts`: no value in `ar.json` or `en.json`
   contains U+0660–U+0669 or U+06F0–U+06F9. **Fails today** on the three
   `setupHealth.cleared.*` keys. A second assertion runs the layer's `date` format
   with locale `ar-SA` (the region whose default is Arabic-Indic) and requires Latin
   digits. Today nothing enforces this, which is the gap.
3. **Date format and time zone** — `my-tasks.component.spec.ts`: a task due at
   `2026-09-15T21:30:00Z`, with the tenant time zone set to `America/New_York`,
   renders **"15 Sep 2026, 17:30"**. With `Asia/Riyadh` it renders "16 Sep 2026,
   00:30". **Fails today** on both halves: renders US format ("9/16/26, 12:30 AM" on
   this machine) and ignores the tenant time zone entirely. New York was chosen
   because it differs from **both** this machine (Riyadh) and CI (UTC), so the test
   cannot pass by coincidence on either.

### The layer's own specs

`date`, `dateTime`, `relative` and `duration` in both languages; the Hijri calendar
(including the 1 Ramadan 1447 reference and a month-boundary case); a
day-boundary instant in two time zones; the plural fallback to `other`; and the
relative-time thresholds.

### Controls (specs that guard the rule, not a feature)

* No Arabic-Indic digits in either JSON file (test 2).
* Every numeric placeholder sits inside a plural object, and Arabic plural objects
  define all six categories (§3).
* The build-time source scan (§2) runs in CI and is **proven to fail** by adding a
  `| date` to a scratch copy of one component before relying on it.

---

## 9. The rule, as it would go into CLAUDE.md

Required pattern, the same status as `EditDialogComponent`:

* Display a date only through the layer, by meaning (`date`, `dateTime`,
  `relative`, `duration`). Never `| date`, `DatePipe`, `toLocale*String` or `new
  Intl.*` in a component.
* Digits are Latin in both languages. No digit literal in a translation where a
  formatted number belongs, and never an Arabic-Indic one.
* A translation that carries a count is a plural object. Never branch on the count
  in a component.
* The time zone is the tenant's (§1). The calendar is the user's. The language is
  the UI's. None of them is the browser's.

SYSTEM-REFERENCE §9 gains a subsection for the layer (§9.6), and §9.4 ("parity is
static only") is updated, since the new specs add real controls.

---

## 10. Proposed commit sequence

**PROPOSED — awaiting Ahmad's approval. No code until then.**

Rules for every commit: one concern; backend and frontend type checks, `ng build`
and **both full test suites** after each (not "obviously unaffected"); CI green at
every commit. No test is committed red. Each of the three defect tests from §8 is
first run against the unmodified code, its failure output saved for the PR, then
committed with the fix that turns it green.

| # | Commit | Contents | Proves |
| -- | -- | -- | -- |
| 1 | `docs(plans)`: approved plan for the formatting layer | this file | — |
| 2 | `feat(working-calendar)`: resolve the effective time zone without creating a calendar | `getEffectiveTimeZone(organizationId)`: read-only, same default as `getOrCreate()`. Unit tests: row present, row absent (and **no row is created**), and a tenant-isolation test under the gate's exact name | D3 |
| 3 | `feat(auth)`: return `timeZone` and `hijriDisplay` from `GET /auth/me` | `AuthModule` imports `WorkingCalendarModule` (checked: no cycle — only `app.module.ts` imports `AuthModule`); controller + spec; frontend `MeResponse` type | D2 |
| 4 | `feat(i18n)`: add the display formatting layer | `core/formatting/`: a `FormatContext` (language from `TranslateService`, time zone and calendar from the signed-in user, defaults `Asia/Riyadh` and Gregorian); `FormatService` with `date`, `dateTime`, `relative`, `duration` and `number`; the empty-value rule; elapsed-time thresholds; Hijri (D4); standalone pipes `amDate`, `amDateTime`, `amRelative`, `amDuration`. Own specs, including Latin digits under `ar-SA`, a day-boundary instant in two time zones, 1 Ramadan 1447, and Umm al-Qura month starts against the official table | §2, §4, §5 |
| 5 | `feat(i18n)`: keep counted strings out of the translate pipe | the splitting loader, `PluralCatalog`, `FormatService.count`, the `amCount` pipe, the `PluralKey` type. Specs: a `plural.*` key through `translate` resolves to nothing; category selection for 0/1/2/3/11/100 | D1 (a) |
| 6 | `fix(i18n)`: give every counted string its plural forms | move the §7e keys under `plural` with six Arabic and two English categories; remove the 2 dead keys; point each call site at `amCount`/`count`; extend `translation-keys.spec.ts` (categories, the counted-placeholder rule, plural-aware parity) | D1 (b) |
| 7 | `fix(i18n)`: use Latin digits in every translation | the three "٧" strings → "7"; spec rejecting Arabic-Indic digits. **Defect test 2 lands here** | defect 2 |
| 8 | `refactor(ui)`: format Setup health through the layer | ages via `duration`, "checked" via `relative`, `clearedAt` / `openedAt` via `dateTime`; the English-shaped branch removed. **Defect test 1 lands here** | defect 1 |
| 9 | `refactor(ui)`: format task, home and notification dates through the layer | my-tasks, task-list, unassigned-tasks, home, notification bell; `dueAt` as `dateTime` everywhere. **Defect test 3 lands here** (my-tasks, tenant time zone `America/New_York`) | defect 3 |
| 10 | `refactor(ui)`: format committee and workflow dates through the layer | committee record (due summary, overdue via `duration` — "overdue 0d" fixed, with a spec for a 5-hour-late task — membership dates, member and quorum counts), workflow stage indicator (dates, time in stage) | addition 3 |
| 11 | `refactor(ui)`: format the remaining dates and counts through the layer | user list and profile, platform tenant detail, public holiday list and AI suggestions (raw strings), org unit head panel (raw string), role list, sidebar badge, data list | §7b–7e |
| 12 | `feat(ui)`: show date pickers in the UI language | PrimeNG translation per language (month and day names, `dateFormat` giving "15 Sep 2026", first day Sunday), switched with the language; value stays Gregorian | addition 1 |
| 13 | `chore(ci)`: fail the build on date formatting outside the layer | Node scan script plus a CI step in the frontend job, **shown failing** against a scratch `\| date` before relying on it; remove the unused `moment` and `moment-hijri` (`npm uninstall`, lockfile diff checked to remove only those, `npm ci` in CI confirms) | §2 |
| 14 | `docs`: record the formatting rule and the authoritative time-zone field | CLAUDE.md required pattern (§9); SYSTEM-REFERENCE §9.6 (the layer), §9.4 (parity now has real controls), and the D3 note that `WorkingCalendar.timezone` is authoritative and `Organization.timezone` is read by nothing that computes a date | D3 record |

Verification before PR: `ng build` with the initial bundle compared against ACC-90's
813 kB baseline and the delta reported; both full suites; and a screenshotted
browser pass in English and Arabic on Setup health, My tasks, Home, the Committee
record, the notification bell, a date picker, and one session whose tenant time
zone differs from the browser's.

---

## 11. Smaller questions — how the plan settles them

1. **Due dates show their time.** `dateTime` wherever `dueAt` appears. SLA due
   dates carry a working-hours time, and one rule for both kinds of due date is
   simpler than guessing which one a reader is looking at.
2. **Platform screens use the signed-in session's time zone** (the platform org's
   effective time zone). The earlier recommendation, "the tenant being viewed",
   would need that tenant's calendar time zone in the platform API, which is a
   change beyond D2 for one field (tenant created date). **Flagged for Ahmad:**
   reverse it if the viewed tenant's zone matters there.
3. **A tenant-level Hijri default** belongs to ACC-98, which owns the preference.
