import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { TaskPageComponent } from './task-page.component';
import { HISTORY, pageView } from './task-page.fixtures';

// ACC-228 — the task page MEASURED, in both languages, in the real theme, font
// and translations (plan §1.8). A page, not a dialog: there is no 420 cap. What
// the drawing fixes, and what must hold at a phone's width:
//
//   - the title line is 28/34 in English and 29/40 in Arabic (Task Screens §1);
//   - the four relations sit in one row on a desktop page, each at least 220
//     wide, and stack on a phone;
//   - the two columns sit side by side on a desktop page, each at least 420,
//     and stack on a phone;
//   - nothing scrolls sideways at 390 (ACC-206 is the known Arabic phone
//     defect; this page must not add to it).
//
// NON-VACUITY FIRST (ACC-120): every measure asserts the page is laid out, in
// the real font, before a number is allowed to mean anything.

const API = `${environment.apiUrl}/tasks`;
const DESKTOP = 1240; // the content width beside a 260 rail, at 1500
const PHONE = 390;

// The longest title the realistic seed's task screens carry, so the wrap is real.
const LONG_TITLE = {
  en: 'Collect sharps-disposal audit forms from every ward in Tower A and Tower B before the quarterly review',
  ar: 'جمع نماذج تدقيق التخلص من الأدوات الحادة من كل أجنحة البرج A والبرج B قبل المراجعة الربعية',
};

@Component({
  standalone: true,
  imports: [TaskPageComponent],
  template: `<div class="am-tp-host" [style.width.px]="width()"><app-task-page /></div>`,
})
class HostComponent {
  readonly width = input(DESKTOP);
}

describe('TaskPageComponent — layout, measured (ACC-228)', () => {
  preserveDocumentLanguage();

  const measured: string[] = [];
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;

  afterAll(() => {
    // The numbers the PR reports, printed where a reader of the run can see them.
    console.log(`ACC-228 task page measurements:\n  ${measured.join('\n  ')}`);
  });

  async function render(language: 'en' | 'ar', width: number, title?: string): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: 'task-1' })) } },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(HostComponent);
    fixture.componentRef.setInput('width', width);
    fixture.autoDetectChanges(true);
    document.body.appendChild(fixture.nativeElement);

    const view = pageView({
      task: {
        ...(title ? { title } : {}),
        openRequest: {
          id: 'req-1',
          type: 'ON_HOLD',
          requestedDueAt: null,
          holdUntil: '2099-10-20T05:00:00.000Z',
          requestedById: 'huda',
          requestedByName: 'Dr. Huda Zahrani',
          reason: 'The audit form needs Infection Control sign-off, and their lead is on leave until 19 Oct.',
          createdAt: '2026-10-05T11:20:00.000Z',
        },
      },
      actions: { complete: true, addEvidence: true, withdrawRequest: true, reject: true, primary: 'COMPLETE' },
    });
    http.expectOne(`${API}/task-1/view`).flush(view);
    http.expectOne(`${API}/task-1/history`).flush(HISTORY);
    await fixture.whenStable();
    http.match(`${API}/task-1/evidence`).forEach((r) => r.flush({ items: [], canAdd: true, closed: false }));
    await fixture.whenStable();
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const el = fixture.nativeElement as HTMLElement;
    // Non-vacuity: the page is on screen, laid out, in the real font.
    expect(el.querySelector('[data-testid="task-page"]')).withContext('the page did not render').not.toBeNull();
    expect(document.fonts.check('13px "IBM Plex Sans Arabic"')).withContext('measured in a fallback font').toBe(true);
    expect(el.querySelector('h1')!.getBoundingClientRect().height).withContext('the page is not laid out').toBeGreaterThan(0);
    return el;
  }

  afterEach(() => {
    http.verify();
    fixture.nativeElement.remove();
  });

  const rect = (el: Element) => el.getBoundingClientRect();
  const cells = (el: HTMLElement) => Array.from(el.querySelectorAll('.am-tp__cell')).map(rect);
  const columns = (el: HTMLElement) => Array.from(el.querySelectorAll('article > .grid > div')).map(rect);

  for (const language of ['en', 'ar'] as const) {
    describe(language === 'en' ? 'English' : 'Arabic', () => {
      it('the title line is the drawn height (28/34 English, 29/40 Arabic)', async () => {
        const el = await render(language, DESKTOP);
        const h1 = el.querySelector('h1')!;
        const style = getComputedStyle(h1);
        const expected = language === 'en' ? { size: '28px', line: 34 } : { size: '29px', line: 40 };
        expect(style.fontSize).toBe(expected.size);
        expect(rect(h1).height).withContext('a one-line title').toBe(expected.line);
        measured.push(`[${language}] title line ${rect(h1).height}px; header block ${Math.round(rect(el.querySelector('header')!).height)}px at ${DESKTOP}`);
      });

      it(`at ${DESKTOP}: four relations in one row, each at least 220 wide; two columns side by side, each at least 420`, async () => {
        const el = await render(language, DESKTOP);
        const strip = cells(el);
        expect(strip.length).toBe(4);
        expect(new Set(strip.map((c) => Math.round(c.top))).size).withContext('the relations wrapped').toBe(1);
        for (const c of strip) expect(c.width).toBeGreaterThanOrEqual(220);
        const cols = columns(el);
        expect(cols.length).toBe(2);
        expect(Math.round(cols[0]!.top)).withContext('the columns stacked').toBe(Math.round(cols[1]!.top));
        for (const c of cols) expect(c.width).toBeGreaterThanOrEqual(420);
        measured.push(
          `[${language}] ${DESKTOP}: relations ${strip.map((c) => Math.round(c.width)).join('/')}px; columns ${cols.map((c) => Math.round(c.width)).join('/')}px; page ${Math.round(rect(el.querySelector('article')!).height)}px tall`,
        );
      });

      it(`at ${PHONE}: relations and columns stack, and nothing scrolls sideways — even with the longest title`, async () => {
        const el = await render(language, PHONE, LONG_TITLE[language]);
        const strip = cells(el);
        const tops = strip.map((c) => Math.round(c.top));
        expect(new Set(tops).size).withContext('the relations did not stack').toBe(4);
        const cols = columns(el);
        expect(Math.round(cols[1]!.top)).withContext('the columns did not stack').toBeGreaterThan(Math.round(cols[0]!.top));
        const host = el.querySelector<HTMLElement>('.am-tp-host')!;
        expect(host.scrollWidth).withContext(`scrolls sideways: ${host.scrollWidth} > ${host.clientWidth}`).toBeLessThanOrEqual(host.clientWidth);
        const h1 = el.querySelector('h1')!;
        expect(rect(h1).width).toBeLessThanOrEqual(PHONE);
        measured.push(
          `[${language}] ${PHONE}: title ${Math.round(rect(h1).height)}px (wrapped), header ${Math.round(rect(el.querySelector('header')!).height)}px, page ${Math.round(rect(el.querySelector('article')!).height)}px tall, scrollWidth ${host.scrollWidth}/${host.clientWidth}`,
        );
      });
    });
  }
});
