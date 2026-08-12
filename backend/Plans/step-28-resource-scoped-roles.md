# Step 28 — Resource-Scoped Authority for Committees (Revised)
# ACC-28: design-only ticket. No implementation code is produced under this
# ticket — this document is the plan a follow-up implementation ticket will
# build from. Sequenced BEFORE Committee Management's remaining closure
# items (which now depend on it) and before Meeting Management, per
# CLAUDE.md's Build Sequence.

---

## RETROSPECTIVE NOTE — Read First

The first revision of this plan proposed a new generic mechanism:
`ResourceRoleAssignment` (a new table), `ResourceScopedPermissionGuard`
(a new guard class), and `LookupRoleMapping` (another new table) — a
full parallel authorization system layered alongside the existing one.

That design was **scrapped**, not merely revised, after a direct
investigation of `WorkflowService.triggerTransition()` and
`resolveAssigneeRaw()`/`resolveApproverPool()` showed it duplicated
machinery that already exists and already does most of the real work:
`resolveAssigneeRaw()`'s `COMMITTEE` case already resolves correctly to
one specific committee's members (not the whole tenant) — it was one
filter short of chair-specific, not fundamentally missing. The first
revision was drafted without checking that.

**The lesson this is meant to leave behind, for this ticket and for
whichever foundational-mechanism plan comes after it**: before designing
a new cross-cutting mechanism, trace the *actual* code path the problem
lives in end to end, and check whether an existing, working piece of
machinery already solves part of it. This is not a special rule for
authorization specifically — it applies to any "we need a new generic X"
proposal in this codebase. A changelog entry would say "design changed
from A to B." The point of this note is the *why*: A was investigated
too shallowly. B exists because the investigation was redone against the
actual code, line by line, before any schema was drafted.

---

## RETROSPECTIVE NOTE 2 — Read Second

This ticket's **second** mid-flight design correction. Section 2.3
below originally proposed `CommitteesService.assertCommitteeAuthority()`
— a Chairman-specific check (flat `committees:manage` OR "is the actor
the active Chairman of this specific committee") — and it was built,
tested, and merged in that shape.

**That check was rejected by direct product decision and has been
removed entirely.** The reasoning: a Chairman is, in practice, very
often a figurehead — a senior clinician or department head who chairs
the committee in name and at meetings, but delegates the actual system
work (updating committee details, adding/removing members, changing
member roles) to a Secretary or coordinator. A literal "are you the
Chairman" check locks out precisely the person actually doing the
work, and grants access to someone who may rarely touch the system at
all. This is a real-world organizational-behavior mismatch, not a bug
in the check's logic — the code was correct for what it checked; what
it checked was the wrong thing.

**The replacement is deliberately unexciting**: five new permission
strings (`committees:create`, `committees:edit_details`,
`committees:add_member`, `committees:remove_member`,
`committees:change_member_role`), one `@Permissions()` decorator per
`CommitteesController` method, no service-level authority check at
all — the exact same model every other controller in this codebase
already uses. Whichever role a tenant actually delegates committee
administration to (Chairman, Secretary, Quality Manager, or a fully
custom role) gets these permissions granted the ordinary way, through
the existing Roles UI — no committee-membership lookup, no
resource-instance authority concept, nothing new for Committee to
carry that no other module has.

**The lesson this leaves behind, alongside Retrospective Note 1's**:
that first correction was about not duplicating existing *machinery*.
This one is about not encoding an *organizational assumption*
("the Chairman does the chairing AND the data entry") into an
authorization check without confirming it holds in practice. Both
corrections removed something that was technically well-built in favor
of something structurally simpler — a pattern worth noticing, not a
coincidence: resource-instance-specific authority checks are a bigger
hammer than this problem, twice now, needed.

---

## 1. OVERVIEW

### What This Document Is

A concrete design for letting specific **workflow stages** require the
actor to hold authority over the particular resource instance being
acted on (e.g. "must be Chairman of *this* committee," not "must hold
some role tenant-wide") — achieved by extending two already-working,
already-integrated pieces of the workflow engine (Sections 2.1/2.2). No
new table. No new guard class. No new generic cross-module model.

The plain-CRUD half of the original problem — `CommitteesController`'s
membership-management endpoints, which aren't workflow transitions at
all — is **not** solved with a resource-instance authority check. See
Retrospective Note 2: that approach (`assertCommitteeAuthority()`, a
Chairman-specific check) was built, then rejected by direct product
decision and removed. Section 2.3 now documents the actual final
design: five ordinary permission strings, checked via a plain
`@Permissions()` decorator per method, no service-level authority
check at all — the same model every other controller already uses.

### Why This Is Needed (Unchanged From the Original Investigation)

The underlying problem is the same as before — `getUserPermissions()`
is flat and tenant-wide, `UserRole` has no resource-scoping columns, and
`CommitteeMember.roleValueId` is today pure opaque metadata with zero
conditional logic reading it. What changed is not the problem, only
which existing machinery turned out to already be closer to a solution
than assumed. See the prior investigation (this session) for the full
citation trail confirming: roles are genuinely tenant-customizable both
directions, `PlatformGuard`'s AND-composition precedent doesn't fit an
OR requirement, and the four recurring "chair / owner / lead" examples
in `module-designs.md` (Committee/Meeting chair, Document
owners/stakeholders, CAPA process owner, Audit lead auditor) are **all**
`WorkflowStage` assignee/trigger concepts — not, as first assumed, a
class of problem that needed a brand-new authorization primitive.

### What The Follow-Up Investigation Found (The Basis For This Redesign)

Confirmed by reading `workflow.service.ts` directly, line by line:

- `triggerTransition()`'s gating logic (lines 176–215) and
  assignee-resolution (`resolveAssigneeRaw()`, lines 720–776;
  `resolveApproverPool()`, lines 861–883) are **two entirely
  disconnected code paths** today. Gating checks `requiredPermission`
  (flat) and `triggerCondition` (`SYSTEM_AUTOMATIC` / `SPECIFIC_USER` /
  `ROLE_BASED` via a tenant-wide `userRole.findFirst`). Assignee
  resolution is only ever called for `CREATE_TASK`/`SEND_NOTIFICATION`
  targeting and for sizing the approval-threshold denominator. Neither
  path checks the other — confirmed directly: for a `ROLE`-assigned
  `SINGLE` stage, any tenant-wide holder of the required role/permission
  can trigger the transition, whether or not they were the one actually
  assigned the task.
- `resolveAssigneeRaw()`'s `COMMITTEE` case (lines 761–771) **already**
  scopes correctly to one specific committee's members (`committeeId`
  filter, org-scoped) — but resolves to **every active member
  indiscriminately**, with no `roleValueId` filter. Same for
  `resolveApproverPool()`'s identical `COMMITTEE` branch (865–872).
  Chair-specific resolution does not yet exist, but resource-specific
  resolution already does — it was one filter away, not absent.
- `resolveAssigneeRaw()`'s `ROLE` case (lines 729–742) has zero
  resource-instance awareness — same flat problem as
  `triggerRoleId`, on the assignment side.
- The frontend's Role pickers (`workflow-stage-form.component.ts:245`,
  `workflow-transition-editor.component.ts:363`) both bind
  `RoleService.listRoles()` unfiltered — confirming that seeding a new
  Role alone (e.g. a hypothetical `COMMITTEE_CHAIRMAN`) would not have
  solved anything: selected as `assigneeRoleId`, it would resolve to
  every chair of every committee in the tenant for every
  committee-linked stage, the same flat problem restated with a
  different Role.
- **Split conclusion**: the workflow-transition-gated half of the
  problem (which covers all four recurring `module-designs.md` examples)
  has a small, integrated fix by extending existing machinery — Sections
  2.1/2.2 below. The plain-CRUD half (`CommitteesController`'s
  membership-management endpoints, which module-designs.md is explicit
  are **not** workflow transitions — `CommitteeMembershipEvent` records
  instead) cannot be reached by that fix at all, since there is no
  `stage`/`transition`/`instance` in that code path. That half is
  handled with five ordinary permission strings — Section 2.3 below,
  updated per Retrospective Note 2 — but does **not** need a generic
  cross-module model either; Committee is the
  only module with this problem today.

---

## 2. PROPOSED DESIGN

### 2.1 `WorkflowStage.assigneeCommitteeRoleValueId` — narrow the existing `COMMITTEE` case

One new nullable column. No new table.

```prisma
model WorkflowStage {
  // ...existing fields unchanged...
  committeeId                 String?
  assigneeCommitteeRoleValueId String?   // NEW — only meaningful when
                                          // assigneeStrategy = COMMITTEE.
                                          // Narrows resolveAssigneeRaw()'s
                                          // COMMITTEE case to members whose
                                          // roleValueId matches this lookup
                                          // value (e.g. "chairman"). Null
                                          // (default) = every active member,
                                          // i.e. today's exact behavior —
                                          // every existing seeded stage is
                                          // unaffected.
}
```

Named `assigneeCommitteeRoleValueId`, not something more abstractly
generic — it is only ever read when `assigneeStrategy === 'COMMITTEE'`,
exactly like the existing `committeeId` field already sitting on this
same generic table for the identical reason. Inventing a fake-generic
name for a field that only means something for one strategy would be
worse, not better.

**Code change** — `resolveAssigneeRaw()`'s `COMMITTEE` case (currently
lines 761–771):

```ts
case 'COMMITTEE': {
  if (!stage.committeeId) return [];
  const members = await this.prisma.committeeMember.findMany({
    where: {
      committeeId: stage.committeeId,
      organizationId,
      isActive: true,
      ...(stage.assigneeCommitteeRoleValueId
        ? { roleValueId: stage.assigneeCommitteeRoleValueId }
        : {}),
    },
  });
  return members.map((m) => m.userId);
}
```

The identical filter is added to `resolveApproverPool()`'s `COMMITTEE`
branch (865–872) for consistency — a `PARALLEL`-mode stage using
`assigneeCommitteeRoleValueId` should size its approval threshold
against the same narrowed pool it assigns to, not the full membership.

Backward compatible with every existing seeded stage: the field
defaults to `null`, and `null` preserves today's exact "all active
members" behavior — no data migration needed on existing `WorkflowStage`
rows beyond adding the column itself.

### 2.2 New `triggerCondition` value — `ASSIGNEE_POOL`

```prisma
enum WorkflowTriggerCondition {
  SPECIFIC_USER
  ROLE_BASED
  ANY_AUTHENTICATED
  SYSTEM_AUTOMATIC
  ASSIGNEE_POOL   // NEW
}
```

**Code change** — `triggerTransition()`, inserted immediately after
`fromStage` is resolved and null-checked (current lines 217–218, i.e.
right before `currentInstanceStage` is fetched):

```ts
if (transition.triggerCondition === 'ASSIGNEE_POOL') {
  const pool = await this.resolveAssigneeRaw(fromStage, instance, organizationId);
  if (!pool.includes(actorId)) {
    throw new ForbiddenException(
      'You are not in the resolved assignee pool for this stage',
    );
  }
}
```

Placed after `fromStage` is available (unlike the other three
`triggerCondition` checks at lines 202–215, which run before it) because
`resolveAssigneeRaw()` needs the full stage row, not just the id.
`resolveAssigneeRaw()` is already a private method on the same class —
no refactor, no new query pattern, reused exactly as it already exists.

This composes with `requiredPermission` (line 198) as an ordinary AND,
same as the three existing `triggerCondition` checks already do — a
tenant admin configuring a transition can require both a flat permission
and `ASSIGNEE_POOL` membership, or just one, per transition, same
configuration model as today.

For a stage with `assigneeStrategy: COMMITTEE` and
`assigneeCommitteeRoleValueId` set to "chairman," a transition with
`triggerCondition: ASSIGNEE_POOL` now means, precisely: *only the active
Chairman of this specific committee may fire this transition* — the
exact "committee chair authority validation" module-designs.md's Org
Position section describes, achieved with a filter and a gating branch,
not a new authorization primitive.

### 2.3 `CommitteesController`/`COMMITTEES_PERMISSIONS` — five ordinary permissions for the non-workflow CRUD path (per Retrospective Note 2)

`updateCommittee`, `addMember`, `changeMemberRole`, `removeMember` are
plain REST actions, not workflow transitions (module-designs.md: "NOT
workflow stage transitions — recorded as events") — 2.1/2.2 cannot reach
them. These were originally gated by `@Permissions(COMMITTEES_PERMISSIONS.MANAGE)`
alone, an all-or-nothing tenant-wide check; a Chairman-specific
resource-instance check (`assertCommitteeAuthority()`) was then built to
loosen that, and was then itself rejected — see Retrospective Note 2 for
why. **The design actually built and shipped** is simpler than either:

`common/constants/permissions.ts` — `COMMITTEES_PERMISSIONS` gains 5 new
strings, `VIEW`/`MANAGE`/`APPROVE` unchanged (8 total):

```ts
CREATE:             'committees:create',
EDIT_DETAILS:       'committees:edit_details',
ADD_MEMBER:         'committees:add_member',
REMOVE_MEMBER:      'committees:remove_member',
CHANGE_MEMBER_ROLE: 'committees:change_member_role',
```

`committees.controller.ts` — one specific `@Permissions()` decorator per
method, no dynamic check, no `@CurrentUserPermissions()`, no
`userPermissions` parameter threaded into the service — the ordinary
`PermissionGuard` path every other controller in this codebase already
uses:

```ts
@Post()
@Permissions(COMMITTEES_PERMISSIONS.CREATE)
createCommittee(...): Promise<ICommittee> { ... }

@Patch(':id')
@Permissions(COMMITTEES_PERMISSIONS.EDIT_DETAILS)
updateCommittee(...): Promise<ICommittee> { ... }

@Post(':id/members')
@Permissions(COMMITTEES_PERMISSIONS.ADD_MEMBER)
addMember(...): Promise<ICommitteeMember> { ... }

@Patch(':id/members/:memberId')
@Permissions(COMMITTEES_PERMISSIONS.CHANGE_MEMBER_ROLE)
changeMemberRole(...): Promise<ICommitteeMember> { ... }

@Delete(':id/members/:memberId')
@Permissions(COMMITTEES_PERMISSIONS.REMOVE_MEMBER)
removeMember(...): Promise<void> { ... }
```

`committees.service.ts` — `assertCommitteeAuthority()` deleted entirely,
along with its `chairmanValue` lookup, the `organizationId: null` fix
that lookup needed, and the `userPermissions` parameter on all four
methods it was threaded through. Nothing replaces it — `PermissionGuard`
alone is the check now, same as `createCommittee` already was.

**Seed-time propagation**: `role.seed.ts`'s `PLATFORM_ADMIN`,
`TENANT_ADMIN`, and `QUALITY_MANAGER` roles all hold `committees:manage`
exclusively via a wholesale `Object.values(COMMITTEES_PERMISSIONS)`
spread (`ALL` array, or `QUALITY_MANAGER`'s own explicit spread) — so
all three automatically pick up the 5 new permission strings with no
further edit to `role.seed.ts` itself. This is what "manage holders keep
full capability because they're granted the whole bundle upfront, not
through any runtime 'does manage cover this' logic" means concretely:
there is no code anywhere checking "does MANAGE imply CREATE" — the
three roles simply hold all 8 `committees:*` strings as literal
`RolePermission` rows.

**Existing tenants need a backfill** — `role.seed.ts`'s change only
affects `seedSystemRoles()` going forward (new tenant bootstrap);
already-provisioned tenants' `RolePermission` rows were snapshotted
before this change. `backend/prisma/backfill-committees-resource-permissions.ts`
closes this, following the exact established pattern from
`backfill-positions-permissions.ts` (ACC-16) and
`backfill-committees-approve-permission.ts` (ACC-22): idempotent,
additive-only, upserts the 5 global `Permission` catalog rows itself
(matching `RoleService.seedPermissions()`'s own behavior) rather than
assuming they pre-exist, then grants each to `PLATFORM_ADMIN`/
`TENANT_ADMIN`/`QUALITY_MANAGER` per organization where missing. This
backfill is **not optional** the way a purely additive nice-to-have
would be — without it, an existing tenant's `committees:manage` holders
would be locked out of all four CRUD actions the moment this ships,
since `PermissionGuard` checks the specific permission string, not
`MANAGE` as a implicit superset.

No new table. No lookup-to-role mapping. No `COMMITTEE_CHAIRMAN` role —
confirmed neither was ever actually seeded in committed code from the
earlier, since-rejected version of this design (checked directly:
zero matches for `COMMITTEE_CHAIRMAN`, `LookupRoleMapping`,
`ResourceRoleAssignment`, or `ResourceScopedPermissionGuard` anywhere in
`backend/src` or `schema.prisma`).

### 2.4 Genericity Through Reuse, Not a New Abstraction Layer

Both 2.1 and 2.2 live entirely inside `WorkflowService` and
`WorkflowStage`/`WorkflowTransition` — tables and a service already
shared by every `WorkflowObjectType` (`DOCUMENT_REQUEST`, `DOCUMENT`,
`CHANGE_REQUEST`, `INCIDENT`, `AUDIT`, `CORRECTIVE_ACTION`, `MEETING`,
`COMMITTEE`, and whatever future types get added). This is deliberate:

- `ASSIGNEE_POOL` as a `triggerCondition` is **immediately usable by any
  future module's workflow**, with zero rebuilding — any stage in any
  object type's workflow can set `triggerCondition: ASSIGNEE_POOL` and
  it works using whatever `resolveAssigneeRaw()` already resolves for
  that stage's `assigneeStrategy` (`ROLE`, `COMMITTEE`, `SPECIFIC_USER`,
  `SELF`, etc.) — the gating logic itself has no notion of "Committee"
  anywhere in it.
- The pattern `assigneeCommitteeRoleValueId` establishes (a narrow,
  strategy-specific filter field, applied inside that one `switch` case)
  is a **template**, not a shared class, for future resource-typed
  strategies — e.g. when Document Management eventually needs to
  distinguish "owners" from "stakeholders" as genuinely separate pools,
  it would follow the same shape (a new filter field, read inside its
  own resolution branch), not require a shared table this ticket would
  otherwise have had to design speculatively. That field is explicitly
  **not** built now — see Non-Goals.
- Section 2.3's non-workflow CRUD fix is, per Retrospective Note 2,
  **not** a resource-instance authority mechanism at all anymore — five
  ordinary permission strings, checked the same way every other
  controller in this codebase already checks permissions. There is
  nothing Committee-specific left to generalize or to warn future
  modules away from pre-building; a future CAPA "owner of affected
  process" need (if one ever arises) would most likely follow this same
  ordinary-permissions shape too, not a narrow resource-specific check
  — that's the generalizable lesson Retrospective Note 2 leaves behind.

Genericity here comes from the fact that `resolveAssigneeRaw()` and
`triggerTransition()` are already shared, not from inventing a new
shared thing.

### 2.5 Unassigned-Stage Detection for `ASSIGNEE_POOL` (Operational Safety — Added After Investigation)

**The confirmed problem.** Neither `addStage`/`updateStage` nor
`addTransition`/`updateTransition` in `workflow-template.service.ts`
perform any config-time validation cross-checking a stage's
`assigneeStrategy`/`assigneeRoleId` against a transition's
`requiredPermission` — a tenant admin can save a combination where the
resolved pool and the required permission never overlap. No runtime
detection exists either: if every person in a stage's resolved
assignee pool lacks the transition's `requiredPermission` (or the pool
is simply empty), that transition becomes permanently unreachable with
zero notification to anyone. `TaskService.create()` already has a
working equivalent for its own zero-eligible-assignee case
(`eligibleAssigneeIds.length === 0` → `status: UNASSIGNED` +
`notifyTenantAdmins()`, `task.service.ts:52–96`) — nothing analogous
exists anywhere in the workflow engine. This gap is pre-existing for
`ROLE_BASED`/`SPECIFIC_USER` today, but `assigneeCommitteeRoleValueId`
(2.1) makes it meaningfully more likely to occur in practice: a single
vacant Chairman seat — a normal, plausible real-world event, not a
misconfiguration — can now silently and permanently block a stage.

**Schema addition** — exactly the shape already specified once in
`module-designs.md`'s Absence and Departure Management section but
never built (confirmed via schema grep: zero matches today):

```prisma
model WorkflowInstanceStage {
  // ...existing fields unchanged...
  isUnassigned Boolean   @default(false)
  unassignedAt DateTime?
}
```

**Detection at stage-entry time.** At every point a new
`WorkflowInstanceStage` row is created — `startInstance()` for the
initial stage, and inside `performTransition()` for the stage a
transition lands on — after the row is created, for every *outgoing*
`WorkflowTransition` from that new stage:

- Skip the transition if `triggerCondition !== 'ASSIGNEE_POOL'` (see
  Pending Discussion #3 below for why this ticket doesn't check
  `ROLE_BASED`/`SPECIFIC_USER` here too).
- Resolve the stage's pool via the existing `resolveAssigneeRaw()`.
- If the pool is empty, the transition is unreachable regardless of
  `requiredPermission` — flag it. (This is a refinement on the
  original proposal, which only spoke of checking `requiredPermission`
  — that check alone silently misses the "pool is empty and the
  transition has no `requiredPermission` at all" case, since there is
  nothing to cross-check. An empty pool always means nobody can ever
  satisfy `pool.includes(actorId)`, independent of permission.)
- If the pool is non-empty and `requiredPermission` is set, check
  whether *any* resolved person's flat permissions
  (`RoleService.getUserPermissions()`, the same resolver used
  everywhere else) include it. If none do, flag it.
- If the pool is non-empty and `requiredPermission` is null, the
  transition is reachable — nothing to flag.

If any outgoing `ASSIGNEE_POOL` transition is flagged by the above: set
`isUnassigned: true, unassignedAt: now()` on the newly-created
`WorkflowInstanceStage`, and notify every `TENANT_ADMIN` in the tenant.
Reuse the pattern **already implemented in this same file** —
`notifyTenantAdminsOfCoverageGap()` in `workflow.service.ts` is the
same query shape (`Role.findFirst({ key: 'TENANT_ADMIN' })` →
`UserRole.findMany(...)` → one `NotificationService.create()` per
admin) already proven and already local to `WorkflowService`. Add a
new private method, e.g. `notifyTenantAdminsOfUnassignedStage()`,
mirroring that existing method's exact shape rather than reaching
across to `TaskService`'s copy of the same pattern. The notification
body must name the specific transition (`labelEn`) and the specific
instance (`objectType`/`objectId`, plus the Committee's own `nameEn`
resolved via a join — an instance id alone isn't actionable for an
admin) so the admin knows exactly what to fix, not just "something is
stuck somewhere."

#### 2.5.1 Drift after entry — resolution to Pending Discussion #2

This entry-time check only fires the moment a stage is entered — it
will not catch a Chairman being removed *while* an instance is already
sitting in that stage. **Recommendation: extend
`SlaMonitorProcessor`'s existing 15-minute sweep**, the same job that
already does double duty for `WorkflowInstanceStage` SLA breaches and
`Task` SLA breaches (`sweepOverdueTasks()`) — add a new
`sweepUnassignedStages()` step alongside it, not a new queue. For
every currently-open `WorkflowInstanceStage` (`exitedAt: null`),
re-run the identical entry-time check against its outgoing
`ASSIGNEE_POOL` transitions, and re-evaluate `isUnassigned`
**symmetrically in both directions**: set it if a previously-fine stage
now has no qualifying pool, *and clear it* if a previously-flagged
stage now has a qualifying pool again (e.g. a new Chairman was
appointed) — an admin should not keep seeing a stale alert once the
gap is fixed.

**Precise notify condition (explicit, to prevent a duplicate
notification):** read the stage's `isUnassigned` value **as it stood
before this sweep pass touches it** (`wasUnassigned`), separately
compute the freshly-evaluated result (`isNowUnassigned`) from the pool
check, and send a Tenant Admin notification **only when
`wasUnassigned === false && isNowUnassigned === true`** — a genuine
false→true transition. This is the mechanism that prevents a duplicate
notification when the sweep re-evaluates a stage the entry-time check
already flagged (and already notified about) minutes earlier: in that
case `wasUnassigned` reads back as `true` from the row the entry-time
check wrote, `isNowUnassigned` is also `true` (nothing has changed),
the condition is false, and no second notification fires. The same
condition, read in reverse, is what makes the clear-on-recovery case
silent too: `wasUnassigned === true && isNowUnassigned === false`
updates the row but is not itself a notify condition — recovery is not
called out separately in this design; only the transition into
unassigned pages anyone. No separate configurable "threshold" — the
sweep already runs every 15 minutes unconditionally for its other
checks (SLA breach), and this check is no more expensive than those;
adding a second cadence knob is complexity without a real benefit at
typical committee-pool scale.

#### 2.5.2 Performance — resolution to Pending Discussion #3

**Recommendation: keep the entry-time check synchronous**, inside the
same request that creates the `WorkflowInstanceStage`. This is
consistent with, not a deviation from, how this codebase already
works today: `resolveAssigneeRaw()` is already called synchronously on
every single transition to resolve `CREATE_TASK`/`SEND_NOTIFICATION`
targets, and `fireTransitionActions()` runs its internal actions
synchronously in-request — BullMQ is reserved specifically for
genuinely slow or externally-dependent work (PDF generation, AI calls,
email delivery, virus scanning, and, notably, the `WEBHOOK` action
specifically *because* of its unpredictable external latency, not
because it's "an action fired on transition" in general). Resolving a
committee-sized member list and checking flat permissions against it
is a handful of small, already-cached-connection Prisma queries, not
long-running work — it does not meet this codebase's own bar for
deferring to a background job. The periodic recheck (2.5.1) is already
asynchronous by construction, since it lives inside the existing
`SlaMonitorProcessor` BullMQ job — no new queue is needed anywhere for
this feature.

---

## 3. NON-GOALS (Explicit — Do Not Drift Into These)

- **A generic `ResourceRoleAssignment`/scoped-permission model.**
  Scrapped — see Retrospective Note. Not deferred, not "phase 2" —
  actively rejected as the wrong shape for this problem, given what 2.1
  and 2.2 already cover using existing machinery.
- **Document/CAPA/Audit-specific assignee filter fields** (an
  owners/stakeholders equivalent of `assigneeCommitteeRoleValueId`).
  Deferred until those modules are actually planned — building them now
  would be speculative against modules that don't exist yet.
- **Fixing `submitApproval()`'s missing authority check.** Found during
  this investigation (see Pending Discussion #2) — `submitApproval()`
  (`workflow.service.ts` lines 295–340) has **zero** authority check
  today, not even a flat permission: any authenticated tenant user can
  record a `WorkflowApproval` on any `WorkflowInstanceStage` in their
  tenant merely by knowing its id. This is a real, separate, arguably
  more severe gap than the one `ASSIGNEE_POOL` closes for
  `triggerTransition()`. Explicitly out of scope for this ticket — flagged
  for a decision, not silently fixed as a drive-by.
- **A migration/backfill script.** Not needed — see Section 4, Pending
  Discussion resolution below. This is a real design outcome of the
  smaller fix, not an oversight.
- **Frontend UI for `assigneeCommitteeRoleValueId` / `ASSIGNEE_POOL`.**
  Needed for the feature to be usable, but this document is design-only;
  UI build belongs to the follow-up implementation ticket (see Section
  5's checklist).
- **Unassigned-stage detection for `ROLE_BASED`/`SPECIFIC_USER`
  transitions.** Section 2.5's detection mechanism is scoped to
  `ASSIGNEE_POOL` only — see Pending Discussion #3 below for why this
  is a deliberate scope line, not an oversight, and where the
  `ROLE_BASED`/`SPECIFIC_USER` version of the same underlying risk is
  tracked instead.

---

## 4. PENDING DISCUSSIONS — Re-Evaluated Against the New Design

### Resolved — carried forward from the prior revision

**1. Chairman-only, or also Vice Chairman? — RESOLVED: Chairman-only.**
**Scope note added after Retrospective Note 2**: this decision now
applies only to `assigneeCommitteeRoleValueId`'s first real use (2.1,
the workflow-transition-gated mechanism, unaffected by the Section 2.3
correction) — `assertCommitteeAuthority()` itself was removed entirely,
so it no longer targets any lookup value at all. Originally: the
smallest correct fix, consistent with this project's "don't build for a
hypothetical second case" discipline. `vice_chairman` (or any other
`committee_member_role` value) gaining the same authority in a future
`assigneeCommitteeRoleValueId` configuration is explicitly deferred, not
designed for — revisit only if a real need surfaces.

### Resolved — surfaced directly by this investigation

**2. `submitApproval()`'s missing authority check — RESOLVED: its own
follow-up ticket, sequenced after ACC-28, not folded into it and not
silently dropped.** This gap (Non-Goals, `workflow.service.ts:295–340`
having zero authority check beyond authentication) was found as a
direct side effect of this investigation, not this ticket's own
subject — `submitApproval()` is a separate endpoint from
`triggerTransition()`, with its own controller route and its own
missing check, unrelated to `ASSIGNEE_POOL`'s addition to the latter.
Fixing it here would silently expand this ticket's scope past
"resource-scoped authority for Committees." A dedicated small ticket,
created after ACC-28 merges, is the correct size — likely a single
`@Permissions()`-shaped fix or an `ASSIGNEE_POOL`-equivalent check
reusing this same investigation's findings, not a design exercise.

### Resolved — surfaced by the unassigned-stage-detection investigation (2.5)

**3. SCOPE: `ASSIGNEE_POOL` only, or also `ROLE_BASED`/`SPECIFIC_USER`? —
RESOLVED: `ASSIGNEE_POOL` only for this ticket; track the other
two as a separate, explicitly named follow-up, not silently dropped.**
The same underlying risk ("nobody can ever satisfy this transition's
gate") exists today for `ROLE_BASED` (nobody in the tenant holds
`triggerRoleId`) and arguably `SPECIFIC_USER` (the named user was
deactivated) — both pre-existing, unrelated to this ticket's own
introduction of risk. They are **not**, however, a cheap generalization
of the same check: `ASSIGNEE_POOL`'s check is "does the *stage's
resolved assignee pool* intersect with people holding the *transition's
requiredPermission*" — it depends on `resolveAssigneeRaw()` and the
stage's `assigneeStrategy`. `ROLE_BASED`'s equivalent check would be
structurally different and simpler — "does anyone hold
`triggerRoleId`" directly, with no reference to the stage's
`assigneeStrategy` or pool at all, since `ROLE_BASED` gates independent
of assignee resolution. `SPECIFIC_USER`'s equivalent is a third,
different shape again (is `triggerUserId`'s `User.status` still
`ACTIVE`). Covering all three "in one pass" would mean writing three
separate check implementations under one ticket, not sharing one — a
real scope expansion, not a cheap add-on. Given only `ASSIGNEE_POOL` is
introduced/worsened by this ticket, the recommendation is: implement
2.5 for `ASSIGNEE_POOL` only here, and add a new entry to
`SYSTEM-REFERENCE.md`'s Known Cross-Cutting Gaps (Tier 1 — Urgent,
cheap, per that document's own tiering) covering both the
`ROLE_BASED` and `SPECIFIC_USER` versions of this gap together as one
bundled future fix, since they're thematically the same finding.
**Confirmed by the user.**

**4. DRIFT AFTER ENTRY — RESOLVED: see 2.5.1** (extend
`SlaMonitorProcessor`'s existing 15-minute sweep with a new
`sweepUnassignedStages()` step; symmetric set/clear of `isUnassigned`;
notify only on an explicit `wasUnassigned === false && isNowUnassigned
=== true` transition, read from the row's prior value before the
sweep updates it — the precise condition that also prevents a
duplicate notification when the sweep re-evaluates a stage the
entry-time check already flagged and notified about minutes earlier).
Listed here for discoverability; full reasoning lives in 2.5.1 rather
than duplicated. **Confirmed by the user.**

**5. PERFORMANCE — RESOLVED: see 2.5.2** (synchronous at stage-entry
time, consistent with `resolveAssigneeRaw()` already being called
synchronously elsewhere in the same code path; the periodic recheck in
#4 above is already async by virtue of running inside the existing
BullMQ sweep). Listed here for discoverability; full reasoning lives
in 2.5.2 rather than duplicated. **Confirmed by the user.**

### Dropped — no longer applicable to the new design

**3. (Was: `ResourceType` enum — reuse `WorkflowObjectType` or new
enum?)** Dropped entirely. There is no generic resource-type enum in
this design — `resourceType`/`resourceId` as concepts don't exist
anymore. Noted here explicitly so a reader comparing against the first
revision isn't left wondering where it went.

**4. (Was: lookup→role mapping — fixed default or tenant-customizable?)**
Dropped entirely. There is no `LookupRoleMapping` table and no seeded
"scoped role" concept in this design. Originally illustrated against
`assertCommitteeAuthority()` checking `CommitteeMember.roleValueId`
directly against the `chairman` lookup value with no intermediate
mapping layer — that method no longer exists (Retrospective Note 2),
but the conclusion is unchanged and, if anything, reinforced: the final
design (2.3) doesn't read `roleValueId` for authority purposes at all
anymore, so there is even less surface for a mapping layer to attach to
than there was when this item was first resolved.

**5. (Was: migration/backfill for Committee Management's existing
seeded data?) — UPDATED after Retrospective Note 2, no longer moot.**
Originally resolved as moot: `assertCommitteeAuthority()` read
`CommitteeMember.roleValueId` live at check time, so there was no
derived data anywhere needing a backfill. That reasoning doesn't carry
over to the corrected design — `PermissionGuard`'s check is a snapshot
comparison against a tenant's actual `RolePermission` rows, not a live
computation, and `role.seed.ts`'s change to add 5 new permission
strings only affects `seedSystemRoles()` going forward. Every
already-provisioned tenant's `PLATFORM_ADMIN`/`TENANT_ADMIN`/
`QUALITY_MANAGER` `RolePermission` rows were snapshotted before this
change and need the backfill in `backend/prisma/backfill-committees-resource-permissions.ts`
(Section 2.3) — without it, an existing tenant's `committees:manage`
holders lose access to all four CRUD actions the moment this ships.
This item's original conclusion held for the design that existed when
it was written; it stopped holding the moment the design changed
underneath it, which is exactly why this note exists rather than
silently leaving the old "moot" conclusion in place.

**6. (Was: should other `committee_member_role` values get default
scoped roles?)** Folded into #1 above (Chairman-only vs. also Vice
Chairman) — restated in the new design's terms rather than kept as a
separate item, since "default scoped roles" as a concept no longer
exists.

---

## 5. SUGGESTED FOLLOW-UP IMPLEMENTATION SCOPE

For whoever picks up the implementation ticket after this plan is
reviewed — not this ticket's own acceptance criteria:

- [x] Pending Discussions #1–2 resolved in this document (Section 4) —
      nothing left to decide before implementation starts
- [x] Migration: `WorkflowStage.assigneeCommitteeRoleValueId String?`;
      add `ASSIGNEE_POOL` to `WorkflowTriggerCondition` enum
- [x] `resolveAssigneeRaw()` COMMITTEE case: add the optional
      `roleValueId` filter (2.1)
- [x] `resolveApproverPool()` COMMITTEE case: identical filter, for
      threshold-pool-sizing consistency (2.1)
- [x] `triggerTransition()`: new `ASSIGNEE_POOL` branch, inserted right
      after `fromStage` is resolved (2.2)
- [x] ~~`CommitteesService.assertCommitteeAuthority()` + wire into~~
      **Superseded by Retrospective Note 2 — see the items below instead.**
- [x] `COMMITTEES_PERMISSIONS`: 5 new strings (`CREATE`/`EDIT_DETAILS`/
      `ADD_MEMBER`/`REMOVE_MEMBER`/`CHANGE_MEMBER_ROLE`) (2.3)
- [x] `committees.controller.ts`: specific `@Permissions()` decorator per
      method (`createCommittee`→`CREATE`, `updateCommittee`→
      `EDIT_DETAILS`, `addMember`→`ADD_MEMBER`, `changeMemberRole`→
      `CHANGE_MEMBER_ROLE`, `removeMember`→`REMOVE_MEMBER`); no
      `@CurrentUserPermissions()`, no `userPermissions` threading (2.3)
- [x] `committees.service.ts`: `assertCommitteeAuthority()` deleted
      entirely, `userPermissions` parameter removed from all 4 methods
      (2.3)
- [x] `backend/prisma/backfill-committees-resource-permissions.ts` +
      `npm run backfill:committees-resource-permissions` script entry —
      grants the 5 new permissions to existing tenants'
      `PLATFORM_ADMIN`/`TENANT_ADMIN`/`QUALITY_MANAGER` roles (2.3,
      Pending Discussion #5)
- [x] Run the backfill against the real dev DB and confirm the summary
      output (same verification step ACC-16/ACC-22's equivalent
      backfills each recorded in their own commit) — 2 organizations
      (platform, demo-org), 30 RolePermission rows created on first run,
      confirmed idempotent on re-run (0 created, 6/6 already complete)
- [x] Frontend: `assigneeCommitteeRoleValueId` field on
      `workflow-stage-form.component.ts` (shown only when
      `assigneeStrategy === COMMITTEE`, options from the
      `committee_member_role` lookup category); `ASSIGNEE_POOL` added to
      `workflow-transition-editor.component.ts`'s `triggerCondition`
      options
- [x] **Prerequisite gap found and closed while doing the above**:
      `assigneeCommitteeRoleValueId` had a read path
      (`resolveAssigneeRaw()`/`resolveApproverPool()`) but **no write
      path at all** — `CreateWorkflowStageDto`, `addStage()`/
      `updateStage()`, `mapStage()`, and `IWorkflowStage` never carried
      it, so the field couldn't be set via the API regardless of any
      frontend wiring. Closed: DTO field +
      `validateCommitteeRoleValueId()` (same pattern as
      `validateAssigneeUserId()`/`validateCommitteeId()` in the same
      file) + create/update/map wiring, with tests. This was missed
      when Section 2.1 was originally implemented — that checkpoint's
      "engine changes" only touched `workflow.service.ts` (the runtime
      read path), not `workflow-template.service.ts` (the tenant-admin
      config write path).
- [ ] **Note, not a fix required by this ticket**:
      `WorkflowTransitionActionsComponent`'s existing, self-documented
      limitation — it filters rendered buttons by `requiredPermission`
      only, not `triggerCondition` (SYSTEM-REFERENCE.md Section 10.6) —
      applies identically to `ASSIGNEE_POOL`. A user who passes the flat
      `requiredPermission` check but isn't in the resolved assignee pool
      will see the transition button rendered and get a 403 on click.
      Expected, same accepted category as the component's existing
      `SYSTEM_AUTOMATIC` blind spot — both are "button shown, server
      correctly rejects" rather than "button hidden," and both are
      already tracked as the same known limitation, not two separate
      ones.
- [x] Tests: `resolveAssigneeRaw()`/`resolveApproverPool()` filter
      correctness (set vs. unset field, backward compatibility on
      existing seeded stages); `ASSIGNEE_POOL` gating (pool member
      passes, non-member blocked)
- [x] Tests (superseding the old flat-OR-Chairman coverage, per
      Retrospective Note 2): each of the 5 `CommitteesController`
      methods rejects a caller lacking its specific permission and
      accepts one holding it; a role holding only `committees:manage`
      (no narrower grants) still performs all 5 actions, purely because
      seed data grants the whole bundle upfront (`committees.permissions.spec.ts`)
- [x] **Correction, caught by explicit review**: the checklist item
      above originally also claimed "tenant isolation holds for all 5"
      on the strength of `PermissionGuard`'s own tenant-scoped
      permission *resolution* — true, but a different concern from
      whether each method's own service-layer *data query*
      (`getCommitteeById()`) correctly rejects a `committeeId`
      belonging to a different org. That was untested for 3 of the 4
      corrected methods (`addMember`/`changeMemberRole`/`removeMember`
      — only `updateCommittee` had it, predating ACC-28). Root cause:
      the removed `assertCommitteeAuthority()` tests proved the
      Chairman-lookup mechanism itself didn't leak across tenants — a
      different, now-deleted code path — not this. Added the 3 missing
      tests to `committees.service.spec.ts`, matching
      `updateCommittee`'s own existing style.
- [ ] Open the separate follow-up ticket for `submitApproval()`'s gap
      (Pending Discussion #2 — decided: own ticket, sequenced after
      ACC-28, not part of this ticket's own scope)
- [x] Pending Discussions #3–5 resolved in this document (Section 4) —
      unassigned-stage detection scope, drift-after-entry recheck, and
      performance. Nothing left to decide before 2.5 implementation
      starts.
- [x] Migration: `WorkflowInstanceStage.isUnassigned Boolean
      @default(false)`, `.unassignedAt DateTime?` (2.5)
- [x] Entry-time check in `startInstance()` and inside
      `performTransition()`: for each outgoing `ASSIGNEE_POOL`
      transition from the newly-created stage, resolve the pool and
      check it against `requiredPermission` (including the empty-pool
      case regardless of `requiredPermission`); set
      `isUnassigned`/`unassignedAt` and notify Tenant Admins when
      nothing qualifies (2.5)
- [x] `notifyTenantAdminsOfUnassignedStage()` — new private method on
      `WorkflowService`, mirroring the existing
      `notifyTenantAdminsOfCoverageGap()`'s query shape; message must
      name the specific transition and instance/committee (2.5)
- [x] `SlaMonitorProcessor.sweepUnassignedStages()` — periodic recheck
      of all open stages' outgoing `ASSIGNEE_POOL` transitions,
      symmetric set/clear of `isUnassigned`, notify only on the
      transition into unassigned (2.5.1)
- [x] Open the separate follow-up entry in `SYSTEM-REFERENCE.md`'s
      Known Cross-Cutting Gaps (Tier 1) for the `ROLE_BASED`/
      `SPECIFIC_USER` version of the unassigned-transition gap
      (Pending Discussion #3 — not part of this ticket's own scope) —
      added during `/ready-to-pr`'s foundational-mechanism check
- [x] Tests (2.5): empty-pool flags regardless of `requiredPermission`;
      non-empty pool with nobody holding `requiredPermission` flags;
      non-empty pool with a qualifying member does not flag; sweep
      clears a previously-flagged stage once a qualifying member
      exists; sweep does not re-notify on every pass once already
      flagged; notification content names the transition and
      instance/committee; tenant isolation on the pool/permission
      resolution (same rigor as every other ACC-17-pattern check)
