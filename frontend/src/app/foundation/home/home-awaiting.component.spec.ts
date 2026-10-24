import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { FormatService } from '../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { ChangeRequestDto, ChangeRequestService } from '../committees/change-requests/change-request.service';
import { REQUEST } from '../committees/change-requests/change-request.testing';
import { TaskRequestForDecisionDto, TaskService } from '../tasks/services/task.service';
import { HomeAwaitingComponent } from './home-awaiting.component';
import { preserveDocumentLanguage } from '../../../testing/document-language';

function taskRequest(id: string, createdAt: string, over: Partial<TaskRequestForDecisionDto> = {}): TaskRequestForDecisionDto {
  return {
    id,
    type: 'EXTENSION',
    requestedDueAt: '2026-10-30T09:00:00Z',
    holdUntil: null,
    requestedById: 'u-sara',
    requestedByName: 'Sara Al-Qahtani',
    reason: 'Waiting for the lab.',
    createdAt,
    task: { id: `t-${id}`, title: `Task ${id}`, sourceType: 'COMMITTEE', sourceId: 'c-1', status: 'IN_PROGRESS', priority: 'MEDIUM', dueAt: null },
    ...over,
  };
}

// ACC-240 — Home's "Awaiting my action" (plan §3.5, Q-B).
describe('HomeAwaitingComponent (ACC-240)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<HomeAwaitingComponent>;
  let format: FormatService;
  let approver: boolean;
  let changes: () => Observable<ChangeRequestDto[]>;
  let tasks: () => Observable<TaskRequestForDecisionDto[]>;
  let changeCalls: number;

  beforeEach(() => {
    approver = true;
    changeCalls = 0;
    changes = () => of([]);
    tasks = () => of([]);
    TestBed.configureTestingModule({
      imports: [HomeAwaitingComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => p === 'committees:approve' && approver } },
        {
          provide: ChangeRequestService,
          useValue: {
            awaitingDecision: () => {
              changeCalls++;
              return changes();
            },
          },
        },
        { provide: TaskService, useValue: { getAwaitingDecision: () => tasks() } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    format = TestBed.inject(FormatService);
  });

  function render(): HTMLElement {
    fixture = TestBed.createComponent(HomeAwaitingComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const rows = (el: HTMLElement) => Array.from(el.querySelectorAll('li'));

  it('an approver with a change request: the card, its row linked to the request page', () => {
    changes = () => of([REQUEST()]);
    const el = render();
    expect(text(el.querySelector('h3'))).toBe('Awaiting my action');
    expect(rows(el).length).toBe(1);
    const link = el.querySelector('[data-testid="home-awaiting-row"]')!;
    expect(text(link)).toBe('Change request 3 · Patient Experience Committee');
    expect(link.getAttribute('href')).toBe('/committees/c-1/change-requests/cr-1');
    expect(text(rows(el)[0].querySelector('span'))).toBe(`Nora Al-Otaibi · submitted ${format.date('2026-10-18T09:00:00Z')}`);
  });

  it('nothing waiting: no card at all', () => {
    expect(render().querySelector('[data-testid="home-awaiting"]')).toBeNull();
  });

  it('both reads failed: no card, and no error on Home', () => {
    changes = () => throwError(() => new Error('boom'));
    tasks = () => throwError(() => new Error('boom'));
    const el = render();
    expect(el.textContent?.trim()).toBe('');
  });

  it('without committees:approve the change requests are not read', () => {
    approver = false;
    tasks = () => of([taskRequest('r1', '2026-10-17T09:00:00Z')]);
    const el = render();
    expect(changeCalls).toBe(0);
    expect(rows(el).length).toBe(1);
  });

  it('task-request rows: the task, what was asked, linked to My Tasks on that request', () => {
    approver = false;
    tasks = () => of([taskRequest('r1', '2026-10-17T09:00:00Z'), taskRequest('r2', '2026-10-16T09:00:00Z', { type: 'ON_HOLD', requestedDueAt: null, holdUntil: '2026-11-02T00:00:00Z' })]);
    const el = render();
    const [first, second] = rows(el);
    expect(text(first.querySelector('a'))).toBe('Task r2');
    expect(text(first.querySelector('span'))).toBe(`Sara Al-Qahtani asks to put it on hold until ${format.date('2026-11-02T00:00:00Z')}`);
    expect(first.querySelector('a')!.getAttribute('href')).toBe('/tasks?request=r2');
    expect(text(second.querySelector('span'))).toBe(`Sara Al-Qahtani asks for the due date to move to ${format.dateTime('2026-10-30T09:00:00Z')}`);
    expect(el.querySelector('[data-testid="home-awaiting-all"]')!.getAttribute('href')).toBe('/tasks');
  });

  it('both kinds together, oldest first, five rows', () => {
    changes = () =>
      of([
        REQUEST({ id: 'cr-a', number: 1, submittedAt: '2026-10-10T09:00:00Z' }),
        REQUEST({ id: 'cr-b', number: 2, submittedAt: '2026-10-14T09:00:00Z' }),
        REQUEST({ id: 'cr-c', number: 4, submittedAt: '2026-10-20T09:00:00Z' }),
      ]);
    tasks = () =>
      of([
        taskRequest('r1', '2026-10-12T09:00:00Z'),
        taskRequest('r2', '2026-10-18T09:00:00Z'),
        taskRequest('r3', '2026-10-11T09:00:00Z'),
        taskRequest('r4', '2026-10-21T09:00:00Z'),
      ]);
    const el = render();
    expect(rows(el).map((li) => `${li.getAttribute('data-awaiting-kind')}:${text(li.querySelector('a'))}`)).toEqual([
      'change:Change request 1 · Patient Experience Committee',
      'task:Task r3',
      'task:Task r1',
      'change:Change request 2 · Patient Experience Committee',
      'task:Task r2',
    ]);
  });

  it('only change requests: no "See all in My Tasks", which would not list them', () => {
    changes = () => of([REQUEST()]);
    expect(render().querySelector('[data-testid="home-awaiting-all"]')).toBeNull();
  });

  it('Arabic', () => {
    TestBed.inject(TranslateService).use('ar');
    changes = () => of([REQUEST({ committeeNameAr: 'لجنة تجربة المرضى' })]);
    const el = render();
    expect(text(el.querySelector('h3'))).toBe(ar.home.awaiting);
    expect(text(el.querySelector('[data-testid="home-awaiting-row"]'))).toBe(ar.home.awaitingChange.replace('{{n}}', '3').replace('{{committee}}', 'لجنة تجربة المرضى'));
  });
});
