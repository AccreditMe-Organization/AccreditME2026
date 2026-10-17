import { Component, DestroyRef, TemplateRef, ViewChild, computed, inject, signal, viewChild } from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { Observable, finalize, of, shareReplay, switchMap, tap } from 'rxjs';
import { CommitteeService, CommitteeListItemDto } from '../../services/committee.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { LanguageService } from '../../../../core/services/language.service';
import { CommitteeFormComponent } from '../committee-form/committee-form.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import {
  DataListColumn,
  DataListComponent,
} from '../../../../shared/components/data-list/data-list.component';
import {
  DataListSource,
  clientSideSource,
} from '../../../../shared/components/data-list/data-list.source';
import { ListRowDirective } from '../../../../shared/components/data-list/list-row.directive';
import { StatusChipComponent } from '../../../../shared/components/status-chip/status-chip.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { AmNumberPipe } from '../../../../core/formatting';
import { SHELL_PHONE_BELOW_PX } from '../../../../layout/app-shell/app-shell.component';

/** A committee's state as the list shows and filters it. */
export type CommitteeListStatus = 'ACTIVE' | 'DISSOLVING' | 'INACTIVE';

// ACC-233's isDissolving is the server's answer for "being dissolved, or has
// been". A dissolved committee is also inactive, and inactive is what it reads
// as: "being dissolved" is only for one still active while it winds down.
export function committeeListStatus(c: Pick<CommitteeListItemDto, 'isActive' | 'isDissolving'>): CommitteeListStatus {
  if (!c.isActive) return 'INACTIVE';
  return c.isDissolving ? 'DISSOLVING' : 'ACTIVE';
}

// ACC-120 slice 4 — the committees list, on the list template /roles and /users
// already use (Template 1). Plan: backend/Plans/step-120-4-committees-list.md.
//
// Six columns, every one fed by GET /committees: name, type, parent, stage,
// status, members. "Next meeting" is left out (Ahmad, 16 Oct): nothing records
// a meeting yet, and a column with nothing behind it would read "—" on every
// row for a reason the reader can't see.
@Component({
  selector: 'app-committee-list',
  standalone: true,
  imports: [
    PageHeaderComponent,
    TranslatePipe,
    FormsModule,
    NgTemplateOutlet,
    ButtonModule,
    CommitteeFormComponent,
    EditDialogComponent,
    DataListComponent,
    ListRowDirective,
    StatusChipComponent,
    OverlaySelectComponent,
    AmNumberPipe,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">
      <app-page-header [title]="'committee.title' | translate">
        <div pageActions>
          @if (canCreate()) {
            <p-button [label]="'committee.addCommittee' | translate" icon="pi pi-plus" (onClick)="onAdd()" />
          }
        </div>
      </app-page-header>

      <!-- At ACC-232's phone width the toolbar has no room for two filters
           beside the search, so they get their own row above the list. -->
      @if (phone()) {
        <div class="grid grid-cols-2 gap-2" data-testid="committee-filters-phone">
          <ng-container [ngTemplateOutlet]="filtersTpl" />
        </div>
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
          [filterNames]="filterNames"
          [searchPlaceholder]="'committee.list.searchPlaceholder' | translate"
          [emptyTitle]="'committee.list.empty' | translate"
          [emptyMessage]="canCreate() ? ('committee.list.emptyCreate' | translate) : ''"
          gridSuffix="16px"
          persistKey="committees"
          [urlSync]="true"
        >
          @if (!phone()) {
            <div listFilters class="flex items-center gap-1.5 shrink-0">
              <ng-container [ngTemplateOutlet]="filtersTpl" />
            </div>
          }

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

          <ng-template #listRow let-committee let-v="visible">
            <!-- amListRow carries the keyboard contract: one tab stop for the
                 table, arrows between rows, Enter opens the committee. -->
            <div
              amListRow
              [amListRowKey]="committee.id"
              (rowOpen)="onOpen(committee)"
              class="grid items-center gap-3 px-3 py-2 cursor-pointer"
              style="grid-template-columns: var(--am-list-cols)"
              (click)="onOpen(committee)"
            >
              @if (v('name')) {
                @if (phone()) {
                  <!-- One column for what the wide list spreads over four. -->
                  <span class="flex flex-col min-w-0">
                    <span class="text-[13px] font-medium truncate" data-cell="name">{{ displayName(committee) }}</span>
                    <span class="text-xs text-[var(--am-text-secondary)] truncate" data-cell="meta">{{ phoneMeta(committee) }}</span>
                  </span>
                } @else {
                  <span class="text-[13px] font-medium truncate" data-cell="name">{{ displayName(committee) }}</span>
                }
              }
              @if (!phone() && v('type')) {
                <span class="text-xs truncate" data-cell="type">{{ typeLabel(committee.typeValueId) }}</span>
              }
              @if (!phone() && v('parent')) {
                <span class="text-xs truncate" data-cell="parent">{{ parentName(committee.parentCommitteeId) }}</span>
              }
              @if (!phone() && v('stage')) {
                <!-- Tenant data: the stage's own names, never | translate. -->
                <span class="text-xs truncate" data-cell="stage">{{ stageName(committee) }}</span>
              }
              @if (!phone() && v('status')) {
                <span class="text-xs" data-cell="status">
                  <app-status-chip
                    variant="user"
                    labelPrefix="committee.status"
                    [value]="status(committee)"
                  />
                </span>
              }
              @if (v('members')) {
                <span
                  dir="ltr"
                  style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
                  class="text-xs text-[var(--am-text-secondary)] text-start"
                  data-cell="members"
                  >{{ committee.memberCount | amNumber }}</span
                >
              }
              <i class="pi pi-chevron-right justify-self-end rtl:rotate-180 text-[10px] text-[var(--am-text-secondary)]" aria-hidden="true"></i>
            </div>
          </ng-template>
        </app-data-list>
      </div>
    </div>

    <!-- The two filters, drawn in the toolbar or, on a phone, above the list.
         Each fills its slot; on a wide screen the slot is sized for the Arabic
         labels, the longer of the two. -->
    <ng-template #filtersTpl>
      <app-overlay-select
        [class]="phone() ? 'min-w-0' : 'w-[170px]'"
        data-filter="status"
        [options]="statusOptions()"
        optionLabel="label"
        optionValue="value"
        [showClear]="true"
        [ariaLabel]="'committee.list.statusFilter' | translate"
        [placeholder]="'committee.list.allStatuses' | translate"
        [ngModel]="list.filterValue('status')"
        (ngModelChange)="list.setFilter('status', $event)"
      />
      <app-overlay-select
        [class]="phone() ? 'min-w-0' : 'w-[190px]'"
        data-filter="type"
        [options]="typeOptions()"
        optionLabel="label"
        optionValue="value"
        [showClear]="true"
        [ariaLabel]="'committee.list.typeFilter' | translate"
        [placeholder]="'committee.list.allTypes' | translate"
        [ngModel]="list.filterValue('typeValueId')"
        (ngModelChange)="list.setFilter('typeValueId', $event)"
      />
    </ng-template>

    <ng-template #formTpl>
      <app-committee-form (saved)="onSaved()" (cancelled)="formVisible.set(false)" />
    </ng-template>
    <app-edit-dialog
      [(visible)]="formVisible"
      [header]="'committee.addCommittee' | translate"
      [content]="formTpl"
    />
  `,
})
export class CommitteeListComponent {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly committeeService = inject(CommitteeService);
  private readonly lookupService = inject(LookupService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly document = inject(DOCUMENT);

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. Same mechanism as committee-detail.component.ts's canEdit /
  // canAddMember, deliberately rather than a second one.
  // POST /committees enforces committees:create (committees.controller.ts).
  readonly canCreate = computed(() => this.navigationAccess.hasPermission('committees:create'));

  readonly list = viewChild.required<DataListComponent<CommitteeListItemDto>>('list');
  readonly formVisible = signal(false);

  /** Every committee in the organisation, once loaded; null until then. */
  private readonly committees = signal<CommitteeListItemDto[] | null>(null);
  private inFlight: Observable<CommitteeListItemDto[]> | null = null;
  readonly committeeTypes = signal<LookupValueDto[]>([]);

  readonly filterNames = ['status', 'typeValueId'] as const;
  readonly trackById = (c: CommitteeListItemDto): string => c.id;

  /** ACC-232's phone width: below it the list is one name column and a count. */
  readonly phone = signal(false);

  constructor() {
    const media = this.document.defaultView?.matchMedia?.(`(max-width: ${SHELL_PHONE_BELOW_PX - 0.02}px)`);
    if (media) {
      this.phone.set(media.matches);
      const onChange = (e: MediaQueryListEvent): void => this.phone.set(e.matches);
      media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
    }
    // A failed lookup leaves every type as "—" (the plan's partial outcome),
    // never the raw id, and the list itself still loads.
    this.lookupService.getValues('committee_type').subscribe({
      next: (values) => this.committeeTypes.set(values),
      error: () => this.committeeTypes.set([]),
    });
  }

  readonly columns = computed<DataListColumn[]>(() => {
    const lang = this.translate.currentLang();
    const name: DataListColumn = {
      key: 'name',
      label: this.translate.instant('committee.col.name'),
      // Sorts by the name being read. A committee with no Arabic name is
      // SHOWN by its English one, and sorts last in an Arabic session
      // (ACC-160), as /roles and /positions do.
      sortBy: lang === 'ar' ? 'nameAr' : 'nameEn',
      alwaysVisible: true,
      width: 'minmax(0, 2fr)',
    };
    // On a phone, the name cell carries type, stage and any status that is
    // not Active on its second line; only the member count keeps a column.
    if (this.phone()) {
      return [
        { ...name, width: 'minmax(0, 1fr)' },
        { key: 'members', label: this.translate.instant('committee.col.members'), sortBy: 'members', alwaysVisible: true, width: '72px' },
      ];
    }
    return [
      name,
      { key: 'type', label: this.translate.instant('committee.col.type'), sortBy: 'type', width: 'minmax(0, 1.2fr)' },
      { key: 'parent', label: this.translate.instant('committee.col.parent'), width: 'minmax(0, 1.2fr)' },
      { key: 'stage', label: this.translate.instant('committee.col.stage'), sortBy: 'stage', width: 'minmax(0, 1.2fr)' },
      { key: 'status', label: this.translate.instant('committee.col.status'), width: '130px' },
      { key: 'members', label: this.translate.instant('committee.col.members'), sortBy: 'members', width: '90px' },
    ];
  });

  readonly statusOptions = computed(() => {
    this.translate.currentLang();
    return (['ACTIVE', 'DISSOLVING', 'INACTIVE'] as const).map((value) => ({
      value,
      label: this.translate.instant(`committee.status.${value.toLowerCase()}`),
    }));
  });

  readonly typeOptions = computed(() => {
    this.translate.currentLang();
    return this.committeeTypes().map((t) => ({
      value: t.id,
      label: this.languageService.bilingual(t.labelEn, t.labelAr),
    }));
  });

  /**
   * Fetch once, then answer every search, sort and filter from the cache —
   * the positions list's pattern (ACC-120 slice 6), so the first load shows
   * the skeleton rather than "No committees yet". `clientSideSource` does not
   * read `query.filters`, so the two filters narrow the rows before it does.
   */
  readonly source: DataListSource<CommitteeListItemDto> = (query) => {
    const cached = this.committees();
    // The list asks more than once while it settles on its first query (its
    // restored preferences, then the URL); every ask before the answer shares
    // ONE request rather than each sending its own.
    const items$ = cached
      ? of(cached)
      : (this.inFlight ??= this.committeeService.listCommittees().pipe(
          tap((rows) => this.committees.set(rows)),
          finalize(() => (this.inFlight = null)),
          shareReplay({ bufferSize: 1, refCount: false }),
        ));
    return items$.pipe(
      switchMap((rows) => {
        const status = query.filters?.['status'] ?? null;
        const typeValueId = query.filters?.['typeValueId'] ?? null;
        const narrowed = rows.filter(
          (c) =>
            (!status || committeeListStatus(c) === status) &&
            (!typeValueId || c.typeValueId === typeValueId),
        );
        return clientSideSource(() => narrowed, {
          searchFields: (c) => [c.nameEn, c.nameAr],
          comparators: {
            nameEn: (a, b) => a.nameEn.localeCompare(b.nameEn, 'en'),
            nameAr: (a, b) => (a.nameAr ?? '').localeCompare(b.nameAr ?? '', 'ar'),
            type: (a, b) => this.compareText(this.typeLabel(a.typeValueId), this.typeLabel(b.typeValueId)),
            stage: (a, b) => this.compareText(this.stageName(a), this.stageName(b)),
            members: (a, b) => a.memberCount - b.memberCount,
          },
          defaultSort: { column: this.languageService.isArabic() ? 'nameAr' : 'nameEn', dir: 'asc' },
          nullsLast: {
            nameAr: (c) => c.nameAr,
            // A committee with no workflow yet has no stage, and sorts after
            // every one that has, in both directions.
            stage: (c) => this.languageService.bilingual(c.currentStageNameEn ?? '', c.currentStageNameAr),
          },
        })(query);
      }),
    );
  };

  private compareText(a: string, b: string): number {
    return a.localeCompare(b, this.languageService.isArabic() ? 'ar' : 'en');
  }

  displayName(committee: CommitteeListItemDto): string {
    return this.languageService.bilingual(committee.nameEn, committee.nameAr);
  }

  typeLabel(typeValueId: string): string {
    const value = this.committeeTypes().find((v) => v.id === typeValueId);
    return value ? this.languageService.bilingual(value.labelEn, value.labelAr) : '—';
  }

  parentName(parentId: string | null): string {
    if (!parentId) return '—';
    const parent = (this.committees() ?? []).find((c) => c.id === parentId);
    return parent ? this.displayName(parent) : '—';
  }

  stageName(committee: CommitteeListItemDto): string {
    if (!committee.currentStageNameEn && !committee.currentStageNameAr) return '—';
    return this.languageService.bilingual(committee.currentStageNameEn ?? '', committee.currentStageNameAr) || '—';
  }

  /** The phone row's second line: type · stage, and the status unless Active. */
  phoneMeta(committee: CommitteeListItemDto): string {
    const parts = [this.typeLabel(committee.typeValueId), this.stageName(committee)];
    const status = committeeListStatus(committee);
    if (status !== 'ACTIVE') parts.push(this.translate.instant(`committee.status.${status.toLowerCase()}`));
    return parts.join(' · ');
  }

  status(committee: CommitteeListItemDto): CommitteeListStatus {
    return committeeListStatus(committee);
  }

  onAdd(): void {
    this.formVisible.set(true);
  }

  onOpen(committee: CommitteeListItemDto): void {
    void this.router.navigate(['/committees', committee.id]);
  }

  onSaved(): void {
    this.formVisible.set(false);
    this.committees.set(null);
    this.list().reload();
  }
}
