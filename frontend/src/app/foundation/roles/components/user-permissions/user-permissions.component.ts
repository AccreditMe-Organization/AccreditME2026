import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { RoleService, PermissionDto, UserPermissionGrantDto } from '../../services/role.service';
import { UserService, IUserDto, IBilingualNameDto } from '../../../user/services/user.service';
import { OrgUnitService, OrgUnitDto } from '../../../organization/services/org-unit.service';
import { OrgPositionService, IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { FormatService } from '../../../../core/formatting';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import {
  SimpleListComponent,
  SimpleListPage,
  SimpleListQuery,
} from '../../../../shared/components/simple-list/simple-list.component';
import { NO_FILTER, rowVisible } from '../../permission-matrix/permission-matrix.model';
import { UserPermissionsSummary, UserRoleLine, summarise } from '../../permission-matrix/user-permissions.model';

/** Left-to-right isolates around each run of digits, so «16 صلاحية» keeps its order. */
const isolateDigits = (text: string): string => text.replace(/[0-9][0-9,.]*/g, (m) => `⁦${m}⁩`);
/** First-strong isolates around a name, so an English name inside an Arabic sentence keeps its own order. */
const isolateName = (text: string): string => `⁨${text}⁩`;

type PageState = 'pick' | 'loading' | 'error' | 'notFound' | 'ready';

interface RoleRowView {
  id: string;
  roleId: string;
  name: string;
  system: boolean;
  active: boolean;
  source: string;
  gives: string;
}

interface PermRowView {
  key: string;
  sentence: string;
  note: string | null;
  from: string;
}

interface GroupView {
  id: string | null;
  label: string | null;
  rows: PermRowView[];
}

interface ModuleView {
  module: string;
  name: string;
  description: string;
  count: string;
  groups: GroupView[];
}

/**
 * ACC-272 — "A user's permissions", `/roles/user-permissions[/:userId]`.
 *
 * Built against "AccreditMe Role Permissions.dc.html", section B. A READ-ONLY
 * answer to "what can this person do, and why": the roles they hold with where
 * each came from, then the granted rows only, each naming the active roles
 * that give it. Nothing here changes anything: no checkboxes, no save. The
 * address carries the person, so it can be shared.
 *
 * Three reads, together: the person (GET /users/:id, whose `references` name
 * their position and units), their grants with each role's keys (GET
 * /users/:id/permissions, one query), and the catalogue. What is SHOWN, and
 * every count, is user-permissions.model.ts: the role permissions page's own
 * rules, role by role.
 */
@Component({
  selector: 'app-user-permissions',
  host: { class: 'block' },
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    TagModule,
    PageHeaderComponent,
    ListDialogComponent,
    SimpleListComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <app-page-header [title]="'roles.userPermissions.title' | translate" />

      <!-- The picker: stays at the top, showing the person once chosen. -->
      <div class="flex flex-col gap-1 max-w-[calc(var(--am-space-40)*13)]" data-up-picker>
        <label for="upFindUser" class="text-meta font-medium text-ink-700">{{ 'roles.userPermissions.findUser' | translate }}</label>
        <div class="up-pick">
          <input
            pInputText
            id="upFindUser"
            readonly
            class="up-pick__text"
            [value]="chosenLabel()"
            [placeholder]="'roles.userPermissions.findUserPlaceholder' | translate"
            (click)="openPicker()"
            (keydown.enter)="$event.preventDefault(); openPicker()"
            data-up-find-user
          />
          <button
            type="button"
            class="up-pick__button up-focus"
            [attr.aria-label]="'roles.userPermissions.findUser' | translate"
            (click)="openPicker()"
            data-up-find-user-button
          >
            <i class="pi pi-search" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      @switch (state()) {
        @case ('pick') {
          <p class="m-0 py-[var(--am-space-16)] text-value text-ink-700" data-up-intro>{{ 'roles.userPermissions.intro' | translate }}</p>
        }
        @case ('loading') {
          @for (s of [1, 2, 3]; track s) {
            <div class="up-card flex flex-col gap-3 p-4" data-up-skeleton aria-hidden="true">
              <span class="am-skeleton-bar w-2/5"></span>
              <span class="am-skeleton-bar w-4/5"></span>
              <span class="am-skeleton-bar w-3/5"></span>
            </div>
          }
        }
        @case ('error') {
          <div class="flex flex-col items-start gap-[var(--am-space-6)] px-[var(--am-space-16)] py-[var(--am-space-12)] border border-[var(--am-danger-border)] rounded-card bg-[var(--am-danger-bg)]" role="alert" data-up-error>
            <p class="m-0 font-semibold text-[var(--am-danger-ink)]">{{ 'roles.userPermissions.loadFailedTitle' | translate }}</p>
            <p class="m-0 text-value">{{ 'roles.matrix.loadFailedBody' | translate }}</p>
            <p-button [label]="'common.retry' | translate" severity="secondary" [outlined]="true" (onClick)="reload()" data-up-retry />
          </div>
        }
        @case ('notFound') {
          <div class="px-[var(--am-space-16)] py-[var(--am-space-12)] border border-[var(--am-border-strong)] rounded-card bg-surface-raised" role="status" data-up-not-found>
            <p class="m-0 font-semibold">{{ 'roles.userPermissions.notFound' | translate }}</p>
          </div>
        }
        @case ('ready') {
          @if (user(); as u) {
            <!-- The person -->
            <section class="up-card flex flex-col gap-[var(--am-space-6)] p-4" [attr.aria-label]="u.name" data-up-card>
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span class="text-body font-semibold" data-up-name>{{ u.name }}</span>
                <span class="up-chip" [class.up-chip--off]="u.status !== 'ACTIVE'" data-up-status>{{ statusLabel(u.status) }}</span>
                <a class="up-link up-focus ms-auto max-md:ms-0" [routerLink]="['/users', u.id]" data-up-open-record>{{ 'roles.userPermissions.openRecord' | translate }}</a>
              </div>
              @if (personMeta(); as meta) {
                <span class="text-meta text-ink-700" data-up-meta>{{ meta }}</span>
              }
              <span class="text-value font-medium" data-up-summary>{{ summaryLine() }}</span>
              @if (u.status === 'INACTIVE') {
                <span class="text-meta text-ink-700" data-up-deactivated>{{ 'roles.userPermissions.deactivated' | translate }}</span>
              }
            </section>

            <!-- Roles -->
            <section class="up-card" aria-labelledby="upRolesTitle" data-up-roles>
              <h2 id="upRolesTitle" class="up-section-title">{{ 'roles.userPermissions.rolesTitle' | translate }}</h2>
              <ul class="m-0 p-0 list-none">
                @for (r of roleRows(); track r.id) {
                  <li class="up-role" [class.up-role--off]="!r.active" [attr.data-up-role]="r.roleId" [attr.data-up-active]="r.active">
                    <span class="flex flex-col min-w-0 flex-[1_1_calc(var(--am-space-40)*6)]">
                      <span class="flex flex-wrap items-center gap-2">
                        <a class="up-role__name up-focus" [routerLink]="['/roles', r.roleId, 'permissions']" data-up-role-link>{{ r.name }}</a>
                        @if (r.system) {
                          <p-tag [value]="'roles.systemBadge' | translate" severity="info" data-up-system />
                        }
                        @if (!r.active) {
                          <span class="up-chip up-chip--off" data-up-inactive>{{ 'roles.userPermissions.inactive' | translate }}</span>
                        }
                      </span>
                      <span class="up-wrap text-meta text-ink-700" data-up-source>{{ r.source }}</span>
                    </span>
                    <span class="up-role__gives" data-up-gives>{{ r.gives }}</span>
                  </li>
                }
              </ul>
            </section>

            <!-- Permissions -->
            <section class="up-card" aria-labelledby="upPermsTitle" data-up-permissions>
              <h2 id="upPermsTitle" class="up-section-title">{{ 'roles.userPermissions.permissionsTitle' | translate }}</h2>
              <div class="flex flex-col gap-3 px-4 pb-4">
                <p class="m-0 text-meta text-ink-700 up-wrap" data-up-read-only>{{ 'roles.userPermissions.readOnly' | translate }}</p>
                @if (summary()?.activeRoles?.length) {
                  <span class="relative w-[calc(var(--am-space-40)*7.5)] max-md:w-full">
                    <input
                      pInputText
                      type="search"
                      class="w-full pe-[var(--am-space-32)] [&::-webkit-search-cancel-button]:hidden"
                      [value]="query()"
                      (input)="query.set($any($event.target).value)"
                      [placeholder]="'roles.matrix.find' | translate"
                      [attr.aria-label]="'roles.matrix.find' | translate"
                      autocomplete="off"
                      data-up-find
                    />
                    @if (query()) {
                      <button
                        type="button"
                        class="up-focus absolute inset-y-0 end-[var(--am-space-8)] my-auto h-fit border-0 bg-transparent p-0 text-ink-500 cursor-pointer"
                        [attr.aria-label]="'roles.matrix.clearSearch' | translate"
                        (click)="query.set('')"
                        data-up-find-clear
                      >✕</button>
                    }
                  </span>
                } @else {
                  <p class="m-0 text-value up-wrap" data-up-no-active>{{ noActiveLine() }}</p>
                }

                @if (noMatch()) {
                  <p class="m-0 text-value" role="status" data-up-no-match>
                    {{ 'roles.matrix.noMatch' | translate }}
                    <button type="button" class="up-focus border-0 bg-transparent p-0 font-semibold text-[var(--am-primary-700)] cursor-pointer" (click)="query.set('')" data-up-clear>{{ 'roles.matrix.noMatchClear' | translate }}</button>
                  </p>
                }

                @for (m of moduleViews(); track m.module) {
                  <section class="up-mod" [attr.data-up-module]="m.module" [attr.aria-label]="m.name">
                    <div class="up-mod__head">
                      <span class="text-body font-semibold">{{ m.name }}</span>
                      <span class="flex-[1_1_calc(var(--am-space-40)*5)] text-meta text-ink-500">{{ m.description }}</span>
                      <span class="flex-none text-meta text-ink-700 tabular-nums" data-up-count>{{ m.count }}</span>
                    </div>
                    @for (g of m.groups; track g.id ?? '') {
                      @if (g.label) {
                        <div class="up-group" [attr.data-up-group]="g.id">{{ g.label }}</div>
                      }
                      <ul class="m-0 p-0 list-none">
                        @for (r of g.rows; track r.key) {
                          <li class="up-row" [class.up-row--in]="!!g.label" [attr.data-up-row]="r.key">
                            <span class="up-tick" aria-hidden="true">✓</span>
                            <span class="min-w-0 flex-auto">
                              <span class="up-wrap block text-value font-medium" data-up-sentence>{{ r.sentence }}</span>
                              @if (r.note) {
                                <span class="up-wrap block text-meta text-ink-500" data-up-note>{{ r.note }}</span>
                              }
                              <span class="up-wrap block text-meta text-ink-700" data-up-from>{{ r.from }}</span>
                            </span>
                          </li>
                        }
                      </ul>
                    }
                  </section>
                }

                @if (nothingLine(); as line) {
                  <p class="m-0 text-meta text-ink-700 up-wrap" data-up-nothing>{{ line }}</p>
                }
              </div>
            </section>
          }
        }
      }
    </div>

    <ng-template #pickerBody>
      <am-simple-list
        [load]="loadPeople"
        [columns]="pickerColumns()"
        grid="minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(calc(var(--am-space-40)*2),auto)"
        [row]="personCells"
        defaultSort="name:asc"
        [searchLabel]="'roles.userPermissions.findUser' | translate"
        [searchPlaceholder]="'roles.userPermissions.findUserPlaceholder' | translate"
        [emptyText]="'committee.memberForm.noPeople' | translate"
        [noMatchText]="'committee.noMatch' | translate: { q: peopleQuery() }"
        [countText]="peopleCountText"
        [selectable]="true"
        (picked)="onPicked($event)"
      />
    </ng-template>
    <ng-template #personCells let-person>
      <span class="flex flex-col min-w-0">
        <span class="truncate font-medium" data-up-person>{{ person.name }}</span>
        <span dir="ltr" class="truncate text-meta text-ink-700 text-start [unicode-bidi:isolate]">{{ person.email }}</span>
      </span>
      <span class="truncate text-meta text-ink-700">{{ unitName(person.primaryOrgUnitId) }}</span>
      <span class="truncate text-meta text-ink-700">{{ positionName(person.positionId) }}</span>
      <span><span class="up-chip" [class.up-chip--off]="person.status !== 'ACTIVE'">{{ statusLabel(person.status) }}</span></span>
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="pickerOpen()"
      [heading]="'roles.userPermissions.findUser' | translate"
      [closeLabel]="'roles.userPermissions.closePicker' | translate"
      [body]="pickerBody"
      (closeRequested)="pickerOpen.set(false)"
    />
  `,
  styles: [
    `
      .up-card{border:1px solid var(--am-border);border-radius:var(--am-radius-card);background:var(--am-surface-raised);min-inline-size:0}
      .up-section-title{margin:0;padding:var(--am-space-12) var(--am-space-16);font-size:var(--am-type-body-size);line-height:var(--am-type-body-line);font-weight:600}
      .up-pick{display:flex;gap:var(--am-space-8);align-items:center}
      .up-pick__text{flex:1 1 0;inline-size:0;min-inline-size:0;cursor:pointer}
      .up-pick__button{flex:none;inline-size:calc(var(--am-space-32) + var(--am-space-4));block-size:calc(var(--am-space-32) + var(--am-space-4));border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);background:var(--am-surface-raised);color:var(--am-ink-700);cursor:pointer}
      .up-focus:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .up-chip{display:inline-block;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);border:1px solid var(--am-border-strong);border-radius:var(--am-radius-pill);padding:0 var(--am-space-8);color:var(--am-ink-900);background:var(--am-surface-raised);white-space:nowrap}
      .up-chip--off{font-weight:600;color:var(--am-ink-700);border-color:var(--am-control-border);background:var(--am-surface)}
      .up-link{font-size:var(--am-type-meta-size);font-weight:600;color:var(--am-primary-700);text-decoration:none}
      .up-wrap{white-space:normal;overflow-wrap:anywhere}
      .up-role{display:flex;flex-wrap:wrap;align-items:center;gap:var(--am-space-4) var(--am-space-12);padding:var(--am-space-8) var(--am-space-16);border-block-start:1px solid var(--am-row-rule)}
      .up-role--off{background:var(--am-surface)}
      .up-role__name{font-weight:600;color:var(--am-primary-700);text-decoration:none;overflow-wrap:anywhere}
      .up-role--off .up-role__name{color:var(--am-ink-700)}
      .up-role__gives{flex:none;margin-inline-start:auto;font-size:var(--am-type-meta-size);font-weight:500;color:var(--am-ink-900)}
      .up-role--off .up-role__gives{color:var(--am-ink-500)}
      .up-mod{border:1px solid var(--am-border);border-radius:var(--am-radius-card)}
      .up-mod__head{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--am-space-4) var(--am-space-12);padding:var(--am-space-8) var(--am-space-16);border-block-end:1px solid var(--am-border)}
      .up-group{padding:var(--am-space-8) var(--am-space-16) var(--am-space-2);font-size:var(--am-type-meta-size);font-weight:700;color:var(--am-ink-700)}
      .up-row{display:flex;align-items:flex-start;gap:var(--am-space-8);padding:var(--am-space-6) var(--am-space-16)}
      .up-row--in{padding-inline-start:calc(var(--am-space-16) + var(--am-space-24))}
      .up-tick{flex:none;font-weight:700;color:var(--am-primary-700);line-height:var(--am-type-body-line)}
      @media (max-width:767.98px){.up-role__gives{flex-basis:100%;margin-inline-start:0}}
    `,
  ],
})
export class UserPermissionsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly roleService = inject(RoleService);
  private readonly userService = inject(UserService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly languageService = inject(LanguageService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly userId = signal<string | null>(null);
  readonly state = signal<PageState>('pick');
  readonly user = signal<IUserDto | null>(null);
  readonly grants = signal<UserPermissionGrantDto[]>([]);
  private readonly catalogue = signal<PermissionDto[] | null>(null);
  readonly query = signal('');

  readonly isRtl = computed(() => this.languageService.isRtl());

  readonly summary = computed<UserPermissionsSummary | null>(() => {
    const catalogue = this.catalogue();
    if (this.state() !== 'ready' || !catalogue) return null;
    return summarise(this.grants(), catalogue, { isTenant: !this.navigationAccess.isPlatformOrg() });
  });

  // ── The person ─────────────────────────────────────────────────────────────

  /** "Name · Unit · Position" in the picker once a person is shown. */
  readonly chosenLabel = computed(() => {
    const u = this.user();
    if (!u || this.state() !== 'ready') return '';
    return [u.name, this.personMeta()].filter(Boolean).join(' · ');
  });

  /** "Unit · Position", from the record's own references. */
  readonly personMeta = computed(() => {
    this.isRtl();
    const refs = this.user()?.references;
    return [refs?.primaryOrgUnit, refs?.position]
      .filter((n): n is IBilingualNameDto => !!n)
      .map((n) => this.name(n))
      .join(' · ');
  });

  readonly summaryLine = computed(() => {
    this.isRtl();
    const s = this.summary();
    if (!s) return '';
    if (s.viaRoot) {
      return this.translate.instant('roles.userPermissions.summaryRoot', { role: isolateName(this.roleName(s.viaRoot.grant)) });
    }
    if (s.activeRoles.length === 0) return this.translate.instant('roles.userPermissions.summaryNone');
    return this.digits(
      this.translate.instant('roles.userPermissions.summary', {
        permissions: this.format.count('role.permissionCount', s.granted.size),
        roles: this.format.count('role.activeRoleCount', s.activeRoles.length),
      }),
    );
  });

  readonly noActiveLine = computed(() => {
    this.isRtl();
    return this.translate.instant('roles.userPermissions.noActive', { name: isolateName(this.user()?.name ?? '') });
  });

  // ── Roles ──────────────────────────────────────────────────────────────────

  readonly roleRows = computed<RoleRowView[]>(() => {
    this.isRtl();
    const s = this.summary();
    if (!s) return [];
    return s.roles.map((r) => ({
      id: r.grant.id,
      roleId: r.grant.role.id,
      name: this.roleName(r.grant),
      system: r.grant.role.isSystem,
      active: r.active,
      source: this.sourceLine(r),
      gives: this.givesLine(r),
    }));
  });

  /**
   * Where a role came from. The server names every head grant's position and
   * unit (`headPosition`, `headUnit`, read with the grants), an acting
   * headship's included; if a name is missing, the record's own references are
   * tried (its position, its primary or acting unit), then a generic line. No
   * request per row.
   */
  private sourceLine(r: UserRoleLine): string {
    const g = r.grant;
    if (g.source === 'DIRECT') {
      return this.digits(this.translate.instant('roles.userPermissions.grantedDirectly', { date: this.format.date(g.grantedAt) }));
    }
    const u = this.user();
    const refs = u?.references;
    const position =
      g.headPosition ?? (g.grantedViaHeadPositionId && g.grantedViaHeadPositionId === u?.positionId ? refs?.position : null);
    const unitId = g.grantedViaHeadPositionOrgUnitId;
    const unit =
      g.headUnit ??
      (unitId && unitId === u?.primaryOrgUnitId ? refs?.primaryOrgUnit : unitId && unitId === u?.actingOrgUnitId ? refs?.actingOrgUnit : null);
    const lead = position
      ? this.translate.instant('userRecord.roles.fromPosition', { position: this.name(position) })
      : this.translate.instant('userRecord.roles.fromPositionUnnamed');
    const scope = g.source === 'HEAD_POSITION_ORG_WIDE' ? this.translate.instant('manageRoles.scopeOrgWide') : unit ? this.name(unit) : null;
    return scope ? `${lead} · ${scope}` : lead;
  }

  private givesLine(r: UserRoleLine): string {
    if (!r.active) return this.translate.instant('roles.userPermissions.givesInactive');
    if (r.isRoot) return this.translate.instant('roles.userPermissions.givesAll');
    return this.digits(this.format.count('role.gives', r.gives.length));
  }

  // ── Permissions ────────────────────────────────────────────────────────────

  readonly moduleViews = computed<ModuleView[]>(() => {
    this.isRtl();
    const s = this.summary();
    if (!s || s.activeRoles.length === 0) return [];
    const filter = { ...NO_FILTER, query: this.query() };
    return s.modules
      .map((m): ModuleView | null => {
        const granted = m.keys.filter((k) => s.granted.has(k));
        if (granted.length === 0) return null;
        const groups = m.groups
          .map((g): GroupView => ({
            id: g.id,
            label: g.id ? this.translateOr(`roles.matrix.group.${m.module}.${g.id}`, g.id) : null,
            rows: g.permissions
              .filter((p) => s.granted.has(p.key))
              .map((p) => ({ key: p.key, sentence: this.sentence(p.key) }))
              .filter((p) => rowVisible(p.key, p.sentence, filter, s.granted, s.granted))
              .map((p) => ({
                ...p,
                note: this.translateOr(`roles.matrix.sentenceNote.${p.key}`, '') || null,
                from: this.fromLine(s.from.get(p.key) ?? []),
              })),
          }))
          .filter((g) => g.rows.length > 0);
        if (groups.length === 0) return null;
        return {
          module: m.module,
          name: this.moduleName(m.module),
          description: this.translateOr(`roles.matrix.module.${m.module}.description`, ''),
          // The whole module's count, whatever the find box shows.
          count: this.digits(this.translate.instant('roles.matrix.ofCount', { held: this.format.number(granted.length), total: this.format.number(m.keys.length) })),
          groups,
        };
      })
      .filter((m): m is ModuleView => !!m);
  });

  readonly noMatch = computed(() => this.query().trim() !== '' && (this.summary()?.activeRoles.length ?? 0) > 0 && this.moduleViews().length === 0);

  /** "Nothing granted in Roles, Setup health and Administration." — only without a search. */
  readonly nothingLine = computed(() => {
    this.isRtl();
    const s = this.summary();
    if (!s || s.activeRoles.length === 0 || this.query().trim() || s.emptyModules.length === 0) return null;
    return this.translate.instant('roles.userPermissions.nothingGranted', { modules: this.joinList(s.emptyModules.map((m) => this.moduleName(m))) });
  });

  private fromLine(grants: readonly UserPermissionGrantDto[]): string {
    const names = grants.map((g) => isolateName(this.roleName(g)));
    const sep = this.translate.instant('roles.userPermissions.listSeparator');
    return this.translate.instant('roles.userPermissions.from', { roles: names.join(sep) });
  }

  /** "A, B and C" in English, «أ، ب، ج» in Arabic. */
  private joinList(items: readonly string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    const sep = this.translate.instant('roles.userPermissions.listSeparator');
    return this.translate.instant('roles.userPermissions.listLast', { rest: items.slice(0, -1).join(sep), last: items.at(-1) });
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    const sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('userId');
      this.userId.set(id);
      this.query.set('');
      if (id) this.load(id);
      else this.state.set('pick');
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  reload(): void {
    const id = this.userId();
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.state.set('loading');
    const cached = this.catalogue();
    forkJoin({
      user: this.userService.getById(id),
      grants: this.roleService.getUserPermissions(id),
      catalogue: cached ? of(cached) : this.roleService.listAllPermissions(),
    }).subscribe({
      next: ({ user, grants, catalogue }) => {
        if (this.userId() !== id) return;
        this.user.set(user);
        this.grants.set(grants);
        this.catalogue.set(catalogue);
        this.state.set('ready');
      },
      error: (err: unknown) => {
        if (this.userId() !== id) return;
        this.user.set(null);
        this.state.set(err instanceof HttpErrorResponse && err.status === 404 ? 'notFound' : 'error');
      },
    });
  }

  // ── The picker ─────────────────────────────────────────────────────────────

  readonly pickerOpen = signal(false);
  readonly peopleQuery = signal('');
  private readonly people = signal<IUserDto[] | null>(null);
  private readonly units = signal<OrgUnitDto[]>([]);
  private readonly positions = signal<IOrgPositionDto[]>([]);
  private namesRequested = false;

  readonly pickerColumns = computed(() => {
    this.isRtl();
    return [
      { label: this.translate.instant('committee.memberForm.col.person'), sort: 'name' },
      { label: this.translate.instant('committee.memberForm.col.unit') },
      { label: this.translate.instant('user.position') },
      { label: this.translate.instant('user.status.title') },
    ];
  });

  readonly peopleCountText = (n: number, searching: boolean): string =>
    this.format.count(searching ? 'committee.peopleMatch' : 'committee.people', n);

  /**
   * One read of every person, whatever their status (a deactivated or invited
   * person can be chosen), then search, sort and Load more in memory, as Add
   * member's picker does.
   */
  readonly loadPeople = (query: SimpleListQuery): Observable<SimpleListPage<IUserDto>> => {
    this.peopleQuery.set(query.q ?? '');
    const cached = this.people();
    const all$ = cached ? of(cached) : this.userService.listAllUsers().pipe(tap((rows) => this.people.set(rows)));
    return all$.pipe(
      map((all) => {
        const term = query.q?.trim().toLowerCase() ?? '';
        const matching = term ? all.filter((u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)) : [...all];
        const locale = this.languageService.isArabic() ? 'ar' : 'en';
        matching.sort((a, b) => (query.dir === 'desc' ? -1 : 1) * a.name.localeCompare(b.name, locale));
        return { items: matching.slice(query.skip, query.skip + query.take), total: all.length, matching: matching.length };
      }),
    );
  };

  openPicker(): void {
    // Unit and position names for the result rows, read once, like the Users
    // list. A reader without those lists sees "—", as there.
    if (!this.namesRequested) {
      this.namesRequested = true;
      this.orgUnitService.getFlat().pipe(catchError(() => of([] as OrgUnitDto[]))).subscribe((u) => this.units.set(u));
      this.orgPositionService.listPositions().pipe(catchError(() => of([] as IOrgPositionDto[]))).subscribe((p) => this.positions.set(p));
    }
    this.pickerOpen.set(true);
  }

  onPicked(person: IUserDto): void {
    this.pickerOpen.set(false);
    void this.router.navigate(['/roles/user-permissions', person.id]);
  }

  unitName(id: string | null): string {
    const unit = id ? this.units().find((u) => u.id === id) : null;
    return unit ? this.languageService.bilingual(unit.nameEn, unit.nameAr) : '—';
  }

  positionName(id: string | null): string {
    const position = id ? this.positions().find((p) => p.id === id) : null;
    return position ? this.languageService.bilingual(position.nameEn, position.nameAr ?? null) : '—';
  }

  // ── Labels ─────────────────────────────────────────────────────────────────

  statusLabel(status: string): string {
    return this.translateOr(`roles.userPermissions.status.${status}`, status);
  }

  private roleName(g: UserPermissionGrantDto): string {
    return this.languageService.bilingual(g.role.nameEn, g.role.nameAr);
  }

  private name(n: IBilingualNameDto): string {
    return this.languageService.bilingual(n.nameEn, n.nameAr);
  }

  private moduleName(module: string): string {
    return this.translateOr(`roles.matrix.module.${module}.name`, module);
  }

  private sentence(key: string): string {
    return this.translateOr(`roles.matrix.sentence.${key}`, key);
  }

  private translateOr(key: string, fallback: string): string {
    const value: unknown = this.translate.instant(key);
    return typeof value === 'string' && value !== key ? value : fallback;
  }

  /** Counts and dates read in the page's direction: isolated digit runs in Arabic. */
  private digits(text: string): string {
    return this.isRtl() ? isolateDigits(text) : text;
  }
}
