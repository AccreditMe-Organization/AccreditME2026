export interface DefaultPositionSeed {
  nameEn: string;
  nameAr: string;
  grade: number;
}

// 10 org-wide default positions (orgUnitId: null) — module-designs.md's
// "Org Position Module" section. Grade 1 = lowest, 10 = highest.
// Pure data, no NestJS/Prisma imports — same reasoning as
// lookup.seed.ts/role.seed.ts: prisma/demo-seed.ts imports this directly via
// plain ts-node (no NestJS DI), which breaks the moment anything in the
// import chain pulls in PrismaService's `.js`-suffixed generated-client
// import (only resolves under Nest CLI's own toolchain — see demo-seed.ts's
// header comment).
export const DEFAULT_POSITIONS: DefaultPositionSeed[] = [
  { nameEn: 'Director', nameAr: 'مدير عام', grade: 10 },
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
