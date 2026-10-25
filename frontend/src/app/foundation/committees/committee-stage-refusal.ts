import { refusalBody, refusalCode } from '../../core/http/refusal';

/**
 * ACC-255 PR 3 — a write the committee's stage does not allow, said in the
 * reader's words. The server refuses it with 409 STAGE_ACTION_NOT_ALLOWED and
 * names the action and the stage in both languages (ACC-241); this turns that
 * into one of four sentences (committee.refusal.*, en and ar):
 *
 *   a member change   "Members can't be changed while the committee is {stage}."
 *   anything else     "This can't be done while the committee is in {stage}."
 *
 * each with a "no current stage" form for a committee with none (D14). The
 * stage is the tenant's own name for it, picked for the reader's language at
 * render (LanguageService.bilingual), so a language switch reaches it.
 * Never the server's English `message`.
 */
export interface CommitteeStageRefusal {
  /** The translation key. */
  key: string;
  /** The stage's names, as the server sent them; both null for no stage. */
  stageNameEn: string | null;
  stageNameAr: string | null;
}

const MEMBER_ACTIONS: ReadonlySet<string> = new Set(['add_member', 'remove_member', 'change_member_role']);

/** The sentence for a STAGE_ACTION_NOT_ALLOWED refusal, or null for any other error. */
export function committeeStageRefusal(err: unknown): CommitteeStageRefusal | null {
  if (refusalCode(err) !== 'STAGE_ACTION_NOT_ALLOWED') return null;
  const body = refusalBody(err) ?? {};
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
  const stageNameEn = text(body['stageNameEn']);
  const stageNameAr = text(body['stageNameAr']);
  const members = MEMBER_ACTIONS.has(String(body['action']));
  const named = stageNameEn !== null || stageNameAr !== null;
  return {
    key: `committee.refusal.${members ? 'members' : 'edit'}NotAllowed${named ? 'InStage' : 'NoStage'}`,
    stageNameEn,
    stageNameAr,
  };
}
