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
          [options]="positions()"
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
        <label for="managerId" class="text-sm font-medium">{{ 'user.manager' | translate }}</label>
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
        <p-button [label]="'user.invite' | translate" type="submit" [loading]="saving()" />
      </div>
    </form>
  `,
})
export class InviteUserComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);

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

  // ACC-42 Phase 6 — no excludeId: a new user isn't itself an org unit, so
  // there's no self/descendant relationship to exclude (unlike org-unit-
  // form's own parentId picker).
  readonly orgUnitCascadeOptions = computed(() => buildOrgUnitCascadeOptions(this.orgUnits(), null, null));

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
          control.updateValueAndValidity();
        }
      },
    });
    this.userService.listUsers({ status: 'ACTIVE' }).subscribe({
      next: (users) =>
        this.managers.set(
          users.map((u) => ({ id: u.id, name: u.name, primaryOrgUnitId: u.primaryOrgUnitId })),
        ),
    });
  }

  orgUnitName(orgUnitId: string | null): string {
    if (!orgUnitId) return '—';
    return this.orgUnits().find((u) => u.id === orgUnitId)?.nameEn ?? orgUnitId;
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
