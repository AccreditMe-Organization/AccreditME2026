import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { LanguageService } from '../../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { ChangeRequestText } from './change-request-text';

// ACC-283 PR 2 — the chain of authority's two refusals the screens can meet today
// (deciding, and submitting), said from their codes in the reader's language, never
// the server's English. Read from the REAL translation files.

const refused = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new HttpErrorResponse({ status, error: { statusCode: status, code, message: 'English for the log', ...extra } });

const lookup = (file: unknown, key: string): string =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], file) as string;

describe('ChangeRequestText — the chain of authority refusals (ACC-283 PR 2)', () => {
  preserveDocumentLanguage();

  function text(lang: 'en' | 'ar'): ChangeRequestText {
    TestBed.configureTestingModule({ providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()] });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    return TestBed.inject(ChangeRequestText);
  }

  afterEach(() => TestBed.resetTestingModule());

  for (const [lang, file] of [
    ['en', en],
    ['ar', ar],
  ] as const) {
    it(`[${lang}] CHANGE_REQUEST_NOT_DECIDER and CHANGE_REQUEST_NO_DECIDER are said from their codes, never the server's English`, () => {
      const t = text(lang);
      const notDecider = t.refusal(refused(403, 'CHANGE_REQUEST_NOT_DECIDER', { awaitingDecisionBy: null }));
      expect(notDecider.code).toBe('CHANGE_REQUEST_NOT_DECIDER');
      expect(notDecider.text).toBe(lookup(file, 'committee.changeRequest.refusal.CHANGE_REQUEST_NOT_DECIDER'));
      const noDecider = t.refusal(refused(409, 'CHANGE_REQUEST_NO_DECIDER', { approveNow: true }));
      expect(noDecider.text).toBe(lookup(file, 'committee.changeRequest.refusal.CHANGE_REQUEST_NO_DECIDER'));
      expect(noDecider.text).not.toContain('English');
      expect(notDecider.retry).toBe(false);
    });
  }

  it('the Arabic never says «المنظمة» (the project says «منشأة»)', () => {
    const r = (ar as unknown as { committee: { changeRequest: { refusal: Record<string, string> } } }).committee.changeRequest.refusal;
    for (const key of ['CHANGE_REQUEST_NOT_DECIDER', 'CHANGE_REQUEST_NO_DECIDER']) expect(r[key]).not.toContain('المنظمة');
  });
});
