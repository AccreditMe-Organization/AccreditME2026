import { Component, Input, Output, EventEmitter, OnInit, OnChanges, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { ConfirmationService } from 'primeng/api';
import {
  WorkflowTemplateService,
  WorkflowStageDto,
  WorkflowTransitionDto,
  CreateWorkflowTransitionDto,
  UpdateWorkflowTransitionDto,
  TransitionPermissionWarning,
} from '../../services/workflow-template.service';
import { RoleService, RoleDto, PermissionDto } from '../../../roles/services/role.service';
import { WorkflowActionConfiguratorComponent } from '../workflow-action-configurator/workflow-action-configurator.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
// ACC-42 Phase 4 — OverlaySelectComponent replaces p-select on these fields:
// raw p-dialog context. See CLAUDE.md's PrimeNG-components-only exception
// note and overlay-select.component.ts for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
// ACC-39 — EditDialogComponent replaces the raw p-dialog + manual @if on
// the Add and Edit Transition dialogs specifically (2 separate migrations,
// not combined — separate FormGroups, separate reset() calls, no shared
// state). The "Configure Actions" dialog below stays a raw p-dialog —
// outside ACC-39's own scope. Add is create-only (architectural
// consistency only); Edit has a genuine edit flow but was already immune
// to ACC-29's bug (editForm.reset() runs imperatively in openEdit(), no
// separate *-form.component.ts involved).
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';

// ACC-55 — hierarchy-mode shape for OverlaySelectComponent: `permissions`
// is the optionGroupChildren field, `module` the optionGroupLabel.
interface PermissionOption {
  value: string;
  label: string;
}

interface PermissionGroup {
  module: string;
  permissions: PermissionOption[];
  // Marks the group holding values with no matching Permission row — either
  // deliberate forward references to unbuilt modules or genuine typos. Its
  // `module` is a translation key rather than a real module name.
  isUnknownGroup?: boolean;
}

const TRIGGER_CONDITIONS = [
  { label: 'SPECIFIC_USER', value: 'SPECIFIC_USER' },
  { label: 'ROLE_BASED', value: 'ROLE_BASED' },
  { label: 'ANY_AUTHENTICATED', value: 'ANY_AUTHENTICATED' },
  { label: 'SYSTEM_AUTOMATIC', value: 'SYSTEM_AUTOMATIC' },
  { label: 'ASSIGNEE_POOL', value: 'ASSIGNEE_POOL' },
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
    CheckboxModule,
    MessageModule,
    WorkflowActionConfiguratorComponent,
    OverlaySelectComponent,
    EditDialogComponent,
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
        <p class="text-red-500 text-sm">{{ error() | translate }}</p>
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
                  [pTooltip]="'common.edit' | translate"
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
            <td colspan="5" class="text-center py-4 text-[var(--am-text-secondary)]">
              {{ 'workflow.noTransitions' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Add Transition -->
      <ng-template #addFormTpl>
        <form [formGroup]="addForm" (ngSubmit)="onSubmitAdd()" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.toStage' | translate }} <span class="text-red-500">*</span></label>
            <app-overlay-select
              formControlName="toStageId"
              [options]="availableStages"
              optionLabel="nameEn"
              optionValue="id"
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
            <app-overlay-select
              formControlName="triggerCondition"
              [options]="triggerConditions"
              optionLabel="label"
              optionValue="value"
            />
          </div>

          @if (addForm.controls.triggerCondition.value === 'ROLE_BASED') {
            <div class="flex flex-col gap-1">
              <label class="font-medium text-sm">{{ 'workflow.assigneeRole' | translate }}</label>
              <app-overlay-select
                formControlName="triggerRoleId"
                [options]="roles()"
                optionLabel="nameEn"
                optionValue="id"
              />
            </div>
          }

          @if (addForm.controls.triggerCondition.value === 'SPECIFIC_USER') {
            <p-message severity="info" [text]="'workflow.userPickerUnavailable' | translate" />
          }

          @if (addForm.controls.triggerCondition.value === 'ASSIGNEE_POOL') {
            <p-message severity="info" [text]="'workflow.assigneePoolHelp' | translate" />
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
            <p class="text-red-500 text-sm">{{ saveError() | translate }}</p>
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
      </ng-template>
      <app-edit-dialog
        [(visible)]="showAddDialog"
        [header]="'workflow.addTransition' | translate"
        [content]="addFormTpl"
        width="560px"
      />

      <!-- Edit Transition -->
      <ng-template #editFormTpl>
        <p class="text-sm text-[var(--am-text-secondary)] mb-2">
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
            <app-overlay-select
              formControlName="triggerCondition"
              [options]="triggerConditions"
              optionLabel="label"
              optionValue="value"
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
            <p class="text-red-500 text-sm">{{ saveError() | translate }}</p>
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
      </ng-template>
      <app-edit-dialog
        [(visible)]="showEditDialog"
        [header]="'workflow.editTransition' | translate"
        [content]="editFormTpl"
        width="560px"
      />

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

  @ViewChild('addFormTpl', { read: TemplateRef, static: true }) addFormTpl!: TemplateRef<unknown>;
  @ViewChild('editFormTpl', { read: TemplateRef, static: true }) editFormTpl!: TemplateRef<unknown>;

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly roleService = inject(RoleService);
  private readonly fb = inject(FormBuilder);
  private readonly confirmationService = inject(ConfirmationService);

  readonly triggerConditions = TRIGGER_CONDITIONS;
  readonly roles = signal<RoleDto[]>([]);

  // ── ACC-55: requiredPermission picker ──────────────────────────────────────
  // 72 permission strings across 19 modules. Flat that is unusable, and
  // OverlaySelectComponent has no filter-search (a known, deliberate gap —
  // CLAUDE.md, ACC-42), so the picker uses hierarchy mode: one group per
  // module, 2-8 options each.
  readonly allPermissions = signal<PermissionDto[]>([]);
  readonly permissionsLoadFailed = signal(false);
  readonly addPermissionWarning = signal<TransitionPermissionWarning | null>(null);
  readonly editPermissionWarning = signal<TransitionPermissionWarning | null>(null);

  // A transition may hold a permission that is not in the known list — 45
  // seeded transitions across every tenant legitimately do (capa:investigate,
  // capa:approve, capa:close, incidents:manage: deliberate forward references
  // to unbuilt modules, workflow.seed.ts:66-81), and a typo looks identical.
  // Either way the value MUST survive a round-trip through this dialog: it is
  // shown as a real, selected option in its own group rather than silently
  // dropped, so opening a transition and saving it unchanged cannot rewrite
  // its permission.
  private readonly extraPermissionValues = signal<string[]>([]);

  readonly permissionGroups = computed<PermissionGroup[]>(() => {
    // Same Map<string, PermissionDto[]> shape role-permission-matrix already
    // uses, rather than a second grouping idiom for the same data.
    const byModule = new Map<string, PermissionOption[]>();
    for (const perm of this.allPermissions()) {
      const key = `${perm.module}:${perm.action}`;
      const list = byModule.get(perm.module) ?? [];
      list.push({ value: key, label: key });
      byModule.set(perm.module, list);
    }

    const groups: PermissionGroup[] = [...byModule.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, permissions]) => ({ module, permissions }));

    // Unknown values get their own group, kept last and labelled, so the
    // configurer can see the value is not a defined permission without the
    // picker having to guess whether it is a typo or a forward reference.
    const extras = this.extraPermissionValues();
    if (extras.length > 0) {
      groups.push({
        module: 'workflow.permissionNotDefined',
        isUnknownGroup: true,
        permissions: extras.map((value) => ({ value, label: value })),
      });
    }
    return groups;
  });

  // Registers a value so it round-trips even when it is not a known
  // permission. No-op for a value already in the known list.
  private trackExtraPermission(value: string | null): void {
    if (!value) return;
    const known = this.allPermissions().some((p) => `${p.module}:${p.action}` === value);
    if (known) return;
    if (this.extraPermissionValues().includes(value)) return;
    this.extraPermissionValues.update((v) => [...v, value]);
  }

  // The form control holds '' for "no permission required"; the API needs
  // null to actually CLEAR it (undefined means "leave unchanged" — see the
  // clearing fix commit). Keeping the control on '' avoids null-vs-empty
  // churn in the template.
  private toPermissionPayload(raw: string | null | undefined): string | null {
    return raw && raw.trim() !== '' ? raw : null;
  }

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
    this.loadPermissions();
  }

  // Reuses RoleService.listAllPermissions() (GET /roles/permissions), the
  // same call role-permission-matrix makes — the real source, not a
  // hardcoded duplicate of permissions.ts.
  //
  // On failure the picker degrades to accepting whatever is already there
  // rather than showing an empty list that looks like "no permissions
  // exist". The endpoint requires roles:view while this screen requires
  // workflows:manage; every real role holds both today, but a
  // workflows-only role would 403 here (recorded as a known limitation).
  private loadPermissions(): void {
    this.roleService.listAllPermissions().subscribe({
      next: (permissions) => {
        this.allPermissions.set(permissions);
        this.permissionsLoadFailed.set(false);
        // Re-register every value already in use: this runs after the parent
        // has supplied `transitions`, so a forward reference like
        // capa:approve becomes selectable rather than being dropped the
        // first time its dialog opens.
        for (const t of this.transitions) this.trackExtraPermission(t.requiredPermission);
      },
      error: () => {
        this.allPermissions.set([]);
        this.permissionsLoadFailed.set(true);
      },
    });
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
    this.addPermissionWarning.set(null);
    this.showAddDialog.set(true);
  }

  openEdit(transition: WorkflowTransitionDto): void {
    this.editingTransition.set(transition);
    // Before resetting the form: a value the picker does not know about must
    // become a selectable option first, or the control would bind to a value
    // with no matching option and render blank — which then saves back as
    // "cleared", silently destroying a deliberate forward reference.
    this.trackExtraPermission(transition.requiredPermission);
    this.editForm.reset({
      labelEn: transition.labelEn,
      labelAr: transition.labelAr,
      triggerCondition: transition.triggerCondition,
      requiredPermission: transition.requiredPermission ?? '',
      isApprovalPath: transition.isApprovalPath,
      validatorConfig: transition.validatorConfig ? JSON.stringify(transition.validatorConfig) : '',
    });
    this.saveError.set(null);
    this.editPermissionWarning.set(null);
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
      // Omitted entirely when blank — on CREATE the column defaults to null,
      // so there is nothing to clear and sending null would be noise.
      ...(this.toPermissionPayload(raw.requiredPermission)
        ? { requiredPermission: this.toPermissionPayload(raw.requiredPermission)! }
        : {}),
      ...(raw.triggerCondition === 'ROLE_BASED' && raw.triggerRoleId
        ? { triggerRoleId: raw.triggerRoleId }
        : {}),
      ...(validatorConfig ? { validatorConfig } : {}),
    };

    this.workflowTemplateService.addTransition(dto).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.showAddDialog.set(false);
        this.changed.emit();

        // ACC-43/ACC-54 pattern: a warning must stay readable, so the dialog
        // does not simply close — but it cannot stay on the ADD dialog
        // either. The transition already exists by now; re-submitting would
        // create a second one. So switch to the EDIT dialog for the record
        // just created, exactly as ACC-54's stage form switches create→edit
        // rather than holding the create dialog open.
        if (result.permissionWarning) {
          this.openEdit(result.transition);
          this.editPermissionWarning.set(result.permissionWarning);
        }
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, 'Save failed'));
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
      // null, not undefined — the picker's "no permission required" option
      // must actually CLEAR the field. `|| undefined` meant "leave
      // unchanged", so clearing was impossible (fixed alongside ACC-55).
      requiredPermission: this.toPermissionPayload(raw.requiredPermission),
      isApprovalPath: raw.isApprovalPath!,
      ...(validatorConfig ? { validatorConfig } : {}),
    };

    this.workflowTemplateService.updateTransition(transition.id, dto).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.editPermissionWarning.set(result.permissionWarning);
        this.changed.emit();

        // Warning keeps the dialog open so it is readable; the edit dialog
        // is already the right place to stay, so unlike the add path there
        // is no mode switch to make. Re-submitting is idempotent here.
        if (!result.permissionWarning) {
          this.showEditDialog.set(false);
        } else {
          this.editingTransition.set(result.transition);
          this.trackExtraPermission(result.transition.requiredPermission);
        }
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, 'Save failed'));
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
          error: (err: unknown) =>
            this.error.set(extractErrorMessage(err, 'Remove failed')),
        });
      },
    });
  }
}
