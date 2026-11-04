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
import { TaskService } from '../tasks/services/task.service';
import { WorkflowAwaitingMeDto, WorkflowAwaitingRowDto, WorkflowService } from '../workflow/services/workflow.service';
import { HomeAwaitingComponent } from './home-awaiting.component';
import { preserveDocumentLanguage } from '../../../testing/document-language';

function stageRow(id: string, since: string, over: Partial<WorkflowAwaitingRowDto> = {}): WorkflowAwaitingRowDto {
  return {
    instanceStageId: id,
    record: { type: 'COMMITTEE', id: `c-${id}`, nameEn: `Committee ${id}`, nameAr: null },
    stage: { id: 'stage-terms', nameEn: 'Terms Review', nameAr: 'مراجعة الشروط', position: 2, stageCount: 6 },
    since,
    ...over,
  };
}

const stages = (rows: WorkflowAwaitingRowDto[], total = rows.length): WorkflowAwaitingMeDto => ({ total, rows });

// ACC-240, ACC-271 — Home's "Awaiting my action": records to approve or return
// (Task Screens §10). Stage approvals from GET /workflows/awaiting-me, change
// requests from their own read; task requests are no longer here.
describe('HomeAwaitingComponent (ACC-240, ACC-271)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<HomeAwaitingComponent>;
  let format: FormatService;
  let approver: boolean;
  let changes: () => Observable<ChangeRequestDto[]>;
  let awaiting: () => Observable<WorkflowAwaitingMeDto>;
  let changeCalls: number;
  let taskCalls: number;

  beforeEach(() => {
    approver = true;
    changeCalls = 0;
    taskCalls = 0;
    changes = () => of([]);
    awaiting = () => of(stages([]));
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
        { provide: WorkflowService, useValue: { getAwaitingMe: () => awaiting() } },
        // Task requests left this card: reading them is a failure here.
        {
          provide: TaskService,
          useValue: {
            getAwaitingDecision: () => {
              taskCalls++;
              return of([]);
            },
          },
        },
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
  const meta = (li: Element) => text(li.querySelector('span.text-xs'));

  it('a stage approval: the record named and linked to its page, its type, stage, place and since', () => {
    awaiting = () => of(stages([stageRow('e1', '2026-10-03T08:00:00Z')]));
    const el = render();
    const link = el.querySelector('[data-testid="home-awaiting-row"]')!;
    expect(text(link)).toBe('Committee e1');
    expect(link.getAttribute('href')).toBe('/committees/c-e1');
    expect(meta(rows(el)[0]!)).toBe(`Committee · Terms Review 2/6 · since ${format.date('2026-10-03T08:00:00Z')}`);
  });

  it('a record with no page yet (a meeting) is named without a link', () => {
    awaiting = () => of(stages([stageRow('m1', '2026-10-03T08:00:00Z', { record: { type: 'MEETING', id: 'mt-1', nameEn: 'October meeting', nameAr: null } })]));
    const el = render();
    const row = el.querySelector('[data-testid="home-awaiting-row"]')!;
    expect(row.tagName).toBe('SPAN');
    expect(text(row)).toBe('October meeting');
    expect(meta(rows(el)[0]!)).toContain('Meeting · Terms Review 2/6');
  });

  it('the header as drawn: title, the count badge and "n records to approve or return"', () => {
    awaiting = () => of(stages([stageRow('e1', '2026-10-03T08:00:00Z')], 7));
    changes = () => of([REQUEST()]);
    const el = render();
    expect(text(el.querySelector('h3'))).toBe('Awaiting my action');
    // The server's stage total counts past the five rows it sends.
    expect(text(el.querySelector('[data-testid="home-awaiting-count"]'))).toBe('8');
    expect(text(el.querySelector('[data-testid="home-awaiting-sub"]'))).toBe('8 records to approve or return');
  });

  it('one record: the singular subtitle', () => {
    awaiting = () => of(stages([stageRow('e1', '2026-10-03T08:00:00Z')]));
    expect(text(render().querySelector('[data-testid="home-awaiting-sub"]'))).toBe('1 record to approve or return');
  });

  it('an approver with a change request: its row keeps its text and links to the request page', () => {
    changes = () => of([REQUEST()]);
    const el = render();
    expect(rows(el).length).toBe(1);
    const link = el.querySelector('[data-testid="home-awaiting-row"]')!;
    expect(text(link)).toBe('Change request 3 · Patient Experience Committee');
    expect(link.getAttribute('href')).toBe('/committees/c-1/change-requests/cr-1');
    expect(meta(rows(el)[0]!)).toBe(`Nora Al-Otaibi · submitted ${format.date('2026-10-18T09:00:00Z')}`);
  });

  it('task requests are not read and there is no "See all" link to /tasks', () => {
    awaiting = () => of(stages([stageRow('e1', '2026-10-03T08:00:00Z')]));
    const el = render();
    expect(taskCalls).toBe(0);
    expect(el.querySelector('a[href="/tasks"]')).toBeNull();
  });

  it('nothing waiting: no card at all', () => {
    expect(render().querySelector('[data-testid="home-awaiting"]')).toBeNull();
  });

  it('both reads failed: no card, and no error on Home', () => {
    changes = () => throwError(() => new Error('boom'));
    awaiting = () => throwError(() => new Error('boom'));
    expect(render().textContent?.trim()).toBe('');
  });

  it('one read failed: the other still shows', () => {
    awaiting = () => throwError(() => new Error('boom'));
    changes = () => of([REQUEST()]);
    expect(rows(render()).length).toBe(1);
  });

  it('without committees:approve the change requests are not read', () => {
    approver = false;
    awaiting = () => of(stages([stageRow('e1', '2026-10-03T08:00:00Z')]));
    const el = render();
    expect(changeCalls).toBe(0);
    expect(rows(el).length).toBe(1);
  });

  it('both kinds together, oldest first, five rows', () => {
    changes = () =>
      of([
        REQUEST({ id: 'cr-a', number: 1, submittedAt: '2026-10-10T09:00:00Z' }),
        REQUEST({ id: 'cr-b', number: 2, submittedAt: '2026-10-14T09:00:00Z' }),
        REQUEST({ id: 'cr-c', number: 4, submittedAt: '2026-10-20T09:00:00Z' }),
      ]);
    awaiting = () =>
      of(stages([stageRow('s3', '2026-10-11T09:00:00Z'), stageRow('s1', '2026-10-12T09:00:00Z'), stageRow('s2', '2026-10-18T09:00:00Z'), stageRow('s4', '2026-10-21T09:00:00Z')]));
    const el = render();
    expect(rows(el).map((li) => `${li.getAttribute('data-awaiting-kind')}:${text(li.querySelector('[data-testid="home-awaiting-row"]'))}`)).toEqual([
      'change:Change request 1 · Patient Experience Committee',
      'stage:Committee s3',
      'stage:Committee s1',
      'change:Change request 2 · Patient Experience Committee',
      'stage:Committee s2',
    ]);
  });

  it('Arabic: the record and stage in Arabic (English fallback), the Arabic subtitle', () => {
    TestBed.inject(TranslateService).use('ar');
    awaiting = () =>
      of(stages([stageRow('e1', '2026-10-03T08:00:00Z', { record: { type: 'COMMITTEE', id: 'c-1', nameEn: 'Quality', nameAr: 'لجنة الجودة' } }), stageRow('e2', '2026-10-04T08:00:00Z')]));
    const el = render();
    expect(text(el.querySelector('h3'))).toBe(ar.home.awaiting);
    const [first, second] = rows(el);
    expect(text(first!.querySelector('[data-testid="home-awaiting-row"]'))).toBe('لجنة الجودة');
    // No Arabic name: the English one, never blank.
    expect(text(second!.querySelector('[data-testid="home-awaiting-row"]'))).toBe('Committee e2');
    expect(meta(first!)).toBe(`${ar.workflow.objectTypeName.COMMITTEE} · مراجعة الشروط 2/6 · منذ ${format.date('2026-10-03T08:00:00Z')}`);
    expect(text(el.querySelector('[data-testid="home-awaiting-sub"]'))).toBe('سجلان للاعتماد أو الإعادة');
  });
});
