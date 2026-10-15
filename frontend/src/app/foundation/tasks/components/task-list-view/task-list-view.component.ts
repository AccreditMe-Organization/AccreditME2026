import {
  Component,
  DestroyRef,
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
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AmDatePipe, FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { RowMenuComponent, RowMenuItem } from '../../../../shared/components/row-menu/row-menu.component';
import { TaskLinkComponent } from '../task-link/task-link.component';
import { TaskActionFailure, TaskActionHostComponent } from '../task-action-host/task-action-host.component';
import {
  ITaskRecordListDto,
  ITaskRecordRowDto,
  TaskRecordListQuery,
  TaskRecordListSort,
  TaskRecordListStatus,
  TaskService,
} from '../../services/task.service';
import { TaskRowActionId, TaskRowActionModel, asRowAction, taskRowActions } from '../../task-row-actions';
import { TaskRowText } from '../../task-row-text';
import { taskPoolLabel } from '../../task-pool-label';

/** Below this window width rows are two-line cards (the phone sheet). */
export const TASK_LIST_PHONE_BELOW_PX = 760;
const PAGE = 50;
const SEARCH_DELAY_MS = 250;

const STATUSES: TaskRecordListStatus[] = ['UNASSIGNED', 'PENDING', 'IN_PROGRESS', 'ON_HOLD', 'REJECTED', 'COMPLETED', 'CANCELLED'];
const SORTS: { value: string; key: string }[] = [
  { value: 'due:asc', key: 'taskList.sort.dueAsc' },
  { value: 'due:desc', key: 'taskList.sort.dueDesc' },
  { value: 'created:desc', key: 'taskList.sort.createdDesc' },
  { value: 'created:asc', key: 'taskList.sort.createdAsc' },
  { value: 'updated:desc', key: 'taskList.sort.updatedDesc' },
  { value: 'status:asc', key: 'taskList.sort.statusAsc' },
  { value: 'title:asc', key: 'taskList.sort.titleAsc' },
  { value: 'title:desc', key: 'taskList.sort.titleDesc' },
];

interface Chip {
  id: 'q' | 'status' | 'overdue' | 'who' | 'required' | 'due' | 'mine' | 'link';
  label: string;
}

interface ViewRow {
  row: ITaskRecordRowDto;
  title: string;
  due: { text: string; tone: string };
  who: string;
  position: string;
  statusKey: string;
  fact: string | null;
  tagKey: string | null;
  recordLine: string | null;
  model: TaskRowActionModel;
  menu: RowMenuItem[][];
}

/**
 * ACC-229 — THE ALL TASKS LIST (Record Tasks Panel §2): a record's tasks in
 * the popup behind "See all", or the organisation's at /tasks/all.
 *
 * Everything is the server's: search, filters and sort run there, 50 rows at a
 * time, so a list of hundreds stays quick and Load more continues the same
 * order. It opens on its defaults every time and remembers nothing (drawn Q3).
 *
 * Only the list scrolls. The toolbar, chips, column header and footer stay
 * put; below 760px the rows become two-line cards. A row's action runs in
 * place: the row is read again where it sits, and a failure is said under
 * that row only (ACC-217).
 */
@Component({
  selector: 'app-task-list-view',
  standalone: true,
  imports: [FormsModule, TranslatePipe, AmDatePipe, OverlaySelectComponent, RowMenuComponent, TaskLinkComponent, TaskActionHostComponent],
  template: `
    <div class="am-tl" [class.am-tl--page]="variant() === 'page'" data-testid="task-list-view">
      <div class="am-tl__toolbar" role="search" data-testid="task-list-toolbar">
        <span class="am-tl__search">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            #search
            type="search"
            [value]="qInput()"
            (input)="onSearch(search.value)"
            [attr.aria-label]="'taskList.searchLabel' | translate"
            [placeholder]="'taskList.searchPlaceholder' | translate"
            data-testid="task-list-search"
          />
        </span>
        <app-overlay-select
          class="am-tl__filter"
          [options]="statusOptions()"
          [placeholder]="'taskList.filter.status' | translate"
          [ariaLabel]="'taskList.filter.status' | translate"
          [showClear]="true"
          [ngModel]="status()"
          (ngModelChange)="status.set($event)"
          data-testid="filter-status"
        />
        <button type="button" class="am-tl__toggle" [attr.aria-pressed]="overdue()" (click)="overdue.set(!overdue())" data-testid="filter-overdue">
          {{ 'taskList.filter.overdueOnly' | translate }}
        </button>
        <app-overlay-select
          class="am-tl__filter am-tl__filter--wide"
          [options]="whoOptions()"
          optionGroupLabel="label"
          optionGroupChildren="items"
          [groupsSelectable]="false"
          [placeholder]="'taskList.filter.assignee' | translate"
          [ariaLabel]="'taskList.filter.assignee' | translate"
          [showClear]="true"
          [ngModel]="who()"
          (ngModelChange)="who.set($event)"
          data-testid="filter-who"
        />
        <app-overlay-select
          class="am-tl__filter"
          [options]="requiredOptions()"
          [placeholder]="'taskList.filter.required' | translate"
          [ariaLabel]="'taskList.filter.required' | translate"
          [showClear]="true"
          [ngModel]="required()"
          (ngModelChange)="required.set($event)"
          data-testid="filter-required"
        />
        <app-overlay-select
          class="am-tl__filter"
          [options]="dueOptions()"
          [placeholder]="'taskList.filter.due' | translate"
          [ariaLabel]="'taskList.filter.due' | translate"
          [showClear]="true"
          [ngModel]="due()"
          (ngModelChange)="due.set($event)"
          data-testid="filter-due"
        />
        <button type="button" class="am-tl__toggle" [attr.aria-pressed]="mine()" (click)="mine.set(!mine())" data-testid="filter-mine">
          {{ 'taskList.filter.mine' | translate }}
        </button>
        <app-overlay-select
          class="am-tl__filter am-tl__filter--wide"
          [options]="sortOptions()"
          [ngModel]="sortValue()"
          (ngModelChange)="sortValue.set($event ?? 'due:asc')"
          [ariaLabel]="'taskList.sort.label' | translate"
          data-testid="task-list-sort"
        />
      </div>

      <div class="am-tl__chips" data-testid="task-list-chips">
        @for (chip of chips(); track chip.id) {
          <button
            type="button"
            class="am-tl__chip"
            [attr.aria-label]="'taskList.chip.remove' | translate: { filter: chip.label }"
            (click)="removeChip(chip.id)"
          >
            {{ chip.label }} <span aria-hidden="true">✕</span>
          </button>
        }
        @if (chips().length > 1 || (chips().length === 1 && chips()[0].id !== 'link')) {
          <button type="button" class="am-tl__clear" (click)="clearAll()" data-testid="task-list-clear">{{ 'taskList.chip.clearAll' | translate }}</button>
        }
        <span class="flex-1"></span>
        <span class="text-xs text-[var(--am-ink-700)]" aria-live="polite" data-testid="task-list-live">{{ liveText() }}</span>
      </div>

      <div #scroller class="am-tl__scroll" data-testid="task-list-scroll" [attr.aria-busy]="phase() === 'loading'">
        @if (!phone()) {
          <div class="am-tl__row am-tl__head" role="row" data-testid="task-list-head">
            <span role="columnheader">{{ 'taskList.col.task' | translate }}</span>
            <span role="columnheader">{{ 'taskList.col.status' | translate }}</span>
            <span role="columnheader">{{ 'taskList.col.assignee' | translate }}</span>
            <span role="columnheader">{{ 'taskList.col.due' | translate }}</span>
            <span role="columnheader">{{ 'taskList.col.createdBy' | translate }}</span>
            <span role="columnheader">{{ 'taskList.col.updated' | translate }}</span>
            <span role="columnheader"><span class="sr-only">{{ 'taskList.col.actions' | translate }}</span></span>
          </div>
        }
        @switch (phase()) {
          @case ('loading') {
            @for (i of skeleton; track i) {
              <div class="am-tl__row" aria-hidden="true"><span class="[grid-column:1/-1] h-3.5 rounded bg-[var(--am-surface)]"></span></div>
            }
          }
          @case ('error') {
            <div class="flex flex-col items-start gap-2 px-4 py-6" role="alert" data-testid="task-list-error">
              <p class="m-0">{{ 'taskList.error' | translate }}</p>
              <button type="button" class="am-tl__btn" (click)="reload()">{{ 'list.retry' | translate }}</button>
            </div>
          }
          @default {
            @if (rows().length === 0) {
              <div class="flex flex-col items-start gap-2 px-4 py-6" data-testid="task-list-empty">
                @if (filtered()) {
                  <p class="m-0 font-semibold">
                    {{ (q() ? 'taskList.noMatchSearch' : 'taskList.noMatch') | translate: { q: q() } }}
                  </p>
                  <p class="m-0 text-[12.5px] text-[var(--am-ink-500)]">{{ countText('taskList.live.total', total()) }}</p>
                  <button type="button" class="am-tl__btn" (click)="clearAll()">{{ (q() && chips().length === 1 ? 'taskList.clearSearch' : 'taskList.chip.clearAll') | translate }}</button>
                } @else {
                  <p class="m-0">{{ 'taskList.empty' | translate }}</p>
                }
              </div>
            }
            <ul class="list-none m-0 p-0" role="list">
              @for (r of rows(); track r.row.id) {
                <li
                  class="am-tl__row am-tl__item"
                  [class.am-tl__item--card]="phone()"
                  [class.am-tl__item--sought]="highlightId() === r.row.id"
                  [attr.data-task-row]="r.row.id"
                  tabindex="-1"
                >
                  <span class="am-tl__task">
                    <span class="flex items-center gap-1.5 min-w-0">
                      <span class="am-tl__title"><am-task-link [taskId]="r.row.id" [title]="r.title" /></span>
                      @if (r.tagKey) {
                        <span class="am-tl__tag">{{ r.tagKey | translate }}</span>
                      }
                    </span>
                    @if (phone()) {
                      @if (r.recordLine) {
                        <span class="am-tl__sub am-tl__tail">{{ r.recordLine }}</span>
                      }
                      <span class="am-tl__sub">
                        <span class="am-tl__due" [attr.data-tone]="r.due.tone">{{ r.due.text }}</span>
                        <span class="am-tl__tail"> · {{ r.who }} · {{ r.statusKey | translate }}</span>
                      </span>
                    } @else if (r.fact || r.recordLine) {
                      <span class="am-tl__sub am-tl__tail">{{ r.recordLine ? r.recordLine : '' }}{{ r.recordLine && r.fact ? ' · ' : '' }}{{ r.fact }}</span>
                    }
                  </span>
                  @if (!phone()) {
                    <span class="min-w-0">{{ r.statusKey | translate }}</span>
                    <span class="am-tl__task">
                      <span class="am-tl__tail">{{ r.who }}</span>
                      @if (r.position) {
                        <span class="am-tl__sub am-tl__tail">{{ r.position }}</span>
                      }
                    </span>
                    <span class="min-w-0 am-tl__due" [attr.data-tone]="r.due.tone">{{ r.due.text }}</span>
                    <span class="min-w-0 am-tl__tail">{{ r.row.createdBy.name }}</span>
                    <span class="min-w-0">{{ r.row.updatedAt | amDate }}</span>
                  }
                  <span class="flex items-center justify-end gap-1">
                    @if (r.model.primary; as p) {
                      <button
                        type="button"
                        class="am-tl__btn am-tl__btn--primary"
                        [disabled]="p.disabled || busyId() === r.row.id"
                        [attr.aria-label]="(p.labelKey | translate) + ' ' + r.title"
                        [attr.title]="p.disabled ? ('task.completeNeedsEvidence' | translate) : null"
                        [attr.data-action]="p.id"
                        (click)="act(r.row, p.id)"
                      >
                        {{ p.labelKey | translate }}
                      </button>
                    }
                    <am-row-menu [groups]="r.menu" [label]="'taskActions.moreActionsFor' | translate: { title: r.title }" (picked)="act(r.row, asRowAction($event))" />
                  </span>
                  @if (rowErrors()[r.row.id]; as message) {
                    <span class="basis-full [grid-column:1/-1] text-xs text-[var(--am-danger-ink)]" role="alert">
                      {{ message }}
                      <button type="button" class="[font:inherit] border-0 bg-transparent p-0 underline cursor-pointer text-[var(--am-primary-700)]" (click)="retryRow(r.row)">{{ 'list.retry' | translate }}</button>
                    </span>
                  }
                </li>
              }
            </ul>
          }
        }
      </div>

      <div class="am-tl__foot" data-testid="task-list-foot">
        @if (phase() === 'ready') {
          <span>{{ footText() }}</span>
          <span class="flex-1"></span>
          @if (more() === 'failed') {
            <span class="text-[var(--am-danger-ink)]" role="alert">{{ 'taskList.live.loadMoreFailed' | translate }}</span>
            <button type="button" class="am-tl__btn" (click)="loadMore()">{{ 'list.retry' | translate }}</button>
          } @else if (rows().length < matching()) {
            <button type="button" class="am-tl__btn" [disabled]="more() === 'loading'" (click)="loadMore()" data-testid="task-list-more">
              {{ (more() === 'loading' ? 'taskList.live.loadingMore' : 'taskList.live.loadMore') | translate }}
            </button>
          }
        }
      </div>
    </div>

    <app-task-action-host (changed)="onChanged($event)" (failed)="onFailed($event)" (busyChange)="busyId.set($event)" />
  `,
  styles: [
    `
      :host{display:flex;flex-direction:column;flex:1 1 auto;min-block-size:0}
      .am-tl{display:flex;flex-direction:column;flex:1 1 auto;min-block-size:0;font-size:13px}
      .am-tl--page{block-size:max(420px,calc(100vh - 200px));border:1px solid var(--am-border);border-radius:var(--am-radius-card);background:var(--am-surface-raised)}
      .am-tl__toolbar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 16px;border-block-end:1px solid var(--am-border)}
      .am-tl__search{flex:1 1 200px;display:flex;align-items:center;gap:6px;block-size:32px;padding:0 10px;border:1px solid var(--am-control-border);border-radius:var(--am-radius-control)}
      .am-tl__search input{flex:1;min-inline-size:0;border:0;outline:0;font:inherit;background:none}
      .am-tl__search:focus-within{outline:var(--am-focus-ring-width) solid var(--am-focus-ring)}
      .am-tl__filter{inline-size:140px}.am-tl__filter--wide{inline-size:180px}
      .am-tl__toggle,.am-tl__btn,.am-tl__chip,.am-tl__clear{font:inherit;font-size:12.5px;block-size:32px;padding:0 11px;border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);background:var(--am-surface-raised);color:var(--am-ink-900);cursor:pointer;white-space:nowrap}
      .am-tl__toggle[aria-pressed=true]{border-color:var(--am-primary-600);background:var(--am-primary-100);color:var(--am-primary-700);font-weight:600}
      .am-tl__chips{flex:none;display:flex;align-items:center;gap:6px;min-block-size:36px;padding:2px 16px;border-block-end:1px solid var(--am-border)}
      .am-tl__chip{block-size:24px;padding:0 9px;border-radius:var(--am-radius-pill);background:var(--am-primary-50);border-color:var(--am-primary-200)}
      .am-tl__clear{block-size:24px;border:0;background:none;color:var(--am-primary-700)}
      .am-tl__scroll{flex:1 1 auto;min-block-size:0;overflow:auto;position:relative}
      .am-tl__row{display:grid;grid-template-columns:minmax(200px,2.2fr) 104px minmax(140px,1.4fr) 168px 124px 96px auto;gap:10px;align-items:center;min-inline-size:1032px;box-sizing:border-box;padding:6px 16px;border-block-end:1px solid var(--am-border)}
      .am-tl__head{position:sticky;inset-block-start:0;z-index:1;block-size:30px;padding-block:0;background:var(--am-surface);font-size:11.5px;font-weight:600;color:var(--am-ink-700)}
      .am-tl__item{min-block-size:52px}.am-tl__item:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:-2px}
      .am-tl__item--card{display:flex;flex-wrap:wrap;min-inline-size:0;min-block-size:60px;gap:4px 8px}
      .am-tl__item--card .am-tl__task{flex:1 1 0}
      .am-tl__item--sought{background:var(--am-primary-50);box-shadow:inset 3px 0 0 var(--am-primary-600)}
      .am-tl__task{display:flex;flex-direction:column;min-inline-size:0}
      .am-tl__title,.am-tl__tail{min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .am-tl__sub{display:flex;min-inline-size:0;font-size:11.5px;color:var(--am-ink-500)}
      .am-tl__due{white-space:nowrap}.am-tl__due[data-tone=danger]{color:var(--am-danger-ink);font-weight:600}.am-tl__due[data-tone=info]{color:var(--am-info-ink)}.am-tl__due[data-tone=muted]{color:var(--am-ink-500)}
      .am-tl__tag{flex:none;font-size:11px;font-weight:600;padding:0 6px;border-radius:var(--am-radius-pill);background:var(--am-surface);border:1px solid var(--am-border);color:var(--am-ink-700)}
      .am-tl__btn--primary{block-size:26px;font-weight:600;color:var(--am-primary-700);border-color:var(--am-primary-600)}
      .am-tl__btn:disabled{cursor:not-allowed;color:var(--am-ink-500);border-color:var(--am-border)}
      .am-tl__foot{flex:none;display:flex;align-items:center;gap:8px;block-size:44px;padding:0 16px;border-block-start:1px solid var(--am-border);color:var(--am-ink-700);font-size:12.5px}
      :host-context([dir=rtl]) .am-tl__foot{block-size:48px}:host-context([dir=rtl]) .am-tl__item{min-block-size:58px}:host-context([dir=rtl]) .am-tl__item--card{min-block-size:64px}
      button:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
    `,
  ],
})
export class TaskListViewComponent {
  private readonly tasks = inject(TaskService);
  private readonly text = inject(TaskRowText);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  /** A record's tasks; both absent means the organisation's (tasks:view). */
  readonly sourceType = input<string | null>(null);
  readonly sourceId = input<string | null>(null);
  /** A task to open at (a deep link): the list loads to it and highlights it. */
  readonly around = input<string | null>(null);
  readonly variant = input<'popup' | 'page'>('popup');
  /** Something on the list changed — the panel behind refreshes when the popup closes. */
  readonly changed = output<void>();
  readonly totalChange = output<{ total: number; scope: 'all' | 'own' }>();

  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  // ── The query ─────────────────────────────────────────────────────────
  readonly qInput = signal('');
  readonly q = signal('');
  readonly status = signal<TaskRecordListStatus | null>(null);
  readonly overdue = signal(false);
  readonly who = signal<string | null>(null);
  readonly required = signal<'REQUIRED' | 'OPTIONAL' | null>(null);
  readonly due = signal<'THIS_WEEK' | 'LATER' | 'NONE' | null>(null);
  readonly mine = signal(false);
  readonly sortValue = signal('due:asc');

  // ── What came back ────────────────────────────────────────────────────
  readonly phase = signal<'loading' | 'ready' | 'error'>('loading');
  readonly more = signal<'idle' | 'loading' | 'failed'>('idle');
  readonly items = signal<ITaskRecordRowDto[]>([]);
  readonly total = signal(0);
  readonly matching = signal(0);
  readonly facets = signal<ITaskRecordListDto['facets']>(null);
  readonly highlightId = signal<string | null>(null);
  readonly linkTitle = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly rowErrors = signal<Record<string, string>>({});
  readonly phone = signal(false);
  protected readonly skeleton = Array.from({ length: 10 }, (_, i) => i);

  private lastAction: Record<string, TaskRowActionId> = {};
  private request: Subscription | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private aroundPending: string | null = null;

  readonly query = computed<TaskRecordListQuery>(() => {
    const [sort, dir] = this.sortValue().split(':') as [TaskRecordListSort, 'asc' | 'desc'];
    const who = this.who();
    return {
      sourceType: this.sourceType() ?? undefined,
      sourceId: this.sourceId() ?? undefined,
      q: this.q() || undefined,
      status: this.status() ? [this.status()!] : undefined,
      overdue: this.overdue() || undefined,
      assignee: who?.startsWith('user:') ? who.slice(5) : undefined,
      pool: who?.startsWith('pool:') ? who.slice(5) : undefined,
      required: this.required() ?? undefined,
      due: this.due() ?? undefined,
      mine: this.mine() || undefined,
      sort,
      dir,
    };
  });

  readonly filtered = computed(() => {
    const q = this.query();
    return !!(q.q || q.status || q.overdue || q.assignee || q.pool || q.required || q.due || q.mine);
  });

  readonly rows = computed<ViewRow[]>(() => {
    this.translate.currentLang();
    const now = new Date();
    return this.items().map((row) => {
      const model = taskRowActions(row.actions, row.evidenceCount);
      return {
        row,
        title: this.text.title(row),
        due: this.text.due(row, now),
        who: this.text.who(row),
        position: this.text.position(row),
        statusKey: this.text.statusKey(row),
        fact: this.text.fact(row),
        tagKey: this.text.requirementKey(row),
        recordLine: row.record ? this.recordLine(row.record) : null,
        model,
        menu: model.menu.map((group) =>
          group.map((a) => ({
            id: a.id,
            label: a.count !== undefined ? this.translate.instant(a.labelKey, { count: a.count }) : this.translate.instant(a.labelKey),
            sub: a.subKey ? this.translate.instant(a.subKey) : undefined,
            danger: a.danger,
            disabled: a.disabled,
          })),
        ),
      };
    });
  });

  // ── The toolbar's options ─────────────────────────────────────────────
  readonly statusOptions = computed(() => {
    this.translate.currentLang();
    return STATUSES.map((s) => ({ value: s, label: this.translate.instant(`task.status.${s.toLowerCase()}`) }));
  });
  readonly requiredOptions = computed(() => {
    this.translate.currentLang();
    return [
      { value: 'REQUIRED', label: this.translate.instant('taskList.tag.required') },
      { value: 'OPTIONAL', label: this.translate.instant('taskList.tag.optional') },
    ];
  });
  readonly dueOptions = computed(() => {
    this.translate.currentLang();
    return [
      { value: 'THIS_WEEK', label: this.translate.instant('taskList.filter.dueThisWeek') },
      { value: 'LATER', label: this.translate.instant('taskList.filter.dueLater') },
      { value: 'NONE', label: this.translate.instant('taskList.filter.dueNone') },
    ];
  });
  readonly sortOptions = computed(() => {
    this.translate.currentLang();
    return SORTS.map((s) => ({ value: s.value, label: this.translate.instant(s.key) }));
  });
  readonly whoOptions = computed(() => {
    this.translate.currentLang();
    const f = this.facets();
    if (!f) return [];
    const groups = [];
    if (f.people.length) {
      groups.push({ label: this.translate.instant('taskList.filter.people'), items: f.people.map((p) => ({ value: `user:${p.id}`, label: p.name })) });
    }
    if (f.pools.length) {
      groups.push({
        label: this.translate.instant('taskList.filter.pools'),
        items: f.pools.map((p) => ({
          value: `pool:${p.key}`,
          label: taskPoolLabel(p.pool, (en, ar) => this.language.bilingual(en, ar), this.language.isArabic()),
        })),
      });
    }
    return groups;
  });

  readonly chips = computed<Chip[]>(() => {
    this.translate.currentLang();
    const chips: Chip[] = [];
    const named = (key: string, value: string) => this.translate.instant(key, { value });
    if (this.linkTitle()) chips.push({ id: 'link', label: this.translate.instant('taskList.chip.link', { title: this.linkTitle() }) });
    if (this.q()) chips.push({ id: 'q', label: named('taskList.chip.search', this.q()) });
    const status = this.status();
    if (status) chips.push({ id: 'status', label: named('taskList.chip.status', this.translate.instant(`task.status.${status.toLowerCase()}`)) });
    if (this.overdue()) chips.push({ id: 'overdue', label: this.translate.instant('taskList.filter.overdueOnly') });
    const who = this.who();
    if (who) {
      const label = this.whoOptions().flatMap((g) => g.items).find((o) => o.value === who)?.label ?? '';
      chips.push({ id: 'who', label: named('taskList.chip.who', label) });
    }
    const required = this.required();
    if (required) chips.push({ id: 'required', label: this.translate.instant(required === 'REQUIRED' ? 'taskList.tag.required' : 'taskList.tag.optional') });
    const due = this.due();
    if (due) {
      const key = due === 'THIS_WEEK' ? 'taskList.filter.dueThisWeek' : due === 'LATER' ? 'taskList.filter.dueLater' : 'taskList.filter.dueNone';
      chips.push({ id: 'due', label: named('taskList.chip.due', this.translate.instant(key)) });
    }
    if (this.mine()) chips.push({ id: 'mine', label: this.translate.instant('taskList.filter.mine') });
    return chips;
  });

  readonly liveText = computed(() => {
    this.translate.currentLang();
    if (this.phase() === 'loading') return this.translate.instant('taskList.live.loading');
    if (this.phase() === 'error') return '';
    return this.filtered() ? this.countText('taskList.live.match', this.matching()) : this.countText('taskList.live.total', this.total());
  });

  readonly footText = computed(() => {
    this.translate.currentLang();
    const shown = this.items().length;
    if (this.filtered()) return this.translate.instant('taskList.foot.matchOf', { matching: this.format.number(this.matching()), total: this.format.number(this.total()) });
    if (shown >= this.total()) return this.translate.instant('taskList.foot.all', { total: this.format.number(this.total()) });
    return this.translate.instant('taskList.foot.showing', { shown: this.format.number(shown), total: this.format.number(this.total()) });
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const query = this.document.defaultView?.matchMedia?.(`(max-width: ${TASK_LIST_PHONE_BELOW_PX - 0.02}px)`);
    if (query) {
      this.phone.set(query.matches);
      const onChange = (e: MediaQueryListEvent): void => this.phone.set(e.matches);
      query.addEventListener('change', onChange);
      destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }
    destroyRef.onDestroy(() => {
      this.request?.unsubscribe();
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });

    // Every change of the query starts again from the first page.
    let first = true;
    effect(() => {
      const q = this.query();
      untracked(() => {
        if (first) {
          first = false;
          this.aroundPending = this.around();
        }
        this.fetchFirst(q);
      });
    });

    afterNextRender(
      () => {
        if (this.variant() === 'popup' && !this.around()) this.searchBox()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  countText(key: 'taskList.live.match' | 'taskList.live.total', n: number): string {
    return this.format.count(key, n);
  }

  onSearch(value: string): void {
    this.qInput.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.q.set(value.trim()), SEARCH_DELAY_MS);
  }

  removeChip(id: Chip['id']): void {
    switch (id) {
      case 'q':
        this.qInput.set('');
        this.q.set('');
        return;
      case 'status':
        return this.status.set(null);
      case 'overdue':
        return this.overdue.set(false);
      case 'who':
        return this.who.set(null);
      case 'required':
        return this.required.set(null);
      case 'due':
        return this.due.set(null);
      case 'mine':
        return this.mine.set(false);
      case 'link':
        this.linkTitle.set(null);
        this.highlightId.set(null);
        return;
    }
  }

  clearAll(): void {
    this.qInput.set('');
    this.q.set('');
    this.status.set(null);
    this.overdue.set(false);
    this.who.set(null);
    this.required.set(null);
    this.due.set(null);
    this.mine.set(false);
    this.linkTitle.set(null);
    this.highlightId.set(null);
    this.searchBox()?.nativeElement.focus();
  }

  reload(): void {
    this.fetchFirst(this.query());
  }

  loadMore(): void {
    if (this.more() === 'loading') return;
    this.more.set('loading');
    this.request?.unsubscribe();
    this.request = this.tasks.getRecordList({ ...this.query(), take: PAGE, skip: this.items().length }).subscribe({
      next: (page) => {
        this.items.update((rows) => [...rows, ...page.items.filter((r) => !rows.some((x) => x.id === r.id))]);
        this.total.set(page.total);
        this.matching.set(page.matching);
        this.more.set('idle');
        this.continueToAround();
      },
      error: () => this.more.set('failed'),
    });
  }

  act(row: ITaskRecordRowDto, id: TaskRowActionId): void {
    this.lastAction[row.id] = id;
    this.rowErrors.update((e) => {
      const { [row.id]: _gone, ...rest } = e;
      return rest;
    });
    this.host()?.run(row, id);
  }

  retryRow(row: ITaskRecordRowDto): void {
    const id = this.lastAction[row.id];
    if (id) this.act(row, id);
  }

  onFailed(failure: TaskActionFailure): void {
    this.rowErrors.update((e) => ({ ...e, [failure.taskId]: failure.message }));
    this.refreshRow(failure.taskId);
  }

  onChanged(taskId: string): void {
    this.changed.emit();
    this.refreshRow(taskId);
  }

  protected readonly asRowAction = asRowAction;
  private readonly host = viewChild(TaskActionHostComponent);

  /**
   * Acting in place: the page the row sits on is read again and the row is
   * replaced where it is. A row that no longer matches the filters leaves.
   */
  private refreshRow(taskId: string): void {
    const index = this.items().findIndex((r) => r.id === taskId);
    if (index < 0) return;
    const skip = Math.floor(index / PAGE) * PAGE;
    this.tasks.getRecordList({ ...this.query(), take: PAGE, skip }).subscribe({
      next: (page) => {
        const fresh = page.items.find((r) => r.id === taskId);
        this.items.update((rows) => (fresh ? rows.map((r) => (r.id === taskId ? fresh : r)) : rows.filter((r) => r.id !== taskId)));
        this.total.set(page.total);
        this.matching.set(page.matching);
        this.totalChange.emit({ total: page.total, scope: page.scope });
      },
    });
  }

  private fetchFirst(query: TaskRecordListQuery): void {
    this.request?.unsubscribe();
    this.phase.set('loading');
    this.more.set('idle');
    this.rowErrors.set({});
    const around = this.aroundPending ?? undefined;
    this.request = this.tasks.getRecordList({ ...query, take: PAGE, skip: 0, around }).subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.total.set(page.total);
        this.matching.set(page.matching);
        this.facets.set(page.facets ?? this.facets());
        this.phase.set('ready');
        this.totalChange.emit({ total: page.total, scope: page.scope });
        if (around) {
          this.aroundPending = null;
          this.aroundIndex = page.aroundIndex;
          this.continueToAround();
        }
      },
      error: () => this.phase.set('error'),
    });
  }

  private aroundIndex: number | null = null;
  private aroundId: string | null = null;

  /** Loads further pages until the linked task is in the list, then shows it. */
  private continueToAround(): void {
    if (this.aroundIndex === null) return;
    const target = this.aroundId ?? this.around();
    if (this.items().length <= this.aroundIndex && this.items().length < this.matching()) {
      this.aroundId = target;
      this.loadMore();
      return;
    }
    this.aroundIndex = null;
    this.aroundId = null;
    const row = this.items().find((r) => r.id === target);
    if (!row || !target) return;
    this.highlightId.set(target);
    this.linkTitle.set(this.text.title(row));
    afterNextRender(
      () => {
        const el = this.scroller()?.nativeElement.querySelector<HTMLElement>(`[data-task-row="${target}"]`);
        el?.scrollIntoView({ block: 'center' });
        el?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  private recordLine(record: NonNullable<ITaskRecordRowDto['record']>): string {
    const type = this.translate.instant(record.type === 'COMMITTEE' || record.type === 'MEETING' ? `taskPage.recordType.${record.type}` : 'taskPage.recordType.OTHER');
    return record.nameEn ? `${type} · ${this.language.bilingual(record.nameEn, record.nameAr)}` : type;
  }
}
