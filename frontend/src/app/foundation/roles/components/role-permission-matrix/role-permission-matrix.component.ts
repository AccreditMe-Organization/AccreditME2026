import { Component, DestroyRef, ElementRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { NgClass } from '@angular/common';
import { forkJoin } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
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
import { MATRIX_COLUMNS } from '../../permission-matrix/permission-columns';
import {
  CELL_COUNT,
  LABEL_CELL,
  MatrixModule,
  MatrixPermission,
  MatrixRow,
  TriState,
  buildMatrix,
  cellKeys,
  changesOf,
  groupChanged,
  markOf,
  matrixRows,
  rowKeys,
  toggleKeys,
  triState,
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

/** What a cell draws. `na` is the hatch; `some` the tri-state dash. */
type CellGlyph = 'on' | 'off' | 'granted' | 'revoked' | 'some' | 'na';

/**
 * ACC-120 slice 5, PR B — the permission matrix, `/roles/:id/permissions`.
 *
 * Built against Templates 6a and Users and Roles section 3. The plan is
 * backend/Plans/step-120-5-permission-matrix.md (sections A, C–G).
 *
 * ## The layout (F)
 *
 * A grid of rows: a header, then each module's header row followed by one row
 * per permission. The first column is FROZEN with `position: sticky;
 * inset-inline-start: 0`, never `pFrozenColumn`, which writes a physical
 * `left` and so pins to the wrong side in Arabic. One declaration,
 * `.pm-frozen`, serves the header corner, module rows and permission rows.
 * Its shadow's x-offset is physical, so it flips by direction through two
 * tokens.
 *
 * Nothing reads or writes `scrollLeft`: an RTL scroller starts at its right
 * edge and browsers disagree on the sign. Focus keeps the focused cell in
 * view, and `scroll-padding-inline-start` keeps it clear of the frozen column.
 * Columns are never reordered for Arabic; `dir` mirrors them.
 *
 * ## The keyboard (D9)
 *
 * One roving tab stop. Arrows follow the eye, so in Arabic ← moves to the next
 * action column. Home and End go to the row's ends; Space toggles the focused
 * cell; Shift+Space toggles the row (a module row: the whole module).
 *
 * ## Saving (D4, D, G)
 *
 * Cells change locally and ring themselves. The header counts the changes,
 * and "Review n changes…" opens a one-column confirmation listing them in
 * words. Save sends the edited set AND the set as loaded; a 409 means someone
 * else saved this role first, and the only way on is "Reload role", because
 * retrying would overwrite their change unseen.
 */
@Component({
  selector: 'app-role-permission-matrix',
  standalone: true,
  imports: [NgClass, PageHeaderComponent, PermissionSaveConfirmComponent, TranslatePipe, AmCountPipe, ButtonModule, TagModule, MessageModule],
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
                <span class="pm-unsaved" data-pm-unsaved>{{ changeCount() | amCount: 'role.unsaved' }}</span>
                <p-button
                  [label]="'common.discard' | translate"
                  severity="secondary"
                  [outlined]="true"
                  (onClick)="discard()"
                />
                <p-button
                  [label]="changeCount() | amCount: 'role.review'"
                  (onClick)="openConfirm()"
                  data-pm-review
                />
              } @else if (savedCount() > 0) {
                <span class="pm-saved" role="status" data-pm-saved>{{ savedCount() | amCount: 'role.saved' }}</span>
              }
            }
          </div>
        </app-page-header>
      }

      @if (noticeKey()) {
        <p-message severity="info" [text]="noticeKey()! | translate" data-pm-notice />
      }

      @if (loadError()) {
        <div class="flex items-center gap-3" role="alert">
          <span class="text-sm text-[var(--am-danger-ink)]">{{ 'roles.matrix.loadFailed' | translate }}</span>
          <p-button [label]="'common.retry' | translate" severity="secondary" [outlined]="true" (onClick)="load()" />
        </div>
      } @else if (loading()) {
        <p class="text-sm text-[var(--am-ink-500)]">{{ 'common.loading' | translate }}</p>
      } @else if (rows().length === 0) {
        <p class="text-sm text-[var(--am-ink-500)]">{{ 'roles.matrix.noneShown' | translate }}</p>
      } @else {
        <div class="pm-frame" [class.pm--rtl]="isRtl()">
          <div class="pm-scroll">
            <div
              class="pm-grid"
              role="grid"
              [attr.aria-label]="'roles.matrix.gridLabel' | translate: { name: nameInSentence() }"
              [attr.aria-readonly]="readOnly() ? 'true' : null"
              [attr.aria-rowcount]="rows().length + 1"
              [attr.aria-colcount]="cellCount"
              (keydown)="onGridKeydown($event)"
              (focusin)="onGridFocusIn($event)"
            >
              <div role="row" class="pm-row pm-row--head" aria-rowindex="1">
                <div role="columnheader" class="pm-frozen pm-head">{{ 'roles.matrix.columnHeader' | translate }}</div>
                @for (col of columns; track col) {
                  <div role="columnheader" class="pm-cell pm-head">{{ 'roles.matrix.col.' + col | translate }}</div>
                }
              </div>

              @for (row of rows(); track rowId(row); let r = $index) {
                <div
                  role="row"
                  class="pm-row"
                  [class.pm-row--module]="row.kind === 'module'"
                  [attr.aria-rowindex]="r + 2"
                  [attr.data-pm-row]="row.kind"
                >
                  <div
                    role="rowheader"
                    class="pm-frozen pm-label"
                    [class.pm-label--toggle]="isToggle(r, 0)"
                    [attr.data-pm-cell]="isToggle(r, 0) ? null : r + ':0'"
                    [attr.tabindex]="isToggle(r, 0) ? null : tabIndexOf(r, 0)"
                    [attr.aria-label]="isToggle(r, 0) ? null : cellLabel(r, 0)"
                    (click)="activate(r, 0)"
                  >
                    @if (isToggle(r, 0)) {
                      <span
                        role="checkbox"
                        class="pm-box"
                        [ngClass]="'pm-glyph--' + glyphOf(r, 0)"
                        [attr.data-pm-cell]="r + ':0'"
                        [attr.tabindex]="tabIndexOf(r, 0)"
                        [attr.aria-checked]="ariaChecked(r, 0)"
                        [attr.aria-label]="cellLabel(r, 0)"
                        >{{ glyphText(r, 0) }}</span
                      >
                    } @else if (row.kind === 'module' || row.permission.placement === 'row') {
                      <!-- read-only: the glyph only, no checkbox ("absent, not disabled", 3c) -->
                      @if (!readOnly() || row.kind === 'permission') {
                        <span class="pm-ro" [ngClass]="'pm-glyph--' + glyphOf(r, 0)" aria-hidden="true">{{ glyphText(r, 0) }}</span>
                      } @else {
                        <span class="pm-slot" aria-hidden="true"></span>
                      }
                    } @else {
                      <span class="pm-slot" aria-hidden="true"></span>
                    }
                    <span class="pm-label-text">
                      @if (row.kind === 'module') {
                        <span class="pm-module-name">{{ moduleName(row.module.module) }}</span>
                        <span class="pm-module-desc">{{ moduleDescription(row.module.module) }}</span>
                      } @else {
                        <span class="pm-perm-name">{{ sentence(row.permission.key) }}</span>
                      }
                    </span>
                  </div>
                  @for (col of columns; track col; let c = $index) {
                    <div
                      role="gridcell"
                      class="pm-cell"
                      [class.pm-cell--toggle]="isToggle(r, c + 1)"
                      [attr.data-pm-cell]="isToggle(r, c + 1) ? null : r + ':' + (c + 1)"
                      [attr.tabindex]="isToggle(r, c + 1) ? null : tabIndexOf(r, c + 1)"
                      [attr.aria-label]="isToggle(r, c + 1) ? null : cellLabel(r, c + 1)"
                      (click)="activate(r, c + 1)"
                    >
                      @if (isToggle(r, c + 1)) {
                        <span
                          role="checkbox"
                          class="pm-box"
                          [ngClass]="'pm-glyph--' + glyphOf(r, c + 1)"
                          [attr.data-pm-cell]="r + ':' + (c + 1)"
                          [attr.tabindex]="tabIndexOf(r, c + 1)"
                          [attr.aria-checked]="ariaChecked(r, c + 1)"
                          [attr.aria-label]="cellLabel(r, c + 1)"
                          >{{ glyphText(r, c + 1) }}</span
                        >
                      } @else {
                        <span class="pm-ro" [ngClass]="'pm-glyph--' + glyphOf(r, c + 1)" aria-hidden="true">{{
                          glyphText(r, c + 1)
                        }}</span>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>

          <div class="pm-legend">
            @if (readOnly()) {
              <span><span class="pm-ro pm-glyph--on" aria-hidden="true">✓</span>{{ 'roles.matrix.legend.granted' | translate }}</span>
              <span><span class="pm-ro pm-glyph--off" aria-hidden="true">·</span>{{ 'roles.matrix.legend.notGranted' | translate }}</span>
            } @else {
              <span><span class="pm-box pm-glyph--on" aria-hidden="true">✓</span>{{ 'roles.matrix.legend.grantedSaved' | translate }}</span>
              <span><span class="pm-box pm-glyph--granted" aria-hidden="true">✓</span>{{ 'roles.matrix.legend.grantedUnsaved' | translate }}</span>
              <span><span class="pm-box pm-glyph--revoked" aria-hidden="true">✕</span>{{ 'roles.matrix.legend.revokedUnsaved' | translate }}</span>
            }
            <span><span class="pm-box pm-glyph--some" aria-hidden="true">–</span>{{ 'roles.matrix.legend.some' | translate }}</span>
            <span><span class="pm-box pm-glyph--na" aria-hidden="true"></span>{{ 'roles.matrix.legend.notApplicable' | translate }}</span>
          </div>
        </div>
      }
    </div>

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
      .pm-frame {
        border: 1px solid var(--am-border-strong);
        border-radius: var(--am-radius-card);
        overflow: hidden;
        background: var(--am-surface-raised);
        --pm-frozen-shadow: var(--am-frozen-shadow-ltr);
      }
      .pm-frame.pm--rtl {
        --pm-frozen-shadow: var(--am-frozen-shadow-rtl);
      }
      .pm-scroll {
        overflow-x: auto;
        /* Focus scrolls a cell into view; this keeps it out from under the
           frozen column instead of behind it. */
        scroll-padding-inline-start: 300px;
      }
      .pm-grid {
        width: 1200px; /* 300 + 6 × 150 */
      }
      .pm-row {
        display: flex;
        align-items: stretch;
        box-sizing: border-box;
        min-height: 44px; /* on the ROW; the whole cell is the control */
        background: var(--am-surface-raised);
        border-block-end: 1px solid var(--am-row-rule);
      }
      .pm-row--module {
        min-height: 56px;
        background: var(--am-surface);
        border-block-end-color: var(--am-border);
      }
      .pm-row--head {
        min-height: 35px;
        height: 35px;
        background: var(--am-surface);
        border-block-end-color: var(--am-border);
      }

      /* THE ONE frozen-cell declaration — header corner, module rows and
         permission rows all use it, so the column cannot drift between them. */
      .pm-frozen {
        flex: none;
        width: 300px;
        box-sizing: border-box;
        padding: 7px 12px;
        border-inline-end: 1px solid var(--am-border-strong);
        box-shadow: var(--pm-frozen-shadow);
        z-index: 2;
        position: sticky;
        inset-inline-start: 0;
        background: inherit;
      }

      .pm-head {
        font-size: 12px;
        line-height: 19px;
        font-weight: 700;
        color: var(--am-ink-500);
        padding-block: 7px;
      }
      .pm-cell.pm-head {
        justify-content: center;
      }
      .pm-cell {
        flex: none;
        width: 150px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 6px;
      }
      .pm-cell--toggle,
      .pm-label--toggle {
        cursor: pointer;
      }

      .pm-label {
        display: flex;
        align-items: flex-start;
        gap: 9px;
      }
      .pm-label-text {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      /* Type sizes from the drawings: English per 6a (13 / 11.5 / 12.5), Arabic
         per 3a (14 / 12 / 14). Line heights are the same in both, so the row
         geometry — 56 for a module, 44 for a permission — does not change
         with the language. */
      .pm-module-name {
        font-size: 13px;
        line-height: 22px;
        font-weight: 600;
        color: var(--am-ink-900);
      }
      .pm-module-desc {
        font-size: 11.5px;
        line-height: 18px;
        color: var(--am-ink-500);
      }
      .pm-perm-name {
        font-size: 12.5px;
        line-height: 22px;
        color: var(--am-ink-900);
        padding-block-start: 1px;
      }
      .pm--rtl .pm-module-name,
      .pm--rtl .pm-perm-name {
        font-size: 14px;
      }
      .pm--rtl .pm-module-desc {
        font-size: 12px;
      }

      /* Marks — 6a's own: a filled tick, an empty box, a success-ringed tick
         for a grant not saved yet, a danger-ringed cross for a revocation not
         saved yet, and the hatch for "not applicable". Granted and not granted
         differ by GLYPH, so the grid passes greyscale (R3). */
      .pm-box,
      .pm-slot {
        flex: none;
        box-sizing: border-box;
        width: 17px;
        height: 17px;
        margin-block-start: 3px;
        border-radius: 3px;
        font-size: 11px;
        line-height: 15px;
        text-align: center;
      }
      .pm-cell .pm-box {
        margin-block-start: 0;
      }
      .pm-slot {
        visibility: hidden;
      }
      .pm-glyph--on,
      .pm-glyph--some {
        border: 1px solid var(--am-primary-700);
        background: var(--am-primary-600);
        color: var(--am-surface-raised);
      }
      .pm-glyph--off {
        border: 1px solid var(--am-control-border);
        background: var(--am-surface-raised);
        color: transparent;
      }
      .pm-glyph--granted {
        border: 1px solid var(--am-success-ink);
        background: var(--am-success-ink);
        color: var(--am-surface-raised);
        box-shadow:
          0 0 0 3px var(--am-success-bg),
          0 0 0 4px var(--am-success-ink);
      }
      .pm-glyph--revoked {
        border: 1px solid var(--am-danger-ink);
        background: var(--am-surface-raised);
        color: var(--am-danger-ink);
        box-shadow:
          0 0 0 3px var(--am-danger-bg),
          0 0 0 4px var(--am-danger-ink);
      }
      .pm-glyph--na {
        border: 1px dashed var(--am-restricted-border);
        background: var(--am-restricted-hatch);
        color: transparent;
      }
      /* Read-only: glyphs, not checkboxes (3c). */
      .pm-ro {
        flex: none;
        min-width: 17px;
        text-align: center;
        font-size: 14px;
        line-height: 22px;
      }
      .pm-ro.pm-glyph--on,
      .pm-ro.pm-glyph--some {
        border: none;
        background: none;
        color: var(--am-primary-700);
        font-weight: 700;
      }
      .pm-ro.pm-glyph--off {
        border: none;
        background: none;
        color: var(--am-ink-300);
      }
      .pm-ro.pm-glyph--na {
        display: inline-block;
        width: 17px;
        height: 17px;
        min-width: 0;
        box-sizing: border-box;
        border-radius: 3px;
      }

      [data-pm-cell]:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }

      .pm-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        padding: 9px 14px;
        background: var(--am-surface);
        border-block-start: 1px solid var(--am-border);
        font-size: 12.5px;
        color: var(--am-ink-700);
      }
      .pm-legend > span {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }
      .pm-legend .pm-box {
        margin-block-start: 0;
      }

      .pm-unsaved {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--am-warning-ink);
        background: var(--am-warning-bg);
        border: 1px solid var(--am-warning-border);
        border-radius: 4px;
        padding: 3px 8px;
      }
      .pm-saved {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--am-success-ink);
      }

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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly columns = MATRIX_COLUMNS;
  readonly cellCount = CELL_COUNT;

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

  /** The roving tab stop: [row, cell]. */
  readonly focusAt = signal<[number, number]>([0, 0]);

  readonly isRtl = computed(() => this.languageService.isRtl());

  // PATCH /roles/:id/permissions requires roles:manage. The ROUTE needs only
  // admin:access + roles:view, so a reader reaches this page and reads it.
  readonly canManage = computed(() => this.navigationAccess.hasPermission('roles:manage'));
  readonly isRootRole = computed(() => this.role()?.key === ROOT_ROLE_KEY);
  readonly isPlatformRole = computed(() => this.role()?.key === PLATFORM_ROLE_KEY);

  // ONE flag the template reads, so the grid and the save controls cannot
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
   * PDI), so an English name inside an Arabic sentence keeps its own order. A
   * bare "Matrix check (delete me)" between « » in Arabic otherwise renders
   * with its brackets and guillemets on the wrong sides.
   */
  readonly nameInSentence = computed(() => `⁨${this.roleName()}⁩`);

  readonly activeHolders = computed(() => this.role()?.activeHolderCount ?? 0);
  readonly headHolders = computed(() => this.role()?.headPositionHolderCount ?? 0);

  /** "Permissions · held by N users", plus the consequence while editable (D). */
  readonly subtitle = computed(() => {
    if (!this.role()) return null;
    const parts = [
      this.translate.instant('roles.matrix.subtitle'),
      this.format.count('role.heldBy', this.activeHolders()),
    ];
    if (!this.readOnly()) parts.push(this.translate.instant('roles.matrix.affects'));
    return parts.join(' · ');
  });

  /** D2 — platform keys are hidden inside a tenant. */
  readonly modules = computed<MatrixModule[]>(() =>
    buildMatrix(this.catalogue(), { isTenant: !this.navigationAccess.isPlatformOrg() }),
  );
  readonly rows = computed<MatrixRow[]>(() => matrixRows(this.modules()));

  readonly changes = computed(() => changesOf(this.modules(), this.selected(), this.loaded()));
  readonly changeCount = computed(() => this.changes().added.length + this.changes().removed.length);

  /** The confirmation's two headings, each line "Module · sentence" (3b). */
  readonly confirmGroups = computed<PermissionChangeGroup[]>(() => {
    const { added, removed } = this.changes();
    const group = (kind: 'added' | 'removed', list: MatrixPermission[]): PermissionChangeGroup => ({
      kind,
      total: list.length,
      lines: list
        .slice(0, CONFIRM_LINES)
        .map((p) => ({ key: p.key, text: `${this.moduleName(p.module)} · ${this.sentence(p.key)}` })),
      more: Math.max(0, list.length - CONFIRM_LINES),
    });
    return [group('added', added), group('removed', removed)].filter((g) => g.total > 0);
  });

  /** "Save changes", or "Save n changes" once a list is cut off (3b). Failed: "Try again". */
  readonly primaryLabel = computed(() => {
    if (this.saveState() === 'failed') return this.translate.instant('roles.matrix.tryAgain');
    const truncated = this.confirmGroups().some((g) => g.more > 0);
    return truncated
      ? this.format.count('role.saveN', this.changeCount())
      : this.translate.instant('roles.matrix.saveChanges');
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

  rowId(row: MatrixRow): string {
    return row.kind === 'module' ? `m:${row.module.module}` : `p:${row.permission.key}`;
  }

  // ── Cells ─────────────────────────────────────────────────────────────────

  /** Whether the cell is an editable toggle (a checkbox). Never in read-only. */
  isToggle(r: number, cell: number): boolean {
    if (this.readOnly()) return false;
    const row = this.rows()[r];
    return !!row && cellKeys(row, cell) !== null;
  }

  glyphOf(r: number, cell: number): CellGlyph {
    const row = this.rows()[r];
    if (!row) return 'na';
    const keys = cellKeys(row, cell);
    if (keys === null) {
      // A column-placed permission's label slot is not a cell with a value.
      return 'na';
    }
    const selected = this.selected();
    const loaded = this.loaded();
    if (keys.length === 1) {
      const mark = markOf(keys[0], selected, loaded);
      return this.readOnly() ? (mark === 'on' ? 'on' : 'off') : mark;
    }
    const tri: TriState = triState(keys, selected);
    if (!this.readOnly() && groupChanged(keys, selected, loaded)) return tri === 'none' ? 'revoked' : 'granted';
    return tri === 'all' ? 'on' : tri === 'some' ? 'some' : 'off';
  }

  glyphText(r: number, cell: number): string {
    switch (this.glyphOf(r, cell)) {
      case 'on':
      case 'granted':
        return this.isAggregate(r, cell) && triState(this.cellKeysAt(r, cell), this.selected()) === 'some' ? '–' : '✓';
      case 'revoked':
        return '✕';
      case 'some':
        return '–';
      case 'off':
        return this.readOnly() ? '·' : '';
      default:
        return '';
    }
  }

  ariaChecked(r: number, cell: number): 'true' | 'false' | 'mixed' {
    const tri = triState(this.cellKeysAt(r, cell), this.selected());
    return tri === 'all' ? 'true' : tri === 'some' ? 'mixed' : 'false';
  }

  /** "Committees · Approve · granted, not saved" — the cell read in order. */
  cellLabel(r: number, cell: number): string {
    const row = this.rows()[r];
    if (!row) return '';
    const t = (k: string): string => this.translate.instant(k);
    const name = row.kind === 'module' ? this.moduleName(row.module.module) : this.sentence(row.permission.key);
    const keys = cellKeys(row, cell);
    if (cell === LABEL_CELL) {
      if (keys === null) return name;
      const scope = row.kind === 'module' ? [t('roles.matrix.wholeModule')] : [];
      return [name, ...scope, this.stateWord(keys)].join(' · ');
    }
    const column = t(`roles.matrix.col.${MATRIX_COLUMNS[cell - 1]}`);
    if (keys === null) return [name, column, t('roles.matrix.state.notApplicable')].join(' · ');
    return [name, column, this.stateWord(keys)].join(' · ');
  }

  private stateWord(keys: string[]): string {
    const t = (k: string): string => this.translate.instant(k);
    const selected = this.selected();
    if (keys.length === 1) {
      const mark = markOf(keys[0], selected, this.loaded());
      if (this.readOnly()) return t(selected.has(keys[0]) ? 'roles.matrix.state.granted' : 'roles.matrix.state.notGranted');
      return t(
        mark === 'on'
          ? 'roles.matrix.state.granted'
          : mark === 'off'
            ? 'roles.matrix.state.notGranted'
            : mark === 'granted'
              ? 'roles.matrix.state.grantedUnsaved'
              : 'roles.matrix.state.revokedUnsaved',
      );
    }
    const tri = triState(keys, selected);
    return t(
      tri === 'all' ? 'roles.matrix.state.granted' : tri === 'some' ? 'roles.matrix.state.some' : 'roles.matrix.state.notGranted',
    );
  }

  private isAggregate(r: number, cell: number): boolean {
    return this.cellKeysAt(r, cell).length > 1;
  }

  private cellKeysAt(r: number, cell: number): string[] {
    const row = this.rows()[r];
    return (row && cellKeys(row, cell)) ?? [];
  }

  tabIndexOf(r: number, cell: number): 0 | -1 {
    const [fr, fc] = this.focusAt();
    return r === fr && cell === fc ? 0 : -1;
  }

  // ── Changing ──────────────────────────────────────────────────────────────

  /** A click: the whole cell is the hit area. */
  activate(r: number, cell: number): void {
    this.moveFocus(r, cell);
    this.toggleCell(r, cell);
  }

  toggleCell(r: number, cell: number): void {
    if (this.readOnly()) return;
    const row = this.rows()[r];
    const keys = row ? cellKeys(row, cell) : null;
    if (!keys) return;
    this.selected.set(toggleKeys(keys, this.selected()));
  }

  toggleRow(r: number): void {
    if (this.readOnly()) return;
    const row = this.rows()[r];
    if (!row) return;
    this.selected.set(toggleKeys(rowKeys(row), this.selected()));
  }

  discard(): void {
    this.selected.set(new Set(this.loaded()));
  }

  // ── Keyboard (D9) ─────────────────────────────────────────────────────────

  onGridKeydown(event: KeyboardEvent): void {
    const [r, c] = this.focusAt();
    const lastRow = this.rows().length - 1;
    const lastCell = CELL_COUNT - 1;
    // Arrows follow the EYE: in Arabic the next action column is to the left.
    const forward = this.isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const back = this.isRtl() ? 'ArrowRight' : 'ArrowLeft';

    let next: [number, number] | null = null;
    switch (event.key) {
      case forward:
        next = [r, Math.min(lastCell, c + 1)];
        break;
      case back:
        next = [r, Math.max(0, c - 1)];
        break;
      case 'ArrowDown':
        next = [Math.min(lastRow, r + 1), c];
        break;
      case 'ArrowUp':
        next = [Math.max(0, r - 1), c];
        break;
      case 'Home':
        next = event.ctrlKey ? [0, 0] : [r, 0];
        break;
      case 'End':
        next = event.ctrlKey ? [lastRow, lastCell] : [r, lastCell];
        break;
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        if (event.shiftKey) this.toggleRow(r);
        else this.toggleCell(r, c);
        return;
      default:
        return;
    }
    event.preventDefault();
    this.moveFocus(next[0], next[1]);
  }

  /**
   * Focus can arrive without an arrow key — Tab into the grid, a click on the
   * glyph rather than the cell, a screen reader's own cursor. The roving stop
   * follows wherever focus lands, so Space always acts on the cell that is
   * actually focused, never on the last one the arrows reached.
   */
  onGridFocusIn(event: FocusEvent): void {
    const at = (event.target as HTMLElement | null)?.closest('[data-pm-cell]')?.getAttribute('data-pm-cell');
    if (!at) return;
    const [r, c] = at.split(':').map(Number);
    const [fr, fc] = this.focusAt();
    if (r !== fr || c !== fc) this.focusAt.set([r, c]);
  }

  private moveFocus(r: number, cell: number): void {
    this.focusAt.set([r, cell]);
    const el = this.host.nativeElement.querySelector<HTMLElement>(`[data-pm-cell="${r}:${cell}"]`);
    // focus() scrolls the cell into view; scroll-padding keeps it clear of the
    // frozen column. scrollLeft is never touched (see the header).
    el?.focus();
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
