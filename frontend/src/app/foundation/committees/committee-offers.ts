import type { CommitteeMemberActionsDto, CommitteeStageRulesDto } from './services/committee.service';

/**
 * ACC-255 PR 3 — what the committee page offers, from the SERVER's answer for
 * the committee's current stage (`stageRules` on GET /committees/:id), combined
 * with the person's own permission for each action. No stage key, name or
 * order is read here, so a tenant who renames, re-keys or reconfigures a stage
 * gets the page their configuration says. The server refuses the same writes
 * with STAGE_ACTION_NOT_ALLOWED (ACC-241); this is only what the page shows.
 *
 *   edit              Edit (the three-tab dialog): committees:edit_details AND
 *                     the stage allows edit_details.
 *   lockedLine        "Locked while the terms are under review…": said to the
 *                     people who could edit, when the stage allows no edit and
 *                     the committee is neither in force nor being dissolved —
 *                     Terms Review, on the seeded workflow (plan §6.2, D11).
 *   addMember,
 *   removeMember,
 *   changeMemberRole  ACC-283 PR 6 — the server's `memberActions` for the action
 *                     (its permission, or the viewer's SEAT on this committee:
 *                     member-actions.ts is the rule, never copied here) AND the
 *                     stage allows it. So a dissolved committee offers none
 *                     (Ahmad, Q-A), and one being dissolved still offers them.
 *   changeOwnSeat     Change seat on the viewer's OWN row: changeMemberRole AND
 *                     the viewer holds committees:change_member_role. A seat
 *                     never changes its holder's own seat (the server's
 *                     SEAT_NEVER_ON_OWN_ROW), so on the seat alone the item is
 *                     absent. Remove on your own row is removeMember, as on any
 *                     row: leaving is not an escalation.
 *
 * ACC-283 — Edit and the locked line also need the server's `mayWrite` (GET
 * /committees/:id): committees:view, or an active member of THIS committee. A
 * unit head who only oversees the committee reads it false, so they are offered
 * no Edit, whatever their permissions. The four member actions need no separate
 * flag: `memberActions` already reads false for anyone who may not write.
 * Callers pass the server's answers; this is the one place they are combined.
 *
 * Request a change is not decided here: it follows the server's own canRaise,
 * which since ACC-283 PR 6 is memberActions.request_change AND the stage AND no
 * open request. Copying any of it here would be a second copy (ACC-240).
 * The header's transition buttons stay as the live workflow renders them.
 */
export interface CommitteeOffers {
  edit: boolean;
  lockedLine: boolean;
  addMember: boolean;
  removeMember: boolean;
  /** Change seat on another member's row. */
  changeMemberRole: boolean;
  /** Change seat on the viewer's own row (see above). */
  changeOwnSeat: boolean;
}

/** The viewer's own permissions this page still reads: Edit's, and the own-row rule's. */
export interface CommitteePermissions {
  editDetails: boolean;
  changeMemberRole: boolean;
}

/**
 * The stage meanings the committee screens read, as the server names them
 * (STAGE_FLAGS). The page's offers and the list's status (ACC-256) read the
 * same two names, from here.
 */
export const STAGE_FLAG_IN_FORCE = 'IN_FORCE';
export const STAGE_FLAG_DISSOLVING = 'DISSOLVING';

/** Nothing allowed and no meaning: what a committee with no live stage reads as (D14). */
export const NO_STAGE_RULES: CommitteeStageRulesDto = {
  actions: { edit_details: false, add_member: false, remove_member: false, change_member_role: false, request_change: false },
  flags: [],
};

/** What a committee read without memberActions allows: nothing (fail closed). */
export const NO_MEMBER_ACTIONS: CommitteeMemberActionsDto = {
  add_member: false,
  remove_member: false,
  change_member_seat: false,
  request_change: false,
};

export function committeeOffers(
  rules: CommitteeStageRulesDto | null | undefined,
  can: CommitteePermissions,
  mayWrite: boolean,
  memberActions: CommitteeMemberActionsDto | null | undefined,
): CommitteeOffers {
  const stage = rules ?? NO_STAGE_RULES;
  const allows = stage.actions;
  const member = memberActions ?? NO_MEMBER_ACTIONS;
  const meaning = (flag: string): boolean => stage.flags.includes(flag);
  const changeMemberRole = member.change_member_seat && allows.change_member_role;
  return {
    edit: mayWrite && can.editDetails && allows.edit_details,
    lockedLine:
      mayWrite && can.editDetails && !allows.edit_details && !meaning(STAGE_FLAG_IN_FORCE) && !meaning(STAGE_FLAG_DISSOLVING),
    addMember: member.add_member && allows.add_member,
    removeMember: member.remove_member && allows.remove_member,
    changeMemberRole,
    changeOwnSeat: changeMemberRole && can.changeMemberRole,
  };
}
