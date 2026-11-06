import type { ICommitteeHomeCounts } from '../committees/interfaces/committee.interface';
import type { ISetupHealthHomeSlice } from '../setup-health/interfaces/setup-health.interface';
import type { IUserHomeCounts } from '../user/user-home-counts.service';

/** A part the caller may see that could not be read this time. */
export interface IHomePartFailed {
  failed: true;
}

/**
 * ACC-279 — GET /home/admin-summary. A part is null when the caller may not see it,
 * `{ failed: true }` when it could not be read, and its data otherwise.
 */
export interface IHomeAdminSummary {
  setup: ISetupHealthHomeSlice | IHomePartFailed | null;
  users: IUserHomeCounts | IHomePartFailed | null;
  committees: ICommitteeHomeCounts | IHomePartFailed | null;
}
