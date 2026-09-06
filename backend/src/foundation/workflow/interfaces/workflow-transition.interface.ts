export interface IWorkflowTransition {
  id: string;
  fromStageId: string;
  toStageId: string;
  labelEn: string;
  labelAr: string;
  requiredPermission: string | null;
  triggerCondition: string; // WorkflowTriggerCondition
  triggerUserId: string | null;
  triggerRoleId: string | null;
  validatorConfig: Record<string, unknown> | null;
  isApprovalPath: boolean;
  actions?: IWorkflowTransitionAction[];
}

// ACC-55 — why a transition's requiredPermission may not do what the
// configurer intends. Both are WARNINGS, never rejections: the save always
// succeeds and the value is written exactly as supplied.
//
// Reachability, since ACC-55's picker means a user can no longer TYPE an
// arbitrary string (traced, not assumed — both warnings are live code):
//   - UNKNOWN_PERMISSION still fires whenever a transition that ALREADY holds
//     an unknown value is re-saved. The editor surfaces such a value as a
//     selectable option so it round-trips, so editing any of the 45 seeded
//     capa:*/incidents:manage transitions reaches this. It is also reachable
//     via the API directly, which accepts any string. What is no longer
//     reachable is a newly INVENTED unknown value through the UI — so this
//     warning's role narrowed from "catch a fresh typo" to "flag a
//     pre-existing unknown value whenever that transition is touched".
//   - NO_ACTIVE_ROLE_HOLDS is unaffected: pick any real permission no active
//     role in the tenant holds.
// Seeding reaches neither — seedDefaultWorkflows() writes via
// prisma.workflowTransition.create() directly, bypassing addTransition().
//
//   UNKNOWN_PERMISSION    no Permission row matches this module:action.
//                         Deliberately does NOT distinguish a typo from a
//                         forward reference — 45 seeded transitions across
//                         every tenant legitimately carry strings for
//                         unbuilt modules (capa:investigate, capa:approve,
//                         capa:close, incidents:manage — declared as
//                         intentional at workflow.seed.ts:66-81). Nothing
//                         at write time can tell those apart from
//                         'committees:aprove', so this reports the fact and
//                         leaves the judgement to the human.
//
//   NO_ACTIVE_ROLE_HOLDS  the string is real, but no ACTIVE role in this
//                         tenant grants it, so triggerTransition()'s
//                         userPermissions.includes() check can never pass
//                         for anyone. This is the failure mode that is
//                         genuinely undetected at runtime for ROLE_BASED
//                         transitions (ACC-56).
//
// Checked in that order and only the first is reported — an unknown string
// is trivially also held by nobody, and saying both would imply two
// separate problems.
export type TransitionPermissionWarning = 'UNKNOWN_PERMISSION' | 'NO_ACTIVE_ROLE_HOLDS';

// Returned by the transition WRITE path only (add/update), never by reads.
// Deliberate: resolving the warning costs two queries per transition, and
// getTemplate() returns every transition in a template at once — making this
// part of IWorkflowTransition would turn one template read into dozens of
// extra round-trips for a hint only the editing screen consumes.
export interface IWorkflowTransitionWriteResult {
  transition: IWorkflowTransition;
  permissionWarning: TransitionPermissionWarning | null;
}

export interface IWorkflowTransitionAction {
  id: string;
  workflowTransitionId: string;
  actionType: string; // WorkflowActionType
  order: number;
  isEnabled: boolean;
  configJson: Record<string, unknown> | null;
}
