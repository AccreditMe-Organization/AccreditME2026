import { Component, Input, Output, EventEmitter, OnInit, OnChanges, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { ConfirmationService } from 'primeng/api';
import {
  WorkflowTemplateService,
  WorkflowStageDto,
  WorkflowTransitionDto,
  CreateWorkflowTransitionDto,
  UpdateWorkflowTransitionDto,
} from '../../services/workflow-template.service';
import { RoleService, RoleDto } from '../../../roles/services/role.service';
import { WorkflowActionConfiguratorComponent } from '../workflow-action-configurator/workflow-action-configurator.component';

const TRIGGER_CONDITIONS = [
  { label: 'SPECIFIC_USER', value: 'SPECIFIC_USER' },
  { label: 'ROLE_BASED', value: 'ROLE_BASED' },
  { label: 'ANY_AUTHENTICATED', value: 'ANY_AUTHENTICATED' },
  { label: 'SYSTEM_AUTOMATIC', value: 'SYSTEM_AUTOMATIC' },
];

@Component({
  selector: 'app-workflow-transition-editor',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    SelectModule,
    CheckboxModule,
    MessageModule,
    WorkflowActionConfiguratorComponent,
  ],
  template: `
    <div class="flex flex-col gap-3">

      <div class="flex items-center justify-between">
        <h3 class="font-medium text-sm">{{ 'workflow.transitions' | translate }}</h3>
        <p-button
          icon="pi pi-plus"
          size="small"
          [label]="'workflow.addTransition' | translate"
          (onClick)="openAdd()"
        />
      </div>

      @if (error()) {
        <p class="text-red-500 text-sm">{{ error() }}</p>
      }

      <p-table [value]="transitions" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ 'workflow.labelEn' | translate }}</th>
            <th>{{ 'workflow.toStage' | translate }}</th>
            <th>{{ 'workflow.triggerCondition' | translate }}</th>
            <th></th>
            <th></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-transition>
          <tr>
            <td>{{ transition.labelEn }}</td>
            <td>{{ stageName(transition.toStageId) }}</td>
            <td>
              <p-tag [value]="transition.triggerCondition" severity="info" />
              @if (transition.isApprovalPath) {
                <p-tag [value]="'workflow.approvalPath' | translate" severity="success" />
              }
            </td>
            <td>
              <p-button
                icon="pi pi-cog"
                [text]="true"
                size="small"
                [pTooltip]="'workflow.actions' | translate"
                (onClick)="openActions(transition)"
              />
            </td>
            <td>
              <div class="flex gap-1 justify-end">
                <p-button
                  icon="pi pi-pencil"
                  [text]="true"
                  size="small"
                  [pTooltip]="'common.save' | translate"
                  (onClick)="openEdit(transition)"
                />
                <p-button
                  icon="pi pi-trash"
                  [text]="true"
                  size="small"
                  severity="danger"
                  [pTooltip]="'common.remove' | translate"
                  (onClick)="onRemove(transition)"
                />
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5" class="text-center py-4 text-surface-400">
              {{ 'workflow.noTransitions' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Add Transition -->
      <p-dialog
        [visible]="showAddDialog()"
        (visibleChange)="showAddDialog.set($event)"
        [header]="'workflow.addTransition' | translate"
        [modal]="true"
        [style]="{ width: '560px' }"
      >
        <form [formGroup]="addForm" (ngSubmit)="onSubmitAdd()" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.toStage' | translate }} <span class="text-red-500">*</span></label>
            <p-select
              formControlName="toStageId"
              [options]="availableStages"
              optionLabel="nameEn"
              optionValue="id"
              styleClass="w-full"
            />
          </div>

          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.labelEn' | translate }} <span class="text-red-500">*</span></label>
            <input pInputText formControlName="labelEn" />
          </div>

          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.labelAr' | translate }} <span class="text-red-500">*</span></label>
            <input pInputText dir="rtl" formControlName="labelAr" />
          </div>

          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.triggerCondition' | translate }} <span class="text-red-500">*</span></label>
            <p-select
              formControlName="triggerCondition"
              [options]="triggerConditions"
              optionLabel="label"
              optionValue="value"
              styleClass="w-full"
            />
          </div>

          @if (addForm.controls.triggerCondition.value === 'ROLE_BASED') {
            <div class="flex flex-col gap-1">
              <label class="font-medium text-sm">{{ 'workflow.assigneeRole' | translate }}</label>
              <p-select
                formControlName="triggerRoleId"
                [options]="roles()"
                optionLabel="nameEn"
                optionValue="id"
                styleClass="w-full"
              />
            </div>
          }

          @if (addForm.controls.triggerCondition.value === 'SPECIFIC_USER') {
            <p-message severity="info" [text]="'workflow.userPickerUnavailable' | translate" />
          }

          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.requiredPermission' | translate }}</label>
            <input pInputText formControlName="requiredPermission" />
          </div>

          <div class="flex items-center gap-2">
            <p-checkbox formControlName="isApprovalPath" [binary]="true" inputId="add-isApprovalPath" />
            <label for="add-isApprovalPath" class="text-sm cursor-pointer">
              {{ 'workflow.isApprovalPath' | translate }}
            </label>
          </div>

          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.validatorConfig' | translate }}</label>
            <textarea pTextarea rows="3" formControlName="validatorConfig"></textarea>
          </div>

          @if (saveError()) {
            <p class="text-red-500 text-sm">{{ saveError() }}</p>
          }

          <div class="flex gap-3 justify-end">
            <p-button
              [label]="'common.cancel' | translate"
              severity="secondary"
              [text]="true"
              type="button"
              (onClick)="showAddDialog.set(false)"
            />
            <p-button
              type="submit"
              [label]="'common.add' | translate"
              [loading]="saving()"
              [disabled]="addForm.invalid"
            />
          </div>
        </form>
      </p-dialog>

      <!-- Edit Transition -->
      <p-dialog
        [visible]="showEditDialog()"
        (visibleChange)="showEditDialog.set($event)"
        [header]="'workflow.editTransition' | translate"
        [modal]="true"
        [style]="{ width: '560px' }"
      >
        <p class="text-sm text-surface-500 mb-2">
          {{ 'workflow.transitionEndpointsLocked' | translate }}
        </p>
        <form [formGroup]="editForm" (ngSubmit)="onSubmitEdit()" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.labelEn' | translate }} <span class="text-red-500">*</span></label>
            <input pInputText formControlName="labelEn" />
          </div>

          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.labelAr' | translate }} <span class="text-red-500">*</span></label>
            <input pInputText dir="rtl" formControlName="labelAr" />
          </div>

          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.triggerCondition' | translate }} <span class="text-red-500">*</span></label>
            <p-select
              formControlName="triggerCondition"
              [options]="triggerConditions"
              optionLabel="label"
              optionValue="value"
              styleClass="w-full"
            />
          </div>

          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.requiredPermission' | translate }}</label>
            <input pInputText formControlName="requiredPermission" />
          </div>

          <div class="flex items-center gap-2">
            <p-checkbox formControlName="isApprovalPath" [binary]="true" inputId="edit-isApprovalPath" />
            <label for="edit-isApprovalPath" class="text-sm cursor-pointer">
              {{ 'workflow.isApprovalPath' | translate }}
            </label>
          </div>

          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.validatorConfig' | translate }}</label>
            <textarea pTextarea rows="3" formControlName="validatorConfig"></textarea>
          </div>

          @if (saveError()) {
            <p class="text-red-500 text-sm">{{ saveError() }}</p>
          }

          <div class="flex gap-3 justify-end">
            <p-button
              [label]="'common.cancel' | translate"
              severity="secondary"
              [text]="true"
              type="button"
              (onClick)="showEditDialog.set(false)"
            />
            <p-button
              type="submit"
              [label]="'common.save' | translate"
              [loading]="saving()"
              [disabled]="editForm.invalid"
            />
          </div>
        </form>
      </p-dialog>

      <!-- Configure Actions -->
      <p-dialog
        [visible]="showActionsDialog()"
        (visibleChange)="showActionsDialog.set($event)"
        [header]="'workflow.actions' | translate"
        [modal]="true"
        [style]="{ width: '560px' }"
      >
        @if (actionsTransition(); as transition) {
          <app-workflow-action-configurator
            [transitionId]="transition.id"
            [actions]="transition.actions ?? []"
            (changed)="changed.emit()"
          />
        }
      </p-dialog>

    </div>
  `,
})
export class WorkflowTransitionEditorComponent implements OnInit, OnChanges {
  @Input() stageId!: string;
  @Input() transitions: WorkflowTransitionDto[] = [];
  @Input() availableStages: WorkflowStageDto[] = [];
  @Output() changed = new EventEmitter<void>();

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly roleService = inject(RoleService);
  private readonly fb = inject(FormBuilder);
  private readonly confirmationService = inject(ConfirmationService);

  readonly triggerConditions = TRIGGER_CONDITIONS;
  readonly roles = signal<RoleDto[]>([]);

  readonly showAddDialog = signal(false);
  readonly showEditDialog = signal(false);
  readonly showActionsDialog = signal(false);
  readonly editingTransition = signal<WorkflowTransitionDto | null>(null);
  readonly actionsTransition = signal<WorkflowTransitionDto | null>(null);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly addForm = this.fb.group({
    toStageId: [null as string | null, [Validators.required]],
    labelEn: ['', [Validators.required, Validators.maxLength(100)]],
    labelAr: ['', [Validators.required, Validators.maxLength(100)]],
    triggerCondition: ['ROLE_BASED', [Validators.required]],
    triggerRoleId: [null as string | null],
    requiredPermission: [''],
    isApprovalPath: [false],
    validatorConfig: [''],
  });

  readonly editForm = this.fb.group({
    labelEn: ['', [Validators.required, Validators.maxLength(100)]],
    labelAr: ['', [Validators.required, Validators.maxLength(100)]],
    triggerCondition: ['ROLE_BASED', [Validators.required]],
    requiredPermission: [''],
    isApprovalPath: [false],
    validatorConfig: [''],
  });

  ngOnInit(): void {
    this.roleService.listRoles().subscribe({ next: (roles) => this.roles.set(roles) });
  }

  ngOnChanges(): void {
    // availableStages/transitions are parent-owned — nothing to refetch here.
  }

  stageName(stageId: string): string {
    return this.availableStages.find((s) => s.id === stageId)?.nameEn ?? stageId;
  }

  openAdd(): void {
    this.addForm.reset({
      toStageId: null,
      labelEn: '',
      labelAr: '',
      triggerCondition: 'ROLE_BASED',
      triggerRoleId: null,
      requiredPermission: '',
      isApprovalPath: false,
      validatorConfig: '',
    });
    this.saveError.set(null);
    this.showAddDialog.set(true);
  }

  openEdit(transition: WorkflowTransitionDto): void {
    this.editingTransition.set(transition);
    this.editForm.reset({
      labelEn: transition.labelEn,
      labelAr: transition.labelAr,
      triggerCondition: transition.triggerCondition,
      requiredPermission: transition.requiredPermission ?? '',
      isApprovalPath: transition.isApprovalPath,
      validatorConfig: transition.validatorConfig ? JSON.stringify(transition.validatorConfig) : '',
    });
    this.saveError.set(null);
    this.showEditDialog.set(true);
  }

  openActions(transition: WorkflowTransitionDto): void {
    this.actionsTransition.set(transition);
    this.showActionsDialog.set(true);
  }

  onSubmitAdd(): void {
    if (this.addForm.invalid) return;
    const raw = this.addForm.getRawValue();

    let validatorConfig: Record<string, unknown> | undefined;
    try {
      validatorConfig = raw.validatorConfig ? JSON.parse(raw.validatorConfig) : undefined;
    } catch {
      this.saveError.set('Invalid JSON in validator config');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);

    const dto: CreateWorkflowTransitionDto = {
      fromStageId: this.stageId,
      toStageId: raw.toStageId!,
      labelEn: raw.labelEn!,
      labelAr: raw.labelAr!,
      triggerCondition: raw.triggerCondition!,
      ...(raw.requiredPermission ? { requiredPermission: raw.requiredPermission } : {}),
      ...(raw.triggerCondition === 'ROLE_BASED' && raw.triggerRoleId
        ? { triggerRoleId: raw.triggerRoleId }
        : {}),
      ...(validatorConfig ? { validatorConfig } : {}),
    };

    this.workflowTemplateService.addTransition(dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.showAddDialog.set(false);
        this.changed.emit();
      },
      error: (err: { error?: { message?: string } }) => {
        this.saveError.set(err?.error?.message ?? 'Save failed');
        this.saving.set(false);
      },
    });
  }

  onSubmitEdit(): void {
    const transition = this.editingTransition();
    if (this.editForm.invalid || !transition) return;
    const raw = this.editForm.getRawValue();

    let validatorConfig: Record<string, unknown> | undefined;
    try {
      validatorConfig = raw.validatorConfig ? JSON.parse(raw.validatorConfig) : undefined;
    } catch {
      this.saveError.set('Invalid JSON in validator config');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);

    const dto: UpdateWorkflowTransitionDto = {
      labelEn: raw.labelEn!,
      labelAr: raw.labelAr!,
      triggerCondition: raw.triggerCondition!,
      requiredPermission: raw.requiredPermission || undefined,
      isApprovalPath: raw.isApprovalPath!,
      ...(validatorConfig ? { validatorConfig } : {}),
    };

    this.workflowTemplateService.updateTransition(transition.id, dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.showEditDialog.set(false);
        this.changed.emit();
      },
      error: (err: { error?: { message?: string } }) => {
        this.saveError.set(err?.error?.message ?? 'Save failed');
        this.saving.set(false);
      },
    });
  }

  onRemove(transition: WorkflowTransitionDto): void {
    this.confirmationService.confirm({
      message: `Remove transition "${transition.labelEn}"?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.workflowTemplateService.removeTransition(transition.id).subscribe({
          next: () => this.changed.emit(),
          error: (err: { error?: { message?: string } }) =>
            this.error.set(err?.error?.message ?? 'Remove failed'),
        });
      },
    });
  }
}
