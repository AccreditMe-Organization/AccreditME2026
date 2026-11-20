import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { aMeeting, aMinutes, aMinutesItem, anAttendanceRow } from '../../meeting-fixtures.testing';
import { MeetingService } from '../../services/meeting.service';
import { MeetingPageComponent } from './meeting-page.component';

// ACC-316 PR 7d-2 — the meeting page on a 390 phone (artboard 14), MEASURED in
// both languages, against the same page at 1280. The page's phone rules are a
// container query on its own column, so a 390-wide host is a 390 phone here.
// On the phone: one column, the side cards (attendance, the review card) above
// the agenda, the banner's answers full-width with the primary on top, every
// button at least 44px tall, and nothing wider than the screen.
// NON-VACUITY FIRST (ACC-120): the boxes are real and distinct before any
// "above" or "as wide as" is allowed to mean anything.

@Component({
  standalone: true,
  imports: [MeetingPageComponent],
  template: `<div class="am-test-frame"><app-meeting-page /></div>`,
  styles: [':host { display: block; } .am-test-frame { inline-size: var(--frame); background: #fff; }'],
})
class Host {}

const MINUTES = aMinutes({
  phase: 'review',
  attendance: [
    anAttendanceRow({ attendance: 'PRESENT' }),
    anAttendanceRow({ attendeeId: 'a-2', userId: 'u-2', name: 'Huda Al-Harbi', seat: { id: 'seat-sec', labelEn: 'Secretary', labelAr: 'أمين السر' }, attendance: 'PRESENT' }),
  ],
  quorum: { quorum: 2, presentMembers: 2, met: true },
  items: [aMinutesItem({ discussion: 'Room 3 is closed for maintenance until the filters are replaced.' })],
  review: {
    round: 1,
    reviewBy: '2027-03-25',
    datePassed: false,
    closed: false,
    reviewers: [{ userId: 'u-1', name: 'Dr. Nora Al-Otaibi', answered: false }],
    // A whole-minutes suggestion the viewer may apply: the review card (a side
    // card) then has controls, so the tab order can be measured.
    suggestions: [{ id: 's-1', round: 1, agendaItemId: null, author: { id: 'u-2', name: 'Huda Al-Harbi' }, text: 'Add the apologies received.', status: 'OPEN', reply: null, createdAt: '2027-03-19T08:00:00.000Z', decidedAt: null }],
    changes: [],
    mine: null,
  },
  distribute: null,
  may: { recordAttendance: false, recordMinutes: false, distribute: false, returnForCorrection: false, review: true, applySuggestions: true, changeActionDates: false },
});

describe('Meeting page — phone 390, measured (ACC-316 PR 7d-2)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  let current: ComponentFixture<Host> | null = null;
  afterAll(() => console.log(`ACC-316 meeting page on a phone:\n  ${measured.join('\n  ')}`));

  async function open(language: 'en' | 'ar', width: number): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'm-1' }) } } },
        {
          provide: MeetingService,
          useValue: {
            get: () => of(aMeeting({ stage: { id: 's-review', nameEn: 'Minutes Review', nameAr: 'مراجعة المحضر', flags: [] } })),
            attendees: () => of([]),
            agenda: () => of([{ id: 'i-1', order: 1, title: 'Isolation room maintenance', description: null, durationMinutes: null, standing: false, presenter: null }]),
            files: () => of({ attachments: [], papers: [] }),
            minutes: () => of(MINUTES),
            openActions: () => of({ mayRead: true, rows: [] }),
          },
        },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    const fixture = TestBed.createComponent(Host);
    current = fixture;
    const host = fixture.nativeElement as HTMLElement;
    host.style.setProperty('--frame', `${width}px`);
    document.body.appendChild(host);
    // Not whenStable(): the page keeps a timer (attendance opens at the start
    // time), so the zone never settles. Render, then let layout and fonts land.
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    await document.fonts.ready;
    fixture.detectChanges();
    return host;
  }

  afterEach(() => {
    const el = current?.nativeElement as HTMLElement | undefined;
    current?.destroy();
    el?.remove();
    current = null;
  });

  const box = (el: Element | null) => el!.getBoundingClientRect();

  for (const language of ['en', 'ar'] as const) {
    it(`[${language}, 390]: one column, the side cards first, the answers full-width with the primary on top, 44px buttons, nothing wider than the phone`, async () => {
      const host = await open(language, 390);
      const page = host.querySelector('[data-testid="meeting-page"]')!;
      const side = host.querySelector('[data-testid="meeting-side"]')!;
      const agenda = host.querySelector('am-meeting-agenda-panel')!;
      const answers = host.querySelector('[data-testid="meeting-review-answers"]')!;
      const primary = host.querySelector('[data-testid="meeting-review-no-corrections"] .p-button')!;
      const suggest = host.querySelector('[data-testid="meeting-review-suggest"] .p-button')!;
      // Non-vacuity: everything measured is really drawn, and distinct.
      for (const [name, el] of [['page', page], ['side', side], ['agenda', agenda], ['answers', answers], ['primary', primary], ['suggest', suggest]] as const) {
        expect(box(el).width).withContext(`${name} width`).toBeGreaterThan(0);
        expect(box(el).height).withContext(`${name} height`).toBeGreaterThan(0);
      }
      expect(box(page).width).withContext('the page is the phone').toBeLessThanOrEqual(390);

      expect(box(side).bottom).withContext('the side cards above the agenda').toBeLessThanOrEqual(box(agenda).top + 0.5);
      expect(Math.abs(box(side).width - box(agenda).width)).withContext('one column').toBeLessThan(1);

      expect(box(primary).bottom).withContext('the primary answer on top').toBeLessThanOrEqual(box(suggest).top + 0.5);
      expect(Math.abs(box(primary).width - box(answers).width)).withContext('No corrections full-width').toBeLessThan(1);
      expect(Math.abs(box(suggest).width - box(answers).width)).withContext('Suggest full-width').toBeLessThan(1);

      const buttons = Array.from(page.querySelectorAll<HTMLElement>('.p-button')).filter((b) => b.offsetParent !== null);
      expect(buttons.length).withContext('buttons to measure').toBeGreaterThan(0);
      for (const b of buttons) expect(box(b).height).withContext(`"${b.textContent?.trim()}" height`).toBeGreaterThanOrEqual(44 - 0.5);

      expect(page.scrollWidth).withContext('nothing wider than the phone').toBeLessThanOrEqual(box(page).width + 0.5);

      // P233 — the tab order is the order on screen (WCAG 2.4.3): from the top
      // of the page, Tab reaches a side-card control before the first agenda one.
      // With no positive tabindex, Tab follows the DOM order of these.
      const focusable = Array.from(
        page.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]'),
      ).filter((el) => el.tabIndex >= 0 && el.offsetParent !== null);
      expect(focusable.some((el) => el.tabIndex > 0)).withContext('no positive tabindex').toBeFalse();
      const firstIn = (container: Element) => focusable.findIndex((el) => container.contains(el));
      const main = host.querySelector('[data-testid="meeting-main"]')!;
      expect(firstIn(side)).withContext('a side-card control is focusable').toBeGreaterThanOrEqual(0);
      expect(firstIn(main)).withContext('an agenda control is focusable').toBeGreaterThanOrEqual(0);
      expect(firstIn(side)).withContext('Tab reaches the side cards before the agenda').toBeLessThan(firstIn(main));
      measured.push(`[${language}, 390] side ${Math.round(box(side).top)}–${Math.round(box(side).bottom)}, agenda from ${Math.round(box(agenda).top)}; answers ${Math.round(box(primary).width)}px wide; ${buttons.length} buttons ≥ 44px`);
    }, 60_000);

    it(`[${language}, 1280]: the agenda and the side cards side by side, as before`, async () => {
      const host = await open(language, 1280);
      const side = host.querySelector('[data-testid="meeting-side"]')!;
      const agenda = host.querySelector('am-meeting-agenda-panel')!;
      expect(box(side).width).toBeGreaterThan(0);
      expect(Math.abs(box(side).top - box(agenda).top)).withContext('the same row').toBeLessThan(1);
      expect(box(side).width).withContext('two columns').toBeLessThan(700);
      // P233 — the agenda is at inline-start: left in English, right in Arabic,
      // though the side column now comes first in the DOM.
      if (language === 'en') expect(box(agenda).left).withContext('the agenda on the left').toBeLessThan(box(side).left);
      else expect(box(agenda).right).withContext('the agenda on the right').toBeGreaterThan(box(side).right);
      // P233 — the banner's order on a wide page is pinned: "No corrections" first.
      const primary = host.querySelector('[data-testid="meeting-review-no-corrections"] .p-button')!;
      const suggest = host.querySelector('[data-testid="meeting-review-suggest"] .p-button')!;
      expect(primary.compareDocumentPosition(suggest) & Node.DOCUMENT_POSITION_FOLLOWING).withContext('No corrections first in the DOM').toBeTruthy();
      if (language === 'en') expect(box(primary).left).withContext('No corrections at inline-start').toBeLessThan(box(suggest).left);
      else expect(box(primary).right).withContext('No corrections at inline-start').toBeGreaterThan(box(suggest).right);
      measured.push(`[${language}, 1280] two columns, side ${Math.round(box(side).width)}px`);
    }, 60_000);
  }
});
