import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
  TranslateService,
} from '@ngx-translate/core';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { AuthService } from '../../core/services/auth.service';
import { FormatService } from '../../core/formatting';
import { CommitteeService } from '../../foundation/committees/services/committee.service';
import { LookupService } from '../../foundation/lookup/services/lookup.service';
import { UserService } from '../../foundation/user/services/user.service';
import { OrgUnitService } from '../../foundation/organization/services/org-unit.service';
import { OrgUnitHeadService } from '../../foundation/organization/services/org-unit-head.service';
import { OrgPositionService } from '../../foundation/org-position/services/org-position.service';
import { RoleService } from '../../foundation/roles/services/role.service';
import { TaskService } from '../../foundation/tasks/services/task.service';
import { WorkflowService } from '../../foundation/workflow/services/workflow.service';
import { WorkflowTemplateService } from '../../foundation/workflow/services/workflow-template.service';
import { CommitteeDetailComponent } from '../../foundation/committees/components/committee-detail/committee-detail.component';
import { CommitteeListComponent } from '../../foundation/committees/components/committee-list/committee-list.component';
import { CommitteeFormComponent } from '../../foundation/committees/components/committee-form/committee-form.component';
import { CommitteeMemberFormComponent } from '../../foundation/committees/components/committee-member-form/committee-member-form.component';
import { WorkflowStageIndicatorComponent } from '../../foundation/workflow/components/workflow-stage-indicator/workflow-stage-indicator.component';
import { WorkflowStageFormComponent } from '../../foundation/workflow/components/workflow-stage-form/workflow-stage-form.component';
import { WorkflowTransitionActionsComponent } from '../../foundation/workflow/components/workflow-transition-actions/workflow-transition-actions.component';
import { WorkflowStageListComponent } from '../../foundation/workflow/components/workflow-stage-list/workflow-stage-list.component';
import { WorkflowTransitionEditorComponent } from '../../foundation/workflow/components/workflow-transition-editor/workflow-transition-editor.component';
import { OrgUnitFormComponent } from '../../foundation/organization/components/org-unit-form/org-unit-form.component';
import { ManageRolesComponent } from '../../foundation/roles/components/manage-roles/manage-roles.component';
import { RolePermissionMatrixComponent } from '../../foundation/roles/components/role-permission-matrix/role-permission-matrix.component';
import { RoleListComponent } from '../../foundation/roles/components/role-list/role-list.component';
import { UserListComponent } from '../../foundation/user/components/user-list/user-list.component';
import { InviteUserComponent } from '../../foundation/user/components/invite-user/invite-user.component';
import { LookupValueListComponent } from '../../foundation/lookup/components/lookup-value-list/lookup-value-list.component';
import { UserRoleAssignmentComponent } from '../../foundation/roles/components/user-role-assignment/user-role-assignment.component';
import { RoleFormComponent } from '../../foundation/roles/components/role-form/role-form.component';
import { LookupValueFormComponent } from '../../foundation/lookup/components/lookup-value-form/lookup-value-form.component';

// ACC-160 — EVERY SWEPT SCREEN, WITH A RECORD THAT HAS NO ARABIC NAME.
//
// The rule is pinned once, in bilingual-name.util.spec.ts. What this file adds
// is the thing that rule's own spec cannot see: a screen REVERTING to a bare
// `isArabic() ? x.nameAr : x.nameEn`, which is how every one of these sites was
// written before. One spec per screen, each asserting the null case.
//
// HOW THE SCREENS ARE BUILT. Each component's template is overridden to empty,
// so nothing in it is instantiated, and no change detection runs, so ngOnInit
// and its loads never fire. What remains is the real class: its real methods
// and computeds, with LanguageService and TranslateService real and every data
// service a stub nothing here reaches. Six of these components had no spec at
// all; this is the cheapest construction that still runs their real code.
//
// Each case runs in an ARABIC session and carries its own guard first: a
// record WITH an Arabic name shows it. Without that, "shows English" would also
// pass in an English session, or with a method that never reads Arabic at all.

/** A data service nothing in these tests reaches: any call returns empty. */
function stubService(): unknown {
  const handler: ProxyHandler<() => unknown> = {
    get: (_t, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : stubService()),
    apply: () => of([]),
  };
  return new Proxy(() => undefined, handler);
}

const STUBBED: Type<unknown>[] = [
  NavigationAccessService, AuthService, FormatService, CommitteeService, LookupService,
  UserService, OrgUnitService, OrgUnitHeadService, OrgPositionService, RoleService,
  TaskService, WorkflowService, WorkflowTemplateService,
];

const confirm = jasmine.createSpy('confirm');

// Overrides MUST precede the first inject(): injecting instantiates the test
// module, after which TestBed refuses overrideComponent. So the switch to an
// Arabic session happens here, after the override, not in beforeEach.
function build<T>(component: Type<T>, inputs: Record<string, unknown> = {}): T {
  TestBed.overrideComponent(component, { set: { template: '', imports: [] } });
  TestBed.inject(TranslateService).use('ar');
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  return fixture.componentInstance;
}

// A partial DTO: these tests read two or three fields of each record, and the
// full shapes would bury the null case being asserted.
const as = <T>(value: object): T => value as unknown as T;

const AR = 'لجنة الجودة';

function configure(): void {
  confirm.calls.reset();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1' }) } } },
      { provide: ConfirmationService, useValue: { confirm } },
      ...STUBBED.map((provide) => ({ provide, useValue: stubService() })),
    ],
  });
}

// The CC-8 order: tear the module down BEFORE resetting <html>, or a pending
// LanguageService effect rewrites dir="rtl" after the reset and leaks into
// every later spec.
function teardown(): void {
  TestBed.resetTestingModule();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
}

describe('swept screens fall back to the English name (ACC-160)', () => {
  beforeEach(configure);
  afterEach(teardown);

  // The guard every case below relies on: the session really is Arabic.
  it('runs in an Arabic session', () => {
    build(RoleListComponent);
    expect(TestBed.inject(LanguageService).isArabic()).toBeTrue();
  });

  describe('committee-detail', () => {
    it('names the committee in English when it has no Arabic name', () => {
      const c = build(CommitteeDetailComponent);
      expect(c.displayName(as({ nameEn: 'Quality Committee', nameAr: AR }))).toBe(AR);
      expect(c.displayName(as({ nameEn: 'Quality Committee', nameAr: null }))).toBe('Quality Committee');
    });

    it('labels a committee type and a member role in English when they have no Arabic label', () => {
      const c = build(CommitteeDetailComponent);
      c.committeeTypes.set([as({ id: 't1', labelEn: 'Board', labelAr: null })]);
      c.memberRoles.set([as({ id: 'r1', labelEn: 'Secretary', labelAr: null })]);
      expect(c.typeLabel('t1')).toBe('Board');
      expect(c.memberRoleLabel('r1')).toBe('Secretary');
    });

    // THE `?? ''` BLANK. Before ACC-160 these returned '' in this case.
    it('names the stage in English rather than leaving it blank', () => {
      const c = build(CommitteeDetailComponent);
      const sub = as<Parameters<typeof c.subCommitteeStage>[0]>({
        id: 'c-1', currentStageNameEn: 'Active', currentStageNameAr: null,
      });
      expect(c.subCommitteeStage(sub)).toBe('Active');
      c.allCommittees.set([sub]);
      expect(c.currentStageName()).toBe('Active');
    });

    it('still shows nothing when there is no stage at all', () => {
      const c = build(CommitteeDetailComponent);
      expect(
        c.subCommitteeStage(as({ id: 'x', currentStageNameEn: null, currentStageNameAr: null })),
      ).toBe('');
    });
  });

  describe('committee-list', () => {
    it('names the committee and its type in English when neither has Arabic', () => {
      const c = build(CommitteeListComponent);
      expect(c.displayName(as({ nameEn: 'Quality Committee', nameAr: AR }))).toBe(AR);
      expect(c.displayName(as({ nameEn: 'Quality Committee', nameAr: null }))).toBe('Quality Committee');
      c.committeeTypes.set([as({ id: 't1', labelEn: 'Board', labelAr: null })]);
      expect(c.typeLabel('t1')).toBe('Board');
    });
  });

  // ── the *LabelField() resolvers, now resolved labels ──────────────────────
  describe('committee-form', () => {
    it('offers committee types and parent committees with a label, never a blank option', () => {
      const c = build(CommitteeFormComponent);
      c.committeeTypes.set([
        as({ id: 't1', labelEn: 'Board', labelAr: 'مجلس' }),
        as({ id: 't2', labelEn: 'Taskforce', labelAr: null }),
      ]);
      c.parentOptions.set([as({ id: 'c1', nameEn: 'Quality Committee', nameAr: null })]);
      expect(c.committeeTypeOptions().map((o) => o.label)).toEqual(['مجلس', 'Taskforce']);
      expect(c.parentCommitteeOptions()[0]!.label).toBe('Quality Committee');
    });
  });

  describe('committee-member-form', () => {
    it('offers member roles with a label, never a blank option', () => {
      const c = build(CommitteeMemberFormComponent, { committeeId: 'c-1' });
      c.memberRoles.set([
        as({ id: 'r1', labelEn: 'Chairman', labelAr: 'رئيس' }),
        as({ id: 'r2', labelEn: 'Observer', labelAr: null }),
      ]);
      expect(c.memberRoleOptions().map((o) => o.label)).toEqual(['رئيس', 'Observer']);
    });
  });

  describe('workflow-stage-form', () => {
    it('offers committee roles with a label, never a blank option', () => {
      const c = build(WorkflowStageFormComponent);
      c.committeeRoles.set([
        as({ id: 'r1', labelEn: 'Chairman', labelAr: 'رئيس' }),
        as({ id: 'r2', labelEn: 'Observer', labelAr: null }),
      ]);
      expect(c.committeeRoleOptions().map((o) => o.label)).toEqual(['رئيس', 'Observer']);
    });
  });

  describe('invite-user', () => {
    it('offers positions with a label, never a blank option', () => {
      const c = build(InviteUserComponent);
      c.positions.set([
        as({ id: 'p1', nameEn: 'Head Nurse', nameAr: 'رئيسة التمريض', isActive: true }),
        as({ id: 'p2', nameEn: 'Charge Nurse', nameAr: null, isActive: true }),
      ]);
      expect(c.positionOptions().map((o) => o.label)).toEqual(['رئيسة التمريض', 'Charge Nurse']);
    });
  });

  // ── workflow ──────────────────────────────────────────────────────────────
  describe('workflow-stage-indicator', () => {
    it('names a stage and a transition in English rather than leaving them blank', () => {
      const c = build(WorkflowStageIndicatorComponent, { instance: as({ id: 'i-1' }) });
      expect(c.stageName('Active', 'نشطة')).toBe('نشطة');
      expect(c.stageName('Active', null)).toBe('Active');
      expect(c.transitionLabel('Approve', null)).toBe('Approve');
      expect(c.transitionLabel(null, null)).toBe('');
    });
  });

  describe('workflow-transition-actions', () => {
    it('labels a transition button in English when it has no Arabic label', () => {
      const c = build(WorkflowTransitionActionsComponent);
      expect(c.transitionLabel(as({ labelEn: 'Approve', labelAr: 'اعتماد' }))).toBe('اعتماد');
      expect(c.transitionLabel(as({ labelEn: 'Approve', labelAr: null }))).toBe('Approve');
    });
  });

  describe('workflow-stage-list', () => {
    it('names the template in English when it has no Arabic name', () => {
      const c = build(WorkflowStageListComponent);
      c.template.set(as({ nameEn: 'Committee workflow', nameAr: null }));
      expect(c.templateName()).toBe('Committee workflow');
    });
  });

  describe('workflow-transition-editor', () => {
    it('names the trigger role in English when it has no Arabic name', () => {
      const c = build(WorkflowTransitionEditorComponent);
      c.roles.set([as({ id: 'ro1', nameEn: 'Quality Manager', nameAr: null })]);
      expect(
        c.triggerRoleLabel(as({ triggerCondition: 'ROLE_BASED', triggerRoleId: 'ro1' })),
      ).toBe('Quality Manager');
    });
  });

  // ── org-unit-form: an inferred computed, and THE ${} HAZARD ───────────────
  describe('org-unit-form', () => {
    const department = { id: 'tv1', key: 'department', labelEn: 'Department', labelAr: null };

    it('labels the root unit type in English when it has no Arabic label', () => {
      const c = build(OrgUnitFormComponent, { unit: as({ parentId: null, typeValue: department }) });
      expect(c.rootTypeLabel()).toBe('Department');
    });

    // Point 4. A template literal renders null as the four characters "null",
    // and this label was a template literal around a bare ternary.
    it('never renders the TEXT "null" for a retired type with no Arabic label', () => {
      const c = build(OrgUnitFormComponent, { unit: as({ parentId: 'p', typeValue: department }) });
      const retired = c.typeOptions().find((o) => o.value === 'tv1');
      expect(retired).withContext('the held type is re-added as retired').toBeDefined();
      expect(retired!.label).not.toContain('null');
      expect(retired!.label.startsWith('Department')).toBeTrue();
    });

    it('labels a selectable type in English when it has no Arabic label', () => {
      const c = build(OrgUnitFormComponent);
      c['typeValues'].set([as({ id: 'tv2', key: 'ward', labelEn: 'Ward', labelAr: null,
        labelOverrideEn: null, labelOverrideAr: null })]);
      expect(c.typeOptions().map((o) => o.label)).toEqual(['Ward']);
    });
  });

  // ── roles ─────────────────────────────────────────────────────────────────
  describe('manage-roles', () => {
    it('names a role in English when it has no Arabic name', () => {
      const c = build(ManageRolesComponent);
      expect(c.roleName(as({ nameEn: 'Auditor', nameAr: 'مدقق' }))).toBe('مدقق');
      expect(c.roleName(as({ nameEn: 'Auditor', nameAr: null }))).toBe('Auditor');
    });
  });

  describe('role-permission-matrix', () => {
    it('names the role in English when it has no Arabic name', () => {
      const c = build(RolePermissionMatrixComponent);
      c.role.set(as({ nameEn: 'Auditor', nameAr: null }));
      expect(c.roleName()).toBe('Auditor');
    });
  });

  describe('role-list', () => {
    it('names the role in English when it has no Arabic name', () => {
      const c = build(RoleListComponent);
      expect(c.displayLabel(as({ nameEn: 'Auditor', nameAr: null }))).toBe('Auditor');
    });

    // The defect beside the null case: this ignored the language entirely, and
    // named the role in Arabic inside an English sentence.
    it('names the role in ENGLISH in an English session, even when it has an Arabic name', () => {
      const c = build(RoleListComponent);
      TestBed.inject(TranslateService).use('en');
      expect(c.displayLabel(as({ nameEn: 'Auditor', nameAr: 'مدقق' }))).toBe('Auditor');
    });
  });

  describe('user-list', () => {
    it('names roles in English in the reactivation message when they have no Arabic name', () => {
      const c = build(UserListComponent);
      TestBed.inject(TranslateService).setTranslation(
        'ar',
        { user: { reactivateRoles: '{{roles}}', reactivateConfirm: '{{roles}}' } },
        true,
      );
      c['openReactivateConfirm'](
        as({ id: 'u1', name: 'Hessa' }),
        [{ nameEn: 'Auditor', nameAr: 'مدقق' }, { nameEn: 'Records Officer', nameAr: null }],
        false,
      );
      expect(confirm).toHaveBeenCalled();
      expect(confirm.calls.mostRecent().args[0].message).toBe('مدقق, Records Officer');
    });
  });

  describe('lookup-value-list', () => {
    it('labels a value in English when it has no Arabic label or override', () => {
      const c = build(LookupValueListComponent);
      expect(
        c.effectiveLabel(as({ labelEn: 'Policy', labelAr: null, labelOverrideEn: null, labelOverrideAr: null })),
      ).toBe('Policy');
      // An English-only rename keeps the English rename, not the seeded word.
      expect(
        c.effectiveLabel(as({ labelEn: 'Policy', labelAr: null, labelOverrideEn: 'Directive', labelOverrideAr: null })),
      ).toBe('Directive');
    });
  });

  // ── ACC-89 items 1–3, shipped with ACC-160 ────────────────────────────────
  // The OPPOSITE defect to the rest of this file: a stored Arabic name that
  // display code never read. So the Arabic half is the assertion that matters,
  // and the null half pins that fixing it did not introduce a blank.
  describe('ACC-89 — English-only displays now follow the language', () => {
    it('transition editor: the table shows the transition label and target stage in Arabic', () => {
      const c = build(WorkflowTransitionEditorComponent);
      c.availableStages = [
        as({ id: 's1', nameEn: 'Approved', nameAr: 'معتمد' }),
        as({ id: 's2', nameEn: 'Closed', nameAr: null }),
      ];
      expect(c.transitionLabel(as({ labelEn: 'Approve', labelAr: 'اعتماد' }))).toBe('اعتماد');
      expect(c.transitionLabel(as({ labelEn: 'Approve', labelAr: null }))).toBe('Approve');
      expect(c.stageName('s1')).toBe('معتمد');
      expect(c.stageName('s2')).toBe('Closed');
      // An unknown id is still said plainly rather than hidden.
      expect(c.stageName('missing')).toBe('missing');
    });

    it("user role assignment: a user's roles are named in Arabic", () => {
      const c = build(UserRoleAssignmentComponent, { userId: 'u1' });
      expect(c.roleName(as({ nameEn: 'Auditor', nameAr: 'مدقق' }))).toBe('مدقق');
      expect(c.roleName(as({ nameEn: 'Auditor', nameAr: null }))).toBe('Auditor');
    });
  });
});

// ── THE FORMS: the Arabic name is optional, the English one is not ──────────
//
// ACC-160's first acceptance criterion, at the form layer: each of the six can
// be created and edited with the Arabic field empty. Removing the validator
// was half of it; the asterisks were the other half, and four of these forms
// hard-code theirs rather than deriving it (am-field derives its own, so the
// two lookup forms needed only the validator).
describe('every form accepts an empty Arabic name (ACC-160)', () => {
  beforeEach(configure);
  afterEach(teardown);

  type FormGroupLike = {
    controls: Record<string, { setValue(v: string): void; valid: boolean; hasError(e: string): boolean }>;
  };
  const forms: [string, () => FormGroupLike, string, string, number][] = [
    ['committee-form', () => build(CommitteeFormComponent).form as never, 'nameEn', 'nameAr', 150],
    ['role-form', () => build(RoleFormComponent).form as never, 'nameEn', 'nameAr', 100],
    ['lookup-value-form', () => build(LookupValueFormComponent).form as never, 'labelEn', 'labelAr', 255],
    ['lookup-value-list override', () => build(LookupValueListComponent).overrideForm as never, 'labelEn', 'labelAr', 255],
    ['workflow-stage-form', () => build(WorkflowStageFormComponent).form as never, 'nameEn', 'nameAr', 100],
    ['transition editor (add)', () => build(WorkflowTransitionEditorComponent).addForm as never, 'labelEn', 'labelAr', 100],
    ['transition editor (edit)', () => build(WorkflowTransitionEditorComponent).editForm as never, 'labelEn', 'labelAr', 100],
  ];

  for (const [name, formOf, en, ar, max] of forms) {
    describe(name, () => {
      // Guard first: if NOTHING on this form were required, "the Arabic name is
      // accepted empty" would prove nothing about the Arabic name.
      it('still requires the English name', () => {
        const form = formOf();
        form.controls[en]!.setValue('');
        expect(form.controls[en]!.hasError('required')).toBeTrue();
      });

      it('accepts an empty Arabic name', () => {
        const form = formOf();
        form.controls[ar]!.setValue('');
        expect(form.controls[ar]!.valid).toBeTrue();
      });

      it('still caps the Arabic name at its length', () => {
        const form = formOf();
        form.controls[ar]!.setValue('ا'.repeat(max + 1));
        expect(form.controls[ar]!.hasError('maxlength')).toBeTrue();
      });
    });
  }
});

