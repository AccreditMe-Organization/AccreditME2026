import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS, Width } from '../../meeting-dialog-layout.testing';
import type { MeetingClashDto, MeetingSeriesDateDto, MeetingSeriesPreviewDto } from '../../services/meeting.service';
import { MeetingRepeatStepComponent } from '../meeting-repeat-step/meeting-repeat-step.component';
import { MeetingScheduleDialogComponent, ScheduleOwner } from './meeting-schedule-dialog.component';

// ACC-316 PR 8a — Schedule meeting's clash line (step 1) and Repeat (step 2)
// against the 420px body cap (ACC-111), MEASURED in both languages, in the
// real theme and font, at 1280 (the form dialog's 560) and on a 390 phone:
//
//   step 1  the clash line under Starts (the design: 375 / 402), and Show who
//           with its rows and Starts and Duration kept (219 / 240);
//   step 2  Example 1, every 3 months on the last Thursday, five dates and a
//           clash (378 / 402); Example 2, every month on day 31, twelve dates,
//           a moved one and shorter months, with "n later dates · … · Show
//           all" (Q7); the Clash chip tapped (358 / 386); Show all; the
//           standing agenda with ten items (Q5); and the end-date calendar.
//
// A list that holds more than the cap allows (Show all, ten standing items)
// scrolls inside its own region; nothing else scrolls. Each body keeps 20px
// under the cap. NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const OWNER: Record<'en' | 'ar', ScheduleOwner> = {
  en: { kind: 'COMMITTEE', id: 'c-1', name: 'Quality & Patient Safety Council', frequency: 'QUARTERLY' },
  ar: { kind: 'COMMITTEE', id: 'c-1', name: 'مجلس الجودة وسلامة المرضى', frequency: 'QUARTERLY' },
};
const NAME = { en: 'Infection Prevention & Control', ar: 'مكافحة العدوى' };
const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
};
const PEOPLE = {
  en: [
    { userId: 'u-1', name: 'Dr. Fahad Al-Anazi', meetings: [{ id: 'm-x', title: 'Antimicrobial Stewardship · November 2026', startsAt: '2026-11-26T10:00:00.000Z', durationMinutes: 90 }] },
    { userId: 'u-2', name: 'Dr. Huda Zahrani', meetings: [{ id: null, title: null, startsAt: '2026-11-26T08:30:00.000Z', durationMinutes: 60 }] },
  ],
  ar: [
    { userId: 'u-1', name: 'د. فهد العنزي', meetings: [{ id: 'm-x', title: 'الإشراف على المضادات الحيوية · نوفمبر 2026', startsAt: '2026-11-26T10:00:00.000Z', durationMinutes: 90 }] },
    { userId: 'u-2', name: 'د. هدى الزهراني', meetings: [{ id: null, title: null, startsAt: '2026-11-26T08:30:00.000Z', durationMinutes: 60 }] },
  ],
};
const clash = (language: 'en' | 'ar', busy: boolean): MeetingClashDto => ({ startsAt: '', invitees: 11, people: busy ? PEOPLE[language] : [] });

/** A preview as the server answers it: each date titled with its pattern month, in the reader's language. */
function preview(language: 'en' | 'ar', days: { day: string; moved?: string; busy?: boolean }[]): MeetingSeriesPreviewDto {
  const dates: MeetingSeriesDateDto[] = days.map((d, i) => ({
    index: i + 1,
    patternDay: d.day,
    day: d.moved ?? d.day,
    startsAt: `${d.moved ?? d.day}T07:00:00.000Z`,
    title: `${NAME[language]} · ${MONTHS[language][Number(d.day.slice(5, 7)) - 1]} ${d.day.slice(0, 4)}`,
    moved: d.moved ? 'NOT_WORKING_DAY' : null,
  }));
  return { dates, clashes: days.map((d) => clash(language, !!d.busy)) };
}
const QUARTERLY = [{ day: '2026-12-31' }, { day: '2027-03-25', busy: true }, { day: '2027-06-24' }, { day: '2027-09-30' }, { day: '2027-12-30' }];
const MONTHLY_31 = [
  { day: '2026-10-31', moved: '2026-11-01', busy: true },
  { day: '2026-11-30' },
  { day: '2026-12-31' },
  { day: '2027-01-31' },
  { day: '2027-02-28' },
  { day: '2027-03-31', busy: true },
  { day: '2027-04-30' },
  { day: '2027-05-31' },
  { day: '2027-06-30' },
  { day: '2027-07-31', moved: '2027-08-01' },
  { day: '2027-08-31' },
  { day: '2027-09-30' },
];

@Component({
  standalone: true,
  imports: [MeetingScheduleDialogComponent],
  template: `<app-meeting-schedule-dialog [visible]="true" [owner]="owner()" />`,
})
class Host {
  readonly owner = signal<ScheduleOwner | null>(null);
}

describe('Schedule meeting — the clash line and Repeat, measured (ACC-316 PR 8a)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();
  let busy = true;
  let answer: MeetingSeriesPreviewDto;

  afterAll(() => console.log(`ACC-316 schedule, clashes and repeat (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  /** The clash check and the preview are each debounced by 250ms: wait them out, then measure. */
  const debounce = async () => {
    await new Promise((r) => setTimeout(r, 400));
    await layout.settle();
    await layout.still();
  };

  async function open(language: 'en' | 'ar', width: Width): Promise<MeetingScheduleDialogComponent> {
    busy = true;
    answer = preview(language, QUARTERLY);
    await layout.open(
      Host,
      language,
      width,
      {
        formChoices: () => of({ types: [{ id: 't-1', labelEn: 'Review', labelAr: 'مراجعة' }] }),
        clashes: () => of([clash(language, busy)]),
        seriesPreview: () => of(answer),
        presenterCandidates: () => of({ items: [], total: 0, matching: 0 }),
      },
      (h) => h.owner.set(OWNER[language]),
    );
    const dialog: MeetingScheduleDialogComponent = layout.fixture.debugElement.query(By.directive(MeetingScheduleDialogComponent)).componentInstance;
    dialog.form.patchValue({ title: OWNER[language].name, typeValueId: 't-1', durationMinutes: 90, time: '09:00', location: language === 'en' ? 'Board room 1, Tower A' : 'قاعة الاجتماعات 1، البرج أ' });
    dialog.pickDay(new Date(2026, 11, 31));
    await debounce();
    return dialog;
  }

  const repeat = (): MeetingRepeatStepComponent => layout.fixture.debugElement.query(By.directive(MeetingRepeatStepComponent)).componentInstance;
  const scroller = (selector: string) => document.querySelector<HTMLElement>(selector)!;

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}, ${width}] step 1: the clash line, and Show who`, async () => {
        await open(language, width);
        // Non-vacuity: the line is drawn, under Starts, with its count.
        expect(document.querySelector('[data-testid="meeting-clash-line"]')).withContext('the clash line').not.toBeNull();
        expect(document.querySelector('[data-testid="schedule-title"]')).not.toBeNull();
        layout.check('step 1, the clash line', language, width, 560);

        await layout.click('[data-testid="meeting-clash-toggle"]');
        expect(document.querySelectorAll('[data-clash-person]').length).withContext('two rows').toBe(2);
        expect(document.querySelector('[data-testid="schedule-who-day"]')).withContext('Starts kept').not.toBeNull();
        layout.check('step 1, Show who', language, width, 560);
      }, 60_000);

      it(`[${language}, ${width}] step 2: Example 1 (every 3 months, the last Thursday), the Clash chip, the end date`, async () => {
        const dialog = await open(language, width);
        dialog.next();
        await debounce();
        expect(document.querySelectorAll('[data-repeat-date]').length).withContext('five dates').toBe(5);
        expect(document.querySelector('[data-repeat-date="2"] [data-chip="clash"]')).withContext('the clash chip').not.toBeNull();
        layout.check('step 2, example 1', language, width, 560);

        await layout.click('[data-repeat-date="2"] [data-chip="clash"]');
        expect(document.querySelectorAll('[data-testid="repeat-clash-view"] [data-clash-person]').length).toBe(2);
        layout.check('step 2, the Clash chip tapped', language, width, 560);
        await layout.click('[data-testid="repeat-clash-back"]');

        repeat().ends.set('ON');
        await layout.settle();
        await layout.click('[data-testid="repeat-end-date"]');
        expect(document.querySelector('[data-testid="repeat-end-date-view"]')).withContext('the calendar took the body').not.toBeNull();
        layout.check('step 2, the end date', language, width, 560);
      }, 60_000);

      it(`[${language}, ${width}] step 2: Example 2 (every month, day 31), Show all, and ten standing items`, async () => {
        const dialog = await open(language, width);
        answer = preview(language, MONTHLY_31);
        dialog.next();
        await debounce();
        const r = repeat();
        r.form.controls.every.setValue('MONTH_1');
        r.monthMode.set('DAY');
        r.form.controls.dayOfMonth.setValue(31);
        await debounce();
        expect(document.querySelectorAll('[data-repeat-date]').length).withContext('the first five').toBe(5);
        expect(document.querySelector('[data-testid="repeat-later"]')).withContext('n later dates · … · Show all').not.toBeNull();
        expect(document.querySelectorAll('[data-chip="moved"], [data-chip="short-month"]').length).withContext('moved and short-month chips').toBeGreaterThan(1);
        layout.check('step 2, example 2', language, width, 560);

        await layout.click('[data-testid="repeat-show-all"]');
        expect(document.querySelectorAll('[data-testid="repeat-all-dates"] [data-repeat-date]').length).toBe(12);
        layout.check('step 2, Show all', language, width, 560, [scroller('[data-testid="repeat-all-dates"]')]);
        await layout.click('[data-testid="repeat-all-dates-view"] .am-backlink');

        await layout.click('[data-testid="repeat-standing"]');
        for (let i = 0; i < 10; i++) r.addItem();
        for (let i = 0; i < 10; i++) r.setTitle(i, language === 'en' ? `Standing item ${i + 1}: infection rates by ward` : `البند الثابت ${i + 1}: معدلات العدوى حسب القسم`);
        await layout.settle();
        await layout.still();
        expect(document.querySelectorAll('[data-standing-item]').length).toBe(10);
        expect(document.querySelector('[data-testid="repeat-standing-full"]')).withContext('the limit is said').not.toBeNull();
        const items = document.querySelector<HTMLElement>('[data-testid="repeat-standing-items"]')!.parentElement!;
        layout.check('step 2, ten standing items', language, width, 560, [items]);
      }, 60_000);
    }
  }
});
