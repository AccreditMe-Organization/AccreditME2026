import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, ParamMap } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { BehaviorSubject, of } from 'rxjs';
import { provideTranslateService } from '@ngx-translate/core';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { FormatService } from '../../../../core/formatting';
import { CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { CommitteeDetailComponent } from './committee-detail.component';

// ACC-208 (Ahmad, 12 Oct, D2) — a "Can't move yet" link names a task by
// ?task=<id>. The page reads the parameter as it CHANGES (the link is followed
// from this same page), removes it so Back and a reload do not repeat it, and
// hands the task to the Tasks panel.
//
// ACC-229 — what the panel does with it (highlight it among the five, or open
// All tasks at it) is the panel's own spec: record-tasks-panel.component.spec.

function stubService(): unknown {
  const handler: ProxyHandler<() => unknown> = {
    get: (_t, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : stubService()),
    apply: () => of([]),
  };
  return new Proxy(() => undefined, handler);
}

describe('CommitteeDetailComponent — ?task=<id> (ACC-208, D2)', () => {
  let queryParams: BehaviorSubject<ParamMap>;
  let navigate: jasmine.Spy;

  function build(): CommitteeDetailComponent {
    queryParams = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({ lang: 'en' }),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1' }) }, queryParamMap: queryParams },
        },
        { provide: Router, useValue: { navigate } },
        { provide: ConfirmationService, useValue: { confirm: jasmine.createSpy('confirm') } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        ...[FormatService, CommitteeService, LookupService, UserService, OrgUnitService, WorkflowService].map(
          (provide) => ({ provide, useValue: stubService() }),
        ),
      ],
    });
    TestBed.overrideComponent(CommitteeDetailComponent, { set: { template: '', imports: [] } });
    const component = TestBed.createComponent(CommitteeDetailComponent).componentInstance;
    (component as unknown as { watchSoughtTask: () => void }).watchSoughtTask();
    return component;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('hands the task to the Tasks panel, and removes the parameter so Back does not repeat it', () => {
    const component = build();
    queryParams.next(convertToParamMap({ task: 'task-1' }));

    expect(component.soughtTask()).toEqual({ id: 'task-1' });
    expect(navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { task: null }, queryParamsHandling: 'merge', replaceUrl: true }),
    );
  });

  it('hands over the same task again as a NEW value, so a second click on the link is seen', () => {
    const component = build();
    queryParams.next(convertToParamMap({ task: 'task-1' }));
    const first = component.soughtTask();
    queryParams.next(convertToParamMap({ task: 'task-1' }));
    expect(component.soughtTask()).toEqual({ id: 'task-1' });
    expect(component.soughtTask()).not.toBe(first);
  });

  it('does nothing without the parameter', () => {
    const component = build();
    queryParams.next(convertToParamMap({ other: 'x' }));
    expect(component.soughtTask()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
