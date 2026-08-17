import { Component, OnInit, TemplateRef, ViewChild, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { ListboxModule } from 'primeng/listbox';
import { InputTextModule } from 'primeng/inputtext';
import { TaskService, ITaskDto } from '../../services/task.service';
import { UserService, IUserDto } from '../../../user/services/user.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

// Tenant-wide view of tasks with status: UNASSIGNED — my-tasks/task-list
// can never surface these (both are scoped to an assignee or a source
// object), so this is the only place an admin sees them and reassigns
// (ACC-34 item 4). Gated by tasks:manage (sidebar.component.ts), the first
// real consumer of that previously-inert permission.
@Component({
  selector: 'app-unassigned-tasks',
  standalone: true,
  imports: [
    DatePipe,
    TranslatePipe,
    ReactiveFormsModule,
    TableModule,
    TagModule,
    ButtonModule,
    ListboxModule,
    InputTextModule,
    EditDialogComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'task.unassignedTasks' | translate }}</h2>
      </div>

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
            <td>{{ task.createdAt | date: 'short' }}</td>
            <td>
              <p-button
                [label]="'task.reassign' | translate"
                size="small"
                [text]="true"
                (onClick)="onOpenReassign(task)"
              />
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

    <ng-template #reassignFormTpl>
      <form [formGroup]="reassignForm" (ngSubmit)="onSubmitReassign()" class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label for="newAssigneeUserIds" class="text-sm font-medium">
            {{ 'task.newAssignees' | translate }} <span class="text-red-500">*</span>
          </label>
          <p-listbox
            inputId="newAssigneeUserIds"
            formControlName="newAssigneeUserIds"
            [options]="users()"
            optionLabel="name"
            optionValue="id"
            [multiple]="true"
            [checkbox]="true"
            [filter]="true"
            filterBy="name,email"
            [showToggleAll]="false"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="reason" class="text-sm font-medium">
            {{ 'task.reassignReason' | translate }} <span class="text-red-500">*</span>
          </label>
          <input pInputText id="reason" formControlName="reason" />
        </div>

        @if (reassignError()) {
          <p class="text-red-500 text-sm">{{ reassignError() | translate }}</p>
        }

        <div class="flex justify-end gap-2 pt-2">
          <p-button
            [label]="'common.cancel' | translate"
            severity="secondary"
            [text]="true"
            (onClick)="reassignVisible.set(false)"
            [disabled]="reassigning()"
          />
          <p-button [label]="'common.save' | translate" type="submit" [loading]="reassigning()" />
        </div>
      </form>
    </ng-template>
    <app-edit-dialog
      [visible]="reassignVisible()"
      (visibleChange)="reassignVisible.set($event)"
      [header]="'task.reassign' | translate"
      [content]="reassignFormTpl"
      width="520px"
    />
  `,
})
export class UnassignedTasksComponent implements OnInit {
  @ViewChild('reassignFormTpl', { read: TemplateRef, static: true }) reassignFormTpl!: TemplateRef<unknown>;

  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  private readonly userService = inject(UserService);

  readonly loading = signal(false);
  readonly tasks = signal<ITaskDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly users = signal<IUserDto[]>([]);

  readonly reassignVisible = signal(false);
  readonly reassigning = signal(false);
  readonly reassignError = signal<string | null>(null);
  private reassignTarget: ITaskDto | null = null;

  readonly reassignForm = this.fb.group({
    newAssigneeUserIds: [[] as string[], [Validators.required, Validators.minLength(1)]],
    reason: ['', [Validators.required, Validators.maxLength(1000)]],
  });

  ngOnInit(): void {
    this.loadTasks();
    this.userService.listUsers().subscribe({ next: (users) => this.users.set(users) });
  }

  loadTasks(): void {
    this.loading.set(true);
    this.error.set(null);
    this.taskService.getUnassigned().subscribe({
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

  onOpenReassign(task: ITaskDto): void {
    this.reassignTarget = task;
    this.reassignError.set(null);
    this.reassignForm.reset({ newAssigneeUserIds: [], reason: '' });
    this.reassignVisible.set(true);
  }

  onSubmitReassign(): void {
    if (this.reassignForm.invalid || !this.reassignTarget) {
      this.reassignForm.markAllAsTouched();
      return;
    }
    this.reassigning.set(true);
    this.reassignError.set(null);

    const value = this.reassignForm.getRawValue();
    this.taskService
      .reassign(this.reassignTarget.id, {
        newAssigneeUserIds: value.newAssigneeUserIds!,
        reason: value.reason!,
      })
      .subscribe({
        next: () => {
          this.reassigning.set(false);
          this.reassignVisible.set(false);
          this.loadTasks();
        },
        error: (err: unknown) => {
          this.reassignError.set(extractErrorMessage(err, 'task.errorReassign'));
          this.reassigning.set(false);
        },
      });
  }
}
