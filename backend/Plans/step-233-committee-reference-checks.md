# Step 233 — Committee parent, reports-to and owning unit checks (ACC-233)

Lane B, Bug, High. Branch `fix/ACC-233-committee-reference-checks` from `dev`
at `4638b5f`.

**Status: two scope findings, waiting for Ahmad's decision before building
(§2).** Everything else below is ready to build as written.

## 1. What exists today (read on `4638b5f`)

`createCommittee` and `updateCommittee` (`committees.service.ts`) check only
that a parent, reports-to or owning unit exists in the caller's organisation:

- `validateCommitteeReference()` and `validateOrgUnitReference()` run
  `findFirst({ id, organizationId })`. A miss is a **404** with an English
  sentence ("Parent committee not found in this tenant").
- **Nothing refuses a committee as its own parent or reports-to, a loop, or a
  dissolving or dissolved target.**
- **Owning unit, create:** omitted or `''` falls back to the organisation's
  root unit (ACC-135, deliberate). An inactive unit is accepted.
- **Owning unit, update:** `if (dto.orgUnitId)` skips the check for `''`, which
  is then written to a required foreign key: a **500**. `null` passes
  `@IsOptional()` and is written to a required column: also a **500**.
- The check and the write are separate statements with no transaction.

## 2. Scope findings — need a decision

### 2.1 Rule 3: no status marks "Dissolution Pending" or "Dissolved"

The ticket says to use "the statuses the code already uses". There are none:

- **`WorkflowStage` stores no key.** The seed's `key: 'dissolution_pending'` /
  `'dissolved'` only wires transitions at seed time; it is not a column
  (ACC-22 recorded this: stages have no stable key, so no screen treats a
  stage semantically).
- **`Committee.dissolvedAt` and `Committee.isActive` are never written** by
  anything in `backend/src`.
- **The dissolution transitions are ordinary ADVANCE moves**, with no marker.
- **Only "Dissolved" has a structural marker:** it is the template's one final
  stage (`isFinal: true`). "Dissolution Pending" is an ordinary stage
  (order 50) that a tenant may rename.

Measured on the shared dev database (read only): both organisations' COMMITTEE
templates still carry the seeded names, and only Dissolved is final.

**Options:**

| | What | Cost |
|---|---|---|
| **A (recommended)** | **Add a stable stage key**: a nullable `WorkflowStage.key`, backfilled from the seed's keys, read as `dissolution_pending` / `dissolved`. | An additive migration and a backfill, which the ticket rules out. It is also the ACC-22 "revisit" decision. |
| B | **Dissolved by structure, Dissolution Pending deferred**: refuse a target whose current stage is final. | No migration. Half of rule 3. |
| C | **By name**: match "Dissolution Pending" / "Dissolved". | No migration, but breaks the day a tenant renames a stage. That is exactly what ACC-22 refused. **Not recommended.** |

### 2.2 Rule 4: "an empty or missing owning unit returns a 400"

On **create**, a missing owning unit is not an error today. It means "the whole
organisation" and resolves to the root unit, which was ACC-135's decision.
Taken literally, rule 4 reverses that.

**Recommended reading:**
- **Omitted on create:** the root, as ACC-135 decided.
- **Omitted on update:** unchanged.
- **`''` on either, or `null` on update:** 400, "Choose the unit that owns this
  committee."
- **Inactive, or not in this organisation:** 400, the same refusal as one that
  does not exist.

If rule 4 means create must REQUIRE the unit, that is a reversal of ACC-135 and
a frontend change too.

## 3. Rules as they will be built (once §2 is decided)

Every refusal is a **400** with a `code`, and its sentence lives in `en.json`
and `ar.json` under `committee.refusal.*`. The dialog translates from the code
and never shows the server's English message. No refusal names or counts
anything in another organisation.

| # | Refusal | Code |
|---|---|---|
| 1 | A committee can't be its own parent. | `COMMITTEE_OWN_PARENT` |
| 1 | A committee can't report to itself. | `COMMITTEE_REPORTS_TO_ITSELF` |
| 2 | A committee can't sit under one of its own sub-committees. | `COMMITTEE_PARENT_LOOP` |
| 2 | A committee can't report to a committee that reports to it. | `COMMITTEE_REPORTS_TO_LOOP` |
| 3 | A committee that is being dissolved, or has been, can't be a parent / be reported to. | `COMMITTEE_PARENT_DISSOLVING`, `COMMITTEE_REPORTS_TO_DISSOLVING` |
| 4 | Choose the unit that owns this committee. | `COMMITTEE_UNIT_REQUIRED` |
| 4, 5 | That unit doesn't exist or is no longer active. | `COMMITTEE_UNIT_NOT_FOUND` |
| 5 | That parent committee / reports-to committee doesn't exist. | `COMMITTEE_PARENT_NOT_FOUND`, `COMMITTEE_REPORTS_TO_NOT_FOUND` |

**How the checks work:**
- **Loops (rule 2):** walk UP from the proposed target, along `parentCommitteeId`
  (or `reportingToCommitteeId`), scoped by organisation. The move is a loop if
  the walk reaches the committee being edited. A walk that revisits a committee
  stops: existing bad data must not hang the request. There is a depth cap of
  500, and hitting it is refused rather than allowed.
- **On create,** a new committee has no descendants, so only rules 3–5 apply to
  its parent and reports-to.
- **Clearing** a parent or reports-to (`null`) is always allowed.
- **Rule 5:** a reference from another organisation is read with
  `{ id, organizationId }`, so it misses exactly as a missing id does. The
  refusal is the same code, the same sentence and the same status.

## 4. The transaction — a per-organisation advisory lock

**Chosen: one interactive transaction that first takes
`pg_advisory_xact_lock(hashtext('committee-hierarchy:' || organizationId))`,
then runs every check, then writes.** Two edits in the same organisation
queue; the second one's walk sees the first one's committed parent. The same
shape is ACC-177's per-organisation lock for the storage quota.

**Why not the alternatives:**
- **Locking only the edited row** (`FOR UPDATE`) does not stop a loop. A ← B
  and B ← A lock different rows.
- **SERIALIZABLE** needs a retry loop around every save.

**Scope of the lock:**
- **It is taken on every create, and on every update that sets a parent or
  reports-to.** An update that changes only names does not wait.
- **The dissolving check reads the target's current workflow instance
  `FOR SHARE`.** A transition on that committee (which takes the instance's row
  lock, ACC-190) waits for this save, and this save waits for a transition
  already in flight.
- **The workflow instance for a new committee is started after the
  transaction**, as today.

## 5. Frontend (the existing committee dialog only)

- **The parent and reports-to pickers leave out** the committee itself and any
  committee in a dissolving or dissolved stage (the §2.1 definition, read from
  the list's current stage). They also leave out the committee's own
  descendants, so the loop refusal is rarely met.
- **A refusal is shown under its field,** from its code, in the user's
  language. The dialog stays open and keeps what was typed.

## 6. Existing data (shared dev database, read only, 15 Oct)

**8 committees:**

| Organisation | Committees | With a parent | With a reports-to |
|---|---|---|---|
| al-manara | 3 | 0 | 1 |
| al-nakheel | 5 | 0 | 1 |

Current stages: Formation 6, Active 2.

**Committees breaking rules 1–5: none.** Measured per rule: own parent 0,
reports to itself 0, parent loop 0, reports-to loop 0, dissolving or dissolved
target 0 (by name and by final stage), owning unit missing 0, in another
organisation 0, inactive 0, cross-organisation or missing parent / reports-to 0.

## 7. Tests

- **Unit:** each rule's refusal and code, clearing allowed, and the walk
  stopping on bad data.
- **Tenant isolation:** rule 5, with the gate's name.
- **`test:db`:**
  - the loop walk on real rows (a chain of three, the edit that would close it);
  - two concurrent saves that would close a loop: exactly one succeeds;
  - a dissolving target.
- **Frontend:** the pickers' exclusions and the refusal shown in the open
  dialog.
- **Mutation checks:** the loop rule and rule 5.

**No migration** (unless §2.1 option A is chosen).

## 8. Progress

- [x] Ticket ACC-233, branch, this plan, existing data checked (§6)
- [ ] Ahmad decides §2.1 and §2.2
- [ ] Backend rules, codes and the locked transaction
- [ ] Translations
- [ ] The committee dialog
- [ ] Tests, `test:db`, mutation checks
- [ ] SYSTEM-REFERENCE and CLAUDE.md
