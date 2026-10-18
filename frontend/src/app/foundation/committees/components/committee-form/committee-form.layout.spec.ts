import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeDetailDto, CommitteeListItemDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { CommitteeFormComponent, CommitteeFormTab } from './committee-form.component';

// ACC-238 — the three-tab committee dialog against the 420px body cap
// (ACC-111), measured rather than assumed (ACC-120): each tab, in both
// languages, in the real dialog shell at compact density with the real theme,
// the tabs in the header and the actions in the footer.
//
// Two numbers per tab:
//   - the PANEL: that tab's own content height;
//   - the BODY: what the dialog body needs with that tab showing. Every panel
//     sits in one grid cell, so the body is the tallest panel on every tab —
//     the footer does not move as the reader switches.
// Each must keep at least ROOM px under the cap (Ahmad's standing rule: at
// least 20px of room in both languages).
//
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass "<= 400"
// perfectly. The guard asserts the three panels are really laid out, at three
// DIFFERENT heights, before the cap means anything.

const CAP = 420;
const ROOM = 20;
const FLOOR = 60;
const TABS: readonly CommitteeFormTab[] = ['identity', 'governance', 'structure'];

const ROW = (id: string, over: Partial<CommitteeListItemDto> = {}): CommitteeListItemDto => ({
  id,
  organizationId: 'org',
  nameEn: `Committee ${id}`,
  nameAr: null,
  typeValueId: 'type-1',
  purpose: null,
  quorumCount: 0,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: null,
  orgUnitId: 'unit-root',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: null,
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  memberCount: 7,
  currentStageNameEn: 'Formation',
  currentStageNameAr: 'التشكيل',
  currentStageKey: 'formation',
  isDissolving: false,
  ...over,
});

// The drawing's committee, with the longest values a real one carries.
const EDITING: CommitteeDetailDto = {
  ...ROW('self', {
    nameEn: 'Patient Experience and Family Engagement Committee',
    nameAr: 'لجنة تجربة المريض وإشراك الأسرة',
    purpose:
      'Oversees how patients and families experience care: complaints, surveys and service recovery, and reports what it finds to the Quality and Patient Safety Council every quarter.',
    parentCommitteeId: 'council',
    reportingToCommitteeId: 'council',
  }),
};
const LIST = [
  EDITING,
  ROW('council', { nameEn: 'Quality & Patient Safety Council', nameAr: 'مجلس الجودة وسلامة المرضى' }),
  ROW('mec', { nameEn: 'Medical Executive Committee', nameAr: 'اللجنة التنفيذية الطبية' }),
];

describe('CommitteeForm — three tabs against the 420px body cap (ACC-238)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<CommitteeFormComponent>;
  const measured: string[] = [];

  async function open(language: 'en' | 'ar', update = () => of(EDITING) as never): Promise<CommitteeFormComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CommitteeFormComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: CommitteeService, useValue: { listCommittees: () => of(LIST), update, create: update, getById: () => of(EDITING) } },
        { provide: LookupService, useValue: { getValues: () => of([{ id: 'type-1', labelEn: 'Standing committee', labelAr: 'لجنة دائمة' }]) } },
        {
          provide: OrgUnitService,
          useValue: {
            getFlat: () => of([{ id: 'unit-root', nameEn: 'Al Nakheel Specialist Hospital', nameAr: 'مستشفى النخيل التخصصي', parentId: null, isActive: true }]),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(CommitteeFormComponent);
    fixture.componentRef.setInput('committee', EDITING);
    fixture.componentRef.setInput('visible', true);
    await settle();
    return fixture.componentInstance;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }

  function body(): HTMLElement {
    const el = document.querySelector<HTMLElement>('.am-dialog__body');
    expect(el).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    return el!;
  }
  const panel = (tab: CommitteeFormTab) => document.querySelector<HTMLElement>(`[data-cf-panel="${tab}"]`)!;

  /** Each tab's own height, and the body's with each tab showing. */
  async function heights(f: CommitteeFormComponent): Promise<Record<CommitteeFormTab, { panel: number; body: number }>> {
    const out = {} as Record<CommitteeFormTab, { panel: number; body: number }>;
    for (const tab of TABS) {
      f.tab.set(tab);
      await settle();
      out[tab] = { panel: Math.round(panel(tab).getBoundingClientRect().height), body: body().scrollHeight };
    }
    return out;
  }

  function assertFits(label: string, language: string, h: Record<CommitteeFormTab, { panel: number; body: number }>): void {
    // Non-vacuity: laid out, and three different heights (one tab can't stand in for all).
    for (const tab of TABS) expect(h[tab].panel).withContext(`${label} ${tab} [${language}] is not laid out`).toBeGreaterThan(FLOOR);
    expect(new Set(TABS.map((t) => h[t].panel)).size).withContext(`${label} [${language}] three tabs, three heights`).toBe(3);

    const tallest = Math.max(...TABS.map((t) => h[t].panel));
    for (const tab of TABS) {
      measured.push(`${label} · ${tab} [${language}]: panel ${h[tab].panel}px, body ${h[tab].body}px`);
      expect(h[tab].panel + ROOM).withContext(`${label} ${tab} [${language}] panel ${h[tab].panel}px`).toBeLessThanOrEqual(CAP);
      expect(h[tab].body + ROOM).withContext(`${label} ${tab} [${language}] body ${h[tab].body}px`).toBeLessThanOrEqual(CAP);
      // The body holds the tallest tab: never shorter than it…
      expect(h[tab].body).withContext(`${label} ${tab} [${language}] body below the tallest tab`).toBeGreaterThanOrEqual(tallest);
    }
    // …and the same on every tab, so the footer does not move as the reader switches.
    expect(new Set(TABS.map((t) => h[t].body)).size).withContext(`${label} [${language}] one body height for all tabs`).toBe(1);
  }

  afterAll(() => {
    // The numbers recorded in step-238-committee-changes.md §11.
    console.log(`ACC-238 measurements\n${measured.join('\n')}`);
  });

  for (const language of ['en', 'ar'] as const) {
    describe(language, () => {
      it('every tab fits with room, and the body holds the tallest tab', async () => {
        const f = await open(language);
        assertFits('edit', language, await heights(f));
      });

      it('with every error showing after Save, every tab still fits (errors replace hints)', async () => {
        const f = await open(language);
        f.form.patchValue({ nameEn: '', typeValueId: null, orgUnitId: null });
        f.submit();
        await settle();
        assertFits('errors', language, await heights(f));
      });

      it('Reports to filled in from the parent still fits', async () => {
        const f = await open(language);
        f.form.patchValue({ parentCommitteeId: null, reportingToCommitteeId: null });
        f.form.controls.parentCommitteeId.setValue('mec');
        await settle();
        expect(f.reportsToPrefilled()).toBe(true);
        assertFits('reports-to filled in', language, await heights(f));
      });

      it('someone else saved first: the footer line does not grow the body', async () => {
        const f = await open(language, () => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'COMMITTEE_CHANGED' } })) as never);
        const before = body().scrollHeight;
        f.submit();
        await settle();
        expect(document.querySelector('[data-cf-reload]')).not.toBeNull();
        expect(body().scrollHeight).withContext(`[${language}] body before/after the conflict`).toBe(before);
        measured.push(`conflict [${language}]: body ${before}px before, ${body().scrollHeight}px after`);
      });
    });
  }
});
