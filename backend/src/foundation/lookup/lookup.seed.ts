export interface SeedValue {
  key: string;
  labelEn: string;
  labelAr: string;
  sortOrder: number;
  attributes?: Record<string, unknown>;
}

export interface SeedCategory {
  key: string;
  labelEn: string;
  labelAr: string;
  isExtensible: boolean;
  attributeSchema?: Record<string, unknown>;
  sortOrder: number;
  values: SeedValue[];
}

export const SYSTEM_LOOKUP_SEED: SeedCategory[] = [
  // ── 1. Committee Type ───────────────────────────────────────────────────────
  {
    key: 'committee_type',
    labelEn: 'Committee Type',
    labelAr: 'نوع اللجنة',
    isExtensible: true,
    sortOrder: 10,
    values: [
      { key: 'quality_committee',  labelEn: 'Quality Committee',  labelAr: 'لجنة الجودة',        sortOrder: 10 },
      { key: 'safety_committee',   labelEn: 'Safety Committee',   labelAr: 'لجنة السلامة',       sortOrder: 20 },
      { key: 'executive_board',    labelEn: 'Executive Board',    labelAr: 'مجلس الإدارة',       sortOrder: 30 },
      { key: 'clinical_committee', labelEn: 'Clinical Committee', labelAr: 'اللجنة السريرية',    sortOrder: 40 },
      { key: 'advisory_committee', labelEn: 'Advisory Committee', labelAr: 'اللجنة الاستشارية', sortOrder: 50 },
    ],
  },

  // ── 2. Committee Member Role ─────────────────────────────────────────────────
  {
    key: 'committee_member_role',
    labelEn: 'Committee Member Role',
    labelAr: 'دور عضو اللجنة',
    isExtensible: true,
    sortOrder: 20,
    values: [
      { key: 'chairman',      labelEn: 'Chairman',      labelAr: 'رئيس اللجنة', sortOrder: 10 },
      { key: 'vice_chairman', labelEn: 'Vice Chairman', labelAr: 'نائب الرئيس', sortOrder: 20 },
      { key: 'secretary',     labelEn: 'Secretary',     labelAr: 'أمين السر',   sortOrder: 30 },
      { key: 'member',        labelEn: 'Member',        labelAr: 'عضو',         sortOrder: 40 },
      { key: 'observer',      labelEn: 'Observer',      labelAr: 'مراقب',       sortOrder: 50 },
      { key: 'advisor',       labelEn: 'Advisor',       labelAr: 'مستشار',      sortOrder: 60 },
    ],
  },

  // ── 3. Document Type ─────────────────────────────────────────────────────────
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
      { key: 'policy',    labelEn: 'Policy',    labelAr: 'سياسة',        sortOrder: 10, attributes: { numberingPrefix: 'POL', requiresFlowchart: false, defaultReviewCycleMonths: 24, requiresCommitteeApproval: true,  defaultRetentionYears: 10 } },
      { key: 'procedure', labelEn: 'Procedure', labelAr: 'إجراء',        sortOrder: 20, attributes: { numberingPrefix: 'PRO', requiresFlowchart: true,  defaultReviewCycleMonths: 12, requiresCommitteeApproval: false, defaultRetentionYears: 10 } },
      { key: 'form',      labelEn: 'Form',      labelAr: 'نموذج',        sortOrder: 30, attributes: { numberingPrefix: 'FRM', requiresFlowchart: false, defaultReviewCycleMonths: 12, requiresCommitteeApproval: false, defaultRetentionYears: 5  } },
      { key: 'plan',      labelEn: 'Plan',      labelAr: 'خطة',          sortOrder: 40, attributes: { numberingPrefix: 'PLN', requiresFlowchart: false, defaultReviewCycleMonths: 12, requiresCommitteeApproval: true,  defaultRetentionYears: 10 } },
      { key: 'manual',    labelEn: 'Manual',    labelAr: 'دليل',         sortOrder: 50, attributes: { numberingPrefix: 'MAN', requiresFlowchart: false, defaultReviewCycleMonths: 36, requiresCommitteeApproval: true,  defaultRetentionYears: 10 } },
      { key: 'guideline', labelEn: 'Guideline', labelAr: 'إرشادات',      sortOrder: 60, attributes: { numberingPrefix: 'GDL', requiresFlowchart: false, defaultReviewCycleMonths: 24, requiresCommitteeApproval: false, defaultRetentionYears: 5  } },
      { key: 'checklist', labelEn: 'Checklist', labelAr: 'قائمة مراجعة', sortOrder: 70, attributes: { numberingPrefix: 'CHL', requiresFlowchart: false, defaultReviewCycleMonths: 12, requiresCommitteeApproval: false, defaultRetentionYears: 5  } },
      { key: 'platform',        labelEn: 'Platform',        labelAr: 'إطار عمل',        sortOrder: 80, attributes: { numberingPrefix: 'PLT', requiresFlowchart: false, defaultReviewCycleMonths: 24, requiresCommitteeApproval: true,  defaultRetentionYears: 10 } },
      { key: 'job_description', labelEn: 'Job Description', labelAr: 'الوصف الوظيفي', sortOrder: 90, attributes: { numberingPrefix: 'JD',  requiresFlowchart: false, defaultReviewCycleMonths: 24, requiresCommitteeApproval: false, defaultRetentionYears: 10 } },
      { key: 'terms_of_reference', labelEn: 'Terms of Reference', labelAr: 'النظام الداخلي', sortOrder: 100, attributes: { numberingPrefix: 'TOR', requiresFlowchart: false, defaultReviewCycleMonths: 12, requiresCommitteeApproval: true, defaultRetentionYears: 10 } },
    ],
  },

  // ── 4. Document Section Type ─────────────────────────────────────────────────
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

  // ── 5. Incident Type ─────────────────────────────────────────────────────────
  {
    key: 'incident_type',
    labelEn: 'Incident Type',
    labelAr: 'نوع الحادثة',
    isExtensible: true,
    sortOrder: 50,
    values: [
      { key: 'operational',   labelEn: 'Operational',            labelAr: 'تشغيلية',          sortOrder: 10 },
      { key: 'safety',        labelEn: 'Safety',                 labelAr: 'سلامة',            sortOrder: 20 },
      { key: 'environmental', labelEn: 'Environmental',          labelAr: 'بيئية',            sortOrder: 30 },
      { key: 'security',      labelEn: 'Security',               labelAr: 'أمنية',            sortOrder: 40 },
      { key: 'financial',     labelEn: 'Financial',              labelAr: 'مالية',            sortOrder: 50 },
      { key: 'hr',            labelEn: 'Human Resources',        labelAr: 'موارد بشرية',      sortOrder: 60 },
      { key: 'it',            labelEn: 'Information Technology', labelAr: 'تقنية المعلومات',  sortOrder: 70 },
    ],
  },

  // ── 6. Incident Severity (non-extensible) ────────────────────────────────────
  {
    key: 'incident_severity',
    labelEn: 'Incident Severity',
    labelAr: 'خطورة الحادثة',
    isExtensible: false,
    sortOrder: 60,
    values: [
      { key: 'critical', labelEn: 'Critical', labelAr: 'حرجة',   sortOrder: 10 },
      { key: 'high',     labelEn: 'High',     labelAr: 'عالية',  sortOrder: 20 },
      { key: 'medium',   labelEn: 'Medium',   labelAr: 'متوسطة', sortOrder: 30 },
      { key: 'low',      labelEn: 'Low',      labelAr: 'منخفضة', sortOrder: 40 },
    ],
  },

  // ── 7. Audit Type ────────────────────────────────────────────────────────────
  {
    key: 'audit_type',
    labelEn: 'Audit Type',
    labelAr: 'نوع المراجعة',
    isExtensible: true,
    sortOrder: 70,
    values: [
      { key: 'internal',        labelEn: 'Internal',         labelAr: 'داخلية',        sortOrder: 10 },
      { key: 'external',        labelEn: 'External',         labelAr: 'خارجية',        sortOrder: 20 },
      { key: 'surveillance',    labelEn: 'Surveillance',     labelAr: 'مراقبة',        sortOrder: 30 },
      { key: 'follow_up',       labelEn: 'Follow-up',        labelAr: 'متابعة',        sortOrder: 40 },
      { key: 'certification',   labelEn: 'Certification',    labelAr: 'اعتماد',        sortOrder: 50 },
      { key: 'recertification', labelEn: 'Re-certification', labelAr: 'إعادة اعتماد', sortOrder: 60 },
    ],
  },

  // ── 8. Corrective Action Type ────────────────────────────────────────────────
  {
    key: 'corrective_action_type',
    labelEn: 'Corrective Action Type',
    labelAr: 'نوع الإجراء التصحيحي',
    isExtensible: true,
    sortOrder: 80,
    values: [
      { key: 'immediate',  labelEn: 'Immediate',  labelAr: 'فوري',    sortOrder: 10 },
      { key: 'corrective', labelEn: 'Corrective', labelAr: 'تصحيحي', sortOrder: 20 },
      { key: 'preventive', labelEn: 'Preventive', labelAr: 'وقائي',  sortOrder: 30 },
      { key: 'systemic',   labelEn: 'Systemic',   labelAr: 'منهجي',  sortOrder: 40 },
    ],
  },

  // ── 9. Standard Body ─────────────────────────────────────────────────────────
  {
    key: 'standard_body',
    labelEn: 'Accreditation Standard Body',
    labelAr: 'هيئة معايير الاعتماد',
    isExtensible: true,
    sortOrder: 90,
    values: [
      { key: 'jci',       labelEn: 'JCI',                        labelAr: 'JCI',                  sortOrder: 10 },
      { key: 'cbahi',     labelEn: 'CBAHI',                      labelAr: 'CBAHI',                sortOrder: 20 },
      { key: 'iso_9001',  labelEn: 'ISO 9001',                   labelAr: 'ISO 9001',             sortOrder: 30 },
      { key: 'iso_14001', labelEn: 'ISO 14001',                  labelAr: 'ISO 14001',            sortOrder: 40 },
      { key: 'iso_45001', labelEn: 'ISO 45001',                  labelAr: 'ISO 45001',            sortOrder: 50 },
      { key: 'iso_27001', labelEn: 'ISO 27001',                  labelAr: 'ISO 27001',            sortOrder: 55 },
      { key: 'abet',      labelEn: 'ABET',                       labelAr: 'ABET',                 sortOrder: 60 },
      { key: 'cap',       labelEn: 'CAP',                        labelAr: 'CAP',                  sortOrder: 70 },
      { key: 'moh',       labelEn: 'Ministry of Health (local)', labelAr: 'وزارة الصحة (محلي)',   sortOrder: 80 },
    ],
  },

  // ── 10. Gap Category ─────────────────────────────────────────────────────────
  {
    key: 'gap_category',
    labelEn: 'Gap Category',
    labelAr: 'فئة الفجوة',
    isExtensible: true,
    sortOrder: 100,
    values: [
      { key: 'process',       labelEn: 'Process',       labelAr: 'العملية',  sortOrder: 10 },
      { key: 'people',        labelEn: 'People',        labelAr: 'الأشخاص', sortOrder: 20 },
      { key: 'technology',    labelEn: 'Technology',    labelAr: 'التقنية',  sortOrder: 30 },
      { key: 'environment',   labelEn: 'Environment',   labelAr: 'البيئة',   sortOrder: 40 },
      { key: 'documentation', labelEn: 'Documentation', labelAr: 'التوثيق', sortOrder: 50 },
      { key: 'resources',     labelEn: 'Resources',     labelAr: 'الموارد',  sortOrder: 60 },
    ],
  },

  // ── 11. Meeting Type ─────────────────────────────────────────────────────────
  {
    key: 'meeting_type',
    labelEn: 'Meeting Type',
    labelAr: 'نوع الاجتماع',
    isExtensible: true,
    sortOrder: 110,
    values: [
      { key: 'regular',       labelEn: 'Regular',       labelAr: 'اجتماع دوري',     sortOrder: 10 },
      { key: 'extraordinary', labelEn: 'Extraordinary', labelAr: 'اجتماع طارئ',     sortOrder: 20 },
      { key: 'emergency',     labelEn: 'Emergency',     labelAr: 'اجتماع استثنائي', sortOrder: 30 },
      { key: 'planning',      labelEn: 'Planning',      labelAr: 'اجتماع تخطيط',    sortOrder: 40 },
      { key: 'review',        labelEn: 'Review',        labelAr: 'اجتماع مراجعة',   sortOrder: 50 },
    ],
  },

  // ── 12. Org Unit Type ────────────────────────────────────────────────────────
  {
    key: 'org_unit_type',
    labelEn: 'Organization Unit Type',
    labelAr: 'نوع الوحدة التنظيمية',
    isExtensible: true,
    sortOrder: 120,
    values: [
      { key: 'department',     labelEn: 'Department',     labelAr: 'قسم',    sortOrder: 10 },
      { key: 'division',       labelEn: 'Division',       labelAr: 'إدارة',  sortOrder: 20 },
      { key: 'unit',           labelEn: 'Unit',           labelAr: 'وحدة',   sortOrder: 30 },
      { key: 'section',        labelEn: 'Section',        labelAr: 'شعبة',   sortOrder: 40 },
      { key: 'administration', labelEn: 'Administration', labelAr: 'مديرية', sortOrder: 50 },
      { key: 'office',         labelEn: 'Office',         labelAr: 'مكتب',   sortOrder: 60 },
    ],
  },
];
