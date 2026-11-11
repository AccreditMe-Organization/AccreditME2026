// ACC-271 PR 5b — a stage's transitions, as a LIST in its expanded row. The Add
// and Edit dialogs are gone (the transition panel on the page replaced them),
// and so is "Who can trigger": whoever works the stage presses its moves.
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { WorkflowTransitionEditorComponent, TransitionOpenEvent } from './workflow-transition-editor.component';
import { WorkflowStageDto, WorkflowTransitionDto } from '../../services/workflow-template.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { pickBilingualName } from '../../../../shared/utils/bilingual-name.util';
import { WorkflowActionConfiguratorComponent } from '../workflow-action-configurator/workflow-action-configurator.component';
import { By } from '@angular/platform-browser';

const PERSON: WorkflowTransitionDto = {
  id: 'transition-1',
  fromStageId: 'stage-1',
  toStageId: 'stage-2',
  labelEn: 'Approve Committee',
  labelAr: 'اعتماد اللجنة',
  validatorConfig: null,
  isApprovalPath: false,
  kind: 'ADVANCE',
  mover: 'PERSON',
  actions: [{ id: 'a1', workflowTransitionId: 'transition-1', actionType: 'LOG_AUDIT', order: 10, isEnabled: true, configJson: null }],
};

const APP: WorkflowTransitionDto = {
  ...PERSON,
  id: 'transition-app',
  labelEn: 'Approve and apply',
  labelAr: 'اعتماد وتطبيق',
  mover: 'APP',
  appMove: { key: 'cr.approve', en: 'Runs when approved.', ar: 'تُنفَّذ عند الاعتماد.' },
};

const STAGES = [
  { id: 'stage-1', nameEn: 'Under review', nameAr: 'قيد المراجعة', order: 10 },
  { id: 'stage-2', nameEn: 'Approved', nameAr: 'معتمد', order: 20 },
] as WorkflowStageDto[];

const TRANSITIONS_URL = `${environment.apiUrl}/workflow-templates/transitions`;

describe('WorkflowTransitionEditorComponent — a stage’s transitions list (ACC-271 PR 5b)', () => {
  let fixture: ComponentFixture<WorkflowTransitionEditorComponent>;
  let component: WorkflowTransitionEditorComponent;
  let http: HttpTestingController;
  let ask: jasmine.Spy;

  function setup(opts: { transitions?: WorkflowTransitionDto[]; manage?: boolean; isProtected?: boolean; arabic?: boolean } = {}): HTMLElement {
    ask = jasmine.createSpy('ask');
    const arabic = opts.arabic ?? false;
    TestBed.configureTestingModule({
      imports: [WorkflowTransitionEditorComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        ConfirmationService,
        { provide: AmConfirmService, useValue: { ask } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => opts.manage ?? true } },
        {
          provide: LanguageService,
          useValue: { isArabic: () => arabic, bilingual: (en: string, ar: string | null | undefined) => pickBilingualName(en, ar, arabic) },
        },
      ],
    });
    fixture = TestBed.createComponent(WorkflowTransitionEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('stageId', 'stage-1');
    fixture.componentRef.setInput('transitions', opts.transitions ?? [PERSON]);
    fixture.componentRef.setInput('availableStages', STAGES);
    fixture.componentRef.setInput('isProtected', opts.isProtected ?? false);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.p-dialog, .p-dialog-mask').forEach((n) => n.remove());
  });

  const row = (el: HTMLElement, id: string): HTMLElement => el.querySelector<HTMLElement>(`[data-transition-row="${id}"]`)!;
  const text = (node: Element | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('reads no roles or permissions: who presses a move is the stage’s', () => {
    setup();
    http.expectNone(`${environment.apiUrl}/roles?pageSize=200`);
    http.expectNone(`${environment.apiUrl}/roles/permissions`);
  });

  it('shows the move, where it goes and its kind in words — and no trigger, role or permission', () => {
    const el = setup({ transitions: [PERSON, { ...PERSON, id: 't-return', kind: 'RETURN' }, { ...PERSON, id: 't-exit', kind: 'EXIT' }] });
    const headers = Array.from(el.querySelectorAll('thead th')).map((th) => text(th));
    expect(headers).toEqual(['workflow.transitionPanel.colTransition', 'workflow.transitionPanel.to', 'workflow.kind.label', 'workflow.transitionPanel.colActions']);
    expect(text(row(el, 'transition-1').querySelector('[data-tr-label]'))).toBe('Approve Committee');
    expect(text(row(el, 'transition-1').querySelector('[data-tr-to]'))).toBe('Approved');
    const chips = Array.from(el.querySelectorAll('[data-tr-kind]')).map((c) => text(c));
    expect(chips).toEqual(['workflow.kind.advance', 'workflow.kind.return', 'workflow.kind.exit']);
    expect(row(el, 't-return').querySelector('[data-tr-kind]')!.classList).toContain('am-tr-chip--return');
    const all = text(el);
    // No permission is shown: a move names none (ACC-271 PR 6b).
    for (const gone of ['committees:manage', 'committees:approve']) {
      expect(all).not.toContain(gone);
    }
  });

  // ACC-284 — Kind says whether a press is a vote; the old flag is not shown, even when stored.
  it('shows no "Approval Path" tag, even for a move stored with isApprovalPath true', () => {
    const el = setup({ transitions: [{ ...PERSON, isApprovalPath: true }] });
    expect(text(row(el, 'transition-1').querySelector('[data-tr-kind]'))).toBe('workflow.kind.advance');
    expect(el.querySelector('p-tag')).toBeNull();
    expect(text(el)).not.toContain('workflow.approvalPath');
  });

  it('names the move and its destination in Arabic in an Arabic session', () => {
    const el = setup({ arabic: true });
    expect(text(row(el, 'transition-1').querySelector('[data-tr-label]'))).toBe('اعتماد اللجنة');
    expect(text(row(el, 'transition-1').querySelector('[data-tr-to]'))).toBe('معتمد');
  });

  it('a person’s move has Edit and a ⋯, and both its name and Edit open it in the panel', () => {
    const el = setup();
    const opened: TransitionOpenEvent[] = [];
    component.open.subscribe((e) => opened.push(e));
    expect(row(el, 'transition-1').querySelector('[data-tr-edit]')).not.toBeNull();
    expect(row(el, 'transition-1').querySelector('am-row-menu')).not.toBeNull();

    row(el, 'transition-1').querySelector<HTMLButtonElement>('[data-tr-open]')!.click();
    row(el, 'transition-1').querySelector<HTMLButtonElement>('[data-tr-edit] button')!.click();
    expect(opened.map((e) => e.transitionId)).toEqual(['transition-1', 'transition-1']);
    expect(opened[0]!.opener).toBe(row(el, 'transition-1').querySelector<HTMLElement>('[data-tr-open]'));
  });

  it('a move the app runs says "Done by the app", has no Edit and no ⋯, and its name still opens it', () => {
    const el = setup({ transitions: [PERSON, APP] });
    const opened: string[] = [];
    component.open.subscribe((e) => opened.push(e.transitionId));
    const app = row(el, 'transition-app');
    expect(text(app.querySelector('[data-tr-app]'))).toBe('workflow.mover.APP');
    expect(row(el, 'transition-1').querySelector('[data-tr-app]')).toBeNull();
    expect(app.querySelector('[data-tr-edit]')).toBeNull();
    expect(app.querySelector('am-row-menu')).toBeNull();
    expect(app.querySelector('[data-tr-open]')!.getAttribute('aria-label')).toBe('workflow.transitionPanel.viewNamed');
    app.querySelector<HTMLButtonElement>('[data-tr-open]')!.click();
    expect(opened).toEqual(['transition-app']);
  });

  it('every move it is given is a row: three Withdraws from three stages stay three rows', () => {
    const withdraw = (id: string, from: string): WorkflowTransitionDto => ({ ...APP, id, fromStageId: from, labelEn: 'Withdraw', labelAr: 'سحب' });
    const el = setup({ transitions: [withdraw('w1', 'stage-1'), withdraw('w2', 'stage-1'), withdraw('w3', 'stage-1')] });
    expect(el.querySelectorAll('[data-transition-row]').length).toBe(3);
  });

  it('a protected workflow’s moves are read-only: no Add, no Edit, no ⋯', () => {
    const el = setup({ isProtected: true });
    expect(el.querySelector('[data-tr-add]')).toBeNull();
    expect(row(el, 'transition-1').querySelector('[data-tr-edit]')).toBeNull();
    expect(row(el, 'transition-1').querySelector('am-row-menu')).toBeNull();
    expect(row(el, 'transition-1').querySelector('[data-tr-open]')).not.toBeNull();
  });

  it('without workflows:manage there is no Add, Edit or ⋯', () => {
    const el = setup({ manage: false });
    expect(el.querySelector('[data-tr-add]')).toBeNull();
    expect(row(el, 'transition-1').querySelector('[data-tr-edit]')).toBeNull();
  });

  it('Add transition asks the page for the panel', () => {
    const el = setup();
    const added = jasmine.createSpy('add');
    component.add.subscribe(added);
    el.querySelector<HTMLButtonElement>('[data-tr-add] button')!.click();
    expect(added).toHaveBeenCalledTimes(1);
  });

  it('⋯ Remove confirms, deletes the move and tells the page', () => {
    setup();
    const changed = jasmine.createSpy('changed');
    component.changed.subscribe(changed);
    component.pick(PERSON, 'remove');
    expect(ask).toHaveBeenCalledTimes(1);
    ask.calls.mostRecent().args[0].accept();
    const req = http.expectOne(`${TRANSITIONS_URL}/transition-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  // Ahmad's item 7 — openActions kept the transition object, so after a reload
  // the dialog showed the actions from before the save.
  it('⋯ Automatic actions shows the transition as last loaded, not as it was when opened', async () => {
    setup();
    component.pick(PERSON, 'actions');
    fixture.detectChanges();
    await fixture.whenStable();
    const configurator = (): WorkflowActionConfiguratorComponent =>
      fixture.debugElement.query(By.directive(WorkflowActionConfiguratorComponent)).componentInstance;
    expect(configurator().actions.map((a) => a.id)).toEqual(['a1']);
    expect(configurator().isProtected).toBeFalse();

    // A save inside the dialog reloads the template: the row gets a new object.
    const reloaded: WorkflowTransitionDto = {
      ...PERSON,
      actions: [...PERSON.actions!, { id: 'a2', workflowTransitionId: 'transition-1', actionType: 'SEND_NOTIFICATION', order: 20, isEnabled: true, configJson: null }],
    };
    fixture.componentRef.setInput('transitions', [reloaded]);
    fixture.detectChanges();
    expect(configurator().actions.map((a) => a.id)).toEqual(['a1', 'a2']);
  });
});
