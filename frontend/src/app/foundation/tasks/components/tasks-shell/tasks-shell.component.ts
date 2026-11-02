import { Component, TemplateRef, ViewChild, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { injectFixLinkParam } from '../../../../shared/utils/fix-link.util';
import { ITaskViewsDto, TaskRecordListView, TaskService } from '../../services/task.service';
import { MyTasksComponent } from '../my-tasks/my-tasks.component';
import { TaskListViewComponent } from '../task-list-view/task-list-view.component';
import { TaskFormComponent } from '../task-form/task-form.component';
import { TaskFormFooterComponent } from '../task-form/task-form-footer.component';
import { TaskFormStepsComponent } from '../task-form/task-form-steps.component';

/** The views of /tasks, in their fixed order (Task Screens; the Unit Tasks View drawing). */
export type TaskViewKey = 'mine' | TaskRecordListView;
const ORDER: readonly TaskViewKey[] = ['mine', 'all', 'unit', 'unassigned'];
const LABELS: Readonly<Record<TaskViewKey, string>> = {
  mine: 'tasks.views.mine',
  all: 'tasks.views.all',
  unit: 'tasks.views.unit',
  unassigned: 'tasks.views.unassigned',
};

/**
 * ACC-120 slice 3 — ONE /tasks LIST WITH SAVED VIEWS (Task Screens: "Unassigned
 * is a saved view"; the Unit Tasks View drawing).
 *
 * Which views exist is GET /tasks/views, read once per page load, and nothing
 * else: a view is null exactly when its list would refuse (SYSTEM-REFERENCE
 * §3.19), so the screen never re-derives a permission. My tasks is always
 * there and is the default with no ?view. The view lives in the URL, so Back,
 * Forward and a copied link land on it. A viewer with My tasks alone gets no
 * switcher: one tab is noise.
 *
 * The open view's total is the list's own, in its header row; the page adds
 * none. A view the server refuses (403) shows only its denied state, so New
 * task goes too.
 *
 * My tasks is today's MyTasksComponent, unchanged but for its header (this
 * page's "Tasks" is the one H1). The other views are the shared task list,
 * organisation-wide, sending their view; each has its own instance, so a
 * switch starts it fresh.
 */
@Component({
  selector: 'app-tasks-shell',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    ButtonModule,
    PageHeaderComponent,
    EditDialogComponent,
    MyTasksComponent,
    TaskListViewComponent,
    TaskFormComponent,
    TaskFormFooterComponent,
    TaskFormStepsComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-3">
      <app-page-header [title]="'tasks.title' | translate">
        <div pageActions>
          <!-- ACC-118 — hidden, not disabled, for a viewer who cannot use it. The
               types come from GET /tasks/views (Create tasks per record type). -->
          @if (canCreate()) {
            <p-button [label]="'task.newTask' | translate" icon="pi pi-plus" (onClick)="formVisible.set(true)" data-testid="task-new" />
          }
        </div>
      </app-page-header>

      @if (viewsState() === 'ready' && switcher().length > 1) {
        <nav class="am-ts__views" [attr.aria-label]="'tasks.views.label' | translate" data-testid="task-views">
          @for (v of switcher(); track v.key) {
            <a
              class="am-ts__view"
              [class.am-ts__view--on]="v.key === current()"
              [routerLink]="['/tasks']"
              [queryParams]="v.key === 'mine' ? {} : { view: v.key }"
              [attr.aria-current]="v.key === current() ? 'page' : null"
              [attr.data-view]="v.key"
              >{{ v.labelKey | translate }}</a
            >
          }
        </nav>
      } @else if (viewsState() === 'error') {
        <div class="am-ts__alert" role="alert" data-testid="task-views-error">
          <span>{{ 'tasks.views.loadFailed' | translate }}</span>
          <button type="button" class="am-ts__retry" (click)="loadViews()">{{ 'list.retry' | translate }}</button>
        </div>
      }

      @if (notice()) {
        <p class="m-0 text-meta text-[var(--am-ink-700)]" role="status" data-testid="task-view-notice">{{ notice()! | translate }}</p>
      }

      @switch (current()) {
        @case ('mine') {
          @if (wantsListView() && viewsState() === 'loading') {
            <div class="am-ts__skeleton" aria-hidden="true" data-testid="task-views-loading">
              @for (i of skeleton; track i) {
                <span class="am-skeleton-bar"></span>
              }
            </div>
          } @else if (!(wantsListView() && viewsState() === 'error')) {
            <app-my-tasks [showHeader]="false" />
          }
        }
        @case ('all') {
          <app-task-list-view variant="page" view="all" [recordType]="recordTypeParam()" (deniedChange)="listDenied.set($event)" />
        }
        @case ('unit') {
          <app-task-list-view
            variant="page"
            view="unit"
            [recordType]="recordTypeParam()"
            [unit]="unitParam()"
            [unitFilter]="unitFilter()"
            (deniedChange)="listDenied.set($event)"
          />
        }
        @case ('unassigned') {
          <app-task-list-view
            variant="page"
            view="unassigned"
            [around]="reassignId()"
            [openAction]="reassignId() ? 'reassign' : null"
            (deniedChange)="listDenied.set($event)"
          />
        }
      }
    </div>

    <ng-template #formTpl>
      <app-task-form
        [allowedSourceTypes]="createTypes()"
        (saved)="onSaved()"
        (cancelled)="taskDialog.requestClose()"
        (dirtyChange)="formDirty.set($event)"
        (ready)="taskFormRef.set($event)"
      />
    </ng-template>
    <ng-template #taskStepsTpl>
      <app-task-form-steps [form]="taskFormRef()" />
    </ng-template>
    <ng-template #taskFooterTpl>
      <app-task-form-footer [form]="taskFormRef()" />
    </ng-template>
    <!-- Cancel goes through requestClose(), the one place the unsaved-work
         question is asked (ACC-96). -->
    <app-edit-dialog
      #taskDialog
      [(visible)]="formVisible"
      [header]="'task.newTask' | translate"
      [content]="formTpl"
      [dirty]="formDirty()"
      [headerExtra]="taskStepsTpl"
      [footer]="taskFooterTpl"
    />
  `,
  styles: [
    `
      .am-ts__views {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-4);
        border-block-end: 1px solid var(--am-border);
      }
      .am-ts__view {
        display: inline-flex;
        align-items: center;
        min-block-size: 36px;
        padding: 0 var(--am-space-12);
        margin-block-end: -1px;
        border-block-end: 2px solid transparent;
        font-size: var(--am-type-body-size);
        color: var(--am-ink-700);
        text-decoration: none;
        white-space: nowrap;
      }
      .am-ts__view:hover {
        color: var(--am-ink-900);
      }
      .am-ts__view--on {
        font-weight: 600;
        color: var(--am-primary-700);
        border-block-end-color: var(--am-primary-600);
      }
      .am-ts__view:focus-visible,
      .am-ts__retry:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-ts__alert {
        display: flex;
        align-items: center;
        gap: var(--am-space-12);
        padding: var(--am-space-8) var(--am-space-12);
        border: 1px solid var(--am-danger-border);
        border-radius: var(--am-radius-card);
        background: var(--am-danger-bg);
        color: var(--am-danger-ink);
        font-size: var(--am-type-meta-size);
      }
      .am-ts__retry {
        font: inherit;
        border: 0;
        background: none;
        padding: 0;
        color: var(--am-primary-700);
        text-decoration: underline;
        cursor: pointer;
      }
      .am-ts__skeleton {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-12);
        padding: var(--am-space-16);
      }
    `,
  ],
})
export class TasksShellComponent {
  private readonly tasks = inject(TaskService);
  private readonly route = inject(ActivatedRoute);

  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  readonly views = signal<ITaskViewsDto | null>(null);
  readonly viewsState = signal<'loading' | 'ready' | 'error'>('loading');
  /** The open list view was refused by the server (a 403). */
  readonly listDenied = signal(false);
  readonly formVisible = signal(false);
  readonly formDirty = signal(false);
  readonly taskFormRef = signal<TaskFormComponent | null>(null);
  /** A Setup health Fix's task (?reassign=<id>), read once on the Unassigned view. */
  readonly reassignId = signal<string | null>(null);
  protected readonly skeleton = [0, 1, 2, 3, 4];

  private readonly params = toSignal(this.route.queryParamMap.pipe(map((p) => p)), {
    initialValue: this.route.snapshot.queryParamMap,
  });
  /** The view the URL asks for; anything else is My tasks. */
  readonly requested = computed<TaskViewKey>(() => {
    const view = this.params().get('view');
    return view === 'all' || view === 'unit' || view === 'unassigned' ? view : 'mine';
  });
  readonly recordTypeParam = computed(() => this.params().get('recordType'));
  readonly unitParam = computed(() => this.params().get('unit'));
  /** The URL asks for a list view (so My tasks waits for the views before showing). */
  readonly wantsListView = computed(() => this.requested() !== 'mine');

  /** The views this viewer has, in order: exactly the non-null ones. */
  readonly switcher = computed(() => {
    const v = this.views();
    if (!v) return [];
    return ORDER.filter((key) => key === 'mine' || v[key] !== null).map((key) => ({ key, labelKey: LABELS[key] }));
  });

  /** The open view: the one asked for, when this viewer has it; otherwise My tasks. */
  readonly current = computed<TaskViewKey>(() => {
    const asked = this.requested();
    const v = this.views();
    if (asked === 'mine' || !v) return 'mine';
    return v[asked] !== null ? asked : 'mine';
  });

  /** A link to a view this viewer no longer has opens My tasks, and says so in one line. */
  readonly notice = computed<string | null>(() =>
    this.viewsState() === 'ready' && this.requested() !== 'mine' && this.current() === 'mine' ? 'tasks.views.unavailable' : null,
  );

  readonly createTypes = computed(() => this.views()?.create.types ?? []);
  readonly canCreate = computed(() => this.createTypes().length > 0 && !(this.current() !== 'mine' && this.listDenied()));
  /** The Unit filter, when the viewer's unit scope holds more than one top-level unit (plan §6). */
  readonly unitFilter = computed(() => (this.views()?.unit?.units.length ?? 0) > 1);

  private readonly list = viewChild(TaskListViewComponent);
  private readonly fixLinkReassign = injectFixLinkParam('reassign');

  constructor() {
    this.loadViews();
    // A view switch starts fresh: the new list says whether it is refused.
    effect(() => {
      this.current();
      untracked(() => this.listDenied.set(false));
    });
    // ?reassign=<id> belongs to the Unassigned view: read it once that view is
    // open (the views have loaded), so the list loads to the task and its row
    // opens Reassign when the server offers it there.
    effect(() => {
      if (this.current() !== 'unassigned') return;
      untracked(() => {
        const id = this.fixLinkReassign();
        if (id) this.reassignId.set(id);
      });
    });
  }

  loadViews(): void {
    this.viewsState.set('loading');
    this.tasks.getViews().subscribe({
      next: (views) => {
        this.views.set(views);
        this.viewsState.set('ready');
      },
      error: () => this.viewsState.set('error'),
    });
  }

  onSaved(): void {
    this.formVisible.set(false);
    this.list()?.reload();
  }
}
