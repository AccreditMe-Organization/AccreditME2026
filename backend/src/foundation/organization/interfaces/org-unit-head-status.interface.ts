// ACC-40 Section 2.2/2.3 — a read-only projection for UI consumption only.
// "holders" is a LIVE derivation (Section 2.2's own query: zero, one, or
// two rows during a declared handover) — never the cached isHeadVacant
// field, which stays inert until SlaMonitorProcessor's sweep needs it.
// actingHeadUserId (Phase 11) IS the cache field itself, not a derived
// value — OrgUnit.actingHeadUserId is the one real source of truth for
// who's covering, unlike "holders" above.
//
// ACC-133 — extended for the Headship panel. Every field above is kept for
// older callers. The new ones read the ledger (OrgUnitHeadEvent) and the period
// table (OrgUnitHeadAssignment), never AuditLog, and are null where the ledger
// has no row, so the panel says what is NOT recorded instead of inventing it.
//
// NAMES ARE SHOWN ONLY TO A CALLER WHO MAY SEE PEOPLE (D7, Ahmad): every person
// name below is null unless the caller holds users:view. Ids, dates, reasons
// and position titles are not withheld; position titles show to every org:view
// holder.

export interface IOrgUnitHeadHolder {
  id: string;
  /** Null without users:view. */
  name: string | null;
  positionId: string | null;
  /** The position's title, both languages (Arabic may be null, ACC-160). */
  positionNameEn: string | null;
  positionNameAr: string | null;
  /**
   * When this person became head of THIS unit: the latest ASSIGNED or
   * HANDOVER_COMPLETED event about them here, or for a successor still
   * pending, their HANDOVER_DECLARED. Null when the ledger has none, or when
   * a later event ended or superseded that headship (the person is head again
   * by a path that wrote no event).
   */
  headSince: Date | null;
}

export interface IOrgUnitHeadPersonRef {
  userId: string;
  /** Null without users:view. */
  name: string | null;
}

export interface IOrgUnitHeadCover {
  userId: string;
  /** Null without users:view. */
  name: string | null;
  reason: 'VACANCY' | 'ABSENCE' | null;
  validFrom: Date;
  /** Null: open-ended, "until it is ended by hand". */
  validTo: Date | null;
}

export interface IOrgUnitHeadStatus {
  holders: IOrgUnitHeadHolder[];
  pendingHeadUserId: string | null;
  headHandoverEffectiveDate: Date | null;
  actingHeadUserId: string | null;

  /**
   * The latest VACATED event on this unit: when, and who recorded it
   * (OrgUnitHeadEvent.approvedBy; `by` is null when no actor was recorded).
   * Null when the ledger has none.
   */
  lastVacancy: { at: Date; by: IOrgUnitHeadPersonRef | null } | null;

  /**
   * When the pending successor's head access began: their HANDOVER_DECLARED
   * event's createdAt. Access starts at declaration, not on the effective date.
   * Null when nobody is pending, or the ledger has no such event.
   */
  pendingHeadAccessSince: Date | null;

  /** The cover in force now (findRunningActingCover). Null when none is. */
  cover: IOrgUnitHeadCover | null;

  /**
   * A cover arranged to START later, not yet in force. Not one of the panel's
   * states, but the endpoints treat it as a cover: Arrange cover refuses while
   * it exists, and End cover accepts. Null when there is none.
   */
  scheduledCover: IOrgUnitHeadCover | null;

  /**
   * Covers on this unit whose period ended in the last 7 days (validTo in
   * (now - 7 days, now]), newest first. For the interim warning: arranging a
   * new cover for the same person starts a new 90-day period.
   */
  recentlyEndedCovers: (IOrgUnitHeadPersonRef & { endedAt: Date })[];
}
