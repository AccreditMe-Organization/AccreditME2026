import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import { aMinutes, anAttendanceRow } from '../../meeting-fixtures.testing';
import type { MeetingMinutesDto } from '../../services/meeting.service';
import { MeetingActionDialogComponent } from './meeting-action-dialog.component';

// ACC-316 PR 7b — Raise action item against the 420px body cap (ACC-111),
// MEASURED in both languages, in the real theme and font, at 1280 (the form's
// 560) and on a 390 phone: empty; pressed with nothing (every error); filled
// with a long title; and refused (said in the footer, never the body). The
// design measured 170 / 180. Each body keeps 20px under the cap.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const LONG = {
  en: 'Repair the negative-pressure alarm in isolation room 3, Tower A, and report the sensor test results to the committee',
  ar: 'إصلاح إنذار الضغط السلبي في غرفة العزل 3، البرج أ، وعرض نتائج اختبار الحساس على اللجنة',
};

@Component({
  standalone: true,
  imports: [MeetingActionDialogComponent],
  template: `<app-meeting-action-dialog [visible]="true" meetingId="m-1" [item]="item" [attendance]="attendance" />`,
})
class Host {
  readonly item = { id: 'i-4', order: 4, title: 'Isolation room maintenance' };
  readonly attendance = [anAttendanceRow(), anAttendanceRow({ attendeeId: 'a-3', kind: 'ORG_GUEST', userId: 'u-3', name: 'Eng. Khalid Al-Shehri', seat: null })];
}

describe('Raise action item dialog — layout, measured (ACC-316 PR 7b)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();
  let respond: () => Observable<MeetingMinutesDto>;

  afterAll(() => console.log(`ACC-316 raise action item dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  const dialog = (): MeetingActionDialogComponent => layout.fixture.debugElement.query(By.directive(MeetingActionDialogComponent)).componentInstance;

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}, ${width}]: empty, with every error, filled, and refused`, async () => {
        respond = () => of(aMinutes());
        await layout.open(Host, language, width, { addAction: () => respond() });
        // Non-vacuity: the item is named, and the fields are there.
        expect(document.querySelector('.am-dialog__context')?.textContent).toContain('Isolation room maintenance');
        expect(document.querySelector('[data-testid="action-title"]')).not.toBeNull();
        layout.check('empty', language, width, 560);

        await layout.click('[data-testid="action-submit"] button');
        expect(document.querySelector('.am-field__message--error')).withContext('the errors').not.toBeNull();
        layout.check('with every error', language, width, 560);

        dialog().form.patchValue({ title: LONG[language], ownerUserId: 'u-3', time: '13:00' });
        dialog().pickDay(new Date(2027, 2, 30));
        await layout.settle();
        const filled = layout.check('filled', language, width, 560);

        respond = () => throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'MEETING_ACTION_DUE_IN_PAST' } }));
        await layout.click('[data-testid="action-submit"] button');
        expect(document.querySelector('[data-testid="action-error"]')).withContext('the refusal, in the footer').not.toBeNull();
        expect(layout.check('refused', language, width, 560)).withContext('the refusal never grows the body').toBe(filled);
      }, 40_000);
    }
  }
});
