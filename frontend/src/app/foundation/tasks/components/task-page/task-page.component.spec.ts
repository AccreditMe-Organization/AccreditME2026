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
      // ACC-120 slice 4 — the header's note, and the reason as a bare quote.
      expect(text(el.querySelector('[data-testid="task-request-note"]'))).toBe('one at a time per task');
      expect(text(el.querySelector('[data-testid="task-request-reason"]'))).toBe('“The audit form needs Infection Control sign-off.”');
      const events = Array.from(el.querySelectorAll('[data-testid="task-event-what"]')).map(text);
      expect(events.length).toBe(4);
      expect(events[0]).toBe('Created by Nora Al-Otaibi');
      expect(events[1]).toBe('Picked up by Dr. Huda Zahrani');
      expect(events[3]).toBe('Hold requested by Dr. Huda Zahrani');
      expect(text(el.querySelectorAll('.am-tp__event')[3]!)).toContain('“The audit form needs Infection Control sign-off.”');
    });

    it('in Arabic: the kicker, the labels and the status are Arabic', () => {
      setup('ar');
      const el = answer(pageView());
      expect(text(el.querySelector('.am-tp__kicker'))).toBe('مهمة');
      expect(text(el.querySelector('header'))).toContain('قيد التنفيذ');
      expect(Array.from(el.querySelectorAll('.am-tp__label')).map(text)).toEqual(['بخصوص', 'لدى', 'أُنشئت بواسطة', 'الأدلة']);
      expect(text(el.querySelector('.am-tp__cell a'))).toBe('لجنة مكافحة العدوى');
    });
  });

  // ACC-120 slice 4 — the header, the relations and history as drawn (Task
  // Screens, the task page).
  describe('as drawn (ACC-120 slice 4)', () => {
    const status = (el: HTMLElement) => el.querySelector('[data-testid="task-status"]')!;
    const dot = (el: HTMLElement) => el.querySelector('[data-testid="task-status-dot"]');

    // Status tones: a dot for open work, amber for Rejected and Unassigned,
    // grey for On hold and Cancelled; Assigned and Completed have none.
    const TONES: { s: string; dot: string | null; ink: string; reads: string }[] = [
      { s: 'IN_PROGRESS', dot: '--am-primary-600', ink: '--am-primary-700', reads: 'In progress' },
      { s: 'PENDING', dot: null, ink: '--am-ink-700', reads: 'Assigned' },
      { s: 'COMPLETED', dot: null, ink: '--am-ink-700', reads: 'Completed ✓' },
      { s: 'REJECTED', dot: '--am-warning-ink', ink: '--am-warning-ink', reads: 'Rejected' },
      { s: 'UNASSIGNED', dot: '--am-warning-ink', ink: '--am-warning-ink', reads: 'Unassigned' },
      { s: 'ON_HOLD', dot: '--am-ink-300', ink: '--am-ink-700', reads: 'On hold' },
      { s: 'CANCELLED', dot: '--am-ink-300', ink: '--am-ink-700', reads: 'Cancelled' },
    ];
    for (const c of TONES) {
      it(`status tone: ${c.s} reads "${c.reads}"${c.dot ? ', with its dot' : ', with no dot'}`, () => {
        setup();
        const el = answer(pageView({ task: { status: c.s as never } }));
        expect(text(status(el))).toBe(c.reads);
        expect(status(el).className).toContain(c.ink);
        if (c.dot) expect(dot(el)?.className).toContain(c.dot);
        else expect(dot(el)).toBeNull();
      });
    }

    const GLYPHS: [string, string][] = [
      ['HIGH', '▲ High priority'],
      ['CRITICAL', '!! Critical priority'],
      ['MEDIUM', 'Medium priority'],
    ];
    for (const [priority, reads] of GLYPHS) {
      it(`priority ${priority} reads "${reads}"`, () => {
        setup();
        const el = answer(pageView({ task: { priority: priority as never } }));
        expect(text(el.querySelector('[data-testid="task-priority"]'))).toBe(reads);
      });
    }

    it('due reads "Due 15 Oct 2099, 17:00 +03": the date isolated, only the time and offset left to right', () => {
      setup();
      const el = answer(pageView());
      expect(text(el.querySelector('[data-testid="task-due"]'))).toBe('Due 15 Oct 2099, 17:00 +03');
      const date = el.querySelector('[data-testid="task-due-date"]')!;
      expect(date.tagName).toBe('BDI');
      const time = el.querySelector('[data-testid="task-due-time"]')!;
      expect(time.getAttribute('dir')).toBe('ltr');
      expect(text(time)).toBe('17:00 +03');
      expect(time.contains(date)).toBeFalse();
    });

    it('in Arabic the date keeps the page direction: day, month, year, then the time and offset', () => {
      setup('ar');
      const el = answer(pageView());
      const date = text(el.querySelector('[data-testid="task-due-date"]'));
      expect(date).toBe('15 أكتوبر 2099');
      expect(text(el.querySelector('[data-testid="task-due-time"]'))).toBe('17:00 +03');
      const due = text(el.querySelector('[data-testid="task-due"]'));
      // The date comes before the time in reading order, Latin digits throughout.
      expect(due.indexOf('15 أكتوبر 2099')).toBeLessThan(due.indexOf('17:00'));
      expect(/[٠-٩]/.test(due)).toBeFalse();
    });

    it('About marks the record with ◇, linking it by the shared record-link rule', () => {
      setup();
      const el = answer(pageView());
      const about = el.querySelector('[data-testid="task-about"]')!;
      expect(text(about)).toContain('◇');
      expect(el.querySelector('[data-testid="task-about-link"]')?.getAttribute('href')).toBe('/committees/committee-1');
    });

    it('a decider decides from the open request through the existing dialog, worded by what was asked; no one-click Approve', () => {
      setup();
      const request = {
        id: 'req-1',
        type: 'ON_HOLD' as const,
        requestedDueAt: null,
        holdUntil: '2099-10-20T05:00:00.000Z',
        requestedById: 'huda',
        requestedByName: 'Dr. Huda Zahrani',
        reason: 'Waiting on Infection Control',
        createdAt: '2026-10-05T11:20:00.000Z',
      };
      const el = answer(pageView({ task: { openRequest: request }, actions: { reviewRequest: true, primary: 'REVIEW_REQUEST' } }));
      const panel = el.querySelector('[data-testid="task-open-request"]')!;
      expect(text(panel.querySelector('[data-testid="task-decide"]'))).toBe('Decide hold request…');
      expect(text(panel)).not.toMatch(/\bApprove\b/);
      panel.querySelector<HTMLButtonElement>('[data-testid="task-decide"]')!.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.dialog()).toBe('decision');
    });

    it('a more-time request is decided with "Decide more-time request…"', () => {
      setup();
      const el = answer(
        pageView({
          task: {
            openRequest: {
              id: 'req-2',
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
      expect(text(el.querySelector('[data-testid="task-decide"]'))).toBe('Decide more-time request…');
    });

    it('history: a 92px time column reading "1 Oct 09:12", the sentence at weight 500, the evidence kind named', () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date('2026-11-05T09:00:00.000Z'));
      try {
        setup();
        const el = answer(pageView(), [
          ...HISTORY,
          { at: '2025-12-31T06:12:00.000Z', actorName: 'Dr. Huda Zahrani', kind: 'evidence_added', reason: null, requestType: null, evidenceType: 'LINK' },
          { at: '2026-10-06T06:12:00.000Z', actorName: null, kind: 'evidence_added', reason: null, requestType: null, evidenceType: 'ATTACHMENT' },
          { at: '2026-10-06T07:00:00.000Z', actorName: 'Nora Al-Otaibi', kind: 'evidence_removed', reason: null, requestType: null, evidenceType: 'INTERNAL_REFERENCE' },
        ]);
        const when = Array.from(el.querySelectorAll('[data-testid="task-event-when"]')).map(text);
        expect(when[0]).toBe('1 Oct 09:12');
        // The year only when it is not this year.
        expect(when).toContain('31 Dec 2025 09:12');
        const what = Array.from(el.querySelectorAll('[data-testid="task-event-what"]')).map(text);
        expect(what).toContain('Evidence added by Dr. Huda Zahrani: a link');
        expect(what).toContain('Evidence added: a file');
        expect(what).toContain('Evidence removed by Nora Al-Otaibi: a record');

        const event = el.querySelector('.am-tp__event') as HTMLElement;
        expect(getComputedStyle(event).gridTemplateColumns.split(' ')[0]).toBe('92px');
        expect(getComputedStyle(el.querySelector('[data-testid="task-event-what"]')!).fontWeight).toBe('500');
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('while it loads, a skeleton of the four relation cells', () => {
      setup();
      const strip = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="task-skeleton-strip"]')!;
      expect(strip.children.length).toBe(4);
      answer(pageView());
    });

    it('in Arabic the meta row is 14px and the sub-lines 12.5px', () => {
      setup('ar');
      document.documentElement.setAttribute('dir', 'rtl');
      const el = answer(pageView());
      expect(getComputedStyle(el.querySelector('.am-tp__meta-row')!).fontSize).toBe('14px');
      const sub = el.querySelector('.am-tp__sub');
      expect(sub).withContext('a relation sub-line is on screen').not.toBeNull();
      expect(getComputedStyle(sub!).fontSize).toBe('12.5px');
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

    // ACC-120 slice 4 — the next step chosen on the client, by the same rule as
    // the record panel (taskPrimaryActionId).
    it('an assignee whose evidence is missing: Add evidence leads, and Complete waits in ⋯ saying why', () => {
      setup();
      const el = answer(
        pageView({
          task: { evidenceCount: 0 },
          actions: { complete: true, completeNeedsEvidence: true, addEvidence: true, reject: true, primary: 'COMPLETE' },
        }),
      );
      expect(actionIds(el)[0]).toBe('addEvidence');
      expect(el.querySelector('[data-action="addEvidence"]')!.classList).toContain('am-tp-btn--primary');
      expect(el.querySelector('[data-testid="task-actions"] [data-action="complete"]')).toBeNull();
      const complete = fixture.componentInstance.menuActions().find((a) => a.id === 'complete');
      expect(complete).toEqual(jasmine.objectContaining({ disabled: true }));
      // The line that describes a disabled Complete button is not shown: there is no such button.
      expect(el.querySelector('#am-tp-complete-why')).toBeNull();
    });

    it('the creator of a rejected task: Reassign… leads, Edit stays beside it, Cancel is in ⋯', () => {
      setup();
      const el = answer(pageView({ task: { status: 'REJECTED' }, actions: { reassign: true, edit: true, cancel: true, primary: null } }));
      expect(actionIds(el)).toEqual(['reassign', 'edit']);
      expect(el.querySelector('[data-action="reassign"]')!.classList).toContain('am-tp-btn--primary');
      expect(text(el.querySelector('[data-action="reassign"]'))).toBe('Reassign…');
      expect(fixture.componentInstance.menuActions().map((a) => a.id)).toEqual(['cancel']);
    });

    it('the action labels read as drawn', () => {
      setup();
      answer(pageView({ actions: { requestHold: true, release: true, resume: true, reopen: true } }));
      const labels = fixture.componentInstance.menuActions().map((a) => TestBed.inject(TranslateService).instant(a.labelKey));
      expect(labels).toEqual(jasmine.arrayContaining(['Ask to put on hold…', 'Hand back…', 'Resume now', 'Reopen task…']));
    });

    it('in Arabic, the same labels', () => {
      setup('ar');
      answer(pageView({ actions: { requestHold: true, release: true, resume: true, reopen: true } }));
      const labels = fixture.componentInstance.menuActions().map((a) => TestBed.inject(TranslateService).instant(a.labelKey));
      expect(labels).toEqual(jasmine.arrayContaining(['طلب تعليق المهمة…', 'إرجاع المهمة…', 'استئناف الآن', 'إعادة فتح المهمة…']));
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

    it('ACC-231 — a 404 from the evidence list is its ordinary load error, never the server text', () => {
      setup();
      http.expectOne(`${API}/task-1/view`).flush(pageView());
      http.expectOne(`${API}/task-1/history`).flush(HISTORY);
      fixture.detectChanges();
      http.expectOne(`${API}/task-1/evidence`).flush({ message: 'Task not found' }, { status: 404, statusText: 'Not Found' });
      fixture.detectChanges();
      const list = (fixture.nativeElement as HTMLElement).querySelector('app-task-evidence-list')!;
      // The files follow the page's own rule, so this happens only if the task
      // changed hands mid-visit. The note ACC-228 needed here is gone.
      expect(text(list)).not.toContain('Evidence is shown to the people on this task.');
      expect(list.querySelector('[role="alert"]')?.textContent?.trim()).toBe("The evidence couldn't be loaded.");
      expect(text(list)).not.toContain('Task not found');
    });
  });
});
