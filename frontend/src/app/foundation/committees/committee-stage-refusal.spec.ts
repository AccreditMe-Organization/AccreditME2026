import { HttpErrorResponse } from '@angular/common/http';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { committeeStageRefusal } from './committee-stage-refusal';

// ACC-255 PR 3 — STAGE_ACTION_NOT_ALLOWED said in the reader's words: which of
// the four sentences, and that each exists in both languages (gender-neutral
// Arabic, as the plan's §16.2 writes it).

const refusal = (body: Record<string, unknown>) => new HttpErrorResponse({ status: 409, error: { code: 'STAGE_ACTION_NOT_ALLOWED', ...body } });
type Refusals = Record<string, string>;
const words = (lang: { committee: { refusal: Refusals } }) => lang.committee.refusal;

describe('committeeStageRefusal (ACC-255)', () => {
  it('a member change gets the members sentence; anything else the edit one', () => {
    for (const action of ['add_member', 'remove_member', 'change_member_role']) {
      expect(committeeStageRefusal(refusal({ action, stageNameEn: 'Dissolved', stageNameAr: 'محلولة' }))?.key).toBe(
        'committee.refusal.membersNotAllowedInStage',
      );
    }
    expect(committeeStageRefusal(refusal({ action: 'edit_details', stageNameEn: 'Active', stageNameAr: null }))).toEqual({
      key: 'committee.refusal.editNotAllowedInStage',
      stageNameEn: 'Active',
      stageNameAr: null,
    });
  });

  it('a committee with no current stage gets the no-stage sentence', () => {
    expect(committeeStageRefusal(refusal({ action: 'add_member', stageNameEn: null, stageNameAr: null }))?.key).toBe(
      'committee.refusal.membersNotAllowedNoStage',
    );
    expect(committeeStageRefusal(refusal({ action: 'edit_details' }))?.key).toBe('committee.refusal.editNotAllowedNoStage');
  });

  it('any other error is not a stage refusal', () => {
    expect(committeeStageRefusal(new HttpErrorResponse({ status: 409, error: { code: 'COMMITTEE_CHANGED' } }))).toBeNull();
    expect(committeeStageRefusal(new HttpErrorResponse({ status: 409 }))).toBeNull();
    expect(committeeStageRefusal(new Error('offline'))).toBeNull();
  });

  it('all four sentences exist in English and Arabic; the stage-named ones name the stage', () => {
    for (const key of ['membersNotAllowedInStage', 'membersNotAllowedNoStage', 'editNotAllowedInStage', 'editNotAllowedNoStage']) {
      for (const lang of [en, ar]) {
        const text = words(lang as never)[key];
        expect(typeof text).withContext(key).toBe('string');
        expect(text.includes('{{stage}}')).withContext(key).toBe(key.endsWith('InStage'));
      }
    }
    expect(words(ar as never)['membersNotAllowedInStage']).toBe('لا يمكن تغيير الأعضاء بينما اللجنة {{stage}}.');
  });
});
