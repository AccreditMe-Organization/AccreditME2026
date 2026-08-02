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
