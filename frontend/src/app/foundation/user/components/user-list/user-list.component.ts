import { Component, OnInit, TemplateRef, ViewChild, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
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

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [
    DatePipe,
    TranslatePipe,
    TableModule,
    ButtonModule,
    TagModule,
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

      <p-table [value]="users()" [loading]="loading() || deactivating()" scrollable scrollHeight="flex" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 22%">{{ 'user.name' | translate }}</th>
            <th style="width: 22%">{{ 'user.email' | translate }}</th>
            <th style="width: 12%">{{ 'user.status.title' | translate }}</th>
            <th style="width: 14%">{{ 'user.position' | translate }}</th>
            <th style="width: 14%">{{ 'user.primaryOrgUnit' | translate }}</th>
            <th style="width: 14%">{{ 'user.lastLogin' | translate }}</th>
            <th style="width: 4%"></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-user>
          <tr class="cursor-pointer" (click)="onView(user)">
            <td>{{ user.name }}</td>
            <td>{{ user.email }}</td>
            <td>
              <p-tag
                [value]="('user.status.' + user.status.toLowerCase()) | translate"
                [severity]="statusColor(user.status)"
              />
            </td>
            <td>{{ positionName(user.positionId) }}</td>
            <td>{{ orgUnitName(user.primaryOrgUnitId) }}</td>
            <td>{{ user.lastLoginAt ? (user.lastLoginAt | date: 'short') : '—' }}</td>
            <td>
              @if (user.status !== 'INACTIVE') {
                <p-button
                  icon="pi pi-user-minus"
                  [text]="true"
                  size="small"
                  severity="danger"
                  (onClick)="onDeactivate(user, $event)"
                />
              }
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="7" class="text-center py-8 text-[var(--am-text-secondary)]">{{ 'user.noUsers' | translate }}</td>
          </tr>
        </ng-template>
      </p-table>
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

  private readonly userService = inject(UserService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly users = signal<IUserDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly infoMessage = signal<string | null>(null);
  readonly inviteVisible = signal(false);
  readonly deactivating = signal(false);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);

  ngOnInit(): void {
    this.orgPositionService.listPositions().subscribe({ next: (positions) => this.positions.set(positions) });
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
    this.loadUsers();
  }

  positionName(positionId: string | null): string {
    if (!positionId) return '—';
    return this.positions().find((p) => p.id === positionId)?.nameEn ?? positionId;
  }

  orgUnitName(orgUnitId: string | null): string {
    if (!orgUnitId) return '—';
    return this.orgUnits().find((u) => u.id === orgUnitId)?.nameEn ?? orgUnitId;
  }

  statusColor(status: string): 'success' | 'danger' | 'warn' | 'secondary' {
    switch (status) {
      case 'ACTIVE':
        return 'success';
      case 'INACTIVE':
        return 'danger';
      case 'SUSPENDED':
        return 'warn';
      default:
        return 'secondary';
    }
  }

  onInvite(): void {
    this.inviteVisible.set(true);
  }

  onInviteSaved(): void {
    this.inviteVisible.set(false);
    this.loadUsers();
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
            this.loadUsers();
          },
          error: (err: unknown) => {
            this.deactivating.set(false);
            this.error.set(extractErrorMessage(err, 'Deactivate failed'));
          },
        });
      },
    });
  }

  private loadUsers(): void {
    this.loading.set(true);
    this.error.set(null);
    this.userService.listUsers().subscribe({
      next: (users) => {
        this.users.set(users);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('user.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
