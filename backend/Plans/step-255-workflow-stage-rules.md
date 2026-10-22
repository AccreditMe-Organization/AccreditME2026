# Step 255 — Workflow engine step 1: what each stage allows, and stage flags

**Ticket:** ACC-255 (Lane B). Step 1 of 2 from the workflow engine design note
(Ahmad, 18 Oct). Step 2 (selection rules, conditional and automatic transitions,
versions, the New workflow screen) must land before the Documents module.

**Status:** PLAN ONLY. Nothing here is built. Written against `dev` at
`6b2c026` (22 Oct). ACC-240's PR 3a (#205) and PR 3b are not on `dev` yet; §11
says how this work lands relative to them.

**Folded in:** ACC-241 (the API lock outside Formation), ACC-254 (the stages
page scrolls sideways; raw enum codes shown), the workflow list's unnamed icon
buttons and the `check:icon-labels` gap, the Quality Manager's redirect from
`/workflows`, the workflow screens' English protected-template refusal, and the
committee form's silent 403 on its type and unit lists.

---

## 1. The agreed design, restated as rules the code must keep

1. **Three registries in code, per record type, served by the template API and
   never copied in the frontend.** They fail closed, as `RECORD_ROUTES` does
   (`stage-task-record-routes.ts:4-8`, `:23-49`):
   - `RECORD_ACTIONS` — what can be done to a record. Committees: edit details,
     add member, remove member, change member role, request a change.
   - `STAGE_FLAGS` — what a stage means. Dissolving, Applies the approved
     change, Record is in force. A flag may be required on exactly one stage.
   - `RECORD_FIELDS` — fields step 2's conditions will read. Committees:
     committee type, owning unit. Defined now, read by nothing in this ticket.
2. **A stage lists the record actions it allows.** A stage only narrows what a
   role allows, never grants. The engine answers "does this record's current
   stage allow this action?"; the module still checks the person's permission.
   Both must say yes.
3. **The seed reproduces today.** Committee Edit is allowed in Formation only.
4. **Flags replace code that matches seeded stage keys.** Keys stay as internal
   seed identity (`WorkflowStage.key`, ACC-233) and are never shown.
5. **Saving a workflow that breaks an exactly-one flag is refused.**
6. **One answer feeds the backend refusal and the frontend offer.** This is
   what delivers ACC-241's lock outside Formation.
7. **Stage configuration changes are audited with what changed.**

---

## 2. What exists today (measured on `dev` `6b2c026`)

### 2.1 Every place that matches a stage key or hard-codes a stage rule

Backend, `backend/src/foundation/workflow/`:

| File:line | What it encodes | Moves to (§4) |
|---|---|---|
| `workflow-stage-keys.ts:16-20` | `KEYED_SEED_TEMPLATES` = COMMITTEE, COMMITTEE_CHANGE_REQUEST — which templates' seeded stages carry a key | stays (seed identity) |
| `workflow-stage-keys.ts:23-30` | `COMMITTEE_STAGE_KEYS` (formation … dissolved) | stays (seed identity, backfill input) |
| `workflow-stage-keys.ts:35-38` | `COMMITTEE_DISSOLVING_STAGE_KEYS` = dissolution_pending, dissolved | **DISSOLVING flag** |
| `workflow-stage-keys.ts:41-43` | `isDissolvingStageKey(key)` | **DISSOLVING flag** (deleted in PR 2) |
| `workflow-stage-keys.ts:49` | `CHANGE_REQUEST_STAGE_KEYS` (draft … withdrawn) | stays (protected template, §4.4) |
| `workflow-stage-keys.ts:63` | `PROTECTED_TEMPLATES` = COMMITTEE_CHANGE_REQUEST | stays |
| `workflow.seed.ts:258-263` | COMMITTEE stages with keys | seed gains `actions` and `flags` (§5.3) |
| `workflow.seed.ts:292-297` | COMMITTEE_CHANGE_REQUEST stages with keys | seed gains `flags` on `approved` |
| `workflow-seed-apply.ts:76-89`, `:108-117` | finds stages by key, writes `key`, resolves transitions by key | stays; also writes actions and flags on CREATE (§5.3) |
| `transition-preconditions.ts:33` | `ctx.fromStageKey !== 'formation'` — the quorum check runs only on an ADVANCE out of Formation | **kept on the key in this ticket** (D10) |
| `workflow.service.ts:872-889` | `triggerSystemTransition(…, toStageKey)` moves a record by target key | stays; the approve move resolves its target by flag (§4.3) |
| `workflow.service.ts:1166` | passes `fromStage.key` to preconditions | stays |
| `workflow-template.service.ts:39` | `PROTECTED_STAGE_EDITABLE` (names, description, deadline, escalation) | unchanged; `actions`/`flags` are not in it (D8) |
| `workflow-template.service.ts:852-875` | `mapStage()` never exposes `key` | unchanged; adds `actions`, `flags` |

Backend, `backend/src/foundation/committees/`:

| File:line | What it encodes | Moves to |
|---|---|---|
| `committee-stage-counts.ts:64,76-77` | reads `WorkflowStage.key`; `isDissolving: isDissolvingStageKey(stage?.key)` for the lists and the detail | **DISSOLVING flag** (and `isInForce`, §4.2) |
| `committee-reference-checks.ts:79` | a dissolving committee can't be a parent (`COMMITTEE_PARENT_DISSOLVING`) | **DISSOLVING flag** |
| `committee-reference-checks.ts:89-91` | can't report to a dissolving committee (`COMMITTEE_REPORTS_TO_DISSOLVING`) | **DISSOLVING flag** |
| `committee-reference-checks.ts:153-172` | `isDissolving()` raw SQL reads the key `FOR SHARE OF wi`; no key ⇒ logged, not dissolving | reads `flags` instead (same lock) |
| `change-requests/change-request-policy.ts:85-106` | `COMMITTEE_STAGE_POLICY`: formation/terms_review → `NOT_APPROVED` (edit, withdraw, reject); active/suspended → `RAISED_HERE` (raise, everything); dissolution_pending/dissolved → `DISSOLVING` (withdraw, reject) | **request_change action + IN_FORCE + DISSOLVING** (§4.2) |
| `change-request-policy.ts:109-113` | `UNKEYED_COMMITTEE_STAGE = NOT_APPROVED` | follows from §4.2 (no flags, no action) |
| `change-request-policy.ts:122-124` | `committeeStageRefusal`: dissolving ⇒ `CHANGE_REQUEST_COMMITTEE_DISSOLVING`, else `CHANGE_REQUEST_STAGE_NOT_ALLOWED` | reads DISSOLVING flag |
| `change-request-policy.ts:132-140` | `assertCommitteeStageAllows`, `assertCommitteeAllowsRaise` | rewritten over the answer (§4.2) |
| `change-request-policy.ts:62-68` | `ACTION_TARGET_STAGE.approve = 'approved'` | **APPLIES_APPROVED_CHANGE flag** (§4.3) |
| `change-request-policy.ts:40-48`, `:55-59`, `:71-83` | `REQUEST_STAGE_POLICY` (what a REQUEST may do in its own stage), `awaitsDecision`, refusals | stays on keys (protected template, D7) |
| `change-requests/committee-change-request.service.ts:169,180-181` | create: permission, then `assertCommitteeAllowsRaise(stageKey)` | **request_change action** |
| `committee-change-request.service.ts:239-241, 287-288, 348, 410-411, 487, 672-673` | committee-stage checks on edit, submit, withdraw, approve, return, decide | §4.2 derivation |
| `committee-change-request.service.ts:826-836` | `committeeStageKey()` — newest COMMITTEE instance's key, `FOR SHARE OF wi` | replaced by the engine's `currentStageRules()` (§3.3) |
| `committees.service.ts:71-72, 100-101` | `currentStageKey`, `isDissolving` on list items and the detail | adds `stageRules` (§6.2); `currentStageKey` stays until PR 3 |

**No committee write checks the stage today** except creating a change request:

| Action | Controller (permission) | Service | Stage check today |
|---|---|---|---|
| Edit details | `committees.controller.ts:61-70` (`EDIT_DETAILS`, :62) | `committees.service.ts:168` `updateCommittee` | **none** — only the dissolving-target check on a changed parent / reports-to (`:205-215`) |
| Add member | `:113-122` (`ADD_MEMBER`, :114) | `:273` `addMember` | none |
| Change member role | `:124-134` (`CHANGE_MEMBER_ROLE`, :125) | `:344` `changeMemberRole` | none |
| Remove member | `:136-146` (`REMOVE_MEMBER`, :137) | `:387` `removeMember` | none |
| Request a change | `committee-change-request.controller.ts:68-77` (`VIEW`) | `committee-change-request.service.ts:168` `create`, `EDIT_DETAILS` at :169 | **yes**, active/suspended (`:181`) |

Frontend:

| File:line | What it encodes | Moves to |
|---|---|---|
| `foundation/committees/committee-stage.ts:28-35` | `COMMITTEE_STAGE_KEYS_FOR_TEST` — a copy of the backend key list | deleted (PR 3) |
| `committee-stage.ts:53-56` | `COMMITTEE_HEADER_POLICY`: formation → Edit; terms_review → locked line | **the server's `stageRules`** (§6.2) |
| `committee-stage.ts:58-64` | `committeeHeaderOffers()` | reads `stageRules` |
| `components/committee-detail/committee-detail.component.ts:552-566` | Edit gated on permission + header policy; member actions on permission only | permission + `stageRules.actions` |
| `committee-references.ts:81` | hides `isDissolving` committees from Parent / Reports to | unchanged (server-derived flag) |
| `components/committee-list/committee-list.component.ts:30,35-37` | list status `isDissolving ? 'DISSOLVING' : 'ACTIVE'` | unchanged (server-derived); §12 Q-F |

**The ticket's "in-force stages in committee-stage-counts" do not exist on
`dev` or on ACC-240's branch.** `committee-stage-counts.ts` derives only
`isDissolving` (`:76-77`). The only code that separates an approved committee
from one not yet approved is `COMMITTEE_STAGE_POLICY`'s `RAISED_HERE` vs
`NOT_APPROVED` (`change-request-policy.ts:92-106`). That is what the IN_FORCE
flag replaces (§4.2); it adds `isInForce` to the counts so the lists can read it
later.

Spec files that reference the same keys or maps: 11 backend (about 82 matching
lines) and 8 frontend (about 37). Each is listed in §9.

### 2.2 The stage configuration API and audit today

- `workflow-template.controller.ts`, under `@Controller('workflow-templates')` (:46), `TenantGuard` + `PermissionGuard` (:47):
  - `GET :id` (:230, `workflows:view`) → `getTemplateById` (`workflow-template.service.ts:65-97`). It returns `recordRoutes` booleans from `RECORD_ROUTES` (:81, :86).
  - `POST :id/stages` (:272), `PATCH stages/:stageId` (:149), `DELETE stages/:stageId` (:160), all `workflows:manage`.
- **The audit records names only.**
  - `addStage` (:270-277) logs `after: { nameEn, nameAr, order }`.
  - `updateStage` (:362-370) logs `before` / `after` with `nameEn`, `nameAr` only, though the DTO (`dto/update-workflow-stage.dto.ts:4` → `create-workflow-stage.dto.ts:31-111`) changes 17 fields.
  - `removeStage` (:405-412) logs `before: { nameEn, nameAr }`.
- **Protected templates:** `refuseProtected(edit)` throws `WORKFLOW_TEMPLATE_PROTECTED` with an edit-specific English `message` and `edit` (`workflow-refusal.ts:96-117`).
- **Backfill convention** (`prisma/backfill-acc239-change-request-workflow.ts`):
  - a dry run by default, `--execute` to write (:182);
  - `BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 }` (:38);
  - refuses customer organisations (:115-116, :169-170);
  - one transaction per organisation with a re-check inside (:120-150), writing one `auditLog` row each (:129-148).
- **Instance lock:** `lockWorkflowInstance(tx, id, organizationId)` (`task/stage-deadline.ts:15-17`). The lock order is instance, then task, then record row (`:9-14`).

---

## 3. The registries and the engine's answer

### 3.1 The registries (new file `backend/src/foundation/workflow/record-registry.ts`)

```ts
export interface RecordActionDef  { key: string; labelKey: string }        // labelKey: frontend i18n key
export interface StageFlagDef     { key: string; labelKey: string; cardinality: 'any' | 'exactlyOne' }
export interface RecordFieldDef   { key: string; labelKey: string; kind: 'lookup' | 'orgUnit' }

export const RECORD_ACTIONS: Partial<Record<WorkflowObjectType, readonly RecordActionDef[]>> = {
  COMMITTEE: [
    { key: 'edit_details',       labelKey: 'workflow.recordAction.COMMITTEE.edit_details' },
    { key: 'add_member',         labelKey: 'workflow.recordAction.COMMITTEE.add_member' },
    { key: 'remove_member',      labelKey: 'workflow.recordAction.COMMITTEE.remove_member' },
    { key: 'change_member_role', labelKey: 'workflow.recordAction.COMMITTEE.change_member_role' },
    { key: 'request_change',     labelKey: 'workflow.recordAction.COMMITTEE.request_change' },
  ],
};

export const STAGE_FLAGS: Partial<Record<WorkflowObjectType, readonly StageFlagDef[]>> = {
  COMMITTEE: [
    { key: 'DISSOLVING', labelKey: 'workflow.stageFlag.DISSOLVING', cardinality: 'any' },
    { key: 'IN_FORCE',   labelKey: 'workflow.stageFlag.IN_FORCE',   cardinality: 'any' },
  ],
  COMMITTEE_CHANGE_REQUEST: [
    { key: 'APPLIES_APPROVED_CHANGE', labelKey: 'workflow.stageFlag.APPLIES_APPROVED_CHANGE', cardinality: 'exactlyOne' },
  ],
};

export const RECORD_FIELDS: Partial<Record<WorkflowObjectType, readonly RecordFieldDef[]>> = {
  COMMITTEE: [
    { key: 'typeValueId', labelKey: 'workflow.recordField.COMMITTEE.typeValueId', kind: 'lookup' },
    { key: 'orgUnitId',   labelKey: 'workflow.recordField.COMMITTEE.orgUnitId',   kind: 'orgUnit' },
  ],
};
```

- **Fail closed, three ways, as `RECORD_ROUTES` does:**
  - a type with no `RECORD_ACTIONS` entry offers no actions to configure, and `stageAllows()` refuses (a programming error, logged);
  - saving an `actions` or `flags` value not in the type's registry is refused (§7);
  - a stage with no row for an action does not allow it.
- **Keys are code, labels are the frontend's.** The labels live in `en.json` / `ar.json` under the `labelKey`s; the server sends the keys only, as `recordRoutes` does today.
- **Adding an action to a registry later ships with its seed default and a backfill**, or the action is dark on every existing stage (fail closed). Recorded so the next module knows it (D3).

### 3.2 Data (one additive migration, `acc255_workflow_stage_rules`)

```prisma
model WorkflowStageRecordAction {
  id             String   @id @default(cuid())
  organizationId String
  stageId        String
  actionKey      String
  createdAt      DateTime @default(now())

  organization Organization  @relation(fields: [organizationId], references: [id])
  stage        WorkflowStage @relation(fields: [stageId], references: [id], onDelete: Cascade)

  @@unique([stageId, actionKey])
  @@index([organizationId])
}

// WorkflowStage gains:
  flags String[] @default([])
  recordActions WorkflowStageRecordAction[]
```

- **A row means "allowed"**; there is no `allowed` boolean (D2). Absent is not allowed, which is the fail-closed reading, and there is no third "not decided" state to explain.
- **A table rather than a JSON column** (the brief's preference): each allowed action is a row the audit can name, it is unique per stage by constraint, and step 2 can join it.
- **`organizationId` on the table** (the multi-tenancy rule), set from the stage's template, and in every `WHERE`.
- **`onDelete: Cascade` from the stage**, because `removeStage` hard-deletes (`workflow-template.service.ts:403`) and the rows mean nothing without it. The stage's own delete is audited with its actions (§8).
- **`flags String[]` on the stage**, not a table: flags are few, read with the stage in every query, and the cardinality check reads them all at once. Validated against `STAGE_FLAGS` in code.
- **Expand only.** A new table and a defaulted column; nothing renamed or dropped. Safe against the running code, which never selects either (ACC-127).

### 3.3 The engine's answer (new `StageRulesService` in `foundation/workflow/`)

```ts
interface StageRules { stageId: string | null; flags: string[]; actions: Record<string, boolean> }

currentStageRules(client, objectType, objectId, organizationId, { lock: 'share' | 'none' }): Promise<StageRules>
stageAllows(client, objectType, objectId, actionKey, organizationId): Promise<boolean>
assertStageAllows(client, objectType, objectId, actionKey, organizationId): Promise<void>  // throws §7
```

- **One read:** the newest instance for `(organizationId, objectType, objectId)` (the rule `committee-stage-counts.ts:50-57` and `committeeStageKey()` already use), its `currentStageId`, that stage's `flags`, and its action rows. Every query is scoped by `organizationId`.
- **`lock: 'share'` takes `FOR SHARE OF wi`** on the instance, as `committeeStageKey()` (`committee-change-request.service.ts:834`) and `isDissolving()` (`committee-reference-checks.ts:154-161`) do today. A transition into another stage then waits for the write, or the write waits for the transition.
- **A record with no instance, or an instance with no current stage, allows nothing and has no flags.** It is logged with ids only (fail closed, ACC-241's rule, step-238 §7).
- **The batch form** `stageRulesFor(organizationId, objectType, objectIds[])` serves the lists in three queries, like `committeeStagesAndCounts()` (`:24-81`).
- **It never reads a permission.** The module checks the person's permission first, as it does today, then asks this. The two together decide (rule 2).

---

## 4. How each hard-coded rule moves

### 4.1 The seed reproduces today (D4)

COMMITTEE stages (`workflow.seed.ts:258-263`):

| Stage key | edit_details | add_member | remove_member | change_member_role | request_change | Flags |
|---|---|---|---|---|---|---|
| formation | ✓ | ✓ | ✓ | ✓ | | |
| terms_review | | ✓ | ✓ | ✓ | | |
| active | | ✓ | ✓ | ✓ | ✓ | IN_FORCE |
| suspended | | ✓ | ✓ | ✓ | ✓ | IN_FORCE |
| dissolution_pending | | ✓ | ✓ | ✓ | | DISSOLVING |
| dissolved | | ✓ | ✓ | ✓ | | DISSOLVING |

- **Edit details:** Formation only. That is what the screen offers today (`committee-stage.ts:54`); ACC-241 makes the API agree.
- **Members: every stage.** Today no screen and no API limits membership by stage, so the seed allows it everywhere. Whether Dissolved should stop membership changes is Q-A (§12).
- **Request a change:** Active and Suspended — `RAISED_HERE` (`change-request-policy.ts:102-103`).
- **A stage a tenant added** (no key) gets the member actions and nothing else, which is what it allows today: membership is unchecked, Edit is not offered (`committee-stage.ts:59` finds no policy), and a request is not raised (`UNKEYED_COMMITTEE_STAGE`, `:109`).

COMMITTEE_CHANGE_REQUEST stages (`workflow.seed.ts:292-297`): `approved` gets `APPLIES_APPROVED_CHANGE`. No record actions (the type has no `RECORD_ACTIONS` entry; its own moves stay in `REQUEST_STAGE_POLICY`, D7).

### 4.2 What a committee stage lets a change request do

`COMMITTEE_STAGE_POLICY`'s three groups become one derivation over the answer:

| Request move | Allowed when the committee's stage… | Old map, for comparison |
|---|---|---|
| raise (create) | allows `request_change` | `raise` only in RAISED_HERE |
| submit, approve, return | is flagged IN_FORCE | only RAISED_HERE allows them |
| edit | is not flagged DISSOLVING | NOT_APPROVED and RAISED_HERE allow it; DISSOLVING does not |
| withdraw, reject | always | every group allows them |

Check against today, stage by stage. Every row is identical, and a spec pins all six plus the unkeyed case (§9):
- formation and terms_review → edit, withdraw, reject (= NOT_APPROVED);
- active and suspended → everything (= RAISED_HERE);
- dissolution_pending and dissolved → withdraw, reject (= DISSOLVING);
- a stage with no key and no flags → edit, withdraw, reject (= UNKEYED → NOT_APPROVED).

The refusal is unchanged: DISSOLVING flag ⇒ `CHANGE_REQUEST_COMMITTEE_DISSOLVING`, else `CHANGE_REQUEST_STAGE_NOT_ALLOWED` (`change-request-policy.ts:122-124`).

### 4.3 The approved stage

- `ACTION_TARGET_STAGE.approve = 'approved'` (`change-request-policy.ts:62-68`) becomes "the stage of the request's template flagged APPLIES_APPROVED_CHANGE".
- The approve move then calls `triggerSystemTransition` with that stage's key. The engine API (`workflow.service.ts:872-889`) stays keyed, because the target is found by flag and its key is only the seed identity.
- **Exactly one** stage per COMMITTEE_CHANGE_REQUEST template carries the flag (§7). If a template ever has none, approve refuses with `CHANGE_REQUEST_STAGE_NOT_ALLOWED` and logs ids; it never applies changes from an unflagged stage.

### 4.4 Dissolving, everywhere

- `committee-reference-checks.ts:153-172` `isDissolving()` reads the stage's `flags` in the same `FOR SHARE OF wi` query, instead of its key. A stage without the flag is not dissolving; the "no key" warning goes, because no key is no longer suspicious.
- `committee-stage-counts.ts:76-77` reads the flag; it also returns `isInForce` (IN_FORCE flag) for later use (Q-F).
- `change-request-policy.ts:122-124` reads it (§4.2).
- `isDissolvingStageKey` and `COMMITTEE_DISSOLVING_STAGE_KEYS` are deleted in PR 2, and a scan-style spec fails if any non-spec source names a committee stage key outside the seed, the backfill and `workflow-stage-keys.ts` (§9).

### 4.5 ACC-241 — the API lock outside Formation

- `updateCommittee` (`committees.service.ts:168`) calls `assertStageAllows(tx, 'COMMITTEE', id, 'edit_details', org)` inside its transaction.
- **Lock order** (step-238 §7, the deadlock found in ACC-238): the answer is read with `lock: 'share'` on the INSTANCE first, then the existing committee row lock (`:186`), then the stale-save comparison. That is instance, then committee, the engine's order.
- `addMember` (:273), `changeMemberRole` (:344) and `removeMember` (:387) call it with their own action in the same order. Seeded everywhere, so nothing changes today (Q-A).
- The change-request apply path (`committee-change-request.service.ts:431-434`) writes the committee through its own transaction and is not an "edit details": it is not checked against `edit_details`, as step-238 §7 already decided.
- A real-database spec presses an edit and Submit for Approval together, ten times, and requires both to finish (step-238 §7's test, now built).

### 4.6 What stays on keys, deliberately

- **`transition-preconditions.ts:33`** (quorum on an ADVANCE out of Formation) stays on `fromStageKey === 'formation'` (D10). It is a rule about a transition, not about what a stage allows, and step 2's conditions are its home.
- **`REQUEST_STAGE_POLICY`** and the other request maps stay keyed (D7). The template is protected, so its six stages are fixed, and their keys are a closed set.
- **The seed and the backfills** read keys; that is what keys are for.

---

## 5. Migration, seed and backfill

### 5.1 Migration `acc255_workflow_stage_rules` (PR 1)

- `CREATE TABLE "WorkflowStageRecordAction"`, with its unique index, organisation index and two foreign keys.
- `ALTER TABLE "WorkflowStage" ADD COLUMN "flags" TEXT[] NOT NULL DEFAULT '{}'`.
- Generated by `prisma migrate dev --name acc255_workflow_stage_rules` against the local test Postgres, never against the shared database. Read before committing (`prisma-change` skill).
- **Runs on merge** as Railway's pre-deploy step while the old container serves; additive, so the old code is unaffected.

### 5.2 Why nothing changes at the moment it deploys

- **PR 1 writes the rules and reads them nowhere that decides anything.** The old maps keep deciding until PR 2. Between the two, the backfill fills the rows and a parity check proves the answer equals the old maps for every committee in every organisation (§5.4). PR 2 switches only once parity is 0 differences.
- **This avoids the trap fail-closed would set:** if the code read the rules before the backfill ran, every stage would allow nothing for a moment, and Edit and membership would be refused across every tenant.

### 5.3 Seed

- `workflow.seed.ts`: each COMMITTEE stage gains `actions: string[]` and `flags: string[]` (§4.1); `approved` gains `flags: ['APPLIES_APPROVED_CHANGE']`.
- `applyWorkflowSeed()` (`workflow-seed-apply.ts`) writes them **only when it creates the stage**. A stage it finds by key or name keeps whatever the tenant configured, as names do today (`:80-86`).
- New organisations get the rules from bootstrap; existing ones from the backfill.

### 5.4 Backfill `npm run backfill:acc255-stage-rules` (after PR 1 deploys)

- **What it writes, per non-platform organisation:**
  - for each COMMITTEE template's stage with a seed key, the §4.1 actions and flags;
  - for each stage with no key, the member actions only;
  - for each COMMITTEE_CHANGE_REQUEST template's `approved` stage, the APPLIES_APPROVED_CHANGE flag.
- **It writes only what is missing.** A stage that already has any action row or any flag is left as it is and reported, so a re-run, or a tenant who configured a stage first, changes nothing.
- **Order: dry run, `-- --execute`, dry run again.** The second dry run must report 0 stages to write.
- **The script's conventions** follow `backfill-acc239-change-request-workflow.ts`:
  - `BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 }`, one transaction per organisation;
  - it re-plans inside the transaction and throws "database changed since the dry run" if the plan moved;
  - it refuses customer organisations (fixtures only, ACC-101), with exit code 1;
  - it writes one `AuditLog` row per organisation (`objectType: 'WorkflowTemplate'`, `actorId: null`, `metadata { source, ticket: 'ACC-255', reason, stagesWritten }`).
- **The parity check** (`npm run check:acc255-stage-parity`, read-only):
  - For every organisation, every committee and every open change request, it compares the new answer with the old maps:
    - Edit offered;
    - each member action;
    - raise;
    - the six request moves;
    - dissolving.
  - It prints differences by organisation slug and committee id. It exits 1 on any difference.
  - It runs inside `BEGIN TRANSACTION READ ONLY`.
  - It is deleted in PR 2's follow-up once the old maps are gone.

---

## 6. The API

### 6.1 For the setup screens (`workflows:view` / `workflows:manage`)

`GET /workflow-templates/:id` (`workflow-template.service.ts:65-97`) adds:

```ts
recordActions: { key: string; labelKey: string }[];                 // RECORD_ACTIONS[objectType] ?? []
stageFlags:    { key: string; labelKey: string; cardinality: 'any' | 'exactlyOne' }[];
recordFields:  { key: string; labelKey: string; kind: string }[];   // step 2 reads it
stages[].actions: string[];   // the allowed action keys, registry order
stages[].flags:   string[];
```

- `PATCH /workflow-templates/stages/:stageId` accepts `actions?: string[]` and `flags?: string[]` (added to `UpdateWorkflowStageDto`). `POST :id/stages` accepts the same.
  - **`actions` replaces the stage's set:** the service diffs it against the rows, inserts and deletes inside one transaction, and audits the difference (§8).
  - **Unknown keys are refused** (§7).
  - **On a protected template** `actions` and `flags` are not in `PROTECTED_STAGE_EDITABLE` (`:39`), so a changed value is `WORKFLOW_TEMPLATE_PROTECTED` with `edit: 'STAGE_FIELD'`. Re-sending the stored value unchanged passes (`:298`), as for every other field.
- **Nothing else is a new route.** The registries ride on the template read, as `recordRoutes` does, so there is one place to read them and no frontend copy (rule 1).

### 6.2 For the record screens

`GET /committees/:id` (`committees.service.ts:100-101`) and the list items (:71-72) add:

```ts
stageRules: {
  actions: { edit_details: boolean; add_member: boolean; remove_member: boolean;
             change_member_role: boolean; request_change: boolean };
  flags: string[];
}
```

- **The same `StageRulesService` answer** the writes assert (rule 6). It contains the stage's answer only; the screen combines it with the person's permission, as `committeeHeaderOffers(stageKey, canEdit)` does today (`committee-stage.ts:58-64`).
- `isDissolving` stays (derived from the flag), so `committee-references.ts:81` and the list's status filter keep working unchanged.
- `currentStageKey` stays in the response until PR 3 removes its last screen use, then goes in a later contract step (D9).
- **The locked line** ("Terms Review: read-only") becomes: Edit not allowed AND not IN_FORCE AND not DISSOLVING, for holders of `committees:edit_details`. For the seeded stages that is exactly Terms Review; a tenant-added stage before approval also shows it, which is the right sentence there (D11).

---

## 7. Refusals and their codes

| Code | Status | When | Body | Said by |
|---|---|---|---|---|
| `STAGE_ACTION_NOT_ALLOWED` | 409 | `assertStageAllows` refuses: edit details, a member action (Q-A), or raising a request where the stage forbids it | `{ action, stageNameEn, stageNameAr }` | the committee page and dialogs, from the code: "This can't be done while the committee is in {stage}." (en / ar) |
| `STAGE_ACTION_UNKNOWN` | 400 | a stage save sends an action key not in `RECORD_ACTIONS[objectType]`, or any action for a type with no entry | `{ actionKey, objectType }` | the stage form (a programming error in practice) |
| `STAGE_FLAG_UNKNOWN` | 400 | a flag not in `STAGE_FLAGS[objectType]` | `{ flag, objectType }` | the stage form |
| `STAGE_FLAG_EXACTLY_ONE` | 409 | a save, add or remove would leave an exactly-one flag on 0 or 2+ stages of the template | `{ flag, stageNames }` | the stage form and the stages list, naming the flag and the stages |

- **`CHANGE_REQUEST_STAGE_NOT_ALLOWED` and `CHANGE_REQUEST_COMMITTEE_DISSOLVING` stay** for the request paths (§4.2), so ACC-240's screens need no change.
- **`STAGE_ACTION_NOT_ALLOWED` replaces step-238 §7's proposed `COMMITTEE_EDIT_LOCKED`**, which was never built: one code for every module (D12).
- **Where the cardinality check runs:** in `updateStage` (flags changed), `addStage` (a new stage with the flag), and `removeStage` (removing the flagged stage). All three run inside the template's transaction after the write, like ACC-120's invariant: write, re-count, refuse and roll back. The check reads every stage of the template.
- **The workflow `WorkflowRefusalCode` union** (`workflow-refusal.ts:14-33`) gains the four codes, and the frontend mirror (`frontend/…/workflow/workflow-refusal.ts`) maps each to a key in both languages.

---

## 8. Audit rows

- **`updateStage` audits every changed field**, before and after: the `before` is the stage's stored values for the fields that changed, and the `after` their new values. `actions` are listed as key arrays, `flags` likewise. A save that changes nothing writes no row.
- **`addStage`** audits the whole new stage: `after` = every DTO field plus `actions` and `flags`.
- **`removeStage`** audits the whole removed stage: `before` = every field plus `actions` and `flags`, since the cascade deletes the action rows.
- **The diff helper** (`stageAuditDiff(before, after)`) lives in the template service and is unit-tested on its own, including that a re-sent unchanged field is not listed.
- **The backfill** writes one row per organisation (§5.4). ACC-101's rule is that a backfill touching tenant data writes to that tenant's trail.
- **Record writes refused by the stage** are not audited (a refusal is not a mutation). The refusal is logged with ids, as ACC-101 records concealed refusals.

---

## 9. Tests

**Backend, unit:**
- `record-registry.spec.ts`:
  - every registry entry has en/ar labels in the frontend files (read from disk);
  - keys are unique per type;
  - `exactlyOne` flags exist only where the seed sets exactly one stage.
- `stage-rules.service.spec.ts`:
  - the answer for each seeded stage (§4.1);
  - a stage with no rows allows nothing;
  - no instance / no current stage allows nothing and logs;
  - the newest instance wins;
  - every query is scoped by organisation;
  - a tenant-isolation test named for CI's gate ("should NOT return records belonging to a different tenant").
- `change-request-policy.spec.ts`:
  - the §4.2 derivation equals the old `COMMITTEE_STAGE_POLICY` for all six stages and the unkeyed case. The old map is kept in the spec as the reference until the parity script is deleted.
- `workflow-template.service.spec.ts`:
  - `actions` / `flags` read and written;
  - unknown keys refused;
  - the cardinality check on update, add and remove;
  - the protected template refusing a changed `actions` / `flags` and passing an unchanged one;
  - the audit diff (only changed fields, actions and flags included, no row for a no-op);
  - a tenant-isolation test for the new table.
- `committees.service.spec.ts`:
  - `updateCommittee` refused outside an `edit_details` stage, with the code and stage names;
  - each member action asks its own key;
  - the permission is still checked first (a person without the key gets the old 403, not the stage refusal).
- `backfill-acc255.spec.ts`:
  - the plan for a seeded tenant, a tenant with an added stage, and one already configured;
  - the customer refusal;
  - a second run plans 0.
- **A key-name scan spec:** no non-spec source outside the seed, the backfills and `workflow-stage-keys.ts` names a committee stage key. It is the same shape as `retired-task-keys.spec.ts` (ACC-244) and fails on a new match.

**Backend, real database (`test:db`):**
- `stage-rules.db-spec.ts`:
  - the migration's constraint (`stageId, actionKey` unique) and the cascade on a stage delete;
  - `FOR SHARE` ordering: an edit and Submit for Approval pressed together ten times both finish (step-238 §7);
  - the cardinality check under two concurrent saves of the change-request template's flags;
  - the backfill end to end: dry run, execute, dry run = 0.

**Frontend (PR 3):**
- `committee-stage.ts` replaced by reads of `stageRules`. Its specs (`committee-detail.header.spec.ts`) re-written over the server's answer, including a tenant-added stage.
- The members panel hides Add / Change role / Remove when the stage forbids them.
- The four new refusal codes said in en / ar.
- ACC-254's layout spec at 1280 / 1440 / 1920 in both languages, no sideways scroll (§10.1).
- The icon-label scan at baseline 0, plus its selftest (§10.2).
- The QM route (§10.3), the refusal translations (§10.4) and the committee choices endpoint use (§10.5).

**Spec files that read the old keys or maps today** (each updated or left as the reference, by the PR that switches it):
- Backend: `change-request-policy.spec.ts`, `workflow.service.spec.ts`, `committee-change-request.db-spec.ts`, `committees.service.spec.ts`, `workflow-template.service.spec.ts`, `backfill-acc233.spec.ts`, `committee-lists.service.spec.ts`, `committee-reference-checks.spec.ts`, `committee-reference-checks.db-spec.ts`, `setup-condition.detectors.spec.ts`, `org-structure.service.spec.ts`.
- Frontend: `committee-detail.header.spec.ts`, `committee-list.component.spec.ts`, `committee-references.spec.ts`, `committee-form.component.spec.ts`, `workflow-transition-actions.component.spec.ts`, `committee-form.choices.spec.ts`, `committee-form.layout.spec.ts`, `bilingual-name.screens.spec.ts`.

---

## 10. Folded in, each with its fix

### 10.1 ACC-254 — the stages page scrolls sideways; raw codes shown

**Cause, measured from the code:**
- The row's actions cell (`workflow-stage-list.component.ts:173`, `shrink-0`) holds up, down, a labelled Edit and delete — about 150-160 px — in `app-data-list`'s default **88 px** actions track (`data-list.component.ts:518`). It spills past the grid into the list's `overflow-y-auto` scroller (`:288`), which then scrolls sideways.
- Second, the first track is `width: 'auto'` (`workflow-stage-list.component.ts:336`). `data-list`'s own rule forbids that (`:498-516`; ACC-234), so header and rows misalign.

**Fix:**
- Edit becomes the row's next step and the rest go into a worded ⋯ menu (`am-row-menu`, ACC-229's shape).
- The actions track becomes a fixed width measured for the longest label in both languages, passed as `gridSuffix`.
- The expand track becomes a fixed 32 px.
- **The transition table in the expanded row** (`workflow-transition-editor.component.ts:137`, 6 columns, `nowrap` chips at `:612`) gets column widths and ellipsis-with-tooltip cells, so a 420 px panel column cannot spill.
- **A layout spec** measures `/workflows/:id/stages` at 1280, 1440 and 1920 in both languages: no sideways scroll, header and rows aligned. Mutation-checked with an `auto` track and an 88 px suffix.

**Raw codes:**
- `{{ stage.approvalMode }}` (`workflow-stage-list.component.ts:149`)
- `{{ stage.assigneeStrategy }}` (`:154`)
- `transition.triggerCondition` tags (`workflow-transition-editor.component.ts:161`)
- the `TRIGGER_CONDITIONS` options (`:73-79`, bound with `optionLabel="label"`)
- the stage form's `APPROVAL_MODES`, `PARALLEL_THRESHOLDS`, `ASSIGNEE_STRATEGIES` (`workflow-stage-form.component.ts:52-88`)
- `template.objectType` (`workflow-template-list.component.ts:51`)
- `action.actionType` (`workflow-action-configurator.component.ts:102`, which already has `actionTypeName()` at :132)

**Fix for the raw codes:**
- One helper per enum maps the value to a key, following `taskStatusTitle()`: `workflow.approvalMode*`, `workflow.threshold*`, `workflow.assignee*` and `workflow.trigger*` already exist (`en.json:569-655`) and are used by nothing today.
- Missing keys are added in en / ar: the POSITION_FIXED value, `triggerAssigneePool`, and the `objectType` values (DOCUMENT_REQUEST … COMMITTEE_CHANGE_REQUEST).
- A frontend scan fails a template that interpolates one of the five workflow enum fields directly.

### 10.2 Unnamed icon buttons, and why `check:icon-labels` passed

**The scan did see them.** `check-icon-labels.mjs` is a RATCHET (`:14-18`): `BASELINE = 14` (`:42`), and it fails only above 14 (`:102`). Both buttons, Set default (`workflow-template-list.component.ts:70`) and Deactivate (`:84`), are inside the 14. CLAUDE.md (ACC-120) names this exactly: "a scan whose first act is to allowlist every existing instance is a disabled scan with extra steps."

**Fix:**
- Name all 14 controls (`ariaLabel`, translated), and set the baseline to **0**, so the scan is a gate. The 14:
  - workflow-template-list :70, :84;
  - stage-list :112, :175, :183, :198;
  - transition-editor :172, :183, :190;
  - action-configurator :119;
  - notification-bell :22;
  - ai-feature-cost-list :57;
  - plan-list :53;
  - data-list :170.
- Fix the matcher's `[^>]*` (`:73`), which stops at the first `>` inside an attribute (an `=>` or `a > b`) and would hide a later `ariaLabel`. It is replaced with an attribute-aware match.
- Add a selftest, like `check:action-gating:selftest`: clean before, fails on an unnamed `<p-button icon>` naming the file, clean after.

### 10.3 The Quality Manager is redirected from `/workflows`

**Cause:**
- The Workflows item sits in the Administration group (`nav-items.ts:213-217`), whose gate is `admin:access` (`:171`). `ROUTE_PERMISSIONS` therefore needs both keys (`:434-450`).
- The route's `permissionGuard` (`app.routes.ts:83-89`) sends anyone without both to the landing page (`permission.guard.ts:70-73`).
- QUALITY_MANAGER holds `workflows:view` (`role.seed.ts:102`) but not `admin:access`, by ACC-123's decision (`:34-37`). The API serves the reads on `workflows:view` alone (`workflow-template.controller.ts:56-57`, `:230-231`).

**Pick (Q-D):** let `workflows:view` alone open the workflows pages, read-only.
- The route's permission becomes `workflows:view` only.
- Every write control there is already gated on `workflows:manage`, and `check:action-gating` checks it.
- The rail shows "Workflows" outside Administration, under Quality management, for holders of `workflows:view` without `admin:access`.
- Administration stays for tenant admins (ACC-123 unchanged).
- **Why:** after this ticket a stage decides what can be done to a committee, so the people who run committees need to read those rules.

### 10.4 The other workflow screens show the server's English refusal

**Cause:** these screens call `extractErrorMessage`, which returns the server's English `message`, before any code mapping:
- the template list, set default and deactivate (`workflow-template-list.component.ts:144`, `:166`);
- the stages list, remove (`workflow-stage-list.component.ts:430`) and reorder (`:463`, `:469`);
- the transition editor (`workflow-transition-editor.component.ts:1062`, `:1113`, `:1133`);
- the action configurator (`workflow-action-configurator.component.ts:286`, `:312`, `:356`).

For `WORKFLOW_TEMPLATE_PROTECTED` that is the edit-specific English sentence (`workflow-refusal.ts:98-112`), shown in Arabic sessions too.

**Fix:**
- Every one of them calls `plainWorkflowRefusalKey(err)` first (as `workflow-stage-form.component.ts:608` does).
- `WORKFLOW_TEMPLATE_PROTECTED` maps by its `edit` detail to nine keys (`workflow.refusal.protected.<EDIT>`, en / ar) instead of the one generic key (`en.json:773`).
- `ACTION_TYPE_RETIRED` and `VALIDATOR_RETIRED` get keys.
- The English fallbacks ('Set default failed', 'Remove failed', 'Invalid JSON in validator config' at `:1015`, `:1077`) become keys.
- A spec per screen sends the protected refusal and expects the translated sentence in both languages.

### 10.5 Committee editors without `lookups:view` or `org:view` get an empty list

**Cause:**
- The Edit dialog reads `GET /lookups/categories/committee_type/values` (`lookups:view`, `lookup.controller.ts:81-82`) and `GET /organization/units/flat` (`org:view`, `organization.controller.ts:46-47`).
- A person who may create or edit committees without those keys gets a 403, and since ACC-240 PR 3a the field says "Couldn't load the list." with Retry. The Retry can never succeed.
- **No seeded role is affected:** QUALITY_MANAGER holds both (`role.seed.ts:99`, `:101`), and the fixtures' custom roles hold neither write key. It is a tenant-made-role gap.

**Fix:**
- `GET /committees/form-choices`, `@Permissions(COMMITTEES_PERMISSIONS.CREATE, COMMITTEES_PERMISSIONS.EDIT_DETAILS)`. The guard admits either (`permission.guard.ts:37`, `.some`).
- It returns the committee types the organisation offers and the active unit tree — the same values the two lists serve, scoped by organisation.
- The Edit dialog and ACC-240's Request a change both read it.
- It carries no person data. Its tenant-isolation spec is named for the gate.

---

## 11. The PR split

ACC-240's PR 3a and 3b merge first. 3a's `canRaise` (`openSummary()`) reads `committeeAllowsRaise`, which PR 2 here moves onto the `request_change` action. Building on top of 3a avoids a second change to the same lines.

| PR | Contents | Migration | Behaviour change |
|---|---|---|---|
| **1 — backend, expand** | registries; migration; seed actions and flags; backfill and its spec; `StageRulesService`; template API read and write of `actions` / `flags` with the four refusals and cardinality; stage-config audit diff; `stageRules` on the committee read; the parity check; `GET /committees/form-choices` | `acc255_workflow_stage_rules` | **none** — the rules are written and served, but nothing decides by them |
| *after PR 1 deploys* | `backfill:acc255-stage-rules` dry run → `-- --execute` → dry run (0); `check:acc255-stage-parity` = 0 differences | — | none |
| **2 — backend, switch** | reference checks, counts, change-request policy and the approve target read the answer (§4.2-4.4); ACC-241 lock on `updateCommittee` and the member actions (§4.5); `isDissolvingStageKey` and `COMMITTEE_STAGE_POLICY` deleted; the key-name scan spec | none | **API only:** a direct edit outside Formation is refused (ACC-241, intended). Screens never offered it. |
| **3 — frontend** | committee page and members panel read `stageRules` (`COMMITTEE_HEADER_POLICY` deleted); new refusal codes said; ACC-254; icon labels and the scan at 0; QM route; protected-refusal translations; Edit dialog and Request a change read `form-choices` | none | members panel hides actions a stage forbids (none today); otherwise nothing |
| **4 — frontend, after the drawing** | stage form: "What can be done to the record here" and flags | none | the new section |

- PRs 1 and 2 are backend and deploy through Railway; PR 3 can merge while Railway is paused, once PR 2 is live (it reads `stageRules`).
- Each PR carries its own tests. PR 1's real-database spec includes the backfill.

---

## 12. The stage form: what the drawing must show (PR 4)

The stage form is `workflow-stage-form.component.ts`. It holds 13 controls in `app-edit-dialog`, not yet in `am-field`, and has no layout spec, so it has not been measured against the 420 px cap. The drawing needs:

1. **A section "What can be done to the record here"**:
   - one checkbox per `recordActions` entry, in registry order, with its label;
   - the sentence "A stage can only narrow what a role allows. It never grants anything." under the heading;
   - for a record type with no actions, the section is absent.
2. **A section "What this stage means"** (flags): one checkbox per `stageFlags` entry, each with a one-line explanation:
   - Dissolving: "Committees here can't be a parent or be reported to."
   - Record is in force: "Change requests can be submitted and decided."
   - Applies the approved change: "Reaching this stage applies the request."
   An `exactlyOne` flag says "Exactly one stage has this."
3. **The exactly-one refusal**, under the flag: "Exactly one stage must apply the approved change. {Stage} already does." With nothing ticked: "Exactly one stage must apply the approved change."
4. **The protected template's read-only state:** both sections shown, disabled, with the existing protected sentence.
5. **The stages list:** small flag chips beside the stage name, and, per stage, a count or the names of the record actions it allows. Fixed tracks only (ACC-234).
6. **Fit:** the form is over the cap once these are added, so the drawing should step or tab it. Measure first, per ACC-120: identity and deadline; who and how it is approved; what it allows and means.
7. **The committee page:** the refusal sentence for `STAGE_ACTION_NOT_ALLOWED`, and the members panel without the actions a stage forbids.

---

## 13. Read-only counts

**None were taken.** On 22 Oct the shared database refused the password in
`backend/.env` (`password authentication failed`, for both the pooler URL and
the direct one, on a bare `SELECT 1`). The local backend on 3001 had stopped
for the same reason.

These are the counts to take once the credential is fixed. Each runs in one
`BEGIN TRANSACTION READ ONLY`; the script is in the session scratchpad
(`acc255-counts.js`), outside the repository:

1. organisations, by slug, with `isPlatformOrg`;
2. COMMITTEE and COMMITTEE_CHANGE_REQUEST templates per organisation, with defaults and active;
3. their stages by organisation, template and key, **including stages with no key** (tenant-added — the backfill's member-only case);
4. keyed stages on any other template type (expected 0);
5. all stages, and how many carry a key;
6. committees by current stage key and instance status, per organisation;
7. committees with no workflow instance (fail-closed cases: they would allow nothing);
8. change requests by stage key;
9. existing `AuditLog` rows for `WorkflowStage`, by action.

Counts 3, 6 and 7 decide whether the backfill's plan and the parity check have
any surprise to report. PR 1 does not merge until they are read.

---

## 14. Decisions and open questions, each with my pick

| # | Question | Pick |
|---|---|---|
| D1 | Registries in one file or three? | One file, `record-registry.ts`; they are read together and are small. |
| D2 | A row with `allowed: boolean`, or presence = allowed? | Presence = allowed. Absence is the fail-closed answer, with no third state. |
| D3 | A new action added to a registry later: allowed or forbidden on existing stages? | Forbidden (fail closed). It ships with a seed default and a backfill, like this one. |
| D4 | The seed reproduces today exactly, including membership in every stage? | Yes (rule 3, "nothing changes"). Q-A asks whether Dissolved should stop it. |
| D5 | Flags as a `String[]` column or a table? | Column. Few values, read with the stage, validated in code. |
| D6 | When is a flag's cardinality checked? | After the write, inside the template's transaction, on update, add and remove; refused and rolled back. |
| D7 | Move the change request's own stage rules (`REQUEST_STAGE_POLICY`) onto actions? | No. The template is protected and its six stages are fixed. Only the approved stage's meaning moves to a flag (the brief). Step 2 can revisit. |
| D8 | Can a protected template's stages change `actions` / `flags`? | No — not in `PROTECTED_STAGE_EDITABLE`. Unchanged re-sends pass. |
| D9 | Keep `currentStageKey` in the committee response? | Until PR 3 removes its last screen use; then a later contract step. |
| D10 | Does the Formation quorum precondition move to a flag? | No. It is a transition rule; step 2's conditions are its home. It stays keyed and is listed in the key-name scan's allowed files. |
| D11 | How is Terms Review's "locked" line derived without the key? | Edit not allowed AND not IN_FORCE AND not DISSOLVING. Identical for the seeded stages. |
| D12 | One refusal code for every module's stage refusal, or one per module? | One, `STAGE_ACTION_NOT_ALLOWED`, carrying the action and stage names. It replaces step-238's unbuilt `COMMITTEE_EDIT_LOCKED`. |
| D13 | Read rules before or after the backfill? | After. PR 1 writes and serves; PR 2 decides, once parity is 0 (§5.2). |
| D14 | A record with no instance or no current stage? | Allows nothing, has no flags, logs ids. |
| Q-A | Should Dissolved (and Dissolution Pending) stop membership changes? | **Keep today's behaviour in the seed** (allowed). Turning it off is one tick per stage once the screen exists, and a tenant decision. |
| Q-B | IN_FORCE has no reader on `dev` except §4.2. Is that the flag's meaning? | **Yes**: "the committee is approved and governs", which is exactly what `RAISED_HERE` meant. The ticket's "in-force stages in committee-stage-counts" are not in the code (§2.1). |
| Q-C | Where does `RECORD_FIELDS` live, and what reads it now? | **In `record-registry.ts`**, served on the template read; nothing reads it until step 2. |
| Q-D | How does the Quality Manager reach `/workflows`? | **`workflows:view` alone opens the pages read-only, with a rail item outside Administration** (§10.3). The other choice is to remove `workflows:view` from QM, which the pickers need. |
| Q-E | Fix the committee 403 by an endpoint or by granting `lookups:view` / `org:view`? | **The endpoint** (§10.5). Granting reaches into other modules' keys, and a tenant can remove them again. |
| Q-F | The committees list shows Formation and Terms Review committees as "Active" (`committee-list.component.ts:35-37`). Should it read IN_FORCE? | **Not in this ticket** (nothing should change). `isInForce` is served from PR 1; the list status is a separate, visible decision. |
| Q-G | `check:icon-labels`: fix the 14 now, or keep the ratchet? | **Fix all 14 and gate at 0** (ACC-120's rule). |

---

## 15. Not in this ticket

- **Step 2:** selection rules, conditional and automatic transitions, versions, the New workflow screen, and anything that reads `RECORD_FIELDS`.
- **The stage form section**, until the drawing exists (PR 4 waits for it).
- **Moving the change request's own moves onto actions** (D7).
- **The committees list's status wording** (Q-F).
