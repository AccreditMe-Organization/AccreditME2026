import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { LookupCategoryDto, LookupService, LookupValueDto } from '../../services/lookup.service';
import { LookupValueListComponent } from './lookup-value-list.component';

// ACC-286 — the "Required seat" row measured, EN and AR, at the page's content
// width on a 1280 screen (988, the page specs' width) and on a 390 phone (358),
// with the real theme and font. The toggle, its label, the hint and a refusal
// line sit in the Label cell, under the seat's name. What is checked:
//   - nothing in the Label cell paints outside it (the hint wraps; nothing is
//     cut or pushed sideways);
//   - the switch and its label share one line.
// The row height and the hint's line count are recorded for the PR.
//
// NON-VACUITY FIRST: the row, the switch and the hint must be on screen and laid
// out, or "nothing outside the cell" would hold of an empty cell.

const CATEGORY = {
  id: 'cat-seat',
  key: 'committee_member_role',
  labelEn: 'Committee Member Role',
  labelAr: 'دور عضو اللجنة',
  isSystem: true,
  isExtensible: true,
  isActive: true,
  attributeSchema: { type: 'object', properties: { required: { type: 'boolean', label: 'Required seat' } } },
} as unknown as LookupCategoryDto;

const seat = (id: string, labelEn: string, labelAr: string, required: boolean): LookupValueDto =>
  ({
    id,
    key: id,
    labelEn,
    labelAr,
    labelOverrideEn: null,
    labelOverrideAr: null,
    layer: 'SYSTEM',
    attributes: required ? { required: true } : null,
    isActive: true,
    isHidden: false,
    sortOrder: 0,
  }) as unknown as LookupValueDto;

const SEATS = [
  seat('chairman', 'Chairman', 'رئيس اللجنة', true),
  seat('vice_chairman', 'Vice Chairman', 'نائب الرئيس', false),
  seat('secretary', 'Secretary', 'أمين السر', true),
];

@Component({
  selector: 'am-test-frame',
  standalone: true,
  imports: [LookupValueListComponent],
  template: `<div data-frame [style.width.px]="width()" style="height:900px;display:flex;flex-direction:column;box-sizing:border-box"><app-lookup-value-list /></div>`,
})
class FrameComponent {
  readonly width = input(988);
}

describe('LookupValueListComponent — the Required seat row laid out (ACC-286)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let fixture: ComponentFixture<FrameComponent>;
  const measured: string[] = [];
  afterAll(() => console.log(`ACC-286 Required seat row\n  ${measured.join('\n  ')}`));

  function setViewport(width: number | null): void {
    const frame = window.frameElement as HTMLElement | null;
    if (!frame) {
      if (width === null) return;
      throw new Error("These specs size the viewport through Karma's iframe, and there is none");
    }
    frame.style.width = width === null ? '' : `${width}px`;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  async function render(lang: 'en' | 'ar', width: number, viewport: number): Promise<void> {
    setViewport(viewport);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FrameComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        {
          provide: LookupService,
          useValue: { getCategoryByKey: () => of(CATEGORY), getValues: () => of(SEATS), overrideAttributes: () => of(undefined) },
        },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => p === 'lookups:manage' } },
      ],
    });
    try {
      localStorage.clear();
    } catch {
      /* none */
    }
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(FrameComponent);
    fixture.componentRef.setInput('width', width);
    document.body.appendChild(fixture.nativeElement);
    await settle();
  }

  afterEach(() => {
    fixture?.nativeElement.remove();
    setViewport(null);
  });

  const box = (el: Element): DOMRect => el.getBoundingClientRect();

  for (const lang of ['en', 'ar'] as const) {
    for (const [width, viewport] of [
      [988, 1280],
      [358, 390],
    ] as const) {
      it(`${lang} at ${viewport}: the toggle, its label and the hint stay inside the Label cell`, async () => {
        await render(lang, width, viewport);
        const toggle = document.querySelector<HTMLElement>('[data-required-seat="chairman"]');
        // Non-vacuity: the row is on screen and laid out.
        expect(toggle).withContext('the Required seat line rendered').not.toBeNull();
        const cell = toggle!.parentElement!;
        const row = cell.parentElement!;
        const hint = cell.querySelector<HTMLElement>('p')!;
        expect(box(cell).width).withContext('the Label cell is laid out').toBeGreaterThan(100);
        expect(box(hint).height).withContext('the hint is laid out').toBeGreaterThan(10);

        // Nothing in the cell paints outside it.
        const c = box(cell);
        const outside = Array.from(cell.querySelectorAll<HTMLElement>('*')).filter((e) => {
          const r = box(e);
          return r.width > 0 && (r.left < c.left - 1 || r.right > c.right + 1);
        });
        expect(outside.map((e) => e.tagName + '.' + e.className.toString().slice(0, 30))).toEqual([]);

        // The switch and its label share one line.
        const sw = box(toggle!.querySelector('p-toggleswitch')!);
        const label = box(toggle!.querySelector('label')!);
        expect(Math.abs(sw.top + sw.height / 2 - (label.top + label.height / 2))).toBeLessThan(4);

        const lineHeight = parseFloat(getComputedStyle(hint).lineHeight) || 16;
        const lines = Math.round(box(hint).height / lineHeight);
        measured.push(
          `${lang} ${viewport}: cell ${Math.round(c.width)}px, row ${Math.round(box(row).height)}px, hint ${lines} line${lines === 1 ? '' : 's'}`,
        );
      });
    }
  }
});
