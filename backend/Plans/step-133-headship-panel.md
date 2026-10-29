# ACC-133 — the six-state Headship panel (plan)

**Status:** BUILT — merged as #199 (f351e74), 20 Oct.

When written: **building (CC-127a, 20 Oct 2026).** The stop below was answered: option
A, in this same PR, with the D7 names rule applied to this panel.

Spec: ACC-133's description in Linear. Drawing:
`frontend/design-reference/AccreditMe Head Management.dc.html` (25 Sep).
Base: `dev` at `6e93a52`. Branch: `feature/ACC-133-headship-panel`.

## 1. The blocker — what the panel needs that GET does not return

`GET /organization/units/:id/head` (`org-unit-head.service.ts:61-80`) returns
four things only:

```ts
holders: { id, name, positionId }[]   // live: 0, 1, or 2 during a handover
pendingHeadUserId: string | null
headHandoverEffectiveDate: Date | null
actingHeadUserId: string | null        // the id only
```

Nothing in the backend reads `OrgUnitHeadEvent` or `OrgUnitHeadAssignment` for a
client: the only readers are the service itself, the Setup health detectors and
`task-authority.service.ts`. Every line below therefore has no source today.

| What ACC-133 draws | Where it lives | Returned? |
|---|---|---|
| Vacant row: "Vacated 1 Sep 2026 by Nora Al-Otaibi" (states 1, 2) | latest `VACATED` event: `effectiveDate`, `user.name` | no |
| Held row: "Since 3 Mar 2024" (states 3–6) | latest `ASSIGNED` / `HANDOVER_COMPLETED` event for the holder | no |
| Incoming row: "Head access since 25 Sep 2026" (states 5, 6) | the `HANDOVER_DECLARED` event's `createdAt` | no |
| Cover row: who covers, and until when; the bar dashed when open-ended (states 2, 4, 6) | the open ACTING `OrgUnitHeadAssignment`: `userId`, `user.name`, `reason`, `validFrom`, `validTo` | id only, no name or dates |
| Arrange cover: "This starts a new 90-day period. The cover that ended on 20 Oct won't count towards it." | ACTING assignments for the same person ended in the last 7 days (`endedAt` / `validTo`) | no |
| Appoint · Replaces strip: "Director · since 3 Mar 2024 · until 30 Sep" | the holder's position name and the held-row event | no date |
| Arrange cover · VACANCY strip: "Vacant since 1 Sep 2026" | the `VACATED` event | no (slice 2 shows "Vacant" only, for this reason) |

Only the "without an event" renderings ("No head recorded", "Start date not
recorded", the two strip variants) can be built from today's GET. Building the
panel on those alone would show "Start date not recorded" on a unit whose start
date IS recorded. That is a false statement, and ACC-133's rule is that the
fallback states what is not recorded, never stands in for what is.

The cover row's name has a second problem. The old panel resolves names through
`UserService.listAllUsers()`. A viewer with `org:view` and no `users:view` (the
read-only persona the acceptance requires) gets no names from that, so the
cover row could not name the acting head for them at all.

## 2. Options

**A — extend the GET, additively (recommended).** Same route, same `org:view`
gate, no migration, no new write. Add fields; the current frontend ignores them.

```ts
holders: { id, name, positionId, positionName, headSince: Date | null }[]
lastVacated: { at: Date; userName: string } | null      // only when vacant
pendingHeadAccessSince: Date | null                     // HANDOVER_DECLARED.createdAt
cover: { userId; name; reason: 'VACANCY' | 'ABSENCE'; validFrom: Date; validTo: Date | null } | null
recentlyEndedCovers: { userId: string; endedOn: Date }[] // ended within 7 days
```

Two or three extra reads (events for the unit, acting assignments for the
unit), each scoped `{ organizationId, orgUnitId }`, each with a test named
`should NOT return records belonging to a different tenant`. Then the panel is
built exactly as ACC-133 draws it, in the same PR or a following one.

**B — build only what today's GET supports.** Always the "without" renderings,
no cover dates, no 7-day warning, no "Head access since". Ships the six states
and the action lists, but states false things on units with history, and drops
the 7-day warning ACC-133 asks for. Not recommended.

**C — split.** A backend PR for option A first (small, specs only), then the
panel PR on top of it.

## 3. Also needs a decision — D7 and this panel

D7 (CC-125a) says head names show only to viewers with `users:view`, and
committee names only with `committees:view`; anyone else sees "Head assigned"
and counts. It was decided for the org chart. Today's GET already returns
holder names to any `org:view` holder. Does D7 apply to this panel too? If yes,
option A's names (holders, cover, last vacated) are withheld from viewers
without `users:view`, and the panel renders "Head assigned" / "Cover arranged"
for them.

## 4. Step 2 — a dialog and a confirm opened from inside the Manage head dialog

**This works today, and the mechanism is already in place on `dev`:**

- The old panel already opens two `EditDialogComponent`s from inside the tree's
  Manage head `EditDialogComponent`: its effective-date picker (`size="picker"`)
  and `SetActingHeadDialogComponent`.
- `EditDialogComponent` appends every dialog to `<body>` (`appendTo` is no
  longer an input, `edit-dialog.component.ts:326`). The nested dialog therefore
  has no scrollable ancestor. `set-acting-head-dialog.component.ts:40-75`
  records the measurement that made this load-bearing: inside the parent's body
  it was clipped by 21px.
- Escape belongs to the top layer through `LayerStackService` (ACC-111).
- A confirm over an open dialog is covered by
  `shared/components/confirm/confirm-over-dialog.spec.ts`, written for exactly
  this panel's Vacate case: one Escape closes only the confirm, and the next one
  closes the panel. The old panel already uses `AmConfirmService` for its
  confirms.

## 5. `check:dialog-overlays`

**Already at its final number.** It reports 0 PrimeNG overlays reachable inside
dialogs and 0 allowlisted, and `ALLOWED` in `scripts/check-dialog-overlays.mjs`
is empty. Nothing for this ticket to lower.

## 6. The build, once the data question is answered

- A standalone `am-headship-panel` taking a unit id, for the future unit record
  page. It replaces the old panel inside the tree's Manage head dialog, and the
  old panel is removed once nothing uses it.
- State derived from the GET: three flags (head held, cover running, successor
  pending) to states 1–6. Each action shown only where its endpoint accepts it.
  State 5 has no primary button.
- Dialogs: Appoint head (Horizon 1: the From row reads "Now, when you save";
  button "Appoint now"; no note field) and Appoint successor (dialog C, compact
  declared, with the 421 in a comment). The position picker has its three
  configurations. Arrange cover reuses `SetActingHeadDialogComponent`, with the
  7-day warning added.
- Confirms through `AmConfirmService.ask()`: Record departure, Start new head
  today, Withdraw appointment.
- The word "handover" appears nowhere in the interface.
- Tests: one spec per state against the matrix, one per save path, the
  empty-ledger renderings, the view without `org:manage`, and layout specs for
  both dialogs. Then mutation checks, the full suites, the browser check with
  intercepted states, and SYSTEM-REFERENCE.md.

## 7. Decisions (CC-127a, Ahmad, 20 Oct)

- **Option A, in this PR.** `GET /organization/units/:id/head` is extended
  additively: same route, same `org:view` gate, no migration, no new write. Every
  existing field is kept for older callers.
- **D7 applies to this panel.** Person names in the response only when the caller
  holds `users:view`, otherwise null. The panel shows "Head assigned" / "Cover
  arranged" where a name would go. Position titles show to every `org:view`
  holder.
- **D13 moves here from PR B:** the holder query gains `position.isActive: true`.
- **The headship reads live in one shared file**,
  `backend/src/foundation/organization/unit-headship.ts` (CC-127b), because lane
  B's ACC-244 builds on it: `findCurrentHeadHolders()` and
  `findRunningActingCover()`.
  `task-authority.service.ts` is not changed in this PR.
- **Never reconstruct from AuditLog.** Where the ledger has no row, the field is
  null and the panel says what is not recorded.

### Added while building, and why

- **`scheduledCover`.** The cached `actingHeadUserId` is written when a cover is
  ARRANGED, even one starting later, and cleared only by End cover. So a cover
  scheduled ahead is not "in force" by the requested window, yet Arrange cover
  refuses while it exists and End cover accepts. The panel treats a scheduled
  cover as "covered", so no state offers an action its endpoint refuses.
- **Dialog C's position is always read-only.** `DeclareHandoverDto` takes no
  position: the successor receives the outgoing head's position
  (`declareHandover()`). The drawing's select for two or more positions would
  offer a choice the server ignores. Appoint head (dialog A) does take one, so the
  three configurations apply there.

## 8. Decisions (CC-127b, Ahmad, 20 Oct)

- **Dialog C loses its read-only Position block.** It measured 434 (EN) and 454
  (AR) at 1280, over the 420 cap. The Replaces strip already names the position,
  and `POST /handover` takes none. C stays compact.
- **The compact field gaps are ACC-251**, not this PR: `am-field` adds its 4px
  flex gap on top of compact's 2px margins, so every compact field is 79 where
  artboard 13 draws 71. Not touched here.
- **`running-acting-cover.ts` became `unit-headship.ts`**, exporting
  `findCurrentHeadHolders()` and `findRunningActingCover()`.
