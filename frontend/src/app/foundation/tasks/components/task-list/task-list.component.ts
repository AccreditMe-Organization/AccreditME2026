import { Component, OnInit, TemplateRef, ViewChild, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { TaskService, ITaskWithAssigneesDto } from '../../services/task.service';
import { TaskFormComponent } from '../task-form/task-form.component';
// ACC-39 — EditDialogComponent replaces this raw p-dialog + manual @if.
// task-form is create-only (no edit flow), so this is architectural
// consistency with the required pattern going forward (SYSTEM-REFERENCE.md
// Section 10.5), not a bug fix — the old @if(formVisible()) wrapping
// <app-task-form> directly was already immune to ACC-29's pre-fill bug.
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';

// The ROUTED, full-page task list, filtered by sourceType + sourceId.
//
// ACC-76 — this is no longer "the embeddable list meant to be dropped into a
// module's detail page", which its header comment claimed from ACC-11 onward.
// It never was: it renders its own page heading, h-full and
// scrollHeight="flex", so embedded it fought its container for height and
// brought a full table's type scale and column widths into a summary panel.
//
// An `embedded` mode was added and then removed the same ticket, once
// Committee's Tasks panel was rebuilt to render its own rows on
// RecordPanelComponent — a summary panel needs four facts, not a table's
// column set, and equal panel heights in a row cannot survive one panel
// bringing its own. Removed rather than left as dead configuration.
//
// A record page that wants a task summary should follow committee-detail's
// shape: RecordPanelComponent plus its own rows, calling
// TaskService.getForSource() directly. That also lets it reload after a
// create, which this component could never be told to do.
@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [DatePipe, TranslatePipe, TableModule, TagModule, ButtonModule, TaskFormComponent, EditDialogComponent],
  template: `
    <div class="flex flex-col h-full gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'task.allTasks' | translate }}</h2>
        <p-button [label]="'task.newTask' | translate" icon="pi pi-plus" (onClick)="onAdd()" />
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() | translate }}</p>
      }

      <p-table [value]="tasks()" [loading]="loading()" scrollable scrollHeight="flex" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 34%">{{ 'task.title' | translate }}</th>
            <th style="width: 26%">{{ 'task.assignees' | translate }}</th>
            <th style="width: 13%">{{ 'task.priority.title' | translate }}</th>
            <th style="width: 14%">{{ 'task.dueDate' | translate }}</th>
            <th style="width: 13%">{{ 'task.status.title' | translate }}</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-task>
          <tr>
            <td>{{ task.title }}</td>
            <td>
              <!-- ACC-58, absorbed into ACC-76: the first surface in the
                   product that answers "who is this assigned to". -->
              @if (task.assignees.length === 0) {
                <span class="text-[var(--am-text-secondary)]">{{ 'task.unassigned' | translate }}</span>
              } @else {
                <div class="flex flex-col">
                  @for (assignee of task.assignees; track assignee.userId) {
                    <span>{{ assignee.userName }}</span>
                  }
                </div>
              }
            </td>
            <td>{{ ('task.priority.' + task.priority.toLowerCase()) | translate }}</td>
            <td>{{ task.dueAt ? (task.dueAt | date: 'short') : '—' }}</td>
            <td>
              <p-tag [value]="('task.status.' + task.status.toLowerCase()) | translate" />
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5" class="text-center py-8 text-[var(--am-text-secondary)]">{{ 'task.noTasks' | translate }}</td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <ng-template #formTpl>
      <app-task-form (saved)="onSaved()" (cancelled)="formVisible.set(false)" />
    </ng-template>
    <app-edit-dialog
      [(visible)]="formVisible"
      [header]="'task.newTask' | translate"
      [content]="formTpl"
    />
  `,
})
export class TaskListComponent implements OnInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly taskService = inject(TaskService);

  readonly sourceType = input<string | null>(null);
  readonly sourceId = input<string | null>(null);

  readonly loading = signal(false);
  readonly tasks = signal<ITaskWithAssigneesDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly formVisible = signal(false);

  ngOnInit(): void {
    this.loadTasks();
  }

  onAdd(): void {
    this.formVisible.set(true);
  }

  onSaved(): void {
    this.formVisible.set(false);
    this.loadTasks();
  }

  loadTasks(): void {
    const type = this.sourceType();
    const id = this.sourceId();
    if (!type || !id) return;

    this.loading.set(true);
    this.taskService.getForSource(type, id).subscribe({
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
}
