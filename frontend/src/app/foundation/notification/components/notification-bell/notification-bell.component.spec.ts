import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { provideFormatTesting } from '../../../../core/formatting/testing';
import { NotificationDto, NotificationService } from '../../services/notification.service';
import { NotificationBellComponent } from './notification-bell.component';

// ACC-228 — a task's notification opens the task's own page. Every task
// notification the server writes — assignment, rejection, a request and its
// decision, escalation — carries objectType 'Task' and the task's id.
describe('NotificationBellComponent — task notifications open the task page (ACC-228)', () => {
  const markRead = jasmine.createSpy('markRead').and.returnValue(of({}));

  function create(): NotificationBellComponent {
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: NotificationService, useValue: { markRead, unreadCount: () => of({ count: 0 }), list: () => of({ data: [] }) } },
      ],
    });
    // ngOnInit (the polling) is not run: these are the item rules alone.
    return TestBed.createComponent(NotificationBellComponent).componentInstance;
  }

  const item = (overrides: Partial<NotificationDto>): NotificationDto => ({
    id: 'n-1',
    titleEn: 'Task assigned',
    titleAr: null,
    bodyEn: '',
    bodyAr: null,
    channel: 'IN_APP',
    status: 'UNREAD',
    objectType: 'Task',
    objectId: 'task-1',
    createdAt: '2026-10-14T08:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => markRead.calls.reset());

  it('links a task notification to /tasks/:id', () => {
    expect(create().taskLink(item({}))).toEqual(['/tasks', 'task-1']);
  });

  it('leaves every other notification without a link, as before', () => {
    const bell = create();
    expect(bell.taskLink(item({ objectType: 'COMMITTEE', objectId: 'c-1' }))).toBeNull();
    expect(bell.taskLink(item({ objectType: null, objectId: null }))).toBeNull();
    expect(bell.taskLink(item({ objectType: 'Task', objectId: null }))).toBeNull();
  });

  it('still marks the notification read when it is opened', () => {
    create().onItemClick(item({}));
    expect(markRead).toHaveBeenCalledWith('n-1');
  });
});
