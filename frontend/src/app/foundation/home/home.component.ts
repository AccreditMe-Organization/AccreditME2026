import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { FormatService, type PluralKey } from '../../core/formatting';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { ITaskListItemDto, TaskService } from '../tasks/services/task.service';
import { taskPoolLabel } from '../tasks/task-pool-label';
import { HomeAdminComponent } from './home-admin.component';
import { HomeAwaitingComponent } from './home-awaiting.component';
import { HomeBriefingComponent } from './home-briefing.component';
import { HomeMyCommitteesComponent } from './home-my-committees.component';
import { HomeMyTasksComponent } from './home-my-tasks.component';
import { HomeTileComponent } from './home-tile.component';
import { MyWorkCountsService } from './my-work-counts.service';

/** The decision line's two reads: requests to decide, and the viewer's own rejected tasks. */
type DecisionState = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; requests: number; rejected: number };
type AvailableState = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; tasks: ITaskListItemDto[] };

const DAY_MS = 24 * 60 * 60 * 1000;

// HomeComponent — ACC-70, rebuilt to the App Shell design in ACC-279
// (backend/Plans/step-279-home-app-shell.md).
//
// ONE HOME FOR EVERYONE (Ahmad, 6 Nov). Each part is shown by a permission and,
// for a module, by whether the organisation has it (the rail's own rule,
// isNavModuleOpen) — never by a role name. Admin permissions get the admin block
// on top; then the same personal part for everyone: the tiles, the decision and
// available lines, the AI briefing, and three capped panels.
//
// DELIBERATELY REACHABLE BY ANY AUTHENTICATED USER. No permissionGuard and no
// ROUTE_PERMISSIONS entry, so it cannot become the wall of failed requests it
// exists to prevent (ACC-62). Every personal read is self-scoped; the admin
// block asks only for the parts its viewer may see.
//
// EVERY COUNT THAT FAILS SAYS SO, with Retry, and never shows 0 (plan §4).
// The tiles and panels read MyWorkCountsService, shared with the rail, so a
// count can never read two ways; Home reloads it on entry and after an action.
//
// NO PURPOSE LINE (ACC-79's two tests, plan §1.6): both drawn lines describe the
// panels below them, and "Nothing here about configuring the system" stopped
// being true when the admin block came onto this page.
//
// NO HEADER ACTIONS (Ahmad, Q7): New task comes with ACC-280's record picker.
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    PageHeaderComponent,
    HomeAdminComponent,
    HomeTileComponent,
    HomeBriefingComponent,
    HomeMyTasksComponent,
    HomeMyCommitteesComponent,
    HomeAwaitingComponent,
    RouterLink,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="am-home">
      <app-page-header [title]="greeting()" [tabTitle]="'nav.home' | translate" />

      <app-home-admin />

      <div class="am-home-tiles" data-testid="home-tiles">
        <am-home-tile
          [label]="'home.tile.openTasks' | translate"
          [state]="openTasks().state"
          [value]="openTasks().value"
          [meta]="overdueMeta()"
          tone="danger"
          [metaState]="overdueState()"
          [metaFailedText]="'home.tile.overdueFailed' | translate"
          [link]="['/tasks']"
          testId="home-tile-tasks"
          (retry)="counts.loadMyTasks()"
          (metaRetry)="counts.loadMyOverdue()"
        />
        <am-home-tile
          [label]="'home.tile.awaitingMe' | translate"
          [state]="awaitingTile().state"
          [value]="awaitingTile().value"
          [meta]="awaitingTile().meta"
          testId="home-tile-awaiting"
          (retry)="counts.loadAwaiting()"
        />
        @if (committeesOpen()) {
          <am-home-tile
            [label]="'home.tile.myCommittees' | translate"
            [state]="committeesTile().state"
            [value]="committeesTile().value"
            testId="home-tile-committees"
            (retry)="counts.loadMyCommittees()"
          />
        }
      </div>

      @if (showLines()) {
        <div class="am-home-lines">
          @switch (decision().state) {
            @case ('failed') {
              <div class="am-ht__line am-ht__line--decide" data-testid="home-decisions">
                <span class="am-ht__line-main">{{ 'home.decisionFailed' | translate }}</span>{{ ' · ' }}
                <button type="button" class="am-ht__retry" data-testid="home-decisions-retry" (click)="loadDecisions()">
                  {{ 'list.retry' | translate }}
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
          @switch (available().state) {
            @case ('failed') {
              <div class="am-ht__line am-ht__line--pool" data-testid="home-available">
                <span class="am-ht__line-main">{{ 'home.availableFailed' | translate }}</span>{{ ' · ' }}
                <button type="button" class="am-ht__retry" data-testid="home-available-retry" (click)="loadAvailable()">
                  {{ 'list.retry' | translate }}
                </button>
              </div>
            }
            @case ('ready') {
              @if (availableCount() > 0) {
                <a routerLink="/tasks" class="am-ht__line am-ht__line--pool" data-testid="home-available">
                  <span class="am-ht__line-main">{{ availableLabel() }}</span>{{ ' ' }}
                  <span class="am-ht__line-sub">{{ poolNames() }} {{ chevron() }}</span>
                </a>
              }
            }
          }
        </div>
      }

      <!-- ACC-198 — the AI briefing: the person's own work, so it sits with the
           personal part. Renders nothing unless a tenant admin may make one here. -->
      <app-home-briefing (showAll)="showFullList()" />

      <div id="home-panels" tabindex="-1" class="am-home-panels" data-fill-panels data-testid="home-panels">
        <app-home-my-tasks />
        @if (committeesOpen()) {
          <app-home-my-committees />
        }
        <app-home-awaiting />
      </div>
    </div>
  `,
  styles: [
    `
      .am-home{display:flex;flex-direction:column;gap:12px;min-inline-size:0}
      .am-home-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;min-inline-size:0}
      .am-home-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr));gap:12px;min-inline-size:0;outline:none}
      .am-home-lines{display:flex;flex-direction:column;gap:8px;min-inline-size:0}
      .am-ht__line{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:var(--am-space-4) var(--am-space-8);padding:var(--am-space-8) var(--am-space-12);border:1px solid;border-radius:var(--am-radius-control);text-decoration:none;min-inline-size:0}
      .am-ht__line--decide{background:var(--am-warning-bg);border-color:var(--am-warning-border)}
      .am-ht__line--decide .am-ht__line-main{color:var(--am-warning-ink)}
      .am-ht__line--pool{background:var(--am-info-bg);border-color:var(--am-info-border)}
      .am-ht__line--pool .am-ht__line-main{color:var(--am-info-ink)}
      .am-ht__line-main{font-size:13px;font-weight:600}
      .am-ht__line-sub{font-size:var(--am-type-meta-size);color:var(--am-ink-700);min-inline-size:0;overflow-wrap:anywhere}
      a.am-ht__line:hover .am-ht__line-main{text-decoration:underline}
      a.am-ht__line:focus-visible,.am-ht__retry:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-ht__retry{font:inherit;font-size:var(--am-type-meta-size);font-weight:600;color:var(--am-primary-700);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
    `,
  ],
})
export class HomeComponent implements OnInit {
  protected readonly counts = inject(MyWorkCountsService);
  private readonly taskService = inject(TaskService);
  private readonly authService = inject(AuthService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly decision = signal<DecisionState>({ state: 'loading' });
  readonly available = signal<AvailableState>({ state: 'loading' });

  /** "Good morning, Layla" in the organisation's time zone (Arabic: two forms only). */
  readonly greeting = computed(() => {
    this.translate.currentLang();
    return this.translate.instant(`home.greeting.${this.format.dayPart()}`, { name: this.authService.currentUser()?.name ?? '' });
  });

  readonly committeesOpen = computed(() => this.counts.committeesOpen());

  readonly openTasks = computed(() => {
    const answer = this.counts.myTasks();
    return { state: answer.state, value: answer.state === 'ready' ? this.format.number(answer.value.matching) : '' };
  });
  readonly overdueState = computed(() => this.counts.myOverdue().state);
  readonly overdueMeta = computed(() => {
    this.translate.currentLang();
    const overdue = this.counts.myOverdue();
    return overdue.state === 'ready' && overdue.value > 0 ? this.format.count('home.overdueTasks', overdue.value) : null;
  });

  readonly awaitingTile = computed(() => {
    this.translate.currentLang();
    const answer = this.counts.awaiting();
    if (answer.state !== 'ready') return { state: answer.state, value: '', meta: null };
    const { stages, changes } = answer.value;
    const total = stages.total + changes.length;
    const times = [stages.oldestSince, ...changes.map((c) => c.submittedAt ?? c.createdAt)]
      .filter((t): t is string => !!t)
      .map((t) => new Date(t).getTime());
    let meta: string | null = null;
    if (total > 0 && times.length > 0) {
      const ms = Date.now() - Math.min(...times);
      meta =
        ms < DAY_MS
          ? this.translate.instant('home.oldestToday')
          : this.translate.instant('home.oldest', { duration: this.format.duration(Math.floor(ms / DAY_MS) * DAY_MS) });
    }
    return { state: answer.state, value: this.format.number(total), meta };
  });

  readonly committeesTile = computed(() => {
    const answer = this.counts.myCommittees();
    return { state: answer.state, value: answer.state === 'ready' ? this.format.number(answer.value.total) : '' };
  });

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

  readonly availableCount = computed(() => {
    const a = this.available();
    return a.state === 'ready' ? a.tasks.length : 0;
  });
  readonly availableLabel = computed(() => this.counted('home.availableToPick', this.availableCount()));
  /** The pools the waiting tasks sit in, each named once, in the reader's language. */
  readonly poolNames = computed(() => {
    this.translate.currentLang();
    const a = this.available();
    if (a.state !== 'ready') return '';
    const arabic = this.languageService.isArabic();
    const names = a.tasks
      .map((t) => (t.pool ? taskPoolLabel(t.pool, (en, ar) => this.languageService.bilingual(en, ar), arabic) : null))
      .filter((n): n is string => !!n);
    return [...new Set(names)].join(arabic ? '؛ ' : '; ');
  });
  readonly chevron = computed(() => (this.languageService.isRtl() ? '‹' : '›'));

  /** The strip under the tiles: only when a line has something to say, or failed. */
  readonly showLines = computed(
    () =>
      this.decision().state === 'failed' ||
      this.available().state === 'failed' ||
      this.decisionTotal() > 0 ||
      this.availableCount() > 0,
  );

  ngOnInit(): void {
    this.counts.refreshOnEntry();
    this.loadDecisions();
    this.loadAvailable();
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

  /** The available line: open pool tasks this person could pick up. Retry runs it again. */
  loadAvailable(): void {
    this.available.set({ state: 'loading' });
    this.taskService.getAvailable().subscribe({
      next: (tasks) => this.available.set({ state: 'ready', tasks }),
      error: () => this.available.set({ state: 'failed' }),
    });
  }

  private counted(key: PluralKey, n: number): string {
    this.translate.currentLang();
    return this.format.count(key, n);
  }
}
