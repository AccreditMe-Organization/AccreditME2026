# Step 233 — Committee parent, reports-to and owning unit checks (ACC-233)

Lane B, Bug, High. Branch `fix/ACC-233-committee-reference-checks` from `dev`
at `4638b5f`.

**Status:** BUILT — merged as #183 (23a5649), 16 Oct.

When written: **built (16 Oct), waiting for `/ready-to-pr`.** Ahmad decided both
scope findings on 15 Oct (§2), **including approving the migration** (§2.1
option A). §9 records where the build differs from this plan.

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

## 2. Scope findings — decided (Ahmad, 15 Oct)

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

**DECIDED: A, and the migration is approved (Ahmad, 15 Oct)**, with these
additions:
- **Key every stage of the committee lifecycle,** not only the two dissolution
  stages: `formation`, `terms_review`, `active`, `suspended`,
  `dissolution_pending`, `dissolved` (the seed's own keys). The committee
  changes feature reads them next.
- **The column is additive and nullable,** with no change to any existing
  column. The key is unique within its workflow, never shown or editable in the
  UI, and a tenant renaming a stage leaves it unchanged.
- **New organisations get the keys from the seed.**
- **Existing organisations are backfilled** by matching each stage to the seed
  (§4b says how), reporting per organisation how many stages got a key and any
  that could not be matched (left null). Dry run first, then for real.
- **A committee whose stage has no key is treated as not dissolving,** and a
  warning is logged with no personal data.

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

**DECIDED: the recommended reading, exactly as written above (Ahmad, 15 Oct).**

## 3. The rules

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
  the walk reaches the committee being edited. The walk is ONE recursive query
  whose `UNION` drops a committee already seen, so a loop already in the data
  ends the walk instead of hanging the request; no depth cap is needed.
- **Dissolving (rule 3):** the target's CURRENT stage (its newest COMMITTEE
  workflow instance) has the key `dissolution_pending` or `dissolved`. Never
  the name or the order.
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
- **It is taken on every update that sets a parent or reports-to.** An update
  that changes only names does not wait. **A create takes none:** the new
  committee has no sub-committees and nothing reports to it, so no loop can pass
  through it.
- **The dissolving check reads the target's current workflow instance
  `FOR SHARE`.** A transition on that committee (which takes the instance's row
  lock, ACC-190) waits for this save, and this save waits for a transition
  already in flight.
- **The workflow instance for a new committee is started after the
  transaction**, as today.

## 4b. The stage key — migration and backfill (approved, 15 Oct)

**Migration `20261016074848_acc233_workflow_stage_key`**, generated by Prisma
(`migrate diff` against a fully migrated local database; `migrate dev` refuses
to run non-interactively):

```sql
ALTER TABLE "WorkflowStage" ADD COLUMN "key" TEXT;
CREATE UNIQUE INDEX "WorkflowStage_workflowTemplateId_key_key"
  ON "WorkflowStage"("workflowTemplateId", "key");
```

- **Expand only:** a nullable column and an index over values that are all
  null, so it is safe against the deployed code, which never selects it.
- **It runs on merge** (the pre-deploy step), not before. It was applied only to
  the throwaway local database while building.

**The seed** (`seedDefaultWorkflows()`) writes the key on each COMMITTEE stage
(`KEYED_SEED_TEMPLATES`, `workflow-stage-keys.ts`) and looks a keyed stage up by
key before name, so a renamed stage is found rather than created twice.

**The backfill** (`npm run backfill:acc233-committee-stage-keys`, dry run by
default, `--execute` to apply) keys each organisation's default COMMITTEE
workflow:
- **Matched by POSITION**: a stage takes the key of the seed stage at the same
  `order`, and only when its first/final flags agree. Position rather than name,
  because a tenant renaming a stage is the case the key exists to survive.
- **Never guessed**: a stage at a position the seed does not use, two stages at
  one position, flags that disagree, or a different key already set are
  reported and left null.
- **Idempotent**: a stage already holding its key is counted, not set again.
- **One transaction per organisation**, which re-plans and refuses if the
  database changed since the dry run, and writes one audit row to that
  organisation's trail. A customer organisation is refused (ACC-101).
- **The dry run works before the deploy**: it notices the column is missing and
  only reports.

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

**One migration** (§4b), approved by Ahmad on 15 Oct.

## 8. Progress

- [x] Ticket ACC-233, branch, this plan, existing data checked (§6)
- [x] Ahmad decides §2.1 and §2.2 (15 Oct: A with the stage-key migration; the recommended reading)
- [x] The stage-key migration, the seed and the backfill (§4b)
- [x] Backend rules, codes and the locked transaction
- [x] Translations
- [x] The committee dialog
- [x] Tests, `test:db`, mutation checks
- [x] SYSTEM-REFERENCE and CLAUDE.md
- [ ] After the deploy: `npm run backfill:acc233-committee-stage-keys`, dry run then `-- --execute`, on the shared database

## 9. As built (16 Oct)

### Where the build differs from the plan

1. **A create takes no hierarchy lock** (§4 said every create). A new committee
   has no sub-committees and nothing reports to it, so no loop can pass through
   it. Its dissolving check still reads the target's instance `FOR SHARE`.
2. **The loop walk has no depth cap** (§3 said 500). It is one recursive query
   whose `UNION` drops a committee already seen, so it always ends, including on
   a loop already in the data.
3. **Only a value that CHANGES is checked on update.** The dialog sends every
   field, so re-checking an unchanged parent would block renaming a committee
   whose parent has since begun dissolving, or whose unit was since deactivated.
4. **An empty parent or reports-to is "none".** `''` used to reach the foreign
   key and fail as a 500. `trimToNull` now stores it as null. The owning unit is
   deliberately not trimmed: empty is a mistake to refuse, not an omission.
5. **The dialog's edit never cleared a parent or reports-to.** It sent
   `undefined` ("leave it alone"). It now sends `null`. Found while building; the
   same two fields, so fixed here.
6. **The dialog swallowed every save error** (`error: () => saving.set(false)`).
   It now says the refusal under its field.
7. **The committees list gains `currentStageKey` and `isDissolving`**, computed on
   the server, so the pickers keep no copy of which keys mean dissolving.
8. **The reference refusals changed from 404 to 400.** The committee in the URL
   still answers 404 when it is not found.

### Backfill results

- **Shared dev database, dry run (16 Oct, before the deploy; the column does not
  exist there yet, so report only):**

  | Organisation | Stages to key | Already keyed | Not matched |
  |---|---|---|---|
  | al-manara | 6 | 0 | 0 |
  | al-nakheel | 6 | 0 | 0 |

  Both still carry the seed's names and positions: Formation 10 → `formation` …
  Dissolved 60 → `dissolved`.
- **The real run waits for the deploy.** The column must not reach the shared
  database before the migration runs on merge. Run
  `npm run backfill:acc233-committee-stage-keys`, then `-- --execute`.
- **`--execute` proved on the throwaway local database**, on an organisation with
  stage 50 renamed "Winding up" and an extra stage the tenant added at 35:
  - the dry run planned 6 keys, with 1 not matched (the extra stage);
  - `--execute` keyed all 6 (the renamed stage got `dissolution_pending`) and
    wrote 1 audit row;
  - the re-run found 0 to key and 6 already keyed.

### Mutation checks (each turned specs red, then restored)

| Mutation | Red |
|---|---|
| The parent loop check never reaches | unit spec, 2 tests (the loop refusal, the walk's arguments); db-spec, 2 tests (the loop at any depth, the ten concurrent rounds) |
| Rule 5: the committee lookup not scoped to the organisation | unit spec, 14 tests, including the named isolation test; the CI isolation gate by name, 1 failed; db-spec, the other-organisation test |
| The hierarchy lock removed | unit spec, the lock test; db-spec, both concurrent-save tests |

