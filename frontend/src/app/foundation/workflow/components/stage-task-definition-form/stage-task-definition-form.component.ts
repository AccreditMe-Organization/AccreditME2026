import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { CheckboxModule } from 'primeng/checkbox';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import {
  TaskAssigneePickerComponent,
  createAssignGroup,
} from '../../../tasks/components/task-assignee-picker/task-assignee-picker.component';
import { CommitteeRoleCatalogueDto, TaskService } from '../../../tasks/services/task.service';
import { CommitteeService } from '../../../committees/services/committee.service';
import { OrgPositionService } from '../../../org-position/services/org-position.service';
import {
  StageTaskAssignKind,
  StageTaskDefinitionDto,
  StageTaskDefinitionSavedDto,
  StageTaskDefinitionWriteDto,
  TaskPriority,
  WorkflowStageDto,
  WorkflowTemplateDto,
  WorkflowTemplateService,
} from '../../services/workflow-template.service';
import { dueAfterStageDeadline, plainWorkflowRefusalKey } from '../../workflow-refusal';

const PRIORITIES: readonly TaskPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// Literal keys, so the translation-keys spec sees each one.
const PRIORITY_KEYS: Record<TaskPriority, string> = {
  LOW: 'task.priority.low',
  MEDIUM: 'task.priority.medium',
  HIGH: 'task.priority.high',
  CRITICAL: 'task.priority.critical',
};
const ROUTE_KEYS: Record<StageTaskAssignKind, string> = {
  POSITION: 'workflow.stageTaskForm.routeUnit',
  RECORD_UNIT_POSITION: 'workflow.stageTaskForm.routeRecordUnit',
  COMMITTEE_ROLE: 'workflow.stageTaskForm.routeCommittee',
  RECORD_COMMITTEE_ROLE: 'workflow.stageTaskForm.routeRecordCommittee',
};

interface Option {
  value: string;
  label: string;
  meta?: string;
}

/**
 * ACC-208 — add and edit a stage's task definition, in two steps (drawing
 * section 2). Hosted by StageTaskListComponent in an EditDialogComponent; the
 * host's footer drives Next, Back and Save through `ready`, as position-form's
 * host does.
 *
 * ## Why two steps — measured, not chosen (ACC-120)
 *
 * The drawing measured one step at 730px English and 778px Arabic against the
 * 420 cap. Compaction cannot close a gap of 300px; the form already had a seam:
 * step 1 is the task itself (what), step 2 the two fields that produce a due
 * time and a person (when and who). The live measurements are recorded in
 * step-208-stage-tasks-screen.md §4.2.
 *
 * ## The deadline rule is shown before Save, and Save stays enabled
 *
 * A priority whose due time passes the stage's deadline is an error on the
 * Priority field the moment it is chosen, naming both numbers and the way out.
 * Save is never disabled for it (a disabled button says nothing): pressing it
 * focuses Priority and repeats the message in a polite live region. The
 * server's 409 lands on the same field with the server's numbers, which win
 * if the tenant's task SLA changed since the template was read.
 *
 * ## The assignment
 *
 * "A unit you choose" IS the task picker (ACC-167), in its stage-task wording.
 * The other three are one or two selects each. The record-relative routes are
 * offered only where the template says its record type has them (B2), and a
 * route whose list needs a permission the viewer lacks is left out with a
 * note. ROLE is never an option.
 */
@Component({
  selector: 'app-stage-task-definition-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    TextareaModule,
    RadioButtonModule,
    CheckboxModule,
    FieldComponent,
    OverlaySelectComponent,
    TaskAssigneePickerComponent,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="am-std-form" novalidate>
      @if (step() === 1) {
        <div class="am-std-form__pair">
          <am-field
            [label]="'workflow.stageTaskForm.titleEn' | translate"
            [control]="form.controls.titleEn"
            inputId="titleEn"
            [forceShowErrors]="showErrors()"
            [errorMessages]="fieldErrors()"
          >
            <input pInputText id="titleEn" class="w-full" formControlName="titleEn" />
          </am-field>
          <am-field
            [label]="'workflow.stageTaskForm.titleAr' | translate"
            [control]="form.controls.titleAr"
            inputId="titleAr"
            [forceShowErrors]="showErrors()"
            [errorMessages]="fieldErrors()"
          >
            <input pInputText id="titleAr" class="w-full" formControlName="titleAr" dir="rtl" />
          </am-field>
        </div>

        <!-- message="none": the description can produce no message. Optional,
             and the 2000-character limit is the textarea's own maxlength, so it
             cannot be exceeded by typing. That frees its slot, which step 1
             needs: with it, Arabic measured 410 against the 420 cap. -->
        <am-field
          [label]="'workflow.stageTaskForm.description' | translate"
          [control]="form.controls.description"
          inputId="description"
          message="none"
        >
          <textarea pTextarea id="description" class="w-full" rows="3" maxlength="2000" formControlName="description"></textarea>
        </am-field>

        <fieldset class="am-std-form__radios">
          <legend class="am-std-form__legend">{{ 'workflow.stageTaskForm.blocks' | translate }}</legend>
          <div class="am-std-form__radio">
            <p-radiobutton inputId="std-mandatory" formControlName="isMandatory" [value]="true" />
            <label for="std-mandatory">
              <span class="am-std-form__radio-title">{{ 'workflow.stageTasks.mandatory' | translate }}</span>
              <span class="am-std-form__radio-help">{{ 'workflow.stageTaskForm.mandatoryHelp' | translate }}</span>
            </label>
          </div>
          <div class="am-std-form__radio">
            <p-radiobutton inputId="std-optional" formControlName="isMandatory" [value]="false" />
            <label for="std-optional">
              <span class="am-std-form__radio-title">{{ 'workflow.stageTasks.optional' | translate }}</span>
              <span class="am-std-form__radio-help">{{ 'workflow.stageTaskForm.optionalHelp' | translate }}</span>
            </label>
          </div>
        </fieldset>

        <div class="am-std-form__check">
          <p-checkbox inputId="std-evidence" formControlName="requiresEvidence" [binary]="true" />
          <label for="std-evidence">{{ 'workflow.stageTaskForm.evidence' | translate }}</label>
        </div>
      }

      @if (step() === 2) {
        <am-field
          [label]="'task.priority.title' | translate"
          [control]="form.controls.priority"
          inputId="priority"
          [hint]="priorityHint()"
          [forceShowErrors]="showErrors() || deadlineBroken()"
          [errorMessages]="priorityErrors()"
        >
          <app-overlay-select
            formControlName="priority"
            [options]="priorityOptions()"
            optionLabel="label"
            optionValue="value"
            [placeholder]="'task.priority.title' | translate"
          />
        </am-field>

        <am-field
          [label]="'workflow.stageTaskForm.assignedThrough' | translate"
          [control]="form.controls.assignKind"
          inputId="assignKind"
          [hint]="routeHint()"
          [forceShowErrors]="showErrors()"
          [errorMessages]="fieldErrors()"
        >
          <app-overlay-select
            formControlName="assignKind"
            [options]="routeOptions()"
            optionLabel="label"
            optionValue="value"
            [placeholder]="'workflow.stageTaskForm.chooseRoute' | translate"
          />
        </am-field>

        @switch (assignKind()) {
          @case ('POSITION') {
            <app-task-assignee-picker
              [group]="form.controls.assign"
              purpose="stage-task"
              [required]="true"
              [forceShowErrors]="showErrors()"
            />
          }
          @case ('RECORD_UNIT_POSITION') {
            <am-field
              [label]="'task.assign.position' | translate"
              [control]="form.controls.recordPositionId"
              inputId="recordPositionId"
              [hint]="'workflow.stageTaskForm.recordUnitHelp' | translate"
              [loading]="positionsLoading()"
              [forceShowErrors]="showErrors()"
              [errorMessages]="fieldErrors()"
            >
              <app-overlay-select
                formControlName="recordPositionId"
                [options]="positionOptions()"
                optionLabel="label"
                optionValue="value"
                [placeholder]="'task.assign.choosePosition' | translate"
              />
            </am-field>
          }
          @case ('COMMITTEE_ROLE') {
            <div class="am-std-form__pair">
              <am-field
                [label]="'workflow.stageTaskForm.committee' | translate"
                [control]="form.controls.committeeId"
                inputId="committeeId"
                [loading]="committeesLoading()"
                [forceShowErrors]="showErrors()"
                [errorMessages]="fieldErrors()"
              >
                <app-overlay-select
                  formControlName="committeeId"
                  [options]="committeeOptions()"
                  optionLabel="label"
                  optionValue="value"
                  [placeholder]="'workflow.stageTaskForm.chooseCommittee' | translate"
                />
              </am-field>
              <am-field
                [label]="'workflow.stageTaskForm.committeeRole' | translate"
                [control]="form.controls.committeeRoleValueId"
                inputId="committeeRoleValueId"
                [loading]="rolesLoading()"
                [forceShowErrors]="showErrors()"
                [errorMessages]="fieldErrors()"
              >
                <app-overlay-select
                  formControlName="committeeRoleValueId"
                  [options]="roleOptions()"
                  optionLabel="label"
                  optionValue="value"
                  [itemTemplate]="metaItem"
                  [placeholder]="
                    (committeeId() ? 'task.assign.chooseRole' : 'workflow.stageTaskForm.chooseCommitteeFirst') | translate
                  "
                />
              </am-field>
            </div>
          }
          @case ('RECORD_COMMITTEE_ROLE') {
            <am-field
              [label]="'workflow.stageTaskForm.committeeRole' | translate"
              [control]="form.controls.committeeRoleValueId"
              inputId="committeeRoleValueId"
              [hint]="'workflow.stageTaskForm.recordCommitteeHelp' | translate"
              [loading]="rolesLoading()"
              [forceShowErrors]="showErrors()"
              [errorMessages]="fieldErrors()"
            >
              <app-overlay-select
                formControlName="committeeRoleValueId"
                [options]="roleOptions()"
                optionLabel="label"
                optionValue="value"
                [placeholder]="'task.assign.chooseRole' | translate"
              />
            </am-field>
          }
        }
      }
    </form>
    <!-- Outside the form's column, so it takes no row and no gap in the body
         this dialog measures against the 420 cap. -->
    <p class="sr-only" aria-live="polite" data-std-announcement>{{ announcement() }}</p>

    <ng-template #metaItem let-option>
      <span class="flex flex-col">
        <span>{{ option.label }}</span>
        @if (option.meta) {
          <span class="text-meta text-[var(--am-ink-500)]">{{ option.meta }}</span>
        }
      </span>
    </ng-template>
  `,
  styles: [
    `
      .am-std-form {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-12);
      }
      .am-std-form__pair {
        display: flex;
        gap: var(--am-space-12);
      }
      .am-std-form__pair > * {
        flex: 1 1 0;
        min-inline-size: 0;
      }
      .am-std-form__radios {
        border: 0;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .am-std-form__legend {
        padding: 0;
        margin-block-end: var(--am-space-2);
        font-size: var(--am-type-meta-size);
        font-weight: 500;
        color: var(--am-ink-700);
      }
      .am-std-form__radio {
        display: flex;
        align-items: flex-start;
        gap: var(--am-space-8);
        padding-block: var(--am-space-2);
      }
      .am-std-form__radio label {
        display: flex;
        flex-direction: column;
        cursor: pointer;
      }
      .am-std-form__radio-title {
        font-size: var(--am-type-value-size);
        font-weight: 500;
      }
      .am-std-form__radio-help {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
      }
      .am-std-form__check {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        font-size: var(--am-type-value-size);
        font-weight: 500;
      }
    `,
  ],
})
export class StageTaskDefinitionFormComponent implements OnInit {
  private readonly templates = inject(WorkflowTemplateService);
  private readonly tasks = inject(TaskService);
  private readonly committees = inject(CommitteeService);
  private readonly positions = inject(OrgPositionService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);
  private readonly access = inject(NavigationAccessService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  /** The definition being edited; null to add one. */
  readonly definition = input<StageTaskDefinitionDto | null>(null);
  readonly stage = input.required<WorkflowStageDto>();
  readonly template = input.required<WorkflowTemplateDto>();

  readonly saved = output<StageTaskDefinitionSavedDto>();
  readonly ready = output<StageTaskDefinitionFormComponent>();
  readonly dirtyChange = output<boolean>();

  readonly form = new FormGroup({
    titleEn: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(255)] }),
    titleAr: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(255)] }),
    // No validator: maxlength on the textarea is the limit (see the template).
    description: new FormControl('', { nonNullable: true }),
    isMandatory: new FormControl(true, { nonNullable: true }),
    requiresEvidence: new FormControl(false, { nonNullable: true }),
    priority: new FormControl<TaskPriority | null>(null, [Validators.required, (c) => this.withinDeadline(c)]),
    assignKind: new FormControl<StageTaskAssignKind | null>(null, [Validators.required]),
    // One control set per route; only the chosen route's are enabled, so only
    // they count toward validity.
    assign: createAssignGroup(true),
    recordPositionId: new FormControl<string | null>(null, [Validators.required]),
    committeeId: new FormControl<string | null>(null, [Validators.required]),
    committeeRoleValueId: new FormControl<string | null>(null, [Validators.required]),
  });

  readonly step = signal(1);
  readonly steps = 2;
  readonly saving = signal(false);
  readonly showErrors = signal(false);
  /** A refusal that has no field: shown in the footer, beside the actions. */
  readonly saveError = signal<string | null>(null);
  readonly announcement = signal('');
  /**
   * The ACC-55 warning after a save: the dialog stays open on it. Shown in the
   * footer's status slot, not the body — inside the body it took step 2 past
   * the 420 cap (422 English, 436 Arabic, measured).
   */
  readonly savedWarning = signal<string | null>(null);

  readonly priority = signal<TaskPriority | null>(null);
  readonly assignKind = signal<StageTaskAssignKind | null>(null);
  readonly committeeId = signal<string | null>(null);
  /** The server's numbers, when its 409 disagreed with the template read here. */
  private readonly serverDeadline = signal<{ taskHours: number; stageHours: number; priority: TaskPriority } | null>(null);

  private readonly positionList = signal<Option[]>([]);
  private readonly committeeList = signal<Option[]>([]);
  private readonly roleList = signal<CommitteeRoleCatalogueDto[]>([]);
  readonly positionsLoading = signal(false);
  readonly committeesLoading = signal(false);
  readonly rolesLoading = signal(false);

  readonly canAdvance = computed(() => this.step() === 1);
  readonly canGoBack = computed(() => this.step() === 2);

  readonly fieldErrors = computed(() => {
    this.translate.currentLang();
    return { required: this.translate.instant('validation.required') };
  });

  private readonly dueHours = computed(() => this.template().taskDueHours ?? { LOW: 80, MEDIUM: 40, HIGH: 16, CRITICAL: 4 });
  private readonly hours = (n: number) => this.format.count('workflow.workingHours', n);
  private readonly priorityLabel = (p: TaskPriority) => this.translate.instant(PRIORITY_KEYS[p]);

  /** "High · due in 16 working hours" — the due time beside its priority (drawing). */
  readonly priorityOptions = computed<Option[]>(() => {
    this.translate.currentLang();
    const hours = this.dueHours();
    return PRIORITIES.map((p) => ({
      value: p,
      label: `${this.priorityLabel(p)} · ${this.translate.instant('workflow.stageTaskForm.priorityDue', { due: this.hours(hours[p]) })}`,
    }));
  });

  /** The numbers behind a broken deadline rule for the current priority, or null while it holds. */
  private readonly deadlineNumbers = computed(() => this.brokenDeadline(this.priority()));

  readonly deadlineBroken = computed(() => this.deadlineNumbers() !== null);

  readonly priorityErrors = computed(() => {
    this.translate.currentLang();
    const broken = this.deadlineNumbers();
    return {
      required: this.translate.instant('validation.required'),
      stageDeadline: broken
        ? this.translate.instant('workflow.stageTaskForm.priorityTooLong', {
            priority: this.priorityLabel(broken.priority),
            due: this.hours(broken.taskHours),
            deadline: broken.stageHours,
            needed: this.hours(broken.taskHours),
          })
        : '',
    };
  });

  readonly priorityHint = computed(() => {
    this.translate.currentLang();
    const deadline = this.stage().slaWorkingHours;
    return deadline === null
      ? this.translate.instant('workflow.stageTaskForm.priorityNoDeadline')
      : this.translate.instant('workflow.stageTaskForm.priorityWithin', { deadline });
  });

  private readonly canSeeCommittees = computed(() => this.access.hasPermission('committees:view'));
  private readonly canSeePositions = computed(() => this.access.hasPermission('org:view'));

  /** The routes this viewer and this record type can use. ROLE is never one. */
  private readonly routes = computed<StageTaskAssignKind[]>(() => {
    const record = this.template().recordRoutes ?? { unit: false, committee: false };
    const committees = this.canSeeCommittees();
    return [
      'POSITION' as const,
      ...(record.unit && this.canSeePositions() ? (['RECORD_UNIT_POSITION'] as const) : []),
      ...(committees ? (['COMMITTEE_ROLE'] as const) : []),
      ...(record.committee && committees ? (['RECORD_COMMITTEE_ROLE'] as const) : []),
    ];
  });

  readonly routeOptions = computed<Option[]>(() => {
    this.translate.currentLang();
    return this.routes().map((r) => ({ value: r, label: this.translate.instant(ROUTE_KEYS[r]) }));
  });

  /** Says why a route is missing, when one is: the record type, or a permission. */
  readonly routeHint = computed(() => {
    this.translate.currentLang();
    const record = this.template().recordRoutes ?? { unit: false, committee: false };
    if (!record.unit && !record.committee) return this.translate.instant('workflow.stageTaskForm.noRelativeRoutes');
    if (!this.canSeeCommittees()) return this.translate.instant('workflow.stageTaskForm.committeesUnavailable');
    if (record.unit && !this.canSeePositions()) return this.translate.instant('workflow.stageTaskForm.positionsUnavailable');
    return '';
  });

  readonly positionOptions = computed(() => this.positionList());
  readonly committeeOptions = computed(() => this.committeeList());
  readonly roleOptions = computed<Option[]>(() =>
    this.roleList().map((r) => ({
      value: r.id,
      label: this.language.bilingual(r.labelEn, r.labelAr),
      meta: r.memberCount === null ? '' : this.format.count('committee.members', r.memberCount),
    })),
  );

  /** The header's second line: where the task lives, then what it is. */
  readonly context = computed(() => {
    this.translate.currentLang();
    if (this.step() === 1) {
      return `${this.language.bilingual(this.template().nameEn, this.template().nameAr)} · ${this.language.bilingual(this.stage().nameEn, this.stage().nameAr)}`;
    }
    const { titleEn, titleAr, isMandatory } = this.form.getRawValue();
    const title = this.language.bilingual(titleEn, titleAr || null);
    const kind = this.translate.instant(isMandatory ? 'workflow.stageTasks.mandatory' : 'workflow.stageTasks.optional');
    return `${title} · ${kind}`;
  });

  readonly stepLabel = computed(() => {
    this.translate.currentLang();
    return this.translate.instant('workflow.stageTaskForm.stepOf', { step: this.step(), steps: this.steps });
  });

  ngOnInit(): void {
    const current = this.definition();
    if (current) {
      this.form.patchValue({
        titleEn: current.titleEn,
        titleAr: current.titleAr ?? '',
        description: current.description ?? '',
        isMandatory: current.isMandatory,
        requiresEvidence: current.requiresEvidence,
        priority: current.priority,
        assignKind: current.assignKind,
        recordPositionId: current.assignKind === 'RECORD_UNIT_POSITION' ? current.positionId : null,
        committeeId: current.assignKind === 'COMMITTEE_ROLE' ? current.committeeId : null,
        committeeRoleValueId: current.committeeRoleValueId,
      });
      if (current.assignKind === 'POSITION') {
        this.form.controls.assign.setValue({ scope: current.orgUnitId, target: current.positionId, userId: current.userId });
      }
    }

    const { priority, assignKind, committeeId } = this.form.controls;
    priority.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.priority.set(value);
      this.serverDeadline.set(null);
    });
    assignKind.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((kind) => this.onRouteChange(kind));
    committeeId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((id) => {
      this.committeeId.set(id);
      this.form.controls.committeeRoleValueId.setValue(null);
      this.loadRoles(id ?? undefined);
    });
    this.priority.set(priority.value);
    this.onRouteChange(assignKind.value, true);

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.dirtyChange.emit(this.form.dirty);
      this.saveError.set(null);
    });
    this.ready.emit(this);
  }

  next(): void {
    if (this.stepOneInvalid()) {
      this.reveal();
      return;
    }
    this.showErrors.set(false);
    this.step.set(2);
  }

  back(): void {
    this.step.set(1);
  }

  onSubmit(): void {
    if (this.stepOneInvalid()) {
      this.step.set(1);
      this.reveal();
      return;
    }
    if (this.form.invalid) {
      this.step.set(2);
      this.reveal();
      if (this.deadlineBroken()) this.announcement.set(this.priorityErrors().stageDeadline);
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    const current = this.definition();
    const request = current
      ? this.templates.updateStageTaskDefinition(current.id, this.toDto())
      : this.templates.addStageTaskDefinition(this.stage().id, this.toDto());
    request.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.savedWarning.set(this.warningText(result));
        this.form.markAsPristine();
        this.dirtyChange.emit(false);
        this.saved.emit(result);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const deadline = dueAfterStageDeadline(err);
        if (deadline) {
          this.serverDeadline.set(deadline);
          // Silently: a value change would read as the person changing priority,
          // which clears the server's numbers it is about to show.
          this.form.controls.priority.updateValueAndValidity({ emitEvent: false });
          this.step.set(2);
          this.reveal();
          this.announcement.set(this.priorityErrors().stageDeadline);
          return;
        }
        this.saveError.set(plainWorkflowRefusalKey(err) ?? 'common.saveFailed');
      },
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** The deadline rule as a validator, so Save refuses exactly what the field shows. */
  private withinDeadline(control: AbstractControl): ValidationErrors | null {
    // Null at construction, before any input exists: nothing to check yet.
    const priority = control.value as TaskPriority | null;
    return priority && this.brokenDeadline(priority) ? { stageDeadline: true } : null;
  }

  /**
   * One rule for the field, the validator and the message: a priority's due
   * time must not pass the stage's deadline; no deadline allows anything. The
   * server's numbers win when its 409 named this same priority.
   */
  private brokenDeadline(priority: TaskPriority | null): { taskHours: number; stageHours: number; priority: TaskPriority } | null {
    if (!priority) return null;
    const server = this.serverDeadline();
    if (server && server.priority === priority) return server;
    const deadline = this.stage().slaWorkingHours;
    if (deadline === null) return null;
    const taskHours = this.dueHours()[priority];
    return taskHours > deadline ? { taskHours, stageHours: deadline, priority } : null;
  }

  private stepOneInvalid(): boolean {
    const { titleEn, titleAr } = this.form.controls;
    return titleEn.invalid || titleAr.invalid;
  }

  private reveal(): void {
    this.showErrors.set(true);
    this.form.markAllAsTouched();
    afterNextRender(
      () => {
        // The first field showing an error, then its control: an input, or an
        // overlay select's trigger (a tabindex="0" element, not an input).
        const field = this.host.nativeElement.querySelector<HTMLElement>('.am-field--error');
        field?.querySelector<HTMLElement>('input, textarea, select, [tabindex="0"], button')?.focus();
      },
      { injector: this.injector },
    );
  }

  /** Only the chosen route's controls count; the rest are disabled and never sent. */
  private onRouteChange(kind: StageTaskAssignKind | null, initial = false): void {
    this.assignKind.set(kind);
    const { assign, recordPositionId, committeeId, committeeRoleValueId } = this.form.controls;
    const enable = (control: AbstractControl, on: boolean) => (on ? control.enable({ emitEvent: false }) : control.disable({ emitEvent: false }));
    enable(assign, kind === 'POSITION');
    enable(recordPositionId, kind === 'RECORD_UNIT_POSITION');
    enable(committeeId, kind === 'COMMITTEE_ROLE');
    enable(committeeRoleValueId, kind === 'COMMITTEE_ROLE' || kind === 'RECORD_COMMITTEE_ROLE');
    if (!initial) committeeRoleValueId.setValue(null, { emitEvent: false });

    if (kind === 'RECORD_UNIT_POSITION') this.loadPositions();
    if (kind === 'COMMITTEE_ROLE') {
      this.loadCommittees();
      this.committeeId.set(committeeId.value);
      if (committeeId.value) this.loadRoles(committeeId.value);
    }
    if (kind === 'RECORD_COMMITTEE_ROLE') this.loadRoles(undefined);
  }

  private loadPositions(): void {
    if (this.positionList().length) return;
    this.positionsLoading.set(true);
    this.positions.listPositions().subscribe({
      next: (rows) => {
        this.positionList.set(
          rows.filter((p) => p.isActive !== false).map((p) => ({ value: p.id, label: this.language.bilingual(p.nameEn, p.nameAr) })),
        );
        this.positionsLoading.set(false);
      },
      error: () => this.positionsLoading.set(false),
    });
  }

  private loadCommittees(): void {
    if (this.committeeList().length) return;
    this.committeesLoading.set(true);
    this.committees.listCommittees().subscribe({
      next: (rows) => {
        this.committeeList.set(rows.map((c) => ({ value: c.id, label: this.language.bilingual(c.nameEn, c.nameAr) })));
        this.committeesLoading.set(false);
      },
      error: () => this.committeesLoading.set(false),
    });
  }

  private loadRoles(committeeId: string | undefined): void {
    this.roleList.set([]);
    if (this.assignKind() === 'COMMITTEE_ROLE' && !committeeId) return;
    this.rolesLoading.set(true);
    this.tasks.getCommitteeRoleCatalogue(committeeId).subscribe({
      next: (roles) => {
        this.roleList.set(roles);
        this.rolesLoading.set(false);
      },
      error: () => this.rolesLoading.set(false),
    });
  }

  private toDto(): StageTaskDefinitionWriteDto {
    const v = this.form.getRawValue();
    const kind = v.assignKind!;
    // Every route field is sent, null where this kind does not use it: the
    // server refuses a field the kind does not take (STAGE_TASK_ROUTE_INCOMPLETE),
    // and an edit that changes kind must clear the old kind's fields.
    return {
      titleEn: v.titleEn.trim(),
      titleAr: v.titleAr.trim() || null,
      description: v.description.trim() || null,
      isMandatory: v.isMandatory,
      requiresEvidence: v.requiresEvidence,
      priority: v.priority!,
      assignKind: kind,
      orgUnitId: kind === 'POSITION' ? v.assign.scope : null,
      positionId: kind === 'POSITION' ? v.assign.target : kind === 'RECORD_UNIT_POSITION' ? v.recordPositionId : null,
      userId: kind === 'POSITION' ? v.assign.userId : null,
      committeeId: kind === 'COMMITTEE_ROLE' ? v.committeeId : null,
      committeeRoleValueId: kind === 'COMMITTEE_ROLE' || kind === 'RECORD_COMMITTEE_ROLE' ? v.committeeRoleValueId : null,
    };
  }

  private warningText(result: StageTaskDefinitionSavedDto): string | null {
    const d = result.definition;
    if (result.warning === 'POSITION_HAS_NO_HOLDER') {
      return this.translate.instant('workflow.stageTaskForm.savedNoHolder', {
        unit: d.orgUnit ? this.language.bilingual(d.orgUnit.nameEn, d.orgUnit.nameAr) : '—',
      });
    }
    if (result.warning === 'POOL_EMPTY') {
      return this.translate.instant('workflow.stageTaskForm.savedPoolEmpty', {
        committee: d.committee ? this.language.bilingual(d.committee.nameEn, d.committee.nameAr) : '—',
      });
    }
    return null;
  }
}
