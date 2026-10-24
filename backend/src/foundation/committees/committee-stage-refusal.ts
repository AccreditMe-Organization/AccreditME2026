import { COMMITTEE_ACTIONS } from '../workflow/record-registry';

/**
 * ACC-255 PR 2 — what a committee's stage refusal says (STAGE_ACTION_NOT_ALLOWED,
 * plan §7 and §16.2), naming the stage. The screens say it from the code and
 * the stage names in the body, through `committee.refusal.membersNotAllowedInStage`
 * / `editNotAllowedInStage` (and their `…NoStage` forms) in both languages; this
 * English sentence is what an API caller reads.
 *
 * A committee with no live stage (D14) has no stage name to give, so it gets
 * its own sentence rather than an empty one.
 */
const MEMBER_ACTIONS: ReadonlySet<string> = new Set([
  COMMITTEE_ACTIONS.ADD_MEMBER,
  COMMITTEE_ACTIONS.REMOVE_MEMBER,
  COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE,
]);

export function committeeStageRefusalMessage(action: string, stageNameEn: string | null): string {
  if (MEMBER_ACTIONS.has(action)) {
    return stageNameEn
      ? `Members can't be changed while the committee is ${stageNameEn}.`
      : "Members can't be changed: the committee has no current stage.";
  }
  return stageNameEn
    ? `This can't be done while the committee is in ${stageNameEn}.`
    : "This can't be done: the committee has no current stage.";
}
