# Step 15 — Design Foundation
# ACC-15: spacing/typography/component design foundation across the
# navigation shell, Super Admin Portal, and Tenant Admin Settings —
# a pure styling/consistency pass, no new pages, routes, or functionality
# (see CLAUDE.md's Build Sequence (Revised), "Design Foundation (Next)")

---

## HEALTH CHECK — Run Before Starting

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AccreditMe Health Check — 2026-07-30
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ERRORS:  None ✅
ERRORS:           None ✅
WARNINGS:         None ✅

DETAILED RESULTS

Check 1  Git State              PASS — on feature/ACC-15-design-foundation, clean
Check 2  Branch vs dev          INFO — fast-forwarded to dev at d1c3cd4, 0 drift
Check 3  Backend TypeScript     PASS — npx tsc --noEmit → zero errors
Check 4  Frontend TypeScript    PASS — npx tsc --noEmit → zero errors

OVERALL STATUS: 🟢 HEALTHY — ready to start ACC-15
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

ACC-13 shipped the navigation shell, Super Admin Portal, and Tenant Admin
Settings hub with PrimeNG's Aura preset and brand colors applied
(`AccreditMePreset`, `--am-*` variables), but every screen styles itself ad
hoc — component-by-component Tailwind utility choices with no shared scale
or shared presentational components. This step is a **pure styling/
consistency pass** over screens that already exist:

1. A real spacing/sizing scale — not invented from scratch, but *codified*
   from what's already mostly used by accident (see Finding B below).
2. A typography scale using Inter — headings, body, labels, weights.
3. Shared presentational components for status/severity badges, cards, and
   a documented table convention — replacing several different ad hoc
   patterns for the same visual idea found scattered across existing code.
4. Applying all of the above across the navigation shell, Super Admin
   Portal, and every existing Tenant Admin Settings screen (Section 4 lists
   every file).

No new pages, routes, or backend changes. No illustrations or brand
personality — that remains a separate future ticket (see Section 6,
Non-Goals).

### Three Things Found During Research That Change This Plan's Shape

**(A) Tailwind CSS is a declared dependency but is not wired into the build
at all — confirmed, not suspected.** `frontend/package.json` lists
`"tailwindcss": "^4.3.2"`, and dozens of existing components use Tailwind
utility classes extensively (`flex`, `gap-4`, `p-4`, `rounded-md`,
`grid-cols-3`, arbitrary-value `bg-[var(--am-card)]`, etc. — every
component read during this research uses this style). But there is no
`@import "tailwindcss"` or legacy `@tailwind` directive anywhere in
`styles.scss` or any other stylesheet, no PostCSS config file anywhere in
`frontend/`, and no `@tailwindcss/postcss` (or any Tailwind build-tool
package) in `package.json` — only the bare `tailwindcss` package itself is
installed. A real `ng build` was run and its compiled
`dist/frontend/browser/styles-*.css` was grepped directly: **zero** `.flex`,
`.gap-4`, or any other Tailwind utility rule exists in the output (14KB
total — just `styles.scss`'s own hand-written rules and `primeicons.css`).
**Every Tailwind class used anywhere in this app today is currently inert.**
This is more foundational than this ticket's own nominal scope (it affects
every existing component, not just the three screen groups named above),
but it has to be fixed before anything else in this plan means anything —
a spacing *scale* is meaningless if the utility classes expressing it don't
compile. Recommended as this ticket's Commit 1 (Section 4) — flagged as
Pending Discussion #1 (Section 8) since the exact correct integration step
for Angular 21's esbuild-based builder + Tailwind v4.3 is worth confirming
before landing, not guessed at.

**(B) Inter is declared as the font-family but never actually loads.**
`styles.scss` sets `font-family: 'Inter', sans-serif;` globally, and
CLAUDE.md's Tech Stack lists "Typography: Inter (Google Fonts)" — but
`frontend/src/index.html` has no `<link>` to Google Fonts (or any font
source) at all. Every page in this app has been silently falling back to
the browser's default system sans-serif this entire time. Needs a Google
Fonts `<link>` (or self-hosted `@font-face`) added — bundled into Commit 1
alongside the Tailwind fix, since both are "the foundation doesn't actually
work yet" issues rather than new design decisions.

**(C) The `--am-status-*`/`--am-severity-*` tokens are worse than merely
"unused" — the one place a severity-like token IS used, it's used
wrong.** `topbar.component.ts`'s impersonation banner hardcodes
`bg-[var(--am-severity-medium)]` for what is a permanent, always-the-same
informational banner — not a severity indicator at all, since there's
nothing variable being rated. Meanwhile every real status pill found
(`tenant-list.component.ts`'s tenant status column) uses PrimeNG's own
generic `p-tag` `severity` prop (`success`/`warn`/`danger`/`secondary`/
`info` — PrimeNG's built-in palette) via a local `STATUS_SEVERITY` map, not
AccreditMe's own `--am-status-*` scale at all. Confirmed via
`grep -rn "am-status-\|am-severity-"` across all of `frontend/src`: the
only non-`tokens.scss` hit in the entire codebase is the topbar's
mismatched usage above. This is exactly the inconsistency this ticket
exists to fix (Section 3).

### No Shared Card Pattern Exists Either

`settings-hub.component.ts` inline-styles its own card:
`class="flex items-center gap-3 p-4 rounded-md bg-[var(--am-card)] border
border-[var(--am-border)] hover:border-[var(--am-blue-primary)]
transition-colors"` — a reasonable pattern, but it exists nowhere as a
reusable component or documented utility, so every future card either
copy-pastes this exact class string or (more likely, per this ticket's own
premise) invents a slightly different one.

---

## 2. SPACING / SIZING SCALE

**Own Tailwind's existing 4px-based default scale — do not invent a
competing one.** Once Tailwind actually compiles (Finding A), its default
scale already exists and already roughly matches what's used by accident
throughout the current codebase (`gap-4`=16px, `p-4`=16px, `gap-6`=24px all
already appear). The work here is *codifying which steps are sanctioned*
for this app, not creating new ones:

```
4px   (Tailwind 1)   — tight inline gaps (icon + label)
8px   (Tailwind 2)   — small gaps (form field internal spacing)
12px  (Tailwind 3)   — compact card/row internal padding
16px  (Tailwind 4)   — standard component padding, standard gap between
                        stacked elements (already the most common value
                        in existing code)
24px  (Tailwind 6)   — section-level spacing, gap between card grid items
32px  (Tailwind 8)   — page-level spacing between major sections
48px  (Tailwind 12)  — rarely — large empty-state vertical padding only
```

Arbitrary bracket values (`p-[18px]`, `gap-[10px]`) are out — if a spacing
need doesn't fit this scale, that's a signal to pick the nearest scale step,
not to reach for an arbitrary value.

**Ownership split (answers the plan's own scoping question):**
- **Tailwind utility classes** own all layout-level spacing in
  custom-built components — gaps, container padding, margins between
  elements. This is the existing mechanism; it just needs to actually
  compile (Finding A) and be used consistently (this scale).
- **`AccreditMePreset` token overrides** own component-internal spacing
  for PrimeNG's own components (button padding, input padding, table cell
  padding) — kept at whatever numeric values match the scale above, not
  overridden ad hoc per screen. Concretely: stop mixing `size="small"` on
  some `p-button`s and default size on others for no visual reason (found
  in `notification-bell.component.ts` vs `tenant-list.component.ts`) —
  pick one default size for each component type and use it everywhere
  unless there's a real information-density reason not to.
- **No new custom CSS variables for spacing** — unlike colors (which
  already have `--am-*` variables and should stay that way), spacing
  doesn't need a runtime-configurable custom property; Tailwind's classes
  already are the mechanism once wired up.

---

## 3. TYPOGRAPHY SCALE

Font family: Inter (once Finding B is fixed). Weights needed: 400
(normal), 500 (medium), 600 (semibold) — no existing component uses bold
(700); don't load a weight nothing uses.

```
H1 (page title)         text-2xl (24px)  font-semibold
H2 (section heading)    text-xl  (20px)  font-semibold   — already the
                                                            dominant
                                                            existing pattern
                                                            (tenant-list,
                                                            settings-hub
                                                            both already
                                                            use this)
H3 (subsection/card title)  text-lg (18px)  font-medium
Body                     text-sm  (14px)  font-normal    — already the
                                                            dominant
                                                            existing pattern
Labels / form field labels  text-sm (14px) font-medium
Captions / helper / muted text  text-xs (12px) — paired with
                                  text-[var(--am-text-secondary)], never
                                  PrimeNG's own `text-surface-400`/
                                  `text-surface-500` utility classes (found
                                  mixed in ad hoc in tenant-list's and
                                  notification-bell's empty-state text —
                                  standardize on the AccreditMe token)
```

---

## 4. SHARED COMPONENT PATTERNS

### Status/Severity Badge

One new shared component, `frontend/src/app/shared/components/status-badge/
status-badge.component.ts` (new `shared/components/` location — nothing
lives there yet; this is the first entry). Takes `[variant]="'status' |
'severity'"` and `[value]="string"` (the specific status/severity key,
e.g. `'approved'`, `'critical'`), renders a pill reading directly from
`--am-status-{value}`/`--am-severity-{value}` via a bound inline style —
never a hardcoded hex, never PrimeNG's own generic `p-tag` severity
palette. Replaces:
- `tenant-list.component.ts`'s `STATUS_SEVERITY` map + `p-tag` usage
- `topbar.component.ts`'s hardcoded `--am-severity-medium` for the
  impersonation banner — which isn't a severity at all (Finding C); this
  banner should probably just use a fixed informational treatment, not any
  entry from the severity scale (see Pending Discussion #4)

### Card

One new shared component, `frontend/src/app/shared/components/card/
card.component.ts`, wrapping exactly the pattern already established in
`settings-hub.component.ts` (Section 1) as a content-projecting shell:
padding, `--am-card` background, `--am-border` border, optional
`[linkable]` input for the hover-border-highlight variant already used
there. Replaces the inline class string everywhere it's duplicated.

### Table

No new component — `p-table` usage is already structurally correct
everywhere it appears (`scrollable scrollHeight="flex"`, matching
CLAUDE.md's Brand Design Tokens convention exactly). The fix is narrower:
standardize empty-state and muted-cell text to
`text-[var(--am-text-secondary)]` instead of the PrimeNG-generated
`text-surface-400`/`text-surface-500` classes found mixed in ad hoc.

---

## 5. FILES TO CREATE / MODIFY

### Commit 1 — Fix the actual foundation (Findings A + B)
```
frontend/postcss.config.* or equivalent Tailwind v4 integration point   CREATE
frontend/package.json                                                  MODIFY (Tailwind build-tool package)
frontend/src/styles.scss                                               MODIFY (@import "tailwindcss";)
frontend/src/index.html                                                MODIFY (Inter Google Fonts link)
```
Exact integration mechanism is Pending Discussion #1 — don't guess at
Angular 21 + Tailwind v4.3's specific wiring without confirming first.

### Commit 2 — Shared presentational components
```
frontend/src/app/shared/components/status-badge/status-badge.component.ts       CREATE
frontend/src/app/shared/components/status-badge/status-badge.component.spec.ts  CREATE
frontend/src/app/shared/components/card/card.component.ts                       CREATE
frontend/src/app/shared/components/card/card.component.spec.ts                  CREATE
```

### Commit 3 — Navigation shell
```
frontend/src/app/layout/topbar/topbar.component.ts        MODIFY (Finding C — impersonation banner)
frontend/src/app/layout/sidebar/sidebar.component.ts      MODIFY (spacing/typography scale)
frontend/src/app/layout/breadcrumb/breadcrumb.component.ts MODIFY (typography scale only — no logic changes)
frontend/src/app/layout/app-shell/app-shell.component.ts   MODIFY (if layout constants need adjusting)
```

### Commit 4 — Super Admin Portal
```
frontend/src/app/platform/components/tenant-list/tenant-list.component.ts             MODIFY (StatusBadge, typography)
frontend/src/app/platform/components/tenant-detail/tenant-detail.component.ts         MODIFY
frontend/src/app/platform/components/create-tenant/create-tenant.component.ts         MODIFY
frontend/src/app/platform/components/plan-list/plan-list.component.ts                 MODIFY
frontend/src/app/platform/components/plan-form/plan-form.component.ts                 MODIFY
frontend/src/app/platform/components/ai-credit-pack-list/ai-credit-pack-list.component.ts   MODIFY
frontend/src/app/platform/components/ai-feature-cost-list/ai-feature-cost-list.component.ts  MODIFY
frontend/src/app/platform/components/platform-settings/platform-settings.component.ts       MODIFY
```

### Commit 5 — Tenant Admin Settings (new ACC-13 screens)
```
frontend/src/app/foundation/admin-settings/components/settings-hub/settings-hub.component.ts               MODIFY (Card component)
frontend/src/app/foundation/admin-settings/components/organization-profile/organization-profile.component.ts MODIFY
frontend/src/app/foundation/admin-settings/components/email-provider-settings/email-provider-settings.component.ts MODIFY
frontend/src/app/foundation/admin-settings/components/ai-settings/ai-settings.component.ts                  MODIFY
```

### Commit 6 — Tenant Admin Settings (existing foundation screens linked from the hub)
```
frontend/src/app/foundation/organization/components/org-unit-tree/org-unit-tree.component.ts       MODIFY
frontend/src/app/foundation/organization/components/org-unit-form/org-unit-form.component.ts       MODIFY
frontend/src/app/foundation/working-calendar/components/calendar-config/calendar-config.component.ts       MODIFY
frontend/src/app/foundation/working-calendar/components/public-holiday-list/public-holiday-list.component.ts MODIFY
frontend/src/app/foundation/working-calendar/components/public-holiday-form/public-holiday-form.component.ts MODIFY
frontend/src/app/foundation/lookup/components/lookup-category-list/lookup-category-list.component.ts        MODIFY
frontend/src/app/foundation/lookup/components/lookup-value-list/lookup-value-list.component.ts               MODIFY
frontend/src/app/foundation/lookup/components/lookup-value-form/lookup-value-form.component.ts                MODIFY
frontend/src/app/foundation/roles/components/role-list/role-list.component.ts                        MODIFY
frontend/src/app/foundation/roles/components/role-form/role-form.component.ts                        MODIFY
frontend/src/app/foundation/roles/components/role-permission-matrix/role-permission-matrix.component.ts MODIFY
frontend/src/app/foundation/roles/components/user-role-assignment/user-role-assignment.component.ts   MODIFY
frontend/src/app/foundation/org-position/components/position-list/position-list.component.ts          MODIFY
frontend/src/app/foundation/org-position/components/position-form/position-form.component.ts          MODIFY
frontend/src/app/foundation/workflow/components/workflow-template-list/workflow-template-list.component.ts MODIFY
frontend/src/app/foundation/workflow/components/workflow-stage-list/workflow-stage-list.component.ts   MODIFY
frontend/src/app/foundation/workflow/components/workflow-stage-form/workflow-stage-form.component.ts   MODIFY
frontend/src/app/foundation/workflow/components/workflow-transition-editor/workflow-transition-editor.component.ts MODIFY
frontend/src/app/foundation/workflow/components/workflow-action-configurator/workflow-action-configurator.component.ts MODIFY
frontend/src/app/foundation/tasks/components/task-list/task-list.component.ts          MODIFY
frontend/src/app/foundation/tasks/components/task-form/task-form.component.ts          MODIFY
frontend/src/app/foundation/tasks/components/my-tasks/my-tasks.component.ts            MODIFY
frontend/src/app/foundation/user/components/user-list/user-list.component.ts           MODIFY
frontend/src/app/foundation/user/components/invite-user/invite-user.component.ts       MODIFY
frontend/src/app/foundation/user/components/user-profile/user-profile.component.ts     MODIFY
```

**Commit 6 is by far the largest single commit in this plan — 25 files, all
mechanical (swap ad hoc classes for the scale/components from Commits 1–3,
no logic changes anywhere).** Flagged sizing concern in Section 8, Pending
Discussion #5.

---

## 6. NON-GOALS (Explicit — Do Not Drift Into These)

- No illustrations, no distinctive brand personality/layout flourishes, no
  marketing-style visual polish. That is a separate future ticket,
  positioned right before the demo milestone after Document Management
  (per CLAUDE.md's Build Sequence) — this ticket is a consistency pass
  over what already exists, not that ticket done early.
- No new pages, routes, or functionality. `StatusBadgeComponent` and
  `CardComponent` (Section 4) are presentational-only — no new data, no
  new API calls, no new business logic. If anything in Commits 3–6 tempts
  adding a feature (e.g., "while I'm in here, let's add sorting to this
  table") — that does not belong in this ticket; note it and move on.
- No changes to `auth`/`notification`-bell components beyond what's listed
  above — they're not part of the three named screen groups.

---

## 7. ACCEPTANCE CRITERIA

- [ ] Tailwind CSS actually compiles (verified: grep a Tailwind utility
      class in a real `ng build`'s output CSS, not just "no build errors")
- [ ] Inter font loads (verified: Network tab or computed style shows
      Inter, not a system-font fallback)
- [ ] Spacing scale documented (Section 2) and applied — no new arbitrary
      bracket spacing values introduced in touched files
- [ ] Typography scale documented (Section 3) and applied across all
      touched files
- [ ] `StatusBadgeComponent` built, replaces `tenant-list.component.ts`'s
      ad hoc `p-tag`/`STATUS_SEVERITY` map and `topbar.component.ts`'s
      mismatched severity-token usage
- [ ] `CardComponent` built, replaces `settings-hub.component.ts`'s inline
      card class string
- [ ] `--am-status-*`/`--am-severity-*` tokens actually consumed by at
      least the new `StatusBadgeComponent`
- [ ] Applied across navigation shell, Super Admin Portal, and every
      Tenant Admin Settings screen listed in Section 5
- [ ] No new pages, routes, or backend changes
- [ ] Frontend TypeScript: zero errors
- [ ] `ng build`: clean (existing bundle-budget warning is pre-existing,
      not this ticket's concern to fix)
- [ ] PR merged to dev with green CI

---

## 8. PENDING DISCUSSIONS

Flagged for confirmation before building starts:

1. **Exact Tailwind v4.3 + Angular 21 integration mechanism (Finding A).**
   Tailwind v4 replaced the old `tailwindcss` PostCSS plugin package with
   `@tailwindcss/postcss` (or a Vite plugin, not applicable here since
   Angular's builder is esbuild-based, not Vite). Angular's own esbuild
   builder may or may not have first-party Tailwind v4 support as of the
   specific Angular 21 version in use here — worth checking Angular's own
   current docs/changelog rather than assuming, since guessing wrong here
   means Commit 1 doesn't actually fix Finding A. **Not guessed at in this
   plan on purpose.**

2. **Google Fonts link vs. self-hosted Inter (Finding B).** Google Fonts
   is the simpler default (matches CLAUDE.md's "Typography: Inter (Google
   Fonts)" line) but means an external network request on every page load
   and a third-party dependency for a GCC/MENA-focused product where some
   customers may have connectivity or data-residency sensitivities.
   **Recommendation: Google Fonts for now** (simplest, matches CLAUDE.md as
   written) — self-hosting is a one-line follow-up if it ever matters,
   not worth blocking this ticket over.

3. **Card and badge as new Angular components vs. plain CSS/Tailwind
   utility classes.** Recommendation is components (Section 4) since they
   encapsulate variants (linkable card, status vs. severity badge) more
   safely than a documented-but-unenforced class string that's easy to
   fat-finger. Confirm this doesn't read as violating "no new
   functionality" (Section 6) — these have zero business logic, purely
   presentational, but are still new files/new component surface area,
   which is worth an explicit sign-off given how firmly Section 6 was
   worded.

4. **`topbar.component.ts`'s impersonation banner (Finding C) — what
   should it actually use instead of a severity token?** It's a fixed,
   always-the-same informational state, not a rated severity. Options:
   (a) a new small `--am-banner-info` token distinct from both the status
   and severity scales, (b) reuse `--am-status-review` (amber — closest
   existing semantic match to "caution/in-progress"), (c) a plain
   PrimeNG `severity="warn"`-equivalent treatment with no AccreditMe token
   at all. **Recommendation: (a)** — cleanest long-term, but this is a
   real content decision, not obviously mechanical like the rest of this
   ticket. Confirm before Commit 3.

5. **Commit 6's size (25 files, Section 5) — one ticket/PR or split
   further?** Every change in it is mechanical and low-risk individually,
   but 25 files touched in one ticket is large. Options: (a) keep as one
   PR (all changes are the same kind of change, low review risk per file
   despite the count), (b) split Commit 6 into two PRs by foundation area
   (e.g., organization/calendar/lookups first, roles/workflow/tasks/users
   second). **Recommendation: (a)** — splitting a single mechanical
   consistency pass into multiple PRs risks the two halves drifting out of
   sync with each other before both land. Confirm before starting Commit 6.

6. **Spacing/typography ownership split (Section 2/3) — confirm the
   "Tailwind owns layout, PrimeNG preset owns component-internals, no new
   CSS variables" split is correct** before it's treated as settled. This
   is the plan's own answer to the ticket's original ask ("where should
   it live?") — surfaced explicitly rather than buried in Section 2/3's
   prose, since it's a real architectural choice, not just documentation.

---

## 9. DEPENDENCIES

### What This Step Requires from ACC-13/14

| Requirement | Where It Comes From |
|---|---|
| `AccreditMePreset`, `providePrimeNG()` | ACC-13/14 |
| Navigation shell, Super Admin Portal, Tenant Admin Settings hub (the screens being restyled) | ACC-13 |
| `--am-*` CSS variables (`tokens.scss`) | Pre-dates ACC-13, confirmed still in place |

### What Future Steps Will Require from ACC-15

| Future Step | What It Needs |
|---|---|
| Committee Management, Meeting Management (next modules) | A working Tailwind build + the spacing/typography scale + `StatusBadgeComponent`/`CardComponent` to build against from day one, rather than inventing their own ad hoc patterns the way every ACC-13 screen did |
| The future full visual/brand polish ticket (pre-demo, after Document Management) | This ticket's scale and shared components as its own starting foundation — that ticket adds personality/illustrations on top, does not redo this work |

---

*Plan created: 2026-07-30*
*Branch: feature/ACC-15-design-foundation*
*Depends on: ACC-13/14 (merged to dev ✅), CLAUDE.md's Key Architecture Decisions section (PrimeNG theming, ACC-13/14)*
