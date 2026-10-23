import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { registerPageName } from '../../../../core/services/document-title.service';
import { BreadcrumbParentService } from '../../../../core/navigation/breadcrumb-parent.service';
import { ADMIN_ACCESS } from '../../../../core/navigation/admin-access';
import { CappedPanelState } from '../../../../shared/components/capped-panel/capped-panel.component';
import { RelationComponent } from '../../../../shared/components/relation/relation.component';
import { RowMenuComponent, RowMenuItem } from '../../../../shared/components/row-menu/row-menu.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { SimpleListColumn } from '../../../../shared/components/simple-list/simple-list.component';
import { injectFixLinkParam } from '../../../../shared/utils/fix-link.util';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import {
  OrgStructureNodeDto,
  OrgUnitDependenciesRefusalDto,
  OrgUnitDto,
  OrgUnitHistoryPageDto,
  OrgUnitService,
  OrgUnitSummaryDto,
} from '../../services/org-unit.service';
import { HeadshipPanelComponent } from '../headship-panel/headship-panel.component';
import { OrgUnitFormComponent } from '../org-unit-form/org-unit-form.component';
import { OrgUnitBlockersDialogComponent } from '../org-unit-blockers-dialog/org-unit-blockers-dialog.component';
import { UnitListPanelComponent, UnitPanelItem } from './unit-list-panel.component';
import { UnitHistoryPanelComponent } from './unit-history-panel.component';
import { HistoryTextDeps, historyPerson } from './unit-history-text';

/** As many 320px columns as fit (the committee record's rule, ACC-232). */
export const ORG_UNIT_PANEL_GRID = 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))';

/** More people than this, and the People panel is ordered by position (OS L617). */
export const PEOPLE_GROUP_ABOVE = 10;

/** The History panel's first read: the five rows it shows. */
const HISTORY_FIRST_PAGE = 5;

type LoadState = 'loading' | 'error' | 'notFound' | 'ready';

interface RelationView {
  label: string;
  kind: 'unit' | 'person';
  name: string;
  link: readonly unknown[] | null;
  state: string;
  hidden: boolean;
  none: boolean;
  testId: string;
}

/**
 * ACC-120 slice 11, PR D — one org unit's record, `/organization/units/:id`.
 * Built against `frontend/design-reference/AccreditMe Organization
 * Structure.dc.html` §3 (OS L312-339, L611-628), a sibling of the Committee
 * record: the header, the Setup health strip, then six panels.
 *
 * It reads `GET …/:id/summary` (PR B) and the first page of
 * `GET …/:id/history`. Every name follows the response (D7): a null name is
 * shown as the position and "Name hidden", never a blank.
 *
 * A deactivated unit shows who deactivated it and when, and offers nothing:
 * no Edit, no Add sub-unit, no headship actions, and one line saying it cannot
 * be reactivated from AccreditMe (there is no endpoint that would).
 */
@Component({
  selector: 'app-org-unit-record',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    ButtonModule,
    RelationComponent,
    RowMenuComponent,
    EditDialogComponent,
    HeadshipPanelComponent,
    OrgUnitFormComponent,
    OrgUnitBlockersDialogComponent,
    UnitListPanelComponent,
    UnitHistoryPanelComponent,
  ],
  template: `
    @switch (state()) {
      @case ('notFound') {
        <div class="am-ur__card px-4 py-6" role="alert" data-testid="unit-not-found">
          <p class="m-0 text-body text-ink-900">{{ 'organization.record.notFound' | translate }}</p>
          <a class="text-primary-700 font-semibold" routerLink="/organization">{{ 'organization.record.backToTree' | translate }}</a>
        </div>
      }
      @case ('error') {
        <div class="am-ur__card flex flex-wrap items-center gap-3 px-4 py-6" role="alert" data-testid="unit-load-error">
          <p class="m-0 text-body text-ink-900">{{ 'organization.record.loadFailed' | translate }}</p>
          <p-button size="small" severity="secondary" [outlined]="true" [label]="'common.retry' | translate" (onClick)="load()" />
        </div>
      }
    }

    @if (summary(); as s) {
      <div class="flex flex-col gap-3" [attr.data-unit-record]="s.unit.id">
        <section class="am-ur__card" data-testid="unit-header">
          <div class="flex flex-wrap items-start justify-between gap-4 px-4 pt-4 pb-3">
            <div class="min-w-0 flex-[1_1_260px]">
              <!-- Both names on one line, as drawn (OS L316-319): the reader's at
                   the record size, the other on its baseline, each in its own
                   direction. They wrap rather than cut. -->
              <div class="flex flex-wrap items-baseline gap-x-3">
                <h1 class="m-0 text-record text-ink-900 min-w-0 [overflow-wrap:anywhere]" data-testid="unit-name">{{ primaryName() }}</h1>
                @if (otherName(); as other) {
                  <span
                    class="text-heading text-ink-500 min-w-0 [unicode-bidi:isolate] [overflow-wrap:anywhere]"
                    [attr.dir]="isArabic() ? 'ltr' : 'rtl'"
                    [attr.lang]="isArabic() ? 'en' : 'ar'"
                    data-testid="unit-other-name"
                  >{{ other }}</span>
                }
              </div>
              <div class="mt-1 text-meta text-ink-700" data-testid="unit-meta">
                {{ typeLabel() }} · <span dir="ltr" class="[unicode-bidi:isolate] font-mono">{{ s.unit.code }}</span> · {{ stateLabel() }}
              </div>
            </div>
            @if (canAct()) {
              <div class="flex items-center gap-2 flex-wrap" data-testid="unit-actions">
                <p-button size="small" [outlined]="true" icon="pi pi-pencil" [label]="'common.edit' | translate" (onClick)="onEdit()" data-testid="unit-edit" />
                <p-button size="small" [outlined]="true" icon="pi pi-plus" [label]="'organization.addSubUnit' | translate" (onClick)="onAddChild()" data-testid="unit-add-child" />
                <am-row-menu
                  [groups]="menuGroups()"
                  [label]="'organization.record.moreActionsFor' | translate: { unit: primaryName() }"
                  (picked)="onPicked($event)"
                />
              </div>
            }
          </div>

          @if (!s.unit.isActive) {
            <div class="am-ur__deactivated" data-testid="unit-deactivated">
              <p class="m-0 font-semibold text-ink-900">{{ deactivatedLine() }}</p>
              <p class="m-0 text-ink-700">{{ 'organization.record.noReactivation' | translate }}</p>
            </div>
          }

          <div class="am-ur__relations" data-testid="unit-relations">
            @for (r of relations(); track r.testId) {
              <am-relation
                [label]="r.label"
                [kind]="r.kind"
                [name]="r.name"
                [link]="r.link"
                [state]="r.state"
                [hidden]="r.hidden"
                [none]="r.none"
                [attr.data-testid]="r.testId"
              />
            }
          </div>
        </section>

        @if (strip(); as st) {
          <div class="am-ur__strip" [class.am-ur__strip--blocks]="st.blocks" role="status" data-testid="unit-strip">
            <span class="font-semibold" data-testid="unit-strip-since">▲ {{ st.since }}</span>
            <span class="min-w-0">{{ st.condition }}</span>
            @if (st.fix; as fix) {
              <button type="button" class="am-ur__link" (click)="runFix(fix.action)" data-testid="unit-strip-fix">{{ fix.label }}</button>
            }
            @if (st.more) {
              <a class="am-ur__link" routerLink="/setup-health" [queryParams]="{ object: s.unit.id }" data-testid="unit-strip-more">{{ st.more }}</a>
            }
          </div>
        }

        <section class="grid gap-3" [style.grid-template-columns]="panelGrid" data-testid="unit-panels">
          @for (id of [s.unit.id]; track id) {
            <am-headship-panel
              id="unit-headship"
              class="am-ur__headship"
              [orgUnitId]="id"
              [unitName]="primaryName()"
              [readOnly]="!s.unit.isActive"
              (saved)="load()"
            />
          }

          <am-unit-list-panel
            [heading]="'organization.record.subUnits' | translate"
            testIdPrefix="unit-subs"
            [items]="subUnitItems()"
            [emptyText]="'organization.record.noSubUnits' | translate"
            [popupHeading]="'organization.record.subUnitsOf' | translate: { unit: primaryName() }"
            [closeLabel]="'organization.record.closeList' | translate"
            [columns]="subUnitColumns()"
            grid="minmax(180px,1.6fr) minmax(110px,1fr) minmax(130px,1.2fr) 96px"
            defaultSort="order:asc"
            [searchLabel]="'organization.record.searchSubUnits' | translate"
            [noMatchText]="'organization.record.noMatch' | translate"
            [countText]="subUnitCount"
          >
            <span amPanelActions class="flex items-center gap-3">
              @if (s.children.length) {
                <a class="am-ur__link text-meta" routerLink="/organization" [queryParams]="{ show: s.unit.id }" data-testid="unit-show-in-tree">{{ 'organization.record.showInTree' | translate }}</a>
              } @else if (canAct()) {
                <button type="button" class="am-ur__link text-meta" (click)="onAddChild()" data-testid="unit-subs-add">{{ 'organization.addSubUnit' | translate }}</button>
              }
            </span>
          </am-unit-list-panel>

          <am-unit-list-panel
            [heading]="'organization.record.people' | translate"
            testIdPrefix="unit-people"
            [items]="peopleItems()"
            [emptyText]="'organization.record.noPeople' | translate: { unit: primaryName() }"
            [popupHeading]="'organization.record.peopleOf' | translate: { unit: primaryName() }"
            [closeLabel]="'organization.record.closeList' | translate"
            [columns]="peopleColumns()"
            grid="minmax(180px,1.4fr) minmax(160px,1.2fr)"
            [defaultSort]="s.people.length > groupAbove ? 'position:asc' : 'name:asc'"
            [searchLabel]="'organization.record.searchPeople' | translate"
            [noMatchText]="'organization.record.noMatch' | translate"
            [countText]="peopleCount"
          >
            <span amPanelActions>
              @if (!s.people.length && canOpenUsers()) {
                <a class="am-ur__link text-meta" routerLink="/users" data-testid="unit-people-users">{{ 'organization.record.openUsers' | translate }}</a>
              }
            </span>
          </am-unit-list-panel>

          @if (s.people.length) {
            <am-unit-list-panel
              [heading]="'organization.record.positions' | translate"
              testIdPrefix="unit-positions"
              [items]="positionItems()"
              [emptyText]="'organization.record.noPositions' | translate"
              [popupHeading]="'organization.record.positionsOf' | translate: { unit: primaryName() }"
              [closeLabel]="'organization.record.closeList' | translate"
              [columns]="positionColumns()"
              grid="minmax(200px,1.6fr) 120px"
              defaultSort="rank:asc"
              [searchLabel]="'organization.record.searchPositions' | translate"
              [noMatchText]="'organization.record.noMatch' | translate"
              [countText]="positionCount"
            />
          }

          <am-unit-list-panel
            [heading]="'organization.record.committees' | translate"
            testIdPrefix="unit-committees"
            [items]="committeeItems()"
            [total]="s.committees.count"
            [offersSeeAll]="s.committees.items !== null"
            [emptyText]="committeesEmptyText()"
            [popupHeading]="'organization.record.committeesOf' | translate: { unit: primaryName() }"
            [closeLabel]="'organization.record.closeList' | translate"
            [columns]="committeeColumns()"
            grid="minmax(200px,1.6fr) minmax(140px,1fr)"
            defaultSort="name:asc"
            [searchLabel]="'organization.record.searchCommittees' | translate"
            [noMatchText]="'organization.record.noMatch' | translate"
            [countText]="committeeCount"
          />

          <am-unit-history-panel
            [unitId]="s.unit.id"
            [unitName]="primaryName()"
            [page]="history()"
            [state]="historyState()"
            (retry)="loadHistory()"
          />
        </section>
      </div>
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
    <ng-template #unitFooterTpl>
      <div class="flex justify-end gap-2">
        <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" (onClick)="unitDialog.requestClose()" [disabled]="!!unitFormRef()?.saving()" />
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

    <am-org-unit-blockers-dialog [(visible)]="blockersVisible" [unitName]="primaryName()" [blockers]="blockers()" />

    @if (actionError(); as e) {
      <p class="mt-3 mb-0 text-meta text-danger" role="alert" data-testid="unit-action-error">{{ e | translate }}</p>
    }
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-ur__card{background:var(--am-surface-raised);border:1px solid var(--am-border);border-radius:var(--am-radius-card)}
      .am-ur__relations{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:var(--am-space-12) var(--am-space-24);padding:var(--am-space-12) var(--am-space-16);border-block-start:1px solid var(--am-border)}
      .am-ur__deactivated{display:flex;flex-direction:column;gap:2px;margin:0 var(--am-space-16) var(--am-space-12);padding:var(--am-space-8) var(--am-space-12);border-radius:var(--am-radius-control);background:var(--am-surface);font-size:var(--am-type-meta-size)}
      .am-ur__strip{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--am-space-4) var(--am-space-12);padding:var(--am-space-8) var(--am-space-16);border:1px solid var(--am-warning-border);border-radius:var(--am-radius-card);background:var(--am-warning-bg);color:var(--am-warning-ink);font-size:var(--am-type-meta-size)}
      .am-ur__strip--blocks{border-color:var(--am-danger-border);background:var(--am-danger-bg);color:var(--am-danger-ink)}
      .am-ur__link{font:inherit;padding:0;border:0;background:none;color:var(--am-primary-700);font-weight:600;cursor:pointer;text-decoration:none}
      .am-ur__link:hover{text-decoration:underline}
      .am-ur__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-ur__headship{min-inline-size:0}
    `,
  ],
})
export class OrgUnitRecordComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly orgUnits = inject(OrgUnitService);
  private readonly access = inject(NavigationAccessService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly breadcrumb = inject(BreadcrumbParentService);
  private readonly confirm = inject(AmConfirmService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly panelGrid = ORG_UNIT_PANEL_GRID;
  protected readonly groupAbove = PEOPLE_GROUP_ABOVE;

  /** The unit in the URL. A link to a sub-unit reuses this component, so it follows the route. */
  readonly unitId = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('id') ?? '',
  });

  readonly summary = signal<OrgUnitSummaryDto | null>(null);
  readonly state = signal<LoadState>('loading');
  readonly history = signal<OrgUnitHistoryPageDto | null>(null);
  readonly historyState = signal<CappedPanelState>('loading');
  readonly actionError = signal<string | null>(null);

  // ── the unit dialog (the tree's, OS L634) ─────────────────────────────────
  readonly formVisible = signal(false);
  readonly editingUnit = signal<OrgUnitDto | null>(null);
  readonly newUnitParentId = signal<string | null>(null);
  readonly unitFormRef = signal<OrgUnitFormComponent | null>(null);
  readonly unitFormDirty = signal(false);
  readonly blockersVisible = signal(false);
  readonly blockers = signal<OrgUnitDependenciesRefusalDto['blockers']>([]);

  /** Setup health's "Set type" Fix (?edit=1) opens Edit once the unit has loaded. */
  private readonly fixLinkEdit = injectFixLinkParam('edit');

  readonly isArabic = computed(() => this.language.isArabic());
  readonly canManage = computed(() => this.access.hasPermission('org:manage'));
  /** Edit, Add sub-unit and ⋯: a manager, on an active unit. */
  readonly canAct = computed(() => this.canManage() && !!this.summary()?.unit.isActive);
  /** A person's record (`/users/:id`) opens for `admin:access` + `users:view` (ACC-123). */
  readonly canOpenUsers = computed(() => this.access.hasPermission(ADMIN_ACCESS) && this.access.hasPermission('users:view'));

  constructor() {
    registerPageName(() => (this.summary() ? this.primaryName() : null));

    effect(() => {
      this.unitId();
      untracked(() => this.load());
    });

    // The breadcrumb is the unit's ancestry (ACC-79): every parent, top first.
    effect(() => {
      const s = this.summary();
      const path = `/organization/units/${this.unitId()}`;
      if (!s || s.unit.id !== this.unitId()) return;
      const crumbs = s.path.slice(0, -1).map((p) => ({ url: `/organization/units/${p.id}`, text: this.language.bilingual(p.nameEn, p.nameAr) }));
      untracked(() => this.breadcrumb.setTrail(path, crumbs));
    });
    inject(DestroyRef).onDestroy(() => this.breadcrumb.clear(`/organization/units/${this.unitId()}`));
  }

  load(): void {
    const id = this.unitId();
    if (!id) return;
    if (this.summary()?.unit.id !== id) {
      this.summary.set(null);
      this.state.set('loading');
    }
    this.actionError.set(null);
    this.orgUnits.getSummary(id).subscribe({
      next: (summary) => {
        if (id !== this.unitId()) return;
        this.summary.set(summary);
        this.state.set('ready');
        if (this.fixLinkEdit() && this.canAct()) this.onEdit();
      },
      error: (err: unknown) => {
        if (id !== this.unitId()) return;
        this.summary.set(null);
        this.state.set(err instanceof HttpErrorResponse && err.status === 404 ? 'notFound' : 'error');
      },
    });
    this.loadHistory();
  }

  loadHistory(): void {
    const id = this.unitId();
    this.historyState.set('loading');
    this.orgUnits.getHistory(id, { take: HISTORY_FIRST_PAGE }).subscribe({
      next: (page) => {
        if (id !== this.unitId()) return;
        this.history.set(page);
        this.historyState.set('ready');
      },
      error: () => {
        if (id === this.unitId()) this.historyState.set('error');
      },
    });
  }

  // ── the header ────────────────────────────────────────────────────────────

  readonly primaryName = computed(() => {
    const u = this.summary()?.unit;
    return u ? this.language.bilingual(u.nameEn, u.nameAr) : '';
  });

  /** The other language below, at the smaller size, when the unit has both names. */
  readonly otherName = computed(() => {
    const u = this.summary()?.unit;
    if (!u?.nameAr) return null;
    return this.isArabic() ? u.nameEn : u.nameAr;
  });

  readonly typeLabel = computed(() => {
    this.translate.currentLang();
    const t = this.summary()?.unit.type;
    return t ? this.language.bilingual(t.labelEn, t.labelAr) : this.translate.instant('organization.tree.noTypeCell');
  });

  readonly stateLabel = computed(() => {
    this.translate.currentLang();
    return this.translate.instant(this.summary()?.unit.isActive ? 'organization.record.stateActive' : 'organization.record.stateDeactivated');
  });

  private readonly textDeps = computed<HistoryTextDeps>(() => {
    this.translate.currentLang();
    return {
      t: (key, params) => this.translate.instant(key, params),
      bilingual: (en, ar) => this.language.bilingual(en, ar),
      date: (value) => this.format.date(value),
    };
  });

  /** "Deactivated 3 Jun 2026 by Nora", from the audit row that recorded it. */
  readonly deactivatedLine = computed(() => {
    const t = this.textDeps().t;
    const d = this.history()?.deactivation;
    if (!d) return t('organization.record.deactivatedNoDate');
    const date = this.format.date(d.at);
    return d.actor
      ? t('organization.record.deactivatedOnBy', { date, person: historyPerson(d.actor, this.textDeps()) })
      : t('organization.record.deactivatedOn', { date });
  });

  /** Parent unit · Head · Acting head (OS L327-331), each with its state as text. */
  readonly relations = computed<RelationView[]>(() => {
    const s = this.summary();
    if (!s) return [];
    const t = this.textDeps().t;
    const out: RelationView[] = [];
    const parent = s.path.length > 1 ? s.path[s.path.length - 2]! : null;
    out.push({
      label: t('organization.parentUnit'),
      kind: 'unit',
      name: parent ? this.language.bilingual(parent.nameEn, parent.nameAr) : t('organization.record.topUnit'),
      link: parent ? ['/organization/units', parent.id] : null,
      state: '',
      hidden: false,
      none: !parent,
      testId: 'relation-parent',
    });

    const heads = [...s.unit.heads].sort((a, b) => (a.role === b.role ? 0 : a.role === 'substantive' ? -1 : 1));
    const head = heads[0];
    if (!head) {
      out.push({ label: t('headship.head.label'), kind: 'person', name: t('headship.head.none'), link: null, state: '', hidden: false, none: true, testId: 'relation-head' });
    } else {
      const position = head.positionNameEn ? this.language.bilingual(head.positionNameEn, head.positionNameAr) : '';
      const incoming = heads.find((h) => h.role === 'incoming' && h !== head);
      const extra = incoming ? t('organization.tree.incoming', { name: incoming.name ?? t('organization.record.nameHidden') }) : '';
      out.push({
        label: t('headship.head.label'),
        kind: 'person',
        name: head.name ?? (position || t('headship.head.assigned')),
        link: head.name && this.canOpenUsers() ? ['/users', head.userId] : null,
        state: [head.name ? position : t('organization.record.nameHidden'), head.role === 'incoming' ? t('organization.record.incoming') : '', extra]
          .filter(Boolean)
          .join(' · '),
        hidden: !head.name,
        none: false,
        testId: 'relation-head',
      });
    }

    const acting = s.unit.acting;
    if (acting) {
      const until = acting.validTo ? t('organization.record.actingUntil', { date: this.format.date(acting.validTo) }) : t('headship.cover.noEndDate');
      out.push({
        label: t('headship.cover.label'),
        kind: 'person',
        name: acting.name ?? t('headship.cover.arranged'),
        link: acting.name && this.canOpenUsers() ? ['/users', acting.userId] : null,
        state: acting.name ? until : `${t('organization.record.nameHidden')} · ${until}`,
        hidden: !acting.name,
        none: false,
        testId: 'relation-acting',
      });
    }
    return out;
  });

  /**
   * The Setup health strip (OS L334-338): the highest open condition, its
   * date, a Fix, and "+ N more" to Setup health filtered to this unit. Only
   * while one is open, and only for `setup:view` (the summary omits it otherwise).
   */
  readonly strip = computed(() => {
    const s = this.summary();
    const a = s?.unit.attention;
    if (!s || !a) return null;
    const t = this.textDeps().t;
    const severity = t(`setupHealth.severity.${a.severity}`);
    const fix = this.canAct()
      ? a.code === 'ORG_UNIT_WITHOUT_TYPE'
        ? { label: t('organization.record.fixType'), action: 'edit' as const }
        : { label: t('organization.record.fixHeadship'), action: 'headship' as const }
      : null;
    return {
      since: t('organization.record.stripSince', { severity, date: this.format.date(a.since) }),
      condition: t(`setupHealth.types.${a.code}`),
      blocks: a.severity === 'BLOCKS_WORK',
      fix,
      more: a.openCount > 1 ? this.format.count('organization.moreConditions', a.openCount - 1) : null,
    };
  });

  runFix(action: 'edit' | 'headship'): void {
    if (action === 'edit') return this.onEdit();
    const panel = this.host.nativeElement.querySelector<HTMLElement>('#unit-headship');
    panel?.scrollIntoView({ block: 'start' });
    (panel?.querySelector<HTMLElement>('[data-action] button, button') ?? panel)?.focus();
  }

  // ── the panels ────────────────────────────────────────────────────────────

  private headText(node: OrgStructureNodeDto): string {
    const t = this.textDeps().t;
    const head = node.heads.find((h) => h.role === 'substantive') ?? node.heads[0];
    if (head) return head.name ?? t('headship.head.assigned');
    if (node.acting) return t('organization.record.actingName', { name: node.acting.name ?? t('organization.record.nameHidden') });
    return t('headship.head.none');
  }

  readonly subUnitItems = computed<UnitPanelItem[]>(() => {
    const s = this.summary();
    if (!s) return [];
    const t = this.textDeps().t;
    return s.children.map((c, i) => {
      const name = this.language.bilingual(c.nameEn, c.nameAr);
      const type = c.type ? this.language.bilingual(c.type.labelEn, c.type.labelAr) : t('organization.tree.noTypeCell');
      const head = this.headText(c);
      const people = this.format.count('organization.people', c.headcount);
      return {
        id: c.id,
        primary: name,
        link: ['/organization/units', c.id],
        secondary: `${type} · ${head}`,
        trailing: people,
        cells: [type, head, people],
        search: `${c.nameEn} ${c.nameAr ?? ''} ${c.code}`.toLowerCase(),
        sort: { order: i, name, type, people: c.headcount },
      };
    });
  });

  readonly peopleItems = computed<UnitPanelItem[]>(() => {
    const s = this.summary();
    if (!s) return [];
    const t = this.textDeps().t;
    const byPosition = s.people.length > PEOPLE_GROUP_ABOVE;
    const rows = s.people.map((p) => {
      const position = p.positionNameEn ? this.language.bilingual(p.positionNameEn, p.positionNameAr) : t('organization.record.noPosition');
      const secondary = p.isHead ? `${position} · ${t('organization.record.headTag')}` : position;
      const name = p.name ?? t('organization.record.nameHidden');
      return {
        id: p.userId,
        primary: name,
        link: p.name && this.canOpenUsers() ? ['/users', p.userId] : null,
        muted: !p.name,
        secondary,
        cells: [secondary],
        search: `${p.name ?? ''} ${p.positionNameEn ?? ''} ${p.positionNameAr ?? ''}`.toLowerCase(),
        sort: { name, position: `${p.isHead ? 0 : 1}${position}` },
        groupKey: `${p.isHead ? 0 : 1}${position}`,
      };
    });
    // Above ten, grouped by position: heads first, then each position together.
    if (byPosition) rows.sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.primary.localeCompare(b.primary));
    return rows;
  });

  readonly positionItems = computed<UnitPanelItem[]>(() => {
    const s = this.summary();
    if (!s) return [];
    const t = this.textDeps().t;
    return s.positions.map((p, i) => {
      const name = this.language.bilingual(p.nameEn, p.nameAr);
      const holders = this.format.count('organization.people', p.count);
      return {
        id: p.positionId,
        primary: name,
        link: null,
        secondary: p.isUnitHeadPosition ? t('organization.record.confersHeadship') : t('organization.record.grade', { grade: this.format.number(p.grade) }),
        trailing: holders,
        cells: [holders],
        search: `${p.nameEn} ${p.nameAr ?? ''}`.toLowerCase(),
        sort: { rank: i, name, holders: p.count },
      };
    });
  });

  readonly committeeItems = computed<UnitPanelItem[]>(() => {
    const items = this.summary()?.committees.items ?? [];
    const t = this.textDeps().t;
    return items.map((c) => {
      const name = this.language.bilingual(c.nameEn, c.nameAr);
      const stage = c.stageNameEn ? this.language.bilingual(c.stageNameEn, c.stageNameAr) : t('organization.record.noStage');
      return {
        id: c.id,
        primary: name,
        link: ['/committees', c.id],
        secondary: stage,
        cells: [stage],
        search: `${c.nameEn} ${c.nameAr ?? ''}`.toLowerCase(),
        sort: { name, stage },
      };
    });
  });

  /** Without `committees:view` the count is shown and the names are not (D7). */
  readonly committeesEmptyText = computed(() => {
    const s = this.summary();
    const t = this.textDeps().t;
    if (s && s.committees.items === null && s.committees.count > 0) return t('organization.record.committeesHidden');
    return t('organization.record.noCommittees');
  });

  private columns(...specs: Array<[string, string | undefined]>): SimpleListColumn[] {
    const t = this.textDeps().t;
    return specs.map(([key, sort]) => ({ label: t(key), ...(sort ? { sort } : {}) }));
  }

  readonly subUnitColumns = computed(() =>
    this.columns(['organization.tree.colUnit', 'name'], ['organization.tree.colType', 'type'], ['organization.tree.colHead', undefined], ['organization.tree.colPeople', 'people']),
  );
  readonly peopleColumns = computed(() => this.columns(['organization.record.colName', 'name'], ['organization.record.colPosition', 'position']));
  readonly positionColumns = computed(() => this.columns(['organization.record.colPosition', 'name'], ['organization.record.colHolders', 'holders']));
  readonly committeeColumns = computed(() => this.columns(['organization.record.colCommittee', 'name'], ['organization.record.colStage', 'stage']));

  readonly subUnitCount = (n: number, searching: boolean) => this.format.count(searching ? 'organization.matches' : 'organization.units', n);
  readonly peopleCount = (n: number) => this.format.count('organization.people', n);
  readonly positionCount = (n: number) => this.format.count('organization.positions', n);
  readonly committeeCount = (n: number) => this.format.count('organization.committees', n);

  // ── actions ───────────────────────────────────────────────────────────────

  readonly menuGroups = computed<RowMenuItem[][]>(() => [
    [{ id: 'deactivate', label: this.textDeps().t('organization.deactivate'), danger: true }],
  ]);

  onPicked(id: string): void {
    if (id === 'deactivate') this.askDeactivate();
  }

  readonly unitDialogHeader = computed(() => {
    const t = this.textDeps().t;
    return this.editingUnit()
      ? t('organization.editUnitNamed', { unit: this.primaryName() })
      : t('organization.addSubUnitTo', { parent: this.primaryName() });
  });

  onEdit(): void {
    const id = this.unitId();
    this.actionError.set(null);
    this.orgUnits.getById(id).subscribe({
      next: (unit) => {
        this.editingUnit.set(unit);
        this.newUnitParentId.set(null);
        this.unitFormDirty.set(false);
        this.formVisible.set(true);
      },
      error: (err: unknown) => this.actionError.set(extractErrorMessage(err, 'organization.record.loadFailed')),
    });
  }

  onAddChild(): void {
    this.editingUnit.set(null);
    this.newUnitParentId.set(this.unitId());
    this.unitFormDirty.set(false);
    this.formVisible.set(true);
  }

  onFormSaved(): void {
    this.unitFormDirty.set(false);
    this.formVisible.set(false);
    this.load();
  }

  private askDeactivate(): void {
    const unit = this.primaryName();
    this.confirm.ask({
      tone: 'destructive',
      header: this.translate.instant('organization.deactivateConfirm.header', { unit }),
      message: this.translate.instant('organization.deactivateConfirm.message'),
      acceptLabel: this.translate.instant('organization.deactivateConfirm.accept'),
      accept: () => this.deactivate(),
    });
  }

  private deactivate(): void {
    this.orgUnits.deactivate(this.unitId()).subscribe({
      next: () => this.load(),
      error: (err: unknown) => {
        const body = err instanceof HttpErrorResponse ? (err.error as Partial<OrgUnitDependenciesRefusalDto> | null) : null;
        if (body?.code === 'ORG_UNIT_HAS_DEPENDENCIES' && Array.isArray(body.blockers)) {
          this.blockers.set(body.blockers);
          this.blockersVisible.set(true);
          return;
        }
        this.actionError.set(extractErrorMessage(err, 'organization.deactivateFailed'));
      },
    });
  }
}
