// ACC-40 Section 2.2/2.3 — a read-only projection for UI consumption only.
// "holders" is a LIVE derivation (Section 2.2's own query: zero, one, or
// two rows during a declared handover) — never the cached
// isHeadVacant/actingHeadUserId fields, which stay inert until Phase 6/7
// wire real logic against them.
export interface IOrgUnitHeadStatus {
  holders: { id: string; name: string; positionId: string | null }[];
  pendingHeadUserId: string | null;
  headHandoverEffectiveDate: Date | null;
}
