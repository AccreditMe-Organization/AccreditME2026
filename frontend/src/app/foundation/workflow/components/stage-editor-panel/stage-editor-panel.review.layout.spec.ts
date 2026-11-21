import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { ConfirmHostComponent } from '../../../../shared/components/confirm/confirm-host.component';
import { WorkflowStageListComponent } from '../workflow-stage-list/workflow-stage-list.component';
import { ALL_KINDS, WHO_RULES, storedEntry } from '../stage-who/stage-who-options.testing';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';

// ACC-245 PR 3b — the committee change request workflow's stages page with
// THREE review stages (Workflow Setup §13), MEASURED in the real theme, font and
// translations, in English and Arabic, at the content column of a 1280 window
// (988) and on a phone (390 less its gutters: 358):
//
//   - the review-stage panel, adding and editing: a PAGE PANEL, which the
//     accepted rule leaves uncapped (Q14), so it is measured and logged, never
//     held to 420 — but nothing inside it scrolls, nothing passes the page's
//     edge, and its fields, who section and footer sit inside it;
//   - the strip with three review stages scrolls sideways in its own frame and
//     nowhere else;
//   - the Remove stage confirm: its body under the 420 cap with at least 20px
//     of room, at 420 and with the dialog given a 390 phone's width.
//
// NON-VACUITY FIRST (ACC-120): the panel, its fields and its who entry are laid
// out, and the confirm's body measures more than a floor, before "inside" or
// "under the cap" may mean anything.

const CAP = 420;
const ROOM = 20;
const FLOOR = 20;

const UNIT = { id: 'unit-legal', nameEn: 'Legal Affairs and Regulatory Compliance Directorate', nameAr: 'إدارة الشؤون القانونية والامتثال التنظيمي' };
const POSITION = { id: 'pos-lc', nameEn: 'Senior Legal Counsel', nameAr: 'المستشار القانوني الأول' };

const move = (id: string, from: string, to: string, labelEn: string, labelAr: string, kind = 'ADVANCE') => ({
  id,
  fromStageId: from,
  toStageId: to,
  labelEn,
  labelAr,
  validatorConfig: null,
  kind,
  mover: 'APP',
  appMove: { key: 'x', en: 'When the request is approved.', ar: 'عند اعتماد الطلب.' },
});

const REVIEW = [
  { id: 'st-legal', en: 'Legal and Regulatory Compliance Review', ar: 'المراجعة القانونية والامتثال التنظيمي' },
  { id: 'st-quality', en: 'Quality review', ar: 'مراجعة الجودة' },
  { id: 'st-finance', en: 'Finance review', ar: 'المراجعة المالية' },
];

const stage = (id: string, nameEn: string, nameAr: string, order: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  workflowTemplateId: 'template-cr',
  nameEn,
  nameAr,
  description: null,
  order,
  slaWorkingHours: null,
  isInitial: order === 10,
  isFinal: order >= 30,
  escalationConfig: null,
  actions: [],
  flags: [],
  liveCount: 2,
  transitions: [],
  ...over,
});

const reviewStage = (r: (typeof REVIEW)[number], i: number) =>
  stage(r.id, r.en, r.ar, 11 + i, {
    description: 'Legal Affairs checks the change against the committee bylaws and the regulator’s current rules.',
    slaWorkingHours: 24,
    reviewStage: true,
    editableFields: ['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig', 'who'],
    who: { mode: 'ANY_ONE', entries: [storedEntry({ kind: 'POSITION_IN_UNIT', positionId: POSITION.id, position: POSITION, orgUnitId: UNIT.id, orgUnit: UNIT, holderCount: 1 })] },
    whoSentence: { en: `Whoever holds ${POSITION.nameEn} in ${UNIT.nameEn}.`, ar: `من يشغل منصب ${POSITION.nameAr} في ${UNIT.nameAr}.` },
    transitions: [
      move(`t-approve-${i}`, r.id, REVIEW[i + 1]?.id ?? 'st-review', 'Approve', 'اعتماد'),
      move(`t-return-${i}`, r.id, 'st-returned', 'Return for changes', 'إعادة للتعديل', 'RETURN'),
    ],
  });

const TEMPLATE = {
  id: 'template-cr',
  organizationId: 'org-a',
  nameEn: 'Committee change request',
  nameAr: 'طلب تغيير اللجنة',
  objectType: 'COMMITTEE_CHANGE_REQUEST',
  isDefault: true,
  isActive: true,
  isProtected: true,
  editableStageFields: ['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig'],
  recordActions: [],
  stageFlags: [{ key: 'APPLIES_APPROVED_CHANGE', labelKey: 'workflow.stageFlag.APPLIES_APPROVED_CHANGE', cardinality: 'exactlyOne' }],
  recordFields: [],
  recordRoutes: { unit: true, committee: true },
  assigneeKinds: ALL_KINDS,
  whoRules: WHO_RULES,
  reviewStages: {
    canAdd: true,
    max: 9,
    count: 3,
    after: [{ id: 'st-draft', nameEn: 'Draft', nameAr: 'مسودة' }, ...REVIEW.map((r) => ({ id: r.id, nameEn: r.en, nameAr: r.ar }))],
    who: { modes: ['ANY_ONE'], assigneeKinds: ['SPECIFIC_USER', 'POSITION_IN_UNIT', 'ORG_UNIT_HEAD', 'COMMITTEE'] },
  },
  stages: [
    stage('st-draft', 'Draft', 'مسودة', 10, { transitions: [move('t-submit', 'st-draft', 'st-legal', 'Submit for review', 'إرسال للمراجعة')] }),
    ...REVIEW.map(reviewStage),
    stage('st-review', 'Under review', 'قيد المراجعة', 20, { transitions: [move('t-apply', 'st-review', 'st-approved', 'Approve and apply', 'اعتماد وتطبيق')] }),
    stage('st-approved', 'Approved', 'معتمد', 30, { flags: ['APPLIES_APPROVED_CHANGE'] }),
  ],
};

@Component({
  standalone: true,
  imports: [WorkflowStageListComponent, ConfirmHostComponent],
  template: `<div class="flex flex-col" data-host [style.width.px]="width()"><app-workflow-stage-list /></div><am-confirm-host />`,
})
class Host {
  readonly width = input(988);
}

describe('Review stages — layout, measured (ACC-245 PR 3b)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  afterAll(() => console.log(`ACC-245 PR 3b (page panel uncapped; dialogs cap ${CAP}, room ≥ ${ROOM}):\n  ${measured.join('\n  ')}`));

  afterEach(() => {
    http?.verify();
    document.querySelectorAll('.p-dialog-mask, .p-dialog, .p-confirmdialog').forEach((n) => n.remove());
    fixture?.destroy();
  });

  async function render(width: number, lang: 'en' | 'ar', open: 'add' | 'edit'): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ templateId: 'template-cr' }), queryParamMap: convertToParamMap({}) } },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.componentRef.setInput('width', width);
    fixture.debugElement.query(By.directive(WorkflowStageListComponent)).componentInstance.phone.set(width < 400);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/workflow-templates/template-cr`).flush(TEMPLATE);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    if (open === 'add') root.querySelector<HTMLButtonElement>('[data-testid="add-review-stage"] button')!.click();
    else root.querySelector<HTMLButtonElement>('[data-strip-card][data-stage-id="st-legal"]')!.click();
    fixture.detectChanges();
    http.match(() => true).forEach((r) => {
      const url = r.request.url;
      if (url.endsWith('/tasks/assignment/units')) r.flush([{ ...UNIT, parentId: null }]);
      else if (url.endsWith('/org-positions')) r.flush([{ ...POSITION, isActive: true }]);
      else r.flush([]);
    });
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    fixture.detectChanges();
    return root.querySelector('[data-host]') as HTMLElement;
  }

  const inside = (child: DOMRect, parent: DOMRect): boolean =>
    child.left >= parent.left - 1 && child.right <= parent.right + 1 && child.top >= parent.top - 1 && child.bottom <= parent.bottom + 1;

  for (const lang of ['en', 'ar'] as const) {
    for (const [label, width] of [['1280', 988], ['390', 358]] as const) {
      for (const open of ['add', 'edit'] as const) {
        it(`${open} at ${label} [${lang}]: the page panel, uncapped; nothing in it scrolls, everything inside, no sideways page`, async () => {
          const host = await render(width, lang, open);
          const panel = host.querySelector<HTMLElement>('[data-stage-panel]');

          // ── Non-vacuity ──
          expect(panel).withContext('the panel is open').not.toBeNull();
          const box = panel!.getBoundingClientRect();
          expect(box.width).withContext('laid out').toBeGreaterThan(300);
          expect(box.height).withContext('laid out').toBeGreaterThan(300);
          expect(panel!.querySelector('[data-goes-after]')).withContext('Goes after').not.toBeNull();
          const entries = panel!.querySelectorAll('am-stage-who-entry');
          expect(entries.length).withContext('one who entry').toBe(1);
          expect(panel!.querySelector('[data-who-decides]')).withContext('the two lines').not.toBeNull();
          measured.push(`panel ${open} at ${label} [${lang}]: ${Math.round(box.height)}px tall (page panel, uncapped)`);

          // ── Nothing inside scrolls ──
          const scrolling = Array.from(panel!.querySelectorAll<HTMLElement>('*')).filter((el) => {
            const s = getComputedStyle(el);
            return (
              ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) ||
              ((s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
            );
          });
          expect(scrolling.map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))).withContext('scrolls inside the panel').toEqual([]);

          // ── Only the strip scrolls sideways, in its own frame ──
          const sideways = [host, ...Array.from(host.querySelectorAll<HTMLElement>('*'))].filter((el) => {
            if (el.hasAttribute('data-strip-frame')) return false;
            const ox = getComputedStyle(el).overflowX;
            return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1;
          });
          expect(sideways.map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))).withContext('scrolls sideways').toEqual([]);
          expect(host.scrollWidth).withContext('the page').toBeLessThanOrEqual(width + 1);

          // ── Inside the panel ──
          for (const part of Array.from(panel!.querySelectorAll<HTMLElement>('am-field, [data-section="who"], [data-who-decides] p, .am-sep__foot'))) {
            expect(inside(part.getBoundingClientRect(), box)).withContext(`${part.tagName.toLowerCase()}.${part.className} inside the panel`).toBeTrue();
          }
          const foot = panel!.querySelector<HTMLElement>('.am-sep__foot')!.getBoundingClientRect();
          for (const button of Array.from(panel!.querySelectorAll<HTMLElement>('.am-sep__foot button'))) {
            expect(inside(button.getBoundingClientRect(), foot)).withContext('footer buttons inside the footer').toBeTrue();
          }
          // The three review stages are on the strip, each with its chip.
          expect(host.querySelectorAll('[data-strip-review]').length).withContext('three review stages on the strip').toBe(3);
        });
      }

      it(`the Remove stage confirm at ${label} [${lang}]: under the 420 cap with room`, async () => {
        const host = await render(988, lang, 'edit');
        host.querySelector<HTMLButtonElement>('[data-panel-remove]')!.click();
        fixture.detectChanges();
        for (let turn = 0; !document.querySelector('.p-confirmdialog .p-dialog-footer button'); turn++) {
          if (turn > 100) throw new Error('the confirm never opened');
          await new Promise((r) => setTimeout(r, 20));
        }
        const frame = document.querySelector<HTMLElement>('.p-confirmdialog')!;
        if (width === 358) frame.style.width = '390px';
        await new Promise((r) => setTimeout(r, 300));
        const body = frame.querySelector<HTMLElement>('.p-dialog-content')!;
        const height = body.scrollHeight;
        measured.push(`remove confirm at ${label} [${lang}]: body ${height}px, room ${CAP - height}px, width ${Math.round(frame.getBoundingClientRect().width)}`);
        expect(height).withContext('laid out').toBeGreaterThan(FLOOR);
        expect(text(body)).toContain(lang === 'en' ? 'Requests will go from Draft straight to Quality review.' : 'ستنتقل الطلبات من «مسودة» مباشرةً إلى «مراجعة الجودة».');
        expect(CAP - height).withContext(`body ${height}px leaves under ${ROOM}px`).toBeGreaterThanOrEqual(ROOM);
      });
    }
  }
});

function text(el: Element | null): string {
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
