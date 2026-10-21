import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { OrgStructureNodeDto, OrgUnitService } from '../../services/org-unit.service';
import { OrgUnitBlockersDialogComponent } from '../org-unit-blockers-dialog/org-unit-blockers-dialog.component';
import { OrgUnitTreeComponent, TREE_NARROW_BELOW_PX } from './org-unit-tree.component';

// ACC-120 slice 11 (PR C) — the tree's layout, measured with the real theme
// and both languages, at the CONTENT widths the shell leaves at 1280, 390 and
// 360 (988, 358 and 328px), and either side of the 900px rule:
//   - Type and People are dropped below 900px of content, never by viewport;
//   - nothing scrolls sideways (the ACC-232 sweep found /organization 5px over
//     at 360, from the old Status tag);
//   - every row's ⋯ sits inside its row;
//   - names wrap, never cut;
// and the Deactivate blockers dialog with five blockers, under the 420 cap.
//
// NON-VACUITY FIRST (ACC-120): a tree that never laid out passes "no
// overflow" perfectly, so each case first proves rows rendered, with width.

const WIDTHS = [988, 358, 328, TREE_NARROW_BELOW_PX, TREE_NARROW_BELOW_PX - 1] as const;
const CAP = 420;

const T = (id: string, labelEn: string, labelAr: string) => ({ id, key: id, labelEn, labelAr, isRetired: false });
const DEPT = T('dept', 'Department', 'قسم');
const SEC = T('sec', 'Section', 'قسم فرعي');
const ORG = T('org', 'Organization', 'منشأة');

function n(id: string, parentId: string | null, nameEn: string, nameAr: string, over: Partial<OrgStructureNodeDto> = {}): OrgStructureNodeDto {
  return {
    id,
    parentId,
    nameEn,
    nameAr,
    code: id.toUpperCase().slice(0, 10),
    type: DEPT,
    sortOrder: 0,
    isActive: true,
    childCount: 0,
    heads: [{ userId: `h-${id}`, name: 'Dr. Abdulrahman Al-Mutairi', positionId: 'p', positionNameEn: 'Head of Department', positionNameAr: 'رئيس القسم', role: 'substantive', countedHere: true }],
    acting: null,
    headcount: 14,
    committees: { count: 0 },
    attention: null,
    ...over,
  };
}

// The drawing's tree, four levels deep, with the longest real names.
const NODES: OrgStructureNodeDto[] = [
  n('root', null, 'Al Nakheel Specialist Hospital', 'مستشفى النخيل التخصصي', { type: ORG }),
  n('med', 'root', 'Medical Services', 'الخدمات الطبية'),
  n('pharm', 'med', 'Pharmacy', 'الصيدلية', {
    acting: { userId: 'huda', name: 'Dr. Huda Zahrani', reason: 'ABSENCE', validFrom: '2026-09-25T12:00:00.000Z', validTo: null, countedHere: false },
    attention: { code: 'ACTING_HEAD_OPEN_ENDED', severity: 'AT_RISK', since: '2026-12-24T12:00:00.000Z', openCount: 1 },
  }),
  n('pharm-ip', 'pharm', 'Inpatient Pharmacy and Medication Safety', 'صيدلية المرضى المنومين وسلامة الأدوية', {
    type: SEC,
    heads: [],
    attention: { code: 'ORG_UNIT_WITHOUT_HEAD', severity: 'BLOCKS_WORK', since: '2026-09-01T12:00:00.000Z', openCount: 2 },
  }),
  n('pharm-op', 'pharm', 'Outpatient Pharmacy', 'صيدلية العيادات الخارجية', { type: SEC }),
  n('lab', 'root', 'Laboratory', 'المختبر', { type: null }),
];

@Component({
  standalone: true,
  imports: [OrgUnitTreeComponent],
  template: `<div data-testid="frame" [style.width.px]="width()" style="box-sizing: content-box"><app-org-unit-tree /></div>`,
})
class FrameComponent {
  readonly width = input(988);
}

describe('OrgUnitTree — layout (ACC-120 slice 11, PR C)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<FrameComponent>;
  const measured: string[] = [];

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  async function render(language: 'en' | 'ar', width: number): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FrameComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        { provide: AuthService, useValue: { currentUser: () => null } },
        { provide: OrgUnitService, useValue: { getStructure: () => of({ nodes: NODES, asOf: '' }), getFlat: () => of([]) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(FrameComponent);
    fixture.componentRef.setInput('width', width);
    document.body.appendChild(fixture.nativeElement);
    await settle();
    const tree = fixture.debugElement.children[0]!.children[0]!.componentInstance as OrgUnitTreeComponent;
    tree.toggleAll(); // every level, the deepest indent included
    await settle();
    return fixture.nativeElement.querySelector('[data-testid="frame"]') as HTMLElement;
  }

  afterEach(() => {
    fixture?.nativeElement.remove();
    document.querySelectorAll('.p-dialog-mask, .cdk-overlay-container').forEach((e) => e.remove());
  });
  afterAll(() => console.log(`ACC-120 slice 11 PR C tree layout\n${measured.join('\n')}`));

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}] ${width}px of content: columns, no sideways scroll, ⋯ in its row, names wrap`, async () => {
        const frame = await render(language, width);
        const rows = Array.from(frame.querySelectorAll<HTMLElement>('tr[data-unit]'));
        const table = frame.querySelector<HTMLElement>('table')!;

        // Non-vacuity: laid out, every unit a row, with real width.
        expect(rows.length).withContext('rows rendered').toBe(NODES.length);
        expect(table.getBoundingClientRect().width).withContext('the table is laid out').toBeGreaterThan(width * 0.8);

        // Type and People: present at 900 and above, dropped below.
        const headers = Array.from(frame.querySelectorAll('th')).map((t) => t.getAttribute('data-col')).filter(Boolean);
        const wide = width >= TREE_NARROW_BELOW_PX;
        expect(headers.includes('type')).withContext(`Type at ${width}`).toBe(wide);
        expect(headers.includes('people')).withContext(`People at ${width}`).toBe(wide);

        // Nothing wider than the frame.
        expect(frame.scrollWidth).withContext('frame scrolls sideways').toBeLessThanOrEqual(frame.clientWidth);
        expect(Math.round(table.getBoundingClientRect().width)).withContext('table wider than the frame').toBeLessThanOrEqual(width);

        for (const row of rows) {
          const r = row.getBoundingClientRect();
          const trigger = row.querySelector<HTMLElement>('[data-testid="row-menu-trigger"]')!;
          const t = trigger.getBoundingClientRect();
          expect(t.width).withContext('the ⋯ is drawn').toBeGreaterThan(0);
          expect(t.left).withContext(`⋯ inside row ${row.dataset['unit']}`).toBeGreaterThanOrEqual(r.left - 0.5);
          expect(t.right).withContext(`⋯ inside row ${row.dataset['unit']}`).toBeLessThanOrEqual(r.right + 0.5);
          for (const cell of Array.from(row.querySelectorAll<HTMLElement>('td'))) {
            // A clipped cell (Type: one line, an ellipsis, the whole label in
            // its title) cannot paint outside its track, whatever it holds.
            const style = getComputedStyle(cell);
            if (style.overflowX === 'hidden' && style.textOverflow === 'ellipsis') {
              expect(cell.getAttribute('title')).withContext('a cut cell keeps its whole text in a title').toBeTruthy();
              continue;
            }
            expect(cell.scrollWidth).withContext(`a cell of ${row.dataset['unit']} paints outside its track`).toBeLessThanOrEqual(cell.clientWidth + 1);
          }
        }

        // Names wrap, never cut: the longest name is whole, and at phone width
        // it takes more than one line.
        const longest = frame.querySelector<HTMLElement>('tr[data-unit="pharm-ip"] [data-testid="unit-name"]')!;
        expect(getComputedStyle(longest).textOverflow).not.toBe('ellipsis');
        expect(longest.scrollWidth).withContext('the name is cut').toBeLessThanOrEqual(longest.clientWidth + 1);
        const lineHeight = parseFloat(getComputedStyle(longest).lineHeight) || 18;
        if (width < 400) expect(longest.getBoundingClientRect().height).withContext('wraps at phone width').toBeGreaterThan(lineHeight * 1.5);

        measured.push(
          `[${language}] ${width}: table ${Math.round(table.getBoundingClientRect().width)}, columns ${headers.join('/') || 'unit/head'}, ` +
            `longest name ${Math.round(longest.getBoundingClientRect().height)}px tall`,
        );
      });
    }

    it(`[${language}] the blockers dialog at five blockers is under the 420 cap`, async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [OrgUnitBlockersDialogComponent],
        providers: [
          ConfirmationService,
          provideNoopAnimations(),
          provideTranslateService({ lang: 'en' }),
          provideFormatTesting(),
          providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ],
      });
      loadTranslationsForTest({ en, ar });
      TestBed.inject(TranslateService).use(language);
      TestBed.inject(LanguageService).use(language);
      document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
      const dialog = TestBed.createComponent(OrgUnitBlockersDialogComponent);
      dialog.componentRef.setInput('unitName', language === 'en' ? 'Inpatient Pharmacy and Medication Safety' : 'صيدلية المرضى المنومين وسلامة الأدوية');
      dialog.componentRef.setInput('blockers', [
        { code: 'ACTIVE_CHILDREN', count: 3 },
        { code: 'ACTIVE_USERS', count: 14 },
        { code: 'ACTIVE_COMMITTEES', count: 2 },
        { code: 'ACTIVE_CHILDREN', count: 11 },
        { code: 'ACTIVE_USERS', count: 104 },
      ]);
      dialog.componentInstance.visible.set(true);
      for (let i = 0; i < 4; i++) {
        dialog.detectChanges();
        await dialog.whenStable();
        await new Promise((r) => setTimeout(r, 30));
      }
      const body = document.querySelector<HTMLElement>('.am-dialog__body')!;
      expect(body).withContext('.am-dialog__body not found').not.toBeNull();
      expect(body.querySelectorAll('[data-testid="blocker"]').length).withContext('five rows').toBe(5);
      expect(body.scrollHeight).withContext('laid out').toBeGreaterThan(200);
      measured.push(`[${language}] blockers dialog, five blockers: body ${body.scrollHeight}px of ${CAP}`);
      expect(body.scrollHeight).toBeLessThanOrEqual(CAP);
      expect(body.scrollWidth).withContext('no sideways scroll').toBeLessThanOrEqual(body.clientWidth);
      dialog.destroy();
    });
  }
});
