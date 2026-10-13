# ACC-120 slice 5 — the user record page (`/users/:id`)

Plan written 12 Oct 2026 (CC-87), approved as ONE PR with D1–D10 as
recommended and additions A1–A4 in CC-88 (13 Oct). Frontend only, plus one
backend comment. No migrations, no backend behaviour change.

## Scope

Today's profile screen (`user-profile.component.ts`, a 724-line single form
with raw `p-datepicker`s, an inline two-step sign-in section and a raw
`p-dialog` around the transfer wizard) becomes a record page built to
Templates "2 Record page", copying the Committee record page for structure.

- The header holds identity and placement; panels follow.
- Each panel and each header action edits in its own dialog on the dialog
  shell. No inline editing, no page-level Save.
- One page serves "my profile" and "an administrator viewing someone": the
  route, the guard (`ownProfileGuard`) and the component are the same, and
  `isOwn` (route id = session user) decides what renders.

## Findings that shaped the plan (CC-87)

- `GET /users/:id` (self or `users:view`) returns the record plus
  `references` (position, unit, acting unit, manager, acting user names).
  No `hijriDisplay`, no invited-at field (`createdAt` stands in).
- `PATCH /users/:id/profile` is self or `users:manage`; for a self-edit the
  placement fields are silently ignored (`user.service.ts:1064`).
- `PATCH /users/:id/out-of-office` is self or `users:manage` and REPLACES all
  three fields: a missing one becomes null (`user.service.ts:1352`).
- Transfer (`users:transfer`), Deactivate (`users:deactivate`, no self
  check — only the last-admin invariant), Reactivate (`users:reactivate`),
  Revoke invitation (`users:invite`, deletes the user). No Resend endpoint.
- `GET /users/:userId/roles` is `roles:view` plus self or `users:view`; each
  grant carries `grantedAt` and `source`, never "granted by".
- Two-step sign-in: status, setup, setup/verify, disable — self only.
  **Turning it off always fails** for an account that has it on
  (`auth.service.ts` `disableMfa`): ACC-164.
- No password-change endpoint exists.
- The Committee page has no pagination and does not use the request-outcome
  state machine; its `tasksError` is never cleared (ticketed, D7).

## Panels left out — absent, not empty (D1)

| Panel | Why |
|---|---|
| Committees | no read of CommitteeMember by user |
| Tasks | `my-tasks` is self-only, `/tasks` needs a source record |
| Sessions | no list endpoint; only `lastLoginAt` (shown in the header) |
| Access history | no read of AuditLog (objectType `User`) or UserTransferEvent by user |

Follow-up ticket (Low): "users: per-user reads for the user record page".

## The page

**Header:** initials avatar, the name as the H1 (tab title via
`registerPageName`), email (LTR-isolated), the Users list's status chip
(`app-status-chip variant="user"`: Active plain, Invited amber, Inactive muted).

**Fact strip:** Position · Unit · Manager · Acting in (when set, with its end
date) · Out of office (when set, with the cover person) · Last sign-in (or
"Never signed in"; for an invited user, "Invited {date}").

**Header actions**, each its own dialog or confirm, each gated:

| Action | Shown when |
|---|---|
| Edit profile | own record, or `users:manage` |
| Out of office | (own record, or `users:manage`) and the user is active |
| Transfer | `users:transfer`, active, and in a unit (the list's rule; the backend refuses otherwise) |
| Deactivate | `users:deactivate`, active, and NOT your own record (D4) |
| Reactivate | `users:reactivate`, inactive (D3) |
| Revoke invitation | `users:invite`, invited (D2) — confirm says it deletes, then back to /users |

**Roles panel** (`roles:view`; a refused read leaves it absent): every grant
(D6 — no 3–6 row cap; a user holds a handful), position grants first and
marked "comes with the position", direct grants with "Granted {date}". The
panel action "Manage roles" (`roles:manage`) opens the existing Manage roles
dialog exactly as the Users list hosts it.

**Two-step sign-in panel**, own record only: the status, and Set up (when off)
or Turn off (when on). Same requests as today.

**Request outcomes per panel (D7):** an opt-in `[outcome]` input on
`RecordPanelComponent` reading the shared `RequestOutcome`: skeleton rather
than spinner, an error block with Retry (and the error id when the server sent
one), "—" as the count on error, and a denied panel ABSENT from the grid. The
existing inputs are untouched, so the Committee page does not change.

## Dialogs

| Dialog | Plan |
|---|---|
| Manage roles | reused as is, hosted as the Users list hosts it |
| Transfer | the existing wizard, moved off the raw `p-dialog` onto the shell; gains `dirtyChange` so `[dirty]` works |
| Edit profile | new; own record: name, language; with `users:manage`: also position, unit, manager, acting unit and its end date. Compact density (7 field blocks). The end date uses the date view (the calendar replaces the fields while picking) |
| Out of office | new; from, to, cover person; both dates through the date view. ALWAYS sends all three fields (A2) |
| Two-step sign-in setup | new; two steps on the existing seam (password → QR code and verification code) |
| Turn off two-step sign-in | new; the password and the warning, then the same request as today (broken until ACC-164) |
| Deactivate / Reactivate / Revoke | the Users list's confirms, moved into one shared service both screens call |

Every field in the field wrapper with `[control]`, every dialog with
`[dirty]`, no raw PrimeNG floating panel inside a dialog. Each body measured in
both languages against the 420px cap; measure, then compact, then step only on
a real seam.

## Files

| File | Change |
|---|---|
| `shared/components/record-panel/record-panel.component.ts` (+ spec) | opt-in `[outcome]` + `(retry)` |
| `foundation/user/components/user-record/user-record.component.ts` (+ spec) | the page |
| `foundation/user/components/user-record/edit-profile-dialog.component.ts` (+ spec) | Edit profile |
| `foundation/user/components/user-record/out-of-office-dialog.component.ts` (+ spec) | Out of office |
| `foundation/user/components/user-record/two-step-setup-dialog.component.ts` (+ spec) | setup |
| `foundation/user/components/user-record/two-step-off-dialog.component.ts` | turn off |
| `foundation/user/services/user-status-actions.service.ts` | the three confirms + which one applies, shared with the list |
| `foundation/user/components/user-list/user-list.component.ts` (+ specs) | uses the shared rule; no Deactivate on your own row (A1) |
| `foundation/user/components/transfer-user-wizard/…` | `dirtyChange` output |
| `foundation/user/user.routes.ts` | `:id` loads the record page |
| deleted: `user-profile/` and `roles/components/user-role-assignment/` | their only consumer was the old page |
| `assets/i18n/en.json`, `ar.json` | new keys |
| `backend/src/foundation/auth/auth.service.ts` | a comment naming ACC-164 at the broken disable path |
| `SYSTEM-REFERENCE.md`, `CLAUDE.md` | §10.8 outcome input, the record page, the guard line corrected |

## Tests — each with the mutation that must turn it red

| # | Test | Mutation |
|---|---|---|
| 1 | each header action is hidden without its own permission | gate Transfer on `users:view` |
| 2 | Deactivate is absent on your own record | drop the not-own condition |
| 3 | an invited user shows the amber chip and only Edit profile / Revoke | show Out of office for INVITED |
| 4 | placement fields appear only with `users:manage` | show them on your own record |
| 5 | Roles: a direct grant shows its date; a position grant shows its source and no date | render the date for a position grant |
| 6 | without `roles:view` the Roles panel is absent and makes no request | render it empty instead |
| 7 | one panel's error leaves the header and other panels in place; Retry re-requests | route the panel error to the page error |
| 8 | RecordPanel outcome: skeleton (not spinner), "—" count on error, denied absent; Committee spec stays green | render the spinner |
| 9 | the Two-step panel and its status request happen only on your own record | drop the own-record condition |
| 10 | setup posts the password, then the code; backup codes never render | render `backupCodes` |
| 11 | Escape with unsaved edits asks "Discard changes?" in each new dialog | drop `[dirty]` |
| 12 | saving the language switches the session only on your own record | always switch |
| 13 | clearing out of office sends nulls (the endpoint replaces everything) | omit the fields |
| 14 | none of the four left-out panel headings ever render | add a placeholder panel |
| 15 | Arabic: headings and meta translated, email LTR-isolated | drop `dir="ltr"` |
| A1 | the Users list offers no Deactivate on your own row | drop the own-row check |
| A2 | changing only the end date keeps the start date and the cover person | send only the changed field |

## Browser check (local only)

Hessa (Organization Administrator) for the full action set; the closest seeded
persona to `admin:access` + `users:view` without write permissions, reported
exactly as held (A4 — no role is created or changed to make one); a staff
member (BASE_USER) on their own record. English and Arabic.

Writes to the shared database: Edit profile (a name changed and restored) and
Out of office (set to future dates, then cleared) — four audit rows. Transfer,
Deactivate, Reactivate, Revoke and Manage roles are walked to their final
confirm and cancelled. Two-step setup is opened and cancelled at step 1
WITHOUT submitting the password; `/auth/mfa/setup` and `setup/verify` are
never called (A3).

## Review answers (CC-88, 13 Oct)

- **D1** — the four panels are left out. One Low ticket: "users: per-user
  reads for the user record page" — committees and access history first,
  sessions later, tasks only after a decision on whose tasks an admin may see.
- **D2** — Revoke is offered for invited users, with a confirm saying it
  deletes them; then back to /users.
- **D3** — Reactivate is added, with the Users list's confirm naming the roles
  they return holding.
- **D4** — Deactivate is hidden on your own record.
- **D5** — Edit profile keeps changing position and unit directly, as today.
- **D6** — every role row is shown; the deviation from Template 2's 3–6 rows is
  recorded here and in SYSTEM-REFERENCE.
- **D7** — the opt-in `[outcome]` input on RecordPanelComponent; Committee
  unchanged. The Committee page's never-cleared `tasksError` is its own Low
  ticket.
- **D8** — the status chip is reused as is.
- **D9** — turning two-step sign-in off is ACC-164; behaviour unchanged, with a
  code comment naming it beside the broken path.
- **D10** — Transfer on `users:transfer`, Deactivate on `users:deactivate`.
- **A1** — the Users list also hides Deactivate on your OWN row, with a test.
- **A2** — Out of office always sends every field; a test that changing only
  the end date keeps the start date and the cover person.
- **A3** — the browser check opens Two-step setup and cancels at step 1 without
  submitting the password; setup and setup/verify are never called.
- **A4** — if no seeded persona has `admin:access` + `users:view` without the
  write permissions, no role is created or changed to make one; the read-only
  check runs with the closest persona and reports what it held.

## As built (CC-88, 13 Oct)

### Dialog bodies, measured in the browser against the 420px cap

| Dialog | English | Arabic |
|---|---|---|
| Edit profile, own record (one step) | 158 | 162 |
| Edit profile with placement, BEFORE stepping | **511 — over** | **526 — over** |
| Edit profile with placement, step 1 (profile) | 158 | 162 |
| Edit profile with placement, step 2 (placement) | 320 | 328 |
| Edit profile, the date view | 271 | 275 |
| Out of office, the fields | 295 | 291 |
| Out of office, the date view | 271 | 275 |
| Two-step sign-in setup, step 1 | 112 | 119 |

Measured with compact density, the actions in the footer and the acting
unit paired with its end date already applied, so the overflow was content;
stepped on the form's own seam (ACC-120's rule). Two-step setup step 2 and
Turn off were not opened live: step 2 needs `/auth/mfa/setup` (A3), and Turn
off needs an account with two-step sign-in on (none has). Both are covered
by specs.

### Changes from the plan, each with its reason

1. **Edit profile is stepped when it carries placement** — measured over the
   cap (above).
2. **Edit profile sends the language only when it was changed** — found in the
   browser pass: Yasser has no saved language, and the old form (and the
   first build of this one) sent the picker's "en" on any save, pinning him to
   English on a name edit. A test and a mutation pin it.
3. **The status confirms stay ConfirmationService confirms**, moved into one
   shared service both screens call, rather than rebuilt as shell dialogs: the
   Users list's wording and flow, unchanged, is what both screens now show.
4. **The Users list's Transfer dialog also binds `[dirty]`** — the wizard
   gained `dirtyChange` for the record page, and the list hosts the same
   wizard.
5. **Edit profile offers no × on the placement pickers** — clearing never
   worked (an empty choice is sent as "unchanged", D5), so the × is not
   offered rather than offered and ignored.
6. **Two scan edits**: `check:dialog-overlays`' last allowlist entry (the old
   profile's three page-level date pickers) is deleted with the page, leaving
   the list empty; `check:icon-labels`' baseline is lowered 29 → 19 at the
   scan's request (dev was already 9 under; the deleted role section took
   the 10th). `check:action-gating` gains one allowlist entry, for the per-date
   clear (×) inside Out of office — form state, like task-form's.

### Mutations — every one seen red, then restored

T1–T7, T9–T15 (T4 and T11 in each of their dialogs), A1, A2, T8 on the
RecordPanel spec, and three for the changes above (the language sent only
when changed; Next refusing an empty name; the step strip shown with
placement): 24 in all, all red.

### Before the PR left draft (/ready-to-pr, 13 Oct)

- **Dev moved** (ACC-198, df16243) and was merged in, not rebased; the merge
  was clean. Every gate was re-run on the merged tree.
- **Pre-PR checklist fixes**: a loading state for the record (the identity
  card's shape, never a spinner) with a spec that it gives way to the record
  or the error; the four inline `style` attributes in this slice's new markup
  became Tailwind classes. Two more mutations, both red: no loading state, and
  T15 re-run against the class.
