import type { ILookupValue } from '../../lookup/interfaces/lookup-value.interface';
import type { IOrgUnit } from '../../organization/interfaces/org-unit.interface';

/**
 * ACC-255 — what the committee's CURRENT STAGE allows to be done to it, and
 * what that stage means, from the workflow engine's own answer
 * (StageRulesService), never from a stage key. The stage only narrows: a
 * screen still needs the person's permission for each action. Nothing decides
 * by this yet (PR 2 switches the writes; PR 3 the screens).
 */
export interface ICommitteeStageRules {
  actions: {
    edit_details: boolean;
    add_member: boolean;
    remove_member: boolean;
    change_member_role: boolean;
    request_change: boolean;
  };
  flags: string[];
}

/**
 * ACC-255 (plan §10.5) — what the committee dialogs choose from, for anyone
 * who may create or edit a committee: exactly what
 * GET /lookups/categories/committee_type/values and GET /organization/units/flat
 * serve, without their lookups:view and org:view gates. No person data.
 */
export interface ICommitteeFormChoices {
  committeeTypes: ILookupValue[];
  orgUnits: IOrgUnit[];
}

export interface ICommittee {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string | null;
  typeValueId: string;
  purpose: string | null;
  quorumCount: number;
  meetingFrequency: string;
  parentCommitteeId: string | null;
  // ACC-135 — the org unit that owns this committee. Nullable in the column for
  // the expand step only (see schema.prisma); the service always writes one, and
  // the contract migration makes it NOT NULL.
  orgUnitId: string | null;
  // Nullable, deliberately unpopulated until Document Management ships
  // (ACC-22 Pending Discussion #1) — see committee.service.ts.
  termsOfReferenceDocumentId: string | null;
  // ACC-135 — a committee, or nothing. The "mutually exclusive with
  // reportingToRoleId, enforced at the service layer" claim this comment used to
  // carry was never true: no such check existed anywhere in the service.
  reportingToCommitteeId: string | null;
  formedAt: Date | null;
  dissolvedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ACC-76 — a committee as it appears in a LIST, with the two facts a reader
// needs to judge it at a glance and which the row itself cannot supply.
//
// Separate from ICommittee for the reason ACC-74 established the hard way:
// an optional field populated by exactly one endpoint is a trap. Role-list
// bound to `permissions?.length` and rendered 0 for every role, silently,
// forever. A distinct type makes the two cases impossible to confuse.
//
// Both fields come from ONE batched query each across the whole list — never
// per row. At ~110ms a round trip, a per-row lookup over a dozen committees
// is the difference between a page and a wait.
export interface ICommitteeListItem extends ICommittee {
  memberCount: number;
  // The committee's live workflow stage, read from the engine rather than
  // stored on Committee (ACC-22 Pending Discussion #5). Null when no workflow
  // instance exists for it, or when the instance sits at no stage.
  //
  // Tenant-editable data: rendered by isArabic() selection, never
  // `| translate` (SYSTEM-REFERENCE §9.3).
  currentStageNameEn: string | null;
  currentStageNameAr: string | null;
  // ACC-233 / ACC-255 — whether the current stage is flagged DISSOLVING (being
  // dissolved, or has been). The dialog's pickers leave those committees out;
  // the server decides. No stage KEY is sent (ACC-265): screens decide by
  // stageRules, and committees.service.spec.ts fails if one comes back.
  isDissolving: boolean;
  // ACC-246 — the committee's own type, with its label: the Edit dialog shows
  // it at once, and still shows one no longer offered. Null for an id that is
  // no committee type in this organisation.
  typeValue: ICommitteeTypeValue | null;
  // ACC-255 — what the current stage allows and means.
  stageRules: ICommitteeStageRules;
}

// ACC-238 — a single committee as its record page reads it: the row plus
// whether its current stage is dissolving, from the same helper as the list
// rows, and what that stage allows (stageRules). No stage key (ACC-265).
// Separate from ICommittee for ICommitteeListItem's reason: an optional field
// filled by one endpoint is a trap.
export interface ICommitteeDetail extends ICommittee {
  isDissolving: boolean;
  typeValue: ICommitteeTypeValue | null;
  // ACC-265 — the owning unit, named, so the record page needs no unit list
  // (GET /organization/units/flat needs org:view, which a committee reader may
  // not hold). Null for a committee with no unit, or an id that is no unit in
  // this organisation.
  orgUnit: ICommitteeOrgUnit | null;
  // ACC-255 — what the current stage allows and means.
  stageRules: ICommitteeStageRules;
}

/** ACC-265 — the committee's owning unit, as the record page names it. */
export interface ICommitteeOrgUnit {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

/** ACC-246 — see committee-type-values.ts. */
export interface ICommitteeTypeValue {
  id: string;
  key: string;
  labelEn: string;
  labelAr: string | null;
  /** Whether the type picker still offers it as a choice. */
  offered: boolean;
}

export interface ICommitteeMember {
  id: string;
  organizationId: string;
  committeeId: string;
  userId: string;
  roleValueId: string;
  joinedAt: Date;
  leftAt: Date | null;
  // Derived STRICTLY from leftAt at the service layer (isActive = leftAt
  // === null) — never set independently (ACC-22 Pending Discussion #6).
  isActive: boolean;
}

export interface ICommitteeMembershipEvent {
  id: string;
  organizationId: string;
  committeeId: string;
  userId: string;
  roleValueId: string;
  action: 'JOINED' | 'LEFT' | 'ROLE_CHANGED';
  effectiveDate: Date;
  reason: string | null;
  approvedBy: string | null;
  createdAt: Date;
}

// ACC-230 — one row of the Members panel and its "See all" list: the member,
// named, with the seat as the tenant names it (the committee_member_role
// lookup, overrides applied). Active members only.
export interface ICommitteeMemberRow {
  id: string;
  userId: string;
  name: string;
  roleValueId: string;
  roleLabelEn: string | null;
  roleLabelAr: string | null;
  joinedAt: Date;
}

// ACC-230 — one row of the Sub-committees panel and its "See all" list.
export interface ISubCommitteeRow {
  id: string;
  nameEn: string;
  nameAr: string | null;
  // The live workflow stage, as listCommittees reads it; null with none.
  stageNameEn: string | null;
  stageNameAr: string | null;
  memberCount: number;
}

export interface ICommitteePage<T> {
  items: T[];
  /** Every row there is (active members, or children), before the search. */
  total: number;
  /** The rows the search matches. */
  matching: number;
}
