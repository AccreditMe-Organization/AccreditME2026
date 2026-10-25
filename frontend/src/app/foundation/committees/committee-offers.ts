import type { CommitteeStageRulesDto } from './services/committee.service';

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
 *   changeMemberRole  each its own permission AND the stage allows it. So a
 *                     dissolved committee offers none (Ahmad, Q-A), and one
 *                     being dissolved still offers them.
 *
 * Request a change is not decided here: it follows the server's own canRaise.
 * The header's transition buttons stay as the live workflow renders them.
 */
export interface CommitteeOffers {
  edit: boolean;
  lockedLine: boolean;
  addMember: boolean;
  removeMember: boolean;
  changeMemberRole: boolean;
}

export interface CommitteePermissions {
  editDetails: boolean;
  addMember: boolean;
  removeMember: boolean;
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

export function committeeOffers(rules: CommitteeStageRulesDto | null | undefined, can: CommitteePermissions): CommitteeOffers {
  const stage = rules ?? NO_STAGE_RULES;
  const allows = stage.actions;
  const meaning = (flag: string): boolean => stage.flags.includes(flag);
  return {
    edit: can.editDetails && allows.edit_details,
    lockedLine: can.editDetails && !allows.edit_details && !meaning(STAGE_FLAG_IN_FORCE) && !meaning(STAGE_FLAG_DISSOLVING),
    addMember: can.addMember && allows.add_member,
    removeMember: can.removeMember && allows.remove_member,
    changeMemberRole: can.changeMemberRole && allows.change_member_role,
  };
}
