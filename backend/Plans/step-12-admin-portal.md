# Step 12 — Admin Portal
# ACC-13: navigation shell, Super Admin portal, Tenant Admin settings, and
# DB-driven Plan/Module/AI-credit management (no Stripe — see CLAUDE.md's
# Build Sequence (Revised), Phase 2 — Monetization is ACC-25, separate ticket)

---

## HEALTH CHECK — Run Before Starting

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AccreditMe Health Check — 2026-07-29
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ERRORS:  None ✅
ERRORS:           None ✅
WARNINGS:         None ✅

DETAILED RESULTS

Check 1  Git State              PASS — on feature/ACC-13-admin-portal, clean
Check 2  Branch vs dev          INFO — branched from dev at 7ba6ce0, 0 drift
Check 3  Backend TypeScript     PASS — npx tsc --noEmit → zero errors
Check 5  Test Suite             PASS — 431/431 tests passing (27 suites)

OVERALL STATUS: 🟢 HEALTHY — ready to start ACC-13
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

Every foundation module through ACC-12 is fully wired on the backend
(TenantGuard/PermissionGuard on every controller) but the frontend has **no
navigation at all** — no app shell, no sidebar, direct-URL-only access to any
module UI (confirmed: `frontend/src/app/layout/` does not exist; every prior
step's own plan has noted this and deferred it, see Section 11). There is also
**no Super Admin surface anywhere** — tenant creation today only happens via
`demo-seed.ts` or a direct DB write, and **no `TenantService` method can even
create a new `Organization` row** (`bootstrap()` requires one to already
exist — confirmed by reading `tenant.service.ts`). This step builds:

1. **Navigation shell** — the app shell (header + sidebar + content) every
   future module's UI will render inside, replacing today's route-per-page
   layout-less arrangement.
2. **Super Admin Portal** — AccreditMe platform staff only: create tenants
   (the missing piece — a real `create()` + `bootstrap()` orchestration),
   list/manage tenants, per-tenant module + AI-credit control, impersonation,
   platform settings.
3. **Tenant Admin Settings** — a settings hub aggregating admin-facing screens
   that already exist scattered across foundation modules (working calendar,
   lookups, roles, org structure, org positions, workflow templates, users) —
   mostly **navigation/UI work, not new backend**, plus three genuinely new
   pieces: organization profile editing (logo — new field), email provider
   settings (UI only, per CLAUDE.md's Email Provider section), and AI settings
   (credits/enabled features).
4. **Plan/PlanModule/AiCreditPack/AiFeatureCost** — four new Prisma models,
   entirely DB-driven per CLAUDE.md's Pricing and Module Strategy section
   ("Plans are stored in DB — never hardcoded"). No Stripe anywhere in this
   ticket — see ACC-25 (Phase 2 — Monetization).
5. **`ModuleGuard`** — new guard checking `Organization.settings.modules`,
   alongside (never replacing) `TenantGuard`/`PermissionGuard`.

### Two Things Found During Research That Change This Plan's Shape

**(A) A real cross-tenant privilege-escalation gap exists today, unrelated to
this ticket's own scope but directly blocking it.** `SYSTEM_ROLE_SEED`
(`role.seed.ts`) seeds a `PLATFORM_ADMIN` role — holding `platform:admin` +
`platform:impersonate` — into **every single tenant's own `Role` table**,
because `seedSystemRoles(organizationId)` runs identically for every org on
bootstrap. `RoleService.getRoles()`/`assignRoleToUser()` have no special case
for it. **Any tenant admin can today open the existing role-assignment UI and
grant `PLATFORM_ADMIN` to one of their own users**, and since `PermissionGuard`
only checks "does this role grant permission X" — never which organization the
role belongs to — that user would pass any endpoint gated by
`@Permissions(PLATFORM_PERMISSIONS.ADMIN)` alone. Building the Super Admin
Portal on top of `PermissionGuard` alone would ship this hole live. **Fix
adopted (Commit 1, below): a new `Organization.isPlatformOrg: Boolean` flag —
exactly one Organization row is ever `true` — and a new `PlatformGuard` that
requires BOTH `platform:admin` permission AND the caller's own org having
`isPlatformOrg: true`.** This closes the gap without touching the existing
per-tenant `PLATFORM_ADMIN` role seed (still harmless — inert unless the
user's org happens to be the one flagged org). A follow-up (not blocking, see
Section 12) is filtering `PLATFORM_ADMIN` out of the assignable-roles list for
non-platform orgs, so it stops appearing as a selectable role in ordinary
tenants' UI at all.

**(B) The ticket's own acceptance criteria name a decorator that collides with
NestJS itself.** "`@Module()` decorator for controllers" — but `@Module()` is
`@nestjs/common`'s own core decorator, used at the top of every single
`*.module.ts` file in this codebase (`AuthModule`, `UserModule`, every
foundation module). A second decorator sharing that exact name and import
surface would be actively confusing at best and a silent shadow-import bug at
worst. **This plan uses `@RequiresModule(moduleKey: string)` instead** — same
purpose, no collision. Flagging the deviation explicitly per this session's
established practice of not silently carrying forward a spec's naming bug.

### `TenantService.bootstrap()` Cannot Create a Tenant — Only Seed One

Confirmed by reading `tenant.service.ts`: `bootstrap(id, actorId)` does
`prisma.organization.findUnique({ where: { id } })` and throws
`NotFoundException` if it doesn't exist — it seeds system data into an
**already-created** `Organization` row (self-service onboarding's job, ACC-16,
not built yet either). Its controller endpoint (`POST /tenant/bootstrap`)
reads `@CurrentTenant()`, meaning it's designed to be called BY a user already
inside that org — structurally incompatible with a Super Admin creating a
tenant for someone with no account yet. **This step adds the missing piece**:
a new `PlatformService.createTenant()` that creates the `Organization` row,
calls the *existing* `TenantService.bootstrap()` service method directly
(not through its controller — the service method itself takes a plain `id`,
it's only the controller that assumes `@CurrentTenant()`), then reuses the
*existing* `UserService.invite()` (built in ACC-12) to invite the tenant's
first admin and `RoleService.assignRoleToUser()` to grant `TENANT_ADMIN`.
Three already-built services orchestrated, zero duplicated logic.

### Scaffold Already in Place (do not blindly recreate)

```
TenantService.findById/update/getTenantConfig/bootstrap()  — EXISTS, reused as-is
TenantController (/tenant, /tenant/config, /tenant/bootstrap) — EXISTS, self-service only, untouched
Organization model                          — EXISTS — MODIFY (add fields, see Section 2)
RoleService.getRoles/getUserPermissions/assignRoleToUser — EXISTS, reused
UserService.invite()                        — EXISTS (ACC-12) — reused for tenant creation flow
AuditLogService                             — EXISTS — AuditAction enum needs 2 new values (Section 2)
PLATFORM_PERMISSIONS (platform:admin, platform:impersonate) — EXISTS, unused until now
PLATFORM_ADMIN / TENANT_ADMIN system roles  — EXIST (role.seed.ts) — reused, PLATFORM_ADMIN's
                                               cross-tenant exposure fixed via PlatformGuard (see above)
TenantGuard                                 — EXISTS — MODIFY minimally (impersonation claim passthrough, Section 8)
frontend/src/app/layout/                    — DOES NOT EXIST — CREATE (this step's core deliverable)
backend/src/platform/                       — DOES NOT EXIST — CREATE
WorkingCalendarService/LookupService/RoleService/OrgUnitService/OrgPositionService/
  WorkflowTemplateService/UserService admin UIs — ALL EXIST already as standalone
  routed pages (per every prior step's Section 11 note) — this step LINKS them
  into the new Tenant Admin Settings hub, does not rebuild them
```

### Explicit Non-Goals / Sequencing Notes

- **No Stripe, no payment processing, no webhooks** anywhere in this ticket —
  entirely ACC-25 (Phase 2 — Monetization). `Plan.monthlyPrice`/`annualPrice`
  are stored and displayed only; nothing charges anyone.
- **`ModuleGuard`/`@RequiresModule()` ship as infrastructure with nothing to
  decorate yet** — the functional modules they're meant to gate (Documents,
  Standards, Incidents, CAPA, Gap, Audit, KPI) don't exist until ACC-17+. Same
  precedent as Step 1's `PermissionGuard` shipping "stubbed" before Step 5
  (now ACC-8) enforced it for real. Verified via unit tests + one placeholder
  controller method in this step's own spec, not a real functional endpoint.
  ACC-14 (Committees) and ACC-15 (Meetings) — the next tickets — are expected
  to apply `@RequiresModule('committees')`/`@RequiresModule('meetings')` to
  their own new controllers themselves; not retrofitted here since those
  controllers don't exist yet either.
- **Email provider settings are UI-only** — this ticket adds
  `Organization.emailConfig` (encrypted, matching `authConfig`/`storageConfig`/
  `aiConfig`'s existing pattern) and a settings form that writes to it, but
  `NotificationEmailProcessor` keeps calling Resend directly. The actual
  `IEmailProvider` refactor is explicitly scheduled "Between Step 12-14" in
  CLAUDE.md's Email Provider section — a separate follow-up ticket, not
  bundled into ACC-13.
- **Impersonation is single-level** — a platform admin can impersonate a
  tenant admin; a tenant admin cannot impersonate anyone; nested/chained
  impersonation is out of scope.
- **AI credit *deduction* runtime flow** (`AiInteractionLog`, the 7-step "AI
  Runtime Flow" in CLAUDE.md's Pricing section) is **not** built here — this
  ticket only builds the *catalog* (`AiFeatureCost`, `AiCreditPack`) and
  *allocation* (`Organization.settings.ai.monthlyCredits` etc., settable by a
  Platform Admin). No AI feature call in this codebase deducts credits yet
  (none exist that call `AI_PROVIDER` for real) — wiring deduction into an
  actual AI call site is that future call site's job, not this ticket's.

---

## 2. PRISMA SCHEMA CHANGES

### NEW Models — Plan Catalog (Commit 1)

*Global, tenant-independent catalog — none of these four models carry an
`organizationId`. Matches CLAUDE.md's Plan Configuration Data Model exactly.*

```prisma
model Plan {
  id               String   @id @default(cuid())
  name             String                                  // internal/slug-like name
  nameEn           String
  nameAr           String
  monthlyPrice     Decimal  @db.Decimal(10, 2)
  annualPrice      Decimal  @db.Decimal(10, 2)
  maxFullUsers     Int?                                     // null = unlimited (Enterprise)
  maxStaff         Int?                                     // null = unlimited
  maxStorageGb     Int
  aiCreditsPerMonth Int
  isActive         Boolean  @default(true)
  isPublic         Boolean  @default(true)                   // false = custom/negotiated, hidden from self-service pricing page
  sortOrder        Int      @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  planModules      PlanModule[]
  organizations    Organization[]                            // reverse of Organization.planId

  @@index([isActive])
  @@index([isPublic])
}

model PlanModule {
  id           String            @id @default(cuid())
  planId       String
  moduleKey    String                                        // e.g. "documents", "standards", "audit" — free text
                                                                // by convention (never a Prisma enum — CLAUDE.md:
                                                                // "never hardcoded" applies to module keys too,
                                                                // same reasoning as Organization.settings.modules'
                                                                // own plain-string keys)
  accessLevel  PlanModuleAccess  @default(NONE)

  plan         Plan              @relation(fields: [planId], references: [id])

  @@unique([planId, moduleKey])
  @@index([planId])
}

enum PlanModuleAccess {
  FULL
  READ_ONLY
  NONE
}

model AiCreditPack {
  id           String   @id @default(cuid())
  name         String
  nameAr       String?
  credits      Int
  price        Decimal  @db.Decimal(10, 2)
  isActive     Boolean  @default(true)
  availableTo  String[]                                       // Plan.id[] this pack can be purchased under; empty = all plans
  sortOrder    Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([isActive])
}

model AiFeatureCost {
  id          String   @id @default(cuid())
  featureKey  String   @unique                                // e.g. "rca_assistance", "gap_analysis_report"
  creditCost  Int
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**Why `Decimal`, not `Int` cents, for prices:** matches the display values in
CLAUDE.md directly (e.g. `monthlyPrice`) — no currency-minor-unit conversion
layer exists elsewhere in this codebase yet, and introducing one here would be
new scope beyond this ticket. Revisit only if ACC-25 (Stripe) needs it.

### Organization Model Changes (Commit 1, same migration)

```prisma
model Organization {
  // ...existing fields unchanged...
  logo             String?                                    // ADD — S3 key, signed URL resolved at read time (never a direct S3 path, per CLAUDE.md)
  emailConfig      String?                                    // ADD — encrypted JSON, same pattern as authConfig/storageConfig/aiConfig
  isPlatformOrg    Boolean          @default(false)            // ADD — Section 1's PlatformGuard fix. Exactly one row ever true.
  planId           String?                                     // ADD — FK to new Plan model. Nullable: legacy/pre-Plan-model tenants
                                                                 // (all of them today) have none until a Platform Admin assigns one.
  plan             Plan?            @relation(fields: [planId], references: [id])   // ADD relation

  // NOTE: the EXISTING `plan SubscriptionPlan @default(STARTER)` enum field
  // is NOT removed in this step — see Section 12, Pending Discussion #2, for
  // why both the old enum and the new Plan FK coexist for now.

  @@index([isPlatformOrg])
  @@index([planId])
}
```

### `AuditAction` — Add Two Values (Commit 1, same migration)

```prisma
enum AuditAction {
  CREATE
  UPDATE
  DELETE
  VIEW
  LOGIN
  LOGOUT
  EXPORT
  IMPORT
  SUBMIT
  APPROVE
  REJECT
  PUBLISH
  ARCHIVE
  RESTORE
  DELEGATE
  IMPERSONATE_START   // ADD — Section 8's impersonation flow
  IMPERSONATE_END     // ADD
}
```

### Migration Name

```
add_plan_catalog_platform_org_flag_and_impersonation_audit_actions
```

```bash
cd backend && npx prisma migrate dev --name add_plan_catalog_platform_org_flag_and_impersonation_audit_actions
```

Purely additive — four new models, five new nullable/defaulted columns on
`Organization`, two new enum values. No data-loss risk.

**One-time data step, not a schema migration — must run once against every
real environment (dev, staging, prod) after this migration applies:**
designate exactly one `Organization` row as `isPlatformOrg: true` (the
AccreditMe internal org — create it via a small one-off script mirroring
`demo-seed.ts`'s own pattern, or manually via Prisma Studio in dev). Until
that row exists, every `PlatformGuard` check fails closed (no org has
`isPlatformOrg: true` yet) — **fail-closed by construction**, not an
oversight to patch later.

---

## 3. FILES TO CREATE / MODIFY (BACKEND)

### Commit 1 — Schema and migration
```
backend/prisma/schema.prisma                                            MODIFY
backend/prisma/migrations/YYYYMMDDHHMMSS_.../                          GENERATED
```
Section 2's changes. Run `npx prisma generate` after.

---

### Commit 2 — Plan catalog module (Platform Admin only)
```
src/platform/plan/interfaces/plan.interface.ts                          CREATE
src/platform/plan/dto/create-plan.dto.ts                                 CREATE
src/platform/plan/dto/update-plan.dto.ts                                 CREATE
src/platform/plan/dto/upsert-plan-module.dto.ts                          CREATE
src/platform/plan/dto/create-ai-credit-pack.dto.ts                       CREATE
src/platform/plan/dto/upsert-ai-feature-cost.dto.ts                      CREATE
src/platform/plan/plan.service.ts                                        CREATE
src/platform/plan/plan.service.spec.ts                                   CREATE
src/platform/plan/plan.controller.ts                                     CREATE
src/platform/plan/plan.controller.spec.ts                                CREATE
src/platform/plan/plan.module.ts                                         CREATE
```

**`plan.service.ts`** methods:
```typescript
listPlans(includeInactive?: boolean): Promise<IPlan[]>
getPlanById(id: string): Promise<IPlan>                                   // includes planModules[]
createPlan(dto: CreatePlanDto, actorId: string): Promise<IPlan>
updatePlan(id: string, dto: UpdatePlanDto, actorId: string): Promise<IPlan>
deactivatePlan(id: string, actorId: string): Promise<void>                 // soft — isActive: false, never deleted (tenants may reference it)

upsertPlanModule(planId: string, dto: UpsertPlanModuleDto, actorId: string): Promise<IPlanModule>
listPlanModules(planId: string): Promise<IPlanModule[]>

listAiCreditPacks(includeInactive?: boolean): Promise<IAiCreditPack[]>
createAiCreditPack(dto: CreateAiCreditPackDto, actorId: string): Promise<IAiCreditPack>
updateAiCreditPack(id: string, dto: Partial<CreateAiCreditPackDto>, actorId: string): Promise<IAiCreditPack>

listAiFeatureCosts(): Promise<IAiFeatureCost[]>
upsertAiFeatureCost(dto: UpsertAiFeatureCostDto, actorId: string): Promise<IAiFeatureCost>   // upsert by featureKey — matches AiFeatureCost.featureKey @unique
```

No `organizationId` parameter anywhere in this service — these are global
catalog entities, gated entirely by `PlatformGuard` at the controller.

**Spec must cover:** CRUD happy paths, `deactivatePlan` never hard-deletes,
`upsertPlanModule`'s `@@unique([planId, moduleKey])` update-vs-create branch,
`upsertAiFeatureCost`'s update-vs-create branch by `featureKey`. No tenant
isolation test needed here — there is no tenant dimension on these models by
design (flag this explicitly in the spec file's own header comment so a
future reviewer doesn't file it as a missing-test gap).

**`plan.controller.ts`** — `@Controller('platform/plans')` /
`platform/plan-modules` / `platform/ai-credit-packs` / `platform/ai-feature-costs`
(four resource groups, one controller — small enough not to split, matching
`RoleController`'s own precedent of owning multiple related resource groups).
`@UseGuards(TenantGuard, PlatformGuard)` at class level (Commit 4 defines
`PlatformGuard` — this commit's controller imports it; sequencing note: this
commit's controller.spec.ts mocks `PlatformGuard` the same way other specs
mock `PermissionGuard`, so Commit 2 does not need to physically wait for
Commit 4 to compile — only to actually boot).

---

### Commit 3 — `Organization.emailConfig` + `logo` read/write on TenantService
```
src/foundation/tenant/tenant.service.ts                                  MODIFY
src/foundation/tenant/tenant.service.spec.ts                             MODIFY
src/foundation/tenant/tenant.controller.ts                               MODIFY
src/foundation/tenant/dto/update-tenant.dto.ts                           MODIFY
src/foundation/tenant/dto/update-email-config.dto.ts                     CREATE
src/foundation/tenant/interfaces/tenant.interface.ts                     MODIFY
```

`UpdateTenantDto` gains optional `logo` (S3 key, uploaded separately via the
existing signed-upload flow — no new upload endpoint needed, reuses whatever
Step 1's `StorageProvider` already exposes). New DTO `UpdateEmailConfigDto`:
`emailProvider: 'resend'|'smtp'|'office365'|'sendgrid'|'ses'`, `config:
Record<string, unknown>` (shape varies per provider — validated loosely as
`@IsObject()`, not per-provider-typed, since no provider but Resend is ever
actually read yet per Section 1's non-goals).

New `TenantService` methods: `updateEmailConfig(id, dto, actorId)` (encrypts
via the existing `encryptConfig()`/`ENCRYPTION_KEY` helper, same as
auth/storage/AI config), `getEmailConfig(id)` (decrypts, returns provider name
+ config; never returns raw encrypted string to the frontend).

New controller endpoints: `PATCH /tenant/email-config`
(`@Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)`, same permission the
existing `/tenant/config` GET already requires), `GET /tenant/email-config`.

`getTenantConfig()`'s response interface (`ITenantConfig`) gains
`emailProvider`/`emailConfig` fields alongside the existing
auth/storage/AI ones.

---

### Commit 4 — `PlatformGuard`
```
src/common/guards/platform.guard.ts                                     CREATE
src/common/guards/platform.guard.spec.ts                                CREATE
```

```typescript
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,  // whatever PermissionGuard already uses to resolve a user's permission set — reuse, don't reimplement
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ userId: string; tenantId: string }>();

    const org = await this.prisma.organization.findUnique({ where: { id: request.tenantId } });
    if (!org?.isPlatformOrg) {
      throw new ForbiddenException('Platform admin access requires an AccreditMe platform account');
    }

    const permissions = await this.permissionResolver.getUserPermissions(request.userId, request.tenantId);
    if (!permissions.includes(PLATFORM_PERMISSIONS.ADMIN)) {
      throw new ForbiddenException('Requires platform:admin permission');
    }

    return true;
  }
}
```

Applied as `@UseGuards(TenantGuard, PlatformGuard)` — **never** `PermissionGuard`
alone, and never `PlatformGuard` without `TenantGuard` first (needs
`request.userId`/`request.tenantId` already populated). This is the concrete
fix for Section 1's finding (A).

**Spec must cover:** rejects when `org.isPlatformOrg` is false regardless of
permissions held (the actual exploit path found in research — a user with
`platform:admin` from a self-assigned `PLATFORM_ADMIN` role in an ordinary
tenant must still be rejected); rejects when `isPlatformOrg` true but
`platform:admin` missing; allows when both true.

---

### Commit 5 — `ModuleGuard` + `@RequiresModule()`
```
src/common/guards/module.guard.ts                                       CREATE
src/common/guards/module.guard.spec.ts                                   CREATE
src/common/decorators/requires-module.decorator.ts                      CREATE
```

```typescript
export const REQUIRES_MODULE_KEY = 'requiresModule';
export const RequiresModule = (moduleKey: string) => SetMetadata(REQUIRES_MODULE_KEY, moduleKey);
```

```typescript
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleKey = this.reflector.get<string>(REQUIRES_MODULE_KEY, context.getHandler());
    if (!moduleKey) return true;   // no @RequiresModule() on this handler — no-op, same "stubbed" shape as Step 1's PermissionGuard before enforcement existed

    const request = context.switchToHttp().getRequest<{ tenantId: string }>();
    const org = await this.prisma.organization.findUnique({ where: { id: request.tenantId } });
    const modules = (org?.settings as { modules?: Record<string, boolean> } | null)?.modules ?? {};

    if (modules[moduleKey] !== true) {
      throw new ForbiddenException(`The '${moduleKey}' module is not enabled for this organization`);
    }
    return true;
  }
}
```

**Spec must cover:** no-op when no `@RequiresModule()` metadata present
(critical — every existing controller must keep working unmodified once this
guard is added anywhere globally); throws when `modules[key]` is `false`,
`undefined`, or `settings` itself is `null`; passes when explicitly `true`.
Since no real controller uses `@RequiresModule()` yet (Section 1's
non-goal), the spec exercises it against a throwaway `@Controller()` fixture
defined inline in the spec file, not a real production endpoint.

---

### Commit 6 — Platform (Super Admin) tenant management
```
src/platform/tenant/dto/create-tenant.dto.ts                             CREATE
src/platform/tenant/dto/update-tenant-modules.dto.ts                     CREATE
src/platform/tenant/dto/allocate-ai-credits.dto.ts                       CREATE
src/platform/tenant/platform-tenant.service.ts                          CREATE
src/platform/tenant/platform-tenant.service.spec.ts                     CREATE
src/platform/tenant/platform-tenant.controller.ts                       CREATE
src/platform/tenant/platform-tenant.controller.spec.ts                  CREATE
src/platform/tenant/platform.module.ts                                  CREATE
```

**`platform-tenant.service.ts`** methods:

```typescript
// Cross-tenant by design — no organizationId filter. Gated entirely by
// PlatformGuard at the controller, not by query scoping (there is nothing to
// scope — this IS the "see every tenant" surface).
listTenants(filters?: { status?: TenantStatus; planId?: string }): Promise<IPlatformTenantSummary[]>

getTenantDetail(id: string): Promise<IPlatformTenantDetail>   // usage: user count, storage used, last activity, plan, module flags

// Orchestrates 3 existing services — see Section 1's finding. Creates the
// Organization row directly (bypassing self-service onboarding's not-yet-built
// wizard), then delegates.
createTenant(dto: CreateTenantDto, actorId: string): Promise<IPlatformTenantDetail>
//   1. prisma.organization.create({ name, slug, country, planId })
//   2. await this.tenantService.bootstrap(org.id, actorId)   — reused as-is
//   3. await this.userService.invite({ email: dto.adminEmail, name: dto.adminName, roleKeys: ['TENANT_ADMIN'] }, org.id, actorId)  — reused as-is (ACC-12)

suspendTenant(id: string, actorId: string): Promise<void>       // status → SUSPENDED
reactivateTenant(id: string, actorId: string): Promise<void>    // status → ACTIVE
extendTrial(id: string, newTrialEndsAt: Date, actorId: string): Promise<void>

updateTenantModules(id: string, dto: UpdateTenantModulesDto, actorId: string): Promise<void>
  // merges into Organization.settings.modules JSON — never overwrites unrelated settings keys wholesale

allocateAiCredits(id: string, dto: AllocateAiCreditsDto, actorId: string): Promise<void>
  // merges into Organization.settings.ai — monthlyCredits/creditsRemaining/overageEnabled

// Mints a normal access_token JWT for targetUserId (must belong to org `tenantId`
// and hold TENANT_ADMIN), with an added `impersonatedBy: platformAdminUserId`
// claim. Sets it as the SAME access_token cookie AuthService.login() uses —
// TenantGuard needs zero changes to validate it (see Section 8). Logs
// IMPERSONATE_START with actorId = platformAdminUserId.
startImpersonation(tenantId: string, targetUserId: string, platformAdminUserId: string, res: ExpressResponse): Promise<void>

// Reads impersonatedBy off the CURRENT request's JWT (already verified by
// TenantGuard), mints a fresh normal JWT for that original platform admin,
// re-sets the cookie. Logs IMPERSONATE_END.
endImpersonation(req: ExpressRequest, res: ExpressResponse): Promise<void>
```

**Spec must cover:** `createTenant()` calls all three delegated services in
order with correct arguments (mocked); `createTenant()` rejects a duplicate
slug (unique constraint → translated to `ConflictException`, matching
`TenantService.bootstrap()`'s own `ConflictException` precedent);
`updateTenantModules()`/`allocateAiCredits()` merge rather than replace
`settings` (test: existing unrelated `settings.taskSla` survives a modules
update); `startImpersonation()` rejects a `targetUserId` that doesn't belong
to `tenantId` or doesn't hold `TENANT_ADMIN`; `endImpersonation()` throws if
called on a non-impersonated session (no `impersonatedBy` claim present).

**`platform-tenant.controller.ts`** — `@Controller('platform/tenants')`,
`@UseGuards(TenantGuard, PlatformGuard)` at class level:

```
GET    /platform/tenants                       list + filters
GET    /platform/tenants/:id                   detail + usage
POST   /platform/tenants                       createTenant
POST   /platform/tenants/:id/suspend
POST   /platform/tenants/:id/reactivate
POST   /platform/tenants/:id/extend-trial
PATCH  /platform/tenants/:id/modules           updateTenantModules
PATCH  /platform/tenants/:id/ai-credits        allocateAiCredits
POST   /platform/tenants/:id/impersonate/:userId   startImpersonation
```

`POST /platform/end-impersonation` lives on this same controller but is
**not** `PlatformGuard`-gated the normal way — the caller, mid-impersonation,
is holding the *impersonated tenant admin's* JWT, which has no
`isPlatformOrg`/`platform:admin` standing of its own. Guarded by `TenantGuard`
alone; the service method itself validates the `impersonatedBy` claim is
present before doing anything (fails closed if it's a normal, non-impersonated
session calling it).

**`platform.module.ts`**:
```typescript
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule), UserModule, RolesModule],
  controllers: [PlatformTenantController],
  providers: [PlatformTenantService],
  exports: [PlatformTenantService],
})
export class PlatformModule {}
```

---

### Commit 7 — `PlatformSettingsService` (platform-wide config, not per-tenant)
```
src/platform/settings/platform-settings.service.ts                      CREATE
src/platform/settings/platform-settings.service.spec.ts                 CREATE
src/platform/settings/platform-settings.controller.ts                   CREATE
src/platform/settings/platform-settings.controller.spec.ts              CREATE
```

Minimal for this ticket — CLAUDE.md's Super Admin Portal lists "Platform
settings" and "Announcements: Platform-wide banner messages" but gives no
concrete data model. This commit ships the smallest real thing: a single
`PlatformSetting` key-value-ish surface reusing the **existing** pattern (no
new model — stored as `Organization.settings` on the one `isPlatformOrg: true`
row itself, under a `platformAnnouncement` key: `{ message: string, severity:
'info'|'warning', activeFrom, activeUntil }`). `GET /platform/settings` (any
authenticated user — the frontend needs to read the active announcement
banner regardless of role) / `PATCH /platform/settings` (`PlatformGuard`).
Deliberately not over-built (no new model, no admin-notification bus) —
flagged in Section 12 as intentionally minimal, expand only when a second
real platform-setting need appears.

---

### Commit 8 — Expose permissions + licensed modules for the frontend nav
```
src/foundation/roles/role.controller.ts                                  MODIFY
src/foundation/roles/role.controller.spec.ts                             MODIFY
src/foundation/tenant/interfaces/tenant.interface.ts                     MODIFY (already touched Commit 3 — add `modules` field here too)
src/foundation/tenant/tenant.service.ts                                   MODIFY
```

`RoleService.getUserPermissions()` already exists (built earlier, unused by
any controller) — add `GET /roles/my-permissions` (`@CurrentUser()`,
`@CurrentTenant()`, `TenantGuard` only — no specific permission required,
every authenticated user can read their own permission set) returning
`string[]`.

`TenantService.findById()`'s `ITenant` response gains `modules:
Record<string, boolean>` derived from `organization.settings.modules ?? {}` —
the sidebar's one-stop source for "what am I licensed to see," reusing the
already-called `GET /tenant` endpoint rather than adding a third one.

---

### Commit 9 — `TenantGuard` impersonation claim passthrough
```
src/common/guards/tenant.guard.ts                                       MODIFY
src/common/guards/tenant.guard.spec.ts                                  MODIFY
```

One small, additive change: after JWT verification, if the payload carries
`impersonatedBy`, attach it to the request (`request.impersonatedBy =
payload.impersonatedBy`) alongside the existing `request.userId`/
`request.tenantId`. **`verifyJwt()` itself, the `tokenVersion` check, and
`PermissionGuard` are completely untouched** — same "confirmed via
`git diff --stat` showing zero changes" bar Step 9/ACC-12 held itself to for
this exact guard. `AuditLogService.log()` calls made during an impersonated
session should include `impersonatedBy` in their `metadata` where the calling
service already has access to `request` — this plan does **not** thread it
through every single existing `AuditLogService.log()` call site
retroactively (that would touch nearly every module in the codebase); it's
available on `request` for any NEW call site going forward, and
`startImpersonation`/`endImpersonation` themselves log it explicitly.

---

## 4. FILES TO CREATE (FRONTEND)

### Commit 10 — Navigation shell
```
frontend/src/app/layout/
  app-shell/app-shell.component.ts                                       CREATE
  sidebar/sidebar.component.ts                                           CREATE
  topbar/topbar.component.ts                                             CREATE
  breadcrumb/breadcrumb.component.ts                                     CREATE
frontend/src/app/core/services/navigation-access.service.ts             CREATE
frontend/src/app/app.component.html                                     MODIFY
frontend/src/app/app.routes.ts                                          MODIFY
```

**`navigation-access.service.ts`** — calls `GET /roles/my-permissions` and
`GET /tenant` once (cached signals, refreshed on login/`restoreSession()`),
exposes `hasPermission(perm: string): boolean` and
`isModuleEnabled(key: string): boolean` for the sidebar and any future
`@RequiresModule()`-mirroring route guard to consume.

**`app-shell.component.ts`** — `PrimeNG p-toolbar` (topbar) + custom sidebar
(not `p-sidebar`'s overlay mode — this needs a permanent collapsible rail per
CLAUDE.md's Brand Design Tokens layout spec: "Top bar 64px + Sidebar 260px
collapsible + Main content fills remaining space") + `<router-outlet>` for
content. Wraps every guarded route going forward.

**`sidebar.component.ts`** — static nav-item list (foundation items always
visible: Tasks, Users, Committees\*, Meetings\*, Roles, Org Structure, Org
Positions, Lookups, Workflows, Working Calendar — \*only once ACC-14/15 ship,
not yet), functional-module items filtered through
`navigationAccessService.isModuleEnabled(key)` (none exist yet — the list is
present but every entry evaluates to hidden until ACC-17+, proving the
mechanism works via Commit 5's `ModuleGuard` spec fixture pattern mirrored
here), plus "Super Admin" section shown only when `hasPermission('platform:
admin')` **and** the current org is the platform org (mirrors `PlatformGuard`'s
own two-part check — checked via `GET /tenant`'s new response, not trusted
from a JWT claim the frontend can't read anyway). Active item gets the 3px
green left stripe per Brand Design Tokens.

**`breadcrumb.component.ts`** — derives from `ActivatedRoute`'s `data.breadcrumb`
static route data (each route in `app.routes.ts` gains a `data: {
breadcrumb: 'Users' }` entry) — simplest approach, no new routing library.

**`app.routes.ts`** — every existing guarded route (`organization`,
`working-calendar`, `lookups`, `roles`, `workflows`, `org-positions`, `tasks`,
`users`) moves under a new parent route wrapping `AppShellComponent`:
```typescript
{
  path: '',
  component: AppShellComponent,
  canActivate: [authGuard],
  children: [
    { path: '', redirectTo: 'organization', pathMatch: 'full' },   // replaces the old root '' redirect entry
    { path: 'organization', data: { breadcrumb: 'nav.organization' }, loadChildren: ... },
    // ...every existing entry, unchanged loadChildren, now nested + given breadcrumb data
    { path: 'platform', data: { breadcrumb: 'nav.platform' }, loadChildren: () => import('./platform/platform.routes').then(m => m.PLATFORM_ROUTES) },
    { path: 'admin-settings', data: { breadcrumb: 'nav.adminSettings' }, loadChildren: () => import('./foundation/admin-settings/admin-settings.routes').then(m => m.ADMIN_SETTINGS_ROUTES) },
  ],
},
```
The standalone root-redirect route added for the session-restore fix (an
earlier ACC-12 follow-up) is superseded by this restructure — its
`redirectTo: 'organization'` behavior is preserved as the new shell's own
default child route, not duplicated.

`app.component.html` — now just `<router-outlet>` (the shell itself moves
into `AppShellComponent`; `app.component.html` stops being where the
notification bell/confirm-dialog live standalone — they move into
`AppShellComponent`'s topbar, still registered from the same global
providers).

---

### Commit 11 — Super Admin Portal (Angular)
```
frontend/src/app/platform/
  services/platform-tenant.service.ts                                   CREATE
  services/plan.service.ts                                              CREATE
  components/
    tenant-list/tenant-list.component.ts                                CREATE
    tenant-detail/tenant-detail.component.ts                            CREATE
    create-tenant/create-tenant.component.ts                            CREATE
    plan-list/plan-list.component.ts                                    CREATE
    plan-form/plan-form.component.ts                                    CREATE
    ai-credit-pack-list/ai-credit-pack-list.component.ts                CREATE
    ai-feature-cost-list/ai-feature-cost-list.component.ts              CREATE
    platform-settings/platform-settings.component.ts                    CREATE
  platform.routes.ts                                                    CREATE
```

`tenant-list.component.ts` — table: name, slug, status pill, plan, last
activity; suspend/reactivate/extend-trial row actions (ConfirmationService
dialog for suspend, matching this codebase's established confirm-dialog
pattern from Step 9); "Create Tenant" button routes to `create-tenant`.

`create-tenant.component.ts` — Reactive Form: org name, slug (validated
unique — debounced async validator hitting a lightweight
`GET /platform/tenants?slug=` check, or just surface the `ConflictException`
on submit if that's simpler for this ticket's scope — **flagged as an
implementation-time choice, not a blocking decision**), country, plan
(dropdown from `GET /platform/plans`), admin name + email. Submits to
`POST /platform/tenants`.

`tenant-detail.component.ts` — usage summary (user count, storage), module
toggle list (`PATCH /platform/tenants/:id/modules`), AI credit allocation
form (`PATCH /platform/tenants/:id/ai-credits`), "Impersonate" button per
active `TENANT_ADMIN` user in that tenant (needs
`GET /platform/tenants/:id` to include a list of that org's `TENANT_ADMIN`
users to impersonate — add this to `getTenantDetail()`'s response, Commit 6).

`plan-list.component.ts` / `plan-form.component.ts` — full CRUD against
`/platform/plans`, `PlanModule` editor embedded in the plan form (one row per
`moduleKey` with an `accessLevel` select — module key list is a **plain
hardcoded frontend constant array** for the dropdown's options only, e.g.
`['documents','standards','incidents','capa','gap','audit','kpi',
'committees','meetings']` — this is a UI convenience list, not a schema
enum, so it doesn't violate CLAUDE.md's "never hardcoded" rule the way a
Prisma enum would; expand this array, not the schema, whenever a new
functional module ships).

An impersonation banner (shown app-wide, not just in this component) belongs
in `AppShellComponent`'s topbar — "Impersonating {tenant name} as {user
name} · End Impersonation" — reads a signal set by
`AuthService.restoreSession()`/`login response` if a future `/auth/me` change
exposes `impersonatedBy` (**this plan does not extend `/auth/me` for this —
see Section 12, Pending Discussion #3, for why this needs one more small
decision before Commit 11 can finish the banner**).

---

### Commit 12 — Tenant Admin Settings hub (Angular)
```
frontend/src/app/foundation/admin-settings/
  admin-settings.routes.ts                                              CREATE
  components/
    settings-hub/settings-hub.component.ts                              CREATE
    organization-profile/organization-profile.component.ts              CREATE
    email-provider-settings/email-provider-settings.component.ts        CREATE
    ai-settings/ai-settings.component.ts                                CREATE
```

`settings-hub.component.ts` — a single landing page with a card grid linking
out to: Organization Profile (new, this commit), Working Calendar (existing
route, linked), Lookups (existing, linked), Roles (existing, linked), Org
Structure (existing, linked), Org Positions (existing, linked), Workflow
Templates (existing, linked), Users (existing, linked), Email Provider (new,
this commit), AI Settings (new, this commit). **Mostly a linking exercise** —
per Section 1, the bulk of Tenant Admin Settings already has working UI; this
commit's real net-new work is the three components below plus this hub page
tying them together.

`organization-profile.component.ts` — Reactive Form: name, country (dropdown
— reuse whatever country list Step 1's onboarding assumptions already
established, or a plain ISO-3166 constant if none exists yet — flagged as a
small implementation-time check), logo upload (existing `StorageProvider`
signed-upload flow). `PATCH /tenant`.

`email-provider-settings.component.ts` — provider select (Resend/SMTP/
Office365/SendGrid/SES), a config `<textarea>` for the JSON blob (deliberately
un-typed per-provider form — Section 1's non-goal: this ticket doesn't wire
real per-provider validation UI, just persists whatever the tenant admin
enters). `PATCH /tenant/email-config`.

`ai-settings.component.ts` — read-only display of current
`monthlyCredits`/`creditsUsed`/`creditsRemaining`/`resetDate` (Platform Admin
sets the allocation, not the tenant admin — this page has no write action
beyond an `overageEnabled` toggle, which IS tenant-controllable per CLAUDE.md's
`Organization.settings.ai.overageEnabled` field). Needs a
`GET /tenant/ai-settings`-shaped read — **reuses the existing `GET /tenant`
response** (Commit 8 already adds `modules`; this component reads a sibling
`ai` field the same response could expose — add it in Commit 8's
`ITenant` change rather than a fifth new endpoint).

---

### Commit 13 — Translation keys
```
frontend/src/assets/i18n/en.json     MODIFY
frontend/src/assets/i18n/ar.json     MODIFY
```

New namespaces: `"nav"` additions (organization, workingCalendar, lookups,
roles, orgStructure, orgPositions, workflows, users, platform, adminSettings,
tasks, committees, meetings — breadcrumb labels), `"platform"` (tenants,
createTenant, suspend, reactivate, extendTrial, impersonate,
endImpersonation, impersonatingBanner, plans, planModules, aiCreditPacks,
aiFeatureCosts, platformSettings, announcement), `"adminSettings"`
(title, organizationProfile, emailProvider, aiSettings, logo, country,
provider options, creditsRemaining, overageEnabled). Real Arabic throughout,
not placeholders.

---

## 5. COMMIT SEQUENCE

All commits on branch `feature/ACC-13-admin-portal`.
Format: `{type}({scope}): {description} [ACC-13]`

```
Commit 1:  chore(prisma): add Plan catalog, isPlatformOrg flag, impersonation audit actions [ACC-13]
Commit 2:  feat(platform): add Plan/PlanModule/AiCreditPack/AiFeatureCost catalog [ACC-13]
Commit 3:  feat(tenant): add email config and logo fields [ACC-13]
Commit 4:  feat(common): add PlatformGuard [ACC-13]
Commit 5:  feat(common): add ModuleGuard and RequiresModule decorator [ACC-13]
Commit 6:  feat(platform): add Super Admin tenant management and impersonation [ACC-13]
Commit 7:  feat(platform): add minimal platform settings surface [ACC-13]
Commit 8:  feat(roles): expose my-permissions and licensed modules for navigation [ACC-13]
Commit 9:  feat(auth): pass through impersonatedBy claim in TenantGuard [ACC-13]
Commit 10: feat(ui-layout): add navigation shell, sidebar, breadcrumb [ACC-13]
Commit 11: feat(ui-platform): add Super Admin portal UI [ACC-13]
Commit 12: feat(ui-admin-settings): add Tenant Admin settings hub [ACC-13]
Commit 13: feat(i18n): add navigation and admin portal translation keys [ACC-13]
```

Run `npx tsc --noEmit` before every backend commit (1–9) and every frontend
commit (10–13). Run `npx jest --passWithNoTests` before every backend commit
that adds/modifies a spec (2, 3, 4, 5, 6, 7, 8, 9).

**Commit 1 carries zero data-loss risk** — purely additive. **The
one-time "designate the platform org" data step (Section 2) must run in every
real environment before Commit 4's `PlatformGuard` is exercised against real
traffic** — in dev, do this immediately after Commit 1's migration, before
continuing to Commit 2.

**Commit 4 must be verified with the exploit scenario from Section 1 as an
actual test, not just a happy-path check** — a user holding `platform:admin`
via a self-assigned `PLATFORM_ADMIN` role inside an ordinary (non-platform)
tenant must be rejected. This is the single most important test in this
entire ticket.

**Commit 10 is the largest single-commit risk** — restructuring
`app.routes.ts` to nest every existing route under the new shell touches
every foundation module's routing simultaneously. Manually click through
every existing route (`organization`, `working-calendar`, `lookups`, `roles`,
`workflows`, `org-positions`, `tasks`, `users`, `login`, `accept-invitation`,
`forgot-password`) after this commit, not just `tsc`/build-clean — a routing
regression here would silently break every foundation module's UI at once.

---

## 6. ACCEPTANCE CRITERIA

- [x] Navigation sidebar with module-based routing
- [x] App shell layout (header + sidebar + content area)
- [x] Breadcrumb navigation
- [x] Super Admin Portal: tenant list and management
- [x] Super Admin Portal: create tenant (creates Organization row + runs bootstrap + invites first admin)
- [x] Super Admin Portal: view tenant usage and activity
- [x] Super Admin Portal: enable/disable modules per tenant
- [x] Super Admin Portal: AI credit allocation per tenant
- [x] Super Admin Portal: impersonate tenant admin, with a visible end-impersonation path
- [x] Super Admin Portal: platform settings (minimal — announcement banner)
- [x] PlatformGuard rejects a self-assigned PLATFORM_ADMIN role from a non-platform org — verified by an explicit test, not just guard logic existing
- [x] Tenant Admin Settings: organization profile (name, logo, country) — logo field is a plain S3-key text input; no file-upload UI/endpoint exists anywhere yet, flagged rather than faked (see Commit 12 notes)
- [x] Tenant Admin Settings: working calendar, lookups, roles, org structure, org positions, workflow templates, users — all linked from the settings hub
- [x] Tenant Admin Settings: email provider settings (UI only — persists to Organization.emailConfig, no live provider switch)
- [x] Tenant Admin Settings: AI settings (credits display, overageEnabled toggle) — required a small new tenant-scoped endpoint (`PATCH /tenant/ai-settings`) not in the original Commit 6 file list
- [x] Plan CRUD (Platform Admin)
- [x] PlanModule configuration
- [x] AiFeatureCost configuration
- [x] AiCreditPack configuration
- [x] Organization module enable/disable via Organization.settings.modules
- [x] ModuleGuard + @RequiresModule() decorator built and unit-tested (nothing to apply it to yet — see Section 1)
- [x] Frontend navigation hides unlicensed modules (mechanism proven even with zero real licensed modules yet)
- [ ] Every existing foundation route still reachable and functional after the app-shell restructure — verified via `tsc --noEmit` + `ng build` (clean both times) only; NOT manually click-tested in a real browser. Flagging honestly rather than claiming full UI verification.
- [x] Backend TypeScript: zero errors
- [x] All tests passing including tenant isolation (514 backend tests passing)
- [x] Frontend TypeScript: zero errors
- [x] Translation keys added in en.json and ar.json
- [x] Tenant isolation: Super Admin sees all tenants (by design, gated by PlatformGuard, not tenant scoping); Tenant Admin sees only their own
- [ ] PR merged to dev with green CI — not opened yet, next step after this build

---

## 7. DEPENDENCIES

### What This Step Requires from ACC-5–ACC-12

| Requirement | Where It Comes From |
|---|---|
| `TenantService.bootstrap()`, `.findById()`, `.getTenantConfig()` | ACC-5 |
| `AuditLogService`, encrypted-config helpers (`encryptConfig`/`ENCRYPTION_KEY`) | ACC-5 |
| `TenantGuard`, `PermissionGuard` | ACC-8 |
| `RoleService.getRoles/getUserPermissions/assignRoleToUser`, `PLATFORM_ADMIN`/`TENANT_ADMIN` system roles | ACC-8 |
| `WorkingCalendarService`/`LookupService`/`OrgUnitService`/`OrgPositionService`/`WorkflowTemplateService` admin UIs (linked, not rebuilt) | ACC-6, ACC-7, ACC-9, ACC-11 |
| `UserService.invite()`, MFA-capable auth | ACC-12 |
| `authGuard`, `AuthService.currentUser`/`restoreSession()` | ACC-12 (+ follow-up session-restore fix) |

### What Future Steps Will Require from ACC-13

| Future Step | What It Needs |
|---|---|
| ACC-14 (Committees), ACC-15 (Meetings) | The app shell to render inside; expected to apply `@RequiresModule('committees')`/`@RequiresModule('meetings')` to their own new controllers themselves |
| ACC-16 (Tenant Onboarding wizard) | The navigation shell + the now-real `PlatformTenantService.createTenant()` pattern as a reference for what self-service onboarding must also accomplish without a Platform Admin present |
| ACC-17+ (all functional modules) | `ModuleGuard`/`@RequiresModule()`, `PlanModule.moduleKey` conventions, and the sidebar's `isModuleEnabled()` gating — all built now, applied then |
| ACC-25 (Stripe + Billing) | The `Plan`/`PlanModule`/`AiCreditPack`/`AiFeatureCost` models this step creates — ACC-25 wires Stripe products/webhooks on top of this catalog, does not replace it |

---

## 8. BUSINESS RULES

### PlatformGuard Is Two Independent Checks, Both Required

`isPlatformOrg` on the caller's own organization, AND `platform:admin`
permission. Neither alone is sufficient — this is the direct fix for Section
1's finding. A user in the platform org without `platform:admin` (e.g. a
future lower-privilege platform support role) is still rejected; a user with
`platform:admin` outside the platform org is still rejected.

### Impersonation Session Shape

An impersonation JWT is a **normal** `access_token` — same 15-minute expiry,
same cookie, same `TenantGuard` validation path — with one added claim,
`impersonatedBy`. `TenantGuard` (Commit 9) surfaces it on `request` but does
not change how it authenticates the request otherwise: the impersonated
tenant admin's own `tokenVersion`/`status` are still checked exactly as if
they'd logged in themselves. Ending impersonation requires that same claim to
still be present on whatever cookie is active at the time `POST
/platform/end-impersonation` is called — if a platform admin's own separate
browser tab still has their un-impersonated session, that's a different
cookie/session entirely and irrelevant to ending this one.

### Module Licensing Never Blocks Foundation Modules

`Organization.settings.modules` and `@RequiresModule()` only ever gate the
*functional* modules (documents, standards, incidents, capa, gap, audit, kpi,
committees, meetings per Section 4's frontend module-key list) — never
tenant/org/roles/lookups/workflow/tasks/users, which every tenant always has
regardless of plan. `ModuleGuard`'s no-op-when-no-decorator default (Section
3, Commit 5) is what makes this automatic — foundation controllers simply
never get `@RequiresModule()` applied to them.

### Audit Log

`AuditLogService.log()` on every mutation: tenant CRUD (`CREATE`/`UPDATE` on
`Organization`), Plan/PlanModule/AiCreditPack/AiFeatureCost CRUD (`CREATE`/
`UPDATE`/`DELETE` semantics on their respective object types — Platform Admin
actions, `tenantId` on these log rows is the **platform org's** id, not the
target tenant's, since these are platform-catalog objects with no tenant
dimension of their own), `IMPERSONATE_START`/`IMPERSONATE_END` (new enum
values, Section 2) on both the platform admin's action and — for
`IMPERSONATE_START` specifically — a second log row under the *target*
tenant's `tenantId` so that tenant's own audit trail shows "an impersonated
session began," not just the platform side.

---

## 9. AI INTEGRATION POINTS

None in this step. CLAUDE.md's AI Integration Points list has no Foundation
Layer or Admin-specific entry for this module — the closest related item
(AI Runtime Flow's credit deduction) is explicitly a non-goal here (Section
1) since no real AI feature call site exists yet to deduct from.

---

## 10. QUEUE SUMMARY (Cross-Reference with Prior Steps)

```
workflow-actions   — ACC-9  — webhook firing on transitions
sla-monitor        — ACC-9, extended ACC-11 — Task + WorkflowInstanceStage overdue sweep
email-delivery     — ACC-10 — async Resend send per EMAIL/BOTH-channel Notification
```

No new BullMQ queue registered in ACC-13 — every operation here (tenant
creation, plan CRUD, impersonation) is synchronous and fast enough not to
need one; revisit only if tenant creation grows a slow step (e.g. real email
delivery confirmation) later.

---

## 11. FRONTEND — THIS STEP BUILDS THE SHARED LAYOUT

Unlike every prior step's plan (each of which noted "no app shell exists yet,
ships as a standalone routed page instead"), **this is the step that changes
that**. Every existing foundation route (`organization`, `working-calendar`,
`lookups`, `roles`, `workflows`, `org-positions`, `tasks`, `users`) gets
nested under the new `AppShellComponent` in Commit 10 — none of their own
internal component code changes, only `app.routes.ts`'s structure and each
route's added `breadcrumb` data. Every functional module built from ACC-17
onward is expected to render inside this shell from day one, not as another
standalone page needing a later migration.

---

## 12. PENDING DISCUSSIONS

Flagged for confirmation before building starts:

1. **Filter `PLATFORM_ADMIN` out of the assignable-roles list for
   non-platform organizations.** Section 1's `PlatformGuard` fix closes the
   actual security hole (a self-assigned `PLATFORM_ADMIN` role can no longer
   pass any real check), but the role still shows up as a selectable option
   in an ordinary tenant's own role-assignment UI, which is confusing at best.
   **Recommendation:** in `RoleService.getRoles()`, filter out roles with
   `key: 'PLATFORM_ADMIN'` when the calling organization's own
   `isPlatformOrg` is false. Small, additive, directly related to this
   ticket's own security finding — recommend bundling into Commit 4 rather
   than a separate follow-up ticket. Confirm before Commit 4.

2. **`Organization.plan` (existing `SubscriptionPlan` enum) vs. the new
   `Organization.planId` (FK to the new `Plan` model) — both now coexist.**
   The old enum (`STARTER`/`PROFESSIONAL`/`ENTERPRISE`, hardcoded) predates
   this ticket and is still read by... nothing found during research that
   actually branches on it today (grep found only its schema declaration and
   `ITenant`'s pass-through field). **Recommendation:** leave the enum
   in place, unused-but-harmless (same precedent as `TaskStatus.DELEGATED`
   after ACC-11 stopped using it) — do not migrate existing `Organization`
   rows' `plan` enum value into a new `Plan` row automatically, since no
   `Plan` rows exist until a Platform Admin creates some via this ticket's
   own UI. New tenants created via `PlatformTenantService.createTenant()`
   get a real `planId`; pre-ACC-13 tenants (today, only demo/dev data) keep
   `planId: null` until a Platform Admin assigns one manually. Confirm this
   reading is acceptable — not a full migration ticket.

3. **The impersonation banner (Commit 11) needs `/auth/me` to expose
   `impersonatedBy` so the frontend can render "Impersonating X · End
   Impersonation" without a dedicated new endpoint.** Two options: (a)
   extend `GET /auth/me` (built ACC-12, currently `{id, email, name}`) to add
   an optional `impersonatedBy: { id, name } | null` field, resolved by
   `AuthController.getMe()` reading `request.impersonatedBy` (Commit 9) and
   looking up that user's display info; or (b) a dedicated
   `GET /platform/impersonation-status` endpoint. **Recommendation: (a)** —
   avoids a fifth new endpoint for one banner, and `/auth/me` is already the
   established "who am I, fully" read. Confirm before Commit 11 (Commit 9's
   `TenantGuard` change and Commit 8's `/auth/me`-adjacent work should land
   first either way, so this doesn't block earlier commits — only Commit
   11's banner specifically).

4. **`create-tenant.component.ts`'s slug-uniqueness UX** (Section 4, Commit
   11) — async validator hitting a live-check endpoint vs. surfacing the
   `ConflictException` on submit. Low-stakes, implementation-time choice —
   flagged so it isn't silently decided as "obviously the fancier option"
   without a moment's confirmation, given this ticket's scope is already
   large. Either is acceptable; default to the simpler submit-time
   `ConflictException` surface unless told otherwise.

---

*Plan created: 2026-07-29*
*Branch created: feature/ACC-13-admin-portal*
*Depends on: ACC-12 (merged to dev ✅)*
