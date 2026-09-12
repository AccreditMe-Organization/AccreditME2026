export interface ICommittee {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string;
  typeValueId: string;
  purpose: string | null;
  quorumCount: number;
  meetingFrequency: string;
  parentCommitteeId: string | null;
  // Nullable, deliberately unpopulated until Document Management ships
  // (ACC-22 Pending Discussion #1) — see committee.service.ts.
  termsOfReferenceDocumentId: string | null;
  // Mutually exclusive — enforced at the service layer, not the DB
  // (ACC-22 Pending Discussion #4).
  reportingToCommitteeId: string | null;
  reportingToRoleId: string | null;
  formedAt: Date | null;
  dissolvedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ACC-76 — a committee as it appears in a LIST, with the two facts a reader
// needs to judge it at a glance and which the row itself cannot supply.
//
// Separate from ICommittee for the reason ACC-74 established the hard way:
// an optional field populated by exactly one endpoint is a trap. Role-list
// bound to `permissions?.length` and rendered 0 for every role, silently,
// forever. A distinct type makes the two cases impossible to confuse.
//
// Both fields come from ONE batched query each across the whole list — never
// per row. At ~110ms a round trip, a per-row lookup over a dozen committees
// is the difference between a page and a wait.
export interface ICommitteeListItem extends ICommittee {
  memberCount: number;
  // The committee's live workflow stage, read from the engine rather than
  // stored on Committee (ACC-22 Pending Discussion #5). Null when no workflow
  // instance exists for it, or when the instance sits at no stage.
  //
  // Tenant-editable data: rendered by isArabic() selection, never
  // `| translate` (SYSTEM-REFERENCE §9.3).
  currentStageNameEn: string | null;
  currentStageNameAr: string | null;
}

export interface ICommitteeMember {
  id: string;
  organizationId: string;
  committeeId: string;
  userId: string;
  roleValueId: string;
  joinedAt: Date;
  leftAt: Date | null;
  // Derived STRICTLY from leftAt at the service layer (isActive = leftAt
  // === null) — never set independently (ACC-22 Pending Discussion #6).
  isActive: boolean;
}

export interface ICommitteeMembershipEvent {
  id: string;
  organizationId: string;
  committeeId: string;
  userId: string;
  roleValueId: string;
  action: 'JOINED' | 'LEFT' | 'ROLE_CHANGED';
  effectiveDate: Date;
  reason: string | null;
  approvedBy: string | null;
  createdAt: Date;
}
