import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { OrgStructureNodeDto, OrgUnitHistoryPageDto, OrgUnitService, OrgUnitSummaryDto } from '../../services/org-unit.service';
import { HeadshipPanelComponent } from '../headship-panel/headship-panel.component';
import { OrgUnitRecordComponent } from './org-unit-record.component';

// ACC-120 slice 11, PR D — the record's layout, with the real theme and both
// languages, at the CONTENT widths the shell leaves at 1280, 390 and 360
// (988, 358 and 328px, as the tree's spec measures):
//   - every capped panel is the same fixed height — 294 / 328 of body, its
//     header on top — however many rows it holds, five or none;
//   - nothing scrolls sideways;
//   - the unit's names wrap, never cut, and take more than one line at phone
//     width; a row name that IS cut (one line, an ellipsis) keeps its whole
//     text in a title.
// The Headship panel has its own layout spec (ACC-133); here a fixed-height
// stand-in holds its place.
//
// NON-VACUITY FIRST (ACC-120): a page that never laid out passes "equal
// heights" and "no overflow" perfectly, so each case first proves the panels
// rendered, with width.

const WIDTHS = [988, 358, 328] as const;
const PANEL = { en: 42 + 294 + 2, ar: 46 + 328 + 2 } as const;

@Component({ selector: 'am-headship-panel', standalone: true, template: '<div style="block-size: 200px"></div>' })
class HeadshipStubComponent {
  readonly orgUnitId = input.required<string>();
  readonly unitName = input.required<string>();
  readonly readOnly = input(false);
}

const SECTION = { id: 't-sec', key: 'section', labelEn: 'Section', labelAr: 'قسم فرعي', isRetired: false };
const LONG_EN = 'Inpatient Pharmacy and Medication Safety Department';
const LONG_AR = 'قسم صيدلية المرضى المنومين وسلامة الأدوية والتغذية العلاجية';

function node(id: string, nameEn: string, nameAr: string, over: Partial<OrgStructureNodeDto> = {}): OrgStructureNodeDto {
  return {
    id,
    parentId: 'pharm',
    nameEn,
    nameAr,
    code: id.toUpperCase().slice(0, 10),
    type: SECTION,
    sortOrder: 0,
    isActive: true,
    childCount: 0,
    heads: [{ userId: `h-${id}`, name: 'Dr. Abdulrahman Al-Mutairi', positionId: 'p', positionNameEn: 'Head of Department', positionNameAr: 'رئيس القسم', role: 'substantive', countedHere: true }],
    acting: null,
    headcount: 14,
    committees: { count: 0 },
    ...over,
  };
}

const SUMMARY: OrgUnitSummaryDto = {
  unit: {
    ...node('pharm', LONG_EN, LONG_AR, {
      parentId: 'med',
      code: 'INPHARMSAF',
      acting: { userId: 'huda', name: 'Dr. Huda Zahrani Al-Shammari', reason: 'ABSENCE', validFrom: '2026-09-25T12:00:00.000Z', validTo: null, countedHere: false },
      attention: { code: 'ACTING_HEAD_OPEN_ENDED', severity: 'AT_RISK', since: '2026-12-24T12:00:00.000Z', openCount: 3 },
    }),
    description: null,
    createdAt: '2025-01-10T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  },
  path: [
    { id: 'root', nameEn: 'Al Nakheel Specialist Hospital', nameAr: 'مستشفى النخيل التخصصي' },
    { id: 'med', nameEn: 'Clinical Support and Medical Services', nameAr: 'الخدمات الطبية والدعم السريري' },
    { id: 'pharm', nameEn: LONG_EN, nameAr: LONG_AR },
  ],
  // Seven children: five rows and the footer.
  children: Array.from({ length: 7 }, (_, i) => node(`c${i}`, `${LONG_EN} ${i}`, `${LONG_AR} ${i}`)),
  positions: [{ positionId: 'p', nameEn: 'Head of Department', nameAr: 'رئيس القسم', grade: 10, isUnitHeadPosition: true, count: 1 }],
  people: Array.from({ length: 3 }, (_, i) => ({
    userId: `u${i}`,
    name: `Dr. Abdulrahman Al-Mutairi ${i}`,
    positionId: 'p',
    positionNameEn: 'Senior Clinical Pharmacist, Oncology',
    positionNameAr: 'صيدلي سريري أول، الأورام',
    isHead: i === 0,
  })),
  // None: the empty panel is the same height as the full ones.
  committees: { count: 0, items: [] },
  asOf: '2026-10-21T09:00:00.000Z',
};

const HISTORY: OrgUnitHistoryPageDto = {
  items: [
    {
      id: 'audit:a1',
      source: 'AUDIT',
      kind: 'CHANGED',
      at: '2025-03-02T09:00:00.000Z',
      actor: { userId: 'nora', name: 'Nora Al-Otaibi', inOrganization: true, positionNameEn: null, positionNameAr: null },
      fields: ['parent', 'nameEn', 'code', 'description'],
      movedTo: { id: 'med', nameEn: 'Clinical Support and Medical Services', nameAr: 'الخدمات الطبية والدعم السريري' },
    },
  ],
  total: 1,
  skip: 0,
  take: 5,
};

describe('OrgUnitRecord — layout (ACC-120 slice 11, PR D)', () => {
  preserveDocumentLanguage();
  const measured: string[] = [];

  async function render(language: 'en' | 'ar', width: number): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'organization/units/:id', component: OrgUnitRecordComponent }]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        { provide: OrgUnitService, useValue: { getSummary: () => of(SUMMARY), getHistory: () => of(HISTORY) } },
      ],
    });
    TestBed.overrideComponent(OrgUnitRecordComponent, { remove: { imports: [HeadshipPanelComponent] }, add: { imports: [HeadshipStubComponent] } });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    const harness = await RouterTestingHarness.create();
    const frame = harness.fixture.nativeElement as HTMLElement;
    frame.style.display = 'block';
    frame.style.width = `${width}px`;
    await harness.navigateByUrl('/organization/units/pharm', OrgUnitRecordComponent);
    for (let i = 0; i < 3; i++) {
      harness.detectChanges();
      await harness.fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return frame;
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .cdk-overlay-container').forEach((e) => e.remove()));
  afterAll(() => console.log(`ACC-120 slice 11 PR D record layout\n${measured.join('\n')}`));

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}] ${width}px of content: panels at one fixed height, no sideways scroll, names wrap`, async () => {
        const frame = await render(language, width);
        const panels = Array.from(frame.querySelectorAll<HTMLElement>('[data-testid="unit-panels"] [data-testid$="-panel"]')).filter(
          (p) => p.tagName === 'SECTION',
        );

        // Non-vacuity: five capped panels, laid out, with width.
        expect(panels.map((p) => p.dataset['testid'])).withContext('capped panels rendered').toEqual([
          'unit-subs-panel',
          'unit-people-panel',
          'unit-positions-panel',
          'unit-committees-panel',
          'unit-history-panel',
        ]);
        for (const p of panels) expect(p.getBoundingClientRect().width).withContext('laid out').toBeGreaterThan(Math.min(width, 320) * 0.8);

        // One fixed height, full (subs: five and the footer) or empty (committees).
        const heights = panels.map((p) => Math.round(p.getBoundingClientRect().height));
        expect(new Set(heights).size).withContext(`heights ${heights.join('/')}`).toBe(1);
        expect(heights[0]).withContext('the capped height').toBe(PANEL[language]);
        expect(frame.querySelector('[data-testid="unit-subs-foot"]')).withContext('the footer is in the five-row panel').not.toBeNull();

        // Nothing wider than the frame.
        expect(frame.scrollWidth).withContext('frame scrolls sideways').toBeLessThanOrEqual(frame.clientWidth);
        for (const el of Array.from(frame.querySelectorAll<HTMLElement>('[data-testid="unit-header"], [data-testid="unit-strip"], [data-testid="unit-panels"] > *'))) {
          const r = el.getBoundingClientRect();
          const f = frame.getBoundingClientRect();
          expect(r.left).withContext(`${el.dataset['testid'] ?? el.tagName} inside the frame`).toBeGreaterThanOrEqual(f.left - 0.5);
          expect(r.right).withContext(`${el.dataset['testid'] ?? el.tagName} inside the frame`).toBeLessThanOrEqual(f.right + 0.5);
        }

        // The unit's names wrap, never cut; at phone width, more than one line.
        const name = frame.querySelector<HTMLElement>('[data-testid="unit-name"]')!;
        const other = frame.querySelector<HTMLElement>('[data-testid="unit-other-name"]')!;
        for (const n of [name, other]) {
          expect(getComputedStyle(n).textOverflow).not.toBe('ellipsis');
          expect(n.scrollWidth).withContext('a name is cut').toBeLessThanOrEqual(n.clientWidth + 1);
        }
        const line = parseFloat(getComputedStyle(name).lineHeight) || 36;
        if (width < 400) expect(name.getBoundingClientRect().height).withContext('wraps at phone width').toBeGreaterThan(line * 1.5);

        // Relation names and the strip wrap inside their boxes too.
        for (const el of Array.from(frame.querySelectorAll<HTMLElement>('[data-testid="relation-value"], [data-testid="unit-strip"]'))) {
          expect(el.scrollWidth).withContext('a relation or the strip paints outside its box').toBeLessThanOrEqual(el.clientWidth + 1);
        }

        // A row name cut to one line keeps its whole text in a title.
        for (const cut of Array.from(frame.querySelectorAll<HTMLElement>('li.am-cp-row .am-cp-cut'))) {
          if (cut.scrollWidth > cut.clientWidth + 1) expect(cut.getAttribute('title')).withContext('a cut row keeps its text').toBeTruthy();
        }

        const header = frame.querySelector<HTMLElement>('[data-testid="unit-header"]')!;
        measured.push(
          `[${language}] ${width}: panels ${heights[0]}px, header ${Math.round(header.getBoundingClientRect().height)}px, ` +
            `name ${Math.round(name.getBoundingClientRect().height)}px tall, columns ${new Set(panels.map((p) => Math.round(p.getBoundingClientRect().left))).size}`,
        );
      });
    }
  }
});
