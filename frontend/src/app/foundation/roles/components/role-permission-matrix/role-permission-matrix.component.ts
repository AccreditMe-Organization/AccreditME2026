import { Component, DestroyRef, ElementRef, HostListener, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { RoleService, RoleDto, PermissionDto } from '../../services/role.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmCountPipe, FormatService } from '../../../../core/formatting';
import { refusalCode } from '../../../../core/http/refusal';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  PermissionChangeGroup,
  PermissionSaveConfirmComponent,
  PermissionSaveState,
} from './permission-save-confirm.component';
import {
  ListFilter,
  MatrixModule,
  MatrixPermission,
  RowMark,
  TriState,
  buildMatrix,
  changesOf,
  filterActive,
  heldCount,
  markOf,
  toggleKeys,
  triState,
  visibleKeys,
} from '../../permission-matrix/permission-matrix.model';
import { LeaveGuarded } from '../../permission-matrix/leave-guard';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';

// ACC-120 — the tenant's ROOT ROLE, frozen server-side (assignPermissions
// refuses it), and the Platform Administrator role, frozen in every
// organisation (R1c). The page shows both read-only rather than offering an
// edit it knows will be refused.
const ROOT_ROLE_KEY = 'TENANT_ADMIN';
const PLATFORM_ROLE_KEY = 'PLATFORM_ADMIN';

/** How many changes each heading of the save confirmation lists (Users and Roles 3b). */
const CONFIRM_LINES = 4;

/** How long "Saved · n changes" stays in the header (3c). */
const SAVED_NOTICE_MS = 5000;

/** Left-to-right isolates (LRI … PDI): a number keeps its own order inside an Arabic line. */
const iso = (text: string): string => `⁦${text}⁩`;

interface RowView {
  key: string;
  sentence: string;
  /** Administration's second line ("Each admin page also needs its own permission"). */
  note: string | null;
  mark: RowMark;
  held: boolean;
  /** workflows:manage on the root role: "Organization Administrator only". */
  rootOnly: boolean;
}

interface GroupView {
  id: string | null;
  label: string | null;
  rows: RowView[];
  keys: string[];
  visible: string[];
  held: number;
  tri: TriState;
}

interface ModuleView {
  module: string;
  name: string;
  description: string;
  groups: GroupView[];
  keys: string[];
  visible: string[];
  held: number;
  tri: TriState;
  collapsed: boolean;
}

/**
 * ACC-272 — a role's permissions, `/roles/:id/permissions`, as a GROUPED LIST.
 *
 * Built against "AccreditMe Role Permissions.dc.html" (sections 1 and 2). It
 * replaced ACC-120 slice 5's six-column grid: the server stores a plain list
 * of keys, and the page shows it as one. Each module is a section with its
 * name, description, a tri-state box and "n of N"; a module of more than six
 * rows splits into the groups of permission-groups.ts, each with its own box.
 * One row per permission: a checkbox and its sentence, never the raw key. No
 * row implies another.
 *
 * ## Find, and Show granted only
 *
 * Both filter what is SHOWN, never what is saved. "Show granted only" reads
 * the set as edited now, and keeps every changed row in view. While a filter
 * is on, a module or group box acts only on its visible rows, and its tooltip
 * says so; its state and its spoken count are still the whole module's.
 *
 * ## The layout
 *
 * The page scrolls in <main>; each module heading is sticky, so its box stays
 * in reach while its rows scroll. Its `top` is minus the shell's padding on
 * <main> (`p-4`, 16px): Chrome measures a sticky top from inside that
 * padding, and at 0 the rows showed through a 16px strip above the heading. Below 768px it is one
 * column, sentences wrap, and the header's save controls move to a bar fixed
 * at the bottom of the screen. The room under the list is the bar's MEASURED
 * height (a ResizeObserver), never a fixed size: the bar wraps to two lines on
 * a phone, and a longer translation or a larger font makes it taller still.
 *
 * ## The keyboard
 *
 * Plain checkboxes in tab order; Space toggles. The module and group boxes are
 * buttons with role="checkbox" and aria-checked "mixed" while some are
 * granted, named "All Committees permissions, 5 of 12 granted".
 *
 * ## Saving (D4, D, G)
 *
 * Unchanged from the grid: the header counts the changes, and "Review n
 * changes…" opens a one-column confirmation listing them in words. Save sends
 * the edited set AND the set as loaded; a 409 means someone else saved this
 * role first, and the only way on is "Reload role".
 */
@Component({
  selector: 'app-role-permission-matrix',
  host: { class: 'block' },
  standalone: true,
  imports: [
    FormsModule,
    PageHeaderComponent,
    PermissionSaveConfirmComponent,
    TranslatePipe,
    AmCountPipe,
    ButtonModule,
    TagModule,
    MessageModule,
    InputTextModule,
    ToggleSwitchModule,
    TooltipModule,
  ],
  template: `
    <div class="flex flex-col gap-4">
      @if (role(); as r) {
        <app-page-header [title]="roleName()" [purpose]="subtitle()" [eyebrow]="'roles.permissionMatrix' | translate">
          <div pageActions class="flex flex-wrap items-center gap-2">
            @if (r.isSystem) {
              <p-tag [value]="'roles.systemBadge' | translate" severity="info" />
            }
            @if (!readOnly()) {
              @if (changeCount() > 0) {
                <span class="contents max-md:hidden">
                  <span class="pm-unsaved" data-pm-unsaved>{{ changeCount() | amCount: 'role.unsaved' }}</span>
                  <p-button [label]="'common.discard' | translate" severity="secondary" [outlined]="true" (onClick)="discard()" />
                  <p-button [label]="changeCount() | amCount: 'role.review'" (onClick)="openConfirm()" data-pm-review />
                </span>
              } @else if (savedCount() > 0) {
                <span class="text-meta font-semibold text-[var(--am-success-ink)]" role="status" data-pm-saved>{{ savedCount() | amCount: 'role.saved' }}</span>
              }
            }
          </div>
        </app-page-header>
      }

      @if (noticeKey()) {
        <p-message severity="info" [text]="noticeKey()! | translate" data-pm-notice />
      }

      @if (loadError()) {
        <div class="flex flex-col items-start gap-[var(--am-space-6)] px-[var(--am-space-16)] py-[var(--am-space-12)] border border-[var(--am-danger-border)] rounded-card bg-[var(--am-danger-bg)]" role="alert" data-pm-error>
          <p class="m-0 font-semibold text-[var(--am-danger-ink)]">{{ 'roles.matrix.loadFailedTitle' | translate }}</p>
          <p class="m-0 text-value">{{ 'roles.matrix.loadFailedBody' | translate }}</p>
          <p-button [label]="'common.retry' | translate" severity="secondary" [outlined]="true" (onClick)="load()" data-pm-retry />
        </div>
      } @else if (loading()) {
        @for (s of [1, 2, 3]; track s) {
          <div class="pm-mod flex flex-col gap-3 p-4" data-pm-skeleton aria-hidden="true">
            <span class="am-skeleton-bar w-2/5"></span>
            <span class="am-skeleton-bar w-4/5"></span>
            <span class="am-skeleton-bar w-3/5"></span>
          </div>
        }
      } @else if (modules().length === 0) {
        <p class="text-sm text-[var(--am-ink-500)]">{{ 'roles.matrix.noneShown' | translate }}</p>
      } @else {
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2" data-pm-toolbar>
          <span class="relative flex-[0_1_calc(var(--am-space-40)*7.5)] max-md:flex-[1_1_100%]">
            <input
              pInputText
              type="search"
              class="w-full pe-[var(--am-space-32)] [&::-webkit-search-cancel-button]:hidden"
              [ngModel]="query()"
              (ngModelChange)="query.set($event)"
              [placeholder]="'roles.matrix.find' | translate"
              [attr.aria-label]="'roles.matrix.find' | translate"
              autocomplete="off"
              data-pm-find
            />
            @if (query()) {
              <button
                type="button"
                class="pm-focus absolute inset-y-0 end-[var(--am-space-8)] my-auto h-fit border-0 bg-transparent p-0 text-ink-500 cursor-pointer"
                [attr.aria-label]="'roles.matrix.clearSearch' | translate"
                (click)="query.set('')"
                data-pm-find-clear
              >✕</button>
            }
          </span>
          <label class="inline-flex items-center gap-2 text-value whitespace-nowrap">
            <p-toggleswitch [ngModel]="grantedOnly()" (ngModelChange)="grantedOnly.set($event)" inputId="pm-granted-only" data-pm-granted-only />
            <span>{{ 'roles.matrix.grantedOnly' | translate }}</span>
          </label>
          <span class="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-700 md:ms-auto" data-pm-legend>
            @if (readOnly()) {
              <span class="inline-flex items-center gap-[var(--am-space-6)] whitespace-nowrap"><span class="pm-ro pm-ro--on" aria-hidden="true">✓</span>{{ 'roles.matrix.held' | translate }}</span>
              <span class="inline-flex items-center gap-[var(--am-space-6)] whitespace-nowrap"><span class="pm-ro" aria-hidden="true">·</span>{{ 'roles.matrix.notHeld' | translate }}</span>
            } @else {
              <span class="inline-flex items-center gap-[var(--am-space-6)] whitespace-nowrap"><span class="pm-box pm-box--on !m-0" aria-hidden="true">✓</span>{{ 'roles.matrix.held' | translate }}</span>
              <span class="inline-flex items-center gap-[var(--am-space-6)] whitespace-nowrap"><span class="pm-box !m-0" aria-hidden="true"></span>{{ 'roles.matrix.notHeld' | translate }}</span>
              <span class="inline-flex items-center gap-[var(--am-space-6)] whitespace-nowrap"><span class="pm-tag pm-tag--granted" aria-hidden="true">＋</span>{{ 'roles.matrix.newlyGranted' | translate }}</span>
              <span class="inline-flex items-center gap-[var(--am-space-6)] whitespace-nowrap"><span class="pm-tag pm-tag--revoked" aria-hidden="true">−</span>{{ 'roles.matrix.newlyRevoked' | translate }}</span>
            }
          </span>
        </div>

        @if (noMatch()) {
          <div class="text-center px-[var(--am-space-16)] py-[var(--am-space-24)] border border-dashed border-[var(--am-border-strong)] rounded-card bg-surface-raised" role="status" data-pm-no-match>
            {{ 'roles.matrix.noMatch' | translate }}
            <button type="button" class="pm-focus border-0 bg-transparent p-0 font-semibold text-[var(--am-primary-700)] cursor-pointer" (click)="clearFilter()" data-pm-clear>{{ 'roles.matrix.noMatchClear' | translate }}</button>
          </div>
        }

        @for (m of view(); track m.module) {
          <section class="pm-mod" [attr.data-pm-module]="m.module" [attr.aria-label]="m.name">
            <div class="pm-head" [class.pm-head--open]="!m.collapsed" data-pm-head>
              @if (!readOnly()) {
                <button
                  type="button"
                  role="checkbox"
                  class="pm-box"
                  [class.pm-box--on]="m.tri !== 'none'"
                  [attr.aria-checked]="aria(m.tri)"
                  [attr.aria-label]="boxLabel(m.name, m.held, m.keys.length)"
                  [attr.aria-description]="filtering() ? tip(m.visible.length) : null"
                  [pTooltip]="filtering() ? tip(m.visible.length) : ''"
                  tooltipEvent="both"
                  (click)="toggle(m.visible)"
                  data-pm-module-box
                >{{ boxGlyph(m.tri) }}</button>
              }
              <span class="min-w-0 flex-[1_1_calc(var(--am-space-40)*5)]">
                <span class="block font-semibold text-body">{{ m.name }}</span>
                <span class="block text-meta text-ink-500">{{ m.description }}</span>
              </span>
              <span class="flex-none text-value text-ink-700 tabular-nums" data-pm-count>{{
                filtering() ? matchCount(m.visible.length, m.keys.length) : ofCount(m.held, m.keys.length)
              }}</span>
              @if (!filtering()) {
                <button
                  type="button"
                  class="pm-fold pm-focus"
                  [attr.aria-expanded]="!m.collapsed"
                  [attr.aria-label]="(m.collapsed ? 'roles.matrix.expand' : 'roles.matrix.collapse') | translate: { name: m.name }"
                  (click)="toggleCollapsed(m.module)"
                  data-pm-fold
                >{{ m.collapsed ? (isRtl() ? '◂' : '▸') : '▾' }}</button>
              }
            </div>
            @if (!m.collapsed) {
              @for (g of m.groups; track g.id ?? '') {
                @if (g.label) {
                  <div class="pm-group" [attr.data-pm-group]="g.id">
                    @if (!readOnly()) {
                      <button
                        type="button"
                        role="checkbox"
                        class="pm-box"
                        [class.pm-box--on]="g.tri !== 'none'"
                        [attr.aria-checked]="aria(g.tri)"
                        [attr.aria-label]="boxLabel(g.label, g.held, g.keys.length)"
                        [attr.aria-description]="filtering() ? tip(g.visible.length) : null"
                        [pTooltip]="filtering() ? tip(g.visible.length) : ''"
                        tooltipEvent="both"
                        (click)="toggle(g.visible)"
                        data-pm-group-box
                      >{{ boxGlyph(g.tri) }}</button>
                    }
                    <span class="flex-auto font-semibold text-meta text-ink-700">{{ g.label }}</span>
                    <span class="flex-none text-meta text-ink-500 tabular-nums" data-pm-count>{{ ofCount(g.held, g.keys.length) }}</span>
                  </div>
                }
                @for (r of g.rows; track r.key) {
                  <div
                    class="pm-row"
                    [class.pm-row--in]="!!g.label"
                    [class.pm-row--granted]="r.mark === 'granted'"
                    [class.pm-row--revoked]="r.mark === 'revoked'"
                    [attr.data-pm-row]="r.key"
                    [attr.data-pm-mark]="r.mark"
                  >
                    @if (!readOnly()) {
                      <input
                        type="checkbox"
                        class="pm-check"
                        [id]="rowId(r.key)"
                        [checked]="r.held"
                        (change)="toggle([r.key])"
                        [attr.aria-label]="r.sentence"
                        [attr.aria-describedby]="r.note || r.mark === 'granted' || r.mark === 'revoked' || warnsSelfElevation(r) ? rowId(r.key) + '-d' : null"
                      />
                    } @else {
                      <span class="pm-ro" [class.pm-ro--on]="r.held" role="img" [attr.aria-label]="(r.held ? 'roles.matrix.held' : 'roles.matrix.notHeld') | translate" data-pm-glyph>{{
                        r.held ? '✓' : '·'
                      }}</span>
                    }
                    <span class="min-w-0 flex-[1_1_calc(var(--am-space-40)*5.5)]">
                      <label class="pm-sentence" [class.font-medium]="readOnly() && r.held" [attr.for]="readOnly() ? null : rowId(r.key)">{{ r.sentence }}</label>
                      <span [id]="rowId(r.key) + '-d'" class="contents">
                        @if (r.note) {
                          <span class="block text-meta text-ink-500">{{ r.note }}</span>
                        }
                        <!-- ACC-221 — allowed, and said: whoever holds it can give
                             themselves Organization Administrator. Not a refusal. -->
                        @if (warnsSelfElevation(r)) {
                          <span class="pm-warn" data-pm-self-elevation><span aria-hidden="true">⚠ </span>{{ 'roles.matrix.manageRolesWarning' | translate }}</span>
                        }
                        @if (r.mark === 'granted') {
                          <span class="sr-only">{{ 'roles.matrix.newlyGranted' | translate }}</span>
                        } @else if (r.mark === 'revoked') {
                          <span class="sr-only">{{ 'roles.matrix.newlyRevoked' | translate }}</span>
                        }
                      </span>
                    </span>
                    @if (r.mark === 'granted') {
                      <span class="pm-tag pm-tag--granted" aria-hidden="true" data-pm-tag>＋ {{ 'roles.matrix.grantedTag' | translate }}</span>
                    } @else if (r.mark === 'revoked') {
                      <span class="pm-tag pm-tag--revoked" aria-hidden="true" data-pm-tag>− {{ 'roles.matrix.revokedTag' | translate }}</span>
                    } @else if (r.rootOnly) {
                      <span class="pm-tag" data-pm-tag>{{ 'roles.matrix.rootRoleOnlyTag' | translate }}</span>
                    }
                  </div>
                }
              }
            }
          </section>
        }
      }
    </div>

    @if (showPhoneBar()) {
      <!-- Room under the last row, exactly the fixed bar's height, so it never covers it. -->
      <div class="md:hidden" [style.height.px]="phoneBarHeight()" aria-hidden="true" data-pm-phone-room></div>
      <div #phoneBar class="fixed inset-x-0 bottom-0 z-[5] flex flex-wrap items-center justify-between gap-[var(--am-space-8)] px-[var(--am-space-12)] py-[var(--am-space-8)] bg-surface-raised border-t border-[var(--am-border-strong)] md:hidden" data-pm-phone-bar>
        <span class="pm-unsaved">{{ changeCount() | amCount: 'role.unsaved' }}</span>
        <span class="flex gap-2">
          <p-button [label]="'common.discard' | translate" severity="secondary" [outlined]="true" (onClick)="discard()" />
          <p-button [label]="changeCount() | amCount: 'role.review'" (onClick)="openConfirm()" data-pm-phone-review />
        </span>
      </div>
    }

    <app-permission-save-confirm
      [visible]="confirmOpen()"
      [roleName]="nameInSentence()"
      [activeHolders]="activeHolders()"
      [headHolders]="headHolders()"
      [groups]="confirmGroups()"
      [changeCount]="changeCount()"
      [state]="saveState()"
      [primaryLabel]="primaryLabel()"
      (cancelled)="closeConfirm()"
      (confirmed)="save()"
      (reload)="reloadRole()"
    />
  `,
  styles: [
    `
      .pm-mod{border:1px solid var(--am-border);border-radius:var(--am-radius-card);background:var(--am-surface-raised);padding-block-end:var(--am-space-4)}
      .pm-head{position:sticky;top:calc(var(--am-space-16) * -1);z-index:1;display:flex;flex-wrap:wrap;align-items:flex-start;gap:var(--am-space-6) var(--am-space-12);padding:var(--am-space-12) var(--am-space-16);background:var(--am-surface-raised);border-radius:var(--am-radius-card)}
      .pm-head--open{border-end-start-radius:0;border-end-end-radius:0;border-block-end:1px solid var(--am-border)}
      .pm-group,.pm-row{display:flex;align-items:flex-start;gap:var(--am-space-4) var(--am-space-12);padding:var(--am-space-8) var(--am-space-16);padding-inline-start:var(--am-space-24)}
      .pm-group{border-block-start:1px solid var(--am-row-rule)}
      .pm-row{flex-wrap:wrap}
      .pm-row--in{padding-inline-start:calc(var(--am-space-24) * 2 + var(--am-space-4))}
      .pm-row--granted{background:var(--am-success-bg)}
      .pm-row--revoked{background:var(--am-warning-bg)}
      .pm-row--revoked .pm-sentence{text-decoration:line-through;text-decoration-color:var(--am-warning-ink)}
      .pm-sentence{display:block;font-size:var(--am-type-value-size);line-height:var(--am-type-body-line);color:var(--am-ink-900)}
      .pm-box,.pm-check{flex:none;box-sizing:border-box;inline-size:var(--am-space-16);block-size:var(--am-space-16);margin:var(--am-space-2) 0 0;padding:0;border-radius:var(--am-radius-control)}
      .pm-box{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--am-control-border);background:var(--am-surface-raised);color:var(--am-surface-raised);font-size:var(--am-type-micro-size);font-weight:700;line-height:1;cursor:pointer}
      .pm-box--on{border-color:var(--am-primary-700);background:var(--am-primary-600)}
      .pm-check{accent-color:var(--am-primary-600);cursor:pointer}
      .pm-box:focus-visible,.pm-check:focus-visible,.pm-focus:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .pm-ro{flex:none;inline-size:var(--am-space-16);text-align:center;font-weight:700;line-height:var(--am-type-body-line);color:var(--am-ink-300)}
      .pm-ro--on{color:var(--am-primary-700)}
      .pm-tag{flex:none;font-size:var(--am-type-micro-size);font-weight:600;border-radius:var(--am-radius-control);padding:0 var(--am-space-6);border:1px solid var(--am-border-strong);background:var(--am-surface);color:var(--am-ink-700)}
      .pm-tag--granted{color:var(--am-success-ink);border-color:var(--am-success-ink);background:var(--am-surface-raised)}
      .pm-tag--revoked{color:var(--am-warning-ink);border-color:var(--am-warning-ink);background:var(--am-surface-raised)}
      .pm-fold{flex:none;inline-size:calc(var(--am-space-24) + var(--am-space-4));block-size:calc(var(--am-space-24) + var(--am-space-4));border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);background:var(--am-surface-raised);color:var(--am-ink-700);cursor:pointer}
      .pm-warn{display:block;font-size:var(--am-type-meta-size);line-height:var(--am-type-body-line);font-weight:600;color:var(--am-warning-ink)}
      .pm-unsaved{font-size:var(--am-type-meta-size);font-weight:600;color:var(--am-warning-ink);background:var(--am-warning-bg);border:1px solid var(--am-warning-border);border-radius:var(--am-radius-control);padding:var(--am-space-2) var(--am-space-8)}
    `,
  ],
})
export class RolePermissionMatrixComponent implements OnInit, LeaveGuarded {
  private readonly roleService = inject(RoleService);
  private readonly route = inject(ActivatedRoute);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly amConfirm = inject(AmConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  private roleId = '';
  private savedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly role = signal<RoleDto | null>(null);
  private readonly catalogue = signal<PermissionDto[]>([]);

  /** The set the page LOADED — what a save sends as expectedPermissionKeys (D4). */
  readonly loaded = signal<ReadonlySet<string>>(new Set());
  /** The set as edited now. Hidden keys (not in use, platform in a tenant) stay as held. */
  readonly selected = signal<ReadonlySet<string>>(new Set());

  readonly confirmOpen = signal(false);
  readonly saveState = signal<PermissionSaveState>('idle');
  readonly savedCount = signal(0);

  // Find and Show granted only: what is SHOWN, never what is saved.
  readonly query = signal('');
  readonly grantedOnly = signal(false);
  /** Modules folded by hand. Every module opens expanded (the design's Q3). */
  readonly collapsed = signal<ReadonlySet<string>>(new Set());

  readonly isRtl = computed(() => this.languageService.isRtl());

  // PATCH /roles/:id/permissions requires roles:manage. The ROUTE needs only
  // admin:access + roles:view, so a reader reaches this page and reads it.
  readonly canManage = computed(() => this.navigationAccess.hasPermission('roles:manage'));
  readonly isRootRole = computed(() => this.role()?.key === ROOT_ROLE_KEY);

  /**
   * ACC-221 — "Manage roles" ticked on a role other than Organization
   * Administrator: anyone holding it can give themselves that role. Ticking it
   * is allowed and the save is not blocked; the row says what it means.
   */
  warnsSelfElevation(row: { key: string; held: boolean }): boolean {
    return row.key === 'roles:manage' && row.held && !this.isRootRole() && !this.isPlatformRole();
  }
  readonly isPlatformRole = computed(() => this.role()?.key === PLATFORM_ROLE_KEY);

  // ONE flag the template reads, so the list and the save controls cannot
  // disagree about whether the page is editable.
  readonly readOnly = computed(() => !this.canManage() || this.isRootRole() || this.isPlatformRole());

  /**
   * Why the page is read-only. Permission first: the frozen-role sentences
   * end in what an administrator CAN do instead, which is false for a reader
   * who cannot manage roles at all.
   */
  readonly noticeKey = computed<string | null>(() => {
    if (!this.role()) return null;
    if (!this.canManage()) return 'roles.matrixReadOnly';
    if (this.isRootRole()) return 'roles.matrixFrozenRootRole';
    if (this.isPlatformRole()) return 'roles.matrix.frozenPlatformRole';
    return null;
  });

  // Tenant data, chosen by language (SYSTEM-REFERENCE §9.3).
  readonly roleName = computed(() => {
    const role = this.role();
    return role ? this.languageService.bilingual(role.nameEn, role.nameAr) : '';
  });

  /**
   * The name as it goes INTO a sentence: wrapped in Unicode isolates (FSI …
   * PDI), so an English name inside an Arabic sentence keeps its own order.
   */
  readonly nameInSentence = computed(() => `⁨${this.roleName()}⁩`);

  readonly activeHolders = computed(() => this.role()?.activeHolderCount ?? 0);
  readonly headHolders = computed(() => this.role()?.headPositionHolderCount ?? 0);

  /** "Permissions · held by N users", plus the consequence while editable (D). */
  readonly subtitle = computed(() => {
    if (!this.role()) return null;
    const parts = [this.translate.instant('roles.matrix.subtitle'), this.format.count('role.heldBy', this.activeHolders())];
    if (!this.readOnly()) parts.push(this.translate.instant('roles.matrix.affects'));
    return parts.join(' · ');
  });

  /** D2 — platform keys are hidden inside a tenant; workflows:manage shows on the root role only. */
  readonly modules = computed<MatrixModule[]>(() =>
    buildMatrix(this.catalogue(), { isTenant: !this.navigationAccess.isPlatformOrg(), isRootRole: this.isRootRole() }),
  );

  readonly filter = computed<ListFilter>(() => ({ query: this.query(), grantedOnly: this.grantedOnly() }));
  readonly filtering = computed(() => filterActive(this.filter()));

  /**
   * What the list draws: each module with its groups and visible rows. While
   * a filter is on, a module with nothing visible is left out, and folded
   * modules are shown open (a match is never hidden in a fold).
   */
  readonly view = computed<ModuleView[]>(() => {
    // Read so the sentences follow a language switch.
    this.isRtl();
    const selected = this.selected();
    const loaded = this.loaded();
    const filter = this.filter();
    const filtering = this.filtering();
    const collapsed = this.collapsed();
    const sentenceOf = (key: string) => this.sentence(key);
    return this.modules()
      .map((m): ModuleView => {
        const groups = m.groups.map((g): GroupView => {
          const visible = visibleKeys(g.permissions, sentenceOf, filter, selected, loaded);
          return {
            id: g.id,
            label: g.id ? this.translateOr(`roles.matrix.group.${m.module}.${g.id}`, g.id) : null,
            rows: g.permissions.filter((p) => visible.includes(p.key)).map((p) => this.rowOf(p, selected, loaded)),
            keys: g.keys,
            visible,
            held: heldCount(g.keys, selected),
            tri: triState(g.keys, selected),
          };
        });
        return {
          module: m.module,
          name: this.moduleName(m.module),
          description: this.moduleDescription(m.module),
          groups: groups.filter((g) => !filtering || g.rows.length > 0),
          keys: m.keys,
          visible: groups.flatMap((g) => g.visible),
          held: heldCount(m.keys, selected),
          tri: triState(m.keys, selected),
          collapsed: !filtering && collapsed.has(m.module),
        };
      })
      .filter((m) => !filtering || m.visible.length > 0);
  });

  /** "No permissions match." — a filter is on and leaves nothing. */
  readonly noMatch = computed(() => this.filtering() && this.view().length === 0);

  readonly changes = computed(() => changesOf(this.modules(), this.selected(), this.loaded()));
  readonly changeCount = computed(() => this.changes().added.length + this.changes().removed.length);
  readonly showPhoneBar = computed(() => !this.readOnly() && this.changeCount() > 0);

  /** The phone bar, while it is rendered, and its measured height for the room under the list. */
  private readonly phoneBar = viewChild<ElementRef<HTMLElement>>('phoneBar');
  readonly phoneBarHeight = signal(0);

  constructor() {
    // One observer per rendered bar, disconnected when the bar goes (or the page
    // does): effect cleanup runs on both.
    effect((onCleanup) => {
      const bar = this.phoneBar()?.nativeElement;
      if (!bar || typeof ResizeObserver === 'undefined') {
        this.phoneBarHeight.set(0);
        return;
      }
      const observer = new ResizeObserver(() => this.phoneBarHeight.set(Math.ceil(bar.getBoundingClientRect().height)));
      observer.observe(bar);
      onCleanup(() => observer.disconnect());
    });
  }

  /** The confirmation's two headings, each line "Module · sentence" (3b). */
  readonly confirmGroups = computed<PermissionChangeGroup[]>(() => {
    const { added, removed } = this.changes();
    const group = (kind: 'added' | 'removed', list: MatrixPermission[]): PermissionChangeGroup => ({
      kind,
      total: list.length,
      lines: list.slice(0, CONFIRM_LINES).map((p) => ({ key: p.key, text: `${this.moduleName(p.module)} · ${this.sentence(p.key)}` })),
      more: Math.max(0, list.length - CONFIRM_LINES),
    });
    return [group('added', added), group('removed', removed)].filter((g) => g.total > 0);
  });

  /** "Save changes", or "Save n changes" once a list is cut off (3b). Failed: "Try again". */
  readonly primaryLabel = computed(() => {
    if (this.saveState() === 'failed') return this.translate.instant('roles.matrix.tryAgain');
    const truncated = this.confirmGroups().some((g) => g.more > 0);
    return truncated ? this.format.count('role.saveN', this.changeCount()) : this.translate.instant('roles.matrix.saveChanges');
  });

  ngOnInit(): void {
    this.roleId = this.route.snapshot.paramMap.get('id') ?? '';
    this.destroyRef.onDestroy(() => this.clearSavedTimer());
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    forkJoin({
      role: this.roleService.getRole(this.roleId),
      catalogue: this.roleService.listAllPermissions(),
    }).subscribe({
      next: ({ role, catalogue }) => {
        this.applyRole(role);
        this.catalogue.set(catalogue);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set(true);
        this.loading.set(false);
      },
    });
  }

  private applyRole(role: RoleDto): void {
    const held = new Set(role.permissions ?? []);
    this.role.set(role);
    this.loaded.set(held);
    this.selected.set(new Set(held));
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  moduleName(module: string): string {
    return this.translateOr(`roles.matrix.module.${module}.name`, module);
  }

  moduleDescription(module: string): string {
    return this.translateOr(`roles.matrix.module.${module}.description`, '');
  }

  /** The permission's sentence (R4) — never the raw key, unless no sentence exists. */
  sentence(key: string): string {
    return this.translateOr(`roles.matrix.sentence.${key}`, key);
  }

  private translateOr(key: string, fallback: string): string {
    const value: unknown = this.translate.instant(key);
    return typeof value === 'string' && value !== key ? value : fallback;
  }

  private rowOf(p: MatrixPermission, selected: ReadonlySet<string>, loaded: ReadonlySet<string>): RowView {
    const note = this.translateOr(`roles.matrix.sentenceNote.${p.key}`, '');
    const permission = this.catalogue().find((c) => `${c.module}:${c.action}` === p.key);
    return {
      key: p.key,
      sentence: this.sentence(p.key),
      note: note || null,
      mark: markOf(p.key, selected, loaded),
      held: selected.has(p.key),
      rootOnly: !!permission?.rootRoleOnly,
    };
  }

  rowId(key: string): string {
    return `pm-${key.replace(/[^a-z0-9_-]/gi, '-')}`;
  }

  /** A count as a person reads it: digits in an isolated run in Arabic, so «5 من 12» keeps its order. */
  private num(n: number): string {
    const text = this.format.number(n);
    return this.isRtl() ? iso(text) : text;
  }

  ofCount(held: number, total: number): string {
    return this.translate.instant('roles.matrix.ofCount', { held: this.num(held), total: this.num(total) });
  }

  matchCount(shown: number, total: number): string {
    return this.translate.instant('roles.matrix.matchCount', { shown: this.num(shown), total: this.num(total) });
  }

  /** "All Committees permissions, 5 of 12 granted": always the WHOLE module's count. */
  boxLabel(name: string, held: number, total: number): string {
    return this.translate.instant('roles.matrix.moduleBox', { name, held: this.num(held), total: this.num(total) });
  }

  /** The tooltip while a filter is on: the box acts only on the rows shown. */
  tip(visible: number): string {
    return this.format.count('role.filterActs', visible);
  }

  aria(tri: TriState): 'true' | 'false' | 'mixed' {
    return tri === 'all' ? 'true' : tri === 'some' ? 'mixed' : 'false';
  }

  boxGlyph(tri: TriState): string {
    return tri === 'all' ? '✓' : tri === 'some' ? '–' : '';
  }

  // ── Changing ──────────────────────────────────────────────────────────────

  /** A row, or a module or group box: under a filter, only the rows shown. */
  toggle(keys: readonly string[]): void {
    if (this.readOnly() || keys.length === 0) return;
    this.selected.set(toggleKeys(keys, this.selected()));
  }

  toggleCollapsed(module: string): void {
    const next = new Set(this.collapsed());
    if (next.has(module)) next.delete(module);
    else next.add(module);
    this.collapsed.set(next);
  }

  /** "Clear the search." clears both filters. */
  clearFilter(): void {
    this.query.set('');
    this.grantedOnly.set(false);
  }

  discard(): void {
    this.selected.set(new Set(this.loaded()));
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  openConfirm(): void {
    if (this.readOnly() || this.changeCount() === 0) return;
    this.saveState.set('idle');
    this.confirmOpen.set(true);
  }

  closeConfirm(): void {
    if (this.saveState() === 'saving') return;
    this.confirmOpen.set(false);
    this.saveState.set('idle');
  }

  save(): void {
    if (this.readOnly() || this.saveState() === 'saving') return;
    const count = this.changeCount();
    this.saveState.set('saving');
    // The FULL set — hidden held keys included — and the set as loaded.
    this.roleService.assignPermissions(this.roleId, [...this.selected()], [...this.loaded()]).subscribe({
      next: (role) => {
        const held = new Set(role.permissions ?? [...this.selected()]);
        this.loaded.set(held);
        this.selected.set(new Set(held));
        this.saveState.set('idle');
        this.confirmOpen.set(false);
        this.showSaved(count);
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 403) this.saveState.set('forbidden');
        else if (refusalCode(err) === 'ROLE_PERMISSIONS_CHANGED') this.saveState.set('conflict');
        // ACC-258 — only reachable from a stale catalogue: the list no longer offers the key.
        else if (refusalCode(err) === 'PERMISSION_ROOT_ROLE_ONLY') this.saveState.set('rootRoleOnly');
        else this.saveState.set('failed');
      },
    });
  }

  /** 409 — someone else saved first. Their set replaces this page's, changes and all. */
  reloadRole(): void {
    this.confirmOpen.set(false);
    this.saveState.set('idle');
    this.roleService.getRole(this.roleId).subscribe({
      next: (role) => this.applyRole(role),
      error: () => this.loadError.set(true),
    });
  }

  private showSaved(count: number): void {
    this.clearSavedTimer();
    this.savedCount.set(count);
    this.savedTimer = setTimeout(() => this.savedCount.set(0), SAVED_NOTICE_MS);
  }

  private clearSavedTimer(): void {
    if (this.savedTimer !== null) clearTimeout(this.savedTimer);
    this.savedTimer = null;
  }

  // ── Leaving (D11) ─────────────────────────────────────────────────────────

  canLeave(): boolean | Promise<boolean> {
    if (this.readOnly() || this.changeCount() === 0) return true;
    return new Promise<boolean>((resolve) => {
      this.amConfirm.ask({
        tone: 'destructive',
        header: this.translate.instant('roles.matrix.leaveHeader'),
        message: this.translate.instant('roles.matrix.leaveMessage'),
        acceptLabel: this.translate.instant('roles.matrix.leave'),
        rejectLabel: this.translate.instant('roles.matrix.stay'),
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.readOnly() || this.changeCount() === 0) return;
    event.preventDefault();
    // Some browsers still need returnValue set to show their own prompt.
    event.returnValue = '';
  }
}
