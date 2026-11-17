import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { AmConfirmOptions, AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { ITaskSlaChange, ITaskSlaNotices, ITaskSlaPolicy, ITaskSlaSettings } from '../../../tenant/services/tenant.service';
import { TaskSlaSettingsComponent } from './task-sla-settings.component';

// ACC-313 PR 2 — the Task SLA page from the approved design (template 5), on
// PR 1's routes: two sections, each with its own dirty chip, Discard and Save,
// a Save that is never disabled, the stage-deadline refusal under its
// priority (ACC-208), the change history, and the leave guard.
// ACC-313 3-fe — read from GET …/policy; the Notifications switch, Reset, the
// "warn before due" column and both warning refusals, said from their codes.

const SLA: ITaskSlaSettings = {
  LOW: { dueAfterHours: 80, managerEscalationAfterHours: 48, headEscalationAfterHours: 96 },
  MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
  HIGH: { dueAfterHours: 16, managerEscalationAfterHours: 8, headEscalationAfterHours: 16 },
  CRITICAL: { dueAfterHours: 4, managerEscalationAfterHours: 2, headEscalationAfterHours: 4 },
};

const NOTICES: ITaskSlaNotices = {
  warnBeforeDue: { LOW: 'OFF', MEDIUM: 'H8', HIGH: 'H2', CRITICAL: 'OFF' },
  notifyOnDueChange: true,
};

const POLICY: ITaskSlaPolicy = { tiers: SLA, notices: NOTICES, workingHoursPerDay: 8 };

const DEFAULTS: ITaskSlaPolicy = {
  tiers: SLA,
  notices: { warnBeforeDue: { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'OFF', CRITICAL: 'OFF' }, notifyOnDueChange: true },
  workingHoursPerDay: 8,
};

const CONFLICT = {
  stageId: 'stage-terms',
  stageName: 'Terms Review',
  stageNameAr: 'مراجعة الشروط',
  templateName: 'Committee Management',
  templateNameAr: null,
  workflowTemplateId: 'template-1',
  stageHours: 16,
  longestTaskHours: 24,
  priority: 'HIGH',
};

const change = (over: Partial<ITaskSlaChange> = {}): ITaskSlaChange => ({
  id: 'c-1',
  changedAt: '2026-11-16T09:00:00.000Z',
  actorName: 'Nora Al-Otaibi',
  kind: 'limits',
  before: { HIGH: { dueAfterHours: 16 }, LOW: { dueAfterHours: 80 } },
  after: { HIGH: { dueAfterHours: 12 }, LOW: { dueAfterHours: 80 } },
  ...over,
});

describe('TaskSlaSettingsComponent (ACC-313)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<TaskSlaSettingsComponent>;
  let http: HttpTestingController;
  let asked: AmConfirmOptions[];
  const base = `${environment.apiUrl}/tenant/task-sla`;
  const isHistory = (skip: number) => (r: { url: string; params: { get(k: string): string | null } }) =>
    r.url === `${base}/history` && r.params.get('skip') === String(skip) && r.params.get('take') === '20';

  function setup(opts: { language?: 'en' | 'ar'; history?: ITaskSlaChange[]; total?: number; policy?: ITaskSlaPolicy } = {}): TaskSlaSettingsComponent {
    asked = [];
    TestBed.configureTestingModule({
      imports: [TaskSlaSettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(opts.language ?? 'en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskSlaSettingsComponent);
    fixture.detectChanges();
    http.expectOne(`${base}/policy`).flush(opts.policy ?? POLICY);
    const rows = opts.history ?? [change()];
    http.expectOne(isHistory(0)).flush({ rows, total: opts.total ?? rows.length });
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (sel: string) => el().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const press = (testId: string) => {
    el().querySelector<HTMLButtonElement>(`[data-testid="${testId}"] button`)!.click();
    fixture.detectChanges();
  };
  const setLimit = (c: TaskSlaSettingsComponent, p: keyof ITaskSlaSettings, v: number | null) => {
    c.limitsForm.controls[p].setValue(v);
    fixture.detectChanges();
  };
  const refuse = (req: TestRequest, stages: unknown[]) => {
    req.flush(
      { statusCode: 409, code: 'TASK_SLA_EXCEEDS_STAGE_DEADLINES', message: 'English for a log', stages },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
  };
  const refuseWarning = (req: TestRequest, code: string, body: Record<string, unknown>) => {
    req.flush({ statusCode: 400, code, message: 'English for a log', ...body }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
  };

  afterEach(() => http.verify());

  describe('the header', () => {
    it('names who changed the policy last, and opens the history', () => {
      setup();
      expect(text('[data-testid="sla-meta"]')).toContain('Last changed by Nora Al-Otaibi on');
      expect(el().querySelector('[data-testid="sla-history-open"]')).not.toBeNull();
    });

    it('an Arabic date takes the page’s direction, in the header and in the history, so the day stays before its month', () => {
      setup({ language: 'ar' });
      const header = el().querySelector<HTMLElement>('[data-testid="sla-meta"] [data-sla-changed-at]')!;
      // Non-vacuity: the date is there, in Arabic, day first.
      expect(header.textContent?.trim()).toMatch(/^16 نوفمبر 2026/);
      expect(header.closest('[dir="ltr"]')).withContext('header date').toBeNull();
      expect(text('[data-testid="sla-meta"]')).toContain('آخر تغيير بواسطة Nora Al-Otaibi في 16 نوفمبر 2026');

      press('sla-history-open');
      const dates = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="sla-history"] [data-sla-changed-at]'));
      expect(dates.length).toBe(1);
      expect(dates[0]!.textContent?.trim()).toMatch(/^16 نوفمبر 2026/);
      for (const d of dates) expect(d.closest('[dir="ltr"]')).withContext('history date').toBeNull();
    });

    it('says when nothing has been changed yet', () => {
      setup({ history: [] });
      expect(text('[data-testid="sla-meta"]')).toBe('Nothing on this page has been changed yet.');
    });

    it('a failed history read says so with Retry, and the sections still work', () => {
      TestBed.configureTestingModule({
        imports: [TaskSlaSettingsComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          provideRouter([]),
          provideTranslateService({ lang: 'en' }),
          provideFormatTesting(),
          { provide: AmConfirmService, useValue: { ask: () => undefined } },
        ],
      });
      loadTranslationsForTest({ en, ar });
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(TaskSlaSettingsComponent);
      fixture.detectChanges();
      http.expectOne(`${base}/policy`).flush(POLICY);
      http.expectOne(isHistory(0)).flush('down', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(text('[data-testid="sla-meta"]')).toContain("The change history couldn't be loaded.");
      expect(el().querySelector('[data-sla-limit="HIGH"] input')).not.toBeNull();
    });
  });

  describe('Time limits', () => {
    it('shows the four limits, Medium marked as the default on new tasks', () => {
      setup();
      expect((el().querySelector('#sla-limit-HIGH') as HTMLInputElement).value).toBe('16');
      expect(text('[data-sla-limit="MEDIUM"]')).toContain('the default on new tasks');
    });

    it('a clean section has no footer; an edit shows Unsaved and the footer; Discard restores', () => {
      const c = setup();
      expect(el().querySelector('[data-testid="sla-limits-footer"]')).toBeNull();
      expect(el().querySelector('[data-testid="sla-limits-unsaved"]')).toBeNull();
      setLimit(c, 'HIGH', 12);
      expect(text('[data-testid="sla-limits-unsaved"]')).toBe('Unsaved');
      expect(el().querySelector('[data-testid="sla-limits-footer"]')).not.toBeNull();
      press('sla-limits-discard');
      expect(c.limitsForm.controls.HIGH.value).toBe(16);
      expect(el().querySelector('[data-testid="sla-limits-footer"]')).toBeNull();
    });

    it('saves through PATCH …/limits with the limits only, then re-reads the history', () => {
      const c = setup();
      setLimit(c, 'HIGH', 12);
      press('sla-limits-save');
      const req = http.expectOne(`${base}/limits`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ LOW: { dueAfterHours: 80 }, MEDIUM: { dueAfterHours: 40 }, HIGH: { dueAfterHours: 12 }, CRITICAL: { dueAfterHours: 4 } });
      req.flush({ ...SLA, HIGH: { ...SLA.HIGH, dueAfterHours: 12 } });
      fixture.detectChanges();
      http.expectOne(isHistory(0)).flush({ rows: [change({ id: 'c-2' })], total: 2 });
      fixture.detectChanges();
      expect(c.limitsDirty()).toBeFalse();
      expect(text('[data-testid="sla-limits-saved"]')).toBe('Changes saved.');
    });

    // PR 2 mutation: Save disabled on an invalid form.
    it('Save is never disabled: an invalid Save reveals the error, counts it, focuses it and sends nothing', () => {
      const c = setup();
      setLimit(c, 'CRITICAL', null);
      const save = el().querySelector<HTMLButtonElement>('[data-testid="sla-limits-save"] button')!;
      expect(save.disabled).toBeFalse();
      press('sla-limits-save');
      http.expectNone(`${base}/limits`);
      expect(text('[data-sla-limit="CRITICAL"]')).toContain('Enter the working hours.');
      expect(text('[data-testid="sla-limits-problems"]')).toBe('1 problem');
      expect(document.activeElement?.id).toBe('sla-limit-CRITICAL');
    });

    it('a generic failure keeps the values and says so in the section, never the server’s English', () => {
      const c = setup();
      setLimit(c, 'HIGH', 12);
      press('sla-limits-save');
      http.expectOne(`${base}/limits`).flush({ message: 'English for a log' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(c.limitsForm.controls.HIGH.value).toBe(12);
      expect(text('[data-testid="sla-limits-footer"]')).toContain("This couldn't be saved. The values entered are still here.");
      expect(el().textContent).not.toContain('English for a log');
    });
  });

  // ACC-208 — moved from the old screen's spec with the save: the stage-deadline
  // rule's refusal, under the priority it is about, from its code and numbers.
  describe('a stage-deadline refusal', () => {
    function refuseHigh(c: TaskSlaSettingsComponent, stages: unknown[]): void {
      setLimit(c, 'HIGH', 24);
      press('sla-limits-save');
      refuse(http.expectOne(`${base}/limits`), stages);
    }

    it('names the stage under the priority that breaks it, as a link to its row, with the way out', () => {
      const c = setup();
      refuseHigh(c, [CONFLICT]);
      const block = el().querySelector('[data-sla-conflicts="HIGH"]');
      expect(block).not.toBeNull();
      const parts = Array.from(block!.querySelectorAll(':scope > span, li')).map((n) => n.textContent?.trim());
      expect(parts).toEqual([
        'High would become 24 working hours, which passes the deadline of:',
        'Committee Management · Terms Review (16 working hours)',
        'Raise those deadlines first, or keep High at 16 working hours or less.',
      ]);
      expect(block!.querySelector('a')?.getAttribute('href')).toBe('/workflows/template-1/stages?stage=stage-terms');
      expect(el().querySelectorAll('[data-sla-conflicts]').length).toBe(1);
      expect(text('[data-testid="sla-limits-problems"]')).toBe('1 problem');
      expect(el().textContent).not.toContain('English for a log');
      expect(c.limitsError()).toBeNull();
    });

    it('lists every stage it would break, keeping the way out to the tightest deadline', () => {
      refuseHigh(setup(), [CONFLICT, { ...CONFLICT, stageId: 'stage-2', stageName: 'Formation', stageNameAr: null, stageHours: 8 }]);
      const block = el().querySelector('[data-sla-conflicts="HIGH"]')!;
      expect(block.querySelectorAll('li').length).toBe(2);
      expect(block.textContent).toContain('keep High at 8 working hours or less');
    });

    it('clears once the hours change', () => {
      const c = setup();
      refuseHigh(c, [CONFLICT]);
      setLimit(c, 'HIGH', 16);
      expect(el().querySelector('[data-sla-conflicts]')).toBeNull();
    });

    it('says it in Arabic, the stage by its Arabic name', () => {
      refuseHigh(setup({ language: 'ar' }), [CONFLICT]);
      const block = text('[data-sla-conflicts="HIGH"]');
      expect(block).toContain('ستصبح الأولوية «عالية» 24 ساعة عمل، وهذا يتجاوز مهلة:');
      expect(block).toContain('Committee Management · مراجعة الشروط (16 ساعة عمل)');
    });
  });

  describe('Reminders and escalation per priority', () => {
    it('lays out one row per priority, its Limit read from the SAVED limits, not an unsaved edit', () => {
      const c = setup();
      expect(el().querySelectorAll('[data-sla-row]').length).toBe(4);
      setLimit(c, 'HIGH', 12);
      const limit = el().querySelector('[data-sla-row="HIGH"] [data-testid="sla-matrix-limit"]')!.textContent?.trim();
      expect(limit).toBe('16 working hours');
    });

    it('saves through PATCH …/escalation with the escalation hours only, keeping a Time-limits edit', () => {
      const c = setup();
      setLimit(c, 'LOW', 70);
      c.escalationForm.controls.HIGH.controls.managerEscalationAfterHours.setValue(4);
      fixture.detectChanges();
      press('sla-escalation-save');
      const req = http.expectOne(`${base}/escalation`);
      expect(req.request.body).toEqual({
        LOW: { managerEscalationAfterHours: 48, headEscalationAfterHours: 96, warnBeforeDue: 'OFF' },
        MEDIUM: { managerEscalationAfterHours: 24, headEscalationAfterHours: 48, warnBeforeDue: 'H8' },
        HIGH: { managerEscalationAfterHours: 4, headEscalationAfterHours: 16, warnBeforeDue: 'H2' },
        CRITICAL: { managerEscalationAfterHours: 2, headEscalationAfterHours: 4, warnBeforeDue: 'OFF' },
      });
      req.flush({ ...SLA, HIGH: { ...SLA.HIGH, managerEscalationAfterHours: 4 } });
      fixture.detectChanges();
      http.expectOne(isHistory(0)).flush({ rows: [change()], total: 1 });
      fixture.detectChanges();
      expect(c.escalationDirty()).toBeFalse();
      expect(c.limitsForm.controls.LOW.value).toBe(70);
      expect(c.limitsDirty()).toBeTrue();
    });

    it('an invalid escalation Save reveals the errors, counts them and focuses the first', () => {
      const c = setup();
      c.escalationForm.controls.MEDIUM.controls.headEscalationAfterHours.setValue(null);
      c.escalationForm.controls.LOW.controls.managerEscalationAfterHours.setValue(null);
      fixture.detectChanges();
      press('sla-escalation-save');
      http.expectNone(`${base}/escalation`);
      expect(text('[data-testid="sla-escalation-problems"]')).toBe('2 problems');
      expect(document.activeElement?.id).toBe('sla-manager-LOW');
    });

    it('names each cell for a screen reader with its priority and column', async () => {
      setup();
      await fixture.whenStable();
      fixture.detectChanges();
      const label = el().querySelector('label[for="sla-head-CRITICAL"]');
      expect(label).withContext('the head cell’s label').not.toBeNull();
      expect(label!.textContent?.trim()).toContain('Critical · Head told after (working hours after the manager)');
    });
  });

  describe('the policy read', () => {
    it('reads GET …/policy, never the old whole-policy routes', () => {
      const c = setup();
      setLimit(c, 'HIGH', 12);
      press('sla-limits-save');
      http.expectNone((r) => r.url === base);
      http.expectOne(`${base}/limits`).flush(SLA);
      fixture.detectChanges();
      http.expectOne(isHistory(0)).flush({ rows: [], total: 0 });
    });

    it('lays the sections out in the plan’s order: Time limits, Notifications, the matrix, Reset', () => {
      setup();
      const order = Array.from(el().querySelectorAll('[data-sla-section]')).map((n) => n.getAttribute('data-sla-section'));
      expect(order).toEqual(['limits', 'notices', 'escalation', 'reset']);
    });

    it('the escalation headers count working hours', () => {
      setup();
      const head = text('.am-sla__row--head');
      expect(head).toContain('Warn before due');
      expect(head).toContain('Manager told after (working hours overdue)');
      expect(head).toContain('Head told after (working hours after the manager)');
    });
  });

  // ── Notifications: the due-date switch (PR 3) ───────────────────────────
  describe('the due-date switch', () => {
    const switchInput = () => el().querySelector<HTMLInputElement>('#sla-notify-due-change')!;
    const state = () => text('[data-testid="sla-notify-due-change-state"]');
    const pressSwitch = () => {
      (el().querySelector('[data-testid="sla-notify-due-change"] p-toggleswitch') as HTMLElement).click();
      fixture.detectChanges();
    };

    it('shows the stored value, with its help, and no Save', () => {
      setup();
      expect(state()).toBe('On');
      expect(text('[data-sla-section="notices"]')).toContain('Notify assignees when a due date changes');
      expect(text('[data-sla-section="notices"]')).toContain('A change of priority is still announced.');
      expect(el().querySelector('[data-sla-section="notices"] footer')).toBeNull();
    });

    // 3-fe mutation: the switch's request.
    it('a press sends PATCH …/notices with the new value at once, then reads the history again', () => {
      setup();
      pressSwitch();
      const req = http.expectOne(`${base}/notices`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ notifyOnDueChange: false });
      expect(state()).withContext('pending shows the new value').toBe('Off');
      expect(switchInput().disabled).withContext('no second press while it runs').toBeTrue();
      req.flush({ ...NOTICES, notifyOnDueChange: false });
      fixture.detectChanges();
      http.expectOne(isHistory(0)).flush({ rows: [], total: 0 });
      fixture.detectChanges();
      expect(state()).toBe('Off');
    });

    it('a refused press leaves the switch where it was, with a line under it', () => {
      setup();
      pressSwitch();
      http.expectOne(`${base}/notices`).flush({ message: 'English for a log' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(state()).toBe('On');
      expect(text('[data-testid="sla-notices-error"]')).toBe("This couldn't be changed. The setting is as it was.");
      expect(el().textContent).not.toContain('English for a log');
    });

    it('a matrix edit in progress keeps its baseline when the switch is saved', () => {
      const c = setup();
      c.escalationForm.controls.LOW.controls.warnBeforeDue.setValue('H2');
      fixture.detectChanges();
      pressSwitch();
      http.expectOne(`${base}/notices`).flush({ ...NOTICES, notifyOnDueChange: false });
      fixture.detectChanges();
      http.expectOne(isHistory(0)).flush({ rows: [], total: 0 });
      expect(c.escalationDirty()).toBeTrue();
    });

    it('says it in Arabic', () => {
      setup({ language: 'ar' });
      expect(text('[data-sla-section="notices"]')).toContain('إشعار المكلَّفين عند تغيّر موعد الاستحقاق');
      expect(state()).toBe('مُفعّل');
    });
  });

  // ── Reset (PR 3) ───────────────────────────────────────────────────────
  describe('Reset', () => {
    // 3-fe mutation: Reset's confirm.
    it('asks first, through the confirm, and sends nothing until it is accepted', () => {
      setup();
      press('sla-reset-open');
      expect(asked.length).toBe(1);
      expect(asked[0]!.tone).toBe('destructive');
      expect(asked[0]!.header).toBe('Reset to defaults?');
      expect(asked[0]!.message).toContain('open tasks keep the limits they were created with');
      expect(asked[0]!.acceptLabel).toBe('Reset to defaults');
      // CC-324 — the four effects as detail lines, and still no numbers.
      expect(asked[0]!.details).toEqual([
        'Time limits: back to the defaults',
        'Escalation hours: back to the defaults',
        'Reminders before due: all off',
        'Due-date change notices: on',
      ]);
      expect(asked[0]!.details!.join(' ') + asked[0]!.message).not.toMatch(/[0-9]/);
      http.expectNone(`${base}/reset`);
      asked[0]!.reject?.();
      http.expectNone(`${base}/reset`);
    });

    it('accepted, it POSTs …/reset, takes the defaults into every section, and reads the history again', () => {
      const c = setup();
      setLimit(c, 'HIGH', 12);
      press('sla-reset-open');
      asked[0]!.accept();
      const req = http.expectOne(`${base}/reset`);
      expect(req.request.method).toBe('POST');
      req.flush(DEFAULTS);
      fixture.detectChanges();
      http.expectOne(isHistory(0)).flush({ rows: [], total: 0 });
      fixture.detectChanges();
      expect(c.limitsForm.controls.HIGH.value).toBe(16);
      expect(c.escalationForm.controls.HIGH.controls.warnBeforeDue.value).toBe('OFF');
      expect(c.limitsDirty()).toBeFalse();
      expect(c.escalationDirty()).toBeFalse();
      expect(text('[data-testid="sla-reset-done"]')).toBe('The policy is back to the defaults.');
    });

    // 3-fe mutation: the Reset refusal's placement.
    it('a stage-deadline refusal names the stages from the refusal’s own data, in the Reset section, and changes nothing', () => {
      const c = setup();
      press('sla-reset-open');
      asked[0]!.accept();
      refuse(http.expectOne(`${base}/reset`), [CONFLICT]);
      const block = el().querySelector('[data-sla-section="reset"] [data-testid="sla-reset-conflicts"]');
      expect(block).not.toBeNull();
      expect(block!.textContent).toContain('Nothing was reset. The default limits would pass the deadline of:');
      expect(block!.querySelector('a')?.textContent?.trim()).toBe('Committee Management · Terms Review (16 working hours)');
      expect(block!.querySelector('a')?.getAttribute('href')).toBe('/workflows/template-1/stages?stage=stage-terms');
      expect(block!.textContent).toContain('Raise those stage deadlines first, then reset again.');
      expect(el().querySelector('[data-sla-conflicts]')).withContext('not under Time limits').toBeNull();
      expect(c.escalationForm.controls.HIGH.controls.warnBeforeDue.value).toBe('H2');
      expect(el().textContent).not.toContain('English for a log');
    });

    it('says the refusal in Arabic, the stage by its Arabic name', () => {
      setup({ language: 'ar' });
      press('sla-reset-open');
      asked[0]!.accept();
      refuse(http.expectOne(`${base}/reset`), [CONFLICT]);
      const block = text('[data-testid="sla-reset-conflicts"]');
      expect(block).toContain('لم يُعَد ضبط شيء.');
      expect(block).toContain('Committee Management · مراجعة الشروط (16 ساعة عمل)');
    });
  });

  // ── Warn before due (PR 4) ─────────────────────────────────────────────
  describe('warn before due', () => {
    it('each row’s select holds its stored warning', () => {
      const c = setup();
      expect(c.escalationForm.controls.HIGH.controls.warnBeforeDue.value).toBe('H2');
      expect(c.escalationForm.controls.MEDIUM.controls.warnBeforeDue.value).toBe('H8');
      expect(el().querySelectorAll('[data-sla-warn] app-overlay-select').length).toBe(4);
    });

    it('options at or past the priority’s SAVED limit are shown greyed with their reason', () => {
      const c = setup();
      const critical = c.warnOptions().CRITICAL; // limit 4
      expect(critical.map((o) => [o.value, o.unavailable])).toEqual([
        ['OFF', false],
        ['H1', false],
        ['H2', false],
        ['H4', true],
        ['H8', true],
        ['WORKING_DAY', true],
      ]);
      expect(critical[3]!.reason).toBe('Not shorter than the limit of 4 working hours');
      expect(critical.map((o) => o.label)).toEqual(['Off', '1 working hour', '2 working hours', '4 working hours', '8 working hours', '1 working day']);
    });

    it('"1 working day" is the calendar’s working day, from the policy read', () => {
      const c = setup({ policy: { ...POLICY, workingHoursPerDay: 16 } });
      expect(c.warnOptions().HIGH.find((o) => o.value === 'WORKING_DAY')!.unavailable).toBeTrue(); // 16 is not < 16
      expect(c.warnOptions().LOW.find((o) => o.value === 'WORKING_DAY')!.unavailable).toBeFalse();
    });

    it('a warning change alone makes the matrix unsaved, and its Save sends it', () => {
      const c = setup();
      c.escalationForm.controls.LOW.controls.warnBeforeDue.setValue('WORKING_DAY');
      fixture.detectChanges();
      expect(text('[data-testid="sla-escalation-unsaved"]')).toBe('Unsaved');
      press('sla-escalation-save');
      const req = http.expectOne(`${base}/escalation`);
      expect((req.request.body as Record<string, { warnBeforeDue: string }>)['LOW']!.warnBeforeDue).toBe('WORKING_DAY');
      req.flush(SLA);
      fixture.detectChanges();
      http.expectOne(isHistory(0)).flush({ rows: [], total: 0 });
      fixture.detectChanges();
      expect(c.escalationDirty()).toBeFalse();
    });

    it('a warning not shorter than its limit is an error on Save: counted, focused, nothing sent', () => {
      const c = setup();
      c.escalationForm.controls.CRITICAL.controls.warnBeforeDue.setValue('H8');
      fixture.detectChanges();
      press('sla-escalation-save');
      http.expectNone(`${base}/escalation`);
      expect(text('[data-testid="sla-escalation-problems"]')).toBe('1 problem');
      expect(text('[data-sla-warn="CRITICAL"]')).toContain("Choose a warning shorter than this priority's limit.");
      expect(document.activeElement?.classList.contains('am-overlay-select-trigger')).toBeTrue();
      expect(document.activeElement?.closest('[data-sla-warn]')?.getAttribute('data-sla-warn')).toBe('CRITICAL');
    });

    // 3-fe mutation: the warning refusal's placement.
    it('the server’s TASK_SLA_WARNING_NOT_BEFORE_DUE is said from its code under the row it names', () => {
      const c = setup();
      c.escalationForm.controls.LOW.controls.managerEscalationAfterHours.setValue(40);
      fixture.detectChanges();
      press('sla-escalation-save');
      refuseWarning(http.expectOne(`${base}/escalation`), 'TASK_SLA_WARNING_NOT_BEFORE_DUE', { priority: 'HIGH', warning: 'H8', limitHours: 8 });
      const block = el().querySelector('[data-sla-warn-refusal="HIGH"]');
      expect(block).not.toBeNull();
      expect(Array.from(block!.querySelectorAll('span')).map((n) => n.textContent?.trim())).toEqual([
        'High: the warning, 8 working hours, must be shorter than the limit, 8 working hours.',
        'Choose a shorter warning, or first raise the limit under Time limits.',
      ]);
      expect(el().querySelectorAll('[data-sla-warn-refusal]').length).toBe(1);
      expect(text('[data-testid="sla-escalation-problems"]')).toBe('1 problem');
      expect(el().textContent).not.toContain('English for a log');
      expect(c.escalationError()).toBeNull();
    });

    // CC-324 2a — the refused select is marked, and tied to its message.
    it('a refused warning marks its select: the error border, aria-invalid, and aria-describedby naming the message', () => {
      const c = setup();
      c.escalationForm.controls.HIGH.controls.warnBeforeDue.setValue('H8');
      fixture.detectChanges();
      press('sla-escalation-save');
      refuseWarning(http.expectOne(`${base}/escalation`), 'TASK_SLA_WARNING_NOT_BEFORE_DUE', { priority: 'HIGH', warning: 'H8', limitHours: 8 });
      const trigger = el().querySelector<HTMLElement>('[data-sla-warn="HIGH"] .am-overlay-select-trigger');
      expect(trigger).withContext('the HIGH warning select').not.toBeNull();
      expect(trigger!.getAttribute('aria-invalid')).toBe('true');
      expect(trigger!.classList).toContain('am-overlay-select-trigger-invalid');
      expect(trigger!.getAttribute('aria-describedby')).toBe('sla-warn-refusal-HIGH');
      // The error border shows even while the select has focus, where the refusal
      // puts it. The trigger's colour transition is held off so the colour read
      // is the one it ends on, not the start of a 150ms fade.
      trigger!.style.transition = 'none';
      trigger!.focus();
      const danger = document.createElement('span');
      danger.style.color = 'var(--am-danger-ink)';
      document.body.appendChild(danger);
      const dangerColour = getComputedStyle(danger).color;
      danger.remove();
      expect(document.activeElement).toBe(trigger);
      expect(getComputedStyle(trigger!).borderTopColor).toBe(dangerColour);
      expect(el().querySelector('#sla-warn-refusal-HIGH')?.textContent).toContain('High: the warning, 8 working hours');
      // Only the refused priority is marked.
      for (const p of ['LOW', 'MEDIUM', 'CRITICAL']) {
        const other = el().querySelector(`[data-sla-warn="${p}"] .am-overlay-select-trigger`)!;
        expect(other.getAttribute('aria-invalid')).withContext(p).toBeNull();
        expect(other.getAttribute('aria-describedby')).withContext(p).toBeNull();
      }
    });

    // CC-324 2b — a refused field keeps the value that was refused.
    it('a refused warning keeps the value that was refused, on the select and in the form', () => {
      const c = setup();
      c.escalationForm.controls.HIGH.controls.warnBeforeDue.setValue('H8');
      fixture.detectChanges();
      press('sla-escalation-save');
      refuseWarning(http.expectOne(`${base}/escalation`), 'TASK_SLA_WARNING_NOT_BEFORE_DUE', { priority: 'HIGH', warning: 'H8', limitHours: 8 });
      expect(c.escalationForm.controls.HIGH.controls.warnBeforeDue.value).toBe('H8');
      expect(text('[data-sla-warn="HIGH"] .am-overlay-select-trigger')).toContain('8 working hours');
      expect(c.escalationDirty()).toBeTrue();
    });

    // 3-fe mutation: the limit refusal's placement.
    it('the server’s TASK_SLA_LIMIT_NOT_AFTER_WARNING is said from its code under that priority’s limit', () => {
      const c = setup();
      setLimit(c, 'HIGH', 2);
      press('sla-limits-save');
      refuseWarning(http.expectOne(`${base}/limits`), 'TASK_SLA_LIMIT_NOT_AFTER_WARNING', { priority: 'HIGH', warning: 'H2', limitHours: 2 });
      const block = el().querySelector('[data-sla-section="limits"] [data-sla-limit-warning="HIGH"]');
      expect(block).not.toBeNull();
      expect(block!.textContent).toContain('High: the warning, 2 working hours, must be shorter than the limit, 2 working hours.');
      expect(block!.textContent).toContain('Keep the limit longer than the warning');
      expect(text('[data-testid="sla-limits-problems"]')).toBe('1 problem');
      expect(document.activeElement?.id).toBe('sla-limit-HIGH');
      setLimit(c, 'HIGH', 3);
      expect(el().querySelector('[data-sla-limit-warning]')).withContext('cleared once the hours change').toBeNull();
    });

    it('says both refusals in Arabic, without an imperative', () => {
      const c = setup({ language: 'ar' });
      setLimit(c, 'HIGH', 2);
      press('sla-limits-save');
      refuseWarning(http.expectOne(`${base}/limits`), 'TASK_SLA_LIMIT_NOT_AFTER_WARNING', { priority: 'HIGH', warning: 'H2', limitHours: 2 });
      const block = text('[data-sla-limit-warning="HIGH"]');
      expect(block).toContain('عالية: يلزم أن يكون التذكير، ساعتا عمل، أقصر من الحد، ساعتا عمل.');
      expect(block).toContain('يلزم إبقاء الحد أطول من التذكير');
    });
  });

  describe('a failed policy read', () => {
    it('keeps each section’s frame with Retry, which reads again', () => {
      TestBed.configureTestingModule({
        imports: [TaskSlaSettingsComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          provideRouter([]),
          provideTranslateService({ lang: 'en' }),
          provideFormatTesting(),
          { provide: AmConfirmService, useValue: { ask: () => undefined } },
        ],
      });
      loadTranslationsForTest({ en, ar });
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(TaskSlaSettingsComponent);
      fixture.detectChanges();
      http.expectOne(`${base}/policy`).flush('down', { status: 503, statusText: 'Unavailable' });
      http.expectOne(isHistory(0)).flush({ rows: [], total: 0 });
      fixture.detectChanges();
      const frames = el().querySelectorAll('[data-sla-section] [role="alert"]');
      expect(frames.length).withContext('Time limits, Notifications and the matrix').toBe(3);
      expect(frames[0]!.textContent).toContain("The task SLA policy couldn't be loaded.");
      expect((el().querySelector('[data-testid="sla-reset-open"] button') as HTMLButtonElement).disabled).withContext('no reset before a read').toBeTrue();
      (frames[0]!.querySelector('button') as HTMLButtonElement).click();
      http.expectOne(`${base}/policy`).flush(POLICY);
      fixture.detectChanges();
      expect(el().querySelector('#sla-limit-LOW')).not.toBeNull();
    });
  });

  describe('leaving with unsaved work', () => {
    it('leaves at once when nothing is unsaved', () => {
      expect(setup().canLeave()).toBeTrue();
    });

    it('asks once, naming every unsaved section', async () => {
      const c = setup();
      setLimit(c, 'HIGH', 12);
      c.escalationForm.controls.LOW.controls.headEscalationAfterHours.setValue(90);
      const answer = c.canLeave() as Promise<boolean>;
      expect(asked.length).toBe(1);
      expect(asked[0]!.message).toBe('Unsaved changes in Time limits, Reminders and escalation per priority will be lost.');
      asked[0]!.reject!();
      expect(await answer).toBeFalse();
    });

    // 3-fe mutation: the leave guard over the new field.
    it('a warning change alone is unsaved work the guard asks about', async () => {
      const c = setup();
      c.escalationForm.controls.CRITICAL.controls.warnBeforeDue.setValue('H1');
      const answer = c.canLeave() as Promise<boolean>;
      expect(asked.length).toBe(1);
      expect(asked[0]!.message).toBe('Unsaved changes in Reminders and escalation per priority will be lost.');
      asked[0]!.accept();
      expect(await answer).toBeTrue();
    });
  });

  // CC-324 6, 7, 9 — the words, read from the translation files themselves.
  describe('the words (CC-324)', () => {
    // The page renders too, so the file's afterEach has its HTTP controller.
    beforeEach(() => setup());
    const t =(file: unknown, path: string): string => {
      const value = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], file);
      if (typeof value !== 'string') throw new Error(`no translation for ${path}`);
      return value;
    };

    it('Off is «متوقف» in the switch and the warning option, and On is written as the product writes it', () => {
      expect(t(ar, 'common.off')).toBe('متوقف');
      expect(t(ar, 'adminSettings.taskSlaPage.warn.off')).toBe('متوقف');
      expect(t(ar, 'common.on')).toBe(t(ar, 'workflow.actionsDialog.on'));
      // No other spelling anywhere in the page's own keys.
      const page = JSON.stringify((ar as Record<string, Record<string, unknown>>)['adminSettings']!['taskSlaPage']);
      expect(page).not.toContain('إيقاف');
      expect(page).not.toContain('مُفعَّل');
    });

    it('the reset has one name: section, button, confirm and history', () => {
      const R = 'adminSettings.taskSlaPage.reset';
      expect([t(en, `${R}.title`), t(en, `${R}.open`), t(en, `${R}.confirmHeader`), t(en, `${R}.confirmAccept`), t(en, 'adminSettings.taskSlaPage.history.kindReset')]).toEqual([
        'Reset to defaults',
        'Reset to defaults…',
        'Reset to defaults?',
        'Reset to defaults',
        'Reset to defaults',
      ]);
      const name = 'إعادة الضبط إلى القيم الافتراضية';
      expect([t(ar, `${R}.title`), t(ar, `${R}.open`), t(ar, `${R}.confirmHeader`), t(ar, `${R}.confirmAccept`), t(ar, 'adminSettings.taskSlaPage.history.kindReset')]).toEqual([
        name,
        `${name}…`,
        `${name}؟`,
        name,
        name,
      ]);
      // A two-sentence message.
      for (const file of [en, ar]) expect(t(file, `${R}.confirmBody`).split(/[.؟]\s/).length).toBe(2);
    });

    it('the switch hint says where and for whom; the section line already says when', () => {
      expect(t(en, 'adminSettings.taskSlaPage.notices.dueChangeHelp')).toBe('In the app, for every task. A change of priority is still announced.');
      expect(t(ar, 'adminSettings.taskSlaPage.notices.dueChangeHelp')).toBe('داخل التطبيق، لكل المهام. يبقى تغيير الأولوية مُعلَنًا.');
    });
  });

  describe('the change history', () => {
    const open = () => {
      press('sla-history-open');
    };

    it('lists each save with what moved, old and new, and a legacy save without values', () => {
      setup({
        history: [
          change(),
          change({ id: 'c-0', kind: 'legacy', before: null, after: null, actorName: null }),
        ],
      });
      open();
      const entries = Array.from(document.querySelectorAll('[data-change-kind]'));
      expect(entries.map((e) => e.getAttribute('data-change-kind'))).toEqual(['limits', 'legacy']);
      const first = entries[0]!.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(first).toContain('High · Due after');
      expect(first).toContain('was16 working hours');
      expect(first).toContain('now12 working hours');
      expect(first).not.toContain('Low');
      expect(entries[1]!.textContent).toContain('Saved; the values were not recorded for this change.');
      expect(entries[1]!.textContent).toContain('not recorded');
    });

    it('Load more asks the next 20 and appends them; a failure keeps the rows and offers Retry', () => {
      const rows = Array.from({ length: 20 }, (_, i) => change({ id: `c-${i}` }));
      setup({ history: rows, total: 21 });
      open();
      (document.querySelector('[data-testid="sla-history-more"] button') as HTMLButtonElement).click();
      http.expectOne(isHistory(20)).flush('down', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(document.querySelectorAll('[data-change-kind]').length).toBe(20);
      const retry = document.querySelector('[data-testid="sla-history"] [role="alert"] button') as HTMLButtonElement;
      retry.click();
      http.expectOne(isHistory(20)).flush({ rows: [change({ id: 'c-20', kind: 'escalation', before: { LOW: { managerEscalationAfterHours: 48 } }, after: { LOW: { managerEscalationAfterHours: 40 } } })], total: 21 });
      fixture.detectChanges();
      expect(document.querySelectorAll('[data-change-kind]').length).toBe(21);
      expect(document.querySelector('[data-testid="sla-history-more"]')).toBeNull();
      // Saved without warnings: before escalation counted working hours (CC-325).
      expect(document.querySelector('[data-change-kind="escalation"]')!.textContent).toContain('40 clock hours');
    });

    it('names the switch and a reset, and a warning by its option', () => {
      setup({
        history: [
          change({ id: 'r', kind: 'reset', before: { tiers: { ...SLA, HIGH: { ...SLA.HIGH, dueAfterHours: 12 } }, notices: NOTICES }, after: DEFAULTS }),
          change({ id: 'n', kind: 'notices', before: { notifyOnDueChange: true }, after: { notifyOnDueChange: false } }),
          change({ id: 'w', kind: 'escalation', before: { HIGH: { warnBeforeDue: 'OFF' } }, after: { HIGH: { warnBeforeDue: 'H2' } } }),
        ],
      });
      open();
      const entry = (kind: string) => (document.querySelector(`[data-change-kind="${kind}"]`)!.textContent ?? '').replace(/\s+/g, ' ');
      expect(entry('reset')).toContain('Reset to defaults');
      expect(entry('reset')).toContain('High · Due after');
      expect(entry('reset')).toContain('was12 working hours');
      expect(entry('reset')).toContain('High · Warn before due');
      expect(entry('notices')).toContain('Notifications');
      expect(entry('notices')).toContain('Due-date change notices');
      expect(entry('notices')).toContain('wasOn');
      expect(entry('notices')).toContain('nowOff');
      expect(entry('escalation')).toContain('wasOff');
      expect(entry('escalation')).toContain('now2 working hours');
    });

    // CC-325 — each row in the unit it was saved in: clock hours before
    // escalation counted working hours, working hours after (a save that
    // carries warnBeforeDue). Counted strings, both languages.
    const OLD_ROW = change({
      id: 'old',
      kind: 'escalation',
      before: { HIGH: { managerEscalationAfterHours: 8, headEscalationAfterHours: 16 } },
      after: { HIGH: { managerEscalationAfterHours: 6, headEscalationAfterHours: 16 } },
    });
    const NEW_ROW = change({
      id: 'new',
      kind: 'escalation',
      before: { HIGH: { managerEscalationAfterHours: 8, headEscalationAfterHours: 16, warnBeforeDue: 'OFF' } },
      after: { HIGH: { managerEscalationAfterHours: 6, headEscalationAfterHours: 16, warnBeforeDue: 'OFF' } },
    });
    for (const [language, clock, working] of [
      ['en', ['was8 clock hours', 'now6 clock hours'], ['was8 working hours', 'now6 working hours']],
      ['ar', ['كانت8 ساعات فعلية', 'أصبحت6 ساعات فعلية'], ['كانت8 ساعات عمل', 'أصبحت6 ساعات عمل']],
    ] as const) {
      it(`${language}: an old row reads clock hours and a new row working hours, side by side`, () => {
        setup({ language, history: [NEW_ROW, OLD_ROW] });
        open();
        const entries = Array.from(document.querySelectorAll('[data-change-kind="escalation"]')).map((e) => (e.textContent ?? '').replace(/\s+/g, ' '));
        expect(entries.length).toBe(2);
        for (const w of working) expect(entries[0]).toContain(w);
        for (const w of clock) expect(entries[1]).toContain(w);
        expect(entries[0]).not.toContain(language === 'en' ? 'clock' : 'فعلية');
        expect(entries[1]).not.toContain(language === 'en' ? 'working' : 'عمل');
      });
    }

    // CC-324 10b / 10c — date · name · section, and a missing name said as one.
    it('names each save as date · name · section, and a missing name as "Name not recorded"', () => {
      setup({ history: [change({ actorName: null })] });
      open();
      const meta = (document.querySelector('[data-sla-change-meta]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      expect(meta).toBe('16 Nov 2026, 12:00 · Name not recorded · Time limits');
    });

    it('in Arabic, a missing name is «الاسم غير مسجّل»', () => {
      setup({ language: 'ar', history: [change({ actorName: null })] });
      open();
      const meta = (document.querySelector('[data-sla-change-meta]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      expect(meta).toContain(' · الاسم غير مسجّل · ');
    });

    // CC-324 5 — old value muted, no strikethrough; new value in the medium weight.
    it('draws the old value muted with no strikethrough, the new one in the medium weight', () => {
      setup();
      open();
      const from = document.querySelector<HTMLElement>('.am-slah__from');
      const to = document.querySelector<HTMLElement>('.am-slah__to');
      expect(from).withContext('an old value').not.toBeNull();
      expect(to).withContext('a new value').not.toBeNull();
      const probe = (token: string) => {
        const p = document.createElement('span');
        p.style.color = `var(${token})`;
        document.body.appendChild(p);
        const color = getComputedStyle(p).color;
        p.remove();
        return color;
      };
      // Non-vacuity: the two tokens resolve to different colours here.
      expect(probe('--am-ink-500')).not.toBe(probe('--am-ink-900'));
      expect(getComputedStyle(from!).textDecorationLine).toBe('none');
      expect(getComputedStyle(from!).color).toBe(probe('--am-ink-500'));
      expect(getComputedStyle(to!).fontWeight).toBe('500');
      expect(getComputedStyle(to!).textDecorationLine).toBe('none');
    });
  });
});
