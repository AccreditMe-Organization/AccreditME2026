// ACC-190 — a stage task definition as the workflow settings screen reads it:
// the stored fields, the names of what it points at (so the screen can say
// "Quality Officer, Cardiology" without more lookups), and the due time its
// priority gives, in working hours from stage entry.

export interface IStageTaskDefinition {
  id: string;
  stageId: string;
  order: number;
  titleEn: string;
  titleAr: string | null;
  description: string | null;
  isMandatory: boolean;
  requiresEvidence: boolean;
  priority: string; // TaskPriority
  assignKind: string; // StageTaskAssignKind
  orgUnitId: string | null;
  positionId: string | null;
  userId: string | null;
  committeeId: string | null;
  committeeRoleValueId: string | null;
  orgUnit: { id: string; nameEn: string; nameAr: string | null } | null;
  position: { id: string; nameEn: string; nameAr: string | null } | null;
  user: { id: string; name: string } | null;
  committee: { id: string; nameEn: string; nameAr: string | null } | null;
  committeeRole: { id: string; labelEn: string; labelAr: string | null } | null;
  /** The priority's due time, in working hours from stage entry. */
  dueAfterHours: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A non-blocking note on a save (the ACC-55 contract: the dialog stays open and
 * shows it). Nobody holds the chosen position, or nobody is in the chosen pool,
 * right now. A relative route cannot be checked until a record enters.
 */
export type StageTaskDefinitionWarning = 'POSITION_HAS_NO_HOLDER' | 'POOL_EMPTY' | null;

export interface IStageTaskDefinitionSaved {
  definition: IStageTaskDefinition;
  warning: StageTaskDefinitionWarning;
}
