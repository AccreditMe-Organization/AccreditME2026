import { Component } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import { aMinutes, aMinutesItem, anAttendanceRow } from '../../meeting-fixtures.testing';
import type { MeetingSuggestionDto } from '../../services/meeting.service';
import { MeetingSuggestDialogComponent } from './meeting-suggest-dialog.component';
import { MeetingDeclineDialogComponent } from '../meeting-decline-dialog/meeting-decline-dialog.component';
import { MeetingReturnDialogComponent } from '../meeting-return-dialog/meeting-return-dialog.component';

// ACC-316 PR 7c-1 — the review dialogs against the 420px body cap (ACC-111),
// MEASURED in both languages at 1280 and on a 390 phone: each with its error
// showing, and refused (said in the footer or the body). The design measured
// Suggest 210 / 226, Decline 173 / 190, Return 225 / 246. Each keeps 20px.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const LONG = {
  en: 'Say where patients needing isolation go while room 3 is closed, and who decides when a second room is needed during the repair.',
  ar: 'اذكروا أين يُنقل المرضى الذين يحتاجون العزل أثناء إغلاق الغرفة 3، ومن يقرر الحاجة إلى غرفة ثانية أثناء الإصلاح.',
};
const SUGGESTION: MeetingSuggestionDto = {
  id: 's-1',
  round: 1,
  agendaItemId: 'i-4',
  author: { id: 'u-3', name: 'Dr. Sara Al-Qahtani' },
  text: LONG.en,
  status: 'OPEN',
  reply: null,
  createdAt: '2027-03-19T08:00:00.000Z',
  decidedAt: null,
};

@Component({
  standalone: true,
  imports: [MeetingSuggestDialogComponent],
  template: `<app-meeting-suggest-dialog [visible]="true" meetingId="m-1" [items]="items" about="i-4" />`,
})
class SuggestHost {
  readonly items = [aMinutesItem({ id: 'i-4', order: 4, title: 'Isolation room maintenance' })];
}

@Component({
  standalone: true,
  imports: [MeetingDeclineDialogComponent],
  template: `<app-meeting-decline-dialog [visible]="true" meetingId="m-1" [suggestion]="suggestion" [itemOrder]="4" />`,
})
class DeclineHost {
  readonly suggestion = SUGGESTION;
}

@Component({
  standalone: true,
  imports: [MeetingReturnDialogComponent],
  template: `<app-meeting-return-dialog [visible]="true" meetingId="m-1" context="Infection Prevention & Control · 24 Sep" [minutes]="minutes" />`,
})
class ReturnHost {
  readonly minutes = aMinutes({
    phase: 'review',
    attendance: [anAttendanceRow({ attendance: 'PRESENT' })],
    review: { round: 1, reviewBy: '2027-03-25', datePassed: false, closed: false, reviewers: [{ userId: 'u-1', name: 'N', answered: true }], suggestions: [SUGGESTION], changes: [], mine: null },
  });
}

describe('Review dialogs — layout, measured (ACC-316 PR 7c-1)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const suggest = new DialogLayout<SuggestHost>();
  const decline = new DialogLayout<DeclineHost>();
  const ret = new DialogLayout<ReturnHost>();
  const refuse = (code: string) => () => throwError(() => new HttpErrorResponse({ status: 400, error: { code } }));

  afterAll(() =>
    console.log(`ACC-316 review dialogs (cap ${CAP}, room ≥ ${ROOM}):\n  ${[...suggest.measured, ...decline.measured, ...ret.measured].join('\n  ')}`),
  );
  afterEach(() => {
    suggest.destroy();
    decline.destroy();
    ret.destroy();
  });

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}, ${width}]: Suggest, Decline and Return, each with its error and refused`, async () => {
        await suggest.open(SuggestHost, language, width, { suggest: refuse('MEETING_NOT_REVIEWER') });
        expect(document.querySelector('[data-testid="suggest-text"]')).not.toBeNull();
        await suggest.click('[data-testid="suggest-submit"] button');
        expect(document.querySelector('.am-field__message--error')).withContext('the text error').not.toBeNull();
        suggest.check('suggest, with its error', language, width, 560);
        const text = document.querySelector<HTMLTextAreaElement>('[data-testid="suggest-text"]')!;
        text.value = LONG[language];
        text.dispatchEvent(new Event('input'));
        await suggest.click('[data-testid="suggest-submit"] button');
        expect(document.querySelector('[data-testid="suggest-error"]')).withContext('the refusal').not.toBeNull();
        suggest.check('suggest, refused', language, width, 560, [text]);
        suggest.destroy();

        await decline.open(DeclineHost, language, width, { declineSuggestion: refuse('MEETING_SUGGESTION_DECIDED') });
        expect(document.querySelector('[data-testid="decline-quote"]')?.textContent).toContain('isolation');
        await decline.click('[data-testid="decline-submit"] button');
        expect(document.querySelector('.am-field__message--error')).withContext('the reply error').not.toBeNull();
        decline.check('decline, with its error', language, width, 420);
        const reply = document.querySelector<HTMLTextAreaElement>('[data-testid="decline-reply"]')!;
        reply.value = LONG[language];
        reply.dispatchEvent(new Event('input'));
        await decline.click('[data-testid="decline-submit"] button');
        expect(document.querySelector('[data-testid="decline-error"]')).withContext('the refusal').not.toBeNull();
        decline.check('decline, refused', language, width, 420, [reply]);
        decline.destroy();

        await ret.open(ReturnHost, language, width, { returnMinutes: refuse('STAGE_ACTION_NOT_ALLOWED') });
        expect(document.querySelector('[data-testid="return-pairs"]')).not.toBeNull();
        const reason = document.querySelector<HTMLTextAreaElement>('[data-testid="return-reason"]')!;
        reason.value = LONG[language];
        reason.dispatchEvent(new Event('input'));
        await ret.click('[data-testid="return-submit"] button');
        expect(document.querySelector('[data-testid="return-error"]')).withContext('the refusal').not.toBeNull();
        ret.check('return, refused', language, width, 420, [reason]);
      }, 60_000);
    }
  }
});
