import { IOrgPosition } from '../../org-position/interfaces/org-position.interface';

// ACC-46 Section 2.6.b Step 2 — drives which subsequent wizard steps are
// shown (Step 3 only if hasActiveDirectReports), pre-fills the position
// picker (Step 4) with only genuinely available choices, and pre-fills the
// manager step's (Step 5) default. Read-only projection — same "for UI
// consumption only" framing as IOrgUnitHeadStatus.
export interface ITransferContext {
  hasActiveDirectReports: boolean;
  availablePositions: IOrgPosition[];
  currentDestinationHead: { id: string; name: string; positionId: string | null } | null;
}
