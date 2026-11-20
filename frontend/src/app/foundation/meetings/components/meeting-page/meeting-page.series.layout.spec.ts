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
import { aMeeting, aSeries } from '../../meeting-fixtures.testing';
import { MeetingService } from '../../services/meeting.service';
import { MeetingPageComponent } from './meeting-page.component';

// ACC-316 PR 8b — the meeting header's series cell, MEASURED at 1280 and on a
// 390 phone, in both languages (no dialog: P239). It sits in the facts grid
// with the committee, the place and the organiser: beside them at 1280, under
// them on the phone. Its line is drawn whole, its links read previous → whole
// series → next in the reading direction, and nothing is wider than the page.
// NON-VACUITY FIRST (ACC-120): every box is real and distinct before "inside",
// "beside" or "before" is allowed to mean anything.

@Component({
  standalone: true,
  imports: [MeetingPageComponent],
  template: `<div class="am-test-frame"><app-meeting-page /></div>`,
  styles: [':host { display: block; } .am-test-frame { inline-size: var(--frame); background: #fff; }'],
})
class Host {}

describe('Meeting page — the series cell, measured (ACC-316 PR 8b)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  let current: ComponentFixture<Host> | null = null;
  afterAll(() => console.log(`ACC-316 the series cell:\n  ${measured.join('\n  ')}`));

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
            get: () => of(aMeeting({ series: aSeries() })),
            attendees: () => of([]),
            agenda: () => of([]),
            files: () => of({ attachments: [], papers: [] }),
            minutes: () => of(null),
            openActions: () => of({ mayRead: false, rows: [] }),
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
    // Not whenStable(): the page keeps a timer, so the zone never settles.
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
    for (const width of [1280, 390]) {
      it(`[${language}, ${width}]: in the facts grid, drawn whole, its links in the reading order, nothing wider than the page`, async () => {
        const host = await open(language, width);
        const page = host.querySelector('[data-testid="meeting-page"]')!;
        const cell = host.querySelector('[data-testid="meeting-series"]')!;
        const grid = cell?.parentElement;
        const line = host.querySelector('[data-testid="meeting-series-line"]')!;
        const previous = host.querySelector('[data-testid="meeting-series-previous"]')!;
        const whole = host.querySelector('[data-testid="meeting-series-whole"]')!;
        const next = host.querySelector('[data-testid="meeting-series-next"]')!;
        const cells = Array.from(grid?.children ?? []).filter((c) => c !== cell);

        // Non-vacuity: everything measured is drawn, distinct, and the grid has its other cells.
        for (const [name, el] of [['page', page], ['cell', cell], ['line', line], ['previous', previous], ['whole', whole], ['next', next]] as const) {
          expect(el).withContext(`${name} exists`).not.toBeNull();
          expect(box(el).width).withContext(`${name} width`).toBeGreaterThan(0);
          expect(box(el).height).withContext(`${name} height`).toBeGreaterThan(0);
        }
        expect(cells.length).withContext('the committee, place and organiser cells').toBe(3);
        expect(box(previous).left).withContext('previous and next are different boxes').not.toBe(box(next).left);

        // Inside the cell, the cell inside the grid, the grid inside the page.
        for (const [name, el] of [['line', line], ['previous', previous], ['whole', whole], ['next', next]] as const) {
          expect(box(el).left).withContext(`${name} inside the cell (start)`).toBeGreaterThanOrEqual(box(cell).left - 0.5);
          expect(box(el).right).withContext(`${name} inside the cell (end)`).toBeLessThanOrEqual(box(cell).right + 0.5);
        }
        expect(box(cell).right).withContext('the cell inside the grid').toBeLessThanOrEqual(box(grid!).right + 0.5);
        expect(page.scrollWidth).withContext('nothing wider than the page').toBeLessThanOrEqual(box(page).width + 0.5);

        // The line is drawn whole: not cut, not clipped.
        expect(line.scrollWidth).withContext('the line is not cut').toBeLessThanOrEqual((line as HTMLElement).clientWidth + 0.5);

        // Reading order: previous, then the whole series, then next — left to right in English, right to left in Arabic.
        const sameRow = (a: Element, b: Element) => Math.abs(box(a).top - box(b).top) < 1;
        const before = (a: Element, b: Element) =>
          sameRow(a, b) ? (language === 'en' ? box(a).right <= box(b).left + 0.5 : box(a).left >= box(b).right - 0.5) : box(a).bottom <= box(b).top + 0.5;
        expect(before(previous, whole)).withContext('previous before the whole series').toBeTrue();
        expect(before(whole, next)).withContext('the whole series before next').toBeTrue();

        const organiser = cells[cells.length - 1]!;
        if (width === 1280) {
          // Beside the other facts, on their row.
          expect(Math.abs(box(cell).top - box(organiser).top)).withContext('on the facts row').toBeLessThan(1);
          if (language === 'en') expect(box(cell).left).withContext('after the organiser').toBeGreaterThan(box(organiser).left);
          else expect(box(cell).right).withContext('after the organiser').toBeLessThan(box(organiser).right);
        } else {
          // Under them, as wide as they are: one column.
          expect(box(cell).top).withContext('under the organiser').toBeGreaterThanOrEqual(box(organiser).bottom - 0.5);
          expect(Math.abs(box(cell).width - box(organiser).width)).withContext('one column').toBeLessThan(1);
        }
        measured.push(`[${language}, ${width}] cell ${Math.round(box(cell).width)}×${Math.round(box(cell).height)}; line ${Math.round(line.scrollWidth)}px; links ${sameRow(previous, next) ? 'on one row' : 'wrapped'}`);
      }, 60_000);
    }
  }
});
