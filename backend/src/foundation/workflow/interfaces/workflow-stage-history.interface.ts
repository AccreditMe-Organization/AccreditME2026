import { IResolvedDelegation } from '../../../common/services/delegation-label.interface';

// ACC-76 — an object's real journey through its workflow.
//
// WHY THIS SHAPE, STATED DELIBERATELY. The obvious alternative is a stepper
// over the template's stages, ordered by WorkflowStage.order, with everything
// before the current stage ticked. That shape LIES about any record that
// revisited a stage — and this engine has such records by design: Committee's
// seeded template carries a TERMS_REVIEW -> FORMATION "Revise Terms"
// transition, so a real committee's path can read
// Formation -> Terms Review -> Formation -> Terms Review. A stepper renders
// that as "step 2 of 6" with no hint that the record has been round the loop,
// and `order` cannot express it because order is a display field, not a
// traversal record.
//
// So: `visits` is the primary element and is a CHRONOLOGY, not a progression.
// A stage entered twice appears twice. The repeat is the information — being
// sent back to Formation is a governance fact a surveyor asks about, not a
// duplicate to collapse.
//
// `unvisitedStages` carries the rest of the template so a reader can still see
// the whole shape of the process, which is most of the point of replacing a
// bare "Current Stage: X" label. It is deliberately a SET, not a continuation
// of the chronology: nothing here promises those stages will be reached, or
// reached in that sequence.
export interface IWorkflowStageVisit {
  // The WorkflowInstanceStage row id — NOT the stage id, which repeats across
  // visits and is therefore unusable as a list key.
  id: string;
  stageId: string;
  // Tenant-editable data: rendered by isArabic() selection, never
  // `| translate` (SYSTEM-REFERENCE §9.3).
  stageNameEn: string;
  stageNameAr: string;
  enteredAt: Date;
  // Null marks the OPEN visit — the current stage. Derived from the data
  // rather than compared against WorkflowInstance.currentStageId, because
  // currentStageId cannot distinguish which of two visits to the same stage
  // is the live one.
  exitedAt: Date | null;
  outcome: string; // WorkflowInstanceStageOutcome
  actorId: string | null;
  // Resolved from User.name at query time; null when the actor no longer
  // resolves within the tenant.
  actorName: string | null;
  comment: string | null;
  isUnassigned: boolean;
  // ACC-40 §2.6.3's stamp — the same pair TaskAssignee carries, resolved the
  // same way by the same service. This is what lets a history row read
  // "Approved by Sarah — Acting Head of Cardiology".
  delegation: IResolvedDelegation | null;
}

export interface IWorkflowUnvisitedStage {
  id: string;
  nameEn: string;
  nameAr: string;
  order: number;
}

export interface IWorkflowStageHistory {
  instanceId: string;
  // Chronological by enteredAt, oldest first. Repeats preserved.
  visits: IWorkflowStageVisit[];
  // Template stages with no visit row. Ordered by `order` purely so the list
  // is stable between loads — see the note above on what that does NOT mean.
  unvisitedStages: IWorkflowUnvisitedStage[];
}
