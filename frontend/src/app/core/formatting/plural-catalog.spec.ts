import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslatePipe, TranslateService, provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { AmCountPipe } from './format.pipes';
import { FormatService, EMPTY_VALUE } from './format.service';
import { PluralCatalog, providePluralAwareTranslateLoader } from './plural-catalog';
import { PluralKey } from './plural-key';
import { loadTranslationsForTest, provideFormatTesting } from './testing';

// ACC-94, decision D1 — counted strings, and condition (a): a plural key must be
// impossible to render through the plain translate pipe.

// No real counted string exists until the translation files gain their plural
// sections (next commit), so these specs use their own.
const key = (path: string) => path as unknown as PluralKey;

const EN_FILE = {
  greeting: 'Hello',
  plural: { demo: { items: { one: '{{count}} item in {{place}}', other: '{{count}} items in {{place}}' } } },
};
const AR_FILE = {
  greeting: 'مرحبًا',
  plural: {
    demo: {
      items: {
        zero: 'لا عناصر في {{place}}',
        one: 'عنصر واحد في {{place}}',
        two: 'عنصران في {{place}}',
        few: '{{count}} عناصر في {{place}}',
        many: '{{count}} عنصرًا في {{place}}',
        other: '{{count}} عنصر في {{place}}',
      },
    },
  },
};

@Component({
  standalone: true,
  imports: [TranslatePipe],
  template: `<span id="translated">{{ 'plural.demo.items' | translate }}</span>`,
})
class TranslatePipeHostComponent {}

describe('Counted strings are unreachable through the translate pipe (ACC-94, D1 a)', () => {
  const loaderChain = (withSplitting: boolean) => {
    TestBed.configureTestingModule({
      imports: [TranslatePipeHostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en' }),
        provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' }),
        ...(withSplitting ? providePluralAwareTranslateLoader() : []),
      ],
    });
    const translate = TestBed.inject(TranslateService);
    const http = TestBed.inject(HttpTestingController);
    translate.use('en').subscribe();
    http.expectOne('./assets/i18n/en.json').flush(EN_FILE);
    return translate;
  };

  it('with the app loader chain: ngx-translate has no plural key, the catalogue has the forms', () => {
    const translate = loaderChain(true);

    expect(translate.instant('greeting')).toBe('Hello');
    expect(translate.instant('plural.demo.items')).toBe('plural.demo.items');
    expect(TestBed.inject(PluralCatalog).forms('en', 'demo.items')).toEqual(EN_FILE.plural.demo.items);

    const fixture = TestBed.createComponent(TranslatePipeHostComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).querySelector('#translated')?.textContent;
    expect(text).toBe('plural.demo.items');
    expect(text).not.toContain('[object Object]');
  });

  it('control: without the splitting loader, the translate pipe WOULD reach the forms object', () => {
    const translate = loaderChain(false);
    expect(typeof translate.instant('plural.demo.items')).toBe('object');
  });
});

describe('FormatService.count (ACC-94, D1)', () => {
  let format: FormatService;
  let translate: TranslateService;
  let catalog: PluralCatalog;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()],
    });
    translate = TestBed.inject(TranslateService);
    catalog = TestBed.inject(PluralCatalog);
    format = TestBed.inject(FormatService);
  });

  it('picks all six Arabic categories by count, with Latin digits', () => {
    loadTranslationsForTest({ ar: AR_FILE });
    translate.use('ar');
    const say = (n: number) => format.count(key('demo.items'), n, { place: 'القائمة' });
    expect(say(0)).toBe('لا عناصر في القائمة');
    expect(say(1)).toBe('عنصر واحد في القائمة');
    expect(say(2)).toBe('عنصران في القائمة');
    expect(say(3)).toBe('3 عناصر في القائمة');
    expect(say(10)).toBe('10 عناصر في القائمة');
    expect(say(11)).toBe('11 عنصرًا في القائمة');
    expect(say(100)).toBe('100 عنصر في القائمة');
    // Arabic categories follow the last two digits: 1,234 ends in 34 → many.
    expect(say(1234)).toBe('1,234 عنصرًا في القائمة');
    expect(say(1200)).toBe('1,200 عنصر في القائمة');
  });

  it('uses English one and other, and formats the count', () => {
    loadTranslationsForTest({ en: EN_FILE });
    expect(format.count(key('demo.items'), 1, { place: 'the list' })).toBe('1 item in the list');
    expect(format.count(key('demo.items'), 0, { place: 'the list' })).toBe('0 items in the list');
    expect(format.count(key('demo.items'), 2500, { place: 'the list' })).toBe('2,500 items in the list');
  });

  it('shows the key for an unknown key, and — for a missing count', () => {
    loadTranslationsForTest({ en: EN_FILE });
    expect(format.count(key('demo.missing'), 3)).toBe('demo.missing');
    expect(format.count(key('demo.items'), null)).toBe(EMPTY_VALUE);
  });

  it('re-evaluates inside computed() on a language switch and when a language file arrives', () => {
    loadTranslationsForTest({ en: EN_FILE });
    const label = computed(() => format.count(key('demo.items'), 2, { place: 'X' }));
    expect(label()).toBe('2 items in X');

    translate.use('ar');
    expect(label()).toBe('demo.items'); // Arabic not loaded yet
    catalog.register('ar', AR_FILE.plural);
    expect(label()).toBe('عنصران في X');
  });
});

@Component({
  standalone: true,
  imports: [AmCountPipe],
  template: `<span id="count">{{ n() | amCount: countKey : { place: 'Setup health' } }}</span>`,
})
class CountHostComponent {
  readonly n = signal(1);
  readonly countKey = key('demo.items');
}

describe('amCount pipe (ACC-94)', () => {
  it('renders the plural form and follows the count and the language', () => {
    TestBed.configureTestingModule({
      imports: [CountHostComponent],
      providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()],
    });
    loadTranslationsForTest({ en: EN_FILE, ar: AR_FILE });
    const translate = TestBed.inject(TranslateService);
    translate.use('en');

    const fixture = TestBed.createComponent(CountHostComponent);
    fixture.detectChanges();
    const text = () => (fixture.nativeElement as HTMLElement).querySelector('#count')?.textContent;
    expect(text()).toBe('1 item in Setup health');

    fixture.componentInstance.n.set(5);
    fixture.detectChanges();
    expect(text()).toBe('5 items in Setup health');

    translate.use('ar');
    fixture.detectChanges();
    expect(text()).toBe('5 عناصر في Setup health');
  });
});
