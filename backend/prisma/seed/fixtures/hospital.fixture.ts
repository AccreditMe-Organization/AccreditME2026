// ACC-62 — Tenant A: Al Nakheel Specialist Hospital.
//
// The name is FICTIONAL, chosen to be plausible for the GCC market without
// implying a real institution or customer.
//
// Pure data. Every constraint this file has to satisfy is enforced by
// validateFixture() before a single write happens — unit-code length, the
// head-position pairing, the manager tree being a real subtree of the org
// tree, and each edge case genuinely being the state it claims to be.
import { TenantFixture } from './fixture.types';

// ── Head-conferring positions ────────────────────────────────────────────────
// Only 'Director' ships with isUnitHeadPosition among the 10 industry-agnostic
// DEFAULT_POSITIONS, so a 4-level hierarchy would otherwise have a hospital's
// CEO, a ward head and a unit head all holding the identical title (ACC-62
// PD #2, approved). Positions are org-wide and @@unique([organizationId,
// nameEn]), so each tenant can carry its own vocabulary.
//
// isSingleAssignee is set on every one of these, never independently: the
// schema requires the pairing and direct-create seeding bypasses
// validateHeadFlagPairing().
const POSITIONS = [
  { nameEn: 'Chief Executive Officer', nameAr: 'الرئيس التنفيذي', grade: 12, isUnitHeadPosition: true, isSingleAssignee: true },
  { nameEn: 'Chief Medical Officer', nameAr: 'المدير الطبي', grade: 11, isUnitHeadPosition: true, isSingleAssignee: true },
  { nameEn: 'Head of Ward', nameAr: 'رئيس جناح', grade: 8, isUnitHeadPosition: true, isSingleAssignee: true },
  { nameEn: 'Head of Section', nameAr: 'رئيس شعبة', grade: 7, isUnitHeadPosition: true, isSingleAssignee: true },
  { nameEn: 'Unit Head', nameAr: 'رئيس وحدة', grade: 6, isUnitHeadPosition: true, isSingleAssignee: true },
];

// ── Org tree ─────────────────────────────────────────────────────────────────
// Clinical departments run Departments -> Wards -> Units. Administrative ones
// use Section rather than Ward at level 2, because no real hospital has a
// "Quality & Patient Safety Ward" (ACC-62 Section 1, flagged and approved).
//
// Codes are the unit keys and inherit CreateOrgUnitDto's real constraints:
// @MaxLength(10) and /^[A-Z0-9-]+$/. That limit is why the microbiology unit
// is CSS-MIC rather than the plan's original CSS-LAB-MIC, which was 11 chars
// and would have been rejected at write time.
const TREE = {
  key: 'NAKHEEL',
  nameEn: 'Al Nakheel Specialist Hospital',
  nameAr: 'مستشفى النخيل التخصصي',
  type: 'administration',
  children: [
    {
      key: 'MED',
      nameEn: 'Medical Affairs',
      nameAr: 'الشؤون الطبية',
      type: 'department',
      children: [
        {
          key: 'MED-IM',
          nameEn: 'Internal Medicine Ward',
          nameAr: 'جناح الباطنة',
          type: 'ward',
          children: [
            { key: 'MED-IM-CAR', nameEn: 'Cardiology Unit', nameAr: 'وحدة القلب', type: 'unit' },
            { key: 'MED-IM-END', nameEn: 'Endocrinology Unit', nameAr: 'وحدة الغدد الصماء', type: 'unit' },
          ],
        },
        {
          key: 'MED-CC',
          nameEn: 'Critical Care Ward',
          nameAr: 'جناح العناية الحرجة',
          type: 'ward',
          children: [
            { key: 'MED-CC-AIC', nameEn: 'Adult ICU', nameAr: 'العناية المركزة للبالغين', type: 'unit' },
            // EDGE CASE 1 — deliberately has staff but no head-position holder.
            { key: 'MED-CC-NIC', nameEn: 'Neonatal ICU', nameAr: 'العناية المركزة لحديثي الولادة', type: 'unit' },
          ],
        },
        {
          key: 'MED-SU',
          nameEn: 'Surgical Ward',
          nameAr: 'جناح الجراحة',
          type: 'ward',
          children: [
            { key: 'MED-SU-OT', nameEn: 'Operating Theatres Unit', nameAr: 'وحدة غرف العمليات', type: 'unit' },
          ],
        },
      ],
    },
    {
      key: 'NUR',
      nameEn: 'Nursing Affairs',
      nameAr: 'شؤون التمريض',
      type: 'department',
      children: [
        {
          key: 'NUR-IP',
          nameEn: 'Inpatient Nursing Ward',
          nameAr: 'جناح تمريض التنويم',
          type: 'ward',
          children: [
            { key: 'NUR-IP-WN', nameEn: 'Ward Nursing Unit', nameAr: 'وحدة تمريض الأجنحة', type: 'unit' },
          ],
        },
        { key: 'NUR-OP', nameEn: 'Outpatient Nursing Ward', nameAr: 'جناح تمريض العيادات', type: 'ward' },
      ],
    },
    {
      key: 'QPS',
      nameEn: 'Quality & Patient Safety',
      nameAr: 'الجودة وسلامة المرضى',
      type: 'department',
      children: [
        { key: 'QPS-ACC', nameEn: 'Accreditation Section', nameAr: 'شعبة الاعتماد', type: 'section' },
        { key: 'QPS-IC', nameEn: 'Infection Control Section', nameAr: 'شعبة مكافحة العدوى', type: 'section' },
      ],
    },
    {
      key: 'CSS',
      nameEn: 'Clinical Support Services',
      nameAr: 'الخدمات الطبية المساندة',
      type: 'department',
      children: [
        // EDGE CASE 3 — head handover in progress.
        { key: 'CSS-PHR', nameEn: 'Pharmacy Section', nameAr: 'شعبة الصيدلية', type: 'section' },
        {
          key: 'CSS-LAB',
          nameEn: 'Laboratory Section',
          nameAr: 'شعبة المختبر',
          type: 'section',
          children: [
            { key: 'CSS-MIC', nameEn: 'Microbiology Unit', nameAr: 'وحدة الأحياء الدقيقة', type: 'unit' },
          ],
        },
      ],
    },
  ],
};

// ── People ───────────────────────────────────────────────────────────────────
// 24 people. Every unit has a head-position holder EXCEPT MED-CC-NIC, which is
// deliberate: it makes the seeded vacancy the ONLY one in the tenant, so the
// edge case is findable rather than lost among incidental gaps. The four
// non-head people exist to serve the other three edge cases (the OOO delegate,
// the vacant unit's staffer, the handover target, and one half of the
// duplicate-name pair).
//
// Every reportsTo points to someone in the same unit or a direct ancestor —
// validateFixture() proves this, so the reporting tree cannot silently stop
// being a subtree of the org tree.
const PEOPLE = [
  { key: 'hessa', name: 'Dr. Hessa Al-Dosari', emailLocal: 'hessa.aldosari', position: 'Chief Executive Officer', unit: 'NAKHEEL', reportsTo: null },

  // Medical Affairs
  { key: 'faisal', name: 'Dr. Faisal Al-Qahtani', emailLocal: 'faisal.alqahtani', position: 'Chief Medical Officer', unit: 'MED', reportsTo: 'hessa' },
  // EDGE CASE 2 — out of office, covered by Omar.
  { key: 'layla', name: 'Dr. Layla Al-Harbi', emailLocal: 'layla.alharbi', position: 'Head of Ward', unit: 'MED-IM', reportsTo: 'faisal' },
  { key: 'omar', name: 'Dr. Omar Siddiqui', emailLocal: 'omar.siddiqui', position: 'Senior Specialist', unit: 'MED-IM', reportsTo: 'layla' },
  { key: 'nawaf', name: 'Dr. Nawaf Al-Shammari', emailLocal: 'nawaf.alshammari', position: 'Unit Head', unit: 'MED-IM-CAR', reportsTo: 'layla' },
  // EDGE CASE 4 — first of the duplicate-name pair.
  { key: 'mohammed-car', name: 'Mohammed Al-Otaibi', emailLocal: 'mohammed.alotaibi', position: 'Specialist', unit: 'MED-IM-CAR', reportsTo: 'nawaf' },
  { key: 'reem', name: 'Dr. Reem Al-Zahrani', emailLocal: 'reem.alzahrani', position: 'Unit Head', unit: 'MED-IM-END', reportsTo: 'layla' },
  { key: 'khalid', name: 'Dr. Khalid Bin Saleh', emailLocal: 'khalid.binsaleh', position: 'Head of Ward', unit: 'MED-CC', reportsTo: 'faisal' },
  { key: 'sara', name: 'Dr. Sara Al-Mutairi', emailLocal: 'sara.almutairi', position: 'Unit Head', unit: 'MED-CC-AIC', reportsTo: 'khalid' },
  // EDGE CASE 1 — Ziad heads the Neonatal ICU today and DEPARTS during
  // seeding, which is what creates the vacancy. He must exist and be active
  // first: invite() refuses to place non-head staff into a headless unit.
  { key: 'ziad', name: 'Dr. Ziad Al-Fahad', emailLocal: 'ziad.alfahad', position: 'Unit Head', unit: 'MED-CC-NIC', reportsTo: 'khalid' },
  // The staffer who REMAINS after Ziad leaves — the point of the case.
  // Reports to the parent ward's head, deliberately NOT to Ziad: deactivate()
  // leaves reports' managerId untouched, so reporting to him would dangle at
  // an INACTIVE user.
  { key: 'fatima', name: 'Fatima Al-Anazi', emailLocal: 'fatima.alanazi', position: 'Senior Specialist', unit: 'MED-CC-NIC', reportsTo: 'khalid' },
  { key: 'tariq', name: 'Dr. Tariq Al-Juhani', emailLocal: 'tariq.aljuhani', position: 'Head of Ward', unit: 'MED-SU', reportsTo: 'faisal' },
  { key: 'maha', name: 'Dr. Maha Al-Subaie', emailLocal: 'maha.alsubaie', position: 'Unit Head', unit: 'MED-SU-OT', reportsTo: 'tariq' },

  // Nursing Affairs
  { key: 'noura', name: 'Noura Al-Ghamdi', emailLocal: 'noura.alghamdi', position: 'Director', unit: 'NUR', reportsTo: 'hessa' },
  { key: 'aisha', name: 'Aisha Al-Balawi', emailLocal: 'aisha.albalawi', position: 'Head of Ward', unit: 'NUR-IP', reportsTo: 'noura' },
  { key: 'huda', name: 'Huda Al-Rashidi', emailLocal: 'huda.alrashidi', position: 'Unit Head', unit: 'NUR-IP-WN', reportsTo: 'aisha' },
  { key: 'mariam', name: 'Mariam Al-Suwaidi', emailLocal: 'mariam.alsuwaidi', position: 'Head of Ward', unit: 'NUR-OP', reportsTo: 'noura' },

  // Quality & Patient Safety — yasser is the tenant admin and the Quality
  // Manager persona structural item 5 has been waiting to test against.
  { key: 'yasser', name: 'Dr. Yasser Al-Amri', emailLocal: 'yasser.alamri', position: 'Director', unit: 'QPS', reportsTo: 'hessa' },
  { key: 'haya', name: 'Haya Al-Marri', emailLocal: 'haya.almarri', position: 'Head of Section', unit: 'QPS-ACC', reportsTo: 'yasser' },
  { key: 'salem', name: 'Salem Al-Hajri', emailLocal: 'salem.alhajri', position: 'Head of Section', unit: 'QPS-IC', reportsTo: 'yasser' },

  // Clinical Support Services
  { key: 'nasser', name: 'Nasser Al-Qassimi', emailLocal: 'nasser.alqassimi', position: 'Director', unit: 'CSS', reportsTo: 'hessa' },
  // EDGE CASE 3 — current head, handing over to Yousef.
  { key: 'amal', name: 'Amal Al-Ghamdi', emailLocal: 'amal.alghamdi', position: 'Head of Section', unit: 'CSS-PHR', reportsTo: 'nasser' },
  { key: 'yousef', name: 'Yousef Bin Tariq', emailLocal: 'yousef.bintariq', position: 'Senior Specialist', unit: 'CSS-PHR', reportsTo: 'amal' },
  // EDGE CASE 4 — second of the duplicate-name pair. Different department,
  // different position, different email; identical name.
  { key: 'mohammed-lab', name: 'Mohammed Al-Otaibi', emailLocal: 'm.alotaibi', position: 'Head of Section', unit: 'CSS-LAB', reportsTo: 'nasser' },
  { key: 'ibrahim', name: 'Ibrahim Al-Dakhil', emailLocal: 'ibrahim.aldakhil', position: 'Unit Head', unit: 'CSS-MIC', reportsTo: 'mohammed-lab' },
];

// ── Committees ───────────────────────────────────────────────────────────────
// Types and member roles reference real SYSTEM lookup keys, never invented
// ones. Infection Control reports to Quality & Patient Safety, giving one real
// committee hierarchy — which is the only structural relationship the schema
// can express, since Committee has no orgUnitId (ACC-62 PD #3 / ACC-63).
const COMMITTEES = [
  {
    key: 'qps-committee',
    nameEn: 'Quality & Patient Safety Committee',
    nameAr: 'لجنة الجودة وسلامة المرضى',
    type: 'quality_committee',
    purpose: 'Oversees the hospital-wide quality management system, accreditation readiness, and patient safety incident review.',
    quorumCount: 3,
    meetingFrequency: 'MONTHLY',
    members: [
      { person: 'yasser', role: 'chairman' },
      { person: 'haya', role: 'secretary' },
      { person: 'layla', role: 'member' },
      { person: 'noura', role: 'member' },
      { person: 'khalid', role: 'member' },
    ],
  },
  {
    key: 'infection-control',
    nameEn: 'Infection Control Committee',
    nameAr: 'لجنة مكافحة العدوى',
    type: 'safety_committee',
    purpose: 'Monitors healthcare-associated infection rates and approves prevention protocols across all clinical areas.',
    quorumCount: 3,
    meetingFrequency: 'MONTHLY',
    reportsToCommittee: 'qps-committee',
    members: [
      { person: 'salem', role: 'chairman' },
      { person: 'huda', role: 'secretary' },
      { person: 'sara', role: 'member' },
      { person: 'mohammed-lab', role: 'member' },
    ],
  },
  {
    key: 'pharmacy-therapeutics',
    nameEn: 'Pharmacy & Therapeutics Committee',
    nameAr: 'لجنة الصيدلة والعلاجيات',
    type: 'clinical_committee',
    purpose: 'Maintains the hospital formulary and reviews medication safety events.',
    quorumCount: 2,
    meetingFrequency: 'QUARTERLY',
    members: [
      { person: 'amal', role: 'chairman' },
      { person: 'yousef', role: 'secretary' },
      { person: 'faisal', role: 'member' },
      { person: 'reem', role: 'advisor' },
    ],
  },
];

export const HOSPITAL_FIXTURE: TenantFixture = {
  slug: 'al-nakheel',
  name: 'Al Nakheel Specialist Hospital',
  country: 'SA',
  emailDomain: 'alnakheel-hospital.test',
  adminKey: 'hessa',

  // ACC-62 PD #4 (approved) — 'ward' is not among the 6 SYSTEM org_unit_type
  // values. Nothing validates OrgUnit.type and that lookup category has zero
  // consumers today, so this is about internal consistency for whenever it
  // does get wired up, not about passing a check.
  orgUnitTypes: [{ key: 'ward', labelEn: 'Ward', labelAr: 'جناح' }],

  positions: POSITIONS,
  tree: TREE,
  people: PEOPLE,
  committees: COMMITTEES,

  edgeCases: {
    // Neonatal ICU. Dr. Ziad Al-Fahad heads it, then departs — the seed
    // deactivates him, and deactivate() calls refreshOrgUnitHeadVacancy()
    // itself, so the vacancy is produced by the real mechanism rather than
    // written by hand. Fatima Al-Anazi remains as a Senior Specialist, which
    // confers no headship. Its parent ward MED-CC has Dr. Khalid Bin Saleh, so
    // resolveActingHeadForOrgUnit() walks up one level and resolves: a PARTIAL
    // vacancy — isHeadVacant true, isHeadFullyUnresolved false, silent.
    vacantHeadUnit: { unit: 'MED-CC-NIC', departingHead: 'ziad' },

    // Layla heads Internal Medicine and has a real subtree beneath her, so her
    // absence is consequential — applyOutOfOfficeRouting() substitutes Omar
    // wherever she would otherwise be assigned or gated. Omar is in the same
    // ward, which is what real coverage looks like. Days, not dates: the
    // applier computes them relative to seed time so the window always spans
    // today.
    outOfOffice: { person: 'layla', covering: 'omar', startsDaysAgo: 3, endsInDays: 11 },

    // Pharmacy Section, Amal -> Yousef, effective in 14 days. The future date
    // is load-bearing: sweepDueHandovers() completes any handover dated <= now,
    // so a past or present date would be swept within 15 minutes and this case
    // would silently disappear.
    handover: { unit: 'CSS-PHR', from: 'amal', to: 'yousef', effectiveInDays: 14 },

    // Two Mohammed Al-Otaibis: a Specialist in Cardiology and the Head of the
    // Laboratory Section. ACC-37 added org-unit display to every user picker
    // precisely so people could be told apart, and that fix has never had data
    // that actually exercises it.
    duplicateNames: [{ people: ['mohammed-car', 'mohammed-lab'] }],
  },
};
