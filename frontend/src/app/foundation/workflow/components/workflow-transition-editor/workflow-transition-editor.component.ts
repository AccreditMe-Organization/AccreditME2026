import { Component, DestroyRef, Input, Output, EventEmitter, OnInit, OnChanges, TemplateRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
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
import { RadioButtonModule } from 'primeng/radiobutton';
import { MessageModule } from 'primeng/message';
import {
  WorkflowTemplateService,
  WorkflowStageDto,
  WorkflowTransitionDto,
  CreateWorkflowTransitionDto,
  UpdateWorkflowTransitionDto,
  TransitionPermissionWarning,
  WORKFLOW_TRANSITION_KINDS,
  WorkflowTransitionKind,
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
import { LanguageService } from '../../../../core/services/language.service';

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
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
// ACC-208 — literal keys, so the translation-keys spec sees each one.
const KIND_LABEL_KEYS: Record<WorkflowTransitionKind, string> = {
  ADVANCE: 'workflow.kind.advance',
  RETURN: 'workflow.kind.return',
  EXIT: 'workflow.kind.exit',
};
const KIND_HELP_KEYS: Record<WorkflowTransitionKind, string> = {
  ADVANCE: 'workflow.kind.advanceHelp',
  RETURN: 'workflow.kind.returnHelp',
  EXIT: 'workflow.kind.exitHelp',
};

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
    RadioButtonModule,
    MessageModule,
    WorkflowActionConfiguratorComponent,
    OverlaySelectComponent,
    EditDialogComponent,
  ],
  template: `
    <div class="flex flex-col gap-3">

      <div class="flex items-center justify-between">
        <h3 class="font-medium text-sm">{{ 'workflow.transitions' | translate }}</h3>
        <!-- ACC-123 — workflows:manage. The cog beside each row is NOT gated
             here: it opens the action configurator, whose own writes are gated
             inside it, so a viewer may still read how a transition is wired. -->
        @if (canManage()) {
          <p-button
            icon="pi pi-plus"
            size="small"
            [label]="'workflow.addTransition' | translate"
            (onClick)="openAdd()"
          />
        }
      </div>

      @if (error()) {
        <p class="text-red-500 text-sm">{{ error() | translate }}</p>
      }

      <p-table [value]="transitions" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ 'workflow.label' | translate }}</th>
            <th>{{ 'workflow.toStage' | translate }}</th>
            <th>{{ 'workflow.kind.label' | translate }}</th>
            <th>{{ 'workflow.triggerCondition' | translate }}</th>
            <th></th>
            <th></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-transition>
          <tr>
            <td>{{ transitionLabel(transition) }}</td>
            <td>{{ stageName(transition.toStageId) }}</td>
            <td>
              <!-- ACC-208 — Send back is dashed, as returns are in the stage
                   strip; End the record is outlined in danger (drawing). -->
              <span [class]="'am-tr-chip am-tr-chip--' + kindOf(transition).toLowerCase()" data-tr-kind>
                {{ kindLabelKey(transition) | translate }}
              </span>
            </td>
            <td>
              <p-tag [value]="transition.triggerCondition" severity="info" />
              <!-- ACC-82 — which role can fire it. ROLE_BASED alone does not say, and
                   a Setup health stage Fix lands here looking for exactly that. -->
              @if (triggerRoleLabel(transition); as roleLabel) {
                <span class="ms-2 text-sm text-[var(--am-text-primary)]">{{ roleLabel }}</span>
              }
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
                @if (canManage()) {
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
              }
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="text-center py-4 text-[var(--am-text-secondary)]">
              {{ 'workflow.noTransitions' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Add Transition.
           ACC-208 — TWO STEPS, measured (ACC-120). Before Kind existed this
           dialog measured 674 English / 696 Arabic against the 420 cap, and
           Kind adds three radio rows. The seam it already had: step 1 is the
           move itself (where to, what it is called, what kind of move), step 2
           who may fire it and what it checks. The actions moved to the footer.
           Numbers: step-208-stage-tasks-screen.md §4.5. -->
      <ng-template #addFormTpl>
        <form [formGroup]="addForm" (ngSubmit)="onSubmitAdd()" class="flex flex-col gap-4">
          @if (addStep() === 1) {
            <div class="flex flex-col gap-1">
              <label class="font-medium text-sm">{{ 'workflow.toStage' | translate }} <span class="text-red-500">*</span></label>
              <app-overlay-select
                formControlName="toStageId"
                [options]="availableStages"
                optionLabel="nameEn"
                optionValue="id"
              />
            </div>

            <div class="am-tr-pair">
              <div class="flex flex-col gap-1">
                <label class="font-medium text-sm">{{ 'workflow.labelEn' | translate }} <span class="text-red-500">*</span></label>
                <input pInputText formControlName="labelEn" />
              </div>
              <div class="flex flex-col gap-1">
                <label class="font-medium text-sm">{{ 'workflow.labelAr' | translate }}</label>
                <input pInputText dir="rtl" formControlName="labelAr" />
              </div>
            </div>

            <!-- ACC-208 — Kind, first after the labels (drawing). Always starts
                 at Advance and is never inferred from stage order: Reject goes
                 to a higher-order stage and Reactivate to a lower one. -->
            <fieldset class="am-tr-kind">
              <legend class="am-tr-kind__legend">{{ 'workflow.kind.label' | translate }}</legend>
              @for (kind of kinds; track kind.value) {
                <div class="am-tr-kind__row">
                  <p-radiobutton [inputId]="'add-kind-' + kind.value" formControlName="kind" [value]="kind.value" />
                  <label [for]="'add-kind-' + kind.value">
                    <span class="am-tr-kind__title">{{ kind.labelKey | translate }}</span>
                    <span class="am-tr-kind__help">{{ kind.helpKey | translate }}</span>
                  </label>
                </div>
              }
            </fieldset>
          } @else {
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
                [options]="addPermissionGroups()"
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

            <!-- ACC-208 (D5) — no "Approval path" here. Create never sent it
                 (CreateWorkflowTransitionDto has no such field; the builder sets
                 it as a follow-up edit), so ticking it was silently dropped. It
                 stays on Edit, where it saves. -->

            <div class="flex flex-col gap-1">
              <label class="font-medium text-sm">{{ 'workflow.validatorConfig' | translate }}</label>
              <textarea pTextarea rows="3" formControlName="validatorConfig"></textarea>
            </div>
          }
        </form>
      </ng-template>
      <ng-template #addFooterTpl>
        <div class="am-tr-footer">
          @if (saveError()) {
            <span class="am-tr-footer__error" role="alert">{{ saveError()! | translate }}</span>
          } @else {
            <span class="am-tr-footer__step">{{ 'common.stepOf' | translate: { step: addStep(), steps: 2 } }}</span>
          }
          <span class="am-tr-footer__actions">
            @if (addStep() === 1) {
              <p-button
                [label]="'common.cancel' | translate"
                severity="secondary"
                [text]="true"
                (onClick)="onAddDialogVisibleChange(false)"
              />
              <p-button
                [label]="'common.next' | translate"
                [disabled]="addStepOneInvalid()"
                (onClick)="addStep.set(2)"
                data-tr-next
              />
            } @else {
              <p-button
                [label]="'common.back' | translate"
                severity="secondary"
                [text]="true"
                [disabled]="saving()"
                (onClick)="addStep.set(1)"
              />
              <p-button
                [label]="'common.add' | translate"
                [loading]="saving()"
                [disabled]="addForm.invalid"
                (onClick)="onSubmitAdd()"
                data-tr-save
              />
            }
          </span>
        </div>
      </ng-template>
      <app-edit-dialog
        [visible]="showAddDialog()"
        (visibleChange)="onAddDialogVisibleChange($event)"
        [header]="'workflow.addTransition' | translate"
        [content]="addFormTpl"
        [footer]="addFooterTpl"
        width="560px"
      />

      <!-- Edit Transition — the same two steps (measured 542 English / 564
           Arabic before Kind). A save that warns keeps step 2 open on the
           warning (ACC-55). -->
      <ng-template #editFormTpl>
        <form [formGroup]="editForm" (ngSubmit)="onSubmitEdit()" class="flex flex-col gap-4">
          @if (editStep() === 1) {
            <p class="text-sm text-[var(--am-text-secondary)] m-0">
              {{ 'workflow.transitionEndpointsLocked' | translate }}
            </p>

            <div class="am-tr-pair">
              <div class="flex flex-col gap-1">
                <label class="font-medium text-sm">{{ 'workflow.labelEn' | translate }} <span class="text-red-500">*</span></label>
                <input pInputText formControlName="labelEn" />
              </div>
              <div class="flex flex-col gap-1">
                <label class="font-medium text-sm">{{ 'workflow.labelAr' | translate }}</label>
                <input pInputText dir="rtl" formControlName="labelAr" />
              </div>
            </div>

            <!-- ACC-208 — Kind, first after the labels (drawing). Always starts
                 at Advance and is never inferred from stage order: Reject goes
                 to a higher-order stage and Reactivate to a lower one. -->
            <fieldset class="am-tr-kind">
              <legend class="am-tr-kind__legend">{{ 'workflow.kind.label' | translate }}</legend>
              @for (kind of kinds; track kind.value) {
                <div class="am-tr-kind__row">
                  <p-radiobutton [inputId]="'edit-kind-' + kind.value" formControlName="kind" [value]="kind.value" />
                  <label [for]="'edit-kind-' + kind.value">
                    <span class="am-tr-kind__title">{{ kind.labelKey | translate }}</span>
                    <span class="am-tr-kind__help">{{ kind.helpKey | translate }}</span>
                  </label>
                </div>
              }
            </fieldset>
          } @else {
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
                [options]="editPermissionGroups()"
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
          }
        </form>
      </ng-template>
      <ng-template #editFooterTpl>
        <div class="am-tr-footer">
          @if (saveError()) {
            <span class="am-tr-footer__error" role="alert">{{ saveError()! | translate }}</span>
          } @else {
            <span class="am-tr-footer__step">{{ 'common.stepOf' | translate: { step: editStep(), steps: 2 } }}</span>
          }
          <span class="am-tr-footer__actions">
            @if (editStep() === 1) {
              <p-button
                [label]="'common.cancel' | translate"
                severity="secondary"
                [text]="true"
                (onClick)="onEditDialogVisibleChange(false)"
              />
              <p-button
                [label]="'common.next' | translate"
                [disabled]="editStepOneInvalid()"
                (onClick)="editStep.set(2)"
                data-tr-next
              />
            } @else {
              <p-button
                [label]="'common.back' | translate"
                severity="secondary"
                [text]="true"
                [disabled]="saving()"
                (onClick)="editStep.set(1)"
              />
              <p-button
                [label]="'common.save' | translate"
                [loading]="saving()"
                [disabled]="editForm.invalid"
                (onClick)="onSubmitEdit()"
                data-tr-save
              />
            }
          </span>
        </div>
      </ng-template>
      <app-edit-dialog
        [visible]="showEditDialog()"
        (visibleChange)="onEditDialogVisibleChange($event)"
        [header]="'workflow.editTransition' | translate"
        [content]="editFormTpl"
        [footer]="editFooterTpl"
        width="560px"
      />

      <!-- Configure Actions -->
      <p-dialog
        [visible]="showActionsDialog()"
        (visibleChange)="showActionsDialog.set($event)"
        [header]="'workflow.actions' | translate"
        [modal]="true"
        [closeOnEscape]="false"
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
  styles: [
    `
      .am-tr-pair {
        display: flex;
        gap: var(--am-space-12);
      }
      .am-tr-pair > * {
        flex: 1 1 0;
        min-inline-size: 0;
      }
      .am-tr-kind {
        border: 0;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .am-tr-kind__legend {
        padding: 0;
        margin-block-end: var(--am-space-2);
        font-size: var(--am-type-value-size);
        font-weight: 500;
      }
      .am-tr-kind__row {
        display: flex;
        align-items: flex-start;
        gap: var(--am-space-8);
        padding-block: var(--am-space-2);
      }
      .am-tr-kind__row label {
        display: flex;
        flex-direction: column;
        cursor: pointer;
      }
      .am-tr-kind__title {
        font-size: var(--am-type-value-size);
        font-weight: 500;
      }
      .am-tr-kind__help {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
      }
      .am-tr-footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-8);
        inline-size: 100%;
      }
      .am-tr-footer__step {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
      }
      .am-tr-footer__error {
        font-size: var(--am-type-meta-size);
        font-weight: 500;
        color: var(--am-danger-ink);
      }
      .am-tr-footer__actions {
        display: flex;
        gap: var(--am-space-8);
      }
      .am-tr-chip {
        display: inline-flex;
        font-size: var(--am-type-micro-size);
        font-weight: 600;
        border-radius: var(--am-radius-control);
        padding: 0 var(--am-space-6);
        white-space: nowrap;
      }
      .am-tr-chip--advance {
        color: var(--am-primary-700);
        background: var(--am-primary-100);
        border: 1px solid var(--am-primary-100);
      }
      .am-tr-chip--return {
        color: var(--am-ink-700);
        background: var(--am-surface-raised);
        border: 1px dashed var(--am-ink-500);
      }
      .am-tr-chip--exit {
        color: var(--am-danger-ink);
        background: var(--am-surface-raised);
        border: 1px solid var(--am-danger-border);
      }
    `,
  ],
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
  private readonly amConfirm = inject(AmConfirmService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);

  // ACC-123 — workflows:manage, what every transition endpoint carries.
  readonly canManage = computed(() =>
    this.navigationAccess.hasPermission('workflows:manage'),
  );
  // ACC-55 — group labels are built inside a computed, outside the template,
  // so TranslatePipe cannot reach them. instant() matches the established
  // precedent in org-unit-head-panel.component.ts.
  private readonly translateService = inject(TranslateService);

  readonly triggerConditions = TRIGGER_CONDITIONS;
  readonly roles = signal<RoleDto[]>([]);
  private readonly languageService = inject(LanguageService);

  // ACC-82 — the name of the role a ROLE_BASED transition is restricted to,
  // for the table. Role names are tenant data (a custom role's name is typed by
  // an admin), so they are chosen by language, not translated. A triggerRoleId
  // that matches no known role is said plainly rather than hidden: it is
  // exactly the case that leaves a stage unfireable.
  triggerRoleLabel(transition: WorkflowTransitionDto): string | null {
    if (transition.triggerCondition !== 'ROLE_BASED' || !transition.triggerRoleId) return null;
    const role = this.roles().find((r) => r.id === transition.triggerRoleId);
    if (!role) return this.translateService.instant('workflow.triggerRoleUnknown');
    return this.languageService.bilingual(role.nameEn, role.nameAr);
  }

  // ── ACC-55: requiredPermission picker ──────────────────────────────────────
  // 72 permission strings across 19 modules. Flat that is unusable, and
  // OverlaySelectComponent has no filter-search (a known, deliberate gap —
  // CLAUDE.md, ACC-42), so the picker uses hierarchy mode: one group per
  // module, 2-8 options each.
  readonly allPermissions = signal<PermissionDto[]>([]);
  readonly permissionsLoadFailed = signal(false);
  readonly editPermissionWarning = signal<TransitionPermissionWarning | null>(null);

  // WHICH KEYS THE PICKER OFFERS (ACC-120 slice 5, F1 / PR B). Only keys a
  // transition may be GIVEN: ones some code checks today (`inUse`, R2), and
  // inside a tenant no platform key (R1). The server refuses the rest on create
  // and on a changed key, so offering them was offering a refusal.
  //
  // A transition may already HOLD a key outside that list: a key nothing
  // checks yet (the seeded Document, Audit, Incident and Meeting transitions
  // require 38 of them per tenant), or one with no Permission row at all, a
  // forward reference such as capa:approve or a typo. Its OWN current key is
  // therefore shown in the EDIT picker, selected, in a group of its own: "Can't
  // be granted yet" when the catalogue knows the key, "Not a defined
  // permission" when it does not. An unrelated edit sends it back unchanged
  // (F1 keeps an unchanged key), never blanked.
  //
  // ONLY its own key. Before PR B every transition's unknown value was offered
  // in every dialog, which would now let a person pick another transition's
  // ungrantable key and be refused. The ADD picker offers no such key at all.
  //
  // There is still no free-text entry for a NEW unknown value (ACC-55, Test 4):
  // a new forward reference is an edit to permissions.ts and workflow.seed.ts,
  // not something a tenant admin does in a dialog.
  readonly addPermissionGroups = computed<PermissionNode[]>(() => this.permissionNodes(null));
  readonly editPermissionGroups = computed<PermissionNode[]>(() =>
    this.permissionNodes(this.editingTransition()?.requiredPermission ?? null),
  );

  /** A key a transition may be given: in use, and not a platform key inside a tenant. */
  private offerable(p: PermissionDto): boolean {
    if (!p.inUse) return false;
    return !(p.module === 'platform' && !this.navigationAccess.isPlatformOrg());
  }

  private permissionNodes(current: string | null): PermissionNode[] {
    // Establishes the dependency that instant() alone does not. The labels
    // below are resolved imperatively, so without reading a signal that
    // changes on a language switch this would never re-evaluate — leaving "No
    // permission required" and the group headings stuck in the previous
    // language for the rest of the session. TranslateService.currentLang is a
    // real Signal (LanguageService relies on the same fact).
    this.translateService.currentLang();

    // Same Map<string, PermissionDto[]> shape role-permission-matrix already
    // uses, rather than a second grouping idiom for the same data.
    const byModule = new Map<string, PermissionNode[]>();
    for (const perm of this.allPermissions()) {
      if (!this.offerable(perm)) continue;
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

    // The transition's own current key, when it is not one of the offered
    // ones: kept LAST, in its own group, so the configurer sees it is not a
    // key they could choose today.
    const offered = new Set([...byModule.values()].flat().map((n) => n.value));
    if (current && !offered.has(current)) {
      const known = this.allPermissions().some((p) => `${p.module}:${p.action}` === current);
      nodes.push({
        value: `${GROUP_SENTINEL_PREFIX}__current__`,
        module: this.translateService.instant(known ? 'workflow.permissionNotGrantable' : 'workflow.permissionNotDefined'),
        permissions: [{ value: current, label: current }],
      });
    }
    return nodes;
  }

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

  // ACC-208 — the transition's kind, offered in this order with its help line.
  readonly kinds = WORKFLOW_TRANSITION_KINDS.map((value) => ({
    value,
    labelKey: KIND_LABEL_KEYS[value],
    helpKey: KIND_HELP_KEYS[value],
  }));
  readonly addStep = signal(1);
  readonly editStep = signal(1);

  addStepOneInvalid(): boolean {
    const { toStageId, labelEn, labelAr, kind } = this.addForm.controls;
    return toStageId.invalid || labelEn.invalid || labelAr.invalid || kind.invalid;
  }

  editStepOneInvalid(): boolean {
    const { labelEn, labelAr, kind } = this.editForm.controls;
    return labelEn.invalid || labelAr.invalid || kind.invalid;
  }

  /** A transition read before ACC-190's column existed reads as the default. */
  kindOf(transition: WorkflowTransitionDto): WorkflowTransitionKind {
    return transition.kind ?? 'ADVANCE';
  }

  kindLabelKey(transition: WorkflowTransitionDto): string {
    return KIND_LABEL_KEYS[this.kindOf(transition)];
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
    // ACC-160 — the Arabic name is OPTIONAL: Arabic fields are never mandatory,
    // because the product is sold to customers who do not operate in Arabic.
    // maxLength stays. An emptied field is sent as '' and stored as NULL by the
    // DTO's trimToNull, so the empty-to-null decision lives in one place.
    labelAr: ['', [Validators.maxLength(100)]],
    kind: ['ADVANCE' as WorkflowTransitionKind, [Validators.required]],
    triggerCondition: ['ROLE_BASED', [Validators.required]],
    triggerRoleId: [null as string | null],
    requiredPermission: [''],
    validatorConfig: [''],
  });

  readonly editForm = this.fb.group({
    labelEn: ['', [Validators.required, Validators.maxLength(100)]],
    // ACC-160 — the Arabic name is OPTIONAL: Arabic fields are never mandatory,
    // because the product is sold to customers who do not operate in Arabic.
    // maxLength stays. An emptied field is sent as '' and stored as NULL by the
    // DTO's trimToNull, so the empty-to-null decision lives in one place.
    labelAr: ['', [Validators.maxLength(100)]],
    kind: ['ADVANCE' as WorkflowTransitionKind, [Validators.required]],
    triggerCondition: ['ROLE_BASED', [Validators.required]],
    requiredPermission: [''],
    isApprovalPath: [false],
    validatorConfig: [''],
  });

  // ACC-120 slice 10 — the Actions dialog is a raw p-dialog, so it is put on
  // the layer stack here and answers Escape itself (closeOnEscape is off).
  // PrimeNG's own Escape closes a dialog only while it holds the highest
  // z-index, and a tooltip takes that: once Remove action's confirm returned
  // focus to the trash button, its tooltip showed and Escape stopped closing
  // this dialog at all. Registered here, before any confirm opens, so a confirm
  // above it is still the top layer when this runs and only the confirm closes.
  private actionsLayerId: number | null = null;

  constructor() {
    const layers = inject(LayerStackService);
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || this.actionsLayerId === null || !layers.isTop(this.actionsLayerId)) return;
      event.stopPropagation();
      this.showActionsDialog.set(false);
    };
    document.addEventListener('keydown', onKeydown);
    effect(() => {
      if (this.showActionsDialog()) {
        if (this.actionsLayerId === null) this.actionsLayerId = layers.push();
      } else if (this.actionsLayerId !== null) {
        layers.remove(this.actionsLayerId);
        this.actionsLayerId = null;
      }
    });
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', onKeydown);
      if (this.actionsLayerId !== null) layers.remove(this.actionsLayerId);
    });
  }

  ngOnInit(): void {
    this.roleService.listAllRoles().subscribe({ next: (roles) => this.roles.set(roles) });
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

  // ACC-160 (ACC-89 items 1 and 2) — both of these read the English name only,
  // whatever the session's language, even when an Arabic one was stored.
  transitionLabel(transition: WorkflowTransitionDto): string {
    return this.languageService.bilingual(transition.labelEn, transition.labelAr);
  }

  stageName(stageId: string): string {
    const stage = this.availableStages.find((s) => s.id === stageId);
    return stage ? this.languageService.bilingual(stage.nameEn, stage.nameAr) : stageId;
  }

  openAdd(): void {
    this.addForm.reset({
      toStageId: null,
      labelEn: '',
      labelAr: '',
      kind: 'ADVANCE',
      triggerCondition: 'ROLE_BASED',
      triggerRoleId: null,
      requiredPermission: '',
      validatorConfig: '',
    });
    this.saveError.set(null);
    this.addStep.set(1);
    this.showAddDialog.set(true);
  }

  openEdit(transition: WorkflowTransitionDto): void {
    this.editingTransition.set(transition);
    // Before resetting the form: a value the picker does not know about must
    // become a selectable option first, or the control would bind to a value
    // with no matching option and render blank — which then saves back as
    // "cleared", silently destroying a deliberate forward reference.
    this.editForm.reset({
      labelEn: transition.labelEn,
      labelAr: transition.labelAr,
      kind: transition.kind ?? 'ADVANCE',
      triggerCondition: transition.triggerCondition,
      requiredPermission: transition.requiredPermission ?? '',
      isApprovalPath: transition.isApprovalPath,
      validatorConfig: transition.validatorConfig ? JSON.stringify(transition.validatorConfig) : '',
    });
    this.saveError.set(null);
    this.editPermissionWarning.set(null);
    this.editStep.set(1);
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
      kind: raw.kind!,
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
          // The warning sits under the permission picker, on step 2.
          this.editStep.set(2);
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
      kind: raw.kind!,
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
    this.amConfirm.ask({
      tone: 'destructive',
      message: this.translate.instant('workflow.confirmRemoveTransition', { name: transition.labelEn }),
      header: this.translate.instant('common.confirm'),
      acceptLabel: this.translate.instant('confirm.removeTransition'),
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
