// System default workflow templates seeded per tenant on bootstrap (see
// TenantService.bootstrap()), written by applyWorkflowSeed(). ACC-271 PR 6b —
// a stage says who works it (`who`) and a move who makes it (`mover`); the
// seed names no role, permission or trigger.

import { COMMITTEE_ACTIONS, STAGE_FLAG } from './record-registry';

// ACC-255 — today's committee rules, reproduced exactly (the plan's §4.1):
// membership in every stage, Edit details in Formation only, a change request
// raised in Active and Suspended. Ahmad's Dissolved change (Q-A) is PR 2's.
const MEMBERS = [COMMITTEE_ACTIONS.ADD_MEMBER, COMMITTEE_ACTIONS.REMOVE_MEMBER, COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE] as const;

export interface SeedAction {
  actionType:
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
  // ACC-271 PR 6a — who moves the record: a person (PERSON: whoever works the
  // from-stage), or the module's own code (APP: the change request's moves).
  // Written with the transition. PR 6b — the only people field a move has.
  mover: 'PERSON' | 'APP';
  validatorConfig?: Record<string, unknown>;
  // On an "All of them" stage, marks which outgoing move submitApproval()
  // fires once every member has approved. Defaults to false (schema default).
  isApprovalPath?: boolean;
  // ACC-190 — RETURN (send back) and EXIT (end the record) are never held by
  // the stage's mandatory tasks; ADVANCE, the default, is. Stage order cannot
  // tell them apart (Reject goes to a higher-order final stage, Reactivate to a
  // lower one), so every seeded transition that is not an advance says so.
  kind?: 'ADVANCE' | 'RETURN' | 'EXIT';
  actions: SeedAction[];
}

/**
 * ACC-271 — how a seeded stage's people decide, and who they are. SINGLE
 * becomes Any one of them; PARALLEL ALL becomes All of them. A Committee vote
 * is never seeded: it needs a committee, and a seed names none.
 */
export type SeedWho =
  | { mode: 'ANY_ONE' | 'ALL'; entries: readonly { kind: 'CREATOR' }[] }
  | { mode: 'ANY_ONE' | 'ALL'; startingAssignment: true };

export interface SeedStage {
  key: string; // stable key within this template only — wires transitions below
  nameEn: string;
  nameAr: string;
  order: number;
  slaWorkingHours?: number;
  isInitial: boolean;
  isFinal: boolean;
  // ACC-271 — who works the stage (plan §5). PR 6b — the only people field a
  // stage has; the old columns keep their database defaults until 6c drops them. A stage the record's creator
  // drives seeds a CREATOR entry; every other stage seeds NO entry and is
  // marked for a starting assignment: the tenant admin, written by
  // WorkflowTemplateService.assignStartingAssignments() once the first admin
  // is invited (the admin does not exist when the seed runs). Written only
  // when the seed CREATES the stage, like the record actions below.
  who: SeedWho;
  // ACC-255 — the record actions this stage allows (RECORD_ACTIONS keys) and
  // what it means (STAGE_FLAGS keys). Written only when the seed CREATES the
  // stage: a stage that already exists keeps what its tenant configured.
  actions?: readonly string[];
  flags?: readonly string[];
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
    | 'COMMITTEE'
    | 'COMMITTEE_CHANGE_REQUEST';
  nameEn: string;
  nameAr: string;
  stages: SeedStage[];
  transitions: SeedTransition[];
}

export const SYSTEM_WORKFLOW_SEED: SeedWorkflow[] = [
  // ── 1. DOCUMENT_REQUEST ──────────────────────────────────────────────────
  {
    objectType: 'DOCUMENT_REQUEST',
    nameEn: 'Document Request',
    nameAr: 'طلب وثيقة',
    stages: [
      { key: 'submitted', nameEn: 'Submitted', nameAr: 'مقدّم', order: 10, isInitial: true, isFinal: false, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'unit_manager_review', nameEn: 'Unit Manager Review', nameAr: 'مراجعة مدير الوحدة', order: 20, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'quality_review', nameEn: 'Quality Review', nameAr: 'مراجعة الجودة', order: 30, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'approved', nameEn: 'Approved', nameAr: 'مقبول', order: 40, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'rejected', nameEn: 'Rejected', nameAr: 'مرفوض', order: 50, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', startingAssignment: true } },
    ],
    transitions: [
      { fromStageKey: 'submitted', toStageKey: 'unit_manager_review', labelEn: 'Submit Request', labelAr: 'تقديم الطلب', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'unit_manager_review', toStageKey: 'quality_review', labelEn: 'Approve', labelAr: 'موافقة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'unit_manager_review', toStageKey: 'rejected', labelEn: 'Reject', labelAr: 'رفض', mover: 'PERSON', kind: 'EXIT', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'quality_review', toStageKey: 'approved', labelEn: 'Approve Request', labelAr: 'قبول الطلب', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'quality_review', toStageKey: 'rejected', labelEn: 'Reject Request', labelAr: 'رفض الطلب', mover: 'PERSON', kind: 'EXIT', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 2. DOCUMENT ───────────────────────────────────────────────────────────
  {
    objectType: 'DOCUMENT',
    nameEn: 'Document Lifecycle',
    nameAr: 'دورة حياة الوثيقة',
    stages: [
      { key: 'drafting', nameEn: 'Drafting', nameAr: 'مسودة', order: 10, isInitial: true, isFinal: false, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'owners_review', nameEn: 'Owners Review', nameAr: 'مراجعة المُلاك', order: 20, isInitial: false, isFinal: false, slaWorkingHours: 40, who: { mode: 'ALL', startingAssignment: true } },
      { key: 'stakeholders_review', nameEn: 'Stakeholders Review', nameAr: 'مراجعة أصحاب المصلحة', order: 30, isInitial: false, isFinal: false, slaWorkingHours: 40, who: { mode: 'ALL', startingAssignment: true } },
      { key: 'final_approval', nameEn: 'Final Approval', nameAr: 'الموافقة النهائية', order: 40, isInitial: false, isFinal: false, slaWorkingHours: 24, who: { mode: 'ALL', startingAssignment: true } },
      { key: 'publish_approval', nameEn: 'Publish Approval', nameAr: 'موافقة النشر', order: 50, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'published', nameEn: 'Published', nameAr: 'منشورة', order: 60, isInitial: false, isFinal: false, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'obsolete', nameEn: 'Obsolete', nameAr: 'ملغاة', order: 70, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', startingAssignment: true } },
    ],
    transitions: [
      { fromStageKey: 'drafting', toStageKey: 'owners_review', labelEn: 'Submit for Review', labelAr: 'إرسال للمراجعة', mover: 'PERSON', validatorConfig: { requiredFields: ['title', 'content'] }, actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'owners_review', toStageKey: 'stakeholders_review', labelEn: 'Owners Approved', labelAr: 'موافقة المُلاك', mover: 'PERSON', isApprovalPath: true, actions: [{ actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'owners_review', toStageKey: 'drafting', labelEn: 'Return for Revision', labelAr: 'إعادة للتعديل', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'stakeholders_review', toStageKey: 'final_approval', labelEn: 'Stakeholders Approved', labelAr: 'موافقة أصحاب المصلحة', mover: 'PERSON', isApprovalPath: true, actions: [{ actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'stakeholders_review', toStageKey: 'drafting', labelEn: 'Return for Revision', labelAr: 'إعادة للتعديل', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'final_approval', toStageKey: 'publish_approval', labelEn: 'All Approved', labelAr: 'اعتماد جميع الأطراف', mover: 'PERSON', isApprovalPath: true, actions: [{ actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'final_approval', toStageKey: 'drafting', labelEn: 'Return for Revision', labelAr: 'إعادة للتعديل', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'publish_approval', toStageKey: 'published', labelEn: 'Publish', labelAr: 'نشر', mover: 'PERSON', actions: [{ actionType: 'GENERATE_PDF', order: 10 }, { actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'publish_approval', toStageKey: 'drafting', labelEn: 'Reject Publication', labelAr: 'رفض النشر', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'published', toStageKey: 'obsolete', labelEn: 'Mark Obsolete', labelAr: 'إلغاء الوثيقة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 3. INCIDENT ───────────────────────────────────────────────────────────
  {
    objectType: 'INCIDENT',
    nameEn: 'Incident Management',
    nameAr: 'إدارة الحوادث',
    stages: [
      { key: 'reported', nameEn: 'Reported', nameAr: 'مُبلَّغ', order: 10, isInitial: true, isFinal: false, slaWorkingHours: 8, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'investigating', nameEn: 'Investigating', nameAr: 'قيد التحقيق', order: 20, isInitial: false, isFinal: false, slaWorkingHours: 40, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'root_cause_identified', nameEn: 'Root Cause Identified', nameAr: 'تحديد السبب الجذري', order: 30, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'closed', nameEn: 'Closed', nameAr: 'مغلق', order: 40, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'cancelled', nameEn: 'Cancelled', nameAr: 'ملغى', order: 50, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', startingAssignment: true } },
    ],
    transitions: [
      { fromStageKey: 'reported', toStageKey: 'investigating', labelEn: 'Start Investigation', labelAr: 'بدء التحقيق', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'investigating', toStageKey: 'root_cause_identified', labelEn: 'Submit Root Cause', labelAr: 'تقديم السبب الجذري', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'investigating', toStageKey: 'closed', labelEn: 'Close — No RCA Needed', labelAr: 'إغلاق — لا يستلزم تحليل السبب الجذري', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'root_cause_identified', toStageKey: 'closed', labelEn: 'Close Incident', labelAr: 'إغلاق الحادثة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'reported', toStageKey: 'cancelled', labelEn: 'Cancel Incident', labelAr: 'إلغاء الحادثة', mover: 'PERSON', kind: 'EXIT', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'investigating', toStageKey: 'cancelled', labelEn: 'Cancel Incident', labelAr: 'إلغاء الحادثة', mover: 'PERSON', kind: 'EXIT', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
    ],
  },

  // ── 4. AUDIT ──────────────────────────────────────────────────────────────
  {
    objectType: 'AUDIT',
    nameEn: 'Audit Management',
    nameAr: 'إدارة المراجعات',
    stages: [
      { key: 'planning', nameEn: 'Planning', nameAr: 'التخطيط', order: 10, isInitial: true, isFinal: false, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'announced', nameEn: 'Announced', nameAr: 'الإعلان', order: 20, isInitial: false, isFinal: false, slaWorkingHours: 40, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'fieldwork', nameEn: 'Fieldwork', nameAr: 'العمل الميداني', order: 30, isInitial: false, isFinal: false, slaWorkingHours: 40, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'findings_draft', nameEn: 'Findings Draft', nameAr: 'مسودة النتائج', order: 40, isInitial: false, isFinal: false, slaWorkingHours: 24, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'auditee_response', nameEn: 'Auditee Response', nameAr: 'رد المدقق عليه', order: 50, isInitial: false, isFinal: false, slaWorkingHours: 40, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'report_review', nameEn: 'Report Review', nameAr: 'مراجعة التقرير', order: 60, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'report_approved', nameEn: 'Report Approved', nameAr: 'اعتماد التقرير', order: 70, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'corrective_action', nameEn: 'Corrective Action', nameAr: 'الإجراء التصحيحي', order: 80, isInitial: false, isFinal: false, slaWorkingHours: 240, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'verification', nameEn: 'Verification', nameAr: 'التحقق', order: 90, isInitial: false, isFinal: false, slaWorkingHours: 240, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'closed', nameEn: 'Closed', nameAr: 'مغلق', order: 100, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', startingAssignment: true } },
    ],
    transitions: [
      { fromStageKey: 'planning', toStageKey: 'announced', labelEn: 'Announce Audit', labelAr: 'الإعلان عن المراجعة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'announced', toStageKey: 'fieldwork', labelEn: 'Begin Fieldwork', labelAr: 'بدء العمل الميداني', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'fieldwork', toStageKey: 'findings_draft', labelEn: 'Complete Fieldwork', labelAr: 'إنهاء العمل الميداني', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'findings_draft', toStageKey: 'auditee_response', labelEn: 'Send Findings', labelAr: 'إرسال النتائج', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'auditee_response', toStageKey: 'report_review', labelEn: 'Submit Response', labelAr: 'تقديم الرد', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'auditee_response', toStageKey: 'findings_draft', labelEn: 'Dispute Findings', labelAr: 'الاعتراض على النتائج', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'report_review', toStageKey: 'report_approved', labelEn: 'Finalize Report', labelAr: 'إنهاء التقرير', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'report_review', toStageKey: 'findings_draft', labelEn: 'Revise Findings', labelAr: 'مراجعة النتائج', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'report_approved', toStageKey: 'corrective_action', labelEn: 'Issue Report', labelAr: 'إصدار التقرير', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'corrective_action', toStageKey: 'verification', labelEn: 'Submit CAP', labelAr: 'تقديم خطة الإجراء التصحيحي', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'verification', toStageKey: 'closed', labelEn: 'Close Audit', labelAr: 'إغلاق المراجعة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'verification', toStageKey: 'corrective_action', labelEn: 'Return for Revision', labelAr: 'إعادة للمراجعة', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 5. CORRECTIVE_ACTION ─────────────────────────────────────────────────
  {
    objectType: 'CORRECTIVE_ACTION',
    nameEn: 'Corrective Action',
    nameAr: 'الإجراء التصحيحي',
    stages: [
      { key: 'detection', nameEn: 'Detection', nameAr: 'الاكتشاف', order: 10, isInitial: true, isFinal: false, slaWorkingHours: 8, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'investigation', nameEn: 'Investigation', nameAr: 'التحقيق', order: 20, isInitial: false, isFinal: false, slaWorkingHours: 40, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'root_cause_approved', nameEn: 'Root Cause Approved', nameAr: 'اعتماد السبب الجذري', order: 30, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'action_planning', nameEn: 'Action Planning', nameAr: 'تخطيط الإجراء', order: 40, isInitial: false, isFinal: false, slaWorkingHours: 24, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'plan_approved', nameEn: 'Plan Approved', nameAr: 'اعتماد الخطة', order: 50, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'implementation', nameEn: 'Implementation', nameAr: 'التنفيذ', order: 60, isInitial: false, isFinal: false, slaWorkingHours: 240, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'implementation_verified', nameEn: 'Implementation Verified', nameAr: 'التحقق من التنفيذ', order: 70, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'effectiveness_check', nameEn: 'Effectiveness Check', nameAr: 'فحص الفاعلية', order: 80, isInitial: false, isFinal: false, slaWorkingHours: 240, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'effectiveness_approved', nameEn: 'Effectiveness Approved', nameAr: 'اعتماد الفاعلية', order: 90, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'closed', nameEn: 'Closed', nameAr: 'مغلق', order: 100, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', startingAssignment: true } },
    ],
    transitions: [
      { fromStageKey: 'detection', toStageKey: 'investigation', labelEn: 'Start Investigation', labelAr: 'بدء التحقيق', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'investigation', toStageKey: 'root_cause_approved', labelEn: 'Submit Root Cause', labelAr: 'تقديم السبب الجذري', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'root_cause_approved', toStageKey: 'action_planning', labelEn: 'Approve Root Cause', labelAr: 'اعتماد السبب الجذري', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'root_cause_approved', toStageKey: 'investigation', labelEn: 'Insufficient Investigation', labelAr: 'تحقيق غير كافٍ', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'action_planning', toStageKey: 'plan_approved', labelEn: 'Submit Action Plan', labelAr: 'تقديم خطة الإجراء', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'plan_approved', toStageKey: 'implementation', labelEn: 'Approve Plan', labelAr: 'اعتماد الخطة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'plan_approved', toStageKey: 'action_planning', labelEn: 'Revise Plan', labelAr: 'مراجعة الخطة', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'implementation', toStageKey: 'implementation_verified', labelEn: 'Submit for Verification', labelAr: 'إرسال للتحقق', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'implementation_verified', toStageKey: 'effectiveness_check', labelEn: 'Verify Implementation', labelAr: 'التحقق من التنفيذ', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'implementation_verified', toStageKey: 'implementation', labelEn: 'Implementation Incomplete', labelAr: 'التنفيذ غير مكتمل', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'effectiveness_check', toStageKey: 'effectiveness_approved', labelEn: 'Submit Effectiveness', labelAr: 'تقديم نتائج الفاعلية', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'effectiveness_approved', toStageKey: 'closed', labelEn: 'Close CAPA', labelAr: 'إغلاق الإجراء التصحيحي', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'effectiveness_approved', toStageKey: 'implementation', labelEn: 'Recurrence Detected — Reopen', labelAr: 'إعادة الفتح — تكرار المشكلة', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 6. MEETING ────────────────────────────────────────────────────────────
  {
    objectType: 'MEETING',
    nameEn: 'Meeting Management',
    nameAr: 'إدارة الاجتماعات',
    stages: [
      { key: 'planned', nameEn: 'Planned', nameAr: 'مجدول', order: 10, isInitial: true, isFinal: false, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'agenda_ready', nameEn: 'Agenda Ready', nameAr: 'الأجندة جاهزة', order: 20, isInitial: false, isFinal: false, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'minutes_draft', nameEn: 'Minutes Draft', nameAr: 'مسودة المحضر', order: 30, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'minutes_review', nameEn: 'Minutes Review', nameAr: 'مراجعة المحضر', order: 40, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ALL', startingAssignment: true } },
      { key: 'minutes_approved', nameEn: 'Minutes Approved', nameAr: 'اعتماد المحضر', order: 50, isInitial: false, isFinal: true, slaWorkingHours: 8, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'cancelled', nameEn: 'Cancelled', nameAr: 'ملغى', order: 60, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', startingAssignment: true } },
    ],
    transitions: [
      { fromStageKey: 'planned', toStageKey: 'agenda_ready', labelEn: 'Prepare Agenda', labelAr: 'إعداد الأجندة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'planned', toStageKey: 'cancelled', labelEn: 'Cancel Meeting', labelAr: 'إلغاء الاجتماع', mover: 'PERSON', kind: 'EXIT', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'agenda_ready', toStageKey: 'minutes_draft', labelEn: 'Record Minutes', labelAr: 'تسجيل المحضر', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'agenda_ready', toStageKey: 'cancelled', labelEn: 'Cancel Meeting', labelAr: 'إلغاء الاجتماع', mover: 'PERSON', kind: 'EXIT', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'minutes_draft', toStageKey: 'minutes_review', labelEn: 'Distribute Minutes', labelAr: 'توزيع المحضر', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'minutes_review', toStageKey: 'minutes_approved', labelEn: 'Approve Minutes', labelAr: 'اعتماد المحضر', mover: 'PERSON', isApprovalPath: true, actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'minutes_review', toStageKey: 'minutes_draft', labelEn: 'Return for Correction', labelAr: 'إعادة للتصحيح', mover: 'PERSON', kind: 'RETURN', isApprovalPath: false, actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'minutes_draft', toStageKey: 'minutes_draft', labelEn: 'Return for Correction', labelAr: 'إعادة للتصحيح', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 7. COMMITTEE ──────────────────────────────────────────────────────────
  {
    objectType: 'COMMITTEE',
    nameEn: 'Committee Management',
    nameAr: 'إدارة اللجان',
    stages: [
      { key: 'formation', nameEn: 'Formation', nameAr: 'التأسيس', order: 10, isInitial: true, isFinal: false, actions: [COMMITTEE_ACTIONS.EDIT_DETAILS, ...MEMBERS], who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'terms_review', nameEn: 'Terms Review', nameAr: 'مراجعة النظام الداخلي', order: 20, isInitial: false, isFinal: false, slaWorkingHours: 40, actions: [...MEMBERS], who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'active', nameEn: 'Active', nameAr: 'نشطة', order: 30, isInitial: false, isFinal: false, actions: [...MEMBERS, COMMITTEE_ACTIONS.REQUEST_CHANGE], flags: [STAGE_FLAG.IN_FORCE], who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'suspended', nameEn: 'Suspended', nameAr: 'موقوفة', order: 40, isInitial: false, isFinal: false, actions: [...MEMBERS, COMMITTEE_ACTIONS.REQUEST_CHANGE], flags: [STAGE_FLAG.IN_FORCE], who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'dissolution_pending', nameEn: 'Dissolution Pending', nameAr: 'قيد الحل', order: 50, isInitial: false, isFinal: false, slaWorkingHours: 40, actions: [...MEMBERS], flags: [STAGE_FLAG.DISSOLVING], who: { mode: 'ANY_ONE', startingAssignment: true } },
      // ACC-255 PR 2 (Ahmad, Q-A): a dissolved committee's members can't be changed;
      // Dissolution Pending still allows it. Existing organisations: backfill:acc255-dissolved-membership.
      { key: 'dissolved', nameEn: 'Dissolved', nameAr: 'محلولة', order: 60, isInitial: false, isFinal: true, actions: [], flags: [STAGE_FLAG.DISSOLVING], who: { mode: 'ANY_ONE', startingAssignment: true } },
    ],
    transitions: [
      { fromStageKey: 'formation', toStageKey: 'terms_review', labelEn: 'Submit for Approval', labelAr: 'إرسال للاعتماد', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'terms_review', toStageKey: 'active', labelEn: 'Approve Committee', labelAr: 'اعتماد اللجنة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'terms_review', toStageKey: 'formation', labelEn: 'Revise Terms', labelAr: 'مراجعة النظام الداخلي', mover: 'PERSON', kind: 'RETURN', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'active', toStageKey: 'suspended', labelEn: 'Suspend Committee', labelAr: 'تعليق اللجنة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'suspended', toStageKey: 'active', labelEn: 'Reactivate Committee', labelAr: 'إعادة تفعيل اللجنة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'active', toStageKey: 'dissolution_pending', labelEn: 'Initiate Dissolution', labelAr: 'بدء إجراءات الحل', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'suspended', toStageKey: 'dissolution_pending', labelEn: 'Dissolve Committee', labelAr: 'حل اللجنة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'dissolution_pending', toStageKey: 'dissolved', labelEn: 'Confirm Dissolution', labelAr: 'تأكيد الحل', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },

  // ── 7b. COMMITTEE_CHANGE_REQUEST (ACC-239) ──────────────────────────────────
  // A change to an approved committee's details. EVERY move is the app's
  // (mover APP): the generic transitions endpoint refuses them, so a request
  // moves only through the change request endpoints — nobody can move one to
  // Approved without the change being applied. Its shape is fixed
  // (PROTECTED_TEMPLATES): tenants may rename the stages and set their
  // deadlines. No SEND_NOTIFICATION action: the module tells the people
  // concerned itself, in both languages. Every stage is worked by its creator
  // (the requester); the approvers are the holders of committees:approve, a
  // rule the module checks, not a stage assignee.
  {
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    nameEn: 'Committee Change Request',
    nameAr: 'طلب تغيير اللجنة',
    stages: [
      { key: 'draft', nameEn: 'Draft', nameAr: 'مسودة', order: 10, isInitial: true, isFinal: false, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'under_review', nameEn: 'Under review', nameAr: 'قيد المراجعة', order: 20, isInitial: false, isFinal: false, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'returned', nameEn: 'Returned', nameAr: 'مُعاد', order: 25, isInitial: false, isFinal: false, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'approved', nameEn: 'Approved', nameAr: 'معتمد', order: 30, isInitial: false, isFinal: true, flags: [STAGE_FLAG.APPLIES_APPROVED_CHANGE], who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'rejected', nameEn: 'Rejected', nameAr: 'مرفوض', order: 40, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'withdrawn', nameEn: 'Withdrawn', nameAr: 'مسحوب', order: 50, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
    ],
    transitions: [
      { fromStageKey: 'draft', toStageKey: 'under_review', labelEn: 'Submit for review', labelAr: 'إرسال للمراجعة', mover: 'APP', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'returned', toStageKey: 'under_review', labelEn: 'Submit again', labelAr: 'إعادة الإرسال', mover: 'APP', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'under_review', toStageKey: 'approved', labelEn: 'Approve and apply', labelAr: 'اعتماد وتطبيق', mover: 'APP', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'under_review', toStageKey: 'returned', labelEn: 'Return for changes', labelAr: 'إعادة للتعديل', mover: 'APP', kind: 'RETURN', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'under_review', toStageKey: 'rejected', labelEn: 'Reject', labelAr: 'رفض', mover: 'APP', kind: 'EXIT', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'draft', toStageKey: 'withdrawn', labelEn: 'Withdraw', labelAr: 'سحب', mover: 'APP', kind: 'EXIT', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'under_review', toStageKey: 'withdrawn', labelEn: 'Withdraw', labelAr: 'سحب', mover: 'APP', kind: 'EXIT', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
      { fromStageKey: 'returned', toStageKey: 'withdrawn', labelEn: 'Withdraw', labelAr: 'سحب', mover: 'APP', kind: 'EXIT', actions: [{ actionType: 'LOG_AUDIT', order: 10 }] },
    ],
  },

  // ── 8. CHANGE_REQUEST ─────────────────────────────────────────────────────
  {
    objectType: 'CHANGE_REQUEST',
    nameEn: 'Change Request',
    nameAr: 'طلب تغيير',
    stages: [
      { key: 'submitted', nameEn: 'Submitted', nameAr: 'مقدّم', order: 10, isInitial: true, isFinal: false, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } },
      { key: 'unit_manager_review', nameEn: 'Unit Manager Review', nameAr: 'مراجعة مدير الوحدة', order: 20, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'quality_review', nameEn: 'Quality Review', nameAr: 'مراجعة الجودة', order: 30, isInitial: false, isFinal: false, slaWorkingHours: 16, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'approved', nameEn: 'Approved', nameAr: 'مقبول', order: 40, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', startingAssignment: true } },
      { key: 'rejected', nameEn: 'Rejected', nameAr: 'مرفوض', order: 50, isInitial: false, isFinal: true, who: { mode: 'ANY_ONE', startingAssignment: true } },
    ],
    transitions: [
      { fromStageKey: 'submitted', toStageKey: 'unit_manager_review', labelEn: 'Submit Change Request', labelAr: 'تقديم طلب التغيير', mover: 'PERSON', actions: [{ actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'unit_manager_review', toStageKey: 'quality_review', labelEn: 'Approve', labelAr: 'موافقة', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 20 }, { actionType: 'LOG_AUDIT', order: 30 }] },
      { fromStageKey: 'unit_manager_review', toStageKey: 'rejected', labelEn: 'Reject', labelAr: 'رفض', mover: 'PERSON', kind: 'EXIT', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'quality_review', toStageKey: 'approved', labelEn: 'Approve Change Request', labelAr: 'قبول طلب التغيير', mover: 'PERSON', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
      { fromStageKey: 'quality_review', toStageKey: 'rejected', labelEn: 'Reject Change Request', labelAr: 'رفض طلب التغيير', mover: 'PERSON', kind: 'EXIT', actions: [{ actionType: 'SEND_NOTIFICATION', order: 10 }, { actionType: 'LOG_AUDIT', order: 20 }] },
    ],
  },
];
