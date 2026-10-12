import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import {
  StageTaskDefinitionDto,
  StageTaskDefinitionSavedDto,
  WorkflowStageDto,
  WorkflowTemplateDto,
} from '../../services/workflow-template.service';
import { StageTaskDefinitionFormComponent } from './stage-task-definition-form.component';

// ACC-208 — the add / edit dialog's form (drawing section 2): the two steps,
// which routes it offers, exactly what each route sends, and the deadline rule
// shown on the Priority field before and after the server answers.

const API = environment.apiUrl;

const STAGE = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Terms Review',
  nameAr: 'مراجعة الشروط',
  slaWorkingHours: 40,
  isFinal: false,
} as WorkflowStageDto;

const TEMPLATE = (over: Partial<WorkflowTemplateDto> = {}): WorkflowTemplateDto => ({
  id: 'template-1',
  organizationId: 'org',
  nameEn: 'Committee Management',
  nameAr: 'إدارة اللجان',
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  recordRoutes: { unit: true, committee: true },
  taskDueHours: { LOW: 80, MEDIUM: 40, HIGH: 16, CRITICAL: 4 },
  ...over,
});

@Component({
  standalone: true,
  imports: [StageTaskDefinitionFormComponent],
  template: `
    <app-stage-task-definition-form
      [definition]="definition()"
      [stage]="stage"
      [template]="template()"
      (saved)="saved.push($event)"
    />
  `,
})
class HostComponent {
  readonly definition = signal<StageTaskDefinitionDto | null>(null);
  readonly template = signal<WorkflowTemplateDto>(TEMPLATE());
  readonly stage = STAGE;
  readonly saved: StageTaskDefinitionSavedDto[] = [];
}

describe('StageTaskDefinitionFormComponent (ACC-208)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;
  let fixture: ComponentFixture<HostComponent>;

  function setup(options: { permissions?: string[]; template?: Partial<WorkflowTemplateDto>; definition?: StageTaskDefinitionDto; language?: 'en' | 'ar' } = {}) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        {
          provide: NavigationAccessService,
          useValue: {
            hasPermission: (p: string) => (options.permissions ?? ['workflows:manage', 'committees:view', 'org:view']).includes(p),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(options.language ?? 'en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    if (options.template) fixture.componentInstance.template.set(TEMPLATE(options.template));
    if (options.definition) fixture.componentInstance.definition.set(options.definition);
    fixture.detectChanges();
    return form();
  }

  const form = () =>
    fixture.debugElement.query(By.directive(StageTaskDefinitionFormComponent)).componentInstance as StageTaskDefinitionFormComponent;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';

  function fillStepOne(f: StageTaskDefinitionFormComponent, title = 'Check the terms'): void {
    f.form.controls.titleEn.setValue(title);
    f.next();
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  describe('step 1, "The task"', () => {
    it('will not move on without an English title, and says why on the field', async () => {
      const f = setup();
      f.next();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(f.step()).toBe(1);
      expect(text()).toContain('This field is required');
      expect(document.activeElement?.id).toBe('titleEn');
    });

    it('moves on with one, and the header names the task and whether it blocks', () => {
      const f = setup();
      fillStepOne(f);
      expect(f.step()).toBe(2);
      expect(f.context()).toBe('Check the terms · Mandatory');
      f.form.controls.isMandatory.setValue(false);
      f.back();
      f.next();
      expect(f.context()).toBe('Check the terms · Optional');
    });

    it('names where the task lives on step 1', () => {
      const f = setup();
      expect(f.context()).toBe('Committee Management · Terms Review');
      expect(f.stepLabel()).toBe('Step 1 of 2');
    });
  });

  describe('the routes it offers', () => {
    const offered = (f: StageTaskDefinitionFormComponent) => f.routeOptions().map((o) => o.value);

    it('offers all four on a record type that has a unit and a committee', () => {
      expect(offered(setup())).toEqual(['POSITION', 'RECORD_UNIT_POSITION', 'COMMITTEE_ROLE', 'RECORD_COMMITTEE_ROLE']);
    });

    it('leaves the relative ones out, and says why, where the record type has neither', () => {
      const f = setup({ template: { objectType: 'DOCUMENT', recordRoutes: { unit: false, committee: false } } });
      expect(offered(f)).toEqual(['POSITION', 'COMMITTEE_ROLE']);
      expect(f.routeHint()).toBe('This kind of record has no unit or committee of its own, so only fixed choices are offered.');
    });

    it('leaves the committee routes out without committees:view, and says why', () => {
      const f = setup({ permissions: ['workflows:manage', 'org:view'] });
      expect(offered(f)).toEqual(['POSITION', 'RECORD_UNIT_POSITION']);
      expect(f.routeHint()).toBe("You can't see committees, so the committee choices aren't offered.");
    });

    it('never offers a system role', () => {
      expect(offered(setup())).not.toContain('ROLE' as never);
    });
  });

  describe('what each route sends — exactly its own fields', () => {
    function save(f: StageTaskDefinitionFormComponent) {
      f.form.controls.priority.setValue('HIGH');
      f.onSubmit();
      const req = http.expectOne(`${API}/workflow-templates/stages/stage-1/task-definitions`);
      return req;
    }

    it('a unit you choose: unit, position and the optional person, through the task picker', () => {
      const f = setup();
      fillStepOne(f);
      f.form.controls.assignKind.setValue('POSITION');
      fixture.detectChanges();
      http.expectOne(`${API}/tasks/assignment/units`).flush([{ id: 'unit-1', parentId: null, nameEn: 'Quality', nameAr: null }]);
      f.form.controls.assign.controls.scope.setValue('unit-1');
      http.expectOne((r) => r.url === `${API}/tasks/assignment/positions`).flush([
        { id: 'pos-1', nameEn: 'Quality Officer', nameAr: null, isSingleAssignee: false, holderCount: 2 },
      ]);
      f.form.controls.assign.controls.target.setValue('pos-1');
      http.expectOne((r) => r.url === `${API}/tasks/assignees`).flush([]);

      const req = save(f);
      expect(req.request.body).toEqual({
        titleEn: 'Check the terms',
        titleAr: null,
        description: null,
        isMandatory: true,
        requiresEvidence: false,
        priority: 'HIGH',
        assignKind: 'POSITION',
        orgUnitId: 'unit-1',
        positionId: 'pos-1',
        userId: null,
        committeeId: null,
        committeeRoleValueId: null,
      });
      req.flush({ definition: { id: 'def-new' }, warning: null });
    });

    it("the record's own unit: the position only, from the org-wide catalogue", () => {
      const f = setup();
      fillStepOne(f);
      f.form.controls.assignKind.setValue('RECORD_UNIT_POSITION');
      http.expectOne(`${API}/org-positions`).flush([{ id: 'pos-1', nameEn: 'Quality Officer', nameAr: null, isActive: true }]);
      f.form.controls.recordPositionId.setValue('pos-1');

      const req = save(f);
      expect(req.request.body).toEqual(
        jasmine.objectContaining({ assignKind: 'RECORD_UNIT_POSITION', orgUnitId: null, positionId: 'pos-1', userId: null, committeeId: null, committeeRoleValueId: null }),
      );
      req.flush({ definition: { id: 'def-new' }, warning: null });
    });

    it('a committee you choose: the committee and a role, from the catalogue counted on it', () => {
      const f = setup();
      fillStepOne(f);
      f.form.controls.assignKind.setValue('COMMITTEE_ROLE');
      http.expectOne(`${API}/committees`).flush([{ id: 'c-1', nameEn: 'Quality Assurance Committee', nameAr: null }]);
      f.form.controls.committeeId.setValue('c-1');
      const roles = http.expectOne((r) => r.url === `${API}/tasks/assignment/committee-roles`);
      expect(roles.request.params.get('catalogue')).toBe('true');
      expect(roles.request.params.get('committeeId')).toBe('c-1');
      roles.flush([{ id: 'role-sec', labelEn: 'Secretary', labelAr: null, memberCount: 0 }]);
      expect(f.roleOptions()).toEqual([{ value: 'role-sec', label: 'Secretary', meta: '0 members' }]);
      f.form.controls.committeeRoleValueId.setValue('role-sec');

      const req = save(f);
      expect(req.request.body).toEqual(
        jasmine.objectContaining({ assignKind: 'COMMITTEE_ROLE', orgUnitId: null, positionId: null, userId: null, committeeId: 'c-1', committeeRoleValueId: 'role-sec' }),
      );
      req.flush({ definition: { id: 'def-new' }, warning: null });
    });

    it("the record's committee: a role only, from the catalogue with no committee named", () => {
      const f = setup();
      fillStepOne(f);
      f.form.controls.assignKind.setValue('RECORD_COMMITTEE_ROLE');
      const roles = http.expectOne((r) => r.url === `${API}/tasks/assignment/committee-roles`);
      expect(roles.request.params.has('committeeId')).toBeFalse();
      roles.flush([{ id: 'role-sec', labelEn: 'Secretary', labelAr: null, memberCount: null }]);
      f.form.controls.committeeRoleValueId.setValue('role-sec');

      const req = save(f);
      expect(req.request.body).toEqual(
        jasmine.objectContaining({ assignKind: 'RECORD_COMMITTEE_ROLE', orgUnitId: null, positionId: null, committeeId: null, committeeRoleValueId: 'role-sec' }),
      );
      req.flush({ definition: { id: 'def-new' }, warning: null });
    });
  });

  describe('the deadline rule', () => {
    it('shows the refusal on Priority as soon as a too-slow priority is chosen, naming both numbers and the way out', () => {
      const f = setup();
      fillStepOne(f);
      f.form.controls.priority.setValue('LOW');
      fixture.detectChanges();

      expect(text()).toContain(
        "Low tasks are due in 80 working hours, but this stage's deadline is 40. Raise the stage deadline to at least 80 working hours, or choose a higher priority.",
      );
    });

    it('keeps Save enabled: pressing it sends nothing, focuses Priority and repeats the message', async () => {
      const f = setup();
      fillStepOne(f);
      f.form.controls.priority.setValue('LOW');
      f.form.controls.assignKind.setValue('RECORD_COMMITTEE_ROLE');
      http.expectOne((r) => r.url === `${API}/tasks/assignment/committee-roles`).flush([{ id: 'r', labelEn: 'S', labelAr: null, memberCount: null }]);
      f.form.controls.committeeRoleValueId.setValue('r');

      f.onSubmit();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(el().querySelector('[data-std-announcement]')?.textContent).toContain('Low tasks are due in 80 working hours');
      expect(document.activeElement?.closest('am-field')?.textContent).toContain('Priority');
      // http.verify() in afterEach: nothing was sent.
    });

    it('accepts any priority on a stage with no deadline', () => {
      const f = setup();
      (fixture.componentInstance as { stage: WorkflowStageDto }).stage = { ...STAGE, slaWorkingHours: null };
      fixture.detectChanges();
      f.form.controls.priority.setValue('LOW');
      expect(f.form.controls.priority.valid).toBeTrue();
    });

    it("lands the server's 409 on the same field, with the server's numbers", () => {
      const f = setup();
      fillStepOne(f);
      f.form.controls.priority.setValue('HIGH');
      f.form.controls.assignKind.setValue('RECORD_COMMITTEE_ROLE');
      http.expectOne((r) => r.url === `${API}/tasks/assignment/committee-roles`).flush([{ id: 'r', labelEn: 'S', labelAr: null, memberCount: null }]);
      f.form.controls.committeeRoleValueId.setValue('r');
      f.onSubmit();
      http
        .expectOne(`${API}/workflow-templates/stages/stage-1/task-definitions`)
        .flush(
          { statusCode: 409, code: 'STAGE_TASK_DUE_AFTER_STAGE_DEADLINE', taskHours: 24, stageHours: 20, priority: 'HIGH', message: 'x' },
          { status: 409, statusText: 'Conflict' },
        );
      fixture.detectChanges();

      expect(f.step()).toBe(2);
      expect(text()).toContain("High tasks are due in 24 working hours, but this stage's deadline is 20.");
      expect(f.saveError()).toBeNull();
    });
  });

  it('goes back to step 1 when Save finds a step-1 field wrong', () => {
    const f = setup();
    fillStepOne(f);
    f.form.controls.titleEn.setValue('');
    f.onSubmit();
    expect(f.step()).toBe(1);
  });

  it('puts a refusal with no field in the footer slot, in words, never the server English', () => {
    const f = setup();
    fillStepOne(f);
    f.form.controls.priority.setValue('HIGH');
    f.form.controls.assignKind.setValue('RECORD_COMMITTEE_ROLE');
    http.expectOne((r) => r.url === `${API}/tasks/assignment/committee-roles`).flush([{ id: 'r', labelEn: 'S', labelAr: null, memberCount: null }]);
    f.form.controls.committeeRoleValueId.setValue('r');
    f.onSubmit();
    http
      .expectOne(`${API}/workflow-templates/stages/stage-1/task-definitions`)
      .flush({ statusCode: 404, code: 'STAGE_TASK_ROLE_NOT_FOUND', message: 'Committee role not found' }, { status: 404, statusText: 'Not Found' });
    expect(f.saveError()).toBe('workflow.refusal.roleNotFound');
  });

  it('keeps the warning after a save, in words naming the unit (ACC-55)', () => {
    const f = setup();
    fillStepOne(f);
    f.form.controls.priority.setValue('HIGH');
    f.form.controls.assignKind.setValue('RECORD_COMMITTEE_ROLE');
    http.expectOne((r) => r.url === `${API}/tasks/assignment/committee-roles`).flush([{ id: 'r', labelEn: 'S', labelAr: null, memberCount: null }]);
    f.form.controls.committeeRoleValueId.setValue('r');
    f.onSubmit();
    http.expectOne(`${API}/workflow-templates/stages/stage-1/task-definitions`).flush({
      definition: { id: 'def-new', orgUnit: { id: 'u', nameEn: 'Cardiology', nameAr: null }, committee: null },
      warning: 'POSITION_HAS_NO_HOLDER',
    });
    fixture.detectChanges();

    expect(f.savedWarning()).toBe('Saved. Nobody holds this position in Cardiology yet, so its tasks will wait unassigned until someone does.');
    expect(fixture.componentInstance.saved.length).toBe(1);
  });

  it('edits with the full shape, so changing route clears the old one', () => {
    const f = setup({
      definition: {
        id: 'def-1',
        titleEn: 'Check the terms',
        titleAr: 'مراجعة',
        description: null,
        isMandatory: true,
        requiresEvidence: true,
        priority: 'HIGH',
        assignKind: 'RECORD_UNIT_POSITION',
        positionId: 'pos-1',
        orgUnitId: null,
        userId: null,
        committeeId: null,
        committeeRoleValueId: null,
      } as StageTaskDefinitionDto,
    });
    http.expectOne(`${API}/org-positions`).flush([{ id: 'pos-1', nameEn: 'Quality Officer', nameAr: null, isActive: true }]);
    f.next();
    f.form.controls.assignKind.setValue('RECORD_COMMITTEE_ROLE');
    http.expectOne((r) => r.url === `${API}/tasks/assignment/committee-roles`).flush([{ id: 'r', labelEn: 'S', labelAr: null, memberCount: null }]);
    f.form.controls.committeeRoleValueId.setValue('r');
    f.onSubmit();

    const req = http.expectOne(`${API}/workflow-templates/task-definitions/def-1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(
      jasmine.objectContaining({ titleAr: 'مراجعة', requiresEvidence: true, assignKind: 'RECORD_COMMITTEE_ROLE', positionId: null, committeeRoleValueId: 'r' }),
    );
    req.flush({ definition: { id: 'def-1' }, warning: null });
  });

  it('speaks Arabic: priorities with their due times, and the step label', () => {
    const f = setup({ language: 'ar' });
    expect(f.stepLabel()).toBe('الخطوة 1 من 2');
    expect(f.priorityOptions().map((o) => o.label)).toEqual([
      'حرجة · خلال 4 ساعات عمل',
      'عالية · خلال 16 ساعة عمل',
      'متوسطة · خلال 40 ساعة عمل',
      'منخفضة · خلال 80 ساعة عمل',
    ]);
  });
});
