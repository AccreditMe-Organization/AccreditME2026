export interface IWorkflowTransition {
  id: string;
  fromStageId: string;
  toStageId: string;
  labelEn: string;
  labelAr: string | null;
  // ACC-271 PR 6b — no old people field: whoever works the from-stage presses a
  // PERSON move.
  validatorConfig: Record<string, unknown> | null;
  isApprovalPath: boolean;
  kind: string; // WorkflowTransitionKind — ACC-190
  // ACC-271 PR 3 — who moves the record: PERSON (whoever works the from-stage)
  // or APP (the module's own code). PR 6b — the stored value only; null (none
  // exist) is a move nobody can make.
  mover: string | null; // TransitionMover
  // ACC-271 PR 3 — on an APP move, on a template read: when the app runs it (APP_MOVES).
  appMove?: { key: string; en: string; ar: string };
  actions?: IWorkflowTransitionAction[];
}

// ACC-65 — the shape of WorkflowTransition.validatorConfig, which is a raw
// Json column. Declared explicitly so the difference between "designed" and
// "enforced" is visible at the type level rather than only in
// checkValidatorConfig()'s body.
//
// step-06 §8 designed four validators. Two remain unenforced and are
// deliberately NOT declared here, because declaring them would imply the
// engine acts on them:
//
//   requiredFields  | minAttachments
//     Both describe the BUSINESS OBJECT — a document's title, its
//     attachments — which the engine never sees. They need the
//     caller-supplied object snapshot that TriggerTransitionDto does not
//     carry and that was never built. Still unenforced; still correct to
//     defer. A transition may carry them (2 seeded transitions do), and
//     they are simply ignored.
//
// The two below are enforced, and both are enforceable for the same reason:
// each is answerable from data the engine already owns, with no snapshot.
export interface ValidatorConfig {
  // Checked against this stage's own WorkflowApproval rows.
  minApprovals?: number;
  // ACC-190 — `allPreviousStageTasksComplete` (ACC-65) is RETIRED: a stage's
  // mandatory tasks now hold every ADVANCE transition out of it, on the
  // approval path too, without opting in. Saving it is refused
  // (VALIDATOR_RETIRED); a stored one is ignored with a warning log.
}

// Returned by the transition WRITE path (add/update). ACC-271 PR 6b — the
// permission warning went with the move's old permission field; the wrapper
// stays so the screens read `.transition` as before.
export interface IWorkflowTransitionWriteResult {
  transition: IWorkflowTransition;
}

export interface IWorkflowTransitionAction {
  id: string;
  workflowTransitionId: string;
  actionType: string; // WorkflowActionType
  order: number;
  isEnabled: boolean;
  configJson: Record<string, unknown> | null;
}
