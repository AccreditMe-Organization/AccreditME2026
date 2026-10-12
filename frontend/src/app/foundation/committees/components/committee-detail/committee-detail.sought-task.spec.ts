import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, ParamMap } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { BehaviorSubject, of } from 'rxjs';
import { provideTranslateService } from '@ngx-translate/core';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AuthService } from '../../../../core/services/auth.service';
import { FormatService } from '../../../../core/formatting';
import { CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { TaskService, ITaskWithAssigneesDto } from '../../../tasks/services/task.service';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { CommitteeDetailComponent } from './committee-detail.component';

// ACC-208 (Ahmad, 12 Oct, D2) — a "Can't move yet" link names a task by
// ?task=<id>, because there is no task page. This page answers it: the row is
// sought out (highlighted, then scrolled to and focused), the parameter is
// removed so Back and a reload do not repeat it, and a task the list does not
// hold yet is fetched first. The link is followed from this same page, so the
// parameter is read as it CHANGES, not once.

function stubService(): unknown {
  const handler: ProxyHandler<() => unknown> = {
    get: (_t, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : stubService()),
    apply: () => of([]),
  };
  return new Proxy(() => undefined, handler);
}

const TASK = { id: 'task-1', title: 'Check the terms', status: 'PENDING', assignees: [] } as unknown as ITaskWithAssigneesDto;

describe('CommitteeDetailComponent — ?task=<id> (ACC-208, D2)', () => {
  let queryParams: BehaviorSubject<ParamMap>;
  let navigate: jasmine.Spy;
  let getForSource: jasmine.Spy;

  function build(listed: ITaskWithAssigneesDto[][]): CommitteeDetailComponent {
    queryParams = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    getForSource = jasmine.createSpy('getForSource').and.returnValues(...listed.map((tasks) => of(tasks)));
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
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
        { provide: TaskService, useValue: { getForSource } },
        ...[FormatService, CommitteeService, LookupService, UserService, OrgUnitService, WorkflowService].map(
          (provide) => ({ provide, useValue: stubService() }),
        ),
      ],
    });
    TestBed.overrideComponent(CommitteeDetailComponent, { set: { template: '', imports: [] } });
    const component = TestBed.createComponent(CommitteeDetailComponent).componentInstance;
    component.loadTasks();
    (component as unknown as { watchSoughtTask: () => void }).watchSoughtTask();
    return component;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('seeks out a task the list holds, and removes the parameter so Back does not repeat it', () => {
    const component = build([[TASK]]);
    queryParams.next(convertToParamMap({ task: 'task-1' }));

    expect(component.soughtTaskId()).toBe('task-1');
    expect(navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { task: null }, queryParamsHandling: 'merge', replaceUrl: true }),
    );
    expect(getForSource).toHaveBeenCalledTimes(1);
  });

  it('reads the list again for a task it does not hold yet, then seeks it out', () => {
    const component = build([[], [TASK]]);
    queryParams.next(convertToParamMap({ task: 'task-1' }));

    expect(getForSource).toHaveBeenCalledTimes(2);
    expect(component.soughtTaskId()).toBe('task-1');
  });

  it('does nothing without the parameter', () => {
    const component = build([[TASK]]);
    queryParams.next(convertToParamMap({ other: 'x' }));
    expect(component.soughtTaskId()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
