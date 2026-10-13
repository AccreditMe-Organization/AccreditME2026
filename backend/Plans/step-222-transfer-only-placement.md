# ACC-222 — a placed person changes unit or position only through Transfer

Plan written 13 Oct 2026 (CC-95). Decided by Ahmad: once a person is ACTIVE
and has a primary unit, their unit or position changes only through Transfer,
never Edit profile. Branch `feature/ACC-222-transfer-only-placement`.

## Why

Edit profile wrote `positionId` and `primaryOrgUnitId` straight onto the user
(`user.service.ts` `updateProfile`), beside Transfer. Transfer is the path that
does the work a move needs: a replacement for a single-holder position, the
head-authority grant, the head events, the audit as a transfer. Edit profile
moved a person without any of that.

## Backend — `UserService.updateProfile()`

- **B1.** For an ACTIVE user who already has a `primaryOrgUnitId`, a CHANGE to
  `positionId` or `primaryOrgUnitId` is refused with **409 `USE_TRANSFER`**,
  before anything is validated or written. The body carries `fields`, the ones
  that changed. Sending the current value back is not a change; an absent field
  is not one either.
- **B2.** Still allowed: an INVITED user, and an ACTIVE user with no primary
  unit (their first placement).
- **B3.** Manager, acting unit and its end date stay editable, unchanged.
- **B4.** A self-edit without `users:manage` never touched placement (the
  fields are dropped), so it is unaffected. An administrator editing their own
  record is held to the rule like anyone else's: it is the same move.
- The refusal lives in `foundation/user/user-refusal.ts`, the shape of the
  roles and storage refusals.

## Frontend — Edit profile (`user-record/edit-profile-dialog`)

- **F1.** For an ACTIVE user with a primary unit (and a viewer who may edit
  placement): position and unit show as read-only facts, with one line —
  "To move this person to another unit or position, use Transfer." — in English
  and Arabic. The placement step disappears: the dialog is ONE step, name,
  language, the two facts, manager and the acting unit with its end date. The
  save sends no position or unit. The page's Transfer button is unchanged.
- **F2.** INVITED users, and ACTIVE users without a unit, keep today's stepped
  dialog.
- **F3.** The server's 409 `USE_TRANSFER` is shown as a translated sentence,
  never its English message (`core/http/refusal.ts`).
- **The 420px body cap (ACC-111/ACC-120 rule).** The one-step shape is measured
  in both languages. If it is over, compaction first (the two facts on one
  row); if still over, stop and report rather than raise the cap or step it
  back.
  **Measured (CC-95, CC-95a, 13 Oct; Hessa editing Noura Al-Ghamdi):** with the
  facts on one row and Name and Language stacked, 407px English and **424px
  Arabic — over**. Stopped and reported. Ahmad's decision (CC-95a, option 1):
  **Name and Language share a row in the placed shape ONLY** — 328px English,
  343px Arabic. The stepped shape is unchanged: step 1 158/162, step 2
  320/328 (measured on the same record marked INVITED in the page's memory; no
  seeded person has that shape).
- **F4 (CC-95a).** The two facts read their names from the record's own
  references (`user.references.position`, `user.references.primaryOrgUnit`,
  the names the record header shows), never the position or unit lists — those
  are permission-gated and may still be loading when the dialog opens.
- **The Users list does not open this dialog** (measured: the only caller of
  `UserService.updateProfile` on the frontend is `edit-profile-dialog`), so it
  needs no change.

## Who it covers today (SELECT, 13 Oct, read only)

| Organisation | ACTIVE with a unit | ACTIVE without | INVITED | Other |
|---|---|---|---|---|
| al-manara | 22 | 0 | 0 | 1 |
| al-nakheel | 24 | 0 | 0 | 2 |
| platform | 0 | 1 | 0 | 0 |

Every ACTIVE tenant user is placed, so the stepped shape (F2) has no seeded
person today; specs cover it, the browser check covers F1.

## Tests

Backend: the refusal for unit, position and both; INVITED allowed; ACTIVE
without a unit allowed; the same value sent back is not a change; manager and
acting unit still save for a placed user; a tenant-isolation test with the
gate's phrase. One mutation each that goes red.

Frontend: both shapes (read-only facts and one step; the stepped dialog), the
save sends no placement for a placed user, the 409 mapped to the translated
sentence. All scans.

Browser (EN and AR), as Hessa on a seeded ACTIVE placed user: Edit profile
shows the read-only placement and the Transfer line; a name change saves and is
restored. No transfer is submitted.
