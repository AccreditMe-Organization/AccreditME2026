# Step 46 — Manager/Escalation Redesign: Invite-Time Guarantees, User Transfer, Escalation Rework

ACC-46 (anticipated ticket number — not yet created): design-only. No
implementation code, no schema migration, is produced under this
document — this is the plan a follow-up implementation ticket will
build from, same process as ACC-28 (`step-28-resource-scoped-roles.md`)
and ACC-40 (`step-40-org-position-unit-head.md`).

Every claim about current-state behavior in this document was
confirmed directly against the code (file:line references throughout)
or, for the Section 1 race condition, reproduced live against a
running dev server — not assumed or inferred from comments alone.

**Revision history**: Pending Discussions #1–5 and #7 decided (Ahmad's
review); #6 superseded outright by Section 2.7's complete rewrite and
removed, not left as answered-by-reference. Section 2.6 (user transfer)
substantially rewritten around a genuine multi-step wizard model with
live validation gates. Section 2.7 (escalation) completely rewritten
around fully automatic Manager-then-Head resolution, informed by a
dedicated investigation into Task's actual SLA/due-date architecture
that surfaced findings the original 2.7 didn't have — including a
second, independent live bug in the current escalation sweep. Pending
Discussions #8–9 (surfaced by that rewrite) subsequently decided.
**Final pre-approval verification pass**: `OrgUnitHeadService.
assignHead()`'s actual implementation was read directly (not assumed)
to check its safety when called from inside `transferUser()`'s
promotion path — a real, confirmed bug was found (would have silently
skipped the promoted person's role grant) and fixed, which in turn
required revising 2.6's transaction design (2.6.c, 2.6.h). All
Pending Discussions raised across every pass are now Decided — see
Section 4, which is empty of open items.

---

## 1. OVERVIEW

### What This Document Is

A full design for seven related pieces of work:

1. A live, exploitable race condition in `invite()`'s position/head
   uniqueness protection — **fix first, blocks everything else**.
2. A related, narrower validation gap in `updateProfile()`.
3. Making `managerId` mandatory on invite, with an org-unit-scoped
   picker auto-defaulted to the unit's current Head.
4. A hard block on inviting into a headless unit.
5. A one-line bootstrap change (`Director` becomes head-conferring)
   that makes rule 4 satisfiable from a tenant's very first invite.
6. A new capability — a guided, multi-step wizard for transferring an
   existing active user between org units, including promotion
   (becoming a different unit's Head) and succession (handing off
   direct reports).
7. A full rework of task escalation — fully automatic Manager-then-Head
   resolution, tenant-configurable two-tier timing thresholds, and a
   real settings UI to configure them (currently entirely dead).

### Why This Is Needed

Confirmed via a dedicated investigation: moving a user's org unit
today is a bare side effect of the general `updateProfile()` admin
edit — no dedicated "transfer" concept exists anywhere in the
codebase. Confirmed via a second, urgent investigation: `invite()`'s
only protection against creating a duplicate single-assignee/
head-conferring position holder (`validatePositionAssignment()`) is
blind to `INVITED`-status users, making it trivially bypassable with
two ordinary sequential invites — reproduced live, not reasoned about.
Confirmed via a third investigation: `Task.escalationUserId`/
`escalationAfterHours` are dead fields nothing has ever set, and the
sweep that would fire escalation has its own independent bug that
would prevent it from ever firing even if they were set. All three are
closed here as the foundation the rest of this plan is built on, not
deferred.

---

## 2. PROPOSED DESIGN

### 2.1 Fix First — The `INVITED`-Status Race Condition

**Confirmed root cause** (reproduced live): `validateSingleAssigneeCap()`
and `validateUnitHeadUniqueness()` (`user.service.ts:526-590`) both
filter their conflict-count query on `status: 'ACTIVE'` only. `invite()`
creates the new row with `status: 'INVITED'` — invisible to both
checks. A second `invite()` call to the identical
`(positionId, primaryOrgUnitId)` pair, made before the first invitee
accepts, finds zero `ACTIVE` holders and passes. `AuthService.
acceptInvitation()` (`auth.service.ts:403-448`) then flips `status:
'ACTIVE'` unconditionally on a valid token, with **no** call to
`validatePositionAssignment()` or any other conflict check. Live
reproduction: two users, invited sequentially to the same
head-conferring single-assignee position in the same unit, both
reached `ACTIVE` holding it with zero rejections anywhere, and
`OrgUnitHeadService.getHeadStatus()` afterward reported both as
`holders` for the same unit.

**Design — Layer 1, close the query gap:**

```ts
// validateSingleAssigneeCap() — user.service.ts:540-548
const existingHolders = await this.prisma.user.count({
  where: {
    organizationId,
    positionId: position.id,
    primaryOrgUnitId: targetPrimaryOrgUnitId,
    status: { in: ['ACTIVE', 'INVITED'] },   // was: 'ACTIVE'
    ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
  },
});
```

Same change to `validateUnitHeadUniqueness()`'s query
(`user.service.ts:578-586`). No signature change to either method —
`validatePositionAssignment()`'s own public signature is untouched.
This alone closes the double-invite gap.

**Design — Layer 2, defense in depth at `acceptInvitation()`:**

```ts
// auth.service.ts — inside acceptInvitation(), before signUpEmail()
if (user.positionId) {
  await this.userService.validatePositionAssignment(
    user.positionId,
    user.primaryOrgUnitId,
    user.organizationId,
    user.id,   // excludeUserId — the accepting user's own row never
               // self-conflicts once Layer 1 also counts INVITED
  );
}
```

Fully reuses `validatePositionAssignment()` — no duplicated logic.
`excludeUserId: user.id` is what makes this safe to call unconditionally
on every acceptance, not just the racing ones.

**DI change required**: `AuthService` does not currently inject
`UserService`. Confirmed safe to add — `AuthModule` already imports
`UserModule` as a plain (non-`forwardRef`) import (`auth.module.ts` —
its own comment confirms `UserModule` does not import `AuthModule`, so
no cycle), and `AuthController` already injects `UserService` today.

**The failure mode**: at the point this check runs, the person already
has a real `User` row (`INVITED`) but has **not yet** created their
Better Auth credential — `signUpEmail()` is the very next line.
Placing the check **before** `signUpEmail()` means a rejection here
has zero side effects: no Better Auth account is ever created, the
`User` row stays exactly as it was. This is the only safe placement.

**DECIDED (this pass)** — response shape: `ConflictException`,
message: `"This position is no longer available in this org unit —
contact your administrator"`. **The invitation token is preserved**,
not burned — distinct from the generic "Invalid or expired invitation"
case, which does end the token's usefulness by design. The conflict
may resolve on its own (the competing invite naturally expires in 7
days, or a tenant admin manually reassigns one of the two), and the
token itself was never compromised, only currently blocked. The person
can retry the exact same accept-invitation link later without a new
invite.

**DECIDED (this pass)** — tenant admins **are** notified when this
rejection occurs, matching the existing `notifyTenantAdminsOf*` pattern
(`notifyTenantAdminsOfIncompleteProfiles()`, `user.service.ts:272-313`,
is the closest direct precedent, reusing the exact `Role.findFirst({key:
'TENANT_ADMIN'}) → UserRole.findMany() → NotificationService.create()`
chain already established across this codebase). New method on
`UserService`:

```ts
async notifyTenantAdminsOfInviteAcceptanceConflict(
  invitedUserName: string,
  organizationId: string,
): Promise<void> {
  const adminRole = await this.prisma.role.findFirst({ where: { organizationId, key: 'TENANT_ADMIN' } });
  if (!adminRole) return;
  const adminUserRoles = await this.prisma.userRole.findMany({
    where: { roleId: adminRole.id, user: { organizationId, status: 'ACTIVE' } },
  });
  for (const userRole of adminUserRoles) {
    await this.notificationService.create(
      {
        userId: userRole.userId,
        titleEn: 'Invitation acceptance blocked — position conflict',
        titleAr: 'تعذّر قبول الدعوة — تعارض في المسمى الوظيفي',
        bodyEn: `${invitedUserName} tried to accept their invitation, but the position/org unit is already held by another active user. Review and reassign one of the two pending invitations.`,
        bodyAr: `حاول ${invitedUserName} قبول دعوته، لكن المسمى الوظيفي/الوحدة التنظيمية مشغولة بالفعل من قبل مستخدم نشط آخر. راجع الدعوتين المعلّقتين وأعد تعيين إحداهما.`,
      },
      organizationId,
    );
  }
}
```

Called from `AuthService.acceptInvitation()`'s `catch` around the
Layer 2 check, before re-throwing the `ConflictException` to the
caller.

### 2.2 The Separate, Narrower `updateProfile()` Gap

**Confirmed current code** (`user.service.ts:332-344`):

```ts
if (dto.positionId !== undefined) {
  const targetPrimaryOrgUnitId =
    dto.primaryOrgUnitId !== undefined ? dto.primaryOrgUnitId : existing.primaryOrgUnitId;
  await this.validatePositionAssignment(dto.positionId, targetPrimaryOrgUnitId, organizationId, id);
}
```

The guard is keyed on `dto.positionId !== undefined` only. A PATCH
that changes **only** `primaryOrgUnitId` never calls
`validatePositionAssignment()` at all.

**Fix**:

```ts
if (dto.positionId !== undefined || dto.primaryOrgUnitId !== undefined) {
  const targetPositionId =
    dto.positionId !== undefined ? dto.positionId : existing.positionId;
  const targetPrimaryOrgUnitId =
    dto.primaryOrgUnitId !== undefined ? dto.primaryOrgUnitId : existing.primaryOrgUnitId;
  if (targetPositionId) {
    await this.validatePositionAssignment(targetPositionId, targetPrimaryOrgUnitId, organizationId, id);
  }
}
```

**This fix, on its own, only protects `updateProfile()`.** The new
`transferUser()` capability (Section 2.6) is a separate service
method and must independently satisfy the same discipline — enforced
throughout 2.6's wizard design below, not left to be rediscovered.

### 2.3 Mandatory Manager

**Confirmed current state**: `invite-user.component.ts`'s manager
picker fetches every `ACTIVE` user tenant-wide via `userService.
listUsers({ status: 'ACTIVE' })` — no `orgUnitId` filter passed, even
though both frontend and backend already support one.

**Backend DTO change** — `InviteUserDto`:

```ts
@IsString()
@IsNotEmpty()
managerId!: string;   // was: @IsOptional() managerId?: string
```

Not a blanket-required decorator — matches `primaryOrgUnitId`'s own
existing conditional-required precedent. Enforced in `UserService.
invite()`:

```ts
const targetPosition = await this.prisma.orgPosition.findFirst({ where: { id: dto.positionId, organizationId } });
const targetOrgUnit = dto.primaryOrgUnitId
  ? await this.prisma.orgUnit.findFirst({ where: { id: dto.primaryOrgUnitId, organizationId } })
  : null;
const isRootUnitHeadInvite = !!targetPosition?.isUnitHeadPosition && !!targetOrgUnit && targetOrgUnit.parentId === null;

if (!dto.managerId && !isRootUnitHeadInvite) {
  throw new BadRequestException('managerId is required for every invite except the root unit\'s own Head');
}
```

**DECIDED (this pass)** — the exemption is scoped narrowly:
**only** the person being invited *as* the root unit's Head is
manager-exempt. An ordinary staff invite into the root unit (not as
its Head) still requires a manager under this design.

**Frontend — org-unit-scoped picker, auto-defaulted to the unit's
current Head** (`invite-user.component.ts`):

- Wire the already-supported `orgUnitId` filter through, re-fetched
  whenever `primaryOrgUnitId`'s `valueChanges` fires.
- Auto-default: on the same change, fetch the selected unit's current
  Head via `hasDirectOrActingHead()`/`getHeadStatus()` (2.4 below),
  `patchValue({ managerId: headUserId })` — still a plain editable
  control afterward, not disabled.
- `managerId`'s form control gains `Validators.required`, conditionally
  removed when `isRootUnitHeadInvite` is detected client-side, matching
  `primaryOrgUnitRequired()`'s own existing conditional-validator
  pattern on this exact form.

### 2.4 Hard Invite-Block Rule — No Head, No Invite

**Rule**: cannot invite anyone into a unit with no direct Head **and**
no Acting Head. Escalation coverage from a parent unit does **not**
count — this rule only ever looks at the target unit itself.

**Confirmed gap found during this investigation**: `OrganizationService.
create()` never calls `refreshOrgUnitHeadVacancy()` on the unit it just
created, and `OrgUnit.isHeadVacant` defaults `false` at the schema
level — so a genuinely headless, freshly-created unit reads as "has a
head" via that cache until something else triggers a refresh.

**Design decision: don't use the cache.** `OrgUnitHeadService.
getHeadStatus()` already computes the identical condition **live**,
every call. Extract its shared logic into a reusable boolean:

```ts
// OrgUnitHeadService — new method, getHeadStatus() refactored to call it
async hasDirectOrActingHead(orgUnitId: string, organizationId: string): Promise<boolean> {
  const orgUnit = await this.getOrgUnitOrThrow(orgUnitId, organizationId);
  const directHolderCount = await this.prisma.user.count({
    where: { organizationId, primaryOrgUnitId: orgUnitId, status: 'ACTIVE', position: { isUnitHeadPosition: true } },
  });
  return directHolderCount > 0 || !!orgUnit.actingHeadUserId;
}
```

**DI**: `UserService` already `forwardRef(() => OrganizationModule)`,
which already exports `OrgUnitHeadService` — zero new circular-dependency
risk.

**Enforcement point — `UserService.invite()`**:

```ts
const isInviteeTheUnitsOwnHead = !!targetPosition?.isUnitHeadPosition;
if (dto.primaryOrgUnitId) {
  const hasHead = await this.orgUnitHeadService.hasDirectOrActingHead(dto.primaryOrgUnitId, organizationId);
  if (!hasHead && !isInviteeTheUnitsOwnHead) {
    throw new ConflictException('This org unit currently has no Head or Acting Head — assign one before inviting new staff into it');
  }
}
```

Inviting someone **as** the target unit's own Head-conferring position,
into a unit with no Head yet, is the rule's own escape valve — filling
the vacancy, not violating the rule.

**The cache-staleness gap is worth fixing on its own** — `Organization
Service.create()` should call `refreshOrgUnitHeadVacancy()` immediately
after creating a unit, the same fix shape ACC-43 already applied to
`invite()` — but this plan has no hard dependency on it (2.4 reads
live, never the cache).

### 2.5 Bootstrap Change — `Director` Becomes Head-Conferring

**Confirmed current seed**: all 10 `DEFAULT_POSITIONS` entries are
`{nameEn, nameAr, grade}` only; `isSingleAssignee`/`isUnitHeadPosition`
both default `false` at the schema level, and `seedDefaultPositions()`'s
`create()` call never overrides either — so `Director` (the tenant's
first admin's position) is `isUnitHeadPosition: false` today.

**Design**:

```ts
// org-position.seed.ts
export interface DefaultPositionSeed {
  nameEn: string;
  nameAr: string;
  grade: number;
  isUnitHeadPosition?: boolean;
}

export const DEFAULT_POSITIONS: DefaultPositionSeed[] = [
  { nameEn: 'Director', nameAr: 'مدير عام', grade: 10, isUnitHeadPosition: true },
  { nameEn: 'Deputy Director', nameAr: 'نائب المدير العام', grade: 9 },
  // ...unchanged
];
```

```ts
// org-position.service.ts — seedDefaultPositions()
await this.prisma.orgPosition.create({
  data: {
    organizationId,
    nameEn: position.nameEn,
    nameAr: position.nameAr,
    grade: position.grade,
    isUnitHeadPosition: position.isUnitHeadPosition ?? false,
    isSingleAssignee: position.isUnitHeadPosition ?? false,   // schema-enforced pairing — must be set together, since seeding bypasses createPosition()'s own validateHeadFlagPairing()
  },
});
```

**Confirmed implementation detail**: `seedDefaultPositions()` calls
`prisma.orgPosition.create()` directly, bypassing
`OrgPositionService.createPosition()` and its
`validateHeadFlagPairing()` check — the seed data itself must satisfy
the pairing invariant.

**`roleId`**: left `null`, deliberately. The tenant's first admin gets
`TENANT_ADMIN` via a **direct** role assignment
(`PlatformTenantService.createTenant()`), never through the
head-authority grant chain (`syncHeadAuthorityRoleGrant()` only fires
when `position.roleId` is set). Setting `Director.isUnitHeadPosition:
true` with `roleId: null` gives the tenant admin real Head status on
the root unit without duplicating or interfering with their existing,
separate `TENANT_ADMIN` grant.

**Effect**: `TenantService.bootstrap()` already guarantees both the
root `OrgUnit` and the `Director` position exist before
`resolveDefaultTenantAdminAssignment()` runs. With this change, the
tenant admin is that unit's real Head from the moment their invite is
accepted, satisfying 2.4's rule immediately for every subsequent
invite into the root unit.

### 2.6 User Transfer — A Guided, Multi-Step Wizard

**Revised model (this pass)**: this is designed as a genuine
multi-step wizard, not a single-submit form — every step that touches
a shared, contended resource (a position, a manager) is gated by a
live server-side validation call **before the wizard is allowed to
advance to the next step**. The final submit still independently
re-validates everything from scratch, inside a transaction — the
step-by-step gates are a UX convenience (fail fast, guide the user,
narrow pickers to only genuinely valid choices), never the sole
authority. This mirrors the same two-layer discipline 2.1 already
established (prevention at the point of choice, defense-in-depth at
the point of commitment).

**Confirmed nothing reusable exists today** for the underlying
mechanics: no `directReports` (the `User.manager` back-relation) bulk-
reassignment logic anywhere in `backend/src` — confirmed via a full
grep, zero production hits.

#### 2.6.a New Read Query — Which Positions Are Available for This User in Unit U

**Generalized from the original design**, per Decision #2 below: the
wizard now always needs a "which positions can this specific person
hold in this specific unit" list, not only head-conferring ones — an
**ordinary** single-assignee position (not head-conferring) needs the
identical exclusion logic, which the original head-only design would
have missed.

```ts
// OrgPositionService — new method
async listAvailablePositionsForUser(
  candidateUserId: string,
  orgUnitId: string,
  organizationId: string,
): Promise<IOrgPosition[]> {
  const allPositions = await this.prisma.orgPosition.findMany({
    where: { organizationId, isActive: true },
  });
  const heldSingleAssigneePositionIds = new Set(
    (
      await this.prisma.user.findMany({
        where: {
          organizationId,
          primaryOrgUnitId: orgUnitId,
          status: { in: ['ACTIVE', 'INVITED'] },   // matches 2.1's fix
          position: { isSingleAssignee: true },
          id: { not: candidateUserId },
        },
        select: { positionId: true },
      })
    ).map((u) => u.positionId),
  );
  return allPositions.filter((p) => !p.isSingleAssignee || !heldSingleAssigneePositionIds.has(p.id));
}
```

Filters on `isSingleAssignee` (not `isUnitHeadPosition`) — correctly
covers both ordinary single-assignee positions and head-conferring
ones (which are always single-assignee, by the schema-enforced
pairing) in one query. Ordinary multi-assignee positions always pass
through untouched.

#### 2.6.b — The Wizard's Steps

**Step 1 — Destination Unit.** Pick `destinationOrgUnitId`. Trivial
validation (unit exists, active). Triggers Step 2's context load.

**Step 2 — Context Load** (automatic, not a user action):

```ts
// GET /users/:id/transfer/context?destinationOrgUnitId=X
// UserService — new method
async getTransferContext(userId: string, destinationOrgUnitId: string, organizationId: string): Promise<ITransferContext> {
  const hasActiveDirectReports = (await this.prisma.user.count({
    where: { managerId: userId, organizationId, status: 'ACTIVE' },
  })) > 0;
  const availablePositions = await this.orgPositionService.listAvailablePositionsForUser(userId, destinationOrgUnitId, organizationId);
  const headStatus = await this.orgUnitHeadService.getHeadStatus(destinationOrgUnitId, organizationId);
  return {
    hasActiveDirectReports,
    availablePositions,
    currentDestinationHead: headStatus.holders[0] ?? null,
  };
}
```

Drives which subsequent steps the wizard shows (Step 3 only if
`hasActiveDirectReports`), pre-fills the position picker (Step 4) with
only genuinely available choices, and pre-fills the manager step's
(Step 5) default.

**Step 3 — Replacement** (conditional — only when Step 2 reported
active direct reports). Picker scoped to the SOURCE unit, `ACTIVE`
users only, excluding the departing person. **Live gate before
advancing**:

```ts
// POST /users/:id/transfer/validate-replacement — { replacementUserId }
// Checks: replacement exists, status === 'ACTIVE', primaryOrgUnitId === departing user's own SOURCE unit
// (matching OrgUnitHeadService.assignHead()'s own existing precedent for this exact shape of check),
// AND that they can legitimately inherit the departing person's current position:
await this.userService.validatePositionAssignment(
  user.positionId, user.primaryOrgUnitId, organizationId, user.id,   // excludeUserId: the departing person's own row — they're vacating this exact position
);
```

**Step 4 — Destination Position.** **Always** collected as its own
explicit step, for every transfer — resolves original Pending
Discussion #2 by generalizing the answer rather than leaving it
case-specific: there is no "leave it unset for later" path anymore, in
any case. Picker shows only `Step 2`'s `availablePositions`. **Live
gate before advancing**:

```ts
// POST /users/:id/transfer/validate-position — { destinationOrgUnitId, newPositionId }
await this.userService.validatePositionAssignment(
  dto.newPositionId, dto.destinationOrgUnitId, organizationId, user.id,
);
// 204 on success, or the specific ConflictException validatePositionAssignment() throws.
```

This is the step with genuine multi-user race exposure — the
`availablePositions` list from Step 2 is a snapshot; another admin
could assign the same single-assignee position to someone else in the
meantime. This explicit re-validation, right before the wizard
advances, is what closes that window — not merely trusting the
earlier snapshot.

**Whether this transfer is a promotion is now derived, not caller-
declared**: `isPromotion = newPosition.isUnitHeadPosition` — there is
no separate `newHeadPositionId` field distinguishing an "ordinary"
transfer from a "promotion" one; picking a head-conferring position
*is* what makes it a promotion.

**Step 5 — New Manager.**

- **If `isPromotion`**: **not a user choice** — derived automatically,
  per 2.6.d below, and shown read-only in the wizard ("this person
  will report to X, Head of [parent unit]" or "no manager — this is
  the organization's root Head"). Any caller-supplied `newManagerId`
  is silently ignored, matching `updateProfile()`'s own established
  "admin-only fields silently excluded, not rejected" convention for
  a field that doesn't apply in this mode.
- **If not `isPromotion`**: picker scoped to the destination unit,
  `ACTIVE` users only, auto-defaulted to `Step 2`'s
  `currentDestinationHead` — still editable. **Required** in this
  branch (`BadRequestException` if omitted). **Fixed in this pass**
  (flagged in review — the original design only checked destination-
  unit membership, not status; applied identically here since Case A
  and Case B now share this one code path, not two separate ones):

  ```ts
  const manager = await this.prisma.user.findFirst({
    where: { id: dto.newManagerId, organizationId, status: 'ACTIVE', primaryOrgUnitId: dto.destinationOrgUnitId },
  });
  if (!manager) {
    throw new ConflictException('newManagerId must be an active user belonging to the destination org unit');
  }
  ```

  No separate live-validate endpoint for this step — unlike positions,
  an ordinary manager choice has no genuine multi-user race condition
  to close early (the person either belongs to the unit and is active,
  or they don't — a much rarer edge to hit mid-wizard than a
  single-assignee position collision). The final submit's own
  re-validation still covers it.

**Step 6 — Review & Confirm.** Final submit — `POST /users/:id/transfer`.

```ts
// dto/transfer-user.dto.ts — new file
export class TransferUserDto {
  @IsString() @IsNotEmpty()
  destinationOrgUnitId!: string;

  @IsString() @IsNotEmpty()
  newPositionId!: string;   // always required now — see Step 4

  @IsString() @IsOptional()
  newManagerId?: string;   // required for a non-promotion transfer, ignored for a promotion — enforced in the service, not via class-validator

  @IsString() @IsOptional()
  replacementUserId?: string;   // required only when the departing person has active direct reports
}
```

```ts
// Return type widened from a plain IUser — see 2.6.c/2.6.e: a
// promotion's own Head-assignment step can fail even after the core
// transfer has already committed, and the caller needs to be told
// that distinctly, not have it look like total failure or be silently
// swallowed into an ordinary success.
export interface ITransferResult {
  user: IUser;
  promotionCompleted: boolean;   // always true for a non-promotion transfer or a successful promotion; false only for the specific partial-failure case in 2.6.e
  promotionError?: string;       // present only when promotionCompleted is false — assignHead()'s own thrown message, verbatim
}

async transferUser(
  userId: string,
  dto: TransferUserDto,
  organizationId: string,
  actorId: string,
): Promise<ITransferResult>
```

**Full re-validation on submit, never trusting the wizard's own step
gates**: every check described in Steps 1–5 above runs again, fresh,
inside `transferUser()` itself. `UserController`'s own handler maps
`result.user` through `toSafeUser()` before returning, matching
ACC-45's now-established response-shaping discipline for every
`User`-returning endpoint — `promotionCompleted`/`promotionError` pass
through unchanged alongside it.

#### 2.6.c — Execution Order

**Verified before finalizing this plan — `assignHead()` is NOT
safe to call after step 6 pre-sets `positionId`, confirmed by reading
its actual implementation, not assumed.** `OrgUnitHeadService.
assignHead()` (`org-unit-head.service.ts:386-457`) derives its own
"old position" by fetching the target user **fresh from the DB inside
itself** — `const targetUser = await this.prisma.user.findFirst({
where: { id: dto.userId, organizationId, status: 'ACTIVE' } })` — not
from any parameter describing the true prior state. If step 6 (as
originally drafted) had already set `positionId: dto.newPositionId`
before step 7 calls `assignHead()`, that internal fetch would read
`targetUser.positionId` as **already equal** to `dto.positionId`. Its
own trailing call —

```ts
await this.userService.syncHeadAuthorityRoleGrant(
  targetUser.id,
  targetUser.positionId,   // would already equal dto.positionId — the bug
  orgUnitId,
  dto.positionId,
  orgUnitId,
  organizationId,
  actorId,
);
```

— feeds `syncHeadAuthorityRoleGrant()` an "old" position identical to
the "new" one. Its very first line, `if (oldPositionId === newPositionId
&& oldOrgUnitId === newOrgUnitId) return;`, would fire immediately and
**silently no-op**. Net effect: the promoted person would correctly end
up holding the Head position (the `user.update` inside `assignHead()`
itself still runs — that part reads `dto.positionId` directly, not the
stale fetch), but if that position has an associated `roleId`, **the
role grant would never fire** — a real, silent authority-provisioning
gap for every promotion whose Head position maps to a role. Confirms
your suspicion precisely: not genuinely safe/idempotent as originally
drafted. Applying your proposed fix (b):

**Fix — step 6 skips `positionId` entirely when `isPromotion`,
deferring wholly to `assignHead()`:**

```ts
await tx.user.update({
  where: { id: user.id },
  data: {
    primaryOrgUnitId: dto.destinationOrgUnitId,
    managerId: resolvedNewManagerId,
    ...(isPromotion ? {} : { positionId: dto.newPositionId }),
  },
});
```

This closes the reported bug — `assignHead()`'s own internal fetch, for
a promotion, now correctly reads the person's true prior `positionId`
(whatever they held before the transfer) as "old," `dto.positionId` as
"new," and the role grant fires exactly as it does for any other
ordinary `assignHead()` call.

**A second, related problem this same trace surfaced, not directly
asked about but load-bearing for the fix above**: closing the
positionId bug means `assignHead()` (step 11 in the full order below)
**must actually run** for every promotion — but `assignHead()`'s entire implementation, and
everything it calls (`validatePositionAssignment()`,
`syncHeadAuthorityRoleGrant()`, `OrganizationService.
refreshOrgUnitHeadVacancy()`), reads and writes through the plain
injected `this.prisma`, never a transaction client passed by a caller.
Calling it from inside `transferUser()`'s own `prisma.$transaction(async
(tx) => {...})` callback (2.6.h) means its internal queries run on a
**separate connection**, outside that transaction — they would not see
step 6's own not-yet-committed `primaryOrgUnitId` update (so
`assignHead()`'s own `targetUser.primaryOrgUnitId !== orgUnitId` guard
would incorrectly throw against still-uncommitted state), and if
`transferUser()`'s transaction later rolled back for an unrelated
reason, `assignHead()`'s own already-committed writes would **not** roll
back with it — exactly the partial-failure risk 2.6.h's own transaction
was introduced to prevent, now reintroduced through this one delegated
call.

**Design decision, needed to make the (b) fix actually work**:
`transferUser()`'s transaction boundary is split around the promotion
step, rather than one single transaction wrapping everything:

1. `prisma.$transaction()` #1 — every step **except** `assignHead()`
   itself: load/validate, the Case B cascade, the transferred person's
   own `primaryOrgUnitId`/`managerId` update (`positionId` included
   only when **not** `isPromotion`), the `UserTransferEvent` write.
   Commits first.
2. **Then**, only for `isPromotion`, call `OrgUnitHeadService.
   assignHead()` as its own separate, already-internally-atomic unit of
   work (it is not itself wrapped in an outer transaction today, and
   isn't being changed here) — its own internal fetch now correctly
   sees the just-committed `primaryOrgUnitId`.

**Accepted tradeoff, stated explicitly rather than silently**: if
`assignHead()` fails after step 1's transaction has already committed,
the transfer is left in a partial-but-recoverable state — the person
has moved unit and manager, but does not yet hold the destination
Head position. Recoverable via the existing, already-shipped
`assignHead()` endpoint directly (no new repair mechanism needed) —
judged an acceptable, narrower gap than the alternative (refactoring
`assignHead()`'s entire call chain — four existing, already-shipped
methods across three services — to thread an optional transaction
client through all of them, solely to make this one promotion path
fully atomic). Flagged here for visibility, not buried — a real,
deliberate scope choice on a genuine correctness question, not an
oversight.

**`UserTransferEvent`'s write timing — confirmed explicitly, not left
to implementation-time chance.** The event's own justification (2.6.f,
Decision #4) is being a trustworthy, queryable history of what actually
happened. For a promotion specifically, "what actually happened" is
only known once `assignHead()` (step 11 below) resolves — writing
`isPromotion: true` *before* that call even runs would record intent,
not outcome, and would leave a **factually wrong** row permanently
committed if `assignHead()` then failed (2.6.h's own accepted
partial-failure case). **Decided: record confirmed outcome, not
intent.** Consequently the event write's position in the step order is
itself conditional:

- **Non-promotion transfer**: no `assignHead()` call exists in this
  branch at all — nothing is pending, nothing can retroactively
  invalidate the row. The event write stays inside transaction #1,
  fully atomic with the rest of the transfer, same as originally
  designed.
- **Promotion**: the event write moves to **after** the `assignHead()`
  attempt has resolved — success or failure — so it always reflects
  reality, never a hopeful guess.

This needs one small addition to `UserTransferEvent`'s own schema
(2.6.f) — `isPromotion` alone can't distinguish "never attempted a
promotion" from "attempted one and it failed," and a failed promotion
attempt is exactly the kind of thing this model's own "deserving its
own queryable history" justification should cover, not silently
collapse into an ordinary transfer:

```prisma
isPromotion        Boolean @default(false)   // CONFIRMED outcome — true only once assignHead() has actually succeeded
promotionAttempted Boolean @default(false)   // true whenever newPositionId was head-conferring, regardless of outcome — lets "attempted, failed" be queried distinctly from "never a promotion"
```

Full step order:

1. Load `user`, confirm `status === 'ACTIVE'` (transferring an
   `INVITED` or `INACTIVE` user is out of scope — `updateProfile()`
   already covers pre-acceptance edits; a departed user has no
   business being transferred).
2. Re-run Step 3's replacement check, if `dto.replacementUserId` is
   present.
3. Re-run Step 4's position check.
4. Re-run Step 5's manager resolution (derived, for a promotion; the
   fixed ACTIVE-status check above, otherwise).
5. **If Case B** (`replacementUserId` present): cascade every active
   direct report to the replacement —

   ```ts
   await tx.user.updateMany({
     where: { managerId: user.id, organizationId, status: 'ACTIVE' },
     data: { managerId: dto.replacementUserId },
   });
   ```

   — then update the replacement's own `positionId: user.positionId`
   (they stay in the SOURCE unit) and call `syncHeadAuthorityRoleGrant()`
   for the replacement (old: their own previous position/unit → new:
   `user.positionId`/source unit).
6. Update the transferred person — `primaryOrgUnitId: dto.
   destinationOrgUnitId, managerId: resolvedNewManagerId`, and
   `positionId: dto.newPositionId` **only when not `isPromotion`** (see
   the fix above — for a promotion, `assignHead()` sets `positionId`
   itself, in step 11).
7. `refreshOrgUnitHeadVacancy()` for **both** source and destination
   units (mirrors `updateProfile()`'s own existing dual-unit refresh)
   — skipped for the destination when `isPromotion`, since
   `assignHead()` (step 11) already does it there.
8. `syncHeadAuthorityRoleGrant()` for the transferred person
   themselves (old: previous position/unit → new: `dto.newPositionId`/
   destination) — skipped when `isPromotion`, since `assignHead()`
   (step 11) already covers this too.
9. `AuditLogService.log()` — `action: 'UPDATE'`, before/after,
   matching `updateProfile()`'s own shape. Describes what this
   transaction itself did (unit + manager change, and position change
   for a non-promotion) — accurate regardless of what a later
   promotion attempt does or doesn't achieve, so it stays here
   unconditionally.
10. **If not `isPromotion`**: write the `UserTransferEvent`
    (`isPromotion: false, promotionAttempted: false`) here, still
    inside the transaction. **If `isPromotion`**: skip this step for
    now — deferred to step 12.

Steps 1–10 run inside **transaction #1**. **Then, only if
`isPromotion` — outside that transaction, as its own separate unit of
work —**:

11. Delegate to the **existing** `OrgUnitHeadService.assignHead()` for
    everything Head-specific — it already validates
    `isUnitHeadPosition`, requires the target to already belong to the
    unit (true by this point — transaction #1 already committed
    `primaryOrgUnitId`), calls `validatePositionAssignment()` again
    (harmless — already passed in step 3; this codebase's own
    established redundant-but-safe pattern), sets `positionId` itself,
    writes its own `OrgUnitHeadEvent` (`action: 'ASSIGNED'`), refreshes
    destination-unit vacancy, and syncs the role grant — correctly this
    time, per the fix above. `transferUser()`'s own job for this branch
    narrows to moving the unit and resolving the manager (steps 1–9)
    — not reimplementing any of `assignHead()`'s steps, and not racing
    it either.

    - **On success**: `promotionCompleted = true`.
    - **On failure**: caught (not re-thrown to the caller as a hard
      failure — see 2.6.e's new table row), `promotionCompleted =
      false`, `promotionError = ` the caught exception's own message,
      and a distinct audit log entry is written (`metadata:
      { transferPromotionFailed: true, reason: promotionError,
      destinationOrgUnitId }`) — separate from step 9's own entry,
      which already committed describing only the core transfer.
12. Write the `UserTransferEvent` — now, after step 11 has resolved
    either way: `isPromotion: promotionCompleted` (only `true` on a
    **confirmed** success), `promotionAttempted: true` (a promotion was
    attempted regardless of outcome).
13. Return `ITransferResult` (2.6.e below).

`assignHead()`'s own `OrgUnitHeadEvent` write (step 11, on success) and
step 9's `AuditLogService.log()` call coexist with the
`UserTransferEvent` write (step 12), same as before — three
records, three different valid angles, none replacing another.

#### 2.6.d — Promotion Variant — Manager Resolution

Unchanged from the original design, reused inside step 4 above:

```ts
const destinationUnit = await this.prisma.orgUnit.findFirst({ where: { id: dto.destinationOrgUnitId, organizationId } });

if (destinationUnit.parentId === null) {
  resolvedNewManagerId = null;   // root exemption — no manager at all
  // Root's OWN head position currently vacant is already guaranteed —
  // Step 4's availablePositions list only offers it if unheld.
} else {
  const parentHasHead = await this.orgUnitHeadService.hasDirectOrActingHead(destinationUnit.parentId, organizationId);
  if (!parentHasHead) {
    throw new ConflictException("Cannot promote into this unit — its parent unit has no Head or Acting Head of its own yet");
  }
  const parentHeadStatus = await this.orgUnitHeadService.getHeadStatus(destinationUnit.parentId, organizationId);
  resolvedNewManagerId = parentHeadStatus.holders[0]?.id ?? parentHeadStatus.actingHeadUserId!;
}
```

**DECIDED (this pass)** — "recursively" means single-level only: the
immediate parent must have its own direct-or-acting Head, or the
promotion is hard-blocked. No walking further up to grandparent —
consistent with 2.4's own "parent escalation coverage does not count"
principle applied one level up.

**Root-unit destination exemption**: allowed only when root's own
head-conferring position is currently vacant (guaranteed by Step 4's
`availablePositions` list already excluding it otherwise), and the
promoted person's `managerId` becomes `null` — mirrors 2.5's own
bootstrap design exactly.

#### 2.6.e — Error Messages, Enumerated

| Case | Message |
|---|---|
| Case B, `replacementUserId` missing | `"This user has active direct reports — a replacement from the source unit is required"` (`BadRequestException`) |
| `replacementUserId` not ACTIVE / not in the source unit | `"The replacement must be an active user already belonging to the departing person's current org unit"` |
| Replacement can't legitimately inherit the position | Whatever `validatePositionAssignment()` itself throws — reused verbatim |
| Position no longer available (Step 4 gate) | Whatever `validatePositionAssignment()` itself throws — reused verbatim |
| `newManagerId` not ACTIVE / not in the destination unit | `"newManagerId must be an active user belonging to the destination org unit"` |
| `newManagerId` omitted for a non-promotion transfer | `"newManagerId is required for an ordinary (non-promotion) transfer"` (`BadRequestException`) |
| Promotion, parent unit headless | `"Cannot promote into this unit — its parent unit has no Head or Acting Head of its own yet"` |
| Promotion, no head-conferring position available in destination | Surfaced at the picker level (Step 4's list is empty for head-conferring options) — `"No available Head position exists in the destination org unit"` if reached anyway server-side |
| **Promotion's `assignHead()` call fails *after* transaction #1 has already committed** (2.6.c step 11, 2.6.h) | **Not a thrown exception — every other row above rejects with nothing having changed; this one is categorically different, since the transfer itself already succeeded.** `transferUser()` still returns its normal success status (e.g. `200`), with `ITransferResult.promotionCompleted: false` and `promotionError` set to whatever `assignHead()` itself threw, verbatim — never swallowed or replaced with a generic message. The frontend surfaces this as a distinct, non-error banner on the wizard's confirmation screen: `"{name} was successfully transferred to {destination unit}, but could not be promoted to Head: {promotionError}. Use 'Assign Head' on the org unit's own page to complete the promotion."` A distinct `AuditLogService` entry (`transferPromotionFailed: true`) is written alongside, and `UserTransferEvent` records `isPromotion: false, promotionAttempted: true` (2.6.f) — the confirmed, not hoped-for, outcome. No automatic retry — a single attempt, surfaced to a human, matching this plan's existing "never silently escalate/assign to nothing" discipline elsewhere. |

#### 2.6.f — `UserTransferEvent` — New Dedicated Model

**DECIDED (this pass, revised from the original recommendation)**: a
new, dedicated event model, not `AuditLogService` alone. A transfer is
a distinct business event — unit, position, and manager changing
together, sometimes a promotion — deserving its own queryable history,
not scattered across generic audit rows or folded into
`OrgUnitHeadEvent`'s narrower purpose. Coexists with, doesn't replace,
the mandatory `AuditLogService.log()` call (2.6.c step 9) and, for the
promotion branch, `assignHead()`'s own `OrgUnitHeadEvent` write — all
three fire for a promotion-variant transfer, each capturing a
different, valid angle.

**Write timing — confirmed explicitly (2.6.c)**: for a non-promotion
transfer, written inside transaction #1, fully atomic with the rest of
the transfer. For a promotion, written only *after* the `assignHead()`
attempt (2.6.c step 11) has resolved — `isPromotion` records
**confirmed outcome**, never intent, so a failed promotion attempt
never leaves a factually wrong row behind.

```prisma
model UserTransferEvent {
  id                    String    @id @default(cuid())
  organizationId        String    // denormalized, same precedent as OrgUnitHeadEvent
  userId                String    // the transferred person
  sourceOrgUnitId       String
  destinationOrgUnitId  String
  sourcePositionId      String?
  destinationPositionId String?
  replacementUserId     String?   // set only for a succession (Case B) transfer
  newManagerId          String?   // null for the root-promotion exemption
  isPromotion           Boolean   @default(false)   // CONFIRMED outcome — true only once assignHead() has actually succeeded, never written optimistically
  promotionAttempted    Boolean   @default(false)   // true whenever newPositionId was head-conferring, regardless of outcome — distinguishes "attempted, failed" from "never a promotion" in query results
  effectiveDate         DateTime  @default(now())
  approvedBy            String    // actorId — always required here (unlike OrgUnitHeadEvent.approvedBy, nullable there since "not every event needs approval"); a transfer always has an acting admin
  createdAt             DateTime  @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])
  user         User         @relation("UserTransferEventUser", fields: [userId], references: [id])
  replacement  User?        @relation("UserTransferEventReplacement", fields: [replacementUserId], references: [id])
  newManager   User?        @relation("UserTransferEventNewManager", fields: [newManagerId], references: [id])
  sourceOrgUnit      OrgUnit @relation("UserTransferEventSourceUnit", fields: [sourceOrgUnitId], references: [id])
  destinationOrgUnit OrgUnit @relation("UserTransferEventDestinationUnit", fields: [destinationOrgUnitId], references: [id])

  @@index([organizationId])
  @@index([userId])
  @@index([sourceOrgUnitId])
  @@index([destinationOrgUnitId])
}
```

Requires a real `prisma migrate dev`, per this project's own Prisma
Rules — a genuine schema addition, not a design detail to defer.

#### 2.6.g — Permission Model

**DECIDED (this pass)** — a new `users:transfer` permission string,
seeded to the `TENANT_ADMIN` role alongside the existing
`users:manage`, matching ACC-44's now-required richer-permission
pattern (action-specific strings per module, never overloading a
single flat `{module}:manage`).

#### 2.6.h — Transaction Safety

**Revised in this pass** — see 2.6.c's own "second, related problem"
finding for the full reasoning: the cascade (bulk `updateMany` on
every direct report), the departing person's own move, the
replacement's position/role update, and the new `UserTransferEvent`
write are genuinely multi-row, multi-step, with real partial-failure
risk — wrapped in `prisma.$transaction()` (**transaction #1**, 2.6.c
steps 1–10). Confirmed one existing precedent for this pattern in the
codebase (`workflow-template.service.ts`) — rare, but established;
`PrismaService` already exposes `$transaction`.

`OrgUnitHeadService.assignHead()` (2.6.c step 11, promotion only) is
deliberately **not** composed inside that same transaction — verified
its own implementation and everything it calls
(`validatePositionAssignment()`, `syncHeadAuthorityRoleGrant()`,
`OrganizationService.refreshOrgUnitHeadVacancy()`) reads/writes through
the plain injected `this.prisma`, never a transaction client a caller
could pass in. Running it inside `transferUser()`'s own `tx` callback
would mean its internal queries run outside that transaction entirely
— unable to see the transaction's own uncommitted writes, and not
rolled back together with them if the transaction later failed for an
unrelated reason. Runs instead as its own, separately-atomic call
immediately after transaction #1 commits — an accepted, explicitly
stated tradeoff (a promotion can be left "moved but not yet Head" if
this second call fails), not a silent gap. Caught, not re-thrown as a
hard failure — see 2.6.e's dedicated table row for exactly what the
caller sees and what recovery is suggested.

Notifications and the `AuditLogService.log()` call (not themselves
transactional writes) stay outside transaction #1, matching how every
other multi-step service method in this codebase already treats
side-effecting calls versus the DB writes proper.

### 2.7 Escalation Redesign — Complete Rewrite

This section supersedes the original 2.7 in full, informed by a
dedicated investigation into Task's actual current SLA/due-date/
escalation architecture (two prior conversation turns), which
surfaced facts the original design didn't have.

#### 2.7.a Confirmed Current State — Two Independent Findings

**Finding 1 — `Task.escalationUserId`/`escalationAfterHours` are
confirmed dead, the same pattern as `tasks:manage`/`WorkflowStage.
requiredPermission` before them.** Both fields are `@IsOptional()` on
`CreateTaskDto`, and `TaskService.create()` validates them if present
— but confirmed via a full grep of the entire frontend, zero real
callers ever send them. The manual task-creation form
(`task-form.component.ts:114-121`) has no escalation fields at all —
title, description, sourceType, sourceId, priority, dueDate only. The
workflow engine's `CREATE_TASK` action (`WorkflowService.
executeCreateTask()`) never passes them either. Settable only via a
direct API call, never through any real UI path.

**Finding 2 — even if they were set, escalation could not actually
fire, for any task, ever, with a nonzero grace period.** Confirmed by
re-reading `SlaMonitorProcessor.sweepOverdueTasks()`'s exact query:

```ts
const overdueTasks = await this.prisma.task.findMany({
  where: { dueAt: { lt: now }, status: { notIn: ['COMPLETED', 'CANCELLED', 'OVERDUE', 'UNASSIGNED'] } },
  ...
});
```

`'OVERDUE'` is **excluded** from the query. A task is processed by
this loop exactly once — the first sweep after `dueAt` passes, while
its status is still not yet `OVERDUE`. At that sweep, `hoursSinceDue`
is necessarily small (0–15 minutes, the sweep interval), so `hoursSinceDue
< task.escalationAfterHours` is true for any realistic grace period —
the method `continue`s past the escalation check. The task then flips
to `OVERDUE` and is permanently excluded from every future sweep by
the same `WHERE` clause — it can never be re-evaluated later, once
enough hours have genuinely passed. **This is a second, independent
bug, not merely a consequence of Finding 1** — even a hand-crafted API
call setting `escalationAfterHours` correctly would never see
escalation actually fire, for any value above one sweep interval.

**Finding 3 — Task due dates are computed completely independently of
`WorkflowStage.slaWorkingHours`.** `WorkflowService` has its own,
differently-scoped, confusingly same-named private `computeSlaDueAt
(stage, organizationId)` (`workflow.service.ts:1393-1404`) — its
result is written only to `WorkflowInstanceStage.slaDueAt`, never
passed to `TaskService.create()`. A workflow-created task's `dueAt`
always falls through to `TaskService`'s own, differently-signatured
`computeSlaDueAt(priority, organizationId)`
(`task.service.ts:406-414`), hardcoded to `priority: 'MEDIUM'` for
every workflow-created task (`workflow.service.ts:763`'s own `// TODO`
comment confirms this is a known, separate gap).

**Finding 4 — a real, working, tenant-configurable escalation
mechanism already exists, but on `WorkflowStage`, not `Task`.**
`WorkflowStage.escalationConfig` (`EscalationRule[] {afterHours,
notifyRoleId?, notifyUserId?}`) is genuinely wired through
`SlaMonitorProcessor.process()`/`fireEscalation()`
(`sla-monitor.processor.ts:71-120,402-438`) — fires when the *stage
itself* breaches its own `slaDueAt`, independent of whether a `Task`
was ever created for it, notifying a fixed role or fixed user (no
Manager/Head concept at all). This is confirmed **separate and
untouched** by this section — see the updated Non-Goals in Section 3.

#### 2.7.b WHO — Fully Automatic, No Human Choice, Anywhere

**DECIDED**: remove `Task.escalationUserId` and `Task.
escalationAfterHours` entirely, via a real migration — matching
ACC-44's precedent for a confirmed-dead field, not left as a
stale, now-differently-meant column. Reusing the same column names for
a fundamentally different (system-resolved, not caller-supplied)
semantics would risk exactly the kind of silently-lying-field shape
this codebase has already hit twice.

**Add, in their place**: two purpose-built, system-only timestamps,
mirroring the two-tier design directly rather than generalizing to an
array (`WorkflowInstanceStage.escalatedRuleIndexes`'s own shape is
right for an arbitrary, tenant-configured rule *list* — Task escalation
here is always exactly two fixed tiers, not N configured ones, so two
plain nullable columns are simpler and more directly queryable):

```prisma
// Task model — remove escalationUserId, escalationAfterHours; add:
managerEscalatedAt DateTime?
headEscalatedAt    DateTime?
```

Both are written **only** by `SlaMonitorProcessor`, never by any
caller — the "no human choice anywhere" requirement extends to the
schema itself, not just the runtime behavior. `escalatedAt` (the old
single field) is removed along with `escalationUserId` — superseded
by the two new tier-specific timestamps.

`CreateTaskDto`'s `escalationUserId?`/`escalationAfterHours?` fields
are removed. `TaskService.create()`'s `if (dto.escalationUserId) {
validateEscalationTarget(...) }` call is removed entirely —
`validateEscalationTarget()` itself is **retired**, not repurposed:
its role was validating an already-chosen caller target, which no
longer exists to validate. Replaced by two new **resolver** methods
(below), a genuinely different kind of method (returns a target,
doesn't validate a caller's choice).

#### 2.7.c WHEN — Two Tenant-Configurable Tiers, Off `Task.dueAt`

Escalation triggers off `Task.dueAt` (already exists, already
computed) with two tiered grace periods per `TaskPriority`
(`LOW`/`MEDIUM`/`HIGH`/`CRITICAL` — confirmed exact enum values,
`schema.prisma:159-164`): a grace period before escalating to the
assignee's Manager, and a further grace period after that before
escalating to their Unit Head. Both genuinely tenant-configurable,
both allowed to be `0` (immediate).

```ts
export interface ITaskSlaTier {
  dueAfterHours: number;                  // existing semantics, renamed for clarity — hours from creation to dueAt
  managerEscalationAfterHours: number;    // grace period after dueAt before Manager-tier fires; 0 = immediate
  headEscalationAfterHours: number;       // ADDITIONAL grace period after the Manager-tier fires before Head-tier fires; 0 = immediate
}
export interface ITaskSlaSettings {
  LOW: ITaskSlaTier;
  MEDIUM: ITaskSlaTier;
  HIGH: ITaskSlaTier;
  CRITICAL: ITaskSlaTier;
}
```

Stored at `Organization.settings.taskSla`.

#### 2.7.d New Settings UI — Activating `taskSla` For Real

**Confirmed**: `Organization.settings.taskSla` is never written by any
code path today, anywhere — not by any service method, not by
`demo-seed.ts`, not by `TenantService.bootstrap()`. Every real
tenant's `TaskService.computeSlaDueAt()` call falls straight through
to the hardcoded `DEFAULT_TASK_SLA_HOURS`/`FALLBACK_SLA_HOURS`
constants, for 100% of tenants, always. There is no admin-facing UI
anywhere — confirmed via a full frontend grep, zero hits outside
type declarations and test fixtures. No typed interface exists for its
shape either — only a local, inline type assertion inside
`TaskService`.

**Design — follows the established `admin-settings` pattern exactly**,
mirroring `email-provider`/`ai-settings`'s own GET+PATCH,
`tenant:manage_config`-gated shape, not introducing a new pattern:

- New DTO (`backend/src/foundation/tenant/dto/update-task-sla.dto.ts`):

  ```ts
  export class TaskSlaTierDto {
    @IsInt() @Min(1)
    dueAfterHours!: number;

    @IsInt() @Min(0)
    managerEscalationAfterHours!: number;

    @IsInt() @Min(0)
    headEscalationAfterHours!: number;
  }

  export class UpdateTaskSlaDto {
    @ValidateNested() @Type(() => TaskSlaTierDto) LOW!: TaskSlaTierDto;
    @ValidateNested() @Type(() => TaskSlaTierDto) MEDIUM!: TaskSlaTierDto;
    @ValidateNested() @Type(() => TaskSlaTierDto) HIGH!: TaskSlaTierDto;
    @ValidateNested() @Type(() => TaskSlaTierDto) CRITICAL!: TaskSlaTierDto;
  }
  ```

- New `TenantController` routes, matching `email-config`'s existing
  GET+PATCH pair exactly:

  ```ts
  @Get('task-sla')
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  getTaskSla(@CurrentTenant() tenantId: string): Promise<ITaskSlaSettings> {
    return this.tenantService.getTaskSla(tenantId);
  }

  @Patch('task-sla')
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  updateTaskSla(@Body() dto: UpdateTaskSlaDto, @CurrentTenant() tenantId: string, @CurrentUser() userId: string): Promise<void> {
    return this.tenantService.updateTaskSla(tenantId, dto, userId);
  }
  ```

- New `TenantService` methods — **don't clobber other keys**, matching
  the exact tested discipline already established for `settings.modules`/
  `settings.ai`/`settings.platformAnnouncement`:

  ```ts
  async getTaskSla(organizationId: string): Promise<ITaskSlaSettings> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const settings = (org?.settings as { taskSla?: ITaskSlaSettings } | null) ?? {};
    return settings.taskSla ?? DEFAULT_TASK_SLA_SETTINGS;
  }

  async updateTaskSla(organizationId: string, dto: UpdateTaskSlaDto, actorId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const existingSettings = (org?.settings as Record<string, unknown> | null) ?? {};
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: { ...existingSettings, taskSla: dto } },
    });
    await this.auditLog.log({ tenantId: organizationId, actorId, action: 'UPDATE', objectType: 'Organization', objectId: organizationId, metadata: { taskSlaUpdated: true } });
  }
  ```

  `DEFAULT_TASK_SLA_SETTINGS` — a new constant replacing today's
  `DEFAULT_TASK_SLA_HOURS`/`FALLBACK_SLA_HOURS` pair with the fuller
  three-field-per-tier shape, sensible starting values matching the
  current hardcoded hours (e.g. `CRITICAL: { dueAfterHours: 4,
  managerEscalationAfterHours: 2, headEscalationAfterHours: 4 }` and
  so on for the other three tiers — exact values are a product/ops
  decision at implementation time, not fixed here).

- **`TenantService.bootstrap()` gains a new step**: write
  `Organization.settings.taskSla = DEFAULT_TASK_SLA_SETTINGS` at
  tenant creation. Not strictly required for correctness (the read-side
  fallback in `getTaskSla()` covers an absent key functionally
  forever), but means the new settings page always has a real, saved
  row to display and edit from day one, rather than only ever showing
  a fallback default until the tenant admin's first save — matching
  the general discipline of bootstrapping real state rather than
  leaning on a runtime fallback indefinitely.

- New frontend component (`task-sla-settings.component.ts`), mirroring
  `ai-settings.component.ts`'s exact load/save shape (`signal`-based,
  `TenantService.getTaskSla()` in `ngOnInit()`, a save method calling
  `TenantService.updateTaskSla()`, `p-message` for error/success),
  rendering a 4-row (one per priority) × 3-column (the three tier
  fields) numeric form. New route (`admin-settings.routes.ts`, path
  `task-sla`), new card in `settings-hub.component.ts`'s
  `NEW_SETTINGS_CARDS`, gated by the same `tenant:manage_config`
  permission `email-provider`/`ai-settings` already use. New
  translation keys (`adminSettings.taskSla` + field labels) in both
  `en.json` and `ar.json`, per CLAUDE.md's i18n requirement.

#### 2.7.e Resolution Logic — Fresh at Firing Time, Not Precomputed

Resolution happens **at `SlaMonitorProcessor.sweepOverdueTasks()`
firing time**, every sweep, never precomputed or stored on the `Task`
row ahead of time — a Manager could change between when a task is
created and when it becomes overdue, and the resolved target must
reflect reality at the moment of firing, not a stale snapshot.

**Fixing Finding 2's bug** — the sweep's own query must stop excluding
`OVERDUE` tasks, so they remain eligible for re-evaluation on every
subsequent sweep until both tiers have fired:

```ts
private async sweepOverdueTasks(now: Date): Promise<void> {
  const overdueTasks = await this.prisma.task.findMany({
    where: {
      dueAt: { lt: now },
      status: { notIn: ['COMPLETED', 'CANCELLED', 'UNASSIGNED'] },   // 'OVERDUE' no longer excluded
    },
    include: { assignees: { where: { removedAt: null } } },
  });

  for (const task of overdueTasks) {
    if (task.status !== 'OVERDUE') {
      await this.prisma.task.update({ where: { id: task.id }, data: { status: 'OVERDUE', slaBreachedAt: now } });
    }

    const slaConfig = await this.tenantService.getTaskSla(task.organizationId);
    const tier = slaConfig[task.priority];
    const hoursSinceDue = DateTime.fromJSDate(now).diff(DateTime.fromJSDate(task.dueAt!), 'hours').hours;

    if (!task.managerEscalatedAt && hoursSinceDue >= tier.managerEscalationAfterHours) {
      if (await this.isWithinWorkingHours(task.organizationId)) {
        await this.fireTaskEscalation(task, 'MANAGER');
      }
    } else if (
      task.managerEscalatedAt && !task.headEscalatedAt &&
      hoursSinceDue >= tier.managerEscalationAfterHours + tier.headEscalationAfterHours
    ) {
      if (await this.isWithinWorkingHours(task.organizationId)) {
        await this.fireTaskEscalation(task, 'HEAD');
      }
    }
  }
}
```

Each tier strictly waits for its own configured threshold — no
fall-through to the Head tier just because the Manager tier had
nothing to resolve (see the "no manager exists" case below).

**DECIDED (this pass)** — both open questions from the prior draft are
now settled, reflected directly in the design below: (Pending
Discussion #8) escalation notifies **every distinct** Manager/Head
across all of a task's assignees, not just the first one in array
order — silently skipping part of a task's accountability chain
because of array position was judged inconsistent with this being a
compliance-oriented product. (Pending Discussion #9) the Head tier's
resolver **does** count Acting Head coverage, not only a direct
Head-conferring-position holder.

```ts
private async fireTaskEscalation(
  task: PrismaTask & { assignees: TaskAssignee[] },
  tier: 'MANAGER' | 'HEAD',
): Promise<void> {
  const assigneeIds = task.assignees.map((a) => a.userId);
  const targets = tier === 'MANAGER'
    ? await this.orgPositionService.resolveManagerEscalationTargets(assigneeIds, task.organizationId)
    : await this.orgPositionService.resolveHeadEscalationTargets(assigneeIds, task.organizationId);

  if (targets.length === 0) {
    await this.auditLog.log({
      tenantId: task.organizationId, action: 'UPDATE', objectType: 'Task', objectId: task.id,
      metadata: { escalationSkipped: true, tier, reason: `No ${tier === 'MANAGER' ? 'manager' : 'unit Head'} resolvable for any of this task's assignees` },
    });
    return;
  }

  for (const targetUserId of targets) {
    await this.notificationService.create(
      { userId: targetUserId, titleEn: 'Task SLA breach escalation', bodyEn: `A task has breached its SLA and has been escalated to you.`, objectType: 'Task', objectId: task.id },
      task.organizationId,
    );
  }
  await this.prisma.task.update({
    where: { id: task.id },
    data: tier === 'MANAGER' ? { managerEscalatedAt: new Date() } : { headEscalatedAt: new Date() },
  });
  await this.auditLog.log({ tenantId: task.organizationId, action: 'UPDATE', objectType: 'Task', objectId: task.id, metadata: { escalatedTo: targets, tier } });
}
```

One timestamp write per tier regardless of how many people were
notified — `managerEscalatedAt`/`headEscalatedAt` record "has this
tier already fired," not "who received it"; `escalatedTo` in the audit
log's `metadata` carries the full list for that.

**New resolver methods** (`OrgPositionService`), replacing
`validateEscalationTarget()` entirely — resolvers, not validators,
each returning every distinct target rather than a single one:

```ts
async resolveManagerEscalationTargets(assigneeIds: string[], organizationId: string): Promise<string[]> {
  const assignees = await this.prisma.user.findMany({ where: { id: { in: assigneeIds }, organizationId, status: 'ACTIVE' } });
  const managerIds = assignees.map((a) => a.managerId).filter((id): id is string => !!id);
  return [...new Set(managerIds)];   // dedup — two assignees sharing one manager notify that manager once, not twice
}

async resolveHeadEscalationTargets(assigneeIds: string[], organizationId: string): Promise<string[]> {
  const assignees = await this.prisma.user.findMany({ where: { id: { in: assigneeIds }, organizationId, status: 'ACTIVE' } });
  const orgUnitIds = [...new Set(assignees.map((a) => a.primaryOrgUnitId).filter((id): id is string => !!id))];

  const targets = new Set<string>();
  for (const orgUnitId of orgUnitIds) {
    const directHolder = await this.prisma.user.findFirst({
      where: { organizationId, primaryOrgUnitId: orgUnitId, status: 'ACTIVE', position: { isUnitHeadPosition: true } },
    });
    if (directHolder) {
      targets.add(directHolder.id);
      continue;
    }
    // PD#9, decided — no direct holder falls back to this unit's Acting
    // Head, mirroring assignHead()'s own holders[0]?.id ?? actingHeadUserId
    // pattern (2.6.d) — a vacancy genuinely covered by an Acting Head
    // should still receive escalation, not be silently skipped.
    const orgUnit = await this.prisma.orgUnit.findFirst({ where: { id: orgUnitId, organizationId } });
    if (orgUnit?.actingHeadUserId) targets.add(orgUnit.actingHeadUserId);
  }
  return [...targets];   // one distinct unit could still resolve to the same person as another via Acting Head coverage — Set already dedups that too
}
```

#### 2.7.f Workflow-Created Tasks — `dueAt` Should Finally Honor `stage.slaWorkingHours`

**Recommended, clear answer: yes.** Given this whole redesign needs a
trustworthy `dueAt` to compute both escalation tiers against, and
given workflow-created tasks are the primary task-creation path in
this platform's own workflow-first design, silently falling back to a
generic `MEDIUM`-priority default for every workflow-created task
(Finding 3) undermines the entire redesign's premise for the majority
of real tasks.

**Design — small, precise, fully reuses existing computation, no
regression for stages with no configured SLA**:

```ts
// WorkflowService.executeCreateTask() — add dueDate to the taskService.create() call
const dueAt = toStage.slaWorkingHours ? await this.computeSlaDueAt(toStage, organizationId) : null;

const task = await this.taskService.create(
  {
    title: `${transition.labelEn} — ${subjectLabel}`,
    sourceType, sourceId: instance.objectId, sourceStageId: toStage.id, workflowInstanceId: instance.id,
    assigneeUserIds: assigneeIds, assigneeDelegations,
    priority: 'MEDIUM',   // unchanged — a separate, already-tracked gap (workflow.service.ts's own TODO), out of this plan's scope
    dueDate: dueAt?.toISOString(),
  },
  organizationId, actorId,
);
```

Reuses `WorkflowService`'s own existing private `computeSlaDueAt(stage,
organizationId)` — the exact same computation already feeding
`WorkflowInstanceStage.slaDueAt` — rather than duplicating the
`WorkingCalendarService.calculateDeadline()` call a second time. When
`stage.slaWorkingHours` is unset, `dueDate` stays `undefined`, and the
task falls through to `TaskService`'s own existing priority-based
default exactly as it does today — zero behavior change for any stage
that hasn't configured an SLA.

#### 2.7.g Pending Discussions #8 and #9 — Decided

Making resolution fully automatic surfaced two real ambiguities the
old caller-validated design never had to answer, since a human picked
the target directly. Both are now decided (Ahmad's review, this pass)
and reflected directly in `fireTaskEscalation()`/`resolveManager
EscalationTargets()`/`resolveHeadEscalationTargets()` above, not left
as open questions:

- **#8 — Multi-assignee tie-break.** **Decided: notify every distinct
  Manager/Head across all assignees, not just the first one in array
  order.** The old `validateEscalationTarget()`'s "any assignee"
  semantics worked for a *validator* (is this one human-chosen target
  valid against *any* assignee's manager/unit) but doesn't translate
  to a *resolver* picking exactly one winner — silently skipping part
  of a task's accountability chain because of array position was
  judged inconsistent with this being a compliance-oriented product.
  `resolveManagerEscalationTargets()`/`resolveHeadEscalationTargets()`
  now return `string[]`, deduplicated, and `fireTaskEscalation()`
  notifies every one of them.
- **#9 — Acting Head coverage in the Head tier.** **Decided: yes,
  included.** `resolveHeadEscalationTargets()` now falls back to
  `OrgUnit.actingHeadUserId` whenever a unit has no direct
  Head-conferring-position holder, mirroring `assignHead()`'s own
  `holders[0]?.id ?? actingHeadUserId` pattern (2.6.d) — a vacancy
  genuinely covered by an Acting Head still receives escalation,
  rather than the whole tier silently no-oping during any Acting-Head-
  covered vacancy.

### Sequencing Note

This redesign only becomes trustworthy once `managerId` is reliably
populated — before this plan's items 3–6 ship, `managerId` is
optional, unscoped, and never reflects any real org-unit relationship
with confidence. Building 2.7 first would resolve escalation targets
against largely-arbitrary data. Confirmed sequencing dependency, not
merely a suggestion.

---

## 3. NON-GOALS (Explicit — Do Not Drift Into These)

- **ACC-40's vacancy-escalation mechanism** (`resolveActingHeadForOrgUnit()`,
  the `isHeadFullyUnresolved` sweep, parent-unit walk for Acting Head
  coverage) is untouched by this plan.
- **`WorkflowStage.escalationConfig`/`SlaMonitorProcessor.
  fireEscalation()`** (Section 2.7.a Finding 4) — a real, separately-
  working, tenant-configurable escalation mechanism operating on
  `WorkflowInstanceStage.slaDueAt` breaches, independent of `Task`
  entirely, with no Manager/Head concept. Confirmed to exist during
  this session's investigation; explicitly **not** touched, folded in,
  or made consistent with 2.7's redesign here — a deliberate scoping
  choice, not an oversight, since unifying the two would be a
  materially larger, separately-scoped piece of work.
- **The task-creation UI's escalation-target picker no longer exists
  as a design question at all** — since escalation is now fully
  automatic with no human choice (2.7.b), there is no picker to design
  or leave for later; this dissolves rather than defers the original
  2.7's own open question.
- **No new Organization Structure module UI** — the transfer wizard
  (2.6) is designed as a Tenant-Admin-only backend + minimal frontend
  capability, not the future dedicated module CLAUDE.md's Build
  Sequence references.
- **`OrganizationService.create()`'s cache-staleness gap** (2.4) is
  flagged, not fixed — 2.4's own design deliberately avoids depending
  on the cache at all.
- **Committee/Meeting-style org-unit-scoped assignment** (the
  `ORG_UNIT_HEAD` workflow-assignee-strategy reachability gap CLAUDE.md
  already tracks) is unrelated and untouched.

---

## 4. PENDING DISCUSSIONS

### 4a. Decided This Pass

| # | Section | Question | Decision |
|---|---|---|---|
| 1 | 2.1 | Burn or preserve the invitation token on a position-conflict rejection at acceptance? Notify admins? | Preserve token. Notify tenant admins — new `notifyTenantAdminsOfInviteAcceptanceConflict()`. |
| 2 | 2.6 | Transferred person's own destination position — cleared/unset, or explicitly picked? | Always explicitly picked, as its own wizard step, live-validated before advancing — generalized to every case, not left case-specific. |
| 3 | 2.6.d | "Recursively" — single-level parent check, or walk multiple ancestors? | Single-level only. |
| 4 | 2.6.f | New dedicated event model, or `AuditLogService` alone? | New dedicated `UserTransferEvent` model, coexisting with `AuditLogService`. |
| 5 | 2.6.g | New `users:transfer` permission string, or gate behind `users:manage`? | New `users:transfer` string. |
| 7 | 2.3 | Manager-exemption scope — only the root unit's own Head, or anyone invited into the root unit generally? | Only the root unit's own Head. |
| 8 | 2.7.g | Multi-assignee tie-break for automatic Manager/Head resolution — which assignee's relationship wins? | **Every** distinct Manager/Head across all assignees is notified — not a single "winner." |
| 9 | 2.7.g | Should the Head tier's resolver include Acting Head coverage, or only a direct Head-conferring-position holder? | Included — falls back to `OrgUnit.actingHeadUserId` when no direct holder exists. |

*(Original #6 — "Manager-then-Unit-Head" pure predicate vs. resolution
algorithm — is superseded outright by Section 2.7's complete rewrite,
which settles it as full automatic resolution. Removed from this table
rather than left as answered-by-reference.)*

Also fixed in this pass, flagged during review rather than raised as
its own Pending Discussion: `newManagerId`'s validation only checked
destination-unit membership, not `status: 'ACTIVE'` — the same gap
already correctly closed for `replacementUserId`. Now a single,
shared check applied identically wherever a transfer resolves a new
manager (2.6.b Step 5), not two separately-fixed copies.

Also found and fixed this pass, during a verification pass Ahmad
specifically requested before final approval: `OrgUnitHeadService.
assignHead()` would have silently failed to grant a promoted person's
associated role if called after `transferUser()`'s own step 6 had
already pre-set their `positionId` — see 2.6.c's own "Verified before
finalizing this plan" note and 2.6.h's revised transaction design.

### 4b. Still Genuinely Open

Empty — every Pending Discussion raised across this document's
several revision passes is now Decided (Section 4a). Implementation
may proceed once this document itself is approved.

---

## 5. SUGGESTED IMPLEMENTATION SEQUENCE

1. **2.1 + 2.2** — the race-condition fix and the `updateProfile()`
   gap. Small, self-contained. Should ship and be verified (including
   a live re-reproduction of the original exploit, confirming it's now
   rejected) before anything else in this plan starts.
2. **2.5** — the one-line bootstrap seed change. Should land on top of
   the corrected validation from step 1, not before it.
3. **2.3 + 2.4** — mandatory manager and the hard invite-block rule.
   Tightly coupled, share the `hasDirectOrActingHead()`/root-Head
   derivation logic.
4. **2.6** — the transfer wizard. Largest single piece, and now
   includes a real schema migration (`UserTransferEvent`) alongside
   the service/controller/frontend work. The wizard's own steps
   (2.6.a query → Step 1–2 → Step 3 conditional → Step 4 → Step 5 →
   Step 6 submit) are each independently testable in that order — an
   ordinary (non-promotion, no-subordinates) transfer end-to-end is a
   reasonable first shippable slice. The promotion variant specifically
   needs a dedicated test confirming `assignHead()`'s role grant
   actually fires post-transfer (2.6.c's own verified fix) — not just
   that `positionId` ends up correct, which alone would have passed
   even with the bug this pass found and closed.
5. **2.7** — escalation redesign, last, once items 3–6's `managerId`
   reliability is actually true in practice — no longer blocked on any
   open Pending Discussion (all resolved, Section 4a). Sub-sequence
   within 2.7 itself: schema migration (remove old fields, add the two
   new timestamps) → settings UI (2.7.d, independently shippable and
   testable on its own, since it has no dependency on the sweep logic)
   → resolver methods (2.7.e) → sweep-query fix (2.7.e, the
   `OVERDUE`-exclusion bug) → workflow `dueAt` wiring (2.7.f,
   independently shippable, worth landing early since it's low-risk
   and unblocks meaningful `dueAt` values for manual testing of the
   rest of 2.7).

No code, migration, or test has been written for any of this — this
document is the plan only, per your instruction.
