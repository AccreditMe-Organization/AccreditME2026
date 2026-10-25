import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
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

// ACC-264 — the bell is an icon: its name is what a screen reader hears, and the
// unread badge is drawn, not read, so the name carries the count.
describe('NotificationBellComponent — the bell is named (ACC-264)', () => {
  preserveDocumentLanguage();

  function render(language: 'en' | 'ar', unread: number): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: NotificationService, useValue: { markRead: () => of({}), unreadCount: () => of({ count: unread }), list: () => of({ data: [] }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    const fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.componentInstance.unreadCount.set(unread);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const name = (el: HTMLElement) => el.querySelector('[data-testid="notification-bell"] button')!.getAttribute('aria-label');

  it('names the bell with how many are unread', () => {
    expect(name(render('en', 3))).toBe('Notifications, 3 unread');
    expect(name(render('en', 1))).toBe('Notifications, 1 unread');
    expect(name(render('en', 0))).toBe('Notifications, 0 unread');
  });

  it('in Arabic, with the plural form each count takes', () => {
    expect(name(render('ar', 0))).toBe('الإشعارات، لا جديد');
    expect(name(render('ar', 1))).toBe('الإشعارات، إشعار واحد غير مقروء');
    expect(name(render('ar', 2))).toBe('الإشعارات، إشعاران غير مقروءين');
    expect(name(render('ar', 5))).toBe('الإشعارات، 5 إشعارات غير مقروءة');
    expect(name(render('ar', 11))).toBe('الإشعارات، 11 إشعارًا غير مقروء');
  });
});
