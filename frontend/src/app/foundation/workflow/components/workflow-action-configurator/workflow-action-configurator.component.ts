import { Component, DestroyRef, EventEmitter, Input, Output, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import {
  WorkflowTemplateService,
  WorkflowTransitionActionDto,
  CreateWorkflowTransitionActionDto,
} from '../../services/workflow-template.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { plainWorkflowRefusalKey } from '../../workflow-refusal';
// ACC-42 Phase 4 — OverlaySelectComponent replaces p-select on this field:
// this component's own dialog renders inside workflow-transition-editor's
// "Configure Actions" p-dialog. See CLAUDE.md's PrimeNG-components-only
// exception note and overlay-select.component.ts for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { StepStripComponent, StepStripItem } from '../../../../shared/components/step-strip/step-strip.component';
import { InputNumberLatinDigits } from '../../../../core/formatting/latin-digits';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';

/**
 * ACC-120 slice 7 — the kinds a person may add. Generate PDF and Lock document
 * belong to modules that do not exist yet, so they are absent (Templates,
 * "Actions when fired"); an existing action of either kind still shows by name.
 */
const ADDABLE_ACTION_TYPES = ['SEND_NOTIFICATION', 'LOG_AUDIT', 'WEBHOOK'] as const;

/** The engine writes the audit row on every transition, whatever isEnabled says. */
const ALWAYS_RUNS = 'LOG_AUDIT';

/**
 * A webhook holds at most this many headers (ACC-120 slice 7). A stored action
 * with more keeps them all: the list scrolls inside its step, nothing is trimmed.
 * The "Up to 5 headers." line says this number in words, in both languages.
 */
export const MAX_WEBHOOK_HEADERS = 5;

/** The controls on step 1, which a Save from step 2 returns to when one is wrong. */
const STEP_ONE_CONTROLS = ['actionType', 'order', 'isEnabled', 'webhookUrl'] as const;

/** The read-only markers a masked read adds (ACC-277); a save never sends them. */
const READ_ONLY_MARKERS = ['headersValueSet', 'signingSecretSet'];

/** One header row: its name, a new value (never a stored one), and whether a value is stored. */
type HeaderRow = FormGroup<{
  name: FormControl<string>;
  value: FormControl<string>;
  /** Stored before this edit: its name is fixed and an empty value keeps the stored one. */
  existing: FormControl<boolean>;
  /** A value is stored for it (from the read's headersValueSet). */
  valueSet: FormControl<boolean>;
}>;

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
    InputTextModule,
    InputNumberModule,
    InputNumberLatinDigits,
    CheckboxModule,
    OverlaySelectComponent,
    EditDialogComponent,
    FieldComponent,
    StepStripComponent,
  ],
  template: `
    <div class="flex flex-col gap-3">

      <div class="flex items-center justify-between">
        <h3 class="font-medium text-sm">{{ 'workflow.actions' | translate }}</h3>
        <!-- ACC-123 — every write is workflows:manage. A protected workflow
             (ACC-120 slice 7) offers no write at all: absent, not disabled. -->
        @if (canWrite()) {
          <p-button
            icon="pi pi-plus"
            size="small"
            [label]="'workflow.addAction' | translate"
            (onClick)="openAdd()"
            data-testid="action-add"
          />
        }
      </div>

      @if (isProtected) {
        <p class="text-meta text-[var(--am-ink-500)]" data-testid="actions-read-only">
          {{ 'workflow.actionsDialog.readOnly' | translate }}
        </p>
      }

      @if (error()) {
        <p class="text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="actions-error">{{ error() | translate }}</p>
      }

      <p-table [value]="actions" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ 'workflow.actionType' | translate }}</th>
            <th>{{ 'workflow.order' | translate }}</th>
            <th>{{ 'workflow.actionsDialog.state' | translate }}</th>
            <th></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-action>
          <tr [attr.data-action-id]="action.id">
            <td>
              <p-tag [value]="actionTypeName(action.actionType)" severity="info" data-testid="action-type" />
            </td>
            <td>{{ action.order }}</td>
            <td data-testid="action-state">
              @if (action.actionType === alwaysRuns) {
                <!-- The engine runs it whatever isEnabled says, so there is no
                     switch to offer. -->
                <span class="text-sm">{{ 'workflow.actionsDialog.alwaysRuns' | translate }}</span>
              } @else if (canWrite()) {
                <div class="flex items-center gap-2">
                  <p-checkbox
                    [ngModel]="shownEnabled(action)"
                    [binary]="true"
                    [ariaLabel]="'workflow.actionsDialog.enabledNamed' | translate: { name: actionTypeName(action.actionType) }"
                    (ngModelChange)="onToggleEnabled(action, $event)"
                    data-testid="action-enabled"
                  />
                  <span class="text-sm" aria-hidden="true">{{ 'workflow.actionEnabled' | translate }}</span>
                </div>
              } @else {
                <span class="text-sm">
                  {{ (action.isEnabled ? 'workflow.actionsDialog.on' : 'workflow.actionsDialog.off') | translate }}
                </span>
              }
            </td>
            <td>
              <div class="flex gap-1 justify-end">
                @if (canWrite()) {
                  <p-button
                    icon="pi pi-pencil"
                    [text]="true"
                    size="small"
                    [pTooltip]="'common.edit' | translate"
                    [ariaLabel]="'workflow.editActionNamed' | translate: { type: actionTypeName(action.actionType) }"
                    (onClick)="openEdit(action)"
                    data-testid="action-edit"
                  />
                  <p-button
                    icon="pi pi-trash"
                    [text]="true"
                    size="small"
                    severity="danger"
                    [pTooltip]="'common.remove' | translate"
                    [ariaLabel]="'workflow.removeActionNamed' | translate: { type: actionTypeName(action.actionType) }"
                    (onClick)="onRemove(action)"
                    data-testid="action-remove"
                  />
                }
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="4" class="text-center py-4 text-[var(--am-ink-500)]">
              {{ 'workflow.noActions' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>

      <ng-template #formTpl>
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4" data-testid="action-form">
          <!-- ACC-120 slice 7 — a webhook is two steps: what the action is, then
               what it sends. Every other kind is this first step alone. -->
          @if (step() === 1) {
            <am-field
              [label]="'workflow.actionType' | translate"
              [control]="form.controls.actionType"
              [forceShowErrors]="showErrors()"
            >
              <!-- No inner input for the wrapper to label: the select names itself. -->
              <app-overlay-select
                formControlName="actionType"
                [options]="typeOptions()"
                optionLabel="label"
                optionValue="value"
                [ariaLabel]="'workflow.actionType' | translate"
              />
            </am-field>

            <!-- ACC-255 PR 4b — compacted (ACC-120): Order and Enabled share a row,
                 and the actions are in the dialog's footer. -->
            <div class="grid grid-cols-2 items-end gap-4">
              <am-field
                [label]="'workflow.order' | translate"
                [control]="form.controls.order"
                inputId="action-order"
                [forceShowErrors]="showErrors()"
              >
                <p-inputNumber
                  formControlName="order"
                  [min]="0"
                  inputId="action-order"
                  styleClass="w-full min-w-0"
                  inputStyleClass="w-full min-w-0"
                />
              </am-field>
              @if (form.controls.actionType.value !== alwaysRuns) {
                <div class="flex items-center gap-2 pb-2">
                  <p-checkbox formControlName="isEnabled" [binary]="true" inputId="action-enabled" />
                  <label for="action-enabled" class="text-sm cursor-pointer">
                    {{ 'workflow.actionEnabled' | translate }}
                  </label>
                </div>
              } @else {
                <span class="text-sm pb-2" data-testid="action-form-always-runs">{{ 'workflow.actionsDialog.alwaysRuns' | translate }}</span>
              }
            </div>

            @if (isWebhook()) {
              <am-field
                [label]="'workflow.webhookUrl' | translate"
                [control]="form.controls.webhookUrl"
                inputId="action-webhook-url"
                [forceShowErrors]="showErrors()"
                [errorMessages]="{ required: 'workflow.actionsDialog.urlRequired' | translate }"
              >
                <input pInputText id="action-webhook-url" formControlName="webhookUrl" dir="ltr" class="w-full" autocomplete="off" />
              </am-field>
            }
          } @else {
            <!-- ACC-277 — values are write-once: a stored value is never sent
                 back here, so its field starts empty and empty keeps it. -->
            <fieldset class="flex flex-col gap-2 min-w-0" data-testid="action-headers">
              <legend class="text-sm font-medium mb-1">{{ 'workflow.actionsDialog.headers' | translate }}</legend>
              @if (headerRows().length) {
                <div class="am-ac-header-grid text-micro text-[var(--am-ink-500)]" aria-hidden="true">
                  <span>{{ 'workflow.actionsDialog.headerName' | translate }}</span>
                  <span>{{ 'workflow.actionsDialog.headerValue' | translate }}</span>
                  <span></span>
                </div>
              }
              <!-- Past the limit (only a stored action can be), every row still
                   shows and the list scrolls inside the step. -->
              <div
                class="am-ac-header-rows"
                [class.am-ac-header-rows--scroll]="headerRows().length > maxHeaders"
                [attr.tabindex]="headerRows().length > maxHeaders ? 0 : null"
                [attr.role]="headerRows().length > maxHeaders ? 'region' : null"
                [attr.aria-label]="headerRows().length > maxHeaders ? ('workflow.actionsDialog.headers' | translate) : null"
                data-testid="action-header-rows"
              >
                @for (row of headerRows(); track row; let i = $index) {
                  <!-- The hint sits right under its field, no gap: with five set headers in
                       Arabic a 4px gap took step 2 to 422px, over the 420px cap. -->
                  <div class="flex flex-col" [formGroup]="row" data-testid="action-header-row">
                    <div class="am-ac-header-grid">
                      @if (row.controls.existing.value) {
                        <span class="text-sm truncate" dir="ltr" data-testid="action-header-name">{{ row.controls.name.value }}</span>
                      } @else {
                        <input
                          pInputText
                          formControlName="name"
                          dir="ltr"
                          autocomplete="off"
                          class="w-full min-w-0"
                          [attr.aria-label]="'workflow.actionsDialog.headerNameNumbered' | translate: { n: i + 1 }"
                          [attr.aria-invalid]="showErrors() && row.controls.name.invalid"
                          data-testid="action-header-name-input"
                        />
                      }
                      <input
                        pInputText
                        type="password"
                        formControlName="value"
                        dir="ltr"
                        autocomplete="off"
                        class="w-full min-w-0"
                        [attr.aria-label]="'workflow.actionsDialog.headerValueFor' | translate: { name: row.controls.name.value || (i + 1) }"
                        [attr.aria-describedby]="row.controls.valueSet.value ? 'action-header-hint-' + i : null"
                        [attr.aria-invalid]="showErrors() && row.controls.value.invalid"
                        data-testid="action-header-value"
                      />
                      <!-- The form opens only for someone who may write; the gate says so here too. -->
                      @if (canWrite()) {
                        <p-button
                          icon="pi pi-times"
                          [text]="true"
                          size="small"
                          severity="secondary"
                          [ariaLabel]="
                            row.controls.name.value
                              ? ('workflow.actionsDialog.removeHeader' | translate: { name: row.controls.name.value })
                              : ('workflow.actionsDialog.removeHeaderUnnamed' | translate)
                          "
                          (onClick)="removeHeader(i)"
                          data-testid="action-header-remove"
                        />
                      }
                    </div>
                    @if (row.controls.valueSet.value) {
                      <span class="text-micro text-[var(--am-ink-500)]" [id]="'action-header-hint-' + i" data-testid="action-header-hint">
                        {{ 'workflow.actionsDialog.valueSetHint' | translate }}
                      </span>
                    }
                    @if (showErrors() && headerError(row); as message) {
                      <span class="text-micro text-[var(--am-danger-ink)]" role="alert">{{ message | translate }}</span>
                    }
                  </div>
                }
              </div>
              @if (headerRows().length < maxHeaders) {
                <div>
                  <p-button
                    icon="pi pi-plus"
                    [text]="true"
                    size="small"
                    [label]="'workflow.actionsDialog.addHeader' | translate"
                    (onClick)="addHeader()"
                    data-testid="action-header-add"
                  />
                </div>
              } @else {
                <p class="text-meta text-[var(--am-ink-500)]" data-testid="action-header-limit">
                  {{ 'workflow.actionsDialog.headerLimit' | translate }}
                </p>
              }
            </fieldset>
          }
        </form>
      </ng-template>
      <ng-template #footerTpl>
        <div class="flex w-full items-center justify-end gap-3">
          @if (saveError()) {
            <p class="me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="action-save-error">{{ saveError() | translate }}</p>
          }
          @if (step() === 2) {
            <p-button
              [label]="'common.back' | translate"
              severity="secondary"
              [text]="true"
              type="button"
              (onClick)="back()"
              [disabled]="saving()"
              data-testid="action-back"
            />
          } @else {
            <!-- Through the shell's close path, so unsaved work asks first. -->
            <p-button
              [label]="'common.cancel' | translate"
              severity="secondary"
              [text]="true"
              type="button"
              (onClick)="formDialog.requestClose()"
              data-testid="action-cancel"
            />
          }
          @if (step() === 1 && isWebhook()) {
            <p-button type="button" [label]="'common.next' | translate" (onClick)="next()" data-testid="action-next" />
          } @else {
            <!-- Never disabled for an invalid form: Save reveals what is missing
                 (Design System artboard 14, rule 5.2). -->
            <p-button
              type="button"
              [label]="(editingAction() ? 'common.save' : 'common.add') | translate"
              [loading]="saving()"
              (onClick)="onSubmit()"
              data-testid="action-save"
            />
          }
        </div>
      </ng-template>
      <ng-template #stepsTpl>
        <am-step-strip [steps]="steps()" [current]="step()" [ariaLabel]="'workflow.actionsDialog.steps' | translate" />
      </ng-template>
      <app-edit-dialog
        #formDialog
        [visible]="showFormDialog()"
        (visibleChange)="showFormDialog.set($event)"
        [header]="(editingAction() ? 'workflow.actionsDialog.editTitle' : 'workflow.addAction') | translate"
        [content]="formTpl"
        [footer]="footerTpl"
        [headerExtra]="stepsTpl"
        [dirty]="formDirty()"
        [saving]="saving()"
        width="520px"
      />

    </div>
  `,
  styles: [
    `
      /* 6px between rows, not 8: five set headers then keep the 20px under the
         420px cap that dialogs here hold to (401px at 8px). */
      .am-ac-header-rows {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-6);
      }
      /* Past the limit (a stored action only): about five rows, then the list
         scrolls inside the step, so the step stays under the 420px cap. */
      .am-ac-header-rows--scroll {
        max-block-size: 300px;
        overflow-y: auto;
        padding-inline-end: var(--am-space-4);
      }
      .am-ac-header-grid {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) 32px;
        gap: var(--am-space-8);
        align-items: center;
      }
    `,
  ],
})
export class WorkflowActionConfiguratorComponent {
  @Input() transitionId!: string;

  /** The transition's actions. A new list (after any save) drops the toggles shown ahead of it. */
  @Input()
  set actions(value: WorkflowTransitionActionDto[]) {
    this._actions = value ?? [];
    this.toggled.set({});
  }
  get actions(): WorkflowTransitionActionDto[] {
    return this._actions;
  }
  private _actions: WorkflowTransitionActionDto[] = [];

  /**
   * ACC-120 slice 7 — a workflow the app sets (the server's PROTECTED_TEMPLATES).
   * Read-only: no add, edit, remove or toggle, and a line saying why.
   */
  @Input() isProtected = false;

  @Output() changed = new EventEmitter<void>();

  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly translate = inject(TranslateService);
  private readonly fb = inject(FormBuilder);
  private readonly amConfirm = inject(AmConfirmService);
  private readonly navigationAccess = inject(NavigationAccessService);

  // ACC-123 — workflows:manage, what every transition-action endpoint carries.
  readonly canManage = computed(() => this.navigationAccess.hasPermission('workflows:manage'));

  /** Whether any write is offered here. Not a computed: isProtected is a plain input. */
  canWrite(): boolean {
    return this.canManage() && !this.isProtected;
  }

  readonly alwaysRuns = ALWAYS_RUNS;
  readonly maxHeaders = MAX_WEBHOOK_HEADERS;

  /**
   * ACC-120 slice 7 — a webhook is two steps: 1, what the action is; 2, the
   * headers it sends. Any other kind is step 1 alone, with Save on it, and the
   * strip draws nothing below two steps.
   */
  readonly step = signal(1);
  readonly showFormDialog = signal(false);
  readonly editingAction = signal<WorkflowTransitionActionDto | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  /** Save was pressed on an invalid form: every error shows. */
  readonly showErrors = signal(false);
  readonly formDirty = signal(false);

  /** A toggle shown ahead of the server's answer, by action id. */
  private readonly toggled = signal<Record<string, boolean>>({});

  readonly form = this.fb.nonNullable.group({
    actionType: ['LOG_AUDIT', [Validators.required]],
    order: [10, [Validators.required, Validators.min(0)]],
    isEnabled: [true],
    webhookUrl: [''],
    headers: this.fb.array<HeaderRow>([]),
  });

  readonly actionType = toSignal(this.form.controls.actionType.valueChanges, {
    initialValue: this.form.controls.actionType.value,
  });

  readonly isWebhook = computed(() => this.actionType() === 'WEBHOOK');

  readonly steps = computed<StepStripItem[]>(() =>
    this.isWebhook()
      ? [
          { n: 1, key: 'workflow.actionsDialog.stepAction' },
          { n: 2, key: 'workflow.actionsDialog.stepHeaders' },
        ]
      : [],
  );

  /** The header rows, as a signal the template can track (a FormArray is not one). */
  readonly headerRows = signal<HeaderRow[]>([]);

  /** The kinds to pick from, by name; an existing action keeps its own kind listed. */
  readonly typeOptions = computed(() => {
    this.translate.currentLang();
    const own = this.editingAction()?.actionType;
    const types: string[] = [...ADDABLE_ACTION_TYPES];
    if (own && !types.includes(own)) types.push(own);
    return types.map((value) => ({ value, label: this.actionTypeName(value) }));
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.form.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => this.formDirty.set(this.form.dirty));
    // The webhook URL is required only for a webhook.
    this.form.controls.actionType.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe((type) => {
      const url = this.form.controls.webhookUrl;
      url.setValidators(type === 'WEBHOOK' ? [Validators.required] : []);
      url.updateValueAndValidity({ emitEvent: false });
    });
  }

  /** The Enabled box as shown: the toggle just made, else the stored state. */
  shownEnabled(action: WorkflowTransitionActionDto): boolean {
    return this.toggled()[action.id] ?? action.isEnabled;
  }

  openAdd(): void {
    this.editingAction.set(null);
    this.resetForm({ actionType: 'LOG_AUDIT', order: 10, isEnabled: true, webhookUrl: '' }, []);
    this.showFormDialog.set(true);
  }

  openEdit(action: WorkflowTransitionActionDto): void {
    this.editingAction.set(action);
    const config = (action.configJson ?? {}) as {
      webhookUrl?: string;
      headers?: Record<string, unknown>;
      headersValueSet?: Record<string, boolean>;
    };
    const valueSet = config.headersValueSet ?? {};
    // Names only: a read never carries a value (ACC-277), and none is refilled.
    const rows = Object.keys(config.headers ?? {}).map((name) => this.headerRow(name, true, valueSet[name] === true));
    this.resetForm(
      { actionType: action.actionType, order: action.order, isEnabled: action.isEnabled, webhookUrl: config.webhookUrl ?? '' },
      rows,
    );
    this.showFormDialog.set(true);
  }

  /** To the headers, once step 1 is right; otherwise its errors show where they are. */
  next(): void {
    if (this.stepOneInvalid()) {
      this.showErrors.set(true);
      return;
    }
    this.step.set(2);
  }

  /** Back to step 1. Every value stays: both steps are one form. */
  back(): void {
    this.step.set(1);
  }

  addHeader(): void {
    if (this.form.controls.headers.length >= MAX_WEBHOOK_HEADERS) return;
    const row = this.headerRow('', false, false);
    this.form.controls.headers.push(row);
    this.headerRows.set([...this.form.controls.headers.controls]);
    this.markChanged();
  }

  removeHeader(index: number): void {
    this.form.controls.headers.removeAt(index);
    this.headerRows.set([...this.form.controls.headers.controls]);
    this.markChanged();
  }

  /** A row's own error: a missing or repeated name, or a new header without a value. */
  headerError(row: HeaderRow): string | null {
    if (row.controls.name.hasError('required')) return 'workflow.actionsDialog.headerNameRequired';
    if (row.hasError('duplicate')) return 'workflow.actionsDialog.headerNameDuplicate';
    if (row.controls.value.hasError('required')) return 'workflow.actionsDialog.headerValueRequired';
    return null;
  }

  onToggleEnabled(action: WorkflowTransitionActionDto, isEnabled: boolean): void {
    this.error.set(null);
    this.toggled.update((t) => ({ ...t, [action.id]: isEnabled }));
    this.workflowTemplateService.updateTransitionAction(action.id, { isEnabled }).subscribe({
      next: () => this.changed.emit(),
      error: (err: unknown) => {
        // Refused: the box goes back to what is stored, and says why.
        this.toggled.update(({ [action.id]: _refused, ...rest }) => rest);
        this.error.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.updateFailed'));
      },
    });
  }

  /**
   * An action type as a person reads it ("Send notification"), never the enum.
   * A type with no translation (one added on the server first) reads
   * "Unknown" rather than the raw key.
   */
  actionTypeName(type: string): string {
    const key = `workflow.actionTypeName.${type}`;
    const name = this.translate.instant(key);
    return name === key ? this.translate.instant('workflow.actionTypeName.unknown') : name;
  }

  onRemove(action: WorkflowTransitionActionDto): void {
    this.amConfirm.ask({
      tone: 'destructive',
      // workflow-template.service.ts removeTransitionAction() deletes the row.
      message: this.translate.instant('workflow.confirmRemoveAction'),
      header: this.translate.instant('workflow.confirmRemoveActionHeader', { type: this.actionTypeName(action.actionType) }),
      acceptLabel: this.translate.instant('confirm.removeAction'),
      accept: () => {
        this.workflowTemplateService.removeTransitionAction(action.id).subscribe({
          next: () => this.changed.emit(),
          error: (err: unknown) =>
            this.error.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.removeFailed')),
        });
      },
    });
  }

  onSubmit(): void {
    // Each row's "same name" rule depends on its siblings, so check them all now.
    this.form.controls.headers.controls.forEach((r) => r.updateValueAndValidity({ emitEvent: false }));
    this.form.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.form.markAllAsTouched();
      // A Save from the headers with something wrong on step 1 goes back to it,
      // rather than refusing on a step that shows nothing wrong.
      if (this.stepOneInvalid()) this.step.set(1);
      return;
    }
    const raw = this.form.getRawValue();
    const configJson = raw.actionType === 'WEBHOOK' ? this.webhookConfig(raw.webhookUrl, raw.headers) : undefined;

    this.saving.set(true);
    this.saveError.set(null);

    const dto: CreateWorkflowTransitionActionDto = {
      actionType: raw.actionType,
      order: raw.order,
      isEnabled: raw.actionType === ALWAYS_RUNS ? true : raw.isEnabled,
      ...(configJson ? { configJson } : {}),
    };

    const editing = this.editingAction();
    const request$ = editing
      ? this.workflowTemplateService.updateTransitionAction(editing.id, dto)
      : this.workflowTemplateService.addTransitionAction(this.transitionId, dto);

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.formDirty.set(false);
        this.showFormDialog.set(false);
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.saveError.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.saveFailed'));
        this.saving.set(false);
      },
    });
  }

  /**
   * The webhook config to send (ACC-277's merge rules): every row by name, a
   * stored header untouched as "" (which keeps its value), a typed value as
   * typed; a removed row is left out, which removes it. Anything else the stored
   * config held is kept, a signing secret as "" (kept), and the read-only
   * markers are never sent.
   */
  private webhookConfig(webhookUrl: string, headers: { name: string; value: string }[]): Record<string, unknown> {
    const stored = { ...((this.editingAction()?.configJson ?? {}) as Record<string, unknown>) };
    for (const marker of READ_ONLY_MARKERS) delete stored[marker];
    if ('signingSecret' in stored) stored['signingSecret'] = '';
    const config: Record<string, unknown> = { ...stored, webhookUrl };
    if (headers.length || 'headers' in stored) {
      config['headers'] = Object.fromEntries(headers.map((h) => [h.name.trim(), h.value]));
    }
    return config;
  }

  private stepOneInvalid(): boolean {
    return STEP_ONE_CONTROLS.some((name) => this.form.controls[name].invalid);
  }

  private headerRow(name: string, existing: boolean, valueSet: boolean): HeaderRow {
    return new FormGroup(
      {
        name: new FormControl(name, { nonNullable: true, validators: existing ? [] : [Validators.required] }),
        // A new header needs a value; a stored one keeps its own when left empty.
        value: new FormControl('', { nonNullable: true, validators: existing ? [] : [Validators.required] }),
        existing: new FormControl(existing, { nonNullable: true }),
        valueSet: new FormControl(valueSet, { nonNullable: true }),
      },
      { validators: (group) => this.uniqueName(group) },
    );
  }

  /** A header name used by another row (names compare as HTTP does, ignoring case). */
  private uniqueName(group: AbstractControl): ValidationErrors | null {
    const name = String(group.get('name')?.value ?? '').trim().toLowerCase();
    if (!name) return null;
    const rows = (group.parent as FormArray<HeaderRow> | null)?.controls ?? [];
    const same = rows.filter((r) => r.controls.name.value.trim().toLowerCase() === name).length;
    return same > 1 ? { duplicate: true } : null;
  }

  private resetForm(values: { actionType: string; order: number; isEnabled: boolean; webhookUrl: string }, rows: HeaderRow[]): void {
    const headers = this.form.controls.headers;
    headers.clear({ emitEvent: false });
    rows.forEach((row) => headers.push(row, { emitEvent: false }));
    this.headerRows.set([...headers.controls]);
    this.form.reset({ ...values, headers: rows.map((r) => r.getRawValue()) });
    this.form.controls.webhookUrl.setValidators(values.actionType === 'WEBHOOK' ? [Validators.required] : []);
    this.form.controls.webhookUrl.updateValueAndValidity({ emitEvent: false });
    this.form.markAsPristine();
    this.formDirty.set(false);
    this.showErrors.set(false);
    this.saveError.set(null);
    this.step.set(1);
  }

  /** Adding or removing a header row is a change, though no field was typed in. */
  private markChanged(): void {
    this.form.markAsDirty();
    // Re-check every row's "same name" rule, which depends on its siblings.
    this.form.controls.headers.controls.forEach((r) => r.updateValueAndValidity({ emitEvent: false }));
    this.form.updateValueAndValidity();
    this.formDirty.set(true);
  }
}
