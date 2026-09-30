import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { UserService } from '../../services/user.service';
import { OrgPositionService, IOrgPositionDto } from '../../../org-position/services/org-position.service';
import {
  OrgUnitService,
  OrgUnitDto,
  buildOrgUnitCascadeOptions,
  orgUnitDisplayName,
} from '../../../organization/services/org-unit.service';
// ACC-46 Section 2.3 — reused as-is, same service the org-unit-head panel
// already uses to read GET /organization/units/:id/head, for the manager
// picker's auto-default. ACC-120 slice 5 gives it a second job: the unit's
// head status is also what decides whether invite() would refuse this unit.
import { OrgUnitHeadService } from '../../../organization/services/org-unit-head.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
// CLAUDE.md (ACC-19) — imperative consumers read LanguageService's isArabic()
// signal rather than deriving their own from TranslateService.
import { LanguageService } from '../../../../core/services/language.service';
// ACC-42 Phase 4/6 — OverlaySelectComponent replaces p-select on these
// fields: raw p-dialog context; primaryOrgUnitId additionally gains real
// hierarchy display for the first time (Phase 6, optionGroupLabel/
// optionGroupChildren). See CLAUDE.md's PrimeNG-components-only exception
// note and overlay-select.component.ts for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';

/**
 * Invite user — rebuilt to the drawing, ACC-120 slice 5.
 *
 * Source: `frontend/design-reference/AccreditMe Users and Roles.dc.html`,
 * artboard "Invite user · form dialog 560 · compact density".
 *
 * ## The paired row is the drawing's own instruction, not a liberty
 *
 * The drawing shows the five fields single-column in variant A and then says, of
 * variant B: *"The single-column A drawing shows the fields and their rules. The
 * build uses the paired row, as the Arabic drawing does."* So Name and Email
 * share one row 50/50 **in both languages**, turning five blocks into four rows.
 *
 * Its arithmetic, which is why the pairing exists at all: a compact block is
 * label 18 + 2 + control 32 + 2 + message 17 = 71, so five blocks give a body of
 * 12 + 5×71 + 4×8 + 12 = **411** against the 420 cap — and Arabic's taller line
 * box makes the block 76, giving **436, which is 16 over**. Pairing takes English
 * to 332 and Arabic to 352, and leaves room for the conditional sentences.
 *
 * ## Both conditional rules are drawn as a REPLACEMENT, not a hidden field
 *
 * Artboard 10's zero-field rule: the field is replaced by a sentence, "not hidden
 * and not disabled". Each mirrors a real condition in `UserService.invite()`, so
 * the dialog never makes a claim the server would refuse:
 *
 *   - **Org unit**, when the tenant has no active units at all.
 *   - **Manager**, when the position is head-conferring and the unit is the root.
 *     Changing either brings the field back, required, with the earlier choice
 *     restored — switching is non-destructive.
 */
@Component({
  selector: 'app-invite-user',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    InputTextModule,
    ButtonModule,
    MessageModule,
    OverlaySelectComponent,
    FieldComponent,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-2">
      <p class="text-[12.5px] text-[var(--am-text-secondary)] -mt-1 mb-1">
        {{ 'user.inviteSubtitle' | translate }}
      </p>

      @if (denied()) {
        <p-message severity="warn" [text]="'user.inviteDenied' | translate" />
      } @else if (error()) {
        <div class="flex items-start gap-2">
          <p-message severity="error" [text]="error()!" />
          <p-button
            size="small"
            [text]="true"
            [label]="'list.retry' | translate"
            (onClick)="onSubmit()"
          />
        </div>
      }

      <!-- Name and Email share one row, 50/50, in both languages — the
           drawing's own instruction and what keeps the body under the cap. -->
      <div class="grid grid-cols-2 gap-x-3">
        <am-field
          [label]="'user.name' | translate"
          [control]="form.controls.name"
          [inputId]="nameId"
          [forceShowErrors]="showErrors()"
          [errorMessages]="nameErrors()"
        >
          <input pInputText [id]="nameId" formControlName="name" class="w-full" />
        </am-field>

        <am-field
          [label]="'user.inviteEmail' | translate"
          [control]="form.controls.email"
          [inputId]="emailId"
          [forceShowErrors]="showErrors()"
          [errorMessages]="emailErrors()"
        >
          <input pInputText [id]="emailId" type="email" formControlName="email" class="w-full" />
        </am-field>
      </div>

      <am-field
        [label]="'user.position' | translate"
        [control]="form.controls.positionId"
        [forceShowErrors]="showErrors()"
        [errorMessages]="requiredError()"
      >
        <app-overlay-select
          formControlName="positionId"
          [options]="assignablePositions()"
          [optionLabel]="nameLabelField()"
          optionValue="id"
          [placeholder]="'user.selectPosition' | translate"
        />
      </am-field>

      <!-- Org unit — replaced by a sentence when the tenant has no units,
           which is exactly when invite() stops requiring one. -->
      @if (hasAnyActiveUnit()) {
        <am-field
          [label]="'user.primaryOrgUnit' | translate"
          [control]="form.controls.primaryOrgUnitId"
          [forceShowErrors]="showErrors()"
          [errorMessages]="requiredError()"
        >
          <app-overlay-select
            formControlName="primaryOrgUnitId"
            [options]="orgUnitCascadeOptions()"
            optionLabel="label"
            optionValue="value"
            optionGroupLabel="label"
            optionGroupChildren="items"
            [placeholder]="'user.selectOrgUnit' | translate"
          />
        </am-field>
      } @else {
        <am-field [label]="'user.primaryOrgUnit' | translate" message="none">
          <div class="am-invite-note">
            <span aria-hidden="true">&#9432;</span>
            <span>
              {{ 'user.inviteNoUnitsYet' | translate }}
              <a routerLink="/organization" class="am-invite-note__link">
                {{ 'user.inviteSetUpUnits' | translate }}
              </a>
            </span>
          </div>
        </am-field>
      }

      <!-- Manager — replaced when the invitee IS the root unit's own head, the
           one case invite() exempts. Switching back restores the earlier
           choice, because the control keeps its value. -->
      @if (!isRootUnitHeadInvite()) {
        <am-field
          [label]="'user.manager' | translate"
          [control]="form.controls.managerId"
          [forceShowErrors]="showErrors()"
          [errorMessages]="requiredError()"
        >
          <app-overlay-select
            formControlName="managerId"
            [options]="managers()"
            optionLabel="name"
            optionValue="id"
            [placeholder]="'user.selectManager' | translate"
          />
        </am-field>
      } @else {
        <am-field [label]="'user.manager' | translate" message="none">
          <div class="am-invite-note">
            <span aria-hidden="true">&#9432;</span>
            <span>{{ 'user.inviteManagerNotNeeded' | translate: { unit: rootUnitName() } }}</span>
          </div>
        </am-field>
      }

      <!-- Beyond the drawing, and deliberately: invite() ALSO refuses a unit
           with no Head or Acting Head unless the invitee is that head. Said
           here rather than left to a 409 the user could not have predicted. -->
      @if (selectedUnitHasNoHead()) {
        <p-message severity="warn" [text]="'user.inviteUnitHasNoHead' | translate" />
      }

      <div class="flex justify-end gap-2 pt-1">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="cancelled.emit()"
          [disabled]="saving()"
        />
        <p-button
          [label]="'user.sendInvitation' | translate"
          type="submit"
          [loading]="saving()"
          [disabled]="saving() || denied()"
        />
      </div>
    </form>
  `,
  styles: [
    `
      .am-invite-note {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        min-height: 32px;
        box-sizing: border-box;
        padding: 6px 10px;
        border: 1px solid #c5daea;
        background: #f2f7fb;
        border-radius: 4px;
        font-size: 12px;
        color: #1f5480;
        text-wrap: pretty;
      }
      .am-invite-note__link {
        font-weight: 600;
        color: inherit;
        text-decoration: underline;
      }
    `,
  ],
})
export class InviteUserComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly orgUnitHeadService = inject(OrgUnitHeadService);
  private readonly translate = inject(TranslateService);
  private readonly languageService = inject(LanguageService);

  readonly saved = output<void>();
  readonly cancelled = output<void>();
  /**
   * ACC-96 — lets the host pass `[dirty]` to EditDialogComponent, so Escape or
   * Cancel on unsaved work asks before discarding. The dialog is the host's, so
   * the state has to travel outward.
   */
  readonly dirtyChange = output<boolean>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly denied = signal(false);
  readonly showErrors = signal(false);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  readonly managers = signal<{ id: string; name: string; primaryOrgUnitId: string | null }[]>([]);
  readonly selectedUnitHasNoHead = signal(false);

  readonly nameId = 'invite-name';
  readonly emailId = 'invite-email';

  // ACC-40 Section 2.4 — mirrors UserService.invite()'s own conditional
  // check exactly: required once the tenant has at least one active
  // OrgUnit, not a blanket rule (a brand-new tenant has none yet).
  readonly hasAnyActiveUnit = computed(() => this.orgUnits().some((u) => u.isActive));

  // ACC-43 — excludes inactive positions from the picker, matching the
  // established client-side isActive-filter convention already used for
  // role pickers. listPositions() itself stays unfiltered — position-list's
  // own admin table still needs to show inactive positions.
  readonly assignablePositions = computed(() => this.positions().filter((p) => p.isActive));

  // ACC-42 Phase 6 — no excludeId: a new user isn't itself an org unit, so
  // there's no self/descendant relationship to exclude.
  readonly orgUnitCascadeOptions = computed(() => buildOrgUnitCascadeOptions(this.orgUnits(), null, null));

  // ACC-46 Section 2.3 — mirrors UserService.invite()'s own
  // isInviteeTheUnitsOwnHead && isRootUnitHeadInvite derivation exactly: the
  // selected position is head-conferring AND the selected unit is root
  // (parentId: null). A plain writable signal, not computed() — it depends on
  // FormControl values, which computed() cannot track.
  readonly isRootUnitHeadInvite = signal(false);

  readonly rootUnitName = computed(() => {
    const root = this.orgUnits().find((u) => u.parentId === null && u.isActive);
    return root ? orgUnitDisplayName(root) : '';
  });

  nameLabelField(): 'nameAr' | 'nameEn' {
    return this.languageService.isArabic() ? 'nameAr' : 'nameEn';
  }

  readonly requiredError = computed(() => {
    // Read so the computed re-evaluates on a language switch. On
    // @ngx-translate/core v18 instant() already tracks the store's own
    // signals (ACC-79 verified this by mutation), so this is belt and braces
    // rather than required — kept because isArabic() is the documented
    // dependency for imperative consumers and costs nothing.
    this.languageService.isArabic();
    return { required: this.translate.instant('validation.required') };
  });

  readonly nameErrors = computed(() => ({
    ...this.requiredError(),
    maxlength: this.translate.instant('validation.maxLength255'),
  }));

  readonly emailErrors = computed(() => ({
    ...this.requiredError(),
    email: this.translate.instant('validation.email'),
  }));

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    email: ['', [Validators.required, Validators.email]],
    positionId: [null as string | null, [Validators.required]],
    primaryOrgUnitId: [null as string | null],
    managerId: [null as string | null],
  });

  ngOnInit(): void {
    this.form.valueChanges.subscribe(() => this.dirtyChange.emit(this.form.dirty));

    this.orgPositionService.listPositions().subscribe({
      next: (positions) => this.positions.set(positions),
      error: (err: unknown) => this.captureLoadError(err),
    });

    this.orgUnitService.getFlat().subscribe({
      next: (units) => {
        this.orgUnits.set(units);
        if (this.hasAnyActiveUnit()) {
          const control = this.form.controls.primaryOrgUnitId;
          control.addValidators(Validators.required);
          // ACC-46 — emitEvent: false. Only the validator state changed, not
          // the value, and the default emission would re-trigger the
          // valueChanges subscription below.
          control.updateValueAndValidity({ emitEvent: false });
        }
      },
      error: (err: unknown) => this.captureLoadError(err),
    });

    this.form.controls.primaryOrgUnitId.valueChanges.subscribe((orgUnitId) => this.onOrgUnitChange(orgUnitId));
    this.form.controls.positionId.valueChanges.subscribe(() => this.updateManagerIdRequirement());
    this.onOrgUnitChange(this.form.controls.primaryOrgUnitId.value);
    this.updateManagerIdRequirement();
  }

  private captureLoadError(err: unknown): void {
    if ((err as { status?: number })?.status === 403) {
      this.denied.set(true);
      return;
    }
    this.error.set(extractErrorMessage(err, this.translate.instant('user.errorInvite')));
  }

  private onOrgUnitChange(orgUnitId: string | null): void {
    // Re-fetched, not filtered client-side — GET /users?orgUnitId= already
    // exists on both sides. orgUnitId: undefined keeps the unfiltered
    // "every active user" behaviour when no unit is selected yet.
    this.userService.listAllUsers({ status: 'ACTIVE', orgUnitId: orgUnitId ?? undefined }).subscribe({
      next: (users) =>
        this.managers.set(users.map((u) => ({ id: u.id, name: u.name, primaryOrgUnitId: u.primaryOrgUnitId }))),
    });

    if (!orgUnitId) {
      this.selectedUnitHasNoHead.set(false);
      this.updateManagerIdRequirement();
      return;
    }

    this.orgUnitHeadService.getHeadStatus(orgUnitId).subscribe({
      next: (status) => {
        const headUserId = status.holders[0]?.id;
        // Auto-default only — still a plain editable control afterward.
        // holders is 0-or-1 outside a declared handover, so holders[0] is the
        // only candidate when one exists.
        if (headUserId) {
          this.form.controls.managerId.patchValue(headUserId);
        }
        this.selectedUnitHasNoHead.set(!headUserId && !this.isInviteeTheUnitsOwnHead());
      },
    });

    this.updateManagerIdRequirement();
  }

  private isInviteeTheUnitsOwnHead(): boolean {
    const position = this.positions().find((p) => p.id === this.form.controls.positionId.value);
    return !!position?.isUnitHeadPosition;
  }

  private updateManagerIdRequirement(): void {
    const unit = this.orgUnits().find((u) => u.id === this.form.controls.primaryOrgUnitId.value);
    const isRootUnitHeadInvite = this.isInviteeTheUnitsOwnHead() && !!unit && unit.parentId === null;

    this.isRootUnitHeadInvite.set(isRootUnitHeadInvite);

    const control = this.form.controls.managerId;
    if (isRootUnitHeadInvite) {
      control.clearValidators();
    } else {
      control.setValidators(Validators.required);
    }
    control.updateValueAndValidity({ emitEvent: false });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);

    const value = this.form.getRawValue();
    this.userService
      .invite({
        name: value.name!,
        email: value.email!,
        positionId: value.positionId ?? undefined,
        primaryOrgUnitId: value.primaryOrgUnitId ?? undefined,
        managerId: value.managerId ?? undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.dirtyChange.emit(false);
          this.saved.emit();
        },
        error: (err: unknown) => {
          this.saving.set(false);
          if ((err as { status?: number })?.status === 403) {
            this.denied.set(true);
            return;
          }
          this.error.set(extractErrorMessage(err, this.translate.instant('user.errorInvite')));
        },
      });
  }
}
