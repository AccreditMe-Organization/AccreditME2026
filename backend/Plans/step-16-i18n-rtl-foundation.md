# Step 16 — Language Switching and RTL Layout Support
# ACC-19: make ngx-translate's language-switching mechanism and RTL layout
# activation actually work end-to-end for the first time — both exist as
# declared dependencies/CSS rules today but have never been exercised
# anywhere in this app (see CLAUDE.md's Localization section, which already
# documents the intended behavior this step actually builds).

---

## HEALTH CHECK — Run Before Starting

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AccreditMe Health Check — 2026-07-31
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ERRORS:  None ✅
ERRORS:           None ✅
WARNINGS:         None ✅

DETAILED RESULTS

Check 1  Git State              PASS — on feature/ACC-19-i18n-rtl-foundation, clean
Check 2  Branch vs dev          INFO — branched from dev at 44b4711 (includes ACC-13
                                 through ACC-18), 0 drift
Check 3  Backend TypeScript     PASS — npx tsc --noEmit → zero errors
Check 4  Frontend TypeScript    PASS — npx tsc --noEmit → zero errors

OVERALL STATUS: 🟢 HEALTHY — ready to plan ACC-19
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

English/Arabic support has been a declared requirement since scaffold
(`en.json`/`ar.json` exist, `ngx-translate` is wired for static template
bindings via the `| translate` pipe), and CLAUDE.md's own Localization
section already documents the intended runtime behavior ("Language
preference stored per user, defaulted from tenant config", "Arabic
activates RTL layout globally via Angular `dir` binding", "PrimeNG RTL mode
enabled when Arabic active"). None of that runtime behavior has ever
actually been built. This step builds it:

1. `GET /auth/me` starts returning the current user's `language`.
2. App bootstrap resolves the effective language (user → org → `en`) and
   applies it via `translate.use()` before initial render.
3. The profile page's language dropdown switches live on save, not just
   persists to the DB.
4. A single, central, reactive mechanism sets `dir`/`lang` on `<html>`
   whenever the current language changes — not a per-component concern.
5. Three existing orphaned `// TODO: wire to TranslateService.currentLang`
   comments get closed out using that mechanism.
6. First empirical proof (test or documented manual steps) that switching
   to Arabic actually renders Arabic text and flips layout direction —
   this has never been confirmed before, in any form.

### What Was Found During Investigation (Not Guessed — Confirmed)

Investigated separately from ACC-18 (report: switching to Arabic on the
profile page shows a "saved" toast but nothing visibly changes). Confirmed
via direct code inspection — not assumption — that this is the wide gap,
not a narrow one:

- `user-profile.component.ts`'s `onSubmitProfile()` calls
  `UserService.updateProfile(..., { language, ... })` and, on success, only
  sets a signal and a success message. Zero runtime side effect — no
  `translate.use()` call, no `document` mutation, nothing.
- `AuthService.restoreSession()` calls `GET /auth/me` — but `MeResponse`
  (`{ id, email, name, impersonatedBy }`) doesn't even include `language`.
  There is nothing to apply even if the frontend wanted to.
- `app.config.ts` hardcodes `provideTranslateService({ lang: 'en' })` — a
  single fixed default, no dynamic resolution of anything.
- Grepped the entire frontend `src` tree (including every spec file) for
  `translate.use(`, `translateService.use(`, `setDefaultLang(` — **zero
  matches, anywhere**. The switching call has never been invoked, not once,
  in any code path, ever.
- `index.html` hardcodes `<html lang="en">` with no `dir` attribute, and
  nothing anywhere sets `document.documentElement.dir` at runtime.
  `styles.scss` already has real RTL-aware CSS
  (`sidebar-active-stripe`'s `[dir='rtl']`/`[dir='ltr']` rules), but they
  are permanently inert — the exact same "written, never wired" situation
  as Tailwind before ACC-15's Commit 1.
- Checked PrimeNG v21.1.9's own installed `PrimeNGConfigType`
  (`node_modules/primeng/types/primeng-config.d.ts`) directly, not from
  memory or documentation. There is no `rtl`/`direction` config option in
  its API at all — PrimeNG v18+ handles RTL purely through CSS logical
  properties that respond automatically to an ancestor's `dir` attribute.
  Nothing to configure on PrimeNG's side; it activates automatically the
  moment `dir="rtl"` is actually set somewhere above it in the DOM.
- Three components already read `translate.currentLang()` reactively,
  anticipating this would eventually work:
  `notification-bell.component.ts`'s `isArabic()` (functioning, reads a
  real signal already), plus explicit
  `// TODO: wire to TranslateService.currentLang` comments sitting unbuilt
  in `lookup-value-list.component.ts` and `lookup-category-list.component.ts`.
  Nobody ever finished the other half.
- `Organization.language` (schema.prisma, defaults to `"en"`) already
  exists and is unused for this purpose anywhere in code — confirmed by
  reading the model directly. This is exactly the "defaulted from tenant
  config" field CLAUDE.md's Localization section already describes.

**Conclusion: this is real, multi-layer, previously-unbuilt work** — a
backend response field, an app-bootstrap resolution step, a live-switch
wire-up, a new central RTL mechanism, and the first-ever empirical
verification that any of it actually renders correctly. Not a "connect two
already-working pieces" ticket.

---

## 2. BACKEND — `language` ON `GET /auth/me`

`MeResponse` (`backend/src/foundation/auth/auth.controller.ts`'s `getMe()`
and `frontend/src/app/core/services/auth.service.ts`'s matching interface)
currently returns `{ id, email, name, impersonatedBy }`. Add `language:
string` — the resolved effective value, not a raw nullable passthrough:

```
resolvedLanguage = user.language ?? organization.language ?? 'en'
```

`AuthService.getMe()` (backend) already has the authenticated user loaded;
resolving `organization.language` requires a join/second lookup already
available via the same `organizationId` used elsewhere in that method. Pure
additive change — no new endpoint, no DTO change (response shape only), no
migration (both source fields already exist).

---

## 3. APP BOOTSTRAP — RESOLVE AND APPLY BEFORE FIRST RENDER

`AuthService.restoreSession()` already runs inside
`provideAppInitializer(() => firstValueFrom(inject(AuthService).restoreSession()))`
in `app.config.ts`, which blocks Angular's initial navigation
(`provideRouter`'s default `initialNavigation: 'enabledBlocking'`). This is
the correct, already-existing hook — no new bootstrap mechanism needed.

`restoreSession()`'s `tap()` callback, on a successful `/auth/me` response,
should call `translate.use(response.language)` before setting the
`currentUser` signal. Because the initializer already blocks the first
render, this avoids any flash-of-wrong-language without needing a second
blocking mechanism — the language is correct by the time anything paints.

For the *unauthenticated* case (401 → `catchError` branch, i.e. the login
page itself): see Pending Discussion #4 — scope boundary for pre-auth
pages.

---

## 4. PROFILE PAGE — LIVE SWITCH ON SAVE

`user-profile.component.ts`'s `onSubmitProfile()` success handler currently
only sets `this.user.set(u)` and a saved-message signal. Add a call to
apply the newly-saved language immediately (exact mechanism — direct
`translate.use()` call vs. going through the central service from Section
5 — should be the latter, so there is exactly one code path that ever
calls `translate.use()` in the whole app, not two).

Exact interaction pattern (live vs. refresh) is Pending Discussion #2 —
do not build against an assumption.

---

## 5. CENTRAL RTL/LANGUAGE MECHANISM

Establish one place — proposed: a new `LanguageService`
(`frontend/src/app/core/services/language.service.ts`, `providedIn: 'root'`)
— that:

1. Owns the single call site for `translate.use(lang)` (bootstrap in
   Section 3 and profile-page save in Section 4 both call through this
   service, never `TranslateService` directly).
2. Reactively sets `document.documentElement.dir` (`'rtl'` for `ar`, `'ltr'`
   otherwise) and `document.documentElement.lang` whenever the current
   language changes — via an `effect()` reading `translate.currentLang()`
   as a signal (same reactive primitive `notification-bell.component.ts`'s
   `isArabic()` already relies on successfully), not a manual
   subscription that could be missed on some code path.
3. Exposes a reactive `isRtl()`/`isArabic()` accessor other components use
   instead of re-deriving `translate.currentLang() === 'ar'` themselves —
   this is what closes out the three orphaned TODOs (Section 6) with one
   shared implementation instead of three separate copies.

This is the "single central mechanism other components can rely on, not a
per-component concern" the ticket explicitly asks for — no component
outside this service should ever touch `document.documentElement.dir`
directly, and no component outside this service and the bootstrap/profile
call sites should ever call `translate.use()` directly.

---

## 6. CLOSE THE THREE ORPHANED TODOs

Using `LanguageService` from Section 5:

- `notification-bell.component.ts`'s `isArabic()` — already correct in
  behavior, but should be re-pointed at the shared service instead of
  re-implementing `translate.currentLang() === 'ar'` locally, so there's
  one implementation, not two that could drift.
- `lookup-value-list.component.ts`'s `displayLabel()`/`effectiveLabel()`
  TODOs — currently hardcode a preference for Arabic labels when present,
  regardless of actual current language. Wire to the real current language
  instead.
- `lookup-category-list.component.ts`'s `displayLabel()` TODO — same fix,
  same pattern.

---

## 7. EMPIRICAL VERIFICATION — FIRST-EVER PROOF

Per the ticket's explicit requirement: this has never been confirmed to
work, in any form, so verification is itself a scoped deliverable, not an
afterthought.

Minimum bar:
1. A real automated test (Karma/Jasmine, matching this app's existing
   frontend test convention) that calls `translate.use('ar')` (or exercises
   `LanguageService`'s equivalent) and asserts on a real rendered
   consequence — either a translated string appearing, or
   `document.documentElement.dir === 'rtl'` — not just that a signal's
   value changed.
2. Documented manual verification steps (this plan file's own progress
   tracker, or the PR description) covering the representative sample from
   Pending Discussion #1: the nav shell (sidebar/topbar visibly flip and
   relabel), one form (a representative input-heavy screen), one table
   (column order/alignment under RTL).

---

## 8. NON-GOALS (Explicit — Do Not Drift Into These)

- **Full RTL visual audit of every existing screen.** This step verifies a
  representative sample (Section 7) proves the *mechanism* works
  correctly. Auditing all ~15+ existing screens pixel-by-pixel for RTL
  correctness (icon mirroring, breadcrumb arrow direction, table column
  order, form label alignment, etc.) is separate, future work — see
  Pending Discussion #1 for proposed sequencing.
- **Pre-auth page language switching**, unless Pending Discussion #4
  resolves in favor of including it.
- **AI-output language** (CLAUDE.md's "All AI outputs in user's preferred
  language") — depends on this step's language resolution existing, but
  wiring it into any AI provider call is out of scope; no AI-integrated
  module has shipped yet.
- **Hijri calendar toggle** — a separate, unrelated per-user display
  preference (CLAUDE.md's Timezone and Calendar section) — not part of
  this step.
- **Email/notification template language** — CLAUDE.md's "All system
  notification templates maintained in both languages" is a content
  requirement for whoever builds those templates, not a runtime-switching
  concern this step addresses.

---

## 9. ACCEPTANCE CRITERIA

- [x] `GET /auth/me` returns `language` (user → org → `en` resolution)
- [x] App bootstrap applies the resolved language via `translate.use()`
      before initial render — no flash of the wrong language
- [x] Profile page's language dropdown switches live on save (or documented
      refresh pattern, per Pending Discussion #2)
- [x] `LanguageService` (or equivalent single mechanism) owns every
      `translate.use()` call site and every `document.documentElement.dir`/
      `.lang` write in the app
- [x] All 3 orphaned TODOs closed, using that shared mechanism
- [x] A real automated test proves `.use('ar')` produces a real rendered
      consequence (translated text or `dir="rtl"`) — not just a signal
      change (`frontend/src/app/core/services/language-rendering.spec.ts`)
- [x] Representative sample manually verified under RTL: nav shell, one
      form, one table — see manual verification log below
- [x] All 4 Pending Discussions below resolved before implementation begins
- [x] Backend TypeScript: zero errors
- [x] Frontend TypeScript: zero errors
- [x] `ng test` passing (15/15)
- [x] No PR opened or merged without explicit instruction

### Manual RTL Verification Log (Section 7, item 2)

Performed via a real headless-Chromium (Playwright) session against the
actual running dev servers, logged in as the platform admin
(`lionit@gmail.com`, org `platform`) with `language: 'ar'` already
persisted on the profile from the Section 2-5 checkpoint's browser check.

- **Nav shell + form** (profile page): confirmed during the mandatory
  Sections 2-5 checkpoint — `dir="rtl"` set on `<html>`, sidebar/topbar
  labels rendered in Arabic, the circular-DI bug was found and fixed here.
- **Table** (Super Admin → Tenants list, `/platform/tenants`, reached via
  the app's own post-login SPA redirect, not a hard page load — see
  incidental finding below): confirmed `dir="rtl"` and `lang="ar"` on
  `<html>`, computed CSS `direction: rtl` on the actual `.p-datatable`
  element, sidebar correctly repositioned to the physical right edge of
  the viewport showing only the "Super Admin" nav item (per the ACC-13
  platform-nav-separation rule), and all table headers/labels
  (اسم المؤسسة, المعرّف الفرعي, الحالة, الخطة, إنشاء مؤسسة) rendered in
  Arabic with correct right-to-left column order. Screenshot:
  `rtl-table-tenants-2.png` (scratchpad, not committed).

**Incidental finding — not in scope, not fixed here**: the first attempt
at this table check used a hard page reload (`page.goto`) directly to
`/platform/tenants` and was incorrectly redirected to `/organization`.
Root cause: `platformAdminGuard` (`frontend/src/app/core/guards/platform-admin.guard.ts`)
synchronously reads `NavigationAccessService.isPlatformAdmin()`, whose
underlying signal is populated by a separate HTTP call that is **not**
part of the `provideAppInitializer`-blocked `restoreSession()` chain —
so on a hard reload of a deep-linked `/platform/*` URL, the guard can
evaluate before that permission data has loaded, defaulting to `false`
and incorrectly bouncing a genuine platform admin to `/organization`.
Confirmed this is a reload-timing race, not an RTL/i18n defect, by
re-running the same check via the app's own internal SPA navigation
(post-login redirect) instead of a hard reload — the guard passed
correctly and the real Tenant List table rendered as expected. This is a
pre-existing bug unrelated to ACC-19's scope; flagging for a separate fix
(e.g. gating the guard on the same initializer, or on
`NavigationAccessService`'s own loaded-state) rather than fixing here.

---

## 10. PENDING DISCUSSIONS

### 1. Splitting the full RTL visual audit from this ticket's scope

This codebase has ~15+ existing screens built without RTL ever having been
exercised. A full pixel-perfect visual audit of every one (layout flip
correctness, icon mirroring, table column order, form alignment) could be
large, separate work — the same shape as Design Foundation (ACC-15) being
split from the still-future full visual-polish ticket.

**Proposed split**: this ticket builds the core mechanism only — switching
+ RTL activation working correctly, verified on a representative sample
(nav shell, one form, one table). A full RTL visual audit across every
existing screen becomes its own separate future ticket.

**Recommendation on sequencing**: unlike the visual-polish ticket
(cosmetic, can wait for the demo milestone), Arabic/RTL is core market fit
for this product's primary GCC/MENA target market — CLAUDE.md's own Demo
Strategy explicitly targets "a compelling demo for GCC healthcare and
government." But several modules between now and the demo (Committee,
Meeting, Document Management, etc.) will add screens that would need
re-auditing if the visual audit runs too early. Recommend positioning the
full RTL visual audit ticket **at the same point as the full visual/brand
polish ticket** — right before the demo milestone, after Document
Management — so it runs once against the complete demo-scope screen set
instead of being redone repeatedly as new modules ship.

**Needs confirmation before this ticket's scope is final.**

### 2. Live switch vs. required page refresh

Should changing language apply immediately across the whole running app
(live, no reload), or is a "your language has been updated, please
refresh" pattern acceptable? This affects whether every currently-rendered
component needs to reactively re-render on a language-change signal
(bigger, more thorough), or whether a simple reload after save is
sufficient (much smaller — `LanguageService` just needs to persist +
trigger a reload, not manage live re-rendering).

**Needs a decision before building Sections 4/5.**

### 3. Session-only quick-toggle vs. persisted-only preference

Should there be a lightweight, session-only language toggle (e.g. for
testing/preview purposes, or a user who wants to briefly view the UI in
the other language without changing their saved profile preference),
separate from the persisted profile-level preference — or is the profile
page the only place language ever changes?

**Affects whether `LanguageService` needs to distinguish a "session
override" from "the saved preference" as two different pieces of state.**

### 4. Pre-auth page scope

Login, accept-invitation, and forgot-password pages render before any user
identity is known (no JWT yet). Is language/RTL support in scope for these
pages in this ticket (e.g. resolved from `Organization.language` once an
org slug is entered, or browser-language detection before that), or is
this ticket scoped to post-login authenticated screens only, leaving
pre-auth pages English-only for now (Section 8 currently assumes the
latter as a Non-Goal, pending this confirmation)?

---

## 11. DEPENDENCIES

- No schema migration required — both `User.language` and
  `Organization.language` already exist.
- No new npm packages — `ngx-translate` and PrimeNG are both already
  installed and require no additional configuration for this step's scope
  (confirmed directly against PrimeNG's installed config type, not
  assumed).
- Builds on `AuthService.restoreSession()`/`provideAppInitializer`
  (ACC-12/ACC-13) and `user-profile.component.ts` (ACC-12) — both already
  exist and are not being restructured, only extended.
- The three orphaned-TODO components (`notification-bell.component.ts`,
  ACC-10; `lookup-value-list.component.ts`/`lookup-category-list.component.ts`,
  ACC-7/ACC-18) are modified, not rebuilt.
