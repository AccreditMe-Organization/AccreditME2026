// ACC-22 (extension) — proves the three behaviors this reusable component
// exists for: (1) a transition button renders only when the server says the
// caller may press it (ACC-271 PR 2; it was the caller's requiredPermission,
// read on the client), (2) clicking a button calls the real
// triggerTransition() endpoint with the correct payload, (3) a successful
// transition emits the updated instance, which is what drives any
// consumer's displayed-stage refresh (CommitteeDetailComponent.
// onWorkflowTransitioned() is a one-line signal .set() on this — the
// meaningful behavior to prove is the emission contract, tested here).
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { environment } from '../../../../../environments/environment';
import { WorkflowTransitionActionsComponent } from './workflow-transition-actions.component';
import { WorkflowInstanceDto } from '../../services/workflow.service';
import { provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { CantMoveDialogComponent } from '../cant-move-dialog/cant-move-dialog.component';

const INSTANCE: WorkflowInstanceDto = {
  id: 'instance-1',
  organizationId: 'org-a',
  workflowTemplateId: 'template-1',
  objectType: 'COMMITTEE',
  objectId: 'committee-1',
  status: 'IN_PROGRESS',
  currentStageId: 'stage-formation',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  unassignedTaskWarnings: [],
};

const TRANSITION = {
  id: 'transition-submit',
  fromStageId: 'stage-formation',
  toStageId: 'stage-terms-review',
  labelEn: 'Submit for Approval',
  labelAr: 'إرسال للاعتماد',
  requiredPermission: 'committees:manage',
  triggerCondition: 'ROLE_BASED',
  triggerUserId: null,
  triggerRoleId: null,
  validatorConfig: null,
  isApprovalPath: false,

  kind: 'ADVANCE' as const,
};

const TEMPLATE_RESPONSE = {
  id: 'template-1',
  organizationId: 'org-a',
  nameEn: 'Committee Management',
  nameAr: 'إدارة اللجان',
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  stages: [
    {
      id: 'stage-formation',
      workflowTemplateId: 'template-1',
      nameEn: 'Formation',
      nameAr: 'التأسيس',
      description: null,
      order: 10,
      slaWorkingHours: null,
      requiredPermission: null,
      isInitial: true,
      isFinal: false,
      approvalMode: 'SINGLE',
      parallelThreshold: null,
      committeeId: null,
      assigneeStrategy: 'ROLE',
      assigneeUserId: null,
      assigneeRoleId: null,
      escalationConfig: null,
      transitions: [TRANSITION],
    },
    // ACC-208 — the target, so a refused move can name where it was going.
    {
      id: 'stage-terms-review',
      workflowTemplateId: 'template-1',
      nameEn: 'Terms Review',
      nameAr: 'مراجعة الشروط',
      description: null,
      order: 20,
      slaWorkingHours: null,
      isInitial: false,
      isFinal: false,
      approvalMode: 'SINGLE',
      parallelThreshold: null,
      committeeId: null,
      assigneeStrategy: 'ROLE',
      assigneeUserId: null,
      assigneeRoleId: null,
      escalationConfig: null,
      transitions: [],
    },
  ],
};

describe('WorkflowTransitionActionsComponent (ACC-22 extension)', () => {
  let fixture: ComponentFixture<WorkflowTransitionActionsComponent>;
  let component: WorkflowTransitionActionsComponent;
  let httpMock: HttpTestingController;

  /** `pressable`: the transition ids GET /moves answers with. */
  function setup(pressable: boolean | string[]): void {
    const transitionIds = pressable === true ? [TRANSITION.id] : pressable === false ? [] : pressable;
    TestBed.configureTestingModule({
      imports: [WorkflowTransitionActionsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        // ACC-208 — the "Can't move yet" dialog: links, and the dialog shell.
        provideRouter([]),
        ConfirmationService,
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowTransitionActionsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('instance', INSTANCE);
    fixture.detectChanges();

    httpMock.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(TEMPLATE_RESPONSE);
    httpMock.expectOne(`${environment.apiUrl}/workflows/instances/instance-1/moves`).flush({ transitionIds });
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  // ACC-271 PR 2 — on a converted stage the move's requiredPermission is not
  // read: whoever works the stage may press it. The screen takes the server's
  // answer and keeps no copy of either rule.
  describe('takes what the server says the caller may press (ACC-271)', () => {
    it('shows a move the server allows, though the person holds none of its requiredPermission', () => {
      // TRANSITION requires committees:manage; nothing here grants it.
      setup([TRANSITION.id]);

      expect(component.availableTransitions().map((t) => t.id)).toEqual([TRANSITION.id]);
      expect(fixture.debugElement.queryAll(By.css('p-button')).length).toBe(1);
    });

    it('shows nothing the server leaves out, whatever the move requires', () => {
      setup([]);

      expect(component.availableTransitions()).toEqual([]);
      expect(fixture.debugElement.queryAll(By.css('p-button')).length).toBe(0);
    });

    it('asks the server again when the record moves, and shows nothing until it answers', () => {
      setup([TRANSITION.id]);

      fixture.componentRef.setInput('instance', { ...INSTANCE, currentStageId: 'stage-terms-review', updatedAt: '2026-01-02T00:00:00.000Z' });
      fixture.detectChanges();

      expect(component.availableTransitions()).toEqual([]);
      httpMock.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(TEMPLATE_RESPONSE);
      httpMock.expectOne(`${environment.apiUrl}/workflows/instances/instance-1/moves`).flush({ transitionIds: [] });
      fixture.detectChanges();
      expect(fixture.debugElement.queryAll(By.css('p-button')).length).toBe(0);
    });
  });

  it('does not render a transition button when the server does not offer it', () => {
    setup(false);

    expect(component.availableTransitions().length).toBe(0);
    const buttons = fixture.debugElement.queryAll(By.css('p-button'));
    expect(buttons.length).toBe(0);
  });

  it("renders a transition button using the transition's own labelEn when the server offers it", () => {
    setup(true);

    expect(component.availableTransitions().length).toBe(1);
    expect(component.availableTransitions()[0].labelEn).toBe('Submit for Approval');
    const buttons = fixture.debugElement.queryAll(By.css('p-button'));
    expect(buttons.length).toBe(1);
  });

  it('triggers the real endpoint on click and emits the updated instance', () => {
    setup(true);
    let emitted: WorkflowInstanceDto | undefined;
    component.transitioned.subscribe((i) => (emitted = i));

    component.onTrigger(TRANSITION);

    const req = httpMock.expectOne(`${environment.apiUrl}/workflows/instances/instance-1/transitions`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ transitionId: 'transition-submit' });

    const updatedInstance: WorkflowInstanceDto = { ...INSTANCE, currentStageId: 'stage-terms-review' };
    req.flush(updatedInstance);

    expect(emitted).toEqual(updatedInstance);
  });

  it('renders one p-message per unassignedTaskWarnings entry (ACC-34)', () => {
    setup(true);

    component.onTrigger(TRANSITION);
    const req = httpMock.expectOne(`${environment.apiUrl}/workflows/instances/instance-1/transitions`);
    req.flush({
      ...INSTANCE,
      currentStageId: 'stage-terms-review',
      unassignedTaskWarnings: ['Task created as UNASSIGNED — no eligible assignee'],
    });
    fixture.detectChanges();

    expect(component.warnings()).toEqual(['Task created as UNASSIGNED — no eligible assignee']);
    const warnings = fixture.debugElement.queryAll(By.css('p-message[severity="warn"]'));
    expect(warnings.length).toBe(1);
  });

  it('renders multiple p-message entries when more than one CREATE_TASK action is unassigned (ACC-34)', () => {
    setup(true);

    component.onTrigger(TRANSITION);
    const req = httpMock.expectOne(`${environment.apiUrl}/workflows/instances/instance-1/transitions`);
    req.flush({
      ...INSTANCE,
      currentStageId: 'stage-terms-review',
      unassignedTaskWarnings: ['Warning one', 'Warning two'],
    });
    fixture.detectChanges();

    const warnings = fixture.debugElement.queryAll(By.css('p-message[severity="warn"]'));
    expect(warnings.length).toBe(2);
  });

  it('renders no warning messages when unassignedTaskWarnings is empty (no regression)', () => {
    setup(true);

    component.onTrigger(TRANSITION);
    const req = httpMock.expectOne(`${environment.apiUrl}/workflows/instances/instance-1/transitions`);
    req.flush({ ...INSTANCE, currentStageId: 'stage-terms-review', unassignedTaskWarnings: [] });
    fixture.detectChanges();

    const warnings = fixture.debugElement.queryAll(By.css('p-message[severity="warn"]'));
    expect(warnings.length).toBe(0);
  });

  // ACC-208 — an Advance refused while the stage's mandatory tasks are open.
  describe("Can't move yet", () => {
    const OPEN_TASK = {
      id: 'task-1',
      title: 'Check the terms',
      titleAr: null,
      status: 'PENDING',
      statusLabel: 'Assigned',
      dueAt: '2026-10-14T13:00:00.000Z',
      requiresEvidence: true,
      assignees: [{ id: 'u-1', name: 'Nora Al-Otaibi' }],
      pool: null,
    };

    function refuse(body: Record<string, unknown>, status = 409): void {
      component.onTrigger(TRANSITION);
      httpMock
        .expectOne(`${environment.apiUrl}/workflows/instances/instance-1/transitions`)
        .flush({ statusCode: status, message: 'English for a log', ...body }, { status, statusText: 'Refused' });
      fixture.detectChanges();
    }

    it('opens the dialog with the open tasks, naming the stage it could not reach and the button pressed', () => {
      setup(true);
      fixture.componentRef.setInput('recordLabel', 'Quality Assurance Committee');
      refuse({ code: 'STAGE_TASKS_OPEN', tasks: [OPEN_TASK] });

      const refused = component.cantMove();
      expect(refused?.label).toBe('Submit for Approval');
      expect(refused?.toStage).toBe('Terms Review');
      expect(refused?.tasks.map((t) => t.id)).toEqual(['task-1']);
      expect(component.refusalContext()).toBe('Quality Assurance Committee · Formation');
      expect(component.error()).toBeNull();
      expect(fixture.debugElement.query(By.directive(CantMoveDialogComponent))).not.toBeNull();

      component.cantMove.set(null);
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.directive(CantMoveDialogComponent))).toBeNull();
    });

    it('words any other workflow refusal by its code, never the server English', () => {
      setup(true);
      refuse({ code: 'STAGE_TASK_ROUTE_NOT_AVAILABLE' }, 400);
      expect(component.error()).toBe('workflow.refusal.routeNotAvailable');
      expect(component.cantMove()).toBeNull();
    });
  });
});
