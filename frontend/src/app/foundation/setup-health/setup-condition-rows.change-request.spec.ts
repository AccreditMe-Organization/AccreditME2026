import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { LanguageService } from '../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { SetupConditionDto } from './services/setup-health.service';
import { SetupConditionRows, fixTargetFor } from './setup-condition-rows';

// ACC-283 PR 1 — "Change request with no one to decide it", learned before the
// backend writes it (PR 3). The committee's name is the title, the request is
// named by its number, and the Fix opens the root unit's Headship, with the
// permissions ORG_UNIT_WITHOUT_HEAD's Fix needs. Read from the REAL translation
// files; the Arabic awaits lane A's check.

const LOADED = new Date('2026-11-16T09:00:00.000Z');

const condition = (over: Partial<SetupConditionDto['subject']> = {}): SetupConditionDto => ({
  id: 'cond-1',
  type: 'CHANGE_REQUEST_WITHOUT_DECIDER',
  severity: 'BLOCKS_WORK',
  objectId: 'request-1',
  subject: { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', requestNumber: 4, rootUnitId: 'unit-root', ...over },
  openedAt: '2026-11-16T06:00:00.000Z',
  ageBasis: 'OBJECT',
  lastSeenAt: '2026-11-16T08:00:00.000Z',
  clearedAt: null,
});

const lookup = (file: unknown, key: string): string =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], file) as string;

describe('SetupConditionRows — a change request with no one to decide it (ACC-283)', () => {
  preserveDocumentLanguage();
  let permissions: Set<string>;

  function rows(lang: 'en' | 'ar'): SetupConditionRows {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.has(p) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    return TestBed.inject(SetupConditionRows);
  }

  afterEach(() => TestBed.resetTestingModule());

  beforeEach(() => {
    permissions = new Set(['org:view', 'org:manage']);
  });

  it("the Fix opens the root unit's Headship, needing org:view and org:manage", () => {
    expect(fixTargetFor(condition())).toEqual({
      link: ['/organization'],
      queryParams: { head: 'unit-root' },
      permissions: ['org:view', 'org:manage'],
    });
  });

  it('a snapshot with no root unit offers no Fix (nothing to open)', () => {
    expect(fixTargetFor(condition({ rootUnitId: undefined }))).toBeNull();
  });

  for (const [lang, file, name] of [
    ['en', en, 'Quality Committee'],
    ['ar', ar, 'لجنة الجودة'],
  ] as const) {
    describe(`[${lang}]`, () => {
      it('names the committee, says the request by its number, and offers the Fix', () => {
        const row = rows(lang).toRow(condition(), LOADED);
        expect(row.objectName).toBe(name);
        expect(row.consequence).toBe(lookup(file, 'setupHealth.consequence.changeRequestWithoutDecider').replace('{{number}}', '4'));
        expect(row.fix).toEqual({
          label: lookup(file, 'setupHealth.fix.CHANGE_REQUEST_WITHOUT_DECIDER'),
          link: ['/organization'],
          queryParams: { head: 'unit-root' },
        });
        expect(row.fixNeeds).toBeNull();
        expect(row.severity).toBe('BLOCKS_WORK');
      });

      it('without org:manage there is no Fix, and the permission line says what is needed', () => {
        permissions.delete('org:manage');
        const row = rows(lang).toRow(condition(), LOADED);
        expect(row.fix).toBeNull();
        expect(row.fixNeeds).toBe(lookup(file, 'setupHealth.fixNeeds.CHANGE_REQUEST_WITHOUT_DECIDER'));
      });

      it('the type has its own label for the group heading and the freshness notice', () => {
        rows(lang);
        expect(TestBed.inject(TranslateService).instant('setupHealth.types.CHANGE_REQUEST_WITHOUT_DECIDER')).toBe(
          lookup(file, 'setupHealth.types.CHANGE_REQUEST_WITHOUT_DECIDER'),
        );
      });
    });
  }

  it('a snapshot with no number still reads, never blank', () => {
    const row = rows('en').toRow(condition({ requestNumber: undefined }), LOADED);
    expect(row.consequence).toBe(lookup(en, 'setupHealth.consequence.changeRequestWithoutDecider').replace('{{number}}', '—'));
  });
});
