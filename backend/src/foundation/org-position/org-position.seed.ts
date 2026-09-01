export interface DefaultPositionSeed {
  nameEn: string;
  nameAr: string;
  grade: number;
  // ACC-46 Section 2.5 — optional, defaults false for every entry that
  // doesn't set it (matches every other seeded position's prior behavior
  // exactly). org-position.service.ts's seedDefaultPositions() also sets
  // isSingleAssignee from this same flag — isUnitHeadPosition: true always
  // requires isSingleAssignee: true (schema-enforced pairing,
  // validateHeadFlagPairing()), which seeding bypasses since it calls
  // prisma.orgPosition.create() directly, not createPosition() — the seed
  // data itself must satisfy the invariant, nothing else will.
  isUnitHeadPosition?: boolean;
}

// 10 org-wide default positions (orgUnitId: null) — module-designs.md's
// "Org Position Module" section. Grade 1 = lowest, 10 = highest.
// Pure data, no NestJS/Prisma imports — same reasoning as
// lookup.seed.ts/role.seed.ts: prisma/demo-seed.ts imports this directly via
// plain ts-node (no NestJS DI), which breaks the moment anything in the
// import chain pulls in PrismaService's `.js`-suffixed generated-client
// import (only resolves under Nest CLI's own toolchain — see demo-seed.ts's
// header comment).
//
// ACC-46 Section 2.5 — Director is the one deliberate exception to ACC-40's
// own design that head-conferring status is never a seed default: makes the
// tenant's first admin (resolveDefaultTenantAdminAssignment() picks Director
// by name for exactly this reason) the root unit's real Head from bootstrap
// onward, satisfying the new "cannot invite into a headless unit" rule
// (Section 2.4) immediately, with no manual configuration step. roleId stays
// unset here (schema default null) — deliberately: the tenant admin already
// gets TENANT_ADMIN via a direct role assignment
// (PlatformTenantService.createTenant()), never through the head-authority
// grant chain, so this needs no roleId to work correctly.
export const DEFAULT_POSITIONS: DefaultPositionSeed[] = [
  { nameEn: 'Director', nameAr: 'مدير عام', grade: 10, isUnitHeadPosition: true },
  { nameEn: 'Deputy Director', nameAr: 'نائب المدير العام', grade: 9 },
  { nameEn: 'Department Head', nameAr: 'رئيس قسم', grade: 8 },
  { nameEn: 'Section Manager', nameAr: 'مدير شعبة', grade: 7 },
  { nameEn: 'Senior Specialist', nameAr: 'أخصائي أول', grade: 6 },
  { nameEn: 'Specialist', nameAr: 'أخصائي', grade: 5 },
  { nameEn: 'Senior Technician', nameAr: 'فني أول', grade: 4 },
  { nameEn: 'Technician', nameAr: 'فني', grade: 3 },
  { nameEn: 'Coordinator', nameAr: 'منسق', grade: 2 },
  { nameEn: 'Staff', nameAr: 'موظف', grade: 1 },
];
