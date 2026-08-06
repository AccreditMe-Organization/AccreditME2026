import { Component, Input, Output, EventEmitter, OnInit, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmationService } from 'primeng/api';
import {
  WorkflowTemplateService,
  WorkflowTransitionActionDto,
  CreateWorkflowTransitionActionDto,
} from '../../services/workflow-template.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

const ACTION_TYPES = [
  { label: 'CREATE_TASK', value: 'CREATE_TASK' },
  { label: 'SEND_NOTIFICATION', value: 'SEND_NOTIFICATION' },
  { label: 'GENERATE_PDF', value: 'GENERATE_PDF' },
  { label: 'LOCK_DOCUMENT', value: 'LOCK_DOCUMENT' },
  { label: 'LOG_AUDIT', value: 'LOG_AUDIT' },
  { label: 'WEBHOOK', value: 'WEBHOOK' },
];

@Component({
  selector: 'app-workflow-action-configurator',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectModule,
    CheckboxModule,
  ],
  template: `
    <div class="flex flex-col gap-3">

      <div class="flex items-center justify-between">
        <h3 class="font-medium text-sm">{{ 'workflow.actions' | translate }}</h3>
        <p-button
          icon="pi pi-plus"
          size="small"
          [label]="'workflow.addAction' | translate"
          (onClick)="openAdd()"
        />
      </div>

      @if (error()) {
        <p class="text-red-500 text-sm">{{ error() | translate }}</p>
      }

      <p-table [value]="actions" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ 'workflow.actionType' | translate }}</th>
            <th>{{ 'workflow.order' | translate }}</th>
            <th></th>
            <th></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-action>
          <tr>
            <td>
              <p-tag [value]="action.actionType" severity="info" />
            </td>
            <td>{{ action.order }}</td>
            <td>
              <div class="flex items-center gap-2">
                <p-checkbox
                  [ngModel]="action.isEnabled"
                  [binary]="true"
                  (ngModelChange)="onToggleEnabled(action, $event)"
                />
                <label class="text-sm">{{ 'workflow.actionEnabled' | translate }}</label>
              </div>
            </td>
            <td>
              <div class="flex gap-1 justify-end">
                <p-button
                  icon="pi pi-pencil"
                  [text]="true"
                  size="small"
                  [pTooltip]="'common.save' | translate"
                  (onClick)="openEdit(action)"
                />
                <p-button
                  icon="pi pi-trash"
                  [text]="true"
                  size="small"
                  severity="danger"
                  [pTooltip]="'common.remove' | translate"
                  (onClick)="onRemove(action)"
                />
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="4" class="text-center py-4 text-[var(--am-text-secondary)]">
              {{ 'workflow.noActions' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>

      <p-dialog
        [visible]="showFormDialog()"
        (visibleChange)="showFormDialog.set($event)"
        [header]="(editingAction() ? 'workflow.editStage' : 'workflow.addAction') | translate"
        [modal]="true"
        [style]="{ width: '520px' }"
      >
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.actionType' | translate }} <span class="text-red-500">*</span></label>
            <p-select
              formControlName="actionType"
              [options]="actionTypes"
              optionLabel="label"
              optionValue="value"
              styleClass="w-full"
            />
          </div>

          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.order' | translate }} <span class="text-red-500">*</span></label>
            <p-inputNumber formControlName="order" [min]="0" styleClass="w-full" />
          </div>

          <div class="flex items-center gap-2">
            <p-checkbox formControlName="isEnabled" [binary]="true" inputId="isEnabled" />
            <label for="isEnabled" class="text-sm cursor-pointer">
              {{ 'workflow.actionEnabled' | translate }}
            </label>
          </div>

          @if (actionType() === 'WEBHOOK') {
            <div class="flex flex-col gap-1">
              <label class="font-medium text-sm">{{ 'workflow.webhookUrl' | translate }} <span class="text-red-500">*</span></label>
              <input pInputText formControlName="webhookUrl" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="font-medium text-sm">{{ 'workflow.webhookHeaders' | translate }}</label>
              <textarea pTextarea rows="3" formControlName="webhookHeaders" placeholder='{"Authorization": "Bearer ..."}'></textarea>
            </div>
          }

          @if (saveError()) {
            <p class="text-red-500 text-sm">{{ saveError() | translate }}</p>
          }

          <div class="flex gap-3 justify-end">
            <p-button
              [label]="'common.cancel' | translate"
              severity="secondary"
              [text]="true"
              type="button"
              (onClick)="showFormDialog.set(false)"
            />
            <p-button
              type="submit"
              [label]="(editingAction() ? 'common.save' : 'common.add') | translate"
              [loading]="saving()"
              [disabled]="form.invalid"
            />
          </div>
        </form>
      </p-dialog>

    </div>
  `,
})
export class WorkflowActionConfiguratorComponent implements OnInit {
  @Input() transitionId!: string;
  @Input() actions: WorkflowTransitionActionDto[] = [];
  @Output() changed = new EventEmitter<void>();

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly fb = inject(FormBuilder);
  private readonly confirmationService = inject(ConfirmationService);

  readonly actionTypes = ACTION_TYPES;
  readonly showFormDialog = signal(false);
  readonly editingAction = signal<WorkflowTransitionActionDto | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    actionType: ['LOG_AUDIT', [Validators.required]],
    order: [10, [Validators.required, Validators.min(0)]],
    isEnabled: [true],
    webhookUrl: [''],
    webhookHeaders: [''],
  });

  readonly actionType = toSignal(this.form.controls.actionType.valueChanges, {
    initialValue: this.form.controls.actionType.value,
  });

  ngOnInit(): void {}

  openAdd(): void {
    this.editingAction.set(null);
    this.form.reset({
      actionType: 'LOG_AUDIT',
      order: 10,
      isEnabled: true,
      webhookUrl: '',
      webhookHeaders: '',
    });
    this.saveError.set(null);
    this.showFormDialog.set(true);
  }

  openEdit(action: WorkflowTransitionActionDto): void {
    this.editingAction.set(action);
    const config = action.configJson as { webhookUrl?: string; headers?: Record<string, string> } | null;
    this.form.reset({
      actionType: action.actionType,
      order: action.order,
      isEnabled: action.isEnabled,
      webhookUrl: config?.webhookUrl ?? '',
      webhookHeaders: config?.headers ? JSON.stringify(config.headers) : '',
    });
    this.saveError.set(null);
    this.showFormDialog.set(true);
  }

  onToggleEnabled(action: WorkflowTransitionActionDto, isEnabled: boolean): void {
    this.workflowTemplateService.updateTransitionAction(action.id, { isEnabled }).subscribe({
      next: () => this.changed.emit(),
      error: (err: unknown) =>
        this.error.set(extractErrorMessage(err, 'Update failed')),
    });
  }

  onRemove(action: WorkflowTransitionActionDto): void {
    this.confirmationService.confirm({
      message: `Remove this ${action.actionType} action?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.workflowTemplateService.removeTransitionAction(action.id).subscribe({
          next: () => this.changed.emit(),
          error: (err: unknown) =>
            this.error.set(extractErrorMessage(err, 'Remove failed')),
        });
      },
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();

    let configJson: Record<string, unknown> | undefined;
    if (raw.actionType === 'WEBHOOK') {
      let headers: Record<string, string> | undefined;
      try {
        headers = raw.webhookHeaders ? JSON.parse(raw.webhookHeaders) : undefined;
      } catch {
        this.saveError.set('Invalid JSON in webhook headers');
        return;
      }
      configJson = { webhookUrl: raw.webhookUrl, ...(headers ? { headers } : {}) };
    }

    this.saving.set(true);
    this.saveError.set(null);

    const dto: CreateWorkflowTransitionActionDto = {
      actionType: raw.actionType!,
      order: raw.order!,
      isEnabled: raw.isEnabled!,
      ...(configJson ? { configJson } : {}),
    };

    const editing = this.editingAction();
    const request$ = editing
      ? this.workflowTemplateService.updateTransitionAction(editing.id, dto)
      : this.workflowTemplateService.addTransitionAction(this.transitionId, dto);

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.showFormDialog.set(false);
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, 'Save failed'));
        this.saving.set(false);
      },
    });
  }
}
