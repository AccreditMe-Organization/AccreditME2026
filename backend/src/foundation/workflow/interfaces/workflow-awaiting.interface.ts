// ACC-271 — GET /workflows/awaiting-me: the records waiting on the viewer's
// decision, for Home's "Awaiting my action". See WorkflowAwaitingService.

export interface IWorkflowAwaitingRow {
  /** The open stage entry the record is waiting at. */
  instanceStageId: string;
  record: { type: string; id: string; nameEn: string; nameAr: string | null };
  /** `position` is the stage's 1-based place by `order` among its template's `stageCount` stages. */
  stage: { id: string; nameEn: string; nameAr: string | null; position: number; stageCount: number };
  /** When the record entered the stage. */
  since: Date;
}

export interface IWorkflowAwaitingMe {
  /** Every record waiting on the viewer. */
  total: number;
  /** The oldest five, oldest first. */
  rows: IWorkflowAwaitingRow[];
}
