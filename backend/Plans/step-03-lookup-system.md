# Step 3 — Lookup System
# ACC-7: implement two-layer lookup system with system seed data and tenant extensions

---

## HEALTH CHECK — Run Before Starting

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AccreditMe Health Check — 2026-07-18
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ERRORS:  None ✅
ERRORS:           None ✅
WARNINGS:
  ⚠ STRIPE_SECRET_KEY is empty — deferred, acceptable for local dev
  ⚠ REDIS_URL is empty — Railway injects in production, acceptable

DETAILED RESULTS

Check 1  Git State              PASS — on dev, clean, ACC-6 PR merged (#2)
Check 2  Branch vs dev          INFO — 0 commits ahead/behind, ready for new ticket
Check 3  Backend TypeScript     PASS — zero errors
Check 4  Frontend TypeScript    PASS — zero errors
Check 5  Test Suite             PASS — 57/57 tests passing
Check 6  Tenant Isolation       PASS — 5 isolation tests passing (3 suites)
Check 7  Migration Status       PASS — 4 migrations, database up to date
Check 8  Schema Validation      PASS — schema.prisma is valid
Check 9  Environment Variables  PASS — all required vars present (2 deferred warnings)
Check 10 Critical Files         PASS — all 11 skills present, all critical files exist
Check 11 Security               PASS — .env and .mcp.json not in git history

OVERALL STATUS: 🟢 HEALTHY — ready to start ACC-7
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

Step 3 implements the **two-layer Lookup System** — the platform-wide mechanism
for all dropdown values used throughout AccreditMe.

**Layer 1 — System Lookups** (shipped with AccreditMe)
Defined once by AccreditMe at the platform level. Visible to every tenant.
Cannot be deleted by tenants. Tenants may hide individual values or override
their display labels. System data is seeded once via a Prisma seed script and
updated by AccreditMe platform releases.

**Layer 2 — Tenant Lookups** (customer-defined)
Tenants can:
- Add new values to any system category (layer = TENANT, organizationId = orgId)
- Override display labels of any system value per-organization
- Hide system values that do not apply to their organization
- Note: Creating entirely new custom categories is deferred to Step 24 (Custom Fields Engine).
  In Step 3, tenants work within the system-defined category structure only.

**Attribute Schema** (category-level)
Each category carries a JSON schema (`attributeSchema`) that defines additional
metadata fields for its values. The UI renders these fields dynamically — no
code changes needed when new attribute fields are added to a category.

### Why This Step Matters

- Committees (Step 10) use `committee_type` and `committee_member_role`
- Documents (Module 2) use `document_type` and `document_section_type`
  and derive document numbering prefixes from `document_type.attributes.numberingPrefix`
- Incidents (Module 3) use `incident_type`, `incident_severity`, `gap_category`
- Audits (Module 4) use `audit_type`, `corrective_action_type`, `standard_body`
- Meetings (Step 11) use `meeting_type`
- Org units (already built in Step 2) use `org_unit_type`
- Every module with a dropdown depends on this system — it cannot be retrofitted

---

## 2. PRISMA SCHEMA CHANGES

### Models Already in Schema — Partial — Modifications Required

```
LookupLayer enum    — EXISTS (SYSTEM, TENANT) — no changes needed
LookupCategory      — EXISTS but missing tenant-scoping fields — MODIFY
LookupValue         — EXISTS with all required fields — no changes needed
```

### What LookupCategory Currently Has

```prisma
model LookupCategory {
  id              String        @id @default(cuid())
  key             String        @unique          // ← must change to composite
  labelEn         String
  labelAr         String
  attributeSchema Json?
  isActive        Boolean       @default(true)
  sortOrder       Int           @default(0)

  values          LookupValue[]
}
```

### What LookupCategory Must Have After Migration

```prisma
model LookupCategory {
  id              String         @id @default(cuid())
  organizationId  String?                              // null = system category
  key             String                               // unique per org (see @@unique)
  labelEn         String
  labelAr         String
  isSystem        Boolean        @default(false)       // true = seeded by AccreditMe
  isExtensible    Boolean        @default(true)        // tenants may add values
  attributeSchema Json?
  isActive        Boolean        @default(true)
  sortOrder       Int            @default(0)
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  organization    Organization?  @relation(fields: [organizationId], references: [id])
  values          LookupValue[]

  @@unique([key, organizationId])     // replaces @unique on key
  @@index([organizationId])
}
```

Also add to **Organization model** (after existing relations):
```prisma
lookupCategories  LookupCategory[]
```

### What LookupValue Already Has (no changes)

```prisma
model LookupValue {
  id              String         @id @default(cuid())
  organizationId  String?                              // null = system value
  categoryId      String
  key             String
  labelEn         String
  labelAr         String
  layer           LookupLayer    @default(SYSTEM)
  attributes      Json?
  isActive        Boolean        @default(true)
  isHidden        Boolean        @default(false)
  labelOverrideEn String?
  labelOverrideAr String?
  sortOrder       Int            @default(0)
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  organization    Organization?  @relation(fields: [organizationId], references: [id])
  category        LookupCategory @relation(fields: [categoryId], references: [id])

  @@unique([categoryId, key, organizationId])
  @@index([organizationId])
  @@index([categoryId])
  @@index([layer])
}
```

### Migration Name

```
extend-lookup-category-tenant-support
```

Run:
```bash
cd backend && npx prisma migrate dev --name extend-lookup-category-tenant-support
```

---

## 3. FILES TO CREATE (BACKEND)

All paths relative to `backend/src/`.

### Commit 1 — Schema (standalone commit before any code)
```
backend/prisma/schema.prisma                                            MODIFY
backend/prisma/migrations/YYYYMMDDHHMMSS_.../                          GENERATED
```

### Commit 2 — Lookup interfaces and DTOs
```
foundation/lookup/interfaces/lookup-category.interface.ts              CREATE
foundation/lookup/interfaces/lookup-value.interface.ts                 CREATE
foundation/lookup/dto/create-lookup-category.dto.ts                    CREATE
foundation/lookup/dto/update-lookup-category.dto.ts                    CREATE
foundation/lookup/dto/create-lookup-value.dto.ts                       CREATE
foundation/lookup/dto/update-lookup-value.dto.ts                       CREATE
foundation/lookup/dto/override-label.dto.ts                            CREATE
foundation/lookup/dto/lookup-category-response.dto.ts                  CREATE
foundation/lookup/dto/lookup-value-response.dto.ts                     CREATE
```

**`lookup-category.interface.ts`**:
```typescript
export interface ILookupCategory {
  id: string;
  organizationId: string | null;
  key: string;
  labelEn: string;
  labelAr: string;
  isSystem: boolean;
  isExtensible: boolean;
  attributeSchema: Record<string, unknown> | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
```

**`lookup-value.interface.ts`**:
```typescript
export type LookupLayer = 'SYSTEM' | 'TENANT';

export interface ILookupValue {
  id: string;
  organizationId: string | null;
  categoryId: string;
  key: string;
  labelEn: string;
  labelAr: string;
  layer: LookupLayer;
  attributes: Record<string, unknown> | null;
  isActive: boolean;
  isHidden: boolean;
  labelOverrideEn: string | null;
  labelOverrideAr: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
```

**`create-lookup-category.dto.ts`** — class-validator decorators:
- `key`: `@IsString @IsNotEmpty @MaxLength(100) @Matches(/^[a-z0-9_]+$/)` — snake_case only
- `labelEn`: `@IsString @IsNotEmpty @MaxLength(255)`
- `labelAr`: `@IsString @IsNotEmpty @MaxLength(255)`
- `isExtensible`: `@IsBoolean @IsOptional` — defaults to true
- `attributeSchema`: `@IsObject @IsOptional`
- `sortOrder`: `@IsInt @IsOptional @Min(0)`

**`update-lookup-category.dto.ts`** — `PartialType(CreateLookupCategoryDto)`.
Cannot update `key` on system categories (enforced in service, not DTO).

**`create-lookup-value.dto.ts`**:
- `key`: `@IsString @IsNotEmpty @MaxLength(100) @Matches(/^[a-z0-9_]+$/)`
- `labelEn`: `@IsString @IsNotEmpty @MaxLength(255)`
- `labelAr`: `@IsString @IsNotEmpty @MaxLength(255)`
- `attributes`: `@IsObject @IsOptional` — must conform to category's attributeSchema
- `isActive`: `@IsBoolean @IsOptional`
- `sortOrder`: `@IsInt @IsOptional @Min(0)`

**`update-lookup-value.dto.ts`** — `PartialType(CreateLookupValueDto)`.

**`override-label.dto.ts`**:
- `labelOverrideEn`: `@IsString @IsNotEmpty @MaxLength(255)`
- `labelOverrideAr`: `@IsString @IsNotEmpty @MaxLength(255)`

**`lookup-category-response.dto.ts`** — `implements ILookupCategory`. All fields with `!` assertion.

**`lookup-value-response.dto.ts`** — `implements ILookupValue`. All fields with `!` assertion.

---

### Commit 3 — System seed data
```
foundation/lookup/lookup.seed.ts                                       CREATE
```

**`lookup.seed.ts`** — pure data file, no NestJS dependencies.
Exports a typed constant `SYSTEM_LOOKUP_SEED` consumed by `LookupService.seedSystemData()`.

```typescript
export interface SeedCategory {
  key: string;
  labelEn: string;
  labelAr: string;
  isExtensible: boolean;
  attributeSchema?: Record<string, unknown>;
  sortOrder: number;
  values: SeedValue[];
}

export interface SeedValue {
  key: string;
  labelEn: string;
  labelAr: string;
  sortOrder: number;
  attributes?: Record<string, unknown>;
}

export const SYSTEM_LOOKUP_SEED: SeedCategory[] = [
  {
    key: 'committee_type',
    labelEn: 'Committee Type',
    labelAr: 'نوع اللجنة',
    isExtensible: true,
    sortOrder: 10,
    values: [
      { key: 'quality_committee',   labelEn: 'Quality Committee',   labelAr: 'لجنة الجودة',        sortOrder: 10 },
      { key: 'safety_committee',    labelEn: 'Safety Committee',    labelAr: 'لجنة السلامة',       sortOrder: 20 },
      { key: 'executive_board',     labelEn: 'Executive Board',     labelAr: 'مجلس الإدارة',       sortOrder: 30 },
      { key: 'clinical_committee',  labelEn: 'Clinical Committee',  labelAr: 'اللجنة السريرية',    sortOrder: 40 },
      { key: 'advisory_committee',  labelEn: 'Advisory Committee',  labelAr: 'اللجنة الاستشارية', sortOrder: 50 },
    ],
  },
  {
    key: 'committee_member_role',
    labelEn: 'Committee Member Role',
    labelAr: 'دور عضو اللجنة',
    isExtensible: true,
    sortOrder: 20,
    values: [
      { key: 'chairman',      labelEn: 'Chairman',       labelAr: 'رئيس اللجنة',    sortOrder: 10 },
      { key: 'vice_chairman', labelEn: 'Vice Chairman',  labelAr: 'نائب الرئيس',    sortOrder: 20 },
      { key: 'secretary',     labelEn: 'Secretary',      labelAr: 'أمين السر',      sortOrder: 30 },
      { key: 'member',        labelEn: 'Member',         labelAr: 'عضو',            sortOrder: 40 },
      { key: 'observer',      labelEn: 'Observer',       labelAr: 'مراقب',          sortOrder: 50 },
      { key: 'advisor',       labelEn: 'Advisor',        labelAr: 'مستشار',         sortOrder: 60 },
    ],
  },
  {
    key: 'document_type',
    labelEn: 'Document Type',
    labelAr: 'نوع الوثيقة',
    isExtensible: true,
    attributeSchema: {
      type: 'object',
      properties: {
        requiresFlowchart:         { type: 'boolean' },
        defaultReviewCycleMonths:  { type: 'number' },
        numberingPrefix:           { type: 'string' },
        requiresCommitteeApproval: { type: 'boolean' },
        defaultRetentionYears:     { type: 'number' },
      },
    },
    sortOrder: 30,
    values: [
      { key: 'policy',     labelEn: 'Policy',     labelAr: 'سياسة',        sortOrder: 10, attributes: { numberingPrefix: 'POL', requiresFlowchart: false, defaultReviewCycleMonths: 24, requiresCommitteeApproval: true,  defaultRetentionYears: 10 } },
      { key: 'procedure',  labelEn: 'Procedure',  labelAr: 'إجراء',        sortOrder: 20, attributes: { numberingPrefix: 'PRO', requiresFlowchart: true,  defaultReviewCycleMonths: 12, requiresCommitteeApproval: false, defaultRetentionYears: 10 } },
      { key: 'form',       labelEn: 'Form',       labelAr: 'نموذج',        sortOrder: 30, attributes: { numberingPrefix: 'FRM', requiresFlowchart: false, defaultReviewCycleMonths: 12, requiresCommitteeApproval: false, defaultRetentionYears: 5  } },
      { key: 'plan',       labelEn: 'Plan',       labelAr: 'خطة',          sortOrder: 40, attributes: { numberingPrefix: 'PLN', requiresFlowchart: false, defaultReviewCycleMonths: 12, requiresCommitteeApproval: true,  defaultRetentionYears: 10 } },
      { key: 'manual',     labelEn: 'Manual',     labelAr: 'دليل',         sortOrder: 50, attributes: { numberingPrefix: 'MAN', requiresFlowchart: false, defaultReviewCycleMonths: 36, requiresCommitteeApproval: true,  defaultRetentionYears: 10 } },
      { key: 'guideline',  labelEn: 'Guideline',  labelAr: 'إرشادات',      sortOrder: 60, attributes: { numberingPrefix: 'GDL', requiresFlowchart: false, defaultReviewCycleMonths: 24, requiresCommitteeApproval: false, defaultRetentionYears: 5  } },
      { key: 'checklist',  labelEn: 'Checklist',  labelAr: 'قائمة مراجعة', sortOrder: 70, attributes: { numberingPrefix: 'CHL', requiresFlowchart: false, defaultReviewCycleMonths: 12, requiresCommitteeApproval: false, defaultRetentionYears: 5  } },
    ],
  },
  {
    key: 'document_section_type',
    labelEn: 'Document Section Type',
    labelAr: 'نوع قسم الوثيقة',
    isExtensible: true,
    sortOrder: 40,
    values: [
      { key: 'purpose',           labelEn: 'Purpose',           labelAr: 'الغرض',             sortOrder: 10 },
      { key: 'scope',             labelEn: 'Scope',             labelAr: 'النطاق',            sortOrder: 20 },
      { key: 'definitions',       labelEn: 'Definitions',       labelAr: 'التعريفات',         sortOrder: 30 },
      { key: 'responsibilities',  labelEn: 'Responsibilities',  labelAr: 'المسؤوليات',        sortOrder: 40 },
      { key: 'procedure',         labelEn: 'Procedure',         labelAr: 'الإجراء',           sortOrder: 50 },
      { key: 'references',        labelEn: 'References',        labelAr: 'المراجع',           sortOrder: 60 },
      { key: 'related_documents', labelEn: 'Related Documents', labelAr: 'الوثائق ذات الصلة', sortOrder: 70 },
    ],
  },
  {
    key: 'incident_type',
    labelEn: 'Incident Type',
    labelAr: 'نوع الحادثة',
    isExtensible: true,
    sortOrder: 50,
    values: [
      { key: 'operational',   labelEn: 'Operational',   labelAr: 'تشغيلية',    sortOrder: 10 },
      { key: 'safety',        labelEn: 'Safety',        labelAr: 'سلامة',      sortOrder: 20 },
      { key: 'environmental', labelEn: 'Environmental', labelAr: 'بيئية',      sortOrder: 30 },
      { key: 'security',      labelEn: 'Security',      labelAr: 'أمنية',      sortOrder: 40 },
      { key: 'financial',     labelEn: 'Financial',     labelAr: 'مالية',      sortOrder: 50 },
      { key: 'hr',            labelEn: 'Human Resources', labelAr: 'موارد بشرية', sortOrder: 60 },
      { key: 'it',            labelEn: 'Information Technology', labelAr: 'تقنية المعلومات', sortOrder: 70 },
    ],
  },
  {
    key: 'incident_severity',
    labelEn: 'Incident Severity',
    labelAr: 'خطورة الحادثة',
    isExtensible: false,
    sortOrder: 60,
    values: [
      { key: 'critical', labelEn: 'Critical', labelAr: 'حرجة',    sortOrder: 10 },
      { key: 'high',     labelEn: 'High',     labelAr: 'عالية',   sortOrder: 20 },
      { key: 'medium',   labelEn: 'Medium',   labelAr: 'متوسطة',  sortOrder: 30 },
      { key: 'low',      labelEn: 'Low',      labelAr: 'منخفضة',  sortOrder: 40 },
    ],
  },
  {
    key: 'audit_type',
    labelEn: 'Audit Type',
    labelAr: 'نوع المراجعة',
    isExtensible: true,
    sortOrder: 70,
    values: [
      { key: 'internal',        labelEn: 'Internal',        labelAr: 'داخلية',        sortOrder: 10 },
      { key: 'external',        labelEn: 'External',        labelAr: 'خارجية',        sortOrder: 20 },
      { key: 'surveillance',    labelEn: 'Surveillance',    labelAr: 'مراقبة',        sortOrder: 30 },
      { key: 'follow_up',       labelEn: 'Follow-up',       labelAr: 'متابعة',        sortOrder: 40 },
      { key: 'certification',   labelEn: 'Certification',   labelAr: 'اعتماد',        sortOrder: 50 },
      { key: 'recertification', labelEn: 'Re-certification', labelAr: 'إعادة اعتماد', sortOrder: 60 },
    ],
  },
  {
    key: 'corrective_action_type',
    labelEn: 'Corrective Action Type',
    labelAr: 'نوع الإجراء التصحيحي',
    isExtensible: true,
    sortOrder: 80,
    values: [
      { key: 'immediate',   labelEn: 'Immediate',   labelAr: 'فوري',       sortOrder: 10 },
      { key: 'corrective',  labelEn: 'Corrective',  labelAr: 'تصحيحي',    sortOrder: 20 },
      { key: 'preventive',  labelEn: 'Preventive',  labelAr: 'وقائي',     sortOrder: 30 },
      { key: 'systemic',    labelEn: 'Systemic',    labelAr: 'منهجي',     sortOrder: 40 },
    ],
  },
  {
    key: 'standard_body',
    labelEn: 'Accreditation Standard Body',
    labelAr: 'هيئة معايير الاعتماد',
    isExtensible: true,
    sortOrder: 90,
    values: [
      { key: 'jci',      labelEn: 'JCI',      labelAr: 'JCI',      sortOrder: 10 },
      { key: 'cbahi',    labelEn: 'CBAHI',    labelAr: 'CBAHI',    sortOrder: 20 },
      { key: 'iso_9001', labelEn: 'ISO 9001', labelAr: 'ISO 9001', sortOrder: 30 },
      { key: 'iso_14001',labelEn: 'ISO 14001',labelAr: 'ISO 14001',sortOrder: 40 },
      { key: 'iso_45001',labelEn: 'ISO 45001',labelAr: 'ISO 45001',sortOrder: 50 },
      { key: 'abet',     labelEn: 'ABET',     labelAr: 'ABET',     sortOrder: 60 },
      { key: 'cap',      labelEn: 'CAP',      labelAr: 'CAP',      sortOrder: 70 },
      { key: 'moh',      labelEn: 'Ministry of Health (local)', labelAr: 'وزارة الصحة (محلي)', sortOrder: 80 },
    ],
  },
  {
    key: 'gap_category',
    labelEn: 'Gap Category',
    labelAr: 'فئة الفجوة',
    isExtensible: true,
    sortOrder: 100,
    values: [
      { key: 'process',       labelEn: 'Process',       labelAr: 'العملية',      sortOrder: 10 },
      { key: 'people',        labelEn: 'People',        labelAr: 'الأشخاص',     sortOrder: 20 },
      { key: 'technology',    labelEn: 'Technology',    labelAr: 'التقنية',      sortOrder: 30 },
      { key: 'environment',   labelEn: 'Environment',   labelAr: 'البيئة',       sortOrder: 40 },
      { key: 'documentation', labelEn: 'Documentation', labelAr: 'التوثيق',     sortOrder: 50 },
      { key: 'resources',     labelEn: 'Resources',     labelAr: 'الموارد',      sortOrder: 60 },
    ],
  },
  {
    key: 'meeting_type',
    labelEn: 'Meeting Type',
    labelAr: 'نوع الاجتماع',
    isExtensible: true,
    sortOrder: 110,
    values: [
      { key: 'regular',       labelEn: 'Regular',       labelAr: 'اجتماع دوري',    sortOrder: 10 },
      { key: 'extraordinary', labelEn: 'Extraordinary', labelAr: 'اجتماع طارئ',    sortOrder: 20 },
      { key: 'emergency',     labelEn: 'Emergency',     labelAr: 'اجتماع استثنائي', sortOrder: 30 },
      { key: 'planning',      labelEn: 'Planning',      labelAr: 'اجتماع تخطيط',   sortOrder: 40 },
      { key: 'review',        labelEn: 'Review',        labelAr: 'اجتماع مراجعة',  sortOrder: 50 },
    ],
  },
  {
    key: 'org_unit_type',
    labelEn: 'Organization Unit Type',
    labelAr: 'نوع الوحدة التنظيمية',
    isExtensible: true,
    sortOrder: 120,
    values: [
      { key: 'department',    labelEn: 'Department',    labelAr: 'قسم',      sortOrder: 10 },
      { key: 'division',      labelEn: 'Division',      labelAr: 'إدارة',    sortOrder: 20 },
      { key: 'unit',          labelEn: 'Unit',          labelAr: 'وحدة',     sortOrder: 30 },
      { key: 'section',       labelEn: 'Section',       labelAr: 'شعبة',     sortOrder: 40 },
      { key: 'administration',labelEn: 'Administration',labelAr: 'مديرية',   sortOrder: 50 },
      { key: 'office',        labelEn: 'Office',        labelAr: 'مكتب',     sortOrder: 60 },
    ],
  },
];
```

---

### Commit 4 — LookupService + spec
```
foundation/lookup/lookup.service.ts                                    CREATE
foundation/lookup/lookup.service.spec.ts                               CREATE
```

**`lookup.service.ts`** methods:

```typescript
// ── System data ──────────────────────────────────────────────────────────────

// Seeds all system categories and values. Idempotent — safe to call repeatedly.
// Called by TenantService.bootstrap(). Never exposed via API.
seedSystemData(): Promise<void>

// ── Categories ───────────────────────────────────────────────────────────────

// Returns all system categories, active only
getCategories(organizationId: string): Promise<ILookupCategory[]>

// Returns a single category by key — system categories only
getCategoryByKey(key: string, organizationId: string): Promise<ILookupCategory>

// Updates labelEn/labelAr/attributeSchema on a category — system categories only
// Custom category creation is deferred to Step 24; throws ForbiddenException
// if called with organizationId set on the category record itself
updateCategory(
  key: string,
  organizationId: string,
  dto: UpdateLookupCategoryDto,
  actorId: string,
): Promise<ILookupCategory>

// Soft-deactivates a system category for this tenant (per-org override, not global)
deactivateCategory(key: string, organizationId: string, actorId: string): Promise<void>

// ── Values ────────────────────────────────────────────────────────────────────

// Two-layer resolution (see Business Rules section 8):
// Returns system values (with org-specific overrides applied) + tenant additions
getValues(categoryKey: string, organizationId: string): Promise<ILookupValue[]>

// Adds a TENANT-layer value to any extensible system category
addValue(
  categoryKey: string,
  organizationId: string,
  dto: CreateLookupValueDto,
  actorId: string,
): Promise<ILookupValue>

// Updates a tenant's own value — throws ForbiddenException on system values
updateValue(
  id: string,
  organizationId: string,
  dto: UpdateLookupValueDto,
  actorId: string,
): Promise<ILookupValue>

// Soft-deletes a tenant value (isActive = false) — throws ForbiddenException on system values
removeValue(id: string, organizationId: string, actorId: string): Promise<void>

// Hides a system value for this tenant only (upserts override record)
hideSystemValue(valueId: string, organizationId: string, actorId: string): Promise<void>

// Restores a previously hidden system value for this tenant
unhideSystemValue(valueId: string, organizationId: string, actorId: string): Promise<void>

// Overrides display labels of a system value for this tenant only
overrideLabel(
  valueId: string,
  organizationId: string,
  dto: OverrideLabelDto,
  actorId: string,
): Promise<void>

// AI stub — returns suggested missing values for a category based on its existing values
// Does NOT persist anything — raw suggestions returned for human review and acceptance
suggestValues(categoryKey: string, organizationId: string, actorId: string): Promise<SuggestedValue[]>
```

**Spec must cover:**
- `seedSystemData()` inserts all 12 categories + their values idempotently
- `getValues()` two-layer resolution — returns system values merged with tenant additions
- `getValues()` hides system value when org has an override with isHidden=true
- `getValues()` applies tenant label override when present
- `addValue()` creates TENANT-layer value correctly scoped to org
- `addValue()` throws ForbiddenException when category is not extensible
- `updateValue()` throws ForbiddenException when attempting to modify a system value
- `removeValue()` throws ForbiddenException when attempting to delete a system value
- `updateCategory()` persists label/schema changes on a system category
- `deactivateCategory()` marks the category inactive for the tenant
- Tenant isolation test: org B cannot see org A's tenant-added values

---

### Commit 5 — LookupController + spec
```
foundation/lookup/lookup.controller.ts                                 CREATE
foundation/lookup/lookup.controller.spec.ts                            CREATE
```

**Endpoints:**

```
GET    /lookups/categories                            @Permissions(LOOKUPS_PERMISSIONS.VIEW)
GET    /lookups/categories/:key                       @Permissions(LOOKUPS_PERMISSIONS.VIEW)
GET    /lookups/categories/:key/values                @Permissions(LOOKUPS_PERMISSIONS.VIEW)
PATCH  /lookups/categories/:key                       @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
DELETE /lookups/categories/:key/deactivate            @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
POST   /lookups/categories/:key/values                @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
PATCH  /lookups/values/:id                            @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
DELETE /lookups/values/:id                            @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
POST   /lookups/values/:id/hide                       @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
POST   /lookups/values/:id/unhide                     @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
POST   /lookups/values/:id/override-label             @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
POST   /lookups/categories/:key/ai/suggest-values     @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
```

Note: `POST /lookups/categories` (create new category) is intentionally absent.
Category creation is deferred to Step 24 (Custom Fields Engine).

Rules:
- `@UseGuards(TenantGuard, PermissionGuard)` at class level
- `@CurrentTenant()` for organizationId — never from request body
- `@CurrentUser()` for actorId on all mutations
- Zero business logic — all delegation to LookupService
- Controller specs mock LookupService and override guards

---

### Commit 6 — LookupModule + AppModule
```
foundation/lookup/lookup.module.ts                                     CREATE
app.module.ts                                                          MODIFY
```

**`lookup.module.ts`**:
```typescript
@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [LookupController],
  providers: [LookupService],
  exports: [LookupService],   // exported — any module needing dropdown values imports this
})
export class LookupModule {}
```

`LookupModule` must be exported because every functional module (documents, incidents,
audits, etc.) will import `LookupService` to resolve dropdown values at runtime.

Add `LookupModule` to `AppModule` imports.

---

### Commit 7 — Fill TenantService bootstrap stub
```
foundation/tenant/tenant.service.ts                                    MODIFY
```

The bootstrap() method has this TODO at line ~155:
```typescript
// TODO(Step 4 — Lookup): seed system lookup values for this tenant
```

Note: this comment says "Step 4" but it is Step 3 in the build order.
Replace the TODO with an actual call:

```typescript
// Seed system lookup data (idempotent — safe on every bootstrap)
await this.lookupService.seedSystemData();
```

`LookupService` is injected via constructor — add it to `TenantModule` imports
(or inject `LookupService` directly if `LookupModule` is imported in `TenantModule`).

**Important:** Do NOT create circular dependency. `TenantModule` already exports
guards and services used by `LookupModule`. To avoid a circular import:
- Inject `PrismaService` directly in `TenantService` to call seedSystemData logic
- OR use NestJS `forwardRef()` carefully
- OR move seedSystemData() to a separate `LookupSeedService` that `TenantModule`
  can import without importing the full `LookupModule`

Preferred resolution: extract seed logic to `LookupSeedService` in a separate
provider that has no dependency on `TenantModule`.

---

## 4. FILES TO CREATE (FRONTEND)

Angular 21 standalone components. PrimeNG for UI. Tailwind for layout.
All paths relative to `frontend/src/app/`.

### Commit 8 — Angular lookup feature
```
foundation/lookup/services/lookup.service.ts                          CREATE
foundation/lookup/components/
  lookup-category-list/lookup-category-list.component.ts             CREATE
  lookup-value-list/lookup-value-list.component.ts                   CREATE
  lookup-value-form/lookup-value-form.component.ts                   CREATE
foundation/lookup/lookup.routes.ts                                    CREATE
```

**`lookup.service.ts`** — Angular `HttpClient` wrapper:
```typescript
@Injectable({ providedIn: 'root' })
export class LookupService {
  listCategories(): Observable<LookupCategoryDto[]>
  getCategoryByKey(key: string): Observable<LookupCategoryDto>
  getValues(categoryKey: string): Observable<LookupValueDto[]>
  createCategory(dto: CreateLookupCategoryDto): Observable<LookupCategoryDto>
  updateCategory(id: string, dto: UpdateLookupCategoryDto): Observable<LookupCategoryDto>
  deactivateCategory(id: string): Observable<void>
  addValue(categoryId: string, dto: CreateLookupValueDto): Observable<LookupValueDto>
  updateValue(id: string, dto: UpdateLookupValueDto): Observable<LookupValueDto>
  removeValue(id: string): Observable<void>
  hideSystemValue(id: string): Observable<void>
  unhideSystemValue(id: string): Observable<void>
  overrideSystemValueLabel(id: string, dto: OverrideLabelDto): Observable<void>
}
```

**`lookup-category-list.component.ts`** — PrimeNG Table:
- Columns: key, labelEn, labelAr, isSystem badge, isExtensible, sortOrder, actions
- System categories: grey "System" badge — edit/delete buttons hidden
- Tenant categories: full edit/delete/deactivate actions
- "New Category" button — navigates to a dialog/form for creating tenant category
- Click on row → navigates to `lookup-value-list` for that category

**`lookup-value-list.component.ts`** — PrimeNG Table:
- Route param `:key` used to load the category and its values
- Columns: key, labelEn (or override), layer badge (System/Tenant), isHidden, attributes summary, actions
- System values: show hide/unhide toggle + override-label button
  - Hidden values shown with strikethrough and a "Restore" action
  - Override label button opens an inline form (labelOverrideEn, labelOverrideAr)
- Tenant values: edit/delete
- "Add Value" button (only shown if category.isExtensible = true) → navigate to value form
- Category header shows name, key, isSystem badge, and attribute schema summary
- AI suggest button: "Suggest Missing Values with AI" (see AI Integration Points)

**`lookup-value-form.component.ts`** — Angular Reactive Form:
- Used for create and edit of tenant values
- Static fields: key, labelEn, labelAr, sortOrder
- Dynamic attribute fields: rendered from `category.attributeSchema` using
  `@switch` on property type:
  - `"boolean"` → p-toggleswitch
  - `"number"` → p-inputNumber
  - `"string"` → pInputText
  - Validation driven by `required` field in attribute schema if present

**`lookup.routes.ts`**:
```typescript
export const LOOKUP_ROUTES: Routes = [
  { path: '', loadComponent: () => LookupCategoryListComponent },
  { path: ':key', loadComponent: () => LookupValueListComponent },
  { path: ':key/values/new', loadComponent: () => LookupValueFormComponent },
  { path: ':key/values/:id/edit', loadComponent: () => LookupValueFormComponent },
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
  "lookup": {
    "title": "Lookup Management",
    "categories": "Lookup Categories",
    "values": "Values",
    "systemBadge": "System",
    "tenantBadge": "Custom",
    "addCategory": "New Category",
    "editCategory": "Edit Category",
    "deactivateCategory": "Deactivate Category",
    "categoryKey": "Category Key",
    "categoryKeyHint": "Lowercase letters, numbers, and underscores only. Cannot be changed after creation.",
    "labelEn": "Label (English)",
    "labelAr": "Label (Arabic)",
    "isExtensible": "Allow tenant values",
    "attributeSchema": "Attribute Schema",
    "addValue": "Add Value",
    "editValue": "Edit Value",
    "removeValue": "Remove Value",
    "valueKey": "Value Key",
    "valueKeyHint": "Lowercase letters, numbers, and underscores only.",
    "layer": "Layer",
    "layerSystem": "System",
    "layerTenant": "Custom",
    "hideValue": "Hide",
    "unhideValue": "Restore",
    "overrideLabel": "Override Label",
    "overrideLabelEn": "Override Label (English)",
    "overrideLabelAr": "Override Label (Arabic)",
    "overrideLabelHint": "Overrides the system label for your organization only.",
    "sortOrder": "Sort Order",
    "attributes": "Attributes",
    "noCategories": "No lookup categories found.",
    "noValues": "No values defined for this category.",
    "systemCategoryReadOnly": "System categories cannot be edited.",
    "systemValueReadOnly": "System values cannot be deleted. You may hide or override their label.",
    "confirmDeactivate": "Deactivate this category? Existing values will no longer appear in dropdowns.",
    "confirmRemoveValue": "Remove this value? It will no longer appear in dropdowns.",
    "suggestValues": "Suggest Values with AI",
    "aiSuggesting": "AI is generating suggestions...",
    "aiSuggestionsTitle": "AI-Suggested Values",
    "aiSuggestionsHint": "Review each suggestion and accept the ones relevant to your organization."
  }
}
```

Arabic equivalents in `ar.json`.

---

## 5. COMMIT SEQUENCE

All commits on branch `feature/ACC-7-lookup-system`.
Format: `{type}({scope}): {description} [ACC-7]`

```
Commit 1:  chore(prisma): extend LookupCategory with tenant-scoping fields [ACC-7]
Commit 2:  feat(lookup): add lookup interfaces and DTOs [ACC-7]
Commit 3:  feat(lookup): add system lookup seed data [ACC-7]
Commit 4:  feat(lookup): add LookupService with two-layer value resolution [ACC-7]
Commit 5:  feat(lookup): add LookupController [ACC-7]
Commit 6:  chore(lookup): register LookupModule in AppModule [ACC-7]
Commit 7:  fix(tenant): wire lookup seed into bootstrap [ACC-7]
Commit 8:  feat(lookup): add Angular lookup components [ACC-7]
Commit 9:  feat(i18n): add lookup translation keys [ACC-7]
```

Run `npx tsc --noEmit` before commits 1, 4, 5, 6, 7, 8.
Run `npx jest --passWithNoTests` before commits 4, 5, 6, 7.

---

## 6. ACCEPTANCE CRITERIA

- [ ] `LookupCategory` schema updated — `organizationId`, `isSystem`, `isExtensible` added
- [ ] Migration applied — database schema up to date
- [ ] All 12 system categories seeded with their default values
- [ ] `seedSystemData()` is idempotent — calling it twice produces no duplicates
- [ ] System categories visible to every tenant (organizationId = null)
- [ ] System categories cannot be edited or deleted by tenants (ForbiddenException)
- [ ] System values cannot be deleted by tenants (ForbiddenException)
- [ ] Tenant can hide a system value — it disappears from their dropdowns
- [ ] Tenant can unhide a previously hidden system value
- [ ] Tenant can override system value label — their users see the override
- [ ] Tenant can add values to extensible categories (layer = TENANT)
- [ ] Tenant can create entirely new categories (organizationId = orgId, isSystem = false)
- [ ] `getValues()` returns merged result: system values (with overrides) + tenant additions
- [ ] `document_type` attribute schema stored correctly — UI renders dynamic fields
- [ ] `incident_severity` is non-extensible — "Add Value" button hidden in UI
- [ ] All lookup endpoints protected by TenantGuard + PermissionGuard
- [ ] `LookupModule` exports `LookupService` — importable by future modules
- [ ] Backend TypeScript: zero errors
- [ ] Frontend TypeScript: zero errors
- [ ] All tests passing (57+ existing + new lookup tests)
- [ ] Tenant isolation tests present for `LookupService`
- [ ] Tenant isolation: org B cannot see org A's tenant-created categories or values
- [ ] `TenantService.bootstrap()` TODO (Step 4 comment) replaced with real call
- [ ] Translation keys in both `en.json` and `ar.json`
- [ ] PR to dev with green CI

---

## 7. DEPENDENCIES

### What This Step Requires from Steps 1–2

| Requirement | Where It Comes From |
|---|---|
| `TenantModule` import | Provides `AuditLogService`, guards, decorators |
| `AuditLogService` | Call `log()` on every category/value create, update, hide, delete |
| `TenantGuard` | Applied at `LookupController` class level |
| `PermissionGuard` | Applied at `LookupController` class level (stubbed until Step 5) |
| `@CurrentTenant()` | Inject tenant ID in controller |
| `@CurrentUser()` | Inject actor ID for audit log |
| `LOOKUPS_PERMISSIONS.VIEW` / `.MANAGE` | Already in `common/constants/permissions.ts` |
| `PrismaModule` | Database access |
| `LookupLayer` enum | Already in `schema.prisma` (SYSTEM, TENANT) |
| `OrgUnit` model | Exists from Step 2 — `org_unit_type` category references it |

### What Future Steps Will Require from Step 3

| Future Step | What It Needs |
|---|---|
| Step 5 — Roles + permissions | `lookups:view` and `lookups:manage` permission strings already defined |
| Step 6 — Workflow engine | `LookupService.getValues()` for workflow stage type dropdowns |
| Step 10 — Committees | `committee_type` and `committee_member_role` values |
| Step 11 — Meetings | `meeting_type` values |
| Module 2 — Documents | `document_type` with `numberingPrefix` attribute for document numbering |
| Module 2 — Documents | `document_section_type` for template section building |
| Module 3 — Quality improvement | `incident_type`, `incident_severity`, `gap_category` values |
| Module 4 — Audit | `audit_type`, `corrective_action_type`, `standard_body` values |
| All modules | `LookupService` exported from `LookupModule` — import in any module needing dropdowns |

---

## 8. BUSINESS RULES

### Two-Layer Architecture

```
SYSTEM layer (isSystem = true, organizationId = null on LookupCategory):
  - Seeded by AccreditMe platform
  - Visible to all tenants
  - Cannot be edited or deleted by tenants
  - Tenants may hide individual values (per-org)
  - Tenants may override display labels (per-org)
  - Tenants may add their own values to extensible system categories

TENANT layer (isSystem = false, organizationId = orgId on LookupCategory):
  - Created by tenant admin
  - Scoped to their organization only
  - Fully editable and deletable by tenant
  - Cannot be seen by other tenants
```

### Two-Layer Value Resolution Algorithm

`getValues(categoryKey, organizationId)` must implement this merge:

```
1. Load all SYSTEM values for category (layer=SYSTEM, organizationId=null)
2. Load all TENANT records for this org in this category (organizationId=orgId)
3. Build a map of tenant records keyed by value.key
4. For each system value:
   a. Check if tenant has an override record with the same key
   b. If override.isHidden = true → EXCLUDE this value from results
   c. If override has labelOverrideEn / labelOverrideAr → use override labels
   d. Otherwise → use system value as-is
5. Collect tenant-only values: tenant records with keys NOT found in system values
6. Return: filtered system values (with overrides applied) + tenant-only values
7. Sort the full result by sortOrder ascending
```

### Hide and Override Mechanism

When a tenant hides or overrides a system value:
- The service **upserts** a TENANT-layer record with the same `categoryId` + `key` but `organizationId = orgId`
- The `@@unique([categoryId, key, organizationId])` constraint allows this to coexist with the system record
- The override record carries `isHidden`, `labelOverrideEn`, `labelOverrideAr`
- The system record is NEVER modified

### Non-Extensible Categories

`isExtensible = false` on a category (e.g. `incident_severity`) means:
- Tenants cannot add new values to this category
- The "Add Value" button is hidden in the UI for this category
- Service throws `ForbiddenException` if tenant tries to add a value anyway

### System Value Keys

System value `key` fields use `snake_case` and are stable across versions.
These keys are referenced in application code (e.g. `document_type.policy`
to look up the policy numbering prefix). Changing keys would break references.
**Never change system value keys after initial release.**

### Attribute Schema Convention

The `attributeSchema` on a `LookupCategory` is a JSON Schema object.
The UI reads it and renders dynamic form fields for each value in that category.
Only `type: 'string' | 'number' | 'boolean'` are supported in the UI renderer.
Other types (`array`, `object`) are stored but rendered as raw JSON text input.

### Tenant Cannot Re-Use a System Category Key

`@@unique([key, organizationId])` on `LookupCategory` allows a tenant to create
a category with key `custom_type` (organizationId = orgId). But they CANNOT create
a category with key `document_type` (already exists with organizationId = null).
The service enforces this with a ConflictException check before insert.

### Audit Log

`AuditLogService.log()` on every mutation:
- Category create, update, deactivate
- Value add, update, remove
- System value hide, unhide, override-label

---

## 9. AI INTEGRATION POINTS

Per CLAUDE.md: "Lookup management: Suggest missing lookup values based on industry standards."

### Suggest Missing Values

**Trigger:** User clicks "Suggest Values with AI" on any value list page.

**Request (frontend → backend):**
```
POST /api/v1/lookups/categories/:key/ai/suggest-values
Body: { language: 'en' }
```

**Backend flow:**
1. Load the category (`categoryKey`, `labelEn`, existing value labels)
2. Build prompt:
   ```
   "This is a quality management system used for organizational accreditation.
    Category: {category.labelEn}
    Existing values: {value1}, {value2}, ...
    Suggest additional values that are commonly needed in quality management
    and accreditation programs but are missing from the list above.
    For each suggestion provide: key (snake_case), English label, Arabic label.
    Return as a JSON array. Do not repeat existing values."
   ```
3. Call `AI_PROVIDER` from `TenantModule`
4. Log AI interaction (actor, model, prompt summary, response, timestamp)
5. Return raw AI suggestions to frontend — NOT auto-saved

**Frontend flow:**
1. Show spinner on button
2. Display suggestions as cards with checkbox
3. User selects which to accept
4. "Add Selected" → calls `POST /lookups/categories/:categoryId/values` for each accepted

**Pattern: AI suggests → human reviews → human approves → system records**

This endpoint can stub the AI call in ACC-7 (return hardcoded sample data).
The live AI call is wired when the AI integration pattern is validated in a later step.

---

## 10. PROGRESS TRACKER

```
[ ] Health check passed (see Section HEALTH CHECK above — 🟢 HEALTHY)
[ ] Linear ticket ACC-7 created via /new-ticket
[ ] Feature branch created: feature/ACC-7-lookup-system
[ ] schema.prisma updated — LookupCategory extended with organizationId, isSystem, isExtensible
[ ] Organization model updated with lookupCategories relation
[ ] Migration run: npx prisma migrate dev --name extend-lookup-category-tenant-support
[ ] Schema verified in Prisma Studio — LookupCategory has new columns
[ ] Commit 1 done: chore(prisma): extend LookupCategory with tenant-scoping fields [ACC-7]
[ ] Lookup interfaces written (ILookupCategory, ILookupValue)
[ ] All 7 DTO files written with class-validator decorators
[ ] Commit 2 done: feat(lookup): add lookup interfaces and DTOs [ACC-7]
[ ] lookup.seed.ts written with all 12 categories + values + Arabic labels
[ ] document_type attributeSchema included
[ ] Commit 3 done: feat(lookup): add system lookup seed data [ACC-7]
[ ] LookupService written — all methods implemented
[ ] Two-layer value resolution algorithm implemented in getValues()
[ ] seedSystemData() is idempotent (uses upsert)
[ ] LookupService spec covers: seed, getValues merge, hide, override, tenant isolation
[ ] npx tsc --noEmit → zero errors
[ ] npx jest --passWithNoTests → all tests pass
[ ] Commit 4 done: feat(lookup): add LookupService with two-layer value resolution [ACC-7]
[ ] LookupController written — all 12 endpoints, zero business logic
[ ] LookupController spec written — guards mocked, routing verified
[ ] Commit 5 done: feat(lookup): add LookupController [ACC-7]
[ ] LookupModule created and exported LookupService
[ ] AppModule updated with LookupModule import
[ ] npx tsc --noEmit → zero errors
[ ] npx jest --passWithNoTests → all tests pass
[ ] Commit 6 done: chore(lookup): register LookupModule in AppModule [ACC-7]
[ ] TenantService bootstrap TODO replaced with real seedSystemData() call
[ ] Circular dependency resolved (LookupSeedService pattern or PrismaService direct)
[ ] Commit 7 done: fix(tenant): wire lookup seed into bootstrap [ACC-7]
[ ] Angular LookupService written
[ ] lookup-category-list component written (PrimeNG Table)
[ ] lookup-value-list component written (system badges, hide/override actions)
[ ] lookup-value-form component written (static fields + dynamic attribute fields)
[ ] lookup.routes.ts written
[ ] Commit 8 done: feat(lookup): add Angular lookup components [ACC-7]
[ ] en.json updated with all lookup keys
[ ] ar.json updated with all Arabic translations
[ ] Commit 9 done: feat(i18n): add lookup translation keys [ACC-7]
[ ] Final check: npx tsc --noEmit (backend + frontend) → zero errors
[ ] Final check: npx jest --passWithNoTests → all tests pass
[ ] Final check: tenant isolation test for LookupService passing
[ ] /ready-to-pr run — PR opened to dev with [ACC-7] in title
[ ] CI green on GitHub Actions
[ ] PR merged to dev (squash merge)
[ ] feature/ACC-7-lookup-system branch deleted from GitHub
[ ] ACC-7 marked Done in Linear
[ ] Step 4 (Roles + permissions) can begin
```

---

## 11. BUSINESS RULES (confirmed by product owner)

### System Lookup Lifecycle

- System lookups are immutable once seeded — keys never change between versions
- New values added in platform releases are additive only — old keys never removed
- `isSystem = true` on LookupCategory is the authoritative flag — enforced in service
- Platform can add new system categories via a new migration + seed iteration

### Tenant Lookup Lifecycle

- Tenant categories: edit and deactivate only — creation is deferred (see below)
- Tenant values: fully owned by tenant — add, edit, remove
- Deactivated categories are not deleted — they become invisible in dropdowns
- Removed tenant values are soft-deleted (set isActive = false) — never hard-deleted
  because historical records may reference the value key
- Custom category creation: Deferred to Step 24 (Custom Fields Engine).
  Tenants cannot create entirely new LookupCategory records in Steps 3–23.
  The service throws ForbiddenException if organizationId is provided on a
  category creation request. Only platform-level migrations can create new categories.

### Cross-Module Value Reference Pattern

When a module needs a lookup value:
```typescript
// Correct — use LookupService, not raw Prisma
const values = await this.lookupService.getValues('document_type', organizationId);
const policy = values.find(v => v.key === 'policy');
const prefix = policy?.attributes?.['numberingPrefix'] ?? 'DOC';
```

Never hardcode value keys as magic strings outside of constants files.
Create a `LOOKUP_KEYS` constant file in `common/constants/` in a later step
to centralise the system value key references used across modules.

### `incident_severity` is Non-Extensible by Design

Severity levels (Critical/High/Medium/Low) map to SLA multipliers and
escalation rules elsewhere in the platform. Allowing tenant-defined severity
values would break those calculations. `isExtensible = false` enforces this.

### Soft-Delete Only

No hard deletes on any lookup record — ever. Records that are "deleted" or
"deactivated" by tenants are set to `isActive = false`. Historical data
(documents, incidents, audits) always references the key — losing the record
would break FK lookups and audit trails.

### Arabic Labels Are Required for System Seed

All 12 system categories and all their values require both `labelEn` and
`labelAr`. The seed file already provides Arabic labels. All future system
seed additions must include Arabic from day one.

### Industry Scope

AccreditMe is industry-agnostic. System categories are generic quality
management terms. The `standard_body` category allows tenants to select
their specific accreditation body — no industry hardcoding anywhere.

---

*Plan created: 2026-07-18*
*Branch to create: feature/ACC-7-lookup-system*
*Depends on: ACC-6 (merged to dev ✅)*
