import { Component, TemplateRef, ViewChild, computed, inject, signal, viewChild } from '@angular/core';
import { LanguageService } from '../../../../core/services/language.service';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ConfirmationService } from 'primeng/api';
import { RoleService, RoleDto } from '../../services/role.service';
import { RoleFormComponent } from '../role-form/role-form.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { RowMenuComponent, RowMenuItem } from '../../../../shared/components/row-menu/row-menu.component';
import { refusalCode } from '../../../../core/http/refusal';
import {
  DataListColumn,
  DataListComponent,
} from '../../../../shared/components/data-list/data-list.component';
import { SortHeaderComponent } from '../../../../shared/components/sort-header/sort-header.component';
import { DataListSource } from '../../../../shared/components/data-list/data-list.source';
import { StatusChipComponent } from '../../../../shared/components/status-chip/status-chip.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { AmCountPipe } from '../../../../core/formatting';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

@Component({
  selector: 'app-role-list',
  standalone: true,
  imports: [SortHeaderComponent, PageHeaderComponent, 
    TranslatePipe,
    AmCountPipe,
    ButtonModule,
    MessageModule,
    RowMenuComponent,
    RoleFormComponent,
    EditDialogComponent,
    DataListComponent,
    StatusChipComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">

      <app-page-header [title]="'roles.title' | translate">
        <div pageActions>
          @if (canCreate()) {
            <p-button
              icon="pi pi-plus"
              [label]="'roles.addRole' | translate"
              (onClick)="openAdd()"
            />
          }
        </div>
      </app-page-header>

      <!-- A row action's failure, in the list's own error shape: the message
           from its code, and Try again only when trying again could work. The
           list's own load error and Retry belong to app-data-list. -->
      @if (actionError(); as failure) {
        <div class="flex items-center gap-2" data-testid="role-action-error">
          <p-message severity="error" [text]="failure.key | translate" />
          @if (failure.retry) {
            <p-button size="small" [outlined]="true" [label]="'list.retry' | translate" (onClick)="retryAction()" />
          }
        </div>
      }

      <!-- ACC-78 - page mode. Bilingual names as a two-line cell, settling
           the two conventions the UX review found: both names always, rather
           than one chosen by language. A role's Arabic name is what an
           Arabic-speaking admin knows it by, and an English session should
           still show it. -->
      <div class="rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] overflow-hidden flex flex-col min-h-0">
        <app-data-list
          #list
          variant="page"
          [source]="source"
          [trackBy]="trackById"
          [columns]="columns()"
          [searchPlaceholder]="'roles.searchPlaceholder' | translate"
          [emptyTitle]="'roles.noRoles' | translate"
          persistKey="roles"
          [urlSync]="true"
        >
          <ng-template #listHeader let-h>
            @for (column of columns(); track column.key) {
              @if (h.visible(column.key)) {
                @if (column.sortBy) {
                  <am-sort-header
                    [key]="column.key"
                    [label]="column.label"
                    [current]="h.sortBy === column.sortBy ? { key: column.key, dir: h.sortDir ?? 'asc' } : null"
                    (sort)="h.sort($event)"
                  />
                } @else {
                  <span role="columnheader">{{ column.label }}</span>
                }
              }
            }
            <span></span>
          </ng-template>

          <ng-template #listRow let-role let-v="visible">
            <div
              class="grid items-center gap-3 px-3 py-2 border-b border-[var(--am-border)]"
              style="grid-template-columns: var(--am-list-cols)"
            >
              @if (v('name')) {
                <div class="min-w-0">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-[13px] font-medium truncate">{{ role.nameEn }}</span>
                    @if (!role.isActive) {
                      <!-- The inactive chip users already wear: "Inactive", not
                           the account chip's "Cancelled". -->
                      <app-status-chip variant="user" labelPrefix="user.status" value="INACTIVE" />
                    }
                  </div>
                  <!-- dir=rtl on the SPAN, not the block. On the block it
                       also flips the block's alignment, so text-start
                       resolves to the RIGHT edge of a wide grid cell and the
                       Arabic name floats away from the English one it belongs
                       under — visible only in a screenshot, since the
                       accessibility tree reports the text as present either
                       way. Isolating an inline span gives correct bidi
                       rendering while the block stays left-aligned in an LTR
                       session (and right-aligned in an Arabic one, which is
                       equally correct). -->
                  <div class="text-[11.5px] text-[var(--am-text-secondary)] truncate">
                    <span dir="rtl" style="unicode-bidi: isolate">{{ role.nameAr || '—' }}</span>
                  </div>
                </div>
              }
              @if (v('key')) {
                <span class="text-xs">
                  @if (role.isSystem) {
                    <span
                      class="text-[10.5px] font-semibold px-1.5 py-px rounded"
                      style="color: var(--am-blue-primary);
                             background: color-mix(in srgb, var(--am-blue-primary) 12%, transparent)"
                    >
                      {{ 'roles.systemBadge' | translate }}
                    </span>
                  } @else {
                    <span class="text-[var(--am-text-secondary)]">
                      {{ 'roles.customBadge' | translate }}
                    </span>
                  }
                </span>
              }
              @if (v('permissions')) {
                <!-- ACC-74 - permissionCount, not permissions?.length. The list
                     deliberately does not carry the permission array; binding
                     to it rendered 0 for every role, always. -->
                <span
                  dir="ltr"
                  style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
                  class="text-xs text-[var(--am-text-secondary)] text-start"
                >
                  {{ role.permissionCount ?? 0 | amCount: 'role.permissions' }}
                </span>
              }

              <!-- ACC-123 — BOTH gated on roles:manage, which is what every
                   action behind them enforces (role.controller.ts: PATCH
                   /roles/:id, PATCH /roles/:id/permissions, POST
                   .../deactivate and .../activate all carry
                   ROLES_PERMISSIONS.MANAGE).

                   Before this, a holder of roles:view alone opened a fully
                   editable "Edit Role" dialog with a live Save, and a row menu
                   offering Manage Permissions and Deactivate Role. Hidden
                   rather than disabled, matching every other write control in
                   the app. -->
              @if (canManage()) {
                <div class="flex items-center gap-1 shrink-0">
                  <p-button
                    [label]="'common.edit' | translate"
                    size="small"
                    [text]="true"
                    (onClick)="openEdit(role)"
                  />
                  <!-- am-row-menu: attached to the page body, under its ⋯ and
                       aligned to its end, so it never widens the list. -->
                  <am-row-menu
                    [groups]="[menuFor(role)]"
                    [label]="'list.actionsFor' | translate: { name: displayLabel(role) }"
                    (picked)="pick(role, $event)"
                  />
                </div>
              }
            </div>
          </ng-template>
        </app-data-list>
      </div>

      <ng-template #formTpl>
        <!-- Cancel goes through the dialog, so unsaved work gets the same
             question Escape asks; the form's dirty state travels out to it. -->
        <app-role-form
          [role]="editingRole()"
          (saved)="onSaved($event)"
          (dirtyChange)="formDirty.set($event)"
          (ready)="roleFormRef.set($event)"
        />
      </ng-template>
      <!-- Declared HERE, not inside the form: p-dialog collects its templates
           at content init, so a footer arriving later never lands. Outside
           the body, it is also what keeps an Arabic system role's Edit under
           the 420 cap at 390px wide. -->
      <ng-template #roleFooterTpl>
        <div class="flex justify-end gap-3">
          <p-button
            [label]="'common.cancel' | translate"
            severity="secondary"
            [text]="true"
            type="button"
            [disabled]="!!roleFormRef()?.saving()"
            (onClick)="roleDialog.requestClose()"
          />
          <p-button
            type="button"
            data-testid="role-save"
            [label]="(editingRole() ? 'common.save' : 'common.add') | translate"
            [loading]="!!roleFormRef()?.saving()"
            [disabled]="!roleFormRef()"
            (onClick)="roleFormRef()?.onSubmit()"
          />
        </div>
      </ng-template>
      <app-edit-dialog
        #roleDialog
        [dirty]="formDirty()"
        [visible]="showFormDialog()"
        (visibleChange)="showFormDialog.set($event)"
        [header]="(editingRole() ? 'roles.editRole' : 'roles.addRole') | translate"
        [content]="formTpl"
        [footer]="roleFooterTpl"
        width="520px"
      />

    </div>
  `,
})
export class RoleListComponent {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly roleService = inject(RoleService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);

  private readonly translate = inject(TranslateService);
  private readonly languageService = inject(LanguageService);
  private readonly navigationAccess = inject(NavigationAccessService);

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. Same mechanism as committee-detail.component.ts's canEdit /
  // canAddMember, deliberately rather than a second one.
  // POST /roles enforces roles:manage, not a roles:create (role.controller.ts).
  readonly canCreate = computed(() => this.navigationAccess.hasPermission('roles:manage'));

  // ACC-123 — the same permission as canCreate, named separately because they
  // answer different questions and a future endpoint split (as users:invite vs
  // users:manage already is) must not have to disentangle one computed doing
  // two jobs.
  readonly canManage = computed(() => this.navigationAccess.hasPermission('roles:manage'));

  /** A row action that failed: what to say, and how to try it again if that could work. */
  readonly actionError = signal<{ key: string; retry: (() => void) | null } | null>(null);
  readonly list = viewChild.required<DataListComponent<RoleDto>>('list');

  // ACC-78 — the client-side PLATFORM_ADMIN filter is GONE, not moved. The
  // backend now excludes it in the WHERE clause, because a post-query filter
  // and a database-side count cannot agree once the endpoint paginates: the
  // page would come back one row short and the total would count a role this
  // tenant can never see.

  // ARROW PROPERTY, NOT A METHOD — a bound method is a new reference on every
  // change detection and refetches in a loop.
  readonly source: DataListSource<RoleDto> = (query) =>
    this.roleService.listRoles({
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });

  readonly trackById = (role: RoleDto): string => role.id;

  readonly columns = computed<DataListColumn[]>(() => {
    const lang = this.translate.currentLang();
    return [
      {
        key: 'name',
        label: this.translate.instant('roles.name'),
        // SORTS BY THE NAME YOU ARE READING. The cell shows both names, so a
        // fixed 'nameEn' would sort an Arabic session by text it is not
        // reading first. Both columns are on the backend's whitelist.
        sortBy: lang === 'ar' ? 'nameAr' : 'nameEn',
        alwaysVisible: true,
        width: '2fr',
      },
      {
        key: 'key',
        label: this.translate.instant('roles.roleType'),
        sortBy: 'key',
        width: '1fr',
      },
      { key: 'permissions', label: this.translate.instant('roles.permissions'), width: '1fr' },
    ];
  });

  /** The row's ⋯ items: the same two the p-menu offered, in the same order. */
  menuFor(role: RoleDto): RowMenuItem[] {
    return [
      { id: 'permissions', label: this.translate.instant('roles.managePermissions') },
      role.isActive
        ? { id: 'deactivate', label: this.translate.instant('roles.deactivateRole'), danger: true }
        : { id: 'activate', label: this.translate.instant('roles.activateRole') },
    ];
  }

  pick(role: RoleDto, id: string): void {
    if (id === 'permissions') this.openPermissions(role);
    else if (id === 'deactivate') this.onDeactivate(role);
    else if (id === 'activate') this.onActivate(role);
  }

  readonly showFormDialog = signal(false);
  readonly formDirty = signal(false);
  readonly roleFormRef = signal<RoleFormComponent | null>(null);
  readonly editingRole = signal<RoleDto | null>(null);
  private wasCreating = false;

  openAdd(): void {
    this.editingRole.set(null);
    this.wasCreating = true;
    this.roleFormRef.set(null);
    this.showFormDialog.set(true);
  }

  openEdit(role: RoleDto): void {
    this.editingRole.set(role);
    this.wasCreating = false;
    this.roleFormRef.set(null);
    this.showFormDialog.set(true);
  }

  openPermissions(role: RoleDto): void {
    void this.router.navigate([role.id, 'permissions'], { relativeTo: this.route });
  }

  onSaved(role: RoleDto): void {
    this.showFormDialog.set(false);
    const wasCreating = this.wasCreating;
    this.list().reload();
    // New roles start with zero permissions — send the admin straight into the
    // matrix to assign some, per plan Commit 8 UI notes.
    if (wasCreating) {
      void this.router.navigate([role.id, 'permissions'], { relativeTo: this.route });
    }
  }

  // ACC-160 — this read `role.nameAr || role.nameEn` with no language check, so
  // an English session named the role in Arabic inside an English sentence.
  displayLabel(role: RoleDto): string {
    return this.languageService.bilingual(role.nameEn, role.nameAr);
  }

  onDeactivate(role: RoleDto): void {
    const label = this.displayLabel(role);
    this.confirmationService.confirm({
      message: this.translate.instant('roles.confirmDeactivateRole', { name: label }),
      header: this.translate.instant('common.confirm'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.runDeactivate(role);
      },
    });
  }

  private runDeactivate(role: RoleDto): void {
    this.actionError.set(null);
    this.roleService.deactivateRole(role.id).subscribe({
      next: () => this.list().reload(),
      error: (err: unknown) => this.failed(err, 'roles.actionError.deactivate', () => this.runDeactivate(role)),
    });
  }

  onActivate(role: RoleDto): void {
    this.actionError.set(null);
    this.roleService.activateRole(role.id).subscribe({
      next: () => this.list().reload(),
      error: (err: unknown) => this.failed(err, 'roles.actionError.activate', () => this.onActivate(role)),
    });
  }

  retryAction(): void {
    this.actionError()?.retry?.();
  }

  /**
   * A refusal is said from its code or status, never the server's text. Only
   * a failure that trying again could fix offers Try again.
   */
  private failed(err: unknown, fallbackKey: string, retry: () => void): void {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (refusalCode(err) === 'LAST_ACTIVE_ADMINISTRATOR') {
      this.actionError.set({ key: 'roles.refusal.lastAdministrator', retry: null });
    } else if (status === 404) {
      this.actionError.set({ key: 'roles.actionError.notFound', retry: null });
      this.list().reload();
    } else if (status === 403) {
      this.actionError.set({ key: 'roles.actionError.forbidden', retry: null });
    } else {
      this.actionError.set({ key: fallbackKey, retry });
    }
  }

}
