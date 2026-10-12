import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { IEmailConfig } from '../../../tenant/services/tenant.service';
import { EMAIL_PROVIDER_FIELDS, EmailProviderSettingsComponent } from './email-provider-settings.component';

// ACC-181 — the email provider screen keeps secrets write-only.

const NONE: IEmailConfig = { provider: null, settings: null, secretsSetAt: {}, defaultSender: 'no-reply@example.test' };
const SMTP_SET: IEmailConfig = {
  provider: 'smtp',
  settings: {
    host: 'mail.example.test',
    port: 587,
    encryption: 'STARTTLS',
    username: 'svc-accreditme',
    password: 'set',
    fromAddress: 'quality@example.test',
    fromName: 'Quality',
  },
  secretsSetAt: { password: '2026-09-29T08:00:00.000Z' },
  defaultSender: 'no-reply@example.test',
};

describe('EmailProviderSettingsComponent (ACC-181)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<EmailProviderSettingsComponent>;
  let http: HttpTestingController;
  let confirmation: ConfirmationService;
  const url = `${environment.apiUrl}/tenant/email-config`;
  const el = () => fixture.nativeElement as HTMLElement;

  function setup(get: IEmailConfig, language: 'en' | 'ar' = 'en', render = true): EmailProviderSettingsComponent {
    TestBed.configureTestingModule({
      imports: [EmailProviderSettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    confirmation = TestBed.inject(ConfirmationService);
    fixture = TestBed.createComponent(EmailProviderSettingsComponent);
    fixture.detectChanges();
    http.expectOne(url).flush(get);
    if (render) fixture.detectChanges();
    return fixture.componentInstance;
  }
  const fieldNames = () =>
    Array.from(el().querySelectorAll('[data-email-field]')).map((n) => n.getAttribute('data-email-field'));

  afterEach(() => http.verify());

  // Test 2 — the ACC-181 bug itself.
  it('saving with untouched secrets sends NO secret key, and never the word "set"', () => {
    const c = setup(SMTP_SET);
    expect(c.form.controls.smtp.controls['password']!.value).toBe('');
    c.save();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('PATCH');
    const body = req.request.body as { provider: string; smtp: Record<string, unknown> };
    expect(body.provider).toBe('smtp');
    expect('password' in body.smtp).toBeFalse();
    expect(JSON.stringify(body)).not.toContain('"set"');
    expect(body.smtp).toEqual({
      host: 'mail.example.test',
      port: 587,
      encryption: 'STARTTLS',
      username: 'svc-accreditme',
      fromAddress: 'quality@example.test',
      fromName: 'Quality',
    });
    req.flush(SMTP_SET);
  });

  it('the form never holds a stored secret, even before the secret field renders', () => {
    // am-secret-field also clears its control when it renders; this pins the
    // screen on its own, with no help from the child.
    const c = setup(SMTP_SET, 'en', false);
    expect(c.form.controls.smtp.controls['password']!.value).toBe('');
    c.save();
    const req = http.expectOne(url);
    expect('password' in (req.request.body as { smtp: Record<string, unknown> }).smtp).toBeFalse();
    req.flush(SMTP_SET);
  });

  it('a newly typed secret is sent', () => {
    const c = setup(SMTP_SET);
    c.form.controls.smtp.controls['password']!.setValue('a-new-password');
    c.save();
    const req = http.expectOne(url);
    expect((req.request.body as { smtp: Record<string, unknown> }).smtp['password']).toBe('a-new-password');
    req.flush(SMTP_SET);
  });

  it('the stored secret shows as "set 29 Sep 2026" with no input for it', () => {
    setup(SMTP_SET);
    const pw = el().querySelector('[data-email-field="password"]')!;
    expect(pw.querySelector('input')).toBeNull();
    expect(pw.textContent).toContain('set 29 Sep 2026');
  });

  // Test 3
  it('each provider shows exactly its fields, in the drawing\'s order', () => {
    const c = setup(NONE);
    c.connect();
    fixture.detectChanges();
    for (const provider of ['resend', 'smtp', 'office365', 'sendgrid', 'ses'] as const) {
      c.form.controls.provider.setValue(provider);
      fixture.detectChanges();
      expect(fieldNames()).withContext(provider).toEqual(EMAIL_PROVIDER_FIELDS[provider].map((f) => f.name));
    }
    c.form.controls.provider.setValue('smtp');
    fixture.detectChanges();
    expect(fieldNames()).toEqual(['host', 'port', 'encryption', 'username', 'password', 'fromAddress', 'fromName']);
    c.form.controls.provider.setValue('ses');
    fixture.detectChanges();
    expect(fieldNames()).toEqual(['region', 'accessKeyId', 'secretAccessKey', 'fromAddress']);
  });

  // Test 4
  it('the port follows encryption until it is edited, then stops', () => {
    const c = setup(NONE);
    const smtp = c.form.controls.smtp.controls;
    expect(smtp['port']!.value).toBe('587');
    smtp['encryption']!.setValue('SSL_TLS');
    expect(smtp['port']!.value).toBe('465');
    smtp['encryption']!.setValue('NONE');
    expect(smtp['port']!.value).toBe('25');
    smtp['port']!.setValue('2525');
    smtp['encryption']!.setValue('STARTTLS');
    expect(smtp['port']!.value).toBe('2525');
  });

  it('a stored port that is not the encryption\'s own counts as edited', () => {
    const c = setup({ ...SMTP_SET, settings: { ...SMTP_SET.settings!, port: 2525 } });
    c.form.controls.smtp.controls['encryption']!.setValue('SSL_TLS');
    expect(c.form.controls.smtp.controls['port']!.value).toBe('2525');
  });

  it('says it is loading until the settings arrive, then shows them', () => {
    TestBed.configureTestingModule({
      imports: [EmailProviderSettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EmailProviderSettingsComponent);
    fixture.detectChanges();
    expect(el().querySelector('[data-email-loading]')?.textContent?.trim()).toBe('Loading...');
    expect(el().querySelector('[data-email-resting]')).toBeNull();
    http.expectOne(url).flush(NONE);
    fixture.detectChanges();
    expect(el().querySelector('[data-email-loading]')).toBeNull();
    expect(el().querySelector('[data-email-resting]')).not.toBeNull();
  });

  // Test 5
  it('with no provider: the sentence and Connect a provider, and no form', () => {
    setup(NONE);
    expect(el().querySelector('[data-email-resting]')).not.toBeNull();
    expect(el().querySelector('[data-email-connect]')).not.toBeNull();
    expect(el().querySelector('[data-email-form]')).toBeNull();
    expect(el().querySelector('input')).toBeNull();
  });

  it('the not-active-yet banner is shown, and there is no Send test email', () => {
    setup(SMTP_SET);
    expect(el().querySelector('[data-email-not-active]')?.textContent).toContain('Not active yet');
    expect(el().textContent).not.toMatch(/test email/i);
    expect(el().querySelector('[data-email-save]')?.textContent?.trim()).toBe('Save for later');
  });

  // Test 6
  it('the sentence names the platform sender — and names none when there is none', () => {
    setup(NONE);
    const sentence = () => el().querySelector('[data-email-default-sentence]')!.textContent!.trim();
    expect(sentence()).toContain('no-reply@example.test');
    expect(sentence()).toContain('via Resend');
    TestBed.resetTestingModule();
    setup({ ...NONE, defaultSender: null });
    expect(sentence()).not.toContain('@');
    expect(sentence()).toContain("AccreditMe's own delivery");
  });

  // Test 7
  it('Disconnect asks first, and only the accept calls DELETE', () => {
    const c = setup(SMTP_SET);
    const confirm = spyOn(confirmation, 'confirm').and.callThrough();
    (el().querySelector('[data-email-disconnect] button') as HTMLButtonElement).click();
    expect(confirm).toHaveBeenCalledTimes(1);
    http.expectNone(url);
    const args = confirm.calls.mostRecent().args[0];
    expect(args.header).toBe('Disconnect SMTP / on-premises Exchange?');
    args.accept!();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('DELETE');
    req.flush(NONE);
    fixture.detectChanges();
    expect(c.stored()?.provider).toBeNull();
    expect(el().querySelector('[data-email-resting]')).not.toBeNull();
  });

  it('a refused incomplete save names the missing fields by their labels', () => {
    const c = setup(NONE);
    c.connect();
    c.form.controls.provider.setValue('resend');
    c.form.controls.resend.controls['apiKey']!.setValue('re_key');
    c.form.controls.resend.controls['fromAddress']!.setValue('quality@example.test');
    c.save();
    http.expectOne(url).flush(
      { statusCode: 400, code: 'EMAIL_SETTINGS_INCOMPLETE', message: 'English', missing: ['apiKey', 'fromAddress'] },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    expect(c.error()).toBe('Fill in: API key, Sender address.');
  });

  // Test 8
  it('Arabic: labels and the sentence are Arabic; product names stay Latin', () => {
    const c = setup(SMTP_SET, 'ar');
    expect(el().textContent).toContain('الخادم');
    expect(el().textContent).toContain('كلمة المرور');
    expect(el().textContent).toContain('حفظ لوقت لاحق');
    expect(c.providerOptions().map((o) => o.label)).toEqual([
      'Resend',
      'SMTP / خادم Exchange داخلي',
      'Office 365',
      'SendGrid',
      'Amazon SES',
    ]);
    TestBed.resetTestingModule();
    setup(NONE, 'ar');
    const sentence = el().querySelector('[data-email-default-sentence]')!.textContent!;
    expect(sentence).toContain('Resend');
    expect(sentence).toContain('تُرسَل');
    expect(sentence).toContain('⁨no-reply@example.test⁩');
  });
});
