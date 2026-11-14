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
import { WorkflowStageListComponent } from '../workflow-stage-list/workflow-stage-list.component';
import { ALL_KINDS, WHO_RULES, storedEntry } from '../stage-who/stage-who-options.testing';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';

// ACC-255 PR 4b (plan §17.6) — the stages page with the stage editor panel
// open, MEASURED in the real theme, font and translations, at the content
// column of a 1280, 1440 and 1920 window (988, 1148, 1628) and on a phone
// (390 less its gutters: 358), in English and Arabic:
//
//   - nothing inside the panel scrolls, either way: the route scrolls as the
//     document (Templates 6b, "No inner scroll on the workflow route");
//   - nothing on the page scrolls sideways, except the strip inside its own
//     frame;
//   - every card, every row of the two sections, and the footer sit inside the
//     panel, and every row's title, description and aside inside the row;
//   - ACC-271 PR 5a — "Who works this stage", with one entry of every kind
//     (the drawing shows three; Creator, the record's unit, the record's
//     committee and a role filter are the rows it does not), the mode choice
//     and the read-back: every entry, field and Remove inside the section;
//   - the "Also needs" column mirrors: after the title in English, before it
//     in Arabic.
//
// NON-VACUITY FIRST (ACC-120): the panel, its card, its who section with its
// six entries, and its eight rows exist and are laid out, before "inside" or
// "does not scroll" may mean anything.

const CASES = [
  { name: 'at 1280', width: 988 },
  { name: 'at 1440', width: 1148 },
  { name: 'at 1920', width: 1628 },
  { name: 'at 390', width: 358 },
  // CI's Linux runner overflowed the 390 case by 15px where a Windows machine
  // did not: the deadline's number input, sized by its own intrinsic width
  // (its size attribute times the font's character width). This case runs it
  // again with a wide fallback font AND every input's intrinsic width widened
  // (size 50), so a local run fails the way CI did on a field that cannot
  // shrink with its column.
  { name: 'at 390, wide fallback font', width: 358, wideFont: true },
] as const;

/** A wide sans font, as a Linux runner without the app's font falls back to. */
const WIDE_FONT_CSS = `*, *::before, *::after { font-family: 'DejaVu Sans', 'Liberation Sans', Verdana, sans-serif !important; }`;

/** Whether something between `el` and `host` clips it sideways (the strip's frame, a truncated cell). */
function clippedBelow(el: HTMLElement, host: HTMLElement): boolean {
  for (let p = el.parentElement; p && p !== host; p = p.parentElement) {
    if (getComputedStyle(p).overflowX !== 'visible') return true;
  }
  return false;
}

/**
 * Every element under the host that passes either of its edges (the right in
 * English, the left in Arabic), unclipped on the way: what to fix when the page-width check fails, named in the
 * failure itself (CI's overflow could not be reproduced on a Windows machine).
 */
function pastTheEdge(host: HTMLElement): string {
  const box = host.getBoundingClientRect();
  const found = Array.from(host.querySelectorAll<HTMLElement>('*'))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1) && !clippedBelow(el, host))
    .map(({ el, r }) => {
      const s = getComputedStyle(el);
      const data = Array.from(el.attributes)
        .filter((a) => a.name.startsWith('data-'))
        .map((a) => (a.value ? `${a.name}=${a.value}` : a.name))
        .join(' ');
      return `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, '.').slice(0, 80)} [${data}] left=${Math.round(r.left)} right=${Math.round(r.right)} width=${Math.round(r.width)} css-width=${s.width} min-width=${s.minWidth}`;
    });
  return found.length ? `past the host's edges (${Math.round(box.left)}..${Math.round(box.right)}):\n  ${found.join('\n  ')}` : 'nothing past the host';
}

const LONG = {
  en: 'Executive Committee Terms of Reference Review and Final Sign-off by the Board',
  ar: 'مراجعة النظام الداخلي للجنة التنفيذية والاعتماد النهائي من مجلس الإدارة',
};

const UNIT = { id: 'unit-q', nameEn: 'Quality and Patient Safety Directorate', nameAr: 'إدارة الجودة وسلامة المرضى' };
const POSITION = { id: 'pos-tl', nameEn: 'Senior Infection Prevention Team Leader', nameAr: 'قائد فريق أول للوقاية من العدوى' };
const ROLE = { id: 'role-chair', labelEn: 'Chairman', labelAr: 'رئيس' };

/** One entry of every kind, the record's unit and committee, and a role filter. */
const WHO_ALL_KINDS = {
  mode: 'ALL',
  entries: [
    storedEntry({ kind: 'ORG_UNIT_HEAD', orgUnitId: UNIT.id, orgUnit: UNIT }),
    storedEntry({ kind: 'ORG_UNIT_HEAD' }),
    storedEntry({ kind: 'POSITION_IN_UNIT', positionId: POSITION.id, position: POSITION, orgUnitId: UNIT.id, orgUnit: UNIT, holderCount: 0 }),
    storedEntry({ kind: 'SPECIFIC_USER', userId: 'u-1', user: { id: 'u-1', name: 'Dr. Abdulrahman Al-Mutairi Al-Shammari' }, isStartingAssignment: true }),
    storedEntry({ kind: 'CREATOR' }),
    storedEntry({ kind: 'COMMITTEE', committeeRoleValueId: ROLE.id, committeeRole: ROLE }),
  ],
};
const LONG_SENTENCE = {
  en: "All of: the head of Quality and Patient Safety Directorate, the head of the record's unit, whoever holds Senior Infection Prevention Team Leader in Quality and Patient Safety Directorate, Dr. Abdulrahman Al-Mutairi Al-Shammari, whoever created the record, and the members of the record's committee in the role Chairman.",
  ar: 'كلٌّ من: من يرأس إدارة الجودة وسلامة المرضى، ومن يرأس وحدة السجل، ومن يشغل وظيفة قائد فريق أول للوقاية من العدوى في إدارة الجودة وسلامة المرضى، وDr. Abdulrahman Al-Mutairi Al-Shammari، ومن أنشأ السجل، وأعضاء لجنة السجل بدور رئيس.',
};

const stage = (i: number): Record<string, unknown> => ({
  id: `stage-${i}`,
  workflowTemplateId: 'template-1',
  nameEn: i === 1 ? LONG.en : `Stage ${i}`,
  nameAr: i === 1 ? LONG.ar : `المرحلة ${i}`,
  description: null,
  order: i * 10,
  slaWorkingHours: 40,
  isInitial: i === 1,
  isFinal: i === 6,
  escalationConfig: null,
  actions: i === 1 ? ['edit_details', 'add_member'] : [],
  flags: i === 1 ? ['IN_FORCE'] : [],
  liveCount: i * 3,
  transitions: [],
  who: i === 1 ? WHO_ALL_KINDS : { mode: 'ANY_ONE', entries: [storedEntry({ kind: 'CREATOR' })] },
  whoSentence: i === 1 ? LONG_SENTENCE : { en: 'Whoever created the record.', ar: 'من أنشأ السجل.' },
});

const TEMPLATE = {
  id: 'template-1',
  organizationId: 'org-a',
  nameEn: 'Committee lifecycle',
  nameAr: 'دورة حياة اللجنة',
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  isProtected: false,
  recordActions: [
    ['edit_details', 'committees:edit_details'],
    ['add_member', 'committees:add_member'],
    ['remove_member', 'committees:remove_member'],
    ['change_member_role', 'committees:change_member_role'],
    ['request_change', 'committees:edit_details'],
  ].map(([key, permissionKey]) => ({ key, labelKey: `workflow.recordAction.COMMITTEE.${key}`, permissionKey })),
  stageFlags: [
    { key: 'DISSOLVING', labelKey: 'workflow.stageFlag.DISSOLVING', cardinality: 'any' },
    { key: 'IN_FORCE', labelKey: 'workflow.stageFlag.IN_FORCE', cardinality: 'any' },
    { key: 'APPLIES_APPROVED_CHANGE', labelKey: 'workflow.stageFlag.APPLIES_APPROVED_CHANGE', cardinality: 'exactlyOne' },
  ],
  recordFields: [],
  recordRoutes: { unit: true, committee: true },
  assigneeKinds: ALL_KINDS,
  whoRules: WHO_RULES,
  stages: [1, 2, 3, 4, 5, 6].map(stage),
};

@Component({
  standalone: true,
  imports: [WorkflowStageListComponent],
  template: `<div class="flex flex-col" data-host [style.width.px]="width()"><app-workflow-stage-list /></div>`,
})
class Host {
  readonly width = input(988);
}

describe('StageEditorPanelComponent — the panel fits the page (ACC-255 PR 4b)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  let wideFontStyle: HTMLStyleElement | null = null;
  afterEach(() => {
    wideFontStyle?.remove();
    wideFontStyle = null;
  });

  async function render(width: number, lang: 'en' | 'ar', wideFont = false): Promise<HTMLElement> {
    if (wideFont) {
      wideFontStyle = document.createElement('style');
      wideFontStyle.textContent = WIDE_FONT_CSS;
      document.head.appendChild(wideFontStyle);
    }
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
          useValue: { snapshot: { paramMap: convertToParamMap({ templateId: 'template-1' }), queryParamMap: convertToParamMap({}) } },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    fixture.componentRef.setInput('width', width);
    fixture.debugElement.query(By.directive(WorkflowStageListComponent)).componentInstance.phone.set(width < 400);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(TEMPLATE);
    fixture.detectChanges();
    // Open the first stage, as a person does: its strip card.
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-strip-card]')!.click();
    fixture.detectChanges();
    // The who lists, loaded together when the panel opens.
    http.match(() => true).forEach((r) => {
      const url = r.request.url;
      if (url.endsWith('/tasks/assignment/units')) r.flush([{ ...UNIT, parentId: null }]);
      else if (url.endsWith('/org-positions')) r.flush([{ ...POSITION, isActive: true }]);
      else if (url.endsWith('/tasks/assignment/committee-roles')) r.flush([{ ...ROLE, memberCount: null }]);
      else r.flush([]);
    });
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    fixture.detectChanges();
    if (wideFont) {
      (fixture.nativeElement as HTMLElement).querySelectorAll('input').forEach((i) => i.setAttribute('size', '50'));
      fixture.detectChanges();
    }
    return fixture.nativeElement.querySelector('[data-host]') as HTMLElement;
  }

  afterEach(() => http.verify());

  const inside = (child: DOMRect, parent: DOMRect): boolean =>
    child.left >= parent.left - 1 && child.right <= parent.right + 1 && child.top >= parent.top - 1 && child.bottom <= parent.bottom + 1;

  for (const lang of ['en', 'ar'] as const) {
    for (const c of CASES) {
      it(`${c.name} [${lang}]: nothing in the panel scrolls, everything inside its box, no sideways page`, async () => {
        const host = await render(c.width, lang, 'wideFont' in c && c.wideFont);
        const panel = host.querySelector<HTMLElement>('[data-stage-panel]');

        // ── Non-vacuity ──
        expect(panel).withContext('the panel is open').not.toBeNull();
        const box = panel!.getBoundingClientRect();
        expect(box.width).withContext('the panel is laid out').toBeGreaterThan(300);
        expect(box.height).withContext('the panel is laid out').toBeGreaterThan(400);
        const cards = Array.from(panel!.querySelectorAll<HTMLElement>('[data-card], [data-section="who"]'));
        expect(cards.length).withContext('the stage card and "Who works this stage"').toBe(2);
        const who = panel!.querySelector<HTMLElement>('[data-section="who"]')!;
        const entries = Array.from(who.querySelectorAll<HTMLElement>('am-stage-who-entry'));
        expect(entries.length).withContext('one entry of every kind, and the record forms').toBe(6);
        expect(who.querySelector('[data-who-modes]')).withContext('the mode choice').not.toBeNull();
        expect(who.querySelector('[data-starting-chip]')).withContext('the starting chip').not.toBeNull();
        expect(who.querySelector('[data-no-holder]')).withContext('the no-holder warning').not.toBeNull();
        expect(who.querySelectorAll('[data-who-role]').length).withContext('the role filter').toBe(1);
        const rows = Array.from(panel!.querySelectorAll<HTMLElement>('[data-check-row]'));
        expect(rows.length).withContext('five actions and three meanings').toBe(8);

        // ── Nothing inside the panel scrolls ──
        const scrolling = Array.from(panel!.querySelectorAll<HTMLElement>('*')).filter((el) => {
          const s = getComputedStyle(el);
          const y = (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
          const x = (s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
          return x || y;
        });
        expect(scrolling.map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80)))
          .withContext('scrolls inside the panel')
          .toEqual([]);

        // ── No sideways page; only the strip scrolls sideways, in its frame ──
        const sideways = [host, ...Array.from(host.querySelectorAll<HTMLElement>('*'))].filter((el) => {
          if (el.hasAttribute('data-strip-frame')) return false;
          const ox = getComputedStyle(el).overflowX;
          return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1;
        });
        expect(sideways.map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))).withContext('scrolls sideways').toEqual([]);
        expect(host.scrollWidth).withContext(`the page; ${pastTheEdge(host)}`).toBeLessThanOrEqual(c.width + 1);
        expect(box.right).withContext('panel inside the column').toBeLessThanOrEqual(host.getBoundingClientRect().right + 1);

        // ── Everything inside its box ──
        for (const card of cards) {
          expect(inside(card.getBoundingClientRect(), box)).withContext(`card ${card.dataset['card']} inside the panel`).toBeTrue();
        }
        for (const row of rows) {
          const r = row.getBoundingClientRect();
          expect(inside(r, box)).withContext(`row ${row.dataset['checkRow']} inside the panel`).toBeTrue();
          for (const part of Array.from(row.querySelectorAll<HTMLElement>('.am-checks__title, .am-checks__desc, [data-check-aside]'))) {
            expect(inside(part.getBoundingClientRect(), r)).withContext(`row ${row.dataset['checkRow']}: ${part.className} inside the row`).toBeTrue();
            expect(part.scrollWidth).withContext(`row ${row.dataset['checkRow']}: ${part.className} not clipped`).toBeLessThanOrEqual(part.clientWidth + 1);
          }
        }
        // ── "Who works this stage": every entry, field, chip and Remove inside ──
        const whoBox = who.getBoundingClientRect();
        for (const [i, entry] of entries.entries()) {
          const r = entry.getBoundingClientRect();
          expect(r.height).withContext(`entry ${i} laid out`).toBeGreaterThan(30);
          expect(inside(r, whoBox)).withContext(`entry ${i} inside the section`).toBeTrue();
          const parts = entry.querySelectorAll<HTMLElement>('[data-slot], [data-who-remove], [data-starting-chip], [data-no-holder], .am-overlay-select-trigger, input');
          for (const part of Array.from(parts)) {
            expect(inside(part.getBoundingClientRect(), r)).withContext(`entry ${i}: ${part.className || part.tagName} inside the entry`).toBeTrue();
          }
        }
        for (const part of Array.from(who.querySelectorAll<HTMLElement>('[data-who-modes], [data-who-readback], [data-who-add], [data-starting-note]'))) {
          expect(inside(part.getBoundingClientRect(), whoBox)).withContext(`${part.className} inside the section`).toBeTrue();
          expect(part.scrollWidth).withContext(`${part.className} not clipped`).toBeLessThanOrEqual(part.clientWidth + 1);
        }

        const foot = panel!.querySelector<HTMLElement>('.am-sep__foot')!;
        expect(inside(foot.getBoundingClientRect(), box)).withContext('footer inside the panel').toBeTrue();
        for (const button of Array.from(foot.querySelectorAll<HTMLElement>('button'))) {
          expect(inside(button.getBoundingClientRect(), foot.getBoundingClientRect())).withContext('footer buttons inside the footer').toBeTrue();
        }

        // ── "Also needs" mirrors ──
        if (c.width > 400) {
          const row = rows[0]!;
          const title = row.querySelector<HTMLElement>('.am-checks__title')!.getBoundingClientRect();
          const aside = row.querySelector<HTMLElement>('[data-check-aside]')!.getBoundingClientRect();
          if (lang === 'en') expect(aside.left).withContext('aside after the title').toBeGreaterThan(title.left);
          else expect(aside.right).withContext('aside before the title, in Arabic').toBeLessThan(title.right);
        }
      });
    }
  }
});
