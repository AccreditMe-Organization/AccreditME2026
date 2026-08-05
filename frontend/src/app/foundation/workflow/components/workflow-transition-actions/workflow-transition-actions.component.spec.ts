// ACC-22 (extension) — proves the three behaviors this reusable component
// exists for: (1) a transition button only renders when the caller holds
// its requiredPermission, (2) clicking a button calls the real
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
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

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
  ],
};

describe('WorkflowTransitionActionsComponent (ACC-22 extension)', () => {
  let fixture: ComponentFixture<WorkflowTransitionActionsComponent>;
  let component: WorkflowTransitionActionsComponent;
  let httpMock: HttpTestingController;

  function setup(hasPermission: boolean): void {
    TestBed.configureTestingModule({
      imports: [WorkflowTransitionActionsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: jasmine.createSpy('hasPermission').and.returnValue(hasPermission) },
        },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowTransitionActionsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('instance', INSTANCE);
    fixture.detectChanges();

    httpMock.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(TEMPLATE_RESPONSE);
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  it('does not render a transition button when the caller lacks the required permission', () => {
    setup(false);

    expect(component.availableTransitions().length).toBe(0);
    const buttons = fixture.debugElement.queryAll(By.css('p-button'));
    expect(buttons.length).toBe(0);
  });

  it("renders a transition button using the transition's own labelEn when the caller holds the required permission", () => {
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
});
