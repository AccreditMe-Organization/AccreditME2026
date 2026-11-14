# Step 278: drop the old workflow "who" columns (ACC-271 step 6c)

**Ticket:** [ACC-278](https://linear.app/accreditme/issue/ACC-278), "Drop the old workflow who columns
(ACC-271 6c)". The map is #261's description (PR 6b).

**Status:** answered (14 Nov, §7.1); PR A being built. Branch `feature/ACC-278-drop-old-who-columns`,
planned from `origin/dev` at `b62c3a4`, fast-forwarded to `9b49be0` (#289 merged) before PR A.

**Recommendation: two deploys.**
1. **PR A, no migration:**
   - mark the 13 old columns, their 2 relations and the 2 back-relations `@ignore`, so the client
     stops asking for them;
   - retire the four executed backfills, their `workflow-who.ts` helpers and their specs.
2. **PR B, after PR A has been live for a release:** one migration that:
   - drops the 13 columns (their 2 foreign keys go with them) and the 4 old enum types;
   - makes `whoMode` and `mover` NOT NULL.

   It is migration **64**, after #289 (62) and #290 (63).

Every claim below was measured on 14 Nov:
- **Code and fixtures:** dev at `b62c3a4`.
- **The two-deploy proof:** a scratch local database (55432), dropped afterwards.
- **Shared-database facts:** read-only counts, run from `D:\Accredit-me-2\backend`.

---

## 1. Nothing reads the columns (6b's scan, re-run)

**What was searched:**
- **Fields:** the 13 (on stages: `assigneeStrategy`, `assigneeRoleId`, `assigneeUserId`,
  `committeeId`, `assigneeCommitteeRoleValueId`, `assigneePositionId`, `assigneeOrgUnitId`,
  `approvalMode`, `parallelThreshold`; on transitions: `triggerCondition`, `triggerRoleId`,
  `triggerUserId`, `requiredPermission`).
- **Relations:** `assigneePosition`, `assigneeOrgUnit`.
- **Enums:** the four types and their values `ROLE_BASED`, `SYSTEM_AUTOMATIC`, `ASSIGNEE_POOL`,
  `ROUND_ROBIN`, `SEQUENTIAL`, `MAJORITY`, `POSITION_FIXED`.
- **Where:** `backend/src` (specs included), `backend/prisma` (schema, seed, scripts; migrations
  counted apart), `backend/scripts` and `frontend/src`.
- **How:** whole words, so the task field `assigneeUserIds` no longer matches.

**`committeeId` was checked by hand**, because it also names who entries and every committee
reference. No code reads a stage's own `committeeId`; the `committeeId` in
`interfaces/workflow-stage.interface.ts` is a who entry's.

**What is left:**

| Where | File (hits) | What it is | Fate |
| -- | -- | -- | -- |
| Schema | `prisma/schema.prisma` (38) | the columns, 2 relations, 2 back-relations (`OrgPosition.workflowStages`, `OrgUnit.assigneeForWorkflowStages`), 4 enums | PR A `@ignore`; PR B removes |
| Executed backfills | `backfill-acc271-stage-assignees.ts` (8), `backfill-acc271-transition-movers.ts` (6), `backfill-acc244-retire-flat-task-keys.ts` (3), `backfill-retire-tasks-complete.ts` (3) | read the columns | PR A deletes |
| Backfill helper | `src/foundation/workflow/workflow-who.ts` (26) | `whoFromLegacy`, `LegacyStageWho`, `moverForTrigger`, `decidesTogether` | PR A deletes these exports (§5) |
| Backfill specs | `backfill-acc271.db-spec.ts` (83), `workflow.seed.spec.ts` (21: the `whoFromLegacy` describe) | cover the backfills | PR A deletes |
| Guard specs | `dto/old-who-fields.dto.spec.ts` (12), `workflow-template.pr5be.spec.ts` (4), `stage-who.spec.ts` (2: `MAJORITY` refused as a who mode) | name a field on purpose | see §7 Q3 |
| Fixture | `committee-change-request.db-spec.ts` (2: line 825 writes `approvalMode: 'COMMITTEE'`, 6a's mutation fixture) | writes a column | PR A removes that write |
| Comments only | `task/task-pool.ts:26`, `task/task.service.ts:234`, `workflow-template.service.spec.ts:147` (`POSITION_FIXED`) | history | reword in PR B |
| Frontend | `recycle-bin.route.spec.ts`, `storage-settings.route.spec.ts` | the nav item's `requiredPermission`, a different field | none |
| Migrations | 5 of 61 | history | never edited |

**No production code reads a column.** The only runtime readers are the four executed backfills.

**Confirmed by the compiler:** a client generated with the 13 columns `@ignore`d type-checks with 12
errors, all in files on the "deletes" rows above:
- the 4 backfills (7);
- `backfill-acc271.db-spec.ts` (4);
- the `approvalMode` fixture write (1).

`workflow.service.ts`, `workflow-template.service.ts` and every other production file compile
unchanged.

## 2. The deploy shape, and the proof

**Why one PR can't do it.** Prisma's generated client names every scalar column it was generated
with:
- **Reads:** every `findMany` and `findFirst` without a `select`.
- **Writes:** every `create` and `update` that returns the row.

On these two models that is nearly all 60 calls in `backend/src` and `prisma`, plus two relation
includes that load whole rows. The migration runs pre-deploy while the old container still serves
(ACC-127), and a rollback brings the old code back. In both cases the old client asks for dropped
columns: the ACC-48 outage.

**Proof.** On a scratch database (`acc278_probe` on 55432), migrated to dev's 61 migrations, I ran
10 calls the app makes and dropped the 13 columns and 4 types exactly as PR B would:

| Call | dev's client, columns present | **dev's client, columns dropped** | `@ignore` client, dropped | `@ignore` client, present |
| -- | -- | -- | -- | -- |
| stage `findMany` (no select) | OK | **P2022 `WorkflowStage.approvalMode`** | OK | OK |
| stage `findFirst` (no select) | OK | **P2022** | OK | OK |
| stage `findMany` (`select` id, nameEn) | OK | OK | OK | OK |
| stage `count` | OK | OK | OK | OK |
| stage `create` (returns the row) | OK | **P2022 `approvalMode`** | OK | OK |
| stage `update` (returns the row) | OK | **P2022** | OK | OK |
| stage `update` (`select` id) | OK | OK | OK | OK |
| transition `findMany` (no select) | OK | **P2022 `WorkflowTransition.requiredPermission`** | OK | OK |
| transition `create` (returns the row) | OK | **P2022 `triggerCondition`** | OK | OK |
| template `findFirst` include stages + transitions | OK | **P2022** | OK | OK |

- **Dev's client fails 7 of 10** once the columns are gone; only narrow `select`s and `count`
  survive.
- **The `@ignore` client passes all 10, both ways.** With the columns present, its creates got the
  database defaults in the three NOT NULL old columns (`approvalMode` SINGLE, `assigneeStrategy`
  ROLE, `triggerCondition` ROLE_BASED), so PR A needs no database change.
- **The `@ignore` schema validates**, provided the 2 relations and the 2 back-relations are
  `@ignore`d too.

**So:**
- **PR A** deploys alone, with no migration.
- **PR B's migration** runs while PR A's container serves; PR A's client never names the columns.
- **Rolling PR B back to PR A** is safe (the `@ignore` client against the dropped database: all OK).
- **Rolling back further, to code before PR A,** is not safe: that is the "dropped" column. After PR
  B, the oldest safe rollback target is PR A.

## 3. `whoMode` and `mover` NOT NULL

**Shared database, counts:**

| | Rows | Null |
| -- | -- | -- |
| `WorkflowStage.whoMode` | 120 (112 ANY_ONE, 8 ALL) | **0** |
| `WorkflowTransition.mover` | 150 (134 PERSON, 16 APP) | **0** |
| Stages with no who entry | | **0** |

**No code path writes null today:**
- **Stage create** (`workflow-template.service.ts:653`) refuses a missing `who` with `WHO_REQUIRED`,
  then writes `whoMode: sentWho.mode`. `who` is `@IsOptional` on the DTO only so that the update DTO
  (a `PartialType`) can leave it out.
- **Stage update** writes `whoMode` only when a `who` is sent (`:811`), never null.
- **Transition create** (`:1016`) writes `mover: 'PERSON'`.
- **The seed** (`workflow-seed-apply.ts:93, :143`) writes `who.mode` and `mover` from types that
  require them (`workflow.seed.ts:32, :51, :69`).
- **Nothing writes `whoMode: null` or `mover: null`** (searched).

**What NOT NULL breaks**, measured by type-checking against PR B's final schema (73 errors, of which
the 4 backfills and their spec account for 38, gone in PR A):

| File | Why | PR B change |
| -- | -- | -- |
| `workflow/stage-pool.service.ts:121, 338, 381` (+1 that follows) | `stage: { whoMode: { not: null } }`, which is no longer a valid filter | delete the filter |
| `workflow/workflow-awaiting.service.ts:93` (+15 that follow) | same | delete the filter |
| `workflow/workflow-who.ts:161` (`writeStartingAssignments`) | same | delete the filter |
| `common/testing/committee-in-stage.ts:31` and 7 db-specs (`committee-change-request` :122, `committee-home` :52, `committee-reference-checks` :157, `task-record-choices` :77, `stage-rules` :159 :220, `webhook-config-secrets` :53) | a fixture stage with no `whoMode` | add `whoMode: 'ANY_ONE'` |
| `stage-without-who.db-spec.ts` (3), `starting-assignments.db-spec.ts` (2) | their subject, a stage with no `who`, becomes impossible | delete those cases |

**`workflow.service.ts` compiles unchanged.** Its `if (mover === null)` (`:595`,
`MOVE_HAS_NO_MOVER`) becomes unreachable, as do `workflow-pool.ts:11` (`?? null`) and
`workflow-template.service.ts:395` (`whoMode === null`).

**Leave them in PR B.** Removing them is optional tidying, and the first touches the file ACC-202
part 2 edits (§6). See Q5.

**The migration's `SET NOT NULL` checks every row.** If a null appeared before it runs, it fails, and
the deploy stops with nothing dropped. The tables are 120 and 150 rows, so the lock is momentary.

## 4. The enum values nothing uses

**The four old enums are each used by exactly one old column** (`pg_attribute`, shared database):

| Type | Values | Used only by |
| -- | -- | -- |
| `WorkflowApprovalMode` | SINGLE, SEQUENTIAL, PARALLEL, COMMITTEE | `WorkflowStage.approvalMode` |
| `WorkflowParallelThreshold` | ALL, MAJORITY, ANY | `WorkflowStage.parallelThreshold` |
| `WorkflowAssigneeStrategy` | SPECIFIC_USER, ROLE, ORG_UNIT_HEAD, SELF, COMMITTEE, ROUND_ROBIN, POSITION_FIXED | `WorkflowStage.assigneeStrategy` |
| `WorkflowTriggerCondition` | SPECIFIC_USER, ROLE_BASED, ANY_AUTHENTICATED, SYSTEM_AUTOMATIC, ASSIGNEE_POOL | `WorkflowTransition.triggerCondition` |

**So PR B drops each type whole** (`DROP TYPE`) after its column, and no value has to be removed from
a live enum. Prisma's migration generates exactly that order.

**Of the enums that stay, one value is unused:** `TransitionMover.AUTOMATIC`.
- It was reserved in ACC-271 ("AUTOMATIC reserved").
- No row holds it, and no code names it.
- `StageWhoMode` and `StageAssigneeKind` are all in use, including `COMMITTEE_VOTE`, which the engine
  reads although no stage has it today.

**How Postgres removes a value**, if Ahmad wants `AUTOMATIC` gone (Q1). Postgres has no
`ALTER TYPE … DROP VALUE`; the type is recreated:

```sql
CREATE TYPE "TransitionMover_new" AS ENUM ('PERSON', 'APP');
ALTER TABLE "WorkflowTransition" ALTER COLUMN "mover" TYPE "TransitionMover_new"
  USING ("mover"::text::"TransitionMover_new");
DROP TYPE "TransitionMover";
ALTER TYPE "TransitionMover_new" RENAME TO "TransitionMover";
```

Prisma's `migrate dev` writes this shape itself. **Is the old client safe with it?**
- **Reading:** yes. It knows a superset of the values, and no row holds the removed one.
- **Writing:** it would fail only if it wrote `AUTOMATIC`, and nothing does.
- **The other direction is the dangerous one,** an old client meeting a value it wasn't generated
  with: Prisma 7 throws, which is why ACC-202 adds values ahead of their writers.

So a removal is safe in the expand-then-contract order. The `ALTER COLUMN … TYPE` rewrites 150 rows
under a brief lock.

## 5. Retiring the executed backfills and their helpers

**Each was executed on the shared database.** CLAUDE.md records the ACC-271 pair as executed on
29 Oct; for every one, the effect is in the data (read-only, today):

| Backfill | What it does | On the shared database |
| -- | -- | -- |
| `backfill-acc271-stage-assignees` | converts every stage to its own `who` | stages not converted (no `whoMode` or no entry): **0** of 120 |
| `backfill-acc271-transition-movers` | sets every transition's `mover` | transitions with no mover: **0** of 150 |
| `backfill-acc244-retire-flat-task-keys` | removes `tasks:view/create/reassign/manage` grants | grants left: **0**; catalog rows: **0** |
| `backfill-retire-tasks-complete` | removes `tasks:complete` grants and its catalog row | grants **0**, catalog **0** |

**Nothing else imports them:**
- **The ACC-271 pair:** imported only by `src/foundation/workflow/backfill-acc271.db-spec.ts`.
- **`backfill-acc244-retire-flat-task-keys`:**
  - imported only by `src/foundation/roles/backfill-acc244-retire-flat-task-keys.db-spec.ts`;
  - **also read, by path,** by `src/common/constants/retired-task-keys.spec.ts:70`. That spec's
    allowance for the backfill file goes with it.
- **`backfill-retire-tasks-complete`:** nothing imports it. `task.controller.ts:468` names it in a
  comment, which stays as history.
- **`package.json`:** four `backfill:` scripts point at them, and go.

**`workflow-who.ts` is NOT deleted whole**, unlike the ticket's wording. It also exports
`writeStartingAssignments()` and its `StartingAssignmentDb` type, which `workflow-template.service.ts`
(production) and four db-specs import:
- **Deleted:** `whoFromLegacy`, `LegacyStageWho`, `moverForTrigger`, `decidesTogether`, and
  `ConvertedWho` / `WhoEntryDraft` if only those used them.
- **Their importers:** the two backfills and `workflow.seed.spec.ts`'s `describe('whoFromLegacy …')`.

**History is kept by git;** the scripts are not moved to an archive folder (Q4).

## 6. Ordering, and overlaps

**Order:**
1. #289 (ACC-202 PR 1, migration 62).
2. Lane A's #290 (ACC-126, migration 63).
3. **PR A** (no migration). It can merge before or after them, since it adds none.
4. **PR B**, migration 64, after both and after PR A has been live for a release.

**Overlaps:**
- **#289:** touches `schema.prisma` (the `WorkflowInstanceStageOutcome` enum, another block),
  `workflow-template.service.ts` (+137), its spec, `workflow.seed.spec.ts` (+12) and
  `workflow.service.ts` (+5).
  - **PR A** edits `schema.prisma` (other models) and `workflow.seed.spec.ts` (deletes the
    `whoFromLegacy` describe): textual merges, rebase after #289.
  - **PR B** edits one comment in `workflow-template.service.ts` (`:676`, "6c drops them") and its
    `pr5be` / `who` specs.
- **#290:** only `RefreshToken`, auth and the frontend. No overlap but `CLAUDE.md` /
  `SYSTEM-REFERENCE.md`.
- **ACC-202 part 2** (Coder 2) makes a stage left by a RETURN or EXIT record those outcomes, in
  `workflow.service.ts`. **Neither PR A nor PR B has to touch `workflow.service.ts`**: it reads no old
  column and compiles against both schemas.
  - The only possible overlap is the optional removal of the unreachable `mover === null` branch
    (`:595`). If we want it, it goes after ACC-202 part 2 merges, or into Coder 2's PR (Q5).

## 7. Questions for Ahmad (recommendation first)

1. **Drop `TransitionMover.AUTOMATIC`?** *Recommendation: keep it.* It was reserved deliberately in
   ACC-271, nothing writes it, and removing it costs a type recreate for no reader. Revisit when the
   first automatic move is designed.
2. **Archive the old values before they go?** 92 of 120 stages and 130 of 150 transitions still hold
   legacy ids or permissions in the old columns. *Recommendation: no archive.* Nothing has read them
   since 6b, the conversion is complete (§5), and Supabase's 30-day point-in-time recovery covers a
   mistake.
3. **The guard specs that name old fields:**
   - `old-who-fields.dto.spec.ts`, each field 400 on create and update. *Recommendation: keep it.*
     The DTO whitelist still refuses a field that no longer exists, and it stops one being re-added
     without a decision.
   - `pr5be.spec.ts` (`not.toHaveProperty('approvalMode')`). *Recommendation: delete in PR B,* where
     it becomes vacuous.
4. **Delete the executed backfills, or move them to an archive folder?** *Recommendation: delete.*
   Git keeps them, and an archive folder would keep importing dropped columns.
5. **The unreachable null branches after NOT NULL** (`workflow.service.ts:595`
   `MOVE_HAS_NO_MOVER`, `workflow-pool.ts:11`, `workflow-template.service.ts:395`).
   *Recommendation: leave them in PR B, and remove them in a small follow-up after ACC-202 part 2
   merges,* so PR B never touches `workflow.service.ts`.
6. **How long between PR A and PR B?** *Recommendation: PR B no sooner than the next day after PR A
   is live,* and not in the same deploy window. PR A is then the rollback target if PR B misbehaves.

### 7.1 Ahmad's answers (14 Nov)

1. **Keep `TransitionMover.AUTOMATIC`.**
2. **No archive** of the old values.
3. **Keep `old-who-fields.dto.spec.ts`;** delete the `pr5be.spec.ts` check in PR B.
4. **Delete the executed backfills.**
5. **The unreachable null branches go in a follow-up after ACC-202 part 2,** not in PR B.
6. **PR B at least a day after PR A is live.**

## 8. The two PRs

### PR A: the client stops asking (no migration)

- **`schema.prisma`:** `@ignore` on the 13 columns, `assigneePosition` / `assigneeOrgUnit`, and the
  back-relations `OrgPosition.workflowStages`, `OrgUnit.assigneeForWorkflowStages`. Validated in the
  probe.
- **Deleted:**
  - the 4 backfills and their 4 `package.json` scripts;
  - `backfill-acc271.db-spec.ts` and `roles/backfill-acc244-retire-flat-task-keys.db-spec.ts`;
  - the `whoFromLegacy` describe in `workflow.seed.spec.ts`;
  - the legacy exports of `workflow-who.ts` (§5).
- **Edited:**
  - `retired-task-keys.spec.ts`, which drops the deleted backfill from its allowances;
  - `committee-change-request.db-spec.ts:825`, whose fixture no longer writes `approvalMode`;
    replaced by a stage whose `whoMode` alone says it is not a vote, if the case still matters.
- **Specs:**
  - **Generated client:** a spec reads `generated/prisma` and asserts that `WorkflowStage` /
    `WorkflowTransition` have none of the 13 fields.
  - **Probe as a db-spec:** dev's runtime calls run against a database where the columns are dropped.
- **Mutation check:** removing one `@ignore` turns that spec red.
- **Gate:** backend tsc, Jest, isolation, `test:db`, every `check:*`.
- **Docs:** SYSTEM-REFERENCE (the stage-who section and its "6c" notes) and CLAUDE.md's ACC-271
  entry.

### PR B: the database drops them (migration 64)

- **`schema.prisma`:**
  - remove the 13 columns, 2 relations, 2 back-relations and 4 enums;
  - `whoMode StageWhoMode` and `mover TransitionMover` (no `?`).
- **The migration,** written by `prisma migrate dev` locally on 55432, never edited by hand:
  - drop the 2 foreign keys and the 13 columns;
  - `SET NOT NULL` on `whoMode` and `mover`;
  - drop the 4 types.
- **Code:** the five `whoMode: { not: null }` filters (§3) and the `workflow-template.service.ts:676`
  comment.
- **Specs:**
  - fixtures get `whoMode` (§3 table);
  - the no-`who` cases go;
  - a db-spec proves a stage or transition write without `whoMode` / `mover` is refused by the
    database.
- **Gate:** as PR A, plus `prisma migrate deploy` on a fresh local database.
- **Deploy check:** `/health` names the merge commit; migrations 64, none failed.

## 9. Progress

- [x] Plan: scan, two-deploy proof, counts, enums, backfills, ordering (14 Nov)
- [x] Ahmad's answers to §7 (14 Nov, §7.1)
- [x] PR A built (14 Nov): `@ignore` (migrate diff empty, mutation-checked), backfills and
  helpers deleted, docs; the 10 calls passed with the columns dropped (dev's client: 3 of 10)
- [ ] PR A live for a release
- [ ] PR B (after #289 and #290)
