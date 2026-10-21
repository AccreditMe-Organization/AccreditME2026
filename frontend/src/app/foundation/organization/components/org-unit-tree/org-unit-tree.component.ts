import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  OnInit,
  TemplateRef,
  ViewChild,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { TreeNode } from 'primeng/api';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TreeTableModule } from 'primeng/treetable';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import {
  OrgStructureNodeDto,
  OrgUnitDependenciesRefusalDto,
  OrgUnitDto,
  OrgUnitService,
} from '../../services/org-unit.service';
import { IOrgUnitHeadStatus, OrgUnitHeadService } from '../../services/org-unit-head.service';
import { OrgUnitFormComponent } from '../org-unit-form/org-unit-form.component';
import { HeadshipPanelComponent } from '../headship-panel/headship-panel.component';
import { HeadshipActionsComponent } from '../headship-actions/headship-actions.component';
import { OrgUnitBlockersDialogComponent } from '../org-unit-blockers-dialog/org-unit-blockers-dialog.component';
import { HeadshipAction, deriveHeadshipState } from '../headship-panel/headship-state';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { RowMenuComponent, RowMenuItem } from '../../../../shared/components/row-menu/row-menu.component';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { injectFixLinkParam } from '../../../../shared/utils/fix-link.util';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AuthService } from '../../../../core/services/auth.service';
import { NO_TYPE, defaultExpanded, filterTree, typeKeyOf, unitAndLevelCount } from './org-tree-model';

/** Below this content width, Type and People are dropped (OS L45). */
export const TREE_NARROW_BELOW_PX = 900;
/**
 * Below this content width (a phone), Attention moves under the name and Head
 * widens. The drawing has no phone; at 328px a 120px Attention column left the
 * Unit column a few characters wide.
 */
export const TREE_COMPACT_BELOW_PX = 600;

const EXPAND_KEY_PREFIX = 'am.orgTree.expanded.';

interface HeadCell {
  name: string;
  meta: string;
  muted: boolean;
}

type HeadStatusEntry = { state: 'loading' } | { state: 'ready'; status: IOrgUnitHeadStatus } | { state: 'failed' };

/**
 * ACC-120 slice 11 (PR C) — `/organization`, the tree, rebuilt to the drawing
 * (`AccreditMe Organization Structure.dc.html` §1, OS L40-148, L498-540).
 *
 * It reads PR B's `GET /organization/units/structure`: heads, covers,
 * headcount and attention for every unit in one call, computed where the chart
 * and the unit record read them too.
 *
 * - **Order is the structure's**: sortOrder, then name. No column sorts and no
 *   `aria-sort` (OS L531): a tree is ordered by where units sit.
 * - **Collapsed to level 2 by default**, the expand state kept per user in
 *   local storage (D9), every read and write wrapped so the page works without
 *   it.
 * - **Type and People drop below 900px of CONTENT width**, measured on this
 *   component, never the viewport (OS L45).
 * - **One worded row menu**, `am-row-menu` "Actions for {unit}" (UX-13), in the
 *   drawn groups. The headship items come from `deriveHeadshipState()` over the
 *   unit's own `GET …/:id/head`, read when its menu opens, and run through
 *   `am-headship-actions`: the same dialogs and confirms as the Headship panel.
 * - **A viewer without org:manage** gets the read-only shape (OS §6): no Add
 *   unit, no Show deactivated, and a menu holding only Headship details.
 */
@Component({
  selector: 'app-org-unit-tree',
  standalone: true,
  imports: [
    PageHeaderComponent,
    TranslatePipe,
    FormsModule,
    TreeTableModule,
    ButtonModule,
    CheckboxModule,
    InputTextModule,
    OverlaySelectComponent,
    RowMenuComponent,
    OrgUnitFormComponent,
    HeadshipPanelComponent,
    HeadshipActionsComponent,
    OrgUnitBlockersDialogComponent,
    EditDialogComponent,
  ],
  template: `
    <app-page-header [title]="'organization.title' | translate">
      @if (counts(); as c) {
        <span pageMeta dir="ltr" class="text-meta text-ink-500 tabular-nums" data-testid="tree-count">{{ c }}</span>
      }
      <div pageActions>
        @if (canCreate()) {
          <p-button icon="pi pi-plus" [label]="'organization.addUnit' | translate" (onClick)="onAdd()" />
        }
      </div>
    </app-page-header>

    <!-- The Tree / Chart tabs (OS L57-60). Chart arrives with PR E; until then
         Tree is the one tab, kept in ?view= so a link says which. -->
    <div class="flex border-b border-rule mb-3" role="tablist" [attr.aria-label]="'organization.tree.tabsLabel' | translate">
      <button
        type="button"
        role="tab"
        class="am-ot__tab"
        aria-selected="true"
        data-testid="tab-tree"
        (click)="selectView('tree')"
      >
        {{ 'organization.tree.tabTree' | translate }}
      </button>
    </div>

    <div class="block min-w-0 border border-rule rounded-card bg-surface-raised">
      <div class="flex flex-wrap items-center gap-2 px-3 py-2 bg-surface border-b border-rule rounded-t-card" data-testid="tree-toolbar">
        <span class="relative inline-flex items-center flex-[0_1_300px] min-w-0">
          <i class="pi pi-search absolute start-2 text-meta text-ink-500 pointer-events-none" aria-hidden="true"></i>
          <input
            pInputText
            type="search"
            class="am-ot__search-input w-full min-w-0"
            [attr.aria-label]="'organization.tree.search' | translate"
            [placeholder]="'organization.tree.search' | translate"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            data-testid="tree-search"
          />
          @if (query()) {
            <button
              type="button"
              class="absolute end-1 p-1 border-0 bg-transparent text-ink-500 cursor-pointer"
              [attr.aria-label]="'organization.tree.searchClear' | translate"
              (click)="query.set('')"
              data-testid="tree-search-clear"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          }
        </span>
        <app-overlay-select
          class="flex-[0_1_220px] min-w-0"
          [options]="typeOptions()"
          [multiple]="true"
          [placeholder]="'organization.tree.typeFilter' | translate"
          [ariaLabel]="'organization.tree.typeFilter' | translate"
          [removeLabel]="'organization.tree.typeFilterRemove' | translate"
          [ngModel]="types()"
          (ngModelChange)="types.set($event ?? [])"
          data-testid="tree-type-filter"
        />
        @if (canManage()) {
          <label class="inline-flex items-center gap-1.5 text-meta text-ink-900">
            <p-checkbox
              [binary]="true"
              [ngModel]="showInactive()"
              (ngModelChange)="showInactive.set($event)"
              inputId="org-tree-show-inactive"
              data-testid="tree-show-inactive"
            />
            <span>{{ 'organization.tree.showDeactivated' | translate }}</span>
          </label>
        }
        @if (matchCount(); as m) {
          <span class="ms-auto text-meta text-ink-500" role="status" data-testid="tree-match-count">{{ m }}</span>
        }
        <p-button
          size="small"
          severity="secondary"
          [outlined]="true"
          [class.ms-auto]="!matchCount()"
          [label]="(allExpanded() ? 'organization.tree.collapseAll' : 'organization.tree.expandAll') | translate"
          [disabled]="filtered().narrowing"
          (onClick)="toggleAll()"
          data-testid="tree-expand-all"
        />
      </div>

      @if (error(); as e) {
        <p class="flex items-center gap-2 m-0 px-3 py-2 text-body text-danger" role="alert">
          {{ e | translate }}
          <p-button size="small" severity="secondary" [text]="true" [label]="'common.retry' | translate" (onClick)="load()" />
        </p>
      }
      @if (actionError(); as e) {
        <p class="m-0 px-3 py-2 text-body text-danger" role="alert" data-testid="tree-action-error">{{ e | translate }}</p>
      }

      <p-treeTable
        [value]="treeNodes()"
        [loading]="loading()"
        styleClass="am-ot__table"
        [tableStyle]="{ 'table-layout': 'fixed', width: '100%' }"
        (onNodeExpand)="onToggle($event.node, true)"
        (onNodeCollapse)="onToggle($event.node, false)"
      >
        <ng-template pTemplate="colgroup">
          <colgroup>
            <col />
            @if (!narrow()) {
              <col class="am-ot__col-type" />
            }
            <col class="am-ot__col-head" [class.am-ot__col-head--compact]="compact()" />
            @if (!narrow()) {
              <col class="am-ot__col-people" />
            }
            @if (attentionColumn()) {
              <col class="am-ot__col-attention" />
            }
            <col class="am-ot__col-menu" />
          </colgroup>
        </ng-template>
        <ng-template pTemplate="header">
          <tr>
            <th scope="col">{{ 'organization.tree.colUnit' | translate }}</th>
            @if (!narrow()) {
              <th scope="col" data-col="type">{{ 'organization.tree.colType' | translate }}</th>
            }
            <th scope="col">{{ 'organization.tree.colHead' | translate }}</th>
            @if (!narrow()) {
              <th scope="col" class="am-ot__num" data-col="people">{{ 'organization.tree.colPeople' | translate }}</th>
            }
            @if (attentionColumn()) {
              <th scope="col" data-col="attention">{{ 'organization.tree.colAttention' | translate }}</th>
            }
            <th scope="col"><span class="sr-only">{{ 'organization.tree.colActions' | translate }}</span></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-rowNode let-rowData="rowData">
          <tr
            [ttRow]="rowNode"
            class="am-ot__row"
            [class.am-ot__row--match]="isMatch(rowData)"
            [class.am-ot__row--context]="isContext(rowData)"
            [class.am-ot__row--inactive]="!rowData.isActive"
            [attr.data-unit]="rowData.id"
          >
            <td class="am-ot__unit">
              <div class="am-ot__unit-inner flex items-center min-w-0">
                <p-treeTableToggler [rowNode]="rowNode" />
                <span class="block min-w-0">
                  <span class="am-ot__name" data-testid="unit-name">{{ primaryName(rowData) }}</span>
                  @if (secondaryName(rowData); as other) {
                    <span class="block text-meta text-ink-500 text-start [unicode-bidi:isolate]" [attr.dir]="isArabic() ? 'ltr' : 'rtl'" [attr.lang]="isArabic() ? 'en' : 'ar'">{{ other }}</span>
                  }
                  @if (compact() && showAttention() && attentionChip(rowData); as chip) {
                    <span class="am-ot__chip" [class.am-ot__chip--blocks]="chip.blocks" [attr.aria-label]="chip.named" data-testid="attention-chip">{{ chip.text }}</span>
                  }
                  @if (!rowData.isActive) {
                    <span class="inline-flex items-center gap-1 text-meta text-ink-500" data-testid="unit-inactive">
                      <span class="size-1.5 rounded-pill bg-ink-500" aria-hidden="true"></span>{{ 'organization.tree.deactivated' | translate }}
                    </span>
                  }
                </span>
              </div>
            </td>
            @if (!narrow()) {
              <td class="am-ot__type-cell text-ink-700" [class.text-ink-500]="!rowData.type" [attr.title]="typeLabel(rowData)" data-col="type">{{ typeLabel(rowData) }}</td>
            }
            <td class="am-ot__head-cell" data-testid="head-cell">
              @if (headCell(rowData); as h) {
                <span class="am-ot__head" [class.am-ot__muted]="h.muted">{{ h.name }}</span>
                @if (h.meta) {
                  <span class="block text-meta text-ink-500">{{ h.meta }}</span>
                }
              }
            </td>
            @if (!narrow()) {
              <td class="am-ot__num" dir="ltr" data-col="people">{{ rowData.headcount }}</td>
            }
            @if (attentionColumn()) {
              <td data-col="attention">
                @if (attentionChip(rowData); as chip) {
                  <span
                    class="am-ot__chip"
                    [class.am-ot__chip--blocks]="chip.blocks"
                    [attr.aria-label]="chip.named"
                    data-testid="attention-chip"
                    >{{ chip.text }}</span
                  >
                }
              </td>
            }
            <td class="am-ot__menu-cell text-end">
              @if (rowData.isActive) {
                <am-row-menu
                  [groups]="menuGroups(rowData)"
                  [groupLabels]="menuLabels(rowData)"
                  [label]="'organization.tree.actionsFor' | translate: { unit: primaryName(rowData) }"
                  (openedChange)="$event && onMenuOpened(rowData)"
                  (picked)="onPicked(rowData, $event)"
                />
              }
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="columnCount()" class="text-center py-8 px-3 text-ink-500">
              {{ (filtered().narrowing ? 'organization.tree.noMatches' : 'organization.noUnits') | translate }}
            </td>
          </tr>
        </ng-template>
      </p-treeTable>
    </div>

    <!-- The dialogs and confirms behind the row menu's headship items: one copy,
         shared with the Headship panel. -->
    @for (unit of actionUnit(); track unit.id) {
      <am-headship-actions
        [orgUnitId]="unit.id"
        [unitName]="primaryName(unit)"
        [status]="readyStatus(unit.id)"
        (saved)="onHeadshipSaved(unit.id)"
      />
    }

    <ng-template #formTpl>
      <app-org-unit-form
        [unit]="editingUnit()"
        [parentId]="newUnitParentId()"
        (saved)="onFormSaved()"
        (cancelled)="unitDialog.requestClose()"
        (ready)="unitFormRef.set($event)"
        (dirtyChange)="unitFormDirty.set($event)"
      />
    </ng-template>
    <!-- The actions live in the dialog footer, not the form body: that is what
         keeps the body under the 420 cap. Cancel goes through requestClose(),
         the one place the unsaved-work question is asked. -->
    <ng-template #unitFooterTpl>
      <div class="flex justify-end gap-2">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="unitDialog.requestClose()"
          [disabled]="!!unitFormRef()?.saving()"
        />
        <p-button
          [label]="(unitFormRef()?.submitLabelKey() ?? 'common.save') | translate"
          [loading]="!!unitFormRef()?.saving()"
          [disabled]="!unitFormRef() || !!unitFormRef()?.saving()"
          (onClick)="unitFormRef()!.onSubmit()"
          data-testid="org-unit-submit"
        />
      </div>
    </ng-template>
    <app-edit-dialog
      #unitDialog
      [(visible)]="formVisible"
      [header]="unitDialogHeader()"
      [content]="formTpl"
      [footer]="unitFooterTpl"
      density="compact"
      [dirty]="unitFormDirty()"
    />

    <ng-template #headPanelTpl>
      @if (managingHeadUnitId(); as unitId) {
        <am-headship-panel [orgUnitId]="unitId" [unitName]="managingHeadUnitName()" (saved)="onHeadPanelSaved()" />
      }
    </ng-template>
    <app-edit-dialog [(visible)]="headPanelVisible" [header]="headPanelHeader()" [content]="headPanelTpl" />

    <am-org-unit-blockers-dialog
      [(visible)]="blockersVisible"
      [unitName]="blockersUnitName()"
      [blockers]="blockers()"
    />
  `,
  styles: [
    `
      :host { display: block; }
      .am-ot__tab { font: inherit; font-size: var(--am-type-value-size); font-weight: 600; padding: var(--am-space-6) var(--am-space-12); margin-block-end: -1px; border: 0; border-block-end: 2px solid var(--am-primary-600); background: none; color: var(--am-primary-700); cursor: pointer; }
      .am-ot__tab:focus-visible { outline: var(--am-focus-ring-width) solid var(--am-focus-ring); outline-offset: var(--am-focus-ring-offset); }
      .am-ot__search-input { padding-inline: var(--am-space-32) var(--am-space-24); }
      .am-ot__search-input::-webkit-search-cancel-button { display: none; }
      :host ::ng-deep .am-ot__table td.am-ot__type-cell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal; }
      :host ::ng-deep .am-ot__table th { font-size: var(--am-type-micro-size); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--am-ink-500); background: var(--am-surface); padding: var(--am-space-6) var(--am-space-8); text-align: start; }
      :host ::ng-deep .am-ot__table td { padding: var(--am-space-6) var(--am-space-8); vertical-align: middle; overflow-wrap: anywhere; font-size: var(--am-type-value-size); }
      :host ::ng-deep .am-ot__table .am-ot__num { text-align: end; font-variant-numeric: tabular-nums; }
      :host ::ng-deep .am-ot__unit-inner .p-treetable-toggler { flex: none; }
      .am-ot__col-type { inline-size: 104px; }
      .am-ot__col-head { inline-size: 30%; }
      .am-ot__col-head--compact { inline-size: 42%; }
      .am-ot__col-people { inline-size: 64px; }
      .am-ot__col-attention { inline-size: 120px; }
      .am-ot__col-menu { inline-size: 40px; }
      :host ::ng-deep .am-ot__table td.am-ot__menu-cell { padding-inline: var(--am-space-4); }
      .am-ot__name { display: block; font-weight: 500; color: var(--am-ink-900); }
      .am-ot__row--match { background: var(--am-primary-50); }
      .am-ot__row--match .am-ot__name { font-weight: 600; color: var(--am-primary-700); }
      .am-ot__row--context .am-ot__name { font-weight: 400; color: var(--am-ink-500); }
      .am-ot__head { display: block; font-weight: 500; color: var(--am-primary-700); }
      .am-ot__head.am-ot__muted { font-weight: 400; color: var(--am-ink-500); }
      .am-ot__chip { display: inline-flex; max-inline-size: 100%; font-size: var(--am-type-micro-size); font-weight: 600; color: var(--am-warning-ink); background: var(--am-warning-bg); border: 1px solid var(--am-warning-border); border-radius: var(--am-radius-pill); padding: 0 var(--am-space-8); overflow-wrap: anywhere; }
      .am-ot__chip--blocks { color: var(--am-danger-ink); background: var(--am-danger-bg); border-color: var(--am-danger-border); }
    `,
  ],
})
export class OrgUnitTreeComponent implements OnInit, AfterViewInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
  @ViewChild('headPanelTpl', { read: TemplateRef, static: true }) headPanelTpl!: TemplateRef<unknown>;

  private readonly orgUnitService = inject(OrgUnitService);
  private readonly headService = inject(OrgUnitHeadService);
  private readonly translate = inject(TranslateService);
  private readonly languageService = inject(LanguageService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly auth = inject(AuthService, { optional: true });
  private readonly confirm = inject(AmConfirmService);
  private readonly format = inject(FormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly headshipActions = viewChild(HeadshipActionsComponent);

  // ACC-118 — found by check:create-gating, not by the ticket's own list of
  // ten. Hidden, not disabled, same as every other page-header create action.
  // POST /organization enforces ORG_PERMISSIONS.MANAGE — org:manage
  // (organization.controller.ts).
  readonly canCreate = computed(() => this.navigationAccess.hasPermission('org:manage'));
  // ACC-123 — the same permission, asked about changing an existing unit.
  readonly canManage = this.canCreate;

  readonly isArabic = computed(() => this.languageService.isArabic());

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  /** PR B's structure: every active unit, and inactive ones for org:manage. */
  readonly nodes = signal<OrgStructureNodeDto[]>([]);
  /** The same units as records, for the Add / Edit dialog. */
  private readonly units = signal<OrgUnitDto[]>([]);

  // ── the toolbar ───────────────────────────────────────────────────────────
  readonly query = signal('');
  readonly types = signal<string[]>([]);
  readonly showInactive = signal(false);

  readonly filtered = computed(() =>
    filterTree(this.nodes(), {
      query: this.query().trim(),
      types: this.types(),
      showInactive: this.canManage() && this.showInactive(),
    }),
  );

  readonly counts = computed(() => {
    if (this.nodes().length === 0) return null;
    const { units, levels } = unitAndLevelCount(this.nodes());
    return this.translate.instant('organization.tree.count', {
      units: this.format.count('organization.units', units),
      levels: this.format.count('organization.levels', levels),
    });
  });

  readonly matchCount = computed(() => {
    const f = this.filtered();
    if (!f.narrowing) return null;
    return this.translate.instant('organization.tree.matchCount', {
      matches: this.format.count('organization.matches', f.matches.size),
      ancestors: this.format.count('organization.ancestors', f.ancestors.size),
    });
  });

  /** The types units hold, retired ones included, then "(No type)". */
  readonly typeOptions = computed(() => {
    const seen = new Map<string, string>();
    let untyped = false;
    for (const node of this.nodes()) {
      if (!node.type) {
        untyped = true;
        continue;
      }
      if (!seen.has(node.type.id)) seen.set(node.type.id, this.typeName(node));
    }
    const options = [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (untyped) options.push({ value: NO_TYPE, label: this.translate.instant('organization.tree.noType') });
    return options;
  });

  // ── width (OS L45: content width, not the viewport) ───────────────────────
  private readonly contentWidth = signal<number>(Number.POSITIVE_INFINITY);
  readonly narrow = computed(() => this.contentWidth() < TREE_NARROW_BELOW_PX);
  readonly compact = computed(() => this.contentWidth() < TREE_COMPACT_BELOW_PX);
  /** Attention is shown only when the response carries it (setup:view). */
  readonly showAttention = computed(() => this.nodes().some((n) => 'attention' in n));
  readonly attentionColumn = computed(() => this.showAttention() && !this.compact());
  readonly columnCount = computed(() => 2 + (this.narrow() ? 0 : 2) + (this.attentionColumn() ? 1 : 0) + 1);

  // ── expansion (D9) ────────────────────────────────────────────────────────
  readonly expanded = signal<Set<string>>(new Set());

  readonly allExpanded = computed(() => {
    const parents = this.nodes().filter((n) => n.childCount > 0 || this.nodes().some((c) => c.parentId === n.id));
    return parents.length > 0 && parents.every((p) => this.expanded().has(p.id));
  });

  readonly treeNodes = computed(() => this.buildTreeNodes());

  // ── the unit dialog ───────────────────────────────────────────────────────
  readonly formVisible = signal(false);
  readonly editingUnit = signal<OrgUnitDto | null>(null);
  readonly newUnitParentId = signal<string | null>(null);
  /** The unit "Add sub-unit" was pressed on, so the title can name it. */
  private readonly newUnitParent = signal<OrgUnitDto | null>(null);
  readonly unitFormRef = signal<OrgUnitFormComponent | null>(null);
  readonly unitFormDirty = signal(false);

  /**
   * The three titles (OS L634): "Add unit", "Add sub-unit to Pharmacy",
   * "Edit Pharmacy". Tenant names through bilingual() (ACC-160).
   */
  readonly unitDialogHeader = computed(() => {
    const editing = this.editingUnit();
    if (editing) {
      return this.translate.instant('organization.editUnitNamed', {
        unit: this.languageService.bilingual(editing.nameEn, editing.nameAr),
      });
    }
    const parent = this.newUnitParent();
    if (parent) {
      return this.translate.instant('organization.addSubUnitTo', {
        parent: this.languageService.bilingual(parent.nameEn, parent.nameAr),
      });
    }
    return this.translate.instant('organization.addUnit');
  });

  // ── the Headship panel ────────────────────────────────────────────────────
  readonly headPanelVisible = signal(false);
  readonly managingHeadUnitId = signal<string | null>(null);
  // ACC-82 — the panel names its unit. A Setup health Fix opens it directly
  // from a list of many units, and "Manage Head" alone does not say which.
  private readonly managingHeadUnit = signal<{ nameEn: string; nameAr: string | null } | null>(null);
  /**
   * Tenant data: chosen by language, never translated (SYSTEM-REFERENCE §9.3).
   * Lifted out of headPanelHeader so the panel's own dialogs can name the unit
   * with the SAME string the header uses — two resolutions of one name is how
   * a title and a dialog end up disagreeing.
   */
  readonly managingHeadUnitName = computed(() => {
    const unit = this.managingHeadUnit();
    if (!unit) return '';
    return (this.languageService.isArabic() && unit.nameAr) || unit.nameEn;
  });

  readonly headPanelHeader = computed(() => {
    const name = this.managingHeadUnitName();
    // A viewer who cannot change the headship is not "managing" it.
    if (!this.canManage()) {
      return name ? this.translate.instant('headship.titleNamed', { unit: name }) : this.translate.instant('headship.title');
    }
    if (!name) return this.translate.instant('orgUnitHead.manageHead');
    return this.translate.instant('orgUnitHead.manageHeadNamed', { unit: name });
  });

  // ── the row menu's headship (read when its menu opens) ────────────────────
  private readonly headStatus = signal<Map<string, HeadStatusEntry>>(new Map());
  /** The unit whose headship actions are hosted (the last menu opened). */
  readonly actionUnit = signal<OrgStructureNodeDto[]>([]);

  // ── deactivate ────────────────────────────────────────────────────────────
  readonly blockersVisible = signal(false);
  private readonly blockersUnit = signal<OrgStructureNodeDto | null>(null);
  readonly blockers = signal<OrgUnitDependenciesRefusalDto['blockers']>([]);
  readonly blockersUnitName = computed(() => {
    const unit = this.blockersUnit();
    return unit ? this.primaryName(unit) : '';
  });

  // ACC-82 — a Setup health Fix link (?head=<unitId>) opens that unit's head
  // panel, where a head or an acting head is assigned. Only for a unit that is
  // in the tree and active.
  private readonly fixLinkHead = injectFixLinkParam('head');

  ngOnInit(): void {
    this.load();
  }

  ngAfterViewInit(): void {
    const host = this.host.nativeElement;
    if (typeof ResizeObserver === 'undefined') return;
    this.contentWidth.set(host.getBoundingClientRect().width || Number.POSITIVE_INFINITY);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.borderBoxSize?.[0]?.inlineSize ?? entries[0]?.contentRect.width;
      if (width) this.ngZone.run(() => this.contentWidth.set(width));
    });
    observer.observe(host);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.orgUnitService.getStructure({ includeInactive: this.canManage() }).subscribe({
      next: ({ nodes }) => {
        this.nodes.set(nodes);
        this.expanded.set(this.restoreExpanded(nodes));
        this.headStatus.set(new Map());
        this.loading.set(false);
        const unitId = this.fixLinkHead();
        const target = unitId ? nodes.find((n) => n.id === unitId) : undefined;
        if (target?.isActive) this.onManageHead(target);
      },
      error: (err: unknown) => {
        this.error.set(extractErrorMessage(err, 'organization.tree.loadFailed'));
        this.loading.set(false);
      },
    });
    // The records the Add / Edit dialog edits. A failure here only affects
    // Edit, which waits for the unit.
    this.orgUnitService.getFlat().subscribe({
      next: (units) => this.units.set(units),
      error: () => this.units.set([]),
    });
  }

  selectView(view: 'tree'): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { view }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  primaryName(node: { nameEn: string; nameAr: string | null }): string {
    return this.languageService.bilingual(node.nameEn, node.nameAr);
  }

  /** The other language below, in its own direction (OS L533), when it differs. */
  secondaryName(node: OrgStructureNodeDto): string | null {
    if (!node.nameAr) return null;
    return this.isArabic() ? node.nameEn : node.nameAr;
  }

  private typeName(node: OrgStructureNodeDto): string {
    const t = node.type!;
    return this.languageService.bilingual(t.labelEn, t.labelAr);
  }

  typeLabel(node: OrgStructureNodeDto): string {
    if (!node.type) return this.translate.instant('organization.tree.noTypeCell');
    const label = this.typeName(node);
    return node.type.isRetired ? `${label} · ${this.translate.instant('organization.typeRetired')}` : label;
  }

  /**
   * The Head cell (OS L537, L503): the head, then one meta line for the state.
   * "No head" is muted; the severity is Attention's, never colour here.
   */
  headCell(node: OrgStructureNodeDto): HeadCell {
    const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params);
    const named = (name: string | null, fallback: string) => name ?? t(fallback);
    const substantive = node.heads.find((h) => h.role === 'substantive') ?? null;
    const incoming = node.heads.find((h) => h.role === 'incoming') ?? null;
    const head = substantive ?? incoming;
    const acting = node.acting;

    if (head) {
      let meta = head.positionNameEn ? this.languageService.bilingual(head.positionNameEn, head.positionNameAr) : '';
      if (substantive && incoming) {
        meta = t('organization.tree.incoming', { name: named(incoming.name, 'headship.head.assigned') });
      } else if (acting && acting.reason === 'ABSENCE') {
        meta = t('organization.tree.awayCovering', { name: named(acting.name, 'headship.cover.arranged') });
      }
      return { name: named(head.name, 'headship.head.assigned'), meta, muted: false };
    }
    if (acting) {
      return { name: named(acting.name, 'headship.cover.arranged'), meta: t('organization.tree.acting'), muted: false };
    }
    return { name: t('headship.head.none'), meta: '', muted: true };
  }

  attentionChip(node: OrgStructureNodeDto): { text: string; named: string; blocks: boolean } | null {
    const a = node.attention;
    if (!a) return null;
    const text = this.translate.instant(`organization.tree.attention.${a.code}`, { date: this.format.date(a.since) });
    const severity = this.translate.instant(`setupHealth.severity.${a.severity}`);
    return {
      text,
      named: this.translate.instant('organization.tree.attention.named', { severity, condition: text.replace(/^▲\s*/, '') }),
      blocks: a.severity === 'BLOCKS_WORK',
    };
  }

  isMatch(node: OrgStructureNodeDto): boolean {
    const f = this.filtered();
    return f.narrowing && f.matches.has(node.id);
  }

  isContext(node: OrgStructureNodeDto): boolean {
    return this.filtered().ancestors.has(node.id);
  }

  private buildTreeNodes(): TreeNode<OrgStructureNodeDto>[] {
    const f = this.filtered();
    const expanded = this.expanded();
    const shown = this.nodes().filter((n) => f.visible.has(n.id));
    const ids = new Set(shown.map((n) => n.id));
    const byParent = new Map<string | null, OrgStructureNodeDto[]>();
    for (const n of shown) {
      const parent = n.parentId && ids.has(n.parentId) ? n.parentId : null;
      byParent.set(parent, [...(byParent.get(parent) ?? []), n]);
    }
    const seen = new Set<string>();
    const build = (parent: string | null): TreeNode<OrgStructureNodeDto>[] =>
      (byParent.get(parent) ?? [])
        .filter((n) => !seen.has(n.id) && (seen.add(n.id), true))
        .map((n) => ({
          key: n.id,
          data: n,
          children: build(n.id),
          // While narrowing, every path to a match is open; otherwise the
          // reader's own expand state.
          expanded: f.narrowing ? true : expanded.has(n.id),
        }));
    return build(null);
  }

  // ── expansion, kept per user (D9) ─────────────────────────────────────────

  private storageKey(): string | null {
    const id = this.auth?.currentUser()?.id;
    return id ? `${EXPAND_KEY_PREFIX}${id}` : null;
  }

  private restoreExpanded(nodes: OrgStructureNodeDto[]): Set<string> {
    const key = this.storageKey();
    if (key) {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
          const ids = JSON.parse(raw) as unknown;
          if (Array.isArray(ids)) {
            const known = new Set(nodes.map((n) => n.id));
            return new Set(ids.filter((id): id is string => typeof id === 'string' && known.has(id)));
          }
        }
      } catch {
        // No storage, or a stored value we cannot read: the default instead.
      }
    }
    return defaultExpanded(nodes.filter((n) => n.isActive));
  }

  private saveExpanded(ids: Set<string>): void {
    const key = this.storageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify([...ids]));
    } catch {
      // Storage refused (private window, quota): the state lasts this visit.
    }
  }

  onToggle(node: TreeNode<OrgStructureNodeDto> | undefined, open: boolean): void {
    if (!node?.data || this.filtered().narrowing) return;
    const next = new Set(this.expanded());
    if (open) next.add(node.data.id);
    else next.delete(node.data.id);
    this.expanded.set(next);
    this.saveExpanded(next);
  }

  toggleAll(): void {
    const next = this.allExpanded()
      ? new Set<string>()
      : new Set(this.nodes().filter((n) => this.nodes().some((c) => c.parentId === n.id)).map((n) => n.id));
    this.expanded.set(next);
    this.saveExpanded(next);
  }

  // ── the row menu (OS L99-104, L518-527) ───────────────────────────────────

  private entryFor(unitId: string): HeadStatusEntry | undefined {
    return this.headStatus().get(unitId);
  }

  readyStatus(unitId: string): IOrgUnitHeadStatus | null {
    const entry = this.entryFor(unitId);
    return entry?.state === 'ready' ? entry.status : null;
  }

  onMenuOpened(node: OrgStructureNodeDto): void {
    if (!this.canManage()) return;
    if (this.actionUnit()[0]?.id !== node.id) this.actionUnit.set([node]);
    const entry = this.entryFor(node.id);
    if (entry && entry.state !== 'failed') return;
    this.setStatus(node.id, { state: 'loading' });
    this.headService.getHeadStatus(node.id).subscribe({
      next: (status) => this.setStatus(node.id, { state: 'ready', status }),
      error: () => this.setStatus(node.id, { state: 'failed' }),
    });
  }

  private setStatus(unitId: string, entry: HeadStatusEntry): void {
    const next = new Map(this.headStatus());
    next.set(unitId, entry);
    this.headStatus.set(next);
  }

  /** The drawn groups: Unit · Headship · View · Deactivate. */
  menuGroups(node: OrgStructureNodeDto): RowMenuItem[][] {
    const t = (key: string) => this.translate.instant(key);
    const details: RowMenuItem = { id: 'headship', label: t('organization.tree.menu.headshipDetails') };
    if (!this.canManage()) return [[details]];

    const unit: RowMenuItem[] = [
      { id: 'add', label: t('organization.addSubUnit') },
      { id: 'edit', label: t('common.edit') },
    ];
    const entry = this.entryFor(node.id);
    let headship: RowMenuItem[];
    if (!entry || entry.state === 'loading') {
      headship = [{ id: 'hs-loading', label: t('organization.tree.menu.loadingHeadship'), disabled: true }];
    } else if (entry.state === 'failed') {
      headship = [{ id: 'hs-failed', label: t('organization.tree.menu.headshipFailed'), disabled: true }];
    } else {
      const host = this.actionUnit()[0]?.id === node.id ? this.headshipActions() : undefined;
      headship = deriveHeadshipState(entry.status).actions.map((action) => {
        const blocked = host?.blockedReason(action) ?? null;
        return {
          id: `hs:${action}`,
          label: t(`headship.action.${action}`),
          danger: action === 'vacate' || action === 'withdrawAppointment',
          ...(blocked ? { disabled: true, sub: t(blocked) } : {}),
        };
      });
    }
    return [unit, headship, [details], [{ id: 'deactivate', label: t('organization.deactivate'), danger: true }]];
  }

  menuLabels(_node: OrgStructureNodeDto): (string | null)[] {
    return this.canManage() ? [null, this.translate.instant('organization.tree.menu.headship'), null, null] : [];
  }

  onPicked(node: OrgStructureNodeDto, id: string): void {
    this.actionError.set(null);
    if (id === 'headship') return this.onManageHead(node);
    if (id === 'deactivate') return this.askDeactivate(node);
    const record = this.units().find((u) => u.id === node.id);
    if (id === 'add' && record) return this.onAddChild(record);
    if (id === 'edit' && record) return this.onEdit(record);
    if (id.startsWith('hs:')) this.headshipActions()?.run(id.slice(3) as HeadshipAction);
  }

  onHeadshipSaved(unitId: string): void {
    const next = new Map(this.headStatus());
    next.delete(unitId);
    this.headStatus.set(next);
    this.load();
  }

  onManageHead(unit: { id: string; nameEn: string; nameAr: string | null }): void {
    this.managingHeadUnitId.set(unit.id);
    this.managingHeadUnit.set(unit);
    this.headPanelVisible.set(true);
  }

  onHeadPanelSaved(): void {
    // The panel stays open — each action is one step in an ongoing change —
    // and reads its own status again. The tree reads again so the row's Head
    // cell says what is now true.
    this.load();
  }

  onAdd(): void {
    this.editingUnit.set(null);
    this.newUnitParentId.set(null);
    this.newUnitParent.set(null);
    this.unitFormDirty.set(false);
    this.formVisible.set(true);
  }

  onAddChild(parent: OrgUnitDto): void {
    this.editingUnit.set(null);
    this.newUnitParentId.set(parent.id);
    this.newUnitParent.set(parent);
    this.unitFormDirty.set(false);
    this.formVisible.set(true);
  }

  onEdit(unit: OrgUnitDto): void {
    this.editingUnit.set(unit);
    this.newUnitParentId.set(null);
    this.newUnitParent.set(null);
    this.unitFormDirty.set(false);
    this.formVisible.set(true);
  }

  onFormSaved(): void {
    this.unitFormDirty.set(false);
    this.formVisible.set(false);
    this.load();
  }

  // ── deactivate (OS L117-148) ──────────────────────────────────────────────

  askDeactivate(node: OrgStructureNodeDto): void {
    const unit = this.primaryName(node);
    this.confirm.ask({
      tone: 'destructive',
      header: this.translate.instant('organization.deactivateConfirm.header', { unit }),
      message: this.translate.instant('organization.deactivateConfirm.message'),
      acceptLabel: this.translate.instant('organization.deactivateConfirm.accept'),
      accept: () => this.deactivate(node),
    });
  }

  private deactivate(node: OrgStructureNodeDto): void {
    this.orgUnitService.deactivate(node.id).subscribe({
      next: () => this.load(),
      error: (err: unknown) => {
        const body = err instanceof HttpErrorResponse ? (err.error as Partial<OrgUnitDependenciesRefusalDto> | null) : null;
        if (body?.code === 'ORG_UNIT_HAS_DEPENDENCIES' && Array.isArray(body.blockers)) {
          this.blockersUnit.set(node);
          this.blockers.set(body.blockers);
          this.blockersVisible.set(true);
          return;
        }
        this.actionError.set(extractErrorMessage(err, 'organization.deactivateFailed'));
      },
    });
  }
}
