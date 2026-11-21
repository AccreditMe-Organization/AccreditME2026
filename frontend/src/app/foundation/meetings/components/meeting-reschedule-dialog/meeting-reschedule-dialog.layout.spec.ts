import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import { aMeeting, aSeries } from '../../meeting-fixtures.testing';
import type { MeetingClashDto, MeetingDto } from '../../services/meeting.service';
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

/** PR 8c — who is busy at the new time: two (the design's), then six (more rows than the list shows). */
const PEOPLE = {
  en: [
    ['Omar Haddad', 'Antimicrobial Stewardship Committee · March 2027'],
    ['Eng. Khalid bin Fahad Al-Shehri', null],
    ['Dr. Huda Abdulaziz Al-Zahrani', 'Infection Prevention and Control Committee · March 2027'],
    ['Nora Al-Otaibi', null],
    ['Fahad Al-Anazi', 'Medication Safety Committee · March 2027'],
    ['Saad Al-Dosari', null],
  ],
  ar: [
    ['عمر حداد', 'لجنة ترشيد المضادات الحيوية · مارس 2027'],
    ['م. خالد بن فهد الشهري', null],
    ['د. هدى عبدالعزيز الزهراني', 'لجنة الوقاية من العدوى ومكافحتها · مارس 2027'],
    ['نورة العتيبي', null],
    ['فهد العنزي', 'لجنة سلامة الأدوية · مارس 2027'],
    ['سعد الدوسري', null],
  ],
} as const;
const busy = (language: 'en' | 'ar', n: number): MeetingClashDto => ({
  startsAt: aMeeting().scheduledAt,
  invitees: 10,
  people: PEOPLE[language].slice(0, n).map(([name, title], i) => ({
    userId: `u-${i}`,
    name,
    meetings: [{ id: title ? `o-${i}` : null, title, startsAt: aMeeting().scheduledAt, durationMinutes: 90 }],
  })),
});
const debounce = () => new Promise((r) => setTimeout(r, 320));

@Component({
  standalone: true,
  imports: [MeetingRescheduleDialogComponent],
  template: `<app-meeting-reschedule-dialog [visible]="true" [meeting]="meeting" />`,
})
class Host {
  meeting = aMeeting();
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
      // PR 8c — the clash line under the new time, collapsed and with its rows in place
      // (artboards 10–11: 383 / 416 with a Told line this dialog doesn't have).
      it(`[${language}, ${width}]: a clash at the new time, collapsed, its rows in place, six rows (scrolling), in a series`, async () => {
        let clash = busy(language, 2);
        await layout.open(Host, language, width, { reschedule: () => of(aMeeting()), clashes: () => of([clash]) }, (h) => (h.meeting = aMeeting({ series: aSeries() })));
        await debounce();
        await layout.settle();
        await type(REASON[language]);
        expect(document.querySelector('[data-testid="meeting-clash-line"]')).withContext('the clash line').not.toBeNull();
        expect(document.querySelector('[data-testid="reschedule-submit"]')?.textContent?.trim()).withContext('Next, in a series').toBe(language === 'en' ? 'Next' : 'التالي');
        layout.check('a clash, collapsed', language, width, 560);

        await layout.click('[data-testid="meeting-clash-toggle"]');
        expect(document.querySelectorAll('[data-testid="meeting-clash-rows"] li').length).toBe(2);
        layout.check('a clash, its rows in place', language, width, 560);

        clash = busy(language, 6);
        const dialog: MeetingRescheduleDialogComponent = layout.fixture.debugElement.query(By.directive(MeetingRescheduleDialogComponent)).componentInstance;
        dialog.form.controls.time.setValue('11:00');
        await debounce();
        await layout.settle();
        await layout.click('[data-testid="meeting-clash-toggle"]');
        const rows = document.querySelector<HTMLElement>('[data-testid="meeting-clash-rows"]')!;
        expect(rows.querySelectorAll('li').length).toBe(6);
        expect(rows.scrollHeight).withContext('six rows overflow the capped list').toBeGreaterThan(rows.clientHeight);
        layout.check('six people, the list scrolls', language, width, 560, [rows]);
      }, 40_000);

      it(`[${language}, ${width}]: opened, with its error, filled, at the limit, the calendar, refused`, async () => {
        respond = () => of(aMeeting());
        await layout.open(Host, language, width, { reschedule: () => respond(), clashes: () => of([]) });
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
