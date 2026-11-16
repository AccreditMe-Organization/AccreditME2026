import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowTemplateDto, WorkflowStageDto, WorkflowTransitionDto } from '../../services/workflow-template.service';
import { TransitionPanelComponent } from './transition-panel.component';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';

// ACC-271 PR 5b — the transition panel, MEASURED in the real theme, font and
// translations, at the page column's width in a 1280, 1440 and 1920 window and
// on a 390 phone (988, 1148, 1628, 358 — the stages page's own cases), in
// English and Arabic, for a person's move (editable) and a move the app runs
// (read-only):
//
//   - nothing in the panel scrolls, sideways or down: the route scrolls as the
//     document (the page's scroll spec holds <main> to that);
//   - every field, the "How it moves" sentence and the footer sit inside it;
//   - From, To and Kind share a row where there is room, and stack on a phone.
//
// NON-VACUITY FIRST: the panel is laid out (its width is the column's) and the
// controls exist, before "inside" may mean anything.

const CASES = [
  { name: 'at 1280', width: 988 },
  { name: 'at 1440', width: 1148 },
  { name: 'at 1920', width: 1628 },
  { name: 'at 390', width: 358 },
] as const;

const LONG = {
  en: 'Send the terms of reference to the Board for its final approval and sign-off',
  ar: 'إرسال النظام الداخلي إلى مجلس الإدارة لاعتماده النهائي والتوقيع عليه',
};

const stage = (id: string, nameEn: string, nameAr: string, order: number): WorkflowStageDto =>
  ({ id, workflowTemplateId: 'tpl-1', nameEn, nameAr, order, transitions: [] }) as unknown as WorkflowStageDto;

const PERSON: WorkflowTransitionDto = {
  id: 't1',
  fromStageId: 's1',
  toStageId: 's2',
  labelEn: LONG.en,
  labelAr: LONG.ar,
  validatorConfig: null,
  isApprovalPath: true,
  kind: 'EXIT',
  mover: 'PERSON',
  actions: [
    { id: 'a1', workflowTransitionId: 't1', actionType: 'SEND_NOTIFICATION', order: 10, isEnabled: true, configJson: null },
    { id: 'a2', workflowTransitionId: 't1', actionType: 'WEBHOOK', order: 20, isEnabled: false, configJson: null },
    { id: 'a3', workflowTransitionId: 't1', actionType: 'LOG_AUDIT', order: 30, isEnabled: true, configJson: null },
  ],
};

const APP: WorkflowTransitionDto = {
  ...PERSON,
  id: 't-app',
  mover: 'APP',
  appMove: { key: 'cr.approve', en: "Runs when the change request is approved on the committee's Changes tab.", ar: 'تُنفَّذ عند اعتماد طلب التغيير من تبويب «التغييرات» في سجل اللجنة.' },
};

const TEMPLATE: WorkflowTemplateDto = {
  id: 'tpl-1',
  organizationId: 'org-a',
  nameEn: 'Committee lifecycle',
  nameAr: 'دورة حياة اللجنة',
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  isProtected: false,
  createdAt: '',
  updatedAt: '',
  stages: [stage('s1', 'Dissolution Pending', 'بانتظار الحل', 10), stage('s2', 'Dissolved', 'منحلة', 20)],
};

@Component({
  standalone: true,
  imports: [TransitionPanelComponent],
  template: `<div data-host [style.width.px]="width()">
    <am-transition-panel [template]="template" [transition]="transition()" fromStageId="s1" />
  </div>`,
})
class Host {
  readonly width = input(988);
  readonly transition = input<WorkflowTransitionDto | null>(PERSON);
  readonly template = TEMPLATE;
}

describe('am-transition-panel — fits the page column (ACC-271 PR 5b)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let fixture: ComponentFixture<Host>;

  async function render(width: number, lang: 'en' | 'ar', transition: WorkflowTransitionDto | null): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    fixture = TestBed.createComponent(Host);
    fixture.componentRef.setInput('width', width);
    fixture.componentRef.setInput('transition', transition);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-transition-panel]')!;
  }

  afterEach(() => fixture?.destroy());

  /** Every descendant that scrolls, either way, with something to scroll. */
  const scrollers = (panel: HTMLElement): string[] =>
    Array.from(panel.querySelectorAll<HTMLElement>('*'))
      .filter((el) => {
        const cs = getComputedStyle(el);
        const x = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
        const y = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
        return x || y;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);

  const inside = (panel: HTMLElement, el: Element, what: string): void => {
    const p = panel.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    expect(r.width).withContext(`${what} is laid out`).toBeGreaterThan(0);
    expect(r.left).withContext(`${what} (left)`).toBeGreaterThanOrEqual(p.left - 1);
    expect(r.right).withContext(`${what} (right)`).toBeLessThanOrEqual(p.right + 1);
  };

  for (const lang of ['en', 'ar'] as const) {
    for (const c of CASES) {
      it(`${c.name} [${lang}], a person’s move: nothing scrolls, everything inside, From · To · Kind in a row where there is room`, async () => {
        const panel = await render(c.width, lang, PERSON);
        // ── Non-vacuity ──
        expect(panel.getBoundingClientRect().width).toBeCloseTo(c.width, 0);
        const fields = Array.from(panel.querySelectorAll<HTMLElement>('am-field'));
        expect(fields.length).withContext('names, From, To and Kind').toBe(5);

        expect(scrollers(panel)).withContext('scrolls inside the panel').toEqual([]);
        expect(panel.scrollWidth).withContext('the panel sideways').toBeLessThanOrEqual(panel.clientWidth + 1);
        for (const sel of ['am-field', '[data-pressed-by]', '[data-actions-summary]', '[data-open-actions]', '[data-panel-save]', '[data-panel-remove]', '[data-panel-cancel]']) {
          for (const el of Array.from(panel.querySelectorAll(sel))) inside(panel, el, sel);
        }
        // The stage link reads inline, inside its sentence.
        inside(panel, panel.querySelector('[data-stage-link]')!, 'the stage link');

        // From, To and Kind: one row where there is room, one above the other on a phone.
        const [from, to, kind] = fields.slice(2).map((f) => f.getBoundingClientRect());
        const oneRow = Math.abs(from!.top - to!.top) < 1 && Math.abs(to!.top - kind!.top) < 1;
        expect(oneRow).withContext('From · To · Kind side by side').toBe(c.width >= 560);
      });

      it(`${c.name} [${lang}], a move the app runs: read-only, nothing scrolls, the banner and Close inside`, async () => {
        const panel = await render(c.width, lang, APP);
        expect(panel.querySelector('[data-app-move]')).withContext('non-vacuity: the server’s line').not.toBeNull();
        expect(scrollers(panel)).withContext('scrolls inside the panel').toEqual([]);
        expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
        for (const sel of ['[data-app-run-banner]', '[data-readonly-pairs] dd', '[data-panel-close]', '[data-open-actions]']) {
          for (const el of Array.from(panel.querySelectorAll(sel))) inside(panel, el, sel);
        }
      });
    }
  }

  it('adding: To is a choice, and the line under the actions heading says when they can be set', async () => {
    const panel = await render(1148, 'en', null);
    expect(panel.querySelector('[data-to-select]')).not.toBeNull();
    expect(panel.querySelector('[data-actions-adding]')).not.toBeNull();
    expect(scrollers(panel)).toEqual([]);
  });
});
