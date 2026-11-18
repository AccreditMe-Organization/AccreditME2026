---
name: angular-component
description: Angular component structure and styling rules for AccreditMe. Invoke manually with /angular-component when creating any new Angular component, page, or service.
disable-model-invocation: true
allowed-tools: Read Glob Grep Write Edit Bash(npx tsc --noEmit *) Bash(npx ng build) Bash(npx ng test *) Bash(npm run check:*) Bash(git add frontend/src/*) Bash(git add frontend/src/assets/*) Bash(git commit *) Bash(git status *)
---

# AccreditMe — Angular Component Rules

Read this before writing any Angular component, page or service. Each rule names
the file that implements it: **read that file for the API**, it is not copied
here. A rule a scan enforces says so; the scan fails CI.

Paths are under `frontend/src/app/` unless they start with `frontend/`.

---

## Where things live

```
core/        app-wide services, guards, interceptors, formatting/, http/, theme/,
             navigation/ (nav-items.ts — the rail, guard, breadcrumb and title)
shared/      components/ (am-*, app-*), directives, pipes, utils
layout/      app-shell, sidebar (the rail), topbar, breadcrumb
foundation/  one folder per module (committees/, tasks/, workflow/, …)
platform/    the platform admin portal
```

A new module's screens go in `foundation/{module}/`: a `{module}.service.ts`,
`interfaces/`, and `components/{name}/{name}.component.ts` (+ `.html`). Look at
`foundation/committees/` as the model. A new page gets a nav item in
`core/navigation/nav-items.ts`, never a second label list (route `data`, a card
array).

---

## Component basics

- **Standalone**, `inject()` for dependencies, `input()` / `output()` /
  `signal()` / `computed()` — no `@Input`, no `EventEmitter`, no mutable state
  fields.
- **Built-in control flow only**: `@if` / `@for (…; track …)` / `@switch`. Never
  `*ngIf`, `*ngFor` or `CommonModule` for them.
- **Import `TranslatePipe` from `@ngx-translate/core` per component**, and only
  the PrimeNG / shared components the template uses. Never `TranslateModule`
  (no component imports it).
- **Reactive Forms** only. Never send `organizationId`; the server takes it
  from the session.
- **HTTP goes through the module's service**, never `HttpClient` in a component.
- **A request has loading, error and empty states**: see
  `core/request-outcome/request-outcome.ts`. An empty message never shows while
  loading.

---

## Dialogs — `app-edit-dialog`

`shared/components/edit-dialog/edit-dialog.component.ts` — REQUIRED for every
create/edit dialog. Content goes in through a `TemplateRef` (`[content]`),
which is what recreates the form on every open.

- **The body is capped at 420px.** Never raise the cap. Measure the body in
  BOTH languages, with the fields wrapped and the actions in the footer.
- **If it overflows, compact first:** `density="compact"`, actions in the
  footer, two short related fields on one row.
  `check:dialog-density` requires compact density for five or more field
  blocks.
- **Step only for an overflow you measured** and could not compact away, on a
  seam the form already has (`am-step-strip`, e.g.
  `foundation/tasks/components/task-form/task-form-steps.component.ts`).
  Groups filled in any order under one Save are tabs (`am-tab-strip`, e.g.
  `foundation/committees/components/committee-form/committee-form.component.ts`).
- **A panel too tall for the body opens as its own layer**, never inline.
- **Save is never disabled for an invalid form.** Pressing it reveals every
  error and moves focus to the first one. `committee-form.component.ts` states
  the rule (artboard 14, rule 5.2), and `shared/components/field/reveal-errors.ts`
  is the helper for a step's Next.
- **A warning returned by a save keeps the dialog open until dismissed**, and
  nothing it triggers may refresh a parent that destroys it (CLAUDE.md,
  ACC-55).
- **Confirmations go through `AmConfirmService.ask()`**
  (`shared/components/confirm/am-confirm.service.ts`), with translated words.
  Enforced by `check:confirm-through-helper` and `check:confirm-translated`.
- **A list in a popup is `am-list-dialog`**
  (`shared/components/list-dialog/`), exempt from the cap. Plain lists use
  `size="compact"` with `am-simple-list` inside.

---

## Fields

- **Every form field is wrapped in `am-field` with `[control]`**
  (`shared/components/field/field.component.ts`). Without `[control]` it can't
  show an error. Enforced by `check:field-control`.
- **Any choice with 5 or more options is `app-overlay-select`**
  (`shared/components/overlay-select/overlay-select.component.ts`), never
  `p-select` or `p-cascadeSelect`.
  - Hierarchies use `optionGroupLabel` / `optionGroupChildren`.
  - Set `[groupsSelectable]="false"` when the groups are categories, not
    choices.
  - Raw PrimeNG overlays inside a dialog are caught by `check:dialog-overlays`.
- **Inline multi-select is `p-listbox`**, never `p-multiselect`.
- **Icon-only buttons are `am-icon-button`** with its required `label`. Enforced
  by `check:icon-labels`.

---

## Dates, numbers and counted strings

Only through `core/formatting/`, by meaning. Enforced by `check:formatting`.

- **In templates:** the `amDate`, `amDateTime`, `amRelative`, `amDuration`,
  `amNumber`, `amCount` and `amMoney` pipes (`format.pipes.ts`).
- **In TypeScript:** `FormatService` (`format.service.ts`).
- **Never** `| date`, `DatePipe`, `toLocale*String`, `new Intl.*`, Angular's
  number pipes, or a unit typed onto a number (`n + 'h'`).
- **Counted strings** are plural objects in the i18n files' `plural` section,
  with every category: six for Arabic, two for English.
- **`p-inputNumber` and `p-paginator`** need `InputNumberLatinDigits` /
  `PaginatorLatinDigits` (`core/formatting/latin-digits.ts`) imported in that
  component; the scan fails a file without them.

---

## Language and Arabic

- **Every visible string is a translation key**, in BOTH
  `frontend/src/assets/i18n/en.json` and `ar.json`, with real Arabic.
- **A record's name is shown with `LanguageService.bilingual(en, ar)`**
  (`core/services/language.service.ts`). Never `isArabic() ? ar : en`, which
  goes blank when the Arabic is null. A dropdown gets a resolved `label` built
  in a `computed()`, never `optionLabel="nameAr"`.
- **Arabic fields are never required.** The server stores an empty one as null
  (`@Transform(trimToNull)`); never validate one as required.
- **Arabic copy addresses the reader in the singular** and uses no gendered
  verb about a person. Use a noun phrase, e.g. «مقدَّم من {{name}}»; see
  `foundation/home/home-arabic.spec.ts`.
- **Tenant data is never translated.** Labels and names stored on records are
  shown as stored, never `| translate`.
- **A workflow enum is shown in words**, through its label helper. Enforced by
  `check:workflow-enum-display`.

---

## Styling

- **Tokens only.** Colour, size, space and radius come from
  `frontend/src/styles/design-tokens.scss` (Tailwind reads the same set through
  `tailwind-theme.scss`). Never a literal colour, px size or radius in a
  component, and never `--am-text-secondary` (retired; use `--am-ink-500`).
  - `check:contrast` checks the token pairs.
  - `check:retired-ink` keeps the retired ink out of `shared/` and `layout/`.
- **Tailwind for layout**, logical properties for RTL (`ps-`, `pe-`, `ms-`,
  `me-`, `text-start`). No inline `style=""`, no Bootstrap.
- **A new PrimeNG component** must be added to the theme
  (`core/theme/accreditme-preset.ts`). Enforced by `check:theme-components`.

---

## Lists and record pages

- **Page lists are `app-data-list`** (`shared/components/data-list/`).
- **Sorting is a column header**, `am-sort-header`
  (`shared/components/sort-header/sort-header.component.ts`, with `nextSort()`
  as the one press rule).
  - Never a toolbar sort dropdown; the exception is phone cards, which have no
    headers.
  - A column the server can't sort by stays plain text.
- **Column tracks are fixed or `fr`**, never `auto`, `min-content` or
  `max-content` (`gridSuffix` in `data-list.component.ts`).
  - Cells take `min-inline-size: 0`.
  - Long text gets an ellipsis, with the full text in a tooltip.
- **Record page panels are `am-capped-panel`**
  (`shared/components/capped-panel/`): five rows, a fixed height, and "See
  all" opening an `am-list-dialog`.
  - Row actions are `am-row-menu`.
  - Example: `foundation/committees/components/committee-members-panel/`.
- **Page title and actions are `app-page-header`.** A create action in it sits
  behind a permission gate (`check:create-gating`), and so does every write
  control (`check:action-gating`).

---

## The server decides; the screen renders

- **No screen keeps a copy of a server rule.** Render the flags the response
  carries: `actions`, `memberActions`, `stageRules`, a `/moves` list,
  `recordRoutes`. Never re-derive them from permission strings, a stage key or
  a stage name. Example: `foundation/committees/committee-offers.ts`.
- **A refusal is said from its CODE, never the server's English `message`.**
  - Read the code with `refusalCode()` / `refusalBody()` (`core/http/refusal.ts`).
  - Map it in a `*-refusal.ts` beside the module. Examples:
    `foundation/workflow/workflow-refusal.ts`,
    `foundation/committees/committee-stage-refusal.ts`,
    `foundation/organization/root-unit-refusal.ts`, `core/ai/ai-refusal.ts`.
  - Show it under the field it concerns, naming the numbers and the way out.

---

## Verify before committing

From `frontend/`:

```bash
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.spec.json
npx ng build                                  # the only check of templates
npx ng test --watch=false --browsers=ChromeHeadless
```

Then run every `check:*` script, **discovered from `package.json`, never
listed by hand**, and report each by name with its exit status:

```bash
for s in $(node -e "const s=require('./package.json').scripts;console.log(Object.keys(s).filter(k=>k.startsWith('check:')).join(' '))"); do
  npm run "$s" >/dev/null 2>&1; echo "$s exit=$?"
done
```

`tsc` never type-checks a template, and `ng test` compiles only what a spec
imports, so `ng build` is required (ACC-72). Gate each command on its own exit
status; never pipe it through `grep` or `head`.
