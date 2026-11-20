import { Component } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import { aMeeting, aSeries } from '../../meeting-fixtures.testing';
import type { MeetingEndSeriesPreviewDto } from '../../services/meeting.service';
import { END_SERIES_REASON_MAX, MeetingEndSeriesDialogComponent } from './meeting-end-series-dialog.component';

// ACC-316 PR 8d — "End the monthly series?" against the 420px body cap
// (ACC-111), MEASURED in both languages, in the real theme and font, at 1280
// (420 wide, a confirm) and on a 390 phone. The design draws 94 / 104 with the
// sentence and two pairs; the built dialog adds the reason End needs. Measured
// here: empty; with the reason's error; a realistic reason, which keeps at
// least one line to spare in its field (P256: at three rows CI's Linux fonts
// wrapped the English one to four lines and the field scrolled); the
// 500-character limit (only the field scrolls); a refused plan. Each body
// keeps 20px under the cap and scrolls nowhere else.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const at = (iso: string) => `${iso}T10:30:00.000Z`;
const PLAN: MeetingEndSeriesPreviewDto = {
  last: { id: 'm-5', startsAt: at('2026-10-22') },
  cancelled: ['2026-11-26', '2026-12-24', '2027-01-28', '2027-02-25', '2027-03-25', '2027-04-22', '2027-05-27'].map((d, i) => ({ id: `m-${i + 6}`, startsAt: at(d) })),
  held: 4,
  total: 12,
};
const REASON = {
  en: 'The committee is merging into the Quality and Patient Safety Committee from December; its agenda moves there.',
  ar: 'تندمج اللجنة في لجنة الجودة وسلامة المرضى اعتبارًا من ديسمبر، وينتقل جدول أعمالها إليها.',
};

@Component({
  standalone: true,
  imports: [MeetingEndSeriesDialogComponent],
  template: `<app-meeting-end-series-dialog [visible]="true" [meeting]="meeting" />`,
})
class Host {
  readonly meeting = aMeeting({ id: 'm-5', scheduledAt: at('2026-10-22'), series: aSeries({ index: 5, mayEnd: true }) });
}

describe('End series dialog — layout, measured (ACC-316 PR 8d)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();

  afterAll(() => console.log(`ACC-316 End series (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  const textarea = () => document.querySelector<HTMLTextAreaElement>('#endSeriesReason')!;
  const type = async (value: string) => {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
    await layout.settle();
    await layout.still();
  };

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}, ${width}]: empty, with its error, filled, at the limit`, async () => {
        await layout.open(Host, language, width, { endSeriesPreview: () => of(PLAN), endSeries: () => of({ cancelled: [], failed: [] }) });
        // Non-vacuity: the sentence, both pairs (the server's plan) and the field are drawn.
        expect(document.querySelectorAll('[data-testid="end-series-pairs"] dd').length).toBe(2);
        expect(document.querySelector('[data-testid="end-series-cancelled"]')?.textContent).toMatch(/7/);
        expect(textarea()).not.toBeNull();
        layout.check('empty', language, width, 420);

        await layout.click('[data-testid="end-series-submit"] button');
        expect(document.querySelector('.am-field__message--error')).withContext('the error is showing').not.toBeNull();
        layout.check('with its error', language, width, 420);

        await type(REASON[language]);
        // A line to spare: what the reason needs (the box shrunk to nothing), plus one line, fits the box.
        const box = textarea().clientHeight;
        const line = parseFloat(getComputedStyle(textarea()).lineHeight);
        textarea().style.height = '0px';
        const needs = textarea().scrollHeight;
        textarea().style.height = '';
        expect(needs).withContext('non-vacuity: the reason takes more than one line').toBeGreaterThan(2 * line);
        expect(needs + line).withContext(`a realistic reason [${language}, ${width}] needs ${needs}px of a ${box}px box, ${line}px a line`).toBeLessThanOrEqual(box + 1);
        const filled = layout.check('a realistic reason', language, width, 420);

        await type('x '.repeat(END_SERIES_REASON_MAX / 2).trim());
        const full = layout.check('at the limit', language, width, 420, [textarea()]);
        expect(full).withContext('a long reason scrolls in its field; the body does not grow').toBe(filled);
      }, 40_000);

      it(`[${language}, ${width}]: a refused plan`, async () => {
        await layout.open(Host, language, width, {
          endSeriesPreview: () => throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'MEETING_SERIES_CANNOT_CANCEL' } })),
          endSeries: () => of({ cancelled: [], failed: [] }),
        });
        expect(document.querySelector('[data-testid="end-series-preview-error"]')).withContext('the refusal').not.toBeNull();
        layout.check('a refused plan', language, width, 420);
      }, 40_000);
    }
  }
});
