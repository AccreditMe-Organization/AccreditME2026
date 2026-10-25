import { readFileSync } from 'fs';
import { join } from 'path';
import { committeeStageRefusalMessage } from './committee-stage-refusal';

// ACC-255 PR 2 — STAGE_ACTION_NOT_ALLOWED on a committee, said in both
// languages. The server's English sentence is what an API caller reads; the
// screens say the same thing from the code and the stage names, through these
// keys (PR 3 wires them). The two must not drift: the English key, with the
// stage put in, IS the server's sentence.

const i18n = (lang: 'en' | 'ar') =>
  (JSON.parse(readFileSync(join(__dirname, '../../../../frontend/src/assets/i18n', `${lang}.json`), 'utf8')) as {
    committee: { refusal: Record<string, string> };
  }).committee.refusal;
const KEYS = ['membersNotAllowedInStage', 'membersNotAllowedNoStage', 'editNotAllowedInStage', 'editNotAllowedNoStage'];
const ARABIC = /[؀-ۿ]/;

describe('committee stage refusal wording (ACC-255 PR 2)', () => {
  it('every key exists in both languages; the stage-named ones carry {{stage}}, the no-stage ones do not', () => {
    for (const lang of ['en', 'ar'] as const) {
      const r = i18n(lang);
      for (const key of KEYS) {
        expect(typeof r[key]).toBe('string');
        expect(r[key]!.includes('{{stage}}')).toBe(key.endsWith('InStage'));
      }
    }
    for (const key of KEYS) expect(i18n('ar')[key]).toMatch(ARABIC);
  });

  it("the English keys are the server's sentences", () => {
    const en = i18n('en');
    const put = (s: string, stage: string) => s.replace('{{stage}}', stage);
    for (const action of ['add_member', 'remove_member', 'change_member_role']) {
      expect(committeeStageRefusalMessage(action, 'Dissolved')).toBe(put(en['membersNotAllowedInStage']!, 'Dissolved'));
      expect(committeeStageRefusalMessage(action, null)).toBe(en['membersNotAllowedNoStage']);
    }
    expect(committeeStageRefusalMessage('edit_details', 'Active')).toBe(put(en['editNotAllowedInStage']!, 'Active'));
    expect(committeeStageRefusalMessage('edit_details', null)).toBe(en['editNotAllowedNoStage']);
  });

  it('the Arabic follows the plan (§16.2) for members', () => {
    expect(i18n('ar')['membersNotAllowedInStage']).toBe('لا يمكن تغيير الأعضاء بينما اللجنة {{stage}}.');
  });
});
