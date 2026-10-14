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
  /**
   * ACC-199 — the person's open and overdue tasks ON THE RECORD the picker was
   * opened from, and whether choosing them offers "✦ Suggest someone" (the
   * threshold, decided here so the screen holds no copy of it). Null when no
   * record was named, or the caller cannot see that record's task list: the
   * picker still answers, only the counts are withheld.
   */
  workload: IHolderWorkload | null;
}

export interface IHolderWorkload {
  openCount: number;
  overdueCount: number;
  canSuggest: boolean;
}

/** ACC-199 — the answer to "✦ Suggest someone". */
export interface IWorkloadHint {
  /** The AI log row, so a followed suggestion can be marked on the task's audit row. */
  interactionId: string | null;
  chosen: { userId: string; openCount: number; overdueCount: number };
  suggestion: {
    userId: string;
    name: string;
    positionNameEn: string | null;
    positionNameAr: string | null;
    openCount: number;
    overdueCount: number;
    /** Due within the next 2 working days: what the model weighed beside the open count. */
    dueSoonCount: number;
  };
  /**
   * Anyone the model was shown had work due within the next 2 working days, so
   * "none due soon" is a reason the pick can rest on — the screen says so when
   * the suggested person has none.
   */
  dueSoonSeen: boolean;
}

export interface IWorkloadHintAvailability {
  available: boolean;
}

export interface IAssignableCommitteeRole {
  id: string;
  labelEn: string;
  labelAr: string | null;
  // Active members holding this role on the committee, right now. Null only in
  // the catalogue (ACC-208, B5) when no committee was named.
  memberCount: number | null;
}
