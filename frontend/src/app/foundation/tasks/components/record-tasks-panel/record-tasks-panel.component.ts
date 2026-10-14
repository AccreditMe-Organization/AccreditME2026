import { Component, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { RowMenuComponent } from '../../../../shared/components/row-menu/row-menu.component';
import { ITaskRecordRowDto, TaskService } from '../../services/task.service';
import { TaskRowActionId, taskRowActions } from '../../task-row-actions';
import { TaskRowText } from '../../task-row-text';
import { TaskLinkComponent } from '../task-link/task-link.component';
import { TaskActionFailure, TaskActionHostComponent } from '../task-action-host/task-action-host.component';
import { TaskListViewComponent } from '../task-list-view/task-list-view.component';

/** The panel shows at most this many rows; the popup is the only full view. */
export const RECORD_TASKS_PANEL_ROWS = 5;

type PanelState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready' };

/**
 * `app-record-tasks-panel` — A RECORD'S TASKS, CAPPED (ACC-229, Record Tasks
 * Panel §1). One component for every record that has tasks; the committee
 * record page is its first consumer (Q2), and meetings and standards pass
 * their own record when their pages exist.
 *
 * - **At most five rows, at a fixed body height** — 294px English, 328px
 *   Arabic, footer included — that never grows and never scrolls, so the
 *   panels in a row stay equal. The order is the server's: open work by
 *   soonest due (overdue first), then On hold, then the most recently closed.
 * - **The header count is every task the viewer can see**, never the five.
 *   "Showing 5 of 16 · See all" opens the popup, the only full view.
 * - **A viewer who may see the record but not its tasks** (no tasks:view) sees
 *   "Your tasks on this committee": only the tasks they are or were on (Q1).
 * - **Each row has one next step and a worded ⋯ menu**, exactly the actions
 *   the server says this viewer may take. An action's failure is said in its
 *   row and never blanks the panel (ACC-217).
 * - **A deep link (`?task=`)** highlights the row when it is among the five;
 *   otherwise the popup opens at it.
 *
 * Its own frame rather than RecordPanelComponent's: that panel's body has a
 * floor, not a fixed height, and its header is a different height from the
 * drawing's.
 */
@Component({
  selector: 'app-record-tasks-panel',
  standalone: true,
  imports: [TranslatePipe, ListDialogComponent, RowMenuComponent, TaskLinkComponent, TaskActionHostComponent, TaskListViewComponent],
  template: `
    <section class="am-rtp" [attr.aria-labelledby]="headingId" data-testid="record-tasks-panel">
      <header class="am-rtp__head" data-testid="record-tasks-head">
        <h2 class="am-rtp__title" [id]="headingId">{{ panelTitle() }}</h2>
        <span class="am-rtp__count" data-testid="record-tasks-count">{{ countText() }}</span>
        <span class="flex-1"></span>
        @if (canCreate()) {
          <button type="button" class="am-rtp__new" (click)="createRequested.emit()" data-testid="record-tasks-new">
            <i class="pi pi-plus" aria-hidden="true"></i>{{ 'task.newTask' | translate }}
          </button>
        }
      </header>

      <div class="am-rtp__body" data-testid="record-tasks-body" [attr.aria-busy]="state().kind === 'loading'">
        @switch (state().kind) {
          @case ('loading') {
            <span class="sr-only" aria-live="polite">{{ 'recordTasks.loading' | translate }}</span>
            @for (i of skeleton; track i) {
              <div class="am-rtp__row am-rtp__skeleton" aria-hidden="true"><span></span><span></span></div>
            }
          }
          @case ('error') {
            <div class="am-rtp__state" role="alert" data-testid="record-tasks-error">
              <p class="m-0">{{ 'recordTasks.error' | translate: { record: recordName() } }}</p>
              <button type="button" class="am-rtp__link" (click)="load()">{{ 'list.retry' | translate }}</button>
            </div>
          }
          @default {
            @if (rows().length === 0) {
              <p class="am-rtp__state" data-testid="record-tasks-empty">
                {{ (scope() === 'own' ? 'recordTasks.ownEmpty' : 'recordTasks.empty') | translate }}
              </p>
            } @else {
              <ul class="am-rtp__list" role="list">
                @for (r of rows(); track r.row.id) {
                  <li
                    class="am-rtp__row"
                    [class.am-rtp__row--sought]="highlightId() === r.row.id"
                    [attr.data-task-row]="r.row.id"
                    tabindex="-1"
                  >
                    <span class="am-rtp__l1">
                      <span class="am-rtp__title-cell"><am-task-link [taskId]="r.row.id" [title]="r.title" /></span>
                      @if (r.tagKey) {
                        <span class="am-rtp__tag">{{ r.tagKey | translate }}</span>
                      }
                      <span class="flex-1"></span>
                      @if (r.primary; as p) {
                        <button
                          type="button"
                          class="am-rtp__btn"
                          [disabled]="p.disabled || busyId() === r.row.id"
                          [attr.aria-label]="(p.labelKey | translate) + ' ' + r.title"
                          [attr.title]="p.disabled ? ('task.completeNeedsEvidence' | translate) : null"
                          [attr.data-action]="p.id"
                          (click)="act(r.row, p.id)"
                        >
                          {{ p.labelKey | translate }}
                        </button>
                      }
                      <am-row-menu [groups]="r.menu" [label]="'taskActions.moreActionsFor' | translate: { title: r.title }" (picked)="act(r.row, $any($event))" />
                    </span>
                    <span class="am-rtp__l2">
                      @if (rowErrors()[r.row.id]; as message) {
                        <span class="am-rtp__err" role="alert" [attr.title]="message">{{ message }}</span>
                        <button type="button" class="am-rtp__link am-rtp__link--small" (click)="retryRow(r.row)">{{ 'list.retry' | translate }}</button>
                      } @else {
                        <span class="am-rtp__due" [attr.data-tone]="r.due.tone" [attr.title]="r.due.text">{{ r.due.text }}</span>
                        <span class="am-rtp__tail" [attr.title]="r.tail">&nbsp;· {{ r.tail }}</span>
                      }
                    </span>
                  </li>
                }
              </ul>
            }
            @if (total() > rows().length) {
              <div class="am-rtp__foot" data-testid="record-tasks-foot">
                <span>{{ 'recordTasks.showing' | translate: { shown: format.number(rows().length), total: format.number(total()) } }}</span>
                <span aria-hidden="true">·</span>
                <button #seeAll type="button" class="am-rtp__link" (click)="openPopup(null)" data-testid="record-tasks-see-all">
                  {{ 'recordTasks.seeAll' | translate }}
                </button>
              </div>
            }
          }
        }
      </div>
    </section>

    <app-task-action-host (changed)="load(false)" (failed)="onFailed($event)" (busyChange)="busyId.set($event)" />

    <ng-template #listTpl>
      <app-task-list-view
        [sourceType]="sourceType()"
        [sourceId]="sourceId()"
        [around]="popupAround()"
        (changed)="popupChanged = true"
      />
    </ng-template>
    <ng-template #popupNew>
      @if (canCreate()) {
        <button type="button" class="am-rtp__new" (click)="createRequested.emit()">
          <i class="pi pi-plus" aria-hidden="true"></i>{{ 'task.newTask' | translate }}
        </button>
      }
    </ng-template>
    <am-list-dialog
      [visible]="popupOpen()"
      [heading]="popupTitle()"
      [count]="format.number(total())"
      [closeLabel]="'recordTasks.closePopup' | translate"
      [body]="listTpl"
      [headerExtra]="popupNew"
      (closeRequested)="closePopup()"
    />
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-rtp{background:var(--am-surface-raised);border:1px solid var(--am-border);border-radius:var(--am-radius-card);overflow:hidden}
      .am-rtp__head{display:flex;align-items:center;gap:8px;block-size:42px;box-sizing:border-box;padding:0 12px 0 16px;border-block-end:1px solid var(--am-border)}
      .am-rtp__title{margin:0;font-size:14px;line-height:20px;font-weight:600;color:var(--am-ink-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .am-rtp__count{flex:none;font-size:12px;font-weight:600;color:var(--am-ink-700);background:var(--am-surface);border:1px solid var(--am-border);border-radius:var(--am-radius-pill);padding:0 8px}
      .am-rtp__new{flex:none;display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;font-weight:600;block-size:28px;padding:0 10px;color:var(--am-primary-700);background:var(--am-surface-raised);border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);cursor:pointer}
      .am-rtp__body{display:flex;flex-direction:column;block-size:294px;box-sizing:border-box;overflow:hidden}
      .am-rtp__list{list-style:none;margin:0;padding:0}
      .am-rtp__row{display:flex;flex-direction:column;justify-content:center;block-size:52px;box-sizing:border-box;padding:4px 12px 4px 16px;border-block-end:1px solid var(--am-border);min-inline-size:0}
      .am-rtp__row--sought{background:var(--am-primary-50);box-shadow:inset 3px 0 0 var(--am-primary-600)}
      .am-rtp__row:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:-2px}
      .am-rtp__l1{display:flex;align-items:center;gap:6px;block-size:26px;min-inline-size:0;font-size:13px}
      .am-rtp__title-cell{min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .am-rtp__tag{flex:none;font-size:11px;font-weight:600;padding:0 6px;border-radius:var(--am-radius-pill);background:var(--am-surface);border:1px solid var(--am-border);color:var(--am-ink-700)}
      .am-rtp__btn{flex:none;font:inherit;font-size:12px;font-weight:600;block-size:26px;padding:0 10px;color:var(--am-primary-700);background:var(--am-surface-raised);border:1px solid var(--am-primary-600);border-radius:var(--am-radius-button);cursor:pointer;white-space:nowrap}
      .am-rtp__btn:disabled{cursor:not-allowed;color:var(--am-ink-500);border-color:var(--am-border)}
      .am-rtp__l2{display:flex;align-items:center;block-size:18px;line-height:18px;min-inline-size:0;font-size:11.5px;color:var(--am-ink-500)}
      .am-rtp__due{flex:none;white-space:nowrap}.am-rtp__due[data-tone=danger]{color:var(--am-danger-ink);font-weight:600}.am-rtp__due[data-tone=info]{color:var(--am-info-ink)}
      .am-rtp__tail,.am-rtp__err{min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .am-rtp__err{color:var(--am-danger-ink);flex:0 1 auto;margin-inline-end:6px}
      .am-rtp__foot{margin-block-start:auto;display:flex;align-items:center;gap:6px;block-size:34px;flex:none;padding:0 16px;border-block-start:1px solid var(--am-border);font-size:12px;color:var(--am-ink-700)}
      .am-rtp__link{font:inherit;padding:0;border:0;background:none;color:var(--am-primary-700);font-weight:600;cursor:pointer}
      .am-rtp__link--small{flex:none;font-size:11.5px}
      .am-rtp__state{margin:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:16px;font-size:13px;color:var(--am-ink-700)}
      .am-rtp__skeleton span{display:block;block-size:10px;border-radius:4px;background:var(--am-surface)}.am-rtp__skeleton span+span{margin-block-start:8px;inline-size:60%}
      button:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      :host-context([dir=rtl]) .am-rtp__head{block-size:46px;padding:0 16px 0 12px}
      :host-context([dir=rtl]) .am-rtp__body{block-size:328px}
      :host-context([dir=rtl]) .am-rtp__row{block-size:58px;padding:4px 16px 4px 12px}
      :host-context([dir=rtl]) .am-rtp__l2{block-size:22px;line-height:22px;font-size:12px}
      :host-context([dir=rtl]) .am-rtp__foot{block-size:38px}
    `,
  ],
})
export class RecordTasksPanelComponent {
  private readonly tasks = inject(TaskService);
  private readonly text = inject(TaskRowText);
  private readonly translate = inject(TranslateService);
  protected readonly format = inject(FormatService);
  private readonly injector = inject(Injector);

  readonly sourceType = input.required<string>();
  readonly sourceId = input.required<string>();
  /** The record's name, for the popup's title and the error line. */
  readonly recordName = input.required<string>();
  /** tasks:create — New task in the header and in the popup. */
  readonly canCreate = input(false);
  /**
   * A task named by a link (?task=): highlighted here, or opened in the popup.
   * A new object for each link followed, so the same task twice is seen twice.
   */
  readonly soughtTask = input<{ id: string } | null>(null);
  readonly createRequested = output<void>();

  private static nextId = 0;
  protected readonly headingId = `am-rtp-heading-${++RecordTasksPanelComponent.nextId}`;
  protected readonly skeleton = Array.from({ length: RECORD_TASKS_PANEL_ROWS }, (_, i) => i);

  readonly state = signal<PanelState>({ kind: 'loading' });
  readonly items = signal<ITaskRecordRowDto[]>([]);
  readonly total = signal(0);
  readonly scope = signal<'all' | 'own'>('all');
  readonly busyId = signal<string | null>(null);
  readonly rowErrors = signal<Record<string, string>>({});
  readonly highlightId = signal<string | null>(null);

  readonly popupOpen = signal(false);
  readonly popupAround = signal<string | null>(null);
  popupChanged = false;

  private readonly host = viewChild(TaskActionHostComponent);
  private readonly listView = viewChild(TaskListViewComponent);
  private lastAction: Record<string, TaskRowActionId> = {};
  private pendingSought: string | null = null;

  readonly rows = computed(() => {
    this.translate.currentLang();
    const now = new Date();
    return this.items().map((row) => {
      const model = taskRowActions(row.actions, row.evidenceCount);
      return {
        row,
        title: this.text.title(row),
        tagKey: this.text.requirementKey(row),
        due: this.text.due(row, now),
        tail: this.text.tail(row),
        primary: model.primary,
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

  readonly panelTitle = computed(() => {
    this.translate.currentLang();
    return this.translate.instant(this.scope() === 'own' ? 'recordTasks.ownTitle' : 'recordTasks.title');
  });
  readonly countText = computed(() => (this.state().kind === 'ready' ? this.format.number(this.total()) : '—'));
  readonly popupTitle = computed(() => {
    this.translate.currentLang();
    return this.scope() === 'own'
      ? this.translate.instant('recordTasks.ownTitle')
      : this.translate.instant('recordTasks.popupTitle', { record: this.recordName() });
  });

  constructor() {
    effect(() => {
      this.sourceType();
      this.sourceId();
      untracked(() => this.load());
    });
    effect(() => {
      const id = this.soughtTask()?.id;
      if (!id) return;
      untracked(() => {
        this.pendingSought = id;
        if (this.state().kind === 'ready') this.showSought();
      });
    });
  }

  /** Reads the five again. `skeleton` false keeps the rows while it does (after an action). */
  load(skeleton = true): void {
    if (skeleton) this.state.set({ kind: 'loading' });
    this.tasks.getRecordPanel(this.sourceType(), this.sourceId()).subscribe({
      next: (panel) => {
        this.items.set(panel.rows);
        this.total.set(panel.total);
        this.scope.set(panel.scope);
        this.state.set({ kind: 'ready' });
        this.showSought();
      },
      error: () => {
        // An action's failure never lands here; only the panel's own read does.
        if (skeleton || this.state().kind !== 'ready') this.state.set({ kind: 'error' });
      },
    });
  }

  /** After a task is created on the record: the five, and the popup if it is open. */
  reload(): void {
    this.load(false);
    this.listView()?.reload();
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
    this.load(false);
  }

  openPopup(around: string | null): void {
    this.popupAround.set(around);
    this.popupChanged = false;
    this.popupOpen.set(true);
  }

  closePopup(): void {
    this.popupOpen.set(false);
    if (this.popupChanged) this.load(false);
  }

  private showSought(): void {
    const id = this.pendingSought;
    if (!id) return;
    this.pendingSought = null;
    if (this.items().some((r) => r.id === id)) {
      this.highlightId.set(id);
      afterNextRender(
        () => {
          const row = document.querySelector<HTMLElement>(`[data-task-row="${id}"]`);
          row?.scrollIntoView({ block: 'center' });
          row?.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
    } else {
      // Not among the five: the popup opens at it.
      this.openPopup(id);
    }
  }
}
