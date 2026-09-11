import { IResolvedDelegation } from '../../../common/services/delegation-label.interface';

// ACC-76 — an object's workflow position, answered TWO ways, because there
// are two different questions and neither answer substitutes for the other.
//
//   `stages`  — what is the process, and where in it are we?
//               Every template stage, in order, always. This is the sequence
//               view: a reader who has never seen a committee before learns
//               the shape of the lifecycle from it.
//
//   `visits`  — what actually happened to THIS record?
//               The chronology, repeats preserved.
//
// WHY BOTH, STATED DELIBERATELY — an earlier revision of this ticket shipped
// `visits` alone, on the reasoning below, and that was wrong: the reasoning is
// a good argument against the sequence being the ONLY view, and no argument at
// all against it existing.
//
// The reasoning that still holds: a stepper's grammar is linear progress with
// a fixed step count — numbered nodes, ticks behind you, "step 3 of 6". Every
// one of those elements states something false about a record that revisited a
// stage, and this engine produces such records by design (Committee's seeded
// template has a TERMS_REVIEW -> FORMATION "Revise Terms" transition, so a real
// path can read Formation -> Terms Review -> Formation -> Terms Review).
// `order` cannot express that: it is a display field, not a traversal record.
//
// What follows from it is NOT "drop the sequence" but "the sequence must not
// claim to be a progression". Hence `visitCount` on each entry: the sequence
// shows the loop rather than hiding it, and the chronology beside it shows
// when the loop happened.
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
  //
  // WHO THIS IS: the person who ENTERED this stage. WorkflowInstanceStage.actorId
  // is written once, at row creation, and the exit update touches only
  // exitedAt/outcome/comment — so it is never overwritten by whoever later
  // left. On a revisited stage the two visits are separate rows with separate
  // actors, each correctly its own.
  actorName: string | null;

  // ACC-76 — the transition that caused entry into this stage, so a history
  // row reads "Terms Review — Submit for Approval" rather than just naming a
  // stage.
  //
  // DERIVED, NOT STORED. WorkflowInstanceStage records no transition id, so
  // this is resolved from the (previous visit's stage -> this visit's stage)
  // pair against the template's transitions. Verified safe for every shipped
  // workflow: across all 8 seeded templates, 67 transitions, NO template has
  // two transitions sharing a from/to pair. Where a tenant later creates one
  // that does, the pair is ambiguous and both fields are null — a blank beats
  // a guess in a compliance trail.
  //
  // Null on the first visit too: nothing transitioned into it, the instance
  // started there.
  //
  // Tenant-editable data: rendered by isArabic() selection, never `| translate`.
  transitionLabelEn: string | null;
  transitionLabelAr: string | null;

  comment: string | null;

  isUnassigned: boolean;
  // ACC-40 §2.6.3's stamp — the same pair TaskAssignee carries, resolved the
  // same way by the same service. This is what lets a history row read
  // "Approved by Sarah — Acting Head of Cardiology".
  delegation: IResolvedDelegation | null;
}

// One entry per stage the template defines — every stage, whether reached or
// not. This is what the sequence view renders.
export interface IWorkflowStageSequenceEntry {
  id: string;
  nameEn: string;
  nameAr: string;
  order: number;
  // 0 = not yet reached. >1 = the record has been here more than once, which
  // the sequence must SHOW rather than flatten — it is the one honest way a
  // linear list can admit a loop happened.
  visitCount: number;
  // True for the stage with an open visit. Derived from exitedAt, never from
  // WorkflowInstance.currentStageId: with a repeat, currentStageId matches two
  // visit rows and cannot say which is live. At most one entry is current; all
  // are false once the instance reaches a final stage and exits it.
  isCurrent: boolean;
}

export interface IWorkflowStageHistory {
  instanceId: string;
  // Every template stage, ordered by `order`. Always present, even before the
  // record has been anywhere.
  stages: IWorkflowStageSequenceEntry[];
  // Chronological by enteredAt, oldest first. Repeats preserved.
  visits: IWorkflowStageVisit[];
}
