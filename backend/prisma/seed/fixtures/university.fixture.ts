// ACC-62 — Tenant B: Al Manara University.
//
// The name is FICTIONAL, chosen to be plausible for the GCC market without
// implying a real institution.
//
// Deliberately mirrors the hospital fixture's SHAPE while sharing none of its
// vocabulary: Faculties -> Schools -> Programs rather than Departments ->
// Wards -> Units, and its own head-conferring titles. That is the point of
// having two tenants — it proves nothing in the seeding machinery is
// hospital-specific.
import { TenantFixture } from './fixture.types';

// ── Head-conferring positions ────────────────────────────────────────────────
// Same reasoning as the hospital's (ACC-62 PD #2): only 'Director' ships with
// isUnitHeadPosition, so without these a Rector, a Dean and a Programme
// Director would all hold the identical title.
//
// 'Head of Office' exists for the same reason the hospital needed 'Head of
// Section': the Deanship's offices are real units that need real heads, and
// no shipped position fits at that level — 'Director' (grade 10) is far too
// senior for an office reporting into a deanship.
const POSITIONS = [
  { nameEn: 'Rector', nameAr: 'مدير الجامعة', grade: 12, isUnitHeadPosition: true, isSingleAssignee: true },
  { nameEn: 'Dean', nameAr: 'عميد', grade: 11, isUnitHeadPosition: true, isSingleAssignee: true },
  { nameEn: 'Head of School', nameAr: 'رئيس مدرسة', grade: 8, isUnitHeadPosition: true, isSingleAssignee: true },
  { nameEn: 'Head of Office', nameAr: 'رئيس مكتب', grade: 7, isUnitHeadPosition: true, isSingleAssignee: true },
  { nameEn: 'Programme Director', nameAr: 'مدير برنامج', grade: 6, isUnitHeadPosition: true, isSingleAssignee: true },
];

// ── Org tree ─────────────────────────────────────────────────────────────────
// Four codes are shortened from the plan's originals for the same reason the
// hospital's were: CreateOrgUnitDto caps `code` at 10 characters, and
// ENG-CIV-BSC / ENG-CIV-MSC / BUS-MGT-BBA were all 11. They are CIV-BSC,
// CIV-MSC and MGT-BBA here. ENG-CMP-CS and HS-NUR-BSN are exactly 10 and fit
// unchanged.
const TREE = {
  key: 'MANARA',
  nameEn: 'Al Manara University',
  nameAr: 'جامعة المنارة',
  type: 'administration',
  children: [
    {
      key: 'ENG',
      nameEn: 'Faculty of Engineering',
      nameAr: 'كلية الهندسة',
      type: 'faculty',
      children: [
        {
          key: 'ENG-CIV',
          nameEn: 'School of Civil & Environmental Engineering',
          nameAr: 'مدرسة الهندسة المدنية والبيئية',
          type: 'school',
          children: [
            { key: 'CIV-BSC', nameEn: 'BSc Civil Engineering', nameAr: 'بكالوريوس الهندسة المدنية', type: 'program' },
            { key: 'CIV-MSC', nameEn: 'MSc Environmental Engineering', nameAr: 'ماجستير الهندسة البيئية', type: 'program' },
          ],
        },
        {
          key: 'ENG-CMP',
          nameEn: 'School of Computing',
          nameAr: 'مدرسة الحوسبة',
          type: 'school',
          children: [
            { key: 'ENG-CMP-CS', nameEn: 'BSc Computer Science', nameAr: 'بكالوريوس علوم الحاسب', type: 'program' },
            { key: 'ENG-CMP-SE', nameEn: 'BSc Software Engineering', nameAr: 'بكالوريوس هندسة البرمجيات', type: 'program' },
          ],
        },
      ],
    },
    {
      key: 'HS',
      nameEn: 'Faculty of Health Sciences',
      nameAr: 'كلية العلوم الصحية',
      type: 'faculty',
      children: [
        {
          key: 'HS-NUR',
          nameEn: 'School of Nursing',
          nameAr: 'مدرسة التمريض',
          type: 'school',
          children: [
            { key: 'HS-NUR-BSN', nameEn: 'BSc Nursing', nameAr: 'بكالوريوس التمريض', type: 'program' },
          ],
        },
        {
          key: 'HS-PHA',
          nameEn: 'School of Pharmacy',
          nameAr: 'مدرسة الصيدلة',
          type: 'school',
          children: [
            { key: 'HS-PHA-PD', nameEn: 'PharmD Program', nameAr: 'برنامج دكتور صيدلة', type: 'program' },
          ],
        },
      ],
    },
    {
      key: 'BUS',
      nameEn: 'Faculty of Business',
      nameAr: 'كلية إدارة الأعمال',
      type: 'faculty',
      children: [
        {
          key: 'BUS-MGT',
          nameEn: 'School of Management',
          nameAr: 'مدرسة الإدارة',
          type: 'school',
          children: [
            { key: 'MGT-BBA', nameEn: 'BBA Program', nameAr: 'برنامج بكالوريوس إدارة الأعمال', type: 'program' },
          ],
        },
      ],
    },
    {
      key: 'DQA',
      nameEn: 'Deanship of Quality & Accreditation',
      nameAr: 'عمادة الجودة والاعتماد',
      type: 'deanship',
      children: [
        { key: 'DQA-ACC', nameEn: 'Accreditation Office', nameAr: 'مكتب الاعتماد', type: 'office' },
        // EDGE CASE 1 — deliberately has staff but no head-position holder.
        { key: 'DQA-IE', nameEn: 'Institutional Effectiveness Office', nameAr: 'مكتب الفاعلية المؤسسية', type: 'office' },
      ],
    },
  ],
};

// ── People ───────────────────────────────────────────────────────────────────
// 20 people. As in the hospital fixture, every unit has a head-position holder
// EXCEPT the one declared vacancy (DQA-IE) — so the seeded vacancy is the only
// one in the tenant rather than one of several accidents.
const PEOPLE = [
  { key: 'adel', name: 'Prof. Adel Al-Mansoori', emailLocal: 'adel.almansoori', position: 'Rector', unit: 'MANARA', reportsTo: null },

  // Faculty of Engineering
  { key: 'huda', name: 'Prof. Huda Al-Blooshi', emailLocal: 'huda.alblooshi', position: 'Dean', unit: 'ENG', reportsTo: 'adel' },
  { key: 'rashid', name: 'Dr. Rashid Al-Nuaimi', emailLocal: 'rashid.alnuaimi', position: 'Head of School', unit: 'ENG-CIV', reportsTo: 'huda' },
  { key: 'latifa', name: 'Dr. Latifa Al-Kaabi', emailLocal: 'latifa.alkaabi', position: 'Programme Director', unit: 'CIV-BSC', reportsTo: 'rashid' },
  { key: 'saeed', name: 'Dr. Saeed Al-Hammadi', emailLocal: 'saeed.alhammadi', position: 'Programme Director', unit: 'CIV-MSC', reportsTo: 'rashid' },
  { key: 'mariam', name: 'Dr. Mariam Al-Shamsi', emailLocal: 'mariam.alshamsi', position: 'Head of School', unit: 'ENG-CMP', reportsTo: 'huda' },
  { key: 'hamad', name: 'Dr. Hamad Al-Zaabi', emailLocal: 'hamad.alzaabi', position: 'Programme Director', unit: 'ENG-CMP-CS', reportsTo: 'mariam' },
  { key: 'aliya', name: 'Aliya Al-Suwaidi', emailLocal: 'aliya.alsuwaidi', position: 'Senior Specialist', unit: 'ENG-CMP-CS', reportsTo: 'hamad' },
  // EDGE CASE 4 — first of the duplicate-name pair.
  { key: 'noor-se', name: 'Dr. Noor Abdullah', emailLocal: 'noor.abdullah', position: 'Programme Director', unit: 'ENG-CMP-SE', reportsTo: 'mariam' },

  // Faculty of Health Sciences — EDGE CASE 2 lives here.
  { key: 'salma', name: 'Prof. Salma Al-Falasi', emailLocal: 'salma.alfalasi', position: 'Dean', unit: 'HS', reportsTo: 'adel' },
  { key: 'khalifa', name: 'Dr. Khalifa Al-Muhairi', emailLocal: 'khalifa.almuhairi', position: 'Head of School', unit: 'HS-NUR', reportsTo: 'salma' },
  { key: 'amna', name: 'Dr. Amna Al-Qubaisi', emailLocal: 'amna.alqubaisi', position: 'Programme Director', unit: 'HS-NUR-BSN', reportsTo: 'khalifa' },
  { key: 'jassim', name: 'Dr. Jassim Al-Ali', emailLocal: 'jassim.alali', position: 'Head of School', unit: 'HS-PHA', reportsTo: 'salma' },
  // EDGE CASE 4 — second of the pair. Different faculty entirely.
  { key: 'noor-pd', name: 'Dr. Noor Abdullah', emailLocal: 'n.abdullah', position: 'Programme Director', unit: 'HS-PHA-PD', reportsTo: 'jassim' },

  // Faculty of Business — EDGE CASE 3 lives here.
  { key: 'badr', name: 'Prof. Badr Al-Marzooqi', emailLocal: 'badr.almarzooqi', position: 'Dean', unit: 'BUS', reportsTo: 'adel' },
  { key: 'shaikha', name: 'Dr. Shaikha Al-Rumaithi', emailLocal: 'shaikha.alrumaithi', position: 'Head of School', unit: 'BUS-MGT', reportsTo: 'badr' },
  { key: 'omar', name: 'Dr. Omar Al-Hosani', emailLocal: 'omar.alhosani', position: 'Programme Director', unit: 'MGT-BBA', reportsTo: 'shaikha' },

  // Deanship of Quality & Accreditation — hind is the tenant admin.
  { key: 'hind', name: 'Dr. Hind Al-Dhaheri', emailLocal: 'hind.aldhaheri', position: 'Director', unit: 'DQA', reportsTo: 'adel' },
  { key: 'maitha', name: 'Maitha Al-Ameri', emailLocal: 'maitha.alameri', position: 'Head of Office', unit: 'DQA-ACC', reportsTo: 'hind' },
  // EDGE CASE 1 — Rana heads Institutional Effectiveness today and DEPARTS
  // during seeding, which is what creates the vacancy.
  { key: 'rana', name: 'Dr. Rana Al-Zaabi', emailLocal: 'rana.alzaabi', position: 'Head of Office', unit: 'DQA-IE', reportsTo: 'hind' },
  // The staffer who REMAINS. Reports to the parent deanship's director, not
  // to Rana, so nothing dangles at an INACTIVE user after her departure.
  { key: 'sultan', name: 'Sultan Al-Junaibi', emailLocal: 'sultan.aljunaibi', position: 'Senior Specialist', unit: 'DQA-IE', reportsTo: 'hind' },
];

// ── Committees ───────────────────────────────────────────────────────────────
const COMMITTEES = [
  {
    key: 'quality-assurance',
    nameEn: 'Quality Assurance Committee',
    nameAr: 'لجنة ضمان الجودة',
    type: 'quality_committee',
    purpose: 'Oversees institutional quality assurance, programme accreditation readiness, and the annual self-study cycle.',
    quorumCount: 3,
    meetingFrequency: 'MONTHLY',
    members: [
      { person: 'hind', role: 'chairman' },
      { person: 'maitha', role: 'secretary' },
      { person: 'huda', role: 'member' },
      { person: 'salma', role: 'member' },
      { person: 'badr', role: 'member' },
    ],
  },
  {
    key: 'academic-standards',
    nameEn: 'Academic Standards Committee',
    nameAr: 'لجنة المعايير الأكاديمية',
    type: 'advisory_committee',
    purpose: 'Reviews programme learning outcomes, assessment standards, and curriculum change proposals.',
    quorumCount: 3,
    meetingFrequency: 'QUARTERLY',
    reportsToCommittee: 'quality-assurance',
    members: [
      { person: 'salma', role: 'chairman' },
      { person: 'sultan', role: 'secretary' },
      { person: 'rashid', role: 'member' },
      { person: 'mariam', role: 'member' },
    ],
  },
  {
    key: 'campus-safety',
    nameEn: 'Campus Health & Safety Committee',
    nameAr: 'لجنة الصحة والسلامة بالحرم الجامعي',
    type: 'safety_committee',
    purpose: 'Monitors laboratory and campus safety compliance, and reviews reported incidents.',
    quorumCount: 2,
    meetingFrequency: 'QUARTERLY',
    members: [
      { person: 'khalifa', role: 'chairman' },
      { person: 'amna', role: 'secretary' },
      { person: 'omar', role: 'member' },
      { person: 'aliya', role: 'observer' },
    ],
  },
];

export const UNIVERSITY_FIXTURE: TenantFixture = {
  slug: 'al-manara',
  name: 'Al Manara University',
  country: 'AE',
  emailDomain: 'almanara-univ.test',
  adminKey: 'adel',

  // ACC-62 PD #4 (approved). 'office' is already a SYSTEM value, so only the
  // four genuinely new ones are added.
  orgUnitTypes: [
    { key: 'faculty', labelEn: 'Faculty', labelAr: 'كلية' },
    { key: 'school', labelEn: 'School', labelAr: 'مدرسة' },
    { key: 'program', labelEn: 'Program', labelAr: 'برنامج' },
    { key: 'deanship', labelEn: 'Deanship', labelAr: 'عمادة' },
  ],

  positions: POSITIONS,
  tree: TREE,
  people: PEOPLE,
  committees: COMMITTEES,

  // All four cases are seeded in BOTH tenants, not split between them. The
  // plan originally put out-of-office and handover only in the hospital; doing
  // both here as well proves the mechanisms are not hospital-specific — the
  // same reasoning that already applied to the duplicate-name case — and costs
  // nothing, since the states are ordinary data.
  edgeCases: {
    // Institutional Effectiveness Office. Dr. Rana Al-Zaabi heads it, then
    // departs; Sultan Al-Junaibi remains as a Senior Specialist, which confers
    // no headship. Parent DQA has Dr. Hind Al-Dhaheri, so the walk-up resolves
    // one level up — a PARTIAL vacancy, flagged and silent.
    vacantHeadUnit: { unit: 'DQA-IE', departingHead: 'rana' },

    // A Dean out of office, covered by one of her own Heads of School. Salma
    // has two schools and their programmes beneath her, so her absence has
    // real reach.
    outOfOffice: { person: 'salma', covering: 'khalifa', startsDaysAgo: 5, endsInDays: 9 },

    // School of Management: Shaikha hands over to Omar, currently the
    // Programme Director beneath her — an ordinary internal promotion.
    // Future-dated for the same reason as the hospital's: sweepDueHandovers()
    // would otherwise complete it within 15 minutes and the case would vanish.
    // 21 days rather than the hospital's 14, so the two tenants do not both
    // expire on the same day.
    handover: { unit: 'BUS-MGT', from: 'shaikha', to: 'omar', effectiveInDays: 21 },

    // Two Dr. Noor Abdullahs, in different faculties entirely — Software
    // Engineering and Pharmacy. Deliberately a second, independent instance of
    // the hospital's duplicate-name case, so it cannot be dismissed as an
    // artefact of one tenant's data.
    duplicateNames: [{ people: ['noor-se', 'noor-pd'] }],
  },
};
