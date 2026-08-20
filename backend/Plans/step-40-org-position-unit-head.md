# Step 40 — Org-Wide OrgPosition Redesign With Explicit Unit Head Designation
# ACC-40: design-only ticket. No implementation code, no schema migration,
# is produced under this ticket — this document is the plan a follow-up
# implementation ticket will build from, same process as ACC-28
# (step-28-resource-scoped-roles.md).

---

## REVISION NOTE — Read First

The first revision of this document gave `OrgUnit` its own standalone
`headUserId` field — a direct, stored pointer to whoever the Head was,
set and cleared by dedicated head-management actions independent of
`User.positionId`.

**That shape was rejected on review and replaced.** Reasoning: this
whole ticket's premise is that a Unit Head is a *position someone
holds* (Section 2.1's `isUnitHeadPosition` flag), not a separate fact
about the `OrgUnit` recorded somewhere else. Storing `headUserId`
independently would have created **two sources of truth for the same
question** — "does this user run this unit" would be answerable two
different, potentially contradictory ways: by checking `OrgUnit.headUserId`,
or by checking whether the user holds an `isUnitHeadPosition: true`
position scoped to that unit. Nothing in the original design would have
kept those in sync automatically; a position change made through the
ordinary profile-edit path would silently leave a stale `headUserId`
behind.

**The corrected design: "who is the Head" is fully *derived* — whoever
currently, actively holds an `isUnitHeadPosition: true` position scoped
to that unit — never stored as its own fact.** This is the same
discipline `step-28`'s own Retrospective Notes established: prefer
deriving an answer from data that already has to exist and stay
correct, over introducing a second place the same fact can drift out of
sync. Sections 2.2, 2.3, 2.5, and 2.6 below are rewritten around this;
`pendingHeadUserId`/`headHandoverEffectiveDate`/`isHeadVacant`/
`headVacantSince`/`actingHeadUserId` remain on `OrgUnit`, but strictly
as **caches of a derived computation**, for the same reason
`WorkflowInstanceStage.isUnassigned` is a cache of a resolvable
condition rather than a second source of truth for it — not as
independent facts a Head-management action sets directly.

---

## 1. OVERVIEW

### What This Document Is

A concrete design reversing `OrgPosition` from its current (theoretical,
never-exercised) per-org-unit scoping back to strictly org-wide
positions, and introducing a genuinely new concept — an explicit
"Unit Head" designation, **derived from who holds a specific kind of
position**, not a separately-stored fact — to serve the need the
abandoned `ORG_UNIT_HEAD` workflow assignee strategy has stood for,
unimplemented, since it was first named in the enum. Also covers: a
per-unit single-assignee flag on `OrgPosition` plus a dedicated
head-conferring flag, a deliberate-handover mechanism reusing
`RoleService`'s last-holder lockout pattern as a base (extended, not
copied unchanged), mandatory `positionId`/`primaryOrgUnitId` for active
users with a real backfill answer, vacancy detection and
hierarchy-escalation reusing the `isUnassigned` pattern's *shape* (on
new `OrgUnit`-level fields, not bolted onto `WorkflowInstanceStage`), a
narrowly-scoped "Acting Head" flag for unit-head coverage specifically —
deliberately the one piece of position-holding-adjacent design that does
**not** derive from position-holding, because covering for an
absent/vacant Head without becoming the Head is exactly what it needs
to represent — a *separate*, genuinely independent User-level
"acting-for-a-unit" concept recovered from a seven-month-old dropped
product-owner note, a live defect found in already-shipped ACC-28 code
during this review (out-of-office substitution silently bypassed by two
real authorization checks), a unified audit-trail stamp recording
*why* delegated authority applied wherever it did, and a position-to-role
mapping mechanism so head-conferring authority can carry real
permissions, not just workflow eligibility.

### Why This Is Needed

Confirmed by direct investigation this session (full ground truth
already captured in ACC-40's own Technical Notes — restated here only
where a design decision depends on the specific number or shape found,
not reproduced in full):

- `OrgPosition.orgUnitId`'s per-unit scoping is schema capability that
  has **never once been exercised** — 10/10 live rows across the only
  tenant are org-wide, the seed script only ever creates org-wide rows,
  and no unit-scoped row has ever been created even manually through the
  admin UI. This is not a feature being removed out from under real
  usage.
- `SYSTEM-REFERENCE.md` Section 5.4 independently confirms task
  escalation (`validateEscalationTarget()`) is the *only* live
  `OrgPositionService` consumer today — the code's own forward-looking
  comment naming Committees/Meetings/Documents/CAPA/Audits as future
  consumers is unrealized. This redesign does not have to preserve
  behavior for any consumer that doesn't exist yet.
- `ORG_UNIT_HEAD` has never had a real design — exactly one mention each
  in `module-designs.md` and `CLAUDE.md`, both just the strategy's name
  in an enum listing, zero resolution logic. `SYSTEM-REFERENCE.md`
  Section 2.5 / Tier 1 (CLOSED ACC-33) confirms it currently resolves to
  an empty pool (changed from throwing) and was removed from the
  frontend assignee-strategy dropdown specifically because it was never
  genuinely implemented. This document is that implementation, designed
  from scratch — not a completion of a pre-existing design, because none
  exists.
- `OrgUnit` has no `headUserId`/`headPositionId` field today — "head" is
  not a stored concept anywhere. Its only two back-relations are
  `positions: OrgPosition[]` and `users: User[]`. (This document does
  **not** add `headUserId` either, per the Revision Note above — Head
  stays derived.)
- Only 1 of 3 currently-**ACTIVE** demo users has both `positionId` and
  `primaryOrgUnitId` set. This is a real backfill number, not a
  hypothetical — any mandatory-field proposal must account for it
  directly, not assume a clean slate.
- `step-02-organization-structure.md` Section 11 ("BUSINESS RULES
  (confirmed by product owner)") contains a single, never-elaborated
  line — `"Users: one primary unit + optional acting-as unit with expiry
  date — note for Step 9"` — explicitly deferred to Step 9 and then
  silently dropped when Step 9 was actually built. Confirmed via a fresh
  grep of `step-09-user-management.md` for the exact phrase: zero
  matches. This is a distinct, genuinely independent concept from
  `OrgUnit.actingHeadUserId` (2.6) — recovered and designed in 2.7.
- Directly reading `workflow.service.ts` during this review surfaced a
  real, already-shipped (ACC-28) defect: `triggerTransition()`'s
  `ASSIGNEE_POOL` gating check and `submitApproval()`'s eligibility check
  both bypass out-of-office substitution — see 2.6.1.

---

## 2. PROPOSED DESIGN

### 2.1 `OrgPosition` — Org-Wide Catalog, Per-Unit Single-Assignee, Head-Conferring Flag

```prisma
model OrgPosition {
  id                 String       @id @default(cuid())
  organizationId     String
  nameEn             String
  nameAr             String?
  grade              Int
  isSingleAssignee   Boolean      @default(false)   // NEW
  isUnitHeadPosition Boolean      @default(false)   // NEW
  isActive           Boolean      @default(true)
  createdAt          DateTime     @default(now())
  updatedAt          DateTime     @updatedAt

  organization       Organization @relation(fields: [organizationId], references: [id])
  users               User[]

  @@index([organizationId])
  @@unique([organizationId, nameEn])
}
```

Removed: `orgUnitId String?`, the `orgUnit OrgUnit?` relation, and the
`@@index([orgUnitId])`. The unique constraint narrows from
`(organizationId, orgUnitId, nameEn)` to `(organizationId, nameEn)` —
now a genuinely simple "one position name per tenant" rule, matching
real HR/compliance practice: a position title like "Department Manager"
is **one defined catalog entry** ("this title exists, at this grade"),
not a per-department clone of the same title with an independently
different grade. `OrgUnit.positions OrgPosition[]` (the reverse
relation) is removed from `OrgUnit` in the same migration.

**Migration shape — confirmed genuinely a no-op for existing data.**
Every one of the 10 live `OrgPosition` rows (the only tenant with any
data) already has `orgUnitId: null` — dropping the column drops no
non-null values, and since nothing else in the codebase holds a foreign
key *to* `OrgPosition.orgUnitId`, this is a straightforward
`npx prisma migrate dev` schema diff: `DROP COLUMN "orgUnitId"`,
`DROP INDEX`, constraint change, plus the two new boolean columns. No
data-transformation script needed alongside it.

**`isSingleAssignee` — scoped per `(positionId, primaryOrgUnitId)`, not
per `positionId` alone.** This is the corrected understanding: the
position *catalog entry* is tenant-wide ("Department Manager" is one
row), but whether more than one person may simultaneously *hold* it is
a **per-org-unit** question — one Department Manager per department,
not one Department Manager across the entire tenant. Concretely: before
setting `User.positionId` to a position where `isSingleAssignee: true`,
count existing `ACTIVE` holders of that **same position, in that same
target unit**:

```typescript
const existingHolders = await this.prisma.user.count({
  where: {
    organizationId,
    positionId: targetPositionId,
    primaryOrgUnitId: targetUser.primaryOrgUnitId,  // note: including null
    status: 'ACTIVE',
  },
});
if (existingHolders >= 1 && !isNoOpReassignment) {
  throw new ConflictException(
    'This position already has an active holder in this org unit',
  );
}
```

`primaryOrgUnitId: null` is not a special case skipped by this check —
it is simply one more partition value. A genuinely org-wide,
`isSingleAssignee: true` position (e.g. a tenant that wants exactly one
"CEO" with no unit scoping at all) is enforced correctly by this same
query: every holder with `primaryOrgUnitId: null` falls into the same
partition, so "at most one holder" still applies tenant-wide for that
specific case — the per-unit scoping and the legacy tenant-wide
behavior are the same mechanism, not two different code paths.

**`isUnitHeadPosition` — requires `isSingleAssignee: true`, enforced at
save time.** `createPosition()`/`updatePosition()` reject
`isUnitHeadPosition: true` combined with `isSingleAssignee: false` with
a `BadRequestException`. **Why**: a position that confers Head authority
but permits multiple simultaneous holders in the same unit would
recreate exactly the ambiguity this whole design exists to remove — "who
is the head of this unit" would once again have more than one possible
answer at the same moment, the same unresolved question `ORG_UNIT_HEAD`
has had since it was first named with no real design behind it. Forcing
the combination to be internally consistent at the schema-validation
layer, rather than trusting every future caller to remember the
relationship, is the same discipline `CreateOrgPositionDto`'s existing
grade bounds (`@Min(1) @Max(10)`) already apply to a different field —
validate the invariant once, centrally, not by convention.

A user holding an `isUnitHeadPosition: true` position with
`primaryOrgUnitId: null` is a valid but inert state — they hold a
head-conferring position scoped to no particular unit, so they will
never resolve as anyone's Head (2.2's derivation query is keyed on
`primaryOrgUnitId`, not on holding the position alone). Not an error;
simply a state where the position grants no head authority anywhere,
same as any other org-wide position today.

### 2.2 "Who Is This Unit's Head" — Derived, Not Stored

**No `headUserId` field anywhere.** The answer to "who currently heads
org unit U" is always computed the same way, on demand:

```typescript
const headHolders = await this.prisma.user.findMany({
  where: {
    organizationId,
    primaryOrgUnitId: orgUnitId,
    status: 'ACTIVE',
    position: { isUnitHeadPosition: true },
  },
});
```

Under normal circumstances this returns **zero or one** row — zero
means the unit is vacant (2.5); one is the current Head. It can
legitimately return **two** rows during an active, declared handover
(2.3) — that is not a bug or a race condition to guard against, it is
the literal, intended representation of "two people are both currently
authorized as Head of this unit," achieved by two users genuinely both
holding an `isUnitHeadPosition: true` position scoped to the same unit
at once.

**Cross-position uniqueness rule — enforced *alongside*, not instead
of, 2.1's per-position check.** A tenant could, in principle, flag more
than one distinct `OrgPosition` as `isUnitHeadPosition: true` (e.g. both
"Department Head" and "Acting Department Chief" independently marked
head-conferring). 2.1's per-position check alone would not catch one
person holding "Department Head" in unit U while a *different* person
simultaneously holds "Acting Department Chief" in the same unit U —
each position's own single-assignee cap is individually satisfied, but
the unit now has two people with head-level authority from two
different positions. A second check, run whenever *any*
`isUnitHeadPosition: true` position is being assigned, closes this:

```typescript
const anyHeadHolders = await this.prisma.user.count({
  where: {
    organizationId,
    primaryOrgUnitId: targetUser.primaryOrgUnitId,
    status: 'ACTIVE',
    position: { isUnitHeadPosition: true },
  },
});
if (anyHeadHolders >= 1 && !isNoOpReassignment && !isDeclaredHandoverBypass) {
  throw new ConflictException(
    'This org unit already has an active Head-position holder',
  );
}
```

Both checks run for a head-conferring position assignment: 2.1's
per-position check and this cross-position check. In practice the
cross-position check is the stricter of the two for any assignment
*of a head-conferring position specifically* (it would already reject
what the per-position check alone would have permitted, per the example
above) — both are kept as explicit, separate validations rather than
treating one as subsuming the other, so a future reader sees the two
distinct real-world constraints they each name, not one query with an
unexplained extra condition folded in.

**The one deliberate bypass**: `isDeclaredHandoverBypass` above is not
a general escape hatch — it is `true` only when the assignment is being
made *by* the dedicated handover-declaration method (2.3), and only for
the exact two users named in that specific open handover. No other code
path may set it. This is the only way a unit is ever permitted to
(temporarily) have two Head-position holders at once.

### 2.3 Deliberate Handover — Pending Discussion #1, Resolved With a Recommendation

**The problem stated precisely**: `RoleService`'s
`TENANT_ADMIN`-count lockout (`deactivateRole()`/`removeRoleFromUser()`)
is a pure **count-based block** — `assignmentCount <= 1` throws,
unconditionally, with no path to legitimately go from one holder to a
different one without a moment where the count is either 0 (briefly no
admin — already blocked entirely today) or a caller adds the new admin
*before* removing the old one with nothing checking "is this the same
logical role, mid-succession." A Unit Head handover is exactly this
case in the real world: an outgoing Head trains a successor for a
period before formally stepping down — both are legitimately "the Head"
during that window.

**Recommended design, reworked around position-holding (per the
Revision Note)**: a handover is not a change to a separately-stored
"who is Head" fact — it is a **declared, temporary, logged exception**
that grants the incoming successor the same `isUnitHeadPosition: true`
position the outgoing holder already holds, *before* the outgoing
holder's own holding of it ends — deliberately violating 2.1/2.2's
normal single-holder caps, but only through this one dedicated code
path, only for the two people it explicitly names, and only for the
declared window.

`OrgUnit` carries two nullable cache fields for the currently-open
handover (if any) — not the source of truth (the actual state is two
real `User.positionId` assignments), but a cheap read for "is a
handover in progress here" without re-deriving it from a position
count each time:

```prisma
model OrgUnit {
  // ...existing fields unchanged...
  pendingHeadUserId         String?     // NEW — the declared incoming successor, only set during an open handover
  headHandoverEffectiveDate DateTime?   // NEW — when the handover auto-completes
  isHeadVacant              Boolean     @default(false)  // NEW — cache, see 2.5
  headVacantSince           DateTime?   // NEW
  actingHeadUserId          String?     // NEW — see 2.6, independent of position-holding

  pendingHead                User?       @relation("OrgUnitPendingHead", fields: [pendingHeadUserId], references: [id])
  actingHead                  User?       @relation("OrgUnitActingHead", fields: [actingHeadUserId], references: [id])
}
```

New append-only audit log — reflecting, per this review round, that
every event here is fundamentally a **position-holding transition for
a head-conferring position** (except `ACTING_*`, which deliberately
never touches position-holding — see 2.6):

```prisma
model OrgUnitHeadEvent {
  id             String                @id @default(cuid())
  organizationId String                // denormalized from OrgUnit.organizationId, set once at creation
  orgUnitId      String
  userId         String                // the person the event is about
  positionId     String?               // the specific isUnitHeadPosition position involved; null only for ACTING_* events
  action         OrgUnitHeadAction
  effectiveDate  DateTime
  reason         String?
  approvedBy     String?               // userId — nullable, not every event needs approval
  createdAt      DateTime              @default(now())

  orgUnit        OrgUnit               @relation(fields: [orgUnitId], references: [id])
  user           User                  @relation(fields: [userId], references: [id])
  position       OrgPosition?          @relation(fields: [positionId], references: [id])

  @@index([organizationId])
  @@index([orgUnitId])
  @@index([userId])
}

enum OrgUnitHeadAction {
  ASSIGNED             // direct appointment to a head-conferring position, no handover — e.g. filling a vacancy
  HANDOVER_DECLARED    // incoming successor granted the same position, outgoing holder unchanged
  HANDOVER_COMPLETED   // outgoing holder's position cleared, incoming successor now sole holder
  HANDOVER_CANCELLED   // incoming successor's position grant reverted, outgoing holder unaffected
  VACATED              // head-conferring position cleared with no successor declared
  ACTING_ASSIGNED       // 2.6 — does not touch position-holding
  ACTING_ENDED           // 2.6 — does not touch position-holding
}
```

Deliberately modeled after `CommitteeMembershipEvent`'s exact shape —
`action` enum, `effectiveDate` distinct from `createdAt`,
`reason`/`approvedBy` both nullable. Same precedent, same reasoning: an
append-only ledger answering "who held this authority, when, and why."

**Declaring a handover** (permission: `org:manage` — see 2.3's
permission note below): a dedicated service method, *not* the ordinary
`UserService.updateProfile()` path —

1. Validates the caller-supplied incoming user does not already hold
   any `isUnitHeadPosition: true` position elsewhere with a conflicting
   single-assignee constraint (an ordinary check, unrelated to this
   handover).
2. Sets the incoming user's `positionId` to the *same* head-conferring
   position the outgoing holder holds — bypassing 2.1's/2.2's normal
   caps via `isDeclaredHandoverBypass`, and *only* for this specific
   pair.
3. Sets `OrgUnit.pendingHeadUserId` (the incoming user) and
   `headHandoverEffectiveDate` on the unit.
4. Writes one `HANDOVER_DECLARED` event (`userId`: incoming successor,
   `positionId`: the head position, `effectiveDate`: the declared
   cutoff, `reason`: caller-supplied).

**During the window** (`now() < headHandoverEffectiveDate`), 2.2's
derivation query genuinely returns both users — this *is* the
"declared dual-holder transition period," represented with no special
casing anywhere else in the system: any code resolving "who heads this
unit" (2.5's escalation resolver, `ORG_UNIT_HEAD` assignee resolution)
naturally sees both, because both are, at the data level, actually true.

**What closes the window** — recommend **both**, not a single mechanism:

- **Automatic**: `SlaMonitorProcessor`'s existing sweep (already
  extended for 2.5's vacancy check) additionally checks, per open
  handover (`OrgUnit` rows with `pendingHeadUserId` set), whether
  `now() >= headHandoverEffectiveDate`; if so, clears the **outgoing**
  holder's `positionId` (the one who is not `pendingHeadUserId`),
  clears `pendingHeadUserId`/`headHandoverEffectiveDate`, writes one
  `HANDOVER_COMPLETED` event (`userId`: the incoming successor, now
  sole holder).
- **Explicit early completion**: a "Complete Handover Now" action
  performing the identical clear-outgoing-holder + cache-clear +
  `HANDOVER_COMPLETED` event immediately, for the case where the
  successor is ready before the declared date.
- **Explicit cancellation**: a "Cancel Handover" action reverting the
  **incoming** successor's `positionId` grant (clearing it, restoring
  them to whatever position they held before, or `null`), clearing
  `pendingHeadUserId`/`headHandoverEffectiveDate` — the original
  outgoing holder remains the sole Head, unaffected. Writes one
  `HANDOVER_CANCELLED` event.

**A deliberate divergence from the `RoleService` precedent, stated
explicitly**: `RoleService`'s lockout *unconditionally blocks* removing
the last `TENANT_ADMIN` — there is no concept of a tenant legitimately
having zero admins, ever. A Unit Head is different: a unit **can**
legitimately be headless for a period (someone resigns before a
replacement is named — an ordinary HR reality, not an error state).
This design therefore does **not** block clearing a Head-position
holder with no handover declared — it writes a `VACATED` event, and
lets 2.5's vacancy-detection-and-escalation mechanism be the actual
safety net, rather than a hard block preventing the removal in the
first place. Same shape of decision `step-28`'s document made choosing
*not* to copy `assertCommitteeAuthority()`'s literal-Chairman check —
reusing a precedent's *pattern* where it fits, not its exact behavior
where the underlying situation is actually different.

**Permission note**: Head-management actions (declare/complete/cancel a
handover, direct assign/vacate, Acting-Head assignment) are gated by
`org:manage`, **not** `positions:manage`. `SYSTEM-REFERENCE.md` Section
5.5 confirms `positions:view`/`positions:manage` gate
`OrgPositionController`'s CRUD on the **position catalog itself**
(defining "Department Manager exists, at grade 7") — a tenant-wide
catalog concept. Head-management actions don't edit the catalog at
all; they change *who leads a specific org unit*, which is an
`OrgUnit`-scoped leadership action, already the kind of thing
`org:manage` (per CLAUDE.md's Permission System list) governs for
`OrgUnit` structure/hierarchy generally. Gating these under
`positions:manage` would conflate "can define what positions exist"
with "can decide who leads this specific unit" — two different
authorities in practice (a platform-level HR/compliance admin
maintaining the position catalog is not necessarily the same person a
tenant delegates org-structure decisions to).

### 2.4 Mandatory `positionId`/`primaryOrgUnitId` for Active Users — Pending Discussion #2, Resolved With a Recommendation

**The real number**: only 1 of 3 currently-**ACTIVE** users satisfies
both fields today. 12 INACTIVE + 1 INVITED user have neither — not part
of this discussion (an inactive/invited user isn't currently doing
anything that would need a position).

**Recommendation: immediate blocking for new user creation/activation
only; no retroactive blocking of already-active users.** Reasoning:
retroactively blocking existing active users from *something* until
backfilled would mean 2 of the tenant's 3 real active accounts —
plausibly including whichever account is actually administering the
tenant day-to-day — lose access to some part of the system the moment
this ships, over a data-completeness gap unrelated to whatever they're
trying to do. Depending on exactly what got blocked, this risks a
**lockout with no self-service path** — the same category of risk
CLAUDE.md's existing last-admin-lockout protection (ACC-16) was built
to prevent, applied to a new field pair instead of role assignment.

**Concretely** (unaffected by this review round's other changes,
including 2.7's new `actingOrgUnitId`/`actingOrgUnitUntil` — see 2.7's
own explicit confirmation):
- `InviteUserDto`/the invite flow: `positionId` and `primaryOrgUnitId`
  become **required**, effective immediately, for every new invitation
  from the moment this ships.
- **Existing active users are not blocked from anything.** No new gate
  on login, no new gate on any existing screen.
- **The "backfill" is a remediation report, not a data-transformation
  script** — unlike every existing `backfill-*.ts` precedent in this
  codebase, which fill in objectively-derivable values. *Which
  position and which org unit a specific existing person belongs to is
  not programmatically derivable at all.* The mechanism: a query
  surfaced to Tenant Admins (dashboard widget, or a one-time
  notification run at rollout reusing the exact
  `Role.findFirst({ key: 'TENANT_ADMIN' })` →
  `UserRole.findMany()` → `NotificationService.create()` pattern
  already used elsewhere). The actual *fix* happens through the
  already-fully-wired `user-profile.component.ts` edit form — no new
  UI needed for the fix itself.
- **Scoped exception for `primaryOrgUnitId`, and a confirmed correction
  to this document's own original claim.** This section originally
  assumed `TenantService.bootstrap()` seeds zero `OrgUnit` rows for a
  brand-new tenant — **confirmed wrong during Phase 2 implementation**,
  verified directly against the current code, not left as an
  unreconciled assumption. `bootstrap()` already creates a root
  `OrgUnit` (`parentId: null`) if none exists, and always seeds all 10
  `DEFAULT_POSITIONS` (including "Director", the highest-graded) via
  `OrgPositionService.seedDefaultPositions()` — both unconditionally,
  on every bootstrap.

  This has a real, immediate consequence, not just a documentation
  correction: `PlatformTenantService.createTenant()` is the one live
  call site of `UserService.invite()` today, and it always calls
  `bootstrap()` first — so by the time it invites the tenant's first
  admin, an active `OrgUnit` and the "Director" position both already
  exist. The conditional check below is therefore **not dormant** for
  this call site; it is immediately true. Making `positionId`/
  `primaryOrgUnitId` required without also fixing this call site would
  have broken tenant creation outright — confirmed via `tsc --noEmit`
  the moment `positionId` became a required DTO field.

  **The fix, built in Phase 2**: `TenantService.resolveDefaultTenantAdminAssignment(organizationId)`
  resolves both ids from what `bootstrap()` already guarantees — the
  seeded "Director" `OrgPosition` and the root `OrgUnit` — throwing an
  invariant-violation error (not a user-facing exception) if either is
  somehow missing. `PlatformTenantService.createTenant()` calls this
  immediately after `bootstrap()` and passes both ids into `invite()`.

  The conditional-mandatoriness rule itself remains correct and
  necessary as a general safeguard, independent of the correction
  above: `primaryOrgUnitId`'s mandatoriness is conditional on the
  tenant having at least one active `OrgUnit`
  (`orgUnit.count({ where: { organizationId, isActive: true } }) > 0`)
  — not a blanket "always required" rule. This still matters for any
  *future* invite path that might run before `bootstrap()`, or a
  tenant whose only `OrgUnit` later gets deactivated — even though, for
  the one call site that exists today, it is never actually the reason
  `primaryOrgUnitId` goes unset.

### 2.5 Vacancy Detection and Hierarchy Escalation — Pending Discussion #3, Resolved With a Recommendation

**`isHeadVacant`/`headVacantSince` — now a cache of a position-holding
query, not of `headUserId IS NULL`.** "Vacant" means: zero `ACTIVE`
users hold an `isUnitHeadPosition: true` position scoped to this unit,
**and** `actingHeadUserId` is also null (an Acting Head means the unit
is covered, not vacant, even with no permanent position-holder — see
2.6). This is a real query (a join + count), not a trivial null check —
if anything, a stronger reason than before to cache the *result* as an
explicit boolean for the sweep's before/after comparison (2.5.1),
rather than re-running the join on every read that only needs to know
"did this change since last time."

**A broader trigger surface than the first revision assumed.** Because
Head status is now derived from *any* user's `positionId`/
`primaryOrgUnitId`, not just from dedicated head-management actions,
**any** change to those two fields on **any** user — an ordinary
profile edit, a user deactivation, a position being deactivated out
from under its holders — can flip a unit's derived vacancy status.
Recommendation: `UserService.updateProfile()`/`deactivate()` (and
`OrgPositionService.deactivatePosition()`) call a shared
`refreshOrgUnitHeadVacancy(orgUnitId, organizationId)` helper whenever
they touch a user who held (before or after the change) an
`isUnitHeadPosition: true` position — the same helper the dedicated
handover/head-assignment methods (2.3) already call after their own
mutations. The periodic sweep (2.5.1) remains the safety net for
anything this entry-time coverage misses, exactly as it already is for
`isUnassigned`.

**The escalation resolver — a genuine resolver, not
`isInSameOrParentOrgUnit()` reused directly, and returning a pool
(`string[]`), matching `resolveAssigneeRaw()`'s established convention
across this codebase rather than a single nullable id.** That existing
method is a *validator*: given one already-known target, walk upward
checking for equality — it answers "is this pre-selected person
allowed," not "who should this be." The new method enumerates
candidates at a unit and only walks to the parent when that unit's own
candidate set is empty:

**Placement, confirmed: `OrgUnitService`, not `WorkflowService`.**
`resolveActingHeadForOrgUnit()` is a pure org-structure query — it never
reads a `WorkflowStage`/`WorkflowInstance`, only `User`/`OrgUnit`. It has
two independent callers: plain vacancy detection (this section, no
workflow involvement at all) and, later, the workflow engine's
`ORG_UNIT_HEAD` assignee resolution (2.6.2's `resolveApproverPool()`
case and `resolveAssigneeRaw()`'s own new case). It belongs in the
domain it actually describes, with `WorkflowService` calling *into*
`OrgUnitService` for it — not the reverse, and not duplicated in both
places.

```typescript
async resolveActingHeadForOrgUnit(
  orgUnitId: string,
  organizationId: string,
): Promise<string[]> {
  let current: string | null = orgUnitId;
  while (current) {
    const holders = await this.prisma.user.findMany({
      where: {
        organizationId,
        primaryOrgUnitId: current,
        status: 'ACTIVE',
        position: { isUnitHeadPosition: true },
      },
      select: { id: true },
    });
    if (holders.length > 0) {
      return holders.map((h) => h.id);
    }

    const unit = await this.prisma.orgUnit.findFirst({
      where: { id: current, organizationId },
      select: { actingHeadUserId: true, parentId: true },
    });
    if (!unit) return [];
    if (unit.actingHeadUserId) return [unit.actingHeadUserId];

    current = unit.parentId;
  }
  return [];
}
```

Same `while (current)` + `parentId` traversal *shape* as
`isInSameOrParentOrgUnit()` — same precedent, adapted body. Note this
resolver needs **no special-case logic for an in-progress handover** —
during a declared handover, the `holders` query above naturally returns
both the outgoing and incoming users, because both genuinely hold the
position at that moment (2.3). The pool is sized 1 in the normal case,
2 during a handover, by construction, with nothing extra to check.

**THE decision this ticket flagged as needing a real answer: does
anything actually block?** Recommendation, unchanged by this review
round's other corrections — **partial vacancy never blocks; only
full-chain exhaustion blocks, and that terminal case is exactly what
`isUnassigned`'s existing semantics already mean.**

The walk always attempts substitution up the hierarchy. Any resolution
landing on an *ancestor's* Head (not the unit's own) fires a
lightweight, non-blocking notification to that ancestor Head ("You are
currently acting for [child unit], which has no Head of its own") —
visible, not gating; the underlying business action proceeds normally
with the substitute as the resolved actor. **Only** the fully-exhausted
case — the walk reaches the top of the hierarchy and still returns an
empty pool — is where blocking genuinely happens, and it is not a *new*
blocking behavior: a workflow stage whose `ORG_UNIT_HEAD` resolution
returns `[]` is, by `checkAndFlagUnassignedStage()`'s existing logic,
already an "unreachable transition" — only a new assignee-strategy case
inside `resolveAssigneeRaw()` calling this new resolver is needed, no
new blocking concept.

**Terminal fallback — Tenant Admin notification**: reuses the pattern
already implemented twice in this codebase
(`notifyTenantAdminsOfCoverageGap()`, `notifyTenantAdminsOfUnassignedStage()`)
— `Role.findFirst({ key: 'TENANT_ADMIN' })` → `UserRole.findMany()` →
one `NotificationService.create()` per admin, naming the specific
`OrgUnit` and, where relevant, the specific blocked transition/instance.

#### 2.5.1 Detection Timing — Entry Check Plus Periodic Sweep

Mirrors `checkAndFlagUnassignedStage()`/`sweepUnassignedStages()`'s
exact two-part shape:

- **Entry-time check** (`refreshOrgUnitHeadVacancy()`, above): whenever
  a change could plausibly affect a unit's derived head-holder count,
  re-run the holder query, update `isHeadVacant`/`headVacantSince`, and
  if now newly vacant, run the escalation walk once — only a
  fully-exhausted result notifies Tenant Admins at this point.
- **Periodic sweep**: extend `SlaMonitorProcessor`'s existing job with a
  new `sweepOrgUnitVacancies()` step (alongside `sweepOverdueTasks()`/
  `sweepUnassignedStages()`, and 2.3's handover-cutoff check) — not a
  new BullMQ queue. For every `OrgUnit` with `isHeadVacant: true`,
  re-run the holder query; symmetric set/clear exactly like
  `sweepUnassignedStages()`: clear silently if a holder now exists (no
  "recovered" notification); if still vacant, re-check
  `wasFullyExhausted` (read before this sweep pass touches anything)
  against `isNowFullyExhausted` from a fresh escalation walk, and
  notify **only** on a genuine `false → true` transition — the
  identical duplicate-notification guard `sweepUnassignedStages()`
  already uses.

**A real gap found during Phase 6 implementation, resolved here before
building it**: `isHeadVacant` alone cannot serve as the
`wasFullyExhausted`/`isNowFullyExhausted` comparison
`sweepUnassignedStages()`'s guard needs — it captures only *this unit's
own* vacancy, not whether escalation to an ancestor currently covers it.
A unit can stay `isHeadVacant: true` for weeks while its escalation
coverage silently changes (an ancestor's own Head departs, then a new
one is appointed) — a distinct fact `isHeadVacant` was never designed to
carry. Investigated first, per standing practice: confirmed (grep across
`sla-monitor.processor.ts`, `schema.prisma`, `notification/`, every
`@Processor` in the codebase, and every Plans file) that **no existing
mechanism anywhere in this codebase already does a periodic
"remind-again-while-still-unresolved" pattern** — `fireEscalation()`/
`fireTaskEscalation()` are fire-once-per-rule (`escalatedRuleIndexes`/
`escalatedAt`, no re-arm), and `sweepUnassignedStages()` itself is
fire-once-on-transition, explicitly silent on every subsequent pass by
design. This is new, not a reuse of an existing pattern.

**Two new `OrgUnit` fields, added in this same Phase 6 migration**:

```prisma
model OrgUnit {
  // ...2.3's fields unchanged, plus:
  isHeadFullyUnresolved             Boolean   @default(false)  // NEW — mirrors WorkflowInstanceStage.isUnassigned's exact role, one level deeper than isHeadVacant
  headFullyUnresolvedLastRemindedAt DateTime?                   // NEW — set on every notification (first + every reminder), cleared entirely on recovery
}
```

`isHeadFullyUnresolved` is the real `wasFullyExhausted`/
`isNowFullyExhausted` comparison target — read fresh at the top of each
sweep pass (before this pass touches anything), compared against a
freshly-run escalation walk, exactly mirroring how
`sweepUnassignedStages()` reads `wasUnassigned = instanceStage.isUnassigned`
before its own update. `headFullyUnresolvedLastRemindedAt` exists for the
periodic-reminder mechanism below — cleared to `null` the moment the unit
is no longer fully unresolved (either recovered entirely, or now covered
by escalation), never left stale.

**Periodic reminder while still fully unresolved — a genuinely new
mechanism, not a copy of `sweepUnassignedStages()`'s fire-once shape**:
a unit left with *nobody* able to act — the fully-exhausted case, the
only one that ever blocks anything — is a materially more urgent
situation than a routine unassigned-transition warning, and paging a
Tenant Admin exactly once, permanently, for a problem that might persist
for months, is a real gap. Resolved as an explicit, separate reminder
cadence layered on top of `isHeadFullyUnresolved`'s own false→true
guard, not a replacement for it:

```typescript
const HEAD_VACANCY_REMINDER_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000; // 2 days — named constant, not a magic number buried in sweep logic
```

Sweep logic, per still-vacant unit, after the recovery check above:

1. Read `wasFullyUnresolved = orgUnit.isHeadFullyUnresolved` (before this
   pass touches anything). Run the escalation walk fresh; `isNowFullyUnresolved = pool.length === 0`.
2. **Transitioned** (`wasFullyUnresolved !== isNowFullyUnresolved`):
   update `isHeadFullyUnresolved` to the new value. If it became `true`:
   also set `headFullyUnresolvedLastRemindedAt = now` and send the
   **first** notification. If it became `false` (an ancestor got
   covered): clear `headFullyUnresolvedLastRemindedAt` to `null`,
   silently — no "resolved by escalation" notice, same silent-recovery
   precedent as everywhere else in this design.
3. **Not transitioned, still fully unresolved**: check
   `now - headFullyUnresolvedLastRemindedAt >= HEAD_VACANCY_REMINDER_INTERVAL_MS`.
   If due, send a **reminder** notification and bump
   `headFullyUnresolvedLastRemindedAt = now`. If not due, stay silent.
4. **Not transitioned, still only partially covered by escalation**:
   silent — matches "partial vacancy never blocks or notifies."

The entry-time check (`refreshOrgUnitHeadVacancy()`) gets the identical
treatment on its own one-time escalation walk: if it returns empty, set
`isHeadFullyUnresolved: true` + `headFullyUnresolvedLastRemindedAt: now`
and send the first notification directly — the sweep's job from that
point on is purely to catch drift and handle the reminder cadence, not
to re-detect the initial transition.

**Reminder wording states the actual elapsed duration, computed from
`headVacantSince`** (already-existing field, no new field needed for
this) — e.g. "has been unresolved for 6 days" — rather than a generic
repeat of the first notification's sentence. Gives the Tenant Admin real,
actionable information (is this fresh or long-standing) instead of an
identical restatement. `notifyTenantAdminsOfOrgUnitVacancy()` takes an
`isReminder: boolean` parameter to select between the two wordings.

### 2.6 "Acting Head" — Coverage, Authority, and the Audit Trail — Pending Discussion #4, Resolved With a Recommendation

**Explicitly scoped**: coverage for **head-of-unit authority
specifically**, during an absence or a not-yet-resolved vacancy — not a
general dual-position mechanism for arbitrary `OrgPosition` holders.
That broader question is closed and out of scope. (Not to be confused
with 2.7's `User.actingOrgUnitId` — that answers "what unit is this user
currently also associated with," an independent, non-authority-bearing
axis; see 2.7's own cross-reference for the full distinction.)

**Still its own `OrgUnit`-level field, unaffected by this review
round's shift to derived position-holding — because it deliberately
represents the one case that is *not* position-holding.** `OrgUnit.actingHeadUserId String?`
(shown in 2.3's schema block) — a person standing in for Head-level
authority **without** being granted the `isUnitHeadPosition` position
itself, and without becoming eligible for any of 2.1/2.2's
single-assignee/cross-position checks (those checks only ever look at
`User.positionId`, which Acting Head never touches). This is the load-
bearing distinction from 2.3's handover mechanism: a handover's incoming
successor *does* receive the actual position (they are becoming the
real Head); an Acting Head *never* does (they are temporarily
authorized, then either the original Head returns or a real Head is
appointed later — never a succession outcome for the acting person
themselves, by design).

**Why a new field instead of reusing the existing
`User.outOfOfficeFrom`/`outOfOfficeTo`/`actingUserId` pattern
(`applyOutOfOfficeRouting()`, already built)**: that mechanism is
per-*user* — it requires the absent person to still exist and to have
set their own out-of-office window. It doesn't cover a genuine vacancy
(no "original Head" object to attach it to once they've actually
departed), and coverage may need to be arranged by a Tenant Admin
directly, not by the outgoing Head themselves. An `OrgUnit`-level field
covers both the absence case and the vacancy case with one mechanism.

**Resolution behavior**: 2.5's `resolveActingHeadForOrgUnit()` checks
`actingHeadUserId` at each unit only *after* finding zero actual
position-holders, and *before* walking to that unit's parent — an
Acting Head counts as "this unit is covered," stopping the walk at that
level, and does **not** set `isHeadVacant` (covered, not vacant).

**Audit trail: yes**, reusing the same `OrgUnitHeadEvent` log from
2.3 — `ACTING_ASSIGNED`/`ACTING_ENDED`, both written with `positionId:
null` (the one case in this log that is not a position-holding
transition, per 2.3's schema note). Same reasoning
`CommitteeMembershipEvent` already establishes as precedent: "who held
this authority, when, why" is one coherent question for a given
`OrgUnit`, regardless of whether the authority was a real position-
holding (`ASSIGNED`/`HANDOVER_*`/`VACATED`) or acting coverage
(`ACTING_*`) — one ledger, not two.

The remaining five subsections widen this section with what this
review round's investigation surfaced: a real defect in already-shipped
code, a real prerequisite gap, a unified audit-stamp mechanism, and the
full authority model for Acting Head coverage.

#### 2.6.1 A Live Defect Found in Already-Shipped ACC-28 Code

**Confirmed by directly reading `workflow.service.ts`, not assumed.**
There are two pool-resolution paths in this file:

- `resolveAssignee()` (the *public*, `private` wrapper): calls
  `resolveAssigneeRaw()`, then pipes the result through
  `applyOutOfOfficeRouting()` — this is the OOO-*aware* path, used for
  actually notifying/creating tasks (`resolveAndNotifyInitialAssignee()`,
  `fireTransitionActions()`'s `CREATE_TASK`/`SEND_NOTIFICATION`
  handling).
- `resolveAssigneeRaw()` (private, called directly in two other
  places): the OOO-*unaware* raw pool.

`triggerTransition()`'s `ASSIGNEE_POOL` gating check
(`workflow.service.ts:233-238`, its own comment explicitly dated
"ACC-28"):

```typescript
if (transition.triggerCondition === 'ASSIGNEE_POOL') {
  const pool = await this.resolveAssigneeRaw(fromStage, instance, organizationId);
  if (!pool.includes(actorId)) {
    throw new ForbiddenException('You are not in the resolved assignee pool for this stage');
  }
}
```

calls `resolveAssigneeRaw()` **directly** — bypassing
`applyOutOfOfficeRouting()` entirely.

`submitApproval()`'s eligibility check (`workflow.service.ts:343-346`)
calls a **completely different** method, `resolveApproverPool()`
(1131-1163) — which never calls `applyOutOfOfficeRouting()` either;
confirmed by grepping the entire file for `applyOutOfOfficeRouting` —
its **only** call site anywhere is inside `resolveAssignee()`.

A third call site shares the identical root cause:
`resolveUnassignedBlockingTransitions()` (975-1052, feeding both the
entry-time check and `SlaMonitorProcessor`'s sweep) also calls
`resolveAssigneeRaw()` directly (line 985) to decide whether a stage is
unassigned.

**The practical consequence, stated plainly**: the person `resolveAssignee()`
actually notifies/assigns (correctly OOO-substituted) can be a different
person than who is legitimately *allowed* to trigger an `ASSIGNEE_POOL`
transition or submit an approval (checked against the raw, non-substituted
pool). Concretely — an absent original assignee, who is not the one who
was actually notified, can still successfully trigger the transition or
submit the approval (still present in the raw pool); their own acting
user, who *was* the one notified, is rejected (`ForbiddenException`,
absent from the raw pool). This is backwards from what
`module-designs.md`'s Absence and Departure Management Pattern 1
describes.

**This predates ACC-40 — it shipped as part of ACC-28.** Not new scope
introduced by this redesign; a pre-existing gap this investigation
happened to surface while tracing how `ORG_UNIT_HEAD`'s pool would flow
through these same two gating checks.

**Recommended fix**: `triggerTransition()`'s `ASSIGNEE_POOL` check calls
`resolveAssignee()` in place of `resolveAssigneeRaw()` (it already has
everything `resolveAssignee()` needs — `fromStage`, `instance`,
`organizationId`). `resolveApproverPool()` gains the equivalent — either
call `applyOutOfOfficeRouting()` on its own result before returning, or
inline the same substitution logic (`resolveApproverPool()` is
`private`, so either shape is a purely internal change).
`resolveUnassignedBlockingTransitions()`'s own raw-pool read (line 985)
should switch to the same substituted read, for the identical reason —
an OOO-aware substitute filling an otherwise-empty raw pool should not
cause a stage to be incorrectly flagged unassigned.

**Flagged for an explicit decision — bundle with this implementation,
or ticket separately?** Recommendation: **bundle**, and the reason is
concrete, not just "while we're in there": 2.6.3's unified delegation
stamp includes an `OUT_OF_OFFICE_COVERAGE` reason specifically so an
audit trail can show "acted while covering for an absent colleague" —
but as long as this defect stands, an OOO substitute is *rejected*
before ever reaching the point where that stamp would be written, for
both of the two gated actions (`ASSIGNEE_POOL` triggers, approvals) this
document's own new `ORG_UNIT_HEAD` wiring depends on. Shipping 2.6.3's
stamp without this fix would leave half of it — the OOO half —
effectively untestable and unreachable in practice. That said: this is
the one item in this document still explicitly awaiting your own
go/no-go, unlike every other item above, which already carries a
settled recommendation you've reviewed and moved past.

#### 2.6.2 `resolveApproverPool()`'s Missing `ORG_UNIT_HEAD` Case

**Confirmed, not assumed**: `resolveApproverPool()` (1131-1163) has
exactly two cases — `COMMITTEE` and `ROLE`. Its own comment states the
`default` fallthrough plainly: *"Any other `assigneeStrategy` on a
multi-approver stage is a seed/config error — there is no well-defined
pool to size a threshold against"* — returns `[]`.

This means: **`submitApproval()`'s eligibility gate is currently a
complete no-op for `ORG_UNIT_HEAD`-strategy stages.**
`approverPool.length` is `0`, so `approverPool.length > 0 &&
!approverPool.includes(actorId)` never evaluates `true` — the
`ForbiddenException` branch is unreachable for this strategy today, and
would remain unreachable even after `resolveAssigneeRaw()` gains its own
`ORG_UNIT_HEAD` case (2.5's checklist item), because `resolveApproverPool()`
is a structurally separate method that case doesn't touch.

**Required addition, a real prerequisite this investigation surfaced —
not optional polish**: a new `ORG_UNIT_HEAD` case in
`resolveApproverPool()`, calling `resolveActingHeadForOrgUnit()` the
same way `resolveAssigneeRaw()`'s own new case will (2.5's checklist),
needing the identical calling-object-`orgUnitId` prerequisite. Without
this, `ORG_UNIT_HEAD` on a multi-approver (`PARALLEL`/`SEQUENTIAL`)
stage is unreachable for approval purposes even once every other piece
of this document ships.

#### 2.6.3 The Unified Delegation-Reason Stamp

Neither `WorkflowInstanceStage`, `WorkflowApproval`, nor `Task`/`TaskAssignee`
currently records *why* an actor was eligible — only *who* acted
(`actorId`/`approverId`/`completedById`), confirmed by reading all four
models directly. Per Ahmad's direct request, this covers **both**
delegation reasons this document now has — Acting Head coverage (2.6)
and out-of-office coverage (the pre-existing Pattern 1 mechanism) —
with **one unified shape**, not two separate ad hoc fields:

```prisma
enum DelegationReason {
  ACTING_HEAD               // eligibility came from OrgUnit.actingHeadUserId, not real position-holding
  OUT_OF_OFFICE_COVERAGE    // eligibility came from substituting in for an absent user via User.actingUserId
}
```

Added to `WorkflowInstanceStage` and `WorkflowApproval`:

```prisma
delegationReason  DelegationReason?
delegationContextId String?   // orgUnitId for ACTING_HEAD; the covered-for user's id for OUT_OF_OFFICE_COVERAGE
```

**Two narrow, single-actor helpers — siblings to the pool resolvers
already designed, not modifications to them.** Keeping pool resolution
(`resolveAssigneeRaw()`/`resolveApproverPool()`/`resolveActingHeadForOrgUnit()`)
returning a flat `string[]`, unchanged, avoids rippling this stamp back
into already-reviewed conventions. A separate, narrow "why was *this
specific* actor eligible" check runs only at the exact moment of
writing the stamp:

```typescript
// Already designed (2.5-adjacent) — reproduced here as this stamp's first input.
async resolveActingHeadOrgUnitIdForUser(
  actorId: string,
  orgUnitId: string,
  organizationId: string,
): Promise<string | null> {
  let current: string | null = orgUnitId;
  while (current) {
    const isRealHolder = await this.prisma.user.count({
      where: { id: actorId, organizationId, primaryOrgUnitId: current, status: 'ACTIVE', position: { isUnitHeadPosition: true } },
    });
    if (isRealHolder > 0) return null; // real position-holder — not "acting"
    const unit = await this.prisma.orgUnit.findFirst({ where: { id: current, organizationId }, select: { actingHeadUserId: true, parentId: true } });
    if (!unit) return null;
    if (unit.actingHeadUserId === actorId) return current; // the unit id they're acting FOR
    current = unit.parentId;
  }
  return null;
}

// NEW — the OOO-coverage sibling.
async resolveOutOfOfficeCoverageForUser(
  actorId: string,
  rawPoolUserIds: string[],
  organizationId: string,
): Promise<string | null> {
  const now = new Date();
  const coveredFor = await this.prisma.user.findFirst({
    where: {
      id: { in: rawPoolUserIds },
      organizationId,
      actingUserId: actorId,
      outOfOfficeFrom: { lte: now },
      outOfOfficeTo: { gte: now },
    },
  });
  return coveredFor?.id ?? null;
}
```

`resolveOutOfOfficeCoverageForUser()` is constrained to `rawPoolUserIds`
deliberately — `actorId` being *someone's* `actingUserId` tenant-wide is
not relevant; only whether they're covering for a person who was
actually part of *this* resolution's raw pool counts.

**Call sites**: at each point `actorId`/`approverId` is written —
`triggerTransition()`'s two `WorkflowInstanceStage.create()` calls, its
own `WorkflowApproval.upsert()` (the approval-path branch), and
`submitApproval()`'s `WorkflowApproval.upsert()` — call both helpers
(if the stage's `assigneeStrategy === 'ORG_UNIT_HEAD'`, the first; always,
the second, since OOO coverage can apply to any strategy's raw pool),
and stamp whichever resolves non-null. **Precedence when both could
theoretically resolve** (a rare edge case — an actor who is both the
acting head of a vacant unit *and* separately covering an absent
`ROLE`-based colleague in the same raw pool): check `ACTING_HEAD` first,
`OUT_OF_OFFICE_COVERAGE` second. The stamp records one reason, not a
set — a stated, deliberate simplification for an edge case this
document does not consider worth a richer shape.

**`TaskAssignee`, not `Task` — a correction from this document's own
earlier proposal, and a genuinely simpler design, stated explicitly.**
An earlier round of this investigation proposed a *pair* of new fields
directly on `Task` (`assigneeResolutionOrgUnitId`, captured at creation;
`completedAsActingHeadOfOrgUnitId`, re-derived at `complete()` time) —
correct in spirit, but more complex than necessary, and re-deriving at
completion time risks reflecting a *changed* situation rather than the
truth at the moment of assignment. `Task` already has a proper per-assignee
join model, `TaskAssignee` (confirmed: `Task.assignees TaskAssignee[]`,
already read via `include: { assignees: true }` in `complete()`, per-row
`userId`/`removedAt`). The corrected design: `TaskAssignee` gains the
same `delegationReason`/`delegationContextId` pair, stamped **once, at
the moment each `TaskAssignee` row is created** by `fireTransitionActions()`'s
`CREATE_TASK` handling — exactly the moment `resolveAssignee()` (already
OOO-aware) and, per 2.6.1's fix, a corrected `resolveAssigneeRaw()`-based
`ORG_UNIT_HEAD` case both have full, fresh knowledge of *why* each
resolved user was included. `Task.complete()` needs **no new fields at
all** — it already knows `completedById`; the delegation reason/context
is read from that one specific `TaskAssignee` row (`userId ===
completedById`), never re-derived. This is a strictly simpler,
more-correct-by-construction design than the earlier proposal, and
supersedes it — see Section 3's Non-Goals for the explicit note.

#### 2.6.4 Full-vs-Scoped Permission: The Explicit Distinction

**Out-of-office coverage grants scoped eligibility only — confirmed
correct, unchanged, no role/permission inheritance.** Confirmed by
re-reading `applyOutOfOfficeRouting()`'s full body: its only `prisma`
calls are `user.findMany()` (a read) plus `notificationService.create()`
and `auditLog.log()` — it never touches the `userRole` table. An acting
user substituted in for one out-of-office colleague's *specific*
resolution becomes eligible for *that* assignment/transition/approval
only; they do not gain the absent colleague's role or any broader
permission. This is existing, already-shipped behavior — nothing about
it changes.

**Acting Head coverage grants full role inheritance — but only when a
real predecessor is identifiable.** Stated explicitly, not left
implied, per the two cases:

- **A real predecessor exists**: the Acting-Head-assignment action takes
  an explicit, admin-supplied `coveringForUserId` — not auto-inferred.
  The system resolves *which* head-conferring position is relevant by
  checking, in order: (a) that predecessor's own current `positionId`,
  if still an `isUnitHeadPosition: true` position scoped to this unit
  (the absence case — they still nominally hold it, just personally
  away); else (b) the predecessor's most recent `OrgUnitHeadEvent` for
  this unit (almost always a `VACATED` row, which already records both
  `userId` and `positionId` per 2.3's schema — the departure case).
  Whichever position resolves, its `roleId` (2.9) is what gets granted
  — see 2.6.5.
- **A pure vacancy — no `coveringForUserId` supplied**: nothing
  identifies which position (and therefore which role) would even be
  relevant — a unit that has never had anyone hold any
  `isUnitHeadPosition` position has no history to resolve against.
  Acting Head grants **workflow-eligibility only**, exactly today's
  already-designed `resolveActingHeadForOrgUnit()` pool-inclusion
  behavior — no role grant, because there is nothing concrete to grant.

#### 2.6.5 The Role-Inheritance Mechanism — Reusing `UserRole` Directly

**Reuses `UserRole` directly — a real, temporary row, not a new
permission-computation path.** When 2.6.4 determines a role should be
granted (a real predecessor's resolved position has a non-null
`roleId`, per 2.9), the acting user receives an ordinary `UserRole` row
for that `roleId` — marked with a new provenance field so it can be
found and removed later without disturbing a role the person happens to
also hold independently:

```prisma
model UserRole {
  // ...existing fields unchanged...
  grantedViaHeadPositionOrgUnitId String?   // NEW — set only when this row was created by head-authority coverage (real holding or Acting Head), not an ordinary role assignment
}
```

**Grant logic — check first, skip if already held**: before creating
the marked row, check whether the acting user already independently
holds that `roleId` (an unmarked, or differently-marked, existing
`UserRole` row). If so, grant nothing — they already have it, and
critically, nothing gets marked as "granted via this mechanism," so a
later revoke (below) correctly leaves their independent grant alone.

**Revoke logic — tied to whichever event ends the authority**: when the
Acting Head assignment ends (explicit clear, or 2.5.1's sweep detecting
a real Head has since been appointed), delete
`userRole.deleteMany({ where: { userId: actingUserId, roleId, grantedViaHeadPositionOrgUnitId: orgUnitId } })`
in the same operation.

**The same mechanism, not a second one, also applies to *real*
position-holding — per 2.9a's "applies to whoever holds (or acts in)
it."** Whenever 2.1's/2.3's ordinary position-assignment/handover paths
grant a user an `isUnitHeadPosition: true` position with a non-null
`roleId`, the identical grant-if-not-already-held logic fires
(`grantedViaHeadPositionOrgUnitId` set to that unit); when the position
is cleared (`VACATED`, handover completion for the outgoing holder,
etc.), the identical revoke fires. One shared helper, two distinct
trigger events (real position assignment/removal; Acting Head
assignment/end) — not two separate implementations to keep in sync.

**Zero changes needed to `getUserPermissions()` or anything built on
it — stated explicitly, this is deliberate reuse, not a new path.**
`getUserPermissions()` already unions permissions across every
`UserRole` row a user holds (the multi-role-union behavior already
proven throughout this codebase — a user holding multiple roles gets
the union of all their permissions, no special-casing per role). A new,
marked `UserRole` row participates in that exact same union
automatically the moment it's created, and stops the moment it's
deleted — no new permission-computation branch, no new resolver, no
change to any existing consumer of `getUserPermissions()`. Confirmed
directly against the current method body (`role.service.ts:381-400`),
not merely asserted — a flat, uncached `userRole.findMany()` union, and
`step-04-roles-permissions.md` independently confirms this is
deliberately real-time with no caching layer today.

**Forward-looking note, not a current requirement — recorded so it
isn't lost.** `step-04`'s own text already anticipates a *future* pass
adding permission caching if request latency ever becomes a concern
("a future pass should cache per-user permission sets... with
invalidation on role/permission-assignment change and on
`User.tokenVersion` bump"). If that future pass ships, the grant/revoke
helper this section describes would need to participate in whatever
invalidation signal gets introduced then — most likely the same
`tokenVersion`-bump precedent already established for forced-logout-on-
role-change. Nothing to build now; no cache exists today for this
helper to invalidate.

---

## 2.7 USER-LEVEL "ACTING-FOR-A-UNIT" ASSIGNMENT

**Origin — a seven-month-old dropped business rule, recovered this
session, not a new invention.** `step-02-organization-structure.md`
Section 11 ("BUSINESS RULES (confirmed by product owner)"), quoted
verbatim:

> `- Users: one primary unit + optional acting-as unit`
> `  with expiry date — note for Step 9`

Confirmed this is genuinely all the elaboration that exists anywhere —
no surrounding context paragraph in `step-02` explaining why, what
triggers it, or who sets it; grepped `step-09-user-management.md` (the
step this note explicitly pointed to) for the exact phrase and any
variant — zero matches. Step 9 built `outOfOfficeFrom`/`outOfOfficeTo`/
`actingUserId` (the *person*-to-person delegate pattern) and silently
never picked this up. Also checked `module-designs.md` and `CLAUDE.md`
directly: no mention anywhere outside this one line.

**Not to be confused with 2.6's `OrgUnit.actingHeadUserId`.** These are
two different axes, on two different models, answering two different
questions: 2.6 (`OrgUnit`-level) answers *"who is covering as this
unit's Head"* — an authority-bearing designation. This section
(`User`-level) answers *"what unit is this user currently also
associated with"* — a scoping fact carrying no authority at all. See
this section's own "THE KEY QUESTION" below for why they deliberately
never interact.

### Schema Shape

```prisma
model User {
  // ...existing fields unchanged...
  actingOrgUnitId    String?
  actingOrgUnitUntil DateTime?

  actingOrgUnit      OrgUnit?  @relation("UserActingOrgUnit", fields: [actingOrgUnitId], references: [id])
}
```

Field names and shape match the original rule's own language
("acting-as unit," "with expiry date") directly. Lives on `User`
directly, matching `primaryOrgUnitId`'s own pattern — and this is a
**meaningfully different situation** from `OrgUnit.headUserId`'s
rejection in the Revision Note, worth stating explicitly: `headUserId`
was rejected because it would have been a second, independently-stored
answer to a question another mechanism (position-holding) already
answers — a genuine two-sources-of-truth risk. `actingOrgUnitId` has no
competing mechanism; nothing else in the schema computes "which unit is
this user currently acting for." A direct stored field is correct here,
not a shortcut reintroducing that same risk.

One concrete Prisma detail: `OrgUnit` already has one inbound relation
from `User` (`primaryOrgUnit`) — a second relation between the same two
models requires an explicit relation name (`"UserActingOrgUnit"` above)
to disambiguate.

### THE KEY QUESTION — Resolved: Fully Independent Axes

**`actingOrgUnitId` does not participate in 2.1's single-assignee
scoping, 2.2's Head derivation, or 2.5's escalation resolver. It confers
no authority of any kind.**

Reasoning:

- **Faithful to the original rule's own framing.** The one line that
  exists groups this with *pure ownership/scoping* concepts —
  `step-02`'s same "Ownership Model" notes list Documents' owner+
  stakeholder units, Incidents' unit-derived-from-reporter, Audit's
  multi-unit scope, alongside this one. Nothing in that framing
  concerns authority or headship — `isUnitHeadPosition` is an
  entirely later (this ticket's) concept the original rule predates.
- **Coupling it to Head derivation would break 2.2's clean cardinality
  guarantee.** 2.2's derivation query is designed to return zero, one,
  or (only during a declared handover) two rows — a third, structurally
  different reason for extra rows (acting-unit overlap) would conflate
  with the handover case the whole design exists to represent clearly,
  and would leave a gap in `OrgUnitHeadEvent`'s audit story (no event
  type exists, or should exist, for "counted as head because of an
  unrelated unit-scoping flag").
- **No capability is actually lost.** If the real need is "let someone
  temporarily cover as Head for a unit they don't hold a position in" —
  that is precisely what 2.6's `actingHeadUserId` (with its own explicit
  admin action and audit trail) already provides. `actingOrgUnitId`
  doesn't need to auto-trigger it; an admin who wants both can set
  `actingHeadUserId` explicitly too, deliberately, the same way every
  other authority-bearing action in this document requires an explicit
  action rather than an inferred side effect.
- **Simpler to implement correctly.** Zero ripple into 2.1/2.2/2.5's
  already-reviewed queries; no re-review of those sections required.

Both the "faithful to the original wording" test and the
"simpler to implement correctly" test point the same direction — they
do not diverge here.

**2.4's mandatory-field rules are entirely unaffected.** `actingOrgUnitId`/
`actingOrgUnitUntil` stay fully optional in every case — never mandatory,
regardless of user status or tenant `OrgUnit` count, unlike
`primaryOrgUnitId`'s conditional requirement. Nothing in 2.4 references
this field pair.

### Expiry Sweep

A new `sweepExpiredActingOrgUnitAssignments()` step on
`SlaMonitorProcessor` — alongside every other step this document already
adds to that same job, not a new queue. For every `User` with
`actingOrgUnitUntil` non-null and `<= now()`: clear both
`actingOrgUnitId` and `actingOrgUnitUntil`. Because this field feeds
nothing in 2.1/2.2/2.5 (per "THE KEY QUESTION" above), this sweep needs
**no follow-on work** — no `refreshOrgUnitHeadVacancy()` call, no
escalation re-check — the simplest of every sweep step this document
adds. Optionally fires a lightweight notification to the affected user
("your acting assignment to X has ended") — a nicety, not a required
part of the core mechanism.

---

## 2.8 BACKWARD COMPATIBILITY WITH ALREADY-SHIPPED FUNCTIONALITY

*(Renumbered from 2.7 — content unchanged.)*

Confirmed directly against the current code for each, not assumed —
this design changes a lot across this review round, so it is checked
here explicitly rather than trusted to be fine by construction.

**1. `TaskService`/`SlaMonitorProcessor`'s `validateEscalationTarget()`
— unaffected. Confirmed, not implied.** Read directly
(`org-position.service.ts`, current lines 154–194): this method reads
exactly two things about a user — `position?.grade` (via
`include: { position: true }`, i.e. `User.positionId` →
`OrgPosition.grade`) and `primaryOrgUnitId` (a field on `User` itself,
consumed by `isInSameOrParentOrgUnit()`'s parent-walk over
`OrgUnit.parentId`). **Neither field is touched by this redesign.**
`OrgPosition.grade` is untouched — Section 2.1 only adds
`isSingleAssignee`/`isUnitHeadPosition` and removes `orgUnitId`;
`grade` keeps its existing meaning and existing values on every row,
including the 10 seeded defaults. `User.primaryOrgUnitId` is untouched
— this design reads it (2.1's single-assignee scoping, 2.2's Head
derivation) but never writes to it as a side effect, and adds no new
field on `User` at all. The one field this redesign removes —
`OrgPosition.orgUnitId` — is **never referenced anywhere in
`validateEscalationTarget()` or `isInSameOrParentOrgUnit()`**, confirmed
by re-reading both method bodies in full: the org-unit traversal in
this method walks `User.primaryOrgUnitId` → `OrgUnit.parentId`, a
completely separate field from the one being removed from
`OrgPosition`. Escalation-target validation keeps working exactly as
it does today, unchanged, with zero code change required to it.

**2. ACC-37's 4 user-picker org-unit disambiguation fixes — unaffected.
Confirmed, not implied.** Re-checked directly against
`unassigned-tasks.component.ts` (the Reassign picker): its
`orgUnitName(orgUnitId)` helper resolves against a local `orgUnits()`
signal populated by `OrgUnitService.getFlat()`, called with
`user.primaryOrgUnitId` — i.e. `User.primaryOrgUnitId`, resolved
against the `OrgUnit` list, exactly the same two things confirmed
unaffected in #1 above. `invite-user.component.ts`'s Manager picker,
`user-profile.component.ts`'s Manager/Acting User pickers, and
`committee-member-form.component.ts`'s Add Member picker all follow the
identical pattern (established once, reused four times in that ticket).
None of the four reads `OrgPosition` at all, let alone
`OrgPosition.orgUnitId` — the field being removed. These four screens
require zero changes from this redesign.

**3. Final full-codebase grep, given how far this design shifted across
this review round — confirms nothing new was missed.** Every backend
reference to `OrgPositionService`/`prisma.orgPosition` (12 files),
`OrgUnitService`/`prisma.orgUnit` (5 files), and `positionId`/
`position?.`/`position:` (7 files) was re-enumerated fresh against the
current codebase. Result: every real (non-spec, non-DI-registration)
file found is already accounted for by this document — `task.service.ts`/
`sla-monitor.processor.ts` (#1 above), `tenant.service.ts` (2.4's
bootstrap checklist item), `organization.service.ts` (its two
`orgUnitId`-adjacent references are commented-out **future** TODO
blocks for modules that don't exist yet — `Incident`/`WorkflowInstance`
gaining their own `orgUnitId`, unrelated to `OrgPosition`'s field of the
same name being removed here), and `user.service.ts` (`invite()`/
`updateProfile()` plain-assign `positionId`/`primaryOrgUnitId` from the
DTO today with **no validation at all** — confirmed directly,
`user.service.ts` lines 94–95 and 144–145 — exactly the
gap 2.1's single-assignee enforcement and 2.4's mandatory-field
requirement are designed to fill, not a new consumer this document
failed to account for). No file outside this document's own Section 2
design or Section 5 checklist references anything this redesign
touches.

---

## 2.9 POSITION-TO-ROLE MAPPING FOR HEAD-CONFERRING POSITIONS

**a. Each `isUnitHeadPosition: true` position optionally carries an
associated `roleId`** — configured once per position (not per unit, not
per holder), applying uniformly to whoever holds, or acts in (2.6.4/
2.6.5), that position:

```prisma
model OrgPosition {
  // ...2.1's fields unchanged, plus:
  roleId String?

  role   Role?   @relation(fields: [roleId], references: [id])
}
```

Not restricted to only being settable when `isUnitHeadPosition: true` —
the field exists on `OrgPosition` generally — but its *effect* (a role
grant, per 2.6.5) is only ever applied for head-conferring positions,
matching how `primaryOrgUnitId: null` + `isUnitHeadPosition: true` is
already a valid-but-inert combination in 2.1.

**b. Confirmed design: entirely independent per hierarchy level — no
automatic cascading or inheritance between levels.** If "Department
Head" maps to Role X and "Division Head" (a different position, used
higher in the `OrgUnit` hierarchy) maps to Role Y, there is no
relationship between X and Y derived from the hierarchy — a Division
Head does not automatically also receive Department Head's role by
virtue of sitting above it, and vice versa. Each head-conferring
position's role mapping is configured independently by the tenant
admin. No cascading logic is built.

**c. Dropdown safety — hard-exclude `PLATFORM_ADMIN` and `TENANT_ADMIN`
specifically, both server- and client-side.** Precedent: CLAUDE.md's
existing Key Architecture Decision (ACC-13/14) already filters
`PLATFORM_ADMIN` out of the assignable-roles list shown to non-platform-org
tenants — this extends that same established pattern, one role further,
in this one specific dropdown. **Why `TENANT_ADMIN` too, newly, here
specifically**: granting a powerful, tenant-wide administrative role
automatically as a side effect of a position-holding mechanism —
without a human explicitly assigning it through the deliberate Roles UI
— is a real self-escalation risk a tenant could trigger by accident
(flag one position as `isUnitHeadPosition: true`, map it to
`TENANT_ADMIN`, and every future holder of that ordinary-sounding
position silently becomes a full tenant administrator). Every other
tenant-configured role stays selectable — no new curation flag or
mechanism, just this one hard exclusion, enforced in two places: the
frontend role-picker on the position form, and server-side validation
in `createPosition()`/`updatePosition()` (defense in depth, matching
this document's own established discipline elsewhere — e.g. 2.1's
`isUnitHeadPosition`/`isSingleAssignee` pairing is validated
server-side, not trusted to client-side enforcement alone).

**d. Onboarding gap — recorded, not designed here.** Confirmed via
direct read of `CLAUDE.md`'s Tenant Onboarding wizard steps
(`Tenant Lifecycle` → `Onboarding`): no step anywhere covers org unit,
position, or head-role setup. A one-line note is added to `CLAUDE.md`
alongside this document (see Section 5's checklist) flagging that this
flow needs a real home eventually — specifically so this doesn't suffer
the same fate as `step-02`'s original acting-as-unit note (2.7's own
origin story): written once, pointed at a specific future step, then
silently dropped when that step was actually built.

**e. Remediation report —
`notifyTenantAdminsOfVacantHeadRoleMappings()` (or equivalent), matching
2.4's exact three-part chain**: `Role.findFirst({ key: 'TENANT_ADMIN' })`
→ `UserRole.findMany()` → `NotificationService.create()`, same "a report,
not a script" framing as 2.4 (the correct role to map is exactly as
undecidable programmatically as the correct position/org-unit mapping
is). **A precision note on what this actually surfaces, stated
explicitly rather than silently picked**: a head-conferring position is
a tenant-wide catalog entry, not a fixed 1:1 property of one `OrgUnit`
— there is no single well-defined "this vacant unit's head-conferring
position" to join against for a unit that has never had any holder at
all. The report therefore surfaces **two related but not strictly
joined signals together**, not one filtered query: (i) which `OrgUnit`
rows currently have `isHeadVacant: true` (2.5's existing cache), and
(ii) which `isUnitHeadPosition: true` positions currently have
`roleId: null`. Reported together because they're thematically the same
class of configuration gap ("head-authority setup incomplete"); a human
Tenant Admin reading both lists already knows which positions are used
in which units and can correlate them, which a database join cannot
do reliably given positions aren't unit-scoped.

**f. Inline nudge — cheap, immediate, independent of the periodic
report.** When a Tenant Admin toggles `isUnitHeadPosition: true` on the
position form without also setting `roleId`, show a non-blocking inline
warning at that exact moment (e.g. "This position won't grant any role
to its holder until you map one") — display-layer only, no schema
implication, doesn't wait for 2.9e's rollout-time/periodic report to
surface the same gap later.

---

## 3. NON-GOALS (Explicit — Do Not Drift Into These)

- **A general dual-position system.** Already closed by direct decision
  before this document was written — 2.6's Acting Head flag is
  deliberately narrow (unit-head coverage only, and deliberately never
  grants the actual position) and must not be generalized into "any
  user can act in any position" during implementation.
- **A standalone, independently-stored `OrgUnit.headUserId` field.**
  Rejected on review — see the Revision Note at the top of this
  document. Head is derived from position-holding; reintroducing a
  separately-stored pointer during implementation would reopen the
  exact two-sources-of-truth problem this revision closed.
- **`User.actingOrgUnitId` conferring Head authority, or any authority
  at all, for the unit it names.** Deliberately not built — see 2.7's
  own "THE KEY QUESTION" reasoning. A future implementer must not
  "improve" this into an OR-condition inside 2.1/2.2/2.5's queries
  without redoing that analysis.
- **Reactivating `ORG_UNIT_HEAD` support in the frontend's
  assignee-strategy dropdown before this design ships.** It stays
  removed (per ACC-33) until `resolveActingHeadForOrgUnit()` actually
  exists and is wired into `resolveAssigneeRaw()`'s `ORG_UNIT_HEAD`
  case — **and** (per 2.6.2) `resolveApproverPool()`'s own
  `ORG_UNIT_HEAD` case, for multi-approver stages to mean anything.
- **Automatic single-assignee or head-conferring flagging for any
  specific seeded position** (e.g. hardcoding `Director` as
  `isUnitHeadPosition: true` in `org-position.seed.ts`). Left as a
  tenant-admin configuration choice. `DEFAULT_POSITIONS` seeds all 10
  with `isSingleAssignee: false`/`isUnitHeadPosition: false`/`roleId: null`
  (the schema defaults), unchanged.
- **A backfill *script* for `positionId`/`primaryOrgUnitId`, or for
  `OrgPosition.roleId`.** Per 2.4 and 2.9e respectively: deliberately
  not built — neither target value is programmatically derivable. Both
  remediations are report/notification mechanisms, not
  data-transformation scripts.
- **Extending `isUnassigned`/`unassignedAt`'s existing
  `WorkflowInstanceStage` mechanism itself.** Untouched by this ticket —
  2.5 builds an independent, `OrgUnit`-scoped twin of the same
  *pattern*, not a modification to the existing implementation.
- **Retroactively blocking existing active users** from any part of the
  system pending backfill. Explicit recommendation in 2.4.
- **Bypassing 2.1/2.2's single-assignee or cross-position checks
  through any path other than the dedicated handover-declaration
  method.** `isDeclaredHandoverBypass` (2.2) is not a general escape
  hatch — implementation must not expose it, or anything equivalent, to
  the ordinary `UserService.updateProfile()` path.
- **Automatic cascading or inheritance of role mappings between
  hierarchy levels.** Per 2.9b — each head-conferring position's
  `roleId` is configured independently; a higher-level head position
  does not automatically inherit or grant a lower level's mapped role,
  or vice versa.
- **Mapping `PLATFORM_ADMIN` or `TENANT_ADMIN` as a head-conferring
  position's `roleId`.** Per 2.9c — hard-excluded from the picker, both
  layers, not merely discouraged.
- **Re-deriving a delegation stamp at completion/read time for `Task`.**
  Superseded design — see 2.6.3's correction. `TaskAssignee` captures
  `delegationReason`/`delegationContextId` once, at creation; `Task`
  itself gains no new fields, and nothing re-checks or re-derives this
  later.
- **Frontend UI** for any of this (Head-conferring flag, handover
  declaration/completion/cancellation, Acting Head assignment, role
  mapping, vacancy/backfill dashboards, delegation-reason display). This
  document is design-only; UI build belongs to the follow-up
  implementation ticket.

---

## 4. PENDING DISCUSSIONS — Summary

All items flagged as needing a real decision are resolved above with a
specific recommendation. Restated here for discoverability only — full
reasoning lives in the numbered sections, not duplicated.

**1. Deliberate handover mechanism — RESOLVED: see 2.3.** A dedicated
service method grants the incoming successor the same head-conferring
position the outgoing holder holds (bypassing the normal single-holder
caps only for this one declared pair), cached on `OrgUnit` via
`pendingHeadUserId`/`headHandoverEffectiveDate`, logged in the new
`OrgUnitHeadEvent` log modeled on `CommitteeMembershipEvent`, closed
automatically by the existing sweep job or explicitly via an
early-completion/cancellation action. Deliberately does **not** copy
`RoleService`'s unconditional block — vacancy is a legitimate state for
a Unit Head in a way it never is for a tenant's last admin.

**2. Mandatory-field enforcement timing — RESOLVED: see 2.4.**
Immediate for new invites/activations only; existing active users are
never retroactively blocked. The "backfill" is a Tenant Admin
notification/report mechanism, not a data-transformation script.
`primaryOrgUnitId`'s requirement is conditional on the tenant already
having at least one `OrgUnit`.

**3. Vacancy detection, escalation, and blocking behavior — RESOLVED:
see 2.5.** A new resolver (`resolveActingHeadForOrgUnit()`, returning a
pool — `string[]`, matching `resolveAssigneeRaw()`'s convention), not a
reuse of `isInSameOrParentOrgUnit()` itself. Partial vacancy never
blocks — the walk substitutes an ancestor's Head automatically, with a
visibility notification, not a gate. Only full-chain exhaustion blocks,
and that is exactly `isUnassigned`'s existing meaning reused unchanged.

**4. Acting Head flag location and audit trail — RESOLVED: see 2.6.**
`OrgUnit.actingHeadUserId`, deliberately independent of position-
holding (the one part of this design that stays a directly-stored fact,
because it represents coverage *without* becoming the position-holder —
deriving it from `positionId` is structurally impossible for what it
needs to mean). Audit trail: yes, via the same `OrgUnitHeadEvent` log
from 2.3, with `positionId: null` marking these events as the one
non-position-holding case in that log.

**5. `OrgPositionService.deactivatePosition()` has no
`reactivatePosition()` counterpart — RESOLVED: close it as part of this
same implementation.** Existing, already-documented Tier 2 gap
(`SYSTEM-REFERENCE.md` Section 5.2), unrelated in origin to this
redesign but directly relevant now: a head-conferring position
mistakenly deactivated has no path back except re-creation, which would
silently orphan any `OrgUnitHeadEvent` history tied to the original row.
Add `reactivatePosition()` (mirroring `RoleService.reactivateRole()`'s
exact shape) in the same PR.

**6. (Surfaced by an earlier review round) Two-sources-of-truth risk for
"who is Head" — RESOLVED: see the Revision Note and 2.2.** The first
revision's standalone `headUserId` field was rejected specifically
because nothing would have kept it synchronized with actual
`User.positionId`/`primaryOrgUnitId` changes made through the ordinary
profile-edit path. Corrected design derives the answer on every read
(cached only for sweep-comparison purposes, per 2.5's `isHeadVacant`),
eliminating the drift risk structurally rather than by relying on every
future caller to remember to update two places.

**7. (New, this review round) `User.actingOrgUnitId`'s interaction with
Head derivation — RESOLVED: fully independent axes, see 2.7.** Does not
participate in 2.1/2.2/2.5's queries and confers no authority. Faithful
to the original `step-02` rule's own scoping-only framing, and avoids
breaking 2.2's zero/one/two-during-handover cardinality guarantee.
2.6's `actingHeadUserId` already covers the "let someone cover as Head"
need explicitly, so no capability is lost by keeping these independent.

**8. (New, this review round) A live defect in already-shipped ACC-28
code — RESOLVED with a recommendation, but the one item still awaiting
your explicit confirmation, see 2.6.1.** `triggerTransition()`'s
`ASSIGNEE_POOL` gating and `submitApproval()`'s eligibility check both
bypass out-of-office substitution today — confirmed by direct code
read, not new scope this ticket introduces. Recommendation: fix bundled
with this implementation, specifically because 2.6.3's
`OUT_OF_OFFICE_COVERAGE` delegation stamp is otherwise unreachable in
practice for either gated action.

**9. (New, this review round) `resolveApproverPool()`'s missing
`ORG_UNIT_HEAD` case — RESOLVED: see 2.6.2.** A real, confirmed
prerequisite, not optional polish — without it, `submitApproval()`'s
eligibility check remains a silent no-op for `ORG_UNIT_HEAD` stages even
after every other piece of this document ships.

**10. (New, this review round) Full-vs-scoped permission model for
delegated authority — RESOLVED: see 2.6.4/2.6.5.** Out-of-office
coverage stays scoped-eligibility-only (confirmed correct, unchanged).
Acting Head coverage grants full role inheritance via a real, marked,
temporary `UserRole` row — but only when an explicit `coveringForUserId`
identifies a real predecessor to resolve a position (and therefore a
role, per 2.9) from; a pure vacancy with no identified predecessor grants
workflow-eligibility only, reusing `getUserPermissions()`'s existing
multi-role-union behavior unchanged.

**11. (New, this review round) Position-to-role mapping design —
RESOLVED: see 2.9.** Each head-conferring position optionally carries
one `roleId`, configured independently per position (no cross-level
cascading), with `PLATFORM_ADMIN`/`TENANT_ADMIN` hard-excluded from the
mapping picker, a matching remediation report, an immediate inline
nudge, and a recorded (not yet designed) gap in the Tenant Onboarding
wizard.

---

## 5. SUGGESTED FOLLOW-UP IMPLEMENTATION SCOPE

For whoever picks up the implementation ticket after this plan is
reviewed — not this ticket's own acceptance criteria.

**Schema / migration**
- [ ] `OrgPosition`: drop `orgUnitId` + its relation + its index; narrow
      `@@unique` to `(organizationId, nameEn)`; add `isSingleAssignee
      Boolean @default(false)`, `isUnitHeadPosition Boolean
      @default(false)`, and `roleId String?` + `Role` relation (2.1, 2.9)
- [ ] `OrgUnit`: add `pendingHeadUserId`, `headHandoverEffectiveDate`,
      `isHeadVacant`, `headVacantSince`, `actingHeadUserId` + their
      `User` relations; remove `positions OrgPosition[]` reverse
      relation. **No `headUserId` field** (2.2, 2.3, 2.5, 2.6)
- [ ] New `OrgUnitHeadEvent` model (with nullable `positionId`) +
      `OrgUnitHeadAction` enum (2.3, 2.6)
- [ ] `User`: add `actingOrgUnitId String?` + `actingOrgUnitUntil
      DateTime?` + named `OrgUnit` relation (2.7)
- [ ] New `DelegationReason` enum (`ACTING_HEAD`,
      `OUT_OF_OFFICE_COVERAGE`); add `delegationReason`/
      `delegationContextId` to `WorkflowInstanceStage`, `WorkflowApproval`,
      and `TaskAssignee` (2.6.3)
- [ ] `UserRole`: add `grantedViaHeadPositionOrgUnitId String?` (2.6.5)
- [ ] Confirm migration is a genuine no-op for existing `OrgPosition`
      data (2.1) — verify against the live DB one more time immediately
      before running

**Backend logic**
- [ ] `OrgPositionService`: `createPosition()`/`updatePosition()`
      validation rejecting `isUnitHeadPosition: true` +
      `isSingleAssignee: false` (2.1), and rejecting `roleId` values
      resolving to `PLATFORM_ADMIN`/`TENANT_ADMIN` (2.9c); new
      `reactivatePosition()` (Pending Discussion #5)
- [ ] Position-assignment enforcement (`UserService`, wherever
      `positionId` is set): per-`(positionId, primaryOrgUnitId)`
      single-assignee check (2.1) **and** the separate cross-position
      head-uniqueness check (2.2), both run for a head-conferring
      position; a shared `isDeclaredHandoverBypass` path usable only by
      2.3's dedicated handover method; the shared grant/revoke helper
      (2.6.5) fires on every position-holding change for an
      `isUnitHeadPosition` position with a non-null `roleId`
- [ ] New Head-management service methods, gated by `org:manage`:
      declare handover, complete handover (auto + explicit), cancel
      handover, direct assign/vacate a head-conferring position,
      assign/clear Acting Head (now taking an optional
      `coveringForUserId`, 2.6.4) — all writing to `OrgUnitHeadEvent`
      (2.3, 2.6); Acting Head assign/clear also fires the shared
      grant/revoke helper (2.6.5) when a predecessor was identified
- [ ] `refreshOrgUnitHeadVacancy()` helper, called from the
      Head-management methods **and** from `UserService.updateProfile()`/
      `deactivate()`/`OrgPositionService.deactivatePosition()` whenever
      they touch a user holding an `isUnitHeadPosition` position (2.5)
- [ ] `resolveActingHeadForOrgUnit()` — new resolver returning
      `Promise<string[]>` (2.5)
- [ ] `resolveActingHeadOrgUnitIdForUser()` and
      `resolveOutOfOfficeCoverageForUser()` — new narrow, single-actor
      helpers for the delegation stamp (2.6.3)
- [ ] **Fix (Pending Discussion #8 — confirm before implementing)**:
      `triggerTransition()`'s `ASSIGNEE_POOL` check switches from
      `resolveAssigneeRaw()` to `resolveAssignee()`; `resolveApproverPool()`
      gains OOO-substitution awareness; `resolveUnassignedBlockingTransitions()`'s
      raw-pool read switches to the substituted read (2.6.1)
- [ ] `resolveApproverPool()`: new `ORG_UNIT_HEAD` case calling
      `resolveActingHeadForOrgUnit()` (2.6.2) — required for
      `submitApproval()` to gate anything for this strategy
- [ ] `WorkflowService.resolveAssigneeRaw()`: new `ORG_UNIT_HEAD` case
      calling `resolveActingHeadForOrgUnit()` against the calling
      object's `orgUnitId` — **prerequisite, confirmed today**: no
      workflow-driven object (Committee, Meeting) currently has an
      `orgUnitId` field; a real, separate schema addition on whichever
      object first consumes `ORG_UNIT_HEAD`, not provided by this
      ticket's own schema changes
- [ ] Delegation stamping at all write sites: `triggerTransition()`'s
      two `WorkflowInstanceStage.create()` calls and its own
      `WorkflowApproval.upsert()`; `submitApproval()`'s
      `WorkflowApproval.upsert()`; `fireTransitionActions()`'s
      `CREATE_TASK` handling for each `TaskAssignee` row (2.6.3)
- [ ] `SlaMonitorProcessor`: new `sweepOrgUnitVacancies()` step
      (symmetric set/clear, notify only on false→true, 2.5.1), a
      handover-cutoff check (2.3), and a new
      `sweepExpiredActingOrgUnitAssignments()` step (2.7) — all
      alongside the existing sweep, no new BullMQ queue
- [ ] `notifyTenantAdminsOfOrgUnitVacancy()` — new method mirroring
      `notifyTenantAdminsOfCoverageGap()`/
      `notifyTenantAdminsOfUnassignedStage()`'s exact shape (2.5)
- [ ] `notifyTenantAdminsOfVacantHeadRoleMappings()` — new method,
      identical three-part chain, surfacing both vacant units and
      unmapped head-conferring positions together (2.9e)
- [ ] `InviteUserDto`: `positionId`/`primaryOrgUnitId` become required;
      conditional check that at least one active `OrgUnit` exists
      before enforcing `primaryOrgUnitId` (2.4)
- [ ] One-time `notifyTenantAdminsOfIncompleteProfiles()` run (or
      equivalent report) for existing tenants at rollout — not a data
      migration (2.4)
- [x] `TenantService.resolveDefaultTenantAdminAssignment()` — resolves
      **both** `positionId` (the seeded "Director" `OrgPosition`) and
      `primaryOrgUnitId` (the root `OrgUnit`, `parentId: null`) for the
      tenant's first admin, called by
      `PlatformTenantService.createTenant()` immediately after
      `bootstrap()`. **Correction to this checklist's own original
      item**: previously described as "assign a default `positionId`;
      `primaryOrgUnitId` correctly stays unset until the tenant creates
      its first `OrgUnit`" — wrong, confirmed against the current code
      during Phase 2. `bootstrap()` already creates a root `OrgUnit` on
      every run, so `primaryOrgUnitId` must be resolved too, not left
      unset (see 2.4's fully corrected text above)

**Frontend** (belongs to the implementation ticket, not this plan)
- [ ] `position-form.component.ts`: remove the `orgUnitId` field
      entirely; add `isSingleAssignee` and `isUnitHeadPosition` toggles
      (client-side validated against each other too, not just relying
      on the 400); a `roleId` picker shown only when
      `isUnitHeadPosition` is true, excluding `PLATFORM_ADMIN`/
      `TENANT_ADMIN` (2.9c), with the inline nudge when left unset
      (2.9f)
- [ ] `position-list.component.ts`: remove the org-unit filter/display
      column
- [ ] New Head-management UI on whichever `OrgUnit` detail screen
      exists (assign, declare/complete/cancel handover, assign/clear
      Acting Head — including the optional "covering for" person
      picker, 2.6.4) — reads the derived holder(s), not a stored field
- [ ] `invite-user.component.ts`/`user-profile.component.ts`:
      `positionId`/`primaryOrgUnitId` become required fields for the
      invite flow specifically — profile-edit for existing users stays
      as-is per 2.4's no-retroactive-blocking decision; a new,
      optional acting-for-a-unit assignment control (2.7), unrelated to
      the Head-management UI above
- [ ] Wherever approval history or task-completion history renders:
      when `delegationReason` is non-null, resolve and display a
      qualifier next to the actor's name — e.g. "Approved by Sarah —
      Acting Head of Cardiology" or "Completed by Sarah — covering for
      Ahmad" — using the same `OrgUnitService`/name-resolution pattern
      already established (2.6.3)
- [ ] Re-add `ORG_UNIT_HEAD` to `workflow-stage-form.component.ts`'s
      assignee-strategy dropdown — only once both backend resolvers
      (2.5's `resolveAssigneeRaw()` case, 2.6.2's `resolveApproverPool()`
      case) are real, per this document's Non-Goals

**Docs**
- [ ] `SYSTEM-REFERENCE.md` Section 5 rewritten to reflect the org-wide
      redesign; new section for the derived-Head/handover/vacancy/
      Acting-Head/role-mapping mechanism, explicit about "Head" never
      being a stored fact
- [ ] `SYSTEM-REFERENCE.md`'s Tier 2 `deactivatePosition()`/no-
      `reactivatePosition()` entry closed (Pending Discussion #5)
- [ ] `SYSTEM-REFERENCE.md` Section 2 (Workflow Engine) — new note on
      the `ASSIGNEE_POOL`/`submitApproval()` OOO-substitution defect
      and its fix (2.6.1), once the Pending Discussion #8 decision is
      confirmed
- [ ] `CLAUDE.md`'s Assignee Resolution Strategies section updated —
      `ORG_UNIT_HEAD` is no longer "not yet supported"
- [ ] `CLAUDE.md`'s Tenant Onboarding wizard steps — one-line note
      added flagging the org unit/position/head-role setup gap (2.9d),
      applied alongside this document's own commit

**Tests**
- [ ] `isSingleAssignee` enforcement: scoped correctly per
      `(positionId, primaryOrgUnitId)` — two different units can each
      independently have their own holder of the same single-assignee
      position; a second holder in the *same* unit is rejected; a
      `primaryOrgUnitId: null` holder is scoped correctly against other
      `null`-unit holders of the same position
- [ ] `isUnitHeadPosition` + `isSingleAssignee: false` rejected at
      create/update time; `roleId` resolving to `PLATFORM_ADMIN`/
      `TENANT_ADMIN` rejected at create/update time (2.9c)
- [ ] Cross-position head-uniqueness: two different head-conferring
      positions can't both have an active holder in the same unit
      simultaneously, outside a declared handover
- [ ] Handover: declare → both holders resolve via
      `resolveActingHeadForOrgUnit()` during the window → auto-complete
      via sweep leaves only the incoming successor; declare → explicit
      early completion; declare → explicit cancellation restores the
      original sole holder
- [x] `resolveActingHeadForOrgUnit()`: own unit's holder(s) found
      directly (including the 2-holder handover case); own unit vacant,
      Acting Head found; own unit vacant with no Acting Head, ancestor's
      holder found; full chain exhausted returns `[]`
- [x] Vacancy sweep: symmetric set/clear; no duplicate notification on
      repeated sweeps of an already-flagged, still-fully-vacant chain;
      notification fires only on the genuine false→true transition;
      vacancy correctly re-derives after an *ordinary* profile edit
      changes a head-position holder's `primaryOrgUnitId` (not just
      through the dedicated Head-management methods) — **and**, per a
      real gap found starting Phase 6 commit 4 (fixed in its own
      commit): also re-derives correctly when the change comes through
      the dedicated Head-management methods themselves
      (`OrgUnitHeadService.assignHead()`/`vacateHead()`/handover
      declare/complete/cancel), which mutate `User.positionId` directly
      and previously bypassed `refreshOrgUnitHeadVacancy()` entirely —
      proven via a real (not mocked) `OrganizationService` wired into a
      real `OrgUnitHeadService`, confirming `vacateHead()` alone flips
      `isHeadVacant` to `true`
- [x] `OrgUnit.isHeadFullyUnresolved`/`headFullyUnresolvedLastRemindedAt`
      (2.5.1) — new fields, this Phase 6 migration, both default
      correctly for every existing `OrgUnit` row; periodic reminder
      cadence: first notification fires immediately on the false→true
      transition, no repeat fires before `HEAD_VACANCY_REMINDER_INTERVAL_MS`
      (2 days) has elapsed, a repeat fires correctly once it has, silence
      resumes immediately on recovery (both fields cleared, not left
      stale); reminder wording states actual elapsed duration from
      `headVacantSince`, not a generic repeat of the first notification
- [ ] Mandatory-field enforcement: new invite rejected without both
      fields; `primaryOrgUnitId` not required when the tenant has zero
      `OrgUnit` rows, required once one exists; existing active user
      with missing fields is *not* blocked from unrelated actions
      (negative test)
- [ ] `isDeclaredHandoverBypass` is unreachable from
      `UserService.updateProfile()`'s ordinary path (negative test,
      confirming the Non-Goals bypass restriction actually holds in
      code)
- [ ] **Regression tests for the fixed live defect (2.6.1)**: an
      out-of-office user's `actingUserId` substitute *can* trigger an
      `ASSIGNEE_POOL` transition and *can* submit an approval for a
      resolution that would have included the absent original user; the
      absent original user, still technically in the raw pool, is
      correctly excluded once substitution is applied
- [ ] `resolveApproverPool()`'s new `ORG_UNIT_HEAD` case: multi-approver
      stage correctly gates on the resolved Head/Acting-Head pool (2.6.2)
- [ ] Delegation stamp: `ACTING_HEAD` reason stamped correctly with the
      resolved `orgUnitId`; `OUT_OF_OFFICE_COVERAGE` reason stamped
      correctly with the covered-for user's id; precedence when both
      could apply (`ACTING_HEAD` wins); `TaskAssignee` rows stamped once
      at creation, `Task.complete()` reads the matching row without
      re-deriving anything
- [ ] Role-inheritance (2.6.4/2.6.5): Acting Head assignment with a real
      `coveringForUserId` grants the resolved position's `roleId` via a
      marked `UserRole` row; assignment with no `coveringForUserId`
      grants no role; ending the assignment removes only the marked
      row, never an independently-held grant on the same role;
      `getUserPermissions()` correctly includes the granted role while
      active and excludes it once revoked, with no code change to that
      method itself
- [ ] Real position-holding also grants/revokes the mapped role via the
      same shared helper (2.6.5's "applies to whoever holds... it")
- [ ] `actingOrgUnitId`/`actingOrgUnitUntil`: expiry sweep clears both
      fields correctly; confirm non-interaction — assigning/clearing
      `actingOrgUnitId` never changes any unit's `isHeadVacant`,
      `resolveActingHeadForOrgUnit()`'s output, or any single-assignee
      check's result (negative test, confirming Pending Discussion #7's
      independent-axes decision actually holds in code)
- [ ] Tenant isolation on every new query this introduces (same rigor
      as every other ACC-17-pattern check)

---

## 6. IMPLEMENTATION PHASE & COMMIT PLAN

Grouped by genuine dependency/risk boundary, not Section 2's numbering
— three places diverge from that numbering directly: Phase 0 is pulled
out and placed first (Section 2.6.1's live defect fix touches
already-shipped, well-tested code, and re-verifying its own test
coverage this session found ~6 existing tests need *updating*, not just
extending — isolating it makes any regression unambiguous to bisect);
2.9's `roleId` *field* lands in Phase 1 (pure schema) while its
*granting effect* moves to Phase 8, after both real position-holding
enforcement (Phase 4) and Acting Head (Phase 6) exist to trigger it;
2.6.3's delegation stamp moves to the end (Phase 9), since it is inert
without both Phase 0's OOO half and Phase 7's `ORG_UNIT_HEAD` half
already working.

**Standing discipline for every phase below, per the ACC-33 lesson —
stated once here, applies throughout, not repeated per commit**: commit
immediately after each logical unit is verified (`tsc --noEmit` +
relevant test file green), never let more than one unit's worth of
change sit uncommitted; stage the specific files that unit touched
(`git add <path> <path>`), never a broad `git add -A`/`git add .` that
could sweep in another in-progress unit's edits.

### Phase 0 — Fix the live OOO-substitution defect (2.6.1)

No new schema. No ACC-40 feature surface — this is a fix to already-shipped
ACC-28/33 code, isolated on purpose.

1. `fix(workflow): route ASSIGNEE_POOL gating through OOO substitution [ACC-40]`
   — `triggerTransition()`'s check switches to `resolveAssignee()`;
   updates the 2 directly-affected existing tests
   (`workflow.service.spec.ts`'s `ASSIGNEE_POOL` gate tests); adds one
   new regression test (an OOO-substituted actor can trigger).
2. `fix(workflow): add OOO-substitution awareness to resolveApproverPool() [ACC-40]`
   — updates the 4 directly-affected existing `submitApproval` ×
   `authorization (ACC-33 item 7)` tests; adds one new regression test.
3. `fix(workflow): use OOO-substituted pool in resolveUnassignedBlockingTransitions() [ACC-40]`
   — updates the relevant existing tests in that `describe` block; adds
   one new regression test (an available OOO substitute is not
   incorrectly flagged unassigned).
4. `docs(system-reference): document the ASSIGNEE_POOL/submitApproval OOO-substitution fix [ACC-40]`
   — small, scoped note; not deferred to Phase 10's consolidated pass.

**Checkpoint**: full existing `workflow.service.spec.ts` suite green,
including the updated tests. Report back before Phase 1.

### Phase 1 — `OrgPosition` foundation

1. `feat(org-position): drop per-unit scoping, add isSingleAssignee/isUnitHeadPosition/roleId [ACC-40]`
   — `schema.prisma` + migration only. Re-verify the no-op claim
   against the live DB immediately before running.
2. `feat(org-position): update create/update DTOs for new fields [ACC-40]`
   — `CreateOrgPositionDto`/`UpdateOrgPositionDto`.
3. `feat(org-position): enforce isUnitHeadPosition requires isSingleAssignee, exclude PLATFORM_ADMIN/TENANT_ADMIN from roleId [ACC-40]`
   — service-layer validation + tests.
4. `feat(org-position): add reactivatePosition() [ACC-40]`
   — mirrors `RoleService.reactivateRole()`; own commit, distinct
   concern (Pending Discussion #5) from the main redesign; controller
   endpoint + tests.
5. `feat(org-position): remove orgUnitId field, add isSingleAssignee/isUnitHeadPosition/roleId controls [ACC-40]`
   — `position-form.component.ts`/`position-list.component.ts`.
6. `chore(i18n): add translation keys for new position fields [ACC-40]`
   — `en.json`/`ar.json`.

**Checkpoint**: schema foundation everything else depends on. Report
back before Phase 2.

### Phase 2 — Mandatory fields + bootstrap + remediation report (2.4)

1. `feat(user): require positionId/primaryOrgUnitId on invite, conditional on OrgUnit existing [ACC-40]`
   — `InviteUserDto` + `UserService.invite()` + tests.
2. `feat(tenant): seed default positionId for newly-bootstrapped Tenant Admin [ACC-40]`
   — `TenantService.bootstrap()` + tests.
3. `feat(user): add notifyTenantAdminsOfIncompleteProfiles remediation report [ACC-40]`
   — new method/script + tests.
4. `feat(user): require positionId/primaryOrgUnitId in invite-user form [ACC-40]`
   — `invite-user.component.ts` validators.

**Retrospective note (added after Phase 2 actually shipped)**: commits 1
and 2 above were built as **one merged commit**
(`feat(user): require positionId/primaryOrgUnitId on invite, conditional
on OrgUnit existing`), not two independent ones — real dependency, not a
process shortcut. `PlatformTenantService.createTenant()` is the one live
call site of `UserService.invite()` today, and it always calls
`bootstrap()` first, so making `positionId` required broke that call
site immediately, in the very same commit that made it required, not on
a separate later commit. Commit 2's actual touched file also differs
from what's listed here: not `TenantService.bootstrap()` itself, but a
new sibling method, `TenantService.resolveDefaultTenantAdminAssignment()`
(full detail and the wrong-assumption correction it's built on: 2.4
above), consumed by `PlatformTenantService.createTenant()`. Commits 3
and 4 shipped exactly as planned. Full checkpoint detail already
reported at Phase 2's own review point — this note exists so the
document itself carries the correction, not just the conversation that
found it.

**Checkpoint**: light. Report back before Phase 3.

### Phase 3 — User-level acting-for-a-unit (2.7)

1. `feat(user): add actingOrgUnitId/actingOrgUnitUntil fields [ACC-40]`
   — `schema.prisma` + migration.
2. `feat(workflow): add sweepExpiredActingOrgUnitAssignments to SlaMonitorProcessor [ACC-40]`
   — sweep step + tests, including the explicit non-interaction
   regression tests (confirms Pending Discussion #7 holds in code).
3. `feat(user): add optional acting-for-a-unit control to profile [ACC-40]`
   — frontend.

**Checkpoint**: light. Report back before Phase 4.

### Phase 4 — Head derivation + assignment-time enforcement (2.2)

1. `feat(user): enforce per-unit single-assignee check on position assignment [ACC-40]`
   — tests, plus regression tests confirming ordinary non-head
   assignments are unaffected.
2. `feat(user): enforce cross-position head-uniqueness check on position assignment [ACC-40]`
   — kept as its own commit, matching 2.2's own explicit "both checks
   run, kept separate" reasoning; tests.

**Checkpoint**: first new blocking behavior on an existing, widely-used
path. Report back before Phase 5.

### Phase 5 — `OrgUnit` head-management schema + handover (2.3)

1. `feat(organization): add OrgUnit head-management schema (cache fields + OrgUnitHeadEvent log) [ACC-40]`
   — one migration: `pendingHeadUserId`, `headHandoverEffectiveDate`,
   `isHeadVacant`, `headVacantSince`, `actingHeadUserId`,
   `OrgUnitHeadEvent` + `OrgUnitHeadAction`. `isHeadVacant`/
   `actingHeadUserId` land now but stay inert until Phases 6/7 wire
   logic against them — harmless, unused nullable columns until then.
2. `feat(user): thread isDeclaredHandoverBypass through Phase 4's checks [ACC-40]`
   — modifies Phase 4's check functions to accept+respect the flag
   (defaulting `false` everywhere until this phase's own caller sets
   it); negative test confirming it's unreachable from the ordinary
   `updateProfile()` path (Non-Goals).
3. `feat(organization): add declareHandover()/completeHandoverNow()/cancelHandover() [ACC-40]`
   — tests covering the full lifecycle.
4. `feat(organization): add direct assign/vacate for head-conferring positions [ACC-40]`
   — `ASSIGNED`/`VACATED` events + tests.
5. `feat(workflow): auto-complete handovers past headHandoverEffectiveDate in the sweep [ACC-40]`
   — `SlaMonitorProcessor` step + tests.
6. `feat(roles): gate Head-management actions with org:manage [ACC-40]`
   — controller/guard wiring.
7. `feat(organization): add Head-management UI (assign, handover declare/complete/cancel) [ACC-40]`
   — frontend.

**Checkpoint**: new `OrgUnit` schema plus a real bypass into Phase 4's
enforcement — confirm the bypass is airtight before Phase 6 builds on
`isHeadVacant`. Report back before Phase 6.

### Phase 6 — Vacancy detection, escalation resolver, Acting Head core (2.5 + 2.6 base)

1. `feat(organization): add resolveActingHeadForOrgUnit() to OrgUnitService [ACC-40]`
   — per this document's own placement confirmation (2.5); tests
   (own-unit holder(s), ancestor walk, Acting Head stop, full
   exhaustion).
2. `feat(organization): add refreshOrgUnitHeadVacancy() and wire into position/user mutation call sites [ACC-40]`
   — includes the migration for `isHeadFullyUnresolved`/
   `headFullyUnresolvedLastRemindedAt` (2.5.1, a real gap found during
   this phase's own implementation, resolved before building it — see
   2.5.1's full writeup); entry-time check + call sites in
   `user.service.ts`/`org-position.service.ts` + tests.
3. `feat(workflow): add sweepOrgUnitVacancies() and notifyTenantAdminsOfOrgUnitVacancy() [ACC-40]`
   — sweep + notification + tests (symmetric set/clear, no duplicate
   notification, plus the 2-day periodic-reminder cadence on top of the
   fully-unresolved false→true guard).
4. `feat(organization): add assign/clear Acting Head with ACTING_ASSIGNED/ACTING_ENDED events [ACC-40]`
   — tests.

**Checkpoint**: the resolver everything downstream depends on — confirm
correctness in isolation before wiring into the real workflow engine.
Report back before Phase 7.

### Phase 7 — Wire `ORG_UNIT_HEAD` into the real workflow engine (2.5's `resolveAssigneeRaw()` case + 2.6.2)

1. `feat(workflow): add ORG_UNIT_HEAD case to resolveAssigneeRaw() [ACC-40]`
   — tests (with a synthetic/test-only `orgUnitId`, per the confirmed
   prerequisite gap below).
2. `feat(workflow): add ORG_UNIT_HEAD case to resolveApproverPool() [ACC-40]`
   — tests.
3. `feat(workflow): re-add ORG_UNIT_HEAD to workflow-stage-form's assignee-strategy dropdown [ACC-40]`
   — frontend.

**Explicit constraint, confirmed today**: no workflow-driven object
(`Committee`, `Meeting`) has an `orgUnitId` field — full live
end-to-end testing is blocked until a real consumer supplies one. This
phase ships "wired, not yet reachable in practice" — the same state
`ASSIGNEE_POOL` sat in for months before ACC-28 gave it real behavior.

**Checkpoint**: decide explicitly whether shipping in this dormant
state is acceptable, rather than letting it pass silently. Report back
before Phase 8.

### Phase 8 — Role inheritance (2.6.4/2.6.5, 2.9's granting effect)

1. `feat(roles): add grantedViaHeadPositionOrgUnitId to UserRole [ACC-40]`
   — migration.
2. `feat(roles): add shared grant/revoke-if-marked helper for head-authority role inheritance [ACC-40]`
   — the helper; tests **must** cover the check-first-before-create
   path as a hard requirement, not a nicety — confirmed this session
   directly against `step-04-roles-permissions.md`'s original schema:
   `UserRole` carries `@@unique([userId, roleId])`, so creating a
   duplicate row for an already-independently-held role would throw a
   Prisma unique-constraint violation, not silently succeed.
3. `feat(user): wire grant/revoke helper into real position-holding assignment/removal [ACC-40]`
   — Phase 4's enforcement gains the role-grant side effect; tests.
4. `feat(organization): wire grant/revoke helper into Acting Head assignment with optional coveringForUserId [ACC-40]`
   — Phase 6's Acting Head methods gain `coveringForUserId` + position/
   role resolution via the predecessor; tests, including a live-run
   (not just asserted) confirmation that `getUserPermissions()` requires
   zero code changes.

**Checkpoint**: most correctness-sensitive phase — real permission
grants. Report back before Phase 9.

### Phase 9 — Unified delegation stamp (2.6.3)

1. `feat(workflow): add DelegationReason enum and stamp fields to WorkflowInstanceStage/WorkflowApproval/TaskAssignee [ACC-40]`
   — migration.
2. `feat(workflow): add resolveActingHeadOrgUnitIdForUser() and resolveOutOfOfficeCoverageForUser() [ACC-40]`
   — the two narrow, single-actor helpers; tests.
3. `feat(workflow): stamp delegationReason on WorkflowInstanceStage/WorkflowApproval writes [ACC-40]`
   — `triggerTransition()`/`submitApproval()` wiring; tests, including
   the precedence case (`ACTING_HEAD` over `OUT_OF_OFFICE_COVERAGE`
   when both could apply).
4. `feat(task): stamp delegationReason on TaskAssignee creation [ACC-40]`
   — `fireTransitionActions()`'s `CREATE_TASK` handling; tests
   confirming `Task.complete()` reads the matching row without
   re-deriving anything.
5. `feat(workflow): display delegation-reason qualifier in approval/task history [ACC-40]`
   — frontend.

**Checkpoint**: mostly additive/observational once Phases 0 and 7 are
both real. Report back before Phase 10.

### Phase 10 — Docs

1. `docs(system-reference): rewrite Section 5 for org-wide OrgPosition, Head derivation, handover, vacancy, Acting Head, and role-mapping [ACC-40]`
2. `docs(system-reference): close deactivatePosition/reactivatePosition Tier 2 gap [ACC-40]`
3. `docs(claude): mark ORG_UNIT_HEAD as supported in Assignee Resolution Strategies [ACC-40]`

**Checkpoint**: none — final wrap-up.

---

Adjacent phase pairs (1+2, 5+6, 9 folded into 7 or 8) could reasonably
merge if fewer checkpoints are preferred — noted for flexibility, not
treated as fixed.
