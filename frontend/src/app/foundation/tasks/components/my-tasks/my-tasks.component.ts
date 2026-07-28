import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SelectButtonModule } from 'primeng/selectbutton';
import { FormsModule } from '@angular/forms';
import { TaskService, ITaskDto } from '../../services/task.service';

const STATUS_OPTIONS = ['PENDING', 'IN_PROGRESS', 'OVERDUE', 'COMPLETED'] as const;

@Component({
  selector: 'app-my-tasks',
  standalone: true,
  imports: [DatePipe, TranslatePipe, TableModule, ButtonModule, TagModule, SelectButtonModule, FormsModule],
  template: `
    <div class="flex flex-col h-full gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'task.myTasks' | translate }}</h2>
      </div>

      <p-selectButton
        [options]="statusOptions"
        [(ngModel)]="selectedStatus"
        (onChange)="loadTasks()"
      >
        <ng-template let-status>
          {{ ('task.status.' + statusKey(status)) | translate }}
        </ng-template>
      </p-selectButton>

      @if (error()) {
        <p class="text-red-500">{{ error() }}</p>
      }

      <p-table [value]="tasks()" [loading]="loading()" scrollable scrollHeight="flex" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 14%">{{ 'task.source' | translate }}</th>
            <th style="width: 32%">{{ 'task.title' | translate }}</th>
            <th style="width: 14%">{{ 'task.priority.title' | translate }}</th>
            <th style="width: 16%">{{ 'task.dueDate' | translate }}</th>
            <th style="width: 12%">{{ 'task.status.title' | translate }}</th>
            <th style="width: 12%"></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-task>
          <tr>
            <td><p-tag [value]="task.sourceType" severity="info" /></td>
            <td>{{ task.title }}</td>
            <td>
              <p-tag
                [value]="('task.priority.' + task.priority.toLowerCase()) | translate"
                [severity]="priorityColor(task.priority)"
              />
            </td>
            <td>{{ task.dueAt ? (task.dueAt | date: 'short') : '—' }}</td>
            <td>
              <p-tag
                [value]="('task.status.' + task.status.toLowerCase()) | translate"
                [severity]="statusColor(task.status)"
              />
            </td>
            <td>
              @if (task.status !== 'COMPLETED' && task.status !== 'CANCELLED') {
                <p-button
                  [label]="'task.complete' | translate"
                  size="small"
                  [text]="true"
                  (onClick)="onComplete(task)"
                />
              }
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="text-center py-8 text-surface-400">{{ 'task.noTasks' | translate }}</td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
})
export class MyTasksComponent implements OnInit {
  private readonly taskService = inject(TaskService);

  readonly statusOptions = [...STATUS_OPTIONS];
  selectedStatus: string | null = null;

  readonly loading = signal(false);
  readonly tasks = signal<ITaskDto[]>([]);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadTasks();
  }

  statusKey(status: string): string {
    return status.toLowerCase();
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

  statusColor(status: string): 'success' | 'danger' | 'warn' | 'secondary' {
    switch (status) {
      case 'COMPLETED':
        return 'success';
      case 'OVERDUE':
        return 'danger';
      case 'UNASSIGNED':
        return 'warn';
      default:
        return 'secondary';
    }
  }

  onComplete(task: ITaskDto): void {
    this.taskService.complete(task.id).subscribe({
      next: () => this.loadTasks(),
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err?.error?.message ?? 'Complete failed'),
    });
  }

  loadTasks(): void {
    this.loading.set(true);
    this.error.set(null);
    this.taskService.getMyTasks(this.selectedStatus ?? undefined).subscribe({
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
