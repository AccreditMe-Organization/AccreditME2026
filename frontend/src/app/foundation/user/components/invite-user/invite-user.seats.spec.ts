import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { InviteUserComponent } from './invite-user.component';

// ACC-159 — the invite form's seats line, read from GET /users/seats when the
// form is built (the host rebuilds it on every opening). Normal, full (with
// what frees a seat), and a failed read or no limit: nothing at all, never
// "0 of 0". Send is never disabled by it, and the server's seat refusal is
// said from its code.
describe('InviteUserComponent — the seats line (ACC-159)', () => {
  let fixture: ComponentFixture<InviteUserComponent>;
  let http: HttpTestingController;

  function render(opts: { permissions?: string[]; arabic?: boolean } = {}): void {
    const permissions = opts.permissions ?? ['users:invite'];
    const arabic = opts.arabic ?? false;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [InviteUserComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => arabic,
            isRtl: () => arabic,
            bilingual: (e: string, a: string | null) => (arabic ? a || e : e),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(arabic ? 'ar' : 'en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(InviteUserComponent);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/org-positions`).flush([]);
    http.expectOne(`${environment.apiUrl}/organization/units/flat`).flush([]);
    http.expectOne(`${environment.apiUrl}/users?status=ACTIVE&pageSize=200`).flush({ data: [], total: 0, page: 1, pageSize: 200 });
  }

  const seatsRequest = () => http.expectOne((r) => r.url === `${environment.apiUrl}/users/seats` && r.method === 'GET');
  const line = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-invite-seats]');
  const answer = (seats: { occupied: number; maxUsers: number }): void => {
    seatsRequest().flush(seats);
    fixture.detectChanges();
  };

  afterEach(() => http.verify());

  it('reads the seats once, when the form is built, and says how many are in use', () => {
    render();
    answer({ occupied: 7, maxUsers: 25 });
    expect(line()!.textContent!.trim()).toBe('7 of 25 seats in use.');
    expect(line()!.hasAttribute('data-full')).toBeFalse();
    // Beside the subtitle, in its paragraph.
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-invite-subtitle]')!.textContent).toContain(
      "They'll get an email",
    );
  });

  it('full: says so and what frees a seat, and Send is not disabled by it', () => {
    render();
    answer({ occupied: 25, maxUsers: 25 });
    expect(line()!.hasAttribute('data-full')).toBeTrue();
    expect(line()!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'No free seats until an invitation expires or someone is deactivated.',
    );
    // Full takes the subtitle's place: a full organisation's Send sends no email.
    const subtitle = (fixture.nativeElement as HTMLElement).querySelector('[data-invite-subtitle]')!;
    expect(subtitle.textContent).not.toContain("They'll get an email");
    // The host's Send button disables only on saving or a refused read (denied).
    expect(fixture.componentInstance.saving()).toBeFalse();
    expect(fixture.componentInstance.denied()).toBeFalse();
  });

  it('a failed read says nothing about seats, and the form still works', () => {
    render();
    seatsRequest().flush({ message: 'nope' }, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    expect(line()).toBeNull();
    expect(fixture.componentInstance.error()).toBeNull();
    expect(fixture.componentInstance.denied()).toBeFalse();
  });

  it('no limit: nothing, never "0 of 0"', () => {
    render();
    answer({ occupied: 3, maxUsers: 0 });
    expect(line()).toBeNull();
  });

  it('without users:invite it never asks', () => {
    render({ permissions: [] });
    http.expectNone(`${environment.apiUrl}/users/seats`);
    expect(line()).toBeNull();
  });

  it('a seat refusal on Send is said from its code, and the line is read again', () => {
    render();
    answer({ occupied: 24, maxUsers: 25 });
    const c = fixture.componentInstance;
    c.form.controls.name.setValue('Dr. Nora Al-Otaibi');
    c.form.controls.email.setValue('nora@example.test');
    c.form.controls.positionId.setValue('pos-1');
    c.form.controls.managerId.setValue('mgr-1');
    c.onSubmit();
    http
      .expectOne((r) => r.url === `${environment.apiUrl}/users/invite` && r.method === 'POST')
      .flush(
        { statusCode: 409, message: 'SERVER ENGLISH', error: 'Conflict', code: 'SEAT_LIMIT_REACHED' },
        { status: 409, statusText: 'Conflict' },
      );
    answer({ occupied: 25, maxUsers: 25 });
    expect(c.error()).toBe(
      "Every seat on your organisation's plan is in use. A seat frees up when an invitation expires or someone is deactivated.",
    );
    expect(line()!.hasAttribute('data-full')).toBeTrue();
  });

  it('Arabic: the count, and the full sentence naming the organisation', () => {
    render({ arabic: true });
    answer({ occupied: 7, maxUsers: 25 });
    expect(line()!.textContent!.trim()).toBe('المقاعد المستخدمة: 7 من 25.');

    render({ arabic: true });
    answer({ occupied: 25, maxUsers: 25 });
    const text = line()!.textContent!.replace(/\s+/g, ' ').trim();
    expect(text).toBe('لا مقاعد شاغرة في المنشأة: يتوفر مقعد بانتهاء صلاحية دعوة أو بإلغاء تفعيل مستخدم.');
    
  });
});
