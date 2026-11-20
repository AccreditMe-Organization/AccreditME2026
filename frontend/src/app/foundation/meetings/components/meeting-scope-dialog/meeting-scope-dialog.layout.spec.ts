import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import { aMeeting, aSeries } from '../../meeting-fixtures.testing';
import type { MeetingClashDto, MeetingScopePreviewDto, MeetingScopePreviewRequest } from '../../services/meeting.service';
import { MeetingScopeDialogComponent } from './meeting-scope-dialog.component';

// ACC-316 PR 8c — "Which meetings change?" against the 420px body cap
// (ACC-111), MEASURED in both languages, in the real theme and font, at 1280
// (420 wide, a confirm) and on a 390 phone. The design draws 175 / 192 with
// "This meeting only" and a kept line, and 304 / 334 with "This and all later"
// and two clash rows (artboards 10–11). Measured here: each choice with its
// clash line collapsed and expanded; two kept lines and "and n more"; many
// clash rows (the list scrolls inside itself); a refused preview. Each body
// keeps 20px under the cap and scrolls nowhere else.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const CHANGE: MeetingScopePreviewRequest = { change: 'RESCHEDULE', scheduledAt: '2027-03-18T11:30:00.000Z' };
const DAYS = ['2027-03-18', '2027-04-22', '2027-05-27', '2027-06-24', '2027-07-22', '2027-08-26', '2027-09-23', '2027-10-28'];
const NAMES = {
  en: [
    ['Omar Haddad', 'Antimicrobial Stewardship Committee · May 2027'],
    ['Dr. Huda Abdulaziz Al-Zahrani', null],
    ['Eng. Khalid bin Fahad Al-Shehri', 'Infection Prevention and Control Committee · July 2027'],
    ['Nora Al-Otaibi', null],
    ['Fahad Al-Anazi', 'Medication Safety Committee · September 2027'],
  ],
  ar: [
    ['عمر حداد', 'لجنة ترشيد المضادات الحيوية · مايو 2027'],
    ['د. هدى عبدالعزيز الزهراني', null],
    ['م. خالد بن فهد الشهري', 'لجنة الوقاية من العدوى ومكافحتها · يوليو 2027'],
    ['نورة العتيبي', null],
    ['فهد العنزي', 'لجنة سلامة الأدوية · سبتمبر 2027'],
  ],
} as const;

const clashOn = (day: string, language: 'en' | 'ar', who: number): MeetingClashDto => {
  const [name, title] = NAMES[language][who]!;
  return { startsAt: `${day}T11:30:00.000Z`, invitees: 9, people: [{ userId: `u-${who}`, name, meetings: [{ id: title ? `o-${who}` : null, title, startsAt: `${day}T11:00:00.000Z`, durationMinutes: 60 }] }] };
};

function preview(language: 'en' | 'ar', clashes: number, kept: number): MeetingScopePreviewDto {
  const fields: MeetingScopePreviewDto['kept'][number]['fields'][] = [['scheduledAt'], ['location', 'meetingUrl', 'durationMinutes'], ['typeValueId']];
  return {
    meetings: DAYS.map((d, i) => ({ id: `m-${i + 4}`, title: `PTC · ${d}`, startsAt: `${d}T11:30:00.000Z`, durationMinutes: 90 })),
    kept: Array.from({ length: kept }, (_, i) => ({ meetingId: `k-${i}`, title: 'PTC', fields: fields[i % 3]!, startsAt: `2027-1${i}-25T07:00:00.000Z` })),
    clashes: DAYS.slice(2, 2 + clashes).map((d, i) => clashOn(d, language, i % 5)),
  };
}

@Component({
  standalone: true,
  imports: [MeetingScopeDialogComponent],
  template: `<app-meeting-scope-dialog [visible]="true" [meeting]="meeting" [change]="change" />`,
})
class Host {
  readonly meeting = aMeeting({ scheduledAt: '2027-03-18T10:30:00.000Z', series: aSeries() });
  readonly change = CHANGE;
}

describe('Which meetings change? dialog — layout, measured (ACC-316 PR 8c)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();

  afterAll(() => console.log(`ACC-316 scope confirm (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  const dialog = (): MeetingScopeDialogComponent => layout.fixture.debugElement.query(By.directive(MeetingScopeDialogComponent)).componentInstance;
  const rows = () => document.querySelector<HTMLElement>('[data-testid="meeting-clash-rows"]')!;

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}, ${width}]: each choice, its clash line collapsed and shown, kept lines, many rows`, async () => {
        let answer = preview(language, 2, 1);
        await layout.open(Host, language, width, { scopePreview: () => of(answer), clashes: () => of([clashOn('2027-03-18', language, 0)]) });
        // Non-vacuity: both choices, the server's range, and the kept line are drawn.
        expect(document.querySelectorAll('[data-testid^="scope-THIS"][data-testid$="-line"]').length).toBe(2);
        expect(document.querySelector('[data-testid="scope-THIS_AND_LATER-line"]')?.textContent).toMatch(/8/);
        expect(document.querySelectorAll('[data-testid="scope-kept"]').length).toBe(1);
        layout.check('this only, kept line, its clash collapsed', language, width, 420);

        await layout.click('[data-testid="meeting-clash-toggle"]');
        layout.check('this only, its clash shown', language, width, 420);

        await layout.click('[data-testid="scope-THIS_AND_LATER"] input');
        expect(dialog().scope()).toBe('THIS_AND_LATER');
        layout.check('this and later, 2 of 8 collapsed', language, width, 420);
        await layout.click('[data-testid="meeting-clash-toggle"]');
        expect(rows().querySelectorAll('li').length).toBe(2);
        layout.check('this and later, 2 rows shown', language, width, 420);

        // Three kept (one line and "and 2 more") and every later meeting with a clash: the rows scroll inside.
        answer = preview(language, 6, 3);
        dialog().loadPreview();
        await layout.settle();
        await layout.still();
        // The rows stay open across the new answer.
        expect(document.querySelectorAll('[data-testid="scope-kept"]').length).toBe(1);
        expect(document.querySelector('[data-testid="scope-kept-more"]')).not.toBeNull();
        expect(rows().querySelectorAll('li').length).toBe(6);
        expect(rows().scrollHeight).withContext('six rows overflow the capped list').toBeGreaterThan(rows().clientHeight);
        layout.check('this and later, 3 kept, 6 rows (the list scrolls)', language, width, 420, [rows()]);
      }, 40_000);

      it(`[${language}, ${width}]: a refused preview`, async () => {
        await layout.open(Host, language, width, {
          scopePreview: () => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'STAGE_ACTION_NOT_ALLOWED' } })),
          clashes: () => of([]),
        });
        expect(document.querySelector('[data-testid="scope-preview-error"]')).withContext('the refusal').not.toBeNull();
        layout.check('a refused preview', language, width, 420);
      }, 40_000);
    }
  }
});
