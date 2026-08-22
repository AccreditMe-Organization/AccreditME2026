// ACC-40 Section 2.2/2.3 — a read-only projection for UI consumption only.
// "holders" is a LIVE derivation (Section 2.2's own query: zero, one, or
// two rows during a declared handover) — never the cached isHeadVacant
// field, which stays inert until SlaMonitorProcessor's sweep needs it.
// actingHeadUserId (Phase 11) IS the cache field itself, not a derived
// value — OrgUnit.actingHeadUserId is the one real source of truth for
// who's covering, unlike "holders" above.
export interface IOrgUnitHeadStatus {
  holders: { id: string; name: string; positionId: string | null }[];
  pendingHeadUserId: string | null;
  headHandoverEffectiveDate: Date | null;
  actingHeadUserId: string | null;
}
