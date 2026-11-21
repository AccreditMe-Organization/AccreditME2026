import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { loadTranslationsForTest } from '../formatting/testing';
import { extractErrorMessage } from '../../shared/utils/http-error.util';
import { moduleLabelKey, moduleRefusal } from '../http/module-refusal';
import { moduleRefusalInterceptor } from './module-refusal.interceptor';

/**
 * ACC-102 — the API's module refusals reach every screen in the reader's
 * language, naming the module by its rail label, with the code kept.
 */
describe('moduleRefusalInterceptor (ACC-102)', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let translate: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([moduleRefusalInterceptor])),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en' }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    translate = TestBed.inject(TranslateService);
    translate.use('en');
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  /** Sends one request, fails it with `body`, and returns what the caller receives. */
  function refusedWith(body: Record<string, unknown>, status = 403): HttpErrorResponse {
    let received: HttpErrorResponse | undefined;
    http.get('/api/v1/probe').subscribe({ error: (e: HttpErrorResponse) => (received = e) });
    backend.expectOne('/api/v1/probe').flush(body, { status, statusText: 'Forbidden' });
    expect(received).withContext('the request failed').toBeDefined();
    return received!;
  }

  it('reads the rail label from the nav item carrying the module key', () => {
    // Non-vacuous: the meetings rail item carries moduleKey 'meetings'.
    expect(moduleLabelKey('meetings')).toBe('nav.meetings');
    expect(moduleLabelKey('no-such-module')).toBeNull();
  });

  it('says MODULE_NOT_ENABLED in English, naming the module by its rail label, and keeps the code', () => {
    const err = refusedWith({ statusCode: 403, message: 'This module is not available to the organization.', code: 'MODULE_NOT_ENABLED', module: 'meetings' });
    expect(extractErrorMessage(err, 'fallback')).toBe("The Meetings module isn't available to your organization.");
    expect(moduleRefusal(err)).toEqual({ code: 'MODULE_NOT_ENABLED', module: 'meetings' });
    expect(err.status).toBe(403);
  });

  it('says MODULE_READ_ONLY in English', () => {
    const err = refusedWith({ statusCode: 403, message: 'x', code: 'MODULE_READ_ONLY', module: 'meetings' });
    expect(extractErrorMessage(err, 'fallback')).toBe(
      "The Meetings module is read-only on your organization's plan, so this change can't be made.",
    );
  });

  it('says both codes in Arabic, with the Arabic rail label', () => {
    translate.use('ar');
    const notEnabled = refusedWith({ code: 'MODULE_NOT_ENABLED', module: 'meetings' });
    expect(extractErrorMessage(notEnabled, 'fallback')).toBe(`وحدة ${ar.nav.meetings} غير متاحة لمنشأتك.`);
    const readOnly = refusedWith({ code: 'MODULE_READ_ONLY', module: 'meetings' });
    expect(extractErrorMessage(readOnly, 'fallback')).toBe(
      `وحدة ${ar.nav.meetings} للقراءة فقط في خطة منشأتك، لذا لا يمكن إجراء هذا التغيير.`,
    );
  });

  it('says "this module" when no rail item carries the module', () => {
    const err = refusedWith({ code: 'MODULE_NOT_ENABLED', module: 'documents' });
    expect(extractErrorMessage(err, 'fallback')).toBe(en.moduleRefusal.notEnabledUnnamed);
  });

  it('leaves every other error untouched', () => {
    const body = { statusCode: 403, message: 'Required permission: meetings:view' };
    const err = refusedWith(body);
    expect(err.error).toEqual(body);
    expect(moduleRefusal(err)).toBeNull();
  });
});
