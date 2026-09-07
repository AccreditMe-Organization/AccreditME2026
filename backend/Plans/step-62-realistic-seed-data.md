# ACC-62 — Realistic Seed Data: Two Tenants

**Status:** PLAN ONLY — no code written, no data changed.
**Branch:** `feature/ACC-62-realistic-seed-data`
**Depends on:** the investigation recorded in this document's Section 5 and
Section 7 (Pending Discussion #1), which is a hard blocker.

---

## 0. What this replaces, and what it does not

Today the database holds 4 organizations: the platform org, `Demo
Organization` (22 users, 8 committees, 1,226 audit rows), and two leftover
test tenants (`ACC45 Verify Temp`, `ACC46 P2 Verify`) created during earlier
verification work and never cleaned up. Between them: 45 users, 2,365 audit
rows, 21 org units, 8 committees.

None of it is realistic. `Demo Organization` has a flat-ish structure, users
named after test scenarios, and committees created to exercise a specific
ticket. Nothing in it resembles what a real customer's tenant looks like, so
nothing in it is useful for a demo, for persona testing, or for finding the
class of bug that only appears at real organizational depth.

This plan replaces all of it with two tenants that look like real
customers — one hospital, one university — and deliberately encodes four
edge cases that are otherwise only reachable by hand-editing the database.

**Not in scope:** any change to `TenantService.bootstrap()` or the four
seeders it calls. This layers on top of them (Section 6).

---

## 1. The two tenants

Both names are **fictional**, chosen to be plausible for the GCC/MENA market
without implying a real institution or customer.

### Tenant A — Al Nakheel Specialist Hospital (`al-nakheel`)

Country: SA. 21 org units across 4 levels (root + 3, as required).

```
Al Nakheel Specialist Hospital                    [NAKHEEL]        root
├── Medical Affairs                               [MED]            department
│   ├── Internal Medicine Ward                    [MED-IM]         ward
│   │   ├── Cardiology Unit                       [MED-IM-CAR]     unit
│   │   └── Endocrinology Unit                    [MED-IM-END]     unit
│   ├── Critical Care Ward                        [MED-CC]         ward
│   │   ├── Adult ICU                             [MED-CC-AIC]     unit
│   │   └── Neonatal ICU                          [MED-CC-NIC]     unit   ← EDGE CASE 1
│   └── Surgical Ward                             [MED-SU]         ward
│       └── Operating Theatres Unit               [MED-SU-OT]      unit
├── Nursing Affairs                               [NUR]            department
│   ├── Inpatient Nursing Ward                    [NUR-IP]         ward
│   │   └── Ward Nursing Unit                     [NUR-IP-WN]      unit
│   └── Outpatient Nursing Ward                   [NUR-OP]         ward
├── Quality & Patient Safety                      [QPS]            department
│   ├── Accreditation Section                     [QPS-ACC]        section
│   └── Infection Control Section                 [QPS-IC]         section
└── Clinical Support Services                     [CSS]            department
    ├── Pharmacy Section                          [CSS-PHR]        section  ← EDGE CASE 3
    └── Laboratory Section                        [CSS-LAB]        section
        └── Microbiology Unit                     [CSS-MIC]        unit
```

> **Code correction (implementation, commit 2).** `CreateOrgUnitDto` enforces
> `@MaxLength(10)` and `/^[A-Z0-9-]+$/` on `code`, which this plan's first
> draft did not account for. `CSS-LAB-MIC` was 11 characters and would have
> been rejected at write time; it is `CSS-MIC` above. `MED-IM-CAR` and
> `MED-CC-NIC` are exactly 10 and fit. `validateFixture()` now enforces the
> real limit so this class of error fails before any database write.

**A deliberate deviation from the brief, flagged for approval.** The brief
says the hospital runs Departments → Wards → Units. That is right for
*clinical* departments and wrong for administrative ones — no real hospital
has a "Quality & Patient Safety Ward". So clinical departments (Medical,
Nursing) use Ward at level 2, and administrative ones (Quality, Clinical
Support) use Section. If you would rather have it uniform, say so and I will
make every level-2 unit a Ward.

`OrgUnit.type` is a free-text `String?` with **no validation anywhere** — the
`org_unit_type` SYSTEM lookup category exists (6 values: department,
division, unit, section, administration, office) but has **zero consumers in
backend or frontend**, confirmed by grep. So `ward`, `faculty`, `school` and
`program` can be used freely; they simply will not match a lookup value.
Noted rather than worked around — see Pending Discussion #4.

### Tenant B — Al Manara University (`al-manara`)

Country: AE. 19 org units across 4 levels.

```
Al Manara University                              [MANARA]         root
├── Faculty of Engineering                        [ENG]            faculty
│   ├── School of Civil & Environmental Eng.      [ENG-CIV]        school
│   │   ├── BSc Civil Engineering                 [CIV-BSC]        program
│   │   └── MSc Environmental Engineering         [CIV-MSC]        program
│   └── School of Computing                       [ENG-CMP]        school
│       ├── BSc Computer Science                  [ENG-CMP-CS]     program
│       └── BSc Software Engineering              [ENG-CMP-SE]     program
├── Faculty of Health Sciences                    [HS]             faculty
│   ├── School of Nursing                         [HS-NUR]         school
│   │   └── BSc Nursing                           [HS-NUR-BSN]     program
│   └── School of Pharmacy                        [HS-PHA]         school
│       └── PharmD Program                        [HS-PHA-PD]      program
├── Faculty of Business                           [BUS]            faculty
│   └── School of Management                      [BUS-MGT]        school
│       └── BBA Program                           [MGT-BBA]        program
└── Deanship of Quality & Accreditation           [DQA]            deanship
    ├── Accreditation Office                      [DQA-ACC]        office
    └── Institutional Effectiveness Office        [DQA-IE]         office
```

Codes are unique per tenant, which is all the schema requires
(`@@unique([organizationId, code])`), so both tenants may reuse a prefix
without collision.

---

## 2. The people

`User.name` is a **single field** (there is no first/last split), and
uniqueness is `@@unique([organizationId, email])` — **names are not unique**,
which is what makes Edge Case 4 expressible.

### 2.1 A prerequisite: head-conferring positions

`DEFAULT_POSITIONS` seeds 10 deliberately industry-agnostic titles (Director
→ Staff). **Only `Director` has `isUnitHeadPosition: true`.** Since ACC-40
made positions org-wide, a unit's head is derived as *"an ACTIVE user whose
`primaryOrgUnitId` is this unit and whose position has
`isUnitHeadPosition: true`"* — so with the defaults alone, the head of a
Faculty, a School and a Program would all have to hold the single title
"Director".

That is unrealistic and makes the seed useless as a demo. **Proposal:** each
tenant additionally seeds its own head-conferring vocabulary, which is
possible because positions are per-tenant (`@@unique([organizationId,
nameEn])`):

| Tenant | Added positions (all `isUnitHeadPosition: true`, `isSingleAssignee: true`) | Grade |
|---|---|---|
| Hospital | Chief Executive Officer | 12 |
| Hospital | Chief Medical Officer | 11 |
| Hospital | Head of Ward | 8 |
| Hospital | Head of Section | 7 |
| Hospital | Unit Head | 6 |
| University | Rector | 12 |
| University | Dean | 11 |
| University | Head of School | 8 |
| University | Head of Office | 7 |
| University | Programme Director | 6 |

The schema enforces the `isUnitHeadPosition → isSingleAssignee` pairing, and
`seedDefaultPositions()` writes via direct `prisma.create()` bypassing
`createPosition()`, so **the fixture data must satisfy that invariant
itself** — the seeder's own comment says exactly this. Flagged as Pending
Discussion #2 because it adds positions the product does not ship by default.

### 2.2 Al Nakheel Specialist Hospital — 25 people

| # | Name | Position | Org unit | Reports to |
|---|---|---|---|---|
| 1 | Dr. Hessa Al-Dosari | Chief Executive Officer | NAKHEEL (root) | — |
| 2 | Dr. Faisal Al-Qahtani | Chief Medical Officer | MED | Hessa Al-Dosari |
| 3 | Dr. Layla Al-Harbi | Head of Ward | MED-IM | Faisal Al-Qahtani |
| 4 | Dr. Omar Siddiqui | Senior Specialist | MED-IM | Layla Al-Harbi |
| 5 | Dr. Nawaf Al-Shammari | Unit Head | MED-IM-CAR | Layla Al-Harbi |
| 6 | Mohammed Al-Otaibi | Specialist | MED-IM-CAR | Nawaf Al-Shammari |
| 7 | Dr. Reem Al-Zahrani | Unit Head | MED-IM-END | Layla Al-Harbi |
| 8 | Dr. Khalid Bin Saleh | Head of Ward | MED-CC | Faisal Al-Qahtani |
| 9 | Dr. Sara Al-Mutairi | Unit Head | MED-CC-AIC | Khalid Bin Saleh |
| 10 | Dr. Ziad Al-Fahad | Unit Head | MED-CC-NIC | Khalid Bin Saleh | **departs** |
| 11 | Fatima Al-Anazi | Senior Specialist | MED-CC-NIC | Khalid Bin Saleh |
| 11 | Dr. Tariq Al-Juhani | Head of Ward | MED-SU | Faisal Al-Qahtani |
| 12 | Dr. Maha Al-Subaie | Unit Head | MED-SU-OT | Tariq Al-Juhani |
| 13 | Noura Al-Ghamdi | Director | NUR | Hessa Al-Dosari |
| 14 | Aisha Al-Balawi | Head of Ward | NUR-IP | Noura Al-Ghamdi |
| 15 | Huda Al-Rashidi | Unit Head | NUR-IP-WN | Aisha Al-Balawi |
| 16 | Mariam Al-Suwaidi | Head of Ward | NUR-OP | Noura Al-Ghamdi |
| 17 | Dr. Yasser Al-Amri | Director | QPS | Hessa Al-Dosari |
| 18 | Haya Al-Marri | Head of Section | QPS-ACC | Yasser Al-Amri |
| 19 | Salem Al-Hajri | Head of Section | QPS-IC | Yasser Al-Amri |
| 20 | Nasser Al-Qassimi | Director | CSS | Hessa Al-Dosari |
| 21 | Amal Al-Ghamdi | Head of Section | CSS-PHR | Nasser Al-Qassimi |
| 22 | Yousef Bin Tariq | Senior Specialist | CSS-PHR | Amal Al-Ghamdi |
| 23 | Mohammed Al-Otaibi | Head of Section | CSS-LAB | Nasser Al-Qassimi |
| 24 | Ibrahim Al-Dakhil | Unit Head | CSS-MIC | Mohammed Al-Otaibi (CSS-LAB) |

**Revised during implementation (commit 2), for a reason worth recording.**
The first draft left several units without a head-position holder — Clinical
Support Services had no director, and its sections were led by *Section
Managers*, which is not a head-conferring position. That would have produced
**four** incidental vacancies alongside the one deliberate edge case, making
the seeded vacancy unfindable among accidents.

Every unit now has a head-position holder **except `MED-CC-NIC`**, so the
vacancy is the only one in the tenant. Concretely: `Head of Section` was added
to the position vocabulary (Section Managers cannot be heads, and the Pharmacy
handover requires its holder to actually *be* a head), and Nasser Al-Qassimi
was added to lead CSS. Verified by running the validator: exactly one unit
resolves to no head, and it is the declared one.

**The tenant admin is `Dr. Hessa Al-Dosari` (#1, the root unit's head), not
Yasser — and this is forced by the code, not a preference.**
`PlatformTenantService.createTenant()` invites the admin as `Director` in the
ROOT unit before this seed runs. `Director` is head-conferring, and
`hasAnyHeadConferringHolder()` counts **ACTIVE and INVITED**, so that invited
admin already blocks anyone else from becoming root's head. Any other
`adminKey` makes the seed unrunnable.

This turns out to be better for the purpose anyway: Yasser stays a **non-admin**
Quality Director, which is exactly what structural sequence item 5 needs. A
Tenant Admin holds every permission and so proves nothing about
permission-gating — CLAUDE.md's own criticism of every test to date.

### 2.3 Al Manara University — 22 people

| # | Name | Position | Org unit | Reports to |
|---|---|---|---|---|
| 1 | Prof. Adel Al-Mansoori | Rector | MANARA (root) | — |
| 2 | Prof. Huda Al-Blooshi | Dean | ENG | Adel Al-Mansoori |
| 3 | Dr. Rashid Al-Nuaimi | Head of School | ENG-CIV | Huda Al-Blooshi |
| 4 | Dr. Latifa Al-Kaabi | Programme Director | CIV-BSC | Rashid Al-Nuaimi |
| 5 | Dr. Saeed Al-Hammadi | Programme Director | CIV-MSC | Rashid Al-Nuaimi |
| 6 | Dr. Mariam Al-Shamsi | Head of School | ENG-CMP | Huda Al-Blooshi |
| 7 | Dr. Hamad Al-Zaabi | Programme Director | ENG-CMP-CS | Mariam Al-Shamsi |
| 8 | Aliya Al-Suwaidi | Senior Specialist | ENG-CMP-CS | Hamad Al-Zaabi |
| 9 | Dr. Noor Abdullah | Programme Director | ENG-CMP-SE | Mariam Al-Shamsi |
| 10 | Prof. Salma Al-Falasi | Dean | HS | Adel Al-Mansoori |
| 11 | Dr. Khalifa Al-Muhairi | Head of School | HS-NUR | Salma Al-Falasi |
| 12 | Dr. Amna Al-Qubaisi | Programme Director | HS-NUR-BSN | Khalifa Al-Muhairi |
| 13 | Dr. Jassim Al-Ali | Head of School | HS-PHA | Salma Al-Falasi |
| 14 | Dr. Noor Abdullah | Programme Director | HS-PHA-PD | Jassim Al-Ali |
| 15 | Prof. Badr Al-Marzooqi | Dean | BUS | Adel Al-Mansoori |
| 16 | Dr. Shaikha Al-Rumaithi | Head of School | BUS-MGT | Badr Al-Marzooqi |
| 17 | Dr. Omar Al-Hosani | Programme Director | MGT-BBA | Shaikha Al-Rumaithi |
| 18 | Dr. Hind Al-Dhaheri | Director | DQA | Adel Al-Mansoori |
| 19 | Maitha Al-Ameri | Head of Office | DQA-ACC | Hind Al-Dhaheri |
| 20 | Dr. Rana Al-Zaabi | Head of Office | DQA-IE | Hind Al-Dhaheri | **departs** |
| 21 | Dr. Fahad Al-Shehhi | Senior Specialist | BUS-MGT | Shaikha Al-Rumaithi | **handover successor** |
| 22 | Sultan Al-Junaibi | Senior Specialist | DQA-IE | Hind Al-Dhaheri |

Same head-coverage rule as the hospital: every unit has a head-position
holder **except `DQA-IE`**, so the seeded vacancy is the only one in the
tenant. `Head of Office` was added for the same reason the hospital needed
`Head of Section` — the Deanship's offices are real units needing real heads,
and `Director` (grade 10) is far too senior for an office reporting into a
deanship.

The tenant admin is `Prof. Adel Al-Mansoori` (#1, the root unit's head), for
the same forced reason as the hospital's. `Dr. Hind Al-Dhaheri` stays a
non-admin Quality Director — the university's equivalent persona.

**All four edge cases are seeded in BOTH tenants, not split between them.**
This plan originally placed out-of-office and handover only in the hospital.
Doing both in the university as well proves the mechanisms are not
hospital-specific — the same reasoning that already justified a second
duplicate-name pair — and costs nothing, since these are ordinary data states.
The university's own instances are listed in Section 3.

## 3. The four edge cases

Each is a deliberate choice with a stated reason and a stated observable
effect. All four are invisible in the current database.

### Edge Case 1 — Vacant head: `MED-CC-NIC` (Neonatal ICU)

Fatima Al-Anazi works there as a **Senior Specialist** — a real occupant,
but not a head-conferring position. So the unit has staff and no head.

**Why this unit:** its parent `MED-CC` (Critical Care Ward) *does* have a
head (Dr. Khalid Bin Saleh), so `resolveActingHeadForOrgUnit()` walks up one
level and resolves successfully. That produces a **partial** vacancy:
`isHeadVacant = true`, `isHeadFullyUnresolved = false`, **no notification** —
"partial vacancy never blocks or notifies." A unit that is simply empty would
not exercise the walk-up at all.

**Deliberately NOT seeded: the fully-unresolved case.** Reaching
`isHeadFullyUnresolved = true` requires *every* ancestor up to the root to
lack an ACTIVE head-holder, which for these trees means a headless
organisation — unrealistic as demo data, and it would fire tenant-admin
notifications on every sweep. That branch is better covered by a test than by
fixture data. Raising it rather than leaving the gap unexplained.

> **REFRAMED during implementation (commit 5) — the original design was not
> buildable.** `invite()` carries an ACC-46 hard block: *"cannot invite anyone
> into a unit with no direct Head and no Acting Head"*, and
> `hasDirectOrActingHead()` looks only at the target unit — escalation coverage
> from a parent explicitly does not count. A unit therefore cannot be **born**
> headless with staff in it; the product forbids exactly that as a starting
> state. Fatima and Sultan could not have been created.
>
> The vacancy is now produced the way it happens in reality: **a head departs.**
> Dr. Ziad Al-Fahad heads the Neonatal ICU (and Dr. Rana Al-Zaabi the
> Institutional Effectiveness Office); each is invited, activated, has their
> staffer placed beneath them, and is then deactivated in commit 6.
>
> This is better than the original, not merely a workaround:
> - Units do not become vacant spontaneously — someone leaves. The seed now
>   tells that story.
> - `deactivate()` calls `refreshOrgUnitHeadVacancy()` **itself**, so
>   `isHeadVacant`/`headVacantSince` are set by the real mechanism rather than
>   written directly by the seed.
> - It gives real data to CLAUDE.md's existing note that vacancy detection is
>   ACTIVE-only.
>
> **Confirmed before relying on it** (rather than discovered at run time):
> `deactivate()` never touches its reports' `managerId` —
> `reassignAllForUser()` moves `TaskAssignee` rows, not people — and its only
> throw is last-admin lockout. The staffer is left exactly in place. Both
> staffers deliberately report to the **parent** unit's head, not to the
> departing head, so nothing dangles at an INACTIVE user.

### Edge Case 2 — Out of office: Dr. Layla Al-Harbi, covered by Dr. Omar Siddiqui

Layla (#3, Head of Ward, `MED-IM`) has `outOfOfficeFrom` / `outOfOfficeTo`
spanning today, with `actingUserId` → Omar Siddiqui (#4, Senior Specialist in
the same ward).

**Why this pair:** Layla is a head-position holder with a real subtree
beneath her, so her absence is consequential — `applyOutOfOfficeRouting()`
substitutes Omar wherever she would have been assigned or gated. Omar sits in
the same unit, which is what a real coverage arrangement looks like.

**Dates must be computed relative to seed time** (e.g. `now - 3 days` →
`now + 11 days`), never hardcoded, or the case silently expires and the seed
stops demonstrating anything. This is a re-runnability requirement, not a
detail.

### Edge Case 3 — Mid-handover: `CSS-PHR` (Pharmacy Section)

`OrgUnit.pendingHeadUserId` → Yousef Bin Tariq (#21), with
`headHandoverEffectiveDate` = **`now + 14 days`**, while Amal Al-Ghamdi (#20)
remains the current holder.

**Why future-dated, and this matters:** `SlaMonitorProcessor.sweepDueHandovers()`
selects units where `headHandoverEffectiveDate <= now` and completes them. A
past or present date would be swept within 15 minutes and the edge case would
evaporate — the seed would look correct on creation and be gone by the time
anyone looked. The schema comment is explicit that these two fields are a
*cache* and not the source of truth (the real state is two `User.positionId`
assignments), so the fixture must set both sides coherently.

### Edge Case 4 — Duplicate name: two people called **Mohammed Al-Otaibi**

- #6 — Specialist, `MED-IM-CAR` (Cardiology Unit)
- #22 — Section Manager, `CSS-LAB` (Laboratory Section)

Different emails (required — `@@unique([organizationId, email])`); identical
`name` (permitted — no uniqueness on name).

**Why this matters and why these two:** ACC-37 added org-unit display to every
user picker specifically so people can be told apart, and that fix has never
had data that actually exercises it. They are in different departments and
hold different positions, so a picker showing only a name is genuinely
ambiguous, while one showing name + unit is not. A third instance is proposed
in the university tenant — **Dr. Noor Abdullah** (#8 in `ENG-CMP-SE`, #14 in
`HS-PHA-PD`) — to prove the case is not an artefact of one tenant's data.

---

### The university's own instances of all four

Added during implementation (commit 3): the plan first placed cases 2 and 3
only in the hospital. Seeding all four in both tenants proves none of the
machinery is industry-specific, and costs nothing.

| Case | Al Manara University |
|---|---|
| 1 — Vacant head | `DQA-IE` (Institutional Effectiveness Office). Sultan Al-Junaibi works there as a Senior Specialist; parent `DQA` has Dr. Hind Al-Dhaheri, so the walk-up resolves — partial vacancy, silent. |
| 2 — Out of office | Prof. Salma Al-Falasi (Dean, Health Sciences), covered by Dr. Khalifa Al-Muhairi (Head of School, Nursing). A dean with two schools and their programmes beneath her, so the absence has real reach. |
| 3 — Mid-handover | `BUS-MGT` (School of Management), Dr. Shaikha Al-Rumaithi → **Dr. Fahad Al-Shehhi**, effective in **21 days**. A Senior Specialist in her own school promoted to head it. 21 rather than the hospital's 14 so the two tenants do not expire on the same day. **Corrected in commit 6:** the successor was originally Dr. Omar Al-Hosani, but `declareHandover()` rejects a successor who already holds a head-conferring position anywhere — silently reassigning them would orphan the unit they currently head with no VACATED event. Omar directs the BBA programme, so he was rejected; Fahad was added as a non-head successor. |
| 4 — Duplicate name | **Dr. Noor Abdullah** — Programme Director in `ENG-CMP-SE` (Software Engineering) and in `HS-PHA-PD` (PharmD). Different faculties entirely. |

---

## 4. Committees

`committee_type` and `committee_member_role` are SYSTEM lookups with real
seeded values (5 and 6 respectively), so fixtures reference existing keys
rather than inventing any.

### Hospital — 3 committees

| Committee | Type | Members (role) |
|---|---|---|
| Quality & Patient Safety Committee | `quality_committee` | Yasser Al-Amri (chairman), Haya Al-Marri (secretary), Layla Al-Harbi (member), Noura Al-Ghamdi (member), Khalid Bin Saleh (member) |
| Infection Control Committee | `safety_committee` | Salem Al-Hajri (chairman), Huda Al-Rashidi (secretary), Sara Al-Mutairi (member), Mohammed Al-Otaibi/CSS-LAB (member) |
| Pharmacy & Therapeutics Committee | `clinical_committee` | Amal Al-Ghamdi (chairman), Yousef Bin Tariq (secretary), Faisal Al-Qahtani (member), Reem Al-Zahrani (advisor) |

Infection Control **reports to** Quality & Patient Safety via
`reportingToCommitteeId`, giving one real committee hierarchy.

### University — 3 committees

| Committee | Type | Members (role) |
|---|---|---|
| Quality Assurance Committee | `quality_committee` | Hind Al-Dhaheri (chairman), Maitha Al-Ameri (secretary), Huda Al-Blooshi (member), Salma Al-Falasi (member), Badr Al-Marzooqi (member) |
| Academic Standards Committee | `advisory_committee` | Salma Al-Falasi (chairman), Sultan Al-Junaibi (secretary), Rashid Al-Nuaimi (member), Mariam Al-Shamsi (member) |
| Campus Health & Safety Committee | `safety_committee` | Khalifa Al-Muhairi (chairman), Amna Al-Qubaisi (secretary), Omar Al-Hosani (member), Aliya Al-Suwaidi (observer) |

Academic Standards **reports to** Quality Assurance.

### The brief's "attached to a specific org unit" cannot be satisfied

**`Committee` has no `orgUnitId` field.** Confirmed against the schema: its
relations are `parentCommitteeId`, `reportingToCommitteeId`,
`reportingToRoleId`, members, membership events and meetings — nothing links
a committee to an org unit. This is the *same* missing field that blocks
`ORG_UNIT_HEAD` from being reachable and that keeps RELATIVE assignee mode
out of scope (CLAUDE.md structural item 3, ACC-56).

I will not fake it by encoding a unit name into the committee's title. See
Pending Discussion #3.

---

## 5. Re-runnability

**Recommendation: reset-then-seed, not idempotent upserts.**

The reason is structural, not stylistic. Of the 85 foreign keys in this
schema, **56 are `ON DELETE RESTRICT`** — an idempotent seed would have to
delete prior data in exact leaf-first order across 44 models before
re-creating it, and two specific constraints make that actively dangerous:

- **`AuditLog.organizationId` is `RESTRICT`.** An Organization cannot be
  deleted while any audit row references it. "Keep the audit history and
  delete the tenant" is not an available option — the database refuses.
  (`AuditLog.actorId` is `SET NULL`, so deleting *users* is already safe;
  users were never the blocker.)
- **`LookupCategory.organizationId` and `LookupValue.organizationId` are
  `SET NULL`.** In this schema `organizationId: null` *means* "SYSTEM row,
  shared by every tenant". So deleting a tenant Organization would silently
  **promote that tenant's private lookup values into global rows visible to
  all tenants** — no error, no warning. A hand-rolled cleanup would do this
  quietly.

`prisma migrate reset` drops and recreates the schema, replaying all 34
migrations. It sidesteps the ordering problem and the promotion hazard
entirely, and produces a byte-identical starting point every time — which is
what "identical state on re-run" actually requires.

**On the append-only rule:** CLAUDE.md forbids UPDATE/DELETE *operations* on
`AuditLog` — it governs application behaviour and production retention. It
was never intended to make a development database un-rebuildable. Rebuilding
a dev schema is categorically different from shipping code that deletes audit
history; the alternative (an `auditLog.deleteMany()` in a committed script)
would violate the rule explicitly and leave that precedent in the repo.

**If someone runs it against a database that already has data:** `prisma
migrate reset` **destroys everything** — all tenants, all users, all audit
history. It prompts for confirmation unless `--force` is passed. The seed
script must therefore refuse to run when it detects a non-development
environment, and must never be wired into a deploy step. Concrete guard
proposed: abort unless `NODE_ENV !== 'production'` **and** the database host
matches an explicit allowlist, so that pointing `DATABASE_URL` at anything
unexpected fails closed rather than wiping it.

---

## 6. Structure

### 6.1 Layering on the real flow, per ACC-23

ACC-23 deliberately reduced `demo-seed.ts` to genesis-only (platform org +
`PLATFORM_ADMIN`) precisely so tenants would be provisioned through the real
Super Admin flow rather than a hand-rolled script that silently drifts from
`TenantService.bootstrap()`. **A rich seed script is exactly the drift risk
that ticket removed**, so this must not reimplement provisioning.

The canonical entry point is `PlatformTenantService.createTenant()`, whose own
comment records that `bootstrap()` alone cannot create a tenant (it needs the
Organization row to exist). It does: create Organization → `bootstrap()` →
`invite()` the admin → assign `TENANT_ADMIN`. Proposed order per tenant:

```
1. PlatformTenantService.createTenant()   ← real flow; gives org, root unit,
                                            10 positions, 12 lookup categories,
                                            7 roles, 8 workflow templates,
                                            an invited TENANT_ADMIN
2. Seed tenant-specific head positions     ← Section 2.1 (fixture data)
3. Create the org-unit tree                ← via OrganizationService
4. Create + activate users                 ← see 6.2
5. Apply the four edge cases               ← Section 3
6. Create committees and members           ← via CommitteesService
```

Steps 3–6 add data through existing services wherever a service method
exists, so audit logging, validation and the head-derivation caches all fire
the way they would for a real user. Direct Prisma writes are reserved for the
edge-case cache fields that have no service-level setter.

### 6.2 The activation problem

`UserService.invite()` creates users with `status: INVITED`. **Head derivation
filters on `status: 'ACTIVE'`** (`resolveActingHeadForOrgUnit()`), so invited
users confer no head and every unit would read as vacant — all four edge
cases would collapse.

`demo-seed.ts` already solves this for the platform admin: it builds a local
Better Auth instance and signs the user up, producing a real, loginable
account. The same pattern extends here, giving ~43 users who can actually log
in — which is what makes persona testing possible. Two known costs: argon2
hashing is deliberately expensive (~43 hashes, seconds not minutes), and the
haveIBeenPwned plugin must stay disabled in the seed's own auth instance, as
`demo-seed.ts` documents for exactly this reason.

**Activation must be interleaved, not batched — a second finding from the
code.** Two guards filter on different statuses, and they pull in opposite
directions:

| Guard | Counts | Effect |
|---|---|---|
| `hasAnyHeadConferringHolder()` (head uniqueness) | ACTIVE **and** INVITED | merely *inviting* a second head into a unit is already a conflict |
| `hasDirectOrActingHead()` (ACC-46 staffing block) | **ACTIVE only** | a still-INVITED head does not unlock their unit for staff |

So invite-everyone-then-activate-everyone **fails on the second person into any
unit**. `applyPeople()` therefore invites and activates one person at a time,
in an order computed up front by `orderPeopleForInvite()`: each unit's head
before anyone else in that unit, and every manager before their reports.
Verified by simulating all three `invite()` guards against the computed order
for both fixtures, rather than discovering a `ConflictException` thirty users
into a run.

### 6.3 File layout — keeping it maintainable

The brief's concern is a wall of inline objects. Proposed split:

```
backend/prisma/seed/
├── seed-realistic.ts            orchestrator; no fixture data
├── fixtures/
│   ├── hospital.fixture.ts      tree + people + committees for Tenant A
│   ├── university.fixture.ts    tree + people + committees for Tenant B
│   └── fixture.types.ts         shared shapes (see below)
└── apply/
    ├── apply-org-tree.ts        walks a UnitFixture tree, creates units
    ├── apply-people.ts          creates + activates users, wires managerId
    ├── apply-edge-cases.ts      the four cases, each with its own comment
    └── apply-committees.ts      committees + members
```

Fixtures are **declarative data** referencing units and people by stable
string keys (`'MED-IM'`, `'layla'`), never by database id — the `apply/`
functions resolve keys to ids. That keeps a fixture readable as an org chart
and makes the manager tree checkable by eye. It also lets a single validation
pass assert, before any write, that every referenced key exists, that the
manager graph is acyclic, and that each manager sits in the same unit or an
ancestor — turning a whole class of fixture typo into an immediate error
rather than a confusing runtime state.

Adding a third tenant later is then one fixture file, no orchestrator change.

---

## 7. Pending Discussions — ALL RESOLVED 2026-09-07

Each decision is recorded inline below, under the question that prompted it.
The original reasoning is kept rather than deleted, so a later reader can see
what was weighed and not just what was chosen.

### #1 — The shared database is a hard blocker (needs your decision)

> **RESOLVED — proceed.** Ahmad confirmed the dev environment is disposable:
> full data loss is acceptable, explicitly including audit history and
> tenant-custom lookup values. The two hazards below are therefore accepted
> consequences, not problems to design around.
>
> Two things this does **not** change. The environment guard in Section 5
> still ships — the decision is that *this* database is disposable, not that
> the seed may run anywhere it happens to be pointed. And CLAUDE.md's
> underlying shared-infrastructure question stays open; this ticket consumes
> the answer for one run, it does not settle the standing policy.

`DATABASE_URL` points at `aws-1-eu-central-1.pooler.supabase.com` — **the
same instance the Railway deployment reads.** There is no separate test or
staging database; only one `DATABASE_URL` exists in the environment.

So running this seed destroys the deployed environment's data, including the
real `Demo Organization`. That is worse than ACC-48, where the data survived
and only the code was mismatched.

This is the decision CLAUDE.md already records as undecided, and a full wipe
forces it. Options: provision a separate dev database and repoint local
development first (recommended), or accept and schedule the deployment's data
loss deliberately. **No code should be written for ACC-62 until this is
settled**, because the answer may change where the seed is allowed to point.

### #2 — Tenant-specific head positions (Section 2.1)

> **RESOLVED — yes, seed them as proposed.** The 8 positions in Section
> 2.1's table are part of the fixture data. Each must satisfy the
> `isUnitHeadPosition → isSingleAssignee` pairing itself, since
> `seedDefaultPositions()`-style direct writes bypass
> `validateHeadFlagPairing()`.

Adding CEO/CMO/Head of Ward/Unit Head and Rector/Dean/Head of School/
Programme Director means the seed ships positions the product does not
include by default. It is necessary for a believable 4-level hierarchy, since
only `Director` confers headship out of the box. Confirm you want the seed to
add them, or say the seed should use only the 10 shipped positions and accept
that most units inherit their head from an ancestor.

### #3 — "At least one committee attached to a specific org unit" is not
buildable

> **RESOLVED — option (a).** Committee-to-committee reporting now, as
> drafted in Section 4. `Committee.orgUnitId` is raised as **ACC-63**
> (Backlog) rather than being folded into ACC-62, noting that it would also
> unblock RELATIVE assignee mode and `ORG_UNIT_HEAD` reachability, and is
> a dependency of part of ACC-56. The brief's original
> "attached to an org unit" requirement is therefore **not met by this
> ticket**, deliberately — recorded here so it is not later read as an
> oversight.

`Committee` has no `orgUnitId`. I can (a) drop that requirement and use
committee-to-committee reporting instead, as drafted; (b) use
`reportingToRoleId` to point a committee at a Role, which is a different
concept and would misrepresent it; or (c) treat adding `Committee.orgUnitId`
as its own ticket — which would also unblock RELATIVE assignee mode and part
of ACC-56, and is arguably overdue. **Recommendation: (a) now, and raise (c)
separately** rather than growing ACC-62 into a schema change.

### #4 — Should the seed add `org_unit_type` lookup values?

> **RESOLVED — yes, add them.** `ward`, `faculty`, `school`, `program` and
> `deanship` become tenant-scoped `LookupValue` rows under the existing
> SYSTEM `org_unit_type` category, so `OrgUnit.type` is internally
> consistent for whenever that lookup is finally wired up. Note these are
> exactly the rows that would be silently promoted to SYSTEM by a
> tenant-delete (Section 5) — irrelevant under reset-then-seed, but the
> reason the hazard is worth remembering.

`ward`, `faculty`, `school`, `program` and `deanship` are not among the 6
seeded values. Nothing validates `OrgUnit.type`, and the `org_unit_type`
category has zero consumers, so the seed works either way. Adding tenant-level
values would make the data internally consistent for whenever that lookup
does get wired up; not adding them keeps the seed smaller. Low stakes — I
lean toward adding them.

### #5 — What happens to the two leftover test tenants?

> **RESOLVED — confirmed, their removal is intended.** `ACC45 Verify Temp`
> and `ACC46 P2 Verify` disappear with the reset, along with the existing
> `Demo Organization`.

`ACC45 Verify Temp` and `ACC46 P2 Verify` are verification leftovers holding
22 users and 1,118 audit rows between them. Under a full reset they simply
disappear, which is the desired outcome. Raising it only so their removal is
an intended result rather than a surprise.

---

## 7b. A partial `al-nakheel` tenant exists in the dev database — deliberately left

**If you find a half-populated `al-nakheel` tenant, it is not a failed run to
diagnose.** During ACC-62's own guard-branch testing, one test used the real
(correctly allowlisted) `DATABASE_URL`. The environment guard passed — as
designed — and the seed genuinely ran before it was stopped. A first attempt
to stop it killed only the shell wrapper, not the `node` process `npm run` had
spawned, so it kept seeding for a while after it appeared to have halted.

Final state: 21 org units, 15 positions, 25 activated users, 1 committee, plus
audit rows and notifications. `al-manara` was never created.

**Left in place on purpose.** Removing it means deleting its `AuditLog` rows —
`AuditLog.organizationId` is `ON DELETE RESTRICT` — which is exactly the
rule-violating path Section 5 argues against. The `prisma migrate reset` that
must precede any real seed run destroys it anyway, so cleaning it by hand would
cost an audit-deleting script for something a required step already removes.

Two things came out of it worth keeping:

- **It proved the pipeline works.** All 25 hospital users were created *and*
  activated through Better Auth in the computed order, with no failures — the
  argon2 volume was fine and the interleaved head-before-staff ordering held
  against the real `invite()` guards, not just the simulation of them.
- **It exposed a real gap in the guard**, now closed. `assertSafeEnvironment()`
  answers *"is this the wrong database?"*. It cannot answer *"did you mean to
  run this at all?"* — and in this incident every check passed correctly while
  the run was still unintended. The seed now also requires explicit intent
  (`--confirm`, or typing the database host at an interactive prompt) and
  refuses outright if any target slug already exists.

---

## 8. Verification plan (once implemented)

- Re-run the seed twice; assert identical row counts and identical logical
  state, proving re-runnability rather than assuming it.
- Assert `MED-CC-NIC` reports `isHeadVacant = true`,
  `isHeadFullyUnresolved = false`, and that
  `resolveActingHeadForOrgUnit()` returns Khalid Bin Saleh via the walk-up.
- Assert `resolveAssignee()` substitutes Omar Siddiqui for Layla Al-Harbi
  while the out-of-office window is open.
- Assert `CSS-PHR.headHandoverEffectiveDate` is in the future and that a
  `SlaMonitorProcessor` run does **not** complete it.
- Assert both `Mohammed Al-Otaibi` records exist with distinct emails and
  distinct `primaryOrgUnitId`, and that a user picker renders them
  distinguishably.
- Log in as a non-admin persona (e.g. Yasser Al-Amri, Quality Director) and
  confirm permission-gating behaves — the live Quality Manager persona test
  that structural sequence item 5 has been waiting for.
