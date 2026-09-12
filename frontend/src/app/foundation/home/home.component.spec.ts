import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { HomeComponent } from './home.component';
import { TaskService } from '../tasks/services/task.service';
import { NotificationService } from '../notification/services/notification.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';

// ACC-70 — this component had no spec when first written, so nothing compiled
// its template, and a `{{ item.title }}` binding against a DTO that carries
// titleEn/titleAr shipped rendering blank. `tsc --noEmit` does not type-check
// Angular templates; only an AOT build or a spec that instantiates the
// component does. Hence the rendering assertions below rather than pure
// logic ones.
describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;

  const NOTIFICATION = {
    id: 'n-1',
    titleEn: 'Committee approved',
    titleAr: 'تمت الموافقة على اللجنة',
    bodyEn: 'body',
    bodyAr: null,
    channel: 'IN_APP',
    status: 'UNREAD',
    objectType: null,
    objectId: null,
    createdAt: '2026-09-01T10:00:00.000Z',
  };

  const task = (id: string, status: string) => ({
    id,
    organizationId: 'org-1',
    title: `Task ${id}`,
    description: null,
    sourceType: 'COMMITTEE',
    sourceId: 'c-1',
    sourceStageId: null,
    workflowInstanceId: null,
    meetingId: null,
    createdById: 'u-1',
    status,
    priority: 'MEDIUM',
    dueAt: null,
    dueDateOverridden: false,
    slaBreachedAt: null,
    completedAt: null,
    completedById: null,
    managerEscalatedAt: null,
    headEscalatedAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  });

  function setup(opts: {
    tasks?: unknown[];
    notifications?: unknown[];
    tasksFail?: boolean;
    notificationsFail?: boolean;
    arabic?: boolean;
  }): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideTranslateLoader(TranslateNoOpLoader),
        {
          provide: TaskService,
          useValue: {
            getMyTasks: () =>
              opts.tasksFail ? throwError(() => new Error('boom')) : of(opts.tasks ?? []),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            // ACC-78 — the inbox returns the shared { data, total, page,
            // pageSize } envelope now, not a bare array.
            list: () =>
              opts.notificationsFail
                ? throwError(() => new Error('boom'))
                : of({
                    data: opts.notifications ?? [],
                    total: (opts.notifications ?? []).length,
                    page: 1,
                    pageSize: 20,
                  }),
          },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ name: 'Dr. Yasser Al-Amri' }) } },
        { provide: LanguageService, useValue: { isArabic: () => opts.arabic ?? false } },
      ],
    });
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  // The bug this spec exists for.
  it('renders a notification title from titleEn, not a non-existent `title` field', () => {
    setup({ notifications: [NOTIFICATION] });

    expect(text()).toContain('Committee approved');
  });

  it('renders titleAr when the language is Arabic', () => {
    setup({ notifications: [NOTIFICATION], arabic: true });

    expect(text()).toContain('تمت الموافقة على اللجنة');
  });

  it('falls back to titleEn when titleAr is null in Arabic', () => {
    setup({ notifications: [{ ...NOTIFICATION, titleAr: null }], arabic: true });

    expect(text()).toContain('Committee approved');
  });

  it('shows only OPEN tasks — completed and cancelled work is not landing-page content', () => {
    setup({
      tasks: [task('1', 'PENDING'), task('2', 'COMPLETED'), task('3', 'CANCELLED'), task('4', 'OVERDUE')],
    });

    expect(text()).toContain('Task 1');
    expect(text()).toContain('Task 4');
    expect(text()).not.toContain('Task 2');
    expect(text()).not.toContain('Task 3');
  });

  // The zero-permission case this page exists for: neither endpoint is
  // permission-gated, so both panels render — empty, but present and honest.
  it('renders both panels for a user with no tasks and no notifications', () => {
    setup({ tasks: [], notifications: [] });

    expect(text()).toContain('home.myTasks');
    expect(text()).toContain('home.notifications');
    expect(text()).toContain('home.noOpenTasks');
    expect(text()).toContain('home.noNotifications');
  });

  it('greets the signed-in user by name', () => {
    setup({});

    expect(fixture.componentInstance.userName()).toBe('Dr. Yasser Al-Amri');
  });

  // Failing loudly here would reproduce, on the landing page itself, the wall
  // of failed requests this page exists to stop people landing on.
  it('fails quietly and independently — one panel failing does not break the other', () => {
    setup({ tasksFail: true, notifications: [NOTIFICATION] });

    expect(text()).toContain('Committee approved');
    expect(fixture.componentInstance.tasksLoading()).toBe(false);
  });

  it('fails quietly when notifications fail', () => {
    setup({ notificationsFail: true, tasks: [task('1', 'PENDING')] });

    expect(text()).toContain('Task 1');
    expect(fixture.componentInstance.notificationsLoading()).toBe(false);
  });
});
