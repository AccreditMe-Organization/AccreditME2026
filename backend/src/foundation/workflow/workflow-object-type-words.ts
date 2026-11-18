import type { WorkflowObjectType } from '../../../generated/prisma/client';

/**
 * ACC-95 — a workflow record type as server-built text names it: the screens'
 * own words (`workflow.objectTypeName.*` in the frontend's en.json / ar.json),
 * never the stored code (`COMMITTEE`). `workflow-object-type-words.spec.ts`
 * reads both files and fails when the two drift; a type missing here is a
 * compile error.
 */
export const WORKFLOW_OBJECT_TYPE_WORDS: Readonly<Record<WorkflowObjectType, { en: string; ar: string }>> = {
  DOCUMENT_REQUEST: { en: 'Document request', ar: 'طلب وثيقة' },
  DOCUMENT: { en: 'Document', ar: 'وثيقة' },
  CHANGE_REQUEST: { en: 'Document change request', ar: 'طلب تغيير وثيقة' },
  INCIDENT: { en: 'Incident', ar: 'حادثة' },
  AUDIT: { en: 'Audit', ar: 'تدقيق' },
  CORRECTIVE_ACTION: { en: 'Corrective action', ar: 'إجراء تصحيحي' },
  MEETING: { en: 'Meeting', ar: 'اجتماع' },
  COMMITTEE: { en: 'Committee', ar: 'لجنة' },
  COMMITTEE_CHANGE_REQUEST: { en: 'Committee change request', ar: 'طلب تغيير لجنة' },
};
