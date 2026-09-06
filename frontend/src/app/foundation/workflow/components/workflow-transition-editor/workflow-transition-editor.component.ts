import { Component, Input, Output, EventEmitter, OnInit, OnChanges, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
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

// ACC-55 — hierarchy-mode shape for OverlaySelectComponent:
//   optionGroupChildren="permissions"  optionGroupLabel="module"
//   optionLabel="label"                optionValue="value"
// A node with a non-empty `permissions` array renders as a group header; one
// without renders as a selectable leaf.
interface PermissionNode {
  value: string;
  label?: string;
  module?: string;
  permissions?: PermissionNode[];
}

// Module headings still need a unique value even though they can no longer be
// selected ([groupsSelectable]="false"): @for tracks by
// getOptionValue(flat.node), so 19 headings all resolving to undefined would
// collide on the track key.
//
// toPermissionPayload() also refuses to persist a sentinel. That is now
// defence in depth rather than the primary guard, and it is kept deliberately:
// before ACC-55's live pass the sentinel was the ONLY protection, and it was
// not enough — selecting a heading sent requiredPermission: null, silently
// CLEARING an existing permission and widening who could fire the transition.
// The real fix is that CdkOption now refuses the click and the keyboard; this
// stays so a future template that forgets [groupsSelectable]="false" degrades
// to a no-op instead of quietly stripping a permission gate.
const GROUP_SENTINEL_PREFIX = '__module__:';

// The picker's explicit "no permission required" choice. Distinct from the
// sentinel: this one IS meant to be selected, and persists as null.
const NO_PERMISSION_VALUE = '';

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

          <!--
            ACC-55 — grouped picker replaces the free-text input. 72 strings
            across 19 modules, read from GET /roles/permissions (the real
            source), so a typo can no longer silently create a permanently
            unfireable transition.
          -->
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">{{ 'workflow.requiredPermission' | translate }}</label>
            <app-overlay-select
              formControlName="requiredPermission"
              [options]="permissionGroups()"
              optionLabel="label"
              optionValue="value"
              optionGroupLabel="module"
              optionGroupChildren="permissions"
              [groupsSelectable]="false"
              [placeholder]="'workflow.noPermissionRequired' | translate"
            />
            @if (permissionsLoadFailed()) {
              <small class="text-[var(--am-text-secondary)]">
                {{ 'workflow.permissionListUnavailable' | translate }}
              </small>
            }
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
              (onClick)="onAddDialogVisibleChange(false)"
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
        [visible]="showAddDialog()"
        (visibleChange)="onAddDialogVisibleChange($event)"
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
            <app-overlay-select
              formControlName="requiredPermission"
              [options]="permissionGroups()"
              optionLabel="label"
              optionValue="value"
              optionGroupLabel="module"
              optionGroupChildren="permissions"
              [groupsSelectable]="false"
              [placeholder]="'workflow.noPermissionRequired' | translate"
            />
            @if (permissionsLoadFailed()) {
              <small class="text-[var(--am-text-secondary)]">
                {{ 'workflow.permissionListUnavailable' | translate }}
              </small>
            }
            <!--
              ACC-55 — the warning sits in normal flow directly under the
              field it is about, deliberately NOT in a sticky footer. ACC-54
              tried that on the stage form and it regressed: sticky content
              overlays what scrolls beneath it, so the panel covered the very
              picker it was advising on. Here it pushes content instead.
            -->
            @if (editPermissionWarning(); as warning) {
              <p-message
                severity="warn"
                [text]="
                  (warning === 'UNKNOWN_PERMISSION'
                    ? 'workflow.permissionUnknownWarning'
                    : 'workflow.permissionNoHolderWarning'
                  ) | translate
                "
              />
            }
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
              (onClick)="onEditDialogVisibleChange(false)"
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
        [visible]="showEditDialog()"
        (visibleChange)="onEditDialogVisibleChange($event)"
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
  // ACC-55 — group labels are built inside a computed, outside the template,
  // so TranslatePipe cannot reach them. instant() matches the established
  // precedent in org-unit-head-panel.component.ts.
  private readonly translateService = inject(TranslateService);

  readonly triggerConditions = TRIGGER_CONDITIONS;
  readonly roles = signal<RoleDto[]>([]);

  // ── ACC-55: requiredPermission picker ──────────────────────────────────────
  // 72 permission strings across 19 modules. Flat that is unusable, and
  // OverlaySelectComponent has no filter-search (a known, deliberate gap —
  // CLAUDE.md, ACC-42), so the picker uses hierarchy mode: one group per
  // module, 2-8 options each.
  readonly allPermissions = signal<PermissionDto[]>([]);
  readonly permissionsLoadFailed = signal(false);
  readonly editPermissionWarning = signal<TransitionPermissionWarning | null>(null);

  // A transition may hold a permission that is not in the known list — 45
  // seeded transitions across every tenant legitimately do (capa:investigate,
  // capa:approve, capa:close, incidents:manage: deliberate forward references
  // to unbuilt modules, workflow.seed.ts:66-81), and a typo looks identical.
  // Either way the value MUST survive a round-trip through this dialog: it is
  // shown as a real, selected option in its own group rather than silently
  // dropped, so opening a transition and saving it unchanged cannot rewrite
  // its permission.
  //
  // This is the ONLY way an unknown value can be present. There is
  // deliberately no free-text escape hatch for entering a NEW one, and that
  // asymmetry is the design, not a gap (live-verified, ACC-55 Test 4):
  //   - existing unknown values stay fully editable, via this mechanism;
  //   - new unknown values cannot be created through the UI at all.
  // Allowing free entry and warning afterward would preserve the exact defect
  // this ticket exists to fix, just behind an extra click. And adding a
  // genuinely new forward reference means editing permissions.ts and
  // workflow.seed.ts — not something a tenant admin does in a dialog.
  private readonly extraPermissionValues = signal<string[]>([]);

  readonly permissionGroups = computed<PermissionNode[]>(() => {
    // Establishes the dependency that instant() alone does not. The two
    // labels below are resolved imperatively, so without reading a signal
    // that changes on a language switch this computed would never
    // re-evaluate — leaving "No permission required" and the not-defined
    // heading stuck in the previous language for the rest of the session.
    // TranslateService.currentLang is a real Signal (LanguageService relies
    // on the same fact), so reading it here is enough.
    this.translateService.currentLang();

    // Same Map<string, PermissionDto[]> shape role-permission-matrix already
    // uses, rather than a second grouping idiom for the same data.
    const byModule = new Map<string, PermissionNode[]>();
    for (const perm of this.allPermissions()) {
      const key = `${perm.module}:${perm.action}`;
      const list = byModule.get(perm.module) ?? [];
      list.push({ value: key, label: key });
      byModule.set(perm.module, list);
    }

    const nodes: PermissionNode[] = [
      // Leaf, not a group — no `permissions` array, so it stays selectable
      // and sits at the top where a configurer looks first.
      {
        value: NO_PERMISSION_VALUE,
        label: this.translateService.instant('workflow.noPermissionRequired'),
      },
      ...[...byModule.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([module, permissions]) => ({
          value: `${GROUP_SENTINEL_PREFIX}${module}`,
          module,
          permissions,
        })),
    ];

    // Values with no matching Permission row get their own group, kept last
    // and labelled as not-defined, so the configurer can see the value is
    // unknown without the picker having to guess whether that is a deliberate
    // forward reference or a typo.
    const extras = this.extraPermissionValues();
    if (extras.length > 0) {
      nodes.push({
        value: `${GROUP_SENTINEL_PREFIX}__unknown__`,
        module: this.translateService.instant('workflow.permissionNotDefined'),
        permissions: extras.map((value) => ({ value, label: value })),
      });
    }
    return nodes;
  });

  // ── ACC-55: deferred parent notification ───────────────────────────────────
  // `changed` triggers workflow-stage-list's loadTemplate(), which replaces
  // the stages array. p-table then rebuilds the expanded row's embedded view,
  // DESTROYING this component and recreating it — resetting showEditDialog and
  // editPermissionWarning to their initial values.
  //
  // That is why the warning flashed and vanished on ACC-55's live pass, on
  // both the add and edit paths. The dialog logic was already correct; the
  // component holding it was being torn down underneath. Verified directly:
  // after a reload the component instance identity changes and both signals
  // are back at their defaults.
  //
  // So a save that produced a warning does NOT notify the parent. The refresh
  // is deferred until the dialog actually closes, by which point there is no
  // surface left to destroy. The list is briefly stale while the dialog is
  // open — the correct trade, since the user is looking at the dialog, not the
  // row behind it.
  private readonly refreshPending = signal(false);

  private notifyParent(): void {
    this.refreshPending.set(false);
    this.changed.emit();
  }

  // Both dialogs route their visibility through here rather than binding
  // [(visible)] directly, so EVERY way out — Cancel, the X, Escape, an
  // outside click — flushes a deferred refresh. A pending refresh must not be
  // strandable by any exit path, or the list stays stale until something else
  // happens to reload it.
  onAddDialogVisibleChange(visible: boolean): void {
    this.showAddDialog.set(visible);
    if (!visible) this.onDialogClosed();
  }

  onEditDialogVisibleChange(visible: boolean): void {
    this.showEditDialog.set(visible);
    if (!visible) this.onDialogClosed();
  }

  private onDialogClosed(): void {
    if (!this.refreshPending()) return;
    this.notifyParent();
  }

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
  //
  // Also the guard that makes a module header inert: hierarchy mode renders
  // headers as selectable rows, so a header's sentinel must never reach the
  // API. Treating it as "no permission" is the safe reading — a header is not
  // a permission, and silently persisting '__module__:committees' would
  // create exactly the unfireable transition this ticket exists to prevent.
  private toPermissionPayload(raw: string | null | undefined): string | null {
    if (!raw || raw.trim() === '') return null;
    if (raw.startsWith(GROUP_SENTINEL_PREFIX)) return null;
    return raw;
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

        // The transition already exists by now, so the add dialog cannot stay
        // open — re-submitting would create a second one. On a warning we
        // switch to the EDIT dialog for the record just created (ACC-54's
        // stage form does the same create→edit switch).
        if (result.permissionWarning) {
          this.openEdit(result.transition);
          this.editPermissionWarning.set(result.permissionWarning);
          // Saved, but the parent must not refresh yet — doing so would
          // destroy the dialog we just opened to show this warning.
          this.refreshPending.set(true);
        } else {
          this.notifyParent();
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

        if (!result.permissionWarning) {
          this.showEditDialog.set(false);
          this.notifyParent();
        } else {
          // Dialog stays open so the warning is readable — and crucially the
          // parent is NOT notified yet (see notifyParent()).
          this.editingTransition.set(result.transition);
          this.trackExtraPermission(result.transition.requiredPermission);
          this.refreshPending.set(true);
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
