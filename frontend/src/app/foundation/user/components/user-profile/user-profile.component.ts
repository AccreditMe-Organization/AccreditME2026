import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { TagModule } from 'primeng/tag';
import { ConfirmationService } from 'primeng/api';
import { UserService, IUserDto } from '../../services/user.service';
import { OrgPositionService, IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { OrgUnitService, OrgUnitDto } from '../../../organization/services/org-unit.service';
import { UserRoleAssignmentComponent } from '../../../roles/components/user-role-assignment/user-role-assignment.component';
import { AuthService, MfaSetupResult } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

// Embeds UserRoleAssignmentComponent for real for the first time — it was
// built in Step 6 as "a minimal stopgap until Step 9 ships a proper user
// profile page." This is that page.
//
// Admin-only fields (positionId, primaryOrgUnitId, managerId,
// actingOrgUnitId, actingOrgUnitUntil — ACC-40 Section 2.7) are shown to
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
    PasswordModule,
    TagModule,
    UserRoleAssignmentComponent,
  ],
  template: `
    <div class="flex flex-col gap-6 p-6 max-w-2xl">
      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
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
            >
              <ng-template #item let-otherUser>
                <div class="flex flex-col">
                  <span>{{ otherUser.name }}</span>
                  <span class="text-xs text-[var(--am-text-secondary)]">{{ orgUnitName(otherUser.primaryOrgUnitId) }}</span>
                </div>
              </ng-template>
            </p-select>
          </div>

          <div class="flex gap-4">
            <div class="flex flex-col gap-1 flex-1">
              <label for="actingOrgUnitId" class="text-sm font-medium">
                {{ 'user.actingOrgUnit' | translate }}
              </label>
              <p-select
                inputId="actingOrgUnitId"
                formControlName="actingOrgUnitId"
                [options]="orgUnits()"
                optionLabel="nameEn"
                optionValue="id"
                [showClear]="true"
              />
            </div>
            <div class="flex flex-col gap-1 flex-1">
              <label for="actingOrgUnitUntil" class="text-sm font-medium">
                {{ 'user.actingOrgUnitUntil' | translate }}
              </label>
              <p-datepicker inputId="actingOrgUnitUntil" formControlName="actingOrgUnitUntil" />
            </div>
          </div>

          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="savingProfile()" />
          </div>
        </form>

        <hr />

        <h3 class="text-lg font-medium">{{ 'user.outOfOffice' | translate }}</h3>
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
            >
              <ng-template #item let-otherUser>
                <div class="flex flex-col">
                  <span>{{ otherUser.name }}</span>
                  <span class="text-xs text-[var(--am-text-secondary)]">{{ orgUnitName(otherUser.primaryOrgUnitId) }}</span>
                </div>
              </ng-template>
            </p-select>
          </div>

          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="savingOoo()" />
          </div>
        </form>

        @if (isOwnProfile()) {
          <hr />

          <h3 class="text-lg font-medium">{{ 'user.mfa.title' | translate }}</h3>

          @if (mfaError()) {
            <p-message severity="error" [text]="mfaError()! | translate" />
          }
          @if (mfaSuccessMessage()) {
            <p-message severity="success" [text]="mfaSuccessMessage()! | translate" />
          }

          @if (mfaEnabled() === false && !mfaSetupResult()) {
            <div class="flex flex-col gap-3">
              <p class="text-sm text-[var(--am-text-secondary)]">{{ 'user.mfa.notEnabled' | translate }}</p>
              <form [formGroup]="mfaSetupForm" (ngSubmit)="onSetupMfa()" class="flex flex-col gap-3 max-w-xs">
                <div class="flex flex-col gap-1">
                  <label for="mfaSetupPassword" class="text-sm font-medium">
                    {{ 'user.mfa.password' | translate }}
                  </label>
                  <p-password
                    inputId="mfaSetupPassword"
                    formControlName="password"
                    [feedback]="false"
                    [toggleMask]="true"
                    styleClass="w-full"
                  />
                </div>
                <div>
                  <p-button
                    [label]="'user.mfa.enable' | translate"
                    type="submit"
                    [loading]="settingUpMfa()"
                    [disabled]="mfaSetupForm.invalid"
                  />
                </div>
              </form>
            </div>
          }

          @if (mfaSetupResult(); as setup) {
            <div class="flex flex-col gap-3">
              <p class="text-sm">{{ 'user.mfa.scanQrCode' | translate }}</p>
              <img [src]="setup.qrCodeDataUrl" alt="TOTP QR code" class="w-40 h-40" />
              <p class="text-sm">
                {{ 'user.mfa.manualEntryKey' | translate }}
                <code class="font-mono">{{ setup.secret }}</code>
              </p>

              <form [formGroup]="mfaVerifyForm" (ngSubmit)="onVerifyMfa()" class="flex flex-col gap-3 max-w-xs">
                <div class="flex flex-col gap-1">
                  <label for="mfaVerifyCode" class="text-sm font-medium">
                    {{ 'user.mfa.verificationCode' | translate }}
                  </label>
                  <input pInputText id="mfaVerifyCode" formControlName="code" maxlength="6" />
                </div>
                <div>
                  <p-button
                    [label]="'user.mfa.verifyAndActivate' | translate"
                    type="submit"
                    [loading]="verifyingMfa()"
                    [disabled]="mfaVerifyForm.invalid"
                  />
                </div>
              </form>
            </div>
          }

          @if (mfaEnabled() === true) {
            <div class="flex flex-col gap-3">
              <p-tag severity="success" [value]="'user.mfa.enabled' | translate" />
              <form [formGroup]="mfaDisableForm" (ngSubmit)="onDisableMfaClick()" class="flex flex-col gap-3 max-w-xs">
                <div class="flex flex-col gap-1">
                  <label for="mfaDisablePassword" class="text-sm font-medium">
                    {{ 'user.mfa.password' | translate }}
                  </label>
                  <p-password
                    inputId="mfaDisablePassword"
                    formControlName="password"
                    [feedback]="false"
                    [toggleMask]="true"
                    styleClass="w-full"
                  />
                </div>
                <div>
                  <p-button
                    [label]="'user.mfa.disable' | translate"
                    severity="danger"
                    type="submit"
                    [loading]="disablingMfa()"
                    [disabled]="mfaDisableForm.invalid"
                  />
                </div>
              </form>
            </div>
          }
        }

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
  private readonly authService = inject(AuthService);
  private readonly languageService = inject(LanguageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly translateService = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);

  readonly userId = this.route.snapshot.paramMap.get('id')!;

  readonly user = signal<IUserDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);
  readonly savingProfile = signal(false);
  readonly savingOoo = signal(false);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  readonly otherUsers = signal<{ id: string; name: string; primaryOrgUnitId: string | null }[]>([]);

  // MFA management only ever acts on the logged-in user (AuthController's
  // mfa/* endpoints resolve the actor from the JWT via @CurrentUser(), not
  // from this page's :id route param) — so the section only renders when
  // viewing your own profile, never when an admin views someone else's.
  readonly isOwnProfile = computed(() => this.user()?.id === this.authService.currentUser()?.id);
  readonly mfaEnabled = signal<boolean | null>(null);
  readonly mfaSetupResult = signal<MfaSetupResult | null>(null);
  readonly mfaError = signal<string | null>(null);
  readonly mfaSuccessMessage = signal<string | null>(null);
  readonly settingUpMfa = signal(false);
  readonly verifyingMfa = signal(false);
  readonly disablingMfa = signal(false);

  readonly mfaSetupForm = this.fb.group({ password: ['', [Validators.required]] });
  readonly mfaVerifyForm = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
  });
  readonly mfaDisableForm = this.fb.group({ password: ['', [Validators.required]] });

  readonly profileForm = this.fb.group({
    name: [''],
    language: ['en'],
    positionId: [null as string | null],
    primaryOrgUnitId: [null as string | null],
    managerId: [null as string | null],
    actingOrgUnitId: [null as string | null],
    actingOrgUnitUntil: [null as Date | null],
  });

  readonly oooForm = this.fb.group({
    outOfOfficeFrom: [null as Date | null],
    outOfOfficeTo: [null as Date | null],
    actingUserId: [null as string | null],
  });

  ngOnInit(): void {
    this.orgPositionService.listPositions().subscribe({ next: (positions) => this.positions.set(positions) });
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
    this.userService.listUsers({ status: 'ACTIVE' }).subscribe({
      next: (users) =>
        this.otherUsers.set(
          users
            .filter((u) => u.id !== this.userId)
            .map((u) => ({ id: u.id, name: u.name, primaryOrgUnitId: u.primaryOrgUnitId })),
        ),
    });
    this.loadUser();
  }

  orgUnitName(orgUnitId: string | null): string {
    if (!orgUnitId) return '—';
    return this.orgUnits().find((u) => u.id === orgUnitId)?.nameEn ?? orgUnitId;
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
          actingOrgUnitId: u.actingOrgUnitId,
          actingOrgUnitUntil: u.actingOrgUnitUntil ? new Date(u.actingOrgUnitUntil) : null,
        });
        this.oooForm.patchValue({
          outOfOfficeFrom: u.outOfOfficeFrom ? new Date(u.outOfOfficeFrom) : null,
          outOfOfficeTo: u.outOfOfficeTo ? new Date(u.outOfOfficeTo) : null,
          actingUserId: u.actingUserId,
        });
        if (this.isOwnProfile()) {
          this.loadMfaStatus();
        }
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
        actingOrgUnitId: value.actingOrgUnitId ?? undefined,
        actingOrgUnitUntil: value.actingOrgUnitUntil ? value.actingOrgUnitUntil.toISOString() : undefined,
      })
      .subscribe({
        next: (u) => {
          this.savingProfile.set(false);
          this.user.set(u);
          this.savedMessage.set('user.profileSaved');
          // Live switch (ACC-19, no refresh) — only when editing your own
          // profile. An admin editing someone else's language preference
          // must never change what the admin themselves currently sees.
          if (this.isOwnProfile() && u.language) {
            this.languageService.use(u.language).subscribe();
          }
        },
        error: (err: unknown) => {
          this.savingProfile.set(false);
          this.error.set(extractErrorMessage(err, 'user.errorSave'));
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
        error: (err: unknown) => {
          this.savingOoo.set(false);
          this.error.set(extractErrorMessage(err, 'user.errorSave'));
        },
      });
  }

  private loadMfaStatus(): void {
    this.authService.getMfaStatus().subscribe({
      next: (status) => this.mfaEnabled.set(status.enabled),
      error: () => this.mfaEnabled.set(false),
    });
  }

  onSetupMfa(): void {
    if (this.mfaSetupForm.invalid) return;
    this.settingUpMfa.set(true);
    this.mfaError.set(null);
    this.mfaSuccessMessage.set(null);

    const { password } = this.mfaSetupForm.getRawValue();
    this.authService.setupMfa(password!).subscribe({
      next: (result) => {
        this.settingUpMfa.set(false);
        this.mfaSetupResult.set(result);
        this.mfaSetupForm.reset();
      },
      error: (err: unknown) => {
        this.settingUpMfa.set(false);
        this.mfaError.set(extractErrorMessage(err, 'user.mfa.errorSetup'));
      },
    });
  }

  onVerifyMfa(): void {
    if (this.mfaVerifyForm.invalid) return;
    this.verifyingMfa.set(true);
    this.mfaError.set(null);

    const { code } = this.mfaVerifyForm.getRawValue();
    this.authService.verifyAndEnableMfa(code!).subscribe({
      next: () => {
        this.verifyingMfa.set(false);
        this.mfaSetupResult.set(null);
        this.mfaVerifyForm.reset();
        this.mfaEnabled.set(true);
        this.mfaSuccessMessage.set('user.mfa.enabledSuccess');
      },
      error: (err: unknown) => {
        this.verifyingMfa.set(false);
        this.mfaError.set(extractErrorMessage(err, 'user.mfa.errorVerify'));
      },
    });
  }

  onDisableMfaClick(): void {
    if (this.mfaDisableForm.invalid) return;
    const { password } = this.mfaDisableForm.getRawValue();

    this.confirmationService.confirm({
      message: this.translateService.instant('user.mfa.disableConfirmMessage'),
      header: this.translateService.instant('common.confirm'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => this.disableMfa(password!),
    });
  }

  private disableMfa(password: string): void {
    this.disablingMfa.set(true);
    this.mfaError.set(null);
    this.mfaSuccessMessage.set(null);

    this.authService.disableMfa(password).subscribe({
      next: () => {
        this.disablingMfa.set(false);
        this.mfaEnabled.set(false);
        this.mfaDisableForm.reset();
        this.mfaSuccessMessage.set('user.mfa.disabledSuccess');
      },
      error: (err: unknown) => {
        this.disablingMfa.set(false);
        this.mfaError.set(extractErrorMessage(err, 'user.mfa.errorDisable'));
      },
    });
  }
}
