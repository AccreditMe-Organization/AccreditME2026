import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeDetailDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { WorkflowService, WorkflowStageHistoryDto, WorkflowInstanceDto } from '../../../workflow/services/workflow.service';
import { ACTIVE_RULES } from '../../testing';
import { CommitteeDetailComponent } from './committee-detail.component';

// ACC-265 item 5 (lane A's comment, Ahmad, 25 Oct) — the committee page's
// Lifecycle row, MEASURED in the real theme, font and translations, in both
// languages, with 1 and with 6 stage history rows.
//
//   - BESIDE (Stage history in the Lifecycle card's row: three tracks, from the
//     1440 content width up): the card alone sets the row's height. History is
//     exactly as tall as the card, the card is the same height with 6 rows as
//     with 1, and the history body scrolls, as a focusable region named
//     "Stage history".
//   - STACKED (two tracks at 1280, one on a phone): history shows in full, with
//     no inner scroll, no tab stop and no contain.
//
// The widths are the page's content column in a 1280, 1440 and 1920 window
// (988, 1148, 1628, as the other layout specs measure) and a 390 phone less
// its 16px gutters (358).
//
// NON-VACUITY FIRST (ACC-120): both cells exist, the card has a real height,
// and the history drew every row it was given, before any height may "match".

const WIDTHS = [
  { name: 'at 1280', width: 988, beside: false },
  { name: 'at 1440', width: 1148, beside: true },
  { name: 'at 1920', width: 1628, beside: true },
  { name: 'at 390', width: 358, beside: false },
] as const;

const STAGES = ['Formation', 'Terms Review', 'Active', 'Suspended', 'Dissolution Pending', 'Dissolved'];
const STAGES_AR = ['التأسيس', 'مراجعة النظام الداخلي', 'نشطة', 'موقوفة', 'قيد الحل', 'محلولة'];

const INSTANCE: WorkflowInstanceDto = {
  id: 'inst-1',
  organizationId: 'org',
  workflowTemplateId: 'tpl-1',
  objectType: 'COMMITTEE',
  objectId: 'c-1',
  status: 'ACTIVE',
  currentStageId: 'stage-3',
  createdAt: '2026-09-01T08:00:00Z',
  updatedAt: '2026-10-10T08:00:00Z',
  unassignedTaskWarnings: [],
};

/** A history of `visits` moves, alternating Formation and Terms Review, then Active. */
function history(visits: number): WorkflowStageHistoryDto {
  const path = visits === 1 ? [0] : [...Array.from({ length: visits - 1 }, (_, i) => i % 2), 2];
  return {
    instanceId: 'inst-1',
    stages: STAGES.map((nameEn, i) => ({
      id: `stage-${i + 1}`,
      nameEn,
      nameAr: STAGES_AR[i]!,
      order: (i + 1) * 10,
      visitCount: path.filter((p) => p === i).length,
      isCurrent: i === path[path.length - 1],
    })),
    visits: path.map((stage, n) => ({
      id: `visit-${n}`,
      stageId: `stage-${stage + 1}`,
      stageNameEn: STAGES[stage]!,
      stageNameAr: STAGES_AR[stage]!,
      enteredAt: `2026-10-${String(n + 1).padStart(2, '0')}T08:00:00Z`,
      exitedAt: n === path.length - 1 ? null : `2026-10-${String(n + 2).padStart(2, '0')}T08:00:00Z`,
      outcome: n === path.length - 1 ? 'PENDING' : 'COMPLETED',
      actorId: 'u-1',
      actorName: 'Dr. Hessa Al-Dosari',
      transitionLabelEn: n === 0 ? null : 'Submit for Approval',
      transitionLabelAr: n === 0 ? null : 'إرسال للاعتماد',
      comment: n === 0 ? null : 'ACC-265 layout proof: a comment long enough to wrap onto a second line in the panel',
      isUnassigned: false,
      delegation: null,
    })),
  };
}

const COMMITTEE: CommitteeDetailDto = {
  id: 'c-1',
  organizationId: 'org',
  nameEn: 'Quality & Patient Safety Committee',
  nameAr: 'لجنة الجودة وسلامة المرضى',
  typeValueId: 'type-1',
  purpose: 'Oversees the hospital-wide quality management system.',
  quorumCount: 3,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: null,
  orgUnitId: 'unit-1',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: null,
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  isDissolving: false,
  stageRules: ACTIVE_RULES,
  typeValue: { id: 'type-1', key: 'quality', labelEn: 'Quality Committee', labelAr: 'لجنة الجودة', offered: true },
  orgUnit: { id: 'unit-1', nameEn: 'Al Nakheel Specialist Hospital', nameAr: 'مستشفى النخيل التخصصي' },
};

@Component({
  standalone: true,
  imports: [CommitteeDetailComponent],
  template: `<div data-host [style.width.px]="width()"><app-committee-detail /></div>`,
})
class PageHost {
  readonly width = input(1148);
}

describe('CommitteeDetailComponent — Stage history beside the Lifecycle card (ACC-265)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<PageHost>;

  async function render(width: number, lang: 'en' | 'ar', visits: number): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [PageHost],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1' }) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => p === 'committees:view' || p === 'workflows:view' } },
        {
          provide: CommitteeService,
          useValue: {
            getById: () => of(COMMITTEE),
            listCommittees: () => of([]),
            listMembers: () => of([]),
            listMembershipEvents: () => of([]),
            membersPage: () => of({ items: [], total: 0, matching: 0 }),
            subCommittees: () => of({ items: [], total: 0, matching: 0 }),
          },
        },
        { provide: LookupService, useValue: { getValues: () => of([]) } },
        { provide: UserService, useValue: { listAllUsers: () => of([]) } },
        {
          provide: WorkflowService,
          useValue: { getInstancesByObject: () => of([INSTANCE]), getStageHistory: () => of(history(visits)) },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    fixture = TestBed.createComponent(PageHost);
    fixture.componentRef.setInput('width', width);
    fixture.detectChanges();
    await document.fonts.ready;
    // The row is measured by a ResizeObserver; give it two frames to settle.
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      fixture.detectChanges();
    }
    return fixture.nativeElement.querySelector('[data-host]') as HTMLElement;
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  interface Measured {
    beside: boolean;
    cardHeight: number;
    historyHeight: number;
    rows: number;
    body: HTMLElement;
    contain: string;
  }

  function measure(host: HTMLElement): Measured {
    const card = host.querySelector<HTMLElement>('[data-lifecycle-card]')!;
    const history = host.querySelector<HTMLElement>('[data-stage-history]')!;
    // ── Non-vacuity ──
    expect(card).withContext('the Lifecycle card').not.toBeNull();
    expect(history).withContext('the Stage history panel').not.toBeNull();
    const c = card.getBoundingClientRect();
    const h = history.getBoundingClientRect();
    expect(c.height).withContext('the card has a real height').toBeGreaterThan(50);
    const body = history.querySelector<HTMLElement>('[data-panel-body]')!;
    return {
      beside: Math.abs(c.top - h.top) < 1,
      cardHeight: c.height,
      historyHeight: h.height,
      // One grid per visit in the indicator's history list.
      rows: history.querySelectorAll('[class*="grid-cols-[76px"]').length,
      body,
      contain: getComputedStyle(history).contain,
    };
  }

  for (const lang of ['en', 'ar'] as const) {
    const label = lang === 'en' ? en.committee.stageHistory : ar.committee.stageHistory;
    for (const w of WIDTHS) {
      it(`${w.name} [${lang}]: ${w.beside ? 'the card sets the row; history fills it and scrolls' : 'history stacks and shows in full'}`, async () => {
        const one = measure(await render(w.width, lang, 1));
        fixture.destroy();
        TestBed.resetTestingModule();
        const six = measure(await render(w.width, lang, 6));

        expect(six.rows).withContext('six history rows drawn').toBeGreaterThan(one.rows);
        expect(one.beside).withContext('beside, 1 row').toBe(w.beside);
        expect(six.beside).withContext('beside, 6 rows').toBe(w.beside);

        if (w.beside) {
          // The card alone sets the row: history is exactly as tall, and more
          // history does not make the card taller.
          expect(Math.abs(six.historyHeight - six.cardHeight)).withContext('history as tall as the card').toBeLessThanOrEqual(1);
          expect(Math.abs(six.cardHeight - one.cardHeight)).withContext('the card, 6 rows vs 1').toBeLessThanOrEqual(1);
          expect(six.body.scrollHeight).withContext('six rows scroll inside the body').toBeGreaterThan(six.body.clientHeight + 1);
          expect(six.contain).withContext('contain').toContain('size');
          // A keyboard user can reach and scroll it.
          expect(six.body.getAttribute('tabindex')).toBe('0');
          expect(six.body.getAttribute('role')).toBe('region');
          expect(six.body.getAttribute('aria-label')).toBe(label);
        } else {
          // Shown in full: nothing scrolls inside, nothing to tab to.
          expect(six.body.scrollHeight).withContext('history in full').toBeLessThanOrEqual(six.body.clientHeight + 1);
          expect(six.body.hasAttribute('tabindex')).withContext('no tab stop').toBeFalse();
          expect(six.contain).withContext('no contain').not.toContain('size');
        }
      });
    }
  }
});
