import {
  Component,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { OrgPositionService, IOrgPositionDto } from '../../services/org-position.service';
import { RoleService, RoleDto } from '../../../roles/services/role.service';
// ACC-41 — OverlaySelectComponent replaces p-select here: this field lives
// inside EditDialogComponent, one of the DOM contexts where PrimeNG's own
// scroll-chaining bug is reachable. See CLAUDE.md's PrimeNG-components-only
// exception note and overlay-select.component.ts for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { revealAndFocusFirstInvalid } from '../../../../shared/components/field/reveal-errors';
import { InputNumberLatinDigits } from '../../../../core/formatting/latin-digits';

@Component({
  selector: 'app-position-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    InputNumberModule,
    InputNumberLatinDigits,
    CheckboxModule,
    ButtonModule,
    MessageModule,
    OverlaySelectComponent,
    FieldComponent,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
      @if (step() === 1) {
      <!-- ACC-120 slice 6 — am-field. The required marker is DERIVED from each
           control's own validators, so the hand-written asterisks are gone:
           one that is written by hand drifts from the validator the day the
           validator changes. The hints move into the wrapper's own hint slot,
           where an error message replaces them rather than stacking under
           them. -->
      <am-field
        [label]="'orgPosition.nameEn' | translate"
        [control]="form.controls.nameEn"
        inputId="nameEn"
        [forceShowErrors]="showErrors()"
        [errorMessages]="fieldErrors()"
      >
        <input pInputText id="nameEn" class="w-full" formControlName="nameEn" />
      </am-field>

      <am-field
        [label]="'orgPosition.nameAr' | translate"
        [control]="form.controls.nameAr"
        inputId="nameAr"
        [forceShowErrors]="showErrors()"
        [errorMessages]="fieldErrors()"
      >
        <input pInputText id="nameAr" class="w-full" formControlName="nameAr" dir="rtl" />
      </am-field>

      <am-field
        [label]="'orgPosition.grade' | translate"
        [control]="form.controls.grade"
        inputId="grade"
        [hint]="'orgPosition.gradeHint' | translate"
        [forceShowErrors]="showErrors()"
        [errorMessages]="fieldErrors()"
      >
        <p-inputNumber
          inputId="grade"
          formControlName="grade"
          [min]="1"
          [max]="10"
          [showButtons]="true"
        />
      </am-field>

      }

      @if (step() === 2) {
      <!-- CHECKBOXES STAY AS CHECKBOX + LABEL ROWS, deliberately. am-field draws
           a label ABOVE a control, which for a checkbox would put the question
           above the box and then repeat it beside it. No am-field consumer in
           the app wraps one, and this is not the place to invent a second
           convention. What did change: each hint sat in a -mt-3 cancelling the
           form's own gap, which is a layout fighting itself — the pair is now
           one block with its own spacing. -->
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <p-checkbox
            inputId="isSingleAssignee"
            formControlName="isSingleAssignee"
            [binary]="true"
          />
          <label for="isSingleAssignee" class="text-sm font-medium">
            {{ 'orgPosition.isSingleAssignee' | translate }}
          </label>
        </div>
        <small class="text-[var(--am-text-secondary)]">
          {{ 'orgPosition.isSingleAssigneeHint' | translate }}
        </small>
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <p-checkbox
            inputId="isUnitHeadPosition"
            formControlName="isUnitHeadPosition"
            [binary]="true"
            [disabled]="!form.value.isSingleAssignee"
          />
          <label for="isUnitHeadPosition" class="text-sm font-medium">
            {{ 'orgPosition.isUnitHeadPosition' | translate }}
          </label>
        </div>
        <small class="text-[var(--am-text-secondary)]">
          {{ 'orgPosition.isUnitHeadPositionHint' | translate }}
        </small>
      </div>

      <am-field
        [label]="'orgPosition.mappedRole' | translate"
        [control]="form.controls.roleId"
        inputId="roleId"
        [hint]="'orgPosition.mappedRoleHint' | translate"
      >
        <app-overlay-select
          formControlName="roleId"
          [options]="assignableRoles()"
          optionLabel="nameEn"
          optionValue="id"
          [showClear]="true"
          [placeholder]="'orgPosition.mappedRolePlaceholder' | translate"
        />
      </am-field>

      @if (showVacantRoleWarning()) {
        <p-message severity="warn" [text]="'orgPosition.vacantRoleWarning' | translate" />
      }
      }

    </form>
  `,
})
export class PositionFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly roleService = inject(RoleService);
  private readonly translate = inject(TranslateService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly position = input<IOrgPositionDto | null>(null);
  // ACC-43 — carries the saved position and whether the vacant-role
  // warning applies, so the parent dialog can stay open long enough for
  // the user to actually see it (an inline warning inside a dialog that
  // closes the instant the request succeeds would never be visible
  // otherwise). The saved position itself matters for the create flow
  // specifically: if the dialog stays open post-create and the parent
  // didn't switch this component from create-mode to edit-mode, a second
  // Save click would call create() again instead of update() — a real
  // duplicate-position bug, not a hypothetical one.
  readonly saved = output<{ position: IOrgPositionDto; hadVacantRoleWarning: boolean }>();
  readonly cancelled = output<void>();

  /**
   * ACC-120 slice 6 — the actions moved to the HOST'S FOOTER, which renders
   * outside `.am-dialog__body` and so off the 420px cap. Measured: with the
   * field wrapper and the row still inside the body, this dialog sat at exactly
   * 420 and scrolled, in BOTH languages.
   *
   * dirtyChange is an output rather than the host reading form.dirty, because
   * form.dirty is a plain property and a computed() over it never
   * re-evaluates — the unsaved-work prompt then silently never fires.
   */
  readonly ready = output<PositionFormComponent>();
  readonly dirtyChange = output<boolean>();

  /**
   * ACC-120 slice 6 — STEPPED, because it does not fit and compacting it does
   * not make it fit.
   *
   * Measured: 486px of content against the 420px cap, in both languages, with
   * the actions already moved to the footer and compact density applied. 66px
   * over is a content problem, not a spacing one, and ACC-111's resolution
   * order asks for a stepped dialog when the form has a genuine editorial seam.
   *
   * This one does, and it is the seam the form already had: step 1 is WHAT THE
   * POSITION IS — what it is called in each language and where it sits in
   * seniority. Step 2 is WHAT HOLDING IT DOES — whether one person holds it per
   * unit, whether it makes that person the unit's Head, and which role it
   * confers. The vacant-role warning belongs with the role that raises it, so it
   * stays on step 2.
   */
  /**
   * ACC-120 slice 6 — REVEAL EVERY ERROR ON SUBMIT, and move focus to the first.
   *
   * markAllAsTouched() alone was not enough, and the result was a DEAD BUTTON:
   * Next was enabled, clicking it did nothing, the field reported
   * aria-invalid="false", and no error element existed anywhere in the dialog.
   * A disabled button would at least have signalled; this said nothing at all.
   *
   * am-field shows an error on blur only once the control is ALSO dirty — a
   * deliberate rule, because a dialog focuses its first field on open and
   * opening a picker blurs it again. `forceShowErrors` is the wrapper's own
   * answer for the submit moment, and invite-user already used it; this form
   * simply did not pass it.
   */
  readonly showErrors = signal(false);

  readonly fieldErrors = computed(() => {
    this.translate.currentLang();
    return { required: this.translate.instant('validation.required') };
  });

  readonly step = signal(1);
  readonly steps = [
    { n: 1, key: 'orgPosition.stepDetails' },
    { n: 2, key: 'orgPosition.stepBehaviour' },
  ];

  readonly canAdvance = computed(() => this.step() === 1);
  readonly canGoBack = computed(() => this.step() === 2);

  next(): void {
    // Everything required lives on step 1, so a reader is never sent to step 2
    // with an error behind them.
    if (this.form.invalid) {
      this.revealErrors();
      return;
    }
    this.step.set(2);
  }

  /**
   * ACC-120 — ONLY for a non-submit advance. A submit needs nothing: the field
   * wrapper reads the form's own submitted state.
   */
  revealErrors(): void {
    this.showErrors.set(true);
    revealAndFocusFirstInvalid(this.form, this.host);
  }

  back(): void {
    this.step.set(1);
  }

  readonly saving = signal(false);
  readonly allRoles = signal<RoleDto[]>([]);
  // ACC-43 — non-blocking nudge (step-40-org-position-unit-head.md's own
  // "won't grant any role until you map one" design). Never blocks the
  // save itself — set alongside the request, not instead of it.
  readonly showVacantRoleWarning = signal(false);

  // ACC-40 Section 2.9c — hard-excludes PLATFORM_ADMIN/TENANT_ADMIN from this
  // one picker, same reasoning and same shape as UserRoleAssignmentComponent's
  // existing PLATFORM_ADMIN exclusion, extended one role further here.
  get assignableRoles(): () => RoleDto[] {
    return () =>
      this.allRoles().filter((r) => r.isActive && r.key !== 'PLATFORM_ADMIN' && r.key !== 'TENANT_ADMIN');
  }

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(100)]],
    nameAr: ['', [Validators.maxLength(100)]],
    grade: [5, [Validators.required, Validators.min(1), Validators.max(10)]],
    isSingleAssignee: [false],
    isUnitHeadPosition: [false],
    roleId: [null as string | null],
  });

  constructor() {
    effect(() => {
      const current = this.position();
      if (current) {
        this.form.patchValue({
          nameEn: current.nameEn,
          nameAr: current.nameAr ?? '',
          grade: current.grade,
          isSingleAssignee: current.isSingleAssignee,
          isUnitHeadPosition: current.isUnitHeadPosition,
          roleId: current.roleId,
        });
      }
    });

    // isUnitHeadPosition requires isSingleAssignee (ACC-40 Section 2.1) —
    // unchecking isSingleAssignee clears isUnitHeadPosition too, matching
    // the disabled state above rather than leaving a stale checked-but-
    // disabled control that would fail the server-side check on submit.
    // valueChanges, not effect() — FormGroup.value is a plain getter, not a
    // signal, so effect() would only ever run once at construction time.
    this.form.get('isSingleAssignee')!.valueChanges.subscribe((isSingleAssignee) => {
      if (!isSingleAssignee && this.form.value.isUnitHeadPosition) {
        this.form.patchValue({ isUnitHeadPosition: false });
      }
    });

    // ACC-43 — clears a previously-shown warning as soon as it no longer
    // applies (role mapped, or Head-Conferring unchecked), rather than
    // leaving a stale warning visible until the next save attempt.
    this.form.get('roleId')!.valueChanges.subscribe(() => this.refreshVacantRoleWarning());
    this.form.get('isUnitHeadPosition')!.valueChanges.subscribe(() => this.refreshVacantRoleWarning());
  }

  private refreshVacantRoleWarning(): void {
    if (!this.showVacantRoleWarning()) return;
    const { isUnitHeadPosition, roleId } = this.form.value;
    if (!isUnitHeadPosition || roleId) this.showVacantRoleWarning.set(false);
  }

  ngOnInit(): void {
    this.ready.emit(this);
    this.form.valueChanges.subscribe(() => this.dirtyChange.emit(this.form.dirty));
    this.roleService.listAllRoles().subscribe({ next: (roles) => this.allRoles.set(roles) });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      // Every required control is on step 1, so go back to it rather than
      // refusing on a step that shows nothing wrong.
      this.step.set(1);
      this.revealErrors();
      return;
    }
    this.saving.set(true);

    const value = this.form.getRawValue();
    // ACC-43 — non-blocking: set alongside the request below, never in
    // place of it.
    this.showVacantRoleWarning.set(!!value.isUnitHeadPosition && !value.roleId);

    const dto = {
      nameEn: value.nameEn!,
      nameAr: value.nameAr || undefined,
      grade: value.grade!,
      isSingleAssignee: value.isSingleAssignee ?? false,
      isUnitHeadPosition: value.isUnitHeadPosition ?? false,
      roleId: value.roleId || undefined,
    };

    const current = this.position();
    const request = current
      ? this.orgPositionService.update(current.id, dto)
      : this.orgPositionService.create(dto);

    request.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.saved.emit({ position: saved, hadVacantRoleWarning: this.showVacantRoleWarning() });
      },
      error: () => this.saving.set(false),
    });
  }
}
