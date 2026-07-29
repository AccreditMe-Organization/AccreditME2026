import { Component, OnInit, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { UserService } from '../../services/user.service';
import { OrgPositionService, IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { OrgUnitService, OrgUnitDto } from '../../../organization/services/org-unit.service';

@Component({
  selector: 'app-invite-user',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    SelectModule,
    ButtonModule,
    MessageModule,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
      @if (error()) {
        <p-message severity="error" [text]="error()!" />
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
        <label for="positionId" class="text-sm font-medium">{{ 'user.position' | translate }}</label>
        <p-select
          inputId="positionId"
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
        </label>
        <p-select
          inputId="primaryOrgUnitId"
          formControlName="primaryOrgUnitId"
          [options]="orgUnits()"
          optionLabel="nameEn"
          optionValue="id"
          [showClear]="true"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="managerId" class="text-sm font-medium">{{ 'user.manager' | translate }}</label>
        <p-select
          inputId="managerId"
          formControlName="managerId"
          [options]="managers()"
          optionLabel="name"
          optionValue="id"
          [showClear]="true"
        />
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
  readonly managers = signal<{ id: string; name: string }[]>([]);

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    email: ['', [Validators.required, Validators.email]],
    positionId: [null as string | null],
    primaryOrgUnitId: [null as string | null],
    managerId: [null as string | null],
  });

  ngOnInit(): void {
    this.orgPositionService.listPositions().subscribe({ next: (positions) => this.positions.set(positions) });
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
    this.userService.listUsers().subscribe({
      next: (users) => this.managers.set(users.map((u) => ({ id: u.id, name: u.name }))),
    });
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
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.error.set(err?.error?.message ?? 'user.errorInvite');
        },
      });
  }
}
