import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { ConfirmationService } from 'primeng/api';
import { UserService, IUserDto } from '../../services/user.service';
import { OrgPositionService, IOrgPositionDto } from '../../../org-position/services/org-position.service';
import {
  OrgUnitService,
  OrgUnitDto,
  buildOrgUnitCascadeOptions,
} from '../../../organization/services/org-unit.service';
import { UserRoleAssignmentComponent } from '../../../roles/components/user-role-assignment/user-role-assignment.component';
import { AuthService, MfaSetupResult } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
// ACC-42 Phase 5 — OverlaySelectComponent replaces p-select on most fields
// in this file: routed-page-under-<main> context. `language` (2 options)
// stayed on p-select at the time — below the scroll-chaining threshold —
// but was migrated separately afterward once a different bug was found:
// PrimeNG's own overlay-flip logic fails to reposition above the trigger
// under CSS zoom specifically, confirmed live elsewhere in the app.
// OverlaySelectComponent's CDK-based positioning doesn't share this bug —
// see CLAUDE.md's Open/Deferred Items for the full investigation.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
// ACC-46 Section 2.6.b — pure content, no dialog of its own; wrapped in a
// raw p-dialog directly in this template, same convention as
// workflow-transition-editor.component.ts's own "Configure Actions"
// dialog (see the wizard's own header comment / plan Section 2.6.b.1 for
// why not EditDialogComponent).
import { TransferUserWizardComponent } from '../transfer-user-wizard/transfer-user-wizard.component';
import { FormatService } from '../../../../core/formatting';

// Embeds UserRoleAssignmentComponent for real for the first time — it was
// built in Step 6 as "a minimal stopgap until Step 9 ships a proper user
// profile page." This is that page.
//
// Admin-only fields (positionId, primaryOrgUnitId, managerId,
// actingOrgUnitId, actingOrgUnitUntil — ACC-40 Section 2.7) are shown to
// every viewer but disabled (ACC-43) unless the viewer holds users:manage —
// the same permission UserService.updateProfile() already checks
// server-side (Section 12, Discussion 3). Disabling here is a UX fix only,
// not the real enforcement: the server still silently strips these fields
// for a non-admin regardless of what the disabled frontend control sends,
// so this can't be bypassed by re-enabling the control client-side.
@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [PageHeaderComponent, 
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    OverlaySelectComponent,
    DatePickerModule,
    ButtonModule,
    MessageModule,
    PasswordModule,
    TagModule,
    DialogModule,
    UserRoleAssignmentComponent,
    TransferUserWizardComponent,
  ],
  template: `
    <div class="flex flex-col gap-6 p-6 max-w-2xl">
      <!-- ACC-79 — the header comes first, above the messages. -->
      @if (user(); as u) {
        <app-page-header [title]="u.name">
          <div pageActions>
            @if (canTransfer()) {
              <p-button [label]="'user.transfer.action' | translate" severity="secondary" (onClick)="transferDialogVisible.set(true)" />
            }
          </div>
        </app-page-header>
      }
      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      @if (user(); as u) {

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
            <app-overlay-select
              formControlName="language"
              [options]="[{ label: 'English', value: 'en' }, { label: 'العربية', value: 'ar' }]"
              optionLabel="label"
              optionValue="value"
            />
          </div>

          @if (canEditAdminFields()) {
            <div class="flex flex-col gap-1">
              <label for="positionId" class="text-sm font-medium">{{ 'user.position' | translate }}</label>
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
                [options]="otherUsers()"
                optionLabel="name"
                optionValue="id"
                [showClear]="true"
                [itemTemplate]="managerItemTpl"
              />
              <ng-template #managerItemTpl let-otherUser>
                <div class="flex flex-col">
                  <span>{{ otherUser.name }}</span>
                  <span class="text-xs text-[var(--am-text-secondary)]">{{ orgUnitName(otherUser.primaryOrgUnitId) }}</span>
                </div>
              </ng-template>
            </div>

            <div class="flex gap-4">
              <div class="flex flex-col gap-1 flex-1">
                <label for="actingOrgUnitId" class="text-sm font-medium">
                  {{ 'user.actingOrgUnit' | translate }}
                </label>
                <app-overlay-select
                  formControlName="actingOrgUnitId"
                  [options]="orgUnitCascadeOptions()"
                  optionLabel="label"
                  optionValue="value"
                  optionGroupLabel="label"
                  optionGroupChildren="items"
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
          } @else {
            <!-- ACC-79 — READ-ONLY AS TEXT, not hidden. ACC-43 deliberately made
                 these five fields visible to every viewer and editable only with
                 users:manage. Rendered as disabled pickers they came out BLANK
                 for a non-admin: a picker labels its value from its option list,
                 and those lists are positions:view / org:view / users:view
                 endpoints. A read-only value has one thing to show, so it is
                 shown as text, named by the references GET /users/:id returns. -->
            <dl class="m-0 flex flex-col gap-4">
              @for (field of readOnlyAdminFields(); track field.labelKey) {
                <div class="flex flex-col gap-1">
                  <dt class="text-sm font-medium">{{ field.labelKey | translate }}</dt>
                  <dd
                    class="m-0 min-h-10 flex items-center px-3 rounded-md border border-[var(--am-border)] bg-[var(--am-surface)] text-[var(--am-text-primary)]"
                  >
                    {{ field.value }}
                  </dd>
                </div>
              }
            </dl>
          }

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
            <app-overlay-select
              formControlName="actingUserId"
              [options]="otherUsers()"
              optionLabel="name"
              optionValue="id"
              [showClear]="true"
              [itemTemplate]="actingUserItemTpl"
            />
            <ng-template #actingUserItemTpl let-otherUser>
              <div class="flex flex-col">
                <span>{{ otherUser.name }}</span>
                <span class="text-xs text-[var(--am-text-secondary)]">{{ orgUnitName(otherUser.primaryOrgUnitId) }}</span>
              </div>
            </ng-template>
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

        <!-- ACC-79 — only with roles:view. Every read inside it needs that
             permission, so without it the section was a "Failed to load roles"
             message beside an Assign Role control nobody could use. -->
        @if (canViewRoles()) {
          <hr />

          <app-user-role-assignment [userId]="u.id" />
        }

        <p-dialog
          [visible]="transferDialogVisible()"
          (visibleChange)="transferDialogVisible.set($event)"
          [header]="'user.transfer.title' | translate"
          [modal]="true"
          [style]="{ width: '640px' }"
        >
          @if (transferDialogVisible()) {
            <app-transfer-user-wizard
              [userId]="u.id"
              (saved)="onTransferSaved()"
              (cancelled)="transferDialogVisible.set(false)"
            />
          }
        </p-dialog>
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
  private readonly navigationAccessService = inject(NavigationAccessService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly translateService = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly format = inject(FormatService);

  readonly userId = this.route.snapshot.paramMap.get('id')!;

  readonly user = signal<IUserDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);
  readonly savingProfile = signal(false);
  readonly savingOoo = signal(false);
  // ACC-46 Section 2.6.g — gated by users:transfer, not users:manage; a
  // transfer moves unit/position/manager together and can trigger a
  // promotion, deliberately gated separately from ordinary profile edits.
  readonly canTransfer = computed(() => this.navigationAccessService.hasPermission('users:transfer'));
  readonly transferDialogVisible = signal(false);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  readonly otherUsers = signal<{ id: string; name: string; primaryOrgUnitId: string | null }[]>([]);

  // ACC-42 Phase 6 — no excludeId: a user isn't itself an org unit, so
  // there's no self/descendant relationship to exclude (unlike org-unit-
  // form's own parentId picker). Shared by both primaryOrgUnitId and
  // actingOrgUnitId — same tenant org-unit tree, no reason to duplicate.
  readonly orgUnitCascadeOptions = computed(() => buildOrgUnitCascadeOptions(this.orgUnits(), null, null));

  // ACC-43 — UX-only mirror of UserService.updateProfile()'s own
  // users:manage gate (user.service.ts:237). Disabling these 5 controls
  // client-side doesn't replace that server-side check; it just stops a
  // non-admin from typing into a field the server has always silently
  // ignored, without any way for a client-side re-enable to bypass it.
  readonly canEditAdminFields = computed(() => this.navigationAccessService.hasPermission('users:manage'));

  readonly canViewRoles = computed(() => this.navigationAccessService.hasPermission('roles:view'));
  readonly canListUsers = computed(() => this.navigationAccessService.hasPermission('users:view'));

  // ACC-79 — the five ACC-43 admin fields as label/value text, for a viewer who
  // may not edit them. Names come from the record's own references; a bilingual
  // name follows the reading language (SYSTEM-REFERENCE §9.3).
  readonly readOnlyAdminFields = computed<{ labelKey: string; value: string }[]>(() => {
    const refs = this.user()?.references;
    const arabic = this.languageService.isArabic();
    const bilingual = (n: { nameEn: string; nameAr: string | null } | null | undefined): string =>
      n ? (arabic ? n.nameAr || n.nameEn : n.nameEn) : '—';
    const until = this.user()?.actingOrgUnitUntil;
    return [
      { labelKey: 'user.position', value: bilingual(refs?.position) },
      { labelKey: 'user.primaryOrgUnit', value: bilingual(refs?.primaryOrgUnit) },
      { labelKey: 'user.manager', value: refs?.manager ?? '—' },
      { labelKey: 'user.actingOrgUnit', value: bilingual(refs?.actingOrgUnit) },
      {
        labelKey: 'user.actingOrgUnitUntil',
        value: this.format.date(until),
      },
    ];
  });

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
    // ACC-79 — each list is requested only when the viewer can read it. They
    // feed the admin pickers; without the permission the request can only 403,
    // and a user opening their own profile hit four of them on every load.
    if (this.navigationAccessService.hasPermission('positions:view')) {
      this.orgPositionService.listPositions().subscribe({ next: (positions) => this.positions.set(positions) });
    }
    if (this.navigationAccessService.hasPermission('org:view')) {
      this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
    }
    if (this.canListUsers()) {
      this.userService.listAllUsers({ status: 'ACTIVE' }).subscribe({
        next: (users) =>
          this.otherUsers.set(
            users
              .filter((u) => u.id !== this.userId)
              .map((u) => ({ id: u.id, name: u.name, primaryOrgUnitId: u.primaryOrgUnitId })),
          ),
      });
    }
    this.loadUser();

    // ACC-43 — one-time check, not a reactive effect: permissions are
    // loaded once at app-init (NavigationAccessService.loadAccess()) and
    // don't change mid-session without a re-login, same assumption every
    // other hasPermission() consumer in the app already relies on.
    if (!this.canEditAdminFields()) {
      for (const field of ['positionId', 'primaryOrgUnitId', 'managerId', 'actingOrgUnitId', 'actingOrgUnitUntil']) {
        this.profileForm.get(field)!.disable();
      }
    }
  }

  // Save responses carry no references (only GET /users/:id does), and the
  // fields they name cannot change through this page for a viewer who sees them
  // as text — so the loaded names are kept rather than blanked.
  private withReferences(u: IUserDto): IUserDto {
    return { ...u, references: u.references ?? this.user()?.references };
  }

  // A viewer without users:view cannot load the colleague list, so the Acting
  // user picker has no options — and without one would not even show who the
  // CURRENT stand-in is. Seed that one entry from the record's references.
  // Choosing someone else still needs a colleague endpoint (ticketed).
  private seedCurrentActingUser(u: IUserDto): void {
    if (this.canListUsers()) return;
    const name = u.references?.actingUser ?? this.user()?.references?.actingUser;
    this.otherUsers.set(
      u.actingUserId && name ? [{ id: u.actingUserId, name, primaryOrgUnitId: null }] : [],
    );
  }

  orgUnitName(orgUnitId: string | null): string {
    if (!orgUnitId) return '—';
    return this.orgUnits().find((u) => u.id === orgUnitId)?.nameEn ?? orgUnitId;
  }

  // ACC-46 — the transferred person's own unit/position/manager just
  // changed; re-fetch this page's own state rather than trying to
  // reconcile the wizard's own local result shape into this component's
  // profileForm fields.
  onTransferSaved(): void {
    this.transferDialogVisible.set(false);
    this.loadUser();
  }

  private loadUser(): void {
    this.userService.getById(this.userId).subscribe({
      next: (u) => {
        this.user.set(u);
        this.seedCurrentActingUser(u);
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
        // ACC-44 — UserService.updateOutOfOffice()'s real gate is
        // isSelf || users:manage (user.service.ts:547), not users:manage
        // alone like the 5-field admin block above — a non-admin can set
        // their OWN out-of-office, just not someone else's. Checked here,
        // inside loadUser()'s own success callback, not the synchronous
        // top of ngOnInit() like the 5-field block: isOwnProfile() reads
        // this.user(), which is still null until this callback runs.
        // Same UX-only framing as canEditAdminFields() itself — the
        // server-side ForbiddenException remains the real enforcement;
        // this only stops a non-admin from filling in a form they can't
        // actually save, instead of hitting a 403 after the fact.
        if (!this.isOwnProfile() && !this.canEditAdminFields()) {
          this.oooForm.disable();
        }
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
          this.user.set(this.withReferences(u));
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
          this.user.set(this.withReferences(u));
          this.seedCurrentActingUser(u);
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
