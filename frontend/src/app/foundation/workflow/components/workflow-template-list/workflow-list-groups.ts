/**
 * ACC-120 slice 7c — the Workflows list's MODULES: which record types sit under
 * each heading, and in what order. The one place that mapping lives.
 *
 * Grouping by record type gave every heading exactly one row (Ahmad's review),
 * so the headings are modules and each row says which record type it is for.
 * The order here is the page's order: modules top to bottom, and the record
 * types inside a module in the order listed. A record type this file does not
 * know falls into a final "Other" group, and is never shown as its code.
 */
export type WorkflowModule = 'DOCUMENTS' | 'INCIDENTS' | 'AUDITS' | 'CORRECTIVE_ACTIONS' | 'MEETINGS' | 'COMMITTEES' | 'OTHER';

export const WORKFLOW_MODULES: readonly { module: Exclude<WorkflowModule, 'OTHER'>; types: readonly string[] }[] = [
  { module: 'DOCUMENTS', types: ['DOCUMENT_REQUEST', 'DOCUMENT', 'CHANGE_REQUEST'] },
  { module: 'INCIDENTS', types: ['INCIDENT'] },
  { module: 'AUDITS', types: ['AUDIT'] },
  { module: 'CORRECTIVE_ACTIONS', types: ['CORRECTIVE_ACTION'] },
  { module: 'MEETINGS', types: ['MEETING'] },
  { module: 'COMMITTEES', types: ['COMMITTEE', 'COMMITTEE_CHANGE_REQUEST'] },
];

const KNOWN_TYPES: ReadonlySet<string> = new Set(WORKFLOW_MODULES.flatMap((m) => m.types));

/** The module heading, in the reader's language. */
export function workflowModuleLabelKey(module: WorkflowModule): string {
  return `workflow.list.module.${module}`;
}

/** Whether this file places the record type in a module (otherwise it is Other). */
export function isKnownWorkflowType(objectType: string | null | undefined): boolean {
  return !!objectType && KNOWN_TYPES.has(objectType);
}

/**
 * The record type as a row's second line names it ("document requests"), for
 * "Default for …" and "For …". An unknown type reads "other records".
 */
export function workflowRecordForKey(objectType: string | null | undefined): string {
  return `workflow.list.recordFor.${isKnownWorkflowType(objectType) ? objectType : 'OTHER'}`;
}
