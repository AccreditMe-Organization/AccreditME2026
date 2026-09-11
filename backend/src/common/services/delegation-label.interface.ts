// ACC-40 §2.6.3 stamps the SAME delegation pair — delegationReason +
// delegationContextId — on three different models: TaskAssignee,
// WorkflowInstanceStage, and WorkflowApproval. It records WHY an actor was
// eligible, not just who acted.
//
// This interface lives in common/ rather than inside either consuming module
// because both the Task list and the workflow stage history need to resolve
// the same stamp, and neither owns it. Same reasoning as
// permission-resolver.interface.ts alongside it.

export type DelegationReasonValue = 'ACTING_HEAD' | 'OUT_OF_OFFICE_COVERAGE';

// The stamp as it reaches a client, with contextId already resolved to a name.
//
// WHY THE LABEL IS RESOLVED SERVER-SIDE: delegationContextId is polymorphic —
// it holds an OrgUnit id for ACTING_HEAD and the covered-for USER's id for
// OUT_OF_OFFICE_COVERAGE (schema.prisma:961-964). A client cannot resolve it
// without first knowing the reason and then knowing which table each reason
// points at. Pushing that branch to every consumer would duplicate the
// mapping and invite one of them to get it wrong silently.
//
// BILINGUAL PAIR, NOT ONE STRING: an OrgUnit carries nameEn/nameAr, and
// SYSTEM-REFERENCE §9.3 requires tenant-editable data be rendered by
// isArabic()-selection, never `| translate`. A User has a single `name`, so
// for OUT_OF_OFFICE_COVERAGE both fields carry that same name — deliberately
// uniform, so a consumer renders one way regardless of reason.
export interface IResolvedDelegation {
  reason: DelegationReasonValue;
  contextId: string;
  // Null when the referenced OrgUnit/User no longer resolves within the
  // tenant. Consumers render the actor with NO qualifier in that case —
  // never a raw id, which would be worse than saying nothing.
  contextLabelEn: string | null;
  contextLabelAr: string | null;
}
