import { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateLoader, provideTranslateService, TranslateNoOpLoader } from '@ngx-translate/core';
import { Observable, of, throwError } from 'rxjs';
import { ConfirmationService } from 'primeng/api';
import { provideFormatTesting } from '../../core/formatting/testing';
import { AuthService } from '../../core/services/auth.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { ChangeRequestDto, ChangeRequestService } from '../committees/change-requests/change-request.service';
import { CommitteeService, MyCommitteeRowDto, MyCommitteesDto } from '../committees/services/committee.service';
import { ITaskListItemDto, ITaskRecordListDto, ITaskRecordRowDto, TaskRecordListQuery, TaskService } from '../tasks/services/task.service';
import { WorkflowAwaitingMeDto, WorkflowAwaitingRowDto, WorkflowService } from '../workflow/services/workflow.service';
import { AiBriefingService } from './ai-briefing.service';
import { HomeAdminSummaryDto, HomeSummaryService } from './home-summary.service';

/** ACC-279 — fixtures for Home's specs. A read answers its value, or fails with 'fail'. */
export type Answer<T> = T | 'fail';

const answer = <T>(a: Answer<T>): Observable<T> => (a === 'fail' ? throwError(() => new Error('boom')) : of(a));

export const taskRow = (over: Partial<ITaskRecordRowDto> = {}): ITaskRecordRowDto =>
  ({
    id: 't-1',
    title: 'Collect the infection figures',
    titleAr: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    dueAt: null,
    onHoldUntil: null,
    record: { type: 'COMMITTEE', id: 'c-1', nameEn: 'IPC Committee', nameAr: 'لجنة مكافحة العدوى' },
    ...over,
  }) as ITaskRecordRowDto;

export const recordList = (items: ITaskRecordRowDto[], matching = items.length): ITaskRecordListDto =>
  ({ items, total: matching, matching, scope: 'own', view: 'mine', facets: null, aroundIndex: null }) as unknown as ITaskRecordListDto;

export const awaitingRow = (over: Partial<WorkflowAwaitingRowDto> = {}): WorkflowAwaitingRowDto =>
  ({
    instanceStageId: 'e-1',
    record: { type: 'COMMITTEE', id: 'c-1', nameEn: 'Medication Safety', nameAr: null },
    stage: { id: 's-1', nameEn: 'Terms Review', nameAr: 'مراجعة الشروط', position: 2, stageCount: 6 },
    since: '2026-11-03T08:00:00.000Z',
    ...over,
  }) as WorkflowAwaitingRowDto;

export const awaitingMe = (rows: WorkflowAwaitingRowDto[], total = rows.length): WorkflowAwaitingMeDto => ({
  total,
  rows,
  oldestSince: rows[0]?.since ?? null,
});

export const committeeRow = (over: Partial<MyCommitteeRowDto> = {}): MyCommitteeRowDto => ({
  committeeId: 'c-1',
  nameEn: 'Infection Prevention & Control',
  nameAr: 'مكافحة العدوى',
  isActive: true,
  seat: { id: 'member', labelEn: 'Member', labelAr: 'عضو' },
  stage: { nameEn: 'Active', nameAr: 'نشطة' },
  isInForce: true,
  isDissolving: false,
  ...over,
});

export interface HomeSpecOptions {
  permissions?: string[];
  myTasks?: Answer<ITaskRecordListDto>;
  myOverdue?: Answer<number>;
  awaiting?: Answer<WorkflowAwaitingMeDto>;
  changes?: Answer<ChangeRequestDto[]>;
  committees?: Answer<MyCommitteesDto>;
  summary?: Answer<HomeAdminSummaryDto>;
  available?: Answer<ITaskListItemDto[]>;
  /** ACC-280 — GET /tasks/views' create.types: New task's record types. */
  createTypes?: Answer<string[]>;
  name?: string;
  /** ACC-281 — signed in as a platform admin. */
  platformAdmin?: boolean;
}

/** Every request Home's reads made, by name, so a spec can say what was and was not asked. */
export interface HomeSpecCalls {
  recordList: TaskRecordListQuery[];
  awaitingMe: number;
  changes: number;
  committees: number;
  summary: number;
  myTasksLegacy: number;
  /** ACC-280 — GET /tasks/views, read once on entry for New task. */
  views: number;
}

export function homeProviders(opts: HomeSpecOptions = {}): { providers: (Provider | EnvironmentProviders)[]; calls: HomeSpecCalls } {
  const calls: HomeSpecCalls = { recordList: [], awaitingMe: 0, changes: 0, committees: 0, summary: 0, myTasksLegacy: 0, views: 0 };
  const held = new Set(opts.permissions ?? []);
  const providers: (Provider | EnvironmentProviders)[] = [
    provideRouter([]),
    provideTranslateService({ lang: 'en' }),
    provideTranslateLoader(TranslateNoOpLoader),
    provideFormatTesting(),
    // ACC-280 — the New task dialog's unsaved-work question (provided app-wide in app.config).
    ConfirmationService,
    {
      provide: TaskService,
      useValue: {
        getRecordList: (q: TaskRecordListQuery) => {
          calls.recordList.push(q);
          if (q.view === 'created') return of(recordList([], 0));
          if (q.overdue) {
            const overdue = opts.myOverdue ?? 0;
            return overdue === 'fail' ? answer<ITaskRecordListDto>('fail') : of(recordList([], overdue));
          }
          return answer(opts.myTasks ?? recordList([]));
        },
        getAwaitingDecision: () => of([]),
        getViews: () => {
          calls.views++;
          const types = opts.createTypes ?? [];
          return types === 'fail'
            ? answer<never>('fail')
            : of({ mine: true, created: true, all: null, unassigned: null, unit: null, create: { types } });
        },
        getAvailable: () => answer(opts.available ?? []),
        // Home no longer reads the unbounded list; a call here is a regression.
        getMyTasks: () => {
          calls.myTasksLegacy++;
          return of([]);
        },
      },
    },
    {
      provide: WorkflowService,
      useValue: {
        getAwaitingMe: () => {
          calls.awaitingMe++;
          return answer(opts.awaiting ?? awaitingMe([]));
        },
      },
    },
    {
      provide: ChangeRequestService,
      useValue: {
        awaitingDecision: () => {
          calls.changes++;
          return answer(opts.changes ?? []);
        },
      },
    },
    {
      provide: CommitteeService,
      useValue: {
        getMine: () => {
          calls.committees++;
          return answer(opts.committees ?? { total: 0, rows: [] });
        },
      },
    },
    {
      provide: HomeSummaryService,
      useValue: {
        adminSummary: () => {
          calls.summary++;
          return answer(opts.summary ?? { setup: null, users: null, committees: null });
        },
      },
    },
    {
      provide: NavigationAccessService,
      useValue: {
        hasPermission: (key: string) => held.has(key),
        isModuleEnabled: () => true,
        isPlatformAdmin: () => opts.platformAdmin ?? false,
      },
    },
    { provide: AuthService, useValue: { currentUser: () => ({ name: opts.name ?? 'Layla Al-Harbi' }) } },
    { provide: AiBriefingService, useValue: { get: () => of({ available: false, creditCost: 5, greeting: 'morning', briefing: null }) } },
  ];
  return { providers, calls };
}
