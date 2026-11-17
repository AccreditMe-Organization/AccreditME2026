import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { FormatService } from '../../../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import type { IAccessHistoryRowDto, IUserAccessHistoryPageDto } from '../../services/user.service';
import { ACCESS_HISTORY_POPUP_PAGE, UserAccessHistoryPanelComponent } from './user-access-history-panel.component';

// ACC-216 part 2 — the Access history panel on its own: five rows, its own
// request outcome (ready, empty, failed with Retry), a refused read (absent, host
// hidden), See all read fifty at a time, Arabic. Whether it exists at all is the
// record page's decision, pinned in its spec (test 18).

@Component({
  standalone: true,
  imports: [UserAccessHistoryPanelComponent],
  template: `<app-user-access-history-panel userId="user-1" personName="Huda Al-Qahtani" />`,
})
class HostComponent {}

const URL_END = '/users/user-1/access-history';
const ME = 'user-me';

const entry = (i: number, over: Partial<IAccessHistoryRowDto> = {}): IAccessHistoryRowDto => ({
  id: `audit:a${i}`,
  at: `2026-11-${String(10 + (i % 15)).padStart(2, '0')}T08:00:00.000Z`,
  kind: 'DEACTIVATED',
  actor: { id: 'user-admin', name: 'Ahmad Admin' },
  ...over,
});
const page = (rows: IAccessHistoryRowDto[], total = rows.length, skip = 0, take = 5): IUserAccessHistoryPageDto => ({
  rows,
  total,
  skip,
  take,
});

describe('UserAccessHistoryPanelComponent (ACC-216 part 2)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let format: FormatService;

  function setup(arabic = false): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: AuthService, useValue: { currentUser: () => ({ id: ME }) } },
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => arabic,
            isRtl: () => arabic,
            bilingual: (nameEn: string, nameAr: string | null) => (arabic ? nameAr || nameEn : nameEn),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(arabic ? 'ar' : 'en');
    http = TestBed.inject(HttpTestingController);
    format = TestBed.inject(FormatService);
    fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask').forEach((m) => m.remove()));

  const firstReq = (): TestRequest =>
    http.expectOne((r) => r.url.endsWith(URL_END) && r.params.get('skip') === '0' && r.params.get('take') === '5');
  function answer(req: TestRequest, body: object | 'fail' | 403 | 404): void {
    if (body === 'fail') req.flush('x', { status: 500, statusText: 'Server Error' });
    else if (typeof body === 'number') req.flush('x', { status: body, statusText: 'Refused' });
    else req.flush(body);
    fixture.detectChanges();
  }
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const rows = () =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-access-row]')).map((r) => ({
      what: r.querySelector('.am-cp-l1')!.textContent!.trim(),
      when: r.querySelector('.am-cp-l2')!.textContent!.trim(),
    }));

  it('ready: asks for the first five; each row says what changed, then when and by whom; the count is every row', () => {
    setup();
    answer(firstReq(), page([
      entry(1, { kind: 'ROLE_GRANTED', role: { id: 'r', nameEn: 'Quality Manager', nameAr: 'مدير الجودة' }, viaHeadship: false }),
      entry(2, { kind: 'PASSWORD_RESET', actor: { id: ME, name: 'Me' } }),
      entry(3, { kind: 'SIGNED_IN_AS', actor: null }),
    ], 3));
    expect(rows()).toEqual([
      { what: 'Role granted: Quality Manager', when: `${format.dateTime(entry(1).at)} · by Ahmad Admin` },
      { what: 'Password reset', when: `${format.dateTime(entry(2).at)} · by you` },
      { what: 'AccreditMe support signed in as this person', when: format.dateTime(entry(3).at) },
    ]);
    expect(q('access-history-count')!.textContent!.trim()).toBe('3');
    expect(q('access-history-head')!.textContent).toContain('Access history');
    expect(q('access-history-foot')).toBeNull();
  });

  it('at most five rows; See all shows above five', () => {
    setup();
    answer(firstReq(), page([1, 2, 3, 4, 5].map((i) => entry(i)), 63));
    expect(rows().length).toBe(5);
    expect(q('access-history-count')!.textContent!.trim()).toBe('63');
    expect(q('access-history-see-all')).not.toBeNull();
  });

  it('empty: "No changes recorded", never a blank panel', () => {
    setup();
    answer(firstReq(), page([], 0));
    expect(q('access-history-empty')!.textContent).toContain('No changes recorded');
    expect(rows().length).toBe(0);
  });

  it('failed: its own message and Retry, which asks again and then shows the rows', () => {
    setup();
    answer(firstReq(), 'fail');
    const error = q('access-history-error')!;
    expect(error.textContent).toContain("Access history couldn't be loaded.");
    error.querySelector('button')!.click();
    fixture.detectChanges();
    answer(firstReq(), page([entry(1)], 1));
    expect(q('access-history-error')).toBeNull();
    expect(rows().length).toBe(1);
  });

  for (const status of [403, 404] as const) {
    it(`a refused read (${status}): absent, host hidden, never an empty panel`, () => {
      setup();
      answer(firstReq(), status);
      const host = el.querySelector<HTMLElement>('app-user-access-history-panel')!;
      expect(host.style.display).toBe('none');
      expect(q('access-history-panel')).toBeNull();
    });
  }

  describe('See all', () => {
    const popupRows = () => document.querySelectorAll('[data-testid="access-history-popup"] [data-access-row]');
    function open(total: number): TestRequest {
      setup();
      answer(firstReq(), page([1, 2, 3, 4, 5].map((i) => entry(i)), total));
      q('access-history-see-all')!.click();
      fixture.detectChanges();
      return http.expectOne(
        (r) => r.url.endsWith(URL_END) && r.params.get('skip') === '0' && r.params.get('take') === String(ACCESS_HISTORY_POPUP_PAGE),
      );
    }

    it(`opens the compact list titled with the person, read ${ACCESS_HISTORY_POPUP_PAGE} at a time; Load more adds the next ${ACCESS_HISTORY_POPUP_PAGE}`, () => {
      expect(ACCESS_HISTORY_POPUP_PAGE).toBe(50);
      const req = open(63);
      answer(req, page(Array.from({ length: 50 }, (_, i) => entry(i + 1)), 63, 0, 50));
      expect(document.querySelector('[data-testid="list-dialog"] h2')!.textContent).toContain('Access history of Huda Al-Qahtani');
      expect(popupRows().length).toBe(50);
      document.querySelector<HTMLButtonElement>('[data-testid="access-history-more"]')!.click();
      fixture.detectChanges();
      const more = http.expectOne((r) => r.url.endsWith(URL_END) && r.params.get('skip') === '50' && r.params.get('take') === '50');
      answer(more, page(Array.from({ length: 13 }, (_, i) => entry(i + 51)), 63, 50, 50));
      expect(popupRows().length).toBe(63);
      expect(document.querySelector('[data-testid="access-history-more"]')).toBeNull();
    });

    it('a failed Load more says so and offers Retry, keeping the rows already read', () => {
      const req = open(63);
      answer(req, page(Array.from({ length: 50 }, (_, i) => entry(i + 1)), 63, 0, 50));
      document.querySelector<HTMLButtonElement>('[data-testid="access-history-more"]')!.click();
      fixture.detectChanges();
      answer(http.expectOne((r) => r.url.endsWith(URL_END) && r.params.get('skip') === '50'), 'fail');
      const failed = document.querySelector<HTMLElement>('[data-testid="access-history-more-error"]')!;
      expect(failed).not.toBeNull();
      expect(popupRows().length).toBe(50);
      failed.querySelector('button')!.click();
      fixture.detectChanges();
      http.expectOne((r) => r.url.endsWith(URL_END) && r.params.get('skip') === '50');
    });
  });

  it('Arabic: heading, rows and "by" in Arabic, dates through the formatting layer', () => {
    setup(true);
    answer(firstReq(), page([entry(1, { kind: 'TWO_STEP_RESET' })], 1));
    expect(q('access-history-head')!.textContent).toContain('سجل الوصول');
    expect(rows()).toEqual([{ what: 'إعادة ضبط التحقق بخطوتين', when: `${format.dateTime(entry(1).at)} · بواسطة Ahmad Admin` }]);
  });

  it('Arabic empty: «لم تُسجَّل أي تغييرات»', () => {
    setup(true);
    answer(firstReq(), page([], 0));
    expect(q('access-history-empty')!.textContent).toContain('لم تُسجَّل أي تغييرات');
  });

  it('its template uses no retired --am-text-secondary', () => {
    const def = (UserAccessHistoryPanelComponent as unknown as { ɵcmp: { styles: unknown } }).ɵcmp;
    const styles = JSON.stringify(def.styles);
    expect(styles).withContext('the styles were read').toContain('--am-ink-500');
    expect(styles).not.toContain('--am-text-secondary');
  });
});
