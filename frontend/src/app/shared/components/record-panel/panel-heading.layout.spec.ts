import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { useLayoutFonts } from '../../../../testing/layout-fonts';
import { CappedPanelComponent } from '../capped-panel/capped-panel.component';
import { RecordPanelComponent } from './record-panel.component';

// CC-340 — ONE heading style for every panel on a record page. The record panel
// (Roles, Committees, Two-step sign-in, Stage history) and the capped panel
// (Tasks, Members, Sub-committees, Signed-in devices) sit side by side; their
// titles must compute the same type step, weight, case and colour, and their
// counts the same pill, in both languages. Measured in the real font and theme.

@Component({
  standalone: true,
  imports: [RecordPanelComponent, CappedPanelComponent],
  template: `<div class="grid grid-cols-2 gap-4 w-[900px]">
    <app-record-panel heading="Roles" [count]="3" badge="2 overdue" emptyTitle="None" [isEmpty]="true" />
    <am-capped-panel heading="Tasks" state="ready" [total]="3" [shown]="0" emptyText="None" testIdPrefix="t" />
  </div>`,
})
class Host {}

const TITLE = ['fontSize', 'lineHeight', 'fontWeight', 'textTransform', 'letterSpacing', 'color', 'fontVariantCaps'] as const;
const COUNT = [
  'fontSize',
  'lineHeight',
  'fontWeight',
  'color',
  'backgroundColor',
  'borderTopWidth',
  'borderTopStyle',
  'borderTopColor',
  'borderTopLeftRadius',
  'paddingInlineStart',
  'paddingInlineEnd',
  'fontVariantNumeric',
] as const;

function styleOf(el: HTMLElement, keys: readonly string[]): Record<string, string> {
  const cs = getComputedStyle(el) as unknown as Record<string, string>;
  return Object.fromEntries(keys.map((k) => [k, cs[k]!]));
}

describe('Record panel and capped panel share one heading (CC-340)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();

  async function render(lang: 'en' | 'ar'): Promise<{ fixture: ComponentFixture<Host>; el: HTMLElement }> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  for (const lang of ['en', 'ar'] as const) {
    it(`${lang}: the two titles and the two counts compute the same style`, async () => {
      const { el } = await render(lang);
      const recordTitle = el.querySelector<HTMLElement>('app-record-panel [data-panel-title]')!;
      const cappedTitle = el.querySelector<HTMLElement>('am-capped-panel .am-cp__title')!;
      const recordCount = el.querySelector<HTMLElement>('app-record-panel [data-panel-count]')!;
      const cappedCount = el.querySelector<HTMLElement>('[data-testid="t-count"]')!;
      // Non-vacuity: all four are drawn, with their text.
      for (const [part, text] of [
        [recordTitle, 'Roles'],
        [cappedTitle, 'Tasks'],
        [recordCount, '3'],
        [cappedCount, '3'],
      ] as const) {
        expect(part).withContext(`"${text}" is drawn`).not.toBeNull();
        expect(part.textContent!.trim()).toBe(text);
        expect(part.getBoundingClientRect().width).toBeGreaterThan(0);
      }

      const want = styleOf(cappedTitle, TITLE);
      expect(styleOf(recordTitle, TITLE)).withContext('the record panel title').toEqual(want);
      // The capped frame's step, sentence case: 14px in English, the Arabic step 15px.
      expect(want['fontSize']).toBe(lang === 'en' ? '14px' : '15px');
      expect(want['fontWeight']).toBe('600');
      expect(want['textTransform']).toBe('none');

      const pill = styleOf(cappedCount, COUNT);
      expect(styleOf(recordCount, COUNT)).withContext('the record panel count').toEqual(pill);
      expect(pill['fontSize']).toBe(lang === 'en' ? '12px' : '13px');
      // A pill: rounded to its own height, with a border.
      expect(parseFloat(pill['borderTopLeftRadius']!)).toBeGreaterThanOrEqual(cappedCount.getBoundingClientRect().height / 2);
      expect(pill['borderTopWidth']).toBe('1px');
      expect(Math.round(recordCount.getBoundingClientRect().height)).toBe(Math.round(cappedCount.getBoundingClientRect().height));

      // The badge ("2 overdue") is the same pill shape, in its own colours.
      const badge = Array.from(el.querySelectorAll<HTMLElement>('app-record-panel header span')).find((s) => s.textContent!.trim() === '2 overdue')!;
      expect(badge).withContext('the badge').toBeDefined();
      const shape = (e: HTMLElement) => styleOf(e, ['fontSize', 'borderTopLeftRadius', 'borderTopWidth', 'paddingInlineStart']);
      expect(shape(badge)).toEqual(shape(cappedCount));

      const head = (sel: string) => Math.round(el.querySelector<HTMLElement>(sel)!.getBoundingClientRect().height);
      console.log(`CC-340 ${lang}: record panel header ${head('app-record-panel header')}px, capped header ${head('am-capped-panel header')}px`);
    });
  }
});
