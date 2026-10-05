import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AmDateTimePipe } from '../../../../core/formatting';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { TaskService, ITaskDto } from '../../services/task.service';
import { TaskReassignDialogComponent } from '../task-reassign-dialog/task-reassign-dialog.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { injectFixLinkParam } from '../../../../shared/utils/fix-link.util';

// Tenant-wide view of tasks with status: UNASSIGNED — my-tasks/task-list
// can never surface these (both are scoped to an assignee or a source
// object), so this is the only place an admin sees them and reassigns
// (ACC-34 item 4). Gated by tasks:manage (sidebar.component.ts), the first
// real consumer of that previously-inert permission.
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
@Component({
  selector: 'app-unassigned-tasks',
  standalone: true,
  imports: [PageHeaderComponent, AmDateTimePipe, TranslatePipe, TableModule, TagModule, ButtonModule, TaskReassignDialogComponent],
  template: `
    <div class="flex flex-col h-full gap-4">
      <app-page-header
        [title]="'task.unassignedTasks' | translate"
        [purpose]="'task.unassignedPurpose' | translate"
      />

      @if (error()) {
        <p class="text-red-500">{{ error() | translate }}</p>
      }

      <p-table [value]="tasks()" [loading]="loading()" scrollable scrollHeight="flex" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 16%">{{ 'task.source' | translate }}</th>
            <th style="width: 40%">{{ 'task.title' | translate }}</th>
            <th style="width: 22%">{{ 'task.createdAt' | translate }}</th>
            <th style="width: 22%"></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-task>
          <tr>
            <td><p-tag [value]="task.sourceType" severity="warn" /></td>
            <td>{{ task.title }}</td>
            <td>{{ task.createdAt | amDateTime }}</td>
            <td>
              <!-- ACC-123 — tasks:reassign, not tasks:manage. The ROUTE is
                   tasks:manage, and the two are separate permissions, so a
                   custom role holding only the first reached this screen and
                   met a 403 on its only action. -->
              @if (canReassign()) {
                <p-button
                  [label]="'task.reassign' | translate"
                  size="small"
                  [text]="true"
                  (onClick)="onOpenReassign(task)"
                />
              }
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="4" class="text-center py-8 text-[var(--am-text-secondary)]">
              {{ 'task.noUnassignedTasks' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <!-- ACC-163 — the shared reassign dialog, which the committee record now
         also hosts. It loads its own people list and owns its own form. -->
    <app-task-reassign-dialog
      [visible]="reassignVisible()"
      (visibleChange)="reassignVisible.set($event)"
      [task]="reassignTarget()"
      (reassigned)="loadTasks()"
    />
  `,
})
export class UnassignedTasksComponent implements OnInit {
  private readonly taskService = inject(TaskService);
  private readonly navigationAccess = inject(NavigationAccessService);

  // ACC-123 — POST /tasks/:id/reassign is open to a tasks:reassign holder (and,
  // since ACC-163, to a task's own creator — but an UNASSIGNED task is an
  // administrative case, so this screen keeps the permission rule alone).
  readonly canReassign = computed(() =>
    this.navigationAccess.hasPermission('tasks:reassign'),
  );

  readonly loading = signal(false);
  readonly tasks = signal<ITaskDto[]>([]);
  readonly error = signal<string | null>(null);

  readonly reassignVisible = signal(false);
  // ACC-82 — the dialog header names the task. A Setup health Fix opens this
  // dialog straight from a list of many rows, and the admin needs to see which
  // task they are about to reassign.
  readonly reassignTarget = signal<ITaskDto | null>(null);

  ngOnInit(): void {
    this.loadTasks();
  }

  // ACC-82 — a Setup health Fix link (?reassign=<taskId>) opens that task's
  // reassign dialog. A task that has since been assigned is no longer listed,
  // so nothing opens.
  private readonly fixLinkReassign = injectFixLinkParam('reassign');

  loadTasks(): void {
    this.loading.set(true);
    this.error.set(null);
    this.taskService.getUnassigned().subscribe({
      next: (tasks) => {
        this.tasks.set(tasks);
        this.loading.set(false);
        const taskId = this.fixLinkReassign();
        const target = taskId ? tasks.find((t) => t.id === taskId) : undefined;
        if (target) this.onOpenReassign(target);
      },
      error: () => {
        this.error.set('task.errorLoad');
        this.loading.set(false);
      },
    });
  }

  onOpenReassign(task: ITaskDto): void {
    this.reassignTarget.set(task);
    this.reassignVisible.set(true);
  }
}
