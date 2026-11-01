/**
 * ACC-120 slice 7 — the Workflows list's group headings: each record type in
 * the plural ("Committees"), for the heading over its workflows. The singular
 * names stay in workflow-labels.ts. A type this file does not know reads
 * "Unknown", never the stored code.
 */
const GROUP_KEYS: Readonly<Record<string, string>> = {
  DOCUMENT_REQUEST: 'workflow.list.group.DOCUMENT_REQUEST',
  DOCUMENT: 'workflow.list.group.DOCUMENT',
  CHANGE_REQUEST: 'workflow.list.group.CHANGE_REQUEST',
  INCIDENT: 'workflow.list.group.INCIDENT',
  AUDIT: 'workflow.list.group.AUDIT',
  CORRECTIVE_ACTION: 'workflow.list.group.CORRECTIVE_ACTION',
  MEETING: 'workflow.list.group.MEETING',
  COMMITTEE: 'workflow.list.group.COMMITTEE',
  COMMITTEE_CHANGE_REQUEST: 'workflow.list.group.COMMITTEE_CHANGE_REQUEST',
};

export function workflowGroupLabelKey(objectType: string | null | undefined): string {
  return (objectType && GROUP_KEYS[objectType]) || 'workflow.valueUnknown';
}
