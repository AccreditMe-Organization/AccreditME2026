# Step 4 — Roles + Permissions
# ACC-8 (suggested): implement role-based access control — system roles, tenant-custom
# roles, permission assignment, user↔role assignment, and PermissionGuard activation

---

## HEALTH CHECK — Run Before Starting

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AccreditMe Health Check — 2026-07-20
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ERRORS:  None ✅
ERRORS:           None ✅
WARNINGS:
  ⚠ STRIPE_SECRET_KEY is empty — deferred, acceptable for local dev
  ⚠ REDIS_URL is empty — Railway injects in production, acceptable

DETAILED RESULTS

Check 1  Git State              PASS — on dev, clean, ACC-7 PR merged, docs commit on top
Check 2  Branch vs dev          INFO — 0 commits ahead/behind, ready for new ticket
Check 3  Backend TypeScript     PASS — npx tsc --noEmit → zero errors
Check 4  Frontend TypeScript    PASS — npx tsc --noEmit → zero errors
Check 5  Test Suite             PASS — 105/105 tests passing (8 suites)
Check 6  Tenant Isolation       PASS — isolation tests present in 3 suites
                                 (organization, working-calendar, lookup)
Check 7  Migration Status       PASS — 5 migrations, database up to date
Check 8  Schema Validation      PASS — schema.prisma is valid
Check 9  Environment Variables  PASS — all required vars present (2 deferred warnings)
Check 10 Security               PASS — .env and .mcp.json not in git history

OVERALL STATUS: 🟢 HEALTHY — ready to start ACC-8
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

Step 4 implements **Roles + Permissions + Access Control** — the mechanism that turns
every `@Permissions('module:action')` decorator already scattered across the codebase
from a no-op into a real authorization check.

Three things ship together:

1. **System roles** — 7 predefined roles seeded into every tenant on bootstrap
   (`PLATFORM_ADMIN`, `TENANT_ADMIN`, `QUALITY_MANAGER`, `QUALITY_OFFICER`, `AUDITOR`,
   `BASE_USER`, `VIEWER`), each pre-wired with a sensible default permission set.
2. **Tenant-custom roles** — tenant admins can create additional roles, assign any
   subset of the platform's permission strings to any role (system or custom), and
   assign/remove roles on users.
3. **PermissionGuard activation** — `TenantGuard` is wired to resolve the calling
   user's permission set on every request; `PermissionGuard`'s bypass (stubbed since
   Step 1) is removed. From this step onward, `@Permissions()` decorators are real.

### Why This Step Matters

- Every controller written so far (`TenantController`, `OrganizationController`,
  `WorkingCalendarController`, `LookupController`) already carries `@Permissions()`
  decorators that currently do nothing — this step makes them enforce.
- Every functional module from here on (Documents, Standards, Audits, Incidents,
  Committees, Meetings, KPI) depends on this system to gate its endpoints.
- Step 9 (Users) depends on this step for role assignment during user invite.
- Step 12 (Super Admin Portal) depends on `PLATFORM_ADMIN` semantics defined here.

### Scaffold Already in Place (from Step 1 — do not recreate)

```
Role            model — EXISTS, partial — MODIFY (see Section 2)
Permission      model — EXISTS, no changes needed
UserRole        model — EXISTS, minor addition (see Section 2)
RolePermission  model — EXISTS, no changes needed
ROLES_PERMISSIONS — EXISTS in common/constants/permissions.ts (VIEW, MANAGE)
PermissionGuard — EXISTS, stubbed (bypasses when userPermissions is empty)
TenantGuard     — EXISTS, sets request.tenantId / request.userId only
```

---

## 2. PRISMA SCHEMA CHANGES

### What `Role` Currently Has

```prisma
model Role {
  id             String       @id @default(cuid())
  organizationId String
  name           String
  description    String?
  isSystem       Boolean      @default(false)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization    Organization @relation(fields: [organizationId], references: [id])
  userRoles       UserRole[]
  rolePermissions RolePermission[]

  @@unique([organizationId, name])
  @@index([organizationId])
}
```

### What `Role` Must Have After Migration

```prisma
model Role {
  id             String       @id @default(cuid())
  organizationId String
  key            String?                          // stable identifier for system roles
                                                    // (e.g. "TENANT_ADMIN"); null for tenant-custom roles
  nameEn         String
  nameAr         String
  description    String?
  isSystem       Boolean      @default(false)      // seeded by AccreditMe — key is immutable
  isActive       Boolean      @default(true)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization    Organization     @relation(fields: [organizationId], references: [id])
  userRoles       UserRole[]
  rolePermissions RolePermission[]

  @@unique([organizationId, key])       // system roles unique per tenant by stable key
  @@unique([organizationId, nameEn])    // all roles unique per tenant by display name
  @@index([organizationId])
}
```

**Why `key` is nullable, not a shared global row:** unlike `LookupCategory` (one shared
`organizationId = null` record referenced by every tenant), each tenant gets its **own**
`Role` row per system role, created during bootstrap. `isSystem = true` + a stable `key`
identifies *which* system role a row represents; `organizationId` is never null on `Role`.
This means Postgres NULL-distinctness makes `@@unique([organizationId, key])` safe —
many tenant-custom roles with `key = null` in the same org do not collide with each other.

**Why `name` splits into `nameEn` / `nameAr`:** matches the bilingual convention already
established for `LookupCategory` / `LookupValue` (`labelEn` / `labelAr`). The original
scaffold's single `name` field was a Step 1 placeholder.

### What `Permission` Already Has (no changes)

```prisma
model Permission {
  id          String           @id @default(cuid())
  module      String
  action      String
  description String?

  rolePermissions RolePermission[]

  @@unique([module, action])
  @@index([module])
}
```

Global table — no `organizationId`. Permission strings (`module:action`) are the same
across every tenant; only which roles/users hold them varies per tenant.

### What `UserRole` Must Have After Migration

```prisma
model UserRole {
  id        String   @id @default(cuid())
  userId    String
  roleId    String
  createdAt DateTime @default(now())              // ADD — "assigned since" for UI display

  user   User @relation(fields: [userId], references: [id])
  role   Role @relation(fields: [roleId], references: [id])

  @@unique([userId, roleId])
  @@index([userId])
  @@index([roleId])
}
```

### What `RolePermission` Already Has (no changes)

```prisma
model RolePermission {
  id           String     @id @default(cuid())
  roleId       String
  permissionId String

  role         Role       @relation(fields: [roleId], references: [id])
  permission   Permission @relation(fields: [permissionId], references: [id])

  @@unique([roleId, permissionId])
  @@index([roleId])
}
```

### Migration Name

```
extend-role-bilingual-names-and-key
```

Run:
```bash
cd backend && npx prisma migrate dev --name extend-role-bilingual-names-and-key
```

**Data migration note:** this is pre-production data (dev database only, no real
tenants). No backfill script needed for the `name` → `nameEn`/`nameAr` split. If any
`Role` rows already exist in the dev database from manual testing, drop them — they
will be regenerated by `seedSystemRoles()` on next bootstrap.

---

## 3. FILES TO CREATE (BACKEND)

All paths relative to `backend/src/`.

### Commit 1 — Schema (standalone commit before any code)
```
backend/prisma/schema.prisma                                            MODIFY
backend/prisma/migrations/YYYYMMDDHHMMSS_.../                          GENERATED
```

---

### Commit 2 — Interfaces and DTOs
```
foundation/roles/interfaces/role.interface.ts                          CREATE
foundation/roles/interfaces/permission.interface.ts                    CREATE
foundation/roles/dto/create-role.dto.ts                                 CREATE
foundation/roles/dto/update-role.dto.ts                                 CREATE
foundation/roles/dto/assign-permissions.dto.ts                          CREATE
foundation/roles/dto/assign-role.dto.ts                                 CREATE
foundation/roles/dto/role-response.dto.ts                               CREATE
```

**`role.interface.ts`**:
```typescript
export interface IRole {
  id: string;
  organizationId: string;
  key: string | null;
  nameEn: string;
  nameAr: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions?: string[];   // populated as "module:action" strings when requested with detail
}
```

**`permission.interface.ts`**:
```typescript
export interface IPermission {
  id: string;
  module: string;
  action: string;
  description: string | null;
}
```

**`create-role.dto.ts`** — class-validator decorators (tenant-custom roles only):
- `nameEn`: `@IsString @IsNotEmpty @MaxLength(100)`
- `nameAr`: `@IsString @IsNotEmpty @MaxLength(100)`
- `description`: `@IsString @IsOptional @MaxLength(500)`
- `permissionKeys`: `@IsArray @IsOptional @IsString({ each: true })` — initial permission
  set, format `"module:action"`; validated against the `Permission` table in the service
- No `key` or `isSystem` field on this DTO — service always sets `key = null`,
  `isSystem = false` for anything created through this endpoint.

**`update-role.dto.ts`** — `PartialType(OmitType(CreateRoleDto, ['permissionKeys']))`.
Permission changes go through the dedicated `assign-permissions` endpoint, not through
a general update, so the checkbox-matrix UI and the name/description form stay decoupled.

**`assign-permissions.dto.ts`**:
- `permissionKeys`: `@IsArray @ArrayNotEmpty @IsString({ each: true })` — full replacement
  set for the role (see Business Rules — Section 8, "Full-replace semantics")

**`assign-role.dto.ts`**:
- `roleId`: `@IsString @IsNotEmpty`

**`role-response.dto.ts`** — `implements IRole`. All fields with `!` assertion.

---

### Commit 3 — System seed data
```
foundation/roles/permission.seed.ts                                    CREATE
foundation/roles/role.seed.ts                                          CREATE
```

**`permission.seed.ts`** — derives the full permission catalog from the constants file
that already exists (`common/constants/permissions.ts`), so the two never drift apart.

```typescript
import * as PermissionConstants from '../../common/constants/permissions';

export interface SeedPermission {
  module: string;
  action: string;
  description: string;
}

// Flattens every {X}_PERMISSIONS constant object into {module, action} pairs.
// Module name is the string before ':' in each permission value (e.g. "documents:view" → "documents").
export const ALL_PERMISSIONS: SeedPermission[] = Object.values(PermissionConstants)
  .flatMap((group) => Object.values(group as Record<string, string>))
  .map((value) => {
    const [module, action] = value.split(':') as [string, string];
    return { module, action, description: value };
  });
```

**`role.seed.ts`** — pure data file, references permission constants directly (never
hardcodes `"documents:view"` as a magic string — same rule as Step 3's lookup keys).

```typescript
import {
  TENANT_PERMISSIONS, ORG_PERMISSIONS, USERS_PERMISSIONS, ROLES_PERMISSIONS,
  LOOKUPS_PERMISSIONS, WORKFLOWS_PERMISSIONS, TASKS_PERMISSIONS, COMMITTEES_PERMISSIONS,
  NOTIFICATIONS_PERMISSIONS, MEETINGS_PERMISSIONS, DOCUMENTS_PERMISSIONS,
  STANDARDS_PERMISSIONS, AUDITS_PERMISSIONS, INCIDENTS_PERMISSIONS, BILLING_PERMISSIONS,
  REPORTS_PERMISSIONS, PLATFORM_PERMISSIONS, KPI_PERMISSIONS,
} from '../../common/constants/permissions';

const ALL = [
  TENANT_PERMISSIONS, ORG_PERMISSIONS, USERS_PERMISSIONS, ROLES_PERMISSIONS,
  LOOKUPS_PERMISSIONS, WORKFLOWS_PERMISSIONS, TASKS_PERMISSIONS, COMMITTEES_PERMISSIONS,
  NOTIFICATIONS_PERMISSIONS, MEETINGS_PERMISSIONS, DOCUMENTS_PERMISSIONS,
  STANDARDS_PERMISSIONS, AUDITS_PERMISSIONS, INCIDENTS_PERMISSIONS, BILLING_PERMISSIONS,
  REPORTS_PERMISSIONS, KPI_PERMISSIONS,
].flatMap((g) => Object.values(g));

const readOnly = (...groups: Record<string, string>[]) =>
  groups.map((g) => g['VIEW']).filter(Boolean) as string[];

export interface SeedRole {
  key: string;
  nameEn: string;
  nameAr: string;
  description: string;
  permissions: string[];   // "module:action" strings
}

export const SYSTEM_ROLE_SEED: SeedRole[] = [
  {
    key: 'PLATFORM_ADMIN',
    nameEn: 'Platform Administrator',
    nameAr: 'مسؤول المنصة',
    description: 'AccreditMe platform staff — full access, used during impersonation (Step 12).',
    permissions: [...ALL, ...Object.values(PLATFORM_PERMISSIONS)],
  },
  {
    key: 'TENANT_ADMIN',
    nameEn: 'Organization Administrator',
    nameAr: 'مسؤول المؤسسة',
    description: 'Full administrative access within the organization (excludes platform-level actions).',
    permissions: ALL.filter((p) => !p.startsWith('platform:')),
  },
  {
    key: 'QUALITY_MANAGER',
    nameEn: 'Quality Manager',
    nameAr: 'مدير الجودة',
    description: 'Manages quality processes across documents, standards, audits, incidents, and meetings.',
    permissions: [
      ...Object.values(DOCUMENTS_PERMISSIONS),
      ...Object.values(STANDARDS_PERMISSIONS),
      ...Object.values(AUDITS_PERMISSIONS),
      ...Object.values(INCIDENTS_PERMISSIONS),
      ...Object.values(MEETINGS_PERMISSIONS),
      ...Object.values(COMMITTEES_PERMISSIONS),
      ...Object.values(TASKS_PERMISSIONS),
      ...Object.values(KPI_PERMISSIONS),
      ...Object.values(REPORTS_PERMISSIONS),
      ORG_PERMISSIONS.VIEW, USERS_PERMISSIONS.VIEW, LOOKUPS_PERMISSIONS.VIEW,
      WORKFLOWS_PERMISSIONS.VIEW,
    ],
  },
  {
    key: 'QUALITY_OFFICER',
    nameEn: 'Quality Officer',
    nameAr: 'مسؤول الجودة',
    description: 'Operational quality tasks — drafting, reviewing, and executing day-to-day work.',
    permissions: [
      DOCUMENTS_PERMISSIONS.VIEW, DOCUMENTS_PERMISSIONS.CREATE, DOCUMENTS_PERMISSIONS.SUBMIT,
      DOCUMENTS_PERMISSIONS.REVIEW, STANDARDS_PERMISSIONS.VIEW, STANDARDS_PERMISSIONS.LINK_EVIDENCE,
      AUDITS_PERMISSIONS.VIEW, AUDITS_PERMISSIONS.EXECUTE,
      INCIDENTS_PERMISSIONS.VIEW, INCIDENTS_PERMISSIONS.REPORT, INCIDENTS_PERMISSIONS.INVESTIGATE,
      MEETINGS_PERMISSIONS.VIEW, MEETINGS_PERMISSIONS.RECORD_MINUTES,
      TASKS_PERMISSIONS.VIEW, TASKS_PERMISSIONS.MANAGE,
      KPI_PERMISSIONS.VIEW_DEPARTMENT, KPI_PERMISSIONS.ENTER_DATA,
      REPORTS_PERMISSIONS.VIEW,
    ],
  },
  {
    key: 'AUDITOR',
    nameEn: 'Auditor',
    nameAr: 'مراجع',
    description: 'Conducts and reports internal/external audits.',
    permissions: [
      ...Object.values(AUDITS_PERMISSIONS),
      STANDARDS_PERMISSIONS.VIEW, DOCUMENTS_PERMISSIONS.VIEW,
      INCIDENTS_PERMISSIONS.VIEW, INCIDENTS_PERMISSIONS.REPORT,
      TASKS_PERMISSIONS.VIEW, KPI_PERMISSIONS.VIEW_DEPARTMENT, REPORTS_PERMISSIONS.VIEW,
    ],
  },
  {
    key: 'BASE_USER',
    nameEn: 'Base User',
    nameAr: 'مستخدم أساسي',
    description: 'Baseline full-user role — view assigned work and enter own KPI data. ' +
      'Deliberately not named "Staff" — see Business Rules for why, and how this ' +
      'differs from the "Staff member" portal-only user type (Step 17b).',
    permissions: [
      DOCUMENTS_PERMISSIONS.VIEW, TASKS_PERMISSIONS.VIEW, MEETINGS_PERMISSIONS.VIEW,
      KPI_PERMISSIONS.VIEW_OWN, KPI_PERMISSIONS.ENTER_DATA, NOTIFICATIONS_PERMISSIONS.VIEW,
    ],
  },
  {
    key: 'VIEWER',
    nameEn: 'Viewer',
    nameAr: 'مشاهد',
    description: 'Read-only access across all modules.',
    permissions: readOnly(
      ORG_PERMISSIONS, USERS_PERMISSIONS, ROLES_PERMISSIONS, LOOKUPS_PERMISSIONS,
      WORKFLOWS_PERMISSIONS, TASKS_PERMISSIONS, COMMITTEES_PERMISSIONS, MEETINGS_PERMISSIONS,
      DOCUMENTS_PERMISSIONS, STANDARDS_PERMISSIONS, AUDITS_PERMISSIONS, INCIDENTS_PERMISSIONS,
      REPORTS_PERMISSIONS,
    ),
  },
];
```

Both files require **Arabic labels from day one** — same rule as the Step 3 lookup seed.

---

### Commit 4 — RoleService + spec
```
foundation/roles/role.service.ts                                       CREATE
foundation/roles/role.service.spec.ts                                  CREATE
```

**`role.service.ts`** methods:

```typescript
// ── Seed ─────────────────────────────────────────────────────────────────────

// Upserts every {module, action} pair from ALL_PERMISSIONS into the global
// Permission table. Idempotent. Called at the start of seedSystemRoles().
seedPermissions(): Promise<void>

// Upserts the 7 SYSTEM_ROLE_SEED roles + their RolePermission rows for one tenant.
// Idempotent — safe to call repeatedly. Called by TenantService.bootstrap().
seedSystemRoles(organizationId: string): Promise<void>

// ── Roles ────────────────────────────────────────────────────────────────────

getRoles(organizationId: string): Promise<IRole[]>
getRoleById(id: string, organizationId: string): Promise<IRole>   // includes permissions[]

// Tenant-custom only — service forces key=null, isSystem=false regardless of input
createRole(dto: CreateRoleDto, organizationId: string, actorId: string): Promise<IRole>

// Editable on system AND tenant roles (see Business Rules) — throws ForbiddenException
// only if dto attempts to touch key/isSystem (not present on the DTO, so structurally impossible;
// guard exists for defense-in-depth against a malformed request body)
updateRole(id: string, dto: UpdateRoleDto, organizationId: string, actorId: string): Promise<IRole>

// Soft-deactivate — isActive=false. Throws ConflictException if this is the tenant's
// last active role carrying TENANT_ADMIN-equivalent access with any user still assigned
// (see Business Rules — "Admin lockout protection")
deactivateRole(id: string, organizationId: string, actorId: string): Promise<void>

// Restores a previously deactivated role
reactivateRole(id: string, organizationId: string, actorId: string): Promise<void>

// Full-replace of a role's permission set. Validates every key exists in Permission table.
assignPermissions(
  roleId: string,
  dto: AssignPermissionsDto,
  organizationId: string,
  actorId: string,
): Promise<IRole>

// ── Permission catalog (for the UI's checkbox matrix) ────────────────────────

listAllPermissions(): Promise<IPermission[]>

// ── User ↔ Role assignment ───────────────────────────────────────────────────
// Temporary home — Users module (Step 9) does not exist yet. Revisit whether these
// five methods move onto a future UsersService once Step 9 lands.

getUserRoles(userId: string, organizationId: string): Promise<IRole[]>

assignRoleToUser(
  userId: string,
  dto: AssignRoleDto,
  organizationId: string,
  actorId: string,
): Promise<void>

// Throws ConflictException if removing this assignment would leave zero users
// holding the TENANT_ADMIN role in the tenant (see Business Rules)
removeRoleFromUser(
  userId: string,
  roleId: string,
  organizationId: string,
  actorId: string,
): Promise<void>

// ── Permission resolution — consumed by TenantGuard via PERMISSION_RESOLVER token ──

// Returns the flattened, deduplicated set of "module:action" strings across all
// ACTIVE roles assigned to the user (inactive roles contribute nothing).
// This is the method the guard activation in Commit 7 wires up.
getUserPermissions(userId: string): Promise<string[]>
```

**Spec must cover:**
- `seedPermissions()` inserts every constant from `permissions.ts` exactly once, idempotently
- `seedSystemRoles()` creates all 7 roles + correct RolePermission rows for a fresh org
- `seedSystemRoles()` is idempotent — calling twice produces no duplicate roles/assignments
- `createRole()` always creates with `key = null`, `isSystem = false` regardless of any
  extra fields smuggled into the request body
- `createRole()` throws `ConflictException` on duplicate `nameEn` within the same org
- `updateRole()` updates nameEn/nameAr/description on a system role's own tenant copy
  (proves system roles are NOT locked for editing — only `key` is immutable)
- `assignPermissions()` replaces the full set — old RolePermission rows not in the new
  list are removed, new ones are added
- `assignPermissions()` throws `NotFoundException` for an unknown permission key
- `deactivateRole()` throws `ConflictException` when deactivating the tenant's only
  role carrying `TENANT_ADMIN` semantics while users are still assigned to it
- `removeRoleFromUser()` throws `ConflictException` when it would remove the last
  `TENANT_ADMIN` assignment in the tenant
- `getUserPermissions()` returns the deduplicated union across multiple assigned roles
- `getUserPermissions()` excludes permissions from a deactivated role
- Tenant isolation test: org B's `getRoles()` never returns org A's custom roles;
  org B cannot assign a role belonging to org A to one of its own users

---

### Commit 5 — RoleController + spec
```
foundation/roles/role.controller.ts                                    CREATE
foundation/roles/role.controller.spec.ts                                CREATE
```

**Endpoints:**

```
GET    /roles                                  @Permissions(ROLES_PERMISSIONS.VIEW)
GET    /roles/permissions                      @Permissions(ROLES_PERMISSIONS.VIEW)
GET    /roles/:id                              @Permissions(ROLES_PERMISSIONS.VIEW)
POST   /roles                                  @Permissions(ROLES_PERMISSIONS.MANAGE)
PATCH  /roles/:id                              @Permissions(ROLES_PERMISSIONS.MANAGE)
PATCH  /roles/:id/permissions                  @Permissions(ROLES_PERMISSIONS.MANAGE)
POST   /roles/:id/deactivate                   @Permissions(ROLES_PERMISSIONS.MANAGE)
POST   /roles/:id/activate                     @Permissions(ROLES_PERMISSIONS.MANAGE)
GET    /users/:userId/roles                    @Permissions(ROLES_PERMISSIONS.VIEW)
POST   /users/:userId/roles                    @Permissions(ROLES_PERMISSIONS.MANAGE)
DELETE /users/:userId/roles/:roleId            @Permissions(ROLES_PERMISSIONS.MANAGE)
```

Note: `GET /roles/permissions` must be routed before `GET /roles/:id` in the controller
class body — Nest matches routes in declaration order, and `:id` would otherwise
swallow the literal `permissions` segment.

Note: the `/users/:userId/roles*` routes live on `RoleController` for now because there
is no `UsersController` yet (Step 9). Flag for relocation when Step 9 lands.

Rules:
- `@UseGuards(TenantGuard, PermissionGuard)` at class level
- `@CurrentTenant()` for organizationId — never from request body
- `@CurrentUser()` for actorId on all mutations
- Zero business logic — all delegation to RoleService
- Controller specs mock RoleService and override guards

---

### Commit 6 — RolesModule + AppModule
```
foundation/roles/roles.module.ts                                       CREATE
app.module.ts                                                          MODIFY
```

**`roles.module.ts`**:
```typescript
import { Global, Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { PERMISSION_RESOLVER } from '../../common/services/permission-resolver.interface';

@Global()
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule)],
  controllers: [RoleController],
  providers: [
    RoleService,
    { provide: PERMISSION_RESOLVER, useExisting: RoleService },
  ],
  exports: [RoleService, PERMISSION_RESOLVER],
})
export class RolesModule {}
```

**Why `@Global()`:** `TenantGuard` (Commit 7) is referenced via `@UseGuards(TenantGuard, ...)`
across controllers living in many different feature modules (`TenantModule`,
`OrganizationModule`, `WorkingCalendarModule`, `LookupModule`, and every module from here
on). Nest resolves a guard class's constructor dependencies from the DI container of
whichever module owns the controller it's applied to. Rather than have every present
and future feature module explicitly import `RolesModule` just so `TenantGuard` can
resolve `PERMISSION_RESOLVER`, `RolesModule` is declared `@Global()` and imported once
in `AppModule` — its exports become visible to every module's injector automatically.
This is the same "resolve once, use everywhere" reasoning behind `STORAGE_PROVIDER` /
`AI_PROVIDER` / `AUTH_PROVIDER` already being provided from `TenantModule`.

Add `RolesModule` to `AppModule` imports.

---

### Commit 7 — PermissionGuard activation + TenantService bootstrap
```
common/services/permission-resolver.interface.ts                       CREATE
common/guards/tenant.guard.ts                                          MODIFY
common/guards/permission.guard.ts                                      MODIFY
foundation/tenant/tenant.service.ts                                    MODIFY
foundation/tenant/tenant.module.ts                                     MODIFY
```

**`permission-resolver.interface.ts`** — the abstraction that keeps `common/guards`
decoupled from the concrete `foundation/roles` module (mirrors the `StorageProvider` /
`AuthProvider` / `AiProvider` pattern already established for pluggable providers):

```typescript
export interface PermissionResolver {
  getUserPermissions(userId: string): Promise<string[]>;
}

export const PERMISSION_RESOLVER = Symbol('PERMISSION_RESOLVER');
```

**`tenant.guard.ts`** changes:
```typescript
constructor(
  @Inject(PERMISSION_RESOLVER)
  private readonly permissionResolver: PermissionResolver,
) {}

// ...after JWT verification succeeds, before `return true`:
request.userPermissions = await this.permissionResolver.getUserPermissions(payload.sub);
```
`canActivate` becomes `async canActivate(...): Promise<boolean>`.

Remove the two comment blocks referencing "activated in Step 5" / tokenVersion TODO
stays (that one is still genuinely Step 9's job — do not touch it).

**`permission.guard.ts`** changes:
- Delete the `if (userPermissions.length === 0) return true;` bypass line entirely —
  this was the Step 1 stub; a user with zero permissions must now be correctly denied,
  not waved through.
- Delete the header comment block describing the stub — replace with a short note
  that this guard has been active since Step 4.
- Logic that remains: `required.some((p) => userPermissions.includes(p))` → 403 if none match.

**`tenant.service.ts`** changes — bootstrap() currently has:
```typescript
await this.lookupService.seedSystemData();
// TODO(Step 5 — Roles): create default roles (Admin, Quality Manager, Staff)
```
Replace with:
```typescript
await this.lookupService.seedSystemData();
await this.roleService.seedSystemRoles(id);
```
Inject `RoleService` via `@Inject(forwardRef(() => RoleService))` in the constructor,
same pattern already used for `LookupService` in this file.

**`tenant.module.ts`** changes — add `forwardRef(() => RolesModule)` to `imports`
alongside the existing `forwardRef(() => LookupModule)`.

**Important:** this is the same circular-dependency shape already solved for
`TenantModule ↔ LookupModule` (`TenantService` needs `RoleService` for bootstrap;
`RolesModule` needs `TenantModule` for `AuditLogService`). Resolve with `forwardRef()`
on both sides — the proven pattern, not a new one.

---

## 4. FILES TO CREATE (FRONTEND)

Angular standalone components. PrimeNG for UI. Tailwind for layout.
All paths relative to `frontend/src/app/`.

### Commit 8 — Angular roles feature
```
foundation/roles/services/role.service.ts                              CREATE
foundation/roles/components/
  role-list/role-list.component.ts                                    CREATE
  role-form/role-form.component.ts                                    CREATE
  role-permission-matrix/role-permission-matrix.component.ts          CREATE
  user-role-assignment/user-role-assignment.component.ts              CREATE
foundation/roles/roles.routes.ts                                       CREATE
```

**`role.service.ts`** — Angular `HttpClient` wrapper:
```typescript
@Injectable({ providedIn: 'root' })
export class RoleService {
  listRoles(): Observable<RoleDto[]>
  getRole(id: string): Observable<RoleDto>
  listAllPermissions(): Observable<PermissionDto[]>
  createRole(dto: CreateRoleDto): Observable<RoleDto>
  updateRole(id: string, dto: UpdateRoleDto): Observable<RoleDto>
  assignPermissions(id: string, permissionKeys: string[]): Observable<RoleDto>
  deactivateRole(id: string): Observable<void>
  activateRole(id: string): Observable<void>
  getUserRoles(userId: string): Observable<RoleDto[]>
  assignRoleToUser(userId: string, roleId: string): Observable<void>
  removeRoleFromUser(userId: string, roleId: string): Observable<void>
}
```

**`role-list.component.ts`** — PrimeNG Table:
- Columns: nameEn, nameAr, isSystem badge, isActive, permission count, actions
- System roles: grey "System" badge — key shown as a tooltip, no delete action
  (deactivate/activate/edit/manage-permissions all remain available)
- Tenant roles: full edit/deactivate actions
- "New Role" button → navigates to `role-form` in create mode
- Click row → navigates to `role-form` in edit mode; "Manage Permissions" action →
  `role-permission-matrix`

**`role-form.component.ts`** — Angular Reactive Form:
- Fields: nameEn, nameAr, description
- System roles: form is fully editable (see Business Rules) — only a banner explains
  that the role's `key` cannot change and it cannot be permanently deleted
- On create: no permission selection here — after save, redirect straight into
  `role-permission-matrix` for the new role

**`role-permission-matrix.component.ts`**:
- Loads `listAllPermissions()` grouped by `module` (rows = modules, columns = actions
  present for that module — sparse grid, since not every module has every action)
- Checkbox per {module, action} cell that exists in the catalog
- Pre-checks cells matching the role's current permission set
- "Save" calls `assignPermissions(roleId, selectedKeys)` — full-replace, single call
- Warning banner when editing `TENANT_ADMIN` or `PLATFORM_ADMIN`: "Removing permissions
  from this role affects every user currently assigned to it."

**`user-role-assignment.component.ts`** — minimal stopgap until Step 9 (Users module)
ships a proper user profile page:
- Takes a `userId` input
- Lists currently assigned roles with a remove (✕) action per row
- "Assign Role" dropdown (roles not yet assigned) + confirm button
- Not yet linked from any navigation — Step 9 will embed this component (or its
  successor) into the user detail page it builds

**`roles.routes.ts`**:
```typescript
export const ROLES_ROUTES: Routes = [
  { path: '', loadComponent: () => RoleListComponent },
  { path: 'new', loadComponent: () => RoleFormComponent },
  { path: ':id/edit', loadComponent: () => RoleFormComponent },
  { path: ':id/permissions', loadComponent: () => RolePermissionMatrixComponent },
];
```

---

### Commit 9 — Translation keys
```
frontend/src/assets/i18n/en.json     MODIFY
frontend/src/assets/i18n/ar.json     MODIFY
```

Keys to add to `en.json`:
```json
{
  "roles": {
    "title": "Roles & Permissions",
    "roleList": "Roles",
    "systemBadge": "System",
    "customBadge": "Custom",
    "addRole": "New Role",
    "editRole": "Edit Role",
    "nameEn": "Name (English)",
    "nameAr": "Name (Arabic)",
    "description": "Description",
    "isActive": "Active",
    "deactivateRole": "Deactivate Role",
    "activateRole": "Activate Role",
    "confirmDeactivate": "Deactivate this role? Users assigned to it will lose its permissions immediately.",
    "confirmDeactivateLastAdmin": "This is the organization's only administrator role with active assignments and cannot be deactivated.",
    "managePermissions": "Manage Permissions",
    "permissionMatrix": "Permission Matrix",
    "permissionMatrixHint": "Check every action this role should be allowed to perform.",
    "adminRoleWarning": "Removing permissions from this role affects every user currently assigned to it.",
    "systemRoleKeyLocked": "This role's identifier cannot be changed. All other fields, including its permissions, may be edited for your organization.",
    "assignedUsers": "Assigned Users",
    "assignRole": "Assign Role",
    "removeRole": "Remove Role",
    "confirmRemoveRole": "Remove this role from the user?",
    "confirmRemoveLastAdmin": "This is the user's only administrator role and cannot be removed while they are the organization's last administrator.",
    "noRoles": "No roles found.",
    "noPermissions": "No permissions assigned.",
    "permissionCount": "{{count}} permissions"
  }
}
```

Arabic equivalents in `ar.json`.

---

## 5. COMMIT SEQUENCE

All commits on branch `feature/ACC-8-roles-permissions`.
Format: `{type}({scope}): {description} [ACC-8]`

```
Commit 1:  chore(prisma): extend Role with bilingual names and stable key [ACC-8]
Commit 2:  feat(roles): add role interfaces and DTOs [ACC-8]
Commit 3:  feat(roles): add permission catalog and system role seed data [ACC-8]
Commit 4:  feat(roles): add RoleService with permission resolution [ACC-8]
Commit 5:  feat(roles): add RoleController [ACC-8]
Commit 6:  chore(roles): register global RolesModule in AppModule [ACC-8]
Commit 7:  feat(auth): activate PermissionGuard via TenantGuard [ACC-8]
Commit 8:  feat(roles): add Angular role management UI [ACC-8]
Commit 9:  feat(i18n): add roles translation keys [ACC-8]
```

Run `npx tsc --noEmit` before commits 1, 4, 5, 6, 7, 8.
Run `npx jest --passWithNoTests` before commits 4, 5, 6, 7.

**Commit 7 is the highest-risk commit in this step** — it changes request-handling
behavior for every existing protected endpoint. After Commit 7, run the FULL existing
test suite (not `--passWithNoTests`) and manually verify a couple of already-built
endpoints (e.g. `GET /lookups/categories`) still return 200 for a token belonging to
a user with a role granting `lookups:view` before proceeding to Commit 8.

---

## 6. ACCEPTANCE CRITERIA

- [ ] `Role` schema updated — `key`, `nameEn`, `nameAr`, `isActive` added; `name` removed
- [ ] `UserRole` schema updated — `createdAt` added
- [ ] Migration applied — database schema up to date
- [ ] All 7 system roles seeded on tenant bootstrap with correct default permissions
- [ ] `seedPermissions()` populates the `Permission` table from `permissions.ts` exactly
      once each — idempotent
- [ ] `seedSystemRoles()` is idempotent — calling twice produces no duplicate roles
- [ ] Tenant can create a custom role and assign it any subset of the permission catalog
- [ ] Tenant can edit a system role's own copy (name, description, permissions) —
      only `key` is immutable
- [ ] System roles cannot be hard-deleted — only deactivated/reactivated
- [ ] Deactivating the tenant's last assigned `TENANT_ADMIN` role is blocked
- [ ] Removing a user's last `TENANT_ADMIN` assignment is blocked
- [ ] `assignPermissions()` performs a full-replace and validates unknown keys
- [ ] `getUserPermissions()` returns the deduplicated union of all active roles' permissions
- [ ] `TenantGuard` populates `request.userPermissions` via `PERMISSION_RESOLVER` on
      every authenticated request
- [ ] `PermissionGuard`'s Step 1 bypass is removed — endpoints now genuinely enforce
      `@Permissions()`
- [ ] Every previously-built endpoint (`tenant`, `organization`, `working-calendar`,
      `lookup`) still functions correctly for a user holding the right permissions,
      and returns 403 for one that doesn't
- [ ] `RolesModule` is `@Global()` and exports `RoleService` + `PERMISSION_RESOLVER`
- [ ] Backend TypeScript: zero errors
- [ ] Frontend TypeScript: zero errors
- [ ] All tests passing (105+ existing + new role tests)
- [ ] Tenant isolation tests present for `RoleService`
- [ ] `TenantService.bootstrap()` TODO for Step 5/Roles replaced with real call
- [ ] Translation keys in both `en.json` and `ar.json`
- [ ] PR to dev with green CI

---

## 7. DEPENDENCIES

### What This Step Requires from Steps 1–3

| Requirement | Where It Comes From |
|---|---|
| `Role`, `Permission`, `UserRole`, `RolePermission` models | Scaffolded in Step 1 |
| `TenantModule` import | Provides `AuditLogService`, forwardRef pattern to follow |
| `AuditLogService` | Call `log()` on every role/permission/assignment mutation |
| `TenantGuard` / `PermissionGuard` | Both exist, stubbed — this step activates them |
| `@CurrentTenant()` / `@CurrentUser()` | Existing decorators, used as-is |
| `ROLES_PERMISSIONS.VIEW` / `.MANAGE` | Already in `common/constants/permissions.ts` |
| Every other `{X}_PERMISSIONS` constant | Already in `common/constants/permissions.ts` —
      source of truth for the seed data in Commit 3 |
| `PrismaModule` | Database access |
| Circular-dependency pattern (`forwardRef` both sides) | Proven in `TenantModule ↔ LookupModule` |

### What Future Steps Will Require from Step 4

| Future Step | What It Needs |
|---|---|
| Step 6 — Workflow engine | Assignee-by-role in workflow stage config |
| Step 8 — Task management | Task delegation checks against `tasks:delegate` |
| Step 9 — Users | Default role assignment on invite; `tokenVersion` bump must
      also invalidate any cached permission resolution once caching is added |
| Step 9 — Users | Likely relocates `/users/:userId/roles*` endpoints off `RoleController` |
| Step 10 — Committees | Reuses the permission-matrix UI pattern for committee roles |
| Step 12 — Super Admin Portal | `PLATFORM_ADMIN` role semantics defined here — impersonation
      flow needs product-owner confirmation on exact assignment rules (see Business Rules) |
| Every functional module (Documents, Standards, Audits, Incidents, KPI) | `@Permissions()`
      decorators already written throughout are enforced starting this step |

---

## 8. BUSINESS RULES

### System Roles Are Per-Tenant Rows, Not Shared Templates

Unlike `LookupCategory` (a single shared `organizationId = null` record read by every
tenant), each tenant gets its **own** `Role` row for each of the 7 system roles,
created by `seedSystemRoles()` during bootstrap. Consequence: editing a system role's
name, description, or permission set on one tenant has zero effect on any other tenant.
Only `key` is immutable (it is how the platform recognizes "this row is the tenant's
copy of `AUDITOR`"); `isSystem` is likewise fixed. Everything else — `nameEn`, `nameAr`,
`description`, and the entire `RolePermission` set — is tenant-editable, including for
system roles. This is intentionally more permissive than the Step 3 lookup rules.

### `BASE_USER` Role vs. "Staff Member" User Type — Resolved Naming Collision

**Decided by product owner (2026-07-20):** this role was originally drafted as `STAFF`,
which collides with an unrelated CLAUDE.md concept, so it is seeded as `BASE_USER`
instead. The two remain worth distinguishing explicitly:

- **`BASE_USER` role** (this step) — a `Role` row assignable to a **full User**, granting
  baseline permissions (view documents/tasks/meetings, enter own KPI data).
- **"Staff member"** (Step 17b) — a completely separate user type with no system
  access at all: document-portal-only, OTP-based login, counted in its own seat pool.
  Staff members **never** receive a `Role` or `UserRole` row — the entire RBAC system
  built in this step does not apply to them.

Do not conflate the two when building Step 17b, and do not reintroduce `STAFF` as a
role key or label anywhere in this step's code, seed data, or UI copy.

### `PLATFORM_ADMIN` Role — Open Question for Step 12

CLAUDE.md's Super Admin Portal (Step 12) describes AccreditMe platform staff acting
outside any single tenant. Seeding a `PLATFORM_ADMIN` role **inside every tenant** (as
this step does, per the explicit instruction to seed all 7 roles) is a pragmatic
placeholder so the role exists for Step 12's impersonation flow to assign. Before
Step 12 ships, confirm with the product owner whether:
  (a) tenant admins should ever be able to see/assign `PLATFORM_ADMIN` themselves
      (default assumption: **no** — hide it from the tenant-facing role picker in the UI,
      enforce nothing server-side yet since there's no platform-portal auth boundary
      built until Step 12), or
  (b) it should instead be a platform-global concept unrelated to per-tenant `Role` rows.
This step seeds it and hides it from the tenant UI's assignable-role list; it does not
attempt to fully solve platform-vs-tenant authorization boundaries.

### Full-Replace Semantics for `assignPermissions()`

`PATCH /roles/:id/permissions` takes the complete desired permission set and replaces
it in one call, rather than exposing separate add/remove endpoints. This matches the
checkbox-matrix UI pattern (user checks/unchecks freely, then saves once) and avoids
partial-update ordering bugs. The service diffs against existing `RolePermission` rows
and issues the minimal set of inserts/deletes.

### Admin Lockout Protection

Two safety nets prevent an organization from locking itself out of administration:
1. `deactivateRole()` throws `ConflictException` if the role carries `key = 'TENANT_ADMIN'`
   and at least one active `UserRole` still points to it in that tenant.
2. `removeRoleFromUser()` throws `ConflictException` if the target assignment is the
   tenant's last active `TENANT_ADMIN` assignment (i.e. removing it would leave zero
   users with that role, counting only active roles and active users).
Both checks query live state at call time — no cached counts.

### Permission Resolution Runs Live, Every Request

`getUserPermissions()` is a real-time query (`User → UserRole → Role → RolePermission
→ Permission`, filtered to `Role.isActive = true`) executed by `TenantGuard` on every
authenticated request. No caching in this step. This is acceptable at current scale;
if request latency becomes a concern, a future pass should cache per-user permission
sets (Redis, keyed by `userId`) with invalidation on role/permission-assignment change
and on `User.tokenVersion` bump — the same signal Step 9 already uses to force logout
on role change. Do not build the cache now; it is explicitly deferred.

### Soft-Delete Only

No hard deletes on `Role`. Deactivation (`isActive = false`) is the only removal path,
consistent with the platform-wide soft-delete convention already established for
lookups. Historical `AuditLog` entries and `RolePermission` history remain intact.

### `Permission` Table Is Seeded From Code, Never From the UI

There is intentionally no `POST /roles/permissions` endpoint. The permission catalog
(`module:action` pairs) is defined exclusively by `common/constants/permissions.ts` and
mirrored into the database by `seedPermissions()`. Adding a new permission string to
the platform is a code change (new constant + a later migration/seed run), never a
tenant-facing action — this keeps `@Permissions()` decorators and the DB catalog from
ever drifting apart.

### Audit Log

`AuditLogService.log()` on every mutation:
- Role create, update, deactivate, reactivate
- Permission assignment changes (log the full new set as `after`)
- User role assignment and removal (log `userId` + `roleId` in `metadata`)

---

## 9. AI INTEGRATION POINTS

None for this step. CLAUDE.md's "AI Integration Points" section lists AI touchpoints
for Working Calendar, Lookup Management, and Workflow Config within the Foundation
layer — Roles + Permissions is not among them. This step is a pure access-control
mechanism; no AI suggestion flow applies here.

---

## 10. PROGRESS TRACKER

```
[ ] Health check passed (see Section HEALTH CHECK above)
[ ] Linear ticket ACC-8 created via /new-ticket
[ ] Feature branch created: feature/ACC-8-roles-permissions
[ ] schema.prisma updated — Role extended with key, nameEn, nameAr, isActive
[ ] UserRole updated with createdAt
[ ] Migration run: npx prisma migrate dev --name extend-role-bilingual-names-and-key
[ ] Schema verified in Prisma Studio — Role has new columns
[ ] Commit 1 done: chore(prisma): extend Role with bilingual names and stable key [ACC-8]
[ ] Role/Permission interfaces written (IRole, IPermission)
[ ] All 5 DTO files written with class-validator decorators
[ ] Commit 2 done: feat(roles): add role interfaces and DTOs [ACC-8]
[ ] permission.seed.ts written — derives ALL_PERMISSIONS from permissions.ts constants
[ ] role.seed.ts written with all 7 system roles + Arabic labels + permission mappings
[ ] Commit 3 done: feat(roles): add permission catalog and system role seed data [ACC-8]
[ ] RoleService written — all methods implemented
[ ] Admin lockout protection implemented (deactivateRole + removeRoleFromUser)
[ ] getUserPermissions() implemented — active-role filtering, deduplication
[ ] RoleService spec covers: seed idempotency, CRUD, permission replace, lockout, isolation
[ ] npx tsc --noEmit → zero errors
[ ] npx jest --passWithNoTests → all tests pass
[ ] Commit 4 done: feat(roles): add RoleService with permission resolution [ACC-8]
[ ] RoleController written — all 11 endpoints, zero business logic
[ ] RoleController spec written — guards mocked, routing verified, /roles/permissions
    ordered before /roles/:id
[ ] Commit 5 done: feat(roles): add RoleController [ACC-8]
[ ] RolesModule created as @Global(), exports RoleService + PERMISSION_RESOLVER
[ ] AppModule updated with RolesModule import
[ ] npx tsc --noEmit → zero errors
[ ] npx jest --passWithNoTests → all tests pass
[ ] Commit 6 done: chore(roles): register global RolesModule in AppModule [ACC-8]
[ ] permission-resolver.interface.ts written
[ ] TenantGuard updated — injects PERMISSION_RESOLVER, populates request.userPermissions
[ ] PermissionGuard bypass removed — Step 1 stub comment removed
[ ] TenantService bootstrap TODO replaced with roleService.seedSystemRoles(id) call
[ ] TenantModule updated with forwardRef(() => RolesModule)
[ ] npx tsc --noEmit → zero errors
[ ] Full test suite (not --passWithNoTests) run and green after guard activation
[ ] Manually verified: existing endpoint (e.g. GET /lookups/categories) returns 200 for
    an authorized token and 403 for one lacking the permission
[ ] Commit 7 done: feat(auth): activate PermissionGuard via TenantGuard [ACC-8]
[ ] All controller specs still pass after guard activation (guards mocked — no change needed)
[ ] Note: real end-to-end permission testing deferred to Step 9
[ ] Angular RoleService written
[ ] role-list component written (PrimeNG Table, system/custom badges)
[ ] role-form component written (nameEn/nameAr/description)
[ ] role-permission-matrix component written (grouped checkbox grid, full-replace save)
[ ] user-role-assignment component written (stopgap, not yet linked from navigation)
[ ] roles.routes.ts written
[ ] Commit 8 done: feat(roles): add Angular role management UI [ACC-8]
[ ] en.json updated with all roles keys
[ ] ar.json updated with all Arabic translations
[ ] Commit 9 done: feat(i18n): add roles translation keys [ACC-8]
[ ] Final check: npx tsc --noEmit (backend + frontend) → zero errors
[ ] Final check: npx jest --passWithNoTests → all tests pass
[ ] Final check: tenant isolation tests for RoleService passing
[ ] Final check: admin lockout protection tests passing
[ ] /ready-to-pr run — PR opened to dev with [ACC-8] in title
[ ] CI green on GitHub Actions
[ ] PR merged to dev (squash merge)
[ ] feature/ACC-8-roles-permissions branch deleted from GitHub
[ ] ACC-8 marked Done in Linear
[ ] Step 5 (Workflow engine) can begin
```

---

*Plan created: 2026-07-20*
*Branch to create: feature/ACC-8-roles-permissions*
*Depends on: ACC-7 (merged to dev ✅)*
