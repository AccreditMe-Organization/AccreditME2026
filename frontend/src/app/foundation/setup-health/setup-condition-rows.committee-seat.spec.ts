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

// ACC-286 PR 2 — "Committee missing a required seat", as Setup health and Home's
// Needs fixing both word it (SetupConditionRows is the one place): the
// committee's name as the title, the empty seats named in the reader's language
// and joined as that language joins a list, the Fix to the committee with both
// its permissions, and the permission line instead when one is missing. Read
// from the REAL translation files; lane A reviewed the wording.

const LOADED = new Date('2026-11-15T09:00:00.000Z');

const condition = (over: Partial<SetupConditionDto['subject']> = {}): SetupConditionDto => ({
  id: 'cond-1',
  type: 'COMMITTEE_MISSING_REQUIRED_SEAT',
  severity: 'AT_RISK',
  objectId: 'committee-1',
  subject: {
    nameEn: 'Quality Committee',
    nameAr: 'لجنة الجودة',
    seats: [
      { id: 'seat-chair', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
      { id: 'seat-own', labelEn: 'Rapporteur', labelAr: null },
    ],
    ...over,
  },
  openedAt: '2026-11-15T06:00:00.000Z',
  ageBasis: 'FIRST_DETECTED',
  lastSeenAt: '2026-11-15T08:00:00.000Z',
  clearedAt: null,
});

const lookup = (file: unknown, key: string): string =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], file) as string;

describe('SetupConditionRows — a committee missing a required seat (ACC-286)', () => {
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
    permissions = new Set(['committees:view', 'committees:add_member']);
  });

  it('the Fix opens the committee and needs committees:view and committees:add_member', () => {
    expect(fixTargetFor(condition())).toEqual({
      link: ['/committees', 'committee-1'],
      queryParams: {},
      permissions: ['committees:view', 'committees:add_member'],
    });
  });

  for (const [lang, file, seats, name] of [
    ['en', en, 'Chairman, Rapporteur', 'Quality Committee'],
    ['ar', ar, 'رئيس اللجنة، Rapporteur', 'لجنة الجودة'],
  ] as const) {
    describe(`[${lang}]`, () => {
      it('names the committee and its empty seats, joined as the language joins a list, with the Fix', () => {
        const row = rows(lang).toRow(condition(), LOADED);
        expect(row.objectName).toBe(name);
        expect(row.consequence).toBe(lookup(file, 'setupHealth.consequence.committeeMissingSeat').replace('{{seats}}', seats));
        expect(row.fix).toEqual({
          label: lookup(file, 'setupHealth.fix.COMMITTEE_MISSING_REQUIRED_SEAT'),
          link: ['/committees', 'committee-1'],
          queryParams: {},
        });
        expect(row.fixNeeds).toBeNull();
        expect(row.severity).toBe('AT_RISK');
        expect(row.age).toBe(lookup(file, 'setupHealth.age.detectedToday'));
      });

      it('without committees:add_member there is no Fix, and the permission line says what is needed', () => {
        permissions.delete('committees:add_member');
        const row = rows(lang).toRow(condition(), LOADED);
        expect(row.fix).toBeNull();
        expect(row.fixNeeds).toBe(lookup(file, 'setupHealth.fixNeeds.COMMITTEE_MISSING_REQUIRED_SEAT'));
      });

      it('the type has its own label for the group heading and the freshness notice', () => {
        rows(lang);
        expect(TestBed.inject(TranslateService).instant('setupHealth.types.COMMITTEE_MISSING_REQUIRED_SEAT')).toBe(
          lookup(file, 'setupHealth.types.COMMITTEE_MISSING_REQUIRED_SEAT'),
        );
      });
    });
  }

  it('a row whose snapshot carries no seats still reads, never blank', () => {
    const row = rows('en').toRow(condition({ seats: [] }), LOADED);
    expect(row.consequence).toBe(lookup(en, 'setupHealth.consequence.committeeMissingSeat').replace('{{seats}}', '—'));
  });
});
