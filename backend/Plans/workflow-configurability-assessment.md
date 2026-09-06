# Can a working workflow actually be configured through the UI?

**Purpose.** Determine whether a functioning workflow can be defined
using the current model and UI, or whether the model itself is wrong.

**Method.** Traced the actual UI components, the actual DTOs, and the
actual engine code. Every claim below cites real fields and real code
paths. Nothing is inferred from field names.

**Short answer.** For the requested example — a Draft → Under Review →
Approved *document* approval — **no.** Not because a field is missing,
but because two structural facts make it impossible before any field is
filled in. Both are stated in Section 1. The rest of the document walks
the UI honestly anyway, because the field-level findings matter
independently of the blockers.

---

## 1. Two blockers that stop the requested example before it starts

### 1.1 You cannot create a workflow template through the UI

`WorkflowTemplateService.createTemplate()` exists on the frontend
service (`workflow-template.service.ts:161`) and the backend endpoint
exists. **It has zero callers anywhere in the application** (verified by
grep across `src/app`).

The template list page (`/workflows`) offers exactly two actions per
row: a star (set default) and a ban icon (deactivate). There is no
"New Template" button.

**Consequence.** A configurer cannot define a workflow for a new
purpose. They may only edit the eight templates seeded at tenant
creation — one per `WorkflowObjectType`.

### 1.2 Only COMMITTEE workflows can ever run

`WorkflowService.startInstance()` has exactly **one** caller in the
entire backend:

```
committees.service.ts:87 —
  await this.workflowService.startInstance('COMMITTEE', committee.id, organizationId, actorId);
```

Nothing starts a `DOCUMENT`, `DOCUMENT_REQUEST`, `CHANGE_REQUEST`,
`INCIDENT`, `AUDIT`, `CORRECTIVE_ACTION`, or `MEETING` instance.

**Consequence.** Seven of the eight templates are fully editable in the
UI and completely inert at runtime. A configurer can spend an hour
carefully building a document-approval workflow, save it with no
errors, and it will never execute — because no code path creates a
document, and therefore none starts its workflow.

Nothing in the UI indicates this. The DOCUMENT template looks exactly
as real as the COMMITTEE one.

**This is the single most important finding in this document.** The
requested Draft → Under Review → Approved example cannot be built as a
document workflow. Everything below therefore walks the COMMITTEE
template, the only one that actually runs.

---

## 2. The walkthrough: editing a workflow that can run

Path: **Sidebar → Workflows → Committee Management → `/workflows/:id/stages`**

The stage list shows: Name (En), Name (Ar), SLA Working Hours,
Approval Mode, Assignee Strategy, plus move-up/move-down, edit, and
delete actions, and an **Add Stage** button.

### 2.1 Stage form — every field, in the order the UI asks

| # | Field | Required | What it does at runtime |
|---|---|---|---|
| 1 | **Name (En)** | ✳ | Display only. Also used in notification bodies (`"<objectType> moved to <nameEn>"`). |
| 2 | **Name (Ar)** | ✳ | Display only. |
| 3 | **Description** | | Stored. **Never read by the engine or shown anywhere else.** |
| 4 | **SLA Working Hours** | | Feeds `computeSlaDueAt()` via `WorkingCalendarService` → sets `WorkflowInstanceStage.slaDueAt` and the created Task's `dueAt`. Drives SLA-breach detection and escalation. |
| 5 | **Is Initial** | | Marks where `startInstance()` begins. |
| 6 | **Is Final** | | Marks a terminal stage. |
| 7 | **Approval Mode** | ✳ | `SINGLE` / `SEQUENTIAL` / `PARALLEL` / `COMMITTEE`. Determines whether firing a transition advances immediately or requires recorded approvals first. |
| 8 | **Parallel Threshold** | | *Only appears when Approval Mode = PARALLEL.* `ALL` / `MAJORITY` / `ANY`. |
| 9 | **Assignee Strategy** | ✳ | Discriminator selecting which of the fields below is read. |
| 10 | **Assignee Role** | | *Only when strategy = ROLE or ROUND_ROBIN.* |
| 11 | **Committee Member Role** | | *Only when strategy = COMMITTEE.* Narrows to one member role. |
| 12 | **Position / Org Unit** | | *Only when strategy = POSITION_FIXED.* |

### 2.2 Field-level findings

**#3 Description is inert.** Stored on the model, returned by the API,
rendered nowhere and read by no engine code. A configurer will
reasonably assume it explains the stage to participants. It does not.

**#5/#6 `isInitial` and `isFinal` are unguarded.** The form is a plain
checkbox pair with no validation. Nothing prevents:
- two stages marked `isInitial` — `startInstance()` does
  `findFirst({ isInitial: true })`, so one is picked arbitrarily and
  the other silently ignored;
- zero stages marked `isInitial` — `startInstance()` throws
  *"Workflow template has no initial stage configured"* at the moment a
  committee is created, i.e. the failure surfaces to an end user
  creating a committee, not to the admin who misconfigured it;
- `isInitial` and `isFinal` both set on one stage.

**Stage `order` is display-only.** The move-up/move-down buttons imply
sequence. Grepping `.order` across `workflow.service.ts` returns **no
engine usage at all**. Flow is determined *exclusively* by transitions.
Reordering stages changes the list's appearance and nothing else. A
configurer would very reasonably believe reordering changes the flow.

**#7 Approval Mode = COMMITTEE shows an info message, not a picker.**
There is no committee selector. `stage.committeeId` is required by the
engine's `COMMITTEE` branches but **cannot be set from this form at
all** — the field exists on the DTO and the model, with no UI. Choosing
COMMITTEE approval mode through the UI produces a stage the engine
cannot resolve.

**#9 Assignee Strategy offers seven options; three are non-functional
via this UI:**
- `SPECIFIC_USER` — shows *"User assignment will be available after
  User Management module is configured"*. There is no user picker.
  Selecting it yields a permanently empty assignee pool.
- `ORG_UNIT_HEAD` — offered with no explanation. It reads
  `instance.orgUnitId`, **a column that exists on no object in the
  schema**. It resolves to `[]` for every object that exists. Nothing
  in the UI says so.
- `ROUND_ROBIN` — offered as a distinct choice. In the engine it shares
  a `case` label with `ROLE` (`case 'ROLE': case 'ROUND_ROBIN':`) and
  has no rotation logic whatsoever. It is `ROLE` under a different
  name. The UI presents them as two different things.

**#10 "Assignee Role" is mislabelled in the transition editor** — see
§2.4.

### 2.3 Transition editor — every field, in order

Reached from the stage list (Transitions section under each stage).

| # | Field | Required | What it does |
|---|---|---|---|
| 1 | **To Stage** | ✳ | Destination. Dropdown of the template's stages. |
| 2 | **Label (En)** | ✳ | The **button text** the end user clicks. |
| 3 | **Label (Ar)** | ✳ | Arabic button text. |
| 4 | **Trigger Condition** | ✳ | `ROLE_BASED` / `SPECIFIC_USER` / `ANY_AUTHENTICATED` / `ASSIGNEE_POOL` / `SYSTEM_AUTOMATIC`. |
| 5 | **Role** | | *Only when Trigger Condition = ROLE_BASED.* |
| 6 | **Required Permission** | | **Free-text input.** |
| 7 | **Is Approval Path** | | Marks this exit as the "advance" outcome vs "return". |
| 8 | **Validator Config** | | **Raw textarea.** |

### 2.4 Transition-level findings — the most severe cluster

**#6 Required Permission is a free-text box.** There is no dropdown, no
autocomplete, no validation, and no list of valid values anywhere in
the UI. The configurer must type an exact string such as
`committees:approve` from memory or from reading
`common/constants/permissions.ts`.

A typo produces no error at save time. The transition is written
successfully and becomes **permanently unfireable** — every attempt
throws `Missing required permission: committees:aprove`, and nothing
ever flags the transition as broken. This is the single easiest way to
silently destroy a workflow through this UI.

> **CORRECTION (2026-09-05, ACC-55 investigation).** This section
> originally claimed the typo risk had *already occurred* in Demo
> Organization — that its `terms_review → active` transition requires
> `committees:approve`, which no role there holds, making it
> unfireable. **That claim was wrong**, and is corrected below rather
> than deleted, since it was committed to `dev` and repeated in Linear
> ACC-56 (now repointed at the real finding). The typo risk described
> above is real; the claimed live instance of it was not.
>
> Verified directly against the live shared dev database:
>
> - Demo Organization's "Approve Committee" transition requires
>   **`committees:manage`**, not `committees:approve` — and
>   `committees:manage` is held by 3 active roles there. **The
>   transition is fireable.**
> - Demo Organization does genuinely lack `committees:approve` role
>   grants (it predates ACC-22's permission split; the two newer
>   tenants have 3 roles each) — but no transition there requires it,
>   so nothing is blocked by that fact.
> - The only tenants holding `committees:approve` *transitions*
>   (ACC45 Verify Temp, ACC46 P2 Verify) are also the ones that grant
>   the permission.
>
> The error was conflating the **current seed source** (`workflow.seed.ts:262`
> does say `committees:approve`) with Demo Organization's **actual
> stored data**, seeded earlier under a different value. Reading the
> seed is not the same as reading the tenant.
>
> Running the general form of the check across every tenant: **zero
> transitions hold a known permission string that no active role in
> their own tenant holds.** This failure class has no live instance
> today.

**Not yet observed in live data, but nothing prevents it.** No tenant
currently holds a *known* permission string that nobody can satisfy
(see the correction above). What does exist: 45 of the 195 transitions
carrying a `requiredPermission` hold a string absent from
`permissions.ts` entirely — `capa:investigate` (21), `capa:approve`
(15), `capa:close` (3), `incidents:manage` (6). Those are **deliberate
forward references** to the not-yet-built CAPA and Incident modules,
declared in a block comment at `workflow.seed.ts:66-81` — not typos,
and a reason any validation here must warn rather than reject.

**The detection gap is real, for a different reason than first
stated.** `resolveUnassignedBlockingTransitions()`
(`workflow.service.ts:1268-1278`) *does* inspect `requiredPermission` —
but only for `ASSIGNEE_POOL` transitions, against the resolved pool.
`resolveUnreachableTriggerConditionTransitions()` states its own
boundary in-code (`workflow.service.ts:1292-1297`): `ROLE_BASED`
transitions with no `triggerRoleId` are outside its scope, because
tenant-wide `requiredPermission` reachability is "a broader, more
expensive question not covered here." All eight seeded templates are
`ROLE_BASED` with `triggerRoleId = NULL`, so for the entire real
corpus this is genuinely undetected. Tracked as ACC-56.

**#8 Validator Config is an unlabelled JSON textarea.** No placeholder,
no hint, no schema, no example. `checkValidatorConfig()` reads exactly
**one** key:

```ts
const config = transition.validatorConfig as { minApprovals?: number } | null;
if (!config?.minApprovals) return;
```

Every other key is silently ignored. CLAUDE.md advertises four
validator types — required fields filled, minimum attachments present,
previous-stage tasks completed, minimum approvals reached. **Only the
last exists.** A configurer writing `{"requiredFields": ["purpose"]}`
gets no error and no effect.

**#5 The role picker under ROLE_BASED is labelled "Assignee Role."**
It binds `triggerRoleId` — a *gate* on who may press the button, not an
assignee. It reuses the stage form's `workflow.assigneeRole`
translation key. A configurer would reasonably read this as "this
transition assigns to X."

**#4 `SYSTEM_AUTOMATIC` is selectable and always wrong here.**
`triggerTransition()` rejects it unconditionally: *"This transition can
only be fired by a system process"* — and no system process fires
transitions. Selecting it creates a dead end.

**#4 `ROLE_BASED` with no role selected silently means "no role
check."** The engine checks `triggerCondition === 'ROLE_BASED' &&
transition.triggerRoleId` — with the role left blank the entire check
is skipped and only `requiredPermission` gates the transition. The UI
gives no indication that leaving it blank changes the meaning. (All
eight seeded templates are in exactly this state.)

**Editing a transition cannot change its endpoints.** The edit dialog
shows *"transition endpoints locked"* — From/To are immutable after
creation. To reroute, delete and recreate.

### 2.5 Actions — what actually makes anything happen

Under each transition: an Actions section (`CREATE_TASK`,
`SEND_NOTIFICATION`, `GENERATE_PDF`, `LOCK_DOCUMENT`, `LOG_AUDIT`,
`WEBHOOK`), each with Order and Enabled.

**This is the most consequential thing in the entire UI, and nothing
says so.** A stage's Assignee Strategy does *nothing on its own*. A
task is created **only** if the transition *into* that stage carries a
`CREATE_TASK` action. Configure the world's most careful assignee
strategy, omit `CREATE_TASK`, and no work is ever assigned to anyone.

The dependency runs backwards from what the layout implies: the
assignee is configured on the **stage**, but whether anyone is told
about it is configured on the **transition that leads into it**.

Two offered action types are stubs that log a string and do nothing:
`GENERATE_PDF` (*"Stubbed — PDF generation deferred to Step 17"*) and
`LOCK_DOCUMENT` (*"Stubbed — no Document model exists yet to lock"*).
Both appear in the dropdown as ordinary choices.

---

## 3. Knowledge the UI never provides

A configurer must already know all of the following. None is
discoverable from the interface:

1. Only COMMITTEE workflows execute; the other seven templates are
   inert.
2. Templates cannot be created — only the seeded eight exist.
3. `CREATE_TASK` on the *inbound transition* is what makes a stage's
   assignee mean anything.
4. Stage `order` and the move buttons do not affect flow.
5. The exact spelling of every permission string, typed by hand.
6. That `validatorConfig` supports exactly one key, `minApprovals`.
7. That `ORG_UNIT_HEAD` and `SPECIFIC_USER` cannot resolve, and
   `ROUND_ROBIN` is an alias for `ROLE`.
8. That `SYSTEM_AUTOMATIC` transitions can never fire.
9. That `ROLE_BASED` with an empty role means "no role check".
10. That COMMITTEE approval mode needs a `committeeId` no form can set.
11. That exactly one stage must be `isInitial`, unenforced.

Items 3, 5 and 6 require reading the engine source. Item 5 additionally
requires knowing which roles hold which permission — a fact split
across the roles screen and the code.

---

## 4. Would the resulting workflow function?

**For the requested document-approval example: no.** It cannot be
created (§1.1) and could never run (§1.2).

**For a COMMITTEE workflow, edited rather than created: partially, and
only if the configurer already knows §3.**

Working end to end today: stage entry, assignee resolution for `ROLE`,
`COMMITTEE`, `SELF` and `POSITION_FIXED`; task creation and
notification via `CREATE_TASK`/`SEND_NOTIFICATION`; SLA computation and
breach escalation; permission and pool gating; audit logging;
unassigned-stage detection and recovery.

**Silently doing nothing** — no error, no warning, nothing in the UI:

| Configuration | What happens |
|---|---|
| Stage with an assignee strategy but no inbound `CREATE_TASK` | Nobody is assigned anything |
| `SPECIFIC_USER` strategy | Empty pool, permanently |
| `ORG_UNIT_HEAD` strategy | Empty pool, permanently |
| `ROUND_ROBIN` strategy | Behaves as `ROLE`; no rotation |
| COMMITTEE approval mode | No committee can be set; unresolvable |
| Misspelled `requiredPermission` | Transition permanently unfireable |
| Any `validatorConfig` key but `minApprovals` | Ignored |
| `GENERATE_PDF` / `LOCK_DOCUMENT` actions | Log a stub string |
| Reordering stages | Purely cosmetic |
| A second `isInitial` stage | Arbitrarily ignored |

---

## 5. Assessment

**The model is broadly sound; the UI and the module coverage are not.**

The data model expresses the right concepts — stage-level assignment
(push) versus transition-level gating (pull) is a real and correct
distinction, and the engine implements it coherently. `ASSIGNEE_POOL`
is a well-judged bridge between the two.

What is wrong is not the schema. It is that:

- the UI exposes the model's *full internal surface* — every enum
  value, every optional field — with no indication of which
  combinations are meaningful, supported, or implemented;
- roughly a third of the offered choices cannot work at all, and are
  presented identically to the ones that can;
- the one thing that determines whether a workflow does anything
  (`CREATE_TASK` on the inbound transition) is the least discoverable
  element in the interface;
- seven of eight templates have no consuming module, so the workflow
  builder is, in practice, a Committee-workflow editor labelled as a
  general one.

The most defensible summary: **this is an engine with an admin
debugging surface attached, not a workflow builder.** It is usable by
someone who has read the engine source. It is not usable, and is
actively misleading, for anyone else — including a Tenant Admin, who is
its intended user.

None of that requires changing the model to fix.
