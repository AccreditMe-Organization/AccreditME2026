import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { FilesService } from './files.service';

const refused = (code: string) => new HttpErrorResponse({ status: 409, error: { statusCode: 409, message: 'server English', code } });

describe('FilesService.refusal (ACC-189)', () => {
  let service: FilesService;
  let translate: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideTranslateService({ lang: 'en' }), ...provideFormatTesting()],
    });
    loadTranslationsForTest({ en, ar });
    service = TestBed.inject(FilesService);
    translate = TestBed.inject(TranslateService);
  });

  // ACC-185 shipped the SharePoint withdrawal backend only; until this ticket
  // the screen showed the server's English in an Arabic session.
  for (const code of ['STORAGE_ACCESS_WITHDRAWN', 'PREVIEW_NOT_AVAILABLE'] as const) {
    it(`${code} has its own words in English and in Arabic`, () => {
      translate.use('en');
      expect(service.refusal(refused(code))).toBe((en.files.refusal as Record<string, string>)[code]!);
      translate.use('ar');
      expect(service.refusal(refused(code))).toBe((ar.files.refusal as Record<string, string>)[code]!);
      expect((ar.files.refusal as Record<string, string>)[code]).not.toBe((en.files.refusal as Record<string, string>)[code]);
    });
  }

  it('a code it has no words for is not translated: the caller shows the server message', () => {
    expect(service.refusal(refused('SOMETHING_NEW'))).toBeNull();
    expect(service.refusal(new HttpErrorResponse({ status: 500 }))).toBeNull();
  });
});
