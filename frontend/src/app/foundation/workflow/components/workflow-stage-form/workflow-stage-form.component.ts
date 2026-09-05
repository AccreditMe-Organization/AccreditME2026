import { Component, Input, Output, EventEmitter, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import {
  WorkflowTemplateService,
  WorkflowStageDto,
  CreateWorkflowStageDto,
  UpdateWorkflowStageDto,
} from '../../services/workflow-template.service';
import { RoleService, RoleDto } from '../../../roles/services/role.service';
// ACC-54 — POSITION_FIXED's pickers and its config-time holder check. All
// three services already existed; none needed a new endpoint.
import {
  OrgPositionService,
  IOrgPositionDto,
} from '../../../org-position/services/org-position.service';
import {
  OrgUnitService,
  OrgUnitDto,
  buildOrgUnitCascadeOptions,
} from '../../../organization/services/org-unit.service';
import { UserService } from '../../../user/services/user.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
// ACC-42 Phase 3 — OverlaySelectComponent replaces p-select on this field:
// EditDialogComponent context, 6 options, qualifies per ACC-41/42's
// established 5+ threshold. See CLAUDE.md's PrimeNG-components-only
// exception note and overlay-select.component.ts for the full mechanism.
//
// approvalMode/parallelThreshold below were originally left on p-select
// (below the 5-option scroll-chaining threshold), but migrated separately
// after a DIFFERENT bug was found: PrimeNG's own overlay-flip logic fails
// to reposition above the trigger under CSS zoom specifically, confirmed
// live (COMMITTEE rendered 15.9px past the viewport edge at 1.5x zoom).
// OverlaySelectComponent's CDK-based positioning does not share this bug —
// see CLAUDE.md's Open/Deferred Items for the full investigation.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

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
  // ACC-54 — unlike ORG_UNIT_HEAD above (wired but still unreachable, since
  // no workflow-driven object carries an orgUnitId to resolve against), this
  // one is immediately usable: both the position and the unit are chosen
  // here at config time, so nothing external has to supply them.
  { label: 'POSITION_FIXED', value: 'POSITION_FIXED' },
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
    CheckboxModule,
    MessageModule,
    OverlaySelectComponent,
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
        <app-overlay-select
          formControlName="approvalMode"
          [options]="approvalModes"
          optionLabel="label"
          optionValue="value"
        />
      </div>

      @if (approvalMode() === 'PARALLEL') {
        <div class="flex flex-col gap-1">
          <label for="parallelThreshold" class="font-medium text-sm">
            {{ 'workflow.parallelThreshold' | translate }}
          </label>
          <app-overlay-select
            formControlName="parallelThreshold"
            [options]="parallelThresholds"
            optionLabel="label"
            optionValue="value"
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
        <app-overlay-select
          formControlName="assigneeStrategy"
          [options]="assigneeStrategies"
          optionLabel="label"
          optionValue="value"
        />
      </div>

      @if (assigneeStrategy() === 'ROLE' || assigneeStrategy() === 'ROUND_ROBIN') {
        <div class="flex flex-col gap-1">
          <label for="assigneeRoleId" class="font-medium text-sm">
            {{ 'workflow.assigneeRole' | translate }}
          </label>
          <app-overlay-select
            formControlName="assigneeRoleId"
            [options]="roles()"
            optionLabel="nameEn"
            optionValue="id"
          />
        </div>
      }

      @if (assigneeStrategy() === 'COMMITTEE') {
        <div class="flex flex-col gap-1">
          <label for="assigneeCommitteeRoleValueId" class="font-medium text-sm">
            {{ 'workflow.assigneeCommitteeRole' | translate }}
          </label>
          <app-overlay-select
            formControlName="assigneeCommitteeRoleValueId"
            [options]="committeeRoles()"
            [optionLabel]="committeeRoleLabelField()"
            optionValue="id"
            [showClear]="true"
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

      @if (assigneeStrategy() === 'POSITION_FIXED') {
        <div class="flex flex-col gap-1">
          <label for="assigneePositionId" class="font-medium text-sm">
            {{ 'workflow.assigneePosition' | translate }}
          </label>
          <app-overlay-select
            formControlName="assigneePositionId"
            [options]="activePositions()"
            optionLabel="nameEn"
            optionValue="id"
            [showClear]="true"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="assigneeOrgUnitId" class="font-medium text-sm">
            {{ 'workflow.assigneeOrgUnit' | translate }}
          </label>
          <app-overlay-select
            formControlName="assigneeOrgUnitId"
            [options]="orgUnitCascadeOptions()"
            optionLabel="label"
            optionValue="value"
            optionGroupLabel="label"
            optionGroupChildren="items"
            [showClear]="true"
          />
          <small class="text-[var(--am-text-secondary)]">
            {{ 'workflow.assigneePositionHint' | translate }}
          </small>
        </div>

        <!--
          ACC-54 — in normal flow, directly beneath the two pickers it is
          about, rather than in the sticky footer below.

          The first attempt at F2 put this in that footer, which fixed the
          buttons-pushed-out-of-view problem but created a worse one: sticky
          positioning OVERLAYS scrolling content, so at the un-scrolled
          position the panel sat on top of the Org Unit picker — label
          clipped, field hidden. Since the warning clears by changing EITHER
          picker, that left a user who does not scroll able to reach only
          Position, not the Org Unit field the warning is actually about.

          In flow here it pushes content instead of covering it, and lands
          immediately under the pair it describes, which is also where the
          user's attention already is. Only the action row stays sticky, so
          the buttons still cannot be pushed out of reach.
        -->
        @if (showNoHolderWarning()) {
          <p-message severity="warn" [text]="'workflow.noPositionHolderWarning' | translate" />
        }
      }

      <!--
        ACC-54 (finding F2) — the ACTION ROW is pinned to the bottom of
        EditDialogComponent's scroll area (max-h-[60vh] overflow-y-auto), so
        Cancel/Save can never be pushed out of the visible region by content
        growing above them. That was the original F2 defect: appending the
        no-holder warning grew the form and the buttons disappeared entirely,
        which reads as a broken dialog.

        The warning itself is deliberately NOT in here — it lives in normal
        flow beside its own pickers above. Sticky content overlays whatever
        scrolls beneath it, and putting the warning here meant it covered the
        Org Unit field (see the comment at its new location).

        Needs an opaque background since it overlaps scrolling content, and a
        top border so it reads as a footer rather than floating text.
      -->
      <div
        class="sticky bottom-0 -mx-1 mt-2 flex flex-col gap-2 border-t border-[var(--am-border)] bg-[var(--am-card)] px-1 pt-3"
      >
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
      </div>

    </form>
  `,
})
export class WorkflowStageFormComponent implements OnInit {
  @Input() stage: WorkflowStageDto | null = null;
  @Input() templateId!: string;
  @Input() nextOrder = 10;
  // ACC-54 — emits the warning flag alongside the saved stage so the parent
  // can keep the dialog open when it fires (ACC-43 precedent, position-form).
  @Output() saved = new EventEmitter<{ stage: WorkflowStageDto; hadNoHolderWarning: boolean }>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly roleService = inject(RoleService);
  private readonly lookupService = inject(LookupService);
  private readonly languageService = inject(LanguageService);
  private readonly fb = inject(FormBuilder);
  // ACC-54 — POSITION_FIXED's two pickers plus its config-time holder check.
  // All three reuse existing services; no new endpoint was needed.
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly userService = inject(UserService);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly roles = signal<RoleDto[]>([]);
  readonly committeeRoles = signal<LookupValueDto[]>([]);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);

  // ACC-54 — non-blocking config-time warning, following position-form's
  // showVacantRoleWarning exactly: set alongside the save request, never in
  // place of it, and cleared reactively once it no longer applies.
  readonly showNoHolderWarning = signal(false);

  // ACC-42 Phase 6 — no excludeId: a workflow stage isn't an org unit, so
  // there's no self/descendant relationship to exclude (unlike org-unit-
  // form's own parentId picker). Same call shape as invite-user's.
  readonly orgUnitCascadeOptions = computed(() =>
    buildOrgUnitCascadeOptions(this.orgUnits(), null, null),
  );

  readonly activePositions = computed(() => this.positions().filter((p) => p.isActive));

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
    assigneePositionId: [null as string | null],
    assigneeOrgUnitId: [null as string | null],
  });

  readonly approvalMode = toSignal(this.form.controls.approvalMode.valueChanges, {
    initialValue: this.form.controls.approvalMode.value,
  });
  readonly assigneeStrategy = toSignal(this.form.controls.assigneeStrategy.valueChanges, {
    initialValue: this.form.controls.assigneeStrategy.value,
  });

  constructor() {
    // ACC-54 — clears a shown warning as soon as it no longer applies (either
    // picker changed, or the strategy moved away from POSITION_FIXED), rather
    // than leaving a stale warning visible until the next save attempt. Same
    // reasoning and same valueChanges mechanism as position-form's
    // refreshVacantRoleWarning() — effect() can't be used here because
    // FormControl values aren't signals.
    this.form.controls.assigneePositionId.valueChanges.subscribe(() =>
      this.showNoHolderWarning.set(false),
    );
    this.form.controls.assigneeOrgUnitId.valueChanges.subscribe(() =>
      this.showNoHolderWarning.set(false),
    );
    this.form.controls.assigneeStrategy.valueChanges.subscribe(() =>
      this.showNoHolderWarning.set(false),
    );
  }

  ngOnInit(): void {
    this.roleService.listRoles().subscribe({ next: (roles) => this.roles.set(roles) });
    this.lookupService.getValues('committee_member_role').subscribe({
      next: (values) => this.committeeRoles.set(values),
    });
    this.orgPositionService.listPositions().subscribe({
      next: (positions) => this.positions.set(positions),
    });
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });

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
        assigneePositionId: this.stage.assigneePositionId,
        assigneeOrgUnitId: this.stage.assigneeOrgUnitId,
      });
    }
  }

  // ACC-54 — the config-time validity check. Runs entirely against existing
  // API surface: GET /users?orgUnitId=&status=ACTIVE, filtered client-side on
  // positionId (which toSafeUser() preserves). No new endpoint was required,
  // which is why Step 4c stayed a genuine no-op.
  //
  // Non-blocking by construction — this never gates the save, it only sets a
  // signal the template renders alongside it.
  //
  // A failed request sets NO warning, deliberately. Listing users needs
  // users:view, which a tenant-created custom role holding only
  // workflows:manage might not have; rendering "nobody holds this" when the
  // truth is "I wasn't allowed to look" would be worse than staying silent.
  private noHolderWarning$(raw: {
    assigneeStrategy: string | null;
    assigneePositionId: string | null;
    assigneeOrgUnitId: string | null;
  }): Observable<boolean> {
    // Only meaningful once both ids are set: a half-configured stage is
    // already visibly incomplete in the form, and asking "who holds nothing
    // in nowhere" would be noise.
    if (
      raw.assigneeStrategy !== 'POSITION_FIXED' ||
      !raw.assigneePositionId ||
      !raw.assigneeOrgUnitId
    ) {
      return of(false);
    }
    const positionId = raw.assigneePositionId;
    return this.userService.listUsers({ orgUnitId: raw.assigneeOrgUnitId, status: 'ACTIVE' }).pipe(
      map((users) => !users.some((u) => u.positionId === positionId)),
      // A failed lookup yields NO warning, deliberately. Listing users needs
      // users:view, which a tenant-created role holding only workflows:manage
      // might lack; rendering "nobody holds this" when the truth is "I wasn't
      // allowed to look" would be worse than staying silent — and it would
      // wrongly hold the dialog open on top of that.
      catchError(() => of(false)),
    );
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
      // ACC-54 — same set-or-explicitly-clear shape as the field above, for
      // the same reason: switching a stage away from POSITION_FIXED must
      // clear the pair rather than leave stale ids behind.
      ...(raw.assigneePositionId
        ? { assigneePositionId: raw.assigneePositionId }
        : this.stage && this.stage.assigneePositionId
          ? { assigneePositionId: null }
          : {}),
      ...(raw.assigneeOrgUnitId
        ? { assigneeOrgUnitId: raw.assigneeOrgUnitId }
        : this.stage && this.stage.assigneeOrgUnitId
          ? { assigneeOrgUnitId: null }
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

    // ACC-54 — forkJoin rather than firing the check separately, because the
    // parent has to know whether the warning applies at the moment `saved`
    // emits: that flag is what decides whether the dialog stays open
    // (ACC-43's fix for the same problem in position-form). position-form
    // could read its own signal inline because its check is a pure
    // form-value comparison; this one is an HTTP round-trip, so the flag
    // simply is not known yet when the save resolves.
    //
    // Still non-blocking in the sense that matters: the save is issued
    // regardless of the check, and the check's result can never prevent it
    // or fail it (catchError below swallows a rejected lookup into "no
    // warning"). Only the dialog's closing waits on it.
    forkJoin({ stage: request$, hadNoHolderWarning: this.noHolderWarning$(raw) }).subscribe({
      next: ({ stage, hadNoHolderWarning }) => {
        this.saving.set(false);
        this.showNoHolderWarning.set(hadNoHolderWarning);
        this.saved.emit({ stage, hadNoHolderWarning });
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, 'Save failed'));
        this.saving.set(false);
      },
    });
  }
}
