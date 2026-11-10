import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import { WorkflowTemplateDto, WorkflowStageDto, WorkflowTransitionDto } from '../../services/workflow-template.service';
import { WorkflowActionConfiguratorComponent } from '../workflow-action-configurator/workflow-action-configurator.component';
import { TransitionPanelComponent } from './transition-panel.component';

// ACC-271 PR 5b — a transition in a page panel (drawing sections 9 and 10):
// what it shows, what a save sends (never a trigger, role, person, permission
// or validator), the two read-only cases, and keyboard and focus.

const API = environment.apiUrl;
const TRANSITIONS_URL = `${API}/workflow-templates/transitions`;

const stage = (id: string, nameEn: string, nameAr: string, order: number, transitions: WorkflowTransitionDto[] = []): WorkflowStageDto =>
  ({ id, workflowTemplateId: 'tpl-1', nameEn, nameAr, order, transitions }) as unknown as WorkflowStageDto;

const PERSON: WorkflowTransitionDto = {
  id: 't1',
  fromStageId: 's1',
  toStageId: 's2',
  labelEn: 'Send to Legal review',
  labelAr: 'إرسال إلى المراجعة القانونية',
  // Stored values a save must leave alone: the panel never sends them.
  validatorConfig: { minimumAttachments: 1 },
  isApprovalPath: false,
  kind: 'ADVANCE',
  mover: 'PERSON',
  actions: [
    { id: 'a1', workflowTransitionId: 't1', actionType: 'LOG_AUDIT', order: 20, isEnabled: true, configJson: null },
    { id: 'a2', workflowTransitionId: 't1', actionType: 'SEND_NOTIFICATION', order: 10, isEnabled: false, configJson: null },
  ],
};

const APP_MOVE: WorkflowTransitionDto = {
  ...PERSON,
  id: 't-app',
  labelEn: 'Approve and apply',
  labelAr: 'اعتماد وتطبيق',
  mover: 'APP',
  appMove: { key: 'cr.approve', en: "Runs when the change request is approved on the committee's Changes tab.", ar: 'تُنفَّذ عند اعتماد طلب التغيير من تبويب «التغييرات» في سجل اللجنة.' },
};

const TEMPLATE: WorkflowTemplateDto = {
  id: 'tpl-1',
  organizationId: 'org-a',
  nameEn: 'Policy review',
  nameAr: 'مراجعة السياسات',
  objectType: 'DOCUMENT',
  isDefault: true,
  isActive: true,
  isProtected: false,
  createdAt: '',
  updatedAt: '',
  stages: [stage('s1', 'Under review', 'قيد المراجعة', 10, [PERSON]), stage('s2', 'Legal review', 'المراجعة القانونية', 20), stage('s3', 'Approved', 'معتمد', 30)],
};

describe('am-transition-panel — a transition in a page panel (ACC-271 PR 5b)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<TransitionPanelComponent>;
  let http: HttpTestingController;
  let ask: jasmine.Spy;

  async function setup(opts: { transition?: WorkflowTransitionDto | null; template?: WorkflowTemplateDto; lang?: 'en' | 'ar' } = {}): Promise<TransitionPanelComponent> {
    const lang = opts.lang ?? 'en';
    ask = jasmine.createSpy('ask');
    TestBed.configureTestingModule({
      imports: [TransitionPanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: AmConfirmService, useValue: { ask } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TransitionPanelComponent);
    fixture.componentRef.setInput('template', opts.template ?? TEMPLATE);
    fixture.componentRef.setInput('transition', opts.transition === undefined ? PERSON : opts.transition);
    fixture.componentRef.setInput('fromStageId', 's1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.p-dialog, .p-dialog-mask, .cdk-overlay-container').forEach((n) => n.remove());
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null => el().querySelector<T>(sel);
  const text = (node: Element | null | undefined): string => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  function type(id: string, value: string): void {
    const input = q<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Picks an option of an overlay select inside the panel, with the mouse. */
  async function choose(selector: string, label: string): Promise<void> {
    q(`${selector} .am-overlay-select-trigger`)!.click();
    fixture.detectChanges();
    const option = Array.from(document.querySelectorAll<HTMLElement>('.am-overlay-select-panel [role="option"]')).find((o) => text(o) === label);
    expect(option).withContext(`option ${label}`).toBeDefined();
    option!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function save(): TestRequest {
    const button = q<HTMLButtonElement>('[data-panel-save] button')!;
    expect(button.disabled).withContext('Save is never disabled').toBeFalse();
    button.click();
    fixture.detectChanges();
    return http.expectOne((r) => r.url.startsWith(TRANSITIONS_URL));
  }

  // ── What it shows ─────────────────────────────────────────────────────────

  it('a person’s move: names, From and To read-only, Kind with its help (no Approval path, ACC-284), and the template · from → to line', async () => {
    await setup();
    expect(text(q('[data-panel-heading]'))).toBe('Send to Legal review');
    expect(text(q('[data-panel-context]'))).toBe('Policy review · Under review → Legal review');
    expect(q<HTMLInputElement>('#tp-labelEn')!.value).toBe('Send to Legal review');
    expect(q<HTMLInputElement>('#tp-labelAr')!.value).toBe('إرسال إلى المراجعة القانونية');
    expect(text(q('[data-panel-heading]')?.closest('section'))).toContain('From Under review');
    expect(text(q('[data-panel-heading]')?.closest('section'))).toContain('To Legal review');
    expect(q('[data-to-select]')).withContext('To is read-only once the move exists').toBeNull();
    expect(text(q('[data-kind-select]'))).toContain('Advance');
    expect(text(el())).toContain('Moves the record on.');
    // ACC-284 — no "approval path" box: Kind says whether a press is a vote.
    expect(q('#tp-isApprovalPath')).toBeNull();
    expect(text(el())).not.toContain('approval path');
  });

  it('nothing about who may press it beyond the stage: no trigger, role, permission or validator', async () => {
    await setup();
    const all = text(el());
    for (const gone of ['Who Can Trigger', 'Required Permission', 'committees:manage', 'Validation Rules', 'minimumAttachments', 'Role-Based']) {
      expect(all).not.toContain(gone);
    }
  });

  it('How it moves: A person, pressed by whoever works the from-stage, the stage a link to its panel', async () => {
    await setup();
    const opened: string[] = [];
    fixture.componentInstance.openStage.subscribe((id) => opened.push(id));
    expect(text(q('[data-mover]'))).toBe('A person');
    expect(text(q('[data-pressed-by]'))).toBe('Pressed by whoever works Under review.');
    const link = q<HTMLAnchorElement>('[data-stage-link]')!;
    expect(link.getAttribute('href')).toBe('?stage=s1');
    link.click();
    expect(opened).toEqual(['s1']);
  });

  it('reads in Arabic: the sentence, the arrow and the names', async () => {
    await setup({ lang: 'ar' });
    expect(text(q('[data-panel-heading]'))).toBe('إرسال إلى المراجعة القانونية');
    expect(text(q('[data-panel-context]'))).toBe('مراجعة السياسات · قيد المراجعة ← المراجعة القانونية');
    expect(text(q('[data-mover]'))).toBe('شخص');
    expect(text(q('[data-pressed-by]'))).toBe('يضغطه من يعمل على مرحلة «قيد المراجعة».');
  });

  it('names its automatic actions in run order, an off one said so', async () => {
    await setup();
    expect(text(q('[data-actions-summary]'))).toBe('Send notification (off) · Log to the audit trail');
  });

  // ── What a save sends ─────────────────────────────────────────────────────

  it('Add sends the names, both stages and Kind — and none of the removed fields (ACC-284: nor Approval path)', async () => {
    const p = await setup({ transition: null });
    expect(text(q('[data-panel-heading]'))).toBe('Add Transition');
    expect(text(q('[data-panel-context]'))).toBe('Policy review · from Under review');
    expect(q('[data-panel-remove]')).toBeNull();
    expect(text(q('[data-actions-adding]'))).toBe('Automatic actions can be set once the transition is added.');
    type('tp-labelEn', 'Escalate');
    await choose('[data-to-select]', 'Approved');
    await choose('[data-kind-select]', 'Send back');

    const req = save();
    expect(req.request.method).toBe('POST');
    // ACC-284 — Approval path is not sent: the engine decides by Kind.
    expect(req.request.body).toEqual({ labelEn: 'Escalate', labelAr: '', kind: 'RETURN', fromStageId: 's1', toStageId: 's3' });
    const saved = jasmine.createSpy('saved');
    p.saved.subscribe(saved);
    req.flush({ transition: { ...PERSON, id: 't-new' } });
    expect(saved).toHaveBeenCalledWith(jasmine.objectContaining({ id: 't-new' }));
  });

  // ACC-284 — nor Approval path: the stored value stays, unread, until it is dropped.
  it('Edit sends the names and Kind only, so stored trigger, permission, validator and approval path stay', async () => {
    await setup();
    type('tp-labelEn', 'Send for legal review');
    const req = save();
    expect(req.request.method).toBe('PATCH');
    expect(req.request.url).toBe(`${TRANSITIONS_URL}/t1`);
    expect(Object.keys(req.request.body).sort()).toEqual(['kind', 'labelAr', 'labelEn']);
    expect(req.request.body.labelEn).toBe('Send for legal review');
    req.flush({ transition: { ...PERSON, labelEn: 'Send for legal review' } });
    fixture.detectChanges();
    expect(text(q('[data-change-count]'))).toBe('Transition saved');
  });

  // The saved line used to vanish a second after a save: the save reloads the
  // template, the panel refills its form, and the refill read as an edit.
  it('the saved line outlives the reload that follows a save, and goes on the next change', async () => {
    await setup();
    type('tp-labelEn', 'Send for legal review');
    save().flush({ transition: { ...PERSON, labelEn: 'Send for legal review' } });
    fixture.detectChanges();
    expect(text(q('[data-change-count]'))).toBe('Transition saved');

    // The page reloads the template: the same transition, as a new object.
    fixture.componentRef.setInput('transition', { ...PERSON, labelEn: 'Send for legal review' });
    fixture.detectChanges();
    expect(q<HTMLInputElement>('#tp-labelEn')!.value).toBe('Send for legal review');
    expect(text(q('[data-change-count]'))).withContext('still shown after the reload').toBe('Transition saved');

    type('tp-labelEn', 'Send for legal review now');
    expect(text(q('[data-change-count]'))).withContext('the next change takes it away').not.toContain('saved');
  });

  it('a transition just added keeps its saved line when the panel reopens on it', async () => {
    const p = await setup({ transition: null });
    type('tp-labelEn', 'Escalate');
    await choose('[data-to-select]', 'Approved');
    p.saved.subscribe(() => undefined);
    save().flush({ transition: { ...PERSON, id: 't-new', labelEn: 'Escalate', toStageId: 's3' } });
    fixture.detectChanges();
    expect(text(q('[data-change-count]'))).toBe('Transition saved');

    // The page reloads and the panel is given the new transition.
    fixture.componentRef.setInput('transition', { ...PERSON, id: 't-new', labelEn: 'Escalate', toStageId: 's3' });
    fixture.detectChanges();
    expect(text(q('[data-change-count]'))).toBe('Transition saved');
    type('tp-labelEn', 'Escalate now');
    expect(text(q('[data-change-count]'))).not.toContain('saved');
  });

  it('opening another transition starts without a saved line', async () => {
    await setup();
    type('tp-labelEn', 'Renamed');
    save().flush({ transition: { ...PERSON, labelEn: 'Renamed' } });
    fixture.detectChanges();
    fixture.componentRef.setInput('transition', { ...PERSON, id: 't2', labelEn: 'Another' });
    fixture.detectChanges();
    expect(text(q('[data-change-count]'))).toBe('');
  });

  it('Save is never disabled: a missing name and To are said in their slots, and nothing is sent', async () => {
    await setup({ transition: null });
    q<HTMLButtonElement>('[data-panel-save] button')!.click();
    fixture.detectChanges();
    const all = text(el());
    expect(all).toContain("Enter the transition's English name.");
    expect(all).toContain('Choose the stage this move goes to.');
    http.expectNone((r) => r.url.startsWith(TRANSITIONS_URL));
  });

  it('a refusal is said from its code', async () => {
    await setup();
    save().flush({ statusCode: 409, code: 'WORKFLOW_TEMPLATE_PROTECTED', edit: 'TRANSITION', message: 'English for a log' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(text(q('[data-panel-refusal]'))).toContain('The moves of a committee change request are fixed');
    expect(text(q('[data-panel-refusal]'))).not.toContain('English for a log');
  });

  it('a reload of the same transition keeps unsaved work (ACC-55); another transition replaces it', async () => {
    await setup();
    type('tp-labelEn', 'Unsaved');
    fixture.componentRef.setInput('transition', { ...PERSON });
    fixture.detectChanges();
    expect(q<HTMLInputElement>('#tp-labelEn')!.value).toBe('Unsaved');
    fixture.componentRef.setInput('transition', { ...PERSON, id: 't2', labelEn: 'Another' });
    fixture.detectChanges();
    expect(q<HTMLInputElement>('#tp-labelEn')!.value).toBe('Another');
  });

  it('Remove confirms, deletes the move and tells the page', async () => {
    const p = await setup();
    const removed = jasmine.createSpy('removed');
    p.removed.subscribe(removed);
    q<HTMLButtonElement>('[data-panel-remove] button')!.click();
    expect(ask).toHaveBeenCalledTimes(1);
    ask.calls.mostRecent().args[0].accept();
    const req = http.expectOne(`${TRANSITIONS_URL}/t1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(removed).toHaveBeenCalledWith('t1');
  });

  // ── Read-only: a move the app runs, and a protected workflow ───────────────

  it('a move the app runs is read-only: the server’s line, why it can’t change, and Close', async () => {
    const p = await setup({ transition: APP_MOVE });
    expect(text(q('[data-app-move]'))).toBe("Runs when the change request is approved on the committee's Changes tab.");
    expect(text(q('[data-app-run-banner]'))).toContain("The app runs this move itself, so it can't be changed here.");
    expect(q('form')).toBeNull();
    expect(q('[data-panel-save]')).toBeNull();
    expect(q('[data-panel-remove]')).toBeNull();
    expect(text(q('[data-readonly-pairs]'))).toContain('Approve and apply');
    const closed = jasmine.createSpy('closed');
    p.closed.subscribe(closed);
    q<HTMLButtonElement>('[data-panel-close] button')!.click();
    expect(closed).toHaveBeenCalled();
  });

  it('a move the app runs reads the server’s Arabic line in Arabic, never a frontend copy', async () => {
    await setup({ transition: APP_MOVE, lang: 'ar' });
    expect(text(q('[data-app-move]'))).toBe('تُنفَّذ عند اعتماد طلب التغيير من تبويب «التغييرات» في سجل اللجنة.');
    expect(text(q('[data-app-run-banner]'))).toContain('ينفّذ النظام هذا الانتقال بنفسه، لذا لا يمكن تعديله هنا.');
  });

  it('an app-run move with no line from the server shows only the sentence', async () => {
    await setup({ transition: { ...APP_MOVE, appMove: undefined } });
    expect(q('[data-app-move]')).toBeNull();
    expect(text(q('[data-app-run-banner]'))).toBe("The app runs this move itself, so it can't be changed here.");
  });

  it('a protected workflow’s move is read-only, without Save or Remove, and its actions open read-only', async () => {
    await setup({ template: { ...TEMPLATE, isProtected: true } });
    expect(text(q('[data-protected-banner]'))).toContain('The moves of a committee change request are fixed');
    expect(q('form')).toBeNull();
    expect(q('[data-panel-save]')).toBeNull();
    expect(q('[data-panel-remove]')).toBeNull();
    expect(text(q('[data-readonly-pairs]'))).toContain('A person · Pressed by whoever works Under review.');
    q<HTMLButtonElement>('[data-open-actions] button')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const configurator = fixture.debugElement.query(By.directive(WorkflowActionConfiguratorComponent)).componentInstance as WorkflowActionConfiguratorComponent;
    expect(configurator.isProtected).toBeTrue();
    expect(configurator.actions.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('an editable move’s actions open editable, as last loaded', async () => {
    await setup();
    q<HTMLButtonElement>('[data-open-actions] button')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const configurator = (): WorkflowActionConfiguratorComponent =>
      fixture.debugElement.query(By.directive(WorkflowActionConfiguratorComponent)).componentInstance;
    expect(configurator().isProtected).toBeFalse();
    fixture.componentRef.setInput('transition', { ...PERSON, actions: [] });
    fixture.detectChanges();
    expect(configurator().actions).toEqual([]);
  });

  // ── Keyboard and focus ────────────────────────────────────────────────────

  it('opening puts focus on the heading', async () => {
    await setup();
    await fixture.whenStable();
    expect(document.activeElement).toBe(q('[data-panel-heading]'));
  });

  it('Escape with nothing changed closes the panel', async () => {
    const p = await setup();
    const closed = jasmine.createSpy('closed');
    p.closed.subscribe(closed);
    q('[data-panel-heading]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  });

  it('Escape with unsaved changes asks first; the panel closes only on Discard', async () => {
    const p = await setup();
    const closed = jasmine.createSpy('closed');
    p.closed.subscribe(closed);
    type('tp-labelEn', 'Changed');
    q('#tp-labelEn')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
    ask.calls.mostRecent().args[0].accept();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('Escape belongs to an overlay above the panel while one is open', async () => {
    const p = await setup();
    const closed = jasmine.createSpy('closed');
    p.closed.subscribe(closed);
    const layers = TestBed.inject(LayerStackService);
    const layer = layers.push();
    q('[data-panel-heading]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).not.toHaveBeenCalled();
    layers.remove(layer);
  });

  it('every control is reachable by Tab in reading order: names, Kind, Approval path, the stage link, actions, then the footer', async () => {
    await setup();
    const focusables = Array.from(
      el().querySelectorAll<HTMLElement>('input, button, a[href], [tabindex]:not([tabindex="-1"])'),
    ).filter((n) => !n.closest('[aria-hidden="true"]') && n.getAttribute('tabindex') !== '-1');
    // Each control by the slot it sits in, in DOM (= Tab) order.
    const SLOTS = ['data-kind-select', 'data-stage-link', 'data-open-actions', 'data-panel-remove', 'data-panel-cancel', 'data-panel-save'];
    const names = focusables.map((n) => {
      if (n.id) return n.id;
      const slot = SLOTS.find((s) => n.closest(`[${s}]`));
      return slot ?? n.tagName;
    });
    const at = (name: string): number => {
      const i = names.indexOf(name);
      expect(i).withContext(`${name} is reachable: ${names.join(', ')}`).toBeGreaterThanOrEqual(0);
      return i;
    };
    expect(names[0]).toBe('tp-labelEn');
    expect(names[1]).toBe('tp-labelAr');
    expect(at('data-kind-select')).toBeGreaterThan(at('tp-labelAr'));
    expect(at('data-stage-link')).toBeGreaterThan(at('data-kind-select'));
    expect(at('data-open-actions')).toBeGreaterThan(at('data-stage-link'));
    expect(at('data-panel-remove')).toBeLessThan(at('data-panel-save'));
    expect(at('data-panel-cancel')).toBeLessThan(at('data-panel-save'));
    expect(names.at(-1)).toBe('data-panel-save');
  });
});
