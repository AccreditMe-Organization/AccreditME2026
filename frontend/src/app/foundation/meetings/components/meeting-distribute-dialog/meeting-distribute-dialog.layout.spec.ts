import { Component, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError, type Observable } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import { aMinutes, anAttendanceRow } from '../../meeting-fixtures.testing';
import type { MeetingMinutesDto } from '../../services/meeting.service';
import { MeetingDistributeDialogComponent } from './meeting-distribute-dialog.component';

// ACC-316 PR 7b — Distribute Minutes? against the 420px body cap (ACC-111),
// MEASURED in both languages at 1280 (a confirm, 420 wide) and on a 390 phone:
// ready, refused (said in the body), and blocked by incomplete attendance with
// five people missing. The design measured 185 / 200. Each keeps 20px.
// ACC-322 PR 2 (M2): "ready" carries the undecided-AI line ("3 AI suggestions
// undecided will be discarded."), the design's +21 EN / +24 AR, re-measured.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const READY = aMinutes({
  attendance: [anAttendanceRow({ attendance: 'PRESENT' }), anAttendanceRow({ attendeeId: 'a-2', userId: 'u-2', name: 'Huda Al-Harbi', attendance: 'PRESENT' })],
  distribute: { ready: true, blockedBy: null, defaultReviewBy: '2027-03-25', aiUndecided: 3 },
});
const BLOCKED = aMinutes({
  distribute: {
    ready: false,
    blockedBy: {
      code: 'MEETING_ATTENDANCE_INCOMPLETE',
      missing: ['Dr. Nora Al-Otaibi', 'Huda Al-Harbi', 'Eng. Saad Al-Dosari', 'Dr. Khalid Al-Mutairi', 'Fatima Al-Anazi'].map((name, i) => ({ attendeeId: `a-${i}`, name })),
    },
    defaultReviewBy: '2027-03-25',
    aiUndecided: 0,
  },
});

@Component({
  standalone: true,
  imports: [MeetingDistributeDialogComponent],
  template: `<app-meeting-distribute-dialog [visible]="true" meetingId="m-1" context="Infection Prevention & Control · 24 Sep" [minutes]="minutes()" />`,
})
class Host {
  readonly minutes = signal<MeetingMinutesDto>(READY);
}

describe('Distribute Minutes dialog — layout, measured (ACC-316 PR 7b)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();
  let respond: () => Observable<void>;

  afterAll(() => console.log(`ACC-316 distribute minutes dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}, ${width}]: ready, refused, and blocked by attendance`, async () => {
        respond = () => of(undefined);
        await layout.open(Host, language, width, { distribute: () => respond() });
        // Non-vacuity: the date field is there, on the server's default.
        expect(document.querySelector<HTMLInputElement>('[data-testid="distribute-review-by"]')?.value).toBeTruthy();
        expect(document.querySelector('[data-testid="distribute-ai-undecided"]')).withContext('the M2 line is in the measurement').not.toBeNull();
        layout.check('ready, with the M2 line', language, width, 420);

        respond = () => throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'MEETING_REVIEW_DATE_INVALID' } }));
        await layout.click('[data-testid="distribute-submit"] button');
        expect(document.querySelector('[data-testid="distribute-error"]')).withContext('the refusal').not.toBeNull();
        layout.check('refused', language, width, 420);

        layout.destroy();
        await layout.open(Host, language, width, { distribute: () => respond() }, (h) => h.minutes.set(BLOCKED));
        expect(document.querySelectorAll('[data-testid="distribute-blocked"] li').length).toBe(5);
        layout.check('blocked, five missing', language, width, 420);
      }, 40_000);
    }
  }
});
