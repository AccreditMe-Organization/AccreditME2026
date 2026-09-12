import {
  Component,
  OnInit,
  TemplateRef,
  ViewChild,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
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
import {
  DataListColumn,
  DataListComponent,
  DataListScope,
} from '../../../../shared/components/data-list/data-list.component';
import { DataListSource } from '../../../../shared/components/data-list/data-list.source';
import { StatusChipComponent } from '../../../../shared/components/status-chip/status-chip.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

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
  imports: [
    DatePipe,
    TranslatePipe,
    ButtonModule,
    MenuModule,
    TooltipModule,
    FormsModule,
    InviteUserComponent,
    EditDialogComponent,
    DataListComponent,
    StatusChipComponent,
    OverlaySelectComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'user.title' | translate }}</h2>
        <p-button [label]="'user.invite' | translate" icon="pi pi-plus" (onClick)="onInvite()" />
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() | translate }}</p>
      }
      @if (infoMessage()) {
        <p class="text-sm text-[var(--am-text-primary)]">{{ infoMessage() }}</p>
      }

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
              optionGroupChildren="children"
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
            <div
              class="grid items-center gap-3 px-3 py-2 border-b border-[var(--am-border)] hover:bg-[var(--am-surface)] cursor-pointer"
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
                  {{ user.lastLoginAt ? (user.lastLoginAt | date: 'short') : '—' }}
                </span>
              }

              <div class="flex items-center gap-1 shrink-0" (click)="$event.stopPropagation()">
                <!-- Edit is LABELLED, per the reference: the common action
                     should be readable rather than an icon whose meaning
                     appears only on hover. -->
                <p-button
                  [label]="'common.edit' | translate"
                  size="small"
                  [text]="true"
                  (onClick)="onView(user)"
                />
                <p-button
                  icon="pi pi-ellipsis-h"
                  size="small"
                  [text]="true"
                  [pTooltip]="'list.more' | translate"
                  (onClick)="openRowMenu(user, $event)"
                />
              </div>
            </div>
          </ng-template>
        </app-data-list>
      </div>

      <p-menu #rowMenu [model]="rowMenuItems()" [popup]="true" />
    </div>

    <ng-template #inviteTpl>
      <app-invite-user (saved)="onInviteSaved()" (cancelled)="inviteVisible.set(false)" />
    </ng-template>
    <app-edit-dialog
      [(visible)]="inviteVisible"
      [header]="'user.invite' | translate"
      [content]="inviteTpl"
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
  private readonly router = inject(Router);

  readonly list = viewChild.required<DataListComponent<IUserDto>>('list');

  readonly error = signal<string | null>(null);
  readonly infoMessage = signal<string | null>(null);
  readonly inviteVisible = signal(false);
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

  readonly rowMenuItems = computed<MenuItem[]>(() => {
    this.translate.currentLang();
    const user = this.menuUser();
    if (!user) return [];

    // Only Deactivate today, and stated rather than padded: the reference's
    // Transfer and Manage roles both live on the user record page that Edit
    // already opens, and Reactivate has no endpoint. Duplicating two items
    // that navigate to the same destination would be menu filler.
    if (user.status === 'INACTIVE') return [];
    return [
      {
        label: this.translate.instant('user.deactivate'),
        icon: 'pi pi-user-minus',
        command: () => this.confirmDeactivate(user),
      },
    ];
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
    this.inviteVisible.set(true);
  }

  onInviteSaved(): void {
    this.inviteVisible.set(false);
    this.list().reload();
    this.loadCounts();
  }

  onView(user: IUserDto): void {
    void this.router.navigate(['/users', user.id]);
  }

  openRowMenu(user: IUserDto, event: Event): void {
    this.menuUser.set(user);
    this.rowMenu.toggle(event);
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
              this.translate.instant('user.deactivateSummary', {
                reassignedCount,
                unassignedCount,
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
}
