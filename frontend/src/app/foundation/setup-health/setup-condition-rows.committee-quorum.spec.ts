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

// ACC-307 PR 1 — "Committee below quorum", as Setup health and Home's Needs
// fixing both word it (SetupConditionRows is the one place), learned before
// anything writes it: the committee's name as the title, the quorum and the
// members who count toward it in the language's plural forms, the Fix to the
// committee with both its permissions, and the permission line instead when one
// is missing. Read from the REAL translation files.

const LOADED = new Date('2026-11-19T09:00:00.000Z');

const condition = (over: Partial<SetupConditionDto['subject']> = {}): SetupConditionDto => ({
  id: 'cond-1',
  type: 'COMMITTEE_BELOW_QUORUM',
  severity: 'AT_RISK',
  objectId: 'committee-1',
  subject: { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', quorum: 3, members: 1, ...over },
  openedAt: '2026-11-19T06:00:00.000Z',
  ageBasis: 'FIRST_DETECTED',
  lastSeenAt: '2026-11-19T08:00:00.000Z',
  clearedAt: null,
});

describe('SetupConditionRows — a committee below quorum (ACC-307)', () => {
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

  it('[en] names the committee, the quorum and the members, with the Fix', () => {
    const row = rows('en').toRow(condition(), LOADED);
    expect(row.objectName).toBe('Quality Committee');
    expect(row.consequence).toBe('The quorum needs 3 members, and the committee has 1 active.');
    expect(row.fix).toEqual({ label: 'Add members', link: ['/committees', 'committee-1'], queryParams: {} });
    expect(row.fixNeeds).toBeNull();
    expect(row.severity).toBe('AT_RISK');
    expect(TestBed.inject(TranslateService).instant('setupHealth.types.COMMITTEE_BELOW_QUORUM')).toBe('Committee below quorum');
  });

  it('[en] a quorum of one is singular', () => {
    expect(rows('en').toRow(condition({ quorum: 1, members: 0 }), LOADED).consequence).toBe(
      'The quorum needs 1 member, and the committee has 0 active.',
    );
  });

  it('[ar] names the committee in Arabic, counts in the Arabic forms with Latin digits, with the Fix', () => {
    const r = rows('ar');
    const row = r.toRow(condition(), LOADED);
    expect(row.objectName).toBe('لجنة الجودة');
    expect(row.consequence).toBe('يتطلب النصاب 3 أعضاء، وعدد الأعضاء النشطين في اللجنة 1.');
    expect(row.fix).toEqual({ label: 'إضافة أعضاء', link: ['/committees', 'committee-1'], queryParams: {} });
    expect(TestBed.inject(TranslateService).instant('setupHealth.types.COMMITTEE_BELOW_QUORUM')).toBe('لجنة دون النصاب');
    expect(r.toRow(condition({ quorum: 2, members: 1 }), LOADED).consequence).toBe('يتطلب النصاب عضوين، وعدد الأعضاء النشطين في اللجنة 1.');
    expect(r.toRow(condition({ quorum: 11, members: 4 }), LOADED).consequence).toBe('يتطلب النصاب 11 عضوًا، وعدد الأعضاء النشطين في اللجنة 4.');
  });

  for (const lang of ['en', 'ar'] as const) {
    it(`[${lang}] without committees:add_member there is no Fix, and the permission line says what is needed`, () => {
      permissions.delete('committees:add_member');
      const row = rows(lang).toRow(condition(), LOADED);
      expect(row.fix).toBeNull();
      expect(row.fixNeeds).toBe(
        lang === 'en' ? 'Fixing this needs permission to add committee members.' : 'إصلاح هذا يتطلب صلاحية إضافة أعضاء إلى اللجان.',
      );
    });
  }
});
