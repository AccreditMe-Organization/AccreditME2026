import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../theme/accreditme-preset';
import { TestFormatContext } from '../../formatting/format-context';
import { loadTranslationsForTest, provideFormatTesting } from '../../formatting/testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { SessionLimitService } from '../../services/session-limit.service';
import { SessionLimitWarningComponent } from './session-limit-warning.component';

// ACC-126 — "Your session ends soon": the wording Ahmad approved, the time in
// the organisation's zone, "Continue working" and "Sign out now", and no
// "Stay signed in".
describe('SessionLimitWarningComponent (ACC-126)', () => {
  preserveDocumentLanguage();
  // 17:50 in Riyadh (UTC+3).
  const ENDS_AT = Date.parse('2026-11-13T14:50:00.000Z');
  let limit: { warningVisible: ReturnType<typeof signal<boolean>>; endsAt: ReturnType<typeof signal<number | null>>; dismiss: jasmine.Spy; signOutNow: jasmine.Spy };

  async function render(lang: 'en' | 'ar'): Promise<HTMLElement> {
    limit = {
      warningVisible: signal(true),
      endsAt: signal<number | null>(ENDS_AT),
      dismiss: jasmine.createSpy('dismiss'),
      signOutNow: jasmine.createSpy('signOutNow'),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SessionLimitWarningComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: SessionLimitService, useValue: limit },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(TestFormatContext).zone.set('Asia/Riyadh');
    const fixture = TestBed.createComponent(SessionLimitWarningComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return document.body;
  }

  afterEach(() => {
    document.querySelectorAll('app-session-limit-warning, .p-dialog-mask, .p-dialog').forEach((el) => el.remove());
  });

  const dialog = () => document.querySelector<HTMLElement>('.p-dialog[role="alertdialog"]');
  const button = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('.p-dialog button')).find(
      (b) => b.textContent?.trim() === label,
    );

  it('says when the session ends, in English, at the organisation’s time', async () => {
    await render('en');
    expect(dialog()).withContext('an alertdialog').not.toBeNull();
    expect(dialog()!.textContent).toContain('Your session ends soon');
    expect(document.querySelector('[data-testid="session-limit-body"]')!.textContent!.trim()).toBe(
      "For security, a session lasts 12 hours. You'll be signed out at 17:50. Save your work, then sign in again.",
    );
  });

  it('says it in Arabic', async () => {
    await render('ar');
    expect(dialog()!.textContent).toContain('تنتهي الجلسة قريبًا');
    expect(document.querySelector('[data-testid="session-limit-body"]')!.textContent!.trim()).toBe(
      'لأغراض الأمان، تمتد الجلسة 12 ساعة، وسيتم تسجيل الخروج عند 17:50. يُرجى حفظ العمل ثم تسجيل الدخول من جديد.',
    );
    expect(button('متابعة العمل')).toBeDefined();
    expect(button('تسجيل الخروج الآن')).toBeDefined();
  });

  it('offers "Continue working" and "Sign out now" — and no "Stay signed in"', async () => {
    await render('en');
    const labels = Array.from(document.querySelectorAll('.p-dialog-footer button, .p-dialog button'))
      .map((b) => b.textContent?.trim())
      .filter((t) => !!t);
    expect(labels).toContain('Continue working');
    expect(labels).toContain('Sign out now');
    expect(labels).not.toContain('Stay signed in');
  });

  it('"Continue working" dismisses; "Sign out now" signs out', async () => {
    await render('en');
    button('Continue working')!.click();
    expect(limit.dismiss).toHaveBeenCalledTimes(1);
    button('Sign out now')!.click();
    expect(limit.signOutNow).toHaveBeenCalledTimes(1);
  });

  it('Escape dismisses the warning; it never signs out', async () => {
    await render('en');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r));
    expect(limit.dismiss).toHaveBeenCalled();
    expect(limit.signOutNow).not.toHaveBeenCalled();
  });

  it('has the exact approved wording in both translation files', () => {
    expect(en.session.limit).toEqual({
      title: 'Your session ends soon',
      body: "For security, a session lasts 12 hours. You'll be signed out at {{time}}. Save your work, then sign in again.",
      continueWorking: 'Continue working',
    });
    expect(ar.session.limit).toEqual({
      title: 'تنتهي الجلسة قريبًا',
      body: 'لأغراض الأمان، تمتد الجلسة 12 ساعة، وسيتم تسجيل الخروج عند {{time}}. يُرجى حفظ العمل ثم تسجيل الدخول من جديد.',
      continueWorking: 'متابعة العمل',
    });
  });
});
