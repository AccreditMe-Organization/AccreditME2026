import type { SetupConditionSeverity } from '../../../../generated/prisma/client';
import type { ActiveSetupConditionType } from '../setup-condition.detectors';

// ACC-82 — SYSTEM-REFERENCE §13. The Setup health read model.

// Where a row's openedAt came from (§13.3). OBJECT: the object's own timestamp
// for entering the condition. FIRST_DETECTED: no such timestamp exists, so the
// age is measured from the first reconciliation that saw it, and the page must
// say so rather than present it as how long the problem has existed.
export type SetupConditionAgeBasis = 'OBJECT' | 'FIRST_DETECTED';

export interface ISetupCondition {
  id: string;
  type: ActiveSetupConditionType;
  severity: SetupConditionSeverity;
  objectId: string;
  // Display snapshot written by the detector; shape per type in §13.2.
  subject: Record<string, unknown>;
  openedAt: Date;
  ageBasis: SetupConditionAgeBasis;
  // The last reconciliation that still found this condition true.
  lastSeenAt: Date;
  clearedAt: Date | null;
}

// §13.5. How far each type's rows can be trusted.
//   CURRENT    last evaluation succeeded, within OVERDUE_AFTER_MS
//   OVERDUE    last evaluation succeeded, but longer ago than that
//   FAILED     the most recent evaluation failed; rows are the last known truth,
//              as of computedAt (null if it has never succeeded)
//   NEVER_RUN  never evaluated; an empty list for this type means nothing
export type SetupConditionFreshnessStatus =
  'CURRENT' | 'OVERDUE' | 'FAILED' | 'NEVER_RUN';

export interface ISetupConditionFreshness {
  type: ActiveSetupConditionType;
  status: SetupConditionFreshnessStatus;
  // When this type's rows were last confirmed: the last successful evaluation.
  computedAt: Date | null;
}

export interface ISetupHealth {
  open: ISetupCondition[];
  // Cleared within the last RECENTLY_CLEARED_DAYS, newest first.
  recentlyCleared: ISetupCondition[];
  // One entry per condition type, always all of them.
  freshness: ISetupConditionFreshness[];
}

export interface ISetupHealthSummary {
  open: number;
  blocksWork: number;
}
