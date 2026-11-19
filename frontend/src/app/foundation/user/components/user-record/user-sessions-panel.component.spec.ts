import { Component, signal } from '@angular/core';
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
import { LanguageService } from '../../../../core/services/language.service';
import { AmConfirmOptions, AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import type { IUserSessionDto, IUserSessionsDto } from '../../services/user.service';
import { SESSIONS_REFUSAL_CODES } from './sessions-refusal';
import { SessionsPanelMode, UserSessionsPanelComponent } from './user-sessions-panel.component';

// ACC-216 Sessions, PR 2 — the "Signed-in devices" panel on its own: its request
// outcome (ready, empty, failed with Retry, refused = absent), its rows, every
// action's confirm and request, every refusal said from its code, Arabic. WHO
// sees it at all is the record page's decision, pinned in its spec (test 19).

@Component({
  standalone: true,
  imports: [UserSessionsPanelComponent],
  template: `<app-user-sessions-panel userId="user-1" [mode]="mode()" personName="Huda Al-Qahtani" />`,
})
class HostComponent {
  readonly mode = signal<SessionsPanelMode>('own');
}

const READ = '/users/user-1/sessions';
const CHROME = { browser: 'Chrome', os: 'Windows' };
const session = (id: string, over: Partial<IUserSessionDto> = {}): IUserSessionDto => ({
  id,
  startedAt: '2026-11-17T06:00:00.000Z',
  lastActiveAt: '2026-11-17T09:50:00.000Z',
  expiresAt: '2026-11-17T18:00:00.000Z',
  device: CHROME,
  address: '203.0.113.7',
  current: false,
  ...over,
});
type Tree = Record<string, unknown>;
const sessionsKeys = (lang: 'en' | 'ar'): Tree => ((((lang === 'en' ? en : ar) as Tree)['userRecord'] as Tree)['sessions'] as Tree);
const page = (rows: IUserSessionDto[], total = rows.length): IUserSessionsDto => ({ rows, total });
const THREE = [
  session('s-this', { current: true }),
  session('s-phone', { device: { browser: 'Safari', os: 'iOS' }, address: '198.51.100.4' }),
  session('s-old', { device: { browser: null, os: null }, address: null }),
];

describe('UserSessionsPanelComponent (ACC-216 Sessions)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let asked: AmConfirmOptions[];
  let format: FormatService;

  function setup(mode: SessionsPanelMode = 'own', arabic = false): void {
    asked = [];
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
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        {
          provide: LanguageService,
          useValue: { isArabic: () => arabic, isRtl: () => arabic, bilingual: (e: string, a: string | null) => (arabic ? a || e : e) },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(arabic ? 'ar' : 'en');
    http = TestBed.inject(HttpTestingController);
    format = TestBed.inject(FormatService);
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.mode.set(mode);
    el = fixture.nativeElement;
    fixture.detectChanges();
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask').forEach((m) => m.remove()));

  const readReq = (): TestRequest => http.expectOne((r) => r.method === 'GET' && r.url.endsWith(READ));
  function answer(req: TestRequest, body: object | 'fail' | 403 | 404 | { status: number; code: string }): void {
    if (body === 'fail') req.flush('x', { status: 500, statusText: 'Server Error' });
    else if (typeof body === 'number') req.flush('x', { status: body, statusText: 'Refused' });
    else if ('code' in body && 'status' in body) req.flush({ code: body.code, message: 'server English' }, { status: body.status, statusText: 'Conflict' });
    else req.flush(body);
    fixture.detectChanges();
  }
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const rows = () =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-session-row]')).map((r) => ({
      id: r.getAttribute('data-session-row'),
      // The device, then " + " and the tag when there is one (two elements, read apart).
      l1: [r.querySelector('.am-sp__device')!.textContent!.trim(), r.querySelector('.am-sp__tag')?.textContent?.trim()]
        .filter(Boolean)
        .join(' + '),
      l2: r.querySelector('.am-cp-l2')!.textContent!.trim(),
      endOne: !!r.querySelector('[data-testid="sessions-end-one"]'),
    }));

  describe('its request outcome', () => {
    it('ready: each device, "This device" on yours, last active and the address the server sent; the count is every sign-in', () => {
      setup('own');
      answer(readReq(), page(THREE, 3));
      const when = (iso: string) => format.relative(iso);
      expect(rows()).toEqual([
        { id: 's-this', l1: 'Chrome on Windows + This device', l2: `Last active ${when(THREE[0]!.lastActiveAt)} · 203.0.113.7`, endOne: false },
        { id: 's-phone', l1: 'Safari on iOS', l2: `Last active ${when(THREE[1]!.lastActiveAt)} · 198.51.100.4`, endOne: true },
        { id: 's-old', l1: 'Unknown browser on unknown system', l2: `Last active ${when(THREE[2]!.lastActiveAt)}`, endOne: true },
      ]);
      expect(q('sessions-count')!.textContent!.trim()).toBe('3');
      expect(q('sessions-head')!.textContent).toContain('Signed-in devices');
    });

    it('past five, See all opens the compact list of every sign-in, titled with the person', () => {
      setup('admin');
      answer(readReq(), page(Array.from({ length: 7 }, (_, i) => session(`s${i}`)), 7));
      expect(rows().length).toBe(5);
      q('sessions-see-all')!.click();
      fixture.detectChanges();
      expect(document.querySelector('[data-testid="list-dialog"] h2')!.textContent).toContain('Signed-in devices: Huda Al-Qahtani');
      expect(document.querySelectorAll('[data-testid="sessions-popup"] [data-session-row]').length).toBe(7);
    });

    it('empty: "No signed-in devices.", and no action offered', () => {
      setup('admin');
      answer(readReq(), page([], 0));
      expect(q('sessions-empty')!.textContent!.trim()).toBe('No signed-in devices.');
      expect(q('sessions-end-all')).toBeNull();
    });

    // Design review of #331: the record panel's own error state, not a text link.
    it("failed: the record panel's error state (message, error id, the small outlined Retry), which asks again", () => {
      setup('own');
      readReq().flush({ statusCode: 500, errorId: 'err-7f3a' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      const error = q('sessions-error')!;
      expect(error.querySelector('p-message')!.textContent).toContain("Signed-in devices couldn't be loaded.");
      expect(q('sessions-error-id')!.textContent).toContain('err-7f3a');
      const retry = error.querySelector<HTMLButtonElement>('p-button button')!;
      expect(retry.textContent!.trim()).toBe('Retry');
      expect(retry.className).toContain('p-button-outlined');
      expect(retry.className).toContain('p-button-sm');
      expect(error.textContent).not.toContain('Try again');
      retry.click();
      fixture.detectChanges();
      answer(readReq(), page(THREE));
      expect(q('sessions-error')).toBeNull();
      expect(rows().length).toBe(3);
    });

    for (const status of [403, 404] as const) {
      it(`refused (${status}): absent, its host hidden, never an empty panel`, () => {
        setup('admin');
        answer(readReq(), status);
        expect(el.querySelector<HTMLElement>('app-user-sessions-panel')!.style.display).toBe('none');
        expect(q('sessions-panel')).toBeNull();
      });
    }
  });

  describe('your own record', () => {
    it('no action on this device; "Sign out" on each other one, confirmed, saying up to 15 minutes, then the request and a fresh list', () => {
      setup('own');
      answer(readReq(), page(THREE));
      expect(q('sessions-end-all')).toBeNull();
      const phone = el.querySelector<HTMLElement>('[data-session-row="s-phone"] [data-testid="sessions-end-one"]')!;
      expect(phone.getAttribute('aria-label')).toBe('Sign out Safari on iOS');
      phone.click();
      expect(asked).toHaveSize(1);
      expect(asked[0]).toEqual(
        jasmine.objectContaining({
          tone: 'destructive',
          header: 'Sign out Safari on iOS?',
          message: 'Safari on iOS will be signed out. It can take up to 15 minutes to stop working.',
          acceptLabel: 'Sign out',
        }),
      );
      asked[0]!.accept();
      const end = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/auth/sessions/s-phone/end'));
      answer(end, { ended: 1 });
      expect(q('sessions-done')!.textContent).toContain('It can take up to 15 minutes');
      answer(readReq(), page([THREE[0]!, THREE[2]!]));
      expect(rows().map((r) => r.id)).toEqual(['s-this', 's-old']);
    });

    it('"Sign out other devices": offered when another device exists, confirmed, then POST end-others', () => {
      setup('own');
      answer(readReq(), page(THREE));
      q('sessions-end-others')!.click();
      expect(asked[0]).toEqual(
        jasmine.objectContaining({
          header: 'Sign out your other devices?',
          message: 'Every device except this one will be signed out. It can take up to 15 minutes for them to stop working.',
          acceptLabel: 'Sign out other devices',
        }),
      );
      asked[0]!.accept();
      answer(http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/auth/sessions/end-others')), { ended: 2 });
      expect(q('sessions-done')!.textContent).toContain('Your other devices are being signed out');
      readReq();
    });

    it('only this device: nothing to sign out, so neither action is offered', () => {
      setup('own');
      answer(readReq(), page([THREE[0]!]));
      expect(q('sessions-end-others')).toBeNull();
      expect(q('sessions-end-one')).toBeNull();
    });

    it('a cancelled confirm sends nothing', () => {
      setup('own');
      answer(readReq(), page(THREE));
      q('sessions-end-others')!.click();
      http.expectNone((r) => r.method === 'POST');
    });
  });

  describe("someone else's record, with the key", () => {
    it('one "Sign out everywhere", naming the person, at once and emailed; then POST end-all', () => {
      setup('admin');
      answer(readReq(), page(THREE.map((s) => ({ ...s, current: false }))));
      expect(q('sessions-end-others')).toBeNull();
      expect(q('sessions-end-one')).toBeNull();
      q('sessions-end-all')!.click();
      expect(asked[0]).toEqual(
        jasmine.objectContaining({
          tone: 'destructive',
          header: 'Sign Huda Al-Qahtani out everywhere?',
          message: 'Huda Al-Qahtani will be signed out of every device at once, and will get an email saying so.',
          acceptLabel: 'Sign out everywhere',
        }),
      );
      asked[0]!.accept();
      answer(http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/users/user-1/sessions/end-all')), { ended: 3 });
      expect(q('sessions-done')!.textContent).toContain('Huda Al-Qahtani was signed out everywhere.');
      readReq();
    });
  });

  describe('refusals, said from their code', () => {
    const expected: Record<string, string> = {
      SESSION_IS_CURRENT: "This is the device you're using. Use Sign out in the menu to end it.",
      CURRENT_SESSION_UNKNOWN: "This device's sign-in couldn't be identified. Sign out and sign in again, then try again.",
      SESSIONS_END_SELF: 'To sign yourself out of other devices, use your own record.',
      SESSIONS_IMPERSONATING: "This can't be done while signed in as someone else.",
      SESSIONS_END_HIGHER_ACCOUNT: 'Only an Organization Administrator can sign an Organization Administrator out everywhere.',
      ACCOUNT_OWNER_PROTECTED: "The account owner can't be signed out here. AccreditMe support can help.",
    };

    for (const code of SESSIONS_REFUSAL_CODES) {
      it(`${code}: its own sentence, never the server's English`, () => {
        setup('admin');
        answer(readReq(), page([session('s1')]));
        q('sessions-end-all')!.click();
        asked[0]!.accept();
        answer(http.expectOne((r) => r.method === 'POST'), { status: 409, code });
        const said = q('sessions-refusal')!.textContent!.trim();
        expect(said).toBe(expected[code]!);
        expect(said).not.toContain('server English');
      });
    }

    it('an unknown failure: the generic sentence', () => {
      setup('own');
      answer(readReq(), page(THREE));
      q('sessions-end-others')!.click();
      asked[0]!.accept();
      answer(http.expectOne((r) => r.method === 'POST'), 'fail');
      expect(q('sessions-refusal')!.textContent!.trim()).toBe("This couldn't be done. Try again.");
    });
  });

  describe('Arabic', () => {
    it('heading, rows, "This device" and the confirm in Arabic; every refusal has its Arabic sentence', () => {
      setup('own', true);
      answer(readReq(), page(THREE));
      expect(q('sessions-head')!.textContent).toContain('أجهزة الدخول');
      expect(rows()[0]!.l1).toBe('Chrome على Windows + هذا الجهاز');
      expect(rows()[2]!.l1).toBe('متصفح غير معروف على نظام غير معروف');
      q('sessions-end-others')!.click();
      expect(asked[0]!.message).toContain('15 دقيقة');
      const tree = sessionsKeys('ar')['refusal'] as Record<string, string>;
      for (const code of [...SESSIONS_REFUSAL_CODES, 'generic']) expect(tree[code]).toMatch(/[؀-ۿ]/);
    });

    it('failed and empty in Arabic: «إعادة المحاولة» and «لا توجد أجهزة دخول.»', () => {
      setup('own', true);
      answer(readReq(), 'fail');
      expect(q('sessions-error')!.querySelector('p-button button')!.textContent!.trim()).toBe('إعادة المحاولة');
      setup('admin', true);
      answer(readReq(), page([], 0));
      expect(q('sessions-empty')!.textContent!.trim()).toBe('لا توجد أجهزة دخول.');
    });

    // Design review of #331: the administrator's confirm says the email arrives.
    it("the administrator's confirm in Arabic: at once, and an email arrives saying so", () => {
      setup('admin', true);
      answer(readReq(), page(THREE));
      q('sessions-end-all')!.click();
      expect(asked[0]!.message).toBe('سيتم تسجيل خروج Huda Al-Qahtani من كل الأجهزة فورًا، ويصل بريد إلكتروني يفيد بذلك.');
    });

    it('Arabic uses «منشأة» for the organisation and no gendered address', () => {
      const all = JSON.stringify(sessionsKeys('ar'));
      expect(all).toContain('المنشأة');
      for (const gendered of ['أنتِ', 'أنتَ', 'قامت', ' هي ', ' هو ']) expect(all).not.toContain(gendered);
    });
  });
});
