import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, ParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { provideTranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { AuthService } from '../../../../core/services/auth.service';
import { TaskService } from '../../services/task.service';
import { MyTasksComponent } from './my-tasks.component';

// ACC-198 — a briefing item links to its row on My tasks: ?task=<id> for a
// task (in the list, or in Available) and ?request=<id> for a request waiting
// for the viewer's decision. The row is marked and focused, and the parameter
// removed. A record no longer here leaves the page ordinary.
describe('MyTasksComponent — ?task= and ?request= (ACC-198)', () => {
  let queryParams: BehaviorSubject<ParamMap>;
  let navigate: jasmine.Spy;

  function build(params: Record<string, string>): MyTasksComponent {
    queryParams = new BehaviorSubject<ParamMap>(convertToParamMap(params));
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({ lang: 'en' }),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams } },
        { provide: Router, useValue: { navigate } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
        { provide: FormatService, useValue: {} },
        { provide: LanguageService, useValue: { bilingual: (en: string) => en, isArabic: () => false } },
        {
          provide: TaskService,
          useValue: {
            getMyTasks: () => of([{ id: 'mine-1', title: 'Mine', status: 'PENDING' }]),
            getAvailable: () => of([{ id: 'pool-1', title: 'Pool', status: 'PENDING' }]),
            getAwaitingDecision: () => of([{ id: 'req-1', task: { id: 't' }, requestedById: 'other' }]),
          },
        },
      ],
    });
    TestBed.overrideComponent(MyTasksComponent, { set: { template: '', imports: [] } });
    const component = TestBed.createComponent(MyTasksComponent).componentInstance;
    component.ngOnInit();
    return component;
  }

  it('?task= for a task in my list marks that row and removes the parameter', () => {
    const c = build({ task: 'mine-1' });
    expect(c.soughtTaskId()).toBe('mine-1');
    expect(navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { task: null, request: null }, replaceUrl: true }));
  });

  it('?task= for a pool task finds it in Available', () => {
    expect(build({ task: 'pool-1' }).soughtTaskId()).toBe('pool-1');
  });

  it('?request= marks the row in Waiting for your decision', () => {
    const c = build({ request: 'req-1' });
    expect(c.soughtRequestId()).toBe('req-1');
    expect(c.soughtTaskId()).toBeNull();
  });

  it('a record no longer here leaves the page ordinary', () => {
    const c = build({ task: 'gone' });
    expect(c.soughtTaskId()).toBeNull();
    expect(c.soughtRequestId()).toBeNull();
  });

  it('no parameter, no navigation', () => {
    build({});
    expect(navigate).not.toHaveBeenCalled();
  });
});
