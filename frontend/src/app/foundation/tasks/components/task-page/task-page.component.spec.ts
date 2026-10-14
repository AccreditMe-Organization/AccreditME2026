import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { BreadcrumbParentService } from '../../../../core/navigation/breadcrumb-parent.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { ITaskPageViewDto } from '../../services/task.service';
import { TaskPageComponent } from './task-page.component';
import { FileViewerService } from '../../../../shared/files/viewer/file-viewer.service';
import { HISTORY, pageView } from './task-page.fixtures';

const API = `${environment.apiUrl}/tasks`;

describe('TaskPageComponent — the task page (ACC-228)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;
  let fixture: ComponentFixture<TaskPageComponent>;
  const params = new BehaviorSubject(convertToParamMap({ id: 'task-1' }));

  function setup(language: 'en' | 'ar' = 'en'): void {
    TestBed.configureTestingModule({
      imports: [TaskPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskPageComponent);
    fixture.detectChanges();
  }

  /** Answers the page, its history and (when the page renders) its evidence. */
  function answer(view: ITaskPageViewDto, history = HISTORY): HTMLElement {
    http.expectOne(`${API}/task-1/view`).flush(view);
    http.expectOne(`${API}/task-1/history`).flush(history);
    fixture.detectChanges();
    http.match(`${API}/task-1/evidence`).forEach((r) => r.flush({ items: [], canAdd: false, closed: false }));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const actionIds = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-testid="task-actions"] [data-action]')).map((b) => b.getAttribute('data-action'));

  afterEach(() => http.verify());

  describe('what it shows', () => {
    it('the title as the H1, its status, priority and due date, and the four relations', () => {
      setup();
      const el = answer(pageView());
      expect(text(el.querySelector('h1'))).toBe('Update hand-hygiene audit tool');
      expect(text(el.querySelector('header'))).toContain('In progress');
      expect(text(el.querySelector('header'))).toContain('High priority');
      const strip = Array.from(el.querySelectorAll('.am-tp__cell')).map(text);
      expect(strip[0]).toContain('Infection Prevention & Control');
      expect(strip[1]).toContain('Dr. Huda Zahrani');
      expect(strip[1]).toContain('Clinical Pharmacist · Pharmacy');
      expect(strip[2]).toContain('Nora Al-Otaibi');
      expect(strip[3]).toContain('Required · 2 added');
    });

    it('links the record when the viewer may open it, and names it as the breadcrumb parent (Q11)', () => {
      setup();
      const el = answer(pageView());
      const link = el.querySelector<HTMLAnchorElement>('.am-tp__cell a');
      expect(link?.getAttribute('href')).toBe('/committees/committee-1');
      expect(TestBed.inject(BreadcrumbParentService).current()).toEqual({
        forPath: '/tasks/task-1',
        url: '/committees/committee-1',
        text: 'Infection Prevention & Control',
      });
    });

    it('says only the record type, with no link and no breadcrumb parent, when the viewer may not open the record', () => {
      setup();
      const el = answer(pageView({ view: { record: { type: 'COMMITTEE', id: 'committee-1', canOpen: false, nameEn: null, nameAr: null } } }));
      expect(el.querySelector('.am-tp__cell a')).toBeNull();
      expect(text(el.querySelector('.am-tp__cell'))).toContain('Committee');
      expect(TestBed.inject(BreadcrumbParentService).current()).toBeNull();
    });

    it('a task waiting in its pool says who it waits for and how many can pick it up', () => {
      setup();
      const el = answer(
        pageView({
          task: {
            status: 'PENDING',
            pool: {
              kind: 'POSITION',
              positionNameEn: 'Quality Officer',
              positionNameAr: null,
              orgUnitNameEn: 'Pharmacy',
              orgUnitNameAr: null,
              roleLabelEn: null,
              roleLabelAr: null,
              committeeNameEn: null,
              committeeNameAr: null,
            },
          },
          view: { assignees: [], poolMemberCount: 4 },
        }),
      );
      const withCell = text(el.querySelectorAll('.am-tp__cell')[1]!);
      expect(withCell).toContain('Waiting for Quality Officer, Pharmacy');
      expect(withCell).toContain('4 can pick it up');
      expect(text(el.querySelector('header'))).toContain('Waiting to be picked up');
    });

    it('shows the open request with what approval does, and history oldest first, worded', () => {
      setup();
      const el = answer(
        pageView({
          task: {
            openRequest: {
              id: 'req-1',
              type: 'ON_HOLD',
              requestedDueAt: null,
              holdUntil: '2099-10-20T05:00:00.000Z',
              requestedById: 'huda',
              requestedByName: 'Dr. Huda Zahrani',
              reason: 'The audit form needs Infection Control sign-off.',
              createdAt: '2026-10-05T11:20:00.000Z',
            },
          },
        }),
      );
      const request = text(el.querySelector('[data-testid="task-open-request"]'));
      expect(request).toContain('Hold until');
      expect(request).toContain('If approved, the start and due dates move to');
      expect(request).toContain('Asked by Dr. Huda Zahrani');
      const events = Array.from(el.querySelectorAll('.am-tp__event')).map(text);
      expect(events.length).toBe(4);
      expect(events[0]).toContain('Created · Nora Al-Otaibi');
      expect(events[1]).toContain('Picked up from the pool');
      expect(events[3]).toContain('Hold requested');
      expect(events[3]).toContain('The audit form needs Infection Control sign-off.');
    });

    it('in Arabic: the kicker, the labels and the status are Arabic', () => {
      setup('ar');
      const el = answer(pageView());
      expect(text(el.querySelector('.am-tp__kicker'))).toBe('مهمة');
      expect(text(el.querySelector('header'))).toContain('قيد التنفيذ');
      expect(Array.from(el.querySelectorAll('.am-tp__label')).map(text)).toEqual(['بخصوص', 'لدى', 'أنشأها', 'الدليل']);
      expect(text(el.querySelector('.am-tp__cell a'))).toBe('لجنة مكافحة العدوى');
    });
  });

  describe('the viewer’s actions, exactly as the server decided them', () => {
    it('an assignee of an In-progress task: Complete is the button, Add evidence beside it, the rest in ⋯', () => {
      setup();
      const el = answer(
        pageView({ actions: { complete: true, addEvidence: true, requestMoreTime: true, requestHold: true, reject: true, primary: 'COMPLETE' } }),
      );
      expect(actionIds(el)).toEqual(['complete', 'addEvidence']);
      expect(el.querySelector<HTMLButtonElement>('[data-action="complete"]')!.classList).toContain('am-tp-btn--primary');
      expect(fixture.componentInstance.menuActions().map((a) => a.id)).toEqual(['requestMoreTime', 'requestHold', 'reject']);
      expect(el.querySelector('[data-testid="task-more"]')?.getAttribute('aria-label')).toBe('More actions for “Update hand-hygiene audit tool”');
    });

    it('Complete waiting for evidence is disabled, and says why in words', () => {
      setup();
      const el = answer(pageView({ actions: { complete: true, completeNeedsEvidence: true, primary: 'COMPLETE' } }));
      const complete = el.querySelector<HTMLButtonElement>('[data-action="complete"]')!;
      expect(complete.disabled).toBe(true);
      expect(complete.getAttribute('aria-describedby')).toBe('am-tp-complete-why');
      expect(text(el.querySelector('#am-tp-complete-why'))).toBe('Add evidence before completing');
    });

    it('a reader with no relationship gets no action group at all', () => {
      setup();
      const el = answer(pageView());
      expect(el.querySelector('[data-testid="task-actions"]')).toBeNull();
    });

    it('Start runs the task’s own endpoint, then reloads the page and its history', () => {
      setup();
      const el = answer(pageView({ task: { status: 'PENDING' }, actions: { start: true, primary: 'START' } }));
      el.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
      http.expectOne({ method: 'POST', url: `${API}/task-1/start` }).flush({});
      http.expectOne(`${API}/task-1/view`).flush(pageView({ actions: { complete: true, primary: 'COMPLETE' } }));
      http.expectOne(`${API}/task-1/history`).flush(HISTORY);
      http.match(`${API}/task-1/evidence`).forEach((r) => r.flush({ items: [], canAdd: false, closed: false }));
      fixture.detectChanges();
      expect(actionIds(el)).toEqual(['complete']);
    });

    it('a decider’s Review request opens the decision dialog for this task’s request', () => {
      setup();
      const el = answer(
        pageView({
          task: {
            openRequest: {
              id: 'req-1',
              type: 'EXTENSION',
              requestedDueAt: '2099-10-20T14:00:00.000Z',
              holdUntil: null,
              requestedById: 'huda',
              requestedByName: 'Dr. Huda Zahrani',
              reason: 'Second ward pilot',
              createdAt: '2026-10-05T11:20:00.000Z',
            },
          },
          actions: { reviewRequest: true, primary: 'REVIEW_REQUEST' },
        }),
      );
      el.querySelector<HTMLButtonElement>('[data-action="reviewRequest"]')!.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.dialog()).toBe('decision');
      expect(fixture.componentInstance.decisionRequest()).toEqual(
        jasmine.objectContaining({ id: 'req-1', task: jasmine.objectContaining({ id: 'task-1', title: 'Update hand-hygiene audit tool' }) }),
      );
    });

    it('a failed action says so and reloads, leaving the page standing', () => {
      setup();
      const el = answer(pageView({ task: { status: 'PENDING' }, actions: { start: true, primary: 'START' } }));
      el.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
      http
        .expectOne({ method: 'POST', url: `${API}/task-1/start` })
        .flush({ message: 'This task is already in progress' }, { status: 409, statusText: 'Conflict' });
      http.expectOne(`${API}/task-1/view`).flush(pageView());
      http.expectOne(`${API}/task-1/history`).flush(HISTORY);
      http.match(`${API}/task-1/evidence`).forEach((r) => r.flush({ items: [], canAdd: false, closed: false }));
      fixture.detectChanges();
      expect(text(el.querySelector('[role="alert"]'))).toBe('This task is already in progress');
      expect(el.querySelector('[data-testid="task-page"]')).not.toBeNull();
    });
  });

  describe('the outcomes (§1)', () => {
    it('a task the viewer may not open and a task that does not exist render the same not-found state', () => {
      setup();
      http.expectOne(`${API}/task-1/view`).flush({ statusCode: 404, message: 'Task not found' }, { status: 404, statusText: 'Not Found' });
      http.expectOne(`${API}/task-1/history`).flush({ statusCode: 404, message: 'Task not found' }, { status: 404, statusText: 'Not Found' });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="task-not-found"]')).not.toBeNull();
      expect(text(el.querySelector('h1'))).toBe("This task can't be opened");
      // Nothing about the task leaks onto the page.
      expect(el.querySelector('[data-testid="task-page"]')).toBeNull();
      expect(el.querySelector<HTMLAnchorElement>('[data-testid="task-not-found"] a')?.getAttribute('href')).toBe('/tasks');
    });

    it('a server failure is an error with Retry; Retry loads again', () => {
      setup();
      http.expectOne(`${API}/task-1/view`).flush({ requestId: 'req-99' }, { status: 500, statusText: 'Server Error' });
      http.expectOne(`${API}/task-1/history`).flush([]);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(text(el.querySelector('h1'))).toBe("Couldn't load this task");
      expect(text(el)).toContain('req-99');
      el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
      answer(pageView());
      expect(el.querySelector('[data-testid="task-page"]')).not.toBeNull();
    });

    it('history failing alone leaves the page standing', () => {
      setup();
      http.expectOne(`${API}/task-1/view`).flush(pageView());
      http.expectOne(`${API}/task-1/history`).flush({}, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      http.match(`${API}/task-1/evidence`).forEach((r) => r.flush({ items: [], canAdd: false, closed: false }));
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(text(el.querySelector('h1'))).toBe('Update hand-hygiene audit tool');
      expect(el.querySelectorAll('.am-tp__event').length).toBe(0);
    });
  });

  describe('evidence', () => {
    it('hosts the evidence list for this task, so every file opens in the in-app viewer', () => {
      setup();
      http.expectOne(`${API}/task-1/view`).flush(pageView());
      http.expectOne(`${API}/task-1/history`).flush(HISTORY);
      fixture.detectChanges();
      const req = http.expectOne(`${API}/task-1/evidence`);
      req.flush({
        items: [
          {
            id: 'ev-1',
            type: 'ATTACHMENT',
            url: null,
            linkTitle: null,
            refType: null,
            refId: null,
            refDisplay: null,
            uploadedAt: '2026-10-05T10:55:00.000Z',
            uploadedBy: { id: 'huda', name: 'Dr. Huda Zahrani' },
            file: { id: 'file-1', name: 'ward-audit.pdf', mimeType: 'application/pdf', sizeBytes: 412000, uploadedAt: '2026-10-05T10:55:00.000Z' },
            canDelete: false,
          },
        ],
        canAdd: false,
        closed: false,
      });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const viewer = TestBed.inject(FileViewerService);
      const open = spyOn(viewer, 'open');
      // The file's name opens the in-app viewer at that file — not a download.
      el.querySelector<HTMLButtonElement>('[data-am-evidence-file="ev-1"]')!.click();
      expect(open).toHaveBeenCalledTimes(1);
      const request = open.calls.mostRecent().args[0];
      expect(request.files.map((f) => f.name)).toEqual(['ward-audit.pdf']);
      expect(request.startIndex).toBe(0);
      expect(el.querySelector('app-task-evidence-list a[download]')).toBeNull();
    });

    it('a viewer the evidence rule refuses is told whose evidence it is — not shown an error', () => {
      setup();
      http.expectOne(`${API}/task-1/view`).flush(pageView());
      http.expectOne(`${API}/task-1/history`).flush(HISTORY);
      fixture.detectChanges();
      http.expectOne(`${API}/task-1/evidence`).flush({ message: 'Task not found' }, { status: 404, statusText: 'Not Found' });
      fixture.detectChanges();
      const list = (fixture.nativeElement as HTMLElement).querySelector('app-task-evidence-list')!;
      expect(text(list)).toContain('Evidence is shown to the people on this task.');
      expect(list.querySelector('[role="alert"]')).toBeNull();
    });
  });
});
