import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { UserService } from '../../services/user.service';
import { OrgPositionService, IOrgPositionDto } from '../../../org-position/services/org-position.service';
import {
  OrgUnitService,
  OrgUnitDto,
  buildOrgUnitCascadeOptions,
} from '../../../organization/services/org-unit.service';
// ACC-46 Section 2.3 — reused as-is, same service the org-unit-head panel
// already uses to read GET /organization/units/:id/head, for the manager
// picker's auto-default.
import { OrgUnitHeadService } from '../../../organization/services/org-unit-head.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
// ACC-42 Phase 4/6 — OverlaySelectComponent replaces p-select on these
// fields: raw p-dialog context; primaryOrgUnitId additionally gains real
// hierarchy display for the first time (Phase 6, optionGroupLabel/
// optionGroupChildren). See CLAUDE.md's PrimeNG-components-only exception
// note and overlay-select.component.ts for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

@Component({
  selector: 'app-invite-user',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    ButtonModule,
    MessageModule,
    OverlaySelectComponent,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }

      <div class="flex flex-col gap-1">
        <label for="name" class="text-sm font-medium">
          {{ 'user.name' | translate }} <span class="text-red-500">*</span>
        </label>
        <input pInputText id="name" formControlName="name" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="email" class="text-sm font-medium">
          {{ 'user.inviteEmail' | translate }} <span class="text-red-500">*</span>
        </label>
        <input pInputText id="email" type="email" formControlName="email" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="positionId" class="text-sm font-medium">
          {{ 'user.position' | translate }} <span class="text-red-500">*</span>
        </label>
        <app-overlay-select
          formControlName="positionId"
          [options]="assignablePositions()"
          optionLabel="nameEn"
          optionValue="id"
          [showClear]="true"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="primaryOrgUnitId" class="text-sm font-medium">
          {{ 'user.primaryOrgUnit' | translate }}
          @if (primaryOrgUnitRequired()) {
            <span class="text-red-500">*</span>
          }
        </label>
        <app-overlay-select
          formControlName="primaryOrgUnitId"
          [options]="orgUnitCascadeOptions()"
          optionLabel="label"
          optionValue="value"
          optionGroupLabel="label"
          optionGroupChildren="items"
          [showClear]="true"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="managerId" class="text-sm font-medium">
          {{ 'user.manager' | translate }}
          @if (!isRootUnitHeadInvite()) {
            <span class="text-red-500">*</span>
          }
        </label>
        <app-overlay-select
          formControlName="managerId"
          [options]="managers()"
          optionLabel="name"
          optionValue="id"
          [showClear]="true"
          [itemTemplate]="managerItemTpl"
        />
        <ng-template #managerItemTpl let-manager>
          <div class="flex flex-col">
            <span>{{ manager.name }}</span>
            <span class="text-xs text-[var(--am-text-secondary)]">{{ orgUnitName(manager.primaryOrgUnitId) }}</span>
          </div>
        </ng-template>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="cancelled.emit()"
          [disabled]="saving()"
        />
        <p-button [label]="'user.invite' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
      </div>
    </form>
  `,
})
export class InviteUserComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly orgUnitHeadService = inject(OrgUnitHeadService);

  readonly saved = output<void>();
  readonly cancelled = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  readonly managers = signal<{ id: string; name: string; primaryOrgUnitId: string | null }[]>([]);

  // ACC-40 Section 2.4 — mirrors UserService.invite()'s own conditional
  // check exactly: required once the tenant has at least one active
  // OrgUnit, not a blanket rule (a brand-new tenant has none yet).
  readonly primaryOrgUnitRequired = computed(() => this.orgUnits().some((u) => u.isActive));

  // ACC-43 — excludes inactive positions from the picker, matching the
  // established client-side isActive-filter convention already used for
  // role pickers (user-role-assignment.component.ts, position-form.
  // component.ts's own assignableRoles getter). listPositions() itself
  // stays unfiltered — position-list.component.ts's own admin table
  // still needs to show inactive positions.
  readonly assignablePositions = computed(() => this.positions().filter((p) => p.isActive));

  // ACC-42 Phase 6 — no excludeId: a new user isn't itself an org unit, so
  // there's no self/descendant relationship to exclude (unlike org-unit-
  // form's own parentId picker).
  readonly orgUnitCascadeOptions = computed(() => buildOrgUnitCascadeOptions(this.orgUnits(), null, null));

  // ACC-46 Section 2.3 — mirrors UserService.invite()'s own
  // isInviteeTheUnitsOwnHead && isRootUnitHeadInvite derivation exactly:
  // the selected position is head-conferring AND the selected unit is
  // root (parentId: null). A plain writable signal, not computed() — it
  // depends on FormControl values, which computed() can't track (Angular
  // signals don't see FormControl reads), so it's updated imperatively
  // from the valueChanges subscriptions in ngOnInit() below.
  readonly isRootUnitHeadInvite = signal(false);

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    email: ['', [Validators.required, Validators.email]],
    positionId: [null as string | null, [Validators.required]],
    primaryOrgUnitId: [null as string | null],
    managerId: [null as string | null],
  });

  ngOnInit(): void {
    this.orgPositionService.listPositions().subscribe({ next: (positions) => this.positions.set(positions) });
    this.orgUnitService.getFlat().subscribe({
      next: (units) => {
        this.orgUnits.set(units);
        if (this.primaryOrgUnitRequired()) {
          const control = this.form.get('primaryOrgUnitId')!;
          control.addValidators(Validators.required);
          // ACC-46 — emitEvent: false. Only the validator state changed,
          // not the value itself; without this, updateValueAndValidity()'s
          // own default valueChanges emission would spuriously re-trigger
          // this control's new ACC-46 Section 2.3 subscription below.
          control.updateValueAndValidity({ emitEvent: false });
        }
      },
    });

    // ACC-46 Section 2.3 — org-unit-scoped manager picker (the orgUnitId
    // filter already existed on both sides, just never wired through here
    // before), auto-defaulted to the selected unit's current Head, plus
    // the conditional managerId validator (root-unit-Head exemption) —
    // all three re-derived together whenever the selected unit or
    // position changes.
    this.form.controls.primaryOrgUnitId.valueChanges.subscribe((orgUnitId) => this.onOrgUnitChange(orgUnitId));
    this.form.controls.positionId.valueChanges.subscribe(() => this.updateManagerIdRequirement());
    this.onOrgUnitChange(this.form.controls.primaryOrgUnitId.value);
    this.updateManagerIdRequirement();
  }

  orgUnitName(orgUnitId: string | null): string {
    if (!orgUnitId) return '—';
    return this.orgUnits().find((u) => u.id === orgUnitId)?.nameEn ?? orgUnitId;
  }

  private onOrgUnitChange(orgUnitId: string | null): void {
    // Re-fetched, not filtered client-side — GET /users?orgUnitId= already
    // exists on both frontend and backend, this is the first consumer to
    // actually pass it. orgUnitId: undefined (no unit selected yet) keeps
    // the pre-ACC-46 unfiltered "every active user" behavior.
    this.userService.listUsers({ status: 'ACTIVE', orgUnitId: orgUnitId ?? undefined }).subscribe({
      next: (users) =>
        this.managers.set(
          users.map((u) => ({ id: u.id, name: u.name, primaryOrgUnitId: u.primaryOrgUnitId })),
        ),
    });

    if (orgUnitId) {
      // Auto-default only — still a plain editable control afterward, per
      // the plan's own explicit "not disabled" requirement. holders is
      // 0-or-1 outside a declared handover (head-conferring positions are
      // always single-assignee, schema-enforced), so holders[0] is the
      // correct, only candidate when one exists.
      this.orgUnitHeadService.getHeadStatus(orgUnitId).subscribe({
        next: (status) => {
          const headUserId = status.holders[0]?.id;
          if (headUserId) {
            this.form.controls.managerId.patchValue(headUserId);
          }
        },
      });
    }

    this.updateManagerIdRequirement();
  }

  private updateManagerIdRequirement(): void {
    const positionId = this.form.controls.positionId.value;
    const orgUnitId = this.form.controls.primaryOrgUnitId.value;
    const position = this.positions().find((p) => p.id === positionId);
    const unit = this.orgUnits().find((u) => u.id === orgUnitId);
    const isRootUnitHeadInvite = !!position?.isUnitHeadPosition && !!unit && unit.parentId === null;

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
          this.saved.emit();
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.error.set(extractErrorMessage(err, 'user.errorInvite'));
        },
      });
  }
}
