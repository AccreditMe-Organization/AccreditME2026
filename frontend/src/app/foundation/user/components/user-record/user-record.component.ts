import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { map } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { registerPageName } from '../../../../core/services/document-title.service';
import { FormatService } from '../../../../core/formatting';
import {
  RequestOutcome,
  RequestOutcomeHandle,
  createRequestOutcome,
} from '../../../../core/request-outcome/request-outcome';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { RecordPanelComponent } from '../../../../shared/components/record-panel/record-panel.component';
import { StatusChipComponent } from '../../../../shared/components/status-chip/status-chip.component';
import { IOrgPositionDto, OrgPositionService } from '../../../org-position/services/org-position.service';
import { OrgUnitDto, OrgUnitService, orgUnitDisplayName } from '../../../organization/services/org-unit.service';
import { ManageRolesComponent } from '../../../roles/components/manage-roles/manage-roles.component';
import { RoleService, UserRoleGrantDto } from '../../../roles/services/role.service';
import { IBilingualNameDto, IUserDto, UserService } from '../../services/user.service';
import { UserStatusActionsService, statusActionFor } from '../../services/user-status-actions.service';
import { TransferUserWizardComponent } from '../transfer-user-wizard/transfer-user-wizard.component';
import { EditProfileDialogComponent } from './edit-profile-dialog.component';
import { CoverOption, OutOfOfficeDialogComponent } from './out-of-office-dialog.component';
import { TwoStepOffDialogComponent } from './two-step-off-dialog.component';
import { TwoStepSetupDialogComponent } from './two-step-setup-dialog.component';
import { USER_PANEL_GRID } from './user-panel-grid';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';

/** One row of the Roles panel. */
export interface RoleRow {
  id: string;
  name: string;
  /** "Granted 3 Oct 2026", or the head position it comes with. */
  detail: string;
  /** Held through a head position: marked, never removable here. */
  derived: boolean;
}

interface Fact {
  key: string;
  labelKey: string;
  value: string;
  /** Dates read left to right inside Arabic. */
  ltr?: boolean;
}

/**
 * The user record page — ACC-120 slice 5. Built to Templates "2 Record page",
 * copying the Committee record page for structure: an identity card with the
 * placement facts, then panels. Every change happens in a dialog; there is no
 * inline editing and no page-level Save.
 *
 * ## One page for "my profile" and "someone else's"
 *
 * Same route, same guard (`ownProfileGuard`: your own id always, anyone else's
 * needs users:view), same component. `isOwn` decides what renders, and every
 * action is gated on what its endpoint enforces:
 *
 *   Edit profile        own record, or users:manage (placement: users:manage)
 *   Out of office       own record, or users:manage — an active user only
 *   Transfer            users:transfer, an active user in a unit
 *   Deactivate          users:deactivate, an active user, NOT your own (D4)
 *   Reactivate          users:reactivate, an inactive user
 *   Revoke invitation   users:invite, an invited user — then back to /users
 *   Manage roles        roles:manage, on the Roles panel
 *   Two-step sign-in    own record only (the endpoints act on the caller)
 *
 * The status actions are the Users list's own, through
 * UserStatusActionsService, so the two screens cannot disagree.
 *
 * ## Panels left OUT, not empty (CC-88, D1)
 *
 * Committees, Tasks, Sessions and Access history have no per-user endpoint,
 * so they are absent — not a placeholder, not a disabled panel. ACC-216 adds
 * the reads. A spec pins their absence.
 *
 * ## Each panel owns its request (ACC-104)
 *
 * Roles and Two-step sign-in each run their own RequestOutcome: a skeleton
 * while loading, an error with Retry that leaves the rest of the page alone,
 * and a refused read leaves the panel absent. Every role row is shown — a user
 * holds a handful — rather than Template 2's 3–6 with a hand-off (D6), since
 * there is no per-user roles list to hand off to.
 */
@Component({
  selector: 'app-user-record',
  standalone: true,
  imports: [
    TranslatePipe,
    ButtonModule,
    MessageModule,
    EditDialogComponent,
    RecordPanelComponent,
    StatusChipComponent,
    ManageRolesComponent,
    TransferUserWizardComponent,
    EditProfileDialogComponent,
    OutOfOfficeDialogComponent,
    TwoStepSetupDialogComponent,
    TwoStepOffDialogComponent,
  ],
  template: `
    @if (loadError()) {
      <p-message severity="error" [text]="loadError()! | translate" data-user-load-error />
    }

    @if (!user() && !loadError()) {
      <!-- While the record loads: the identity card's shape, not a spinner
           (artboard 8 — no centred spinner for an initial load). -->
      <section
        class="rounded-lg bg-[var(--am-card)] border border-[var(--am-border)] px-[18px] py-4 flex flex-col gap-3"
        aria-busy="true"
        data-user-loading
      >
        <span class="am-skeleton-bar w-1/3"></span>
        <span class="am-skeleton-bar w-1/2"></span>
        <span class="am-skeleton-bar w-2/3"></span>
      </section>
    }

    @if (user(); as u) {
      <div class="flex flex-col gap-3">
        <section class="rounded-lg bg-[var(--am-card)] border border-[var(--am-border)]" data-user-identity>
          <div class="flex flex-wrap items-start justify-between gap-4 px-[18px] pt-4 pb-3.5">
            <div class="flex items-center gap-3 min-w-[280px] flex-1">
              <span
                aria-hidden="true"
                class="flex items-center justify-center shrink-0 w-11 h-11 rounded-full text-[15px] font-semibold bg-[var(--am-surface)] border border-[var(--am-border)] text-[var(--am-text-secondary)]"
                data-user-avatar
                >{{ initials() }}</span
              >
              <div class="min-w-0">
                <h1 class="text-2xl font-semibold leading-tight tracking-tight">{{ u.name }}</h1>
                <div class="flex flex-wrap items-center gap-2 mt-1">
                  <span
                    dir="ltr"
                    class="text-[13px] text-[var(--am-text-secondary)] [unicode-bidi:isolate]"
                    data-user-email
                    >{{ u.email }}</span
                  >
                  <app-status-chip variant="user" labelPrefix="user.status" [value]="u.status" />
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2.5 flex-wrap" data-user-actions>
              @if (canEditProfile()) {
                <p-button
                  [label]="'userRecord.editProfile' | translate"
                  icon="pi pi-pencil"
                  size="small"
                  [outlined]="true"
                  (onClick)="editProfileOpen.set(true)"
                  data-action="editProfile"
                />
              }
              @if (canSetOutOfOffice()) {
                <p-button
                  [label]="'userRecord.outOfOffice' | translate"
                  icon="pi pi-calendar"
                  size="small"
                  [outlined]="true"
                  (onClick)="outOfOfficeOpen.set(true)"
                  data-action="outOfOffice"
                />
              }
              @if (canTransfer()) {
                <p-button
                  [label]="'user.transfer.action' | translate"
                  icon="pi pi-arrow-right-arrow-left"
                  size="small"
                  [outlined]="true"
                  (onClick)="openTransfer()"
                  data-action="transfer"
                />
              }
              @if (canDeactivate()) {
                <p-button
                  [label]="'user.deactivate' | translate"
                  icon="pi pi-user-minus"
                  size="small"
                  severity="danger"
                  [outlined]="true"
                  (onClick)="runStatusAction('deactivate')"
                  data-action="deactivate"
                />
              }
              @if (canReactivate()) {
                <p-button
                  [label]="'user.reactivate' | translate"
                  icon="pi pi-user-plus"
                  size="small"
                  [outlined]="true"
                  (onClick)="runStatusAction('reactivate')"
                  data-action="reactivate"
                />
              }
              @if (canRevokeInvitation()) {
                <p-button
                  [label]="'user.revokeInvitation' | translate"
                  icon="pi pi-times-circle"
                  size="small"
                  severity="danger"
                  [outlined]="true"
                  (onClick)="runStatusAction('revokeInvitation')"
                  data-action="revokeInvitation"
                />
              }
            </div>
          </div>

          <!-- The fact strip, as on the Committee record: short values read in
               one sweep rather than one bordered box each. -->
          <dl class="m-0 flex flex-wrap" data-user-facts>
            @for (fact of facts(); track fact.key; let last = $last) {
              <div
                class="px-[18px] py-2.5 flex-[1_1_170px] min-w-0 border-t border-[var(--am-border)]"
                [class.border-e]="!last"
                [attr.data-fact]="fact.key"
              >
                <dt class="text-[11px] font-semibold uppercase tracking-wide text-[var(--am-text-secondary)] mb-1">
                  {{ fact.labelKey | translate }}
                </dt>
                <dd class="m-0 text-[13px]">{{ fact.value }}</dd>
              </div>
            }
          </dl>
        </section>

        @if (actionMessage(); as message) {
          <p-message severity="success" [text]="message" role="status" data-user-action-message />
        }
        @if (actionError(); as message) {
          <p-message severity="error" [text]="message | translate" data-user-action-error />
        }

        <div class="grid gap-3" [style.grid-template-columns]="panelGrid" data-user-panels>
          @if (canViewRoles() && rolesHandle()) {
            <app-record-panel
              data-panel="roles"
              [heading]="'userRecord.roles.heading' | translate"
              [count]="roleRows().length"
              [outcome]="rolesOutcome()"
              (retry)="rolesHandle()?.retry()"
              [emptyTitle]="'userRecord.roles.empty' | translate"
              [emptyMessage]="'userRecord.roles.emptyBody' | translate"
            >
              @if (canManageRoles()) {
                <button
                  panelActions
                  type="button"
                  class="text-[12.5px] text-[var(--am-blue-primary)] hover:underline"
                  (click)="openManageRoles()"
                  data-action="manageRoles"
                >
                  {{ 'manageRoles.menuAction' | translate }}
                </button>
              }
              <ul class="m-0 p-0 list-none">
                @for (row of roleRows(); track row.id) {
                  <li class="flex gap-2 px-4 py-2 border-b border-[var(--am-row-rule)]" [attr.data-role-row]="row.derived ? 'derived' : 'direct'">
                    @if (row.derived) {
                      <span aria-hidden="true" class="pt-[1px] text-[var(--am-text-secondary)]">⊡</span>
                    }
                    <div class="flex flex-col min-w-0">
                      <span class="text-[13px] font-medium">{{ row.name }}</span>
                      <span class="text-[11.5px] text-[var(--am-text-secondary)]" data-role-detail>{{ row.detail }}</span>
                    </div>
                  </li>
                }
              </ul>
            </app-record-panel>
          }

          @if (isOwn() && twoStepHandle()) {
            <app-record-panel
              data-panel="twoStep"
              [heading]="'userRecord.twoStep.heading' | translate"
              [outcome]="twoStepOutcome()"
              (retry)="twoStepHandle()?.retry()"
              [error]="'userRecord.twoStep.loadError'"
              [bodyHeight]="120"
            >
              @if (canManageTwoStep() && twoStepEnabled() === false) {
                <button
                  panelActions
                  type="button"
                  class="text-[12.5px] text-[var(--am-blue-primary)] hover:underline"
                  (click)="twoStepSetupOpen.set(true)"
                  data-action="twoStepSetUp"
                >
                  {{ 'userRecord.twoStep.setUp' | translate }}
                </button>
              }
              @if (canManageTwoStep() && twoStepEnabled() === true) {
                <button
                  panelActions
                  type="button"
                  class="text-[12.5px] text-[var(--am-danger-ink)] hover:underline"
                  (click)="twoStepOffOpen.set(true)"
                  data-action="twoStepOff"
                >
                  {{ 'userRecord.twoStep.turnOff' | translate }}
                </button>
              }
              <p class="m-0 px-4 py-3 text-[13px]" data-two-step-status>
                {{ (twoStepEnabled() ? 'userRecord.twoStep.on' : 'userRecord.twoStep.off') | translate }}
              </p>
            </app-record-panel>
          }
        </div>
      </div>

      <!-- ── Dialogs ──────────────────────────────────────────────────────── -->
      <app-edit-profile-dialog
        [visible]="editProfileOpen()"
        (visibleChange)="editProfileOpen.set($event)"
        [user]="u"
        [isOwn]="isOwn()"
        [canEditPlacement]="canEditPlacement()"
        [positions]="positions()"
        [orgUnits]="orgUnits()"
        [managers]="colleagues()"
        (saved)="onSaved($event)"
      />
      <app-out-of-office-dialog
        [visible]="outOfOfficeOpen()"
        (visibleChange)="outOfOfficeOpen.set($event)"
        [user]="u"
        [coverOptions]="coverOptions()"
        (saved)="onSaved($event)"
      />
      <app-two-step-setup-dialog
        [visible]="twoStepSetupOpen()"
        (visibleChange)="twoStepSetupOpen.set($event)"
        (enabled)="twoStepHandle()?.retry()"
      />
      <app-two-step-off-dialog
        [visible]="twoStepOffOpen()"
        (visibleChange)="twoStepOffOpen.set($event)"
        (disabled)="twoStepHandle()?.retry()"
      />

      <!-- Transfer — the wizard both hosts share, on the shell (TemplateRef, so
           every opening starts at step one). -->
      <ng-template #transferTpl>
        <app-transfer-user-wizard
          [userId]="u.id"
          (saved)="onTransferSaved()"
          (cancelled)="transferOpen.set(false)"
          (dirtyChange)="transferDirty.set($event)"
        />
      </ng-template>
      <app-edit-dialog
        [visible]="transferOpen()"
        (visibleChange)="transferOpen.set($event)"
        [header]="'user.transfer.title' | translate"
        [context]="u.name"
        [content]="transferTpl"
        [dirty]="transferDirty()"
        width="640px"
      />

      <!-- Manage roles — hosted exactly as the Users list hosts it. -->
      <ng-template #manageRolesTpl>
        <app-manage-roles
          [userId]="u.id"
          [userName]="u.name"
          (saved)="onRolesSaved()"
          (cancelled)="rolesDialog.requestClose()"
          (dirtyChange)="rolesDirty.set($event)"
          (ready)="rolesRef.set($event)"
        />
      </ng-template>
      <ng-template #manageRolesFooterTpl>
        <div class="flex items-center justify-between gap-3">
          <span class="min-w-0 truncate text-[11.5px] text-[var(--am-text-secondary)]">
            {{ rolesRef()?.changeSummary() }}
          </span>
          <div class="flex shrink-0 gap-2">
            <p-button
              [label]="'common.cancel' | translate"
              severity="secondary"
              [text]="true"
              (onClick)="rolesDialog.requestClose()"
              [disabled]="!!rolesRef()?.saving()"
            />
            <p-button
              [label]="rolesSaveLabel()"
              (onClick)="onRolesSave()"
              [loading]="!!rolesRef()?.saving()"
              [disabled]="!rolesRef() || !rolesRef()!.changeCount() || !!rolesRef()?.saving()"
            />
          </div>
        </div>
      </ng-template>
      <app-edit-dialog
        #rolesDialog
        [visible]="rolesOpen()"
        (visibleChange)="rolesOpen.set($event)"
        [header]="'manageRoles.title' | translate"
        [context]="u.name"
        [content]="manageRolesTpl"
        [footer]="manageRolesFooterTpl"
        [dirty]="rolesDirty()"
      />
    }
  `,
})
export class UserRecordComponent implements OnInit, OnDestroy {
  /** ACC-232 — never wider than the page; see user-panel-grid.ts. */
  protected readonly panelGrid = USER_PANEL_GRID;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly roleService = inject(RoleService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly authService = inject(AuthService);
  private readonly access = inject(NavigationAccessService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly amConfirm = inject(AmConfirmService);
  private readonly statusActions = inject(UserStatusActionsService);

  readonly userId = this.route.snapshot.paramMap.get('id')!;
  readonly user = signal<IUserDto | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly actionMessage = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  private readonly activeUsers = signal<IUserDto[]>([]);

  readonly editProfileOpen = signal(false);
  readonly outOfOfficeOpen = signal(false);
  readonly twoStepSetupOpen = signal(false);
  readonly twoStepOffOpen = signal(false);
  readonly transferOpen = signal(false);
  readonly transferDirty = signal(false);
  readonly rolesOpen = signal(false);
  readonly rolesDirty = signal(false);
  readonly rolesRef = signal<ManageRolesComponent | null>(null);

  constructor() {
    // ACC-79 — the browser tab names the person; the H1 lives in this page's
    // own identity card rather than PageHeaderComponent.
    registerPageName(() => this.user()?.name ?? null);
  }

  // ── Who may do what ─────────────────────────────────────────────────────
  private readonly can = (permission: string): boolean => this.access.hasPermission(permission);

  /** The route's id is the signed-in person's own. Known before the record loads. */
  readonly isOwn = computed(() => this.userId === this.authService.currentUser()?.id);

  readonly canEditPlacement = computed(() => this.can('users:manage'));
  readonly canEditProfile = computed(() => this.isOwn() || this.can('users:manage'));
  readonly canSetOutOfOffice = computed(
    () => (this.isOwn() || this.can('users:manage')) && this.user()?.status === 'ACTIVE',
  );
  readonly canTransfer = computed(
    () => this.can('users:transfer') && this.user()?.status === 'ACTIVE' && !!this.user()?.primaryOrgUnitId,
  );
  private readonly statusAction = computed(() => {
    const user = this.user();
    return user ? statusActionFor(user, this.can, this.authService.currentUser()?.id) : null;
  });
  readonly canDeactivate = computed(() => this.statusAction() === 'deactivate');
  readonly canReactivate = computed(() => this.statusAction() === 'reactivate');
  readonly canRevokeInvitation = computed(() => this.statusAction() === 'revokeInvitation');
  readonly canViewRoles = computed(() => this.can('roles:view'));
  readonly canManageRoles = computed(() => this.can('roles:manage'));
  /** The two-step endpoints act on the CALLER, so only on your own record. */
  readonly canManageTwoStep = computed(() => this.isOwn());

  // ── Panels ──────────────────────────────────────────────────────────────
  readonly rolesHandle = signal<RequestOutcomeHandle<UserRoleGrantDto> | null>(null);
  readonly rolesOutcome = computed<RequestOutcome<unknown> | null>(() => this.rolesHandle()?.outcome() ?? null);
  readonly twoStepHandle = signal<RequestOutcomeHandle<{ enabled: boolean }> | null>(null);
  readonly twoStepOutcome = computed<RequestOutcome<unknown> | null>(() => this.twoStepHandle()?.outcome() ?? null);
  readonly twoStepEnabled = computed<boolean | null>(() => {
    const outcome = this.twoStepHandle()?.outcome();
    return outcome?.status === 'rows' ? outcome.data[0].enabled : null;
  });

  readonly roleRows = computed<RoleRow[]>(() => {
    this.translate.currentLang();
    const outcome = this.rolesHandle()?.outcome();
    if (outcome?.status !== 'rows') return [];
    const grants = [...outcome.data];
    const derived = grants.filter((g) => g.source !== 'DIRECT').map((g) => this.derivedRow(g));
    const direct = grants
      .filter((g) => g.source === 'DIRECT')
      .map((g) => ({
        id: g.id,
        name: this.languageService.bilingual(g.role.nameEn, g.role.nameAr),
        detail: this.translate.instant('manageRoles.grantedOn', { date: this.format.date(g.grantedAt) }),
        derived: false,
      }));
    return [...derived, ...direct];
  });

  /**
   * A grant through a head position names that position when it is the one
   * the record shows — the grant's ids against the record's own, named from
   * the record's references, so no position or unit list is needed. Anything
   * else is named generically rather than left blank.
   */
  private derivedRow(grant: UserRoleGrantDto): RoleRow {
    const user = this.user();
    const refs = user?.references;
    const position =
      grant.grantedViaHeadPositionId && grant.grantedViaHeadPositionId === user?.positionId ? refs?.position : null;
    const unit =
      grant.grantedViaHeadPositionOrgUnitId && grant.grantedViaHeadPositionOrgUnitId === user?.primaryOrgUnitId
        ? refs?.primaryOrgUnit
        : null;
    const sentence = position
      ? this.translate.instant('userRecord.roles.fromPosition', { position: this.name(position) })
      : this.translate.instant('userRecord.roles.fromPositionUnnamed');
    const scope =
      grant.source === 'HEAD_POSITION_ORG_WIDE'
        ? this.translate.instant('manageRoles.scopeOrgWide')
        : unit
          ? this.translate.instant('manageRoles.scopeUnitOnly', { unit: this.name(unit) })
          : null;
    return {
      id: grant.id,
      name: this.languageService.bilingual(grant.role.nameEn, grant.role.nameAr),
      detail: scope ? `${sentence} · ${scope}` : sentence,
      derived: true,
    };
  }

  // ── The header ──────────────────────────────────────────────────────────
  readonly initials = computed(() => {
    const words = (this.user()?.name ?? '').replace(/^(dr|mr|mrs|ms|eng)\.?\s+/i, '').split(/\s+/).filter(Boolean);
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  });

  readonly facts = computed<Fact[]>(() => {
    this.translate.currentLang();
    const user = this.user();
    if (!user) return [];
    const refs = user.references;
    const facts: Fact[] = [
      { key: 'position', labelKey: 'user.position', value: this.nameOrDash(refs?.position) },
      { key: 'unit', labelKey: 'user.primaryOrgUnit', value: this.nameOrDash(refs?.primaryOrgUnit) },
      { key: 'manager', labelKey: 'user.manager', value: refs?.manager ?? '—' },
    ];
    if (user.actingOrgUnitId) {
      const unit = this.nameOrDash(refs?.actingOrgUnit);
      facts.push({
        key: 'actingIn',
        labelKey: 'userRecord.actingIn',
        value: user.actingOrgUnitUntil
          ? this.translate.instant('userRecord.actingUntil', { unit, date: this.format.date(user.actingOrgUnitUntil) })
          : unit,
      });
    }
    if (user.outOfOfficeFrom || user.outOfOfficeTo) {
      facts.push({ key: 'outOfOffice', labelKey: 'userRecord.outOfOffice', value: this.outOfOfficeLine(user) });
    }
    if (user.status === 'INVITED') {
      facts.push({ key: 'invited', labelKey: 'userRecord.invitedOn', value: this.format.date(user.createdAt) });
    } else {
      facts.push({
        key: 'lastSignIn',
        labelKey: 'user.lastLogin',
        value: user.lastLoginAt
          ? this.format.dateTime(user.lastLoginAt)
          : this.translate.instant('userRecord.neverSignedIn'),
      });
    }
    return facts;
  });

  private outOfOfficeLine(user: IUserDto): string {
    const from = user.outOfOfficeFrom ? this.format.date(user.outOfOfficeFrom) : null;
    const to = user.outOfOfficeTo ? this.format.date(user.outOfOfficeTo) : null;
    const window =
      from && to
        ? this.translate.instant('userRecord.outOfOfficeRange', { from, to })
        : from
          ? this.translate.instant('userRecord.outOfOfficeFromOnly', { from })
          : this.translate.instant('userRecord.outOfOfficeToOnly', { to });
    const cover = user.references?.actingUser;
    return cover ? `${window} · ${this.translate.instant('userRecord.coveredBy', { name: cover })}` : window;
  }

  private name(n: IBilingualNameDto): string {
    return this.languageService.bilingual(n.nameEn, n.nameAr);
  }

  private nameOrDash(n: IBilingualNameDto | null | undefined): string {
    return n ? this.name(n) : '—';
  }

  // ── Dialog options ──────────────────────────────────────────────────────
  /** Active colleagues, with their unit — the manager and cover pickers. */
  readonly colleagues = computed<CoverOption[]>(() => {
    const units = new Map(this.orgUnits().map((u) => [u.id, orgUnitDisplayName(u)]));
    return this.activeUsers()
      .filter((u) => u.id !== this.userId)
      .map((u) => ({ id: u.id, name: u.name, unit: u.primaryOrgUnitId ? (units.get(u.primaryOrgUnitId) ?? '') : '' }));
  });

  /**
   * Without users:view there is no colleague list, so the cover picker could
   * not even show who covers TODAY. Seeded with that one person from the
   * record's references (as the profile page did).
   */
  readonly coverOptions = computed<CoverOption[]>(() => {
    if (this.can('users:view')) return this.colleagues();
    const user = this.user();
    const name = user?.references?.actingUser;
    return user?.actingUserId && name ? [{ id: user.actingUserId, name, unit: '' }] : [];
  });

  /** "Save 2 changes" — the Users list's own label (ACC-120 slice 5). */
  readonly rolesSaveLabel = computed(() => {
    this.translate.currentLang();
    const n = this.rolesRef()?.changeCount() ?? 0;
    return n > 0
      ? this.format.count('manageRoles.saveChanges', n)
      : this.translate.instant('manageRoles.saveNoChanges');
  });

  ngOnInit(): void {
    this.loadUser();

    if (this.canViewRoles()) {
      this.rolesHandle.set(
        createRequestOutcome(() => this.roleService.getUserRoles(this.userId), {
          describeEmpty: () => ({ reason: '', filtered: false }),
        }),
      );
    }
    if (this.isOwn()) {
      this.twoStepHandle.set(
        createRequestOutcome(() => this.authService.getMfaStatus().pipe(map((status) => [status])), {
          describeEmpty: () => ({ reason: '', filtered: false }),
        }),
      );
    }

    // ACC-79 — each list only when the viewer can read it AND a dialog here
    // can use it. Without the permission the request can only 403.
    if (this.canEditPlacement() && this.can('positions:view')) {
      this.orgPositionService.listPositions().subscribe({ next: (p) => this.positions.set(p) });
    }
    if (this.can('org:view') && (this.canEditPlacement() || this.can('users:view'))) {
      this.orgUnitService.getFlat().subscribe({ next: (u) => this.orgUnits.set(u) });
    }
    if (this.can('users:view')) {
      this.userService.listAllUsers({ status: 'ACTIVE' }).subscribe({ next: (u) => this.activeUsers.set(u) });
    }
  }

  ngOnDestroy(): void {
    this.rolesHandle()?.destroy();
    this.twoStepHandle()?.destroy();
  }

  private loadUser(): void {
    this.userService.getById(this.userId).subscribe({
      next: (u) => {
        this.user.set(u);
        this.loadError.set(null);
      },
      error: () => this.loadError.set('user.errorLoad'),
    });
  }

  /** A save answers without references; re-read so the header names them. */
  onSaved(saved: IUserDto): void {
    this.user.update((current) => (current ? { ...saved, references: current.references } : saved));
    this.loadUser();
  }

  openTransfer(): void {
    this.transferDirty.set(false);
    this.transferOpen.set(true);
  }

  onTransferSaved(): void {
    this.transferDirty.set(false);
    this.transferOpen.set(false);
    this.loadUser();
    this.rolesHandle()?.retry();
  }

  openManageRoles(): void {
    this.rolesRef.set(null);
    this.rolesDirty.set(false);
    this.rolesOpen.set(true);
  }

  /** The Users list's last-role confirm, unchanged. */
  onRolesSave(): void {
    const form = this.rolesRef();
    if (!form) return;
    if (!form.wouldLeaveWithNoRoles()) {
      form.onSubmit();
      return;
    }
    this.amConfirm.ask({
      tone: 'destructive',
      header: this.translate.instant('manageRoles.confirmNoRolesTitle', { name: this.user()?.name ?? '' }),
      message: this.translate.instant('manageRoles.confirmNoRolesBody'),
      acceptLabel: this.translate.instant('manageRoles.confirmNoRolesAccept'),
      rejectLabel: this.translate.instant('common.cancel'),
      accept: () => form.onSubmit(),
    });
  }

  onRolesSaved(): void {
    this.rolesOpen.set(false);
    this.rolesDirty.set(false);
    this.rolesHandle()?.retry();
  }

  runStatusAction(action: 'deactivate' | 'reactivate' | 'revokeInvitation'): void {
    const user = this.user();
    if (!user) return;
    this.actionMessage.set(null);
    this.actionError.set(null);
    this.statusActions.confirm(action, user, {
      succeeded: (message) => {
        // A revoked invitation deletes the record: there is no page to stay on.
        if (action === 'revokeInvitation') {
          void this.router.navigate(['/users']);
          return;
        }
        this.actionMessage.set(message);
        this.loadUser();
        this.rolesHandle()?.retry();
      },
      failed: (message) => this.actionError.set(message),
    });
  }
}
