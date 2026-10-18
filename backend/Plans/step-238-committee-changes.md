# Step 238 — Committee changes: edit in Formation, and a change request after approval

**Tickets:**
- ACC-238: PR 1, Formation edit.
- ACC-239: PR 2, the change request backend.
- ACC-240: PR 3, the change request screens.
- ACC-241: the API lock on direct edits, a small ticket required before the first customer.

**Lane:** B.

**Drawing:** `frontend/design-reference/AccreditMe Committee Changes.dc.html`, committed with this plan.

**Rules:** Ahmad's, accepted on 15 Oct. They are restated in §2 and are not reopened here.

**Status:** PLAN ONLY. Nothing is built until Ahmad answers §10.

---

## 1. The split

| PR | Ticket | What | Migration |
|---|---|---|---|
| 1 | ACC-238 | Three-tab Edit dialog; header actions by stage key; Terms Review locked line; stale-save 409; parent prefills Reports to; quorum ≥ 1 before Submit for Approval; the two permission sentences; self-parent wording | **None** |
| 2 | ACC-239 | `CommitteeChangeRequest` + its workflow type and seeded workflow; endpoints and rules; apply on approval in one transaction; quorum snapshot | **One, additive** |
| 3 | ACC-240 | Request a change page; request page; open-request banner; Change requests panel; Approve / Return / Reject / Withdraw dialogs; Home | None |
| — | ACC-241 | `PATCH /committees/:id` refuses outside Formation (409 `COMMITTEE_EDIT_LOCKED`) | None |

**Order:**
- PR 1 → PR 2 → PR 3, and each is blocked by the one before.
- ACC-241 is blocked by ACC-239, so that an Active committee always has a way to change.
- ACC-241 merges before the first customer, and no later.

## 2. The rules, as they bind the code

1. **Stage keys only.** A stage is recognised by `WorkflowStage.key` (ACC-233), never by its name.
   - The committee keys are `formation`, `terms_review`, `active`, `suspended`, `dissolution_pending` and `dissolved`.
   - A stage with no key is treated as "nothing new offered" on screen, and refused at the API (it fails closed).
2. **Formation:** every committee field can be edited directly with `committees:edit_details`, in the three-tab dialog.
3. **Terms Review:** read-only.
   - **Revise Terms EXISTS in the seed** (`workflow.seed.ts`, terms_review → formation, kind RETURN, `committees:manage`, ROLE_BASED), so nothing has to be seeded for it.
   - The locked line shows to holders of `committees:edit_details` only.
4. **Active and Suspended:** no direct edit. Every field change goes through a change request, even an Arabic-name typo. The committee stays Active and keeps meeting while a request is open.
5. **Request lifecycle:** Draft → Under review → Approved (applied) or Rejected.
   - Return sends it back to Draft with a note.
   - Withdrawn ends it.
6. **Dissolution Pending and Dissolved:** no edit and no new request. An open request can only be rejected or withdrawn.
7. **Members:** outside all of this; membership events work as today.
8. **One open request per committee:**
   - A draft counts as open.
   - Drafts never expire.
   - A holder of `committees:approve` can withdraw a stale draft.
9. **Permissions:**
   - Request, edit a draft and submit: `committees:edit_details`. Only the requester edits or submits their own draft (see Q3).
   - Withdraw: the requester, at any open stage; or a holder of `committees:approve`, while it is a draft.
   - Approve, Return (note required) and Reject (reason required): `committees:approve`.
   - Nobody decides their own request.
   - The approver cannot change the proposed values; they return the request instead.
10. **On approval:**
    - All values are applied in ONE transaction and audited.
    - A task "Revise the terms of reference" is created on the committee for the requester.
11. **Quorum:**
    - An approval already in progress keeps the quorum it started with; only approvals that start after the change use the new one.
    - Quorum must be at least 1 before Submit for Approval.
12. **Parent, Reports to and owning unit:**
    - These follow ACC-233.
    - Choosing a parent prefills Reports to.
    - The owning-unit picker shows active units only.
13. **Stale save:** the Formation edit's second save is a 409, "… was changed by someone else since you opened it. Nothing was saved.", with Reload. This is the role matrix's shape.
14. **Header transition buttons:** these stay as the live workflow renders them.
    - The drawing's labels outside Terms Review are examples only.
    - **There is no "Cancel Dissolution" transition in the seed**, and none is added.

## 3. What exists today (measured, 18 Oct, `21a4f68`)

**Backend**
- `PATCH /committees/:id`, with `@Permissions(committees:edit_details)`, calls `CommitteesService.updateCommittee()` (`committees.service.ts:136–206`).
  - It runs in one transaction. The hierarchy advisory lock is taken only when parent or reports-to is sent (l.145–148).
  - It re-reads the row (l.150–151), and `assertCommitteeReferences` checks changed values only (l.161).
  - It writes the row; the audit is after commit.
  - **There is no stage check, no concurrency check and no row lock.** `Committee.updatedAt` exists; there is no version column.
- `COMMITTEE_REFUSALS` (`committee-reference-checks.ts:19–30`): `COMMITTEE_OWN_PARENT` reads "A committee can't be its own parent.", but the dialog says "… its own parent **committee**." `COMMITTEE_PARENT_DISSOLVING` has the same mismatch ("can't be a parent." against "can't be a parent committee.").
- **COMMITTEE seed** (`workflow.seed.ts:251–274`):
  - Six keyed stages, all SINGLE / ROLE / QUALITY_MANAGER.
  - Eight ROLE_BASED transitions. Submit for Approval and Revise Terms need `committees:manage`; Approve Committee and Confirm Dissolution need `committees:approve`.
  - **No seeded stage anywhere uses approval mode COMMITTEE.**
- **Quorum is read live:** `isApprovalThresholdMet()` (`workflow.service.ts:805–815`) reads `committee.quorumCount` from the stage's `committeeId` on every vote. COMMITTEE mode is set on a *record's* stage (for example, a document approved by a committee), not on the committee's own workflow.
- **Engine:**
  - `performTransition()` (l.829) does every read first, then one `$transaction` under `lockWorkflowInstance` (l.869–918): the gate, exit and cancel, the new `WorkflowInstanceStage` (l.895), entry tasks, and the instance update. Audit, notices and actions run after commit.
  - `triggerTransition()` refuses `SYSTEM_AUTOMATIC` (l.468).
  - There is no hook for a caller's write inside the stage-change transaction.
- `WorkflowObjectType.CHANGE_REQUEST` exists and is the **document** change request (5 stages). It is not reusable here: its stages, permissions and future Document module are different.
- Tasks: `TaskSourceType.COMMITTEE` exists. `TaskService.create()` is not transaction-aware. The engine creates tasks in a transaction through `prepareEntryTask` / `insertPrepared` / `announceCreated`.
- Home has **no** "awaiting my action" endpoint. `GET /tasks/requests/awaiting-decision` is task requests only.

**Frontend**
- **The committee page** is `committee-detail.component.ts`, one component.
  - Header: stage pill, Inactive tag, `app-workflow-transition-actions`, then Edit (behind `canEdit()` = `committees:edit_details`, **in every stage**).
  - Panel grid: Members, Tasks, Sub-committees, Meetings, Documents, Membership history.
  - **It reads no stage key.** `CommitteeDto` has none; only `CommitteeListItemDto` carries `currentStageKey` and `isDissolving`.
- **The committee form** is `committee-form.component.ts`.
  - It is one step, eight fields, raw labels (no `am-field`), with the buttons in the body.
  - It is opened with the default 560 size and no `dirty`, `saving` or `footer`.
  - Parent and Reports to are independent; there is no prefill.
  - The owning unit uses `buildOrgUnitCascadeOptions()`, which keeps active units only (already true).
  - ACC-233's `referenceOptions()` already leaves out self, dissolving committees and loops.
  - **No tab pattern exists anywhere in the app.** The nearest is `am-step-strip`, rendered in the dialog header via `headerExtra`.
- **Stale save:**
  - Frontend: `permission-save-confirm.component.ts` with `roles.matrix.conflict` / `roles.matrix.reloadRole`.
  - Backend: `RolePermissionsChangedException` (409 `ROLE_PERMISSIONS_CHANGED`, compared under the role row lock).
- **Permission sentences** are in `roles.matrix.sentence[...]` in en/ar.json:
  - `committees:edit_details`: "Edit name, purpose, quorum, frequency".
  - `committees:approve`: "Approve terms and confirm a dissolution".
  - `check:permission-sentences` requires both languages to be present.
- **Reusable pieces:**
  - `am-capped-panel` (5 rows, 294 / 328), `am-list-dialog` (`compact` 720×560), `am-simple-list`, `am-sort-header`.
  - `app-workflow-stage-indicator` (`sequence` / `history`).
  - `EditDialogComponent` (`confirm` 420 / `form` 560).
  - `BreadcrumbParentService`.

## 4. PR 1 — Formation edit (ACC-238)

### 4.1 Backend

1. **Stage on the read.**
   - `GET /committees/:id` adds `currentStageKey: string | null` and `isDissolving: boolean`, the same fields and the same derivation as the list row.
   - This is additive and has no migration.
2. **Stale save.**
   - `UpdateCommitteeDto.expectedUpdatedAt?: string` (ISO).
   - Inside the existing transaction, the committee row is locked first: `SELECT … FOR UPDATE`, scoped by `id` AND `organizationId`, after the hierarchy lock so the lock order is hierarchy then row.
   - When `expectedUpdatedAt` is sent and differs from the row's `updatedAt` (exact milliseconds), the save throws `CommitteeChangedException`: 409, code `COMMITTEE_CHANGED`, "This committee was changed by someone else since it was opened. Nothing was saved."
   - Omitting the field keeps today's behaviour, so scripts and the create path are untouched.
   - Why `updatedAt` and not a version column: no migration, and `@updatedAt` moves on every write to the row. Q7 asks whether that is enough.
3. **Quorum ≥ 1 before Submit for Approval.**
   - The check is a per-record-type transition precondition in `WorkflowService.triggerTransition()`: a small registry `TRANSITION_PRECONDITIONS` beside `RECORD_ROUTES`, which fails open for types with no entry.
   - Its COMMITTEE entry: leaving stage key `formation` by an ADVANCE refuses with 409 `COMMITTEE_QUORUM_NOT_SET` while `quorumCount < 1`.
   - It is read inside the stage-change transaction, so an edit cannot slip past it.
   - Q5 asks whether the registry belongs in the engine or as a committee-side check.
4. **Refusal wording.** `COMMITTEE_OWN_PARENT` becomes "A committee can't be its own parent committee." and `COMMITTEE_PARENT_DISSOLVING` becomes "A committee that is being dissolved, or has been, can't be a parent committee."
   - These are the dialog's own words, minus its "Choose another." suffixes.
   - The specs that assert on the messages are updated with them.

### 4.2 Frontend

1. **Three-tab Edit dialog.**
   - `committee-form` becomes three panels: **Identity** (names EN/AR, type, purpose), **Governance** (quorum, meeting frequency) and **Structure** (owning unit, parent, Reports to).
   - There is one form and one Save. The fields move into `am-field` with `[control]`. Cancel and Save move into the dialog `footer`, with "Saved together · all three tabs" on the footer's left.
   - The dialog gains `dirty` and `saving`.
   - **New shared `am-tab-strip`** (`shared/components/tab-strip/`): `role="tablist"`, a `role="tab"` / `aria-selected` / `aria-controls` button per tab, arrow keys, Home and End, roving tabindex, and RTL arrows mirrored. Each tab can show "⚠ n".
     - It is rendered through the dialog's `headerExtra`, as `am-step-strip` is, so it does not count against the 420 cap.
     - Below two tabs it renders nothing. It is the first tab pattern in the app, kept small.
   - **Errors:** Save on an invalid form moves to the first tab with an error and focuses its first invalid field. Each tab shows its own error count.
   - **The create path** (New committee, `committee-list`) uses the same three tabs (Q8).
2. **How it fits the cap.** Body heights, as drawn and to be measured:

   | Tab | EN | AR | Room under 420 |
   |---|---|---|---|
   | Identity | 349 | 374 | 71 / **46** |
   | Governance | 127 | 136 | 293 / 284 |
   | Structure | 309 | 328 | 111 / 92 |

   - Every tab keeps at least 20px of room in both languages; the tightest is Identity in Arabic, at 46px. The body never scrolls and the cap is not raised.
   - The body holds the tallest tab's height (Identity), so the footer does not jump between tabs (Q9).
   - **Pinned by a new `committee-form.layout.spec.ts`**, written in the shape of `stage-task-definition-form.layout.spec.ts`: the real preset, both languages, each tab's `.am-dialog__body` `scrollHeight` ≤ 420 − 20.
   - It has a non-vacuity guard first: each of the three tabs measures a distinct, non-zero height.
   - Compact density is applied, because with `am-field` the dialog has more than 5 fields (`check:dialog-density`).
3. **Stale-save state.**
   - A 409 `COMMITTEE_CHANGED` replaces the footer's message area with "<name> was changed by someone else since you opened it. Nothing was saved." and swaps Save for **Reload**. Reload re-fetches the committee and resets the form, keeping the tab.
   - The body does not grow (drawn: 349 unchanged).
   - New keys: `committee.edit.conflict`, `committee.edit.reload`, in EN and AR.
4. **Parent prefills Reports to.** Through `valueChanges` on the parent: Reports to follows only while it is empty or still equals the old parent. Otherwise it is left alone. The hint is "Filled in from Parent committee · you can change it".
5. **Lists are absent, not disabled.**
   - The ACC-233 `referenceOptions()` filtering is kept.
   - A quiet line says what is left out.
   - Typeahead on an excluded name shows "Not available: it sits under this committee." The drawing has the matching variants for dissolving committees and for self.
6. **Header actions by stage key** (from `GET /committees/:id`'s `currentStageKey`):

   | Key | New in the header |
   |---|---|
   | `formation` | **Edit**, after the transition buttons |
   | `terms_review` | No Edit. A 🔒 locked line under the title row, for `committees:edit_details` holders only: "Locked while the terms are under review. Revise Terms to change it." / «مقفلة أثناء مراجعة الاختصاصات. استخدم «مراجعة الاختصاصات» لتغييرها.» |
   | `active`, `suspended` | Nothing in PR 1. PR 3 adds **Request a change** (secondary, after the transitions, before ⋯) |
   | `dissolution_pending`, `dissolved`, or no key | Nothing |

   - Transition buttons are unchanged: `app-workflow-transition-actions` keeps drawing the live workflow.
   - The quorum refusal is said from its code through `workflow-refusal.ts`: "Set a quorum of at least 1 before submitting this committee for approval."
7. **Permission sentences** (`roles.matrix.sentence`):
   - `committees:edit_details`: EN "Edit a committee in Formation and request changes after approval". AR «تعديل اللجنة في مرحلة التشكيل وطلب تغييرات بعد الاعتماد».
   - `committees:approve`: EN "Approve terms, changes and dissolutions". AR «اعتماد اللائحة والتغييرات وحلّ اللجان».
   - The Arabic is my draft (Q12).
8. **Translations:** the self-parent dialog key `committee.refusal.ownParent` already reads "parent committee"; it is unchanged, and the API now matches it.

### 4.3 Tests (PR 1)

- **Backend:**
  - The stale save: equal passes, different gives 409 with nothing written, omitted passes.
  - The row-lock order.
  - The quorum precondition: 0 refused and nothing moved; 1 passes; another type is unaffected.
  - The new read fields.
  - The identical 404 for another organisation.
  - The renamed refusal messages.
- **Frontend:**
  - The tab strip's keyboard and ARIA.
  - Save moving to the first tab with an error.
  - The prefill (follows, then stops following once edited).
  - The header per stage key, with the locked line shown only with the permission.
  - The 409 and Reload.
  - The layout spec.

## 5. PR 2 — The change request backend (ACC-239)

### 5.1 Data model (ONE additive migration, `acc239_committee_change_request`)

```prisma
enum WorkflowObjectType { … COMMITTEE_CHANGE_REQUEST }   // new value

model CommitteeChangeRequest {
  id             String   @id @default(cuid())
  organizationId String
  committeeId    String
  number         Int                 // per committee: "Change request 3"
  requestedById  String
  reason         String              // "Why is this change needed?" — required
  changes        Json                // only the fields that change: { quorumCount: 6, reportingToCommitteeId: "…" }
  baseline       Json                // those fields' values when the draft was last saved
  returnNote     String?             // the latest Return's note
  decisionNote   String?             // the Reject reason
  decidedById    String?
  decidedAt      DateTime?
  appliedAt      DateTime?
  appliedFrom    Json?               // the values replaced at apply ("Current" struck through)
  termsTaskId    String?
  withdrawnById  String?
  withdrawnAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  // relations: organization, committee, requestedBy (User), decidedBy?, withdrawnBy?, termsTask?
  @@unique([committeeId, number])
  @@index([organizationId])
  @@index([organizationId, committeeId])
  @@index([organizationId, requestedById])
}

model WorkflowInstanceStage { … quorumCount Int? }      // the snapshot
```

- **There is no status column.** The state is the request's workflow instance's current stage key, which is one fact in one place (ACC-82's rule). "Open" means the key is `draft` or `under_review`.
- **`changes` is JSON, not a column per field.** Nine editable fields would be nine nullable columns, each with a second "was this sent" flag (`nameAr` can legitimately change to null).
  - A key present in the JSON means "changes to this value". It is validated by `CommitteeChangeDto`, which carries the same validators as `UpdateCommitteeDto` (`@Transform(trimToNull)` included), on save, on submit and again on apply.
  - The editable fields are: nameEn, nameAr, typeValueId, purpose, quorumCount, meetingFrequency, orgUnitId, parentCommitteeId, reportingToCommitteeId. Q6 asks about `termsOfReferenceDocumentId`.
- **`number`** is max + 1 per committee, taken under the committee row lock that also guards "one open" (Q4).
- **Why the migration is safe for the running code:** a new table, a nullable column and a new enum value. No running code selects the column, no row can hold the value until the new code seeds it, and the seed and backfill run AFTER the deploy (ACC-173's rule).

### 5.2 The workflow type

- **New `WorkflowObjectType.COMMITTEE_CHANGE_REQUEST`.** `CHANGE_REQUEST` is the document one and is not reused (§3).
- **It is touched in:**
  - `create-workflow-template.dto`'s `WORKFLOW_OBJECT_TYPES`;
  - the `SeedWorkflow` union and `KEYED_SEED_TEMPLATES`;
  - `mapObjectTypeToTaskSourceType()`, which maps it to `COMMITTEE`, because tasks sit on the committee;
  - the `ObjectVisibilityService` rules: `committees:view`, and the parent committee must be visible. Without an entry the visibility check fails closed.
  - It is NOT in `RECORD_ROUTES`: no stage tasks are offered on it (Q10).
- **The seeded template is keyed, and every transition is `SYSTEM_AUTOMATIC`:**

  | Stage key | Order | Flags |
  |---|---|---|
  | `draft` | 10 | initial |
  | `under_review` | 20 | — |
  | `approved` | 30 | final |
  | `rejected` | 40 | final |
  | `withdrawn` | 50 | final |

  | Transition | From → to | Kind |
  |---|---|---|
  | Submit for review | draft → under_review | ADVANCE |
  | Return for changes | under_review → draft | RETURN |
  | Approve and apply | under_review → approved | ADVANCE |
  | Reject | under_review → rejected | EXIT |
  | Withdraw | draft → withdrawn | EXIT |
  | Withdraw | under_review → withdrawn | EXIT |

  - Because they are `SYSTEM_AUTOMATIC`, the generic `POST /workflows/instances/:id/transitions` already refuses them (`workflow.service.ts:468`). Nobody can move a request to Approved without applying it.
  - Transitions are found by their from and to stage keys; transitions have no key of their own.
- **Build check:** `checkAndFlagUnassignedStage()` must not report `under_review` as "no eligible actor" merely because its transitions are system-fired. If it would, the type is excluded there, with a test.
- **Seeding:**
  - New organisations: `seedDefaultWorkflows`, an idempotent upsert.
  - Existing organisations: `npm run backfill:acc239-committee-change-request-workflow`, dry run first, then `--execute`, AFTER the deploy. It follows the ACC-190 / ACC-233 shape: the fixture-tenant guard, one audit row per organisation, and a re-run reports nothing to change.

### 5.3 The engine hook (the one engine change)

- **The change:**
  - `WorkflowService.triggerSystemTransition(instanceId, { fromKey, toKey }, organizationId, actorId, comment?, inTx?: (tx) => Promise<void>)`.
  - It runs `performTransition()` with an optional `inTx` callback, called inside the stage-change `$transaction`, after the "still open" check and the gate, before the instance update.
  - The callback's write and the stage move commit together or not at all.
  - It is the engine's first caller-supplied write, and is restricted: only `SYSTEM_AUTOMATIC` transitions accept it.
- **Why not have the module write first and transition second:** a failure between the two would leave a committee changed with its request still "Under review". This is the ACC-190 lesson (eight separate writes, then one transaction).
- **ACC-64 still holds:** the engine still emits nothing on its own. A person presses Approve, and the module's own service decides what to write; the engine only offers the transaction.

### 5.4 Endpoints

All of these are `@UseGuards(TenantGuard, PermissionGuard)`. Every query is scoped by `organizationId`, and another organisation's id gets the identical 404 that a missing one does.

| Method & path | Permission | Does |
|---|---|---|
| `GET /committees/:id/change-requests` | `committees:view` | Paged list for the panel and See all (`q`, `sort`, `dir`, `take`, `skip`; sorts: number, status, requested) |
| `GET /committees/:id/change-requests/open` | `committees:view` | The banner: `{ id, number, stageKey, fields[], requestedBy, submittedAt, approverHint } | null` |
| `POST /committees/:id/change-requests/preview` | `committees:edit_details` | Impact lines for a proposed set, with no write (§5.6) |
| `POST /committees/:id/change-requests` | `committees:edit_details` | Create a draft; `submit: true` creates and submits in one call |
| `GET /committee-change-requests/:id` | `committees:view` | One request: values, current values, impact, stage history, and `actions` for this viewer |
| `PATCH /committee-change-requests/:id` | `committees:edit_details` | Edit a draft (requester only) |
| `POST /committee-change-requests/:id/submit` | `committees:edit_details` | Draft → Under review (requester only) |
| `POST /committee-change-requests/:id/withdraw` | — (checked in service) | The requester, at any open stage; a `committees:approve` holder, a draft only |
| `POST /committee-change-requests/:id/approve` | `committees:approve` | Apply (§5.5) |
| `POST /committee-change-requests/:id/return` | `committees:approve` | `{ note }`, required, 1–1000 chars |
| `POST /committee-change-requests/:id/reject` | `committees:approve` | `{ reason }`, required, 1–1000 chars |
| `GET /committee-change-requests/awaiting-decision` | `committees:approve` | Under-review requests the caller did not raise, for Home |

- **`actions`** is the server's per-viewer flags (`edit`, `submit`, `withdraw`, `approve`, `return`, `reject`), each restating its endpoint's own refusal. This is ACC-228's `taskActionsFor()` shape.
- **Refusal codes** are 409 unless noted:
  - `CHANGE_REQUEST_STAGE_NOT_ALLOWED`: the committee is not Active or Suspended.
  - `CHANGE_REQUEST_ALREADY_OPEN`: carries the open request's id and number.
  - `CHANGE_REQUEST_NO_CHANGES`: 400.
  - `CHANGE_REQUEST_REASON_REQUIRED`: 400.
  - `CHANGE_REQUEST_OWN_DECISION`.
  - `CHANGE_REQUEST_COMMITTEE_DISSOLVING`: approve and return only.
  - `CHANGE_REQUEST_NOT_OPEN`.
  - `CHANGE_REQUEST_CHANGED`: a stale draft edit, compared on `expectedUpdatedAt`, the same shape as PR 1.
  - Plus every ACC-233 `COMMITTEE_*` reference refusal.
- **Locks:**
  - Create and submit take the committee row lock (`FOR UPDATE`), then check "one open".
  - Every action locks the request row, then follows the engine's lock order: instance, then task.

### 5.5 Approve and apply, in one transaction

**Before the transaction (reads only):**
- Load the request and committee, scoped.
- Check: `committees:approve`, not the requester, stage key `under_review`, the committee's key `active` or `suspended` and not dissolving.
- Prepare the terms task (title "Revise the terms of reference", EN/AR; sourceType COMMITTEE; assignee the requester; creator the approver; priority Medium; due date and limit from the priority SLA, as ACC-174 computes them).

**Inside the stage-change transaction's `inTx`:**
1. Take the hierarchy lock if parent or reports-to changes, then lock the committee row.
2. Run `assertCommitteeReferences()` on the changed values (ACC-233). A refusal rolls everything back, and the approver sees the reason; the request stays Under review.
3. Record `appliedFrom` from the committee's current values. The request's `baseline` is NOT required to match: with one open request and ACC-241's lock there is nothing else that writes, and during development a direct edit should not strand a request (Q11).
4. Write the committee.
5. Insert the terms task, using the engine's `insertPrepared` path; `TaskService.create()` is not transaction-aware.
6. Stamp `appliedAt`, `decidedById`, `decidedAt` and `termsTaskId` on the request.

**After commit:**
- The committee's UPDATE audit row (before and after, with `metadata.changeRequestId`).
- The request's APPROVE audit row.
- The task's announcement.
- The notices (§5.7).

### 5.6 Quorum snapshot, and the impact lines

- **The snapshot:**
  - When an entry is created in a stage whose `approvalMode === 'COMMITTEE'` and which has a `committeeId`, the committee's `quorumCount` is read (scoped) and saved on `WorkflowInstanceStage.quorumCount`. This happens in `startInstance()` and in `performTransition()` (l.895), alongside the entry's other reads.
  - `isApprovalThresholdMet()` uses `currentInstanceStage.quorumCount ?? committee.quorumCount`.
  - An entry made before the deploy has null, so it keeps the live read (Q2).
- **Where it applies:** to record stages a tenant configures in COMMITTEE mode. No seeded stage uses it today, which makes this a guarantee for configured workflows and for the modules to come (Documents, Meetings). The committee's own lifecycle is not affected.
- **Build check (read only), before writing the fallback:** count the open entries in COMMITTEE-mode stages on the shared database, to know whether any approval is in flight.
- **Impact lines** are returned as codes with numbers; the screen words them.
  - `QUORUM`: `{ inProgress, from, to }`, worded "Approvals already in progress keep quorum 5; approvals that start after this change need 6." `inProgress` is the count of open COMMITTEE-mode entries for this committee.
  - `NAME`: where the name shows.
  - `MEETING_FREQUENCY`: no meetings exist yet, so it says only that the frequency changes.
  - `OWNING_UNIT`: escalations and new stage tasks go to the new unit.
  - `PARENT` / `REPORTS_TO`.
  - `TERMS_TASK`: on every request, "A task to revise the terms of reference will be created for <requester>."

### 5.7 Notifications (Q1)

| Event | Notify |
|---|---|
| Submitted | Every ACTIVE holder of `committees:approve` except the requester (the `reassignHolderIds` shape) |
| Returned | The requester, with the note |
| Approved | The requester; the terms task's own announcement also reaches them |
| Rejected | The requester, with the reason |
| Withdrawn by an approver (a stale draft) | The requester |
| Withdrawn by the requester | Nobody |

All are sent after commit with the stored-notice shape (`NotificationService.create`, EN and AR, `objectType: COMMITTEE_CHANGE_REQUEST`). A failed send never undoes the action.

### 5.8 Tests (PR 2)

- **Unit:**
  - every rule in §2, refused and allowed;
  - "one open" under two concurrent creates (a real-Postgres `db-spec`);
  - apply all or nothing (a reference refusal leaves the committee, the task and the stage untouched; a `db-spec`);
  - the quorum snapshot: 5 at entry, the committee changed to 6, and the vote still counts against 5; a new entry counts against 6; null falls back;
  - the generic transitions endpoint refusing every request transition;
  - the identical 404 for another organisation on every route (named for CI's tenant-isolation gate);
  - the backfill's dry run, execute and re-run.

## 6. PR 3 — The change request screens (ACC-240)

### 6.1 Screen → code map

| Screen in the drawing | Component | Exists? | Endpoint |
|---|---|---|---|
| Header "Request a change" (Active, Suspended) | `committee-detail` header | extend | — |
| Open-request banner (+ Error, Partial) | new `committee-change-banner` | **new** | `GET /committees/:id/change-requests/open` |
| Change requests panel | new `committee-change-requests-panel` on `am-capped-panel` | **new** (frame exists) | `GET /committees/:id/change-requests` |
| See all | `am-list-dialog size="compact"` + `am-simple-list` + `am-sort-header` | exists | same, paged |
| Request a change page | new `committee-change-request-form` page, route `/committees/:id/change-requests/new`; draft edit at `…/:requestId/edit` | **new** | `preview`, `POST`, `PATCH` |
| Request page | new `committee-change-request-page`, route `/committees/:id/change-requests/:requestId` | **new** | `GET /committee-change-requests/:id` |
| Stepper + stage history | `app-workflow-stage-indicator` (`sequence`, `history`) | exists | instance by object |
| Approve dialog (420) | `app-edit-dialog size="confirm"` | exists | `…/approve` |
| Return / Reject dialogs (560) | `app-edit-dialog` form + footer + `dirty` | exists | `…/return`, `…/reject` |
| Withdraw (420) | `app-edit-dialog size="confirm"` | exists | `…/withdraw` |
| Phone sticky action bar | request page, below 760px | **new** (CSS) | — |
| Home "Awaiting my action" | Home card | **new** (Q13) | `GET /committee-change-requests/awaiting-decision` |
| Permission sentences | en/ar.json | done in PR 1 | — |

- **Routes** are added to `committees.routes.ts`. Each child carries its own `canActivate: [permissionGuard]`, and the literal paths go before `:requestId`, following the `tasks.routes.ts` precedent and ACC-79's rule.
- The breadcrumb parent is the committee, through `BreadcrumbParentService`, showing the name only to a viewer who may open it.
- **The panel's place:** last in the grid, after Membership history.
- **Panel rows:** "Change request N · fields", status, "requester · date".
- **Empty:** "No change requests yet. Changes to this committee's details after approval are listed here."
- **Sorting** is by column header (ACC-234); phone cards keep the compact sort menu.

### 6.2 Fit and rules

- **Dialog bodies, as drawn:**

  | Dialog | Width | EN | AR |
  |---|---|---|---|
  | Approve | 420 | 126 | 138 |
  | Approve, typo-only | 420 | 98 | 108 |
  | Return | 560 | 152 | 166 |
  | Reject | 560 | 152 | 166 |
  | Withdraw | 420 | 42 | 48 |

  - All are far under 420 − 20. A layout spec pins Approve's longest case (all nine fields changed) in both languages. If nine lines would not fit, the list collapses to "9 fields" with the full list on the page (Q14).
- **The Request a change form is a PAGE, not a dialog,** so the 420 cap does not apply. That is why the drawing makes it a page: nine fields, the reason and the impact list cannot fit a dialog.
- **Attachments:** none on a change request; the in-app viewer rule has nothing to apply to.
- **Refusals** are said from their code (`committee.changeRequest.refusal.*`), never from the English message.

## 7. ACC-241 — The API lock on direct edits (before the first customer)

- **Location:** `CommitteesService.updateCommittee()`, inside the transaction, **after** the before-read and its 404 (`committees.service.ts:150–151`) and **before** `assertCommitteeReferences` (l.161). After PR 1, this is after the row lock and the `expectedUpdatedAt` comparison.
- **What it does:**
  - It reads the committee's instance's current stage key in the same transaction, as `isDissolving()` does (`committee-reference-checks.ts:153–172`).
  - Any key other than `formation` is a 409 `COMMITTEE_EDIT_LOCKED`. A missing instance or key is also refused (fail closed), with a log line of ids only.
  - The dialog words it from the code.
- **What it leaves alone:** the apply path in §5.5 writes the committee through its own code inside its own transaction, so the lock does not touch it. Membership is unaffected.

## 8. Lane A overlap check (18 Oct)

- **GitHub has no open pull requests.**
- **Every remote branch that touches the committee page, the committee dialog or the permission sentences is merged**, up to #186 (committees list and Add member, `7f81220`) and #188 (ACC-235, `21a4f68`).
- The only PR closed without merging is #127 (`fix/ACC-120-false-dto-comments`), which touched no committee files.
- **Lane A's folder** (`D:\Accredit-me project`) is clean, on `21a4f68`, with nothing ahead of `dev`.
- **No overlap.** If lane A opens anything touching `committee-detail`, `committee-form`, `committee-list` or `roles.matrix.sentence` before PR 1 merges, this check is redone.

## 9. Not in these PRs

- The Dissolution Pending → Active "Cancel Dissolution" transition: not seeded, and not added.
- Meetings' own use of a changed frequency: Meetings do not exist yet.
- Editing the terms-of-reference document itself: that is the task's work, and Document Management.
- The stage lock on the API: ACC-241.

## 10. Questions — each with my pick

1. **Notifications.**
   - Who is told on submit, return, approve, reject and withdraw?
   - **Pick: §5.7.**
     - Submit tells every active `committees:approve` holder except the requester.
     - Every decision tells the requester.
     - A self-withdraw tells nobody.
2. **Approvals open at deploy time.**
   - Should entries already in progress keep the live quorum (no snapshot exists for them), or be backfilled with today's value?
   - **Pick: fall back to live.** First, count them read-only; if there are none, the question is moot.
3. **Who edits or submits a draft?**
   - Only its requester, or anyone with `committees:edit_details`?
   - **Pick: only the requester.** Anyone else waits, or an approver withdraws a stale draft.
4. **Numbering.**
   - Per committee ("Change request 3" of this committee) or per organisation?
   - **Pick: per committee**, as the drawing reads.
5. **Where does "quorum ≥ 1" live?**
   - In a small engine registry (`TRANSITION_PRECONDITIONS`, per record type, fails open), or checked in the committee module?
   - **Pick: the registry.** The generic endpoint fires Submit for Approval, so the check must sit on that path, and a registry is where the next module's precondition goes too.
6. **The terms-of-reference link** (`termsOfReferenceDocumentId`).
   - Should it be a requestable field?
   - **Pick: no, not now.** No Document module exists to pick from; it joins the list when Documents ship.
7. **Is `updatedAt` enough for the stale save, or should `Committee` gain a `version` column?**
   - **Pick: `updatedAt`.** It needs no migration and moves on every write.
   - Its one blind spot is a write that leaves the row untouched (a membership change), which is correct: such a write did not change what the dialog shows.
8. **The New committee dialog.**
   - Same three tabs?
   - **Pick: yes.** It is one component, and creating sits in Formation by definition.
9. **Tab body height.**
   - Should it hold at the tallest tab, or follow each tab?
   - **Pick: hold at Identity's height**, so Save does not move under the pointer.
10. **Stage tasks on the request workflow** (a `RECORD_ROUTES` entry).
    - **Pick: no.** A request is a decision, not work; the one task it makes is the terms task on the committee.
11. **A committee changed directly after a request was drafted.**
    - This is only possible during development, before ACC-241.
    - **Pick: apply over the current values, record `appliedFrom`, and show the true "Current" values on the page.** The alternative, refusing because the baseline differs, strands requests in development for no benefit after ACC-241.
12. **The Arabic permission sentences** in §4.2 (7).
    - **Pick: mine, as written.** Ahmad to correct the wording if needed.
13. **Home "Awaiting my action".**
    - Home has no such section today: task-request decisions live on My tasks as "Waiting for your decision".
    - Should a new Home card list change requests only, or both kinds of decision?
    - **Pick: one new permission-gated card, "Awaiting my action", listing both** (task requests for whoever may decide them, change requests for `committees:approve`), each row linking to its page. My tasks keeps its own list.
14. **Approve dialog with many fields.**
    - If the changes-in-words list would pass the cap, should it collapse to a count?
    - **Pick: collapse above 6 lines** to "Quorum, Reports to and 5 more", with the full table on the page. To be measured in PR 3.
15. **Are the request workflow's stages fixed?**
    - Tenants could otherwise add stages to the request template in Workflow settings, which this feature cannot follow.
    - **Pick: rename and SLA only.** Adding or removing a stage or transition on a `COMMITTEE_CHANGE_REQUEST` template is refused (`WORKFLOW_TEMPLATE_FIXED`), as it is a system process.
