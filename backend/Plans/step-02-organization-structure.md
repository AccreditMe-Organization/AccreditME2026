# Step 2 — Organization Structure
# ACC-6: implement organization units, working calendar, and SLA service

---

## HEALTH CHECK — Run Before Starting

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AccreditMe Health Check — 2026-07-14
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ERRORS:  None ✅
ERRORS:           None ✅
WARNINGS:
  ⚠ STRIPE_SECRET_KEY is empty — deferred, acceptable for local dev
  ⚠ REDIS_URL is empty — Railway injects in production, acceptable

DETAILED RESULTS

Check 1  Git State              PASS — on dev, clean, ACC-5 PR merged (#1)
Check 2  Branch vs dev          INFO — 0 commits ahead/behind, ready for new ticket
Check 3  Backend TypeScript     PASS — zero errors
Check 4  Frontend TypeScript    PASS — zero errors
Check 5  Test Suite             PASS — 14/14 tests passing
Check 6  Tenant Isolation       PASS — 1 isolation test passing
Check 7  Migration Status       PASS — 2 migrations, database up to date
Check 8  Schema Validation      PASS — schema.prisma is valid
Check 9  Environment Variables  PASS — all required vars present (2 deferred warnings)
Check 10 Critical Files         PASS — all 11 skills present, all critical files exist
Check 11 Security               PASS — .env and .mcp.json not in git history

OVERALL STATUS: 🟢 HEALTHY — ready to start ACC-6
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

Step 2 completes two closely related foundation concerns:

**Organization Units (Org Structure)**
A self-referential hierarchy of `OrgUnit` records representing the internal
structure of a tenant organization: hospitals have departments (ICU, ER, Pharmacy),
government bodies have divisions and sections. Each unit has a short `code`
that flows directly into document numbering in Module 2
(`POL-ICU-2024-001`). The hierarchy is unlimited depth.

**Working Calendar + WorkingCalendarService**
The `WorkingCalendar` and `PublicHoliday` models already exist in the schema.
This step brings them to life with a full NestJS module and — critically —
the `WorkingCalendarService`, the single service that ALL other modules must
use for every SLA and due-date calculation in the platform.

### Why This Step Matters

- Every Task (Step 8) needs a due date calculated via `WorkingCalendarService`
- Every document review SLA, audit finding deadline, and corrective action
  timeline runs through this service — it cannot be retrofitted later
- `OrgUnit.code` is consumed by the document numbering engine in Module 2
- User assignment (Step 9) attaches users to org units
- The committee module (Step 10) references org units for meeting invitations

---

## 2. PRISMA SCHEMA CHANGES

### Models Already in Schema — No Changes Needed

```
WorkingCalendar   — EXISTS with all required fields
PublicHoliday     — EXISTS with all required fields
```

Confirm by reading `backend/prisma/schema.prisma` lines 308–335.

### Model to Add

`OrgUnit` does NOT exist. Add it and the corresponding relation on `Organization`.

```prisma
// Add to Organization model (after the existing relations):
orgUnits         OrgUnit[]

// New model — add after the PublicHoliday model:
model OrgUnit {
  id             String       @id @default(cuid())
  organizationId String
  parentId       String?
  nameEn         String
  nameAr         String?      // Optional — display as "nameEn (nameAr)" when both exist
  code           String       // Short code used in document numbering (e.g. ICU, ER, HR)
  type           String?      // Lookup value key from org_unit_type category
  description    String?
  isActive       Boolean      @default(true)
  isCodeLocked   Boolean      @default(false) // Set to true on first document number generation
  sortOrder      Int          @default(0)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization   Organization @relation(fields: [organizationId], references: [id])
  parent         OrgUnit?     @relation("OrgUnitHierarchy", fields: [parentId], references: [id])
  children       OrgUnit[]    @relation("OrgUnitHierarchy")

  @@unique([organizationId, code])
  @@index([organizationId])
  @@index([parentId])
}
```

**Code field rules:**
- System auto-generates code from nameEn (uppercase, max 10 chars, spaces replaced with hyphens)
- Tenant admin can modify code only when `isCodeLocked = false`
- `isCodeLocked` set to `true` automatically when the first document number is generated using this unit's code
- Once locked — code is permanently read-only

### Migration Name

```
add-org-unit
```

Run:
```bash
cd backend && npx prisma migrate dev --name add-org-unit
```

Verify in Prisma Studio:
```bash
cd backend && npx prisma studio
```
Confirm `OrgUnit` table exists with all columns.

---

## 3. FILES TO CREATE (BACKEND)

All paths relative to `backend/src/`.

### Commit 1 — Schema (standalone commit before any code)
```
backend/prisma/schema.prisma                                       MODIFY
backend/prisma/migrations/YYYYMMDDHHMMSS_add_org_unit/            GENERATED
```

### Commit 2 — Org Unit interfaces and DTOs
```
foundation/organization/interfaces/org-unit.interface.ts          CREATE
foundation/organization/dto/create-org-unit.dto.ts                CREATE
foundation/organization/dto/update-org-unit.dto.ts                CREATE
foundation/organization/dto/org-unit-response.dto.ts              CREATE
```

**`org-unit.interface.ts`** — `IOrgUnit` with all fields as string literal types.
No Prisma imports. Same pattern as `ITenant` in Step 1.

**`create-org-unit.dto.ts`** — class-validator decorators:
- `nameEn`: `@IsString @IsNotEmpty @MaxLength(255)`
- `nameAr`: `@IsString @IsNotEmpty @MaxLength(255)`
- `code`: `@IsString @IsNotEmpty @MaxLength(20) @Matches(/^[A-Z0-9_-]+$/)` — uppercase only
- `type`: `@IsString @IsOptional`
- `parentId`: `@IsString @IsOptional`
- `description`: `@IsString @IsOptional @MaxLength(1000)`
- `sortOrder`: `@IsInt @IsOptional @Min(0)`

**`update-org-unit.dto.ts`** — same fields all optional. Extends with `PartialType` from `@nestjs/mapped-types`.

**`org-unit-response.dto.ts`** — `implements IOrgUnit`. All fields with `!` assertion. Includes `children?: OrgUnitResponseDto[]` for nested tree responses.

### Commit 3 — Working Calendar interfaces and DTOs
```
foundation/working-calendar/interfaces/working-calendar.interface.ts   CREATE
foundation/working-calendar/interfaces/public-holiday.interface.ts     CREATE
foundation/working-calendar/dto/update-working-calendar.dto.ts         CREATE
foundation/working-calendar/dto/create-public-holiday.dto.ts           CREATE
foundation/working-calendar/dto/working-calendar-response.dto.ts       CREATE
foundation/working-calendar/dto/public-holiday-response.dto.ts         CREATE
```

**`working-calendar.interface.ts`** — `IWorkingCalendar`:
```typescript
export interface IWorkingCalendar {
  id: string;
  organizationId: string;
  timezone: string;
  workingDays: number[];        // 0=Sun, 1=Mon, ..., 6=Sat
  workingHoursStart: string;    // "HH:mm" e.g. "08:00"
  workingHoursEnd: string;      // "HH:mm" e.g. "16:00"
  createdAt: Date;
  updatedAt: Date;
}
```

**`public-holiday.interface.ts`** — `IPublicHoliday`:
```typescript
export interface IPublicHoliday {
  id: string;
  workingCalendarId: string;
  nameEn: string;
  nameAr: string;
  date: Date;
  isRecurring: boolean;
  createdAt: Date;
}
```

**`update-working-calendar.dto.ts`**:
- `timezone`: `@IsString @IsOptional` (validate against Luxon timezone list in service)
- `workingDays`: `@IsArray @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) @IsOptional`
- `workingHoursStart`: `@IsString @IsOptional @Matches(/^\d{2}:\d{2}$/)`
- `workingHoursEnd`: `@IsString @IsOptional @Matches(/^\d{2}:\d{2}$/)`

**`create-public-holiday.dto.ts`**:
- `nameEn`: `@IsString @IsNotEmpty @MaxLength(255)`
- `nameAr`: `@IsString @IsNotEmpty @MaxLength(255)`
- `date`: `@IsDateString` (ISO 8601 date string, e.g. "2026-12-25")
- `isRecurring`: `@IsBoolean @IsOptional`

### Commit 4 — WorkingCalendarService + spec
```
foundation/working-calendar/working-calendar.service.ts           CREATE
foundation/working-calendar/working-calendar.service.spec.ts      CREATE
```

**Critical service — read the SLA rules in Section 8 before writing this.**

Methods:
```typescript
// Get or create the calendar for a tenant (creates GCC default if none exists)
getOrCreate(organizationId: string): Promise<IWorkingCalendar>

// Update calendar config
update(organizationId: string, dto: UpdateWorkingCalendarDto, actorId: string): Promise<IWorkingCalendar>

// Add a public holiday
addHoliday(organizationId: string, dto: CreatePublicHolidayDto, actorId: string): Promise<IPublicHoliday>

// Remove a public holiday
removeHoliday(holidayId: string, organizationId: string, actorId: string): Promise<void>

// List public holidays (current year + next year)
listHolidays(organizationId: string, year?: number): Promise<IPublicHoliday[]>

// THE CRITICAL METHOD — used by every module that needs SLA/due dates
// Returns the DateTime that is `workingHours` working hours after `start`
// Accounts for: working day boundaries, working hour windows, public holidays
calculateDeadline(
  start: DateTime,             // Luxon DateTime (can be any time)
  workingHours: number,        // SLA in working hours
  organizationId: string,
): Promise<DateTime>           // Returns UTC DateTime

// Internal helpers (private):
// isWorkingMoment(dt: DateTime, cal: WorkingCalendar, holidays: Date[]): boolean
// nextWorkingStart(dt: DateTime, cal: WorkingCalendar, holidays: Date[]): DateTime
```

**Spec must cover:**
- `calculateDeadline` with task assigned during working hours
- `calculateDeadline` with task assigned outside working hours (SLA starts next working day)
- `calculateDeadline` spanning a public holiday (holiday is skipped)
- `calculateDeadline` spanning a weekend (weekend days are skipped)
- Tenant isolation test: calendars from two different tenants do not bleed into each other
- GCC default creation when no calendar exists

### Commit 5 — OrganizationService + spec
```
foundation/organization/organization.service.ts                   CREATE
foundation/organization/organization.service.spec.ts              CREATE
```

Methods:
```typescript
// Return full tree for the tenant (nested children)
getTree(organizationId: string): Promise<IOrgUnit[]>

// Return flat list (for dropdowns)
listFlat(organizationId: string): Promise<IOrgUnit[]>

// Find single unit — scoped to tenant
findById(id: string, organizationId: string): Promise<IOrgUnit>

// Create a unit — validates parent belongs to same tenant
create(organizationId: string, dto: CreateOrgUnitDto, actorId: string): Promise<IOrgUnit>

// Update a unit — validates code uniqueness within tenant
update(id: string, organizationId: string, dto: UpdateOrgUnitDto, actorId: string): Promise<IOrgUnit>

// Soft deactivate — deactivation guard runs before any state change.
// Deactivation guard: checks for active users, documents, incidents, and workflows
// before allowing deactivation. Returns 409 ConflictException with blocker list if any exist.
deactivate(id: string, organizationId: string, actorId: string): Promise<IOrgUnit>
```

**All queries must include `where: { organizationId }` — no exceptions.**
**`AuditLogService.log()` on every create/update/deactivate.**
**Tenant isolation test is mandatory.**

### Commit 6 — Controllers + specs
```
foundation/organization/organization.controller.ts                CREATE
foundation/organization/organization.controller.spec.ts           CREATE
foundation/working-calendar/working-calendar.controller.ts        CREATE
foundation/working-calendar/working-calendar.controller.spec.ts   CREATE
```

**OrganizationController** endpoints:
```
GET    /organization/units          @Permissions(ORG_PERMISSIONS.VIEW)
GET    /organization/units/flat     @Permissions(ORG_PERMISSIONS.VIEW)
GET    /organization/units/:id      @Permissions(ORG_PERMISSIONS.VIEW)
POST   /organization/units          @Permissions(ORG_PERMISSIONS.MANAGE)
PATCH  /organization/units/:id      @Permissions(ORG_PERMISSIONS.MANAGE)
DELETE /organization/units/:id      @Permissions(ORG_PERMISSIONS.MANAGE)  // soft deactivate
```

**WorkingCalendarController** endpoints:
```
GET    /working-calendar            @Permissions(ORG_PERMISSIONS.VIEW)
PATCH  /working-calendar            @Permissions(ORG_PERMISSIONS.MANAGE)
GET    /working-calendar/holidays   @Permissions(ORG_PERMISSIONS.VIEW)
POST   /working-calendar/holidays   @Permissions(ORG_PERMISSIONS.MANAGE)
DELETE /working-calendar/holidays/:id  @Permissions(ORG_PERMISSIONS.MANAGE)
```

Rules:
- `@UseGuards(TenantGuard, PermissionGuard)` at class level on both controllers
- `@CurrentTenant()` for tenant ID — never `request.body.organizationId`
- `@CurrentUser()` for actor ID on mutations
- Zero business logic — all delegation to service
- Controller specs mock the service and override guards

### Commit 7 — Module files + AppModule
```
foundation/organization/organization.module.ts                    CREATE
foundation/working-calendar/working-calendar.module.ts            CREATE
backend/src/app.module.ts                                         MODIFY
```

**`organization.module.ts`**:
```typescript
@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [OrganizationController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
```

**`working-calendar.module.ts`**:
```typescript
@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [WorkingCalendarController],
  providers: [WorkingCalendarService],
  exports: [WorkingCalendarService],  // exported — every module that needs SLA imports this
})
export class WorkingCalendarModule {}
```

**Note:** `WorkingCalendarModule` must export `WorkingCalendarService` because:
- Task module (Step 8) imports it for due date calculation
- Workflow module (Step 6) imports it for SLA enforcement
- Every functional module that has deadlines needs it

**`app.module.ts`** — add both imports.

### Commit 8 — Update TenantService bootstrap stubs
```
foundation/tenant/tenant.service.ts                               MODIFY
```

Fill in the Step 2 TODO stub in `bootstrap()`:

```typescript
// TODO(Step 2 — Organization): seed default OrgUnit (root unit = org name)
//   organizationService.createRoot(orgId, orgName)
```

Actually — do NOT call `OrganizationService` from `TenantService` (circular dependency risk).
Instead, the bootstrap method calls `PrismaService` directly to seed the root org unit.
Add one root OrgUnit named after the organization when bootstrapping.

---

## 4. FILES TO CREATE (FRONTEND)

Angular 18+ standalone components. PrimeNG for UI. Tailwind for layout.
All paths relative to `frontend/src/app/`.

### Commit 9 — Angular org unit feature
```
foundation/organization/services/org-unit.service.ts             CREATE
foundation/organization/components/
  org-unit-tree/org-unit-tree.component.ts                       CREATE
  org-unit-form/org-unit-form.component.ts                       CREATE
foundation/organization/organization.routes.ts                    CREATE
```

**`org-unit.service.ts`** — Angular `HttpClient` wrapper:
```typescript
@Injectable({ providedIn: 'root' })
export class OrgUnitService {
  getTree(): Observable<OrgUnitDto[]>
  getFlat(): Observable<OrgUnitDto[]>
  create(dto: CreateOrgUnitDto): Observable<OrgUnitDto>
  update(id: string, dto: UpdateOrgUnitDto): Observable<OrgUnitDto>
  deactivate(id: string): Observable<OrgUnitDto>
}
```

**`org-unit-tree.component.ts`** — PrimeNG `<p-tree>` displaying the hierarchy.
- Expands/collapses nodes
- Add child button per node
- Edit and deactivate actions per node
- Inactive units shown greyed out

**`org-unit-form.component.ts`** — Angular Reactive Form:
- nameEn, nameAr, code (uppercase-forced), type (dropdown from lookups),
  parentId (tree-select dropdown), description, sortOrder
- Used for both create and edit (mode determined by `@Input() unit`)

**`organization.routes.ts`**:
```typescript
export const ORGANIZATION_ROUTES: Routes = [
  { path: '', loadComponent: () => OrgUnitTreeComponent },
  { path: 'new', loadComponent: () => OrgUnitFormComponent },
  { path: ':id/edit', loadComponent: () => OrgUnitFormComponent },
];
```

### Commit 10 — Angular working calendar feature
```
foundation/working-calendar/services/working-calendar.service.ts     CREATE
foundation/working-calendar/components/
  calendar-config/calendar-config.component.ts                        CREATE
  public-holiday-list/public-holiday-list.component.ts               CREATE
  public-holiday-form/public-holiday-form.component.ts               CREATE
foundation/working-calendar/working-calendar.routes.ts               CREATE
```

**`working-calendar.service.ts`** — `HttpClient` wrapper:
```typescript
@Injectable({ providedIn: 'root' })
export class WorkingCalendarService {
  getCalendar(): Observable<WorkingCalendarDto>
  updateCalendar(dto: UpdateWorkingCalendarDto): Observable<WorkingCalendarDto>
  getHolidays(year?: number): Observable<PublicHolidayDto[]>
  addHoliday(dto: CreatePublicHolidayDto): Observable<PublicHolidayDto>
  removeHoliday(id: string): Observable<void>
}
```

**`calendar-config.component.ts`** — Working days + hours configuration:
- Day checkboxes (Sun Mon Tue Wed Thu Fri Sat) with GCC preset button and Western preset button
- Time range picker for workingHoursStart / workingHoursEnd (PrimeNG Calendar timepicker)
- Timezone dropdown (Luxon timezone list, pre-filtered to common timezones)
- AI suggestion button: "Suggest public holidays for [country] [year]" — calls AI endpoint, shows suggestions for user to accept/reject

**`public-holiday-list.component.ts`** — PrimeNG Table:
- Columns: nameEn, nameAr, date, isRecurring, actions (edit, delete)
- Add holiday button → opens public-holiday-form in dialog
- AI suggest button (see AI integration below)

**`public-holiday-form.component.ts`** — Reactive Form:
- nameEn, nameAr, date (PrimeNG Calendar datepicker), isRecurring toggle

**`working-calendar.routes.ts`**:
```typescript
export const WORKING_CALENDAR_ROUTES: Routes = [
  { path: '', loadComponent: () => CalendarConfigComponent },
  { path: 'holidays', loadComponent: () => PublicHolidayListComponent },
];
```

### Commit 11 — Translation keys
```
frontend/src/assets/i18n/en.json     MODIFY
frontend/src/assets/i18n/ar.json     MODIFY
```

Keys to add to `en.json`:
```json
{
  "organization": {
    "title": "Organization Structure",
    "addUnit": "Add Unit",
    "addChildUnit": "Add Child Unit",
    "editUnit": "Edit Unit",
    "deactivate": "Deactivate",
    "activate": "Activate",
    "nameEn": "Name (English)",
    "nameAr": "Name (Arabic)",
    "code": "Unit Code",
    "codeHint": "Uppercase letters and numbers only. Used in document numbering.",
    "type": "Unit Type",
    "parentUnit": "Parent Unit",
    "description": "Description",
    "noUnits": "No organization units defined yet.",
    "confirmDeactivate": "Deactivate this unit? Active children must be deactivated first.",
    "codeInUse": "This code is already in use in your organization."
  },
  "workingCalendar": {
    "title": "Working Calendar",
    "workingDays": "Working Days",
    "workingHours": "Working Hours",
    "timezone": "Timezone",
    "presetGcc": "GCC (Sun–Thu)",
    "presetWestern": "Western (Mon–Fri)",
    "holidays": "Public Holidays",
    "addHoliday": "Add Holiday",
    "holidayNameEn": "Holiday Name (English)",
    "holidayNameAr": "Holiday Name (Arabic)",
    "holidayDate": "Date",
    "isRecurring": "Repeats every year",
    "noHolidays": "No public holidays defined for this year.",
    "suggestHolidays": "Suggest Holidays with AI",
    "aiSuggesting": "AI is generating suggestions...",
    "aiSuggestionsTitle": "AI-Suggested Holidays",
    "aiSuggestionsHint": "Review each suggestion. Accept the ones that apply to your organization."
  }
}
```

Arabic equivalents in `ar.json` (translate each key).

---

## 5. COMMIT SEQUENCE

All commits on branch `feature/ACC-6-organization-structure`.
Format: `{type}({scope}): {description} [ACC-6]`

```
Commit 1:  chore(prisma): add OrgUnit model with hierarchy support [ACC-6]
Commit 2:  feat(organization): add org unit interfaces and DTOs [ACC-6]
Commit 3:  feat(working-calendar): add working calendar interfaces and DTOs [ACC-6]
Commit 4:  feat(working-calendar): add WorkingCalendarService with SLA calculation [ACC-6]
Commit 5:  feat(organization): add OrganizationService with hierarchy support [ACC-6]
Commit 6:  feat(organization): add organization and working-calendar controllers [ACC-6]
Commit 7:  chore(organization): register organization and working-calendar modules [ACC-6]
Commit 8:  fix(tenant): seed root OrgUnit in bootstrap [ACC-6]
Commit 9:  feat(organization): add Angular org unit components [ACC-6]
Commit 10: feat(working-calendar): add Angular working calendar components [ACC-6]
Commit 11: chore(i18n): add organization and working-calendar translation keys [ACC-6]
```

Run `npx tsc --noEmit` before commits 1, 4, 5, 6, 7, 9, 10.
Run `npx jest --passWithNoTests` before commits 4, 5, 6, 7.

---

## 6. ACCEPTANCE CRITERIA

- [ ] `OrgUnit` model in schema with self-referential hierarchy, migration applied
- [ ] `OrgUnit.code` is unique per organization (enforced at DB and service level)
- [ ] `OrgUnit` cannot have a parent from a different organization (enforced in service)
- [ ] Deactivating a unit with active children throws `ConflictException`
- [ ] `WorkingCalendar.getOrCreate()` creates GCC default if none exists
- [ ] `WorkingCalendarService.calculateDeadline()` correctly skips weekends
- [ ] `WorkingCalendarService.calculateDeadline()` correctly skips public holidays
- [ ] Task assigned at 17:00 (after working hours) → SLA starts 08:00 next working day
- [ ] Task assigned on Friday with GCC calendar → SLA starts 08:00 Sunday
- [ ] `WorkingCalendarService` exported from `WorkingCalendarModule` — importable by any module
- [ ] Backend TypeScript: zero errors
- [ ] Frontend TypeScript: zero errors
- [ ] All tests passing
- [ ] Tenant isolation tests present for `OrganizationService` and `WorkingCalendarService`
- [ ] Tenant isolation: org units from tenant A are never returned for tenant B
- [ ] Tenant isolation: calendars from tenant A never affect SLA calculations for tenant B
- [ ] Translation keys in both `en.json` and `ar.json` for all new UI strings
- [ ] AI suggest holidays UI wired (button present, even if backend endpoint stubbed)
- [ ] PR to dev with green CI

---

## 7. DEPENDENCIES

### What This Step Requires from Step 1

| Requirement | Where It Comes From |
|---|---|
| `TenantModule` import | Provides `AuditLogService`, guards, decorators |
| `AuditLogService` | Call `log()` on every org unit and calendar mutation |
| `TenantGuard` | Applied at controller class level |
| `PermissionGuard` | Applied at controller class level (still stubbed — Step 5) |
| `@CurrentTenant()` | Inject tenant ID in controllers |
| `@CurrentUser()` | Inject actor ID for audit log |
| `ORG_PERMISSIONS.VIEW` / `ORG_PERMISSIONS.MANAGE` | Permission decorators on endpoints |
| `PrismaModule` | Database access for both modules |

### What Future Steps Will Require from Step 2

| Future Step | What It Needs |
|---|---|
| Step 3 — Lookup system | `OrgUnit` model exists for lookup attribute `orgUnitType` |
| Step 6 — Workflow engine | `WorkingCalendarModule` for SLA enforcement on workflow stages |
| Step 8 — Task management | `WorkingCalendarModule.calculateDeadline()` for task due dates |
| Step 9 — User management | `OrgUnit` FK — users assigned to org units |
| Module 1 — Standards | No direct dependency but org units used in audit scoping |
| Module 2 — Documents | `OrgUnit.code` used in document numbering (`POL-ICU-2024-001`) |
| Module 3 — Quality improvement | Incidents reference org unit where incident occurred |
| Module 4 — Audit | Audit scope includes org units |

---

## 8. WORKING CALENDAR RULES

### Data Model

```
WorkingCalendar
  workingDays:      Int[]     — day-of-week integers (0=Sun, 1=Mon, ..., 6=Sat)
  workingHoursStart: String  — "HH:mm" in the tenant's timezone
  workingHoursEnd:   String  — "HH:mm" in the tenant's timezone
  timezone:          String  — IANA timezone string e.g. "Asia/Riyadh"
  publicHolidays:    PublicHoliday[]
```

### GCC Default

```
workingDays:       [0, 1, 2, 3, 4]   (Sunday through Thursday)
workingHoursStart: "08:00"
workingHoursEnd:   "16:00"
timezone:          "Asia/Riyadh"     (UTC+3)
```

### Western Option

```
workingDays:       [1, 2, 3, 4, 5]   (Monday through Friday)
workingHoursStart: "08:00"
workingHoursEnd:   "17:00"
timezone:          "Europe/London"   (as example)
```

### SLA Calculation Rules

All rules implemented in `WorkingCalendarService.calculateDeadline()`:

```
RULE 1 — All timestamps stored as UTC in PostgreSQL.
  Convert to tenant timezone for ALL working hour logic.
  Store results back as UTC.

RULE 2 — If start falls OUTSIDE working hours or on a non-working day:
  → Advance start to the beginning of the NEXT working period.
  Example: assigned at 17:30 on Thursday → SLA clock starts 08:00 next Sunday (GCC)
  Example: assigned at any time on Friday → SLA clock starts 08:00 Sunday (GCC)

RULE 3 — If a date falls on a public holiday:
  → Skip the entire day. Treat it as a non-working day.
  Recurring holidays (isRecurring=true): match on month+day only, ignoring year.
  Non-recurring: match on exact date.

RULE 4 — Walking the SLA forward:
  Do NOT advance minute-by-minute — this produces 43,200 iterations
  for a 30-day SLA and is unacceptably inefficient.

  Use this algorithm instead:
  1. Advance day-by-day through the calendar from the start date
  2. For each day check two conditions:
     a. Is this day in workingDays[]?
     b. Is this day a public holiday?
  3. If both conditions pass — add the full working day duration
     (workingHoursEnd minus workingHoursStart) to the SLA counter
  4. Continue until the remaining SLA time is less than one full
     working day
  5. Only at this final partial day — drop to minute-level precision
     to find the exact deadline time within that working day

  This approach is O(days) not O(minutes) — correct and efficient.

RULE 5 — Working hours are in the tenant timezone:
  A tenant in Asia/Riyadh with workingHoursEnd "16:00" means 13:00 UTC.
  All Luxon operations use the tenant timezone explicitly.

RULE 6 — Escalation triggers fire only during working hours:
  The SLA breach check job (BullMQ, every 15 min) only sends notifications
  between workingHoursStart and workingHoursEnd.
  Do not implement this in Step 2 — note it here for Step 8.
```

### Luxon Usage Pattern

```typescript
import { DateTime } from 'luxon';

// Convert UTC DB timestamp to tenant timezone
const localNow = DateTime.now().setZone(calendar.timezone);

// Parse working hours
const [startHour, startMin] = calendar.workingHoursStart.split(':').map(Number);

// Build start-of-working-day in tenant timezone
const workdayStart = localNow.startOf('day').set({ hour: startHour, minute: startMin });

// Convert back to UTC for storage
const utcDeadline = deadline.toUTC();
```

---

## 9. AI INTEGRATION POINTS

Per CLAUDE.md, Step 2 has one AI touchpoint:

### Public Holiday Suggestion

**Trigger:** User clicks "Suggest Holidays with AI" on the working calendar page.

**Request (frontend → backend):**
```
POST /api/v1/working-calendar/ai/suggest-holidays
Body: { country: "SA", year: 2027, language: "en" }
```

**Backend flow:**
1. `WorkingCalendarController` receives request
2. Injects `AI_PROVIDER` (from `TenantModule`)
3. Builds prompt: "List all official public holidays for Saudi Arabia in 2027.
   For each holiday, provide: English name, Arabic name, date (YYYY-MM-DD),
   whether it recurs annually (true/false). Return as JSON array."
4. Calls `aiProvider.complete(prompt)`
5. Logs AI interaction: actor, model, prompt summary, response summary, timestamp
6. Returns raw AI response to frontend for human review — NOT auto-saved

**Frontend flow:**
1. Show spinner on button
2. Receive suggestions array
3. Display each suggestion as a card with checkbox
4. User checks which ones to accept
5. User clicks "Add Selected" → calls `POST /working-calendar/holidays` for each

**Pattern: AI suggests → human reviews → human approves → system records**

This endpoint can be a stub in Step 2 that returns hardcoded sample data,
with the real AI call wired in after the AI integration pattern is confirmed.

---

## 10. PROGRESS TRACKER

Track each item as it is completed. Update this file or maintain in Linear.

```
[x] Health check passed (see Section HEALTH CHECK above — 🟢 HEALTHY)
[x] Linear ticket ACC-6 created via /new-ticket
[x] Feature branch created: feature/ACC-6-organization-structure
[x] schema.prisma updated — OrgUnit model added
[x] nameAr confirmed as optional (String?)
[x] isCodeLocked Boolean @default(false) added to model
[x] Migration run: npx prisma migrate dev --name add-org-unit
[x] OrgUnit table verified in Prisma Studio
[x] Commit 1 done: chore(prisma): add OrgUnit model [ACC-6]
[x] Org unit interfaces + DTOs written and confirmed (files 1-4)
[x] Commit 2 done: feat(organization): add org unit interfaces and DTOs [ACC-6]
[x] Working calendar interfaces + DTOs written and confirmed (files 5-10)
[x] Commit 3 done: feat(working-calendar): add working calendar interfaces and DTOs [ACC-6]
[x] WorkingCalendarService written with all SLA rules
[x] WorkingCalendarService spec covers: working hours, weekend skip, holiday skip, isolation
[x] npx tsc --noEmit → zero errors
[x] npx jest → all tests pass including isolation
[x] Commit 4 done: feat(working-calendar): add WorkingCalendarService [ACC-6]
[x] OrganizationService written with hierarchy support
[x] OrganizationService spec covers: tree, create, deactivate, isolation
[x] npx tsc --noEmit → zero errors
[x] npx jest → all tests pass
[x] Commit 5 done: feat(organization): add OrganizationService [ACC-6]
[x] OrganizationController written (zero business logic)
[x] WorkingCalendarController written (zero business logic)
[x] Controller specs override guards, verify routing only
[x] Commit 6 done: feat(organization): add controllers [ACC-6]
[x] OrganizationModule and WorkingCalendarModule created
[x] AppModule updated
[x] Commit 7 done: chore(organization): register modules [ACC-6]
[x] TenantService bootstrap updated to seed root OrgUnit
[x] Commit 8 done: fix(tenant): seed root OrgUnit in bootstrap [ACC-6]
[x] Angular org unit service + tree component + form component created
[x] Commit 9 done: feat(organization): add Angular org unit components [ACC-6]
[x] Angular working calendar service + config + holiday components created
[x] AI suggest holidays button present in calendar-config component
[x] Commit 10 done: feat(working-calendar): add Angular working calendar components [ACC-6]
[x] en.json updated with all keys from Section 4
[x] ar.json updated with all Arabic translations
[x] Commit 11 done: chore(i18n): add translation keys [ACC-6]
[x] Final check: npx tsc --noEmit (backend + frontend) → zero errors
[x] Final check: npx jest --passWithNoTests → all tests pass
[x] Final check: tenant isolation tests all passing
[x] /ready-to-pr run — PR opened to dev with [ACC-6] in title
[x] CI green on GitHub Actions
[x] PR merged to dev (squash merge)
[x] feature/ACC-6-organization-structure branch deleted from GitHub
[x] ACC-6 marked Done in Linear
[x] Step 3 (Lookup system) can begin
```

---

## 11. BUSINESS RULES (confirmed by product owner)

### Hierarchy
- Unlimited depth — no hardcoded level limit
- Self-referential model handles any depth

### Ownership Model (notes for future steps)
- Documents: one owner org unit + stakeholder units
  via junction table — note for Step 17
- Incidents: owned by reporting user, unit derived
  from user's unit at time of reporting — note for Step 18
- Audit: multi-unit scope via junction table — note for Step 19
- Users: one primary unit + optional acting-as unit
  with expiry date — note for Step 9
- Committees: optional org unit ownership for
  sector-level committees — note for Step 10

### Arabic Name Rules
- nameAr is optional (String?)
- Display format when both exist: "nameEn (nameAr)"
- Display format when only English: "nameEn"
- Codes are always English uppercase only

### Code Field Rules
- Auto-generated from nameEn by system
- Admin can modify if isCodeLocked = false
- isCodeLocked set to true on first document number generation
- Once locked — permanently read-only, never changes

### Deactivation Rules
- Cannot deactivate if unit has ANY of:
  * Active users assigned to it
  * Active documents owned by it
  * Open incidents referencing it
  * Active workflow instances in it
- System returns 409 with detailed list of blockers
- Deactivated units remain visible in all history and reports
- Cannot delete any org unit that has records attached (ever)
- Deactivation guard enforced in OrganizationService.deactivate()

### Working Calendar
- One per organization — confirmed
- GCC default: Sunday-Thursday, 08:00-16:00, Asia/Riyadh
- Western default: Monday-Friday, 08:00-17:00

### UI Component Decisions
- Admin browse view: PrimeNG p-treeTable with expand/collapse
  Shows: unit name (both languages), code, type,
  active user count, status
- Form picker (assign reviewer, scope audit):
  PrimeNG p-cascadeSelect for navigating hierarchy
- Name display: "nameEn (nameAr)" when both exist

### Industry Scope
- AccreditMe is industry-agnostic
- All examples in this plan use healthcare for illustration only
- No industry-specific logic is hardcoded

---

*Plan created: 2026-07-14*
*Branch to create: feature/ACC-6-organization-structure*
*Depends on: ACC-5 (merged to dev ✅)*
