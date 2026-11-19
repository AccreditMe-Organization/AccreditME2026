import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import { aMeeting } from '../../meeting-fixtures.testing';
import type { MeetingDto } from '../../services/meeting.service';
import { MeetingRescheduleDialogComponent, RESCHEDULE_REASON_MAX } from './meeting-reschedule-dialog.component';

// ACC-316 PR 6 — Reschedule meeting against the 420px body cap (ACC-111),
// MEASURED in both languages, in the real theme and font, at 1280 and on a 390
// phone: opened on the meeting's own date and time; pressed with no reason (its
// error); a realistic reason; the 500-character limit (the textarea scrolls
// inside itself, the body does not grow); the calendar, which takes the body's
// place; and refused by the server. Each body keeps 20px under the cap.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const REASON = {
  en: 'The chair is at the regional accreditation workshop on the 18th; moved to the following week.',
  ar: 'رئيس اللجنة يحضر ورشة الاعتماد الإقليمية يوم 18، فنُقل الاجتماع إلى الأسبوع التالي.',
};

@Component({
  standalone: true,
  imports: [MeetingRescheduleDialogComponent],
  template: `<app-meeting-reschedule-dialog [visible]="true" [meeting]="meeting" />`,
})
class Host {
  readonly meeting = aMeeting();
}

describe('Reschedule meeting dialog — layout, measured (ACC-316 PR 6)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();
  let respond: () => Observable<MeetingDto>;

  afterAll(() => console.log(`ACC-316 reschedule meeting dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  const textarea = () => document.querySelector<HTMLTextAreaElement>('#rescheduleReason')!;
  const type = async (value: string) => {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
    await layout.settle();
  };

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}, ${width}]: opened, with its error, filled, at the limit, the calendar, refused`, async () => {
        respond = () => of(aMeeting());
        await layout.open(Host, language, width, { reschedule: () => respond() });
        const dialog: MeetingRescheduleDialogComponent = layout.fixture.debugElement.query(By.directive(MeetingRescheduleDialogComponent)).componentInstance;
        // Non-vacuity: the meeting is named, and its own date and time are filled in.
        expect(document.querySelector('.am-dialog__context')?.textContent).toContain(aMeeting().title);
        expect((document.querySelector<HTMLInputElement>('[data-testid="reschedule-day"]')?.value ?? '').length).toBeGreaterThan(0);
        expect(dialog.form.controls.time.value).toMatch(/^\d\d:\d\d$/);
        layout.check('opened', language, width, 560);

        await layout.click('[data-testid="reschedule-submit"] button');
        expect(document.querySelector('.am-field__message--error')).withContext('the reason error').not.toBeNull();
        layout.check('with its error', language, width, 560);

        await type(REASON[language]);
        const filled = layout.check('filled', language, width, 560);
        await type('x '.repeat(RESCHEDULE_REASON_MAX / 2).trim());
        const full = layout.check('at the limit', language, width, 560, [textarea()]);
        expect(full).withContext('a long reason scrolls in its field; the body does not grow').toBe(filled);

        await layout.click('.am-mw__calendar-button');
        expect(document.querySelector('[data-testid="reschedule-date-view"]')).withContext('the calendar took the body').not.toBeNull();
        layout.check('the calendar', language, width, 560);
        await layout.click('[data-testid="reschedule-date-view"] .am-backlink');

        await type(REASON[language]);
        respond = () => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_CHANGED' } }));
        await layout.click('[data-testid="reschedule-submit"] button');
        expect(document.querySelector('[data-testid="reschedule-error"]')).withContext('the refusal').not.toBeNull();
        layout.check('refused', language, width, 560);
      }, 40_000);
    }
  }
});
