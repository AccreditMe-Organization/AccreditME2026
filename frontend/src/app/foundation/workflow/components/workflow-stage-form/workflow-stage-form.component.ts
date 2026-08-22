import { Component, Input, Output, EventEmitter, OnInit, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import {
  WorkflowTemplateService,
  WorkflowStageDto,
  CreateWorkflowStageDto,
  UpdateWorkflowStageDto,
} from '../../services/workflow-template.service';
import { RoleService, RoleDto } from '../../../roles/services/role.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

const APPROVAL_MODES = [
  { label: 'SINGLE', value: 'SINGLE' },
  { label: 'SEQUENTIAL', value: 'SEQUENTIAL' },
  { label: 'PARALLEL', value: 'PARALLEL' },
  { label: 'COMMITTEE', value: 'COMMITTEE' },
];

const PARALLEL_THRESHOLDS = [
  { label: 'ALL', value: 'ALL' },
  { label: 'MAJORITY', value: 'MAJORITY' },
  { label: 'ANY', value: 'ANY' },
];

// ACC-40 Section 6/Phase 7 — ORG_UNIT_HEAD re-added now that both
// resolveAssigneeRaw() and resolveApproverPool() (backend) have real
// resolution logic wired to OrganizationService.resolveActingHeadForOrgUnit().
// Still "wired, not yet reachable in practice" for every real tenant today:
// no workflow-driven object (Committee, Meeting) has its own orgUnitId
// field yet, so this strategy will resolve to an empty pool until a real
// functional module supplies one — a tenant admin who selects it now
// configures a stage that behaves exactly like today's stub, not a crash
// or invalid state. Confirmed acceptable per the plan's own Non-Goals
// restriction, same "wired then dormant" state ASSIGNEE_POOL itself sat in
// for months before ACC-28 gave it real behavior.
const ASSIGNEE_STRATEGIES = [
  { label: 'SPECIFIC_USER', value: 'SPECIFIC_USER' },
  { label: 'ROLE', value: 'ROLE' },
  { label: 'SELF', value: 'SELF' },
  { label: 'COMMITTEE', value: 'COMMITTEE' },
  { label: 'ROUND_ROBIN', value: 'ROUND_ROBIN' },
  { label: 'ORG_UNIT_HEAD', value: 'ORG_UNIT_HEAD' },
];

@Component({
  selector: 'app-workflow-stage-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectModule,
    CheckboxModule,
    MessageModule,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">

      <div class="flex flex-col gap-1">
        <label for="nameEn" class="font-medium text-sm">
          {{ 'workflow.nameEn' | translate }} <span class="text-red-500">*</span>
        </label>
        <input id="nameEn" pInputText formControlName="nameEn" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="nameAr" class="font-medium text-sm">
          {{ 'workflow.nameAr' | translate }} <span class="text-red-500">*</span>
        </label>
        <input id="nameAr" pInputText dir="rtl" formControlName="nameAr" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="description" class="font-medium text-sm">
          {{ 'workflow.description' | translate }}
        </label>
        <textarea id="description" pTextarea rows="2" formControlName="description"></textarea>
      </div>

      <div class="flex flex-col gap-1">
        <label for="slaWorkingHours" class="font-medium text-sm">
          {{ 'workflow.slaWorkingHours' | translate }}
        </label>
        <p-inputNumber
          inputId="slaWorkingHours"
          formControlName="slaWorkingHours"
          [min]="0"
          styleClass="w-full"
        />
      </div>

      <div class="flex gap-4">
        <div class="flex items-center gap-2">
          <p-checkbox formControlName="isInitial" [binary]="true" inputId="isInitial" />
          <label for="isInitial" class="text-sm cursor-pointer">
            {{ 'workflow.isInitial' | translate }}
          </label>
        </div>
        <div class="flex items-center gap-2">
          <p-checkbox formControlName="isFinal" [binary]="true" inputId="isFinal" />
          <label for="isFinal" class="text-sm cursor-pointer">
            {{ 'workflow.isFinal' | translate }}
          </label>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label for="approvalMode" class="font-medium text-sm">
          {{ 'workflow.approvalMode' | translate }} <span class="text-red-500">*</span>
        </label>
        <p-select
          inputId="approvalMode"
          formControlName="approvalMode"
          [options]="approvalModes"
          optionLabel="label"
          optionValue="value"
          styleClass="w-full"
        />
      </div>

      @if (approvalMode() === 'PARALLEL') {
        <div class="flex flex-col gap-1">
          <label for="parallelThreshold" class="font-medium text-sm">
            {{ 'workflow.parallelThreshold' | translate }}
          </label>
          <p-select
            inputId="parallelThreshold"
            formControlName="parallelThreshold"
            [options]="parallelThresholds"
            optionLabel="label"
            optionValue="value"
            styleClass="w-full"
          />
        </div>
      }

      @if (approvalMode() === 'COMMITTEE') {
        <p-message
          severity="info"
          [text]="'workflow.committeePickerUnavailable' | translate"
        />
      }

      <div class="flex flex-col gap-1">
        <label for="assigneeStrategy" class="font-medium text-sm">
          {{ 'workflow.assigneeStrategy' | translate }} <span class="text-red-500">*</span>
        </label>
        <p-select
          inputId="assigneeStrategy"
          formControlName="assigneeStrategy"
          [options]="assigneeStrategies"
          optionLabel="label"
          optionValue="value"
          styleClass="w-full"
        />
      </div>

      @if (assigneeStrategy() === 'ROLE' || assigneeStrategy() === 'ROUND_ROBIN') {
        <div class="flex flex-col gap-1">
          <label for="assigneeRoleId" class="font-medium text-sm">
            {{ 'workflow.assigneeRole' | translate }}
          </label>
          <p-select
            inputId="assigneeRoleId"
            formControlName="assigneeRoleId"
            [options]="roles()"
            optionLabel="nameEn"
            optionValue="id"
            styleClass="w-full"
          />
        </div>
      }

      @if (assigneeStrategy() === 'COMMITTEE') {
        <div class="flex flex-col gap-1">
          <label for="assigneeCommitteeRoleValueId" class="font-medium text-sm">
            {{ 'workflow.assigneeCommitteeRole' | translate }}
          </label>
          <p-select
            inputId="assigneeCommitteeRoleValueId"
            formControlName="assigneeCommitteeRoleValueId"
            [options]="committeeRoles()"
            [optionLabel]="committeeRoleLabelField()"
            optionValue="id"
            [showClear]="true"
            styleClass="w-full"
          />
          <small class="text-[var(--am-text-secondary)]">
            {{ 'workflow.assigneeCommitteeRoleHint' | translate }}
          </small>
        </div>
      }

      @if (assigneeStrategy() === 'SPECIFIC_USER') {
        <p-message
          severity="info"
          [text]="'workflow.userPickerUnavailable' | translate"
        />
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
          (onClick)="cancelled.emit()"
        />
        <p-button
          type="submit"
          [label]="(stage ? 'common.save' : 'common.add') | translate"
          [loading]="saving()"
          [disabled]="form.invalid"
        />
      </div>

    </form>
  `,
})
export class WorkflowStageFormComponent implements OnInit {
  @Input() stage: WorkflowStageDto | null = null;
  @Input() templateId!: string;
  @Input() nextOrder = 10;
  @Output() saved = new EventEmitter<WorkflowStageDto>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly roleService = inject(RoleService);
  private readonly lookupService = inject(LookupService);
  private readonly languageService = inject(LanguageService);
  private readonly fb = inject(FormBuilder);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly roles = signal<RoleDto[]>([]);
  readonly committeeRoles = signal<LookupValueDto[]>([]);

  committeeRoleLabelField(): 'labelAr' | 'labelEn' {
    return this.languageService.isArabic() ? 'labelAr' : 'labelEn';
  }

  readonly approvalModes = APPROVAL_MODES;
  readonly parallelThresholds = PARALLEL_THRESHOLDS;
  readonly assigneeStrategies = ASSIGNEE_STRATEGIES;

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(100)]],
    nameAr: ['', [Validators.required, Validators.maxLength(100)]],
    description: [''],
    slaWorkingHours: [null as number | null, [Validators.min(0)]],
    isInitial: [false],
    isFinal: [false],
    approvalMode: ['SINGLE', [Validators.required]],
    parallelThreshold: [null as string | null],
    assigneeStrategy: ['ROLE', [Validators.required]],
    assigneeRoleId: [null as string | null],
    assigneeCommitteeRoleValueId: [null as string | null],
  });

  readonly approvalMode = toSignal(this.form.controls.approvalMode.valueChanges, {
    initialValue: this.form.controls.approvalMode.value,
  });
  readonly assigneeStrategy = toSignal(this.form.controls.assigneeStrategy.valueChanges, {
    initialValue: this.form.controls.assigneeStrategy.value,
  });

  ngOnInit(): void {
    this.roleService.listRoles().subscribe({ next: (roles) => this.roles.set(roles) });
    this.lookupService.getValues('committee_member_role').subscribe({
      next: (values) => this.committeeRoles.set(values),
    });

    if (this.stage) {
      this.form.patchValue({
        nameEn: this.stage.nameEn,
        nameAr: this.stage.nameAr,
        description: this.stage.description ?? '',
        slaWorkingHours: this.stage.slaWorkingHours,
        isInitial: this.stage.isInitial,
        isFinal: this.stage.isFinal,
        approvalMode: this.stage.approvalMode,
        parallelThreshold: this.stage.parallelThreshold,
        assigneeStrategy: this.stage.assigneeStrategy,
        assigneeRoleId: this.stage.assigneeRoleId,
        assigneeCommitteeRoleValueId: this.stage.assigneeCommitteeRoleValueId,
      });
    }
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.saveError.set(null);

    const raw = this.form.getRawValue();
    const shared = {
      nameEn: raw.nameEn!,
      nameAr: raw.nameAr!,
      ...(raw.description ? { description: raw.description } : {}),
      ...(raw.slaWorkingHours != null ? { slaWorkingHours: raw.slaWorkingHours } : {}),
      isInitial: raw.isInitial!,
      isFinal: raw.isFinal!,
      approvalMode: raw.approvalMode!,
      ...(raw.approvalMode === 'PARALLEL' && raw.parallelThreshold
        ? { parallelThreshold: raw.parallelThreshold }
        : {}),
      assigneeStrategy: raw.assigneeStrategy!,
      ...(raw.assigneeRoleId ? { assigneeRoleId: raw.assigneeRoleId } : {}),
      // On update, an explicit null clears a previously-set filter back to
      // "all active members" — omitting it entirely (like assigneeRoleId
      // above) would leave a prior value untouched instead. On create
      // there's nothing to clear, so it's simply omitted when unset.
      ...(raw.assigneeCommitteeRoleValueId
        ? { assigneeCommitteeRoleValueId: raw.assigneeCommitteeRoleValueId }
        : this.stage && this.stage.assigneeCommitteeRoleValueId
          ? { assigneeCommitteeRoleValueId: null }
          : {}),
    };

    const request$ = this.stage
      ? this.workflowTemplateService.updateStage(
          this.stage.id,
          shared satisfies UpdateWorkflowStageDto,
        )
      : this.workflowTemplateService.addStage(this.templateId, {
          ...shared,
          order: this.nextOrder,
        } satisfies CreateWorkflowStageDto);

    request$.subscribe({
      next: (stage) => {
        this.saving.set(false);
        this.saved.emit(stage);
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, 'Save failed'));
        this.saving.set(false);
      },
    });
  }
}
