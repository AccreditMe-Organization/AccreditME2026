import { Component, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TaskService } from '../../services/task.service';
// ACC-41 — OverlaySelectComponent replaces p-select here: this field sits in
// a raw p-dialog (not EditDialogComponent), the second confirmed DOM context
// where PrimeNG's own scroll-chaining bug is reachable, and the option list
// here is a plain string[] (exercises the primitive-array fallback in
// getOptionLabel()/getOptionValue()). See CLAUDE.md's PrimeNG-components-only
// exception note and overlay-select.component.ts for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

const SOURCE_TYPES = [
  'MEETING',
  'DOCUMENT',
  'AUDIT',
  'CAPA',
  'INCIDENT',
  'CORRECTIVE_ACTION',
  'STANDARD',
  'KPI',
  'GAP',
  'QUALITY_IMPROVEMENT_PLAN',
];

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

@Component({
  selector: 'app-task-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    TextareaModule,
    SelectModule,
    DatePickerModule,
    ButtonModule,
    MessageModule,
    OverlaySelectComponent,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label for="title" class="text-sm font-medium">
          {{ 'task.title' | translate }} <span class="text-red-500">*</span>
        </label>
        <input pInputText id="title" formControlName="title" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="description" class="text-sm font-medium">{{ 'task.description' | translate }}</label>
        <textarea pTextarea id="description" formControlName="description" rows="3"></textarea>
      </div>

      <div class="flex gap-4">
        <div class="flex flex-col gap-1 flex-1">
          <label for="sourceType" class="text-sm font-medium">
            {{ 'task.sourceType' | translate }} <span class="text-red-500">*</span>
          </label>
          <app-overlay-select formControlName="sourceType" [options]="sourceTypes" />
        </div>
        <div class="flex flex-col gap-1 flex-1">
          <label for="sourceId" class="text-sm font-medium">
            {{ 'task.sourceId' | translate }} <span class="text-red-500">*</span>
          </label>
          <input pInputText id="sourceId" formControlName="sourceId" />
        </div>
      </div>

      <div class="flex gap-4">
        <div class="flex flex-col gap-1 flex-1">
          <label for="priority" class="text-sm font-medium">{{ 'task.priority.title' | translate }}</label>
          <p-select inputId="priority" formControlName="priority" [options]="priorities" />
        </div>
        <div class="flex flex-col gap-1 flex-1">
          <label for="dueDate" class="text-sm font-medium">{{ 'task.dueDate' | translate }}</label>
          <p-datepicker inputId="dueDate" formControlName="dueDate" [showTime]="true" />
        </div>
      </div>

      <p-message severity="info" [text]="'task.assigneePickerUnavailable' | translate" />

      <div class="flex justify-end gap-2 pt-2">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="cancelled.emit()"
          [disabled]="saving()"
        />
        <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" />
      </div>
    </form>
  `,
})
export class TaskFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);

  readonly saved = output<void>();
  readonly cancelled = output<void>();

  readonly saving = signal(false);
  readonly sourceTypes = SOURCE_TYPES;
  readonly priorities = PRIORITIES;

  readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(255)]],
    description: ['', [Validators.maxLength(2000)]],
    sourceType: ['DOCUMENT', [Validators.required]],
    sourceId: ['', [Validators.required]],
    priority: ['MEDIUM'],
    dueDate: [null as Date | null],
  });

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);

    const value = this.form.getRawValue();
    this.taskService
      .create({
        title: value.title!,
        description: value.description || undefined,
        sourceType: value.sourceType!,
        sourceId: value.sourceId!,
        priority: value.priority ?? undefined,
        dueDate: value.dueDate ? value.dueDate.toISOString() : undefined,
        // No user-listing endpoint exists yet (Users module is Step 9) — see
        // the p-message stopgap above. Submitting empty is a genuinely
        // working path: TaskService.create() creates the task as UNASSIGNED
        // and notifies the Tenant Admin to assign it, rather than faking a
        // picker with raw ID text input.
        assigneeUserIds: [],
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.saved.emit();
        },
        error: () => this.saving.set(false),
      });
  }
}
