# Step 258 — Workflow editing for the Organization Administrator only (ACC-258)

**Status:** plan only (24 Oct 2026). Nothing is built.
**Decision behind it:** Ahmad, 22 Oct (ACC-255 Q-D). Only the tenant admin can
change a workflow: its stages, stage rules, flags and transitions. Every other
role sees a running workflow's progress only on the record it runs on. The
`/workflows` redirect for non-admins stays (ACC-257 was cancelled).

**The gap** (ACC-255 plan §16.1): `workflows:manage` is the check on every
workflow write. It is seeded only to Organization Administrator
(`TENANT_ADMIN`) and Platform Administrator (`PLATFORM_ADMIN`), but
`assertGrantable()` lets a tenant admin give it to any custom or editable role.

---

## 1. Read-only counts on the shared database (24 Oct)

Taken from `D:\Accredit-me-2\backend` in one `BEGIN TRANSACTION READ ONLY`,
rolled back, with nothing written. The script is in the session scratchpad
(`acc258-counts.js`), outside the repository. It prints slugs, role names and
counts only.

**Organisations:** `al-manara` and `al-nakheel` (both fixtures; there is no
customer), plus `platform`.

**Every role that holds `workflows:manage`:**

| Organisation | Role | System or custom | Users (active) |
|---|---|---|---|
| al-manara | Organization Administrator (`TENANT_ADMIN`) | system | 1 (1) |
| al-manara | Platform Administrator (`PLATFORM_ADMIN`) | system | 0 (0) |
| al-nakheel | Organization Administrator | system | 1 (1) |
| al-nakheel | Platform Administrator | system | 0 (0) |
| platform | Organization Administrator | system | 0 (0) |
| platform | Platform Administrator | system | 1 (1) |

- **No custom role and no other system role holds it**, in any organisation.
- **Every Organization Administrator role holds it**: 3 of 3.
- **Platform Administrator holds it everywhere**, because its seed is `ALL` plus
  the platform keys. Inside a tenant it has 0 users and can't be assigned
  (`PlatformRoleNotAssignableException`).
- **No workflow transition requires `workflows:manage`** (0 transitions).

So the revocation backfill (§5) has **nothing to remove today**, unless Q1 is
answered "revoke it from Platform Administrator inside tenants" (2 grants). It
is still built, so the rule is enforced on any data, not just today's.

---

## 2. Where grants are written today, and where the refusal goes

| Path | Where | Checks a grant today | Change |
|---|---|---|---|
| Create a role | `RoleService.createRole()` (`role.service.ts:324`), `POST /roles` | `assertGrantable(createKeys, isPlatformOrg)` | refuse a root-only key: a new role is never the root role |
| Save a role's permissions | `RoleService.assignPermissions()` (`:476`), `PATCH /roles/:id/permissions` | the root and platform roles are refused outright (`:506`, `:521`); for others, `assertGrantable` on newly added keys (`:577`) | refuse a root-only key among the newly added keys |
| Rename a role | `updateRole()` (`:391`), `PATCH /roles/:id` | touches no permission | none |
| System role seed | `seedSystemRoles()` (`:100`), from `SYSTEM_ROLE_SEED` (`role.seed.ts`) | none (code-owned) | none; a spec pins that only the allowed roles hold the key in the seed |
| Realistic seed's custom roles | `prisma/seed/apply/apply-custom-roles.ts`, through `RoleService.createRole()` | as Create | covered by the Create refusal |
| Backfills and `demo-seed.ts` | direct `rolePermission` writes in `prisma/*.ts` | none | none needed: no existing script grants `workflows:manage` (grep). A future script that grants keys must not grant this one; the seed spec catches a seed change, but not a script. |
| Head-authority grants | `grantRoleViaHeadAuthority()` | grants a ROLE to a person, never a key to a role | none |

**There is no import path** for roles or permissions.

### 2.1 The rule, in one place

In `foundation/roles/permission-grantability.ts`, next to the existing rules:

```ts
/** ACC-258 — keys only the tenant's root role (TENANT_ADMIN) may hold. */
export const ROOT_ROLE_ONLY_PERMISSIONS: ReadonlySet<string> = new Set([WORKFLOWS_PERMISSIONS.MANAGE]);
export const isRootRoleOnly = (key: string): boolean => ROOT_ROLE_ONLY_PERMISSIONS.has(key);
/** Refuses root-only keys being given to any role but the root role. */
export function assertNotRootRoleOnly(keys: readonly string[], roleKey: string | null): void
```

- **Separate from `assertKnownAndGrantable()`, deliberately.** That function also
  guards a workflow transition's `requiredPermission`. A transition that requires
  `workflows:manage` stays valid: the root role holds it, so someone can still
  fire it. Folding the new rule into it would make such transitions unsaveable.
- **Called by `createRole()`**, where the role key is always null, so any
  root-only key is refused. **Called by `assignPermissions()`** on the newly
  added keys. The root role never reaches it (it is refused earlier as frozen),
  and the platform role never reaches it either (frozen, `:521`).
- **A non-root role that already holds the key (none today)** loses it on its
  next save: the editor no longer shows the key, so the save doesn't send it,
  and the existing audit row records it under `removed`. The backfill (§5) is
  what removes it everywhere at once.

### 2.2 The refusal

- **Code:** `PERMISSION_ROOT_ROLE_ONLY`, **400**, alongside
  `PLATFORM_PERMISSION_NOT_ALLOWED` and `PERMISSION_NOT_IN_USE` in
  `role-permission-refusal.ts` (same body shape: `{ statusCode, message, error,
  code, keys }`).
- **English (`message`, and the frontend's wording):** "Only the Organization
  Administrator role can edit workflows. This permission can't be given to
  another role."
- **Arabic (gender-neutral, no addressee):** «تعديل سير العمل متاح لدور مسؤول
  المؤسسة فقط. لا يمكن منح هذه الصلاحية لدور آخر.»
- The role's name in the sentence is the seed's (`مسؤول المؤسسة`). A tenant may
  rename the role, but the refusal names its function, as the existing
  frozen-role sentences do.

---

## 3. Can Organization Administrator lose it? No (your pick)

It already can't, and nothing new is needed to keep it that way:
- `assignPermissions()` refuses the root role outright (`role.service.ts:506`,
  ACC-120's frozen set). Its permissions can't be edited at all, only its name
  and description.
- `seedSystemRoles()` writes `ALL` to it, which includes `workflows:manage`.
- At least one active user always holds the role
  (`assertTenantRetainsAnActiveAdministrator()`).

A spec pins the first point for this key specifically: a save to the root role
is refused, and it still holds `workflows:manage`.

---

## 4. How the role editor learns which keys are reserved

**It already builds its list from the server catalogue.** It reads
`GET /roles/permissions` → `RoleService.listAllPermissions()`. The frontend's
`buildMatrix()` (`frontend/src/app/foundation/roles/permission-matrix/permission-matrix.model.ts:54`)
keeps only `inUse` keys, and hides platform keys inside a tenant.

**A server change alone could hide the key only by misusing `inUse`**, and that
would break something else. The workflow transition editor reads the same
catalogue and the same flag
(`workflow-transition-editor.component.ts:683-710`) to decide which permissions
a transition may require. Marking `workflows:manage` "not in use" would also
drop it from that picker, and would claim no code checks a key that every
workflow write checks. **So a small frontend change is needed.**

**The server side:** the catalogue gains one field, from the same rule,
`rootRoleOnly: boolean` (`isRootRoleOnly(key)`), next to `inUse`. Nothing in
the frontend hard-codes `workflows:manage`.

**The frontend change, all in lane A's roles screen:**

| File | Change |
|---|---|
| `frontend/src/app/foundation/roles/services/role.service.ts` | `PermissionDto` gains `rootRoleOnly: boolean`. |
| `frontend/src/app/foundation/roles/permission-matrix/permission-matrix.model.ts` | `buildMatrix(catalogue, { isTenant, isRootRole })` drops a `rootRoleOnly` key unless the role is the root role, whose matrix is read-only anyway and so shows it as held. |
| `frontend/src/app/foundation/roles/components/role-permission-matrix/role-permission-matrix.component.ts` | passes `isRootRole()` (already computed, `:553`) to `buildMatrix`, and says the new refusal code if a stale screen ever sends the key (next to the existing `ROLE_PERMISSIONS_CHANGED` handling, `:913`). |
| `frontend/src/assets/i18n/en.json`, `ar.json` | the refusal sentence (§2.2). |
| their specs | `permission-matrix.model.spec.ts` (the row is hidden for a custom role and shown for the root role), and the component's refusal. |

The role form (`role-form`) sends no permission keys, so new roles start empty
and get their keys only through the matrix. No change is needed there.

**Lane A coordination:** the backend can ship first. Its refusal and catalogue
field are additive, and the current matrix still shows the key; a save that
adds it is then refused with the new code, which today's matrix shows as a
generic error until lane A's change lands. Or lane A's change lands with it.
Your call (Q3).

---

## 5. The revocation backfill: `backfill:acc258-revoke-workflows-manage`

**Runs only after the code is live**, never before, so a grant can't come back
between the backfill and the deploy. It follows ACC-244's revocation script
(`backfill-acc244-retire-flat-task-keys.ts`) and the ACC-255 backfill's
conventions:

- **Plan:** for every NON-platform organisation, the `RolePermission` rows for
  `workflows:manage` on any role except the root role (and, per Q1, except
  Platform Administrator), each with the role's name and system flag.
- **Dry run by default; `-- --execute` to write; a second dry run must report
  0.**
- **One transaction per organisation**, `BACKFILL_TX = { maxWait: 10_000,
  timeout: 60_000 }`. Inside it, the plan is read again and the script refuses
  ("database changed since the dry run") if it moved. Each row is deleted by its
  id AND the role id. The organisation is checked for every row.
- **One audit row per revoked grant**, written in the same transaction to that
  organisation's own trail (ACC-101): `objectType: 'RolePermission'`,
  `objectId: roleId`, `action: 'UPDATE'`, with before and after permission
  lists and `metadata { source, ticket: 'ACC-258', reason, removed:
  ['workflows:manage'] }`, the shape `assignPermissions()` already writes.
  `actorId: null`.
- **Tenant-scoped, platform organisation excluded** (`isPlatformOrg: false`),
  and **customers refused** (fixtures only, exit 1). CLAUDE.md (ACC-101)
  permits a revocation backfill only while no customer exists; after the first
  customer it becomes a report and a customer-notified change. Today there is
  none.
- **What a person notices:** anyone holding a revoked role loses workflow
  editing on their next request (permissions are resolved per request, ACC-101).
  On today's data, nobody does.

---

## 6. Specs

**Backend, unit:**
- `permission-grantability.spec.ts` (new; the rule has no spec file of its own today): `isRootRoleOnly`; `assertNotRootRoleOnly`
  refuses for a null role key and for a non-root key, and passes for
  `TENANT_ADMIN`; `assertKnownAndGrantable` still accepts `workflows:manage`
  (transitions).
- `role.service.spec.ts`:
  - `createRole` with `workflows:manage` is 400 `PERMISSION_ROOT_ROLE_ONLY`,
    nothing is created, and no audit row is written;
  - `assignPermissions` adding it to a custom role, and to an editable system
    role (Quality Manager), is refused with nothing written;
  - removing it from a role that holds it is allowed and audited;
  - the root role stays refused as frozen and still holds the key;
  - the catalogue returns `rootRoleOnly: true` for `workflows:manage` only;
  - a tenant-isolation test named for the gate: another organisation's role id
    is the existing 404, never the new refusal.
- `role.seed.spec.ts`: in `SYSTEM_ROLE_SEED`, `workflows:manage` is held by
  `TENANT_ADMIN` (and `PLATFORM_ADMIN`, per Q1) and by no other role.
- `workflow-template.service.spec.ts`: a transition may still require
  `workflows:manage`.

**Backend, real database (`test:db`):** `backfill-acc258.db-spec.ts`:
- a fixture-like organisation with a custom role and an editable system role
  given the key directly: a dry run plans both; execute removes both, with one
  audit row each, in that organisation's trail; a second dry run plans 0;
- the root role keeps the key;
- another organisation's grants are untouched (tenant isolation);
- the platform organisation is never planned;
- a customer organisation is refused, with nothing written.

**Frontend (lane A's files):** `permission-matrix.model.spec.ts` and the
component's refusal (§4).

---

## 7. Migration

**None.** The rule lives in code, beside the existing grantability rules, and
the catalogue field is computed, not stored. The revocation is a data backfill,
not a schema change.

---

## 8. Questions

| # | Question | My pick |
|---|---|---|
| Q1 | **Platform Administrator also holds `workflows:manage`**, in every organisation, through its `ALL` seed. Does "only Organization Administrator" include it? | **Leave it alone.** Its set is frozen (refused at `:521`). It can't be assigned inside a tenant, so its 2 tenant copies have 0 users and grant nothing to anyone. In the platform organisation it is what `PlatformGuard` reads, and that organisation runs no workflows. The rule becomes "the root role, and the frozen platform role nobody in a tenant can hold". The backfill skips both, so it removes 0 grants today. The alternative is to take the key out of `PLATFORM_ADMIN`'s seed and revoke its 2 tenant copies. That changes a frozen role's set for no one's benefit. |
| Q2 | A non-root role that already holds the key (none today): should its next unrelated save drop it silently (audited under `removed`), or keep it until the backfill? | **Drop it on save.** It is the direction the rule wants, it is audited, and none exists today. |
| Q3 | Ship the backend first and let lane A follow, or land both together? | **Together, if lane A can take it this week.** Otherwise backend first. The refusal is correct on its own, and the only visible effect until lane A ships is a generic error on a box that shouldn't be ticked. |

---

## 9. Not in this ticket

- The `/workflows` redirect for non-admins (it stays, ACC-257 cancelled).
- Any other key becoming root-only. `ROOT_ROLE_ONLY_PERMISSIONS` is a set so
  the next one is one line, with its own decision, count and backfill.
- Read-only workflow pages for `workflows:view` holders.
