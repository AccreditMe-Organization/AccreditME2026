import type { IOrgUnitPathItem } from './org-structure.interface';

/**
 * ACC-120 slice 11, PR D — `GET /organization/units/:id/history` (D8).
 *
 * The unit's stored rows, newest first: its own `AuditLog` rows (the record
 * created, changed, moved, deactivated) and its `OrgUnitHeadEvent` rows (the
 * headship ledger). Nothing is reconstructed: each entry is one stored row.
 *
 * WHAT A CALLER SEES (D7): `org:view` for the endpoint; a person's name only
 * with `users:view`, else null. Ids and dates are never withheld. The audit
 * row's `before` / `after` copies are NEVER returned: the server reads them to
 * name what changed, and sends only those names.
 */

/** Someone the row names. `name` is null without `users:view`. */
export interface IOrgUnitHistoryPerson {
  userId: string;
  name: string | null;
  /** Their position now, shown in place of a hidden name. Titles are `org:view` data. */
  positionNameEn: string | null;
  positionNameAr: string | null;
}

/** The fields of the unit an edit can change, by the names the record uses. */
export type OrgUnitHistoryField = 'nameEn' | 'nameAr' | 'code' | 'type' | 'description' | 'parent' | 'sortOrder';

/** From an AuditLog row on the unit. */
export type OrgUnitAuditKind = 'CREATED' | 'CHANGED' | 'DEACTIVATED' | 'REACTIVATED' | 'RECORDED';

/** From an OrgUnitHeadEvent row: its `action`, as stored. */
export type OrgUnitHeadEventKind =
  | 'ASSIGNED'
  | 'HANDOVER_DECLARED'
  | 'HANDOVER_COMPLETED'
  | 'HANDOVER_CANCELLED'
  | 'VACATED'
  | 'ACTING_ASSIGNED'
  | 'ACTING_ENDED';

interface IOrgUnitHistoryBase {
  /** `audit:<id>` or `head:<id>`, unique across both sources. */
  id: string;
  /** When the row was written. */
  at: Date;
  /** Who did it. Null when no person is recorded (the system did it). */
  actor: IOrgUnitHistoryPerson | null;
}

export interface IOrgUnitAuditHistoryEntry extends IOrgUnitHistoryBase {
  source: 'AUDIT';
  kind: OrgUnitAuditKind;
  /** CHANGED only: which fields differ between the stored copies. */
  fields: OrgUnitHistoryField[];
  /**
   * Present only when the parent changed: the new parent, with its current
   * names, or null when the unit was moved to the top.
   */
  movedTo?: IOrgUnitPathItem | null;
}

export interface IOrgUnitHeadHistoryEntry extends IOrgUnitHistoryBase {
  source: 'HEAD_EVENT';
  kind: OrgUnitHeadEventKind;
  /** When it took effect, as recorded on the event. */
  effectiveDate: Date;
  /** The person the event is about. */
  subject: IOrgUnitHistoryPerson;
  /** The head position involved; null for acting events. */
  position: { id: string; nameEn: string; nameAr: string | null } | null;
}

export type IOrgUnitHistoryEntry = IOrgUnitAuditHistoryEntry | IOrgUnitHeadHistoryEntry;

export interface IOrgUnitHistoryPage {
  items: IOrgUnitHistoryEntry[];
  /** Every row there is, both sources together. */
  total: number;
  skip: number;
  take: number;
  /**
   * For an inactive unit: the latest audit row that moved it from active to
   * inactive, or null when no such row exists. Absent for an active unit.
   */
  deactivation?: { at: Date; actor: IOrgUnitHistoryPerson | null } | null;
}
