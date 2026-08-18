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
new `OrgUnit`-level fields, not bolted onto `WorkflowInstanceStage`),
and a narrowly-scoped "Acting As" flag for head coverage specifically —
deliberately the one piece of this design that does **not** derive from
position-holding, because covering for an absent/vacant Head without
becoming the Head is exactly what it needs to represent.

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
handover, direct assign/vacate, Acting-As assignment) are gated by
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

**Concretely** (unaffected by this review round's other changes):
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
- **Scoped exception for `primaryOrgUnitId`**: a brand-new tenant has
  zero `OrgUnit` rows until an admin creates one (bootstrap doesn't
  seed any). `primaryOrgUnitId`'s mandatoriness is conditional on the
  tenant having at least one active `OrgUnit`
  (`orgUnit.count({ where: { organizationId, isActive: true } }) > 0`)
  — not a blanket "always required" rule that would make onboarding a
  brand-new tenant self-contradictory.

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

### 2.6 "Acting As" Flag for Unit-Head Coverage — Pending Discussion #4, Resolved With a Recommendation

**Explicitly scoped**: coverage for **head-of-unit authority
specifically**, during an absence or a not-yet-resolved vacancy — not a
general dual-position mechanism for arbitrary `OrgPosition` holders.
That broader question is closed and out of scope.

**Still its own `OrgUnit`-level field, unaffected by this review
round's shift to derived position-holding — because it deliberately
represents the one case that is *not* position-holding.** `OrgUnit.actingHeadUserId String?`
(shown in 2.3's schema block) — a person standing in for Head-level
authority **without** being granted the `isUnitHeadPosition` position
itself, and without becoming eligible for any of 2.1/2.2's
single-assignee/cross-position checks (those checks only ever look at
`User.positionId`, which Acting As never touches). This is the load-
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

---

## 2.7 BACKWARD COMPATIBILITY WITH ALREADY-SHIPPED FUNCTIONALITY

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

## 3. NON-GOALS (Explicit — Do Not Drift Into These)

- **A general dual-position system.** Already closed by direct decision
  before this document was written — 2.6's "Acting As" flag is
  deliberately narrow (unit-head coverage only, and deliberately never
  grants the actual position) and must not be generalized into "any
  user can act in any position" during implementation.
- **A standalone, independently-stored `OrgUnit.headUserId` field.**
  Rejected on review — see the Revision Note at the top of this
  document. Head is derived from position-holding; reintroducing a
  separately-stored pointer during implementation would reopen the
  exact two-sources-of-truth problem this revision closed.
- **Reactivating `ORG_UNIT_HEAD` support in the frontend's
  assignee-strategy dropdown before this design ships.** It stays
  removed (per ACC-33) until `resolveActingHeadForOrgUnit()` actually
  exists and is wired into `resolveAssigneeRaw()`'s `ORG_UNIT_HEAD`
  case.
- **Automatic single-assignee or head-conferring flagging for any
  specific seeded position** (e.g. hardcoding `Director` as
  `isUnitHeadPosition: true` in `org-position.seed.ts`). Left as a
  tenant-admin configuration choice. `DEFAULT_POSITIONS` seeds all 10
  with `isSingleAssignee: false`/`isUnitHeadPosition: false` (the
  schema defaults), unchanged.
- **A backfill *script* for `positionId`/`primaryOrgUnitId`.** Per 2.4:
  deliberately not built — the target values aren't programmatically
  derivable. The remediation is a report/notification mechanism, not a
  data-transformation script.
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
- **Frontend UI** for any of this (Head-conferring flag, handover
  declaration/completion/cancellation, Acting-As assignment,
  vacancy/backfill dashboards). This document is design-only; UI build
  belongs to the follow-up implementation ticket.

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

**4. "Acting As" flag location and audit trail — RESOLVED: see 2.6.**
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

**6. (New, surfaced by this review round) Two-sources-of-truth risk for
"who is Head" — RESOLVED: see the Revision Note and 2.2.** The first
revision's standalone `headUserId` field was rejected specifically
because nothing would have kept it synchronized with actual
`User.positionId`/`primaryOrgUnitId` changes made through the ordinary
profile-edit path. Corrected design derives the answer on every read
(cached only for sweep-comparison purposes, per 2.5's `isHeadVacant`),
eliminating the drift risk structurally rather than by relying on every
future caller to remember to update two places.

---

## 5. SUGGESTED FOLLOW-UP IMPLEMENTATION SCOPE

For whoever picks up the implementation ticket after this plan is
reviewed — not this ticket's own acceptance criteria.

**Schema / migration**
- [ ] `OrgPosition`: drop `orgUnitId` + its relation + its index; narrow
      `@@unique` to `(organizationId, nameEn)`; add `isSingleAssignee
      Boolean @default(false)` and `isUnitHeadPosition Boolean
      @default(false)` (2.1)
- [ ] `OrgUnit`: add `pendingHeadUserId`, `headHandoverEffectiveDate`,
      `isHeadVacant`, `headVacantSince`, `actingHeadUserId` + their
      `User` relations; remove `positions OrgPosition[]` reverse
      relation. **No `headUserId` field** (2.2, 2.3, 2.5, 2.6)
- [ ] New `OrgUnitHeadEvent` model (with nullable `positionId`) +
      `OrgUnitHeadAction` enum (2.3, 2.6)
- [ ] Confirm migration is a genuine no-op for existing `OrgPosition`
      data (2.1) — verify against the live DB one more time immediately
      before running

**Backend logic**
- [ ] `OrgPositionService`: `createPosition()`/`updatePosition()`
      validation rejecting `isUnitHeadPosition: true` +
      `isSingleAssignee: false` (2.1); new `reactivatePosition()`
      (Pending Discussion #5)
- [ ] Position-assignment enforcement (`UserService`, wherever
      `positionId` is set): per-`(positionId, primaryOrgUnitId)`
      single-assignee check (2.1) **and** the separate cross-position
      head-uniqueness check (2.2), both run for a head-conferring
      position; a shared `isDeclaredHandoverBypass` path usable only by
      2.3's dedicated handover method
- [ ] New Head-management service methods, gated by `org:manage`:
      declare handover, complete handover (auto + explicit), cancel
      handover, direct assign/vacate a head-conferring position,
      assign/clear Acting Head — all writing to `OrgUnitHeadEvent`
      (2.3, 2.6)
- [ ] `refreshOrgUnitHeadVacancy()` helper, called from the
      Head-management methods **and** from `UserService.updateProfile()`/
      `deactivate()`/`OrgPositionService.deactivatePosition()` whenever
      they touch a user holding an `isUnitHeadPosition` position (2.5)
- [ ] `resolveActingHeadForOrgUnit()` — new resolver returning
      `Promise<string[]>` (2.5)
- [ ] `WorkflowService.resolveAssigneeRaw()`: new `ORG_UNIT_HEAD` case
      calling `resolveActingHeadForOrgUnit()` against the calling
      object's `orgUnitId` — **prerequisite, confirmed today**: no
      workflow-driven object (Committee, Meeting) currently has an
      `orgUnitId` field; a real, separate schema addition on whichever
      object first consumes `ORG_UNIT_HEAD`, not provided by this
      ticket's own schema changes
- [ ] `SlaMonitorProcessor`: new `sweepOrgUnitVacancies()` step
      (symmetric set/clear, notify only on false→true, 2.5.1) and a
      handover-cutoff check (2.3) — both alongside the existing sweep,
      no new BullMQ queue
- [ ] `notifyTenantAdminsOfOrgUnitVacancy()` — new method mirroring
      `notifyTenantAdminsOfCoverageGap()`/
      `notifyTenantAdminsOfUnassignedStage()`'s exact shape (2.5)
- [ ] `InviteUserDto`: `positionId`/`primaryOrgUnitId` become required;
      conditional check that at least one active `OrgUnit` exists
      before enforcing `primaryOrgUnitId` (2.4)
- [ ] One-time `notifyTenantAdminsOfIncompleteProfiles()` run (or
      equivalent report) for existing tenants at rollout — not a data
      migration (2.4)
- [ ] `TenantService.bootstrap()`: assign the newly-created Tenant Admin
      a default `positionId` (e.g. "Director") at provisioning time;
      `primaryOrgUnitId` correctly stays unset until the tenant creates
      its first `OrgUnit` (2.4's conditional exception)

**Frontend** (belongs to the implementation ticket, not this plan)
- [ ] `position-form.component.ts`: remove the `orgUnitId` field
      entirely; add `isSingleAssignee` and `isUnitHeadPosition` toggles,
      with the latter disabled/validated against the former client-side
      too (mirroring the backend rule, not just relying on the 400)
- [ ] `position-list.component.ts`: remove the org-unit filter/display
      column
- [ ] New Head-management UI on whichever `OrgUnit` detail screen
      exists (assign, declare/complete/cancel handover, assign/clear
      Acting Head) — reads the derived holder(s), not a stored field
- [ ] `invite-user.component.ts`/`user-profile.component.ts`:
      `positionId`/`primaryOrgUnitId` become required fields for the
      invite flow specifically — profile-edit for existing users stays
      as-is per 2.4's no-retroactive-blocking decision
- [ ] Re-add `ORG_UNIT_HEAD` to `workflow-stage-form.component.ts`'s
      assignee-strategy dropdown — only once the backend resolver (2.5)
      is real, per this document's Non-Goals

**Docs**
- [ ] `SYSTEM-REFERENCE.md` Section 5 rewritten to reflect the org-wide
      redesign; new section for the derived-Head/handover/vacancy
      mechanism, explicit about "Head" never being a stored fact
- [ ] `SYSTEM-REFERENCE.md`'s Tier 2 `deactivatePosition()`/no-
      `reactivatePosition()` entry closed (Pending Discussion #5)
- [ ] `CLAUDE.md`'s Assignee Resolution Strategies section updated —
      `ORG_UNIT_HEAD` is no longer "not yet supported"

**Tests**
- [ ] `isSingleAssignee` enforcement: scoped correctly per
      `(positionId, primaryOrgUnitId)` — two different units can each
      independently have their own holder of the same single-assignee
      position; a second holder in the *same* unit is rejected; a
      `primaryOrgUnitId: null` holder is scoped correctly against other
      `null`-unit holders of the same position
- [ ] `isUnitHeadPosition` + `isSingleAssignee: false` rejected at
      create/update time
- [ ] Cross-position head-uniqueness: two different head-conferring
      positions can't both have an active holder in the same unit
      simultaneously, outside a declared handover
- [ ] Handover: declare → both holders resolve via
      `resolveActingHeadForOrgUnit()` during the window → auto-complete
      via sweep leaves only the incoming successor; declare → explicit
      early completion; declare → explicit cancellation restores the
      original sole holder
- [ ] `resolveActingHeadForOrgUnit()`: own unit's holder(s) found
      directly (including the 2-holder handover case); own unit vacant,
      Acting Head found; own unit vacant with no Acting Head, ancestor's
      holder found; full chain exhausted returns `[]`
- [ ] Vacancy sweep: symmetric set/clear; no duplicate notification on
      repeated sweeps of an already-flagged, still-fully-vacant chain;
      notification fires only on the genuine false→true transition;
      vacancy correctly re-derives after an *ordinary* profile edit
      changes a head-position holder's `primaryOrgUnitId` (not just
      through the dedicated Head-management methods)
- [ ] Mandatory-field enforcement: new invite rejected without both
      fields; `primaryOrgUnitId` not required when the tenant has zero
      `OrgUnit` rows, required once one exists; existing active user
      with missing fields is *not* blocked from unrelated actions
      (negative test)
- [ ] `isDeclaredHandoverBypass` is unreachable from
      `UserService.updateProfile()`'s ordinary path (negative test,
      confirming the Non-Goals bypass restriction actually holds in
      code)
- [ ] Tenant isolation on every new query this introduces (same rigor
      as every other ACC-17-pattern check)
