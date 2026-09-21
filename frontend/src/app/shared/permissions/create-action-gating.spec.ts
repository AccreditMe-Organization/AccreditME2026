// ACC-118 — every list page's create action is hidden from a caller who cannot
// use it.
//
// ## Why one parameterised file rather than ten
//
// The assertion is identical on all ten pages, and writing it ten times invites
// ten slightly different versions of it — one of which ends up asserting only
// the direction that happens to pass. Here the table is the only thing that
// varies, so a page is added by adding a row.
//
// ## BOTH DIRECTIONS, ALWAYS
//
// A spec that only asserts "absent without the permission" passes when the gate
// hides the button from EVERYONE, which is a worse bug than the one being
// fixed. A spec that only asserts "present with it" passes when the gate is
// removed entirely. Neither direction is evidence on its own, so every row runs
// both against the same rendered component.
//
// ## Rendered, not computed
//
// Asserting on `canCreate()` alone would pass while the template ignored it —
// exactly the defect this ticket exists to fix, since `canCreate` did not exist
// before it. So each case renders the real template and queries the DOM.
import { Component, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import {
  TranslateNoOpLoader,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { LanguageService } from '../../core/services/language.service';

import { CommitteeListComponent } from '../../foundation/committees/components/committee-list/committee-list.component';
import { CommitteeService } from '../../foundation/committees/services/committee.service';
import { LookupValueListComponent } from '../../foundation/lookup/components/lookup-value-list/lookup-value-list.component';
import { LookupService } from '../../foundation/lookup/services/lookup.service';
import { PositionListComponent } from '../../foundation/org-position/components/position-list/position-list.component';
import { OrgPositionService } from '../../foundation/org-position/services/org-position.service';
import { RoleListComponent } from '../../foundation/roles/components/role-list/role-list.component';
import { RoleService } from '../../foundation/roles/services/role.service';
import { TaskListComponent } from '../../foundation/tasks/components/task-list/task-list.component';
import { TaskService } from '../../foundation/tasks/services/task.service';
import { WorkflowStageListComponent } from '../../foundation/workflow/components/workflow-stage-list/workflow-stage-list.component';
import { WorkflowTemplateService } from '../../foundation/workflow/services/workflow-template.service';
import { PublicHolidayListComponent } from '../../foundation/working-calendar/components/public-holiday-list/public-holiday-list.component';
import { WorkingCalendarService } from '../../foundation/working-calendar/services/working-calendar.service';
import { AiCreditPackListComponent } from '../../platform/components/ai-credit-pack-list/ai-credit-pack-list.component';
import { AiFeatureCostListComponent } from '../../platform/components/ai-feature-cost-list/ai-feature-cost-list.component';
import { PlanListComponent } from '../../platform/components/plan-list/plan-list.component';
import { PlanService } from '../../platform/services/plan.service';
import { OrgUnitTreeComponent } from '../../foundation/organization/components/org-unit-tree/org-unit-tree.component';
import { OrgUnitService } from '../../foundation/organization/services/org-unit.service';
import { UserListComponent } from '../../foundation/user/components/user-list/user-list.component';
import { UserService } from '../../foundation/user/services/user.service';
import { TenantListComponent } from '../../platform/components/tenant-list/tenant-list.component';
import { PlatformTenantService } from '../../platform/services/platform-tenant.service';

/**
 * Every method returns an empty observable and every property an empty array,
 * which is enough for these components to reach first render. The point is the
 * create action, not the data: a page with no rows still shows its create
 * button, so an empty stub is the cleanest possible fixture for this question.
 */
function serviceStub(): unknown {
  const stub = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'then') return undefined; // not a thenable
        return (..._args: unknown[]) => of([]);
      },
    },
  );
  return stub;
}

interface Case {
  readonly page: string;
  readonly component: Type<unknown>;
  /** The permission the ENDPOINT enforces — read off its @Permissions(). */
  readonly permission: string;
  /** Platform screens are gated by PlatformGuard, which needs both halves. */
  readonly platform?: boolean;
  readonly services: readonly Type<unknown>[];
  /**
   * Concrete stubs for pages whose create action only renders once real data
   * has loaded. Kept per-case rather than folded into serviceStub(), so the
   * default stays "returns nothing" and a page needing more has to say so.
   */
  readonly overrides?: ReadonlyMap<Type<unknown>, unknown>;
}

// The permission on each row is the one its endpoint's decorator carries, not
// one inferred from the entity name. Two would have been wrong if inferred:
// public-holiday is org:manage, and role is roles:manage rather than a
// roles:create, which does not exist.
const CASES: readonly Case[] = [
  {
    page: 'committee-list',
    component: CommitteeListComponent,
    permission: 'committees:create',
    services: [CommitteeService, LookupService],
  },
  {
    page: 'lookup-value-list',
    component: LookupValueListComponent,
    permission: 'lookups:manage',
    services: [LookupService],
    // This page's button carries TWO conditions — isExtensible AND the
    // permission — so the fixture has to satisfy the first for the second to
    // be what the test is measuring. A non-extensible category would hide the
    // button for a reason that has nothing to do with permissions, and the
    // ABSENT case would then pass vacuously.
    overrides: new Map<Type<unknown>, unknown>([
      [
        LookupService,
        {
          getCategoryByKey: () =>
            of({ id: 'c1', key: 'k', nameEn: 'K', nameAr: 'K', isSystem: false, isExtensible: true }),
          getValues: () => of([]),
        },
      ],
    ]),
  },
  {
    page: 'position-list',
    component: PositionListComponent,
    permission: 'positions:manage',
    services: [OrgPositionService],
  },
  {
    page: 'role-list',
    component: RoleListComponent,
    permission: 'roles:manage',
    services: [RoleService],
  },
  {
    page: 'task-list',
    component: TaskListComponent,
    permission: 'tasks:create',
    services: [TaskService],
  },
  {
    page: 'workflow-stage-list',
    component: WorkflowStageListComponent,
    permission: 'workflows:manage',
    services: [WorkflowTemplateService],
  },
  {
    page: 'public-holiday-list',
    component: PublicHolidayListComponent,
    permission: 'org:manage',
    services: [WorkingCalendarService],
  },
  {
    page: 'ai-credit-pack-list',
    component: AiCreditPackListComponent,
    permission: 'platform:admin',
    platform: true,
    services: [PlanService],
  },
  {
    page: 'ai-feature-cost-list',
    component: AiFeatureCostListComponent,
    permission: 'platform:admin',
    platform: true,
    services: [PlanService],
  },
  {
    page: 'plan-list',
    component: PlanListComponent,
    permission: 'platform:admin',
    platform: true,
    services: [PlanService],
  },

  // The three below were NOT in the ticket's list of ten. check-create-gating
  // found them, which is the whole argument for having a scan as well as
  // specs: the ten came from a person signing in, and a person stops looking.
  {
    page: 'org-unit-tree',
    component: OrgUnitTreeComponent,
    permission: 'org:manage',
    services: [OrgUnitService],
  },
  {
    page: 'user-list',
    component: UserListComponent,
    // users:invite, not users:manage — both exist and they are not the same.
    permission: 'users:invite',
    services: [UserService],
  },
  {
    page: 'tenant-list',
    component: TenantListComponent,
    permission: 'platform:admin',
    platform: true,
    services: [PlatformTenantService],
  },
];

@Component({ standalone: true, template: '' })
class BlankComponent {}

function render(testCase: Case, permissions: string[]): ComponentFixture<unknown> {
  const access = {
    hasPermission: (p: string) => permissions.includes(p),
    isPlatformAdmin: () => permissions.includes('platform:admin'),
    permissions: () => permissions,
    modules: () => ({}),
    tenantName: () => 'Test',
    loadState: () => 'loaded',
    loadAccess: () => of(null),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [testCase.component],
    providers: [
      provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ConfirmationService,
      { provide: NavigationAccessService, useValue: access },
      { provide: LanguageService, useValue: { isArabic: () => false, isRtl: () => false } },
      { provide: Router, useValue: { navigate: () => Promise.resolve(true), url: '/' } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: new Map(), queryParamMap: new Map(), params: {}, queryParams: {} },
          paramMap: of(new Map()),
          queryParamMap: of(new Map()),
          params: of({}),
          queryParams: of({}),
        },
      },
      ...testCase.services.map((s) => ({
        provide: s,
        useValue: testCase.overrides?.get(s) ?? serviceStub(),
      })),
    ],
  });
  // The create button is what is under test; child routes are not.
  TestBed.overrideComponent(testCase.component, { set: {} });

  const fixture = TestBed.createComponent(testCase.component);
  fixture.detectChanges();
  return fixture;
}

/**
 * The create action is the only `pi-plus` control in a page header's action
 * slot. Queried by that rather than by translated label text, which would make
 * the assertion depend on copy.
 */
function createActionCount(fixture: ComponentFixture<unknown>): number {
  const root = fixture.nativeElement as HTMLElement;
  // Counts BUTTONS, not icon markers. A rendered p-button carries both the
  // `icon="pi pi-plus"` attribute and a `.pi-plus` child, so matching markers
  // counted every control twice and made the PRESENT direction expect 2.
  return Array.from(root.querySelectorAll('[pageActions] button')).filter((b) =>
    b.querySelector('.pi-plus'),
  ).length;
}

describe('ACC-118 — a list page hides its create action from a caller who cannot use it', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const testCase of CASES) {
    describe(testCase.page, () => {
      it(`is ABSENT without ${testCase.permission}`, () => {
        const fixture = render(testCase, []);
        expect(createActionCount(fixture)).toBe(0);
      });

      it(`is PRESENT with ${testCase.permission}`, () => {
        const fixture = render(testCase, [testCase.permission]);
        expect(createActionCount(fixture)).toBe(1);
      });

      // Hidden, not disabled: a disabled control still announces an action that
      // is not this caller's to take, which is what the ticket rules out.
      it('is removed from the DOM rather than disabled', () => {
        const fixture = render(testCase, []);
        const disabled = (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[pageActions] button[disabled]',
        );
        expect(disabled.length).toBe(0);
      });
    });
  }
});

describe('BlankComponent', () => {
  it('exists only to keep the harness importable', () => {
    expect(BlankComponent).toBeDefined();
  });
});
