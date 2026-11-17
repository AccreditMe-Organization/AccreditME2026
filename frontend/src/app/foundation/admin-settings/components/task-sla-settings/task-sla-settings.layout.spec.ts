import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { ConfirmHostComponent } from '../../../../shared/components/confirm/confirm-host.component';
import { ITaskSlaChange } from '../../../tenant/services/tenant.service';
import { TaskSlaSettingsComponent } from './task-sla-settings.component';

// ACC-313 PR 2 — the page with the real theme, in both languages:
//   - at the content width a 1280 window gives (988), a 1440 window's (1148)
//     and a phone's (358): every section laid out, the matrix one row per
//     priority at 988 and 1148 and one block per priority at 358, and nothing
//     wider than the frame;
//   - the leave confirm under the 420px cap, with room;
//   - the change history in its list dialog, nothing running sideways.
// ACC-313 3-fe — the "warn before due" column at all three widths, its select
// showing its longest label whole ("1 working day" / «يوم عمل واحد») and its
// open list on the page; the Notifications and Reset sections; the Reset
// confirm under the 420px cap, with room.
//
// NON-VACUITY FIRST (ACC-120): each case proves the thing it measures rendered,
// with width and height, before "nothing is wider" may mean anything.

const CAP = 420;
const ROOM = 20;

@Component({
  standalone: true,
  imports: [TaskSlaSettingsComponent, ConfirmHostComponent],
  template: `<div data-testid="frame" [style.width.px]="width()" style="box-sizing: content-box"><app-task-sla-settings /></div><am-confirm-host />`,
})
class FrameComponent {
  readonly width = input(988);
}

const SLA = {
  LOW: { dueAfterHours: 80, managerEscalationAfterHours: 48, headEscalationAfterHours: 96 },
  MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
  HIGH: { dueAfterHours: 16, managerEscalationAfterHours: 8, headEscalationAfterHours: 16 },
  CRITICAL: { dueAfterHours: 4, managerEscalationAfterHours: 2, headEscalationAfterHours: 4 },
};

const POLICY = {
  tiers: SLA,
  // LOW holds the longest option label in both languages.
  notices: { warnBeforeDue: { LOW: 'WORKING_DAY', MEDIUM: 'H8', HIGH: 'H2', CRITICAL: 'OFF' }, notifyOnDueChange: true },
  workingHoursPerDay: 8,
};

const HISTORY: ITaskSlaChange[] = [
  {
    id: 'c-2',
    changedAt: '2026-11-16T09:00:00.000Z',
    actorName: 'Dr. Nora bint Abdulrahman Al-Otaibi',
    kind: 'escalation',
    before: { LOW: { managerEscalationAfterHours: 48, headEscalationAfterHours: 96 }, HIGH: { managerEscalationAfterHours: 8, headEscalationAfterHours: 16 } },
    after: { LOW: { managerEscalationAfterHours: 40, headEscalationAfterHours: 80 }, HIGH: { managerEscalationAfterHours: 6, headEscalationAfterHours: 12 } },
  },
  { id: 'c-1', changedAt: '2026-11-10T09:00:00.000Z', actorName: 'Huda Al-Harbi', kind: 'limits', before: { HIGH: { dueAfterHours: 24 } }, after: { HIGH: { dueAfterHours: 16 } } },
  { id: 'c-0', changedAt: '2026-11-01T09:00:00.000Z', actorName: null, kind: 'legacy', before: null, after: null },
  { id: 'n-1', changedAt: '2026-10-30T09:00:00.000Z', actorName: 'Huda Al-Harbi', kind: 'notices', before: { notifyOnDueChange: true }, after: { notifyOnDueChange: false } },
  {
    id: 'r-1',
    changedAt: '2026-10-29T09:00:00.000Z',
    actorName: 'Huda Al-Harbi',
    kind: 'reset',
    before: { tiers: { ...SLA, HIGH: { ...SLA.HIGH, dueAfterHours: 24 } }, notices: { warnBeforeDue: { LOW: 'WORKING_DAY', MEDIUM: 'OFF', HIGH: 'OFF', CRITICAL: 'OFF' }, notifyOnDueChange: false } },
    after: { tiers: SLA, notices: { warnBeforeDue: { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'OFF', CRITICAL: 'OFF' }, notifyOnDueChange: true } },
  },
];

describe('TaskSlaSettings — layout (ACC-313)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let fixture: ComponentFixture<FrameComponent>;
  const measured: string[] = [];

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  async function until(what: string, ok: () => boolean): Promise<void> {
    for (let turn = 0; !ok(); turn++) {
      if (turn > 100) throw new Error(`timed out waiting for ${what}`);
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 20));
    }
    await settle();
  }

  /** Until the frame stops moving: PrimeNG's open motion runs on CSS time, not the test's. */
  async function still(frame: HTMLElement): Promise<void> {
    let last = '';
    let same = 0;
    for (let turn = 0; turn < 100; turn++) {
      const r = frame.getBoundingClientRect();
      const now = `${r.width}x${r.height}@${r.left},${r.top}`;
      same = now === last ? same + 1 : 0;
      if (same >= 3) return settle();
      last = now;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error('the dialog never stopped moving');
  }

  async function render(lang: 'en' | 'ar', width: number): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FrameComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(FrameComponent);
    fixture.componentRef.setInput('width', width);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${environment.apiUrl}/tenant/task-sla/policy`).flush(POLICY);
    http.expectOne((r) => r.url === `${environment.apiUrl}/tenant/task-sla/history`).flush({ rows: HISTORY, total: HISTORY.length });
    await settle();
    return fixture.nativeElement.querySelector('[data-testid="frame"]') as HTMLElement;
  }

  const page = () => fixture.debugElement.children[0]!.children[0]!.componentInstance as TaskSlaSettingsComponent;
  const box = (el: Element) => el.getBoundingClientRect();

  afterEach(() => {
    fixture?.nativeElement.remove();
    document.querySelectorAll('.p-dialog-mask, .p-dialog, .p-confirmdialog, .cdk-overlay-container').forEach((n) => n.remove());
  });
  afterAll(() => console.log(`ACC-313 Task SLA layout\n${measured.join('\n')}`));

  for (const lang of ['en', 'ar'] as const) {
    for (const width of [988, 1148, 358]) {
      it(`${lang}, ${width}: every section laid out, the matrix ${width < 560 ? 'stacked' : 'one row per priority'}, nothing wider than the frame`, async () => {
        const frame = await render(lang, width);
        const limits = frame.querySelector('[data-sla-section="limits"]')!;
        const notices = frame.querySelector('[data-sla-section="notices"]')!;
        const escalation = frame.querySelector('[data-sla-section="escalation"]')!;
        const reset = frame.querySelector('[data-sla-section="reset"]')!;
        const rows = Array.from(frame.querySelectorAll<HTMLElement>('[data-sla-row]'));
        // Non-vacuity: every section and all four rows rendered, with size, and
        // each row holds a warning select whose trigger shows a label.
        expect(box(limits).width).withContext('limits').toBeGreaterThan(200);
        expect(box(notices).height).withContext('notices').toBeGreaterThan(40);
        expect(box(escalation).height).withContext('escalation').toBeGreaterThan(100);
        expect(box(reset).height).withContext('reset').toBeGreaterThan(40);
        expect(rows.length).toBe(4);
        expect(frame.querySelectorAll('[data-sla-limit] input').length).toBe(4);
        const triggers = rows.map((r) => r.querySelector<HTMLElement>('[data-sla-warn] .am-overlay-select-trigger')!);
        expect(triggers.every((t) => !!t && box(t).width > 60)).withContext('a warning select per row').toBeTrue();
        // The longest label, whole: LOW holds "1 working day" / «يوم عمل واحد».
        const low = triggers[0]!;
        expect(low.textContent).toContain(lang === 'en' ? '1 working day' : 'يوم عمل واحد');
        const lowLabel = low.querySelector<HTMLElement>('.am-overlay-select-label') ?? low;
        expect(lowLabel.scrollWidth).withContext('the longest label is not cut').toBeLessThanOrEqual(lowLabel.clientWidth + 1);
        // The section order is the plan's.
        expect([limits, notices, escalation, reset].map((n) => Math.round(box(n).top))).toEqual(
          [limits, notices, escalation, reset].map((n) => Math.round(box(n).top)).sort((a, b) => a - b),
        );

        const stacked = page().stacked();
        expect(stacked).withContext('stacked').toBe(width < 560);
        for (const row of rows) {
          const cells = Array.from(row.children) as HTMLElement[];
          const tops = cells.map((c) => Math.round(box(c).top));
          if (stacked) {
            // One block per priority: each part below the one before it.
            expect(tops).withContext(`${row.dataset['slaRow']} stacked`).toEqual([...tops].sort((a, b) => a - b));
            expect(new Set(tops).size).withContext(`${row.dataset['slaRow']} stacked`).toBe(cells.length);
          } else {
            // One row: every field input, and the warning select, starts on the same line.
            const inputs = Array.from(row.querySelectorAll('input')).map((i) => Math.round(box(i).top));
            expect(new Set(inputs).size).withContext(`${row.dataset['slaRow']} one line`).toBe(1);
            const trigger = row.querySelector<HTMLElement>('[data-sla-warn] .am-overlay-select-trigger')!;
            expect(Math.abs(Math.round(box(trigger).top) - inputs[0]!)).withContext(`${row.dataset['slaRow']} warning on the line`).toBeLessThanOrEqual(2);
          }
        }
        if (!stacked) {
          // The page holds its 760 column; the head row names the columns.
          expect(box(limits).width).toBeLessThanOrEqual(760);
          expect(frame.querySelector('.am-sla__row--head')).not.toBeNull();
          // The warning column holds 180px; its list opens at 200 (the warning list test).
          expect(box(triggers[0]!.closest('[data-sla-warn]')!).width).withContext('warning column').toBeGreaterThanOrEqual(175);
          // Every Limit figure on ONE line, the longest included ("80 working
          // hours" / «80 ساعة عمل»). Non-vacuity first: the figure is there and
          // has size, so one line box means one line, not nothing.
          const limitFigures = rows.map((r) => r.querySelector<HTMLElement>('[data-testid="sla-matrix-limit"]')!);
          expect(limitFigures[0]!.textContent).toContain(lang === 'en' ? '80 working hours' : '80 ساعة عمل');
          for (const figure of limitFigures) {
            expect(box(figure).width).withContext(`${figure.textContent} has size`).toBeGreaterThan(20);
            // One line box per distinct top: Arabic beside digits gives one rect per
            // direction run on the same line, so count lines, not rects.
            const lines = new Set(Array.from(figure.getClientRects()).map((r) => Math.round(r.top)));
            expect(lines.size).withContext(`${figure.textContent} on one line`).toBe(1);
          }
        } else {
          // Each stacked cell shows its own label.
          const label = rows[0]!.querySelector('label.am-field__label')!;
          expect(label.classList).not.toContain('sr-only');
          expect(box(label).height).toBeGreaterThan(8);
        }

        expect(frame.scrollWidth).withContext('frame').toBeLessThanOrEqual(frame.clientWidth);
        const f = box(frame);
        const over = Array.from(frame.querySelectorAll<HTMLElement>('*')).filter((e) => {
          const r = box(e);
          return r.width > 0 && (r.right > f.right + 1 || r.left < f.left - 1);
        });
        expect(over.map((e) => e.getAttribute('data-testid') ?? e.id ?? e.className ?? e.tagName)).withContext('elements past the frame').toEqual([]);
        measured.push(
          `  ${lang} ${width}: limits ${Math.round(box(limits).height)}, notices ${Math.round(box(notices).height)}, escalation ${Math.round(box(escalation).height)}, reset ${Math.round(box(reset).height)}, page ${Math.round(frame.scrollHeight)}; matrix ${stacked ? 'stacked' : 'rows'}; warning column ${Math.round(box(triggers[0]!).width)}; limit ${stacked ? '-' : Math.round(box(rows[0]!.querySelector('[data-testid="sla-matrix-limit"]')!).width)}; sideways ${frame.scrollWidth - frame.clientWidth}`,
        );
      }, 20_000);
    }

    it(`${lang}: the leave confirm, naming both sections, fits the ${CAP}px cap with room`, async () => {
      await render(lang, 988);
      const p = page();
      p.limitsForm.controls.HIGH.setValue(12);
      p.escalationForm.controls.LOW.controls.headEscalationAfterHours.setValue(90);
      await settle();
      void p.canLeave();
      await until('the confirm', () => !!document.querySelector('.p-confirmdialog .p-dialog-footer button, .p-confirmdialog button'));
      const frame = document.querySelector<HTMLElement>('.p-confirmdialog')!;
      await still(frame);
      const body = frame.querySelector<HTMLElement>('.p-dialog-content')!;
      // Non-vacuity: the message is there and names both sections.
      const sections = lang === 'en' ? ['Time limits', 'Reminders and escalation per priority'] : ['حدود الوقت', 'التذكير والتصعيد حسب الأولوية'];
      for (const s of sections) expect(body.textContent).toContain(s);
      const height = body.scrollHeight;
      expect(height).toBeGreaterThan(20);
      expect(box(frame).width).toBeLessThanOrEqual(CAP + 1);
      expect(CAP - height).withContext(`body ${height}px`).toBeGreaterThanOrEqual(ROOM);
      measured.push(`  ${lang} leave confirm: body ${height}px, width ${Math.round(box(frame).width)}`);
    }, 20_000);

    it(`${lang}: the change history lists every save in its list dialog, nothing sideways`, async () => {
      const frame = await render(lang, 988);
      (frame.querySelector('[data-testid="sla-history-open"] button') as HTMLButtonElement).click();
      await until('the history', () => !!document.querySelector('[data-testid="sla-history"] [data-change-kind]'));
      const dialog = document.querySelector<HTMLElement>('[data-testid="list-dialog"]')!;
      await still(dialog);
      const list = document.querySelector<HTMLElement>('[data-testid="sla-history"]')!;
      const entries = list.querySelectorAll('[data-change-kind]');
      // Non-vacuity: five saves, the escalation one with its four moved values,
      // the switch and a reset among them.
      expect(entries.length).toBe(5);
      expect(list.querySelector('[data-change-kind="notices"]')).not.toBeNull();
      expect(list.querySelector('[data-change-kind="reset"] li')).not.toBeNull();
      expect(entries[0]!.querySelectorAll('li').length).toBe(4);
      expect(box(list).width).toBeGreaterThan(300);
      expect(list.scrollWidth).withContext('history sideways').toBeLessThanOrEqual(list.clientWidth);
      measured.push(`  ${lang} history: dialog ${Math.round(box(dialog).width)}×${Math.round(box(dialog).height)}, list ${list.scrollHeight}`);
    }, 20_000);

    it(`${lang}: the Reset confirm, its longest body, fits the ${CAP}px cap with room`, async () => {
      const frame = await render(lang, 988);
      (frame.querySelector('[data-testid="sla-reset-open"] button') as HTMLButtonElement).click();
      await until('the confirm', () => !!document.querySelector('.p-confirmdialog .p-dialog-footer button, .p-confirmdialog button'));
      const dialog = document.querySelector<HTMLElement>('.p-confirmdialog')!;
      await still(dialog);
      const body = dialog.querySelector<HTMLElement>('.p-dialog-content')!;
      // Non-vacuity: the body says what goes back and what stays.
      expect(body.textContent).toContain(lang === 'en' ? 'open tasks keep the limits they were created with' : 'وتحتفظ المهام المفتوحة بالحدود التي أُنشئت بها');
      const height = body.scrollHeight;
      expect(height).toBeGreaterThan(40);
      expect(box(dialog).width).toBeLessThanOrEqual(CAP + 1);
      expect(CAP - height).withContext(`body ${height}px`).toBeGreaterThanOrEqual(ROOM);
      measured.push(`  ${lang} reset confirm: body ${height}px, width ${Math.round(box(dialog).width)}`);
    }, 20_000);

    it(`${lang}: the warning list opens on the page, its six options whole`, async () => {
      const frame = await render(lang, 988);
      const trigger = frame.querySelector<HTMLElement>('[data-sla-warn="CRITICAL"] .am-overlay-select-trigger')!;
      trigger.click();
      await until('the list', () => document.querySelectorAll('.cdk-overlay-container [role="option"]').length === 6);
      const options = Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container [role="option"]'));
      // Non-vacuity: six options, three of them greyed (Critical's limit is 4).
      expect(options.length).toBe(6);
      expect(options.filter((o) => o.getAttribute('aria-disabled') === 'true').length).toBe(3);
      // A greyed option says why, beside its label.
      expect(options[3]!.textContent).toContain(lang === 'en' ? 'Not shorter than the limit of 4 working hours' : 'ليس أقصر من الحد البالغ 4 ساعات عمل');
      expect(options[1]!.textContent).not.toContain(lang === 'en' ? 'Not shorter' : 'ليس أقصر');
      const panel = options[0]!.closest<HTMLElement>('.cdk-overlay-pane')!;
      expect(box(panel).width).toBeGreaterThanOrEqual(box(trigger).width - 1);
      // The list keeps its 200px though the column is 180 (panelMinWidth).
      expect(box(panel).width).withContext('panel width').toBeGreaterThanOrEqual(199);
      for (const o of options) expect(o.scrollWidth).withContext(o.textContent ?? '').toBeLessThanOrEqual(o.clientWidth + 1);
      expect(box(panel).right).toBeLessThanOrEqual(window.innerWidth + 1);
      expect(box(panel).left).toBeGreaterThanOrEqual(-1);
      measured.push(`  ${lang} warning list: panel ${Math.round(box(panel).width)}×${Math.round(box(panel).height)}`);
    }, 20_000);
  }
});
