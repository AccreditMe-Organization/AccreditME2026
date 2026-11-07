import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, forkJoin, map, of, debounceTime } from 'rxjs';
import { MyWorkEvents } from '../../core/my-work/my-work-events';
import { isNavModuleOpen } from '../../core/navigation/nav-items';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { ChangeRequestDto, ChangeRequestService } from '../committees/change-requests/change-request.service';
import { CommitteeService, MyCommitteesDto } from '../committees/services/committee.service';
import { ITaskRecordListDto, TaskRecordListQuery, TaskService } from '../tasks/services/task.service';
import { WorkflowAwaitingMeDto, WorkflowService } from '../workflow/services/workflow.service';

/** One read's answer as a screen shows it: never a number standing in for a failure. */
export type Loadable<T> = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; value: T };

/** A capped panel's state for a read: it calls a failure `error`. */
export function panelState(state: Loadable<unknown>['state']): 'loading' | 'error' | 'ready' {
  return state === 'failed' ? 'error' : state;
}

export interface AwaitingAnswer {
  stages: WorkflowAwaitingMeDto;
  /** Committee change requests to decide; asked only of committees:approve holders. */
  changes: ChangeRequestDto[];
}

/** The person's open tasks, as My tasks on /tasks counts them (an active assignee row). */
export const MY_OPEN_TASKS: TaskRecordListQuery = {
  view: 'mine',
  status: ['PENDING', 'IN_PROGRESS', 'ON_HOLD'],
  sort: 'due',
  take: 5,
};
const MY_OVERDUE_TASKS: TaskRecordListQuery = { ...MY_OPEN_TASKS, overdue: true, take: 1 };

/** A load started this recently is not repeated: Home's entry right after sign-in. */
const COALESCE_MS = 2000;

/**
 * ACC-279 — the person's work counts, ONE source for Home and the rail.
 *
 * It owns the reads behind Home's personal tiles and panels (plan §2.5), all of
 * them existing endpoints:
 *
 *   myTasks       GET /tasks/record-list?view=mine&status=PENDING,IN_PROGRESS,ON_HOLD&sort=due&take=5
 *   myOverdue     the same with &overdue=true&take=1 (its `matching`)
 *   awaiting      GET /workflows/awaiting-me, and for committees:approve holders
 *                 GET /committee-change-requests/awaiting-decision
 *   myCommittees  GET /committees/mine, while the Committees module is open
 *
 * It loads ONCE after sign-in (the shell calls init() when access has loaded),
 * again when Home opens, and once after a burst of actions that change a count
 * (MyWorkEvents). There is no timer: nothing polls. clear() at sign-out.
 *
 * Each read has its own state. A failed read is `failed`, never 0, and Retry
 * re-runs only that read. The awaiting read fails as a whole if either half
 * fails, because a partial count is a wrong count.
 */
@Injectable({ providedIn: 'root' })
export class MyWorkCountsService {
  private readonly tasks = inject(TaskService);
  private readonly workflows = inject(WorkflowService);
  private readonly changeRequests = inject(ChangeRequestService);
  private readonly committees = inject(CommitteeService);
  private readonly access = inject(NavigationAccessService);

  readonly myTasks = signal<Loadable<ITaskRecordListDto>>({ state: 'loading' });
  readonly myOverdue = signal<Loadable<number>>({ state: 'loading' });
  readonly awaiting = signal<Loadable<AwaitingAnswer>>({ state: 'loading' });
  readonly myCommittees = signal<Loadable<MyCommitteesDto>>({ state: 'loading' });

  /**
   * ACC-281 — whether this person sits on at least one active committee: My
   * committees has loaded with a total above 0. False while loading, after a
   * failure, or with none. Lane A's rail and route guard read it to show and admit
   * Committees to a member without committees:view; it costs no query of its own.
   */
  readonly isCommitteeMember = computed(() => {
    const c = this.myCommittees();
    return c.state === 'ready' && c.value.total > 0;
  });

  private started = false;
  private lastLoadAt = 0;
  private readonly inFlight = new Map<string, Subscription>();

  constructor() {
    const events = inject(MyWorkEvents)
      .changes$.pipe(debounceTime(0))
      .subscribe(() => {
        if (this.started) this.reload();
      });
    inject(DestroyRef).onDestroy(() => events.unsubscribe());
  }

  /** Whether My committees applies to this organisation: the rail's own module rule. */
  committeesOpen(): boolean {
    return isNavModuleOpen('committees', this.access);
  }

  /** Load once; later calls do nothing. The shell calls it after sign-in. */
  init(): void {
    if (this.started) return;
    this.started = true;
    this.reload();
  }

  /** Home's entry: load, unless a load began moments ago (sign-in, then Home). */
  refreshOnEntry(): void {
    if (this.started && Date.now() - this.lastLoadAt < COALESCE_MS) return;
    this.started = true;
    this.reload();
  }

  reload(): void {
    this.lastLoadAt = Date.now();
    this.loadMyTasks();
    this.loadMyOverdue();
    this.loadAwaiting();
    this.loadMyCommittees();
  }

  loadMyTasks(): void {
    this.run('myTasks', this.myTasks, this.tasks.getRecordList(MY_OPEN_TASKS));
  }

  loadMyOverdue(): void {
    this.run('myOverdue', this.myOverdue, this.tasks.getRecordList(MY_OVERDUE_TASKS).pipe(map((list) => list.matching)));
  }

  loadAwaiting(): void {
    const changes$: Observable<ChangeRequestDto[]> = this.access.hasPermission('committees:approve')
      ? this.changeRequests.awaitingDecision()
      : of([]);
    this.run('awaiting', this.awaiting, forkJoin({ stages: this.workflows.getAwaitingMe(), changes: changes$ }));
  }

  loadMyCommittees(): void {
    if (!this.committeesOpen()) {
      this.inFlight.get('myCommittees')?.unsubscribe();
      this.myCommittees.set({ state: 'ready', value: { total: 0, rows: [] } });
      return;
    }
    this.run('myCommittees', this.myCommittees, this.committees.getMine());
  }

  /** Sign-out: forget everything, so the next person never sees these. */
  clear(): void {
    for (const sub of this.inFlight.values()) sub.unsubscribe();
    this.inFlight.clear();
    this.started = false;
    this.lastLoadAt = 0;
    this.myTasks.set({ state: 'loading' });
    this.myOverdue.set({ state: 'loading' });
    this.awaiting.set({ state: 'loading' });
    this.myCommittees.set({ state: 'loading' });
  }

  // A reload keeps the last answer on screen until the new one arrives, so a
  // count does not flicker to a skeleton after every action; only a first load,
  // or a Retry after a failure, shows loading.
  private run<T>(key: string, target: ReturnType<typeof signal<Loadable<T>>>, source: Observable<T>): void {
    this.inFlight.get(key)?.unsubscribe();
    if (target().state !== 'ready') target.set({ state: 'loading' });
    const sub = source
      .pipe(
        map((value): Loadable<T> => ({ state: 'ready', value })),
        catchError(() => of<Loadable<T>>({ state: 'failed' })),
      )
      .subscribe((answer) => {
        target.set(answer);
        this.inFlight.delete(key);
      });
    if (!sub.closed) this.inFlight.set(key, sub);
  }
}
