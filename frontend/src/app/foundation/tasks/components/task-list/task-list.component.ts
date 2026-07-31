import { Component, OnInit, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TaskService, ITaskDto } from '../../services/task.service';
import { TaskFormComponent } from '../task-form/task-form.component';

// Embeddable list filtered by sourceType + sourceId — meant to be dropped
// into a future module's detail page (e.g. an Incident detail page showing
// its tasks). No functional module exists yet to embed it in, so it ships
// as its own standalone routed page for now, same "temporary standalone,
// built reusable" pattern Step 7 used for the notification bell. The create
// dialog follows the same p-dialog + embedded form pattern as Step 8's
// OrgPosition list (position-list.component.ts).
@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [DatePipe, TranslatePipe, TableModule, TagModule, ButtonModule, DialogModule, TaskFormComponent],
  template: `
    <div class="flex flex-col h-full gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'task.allTasks' | translate }}</h2>
        <p-button [label]="'task.newTask' | translate" icon="pi pi-plus" (onClick)="onAdd()" />
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() }}</p>
      }

      <p-table [value]="tasks()" [loading]="loading()" scrollable scrollHeight="flex" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 40%">{{ 'task.title' | translate }}</th>
            <th style="width: 20%">{{ 'task.priority.title' | translate }}</th>
            <th style="width: 20%">{{ 'task.dueDate' | translate }}</th>
            <th style="width: 20%">{{ 'task.status.title' | translate }}</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-task>
          <tr>
            <td>{{ task.title }}</td>
            <td>{{ ('task.priority.' + task.priority.toLowerCase()) | translate }}</td>
            <td>{{ task.dueAt ? (task.dueAt | date: 'short') : '—' }}</td>
            <td>
              <p-tag [value]="('task.status.' + task.status.toLowerCase()) | translate" />
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="4" class="text-center py-8 text-[var(--am-text-secondary)]">{{ 'task.noTasks' | translate }}</td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <p-dialog
      [(visible)]="formVisible"
      [header]="'task.newTask' | translate"
      [modal]="true"
      styleClass="w-full max-w-lg"
    >
      @if (formVisible()) {
        <app-task-form (saved)="onSaved()" (cancelled)="formVisible.set(false)" />
      }
    </p-dialog>
  `,
})
export class TaskListComponent implements OnInit {
  private readonly taskService = inject(TaskService);

  readonly sourceType = input<string | null>(null);
  readonly sourceId = input<string | null>(null);

  readonly loading = signal(false);
  readonly tasks = signal<ITaskDto[]>([]);
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
