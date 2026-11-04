import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { AmDateTimePipe, FormatService, type PluralKey } from '../../core/formatting';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { CardComponent } from '../../shared/components/card/card.component';
import { TaskService, ITaskListItemDto } from '../tasks/services/task.service';
import { isTaskOpen, isTaskOverdue, taskStatusLabelKey } from '../tasks/task-status';
import { taskPoolLabel } from '../tasks/task-pool-label';
import { NotificationService, NotificationDto } from '../notification/services/notification.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { HomeBriefingComponent } from './home-briefing.component';
import { HomeAwaitingComponent } from './home-awaiting.component';
import { TaskLinkComponent } from '../tasks/components/task-link/task-link.component';

/** How many open tasks the My tasks panel lists; "All my tasks" opens the rest. */
export const HOME_TASK_ROWS = 5;

/** The decision line's two reads: requests to decide, and the viewer's own rejected tasks. */
type DecisionState = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; requests: number; rejected: number };

/** A row that may name its record (a list that carries the name); my-tasks rows do not. */
type MaybeNamed = ITaskListItemDto & { record?: { nameEn: string | null; nameAr: string | null } | null };

// HomeComponent — ACC-70. The post-login landing page.
//
// WHY IT EXISTS: every non-platform-admin used to be redirected to
// /organization, an admin screen. A user without org:view landed on a page
// that rendered a wall of failed requests — the concrete finding from ACC-62's
// persona testing. Sending them to their own profile instead would have been a
// workaround; this is the product working.
//
// DELIBERATELY REACHABLE BY ANY AUTHENTICATED USER. It carries no
// permissionGuard and has no entry in ROUTE_PERMISSIONS, so it cannot become
// the thing it exists to prevent. Every read below is self-scoped — my-tasks,
// the decider inbox, my created tasks, my pools, my notifications — so none
// needs a permission and none can 403 for a legitimately logged-in user.
//
// ACC-271 — the My tasks panel as drawn (Task Screens §10): a header with the
// open and overdue counts, then two lines that appear only when they have
// something — what waits for this person's DECISION (requests to decide, and
// their own tasks that came back rejected) and what is AVAILABLE TO PICK UP in
// their pools — then the open tasks and "All my tasks". Every read is fired
// together and fails quietly on its own; a failed decision count says so with
// Retry, never 0.
//
// NOT THE DASHBOARD. CLAUDE.md records a permission-gated widget dashboard as
// part of Committee production-readiness ("my committees / pending my action",
// widgets gated on permission strings, never on named roles). That is this
// same screen's LATER pass, once modules exist to draw from — not a duplicate
// of this one and not superseded by it. When the dashboard work happens, it
// should grow this component rather than add a second landing page.
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [PageHeaderComponent, HomeBriefingComponent, HomeAwaitingComponent, AmDateTimePipe, RouterLink, TranslatePipe, CardComponent, TaskLinkComponent],
  template: `
    <div class="flex flex-col gap-6">
      <!-- ACC-79 — no purpose line. "Your open work and recent activity"
           described what is directly below it, which is the first test a
           purpose line fails (see PageHeaderComponent). -->
      <app-page-header
        [title]="'home.greeting' | translate: { name: userName() }"
        [tabTitle]="'nav.home' | translate"
      />

      <!-- ACC-198 — the AI briefing, above the accepted panels at full width.
           Renders nothing at all unless a tenant admin may make one here. -->
      <app-home-briefing (showAll)="showFullList()" />

      <!-- ACC-240 / ACC-271 — records waiting on this person's decision, oldest
           first. Renders nothing at all with nothing waiting. -->
      <app-home-awaiting />

      <div id="home-panels" tabindex="-1" class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start outline-none">
        <app-card>
          <section aria-labelledby="home-tasks-h" data-testid="home-tasks">
            <div class="am-ht__head">
              <h3 id="home-tasks-h" class="text-lg font-medium">{{ 'home.myTasks' | translate }}</h3>
              @if (!tasksLoading()) {
                <span class="am-ht__summary" data-testid="home-tasks-summary"
                  >{{ openLabel() }} · <span [class.am-ht__late]="overdueCount() > 0">{{ overdueLabel() }}</span></span
                >
              }
            </div>

            @switch (decision().state) {
              @case ('failed') {
                <div class="am-ht__line am-ht__line--decide" data-testid="home-decisions">
                  <span class="am-ht__line-main">{{ 'home.decisionFailed' | translate }}</span>{{ ' · ' }}
                  <button type="button" class="am-ht__retry" data-testid="home-decisions-retry" (click)="loadDecisions()">
                    {{ 'common.retry' | translate }}
                  </button>
                </div>
              }
              @case ('ready') {
                @if (decisionTotal() > 0) {
                  <a routerLink="/tasks" class="am-ht__line am-ht__line--decide" data-testid="home-decisions">
                    <span class="am-ht__line-main">{{ waitingLabel() }}</span>{{ ' ' }}
                    <span class="am-ht__line-sub">{{ requestsLabel() }} · {{ rejectedLabel() }} {{ chevron() }}</span>
                  </a>
                }
              }
            }

            @if (available().length) {
              <a routerLink="/tasks" class="am-ht__line am-ht__line--pool" data-testid="home-available">
                <span class="am-ht__line-main">{{ availableLabel() }}</span>{{ ' ' }}
                <span class="am-ht__line-sub">{{ poolNames() }} {{ chevron() }}</span>
              </a>
            }

            @if (tasksLoading()) {
              <p class="am-ht__note">{{ 'common.loading' | translate }}</p>
            } @else if (openTasks().length === 0) {
              <p class="am-ht__note" data-testid="home-tasks-empty">{{ 'home.noOpenTasks' | translate }}</p>
            } @else {
              <ul class="am-ht__rows">
                @for (task of shownTasks(); track task.id) {
                  <li class="am-ht__row" data-testid="home-task-row">
                    <span class="am-ht__row-main">
                      <span class="am-ht__row-title"><am-task-link [taskId]="task.id" [title]="task.title" /></span>
                      <span class="am-ht__row-meta">◇ {{ recordLine(task) }} · <span [class.am-ht__held]="task.status === 'ON_HOLD'">{{ statusLine(task) }}</span></span>
                    </span>
                    <span class="am-ht__due" [class.am-ht__late]="isOverdue(task)">{{ dueLine(task) }}</span>
                  </li>
                }
              </ul>
            }
            <div class="am-ht__foot">
              <a routerLink="/tasks" class="am-ht__all" data-testid="home-tasks-all">{{ 'home.allMyTasks' | translate }}</a>
            </div>
          </section>
        </app-card>

        <app-card>
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-medium">{{ 'home.notifications' | translate }}</h3>
          </div>

          @if (notificationsLoading()) {
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'common.loading' | translate }}</p>
          } @else if (notifications().length === 0) {
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'home.noNotifications' | translate }}</p>
          } @else {
            <ul class="flex flex-col divide-y divide-[var(--am-border)]">
              @for (item of notifications(); track item.id) {
                <li class="py-3 flex flex-col gap-1">
                  <span class="text-sm" [class.font-semibold]="item.status === 'UNREAD'">
                    {{ notificationTitle(item) }}
                  </span>
                  <span class="text-xs text-[var(--am-text-secondary)]">
                    {{ item.createdAt | amDateTime }}
                  </span>
                </li>
              }
            </ul>
          }
        </app-card>
      </div>
    </div>
  `,
  styles: [
    `
      .am-ht__head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--am-space-4) var(--am-space-12);margin-block-end:var(--am-space-12)}
      .am-ht__summary{font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-700)}
      .am-ht__late{color:var(--am-danger-ink);font-weight:600}
      .am-ht__line{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:var(--am-space-4) var(--am-space-8);padding:var(--am-space-8) var(--am-space-12);margin-block-end:var(--am-space-8);border:1px solid;border-radius:var(--am-radius-control);text-decoration:none}
      .am-ht__line--decide{background:var(--am-warning-bg);border-color:var(--am-warning-border)}
      .am-ht__line--decide .am-ht__line-main{color:var(--am-warning-ink)}
      .am-ht__line--pool{background:var(--am-info-bg);border-color:var(--am-info-border)}
      .am-ht__line--pool .am-ht__line-main{color:var(--am-info-ink)}
      .am-ht__line-main{font-size:13px;font-weight:600}
      .am-ht__line-sub{font-size:var(--am-type-meta-size);color:var(--am-ink-700);min-inline-size:0;overflow-wrap:anywhere}
      a.am-ht__line:hover .am-ht__line-main{text-decoration:underline}
      a.am-ht__line:focus-visible,.am-ht__retry:focus-visible,.am-ht__all:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-ht__retry{font:inherit;font-size:var(--am-type-meta-size);font-weight:600;color:var(--am-primary-700);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
      .am-ht__note{font-size:14px;color:var(--am-ink-500);padding-block:var(--am-space-8)}
      .am-ht__rows{display:flex;flex-direction:column}
      .am-ht__row{display:flex;align-items:flex-start;gap:var(--am-space-12);padding-block:var(--am-space-8);border-block-end:1px solid var(--am-row-rule);min-inline-size:0}
      .am-ht__row-main{flex:1 1 auto;min-inline-size:0;display:flex;flex-direction:column;gap:2px}
      .am-ht__row-title{font-size:14px;font-weight:500;min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .am-ht__row-meta{font-size:var(--am-type-meta-size);color:var(--am-ink-500);min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .am-ht__held{color:var(--am-info-ink)}
      .am-ht__due{flex:none;font-size:var(--am-type-meta-size);color:var(--am-ink-700);white-space:nowrap}
      .am-ht__foot{padding-block-start:var(--am-space-8)}
      .am-ht__all{font-size:13px;font-weight:600;color:var(--am-primary-700);text-decoration:none}
      .am-ht__all:hover{text-decoration:underline}
    `,
  ],
})
export class HomeComponent implements OnInit {
  private readonly taskService = inject(TaskService);
  private readonly notificationService = inject(NotificationService);
  private readonly authService = inject(AuthService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly openTasks = signal<ITaskListItemDto[]>([]);
  readonly notifications = signal<NotificationDto[]>([]);
  readonly available = signal<ITaskListItemDto[]>([]);
  readonly decision = signal<DecisionState>({ state: 'loading' });
  readonly tasksLoading = signal(false);
  readonly notificationsLoading = signal(false);

  /** Open tasks as drawn: overdue first, then soonest due (undated last), then on hold. */
  readonly sortedTasks = computed(() =>
    [...this.openTasks()].sort((a, b) => this.rank(a) - this.rank(b) || this.dueTime(a) - this.dueTime(b) || a.id.localeCompare(b.id)),
  );
  readonly shownTasks = computed(() => this.sortedTasks().slice(0, HOME_TASK_ROWS));
  readonly overdueCount = computed(() => this.openTasks().filter((t) => isTaskOverdue(t)).length);

  readonly openLabel = computed(() => this.counted('home.openTasks', this.openTasks().length));
  readonly overdueLabel = computed(() => this.counted('home.overdueTasks', this.overdueCount()));

  readonly decisionTotal = computed(() => {
    const d = this.decision();
    return d.state === 'ready' ? d.requests + d.rejected : 0;
  });
  readonly waitingLabel = computed(() => this.counted('home.waitingDecision', this.decisionTotal()));
  readonly requestsLabel = computed(() => {
    const d = this.decision();
    return this.counted('home.requests', d.state === 'ready' ? d.requests : 0);
  });
  readonly rejectedLabel = computed(() => {
    const d = this.decision();
    return this.counted('home.rejected', d.state === 'ready' ? d.rejected : 0);
  });

  readonly availableLabel = computed(() => this.counted('home.availableToPick', this.available().length));
  /** The pools the waiting tasks sit in, each named once, in the reader's language. */
  readonly poolNames = computed(() => {
    this.translate.currentLang();
    const arabic = this.languageService.isArabic();
    const names = this.available()
      .map((t) => (t.pool ? taskPoolLabel(t.pool, (en, ar) => this.languageService.bilingual(en, ar), arabic) : null))
      .filter((n): n is string => !!n);
    return [...new Set(names)].join(arabic ? '؛ ' : '; ');
  });
  readonly chevron = computed(() => (this.languageService.isRtl() ? '‹' : '›'));

  userName(): string {
    return this.authService.currentUser()?.name ?? '';
  }

  // Notifications carry titleEn/titleAr, not a single resolved title — same
  // shape NotificationBellComponent already renders. Arabic falls back to
  // English when titleAr is null rather than showing an empty row.
  notificationTitle(item: NotificationDto): string {
    return this.languageService.isArabic() && item.titleAr ? item.titleAr : item.titleEn;
  }

  isOverdue(task: ITaskListItemDto): boolean {
    return isTaskOverdue(task);
  }

  /** "Committee", or "Committee · {name}" when the row carries its record's name. */
  recordLine(task: MaybeNamed): string {
    const type = this.translate.instant(`taskList.recordType.${task.sourceType}`) as string;
    const record = task.record;
    return record?.nameEn ? `${type} · ${this.languageService.bilingual(record.nameEn, record.nameAr)}` : type;
  }

  statusLine(task: ITaskListItemDto): string {
    if (task.status === 'ON_HOLD' && task.onHoldUntil) {
      return this.translate.instant('home.onHoldUntil', { date: this.format.date(task.onHoldUntil) });
    }
    return this.translate.instant(taskStatusLabelKey(task));
  }

  dueLine(task: ITaskListItemDto): string {
    return task.dueAt ? this.translate.instant('home.dueOn', { date: this.format.dateTime(task.dueAt) }) : '—';
  }

  ngOnInit(): void {
    // Every read fired together; each fails quietly on its own.
    this.loadTasks();
    this.loadDecisions();
    this.loadAvailable();
    this.loadNotifications();
  }

  // ACC-198 — the briefing's "Show the full list": the panels below, focused.
  showFullList(): void {
    const panels = document.getElementById('home-panels');
    panels?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    panels?.focus({ preventScroll: true });
  }

  /** The decision line: requests to decide, and this person's tasks that came back rejected. Retry runs it again. */
  loadDecisions(): void {
    this.decision.set({ state: 'loading' });
    forkJoin({
      requests: this.taskService.getAwaitingDecision(),
      rejected: this.taskService.getRecordList({ view: 'created', status: ['REJECTED'], take: 1 }),
    }).subscribe({
      // `matching` is the rejected count: `total` is every task in the view, before the filter.
      next: ({ requests, rejected }) => this.decision.set({ state: 'ready', requests: requests.length, rejected: rejected.matching }),
      error: () => this.decision.set({ state: 'failed' }),
    });
  }

  private counted(key: PluralKey, n: number): string {
    this.translate.currentLang();
    return this.format.count(key, n);
  }

  private rank(task: ITaskListItemDto): number {
    if (task.status === 'ON_HOLD') return 2;
    return isTaskOverdue(task) ? 0 : 1;
  }

  private dueTime(task: ITaskListItemDto): number {
    return task.dueAt ? new Date(task.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  }

  private loadTasks(): void {
    this.tasksLoading.set(true);
    this.taskService.getMyTasks().subscribe({
      next: (tasks) => {
        // Open work only — a landing page listing everything the user has
        // ever completed buries what still needs doing.
        this.openTasks.set(tasks.filter((t) => isTaskOpen(t)));
        this.tasksLoading.set(false);
      },
      // Every panel fails QUIETLY and independently. None of these endpoints
      // is permission-gated, so an error here is a genuine fault rather than a
      // denial — and this is the screen a user is sent to when something has
      // already gone wrong elsewhere. Rendering an error banner on it would
      // reproduce, on the landing page itself, the "wall of failed requests"
      // this page exists to stop people landing on.
      error: () => this.tasksLoading.set(false),
    });
  }

  private loadAvailable(): void {
    this.taskService.getAvailable().subscribe({
      next: (tasks) => this.available.set(tasks),
      error: () => this.available.set([]),
    });
  }

  private loadNotifications(): void {
    this.notificationsLoading.set(true);
    // ACC-78 — unwraps the shared envelope. Like the bell, this panel wants the
    // newest few and ignores `total`.
    this.notificationService.list(undefined, 5).subscribe({
      next: (page) => {
        this.notifications.set(page.data);
        this.notificationsLoading.set(false);
      },
      error: () => this.notificationsLoading.set(false),
    });
  }
}
