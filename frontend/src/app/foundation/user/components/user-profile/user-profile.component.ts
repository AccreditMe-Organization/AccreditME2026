import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { UserService, IUserDto } from '../../services/user.service';
import { OrgPositionService, IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { OrgUnitService, OrgUnitDto } from '../../../organization/services/org-unit.service';
import { UserRoleAssignmentComponent } from '../../../roles/components/user-role-assignment/user-role-assignment.component';

// Embeds UserRoleAssignmentComponent for real for the first time — it was
// built in Step 6 as "a minimal stopgap until Step 9 ships a proper user
// profile page." This is that page.
//
// Admin-only fields (positionId, primaryOrgUnitId, managerId) are shown to
// every viewer, not conditionally hidden — UserService.updateProfile()
// already silently strips them server-side when a non-admin edits their own
// profile (Section 12, Discussion 3), so submitting them as a self-editing
// non-admin is a harmless no-op rather than a rejected request.
@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    SelectModule,
    DatePickerModule,
    ButtonModule,
    MessageModule,
    UserRoleAssignmentComponent,
  ],
  template: `
    <div class="flex flex-col gap-6 p-6 max-w-2xl">
      @if (error()) {
        <p-message severity="error" [text]="error()!" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()!" />
      }

      @if (user(); as u) {
        <h2 class="text-xl font-semibold">{{ u.name }}</h2>

        <form [formGroup]="profileForm" (ngSubmit)="onSubmitProfile()" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">{{ 'user.email' | translate }}</label>
            <input pInputText [value]="u.email" disabled />
          </div>

          <div class="flex flex-col gap-1">
            <label for="name" class="text-sm font-medium">{{ 'user.name' | translate }}</label>
            <input pInputText id="name" formControlName="name" />
          </div>

          <div class="flex flex-col gap-1">
            <label for="language" class="text-sm font-medium">{{ 'user.language' | translate }}</label>
            <p-select
              inputId="language"
              formControlName="language"
              [options]="[{ label: 'English', value: 'en' }, { label: 'العربية', value: 'ar' }]"
              optionLabel="label"
              optionValue="value"
            />
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
              [options]="otherUsers()"
              optionLabel="name"
              optionValue="id"
              [showClear]="true"
            />
          </div>

          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="savingProfile()" />
          </div>
        </form>

        <hr />

        <h3 class="text-lg font-semibold">{{ 'user.outOfOffice' | translate }}</h3>
        <form [formGroup]="oooForm" (ngSubmit)="onSubmitOutOfOffice()" class="flex flex-col gap-4">
          <div class="flex gap-4">
            <div class="flex flex-col gap-1 flex-1">
              <label for="outOfOfficeFrom" class="text-sm font-medium">
                {{ 'user.outOfOfficeFrom' | translate }}
              </label>
              <p-datepicker inputId="outOfOfficeFrom" formControlName="outOfOfficeFrom" />
            </div>
            <div class="flex flex-col gap-1 flex-1">
              <label for="outOfOfficeTo" class="text-sm font-medium">
                {{ 'user.outOfOfficeTo' | translate }}
              </label>
              <p-datepicker inputId="outOfOfficeTo" formControlName="outOfOfficeTo" />
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <label for="actingUserId" class="text-sm font-medium">{{ 'user.actingUser' | translate }}</label>
            <p-select
              inputId="actingUserId"
              formControlName="actingUserId"
              [options]="otherUsers()"
              optionLabel="name"
              optionValue="id"
              [showClear]="true"
            />
          </div>

          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="savingOoo()" />
          </div>
        </form>

        <hr />

        <app-user-role-assignment [userId]="u.id" />
      }
    </div>
  `,
})
export class UserProfileComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly route = inject(ActivatedRoute);

  readonly userId = this.route.snapshot.paramMap.get('id')!;

  readonly user = signal<IUserDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);
  readonly savingProfile = signal(false);
  readonly savingOoo = signal(false);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  readonly otherUsers = signal<{ id: string; name: string }[]>([]);

  readonly profileForm = this.fb.group({
    name: [''],
    language: ['en'],
    positionId: [null as string | null],
    primaryOrgUnitId: [null as string | null],
    managerId: [null as string | null],
  });

  readonly oooForm = this.fb.group({
    outOfOfficeFrom: [null as Date | null],
    outOfOfficeTo: [null as Date | null],
    actingUserId: [null as string | null],
  });

  ngOnInit(): void {
    this.orgPositionService.listPositions().subscribe({ next: (positions) => this.positions.set(positions) });
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
    this.userService.listUsers().subscribe({
      next: (users) =>
        this.otherUsers.set(
          users.filter((u) => u.id !== this.userId).map((u) => ({ id: u.id, name: u.name })),
        ),
    });
    this.loadUser();
  }

  private loadUser(): void {
    this.userService.getById(this.userId).subscribe({
      next: (u) => {
        this.user.set(u);
        this.profileForm.patchValue({
          name: u.name,
          language: u.language ?? 'en',
          positionId: u.positionId,
          primaryOrgUnitId: u.primaryOrgUnitId,
          managerId: u.managerId,
        });
        this.oooForm.patchValue({
          outOfOfficeFrom: u.outOfOfficeFrom ? new Date(u.outOfOfficeFrom) : null,
          outOfOfficeTo: u.outOfOfficeTo ? new Date(u.outOfOfficeTo) : null,
          actingUserId: u.actingUserId,
        });
      },
      error: () => this.error.set('user.errorLoad'),
    });
  }

  onSubmitProfile(): void {
    this.savingProfile.set(true);
    this.error.set(null);
    this.savedMessage.set(null);

    const value = this.profileForm.getRawValue();
    this.userService
      .updateProfile(this.userId, {
        name: value.name ?? undefined,
        language: value.language ?? undefined,
        positionId: value.positionId ?? undefined,
        primaryOrgUnitId: value.primaryOrgUnitId ?? undefined,
        managerId: value.managerId ?? undefined,
      })
      .subscribe({
        next: (u) => {
          this.savingProfile.set(false);
          this.user.set(u);
          this.savedMessage.set('user.profileSaved');
        },
        error: (err: { error?: { message?: string } }) => {
          this.savingProfile.set(false);
          this.error.set(err?.error?.message ?? 'user.errorSave');
        },
      });
  }

  onSubmitOutOfOffice(): void {
    this.savingOoo.set(true);
    this.error.set(null);
    this.savedMessage.set(null);

    const value = this.oooForm.getRawValue();
    this.userService
      .updateOutOfOffice(this.userId, {
        outOfOfficeFrom: value.outOfOfficeFrom ? value.outOfOfficeFrom.toISOString() : undefined,
        outOfOfficeTo: value.outOfOfficeTo ? value.outOfOfficeTo.toISOString() : undefined,
        actingUserId: value.actingUserId ?? undefined,
      })
      .subscribe({
        next: (u) => {
          this.savingOoo.set(false);
          this.user.set(u);
          this.savedMessage.set('user.profileSaved');
        },
        error: (err: { error?: { message?: string } }) => {
          this.savingOoo.set(false);
          this.error.set(err?.error?.message ?? 'user.errorSave');
        },
      });
  }
}
