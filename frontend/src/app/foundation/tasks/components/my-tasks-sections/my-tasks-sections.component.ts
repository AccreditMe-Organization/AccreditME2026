import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AmDateTimePipe, FormatService } from '../../../../core/formatting';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import {
  IAvailableTaskListItemDto,
  ITaskRecordRowDto,
  ITaskRequestInboxDto,
  TaskPoolDto,
  TaskRecordRefDto,
  TaskService,
} from '../../services/task.service';
import { taskPoolLabel } from '../../task-pool-label';
import { taskPriorityGlyph, taskPriorityKey, taskRecordHref, taskRecordTypeKey } from '../../task-row-display';
import { TaskActionFailure, TaskActionHostComponent } from '../task-action-host/task-action-host.component';
import { TaskLinkComponent } from '../task-link/task-link.component';

type LoadState = 'loading' | 'ready' | 'error';

/** The record as a row shows it: its name or type word, and where it opens (if anywhere). */
interface RecordView {
  label: string;
  href: string[] | null;
}

/** A row of "Waiting for your decision": a request to decide, or a task of yours someone rejected. */
interface DecisionRow {
  kind: 'request' | 'rejected';
  /** The request's id, or the rejected task's: what `data-request-row` / `data-task-row` names. */
  id: string;
  taskId: string;
  title: string;
  dueAt: string | null;
  record: RecordView;
  /** Who asked, or who rejected. */
  who: string;
  /** The ask ("Hold until 20 Oct 2026"), or "Rejected by …". */
  ask: string;
  /** The reason, quoted. */
  why: string | null;
  request: ITaskRequestInboxDto | null;
  row: ITaskRecordRowDto | null;
}

/** A row of "Available to pick up". */
interface AvailableRow {
  task: IAvailableTaskListItemDto;
  record: RecordView;
  pool: string | null;
  priority: { glyph: string | null; label: string };
}

/** Rejected tasks are read 50 at a time; the count is the server's `matching`. */
const REJECTED_PAGE = 50;

/**
 * ACC-120 slice 3 — MY TASKS' TWO SECTIONS, above its list (Task Screens).
 *
 * "Waiting for your decision" holds two kinds of row, soonest due first:
 * requests the viewer may decide (GET /tasks/requests/awaiting-decision), and
 * tasks the viewer created that someone rejected (the record list's view
 * created, status REJECTED). Its count is the requests plus the rejected
 * list's `matching` — never its `total`, which ignores the status filter and
 * counts every task the viewer created.
 *
 * "Available to pick up" is GET /tasks/available: tasks waiting in a pool the
 * viewer is in. Pick up keeps today's handling: when someone was first (409)
 * the server's sentence is said and the section reloads.
 *
 * Each section loads, fails and retries on its own, and a section with nothing
 * in it is absent. A failure is never silence: one line in the section's place
 * says so, with Retry, and its count reads "—", never 0. After any action the
 * section reloads and the list below is told (`changed`).
 *
 * The record is named by the one rule (task-row-display.ts): a link where the
 * viewer may open it, its name where they may only see it, else its type word.
 */
@Component({
  selector: 'app-my-tasks-sections',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, AmDateTimePipe, TaskLinkComponent, TaskActionHostComponent],
  template: `
    @if (showDecision()) {
      <section class="am-mts am-mts--warning" aria-labelledby="mtsDecisionHeading" data-testid="mts-decision">
        <div class="am-mts__head">
          <h2 id="mtsDecisionHeading" class="am-mts__title">{{ 'task.request.awaiting' | translate }}</h2>
          <span class="am-mts__count" [attr.aria-label]="decisionCountLabel()" data-testid="mts-decision-count">{{ decisionCountText() }}</span>
          <p class="am-mts__purpose">{{ 'tasks.sections.decision.purpose' | translate }}</p>
        </div>
        @if (decisionState() === 'error') {
          <p class="am-mts__failed" role="alert" data-testid="mts-decision-failed">
            {{ 'tasks.sections.decision.failed' | translate }} ·
            <button type="button" class="am-mts__retry" (click)="loadDecision()" data-testid="mts-decision-retry">{{ 'common.retry' | translate }}</button>
          </p>
        } @else {
          @if (decisionError()) {
            <p class="am-mts__failed" role="alert" data-testid="mts-decision-action-error">{{ decisionError() }}</p>
          }
          <ul class="am-mts__rows" role="list">
            @for (r of decisionRows(); track r.kind + r.id) {
              <li
                class="am-mts__row"
                [class.am-mts__row--sought]="r.kind === 'request' ? soughtRequestId() === r.id : soughtTaskId() === r.taskId"
                [attr.data-request-row]="r.kind === 'request' ? r.id : null"
                [attr.data-task-row]="r.kind === 'rejected' ? r.taskId : null"
                tabindex="-1"
              >
                <span class="am-mts__task">
                  <span class="am-mts__title-line"><am-task-link [taskId]="r.taskId" [title]="r.title" /></span>
                  <span class="am-mts__sub">
                    <span aria-hidden="true">◇&nbsp;</span>
                    @if (r.record.href) {
                      <a class="am-mts__record" [routerLink]="r.record.href" data-testid="mts-record">{{ r.record.label }}</a>
                    } @else {
                      <span data-testid="mts-record">{{ r.record.label }}</span>
                    }
                    <span>&nbsp;· {{ r.who }}</span>
                  </span>
                </span>
                <span class="am-mts__ask">
                  <span class="am-mts__ask-line" data-testid="mts-ask">{{ r.ask }}</span>
                  @if (r.why) {
                    <span class="am-mts__why" data-testid="mts-why">{{ r.why }}</span>
                  }
                </span>
                <span class="am-mts__act">
                  @if (r.request; as request) {
                    @if (canReview(request)) {
                      <button
                        type="button"
                        class="am-mts__btn"
                        [disabled]="busyId() !== null"
                        [attr.aria-label]="'task.request.reviewNamed' | translate: { title: r.title }"
                        (click)="review(request)"
                        data-testid="mts-review"
                      >
                        {{ 'taskPage.action.reviewRequest' | translate }}
                      </button>
                    }
                  } @else if (r.row && r.row.actions.reassign) {
                    <button
                      type="button"
                      class="am-mts__btn"
                      [disabled]="busyId() !== null"
                      [attr.aria-label]="'tasks.sections.decision.reassignNamed' | translate: { title: r.title }"
                      (click)="reassign(r.row)"
                      data-testid="mts-reassign"
                    >
                      {{ 'taskPage.action.reassign' | translate }}
                    </button>
                  }
                </span>
              </li>
            }
          </ul>
        }
      </section>
    }

    @if (showAvailable()) {
      <section class="am-mts am-mts--info" aria-labelledby="mtsAvailableHeading" data-testid="mts-available">
        <div class="am-mts__head">
          <h2 id="mtsAvailableHeading" class="am-mts__title">{{ 'task.available' | translate }}</h2>
          <span class="am-mts__count" [attr.aria-label]="availableCountLabel()" data-testid="mts-available-count">{{ availableCountText() }}</span>
          <p class="am-mts__purpose">{{ 'tasks.sections.available.purpose' | translate }}</p>
        </div>
        @if (availableState() === 'error') {
          <p class="am-mts__failed" role="alert" data-testid="mts-available-failed">
            {{ 'tasks.sections.available.failed' | translate }} ·
            <button type="button" class="am-mts__retry" (click)="loadAvailable()" data-testid="mts-available-retry">{{ 'common.retry' | translate }}</button>
          </p>
        } @else {
          @if (pickError()) {
            <p class="am-mts__failed" role="alert" data-testid="mts-pick-error">{{ pickError() }}</p>
          }
          <ul class="am-mts__rows" role="list">
            @for (a of availableRows(); track a.task.id) {
              <li class="am-mts__row am-mts__row--available" [class.am-mts__row--sought]="soughtTaskId() === a.task.id" [attr.data-task-row]="a.task.id" tabindex="-1">
                <span class="am-mts__task">
                  <span class="am-mts__title-line"><am-task-link [taskId]="a.task.id" [title]="a.task.title" /></span>
                  <span class="am-mts__sub">
                    <span aria-hidden="true">◇&nbsp;</span>
                    @if (a.record.href) {
                      <a class="am-mts__record" [routerLink]="a.record.href" data-testid="mts-record">{{ a.record.label }}</a>
                    } @else {
                      <span data-testid="mts-record">{{ a.record.label }}</span>
                    }
                    @if (a.pool) {
                      <span data-testid="mts-pool">&nbsp;· {{ 'tasks.sections.available.offeredTo' | translate: { pool: a.pool } }}</span>
                    }
                  </span>
                </span>
                <span class="am-mts__cell" data-testid="mts-priority">
                  @if (a.priority.glyph) {<span aria-hidden="true">{{ a.priority.glyph }}&nbsp;</span>}{{ a.priority.label }}
                </span>
                <span class="am-mts__cell" data-testid="mts-due">{{ a.task.dueAt | amDateTime }}</span>
                <span class="am-mts__act">
                  <button
                    type="button"
                    class="am-mts__btn"
                    [disabled]="picking() !== null"
                    [attr.aria-busy]="picking() === a.task.id ? 'true' : null"
                    [attr.aria-label]="'task.pickNamed' | translate: { title: a.task.title }"
                    (click)="pick(a.task)"
                    data-testid="mts-pick"
                  >
                    {{ 'task.pick' | translate }}
                  </button>
                </span>
              </li>
            }
          </ul>
        }
      </section>
    }

    <app-task-action-host (changed)="onActionDone()" (failed)="onActionFailed($event)" (busyChange)="busyId.set($event)" />
  `,
  styles: [
    `
      :host{display:flex;flex-direction:column;gap:var(--am-space-12)}
      .am-mts{display:flex;flex-direction:column;gap:var(--am-space-8);padding:var(--am-space-12) var(--am-space-16);border:1px solid;border-radius:var(--am-radius-card)}
      .am-mts--warning{background:var(--am-warning-bg);border-color:var(--am-warning-border)}
      .am-mts--info{background:var(--am-info-bg);border-color:var(--am-info-border)}
      .am-mts__head{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--am-space-4) var(--am-space-8)}
      .am-mts__title{margin:0;font-size:var(--am-type-body-size);font-weight:600;color:var(--am-ink-900)}
      .am-mts__count{min-inline-size:var(--am-space-24);padding:0 var(--am-space-6);border-radius:var(--am-radius-pill);background:var(--am-surface-raised);font-size:var(--am-type-meta-size);font-weight:600;text-align:center}
      .am-mts--warning .am-mts__count{color:var(--am-warning-ink)}
      .am-mts--info .am-mts__count{color:var(--am-info-ink)}
      .am-mts__purpose{margin:0;flex:1 1 auto;font-size:var(--am-type-meta-size);color:var(--am-ink-700)}
      .am-mts__failed{margin:0;font-size:var(--am-type-meta-size);color:var(--am-danger-ink)}
      .am-mts__retry{font:inherit;border:0;background:none;padding:0;color:var(--am-primary-700);text-decoration:underline;cursor:pointer}
      .am-mts__rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--am-space-6)}
      .am-mts__row{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,2fr) auto;gap:var(--am-space-12);align-items:center;padding:var(--am-space-8) var(--am-space-12);border:1px solid var(--am-border);border-radius:var(--am-radius-control);background:var(--am-surface-raised)}
      .am-mts__row--available{grid-template-columns:minmax(0,3fr) minmax(0,1fr) minmax(0,1.3fr) auto}
      .am-mts__row--sought{border-color:var(--am-primary-600);box-shadow:inset 3px 0 0 var(--am-primary-600)}
      :host-context([dir=rtl]) .am-mts__row--sought{box-shadow:inset -3px 0 0 var(--am-primary-600)}
      .am-mts__row:focus-visible,.am-mts__btn:focus-visible,.am-mts__retry:focus-visible,.am-mts__record:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-mts__task,.am-mts__ask{display:flex;flex-direction:column;min-inline-size:0}
      .am-mts__sub,.am-mts__why{display:flex;flex-wrap:wrap;min-inline-size:0;font-size:var(--am-type-meta-size);color:var(--am-ink-700)}
      .am-mts__record{color:var(--am-primary-700);text-decoration:none}.am-mts__record:hover{text-decoration:underline}
      .am-mts__cell{font-size:var(--am-type-meta-size);color:var(--am-ink-900)}
      .am-mts__act{display:flex;justify-content:flex-end}
      .am-mts__btn{font:inherit;font-size:var(--am-type-meta-size);font-weight:600;white-space:nowrap;padding:var(--am-space-4) var(--am-space-12);border:1px solid var(--am-primary-600);border-radius:var(--am-radius-button);background:var(--am-surface-raised);color:var(--am-primary-700);cursor:pointer}
      .am-mts__btn:disabled{cursor:not-allowed;color:var(--am-ink-500);border-color:var(--am-border)}
      /* Phone: each row is a card, its parts stacked. */
      @media (max-width:759.98px){.am-mts__row,.am-mts__row--available{grid-template-columns:minmax(0,1fr);gap:var(--am-space-4)}.am-mts__act{justify-content:flex-start}}
    `,
  ],
})
export class MyTasksSectionsComponent {
  private readonly tasks = inject(TaskService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);
  private readonly access = inject(NavigationAccessService);
  private readonly auth = inject(AuthService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** A request to mark (a ?request= link), when it is in "Waiting for your decision". */
  readonly soughtRequestId = input<string | null>(null);
  /** A task to mark (a ?task= link), when it is in "Available to pick up". */
  readonly soughtTaskId = input<string | null>(null);

  /** Something changed (a decision, a reassign, a pick): the list below reloads. */
  readonly changed = output<void>();
  /** The requests now shown, after each load: the shell checks a ?request= against them. */
  readonly requestsLoaded = output<string[]>();
  /** The tasks now available, after each load; null when it failed. */
  readonly availableLoaded = output<string[] | null>();

  private readonly actionHost = viewChild(TaskActionHostComponent);

  // ── What came back ────────────────────────────────────────────────────
  readonly requests = signal<ITaskRequestInboxDto[]>([]);
  readonly rejected = signal<ITaskRecordRowDto[]>([]);
  readonly rejectedMatching = signal(0);
  private readonly requestsState = signal<LoadState>('loading');
  private readonly rejectedState = signal<LoadState>('loading');
  readonly available = signal<IAvailableTaskListItemDto[]>([]);
  readonly availableState = signal<LoadState>('loading');

  readonly picking = signal<string | null>(null);
  readonly pickError = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly decisionError = signal<string | null>(null);

  /** Either read failing fails the section: one line, one Retry for both. */
  readonly decisionState = computed<LoadState>(() => {
    const states = [this.requestsState(), this.rejectedState()];
    if (states.includes('error')) return 'error';
    return states.every((s) => s === 'ready') ? 'ready' : 'loading';
  });

  readonly decisionRows = computed<DecisionRow[]>(() => {
    this.translate.currentLang();
    const requests = this.requests().map((r) => this.requestRow(r));
    const rejected = this.rejected().map((r) => this.rejectedRow(r));
    // Soonest due first; a task with no due date last; then by title.
    return [...requests, ...rejected].sort((a, b) => {
      if (a.dueAt !== b.dueAt) {
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      }
      return a.title.localeCompare(b.title);
    });
  });

  readonly availableRows = computed<AvailableRow[]>(() => {
    this.translate.currentLang();
    return this.available().map((task) => ({
      task,
      record: this.recordView(task.record),
      pool: task.pool ? this.poolLabel(task.pool) : null,
      priority: this.priority(task.priority),
    }));
  });

  /** Present while it has something to show, or something to say (a failure). */
  readonly showDecision = computed(() => this.decisionState() === 'error' || (this.decisionState() === 'ready' && this.decisionRows().length > 0));
  readonly showAvailable = computed(() => this.availableState() === 'error' || (this.availableState() === 'ready' && this.available().length > 0));

  /** The requests plus the rejected list's matching (not its total). Null when unknown. */
  private readonly decisionCount = computed(() => (this.decisionState() === 'ready' ? this.requests().length + this.rejectedMatching() : null));
  private readonly availableCount = computed(() => (this.availableState() === 'ready' ? this.available().length : null));

  readonly decisionCountText = computed(() => this.countText(this.decisionCount()));
  readonly availableCountText = computed(() => this.countText(this.availableCount()));
  readonly decisionCountLabel = computed(() => {
    this.translate.currentLang();
    const n = this.decisionCount();
    return n === null ? this.translate.instant('tasks.sections.countUnknown') : this.format.count('tasks.sections.decisionCount', n);
  });
  readonly availableCountLabel = computed(() => {
    this.translate.currentLang();
    const n = this.availableCount();
    return n === null ? this.translate.instant('tasks.sections.countUnknown') : this.format.count('tasks.sections.availableCount', n);
  });

  constructor() {
    this.reload();
    // A marked row is brought into view and focused, once it is drawn.
    effect(() => {
      const request = this.soughtRequestId();
      const task = this.soughtTaskId();
      const shown = this.decisionRows().length + this.available().length;
      untracked(() => {
        const selector = request ? `[data-request-row="${request}"]` : task ? `[data-task-row="${task}"]` : null;
        if (!selector || !shown) return;
        afterNextRender(
          () => {
            const row = this.host.nativeElement.querySelector<HTMLElement>(selector);
            row?.scrollIntoView({ block: 'center' });
            row?.focus({ preventScroll: true });
          },
          { injector: this.injector },
        );
      });
    });
  }

  /** Both sections, from the server: after a save on the page, and at first. */
  reload(): void {
    this.loadDecision();
    this.loadAvailable();
  }

  loadDecision(): void {
    this.decisionError.set(null);
    this.requestsState.set('loading');
    this.rejectedState.set('loading');
    this.tasks.getAwaitingDecision().subscribe({
      next: (requests) => {
        this.requests.set(requests);
        this.requestsState.set('ready');
        this.requestsLoaded.emit(requests.map((r) => r.id));
      },
      error: () => this.requestsState.set('error'),
    });
    this.tasks.getRecordList({ view: 'created', status: ['REJECTED'], take: REJECTED_PAGE, skip: 0 }).subscribe({
      next: (page) => {
        this.rejected.set(page.items);
        this.rejectedMatching.set(page.matching);
        this.rejectedState.set('ready');
      },
      error: () => this.rejectedState.set('error'),
    });
  }

  loadAvailable(): void {
    this.availableState.set('loading');
    this.tasks.getAvailable().subscribe({
      next: (tasks) => {
        this.available.set(tasks);
        this.availableState.set('ready');
        this.availableLoaded.emit(tasks.map((t) => t.id));
      },
      error: () => {
        this.availableState.set('error');
        this.availableLoaded.emit(null);
      },
    });
  }

  /** The inbox is the viewer's to decide by construction; the person who asked never decides. */
  canReview(request: ITaskRequestInboxDto): boolean {
    return request.requestedById !== this.auth.currentUser()?.id;
  }

  review(request: ITaskRequestInboxDto): void {
    this.decisionError.set(null);
    this.actionHost()?.reviewRequest(request);
  }

  reassign(row: ITaskRecordRowDto): void {
    this.decisionError.set(null);
    this.actionHost()?.run(row, 'reassign');
  }

  /**
   * A 409 means someone else picked it up first: the server's sentence is said,
   * and the section reloads either way so the row leaves.
   */
  pick(task: IAvailableTaskListItemDto): void {
    if (this.picking() !== null) return;
    this.picking.set(task.id);
    this.pickError.set(null);
    this.tasks.pick(task.id).subscribe({
      next: () => {
        this.picking.set(null);
        this.loadAvailable();
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.picking.set(null);
        this.loadAvailable();
        this.changed.emit();
        this.pickError.set(this.translate.instant(extractErrorMessage(err, 'task.errorAction')));
      },
    });
  }

  /** A decision or a reassign finished: this section reloads, and so does the list. */
  onActionDone(): void {
    this.loadDecision();
    this.changed.emit();
  }

  onActionFailed(failure: TaskActionFailure): void {
    this.decisionError.set(failure.message);
  }

  private requestRow(r: ITaskRequestInboxDto): DecisionRow {
    const ask =
      r.type === 'ON_HOLD'
        ? this.translate.instant('tasks.sections.decision.askHold', { date: this.format.date(r.holdUntil) })
        : this.translate.instant('tasks.sections.decision.askMore', {
            from: this.format.dateTime(r.task.dueAt),
            to: this.format.dateTime(r.requestedDueAt),
          });
    return {
      kind: 'request',
      id: r.id,
      taskId: r.task.id,
      title: r.task.title,
      dueAt: r.task.dueAt,
      record: this.recordView(r.record),
      who: r.requestedByName,
      ask,
      why: r.reason ? this.translate.instant('tasks.sections.quoted', { text: r.reason }) : null,
      request: r,
      row: null,
    };
  }

  private rejectedRow(row: ITaskRecordRowDto): DecisionRow {
    const name = row.rejectedBy?.name ?? null;
    return {
      kind: 'rejected',
      id: row.id,
      taskId: row.id,
      title: this.language.bilingual(row.title, row.titleAr),
      dueAt: row.dueAt,
      record: this.recordView(row.record),
      who: name ?? this.translate.instant('task.status.rejected'),
      ask: name ? this.translate.instant('tasks.sections.decision.rejectedBy', { name }) : this.translate.instant('task.status.rejected'),
      why: row.rejectedReason ? this.translate.instant('tasks.sections.quoted', { text: row.rejectedReason }) : null,
      request: null,
      row,
    };
  }

  /** Its name and link by the one rule; with no name, its type word, never the code. */
  private recordView(record: TaskRecordRefDto | null): RecordView {
    if (!record) return { label: this.translate.instant(taskRecordTypeKey('OTHER')), href: null };
    return {
      label: record.nameEn ? this.language.bilingual(record.nameEn, record.nameAr) : this.translate.instant(taskRecordTypeKey(record.type)),
      href: taskRecordHref(record, (p) => this.access.hasPermission(p)),
    };
  }

  private poolLabel(pool: TaskPoolDto): string {
    return taskPoolLabel(pool, (en, ar) => this.language.bilingual(en, ar), this.language.isArabic());
  }

  private priority(priority: string): { glyph: string | null; label: string } {
    const key = taskPriorityKey(priority);
    const label = this.translate.instant(key);
    return { glyph: taskPriorityGlyph(priority), label: label === key ? priority : label };
  }

  private countText(n: number | null): string {
    return n === null ? '—' : this.format.number(n);
  }
}
