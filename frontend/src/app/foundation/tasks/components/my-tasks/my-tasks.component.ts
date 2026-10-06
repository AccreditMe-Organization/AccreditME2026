import { Component, OnInit, inject, signal } from '@angular/core';
import { AmDateTimePipe, FormatService } from '../../../../core/formatting';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import { FormsModule } from '@angular/forms';
import {
  TaskService,
  ITaskListItemDto,
  IMyTaskListItemDto,
  MyTasksQuery,
  TaskPoolDto,
} from '../../services/task.service';
import { LanguageService } from '../../../../core/services/language.service';
import { taskPoolLabel } from '../../task-pool-label';
import { TaskReleaseDialogComponent } from '../task-release-dialog/task-release-dialog.component';
import {
  displayStatus,
  isTaskOpen,
  isTaskOverdue,
  taskStatusLabelKey,
  taskStatusSeverity,
} from '../../task-status';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { TaskRejectDialogComponent } from '../task-reject-dialog/task-reject-dialog.component';
import { TaskLinkEvidenceDialogComponent } from '../task-link-evidence-dialog/task-link-evidence-dialog.component';

// ACC-163 — "Overdue" is a filter, not a status (Q8): it asks the server for
// open tasks past their due time, whatever their status. The other three are
// statuses. Cancelled has no button because the list is about work still
// owed; it is still shown under "all".
type FilterValue = 'PENDING' | 'IN_PROGRESS' | 'OVERDUE' | 'COMPLETED';

const FILTERS: { value: FilterValue; labelKey: string }[] = [
  { value: 'PENDING', labelKey: 'task.status.pending' },
  { value: 'IN_PROGRESS', labelKey: 'task.status.in_progress' },
  { value: 'OVERDUE', labelKey: 'task.overdueBadge' },
  { value: 'COMPLETED', labelKey: 'task.status.completed' },
];

/**
 * My tasks — every task the signed-in person is an active assignee on.
 *
 * ## ACC-163 — the assignee's actions, and why none is permission-gated
 *
 * Start, Add link evidence, Reject and Complete are all SELF-SCOPED: the
 * server refuses anyone who is not a currently-active assignee, and no
 * permission is involved, because the engine assigns work to people who hold
 * no task permission at all. Every row here is the viewer's own assignment by
 * construction, so what decides which actions show is the task's STATUS:
 *
 *   Start              Assigned only
 *   Add link evidence  any open task
 *   Reject             Assigned or In progress
 *   Complete           any open task — DISABLED, with the reason written on the
 *                      row, while evidence is required and none has been added.
 *                      The server refuses that case too; the row says so first.
 *
 * ## Icon buttons, not a "More actions" menu
 *
 * Four labelled icon buttons rather than a p-menu popup. A PrimeNG popup is a
 * connected overlay, and inside this scrolling table it would close on the
 * table's own scroll — the bug class OverlaySelectComponent exists to avoid
 * (CLAUDE.md, ACC-41). Each button's label names the task, for a screen reader.
 *
 * A rejected task leaves this list at once: rejecting ends the caller's
 * assignment, and the list holds active assignments only.
 *
 * ## ACC-167 — Available to pick up, and Release
 *
 * Above the list: tasks waiting in a pool the viewer is in right now — their
 * position in their unit, or their role on a committee. Pick up takes one;
 * when someone else was first, the server says so (409) and both lists
 * reload. The section is absent for anyone with nothing waiting, so a person
 * in no pool never sees an empty heading.
 *
 * A task the viewer PICKED UP can be released back to its pool, with a
 * reason. One the assigner gave them directly cannot — they reject it, which
 * returns it to its creator. `pickedByMe` is what tells the two apart, and it
 * comes from the server, which refuses a release of a direct assignment too.
 */
@Component({
  selector: 'app-my-tasks',
  standalone: true,
  imports: [
    PageHeaderComponent,
    AmDateTimePipe,
    TranslatePipe,
    TableModule,
    TagModule,
    SelectButtonModule,
    FormsModule,
    IconButtonComponent,
    ButtonModule,
    TaskRejectDialogComponent,
    TaskLinkEvidenceDialogComponent,
    TaskReleaseDialogComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">
      <app-page-header [title]="'task.myTasks' | translate" />

      @if (available().length > 0) {
        <section class="am-available" aria-labelledby="availableHeading">
          <h2 id="availableHeading" class="text-heading font-semibold">{{ 'task.available' | translate }}</h2>
          <p class="text-meta text-[var(--am-ink-500)]">{{ 'task.availablePurpose' | translate }}</p>
          <p-table [value]="available()" styleClass="w-full">
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 12%">{{ 'task.source' | translate }}</th>
                <th style="width: 30%">{{ 'task.title' | translate }}</th>
                <th style="width: 11%">{{ 'task.priority.title' | translate }}</th>
                <th style="width: 15%">{{ 'task.dueDate' | translate }}</th>
                <th style="width: 32%"><span class="sr-only">{{ 'common.actions' | translate }}</span></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-task>
              <tr>
                <td><p-tag [value]="task.sourceType" severity="info" /></td>
                <td>
                  <span class="block">{{ task.title }}</span>
                  @if (task.pool) {
                    <span class="block text-meta text-[var(--am-ink-500)]">
                      {{ 'task.assign.assignedToPool' | translate: { pool: poolLabel(task.pool) } }}
                    </span>
                  }
                </td>
                <td>
                  <p-tag
                    [value]="('task.priority.' + task.priority.toLowerCase()) | translate"
                    [severity]="priorityColor(task.priority)"
                  />
                </td>
                <td>{{ task.dueAt | amDateTime }}</td>
                <td class="text-end">
                  @if (canPick(task)) {
                    <p-button
                      size="small"
                      [label]="'task.pick' | translate"
                      [ariaLabel]="'task.pickNamed' | translate: { title: task.title }"
                      [loading]="picking() === task.id"
                      [disabled]="picking() !== null"
                      (onClick)="onPick(task)"
                    />
                  }
                </td>
              </tr>
            </ng-template>
          </p-table>
        </section>
      }

      <!-- The template is NAMED #item: p-selectButton ignores an unnamed one
           and renders the raw option values instead — which is how this filter
           showed "PENDING" in both languages (the ACC-79 browser pass). -->
      <p-selectButton
        [options]="filters"
        optionValue="value"
        [(ngModel)]="selectedFilter"
        (onChange)="loadTasks()"
      >
        <ng-template #item let-option>
          {{ option.labelKey | translate }}
        </ng-template>
      </p-selectButton>

      @if (error()) {
        <p class="text-meta text-[var(--am-danger-ink)]" role="alert">{{ error()! | translate }}</p>
      }

      <p-table [value]="tasks()" [loading]="loading()" scrollable scrollHeight="flex" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 12%">{{ 'task.source' | translate }}</th>
            <th style="width: 30%">{{ 'task.title' | translate }}</th>
            <th style="width: 11%">{{ 'task.priority.title' | translate }}</th>
            <th style="width: 15%">{{ 'task.dueDate' | translate }}</th>
            <th style="width: 16%">{{ 'task.status.title' | translate }}</th>
            <th style="width: 16%"><span class="sr-only">{{ 'common.actions' | translate }}</span></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-task>
          <tr>
            <td><p-tag [value]="task.sourceType" severity="info" /></td>
            <td>
              <span class="block">{{ task.title }}</span>
              @if (task.pickedByMe && task.pool) {
                <span class="block text-meta text-[var(--am-ink-500)]">
                  {{ 'task.pickedUp' | translate }} · {{ poolLabel(task.pool) }}
                </span>
              }
              @if (task.requiresEvidence) {
                <span class="block text-meta text-[var(--am-ink-500)]">
                  {{ evidenceLine(task) }}
                </span>
                @if (needsEvidence(task)) {
                  <span class="block text-meta text-[var(--am-warning-ink)]">
                    {{ 'task.completeNeedsEvidence' | translate }}
                  </span>
                }
              }
            </td>
            <td>
              <p-tag
                [value]="('task.priority.' + task.priority.toLowerCase()) | translate"
                [severity]="priorityColor(task.priority)"
              />
            </td>
            <td>{{ task.dueAt | amDateTime }}</td>
            <td>
              <span class="inline-flex flex-wrap items-center gap-1.5">
                <p-tag [value]="statusLabel(task) | translate" [severity]="statusSeverity(task)" />
                <!-- A flag beside the status, never instead of it: a task can
                     be In progress AND overdue, and both facts matter (Q8). -->
                @if (isOverdue(task)) {
                  <p-tag [value]="'task.overdueBadge' | translate" severity="danger" />
                }
              </span>
            </td>
            <td>
              <span class="inline-flex items-center gap-1">
                @if (canStart(task)) {
                  <am-icon-button
                    icon="pi pi-play"
                    [label]="'task.startNamed' | translate: { title: task.title }"
                    (activated)="onStart(task)"
                  />
                }
                @if (canAddEvidence(task)) {
                  <am-icon-button
                    icon="pi pi-link"
                    [label]="'task.addLinkNamed' | translate: { title: task.title }"
                    (activated)="openLinkDialog(task)"
                  />
                }
                @if (canRelease(task)) {
                  <am-icon-button
                    icon="pi pi-replay"
                    [label]="'task.releaseNamed' | translate: { title: task.title }"
                    (activated)="openReleaseDialog(task)"
                  />
                }
                @if (canReject(task)) {
                  <am-icon-button
                    icon="pi pi-times"
                    severity="danger"
                    [label]="'task.rejectNamed' | translate: { title: task.title }"
                    (activated)="openRejectDialog(task)"
                  />
                }
                @if (canComplete(task)) {
                  <am-icon-button
                    icon="pi pi-check"
                    severity="primary"
                    [disabled]="needsEvidence(task)"
                    [label]="
                      (needsEvidence(task) ? 'task.completeNamedNeedsEvidence' : 'task.completeNamed')
                        | translate: { title: task.title }
                    "
                    (activated)="onComplete(task)"
                  />
                }
              </span>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="text-center py-8 text-[var(--am-text-secondary)]">{{ 'task.noTasks' | translate }}</td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <app-task-reject-dialog
      [visible]="rejectVisible()"
      (visibleChange)="rejectVisible.set($event)"
      [task]="actionTarget()"
      (rejected)="loadTasks()"
    />
    <app-task-link-evidence-dialog
      [visible]="linkVisible()"
      (visibleChange)="linkVisible.set($event)"
      [task]="actionTarget()"
      (added)="loadTasks()"
    />
    <app-task-release-dialog
      [visible]="releaseVisible()"
      (visibleChange)="releaseVisible.set($event)"
      [task]="actionTarget()"
      (released)="reloadAll()"
    />
  `,
  styles: [
    `
      .am-available {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
      }
    `,
  ],
})
export class MyTasksComponent implements OnInit {
  private readonly taskService = inject(TaskService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  readonly filters = FILTERS;
  selectedFilter: FilterValue | null = null;

  readonly loading = signal(false);
  readonly tasks = signal<IMyTaskListItemDto[]>([]);
  readonly error = signal<string | null>(null);

  /** ACC-167 — tasks waiting in the viewer's pools. */
  readonly available = signal<ITaskListItemDto[]>([]);
  /** The id of the task a Pick up is in flight for; one at a time. */
  readonly picking = signal<string | null>(null);

  readonly actionTarget = signal<ITaskListItemDto | null>(null);
  readonly rejectVisible = signal(false);
  readonly linkVisible = signal(false);
  readonly releaseVisible = signal(false);

  ngOnInit(): void {
    this.reloadAll();
  }

  reloadAll(): void {
    this.loadTasks();
    this.loadAvailable();
  }

  poolLabel(pool: TaskPoolDto): string {
    return taskPoolLabel(pool, (en, ar) => this.language.bilingual(en, ar), this.language.isArabic());
  }

  statusLabel(task: ITaskListItemDto): string {
    return taskStatusLabelKey(task);
  }

  statusSeverity(task: ITaskListItemDto): ReturnType<typeof taskStatusSeverity> {
    return taskStatusSeverity(task);
  }

  isOverdue(task: ITaskListItemDto): boolean {
    return isTaskOverdue(task);
  }

  // "Evidence required · none added yet" / "· 2 added".
  evidenceLine(task: ITaskListItemDto): string {
    const label = this.translate.instant('task.evidenceRequired');
    const count =
      task.evidenceCount === 0
        ? this.translate.instant('task.evidenceNone')
        : this.format.count('task.evidenceAdded', task.evidenceCount);
    return `${label} · ${count}`;
  }

  needsEvidence(task: ITaskListItemDto): boolean {
    return task.requiresEvidence && task.evidenceCount === 0 && isTaskOpen(task);
  }

  // Every row in Available is waiting in one of the viewer's pools by
  // construction; the server re-checks membership and who was first.
  canPick(task: ITaskListItemDto): boolean {
    return isTaskOpen(task) && task.status !== 'REJECTED';
  }

  canRelease(task: IMyTaskListItemDto): boolean {
    return task.pickedByMe && !!task.pool && isTaskOpen(task);
  }

  canStart(task: ITaskListItemDto): boolean {
    return displayStatus(task.status) === 'PENDING';
  }

  canReject(task: ITaskListItemDto): boolean {
    const status = displayStatus(task.status);
    return status === 'PENDING' || status === 'IN_PROGRESS';
  }

  canAddEvidence(task: ITaskListItemDto): boolean {
    return isTaskOpen(task);
  }

  canComplete(task: ITaskListItemDto): boolean {
    return isTaskOpen(task);
  }

  priorityColor(priority: string): 'danger' | 'warn' | 'info' | 'secondary' {
    switch (priority) {
      case 'CRITICAL':
        return 'danger';
      case 'HIGH':
        return 'warn';
      case 'MEDIUM':
        return 'info';
      default:
        return 'secondary';
    }
  }

  onStart(task: ITaskListItemDto): void {
    this.runAction(this.taskService.start(task.id));
  }

  onComplete(task: ITaskListItemDto): void {
    if (this.needsEvidence(task)) return;
    this.runAction(this.taskService.complete(task.id));
  }

  openRejectDialog(task: ITaskListItemDto): void {
    this.actionTarget.set(task);
    this.rejectVisible.set(true);
  }

  openLinkDialog(task: ITaskListItemDto): void {
    this.actionTarget.set(task);
    this.linkVisible.set(true);
  }

  openReleaseDialog(task: ITaskListItemDto): void {
    this.actionTarget.set(task);
    this.releaseVisible.set(true);
  }

  // A 409 means someone else picked it up first — said in the server's own
  // words, and both lists reload so the row leaves Available either way.
  onPick(task: ITaskListItemDto): void {
    if (this.picking() !== null) return;
    this.picking.set(task.id);
    this.error.set(null);
    this.taskService.pick(task.id).subscribe({
      next: () => {
        this.picking.set(null);
        this.reloadAll();
      },
      error: (err: unknown) => {
        this.picking.set(null);
        // Reload FIRST: loadTasks() clears the error line, so setting it
        // before would erase the reason the moment it appeared.
        this.reloadAll();
        this.error.set(extractErrorMessage(err, 'task.errorAction'));
      },
    });
  }

  loadAvailable(): void {
    this.taskService.getAvailable().subscribe({
      next: (tasks) => this.available.set(tasks),
      // The section is an addition to the page, not the page: a failure here
      // leaves it absent rather than putting an error over the viewer's own list.
      error: () => this.available.set([]),
    });
  }

  loadTasks(): void {
    this.loading.set(true);
    this.error.set(null);
    this.taskService.getMyTasks(this.query()).subscribe({
      next: (tasks) => {
        this.tasks.set(tasks);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('task.errorLoad');
        this.loading.set(false);
      },
    });
  }

  private query(): MyTasksQuery {
    switch (this.selectedFilter) {
      case null:
        return {};
      case 'OVERDUE':
        return { overdue: true };
      default:
        return { status: this.selectedFilter };
    }
  }

  private runAction(request: ReturnType<TaskService['start']>): void {
    this.error.set(null);
    request.subscribe({
      next: () => this.loadTasks(),
      error: (err: unknown) => this.error.set(extractErrorMessage(err, 'task.errorAction')),
    });
  }
}
