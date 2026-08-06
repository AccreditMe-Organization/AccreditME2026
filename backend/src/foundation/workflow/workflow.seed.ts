// System default workflow templates seeded per tenant on bootstrap, after
// seedSystemRoles() has run for that tenant (see TenantService.bootstrap()).
// Role keys below are resolved to that tenant's actual Role.id values at
// seed time by WorkflowTemplateService.seedDefaultWorkflows() — the same
// "seed with a stable string, resolve to a real ID at seed time" pattern
// already used by RoleService.seedSystemRoles() for permission strings.

export interface SeedAction {
  actionType:
    | 'CREATE_TASK'
    | 'SEND_NOTIFICATION'
    | 'GENERATE_PDF'
    | 'LOCK_DOCUMENT'
    | 'LOG_AUDIT'
    | 'WEBHOOK';
  order: number;
  configJson?: Record<string, unknown>;
}

export interface SeedTransition {
  fromStageKey: string;
  toStageKey: string;
  labelEn: string;
  labelAr: string;
  triggerCondition: 'SPECIFIC_USER' | 'ROLE_BASED' | 'ANY_AUTHENTICATED' | 'SYSTEM_AUTOMATIC';
  triggerRoleKey?: string; // resolved to Role.id at seed time
  requiredPermission?: string;
  validatorConfig?: Record<string, unknown>;
  // Only meaningful when the fromStage's approvalMode is PARALLEL/SEQUENTIAL/
  // COMMITTEE — marks which outgoing transition submitApproval() fires once
  // the stage's threshold is satisfied. Defaults to false (schema default).
  isApprovalPath?: boolean;
  actions: SeedAction[];
}

export interface SeedStage {
  key: string; // stable key within this template only — wires transitions below
  nameEn: string;
  nameAr: string;
  order: number;
  slaWorkingHours?: number;
  isInitial: boolean;
  isFinal: boolean;
  approvalMode: 'SINGLE' | 'SEQUENTIAL' | 'PARALLEL' | 'COMMITTEE';
  parallelThreshold?: 'ALL' | 'MAJORITY' | 'ANY';
  assigneeStrategy: 'SPECIFIC_USER' | 'ROLE' | 'ORG_UNIT_HEAD' | 'SELF' | 'COMMITTEE' | 'ROUND_ROBIN';
  assigneeRoleKey?: string; // resolved to Role.id at seed time
}

export interface SeedWorkflow {
  objectType:
    | 'DOCUMENT_REQUEST'
    | 'DOCUMENT'
    | 'CHANGE_REQUEST'
    | 'INCIDENT'
    | 'AUDIT'
    | 'CORRECTIVE_ACTION'
    | 'MEETING'
    | 'COMMITTEE';
  nameEn: string;
  nameAr: string;
  stages: SeedStage[];
  transitions: SeedTransition[];
}

// NOTE: The following requiredPermission strings are
// forward references — they do not yet exist in
// common/constants/permissions.ts and will be added
// when their respective modules are built:
//
//   capa:investigate, capa:approve, capa:close
//     → Step 18 (CAPA module)
//
//   incidents:manage
//     → Step 17 (Incident module — extend INCIDENTS_PERMISSIONS)
//
//   gaps:investigate, gaps:approve
//     → Step 18 (Gap module)
//
// All other permission strings in this file already
// exist in permissions.ts and are valid.

export const SYSTEM_WORKFLOW_SEED: SeedWorkflow[] = [
  // ── 1. DOCUMENT_REQUEST ──────────────────────────────────────────────────
  {
    objectType: 'DOCUMENT_REQUEST',
    nameEn: 'Document Request',
    nameAr: 'طلب وثيقة',
    stages: [
      { key: 'submitted', nameEn: 'Submitted', nameAr: 'مقدّم', order: 10, isInitial: true, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
      { key: 'unit_manager_review', nameEn: 'Unit Manager Review', nameAr: 'مراجعة مدير الوحدة', order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ORG_UNIT_HEAD', slaWorkingHours: 16 },
      { key: 'quality_review', nameEn: 'Quality Review', nameAr: 'مراجعة الجودة', order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'approved', nameEn: 'Approved', nameAr: 'مقبول', order: 40, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
      { key: 'rejected', nameEn: 'Rejected', nameAr: 'مرفوض', order: 50, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'submitted', toStageKey: 'unit_manager_review', labelEn: 'Submit Request', labelAr: 'تقديم الطلب', triggerCondition: 'ANY_AUTHENTICATED', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'unit_manager_review', toStageKey: 'quality_review', labelEn: 'Approve', labelAr: 'موافقة', triggerCondition: 'ROLE_BASED', requiredPermission: 'org:manage', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'unit_manager_review', toStageKey: 'rejected', labelEn: 'Reject', labelAr: 'رفض', triggerCondition: 'ROLE_BASED', requiredPermission: 'org:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'quality_review', toStageKey: 'approved', labelEn: 'Approve Request', labelAr: 'قبول الطلب', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:approve', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'quality_review', toStageKey: 'rejected', labelEn: 'Reject Request', labelAr: 'رفض الطلب', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:approve', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 2. DOCUMENT ───────────────────────────────────────────────────────────
  {
    objectType: 'DOCUMENT',
    nameEn: 'Document Lifecycle',
    nameAr: 'دورة حياة الوثيقة',
    stages: [
      { key: 'drafting', nameEn: 'Drafting', nameAr: 'مسودة', order: 10, isInitial: true, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
      { key: 'owners_review', nameEn: 'Owners Review', nameAr: 'مراجعة المُلاك', order: 20, isInitial: false, isFinal: false, approvalMode: 'PARALLEL', parallelThreshold: 'ALL', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 40 },
      { key: 'stakeholders_review', nameEn: 'Stakeholders Review', nameAr: 'مراجعة أصحاب المصلحة', order: 30, isInitial: false, isFinal: false, approvalMode: 'PARALLEL', parallelThreshold: 'ALL', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 40 },
      { key: 'final_approval', nameEn: 'Final Approval', nameAr: 'الموافقة النهائية', order: 40, isInitial: false, isFinal: false, approvalMode: 'PARALLEL', parallelThreshold: 'ALL', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 24 },
      { key: 'publish_approval', nameEn: 'Publish Approval', nameAr: 'موافقة النشر', order: 50, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'published', nameEn: 'Published', nameAr: 'منشورة', order: 60, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
      { key: 'obsolete', nameEn: 'Obsolete', nameAr: 'ملغاة', order: 70, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'drafting', toStageKey: 'owners_review', labelEn: 'Submit for Review', labelAr: 'إرسال للمراجعة', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:submit', validatorConfig: { requiredFields: ['title', 'content'] }, actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'owners_review', toStageKey: 'stakeholders_review', labelEn: 'Owners Approved', labelAr: 'موافقة المُلاك', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:review', isApprovalPath: true, actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'owners_review', toStageKey: 'drafting', labelEn: 'Return for Revision', labelAr: 'إعادة للتعديل', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:review', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'stakeholders_review', toStageKey: 'final_approval', labelEn: 'Stakeholders Approved', labelAr: 'موافقة أصحاب المصلحة', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:review', isApprovalPath: true, actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'stakeholders_review', toStageKey: 'drafting', labelEn: 'Return for Revision', labelAr: 'إعادة للتعديل', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:review', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'final_approval', toStageKey: 'publish_approval', labelEn: 'All Approved', labelAr: 'اعتماد جميع الأطراف', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:approve', isApprovalPath: true, actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'final_approval', toStageKey: 'drafting', labelEn: 'Return for Revision', labelAr: 'إعادة للتعديل', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:approve', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'publish_approval', toStageKey: 'published', labelEn: 'Publish', labelAr: 'نشر', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:publish', actions: [{ actionType: 'GENERATE_PDF', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'publish_approval', toStageKey: 'drafting', labelEn: 'Reject Publication', labelAr: 'رفض النشر', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:publish', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'published', toStageKey: 'obsolete', labelEn: 'Mark Obsolete', labelAr: 'إلغاء الوثيقة', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:manage_templates', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 3. INCIDENT ───────────────────────────────────────────────────────────
  {
    objectType: 'INCIDENT',
    nameEn: 'Incident Management',
    nameAr: 'إدارة الحوادث',
    stages: [
      { key: 'reported', nameEn: 'Reported', nameAr: 'مُبلَّغ', order: 10, isInitial: true, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 8 },
      { key: 'investigating', nameEn: 'Investigating', nameAr: 'قيد التحقيق', order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 40 },
      { key: 'root_cause_identified', nameEn: 'Root Cause Identified', nameAr: 'تحديد السبب الجذري', order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 16 },
      { key: 'closed', nameEn: 'Closed', nameAr: 'مغلق', order: 40, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
      { key: 'cancelled', nameEn: 'Cancelled', nameAr: 'ملغى', order: 50, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'reported', toStageKey: 'investigating', labelEn: 'Start Investigation', labelAr: 'بدء التحقيق', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'investigating', toStageKey: 'root_cause_identified', labelEn: 'Submit Root Cause', labelAr: 'تقديم السبب الجذري', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'investigating', toStageKey: 'closed', labelEn: 'Close — No RCA Needed', labelAr: 'إغلاق — لا يستلزم تحليل السبب الجذري', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:close', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'root_cause_identified', toStageKey: 'closed', labelEn: 'Close Incident', labelAr: 'إغلاق الحادثة', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:close', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'reported', toStageKey: 'cancelled', labelEn: 'Cancel Incident', labelAr: 'إلغاء الحادثة', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:manage', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'investigating', toStageKey: 'cancelled', labelEn: 'Cancel Incident', labelAr: 'إلغاء الحادثة', triggerCondition: 'ROLE_BASED', requiredPermission: 'incidents:manage', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
    ],
  },

  // ── 4. AUDIT ──────────────────────────────────────────────────────────────
  {
    objectType: 'AUDIT',
    nameEn: 'Audit Management',
    nameAr: 'إدارة المراجعات',
    stages: [
      { key: 'planning', nameEn: 'Planning', nameAr: 'التخطيط', order: 10, isInitial: true, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
      { key: 'announced', nameEn: 'Announced', nameAr: 'الإعلان', order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 40 },
      { key: 'fieldwork', nameEn: 'Fieldwork', nameAr: 'العمل الميداني', order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 40 },
      { key: 'findings_draft', nameEn: 'Findings Draft', nameAr: 'مسودة النتائج', order: 40, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 24 },
      { key: 'auditee_response', nameEn: 'Auditee Response', nameAr: 'رد المدقق عليه', order: 50, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 40 },
      { key: 'report_review', nameEn: 'Report Review', nameAr: 'مراجعة التقرير', order: 60, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'report_approved', nameEn: 'Report Approved', nameAr: 'اعتماد التقرير', order: 70, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'corrective_action', nameEn: 'Corrective Action', nameAr: 'الإجراء التصحيحي', order: 80, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 240 },
      { key: 'verification', nameEn: 'Verification', nameAr: 'التحقق', order: 90, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 240 },
      { key: 'closed', nameEn: 'Closed', nameAr: 'مغلق', order: 100, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'planning', toStageKey: 'announced', labelEn: 'Announce Audit', labelAr: 'الإعلان عن المراجعة', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:create', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'announced', toStageKey: 'fieldwork', labelEn: 'Begin Fieldwork', labelAr: 'بدء العمل الميداني', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:execute', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'fieldwork', toStageKey: 'findings_draft', labelEn: 'Complete Fieldwork', labelAr: 'إنهاء العمل الميداني', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:execute', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'findings_draft', toStageKey: 'auditee_response', labelEn: 'Send Findings', labelAr: 'إرسال النتائج', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:report', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'auditee_response', toStageKey: 'report_review', labelEn: 'Submit Response', labelAr: 'تقديم الرد', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:execute', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'auditee_response', toStageKey: 'findings_draft', labelEn: 'Dispute Findings', labelAr: 'الاعتراض على النتائج', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:execute', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'report_review', toStageKey: 'report_approved', labelEn: 'Finalize Report', labelAr: 'إنهاء التقرير', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:report', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'report_review', toStageKey: 'findings_draft', labelEn: 'Revise Findings', labelAr: 'مراجعة النتائج', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:report', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'report_approved', toStageKey: 'corrective_action', labelEn: 'Issue Report', labelAr: 'إصدار التقرير', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:close', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'corrective_action', toStageKey: 'verification', labelEn: 'Submit CAP', labelAr: 'تقديم خطة الإجراء التصحيحي', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:execute', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'verification', toStageKey: 'closed', labelEn: 'Close Audit', labelAr: 'إغلاق المراجعة', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:close', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'verification', toStageKey: 'corrective_action', labelEn: 'Return for Revision', labelAr: 'إعادة للمراجعة', triggerCondition: 'ROLE_BASED', requiredPermission: 'audits:execute', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 5. CORRECTIVE_ACTION ─────────────────────────────────────────────────
  {
    objectType: 'CORRECTIVE_ACTION',
    nameEn: 'Corrective Action',
    nameAr: 'الإجراء التصحيحي',
    stages: [
      { key: 'detection', nameEn: 'Detection', nameAr: 'الاكتشاف', order: 10, isInitial: true, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 8 },
      { key: 'investigation', nameEn: 'Investigation', nameAr: 'التحقيق', order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 40 },
      { key: 'root_cause_approved', nameEn: 'Root Cause Approved', nameAr: 'اعتماد السبب الجذري', order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'action_planning', nameEn: 'Action Planning', nameAr: 'تخطيط الإجراء', order: 40, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 24 },
      { key: 'plan_approved', nameEn: 'Plan Approved', nameAr: 'اعتماد الخطة', order: 50, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'implementation', nameEn: 'Implementation', nameAr: 'التنفيذ', order: 60, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 240 },
      { key: 'implementation_verified', nameEn: 'Implementation Verified', nameAr: 'التحقق من التنفيذ', order: 70, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 16 },
      { key: 'effectiveness_check', nameEn: 'Effectiveness Check', nameAr: 'فحص الفاعلية', order: 80, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_OFFICER', slaWorkingHours: 240 },
      { key: 'effectiveness_approved', nameEn: 'Effectiveness Approved', nameAr: 'اعتماد الفاعلية', order: 90, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'closed', nameEn: 'Closed', nameAr: 'مغلق', order: 100, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'detection', toStageKey: 'investigation', labelEn: 'Start Investigation', labelAr: 'بدء التحقيق', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'investigation', toStageKey: 'root_cause_approved', labelEn: 'Submit Root Cause', labelAr: 'تقديم السبب الجذري', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'root_cause_approved', toStageKey: 'action_planning', labelEn: 'Approve Root Cause', labelAr: 'اعتماد السبب الجذري', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:approve', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'root_cause_approved', toStageKey: 'investigation', labelEn: 'Insufficient Investigation', labelAr: 'تحقيق غير كافٍ', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:approve', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'action_planning', toStageKey: 'plan_approved', labelEn: 'Submit Action Plan', labelAr: 'تقديم خطة الإجراء', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'plan_approved', toStageKey: 'implementation', labelEn: 'Approve Plan', labelAr: 'اعتماد الخطة', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:approve', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'plan_approved', toStageKey: 'action_planning', labelEn: 'Revise Plan', labelAr: 'مراجعة الخطة', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:approve', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'implementation', toStageKey: 'implementation_verified', labelEn: 'Submit for Verification', labelAr: 'إرسال للتحقق', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'implementation_verified', toStageKey: 'effectiveness_check', labelEn: 'Verify Implementation', labelAr: 'التحقق من التنفيذ', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'implementation_verified', toStageKey: 'implementation', labelEn: 'Implementation Incomplete', labelAr: 'التنفيذ غير مكتمل', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:investigate', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'effectiveness_check', toStageKey: 'effectiveness_approved', labelEn: 'Submit Effectiveness', labelAr: 'تقديم نتائج الفاعلية', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:investigate', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'effectiveness_approved', toStageKey: 'closed', labelEn: 'Close CAPA', labelAr: 'إغلاق الإجراء التصحيحي', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:close', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'effectiveness_approved', toStageKey: 'implementation', labelEn: 'Recurrence Detected — Reopen', labelAr: 'إعادة الفتح — تكرار المشكلة', triggerCondition: 'ROLE_BASED', requiredPermission: 'capa:approve', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 6. MEETING ────────────────────────────────────────────────────────────
  {
    objectType: 'MEETING',
    nameEn: 'Meeting Management',
    nameAr: 'إدارة الاجتماعات',
    stages: [
      { key: 'planned', nameEn: 'Planned', nameAr: 'مجدول', order: 10, isInitial: true, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
      { key: 'agenda_ready', nameEn: 'Agenda Ready', nameAr: 'الأجندة جاهزة', order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
      { key: 'minutes_draft', nameEn: 'Minutes Draft', nameAr: 'مسودة المحضر', order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'SELF', slaWorkingHours: 16 },
      { key: 'minutes_review', nameEn: 'Minutes Review', nameAr: 'مراجعة المحضر', order: 40, isInitial: false, isFinal: false, approvalMode: 'PARALLEL', parallelThreshold: 'ALL', assigneeStrategy: 'ROLE', assigneeRoleKey: 'BASE_USER', slaWorkingHours: 16 },
      { key: 'minutes_approved', nameEn: 'Minutes Approved', nameAr: 'اعتماد المحضر', order: 50, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 8 },
      { key: 'cancelled', nameEn: 'Cancelled', nameAr: 'ملغى', order: 60, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'planned', toStageKey: 'agenda_ready', labelEn: 'Prepare Agenda', labelAr: 'إعداد الأجندة', triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'planned', toStageKey: 'cancelled', labelEn: 'Cancel Meeting', labelAr: 'إلغاء الاجتماع', triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'agenda_ready', toStageKey: 'minutes_draft', labelEn: 'Record Minutes', labelAr: 'تسجيل المحضر', triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:manage', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'agenda_ready', toStageKey: 'cancelled', labelEn: 'Cancel Meeting', labelAr: 'إلغاء الاجتماع', triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'minutes_draft', toStageKey: 'minutes_review', labelEn: 'Distribute Minutes', labelAr: 'توزيع المحضر', triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'minutes_review', toStageKey: 'minutes_approved', labelEn: 'Approve Minutes', labelAr: 'اعتماد المحضر', triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:approve_minutes', isApprovalPath: true, actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'minutes_review', toStageKey: 'minutes_draft', labelEn: 'Return for Correction', labelAr: 'إعادة للتصحيح', triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:manage', isApprovalPath: false, actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'minutes_draft', toStageKey: 'minutes_draft', labelEn: 'Return for Correction', labelAr: 'إعادة للتصحيح', triggerCondition: 'ROLE_BASED', requiredPermission: 'meetings:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 7. COMMITTEE ──────────────────────────────────────────────────────────
  {
    objectType: 'COMMITTEE',
    nameEn: 'Committee Management',
    nameAr: 'إدارة اللجان',
    stages: [
      { key: 'formation', nameEn: 'Formation', nameAr: 'التأسيس', order: 10, isInitial: true, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
      { key: 'terms_review', nameEn: 'Terms Review', nameAr: 'مراجعة النظام الداخلي', order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 40 },
      { key: 'active', nameEn: 'Active', nameAr: 'نشطة', order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
      { key: 'suspended', nameEn: 'Suspended', nameAr: 'موقوفة', order: 40, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
      { key: 'dissolution_pending', nameEn: 'Dissolution Pending', nameAr: 'قيد الحل', order: 50, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 40 },
      { key: 'dissolved', nameEn: 'Dissolved', nameAr: 'محلولة', order: 60, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'formation', toStageKey: 'terms_review', labelEn: 'Submit for Approval', labelAr: 'إرسال للاعتماد', triggerCondition: 'ROLE_BASED', requiredPermission: 'committees:manage', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'terms_review', toStageKey: 'active', labelEn: 'Approve Committee', labelAr: 'اعتماد اللجنة', triggerCondition: 'ROLE_BASED', requiredPermission: 'committees:approve', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'terms_review', toStageKey: 'formation', labelEn: 'Revise Terms', labelAr: 'مراجعة النظام الداخلي', triggerCondition: 'ROLE_BASED', requiredPermission: 'committees:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'active', toStageKey: 'suspended', labelEn: 'Suspend Committee', labelAr: 'تعليق اللجنة', triggerCondition: 'ROLE_BASED', requiredPermission: 'committees:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'suspended', toStageKey: 'active', labelEn: 'Reactivate Committee', labelAr: 'إعادة تفعيل اللجنة', triggerCondition: 'ROLE_BASED', requiredPermission: 'committees:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'active', toStageKey: 'dissolution_pending', labelEn: 'Initiate Dissolution', labelAr: 'بدء إجراءات الحل', triggerCondition: 'ROLE_BASED', requiredPermission: 'committees:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'suspended', toStageKey: 'dissolution_pending', labelEn: 'Dissolve Committee', labelAr: 'حل اللجنة', triggerCondition: 'ROLE_BASED', requiredPermission: 'committees:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'dissolution_pending', toStageKey: 'dissolved', labelEn: 'Confirm Dissolution', labelAr: 'تأكيد الحل', triggerCondition: 'ROLE_BASED', requiredPermission: 'committees:approve', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 8. CHANGE_REQUEST ─────────────────────────────────────────────────────
  {
    objectType: 'CHANGE_REQUEST',
    nameEn: 'Change Request',
    nameAr: 'طلب تغيير',
    stages: [
      { key: 'submitted', nameEn: 'Submitted', nameAr: 'مقدّم', order: 10, isInitial: true, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
      { key: 'unit_manager_review', nameEn: 'Unit Manager Review', nameAr: 'مراجعة مدير الوحدة', order: 20, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ORG_UNIT_HEAD', slaWorkingHours: 16 },
      { key: 'quality_review', nameEn: 'Quality Review', nameAr: 'مراجعة الجودة', order: 30, isInitial: false, isFinal: false, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER', slaWorkingHours: 16 },
      { key: 'approved', nameEn: 'Approved', nameAr: 'مقبول', order: 40, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
      { key: 'rejected', nameEn: 'Rejected', nameAr: 'مرفوض', order: 50, isInitial: false, isFinal: true, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', assigneeRoleKey: 'QUALITY_MANAGER' },
    ],
    transitions: [
      { fromStageKey: 'submitted', toStageKey: 'unit_manager_review', labelEn: 'Submit Change Request', labelAr: 'تقديم طلب التغيير', triggerCondition: 'ANY_AUTHENTICATED', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'unit_manager_review', toStageKey: 'quality_review', labelEn: 'Approve', labelAr: 'موافقة', triggerCondition: 'ROLE_BASED', requiredPermission: 'org:manage', actions: [{ actionType: 'CREATE_TASK', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'unit_manager_review', toStageKey: 'rejected', labelEn: 'Reject', labelAr: 'رفض', triggerCondition: 'ROLE_BASED', requiredPermission: 'org:manage', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'quality_review', toStageKey: 'approved', labelEn: 'Approve Change Request', labelAr: 'قبول طلب التغيير', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:approve', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'quality_review', toStageKey: 'rejected', labelEn: 'Reject Change Request', labelAr: 'رفض طلب التغيير', triggerCondition: 'ROLE_BASED', requiredPermission: 'documents:approve', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },
];
