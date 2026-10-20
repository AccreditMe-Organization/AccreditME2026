import { ITaskActions } from './task-page.interface';
import { ITaskOpenRequest } from './task-request.interface';
import { ITaskPoolView } from '../task-pool';

/**
 * ACC-229 — one row of a record's Tasks panel and of the All tasks list. A
 * list row, not a task: what the row shows and the viewer's actions on it. An
 * action that opens a dialog reads the task page's view model first, so the
 * dialogs keep taking a whole task.
 */
export interface ITaskRecordRow {
  id: string;
  title: string;
  titleAr: string | null;
  status: string;
  priority: string;
  dueAt: Date | null;
  onHoldUntil: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  rejectedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  requiresEvidence: boolean;
  /** Required or Optional — only a task created from a stage's definition says either. */
  requirement: 'REQUIRED' | 'OPTIONAL' | null;
  sourceType: string;
  sourceId: string;
  /** The record, named, on the organisation-wide list only; its name only when the viewer may open it. */
  record: { type: string; id: string; nameEn: string | null; nameAr: string | null } | null;
  assignees: { id: string; name: string; positionNameEn: string | null; positionNameAr: string | null }[];
  /** The pool it waits in, or was picked from; null when it went to named people. */
  pool: ITaskPoolView | null;
  /** True while nobody holds it and its pool can pick it up. */
  waitingInPool: boolean;
  /** The viewer took it from its pool. */
  pickedByViewer: boolean;
  openRequest: ITaskOpenRequest | null;
  evidenceCount: number;
  createdBy: { id: string; name: string };
  createdByWorkflow: boolean;
  actions: ITaskActions;
}

export interface ITaskRecordPanel {
  /** Every task the viewer can see on the record — never the five shown. */
  total: number;
  /** 'own' when the viewer may see the record but not all its tasks (Q1). */
  scope: 'all' | 'own';
  rows: ITaskRecordRow[];
  /** ACC-244 — may the viewer create a task on this record (Create tasks on its type)? */
  canCreate: boolean;
}

export interface ITaskRecordListFacets {
  people: { id: string; name: string }[];
  pools: { key: string; pool: ITaskPoolView }[];
  /** ACC-244 — the record types present in this view, for the Record type filter. */
  recordTypes: string[];
  /** ACC-244 — the unit view only: the owning units present, for the Unit filter. */
  units: { id: string; nameEn: string; nameAr: string | null }[];
}

export interface ITaskRecordList {
  items: ITaskRecordRow[];
  /** Every task the viewer can see here, before filters. */
  total: number;
  /** The tasks the filters match. */
  matching: number;
  scope: 'all' | 'own';
  /** ACC-244 — which list this is: one record's tasks, or an organisation-wide view. */
  view: 'record' | 'all' | 'unit' | 'unassigned';
  /** Only on the first page: the assignee and pool filter options. */
  facets: ITaskRecordListFacets | null;
  /** Where `around` sits (0-based) under this sort and these filters; null when absent or not matched. */
  aroundIndex: number | null;
}
