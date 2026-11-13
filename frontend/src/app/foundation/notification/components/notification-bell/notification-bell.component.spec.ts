import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
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
import { providePrimeNG } from 'primeng/config';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';

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
    const bell = create();
    expect(bell.itemLink(item({}))).toEqual(['/tasks', 'task-1']);
    expect(bell.isRecordLink(item({}))).toBe(false);
  });

  // ACC-271 PR 4 — a closed-task notice carries its record for a reader who may
  // open it; the server sends no object for anyone else.
  it("opens a closed-task notice's committee, and marks it as opening the record", () => {
    const bell = create();
    expect(bell.itemLink(item({ objectType: 'COMMITTEE', objectId: 'c-1' }))).toEqual(['/committees', 'c-1']);
    expect(bell.isRecordLink(item({ objectType: 'COMMITTEE', objectId: 'c-1' }))).toBe(true);
  });

  it('leaves every other notification without a link, as before', () => {
    const bell = create();
    expect(bell.itemLink(item({ objectType: 'MEETING', objectId: 'm-1' }))).toBeNull();
    expect(bell.itemLink(item({ objectType: null, objectId: null }))).toBeNull();
    expect(bell.itemLink(item({ objectType: 'Task', objectId: null }))).toBeNull();
    expect(bell.itemLink(item({ objectType: 'COMMITTEE', objectId: null }))).toBeNull();
    expect(bell.isRecordLink(item({ objectType: null, objectId: null }))).toBe(false);
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

// ACC-90 — the panel (p-popover and the list) loads on the first press, not at
// start-up, and that same press opens it. The bell and its count are eager.
describe('NotificationBellComponent — the panel loads on the first press (ACC-90)', () => {
  preserveDocumentLanguage();

  async function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        {
          provide: NotificationService,
          useValue: {
            markRead: () => of({}),
            markAllRead: () => of({}),
            getUnreadCount: () => of({ count: 1 }),
            list: () =>
              of({
                data: [
                  {
                    id: 'n-1',
                    titleEn: 'Task assigned: Collect December figures',
                    titleAr: null,
                    bodyEn: '',
                    bodyAr: null,
                    channel: 'IN_APP',
                    status: 'UNREAD',
                    objectType: 'Task',
                    objectId: 'task-1',
                    createdAt: '2026-11-12T08:00:00.000Z',
                  },
                ],
              }),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(NotificationBellComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }

  // ACC-248 — bounded by TURNS: the popover's motion runs on CSS time.
  async function until(fixture: { detectChanges(): void }, condition: () => boolean, what: string, turns = 100): Promise<void> {
    for (let turn = 0; !condition(); turn++) {
      if (turn >= turns) throw new Error(`timed out waiting for ${what}`);
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  const popover = () => document.querySelector<HTMLElement>('.p-popover');

  afterEach(() => document.querySelectorAll('.p-popover, app-notification-bell').forEach((el) => el.remove()));

  /**
   * The panel's block, rendered as Angular renders it once its `when` holds.
   * Manual: this harness does not run the block's own trigger (the bell polls
   * every 30 seconds, so it is never stable), and what is under test is that
   * the press asks for the block and then opens it.
   */
  async function loadPanel(fixture: ComponentFixture<NotificationBellComponent>): Promise<void> {
    const [block] = await fixture.getDeferBlocks();
    expect(block).withContext('the panel is a @defer block').toBeDefined();
    await block!.render(DeferBlockState.Complete);
    fixture.detectChanges();
  }

  /**
   * A press on the bell, as p-button reports it: a click event from its button.
   * The handler is called with that event. A DOM click() does not reach
   * p-button's output in this harness; the browser pass (cc241) presses the
   * real button.
   */
  function press(fixture: ComponentFixture<NotificationBellComponent>): void {
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="notification-bell"] button')!;
    const event = new MouseEvent('click');
    Object.defineProperty(event, 'currentTarget', { value: button });
    fixture.componentInstance.onToggle(event);
    fixture.detectChanges();
  }

  it('no panel until the bell is pressed; the first press loads it and opens it with the list', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-notification-bell-panel')).withContext('not loaded at start-up').toBeNull();
    expect(popover()).toBeNull();

    press(fixture);
    expect(fixture.componentInstance.panelWanted()).withContext("the press set the panel block's when").toBeTrue();
    await loadPanel(fixture);
    await until(fixture, () => !!popover(), 'the panel to open on the first press');

    expect(host.querySelector('app-notification-bell-panel')).withContext('the press loaded the panel').not.toBeNull();
    expect(popover()!.textContent).toContain(en.notification.title);
    expect(popover()!.textContent).toContain('Task assigned: Collect December figures');
    fixture.destroy();
  });

  it('the next press closes it, and the one after opens it again', async () => {
    const fixture = await render();
    press(fixture);
    await loadPanel(fixture);
    await until(fixture, () => !!popover(), 'the panel to open');
    press(fixture);
    await until(fixture, () => !popover(), 'the panel to close');
    press(fixture);
    await until(fixture, () => !!popover(), 'the panel to open again');
    fixture.destroy();
  });
});
