import {
  Component,
  TemplateRef,
  ViewChild,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { RoleService, RoleDto } from '../../services/role.service';
import { RoleFormComponent } from '../role-form/role-form.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import {
  DataListColumn,
  DataListComponent,
} from '../../../../shared/components/data-list/data-list.component';
import { DataListSource } from '../../../../shared/components/data-list/data-list.source';
import { StatusChipComponent } from '../../../../shared/components/status-chip/status-chip.component';

@Component({
  selector: 'app-role-list',
  standalone: true,
  imports: [
    TranslatePipe,
    ButtonModule,
    MenuModule,
    TooltipModule,
    RoleFormComponent,
    EditDialogComponent,
    DataListComponent,
    StatusChipComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">

      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'roles.title' | translate }}</h2>
        <p-button
          icon="pi pi-plus"
          [label]="'roles.addRole' | translate"
          (onClick)="openAdd()"
        />
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() | translate }}</p>
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
                  <button
                    type="button"
                    class="flex items-center gap-1 text-start uppercase hover:text-[var(--am-blue-primary)]"
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
                      <app-status-chip variant="account" value="CANCELLED" />
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
                    <span dir="rtl" style="unicode-bidi: isolate">{{ role.nameAr }}</span>
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
                  {{ 'roles.permissionCount' | translate: { count: role.permissionCount ?? 0 } }}
                </span>
              }

              <div class="flex items-center gap-1 shrink-0">
                <p-button
                  [label]="'common.edit' | translate"
                  size="small"
                  [text]="true"
                  (onClick)="openEdit(role)"
                />
                <p-button
                  icon="pi pi-ellipsis-h"
                  size="small"
                  [text]="true"
                  [pTooltip]="'list.more' | translate"
                  (onClick)="openRowMenu(role, $event)"
                />
              </div>
            </div>
          </ng-template>
        </app-data-list>
      </div>

      <p-menu #rowMenu [model]="rowMenuItems()" [popup]="true" />

      <ng-template #formTpl>
        <app-role-form
          [role]="editingRole()"
          (saved)="onSaved($event)"
          (cancelled)="showFormDialog.set(false)"
        />
      </ng-template>
      <app-edit-dialog
        [visible]="showFormDialog()"
        (visibleChange)="showFormDialog.set($event)"
        [header]="(editingRole() ? 'roles.editRole' : 'roles.addRole') | translate"
        [content]="formTpl"
        width="520px"
      />

    </div>
  `,
})
export class RoleListComponent {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
  @ViewChild('rowMenu') rowMenu!: { toggle: (event: Event) => void };

  private readonly roleService = inject(RoleService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);

  private readonly translate = inject(TranslateService);

  readonly error = signal<string | null>(null);
  readonly list = viewChild.required<DataListComponent<RoleDto>>('list');
  readonly menuRole = signal<RoleDto | null>(null);

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

  readonly rowMenuItems = computed<MenuItem[]>(() => {
    this.translate.currentLang();
    const role = this.menuRole();
    if (!role) return [];

    return [
      {
        label: this.translate.instant('roles.managePermissions'),
        icon: 'pi pi-lock',
        command: () => this.openPermissions(role),
      },
      role.isActive
        ? {
            label: this.translate.instant('roles.deactivateRole'),
            icon: 'pi pi-ban',
            command: () => this.onDeactivate(role),
          }
        : {
            label: this.translate.instant('roles.activateRole'),
            icon: 'pi pi-check',
            command: () => this.onActivate(role),
          },
    ];
  });

  openRowMenu(role: RoleDto, event: Event): void {
    this.menuRole.set(role);
    this.rowMenu.toggle(event);
  }

  readonly showFormDialog = signal(false);
  readonly editingRole = signal<RoleDto | null>(null);
  private wasCreating = false;

  openAdd(): void {
    this.editingRole.set(null);
    this.wasCreating = true;
    this.showFormDialog.set(true);
  }

  openEdit(role: RoleDto): void {
    this.editingRole.set(role);
    this.wasCreating = false;
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

  displayLabel(role: RoleDto): string {
    return role.nameAr || role.nameEn;
  }

  onDeactivate(role: RoleDto): void {
    const label = this.displayLabel(role);
    this.confirmationService.confirm({
      message: `Deactivate role "${label}"? This will immediately revoke permissions for all users assigned to this role.`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.roleService.deactivateRole(role.id).subscribe({
          next: () => this.list().reload(),
          error: (err: unknown) =>
            this.error.set(extractErrorMessage(err, 'Deactivate failed')),
        });
      },
    });
  }

  onActivate(role: RoleDto): void {
    this.roleService.activateRole(role.id).subscribe({
      next: () => this.list().reload(),
      error: (err: unknown) =>
        this.error.set(extractErrorMessage(err, 'Activate failed')),
    });
  }

}
