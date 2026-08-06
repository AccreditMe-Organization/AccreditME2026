# Step 22 — Committee Management
# ACC-22: first Governance module in the build sequence. Depends only on
# the navigation shell (ACC-13/14, already shipped). Unblocks Meeting
# Management (depends on committees) and Document Management (depends on
# committees for approval mode) per CLAUDE.md's Key Dependency Rules.

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

Check 1  Git State              PASS — on feature/ACC-22-committee-management, clean
Check 2  Branch vs dev          INFO — branched from dev at 5f38777 (includes ACC-13
                                 through ACC-21, real CI, Design Foundation, i18n/RTL),
                                 0 drift
Check 3  Backend TypeScript     PASS — npx tsc --noEmit → zero errors
Check 4  Frontend TypeScript    PASS — npx tsc --noEmit → zero errors

OVERALL STATUS: 🟢 HEALTHY — ready to plan ACC-22
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

The Committee resource itself — creation, lifecycle (via the workflow
engine's existing COMMITTEE object type), membership management, and the
UI to drive all of it. This is **not** a from-scratch module in the usual
sense: significant scaffolding already exists (see Section 2), built
speculatively by earlier steps that needed a `Committee` FK to exist
without the module itself being built yet.

### What Was Found During Investigation (Not Guessed — Confirmed)

Read `module-designs.md`'s full "Committee Module (Step 10)" section
(lines 787–924) and cross-checked every claim against the actual current
codebase state, not assumption:

- `Committee`/`CommitteeMember` **tables already exist** in
  `schema.prisma` — created in the very first migration
  (`20260712200755_initial_schema`, `[SETUP]`, part of the original
  "21 foundation models" scaffold), purely to satisfy
  `WorkflowStage.committeeId` and `Meeting.committeeId` FK references.
  Current shape:
  ```prisma
  model Committee {
    id, organizationId, name, typeValueId, description,
    quorum (Int), isActive, createdAt, updatedAt
    // relations: organization, members, meetings
  }
  model CommitteeMember {
    id, committeeId, userId, roleValueId, joinedAt, leftAt
  }
  ```
  This does **not** match module-designs.md's spec at all — no
  `nameEn`/`nameAr` (just a single `name`), no `meetingFrequency`,
  `parentCommitteeId`, `termsOfReferenceDocumentId`, `reportingToId`,
  `formedAt`/`dissolvedAt` on Committee; no `isActive` on
  CommitteeMember; and `CommitteeMembershipEvent` doesn't exist at all.
  **This step's migration is an ALTER, not a fresh CREATE.**
- Confirmed via `grep` that **zero application code depends on the
  current stub shape** — `src/foundation/meetings/` and
  `src/foundation/committees/` don't exist yet as directories. The
  *only* code referencing `prisma.committee`/`prisma.committeeMember`
  today is `workflow.service.ts` and `workflow-template.service.ts`
  (see Section 5 — the ACC-17 gap). Free to reshape the schema without
  breaking anything else.
- `Meeting`/`AgendaItem` stub models also already exist (same original
  migration), with `Meeting.committeeId` as a nullable FK to
  `Committee.id`. Not this step's concern (Meeting Management is a
  separate future ticket per CLAUDE.md), but confirmed our migration
  must not change `Committee.id`'s type/meaning — only additive/renamed
  columns — so `Meeting`'s existing FK stays valid.
- `WorkflowObjectType.COMMITTEE` **already in the enum**, and a full
  **6-stage COMMITTEE workflow is already seeded** in
  `workflow.seed.ts` (from ACC-9) — stage keys `formation`,
  `terms_review`, `active`, `suspended`, `dissolution_pending`,
  `dissolved`, matching module-designs.md's lifecycle exactly
  (FORMATION → TERMS_REVIEW → ACTIVE →
  SUSPENDED/DISSOLUTION_PENDING → DISSOLVED). **This step does not
  seed a new workflow** — the lifecycle *shell* already runs through
  the generic `WorkflowService`/`WorkflowTemplateService`. What's
  missing is the actual Committee/CommitteeMember *resource* (the
  record a `WorkflowInstance` of type COMMITTEE would actually point
  at) and the UI to create/manage it.
- `COMMITTEES_PERMISSIONS.VIEW`/`.MANAGE` already exist in
  `permissions.ts` and are already spread into `QUALITY_MANAGER`'s and
  (transitively, via `ALL`) `TENANT_ADMIN`'s seeded permission sets.
  See Pending Discussion #2 for a real discrepancy this step surfaces.
- Lookups already seeded: `committee_type` (5 values: quality/safety/
  executive_board/clinical/advisory) and `committee_member_role`
  (6 values: chairman/vice_chairman/secretary/member/observer/advisor).
  Neither has an `attributeSchema` — no dynamic attribute form needed,
  no lookup work required for this step.
- `terms_of_reference` document type is already seeded in the
  `document_type` lookup category (numberingPrefix `TOR`,
  `requiresCommitteeApproval: true`, confirmed present) — but **no
  `Document` model exists in `schema.prisma` at all**. Document
  Management hasn't been built. See Pending Discussion #1 — this is a
  real circular-dependency conflict with module-designs.md's TOR
  design, not something to guess past.

---

## 2. DATA MODEL — MIGRATION STRATEGY (ALTER, not CREATE)

All 8 Pending Discussions (Section 6) are resolved as of this revision —
the schema below reflects every resolution, not the original proposal.

### Committee (ALTER existing table)

```prisma
model Committee {
  id                         String    @id @default(cuid())
  organizationId             String
  nameEn                     String    // RENAME from `name` — see migration note below
  nameAr                     String    // NEW, required — confirmed zero existing rows
                                       // anywhere (Pending Discussion #3, resolved),
                                       // so this is a plain NOT NULL column, no backfill needed
  typeValueId                String    // unchanged (already correct — FK to LookupValue)
  purpose                    String?   // RENAME from `description` (module-designs.md calls it `purpose`)
  quorumCount                Int       @default(0) // RENAME from `quorum`
  meetingFrequency           CommitteeMeetingFrequency @default(AS_NEEDED) // NEW enum
  parentCommitteeId          String?   // NEW — sub-committees
  termsOfReferenceDocumentId String?   // NEW — nullable, deliberately unpopulated until
                                       // Document Management ships (Pending Discussion #1,
                                       // resolved: option (a))
  reportingToCommitteeId     String?   // NEW — mutually exclusive with reportingToRoleId,
                                       // enforced at the service layer, not the DB
                                       // (Pending Discussion #4, resolved: option (a),
                                       // two real FK columns over a polymorphic column)
  reportingToRoleId          String?   // NEW — see reportingToCommitteeId above
  formedAt                   DateTime? // NEW — point-in-time marker, set by a workflow
                                       // transition action on entry to ACTIVE
  dissolvedAt                DateTime? // NEW — point-in-time marker, set by a workflow
                                       // transition action on entry to DISSOLVED
  isActive                   Boolean   @default(true) // soft-deactivate flag, independent
                                       // of workflow lifecycle stage — no `status` field
                                       // exists on this model at all, see the note below
                                       // (Pending Discussion #5, resolved)
  createdAt                  DateTime  @default(now())
  updatedAt                  DateTime  @updatedAt

  organization         Organization      @relation(fields: [organizationId], references: [id])
  parentCommittee      Committee?        @relation("SubCommittees", fields: [parentCommitteeId], references: [id])
  subCommittees        Committee[]       @relation("SubCommittees")
  reportingToCommittee Committee?        @relation("CommitteeReportingTo", fields: [reportingToCommitteeId], references: [id])
  reportsToMe          Committee[]       @relation("CommitteeReportingTo")
  reportingToRole      Role?             @relation(fields: [reportingToRoleId], references: [id])
  members              CommitteeMember[]
  membershipEvents     CommitteeMembershipEvent[]
  meetings             Meeting[]

  @@index([organizationId])
  @@index([parentCommitteeId])
  @@index([reportingToCommitteeId])
  @@index([reportingToRoleId])
}

enum CommitteeMeetingFrequency {
  WEEKLY
  MONTHLY
  QUARTERLY
  BIANNUAL
  ANNUAL
  AS_NEEDED
}
```

**No `status`/`CommitteeStatus` field on this model — resolved
differently than this plan's own original proposal.** Verbatim re-check
of module-designs.md's actual "Data Models (Step 10)" section confirms a
stored status field was never part of the spec — only the conceptual
FORMATION → ... → DISSOLVED lifecycle stages were described, which the
workflow engine already tracks. Current lifecycle stage is read live
from `WorkflowInstanceStage` (a Prisma `include` at query time, not N+1
per-row queries), which remains the single source of truth with no
synchronized read-cache duplicated onto `Committee`.

**This is now the general policy for every entity with a real
`WorkflowObjectType`** (Document, Incident, Audit, CAPA, Meeting,
Committee, and later AccreditationRound/Gap) — record this as a new
CLAUDE.md architecture rule once this ticket ships. `Task` and
`AuditProgram`/`AuditProgramItem` are confirmed NOT
`WorkflowObjectType`-tracked and correctly keep their own independent
status fields per their own module specs — this policy does not apply
to them.

**`Role` needs a new back-relation** to support `reportingToRole` above
(Prisma requires both sides of a relation to be declared):
```prisma
model Role {
  // ...existing fields unchanged...
  reportingCommittees Committee[] // NEW — back-relation for Committee.reportingToRoleId
}
```

### CommitteeMember (ALTER existing table)

```prisma
model CommitteeMember {
  id             String    @id @default(cuid())
  organizationId String    // NEW — denormalized from Committee.organizationId, set once
                            // at creation, never updated (Pending Discussion #7, resolved)
                            // — matches CLAUDE.md's literal "every tenant table has an
                            // organizationId field" rule, and lets every tenant isolation
                            // test on this table use the same findFirst({ id,
                            // organizationId }) shape as everywhere else, instead of a
                            // one-off relation-filter special case.
  committeeId    String
  userId         String
  roleValueId    String    // unchanged
  joinedAt       DateTime  @default(now())
  leftAt         DateTime?
  isActive       Boolean   @default(true) // NEW — derived STRICTLY from leftAt at the
                            // service layer (isActive = leftAt === null), never set
                            // independently. Exists for query/index convenience and to
                            // match module-designs.md's explicit spec, not as a second,
                            // independently-driftable source of truth (Pending
                            // Discussion #6, resolved). The two existing
                            // workflow.service.ts queries that currently filter on
                            // `leftAt: null` switch to `isActive: true` once this column
                            // exists (Section 3).

  committee      Committee @relation(fields: [committeeId], references: [id])
  user           User      @relation(fields: [userId], references: [id])

  @@unique([committeeId, userId])
  @@index([organizationId])
  @@index([committeeId])
  @@index([userId])
}
```

### CommitteeMembershipEvent (NEW model)

```prisma
model CommitteeMembershipEvent {
  id             String    @id @default(cuid())
  organizationId String    // NEW — same denormalization rationale as CommitteeMember
                            // above (Pending Discussion #7, resolved)
  committeeId    String
  userId         String
  roleValueId    String
  action         CommitteeMembershipAction // JOINED | LEFT | ROLE_CHANGED
  effectiveDate  DateTime
  reason         String?
  approvedBy     String?   // userId — nullable, not every event needs approval
  createdAt      DateTime  @default(now())

  committee      Committee @relation(fields: [committeeId], references: [id])
  user           User      @relation(fields: [userId], references: [id])

  @@index([organizationId])
  @@index([committeeId])
  @@index([userId])
}

enum CommitteeMembershipAction {
  JOINED
  LEFT
  ROLE_CHANGED
}
```

Per module-designs.md: **membership changes within the ACTIVE stage are
NOT workflow transitions** — they're recorded as `CommitteeMembershipEvent`
rows, giving a complete audit trail independent of (and in addition to)
the generic `AuditLog` table. `CommitteeMember` itself stays the
current-state table (who's active right now); `CommitteeMembershipEvent`
is the append-style history.

### Migration Mechanics

- `npx prisma migrate dev --name "extend-committee-tables-full-spec"`
- Column rename (`name` → `nameEn`, `description` → `purpose`, `quorum` →
  `quorumCount`) needs an explicit `@map` or manual SQL rename in the
  generated migration if Prisma's diff engine doesn't detect the rename
  as a rename (it may instead propose drop+add, which would lose data).
  Confirmed zero existing Committee rows anywhere (Pending Discussion #3,
  resolved), so a drop+add costs no real data either way — but the
  generated migration SQL must still be inspected before applying, per
  CLAUDE.md's "never modify migration files manually" rule; regenerate
  with a different approach if it proposes anything destructive, don't
  hand-edit the file. **This inspection is this ticket's mandatory
  checkpoint** — see the note at the top of Section 3.

---

## 3. TENANT ISOLATION — ACC-17 PATTERN, APPLIED THROUGHOUT

> **Mandatory checkpoint**: after Section 2 (migration) and this section
> (ACC-17 `committeeId` gap closure) are committed, PAUSE before starting
> Section 4 (UI work). Show the generated migration SQL (confirm no
> destructive drop+add on the renamed columns, per CLAUDE.md's
> migration-safety rule) and confirm `workflow.service.ts`'s and
> `workflow-template.service.ts`'s existing test suites still pass after
> the `committeeId`/`isActive`/`organizationId` query changes below —
> this migration touches already-shipped, already-tested workflow engine
> code, the same discipline as every prior foundational-risk checkpoint
> this session (ACC-15's Tailwind commit, ACC-19's LanguageService).

Every new query in the Committee module itself follows the pattern
already confirmed correct in ACC-17's audit:

- All `CommitteeService` queries scoped by `organizationId` sourced from
  `@CurrentTenant()` — never from the request body or a client-supplied
  field.
- `POST /committees/:id/members` (or equivalent) accepting a
  client-supplied `userId` must re-validate that user belongs to the
  caller's org before writing — the exact `validateAssigneeUserId()`
  pattern in `workflow-template.service.ts`, and the exact
  `NotificationService.create()` pattern from ACC-17.
- `parentCommitteeId` (sub-committees) is itself a client-supplied ID
  referencing another Committee row — same re-validation requirement:
  confirm the parent belongs to the caller's org before allowing the
  link. Easy to miss since it's committee-to-committee, not
  committee-to-user; flagging explicitly so it doesn't slip through.
- `reportingToCommitteeId` and `reportingToRoleId` (Pending Discussion
  #4, resolved as two separate FK columns) are **two distinct
  validation paths, not one shared check** — each references a
  different Prisma model, so each needs its own query and its own
  `NotFoundException` message. Do not collapse these into one
  `validateReportingTo()` helper that only actually checks whichever
  field happens to come first; write two genuinely separate lookups
  (or one function with an explicit `if (dto.reportingToCommitteeId)`
  / `else if (dto.reportingToRoleId)` branch, each branch calling a
  different query):
  - `reportingToCommitteeId` → `prisma.committee.findFirst({ where: { id: dto.reportingToCommitteeId, organizationId } })`
    — same `Committee` lookup shape as `parentCommitteeId` above.
    Throw `NotFoundException('Reporting-to committee not found in this tenant')`
    if not found.
  - `reportingToRoleId` → `prisma.role.findFirst({ where: { id: dto.reportingToRoleId, organizationId } })`
    — a **separate** query against the `Role` model, not `Committee`.
    Throw `NotFoundException('Reporting-to role not found in this tenant')`
    if not found.
- A tenant isolation test (`should NOT return records belonging to a
  different tenant`) for every new `findMany`/`findFirst` — matching
  CLAUDE.md's Testing Strategy requirement and the count-must-match-query-
  count checklist item from `/ready-to-pr`.

### Closing the ACC-17 `committeeId` Gap (this step's own scope)

**Write-time** (mirrors `validateAssigneeUserId()` exactly):

```typescript
// workflow-template.service.ts
private async validateCommitteeId(committeeId: string, organizationId: string): Promise<void> {
  const committee = await this.prisma.committee.findFirst({ where: { id: committeeId, organizationId } });
  if (!committee) {
    throw new NotFoundException('Committee not found in this tenant');
  }
}
```

Called from `addStage()` and `updateStage()` exactly where
`validateAssigneeUserId()` is currently called for `assigneeUserId`,
replacing the two `// TODO(Committee Management): ...` comments at
lines ~344 and ~396.

**Read-time defense-in-depth** (three call sites in `workflow.service.ts`,
found during this investigation — not previously flagged in the ACC-17
ticket text, but the same class of gap):

1. `isApprovalThresholdMet()` — `prisma.committee.findUnique({ where: { id: fromStage.committeeId } })`
   → change to `findFirst({ where: { id: fromStage.committeeId, organizationId } })`.
2. `resolveAssigneeRaw()`'s `COMMITTEE` case — `prisma.committeeMember.findMany({ where: { committeeId: stage.committeeId, leftAt: null } })`
   → change to `findMany({ where: { committeeId: stage.committeeId, organizationId, isActive: true } })`
   — direct `organizationId` filter on the now-denormalized column
   (Pending Discussion #7, resolved) and `isActive` instead of
   `leftAt: null` (Pending Discussion #6, resolved).
3. `resolveApproverPool()` — same pattern as #2.

All three already have `organizationId` in scope in their calling
context (`WorkflowService` methods all take `organizationId` as a
parameter) — this is a query-shape fix, not a new plumbing requirement.

---

## 4. DESIGN FOUNDATION REUSE (ACC-15)

- Spacing/typography scale: applied throughout, no deviation.
- `CardComponent`: committee list as cards (one per committee) fits the
  existing pattern used elsewhere — no new component needed.
- `StatusBadgeComponent`: **did not have an obvious existing variant to
  reuse** — resolved via Pending Discussion #8 as a new `'committee'`
  variant. Its `StatusBadgeVariant` union type is currently
  `'status' | 'severity' | 'account'`, each mapped to a fixed
  `--am-{variant}-*` token set in `tokens.scss`. Committee's lifecycle
  (FORMATION/TERMS_REVIEW/ACTIVE/SUSPENDED/DISSOLUTION_PENDING/DISSOLVED)
  didn't cleanly fit any of the three:
  - `'status'` tokens are draft/review/approved/rejected/published/
    archived — document-lifecycle-shaped, not committee-shaped.
  - `'account'` tokens (trial/active/suspended/cancelled/offboarding)
    are semantically closer (active/suspended overlap directly) but
    that scale was deliberately kept as tenant/organization-account-only
    per its own code comment — reusing it for committees would blur
    that boundary.
  - `'severity'` doesn't apply at all.
- `Committee.typeValueId` (committee_type lookup) also needs a visual
  treatment somewhere in the list/detail UI — same open question,
  bundled into Pending Discussion #8.
- Add-flow modal convention (ACC-18): new committee creation via
  `p-dialog`, not a routed page — mirrors `org-unit-form`/
  `position-list`'s pattern (parent list component owns
  `formVisible`/`editingCommittee` signals, `@if` + `p-dialog`).
  Membership add/remove likely also modal-based (adding a member is a
  small form: user picker + role picker) — same convention.

---

## 5. I18N/RTL CONVENTION (ACC-19)

- Every new template string uses `| translate` — no exceptions, per the
  exact bug class ACC-19's sweep found (a signal/property bound directly
  without the pipe renders the raw i18n key — invisible in English,
  glaring in Arabic).
- Every new key added to **both** `en.json` and `ar.json` in the same
  commit that introduces the UI using it — not deferred to a follow-up,
  per ACC-19's own established discipline.
- If a new `StatusBadgeComponent` variant is added (Pending Discussion
  #8), its translation keys follow the existing `{variant}.{value}`
  convention (e.g. `committee.formation`, `committee.active`, etc.) —
  confirmed this is how `'status'`/`'account'` variants already work
  before assuming it for a new variant.

---

## 6. PENDING DISCUSSIONS — ALL RESOLVED

### 1. Terms of Reference — circular dependency with Document Management

module-designs.md is explicit: "Terms of Reference: Formal document in
the Document module (not a text field)... Created when committee enters
FORMATION... Goes through document approval workflow." But **Document
Management does not exist yet** — no `Document` model in the schema at
all — and per CLAUDE.md's own Key Dependency Rules, **Document
Management depends on Committee** (for approval mode), meaning Document
Management is scheduled to ship *after* this module, not before. Building
Committee Management's FORMATION stage exactly as module-designs.md
describes it is not possible without Document Management already
existing — a genuine circular dependency, not a sequencing oversight I
can resolve by re-reading the spec more carefully.

**Options:**
- (a) `termsOfReferenceDocumentId` stays a nullable field, entirely
  unpopulated by this step — committee creation/FORMATION does not
  block on it, and it gets wired up retroactively once Document
  Management ships (which will need to link back to existing
  committees anyway).
- (b) A lightweight stand-in (e.g. a simple file upload field + text
  field on `Committee` itself) as a temporary substitute for the full
  Document-module-backed TOR, migrated later.
- (c) Reorder the build sequence so a minimal slice of Document
  Management ships first — contradicts CLAUDE.md's already-documented
  dependency direction and is a much bigger scope change than this
  ticket should absorb.

**RESOLVED: option (a).** `termsOfReferenceDocumentId` stays nullable,
unpopulated until Document Management ships. FORMATION stage's "Terms of
Reference drafted" business rule becomes a manual/external process for
now (tenant admin drafts it outside the system), same as how the
workflow's `CREATE_TASK` action can still remind someone to do this
without an actual Document record backing it.

### 2. `committees:approve` — real discrepancy between module-designs.md and the already-shipped workflow seed

module-designs.md's transition table specifies:
```
TERMS_REVIEW → ACTIVE             "Approve Committee"      committees:approve
DISSOLUTION_PENDING → DISSOLVED   "Confirm Dissolution"     committees:approve
```
(distinct from `committees:manage` for the other four transitions) — but
the **already-shipped** `workflow.seed.ts` (from ACC-9) uses
`committees:manage` for **all eight** transitions, including these two.
`COMMITTEES_PERMISSIONS` currently has only `VIEW`/`MANAGE` — no
`APPROVE`.

This mirrors the granularity pattern already established elsewhere
(documents:review vs. documents:approve, audits:execute vs.
audits:report) and CLAUDE.md states module-designs.md is the
authoritative source for workflow stage details — suggesting the
already-shipped seed under-specified this back in ACC-9 (before
Committee Management itself was ever built) rather than module-designs.md
being wrong.

**RESOLVED — confirmed real, fix it.** Add
`APPROVE: 'committees:approve'` to `COMMITTEES_PERMISSIONS`, update the
two approval transitions in `workflow.seed.ts` to require it instead of
`committees:manage`, and backfill the existing demo tenant's seeded
permissions (same pattern ACC-16 used for the Org Positions permission-
seed gap) — `seedDefaultWorkflows()`/role seeding run per-tenant at
provisioning time, not auto-re-synced, so the demo tenant needs an
explicit reseed call to pick up the corrected transition permission.
`APPROVE` flows into `QUALITY_MANAGER` and `TENANT_ADMIN` automatically
via the existing `Object.values(COMMITTEES_PERMISSIONS)` spread — no
other `role.seed.ts` changes needed.

### 3. `nameAr` backfill for the migration

`Committee.nameAr` is a new required (`String`, not `String?`) column
per module-designs.md's bilingual requirement. If any Committee rows
already exist in any environment (shouldn't be true in dev — confirmed
no committee-creating code exists yet — but worth explicitly ruling out
rather than assuming), the migration needs either a default value
strategy or a data backfill step before the column can go NOT NULL.

**RESOLVED — confirmed zero existing Committee rows in any environment**
(no committee-creating code has ever shipped). Non-issue — proceed with
`nameAr` as a plain `NOT NULL` column, no backfill logic needed.

### 4. `reportingToId` — polymorphic shape unclear

module-designs.md says a committee "reports to" either another committee
or a role, but doesn't specify how that's modeled (a single nullable FK
can't point at two different tables cleanly in Prisma without either a
polymorphic-association workaround or two separate nullable columns).

**Options:**
- (a) Two nullable columns: `reportingToCommitteeId` + `reportingToRoleId`,
  exactly one populated at a time (enforced at the service layer, not
  the DB).
- (b) Single `reportingToId` + a `reportingToType` discriminator enum
  (`COMMITTEE` | `ROLE`), resolved manually in application code (no FK
  constraint possible on a polymorphic column).

**RESOLVED: option (a).** Two separate nullable FK columns —
`reportingToCommitteeId` + `reportingToRoleId`, exactly one populated at
a time, enforced at the service layer. Reflected in Section 2's schema.

### 5. `Committee.status` vs. the `WorkflowInstance`'s own current-stage tracking

The workflow engine already tracks an object's current lifecycle stage
via `WorkflowInstanceStage` (per the Core Concepts in CLAUDE.md's
Workflow Engine section) — so does `Committee` need its own denormalized
`status` field at all, or should every read of "what state is this
committee in" go through the `WorkflowInstance`/`WorkflowInstanceStage`
tables?

**RESOLVED — differently than this plan's own original proposal, after
further review.** REMOVE the `status`/`CommitteeStatus` field from the
`Committee` model entirely — do NOT add a denormalized status column.
Confirmed via module-designs.md's actual "Data Models (Step 10)" section
(verbatim re-checked) that a stored status field was never part of the
spec in the first place — only the conceptual lifecycle stages were
described. Read current lifecycle stage live via `WorkflowInstanceStage`,
joined efficiently at query time (a Prisma `include`, not N+1 queries per
row) — `WorkflowInstanceStage` remains the single source of truth, full
stop, no synchronized read-cache.

**This is now the general policy for every entity with a real
`WorkflowObjectType`** (Document, Incident, Audit, CAPA, Meeting,
Committee, and later AccreditationRound/Gap) — record this as a new
architectural rule in CLAUDE.md once this ticket ships. Does NOT apply
to `Task` or `AuditProgram`/`AuditProgramItem`, which are confirmed NOT
`WorkflowObjectType`-tracked and correctly keep their own independent
status fields per their own module specs. Reflected in Section 2's
schema (no `status` field, no `CommitteeStatus` enum).

### 6. `CommitteeMember.isActive` vs. `leftAt: null` as the "active" proxy

module-designs.md's `CommitteeMember` spec includes `isActive`
explicitly, but the already-existing `workflow.service.ts` code
(`resolveAssigneeRaw()`'s COMMITTEE case, `resolveApproverPool()`)
already queries `leftAt: null` as its "is this member currently active"
check. Adding a real `isActive` column risks two sources of truth that
could drift (a member with `leftAt: null` but `isActive: false`, or vice
versa) if not kept in lockstep by the service layer.

**RESOLVED.** Add `isActive` per the spec, but derive it strictly from
`leftAt` at the service layer (`isActive = leftAt === null`) — never set
independently. Update the two existing `workflow.service.ts` queries to
filter on `isActive: true` instead of `leftAt: null` once the column
exists. Reflected in Section 2's schema and Section 3's read-time fixes.

### 7. Denormalize `organizationId` onto `CommitteeMember`?

The read-time defense-in-depth fix in Section 3 (#2) requires a relation
filter (`committee: { organizationId }`) rather than a direct column
filter, since `CommitteeMember` has no `organizationId` of its own.
Every other tenant-scoped table in this schema has its own direct
`organizationId` column per CLAUDE.md's Multi-Tenancy rule ("Every
database table holding tenant data MUST have an organizationId field") —
`CommitteeMember` (and the new `CommitteeMembershipEvent`) arguably
should too, for consistency with that rule and for index-efficiency on
tenant-scoped queries, rather than relying on a join through `Committee`
every time.

**RESOLVED — yes.** Add `organizationId` directly to both
`CommitteeMember` and `CommitteeMembershipEvent`, set once at creation,
matching CLAUDE.md's literal "every tenant table has organizationId"
rule. Reflected in Section 2's schema.

### 8. `StatusBadgeComponent` variant for committee status/type

As described in Section 4 — neither `'status'`, `'severity'`, nor
`'account'` cleanly fits Committee's 6-stage lifecycle or its
`committee_type` lookup values.

**Options:**
- (a) New `'committee'` variant added to `StatusBadgeVariant`, with its
  own `--am-committee-*` token set in `tokens.scss` (6 colors, one per
  lifecycle stage) and `committee.{value}` translation keys.
- (b) Reuse `'account'` tokens directly (active/suspended already
  overlap; FORMATION/TERMS_REVIEW could map to `trial`, DISSOLVED to
  `cancelled`/`offboarding`) despite the semantic mismatch the existing
  code comment warns about.
- (c) A plain `p-tag` with `severity` inferred ad hoc per stage
  (PrimeNG's own component, no `StatusBadgeComponent` involvement at
  all) — matches how `lookup-value-list.component.ts` already renders
  SYSTEM/TENANT layer tags, for instance.

**RESOLVED, then REVISED after implementation surfaced a factual error in
the premise.** The originally approved option (a) — a new `'committee'`
`StatusBadgeComponent` variant keyed on a stage "value" like
`formation`/`active`, mapped to `--am-committee-{value}` colors and
`committee.{value}` translation keys — assumed `WorkflowStage` has a
stable, persisted key/slug per stage. **It does not.** Confirmed directly
against `schema.prisma`: `WorkflowStage` has only `id` (a per-template
cuid), `nameEn`/`nameAr` (tenant-editable bilingual display text), and
`order` — no `key` column at all. The `key: 'formation'` etc. values in
`workflow.seed.ts` are an in-memory convenience used only to resolve
`fromStageKey`/`toStageKey` into real stage IDs at seed time; they are
never written to the database and have no runtime existence once seeding
completes. Since stages are tenant-editable via the workflow builder UI
(CLAUDE.md's "Tenant Configuration UI" section), even a freshly-seeded
"Formation" stage isn't guaranteed to keep that name — there is nothing
stable to bind a colored badge to.

**FINAL RESOLUTION (option A of the re-review): no colored badge.** The
committee detail page shows the current `WorkflowInstanceStage`'s own
`nameEn`/`nameAr` as plain text (or a neutral, uncolored `p-tag` if that
fits the layout better) — no `--am-committee-*` tokens, no new
`StatusBadgeComponent` variant, no `committee.{value}` translation keys.
The `tokens.scss` and `status-badge.component.ts` edits made under the
original resolution were reverted before proceeding. `committee_type`
(the lookup value, not the lifecycle) is unaffected — it still gets a
plain translated label per the earlier resolution.

**This finding is bigger than Committee Management and must not be
lost**: `WorkflowStage` having no persisted, stable key/slug — only
tenant-editable `nameEn`/`nameAr`/`order` — blocks any future *semantic*
(not merely positional) colored-badge or icon treatment across **every**
`WorkflowObjectType`-driven module, not just this one: Document,
Incident, CAPA, Audit, Gap, and Committee all share this exact gap. This
becomes a real candidate ticket once a second workflow-driven module
actually needs a semantic stage treatment (most likely Document or
Incident, the next modules after Governance per CLAUDE.md's Build
Sequence). **Flag for CLAUDE.md's Open/Deferred Items section in the
next batch sync** — not resolved by this ticket, and not this ticket's
scope to fix (would require a schema change to `WorkflowStage` itself,
affecting the shared workflow engine, not a Committee-specific fix).

---

## 7. NON-GOALS (Explicit — Do Not Drift Into These)

- **Meeting Management** — separate future ticket (depends on
  committees, per CLAUDE.md). `Meeting`/`AgendaItem` stub models are
  read-only context for this ticket, not something to build out.
- **Document Management / real Terms of Reference documents** — see
  Pending Discussion #1. This ticket does not build any part of the
  Document module.
- **AI Integration Points** (TOR_DRAFTING, COMMITTEE_HEALTH_REPORT,
  DECISION_PATTERN_ANALYSIS) — all three depend on infrastructure this
  ticket doesn't build (TOR_DRAFTING needs Document Management;
  COMMITTEE_HEALTH_REPORT and DECISION_PATTERN_ANALYSIS need enough
  committee/decision history to be meaningful, which won't exist on
  day one). Deferred to a future AI-integration pass once the base
  module has real usage data.
- **Full RTL visual audit** of the new committee screens — per the
  already-established deferral (ACC-19), this stays bundled with the
  future full-audit ticket, not redone per-module.

### Discovered During Browser Verification — Not This Ticket's Scope to Fix

`prisma/demo-seed.ts` never calls `WorkflowTemplateService.seedDefaultWorkflows()`
— it mirrors `LookupService.seedSystemData()` and `RoleService.seedSystemRoles()`
by hand (same ts-node/generated-client-import constraint documented in its own
header comment), but has no equivalent hand-rolled workflow-template seeding
step. This means the demo org (and any other org provisioned only via
`demo-seed.ts`, not the real `TenantService.provisionTenant()` bootstrap flow)
has **zero** `WorkflowTemplate` rows for **any** object type, not just
COMMITTEE — confirmed via `GET /workflow-templates` returning `[]` against a
freshly-authenticated demo session. This was invisible until now because no
module before Committee Management has ever actually called
`WorkflowService.startInstance()` against real demo data — Committee is the
first. Worked around for this verification only via a temporary script
(reimplementing `seedDefaultWorkflows()`'s exact logic against the demo org,
deleted after use); the demo org's database now has real `WorkflowTemplate`
rows going forward, but `demo-seed.ts` itself was **not** modified. Flag as a
real, standalone fix needed in `demo-seed.ts` (call the equivalent seeding
logic for all default object types) before the next person relies on `npm run
seed:demo` producing a fully-working demo environment.

---

## 8. ACCEPTANCE CRITERIA

- [x] All 8 Pending Discussions resolved before `/new-module` begins
- [x] `Committee`/`CommitteeMember` migrated to full spec via ALTER
      migration (not a fresh CREATE) — confirmed no data loss on
      pre-existing rows (Pending Discussion #3)
- [x] `CommitteeMembershipEvent` model added
- [x] Committee CRUD: create, list, detail, update, sub-committee linking
- [x] Membership management: add/remove/role-change members, each
      recorded as a `CommitteeMembershipEvent` (not a workflow transition)
- [x] Every new/modified query scoped by `organizationId` from
      `TenantGuard` — never client input
- [x] `parentCommitteeId` re-validated against the caller's org before
      write (`prisma.committee.findFirst({ id, organizationId })`)
- [x] `reportingToCommitteeId` re-validated against the caller's org
      before write — via its OWN `prisma.committee.findFirst({ id,
      organizationId })` call, independent of `parentCommitteeId`'s check
- [x] `reportingToRoleId` re-validated against the caller's org before
      write — via a SEPARATE `prisma.role.findFirst({ id,
      organizationId })` call (a different Prisma model than the two
      Committee checks above, not a shared helper that only checks one)
- [x] Member `userId` re-validated against the caller's org before write
- [x] ACC-17's dormant `committeeId` gap fully closed: write-time
      validation in `workflow-template.service.ts`, read-time
      defense-in-depth in all 3 `workflow.service.ts` call sites
- [x] Tenant isolation test added for every new query
- [x] New UI uses ACC-15's spacing/typography/`CardComponent` patterns.
      **Revised from the original criterion**: no `StatusBadgeComponent`
      treatment — Pending Discussion #8 was re-resolved after
      implementation surfaced that `WorkflowStage` has no persisted
      stage key/slug to bind a colored badge to (see Section 6). Current
      lifecycle stage is shown as plain `nameEn`/`nameAr` text instead.
- [x] Add-flow uses `p-dialog`, not a routed page (ACC-18 convention)
- [x] Every new UI string has a `| translate` pipe and matching
      `en.json`/`ar.json` keys added in the same commit
- [x] Backend TypeScript: zero errors
- [x] Frontend TypeScript: zero errors
- [x] All tests passing including tenant isolation (569/569 backend
      tests, 12 tenant isolation tests, all green; frontend 27/27 green)
- [x] Real browser verification (login → create committee → detail
      page → add member → membership history) via a scripted Playwright
      session — confirmed working end-to-end; also caught and fixed a
      real bug (see Section 6, Discussion #8) where the "Reports To"
      `p-selectButton`'s custom item template used a bare `<ng-template
      let-mode>` instead of the `#item` template-reference-variable
      PrimeNG's `SelectButton` actually queries for, silently rendering
      blank buttons
- [x] `WorkflowTransitionActionsComponent` added and wired into
      `CommitteeDetailComponent` — found missing during the browser
      verification above (a committee that can never leave FORMATION
      isn't a working module); built generic (WorkflowInstance/stage
      inputs only, no Committee-specific logic) for reuse across every
      future workflow-driven module
- [x] PR opened to dev — explicitly requested

---

## 9. DEPENDENCIES

- Navigation shell (ACC-13/14) — already exists, satisfied.
- Workflow engine (ACC-9) — `WorkflowObjectType.COMMITTEE` and the
  6-stage seed already exist, satisfied.
- Design Foundation (ACC-15) — `CardComponent`/`StatusBadgeComponent`/
  spacing scale already exist, satisfied (pending Discussion #8 for the
  exact badge treatment).
- i18n/RTL Foundation (ACC-19) — `LanguageService`/`| translate`
  convention already exists, satisfied.
- Lookup system (ACC-7) — `committee_type`/`committee_member_role`
  already seeded, satisfied.
- **Not yet satisfied**: Document Management (for real TOR linkage) —
  see Pending Discussion #1, worked around via a nullable field for now.
- **Blocks**: Meeting Management, Document Management (per CLAUDE.md's
  Key Dependency Rules) — this ticket unblocks both once merged.
