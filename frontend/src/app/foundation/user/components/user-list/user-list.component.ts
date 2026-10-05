import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { UserService, IUserDto } from '../../services/user.service';
import {
  OrgPositionService,
  IOrgPositionDto,
} from '../../../org-position/services/org-position.service';
import {
  OrgUnitService,
  OrgUnitDto,
  buildOrgUnitCascadeOptions,
} from '../../../organization/services/org-unit.service';
import { InviteUserComponent } from '../invite-user/invite-user.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { ManageRolesComponent } from '../../../roles/components/manage-roles/manage-roles.component';
import {
  DataListColumn,
  DataListComponent,
  DataListScope,
} from '../../../../shared/components/data-list/data-list.component';
import { DataListSource } from '../../../../shared/components/data-list/data-list.source';
import { StatusChipComponent } from '../../../../shared/components/status-chip/status-chip.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { RoleService, UserRoleGrantDto } from '../../../roles/services/role.service';
import { LanguageService } from '../../../../core/services/language.service';
import { TransferUserWizardComponent } from '../transfer-user-wizard/transfer-user-wizard.component';
import { AmDateTimePipe, FormatService } from '../../../../core/formatting';
import { ListRowDirective } from '../../../../shared/components/data-list/list-row.directive';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';

export type RowAction =
  | 'manageRoles'
  | 'transfer'
  // ACC-83 — ONE status slot, filled by the row's own status: ACTIVE gets
  // Deactivate, INACTIVE gets Reactivate, INVITED gets Revoke invitation.
  | 'deactivate'
  | 'reactivate'
  | 'revokeInvitation';

// ACC-78 — the full-page table, rebuilt against
// frontend/design-reference/AccreditMe Users List.dc.html.
//
// Seven labelled columns with click-to-sort headers, a real pager, the
// three-filter bar (status chips with counts, org unit, position), a column
// chooser, and Edit labelled beside a More menu. The first attempt rendered
// the compact panel's two-line cell here and built no header row, no
// click-to-sort and no pager at all — none of which was gated on row count;
// they were simply absent. (This page's own search DID render, since the
// tenant has 25 users and the toolbar threshold is 12. The threshold cost
// Roles its search, not this page.)
@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [PageHeaderComponent, 
    AmDateTimePipe,
    TranslatePipe,
    ButtonModule,
    MenuModule,
    TooltipModule,
    FormsModule,
    InviteUserComponent,
    EditDialogComponent,
    ManageRolesComponent,
    DataListComponent,
    StatusChipComponent,
    OverlaySelectComponent,
    TransferUserWizardComponent,
    ListRowDirective,
    IconButtonComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">
      <app-page-header [title]="'user.title' | translate">
        <div pageActions>
          @if (canCreate()) {
            <p-button [label]="'user.invite' | translate" icon="pi pi-plus" (onClick)="onInvite()" />
          }
        </div>
      </app-page-header>

      <!-- ACC-83 — THE SPACE IS RESERVED, so a message cannot move the rows.
           These two blocks were inserted into normal flow, so either appearing
           pushed the whole table down by roughly 60px. On a list whose row menu
           holds an irreversible action that is not a cosmetic problem: Ahmad
           deactivated the wrong person with it, by clicking the position a row
           had occupied a moment earlier, after a refusal banner appeared.
           A fixed min-height holds the slot whether or not anything is in it.
           Reserved rather than taken out of flow deliberately: an overlay would
           cover the first row, which is the thing the reader is looking at. -->
      <div class="min-h-[2.5rem]">
        @if (error()) {
          <p class="m-0 text-red-500">{{ error() | translate }}</p>
        }
        @if (infoMessage()) {
          <p class="m-0 text-sm text-[var(--am-text-primary)]">{{ infoMessage() }}</p>
        }
      </div>

      <div
        class="rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] overflow-hidden flex flex-col min-h-0"
      >
        <app-data-list
          #list
          variant="page"
          [source]="source"
          [trackBy]="trackById"
          [columns]="columns()"
          [scopes]="scopes()"
          [filterNames]="filterNames"
          [searchPlaceholder]="'user.searchPlaceholder' | translate"
          [emptyTitle]="'user.noUsers' | translate"
          [emptyMessage]="'user.noUsersBody' | translate"
          persistKey="users"
          [urlSync]="true"
        >
          <!-- The two pickers are projected: only this list knows that its org
               unit filter is a hierarchy and its position filter is flat. -->
          <!-- optionGroupChildren is "items", NOT "children".
               buildOrgUnitCascadeOptions() emits
               OrgUnitCascadeOption { label, value, items? }, and every other
               org-unit picker passes "items" (invite-user, user-profile,
               org-unit-form). Passing "children" made flattenHierarchy() find
               no descendants, so all 21 units collapsed to the single root —
               a filter that silently offered one choice instead of a tree. -->
          <div listFilters class="flex items-center gap-1.5 shrink-0">
            <!-- Wider than the English labels need. Arabic renders these
                 longer — "كل الوحدات التنظيمية" truncated at 170px, which was
                 only visible in an Arabic screenshot. Sized for the longer of
                 the two languages rather than the one being developed in. -->
            <app-overlay-select
              class="w-[210px]"
              [options]="orgUnitOptions()"
              optionLabel="label"
              optionValue="value"
              optionGroupLabel="label"
              optionGroupChildren="items"
              [groupsSelectable]="true"
              [showClear]="true"
              [placeholder]="'user.allOrgUnits' | translate"
              [ngModel]="list.filterValue('orgUnitId')"
              (ngModelChange)="list.setFilter('orgUnitId', $event)"
            />
            <app-overlay-select
              class="w-[210px]"
              [options]="positionOptions()"
              optionLabel="label"
              optionValue="value"
              [showClear]="true"
              [placeholder]="'user.allPositions' | translate"
              [ngModel]="list.filterValue('positionId')"
              (ngModelChange)="list.setFilter('positionId', $event)"
            />
          </div>

          <!-- Header cells sit in the same grid as the row, both reading
               --am-list-cols, so they cannot drift out of alignment. -->
          <ng-template #listHeader let-h>
            @for (column of columns(); track column.key) {
              @if (h.visible(column.key)) {
                @if (column.sortBy) {
                  <button
                    type="button"
                    class="flex items-center gap-1 text-start uppercase hover:text-[var(--am-blue-primary)]"
                    [class.text-[var(--am-blue-primary)]]="h.sortBy === column.sortBy"
                    (click)="h.sort(column.key)"
                  >
                    {{ column.label }}
                    @if (h.sortBy === column.sortBy) {
                      <i
                        class="pi text-[9px]"
                        [class.pi-arrow-up]="h.sortDir !== 'desc'"
                        [class.pi-arrow-down]="h.sortDir === 'desc'"
                      ></i>
                    }
                  </button>
                } @else {
                  <span>{{ column.label }}</span>
                }
              }
            }
            <span></span>
          </ng-template>

          <ng-template #listRow let-user let-v="visible">
            <!-- ACC-111 — the row's keyboard contract lives in amListRow: one
                 tab stop for the table, arrows between rows, Enter opens,
                 →/← reach the row's own actions. The key is what lets focus
                 follow this RECORD after an edit re-sorts the list. -->
            <div
              amListRow
              [amListRowKey]="user.id"
              (rowOpen)="onView(user)"
              class="grid items-center gap-3 px-3 py-2 cursor-pointer"
              style="grid-template-columns: var(--am-list-cols)"
              (click)="onView(user)"
            >
              @if (v('name')) {
                <span class="text-[13px] font-medium truncate">{{ user.name }}</span>
              }
              @if (v('email')) {
                <span
                  dir="ltr"
                  style="unicode-bidi: isolate"
                  class="text-xs text-[var(--am-text-secondary)] truncate text-start"
                  >{{ user.email }}</span
                >
              }
              @if (v('position')) {
                <span class="text-xs truncate">{{ positionName(user.positionId) }}</span>
              }
              @if (v('orgUnit')) {
                <span class="text-xs truncate">{{ orgUnitName(user.primaryOrgUnitId) }}</span>
              }
              @if (v('manager')) {
                <span class="text-xs truncate">{{ managerName(user.managerId) }}</span>
              }
              @if (v('status')) {
                <span class="text-xs">
                  <app-status-chip
                    variant="user"
                    labelPrefix="user.status"
                    [value]="user.status"
                  />
                </span>
              }
              @if (v('lastLogin')) {
                <span
                  dir="ltr"
                  style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
                  class="text-xs text-[var(--am-text-secondary)] text-start"
                >
                  {{ user.lastLoginAt | amDateTime }}
                </span>
              }

              <div class="flex items-center gap-1 shrink-0" (click)="$event.stopPropagation()">
                <!-- LABELLED, per the reference: the common action should be
                     readable rather than an icon whose meaning appears only on
                     hover.

                     ACC-123 — it reads OPEN, not Edit. It calls onView(), which
                     navigates to the profile; it opens no form and saves
                     nothing. Found while walking this page as READ_ONLY_ADMIN:
                     the row menu beside it is correctly suppressed for someone
                     with no write permission, so this button was the only thing
                     on the page promising a write to a person who has none. Not
                     a gating hole — a label describing the wrong action, which
                     was equally wrong for every other role and simply easier to
                     see from there. -->
                <p-button
                  [label]="'common.open' | translate"
                  size="small"
                  [text]="true"
                  (onClick)="onView(user)"
                />
                <!-- ACC-79 — only when the row HAS actions. It used to render
                     on every row and open an empty box for an inactive user. -->
                @if (rowActionsFor(user).length > 0) {
                  <!-- The label names the OBJECT: twenty rows otherwise give a
                       screen-reader user twenty identical "More actions". -->
                  <am-icon-button
                    icon="pi pi-ellipsis-h"
                    [label]="'list.moreFor' | translate: { name: user.name }"
                    (activated)="openRowMenu(user, $event)"
                  />
                }
              </div>
            </div>
          </ng-template>
        </app-data-list>
      </div>

      <p-menu #rowMenu [model]="rowMenuItems()" [popup]="true" />
    </div>

    <ng-template #inviteTpl>
      <app-invite-user
        (saved)="onInviteSaved()"
        (cancelled)="inviteDialog.requestClose()"
        (dirtyChange)="inviteDirty.set($event)"
        (ready)="inviteFormRef.set($event)"
      />
    </ng-template>
    <!-- Declared HERE, not inside the form: p-dialog collects its pTemplate
         children at content init, so a footer arriving later never lands.
         Keeping the actions out of the body is also what keeps the body under
         the 420 cap — with them inside, Arabic measured 434 and scrolled.

         CANCEL GOES THROUGH requestClose(), never straight to visible=false.
         That is the single place the unsaved-work question is asked; Escape and
         the header's ✕ already arrive there, and a Cancel that bypasses it
         discards a part-typed invitation without a word. -->
    <ng-template #inviteFooterTpl>
      <div class="flex justify-end gap-2">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="inviteDialog.requestClose()"
          [disabled]="!!inviteFormRef()?.saving()"
        />
        <p-button
          [label]="'user.sendInvitation' | translate"
          (onClick)="inviteFormRef()?.onSubmit()"
          [loading]="!!inviteFormRef()?.saving()"
          [disabled]="!inviteFormRef() || !!inviteFormRef()?.saving() || !!inviteFormRef()?.denied()"
        />
      </div>
    </ng-template>
    <!-- ACC-120 slice 5 — [dirty] is an opt-in input on the DIALOG, and
         invite-user sits inside it, so the state travels outward through
         (dirtyChange). Without it, Escape discards a half-typed invitation
         silently. density="compact" is declared ONCE for the whole dialog,
         never per field: the drawing measures five compact blocks at 411/420
         in English and 436 in Arabic, which is why Name and Email share a
         row. -->
    <app-edit-dialog
      #inviteDialog
      [(visible)]="inviteVisible"
      [header]="'user.invite' | translate"
      [content]="inviteTpl"
      [footer]="inviteFooterTpl"
      density="compact"
      [dirty]="inviteDirty()"
    />

    <!-- ACC-79 — the same wizard the user profile hosts (ACC-46), opened from
         the row. A TemplateRef, so each opening gets a fresh wizard at step
         one rather than the last user's half-finished state (ACC-29). -->
    <ng-template #transferTpl>
      @if (transferUser(); as u) {
        <app-transfer-user-wizard
          [userId]="u.id"
          (saved)="onTransferSaved()"
          (cancelled)="transferVisible.set(false)"
        />
      }
    </ng-template>
    <app-edit-dialog
      [(visible)]="transferVisible"
      [header]="'user.transfer.title' | translate"
      [content]="transferTpl"
      width="640px"
    />

    <!-- ACC-120 slice 5 — Manage roles. A TemplateRef so each opening rebuilds
         it: reopening on a different person must not inherit the last one's
         ticks (ACC-29). -->
    <ng-template #manageRolesTpl>
      @if (rolesUser(); as u) {
        <app-manage-roles
          [userId]="u.id"
          [userName]="u.name"
          (saved)="onRolesSaved()"
          (cancelled)="rolesDialog.requestClose()"
          (dirtyChange)="rolesDirty.set($event)"
          (ready)="rolesRef.set($event)"
        />
      }
    </ng-template>
    <ng-template #manageRolesFooterTpl>
      <div class="flex items-center justify-between gap-3">
        <!-- The footer names every change in words. A count alone makes the
             reader scroll back up the list to find out what they did. -->
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
      [(visible)]="rolesVisible"
      [header]="'manageRoles.title' | translate"
      [context]="rolesUser()?.name ?? ''"
      [content]="manageRolesTpl"
      [footer]="manageRolesFooterTpl"
      [dirty]="rolesDirty()"
    />
  `,
})
export class UserListComponent implements OnInit {
  @ViewChild('inviteTpl', { read: TemplateRef, static: true }) inviteTpl!: TemplateRef<unknown>;
  @ViewChild('rowMenu') rowMenu!: { toggle: (event: Event) => void };

  private readonly userService = inject(UserService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  // ACC-83 — the reactivation confirmation names the roles the person returns
  // holding, which means reading them before the dialog opens.
  private readonly roleService = inject(RoleService);
  private readonly languageService = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly access = inject(NavigationAccessService);
  private readonly navigationAccess = inject(NavigationAccessService);

  // ACC-118 — found by check:create-gating, not by the ticket's own list of
  // ten. Hidden, not disabled, same as every other page-header create action.
  // POST /users/invite enforces USERS_PERMISSIONS.INVITE — users:invite, NOT
  // users:manage. Both exist and they are not the same (user.controller.ts).
  readonly canCreate = computed(() => this.navigationAccess.hasPermission('users:invite'));

  readonly list = viewChild.required<DataListComponent<IUserDto>>('list');
  readonly transferVisible = signal(false);
  readonly transferUser = signal<IUserDto | null>(null);

  readonly error = signal<string | null>(null);
  readonly infoMessage = signal<string | null>(null);
  readonly inviteVisible = signal(false);
  readonly inviteDirty = signal(false);
  readonly inviteFormRef = signal<InviteUserComponent | null>(null);

  // ACC-120 slice 5 — Manage roles.
  readonly rolesVisible = signal(false);
  readonly rolesUser = signal<IUserDto | null>(null);
  readonly rolesDirty = signal(false);
  readonly rolesRef = signal<ManageRolesComponent | null>(null);

  /**
   * "Save 2 changes" / "Save 1 change" / "Save" — the button says what it will
   * do.
   *
   * THROUGH THE PLURAL CATALOGUE, not a flat key with {{count}} in it. The first
   * attempt read "Save 1 changes" in English, which is the exact defect the
   * plural rule exists for (ACC-94): a counted string is a plural object with
   * every category the language has, six for Arabic, never one fixed form.
   */
  readonly rolesSaveLabel = computed(() => {
    this.translate.currentLang();
    const n = this.rolesRef()?.changeCount() ?? 0;
    return n > 0
      ? this.format.count('manageRoles.saveChanges', n)
      : this.translate.instant('manageRoles.saveNoChanges');
  });
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  readonly statusCounts = signal<Record<string, number>>({});
  readonly menuUser = signal<IUserDto | null>(null);
  // Resolves managerId to a name. Read through listAllUsers() rather than the
  // current page: a manager is very often not on the same page as their report.
  readonly allUsers = signal<IUserDto[]>([]);

  readonly filterNames = ['orgUnitId', 'positionId'] as const;

  // ARROW PROPERTY, NOT A METHOD. DataListComponent reads this as a signal
  // input, so a bound method would be a new reference on every change
  // detection and refetch in a loop.
  readonly source: DataListSource<IUserDto> = (query) =>
    this.userService.listUsers({
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      // The scope chip maps to THIS endpoint's own status filter. The list
      // component carries the scope without knowing what it means.
      status: query.scope ?? undefined,
      orgUnitId: query.filters?.['orgUnitId'] ?? undefined,
      positionId: query.filters?.['positionId'] ?? undefined,
    });

  readonly trackById = (user: IUserDto): string => user.id;

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    return [
      // Name is alwaysVisible: a user list with the name column hidden is a
      // list of nothing.
      {
        key: 'name',
        label: this.translate.instant('user.name'),
        sortBy: 'name',
        alwaysVisible: true,
        width: '1.4fr',
      },
      {
        key: 'email',
        label: this.translate.instant('user.email'),
        sortBy: 'email',
        width: '1.6fr',
      },
      { key: 'position', label: this.translate.instant('user.position'), width: '1.1fr' },
      { key: 'orgUnit', label: this.translate.instant('user.primaryOrgUnit'), width: '1.1fr' },
      { key: 'manager', label: this.translate.instant('user.manager'), width: '1.1fr' },
      {
        key: 'status',
        label: this.translate.instant('user.status.title'),
        sortBy: 'status',
        width: '0.8fr',
      },
      {
        key: 'lastLogin',
        label: this.translate.instant('user.lastLogin'),
        sortBy: 'lastLoginAt',
        width: '1fr',
      },
    ];
  });

  readonly scopes = computed<DataListScope[]>(() => {
    this.translate.currentLang();
    const counts = this.statusCounts();
    return [
      { key: 'ACTIVE', label: this.translate.instant('user.status.active'), count: counts['ACTIVE'] },
      {
        key: 'INVITED',
        label: this.translate.instant('user.status.invited'),
        count: counts['INVITED'],
      },
      {
        key: 'INACTIVE',
        label: this.translate.instant('user.status.inactive'),
        count: counts['INACTIVE'],
      },
    ];
  });

  // Same hierarchy shape every other org-unit picker uses (ACC-42). No unit is
  // excluded and the walk starts at the roots, so the filter offers the whole
  // tree.
  readonly orgUnitOptions = computed(() =>
    buildOrgUnitCascadeOptions(this.orgUnits(), null, null),
  );

  readonly positionOptions = computed(() =>
    this.positions().map((p) => ({ label: p.nameEn, value: p.id })),
  );

  /**
   * The actions this row's More menu offers — the one place that decides, read
   * both by the menu and by whether the "…" button renders at all.
   *
   * Each is gated on BOTH its permission and the states the backend accepts, so
   * the menu never offers something that would come back 403 or 409:
   *   transfer    users:transfer, ACTIVE, and a current org unit to move from
   *               (transferUser() rejects anything else)
   *   deactivate  users:deactivate, and not already INACTIVE
   *
   * ACC-79 corrected ACC-78 here. ACC-78 left Transfer out as "filler" because
   * the profile page also has it, but the reference puts it in this menu, and
   * it offered Deactivate to anyone who could see the list. Still missing, and
   * ticketed rather than built: Reactivate (INACTIVE) and Revoke invitation
   * (INVITED), the reference's other status actions — neither has an endpoint.
   */
  rowActionsFor(user: IUserDto): RowAction[] {
    const actions: RowAction[] = [];
    // ACC-120 — roles:manage, which is what POST and DELETE
    // /users/:id/roles both carry. Offered for an INACTIVE user too: their
    // roles are still real and still decide what they can do if reactivated.
    if (this.access.hasPermission('roles:manage')) {
      actions.push('manageRoles');
    }
    if (
      this.access.hasPermission('users:transfer') &&
      user.status === 'ACTIVE' &&
      !!user.primaryOrgUnitId
    ) {
      actions.push('transfer');
    }
    // ACC-83 — THE STATUS SLOT, one action chosen by the row's status rather
    // than Deactivate for everything that is not already INACTIVE.
    //
    // Deactivate was being offered to an INVITED user, where it is the wrong
    // action and not a cosmetic mismatch: it ran the whole departure flow on
    // someone who never arrived, including telling every admin they had left.
    //
    // Each is still gated on BOTH its permission and the status the backend
    // accepts, so the menu never offers something that comes back 403 or 409.
    if (user.status === 'ACTIVE' && this.access.hasPermission('users:deactivate')) {
      actions.push('deactivate');
    } else if (user.status === 'INACTIVE' && this.access.hasPermission('users:reactivate')) {
      actions.push('reactivate');
    } else if (user.status === 'INVITED' && this.access.hasPermission('users:invite')) {
      actions.push('revokeInvitation');
    }
    return actions;
  }

  readonly rowMenuItems = computed<MenuItem[]>(() => {
    this.translate.currentLang();
    const user = this.menuUser();
    if (!user) return [];

    // ACC-83 — a lookup rather than a ternary chain. Three actions nested as
    // ?: was already at its limit; five would be unreadable, and the next
    // person adding one would be editing the shape rather than adding a row.
    const items: Record<RowAction, MenuItem> = {
      manageRoles: {
        label: this.translate.instant('manageRoles.menuAction'),
        icon: 'pi pi-id-card',
        command: () => this.openManageRoles(user),
      },
      transfer: {
        label: this.translate.instant('user.transfer.menuAction'),
        icon: 'pi pi-arrow-right-arrow-left',
        command: () => this.openTransfer(user),
      },
      deactivate: {
        label: this.translate.instant('user.deactivate'),
        icon: 'pi pi-user-minus',
        command: () => this.confirmDeactivate(user),
      },
      reactivate: {
        label: this.translate.instant('user.reactivate'),
        icon: 'pi pi-user-plus',
        command: () => this.confirmReactivate(user),
      },
      revokeInvitation: {
        label: this.translate.instant('user.revokeInvitation'),
        icon: 'pi pi-times-circle',
        command: () => this.confirmRevokeInvitation(user),
      },
    };

    return this.rowActionsFor(user).map((action) => items[action]);
  });

  ngOnInit(): void {
    this.orgPositionService
      .listPositions()
      .subscribe({ next: (positions) => this.positions.set(positions) });
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
    this.userService.listAllUsers().subscribe({ next: (users) => this.allUsers.set(users) });
    this.loadCounts();
  }

  private loadCounts(): void {
    this.userService.getStatusCounts().subscribe({
      next: (counts: Record<string, number>) => this.statusCounts.set(counts),
      // A chip without its count is still a working filter, so a failure here
      // must not take the list down with it.
      error: () => this.statusCounts.set({}),
    });
  }

  positionName(positionId: string | null): string {
    if (!positionId) return '—';
    return this.positions().find((p) => p.id === positionId)?.nameEn ?? positionId;
  }

  orgUnitName(orgUnitId: string | null): string {
    if (!orgUnitId) return '—';
    return this.orgUnits().find((u) => u.id === orgUnitId)?.nameEn ?? orgUnitId;
  }

  managerName(managerId: string | null): string {
    if (!managerId) return '—';
    return this.allUsers().find((u) => u.id === managerId)?.name ?? '—';
  }

  onInvite(): void {
    this.inviteDirty.set(false);
    this.inviteVisible.set(true);
  }

  onInviteSaved(): void {
    // Cleared before closing: the dialog is reopened with a fresh component
    // (TemplateRef), but this signal lives on the host and would otherwise
    // still read dirty on the next open, making Escape ask about nothing.
    this.inviteDirty.set(false);
    this.inviteVisible.set(false);
    this.list().reload();
    this.loadCounts();
  }

  openManageRoles(user: IUserDto): void {
    this.rolesRef.set(null);
    this.rolesDirty.set(false);
    this.rolesUser.set(user);
    this.rolesVisible.set(true);
  }

  /**
   * The last-role confirm (the drawing's 420 dialog). Asked only when saving
   * would leave the person holding NOTHING — no direct grant and no
   * head-position grant either, because someone who still holds a derived role
   * is not left with none.
   */
  onRolesSave(): void {
    const form = this.rolesRef();
    if (!form) return;
    if (!form.wouldLeaveWithNoRoles()) {
      form.onSubmit();
      return;
    }
    this.confirmationService.confirm({
      header: this.translate.instant('manageRoles.confirmNoRolesTitle', {
        name: this.rolesUser()?.name ?? '',
      }),
      message: this.translate.instant('manageRoles.confirmNoRolesBody'),
      acceptLabel: this.translate.instant('manageRoles.confirmNoRolesAccept'),
      rejectLabel: this.translate.instant('common.cancel'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => form.onSubmit(),
    });
  }

  onRolesSaved(): void {
    this.rolesVisible.set(false);
    this.rolesDirty.set(false);
  }

  onView(user: IUserDto): void {
    void this.router.navigate(['/users', user.id]);
  }

  openRowMenu(user: IUserDto, event: Event): void {
    this.menuUser.set(user);
    this.rowMenu.toggle(event);
  }

  openTransfer(user: IUserDto): void {
    this.infoMessage.set(null);
    this.transferUser.set(user);
    this.transferVisible.set(true);
  }

  onTransferSaved(): void {
    this.transferVisible.set(false);
    this.list().reload();
  }

  // Per step-09 plan Section 12, Discussion 5: shows the user's name and a
  // qualitative impact statement up front — the EXACT count of tasks affected
  // is only known once the backend actually runs the departure flow (there is
  // no preview endpoint), so the real counts are surfaced as an info message
  // immediately after the action completes instead of guessed at in the
  // confirmation copy.
  confirmDeactivate(user: IUserDto): void {
    this.infoMessage.set(null);
    this.confirmationService.confirm({
      message: this.translate.instant('user.deactivateConfirm', { name: user.name }),
      header: this.translate.instant('user.deactivate'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.userService.deactivate(user.id).subscribe({
          next: ({ reassignedCount, unassignedCount }) => {
            this.infoMessage.set(
              // Two counts, two plural forms: one rule cannot agree with both.
              this.translate.instant('user.deactivateSummary', {
                reassigned: this.format.count('user.tasksReassigned', reassignedCount),
                flagged: this.format.count('user.tasksFlaggedUnassigned', unassignedCount),
              }),
            );
            this.list().reload();
            this.loadCounts();
          },
          error: (err: unknown) => {
            this.error.set(extractErrorMessage(err, 'Deactivate failed'));
          },
        });
      },
    });
  }

  /**
   * ACC-83 — reactivation says what COMES BACK, before the click.
   *
   * ACC-83 already required the confirmation to state what does not come back
   * (reassigned tasks). The other half matters more: UserRole rows survive
   * deactivation, so a reactivated person returns holding every direct role
   * they had — possibly Organization Administrator. An administrator should see
   * the authority they are about to restore while deciding, not discover it
   * afterwards on the Roles screen.
   *
   * So the roles are fetched FIRST and the dialog waits for them. If that read
   * is refused — a caller may hold users:reactivate without users:view, and
   * GET /users/:id/roles needs the parent permission (ACC-101) — the dialog
   * still opens and SAYS the roles could not be listed, rather than implying
   * there are none. A blank where authority should be named is the worst of
   * the three outcomes.
   */
  confirmReactivate(user: IUserDto): void {
    this.infoMessage.set(null);
    this.error.set(null);
    this.roleService.getUserRoles(user.id).subscribe({
      next: (grants: UserRoleGrantDto[]) =>
        this.openReactivateConfirm(
          user,
          grants.map((g) => g.role),
          false,
        ),
      error: () => this.openReactivateConfirm(user, [], true),
    });
  }

  private openReactivateConfirm(
    user: IUserDto,
    roles: { nameEn: string; nameAr: string | null }[],
    rolesUnavailable: boolean,
  ): void {
    const roleLine = rolesUnavailable
      ? this.translate.instant('user.reactivateRolesUnavailable')
      : roles.length === 0
        ? this.translate.instant('user.reactivateNoRoles')
        : this.translate.instant('user.reactivateRoles', {
            roles: roles
              .map((r) => this.languageService.bilingual(r.nameEn, r.nameAr))
              .join(', '),
          });

    this.confirmationService.confirm({
      // ONE key, with the roles sentence passed INTO it.
      //
      // This was three translated pieces joined by a template literal, and
      // check:confirm-translated refused it — correctly, and it caught the
      // author of the scan. Word order and punctuation belong to the
      // translation: an Arabic reader should not get an English paragraph
      // shape with Arabic words in it.
      message: this.translate.instant('user.reactivateConfirm', {
        name: user.name,
        roles: roleLine,
      }),
      header: this.translate.instant('user.reactivate'),
      icon: 'pi pi-user-plus',
      accept: () => {
        this.userService.reactivate(user.id).subscribe({
          next: ({ returnedTaskCount }) => {
            this.infoMessage.set(
              this.translate.instant('user.reactivateSummary', {
                name: user.name,
                tasks: this.format.count('user.tasksReturned', returnedTaskCount),
              }),
            );
            this.list().reload();
            this.loadCounts();
          },
          error: (err: unknown) => {
            this.error.set(extractErrorMessage(err, 'Reactivate failed'));
          },
        });
      },
    });
  }

  /**
   * ACC-83 — withdrawing an invitation, which is destructive in a way
   * deactivation is not: the row goes, so the confirmation says so plainly and
   * says the email becomes free again.
   */
  confirmRevokeInvitation(user: IUserDto): void {
    this.infoMessage.set(null);
    this.error.set(null);
    this.confirmationService.confirm({
      message: this.translate.instant('user.revokeInvitationConfirm', {
        name: user.name,
        email: user.email,
      }),
      header: this.translate.instant('user.revokeInvitation'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.userService.revokeInvitation(user.id).subscribe({
          next: () => {
            this.infoMessage.set(
              this.translate.instant('user.revokeInvitationSummary', { name: user.name }),
            );
            this.list().reload();
            this.loadCounts();
          },
          error: (err: unknown) => {
            this.error.set(extractErrorMessage(err, 'Revoke failed'));
          },
        });
      },
    });
  }
}
