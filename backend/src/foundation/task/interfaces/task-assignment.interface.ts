// ACC-167 — what the assignment picker returns. ONLY what the cascade needs:
// no email, no user status, no other profile field. The picker is open to
// tasks:create holders who may hold no users:view, so it must not become a
// way round that permission.

export interface IAssignableUnit {
  id: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string | null;
}

export interface IAssignablePosition {
  id: string;
  nameEn: string;
  nameAr: string | null;
  // A single-holder position fills itself: the task goes straight to its
  // holder rather than to a pool.
  isSingleAssignee: boolean;
  // Active holders of this position in the chosen unit, right now.
  holderCount: number;
}

// A person who can be chosen. The position is what tells two people with the
// same name apart (ACC-166).
export interface IAssignableHolder {
  id: string;
  name: string;
  positionNameEn: string | null;
  positionNameAr: string | null;
}

export interface IAssignableCommitteeRole {
  id: string;
  labelEn: string;
  labelAr: string | null;
  // Active members holding this role on the committee, right now.
  memberCount: number;
}
