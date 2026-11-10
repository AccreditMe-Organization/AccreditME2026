import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { EMPTY_VALUE, FormatService } from './format.service';
import { AmMoneyPipe } from './format.pipes';
import { provideFormatTesting } from './testing';
import { preserveDocumentLanguage } from '../../../testing/document-language';

// ACC-120 — a price reads whole ("4,800") or with exactly two decimals
// ("4,800.50", "49.90"), never "4,800.5". Latin digits in both languages.

@Component({
  standalone: true,
  imports: [AmMoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span id="price">{{ price() | amMoney }}</span>`,
})
class PriceHostComponent {
  readonly price = signal<number | null>(4800.5);
}

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

describe('FormatService.money and amMoney (ACC-120)', () => {
  preserveDocumentLanguage();

  let format: FormatService;
  let translate: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PriceHostComponent],
      providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()],
    });
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {});
    translate.setTranslation('ar', {});
    translate.use('en');
    format = TestBed.inject(FormatService);
  });

  for (const language of ['en', 'ar'] as const) {
    describe(language === 'en' ? 'in English' : 'in Arabic', () => {
      beforeEach(() => translate.use(language));

      it('a price with a fraction shows two decimals: 4800.5 → "4,800.50"', () => {
        expect(format.money(4800.5)).toBe('4,800.50');
      });

      it('a whole price stays whole: 4800 → "4,800"', () => {
        expect(format.money(4800)).toBe('4,800');
      });

      it('49.9 → "49.90"', () => {
        expect(format.money(49.9)).toBe('49.90');
      });

      it('keeps Latin digits', () => {
        expect(format.money(1234567.25)).toBe('1,234,567.25');
        expect(format.money(1234567.25)).not.toMatch(ARABIC_INDIC_DIGITS);
      });
    });
  }

  it('a fraction that rounds to whole cents reads whole', () => {
    expect(format.money(4800.001)).toBe('4,800');
  });

  it('nothing to show is "—"', () => {
    expect(format.money(null)).toBe(EMPTY_VALUE);
    expect(format.money(undefined)).toBe(EMPTY_VALUE);
    expect(format.money(Number.NaN)).toBe(EMPTY_VALUE);
  });

  it('the pipe renders the same, in both languages', () => {
    const fixture = TestBed.createComponent(PriceHostComponent);
    const text = () => (fixture.nativeElement as HTMLElement).querySelector('#price')!.textContent;
    fixture.detectChanges();
    expect(text()).toBe('4,800.50');
    translate.use('ar');
    fixture.detectChanges();
    expect(text()).toBe('4,800.50');
    fixture.componentInstance.price.set(4800);
    fixture.detectChanges();
    expect(text()).toBe('4,800');
  });
});
