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
import { ConfirmationService } from 'primeng/api';
import { UserService, IUserDto } from '../../services/user.service';
import { OrgPositionService, IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { OrgUnitService, OrgUnitDto } from '../../../organization/services/org-unit.service';
import { InviteUserComponent } from '../invite-user/invite-user.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
// ACC-39 — EditDialogComponent replaces this raw p-dialog + manual @if.
// invite-user is create-only (no edit flow), so this is architectural
// consistency with the required pattern going forward (SYSTEM-REFERENCE.md
// Section 10.5), not a bug fix — the old @if(inviteVisible()) wrapping
// <app-invite-user> directly was already immune to ACC-29's pre-fill bug.
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import {
  DataListComponent,
  DataListScope,
  DataListSortOption,
} from '../../../../shared/components/data-list/data-list.component';
import { DataListSource } from '../../../../shared/components/data-list/data-list.source';
import { StatusChipComponent } from '../../../../shared/components/status-chip/status-chip.component';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [
    DatePipe,
    TranslatePipe,
    ButtonModule,
    DataListComponent,
    StatusChipComponent,
    InviteUserComponent,
    EditDialogComponent,
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

      <!-- ACC-78 — the shared list pattern's first consumer.
           persistKey + urlSync because this is a full page that owns its query
           string; a record panel would pass neither. -->
      <div class="rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] overflow-hidden">
        <app-data-list
          #list
          [source]="source"
          [trackBy]="trackById"
          [sortOptions]="sortOptions()"
          [scopes]="scopes()"
          [searchPlaceholder]="'user.searchPlaceholder' | translate"
          [emptyTitle]="'user.noUsers' | translate"
          [emptyMessage]="'user.noUsersBody' | translate"
          persistKey="users"
          [urlSync]="true"
          [hasDestination]="false"
        >
          <ng-template #listRow let-user>
            <div
              class="grid items-center gap-3 px-3 py-2 border-b border-[var(--am-border)] cursor-pointer hover:bg-[var(--am-surface)]"
              style="grid-template-columns: 1fr auto"
              (click)="onView(user)"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-[13px] font-medium truncate">{{ user.name }}</span>
                  <app-status-chip variant="user" [value]="user.status" />
                </div>
                <!-- Secondary line at narrow widths; the two trailing fields
                     promote out of it into their own columns past the shared
                     breakpoint. Same component, same row template — the width
                     of the LIST decides, not the viewport. -->
                <div class="flex items-baseline gap-1.5 text-[11.5px] text-[var(--am-text-secondary)] min-w-0">
                  <span class="truncate">{{ user.email }}</span>
                  <span class="@min-[520px]/datalist:hidden">·</span>
                  <span class="@min-[520px]/datalist:hidden truncate">
                    {{ positionName(user.positionId) }}
                  </span>
                </div>
              </div>

              <div class="flex items-center gap-3 shrink-0">
                <span
                  class="hidden @min-[520px]/datalist:block text-xs text-[var(--am-text-secondary)] w-[130px] truncate"
                >
                  {{ positionName(user.positionId) }}
                </span>
                <span
                  class="hidden @min-[720px]/datalist:block text-xs text-[var(--am-text-secondary)] w-[140px] truncate"
                >
                  {{ orgUnitName(user.primaryOrgUnitId) }}
                </span>
                <span
                  dir="ltr"
                  style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
                  class="hidden @min-[900px]/datalist:block text-xs text-[var(--am-text-secondary)] w-[110px]"
                >
                  {{ user.lastLoginAt ? (user.lastLoginAt | date: 'short') : '—' }}
                </span>
                @if (user.status !== 'INACTIVE') {
                  <p-button
                    icon="pi pi-user-minus"
                    [text]="true"
                    size="small"
                    severity="danger"
                    (onClick)="onDeactivate(user, $event)"
                  />
                }
              </div>
            </div>
          </ng-template>
        </app-data-list>
      </div>
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
  // Required: reload() after a write is not optional, so a missing list is a
  // bug rather than a state to tolerate.
  readonly list = viewChild.required<DataListComponent<IUserDto>>('list');

  private readonly userService = inject(UserService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  readonly error = signal<string | null>(null);
  readonly infoMessage = signal<string | null>(null);
  readonly inviteVisible = signal(false);
  readonly deactivating = signal(false);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);

  // The list owns its own loading; this page only supplies the lookups its
  // row template needs to render names instead of ids.
  ngOnInit(): void {
    this.orgPositionService.listPositions().subscribe({ next: (positions) => this.positions.set(positions) });
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
  }

  // An arrow property, not a method: DataListComponent reads this as a signal
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
    });

  readonly trackById = (user: IUserDto): string => user.id;

  // Columns the backend's sort whitelist actually accepts — an unknown one is
  // a 400, not a silent reorder, so these are not free-form.
  readonly sortOptions = computed<DataListSortOption[]>(() => {
    this.translate.currentLang();
    return [
      { column: 'name', label: this.translate.instant('user.name') },
      { column: 'email', label: this.translate.instant('user.email') },
      { column: 'status', label: this.translate.instant('user.status.title') },
      { column: 'createdAt', label: this.translate.instant('user.createdAt'), dir: 'desc' },
    ];
  });

  // No counts. The reference shows them, and they need a grouped count the
  // backend does not expose — see the ticket note rather than four extra
  // requests per page load.
  readonly scopes = computed<DataListScope[]>(() => {
    this.translate.currentLang();
    return [
      { key: 'ACTIVE', label: this.translate.instant('user.status.active') },
      { key: 'INVITED', label: this.translate.instant('user.status.invited') },
      { key: 'INACTIVE', label: this.translate.instant('user.status.inactive') },
    ];
  });

  positionName(positionId: string | null): string {
    if (!positionId) return '—';
    return this.positions().find((p) => p.id === positionId)?.nameEn ?? positionId;
  }

  orgUnitName(orgUnitId: string | null): string {
    if (!orgUnitId) return '—';
    return this.orgUnits().find((u) => u.id === orgUnitId)?.nameEn ?? orgUnitId;
  }

  onInvite(): void {
    this.inviteVisible.set(true);
  }

  onInviteSaved(): void {
    this.inviteVisible.set(false);
    this.list().reload();
  }

  onView(user: IUserDto): void {
    void this.router.navigate(['/users', user.id]);
  }

  // Per step-09 plan Section 12, Discussion 5: shows the user's name and a
  // qualitative impact statement up front — the EXACT count of tasks
  // affected is only known once the backend actually runs the departure
  // flow (there is no preview endpoint), so the real counts are surfaced
  // as an info message immediately after the action completes instead of
  // guessed at in the confirmation copy.
  onDeactivate(user: IUserDto, event: Event): void {
    event.stopPropagation();
    this.infoMessage.set(null);
    this.confirmationService.confirm({
      message: this.translate.instant('user.deactivateConfirm', { name: user.name }),
      header: this.translate.instant('user.deactivate'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        // ConfirmDialog closes immediately on accept (it doesn't wait on the
        // callback) — the loading state is shown on the table itself via
        // `[loading]`, not inside the (already-closed) dialog.
        this.deactivating.set(true);
        this.userService.deactivate(user.id).subscribe({
          next: ({ reassignedCount, unassignedCount }) => {
            this.deactivating.set(false);
            this.infoMessage.set(
              this.translate.instant('user.deactivateSummary', { reassignedCount, unassignedCount }),
            );
            this.list().reload();
          },
          error: (err: unknown) => {
            this.deactivating.set(false);
            this.error.set(extractErrorMessage(err, 'Deactivate failed'));
          },
        });
      },
    });
  }

}
