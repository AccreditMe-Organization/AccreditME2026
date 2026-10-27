import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { Observable, finalize, firstValueFrom, of, shareReplay, switchMap, tap } from 'rxjs';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { DataListColumn, DataListComponent } from '../../../shared/components/data-list/data-list.component';
import { DataListSource, clientSideSource } from '../../../shared/components/data-list/data-list.source';
import { ListRowDirective } from '../../../shared/components/data-list/list-row.directive';
import { SortHeaderComponent } from '../../../shared/components/sort-header/sort-header.component';
import { OverlaySelectComponent } from '../../../shared/components/overlay-select/overlay-select.component';
import { AmCountPipe, FormatService } from '../../../core/formatting';
import { LanguageService } from '../../../core/services/language.service';
import { FilesService } from '../../../shared/files/files.service';
import { SHELL_PHONE_BELOW_PX } from '../../../layout/app-shell/app-shell.component';
import { IRecycleBinItem, PURGE_MAX_FILES, RECYCLE_BIN_DAYS, RecycleBinService } from './recycle-bin.service';
import {
  DAYS_LEFT_WARN,
  DELETED_BANDS,
  DELETED_BY_NOBODY,
  comparators,
  deleters,
  fileKind,
  isRecordGone,
  matchesFilters,
  recordTypes,
  totals,
} from './recycle-bin-view';
import { RecycleBinRestoreDialogComponent } from './recycle-bin-restore-dialog.component';
import { RecycleBinPurgeDialogComponent } from './recycle-bin-purge-dialog.component';

/** What the last restore or purge came to, said above the list until dismissed. */
type BinOutcome =
  | { kind: 'restored'; count: number }
  | { kind: 'restoreMixed'; restored: number; lines: readonly string[] }
  | { kind: 'purged'; count: number }
  | { kind: 'purgeGone' };

/**
 * ACC-260, PR D — the Recycle bin, `/admin-settings/recycle-bin`
 * (tenant:manage_config). Design: AccreditMe Storage Settings.dc.html §6
 * (L345–434), its dialogs (L885–906) and notes (L1080–1097); plan:
 * backend/Plans/step-260-storage-settings.md §1.7, G6, G8, G14 and PR D.
 *
 * GET /tenant/recycle-bin answers the WHOLE list (no paging, plan G8), so it is
 * read once and the shared list searches, filters, sorts and pages it in
 * memory — the committees list's pattern. Sorting is by column header; it opens
 * soonest to expire first.
 *
 * - Restore: one file per request (the API's shape), so several selected files
 *   are several requests in sequence, each reported: restored, or refused with
 *   its reason. FILE_RECORD_GONE marks the row gone for the rest of the visit.
 *   The list shown afterwards is the one the last successful restore answered
 *   with, or a fresh GET when any file was no longer in the bin (404).
 * - Purge: ONE request for the selection, all or nothing (plan G14). On a 404
 *   the bin is read again and the page says nothing was purged.
 *
 * Selection is the page's state; the shared row directive reports Space, as
 * its own header says the caller owns the selection a bulk bar reads.
 */
@Component({
  selector: 'app-recycle-bin',
  standalone: true,
  imports: [
    PageHeaderComponent,
    TranslatePipe,
    FormsModule,
    NgTemplateOutlet,
    RouterLink,
    ButtonModule,
    DataListComponent,
    ListRowDirective,
    SortHeaderComponent,
    OverlaySelectComponent,
    AmCountPipe,
    RecycleBinRestoreDialogComponent,
    RecycleBinPurgeDialogComponent,
  ],
  template: `
    <!-- A wide screen holds the page to <main>'s height, so the list scrolls
         inside its card. A phone does not: the filters, the outcome and the
         bulk bar stack above the list there and would leave its rows no room,
         so the page grows and <main> scrolls it. -->
    <div class="flex flex-col gap-4" [class.h-full]="!phone()">
      <app-page-header [title]="'recycleBin.title' | translate" [purpose]="purpose()" />

      @if (outcome(); as o) {
        <div
          class="am-bin__outcome"
          [class.am-bin__outcome--error]="o.kind === 'restoreMixed' || o.kind === 'purgeGone'"
          [attr.role]="o.kind === 'restoreMixed' || o.kind === 'purgeGone' ? 'alert' : 'status'"
          data-testid="bin-outcome"
        >
          <div class="min-w-0 flex-1">
            @switch (o.kind) {
              @case ('restored') {
                <p class="m-0">{{ o.count | amCount: 'recycleBin.restored' }}</p>
              }
              @case ('purged') {
                <p class="m-0">{{ o.count | amCount: 'recycleBin.purged' }}</p>
              }
              @case ('purgeGone') {
                <p class="m-0">{{ 'recycleBin.outcome.purgeGone' | translate }}</p>
              }
              @case ('restoreMixed') {
                <p class="m-0 font-semibold">{{ (o.lines.length - o.restored) | amCount: 'recycleBin.restoreMixed' : { restored: restoredCount(o.restored) } }}</p>
                <ul class="m-0 mt-1 ps-4">
                  @for (line of o.lines; track $index) {
                    <li data-testid="bin-outcome-line">{{ line }}</li>
                  }
                </ul>
              }
            }
          </div>
          <p-button size="small" [text]="true" [label]="'recycleBin.outcome.dismiss' | translate" (onClick)="outcome.set(null)" data-testid="bin-outcome-dismiss" />
        </div>
      }

      @if (phone()) {
        <div class="grid grid-cols-1 gap-2" data-testid="bin-filters-phone">
          <ng-container [ngTemplateOutlet]="filtersTpl" />
        </div>
      }

      <div class="am-bin__card">
        @if (selected().length > 0) {
          <div class="am-bin__bulk" data-testid="bin-bulk">
            <span class="am-bin__bulk-count">{{ selected().length | amCount: 'recycleBin.selected' : { size: size(selectedBytes()) } }}</span>
            @if (selectedRestorable().length > 0) {
              <p-button size="small" severity="secondary" [outlined]="true" [label]="'recycleBin.bulk.restore' | translate" (onClick)="openRestore(selected())" data-testid="bulk-restore" />
            }
            <p-button size="small" severity="danger" [outlined]="true" [label]="'recycleBin.bulk.purge' | translate" (onClick)="openPurge(selected())" data-testid="bulk-purge" />
            <p-button size="small" [text]="true" [label]="'recycleBin.bulk.clear' | translate" (onClick)="clearSelection()" data-testid="bulk-clear" />
          </div>
        }
        <app-data-list
          #list
          variant="page"
          [source]="source"
          [trackBy]="trackById"
          [columns]="columns()"
          [filterNames]="filterNames"
          [initialSort]="{ sortBy: 'daysLeft', sortDir: 'asc' }"
          [pageSize]="10"
          [searchPlaceholder]="'recycleBin.searchPlaceholder' | translate"
          [emptyTitle]="'recycleBin.empty' | translate"
          [emptyMessage]="'recycleBin.emptyBody' | translate: { period: period() }"
          [noResultsTitle]="'recycleBin.noResults' | translate"
          [noResultsMessage]="noResultsMessage()"
          [gridSuffix]="phone() ? '' : 'calc(var(--am-space-40) * 4.75)'"
          persistKey="recycleBin"
        >
          @if (!phone()) {
            <div listFilters class="flex items-center gap-1.5 shrink-0">
              <ng-container [ngTemplateOutlet]="filtersTpl" />
            </div>
          }

          <ng-template #listHeader let-h>
            @for (column of columns(); track column.key) {
              @if (h.visible(column.key)) {
                @if (column.key === 'file') {
                  <span class="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      class="am-bin__box"
                      [checked]="pageAllSelected()"
                      [indeterminate]="pageSomeSelected()"
                      [attr.aria-label]="'recycleBin.selectPage' | translate"
                      (change)="togglePage()"
                      data-testid="bin-select-page"
                    />
                    <am-sort-header
                      class="min-w-0"
                      [key]="column.key"
                      [label]="column.label"
                      [current]="h.sortBy === column.sortBy ? { key: column.key, dir: h.sortDir ?? 'asc' } : null"
                      (sort)="h.sort($event)"
                    />
                  </span>
                } @else if (column.sortBy) {
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
            @if (!phone()) {
              <span></span>
            }
          </ng-template>

          <ng-template #listRow let-item let-i="index" let-v="visible">
            <div
              amListRow
              [amListRowKey]="item.id"
              [amListRowIndex]="i"
              [amListRowSelected]="isSelected(item)"
              (rowToggleSelect)="toggle(item)"
              class="grid items-start gap-3 px-3 py-2"
              style="grid-template-columns: var(--am-list-cols)"
              [attr.data-file]="item.id"
              [attr.data-gone]="gone(item) ? 'true' : null"
            >
              @if (v('file')) {
                <span class="flex min-w-0 items-start gap-2" data-cell="file">
                  <input
                    type="checkbox"
                    class="am-bin__box mt-0.5"
                    [checked]="isSelected(item)"
                    [attr.aria-label]="'recycleBin.selectRow' | translate: { name: item.name }"
                    (change)="toggle(item)"
                    data-testid="bin-select"
                  />
                  <span class="flex min-w-0 flex-col">
                    <span class="am-bin__name" [title]="item.name" data-testid="bin-name">{{ item.name }}</span>
                    <span class="am-bin__meta" data-testid="bin-meta">{{ meta(item) }}</span>
                    @if (phone()) {
                      <span class="am-bin__meta">{{ fromType(item) }} · {{ recordText(item) }}</span>
                      <span class="am-bin__actions am-bin__actions--phone" data-cell="actions">
                        <ng-container [ngTemplateOutlet]="actionsTpl" [ngTemplateOutletContext]="{ $implicit: item }" />
                      </span>
                    }
                  </span>
                </span>
              }
              @if (!phone() && v('from')) {
                <span class="flex min-w-0 flex-col" data-cell="from">
                  <span class="am-bin__meta">{{ fromType(item) }}</span>
                  @if (recordLink(item); as link) {
                    <a class="am-bin__link" [routerLink]="link" [title]="recordText(item)" data-testid="bin-record-link">{{ recordText(item) }}</a>
                  } @else {
                    <span class="am-bin__record" [class.am-bin__record--gone]="gone(item)" data-testid="bin-record">{{ recordText(item) }}</span>
                  }
                </span>
              }
              @if (!phone() && v('deletedBy')) {
                <span class="am-bin__cell" data-cell="deletedBy">{{ item.deletedBy?.name ?? ('recycleBin.deletedByUnknown' | translate) }}</span>
              }
              @if (!phone() && v('deleted')) {
                <span class="am-bin__cell am-num" data-cell="deleted">{{ date(item.deletedAt) }}</span>
              }
              @if (v('daysLeft')) {
                <span class="am-bin__cell am-num" [class.am-bin__days--warn]="warn(item)" data-cell="daysLeft" data-testid="bin-days">{{ item.daysLeft | amCount: 'recycleBin.daysLeft' }}</span>
              }
              @if (!phone()) {
                <span class="am-bin__actions" data-cell="actions">
                  <ng-container [ngTemplateOutlet]="actionsTpl" [ngTemplateOutletContext]="{ $implicit: item }" />
                </span>
              }
              @if (gone(item)) {
                <p class="am-bin__gone" data-testid="bin-gone">{{ 'recycleBin.recordGone' | translate }}</p>
              }
            </div>
          </ng-template>
        </app-data-list>
      </div>
    </div>

    <!-- Restore (unless the record is gone) and Purge…: a row's two actions,
         in their own track on a wide screen and under the file on a phone. -->
    <ng-template #actionsTpl let-item>
      @if (!gone(item)) {
        <p-button
          size="small"
          [text]="true"
          [label]="'recycleBin.restore' | translate"
          [ariaLabel]="'recycleBin.restoreAria' | translate: { name: item.name }"
          (onClick)="openRestore([item])"
          data-testid="bin-restore"
        />
      }
      <p-button
        size="small"
        [text]="true"
        severity="danger"
        [label]="'recycleBin.purge' | translate"
        [ariaLabel]="'recycleBin.purgeAria' | translate: { name: item.name }"
        (onClick)="openPurge([item])"
        data-testid="bin-purge"
      />
    </ng-template>

    <ng-template #filtersTpl>
      <app-overlay-select
        [class]="phone() ? 'min-w-0' : 'w-[150px]'"
        data-filter="recordType"
        [options]="recordTypeOptions()"
        optionLabel="label"
        optionValue="value"
        [showClear]="true"
        [ariaLabel]="'recycleBin.filter.recordType' | translate"
        [placeholder]="'recycleBin.filter.allRecordTypes' | translate"
        [ngModel]="list.filterValue('recordType')"
        (ngModelChange)="list.setFilter('recordType', $event)"
      />
      <app-overlay-select
        [class]="phone() ? 'min-w-0' : 'w-[170px]'"
        data-filter="deletedBy"
        [options]="deletedByOptions()"
        optionLabel="label"
        optionValue="value"
        [showClear]="true"
        [ariaLabel]="'recycleBin.filter.deletedBy' | translate"
        [placeholder]="'recycleBin.filter.anyone' | translate"
        [ngModel]="list.filterValue('deletedBy')"
        (ngModelChange)="list.setFilter('deletedBy', $event)"
      />
      <app-overlay-select
        [class]="phone() ? 'min-w-0' : 'w-[180px]'"
        data-filter="deleted"
        [options]="deletedOptions()"
        optionLabel="label"
        optionValue="value"
        [showClear]="true"
        [ariaLabel]="'recycleBin.filter.deleted' | translate"
        [placeholder]="'recycleBin.filter.anyTime' | translate"
        [ngModel]="list.filterValue('deleted')"
        (ngModelChange)="list.setFilter('deleted', $event)"
      />
    </ng-template>

    <am-recycle-bin-restore-dialog
      [visible]="restoreOpen()"
      (visibleChange)="restoreOpen.set($event)"
      [restoring]="restoreTargets()"
      [skipped]="restoreSkipped()"
      [record]="restoreRecord()"
      [busy]="busy()"
      (confirm)="confirmRestore()"
    />
    <am-recycle-bin-purge-dialog
      [visible]="purgeOpen()"
      (visibleChange)="purgeOpen.set($event)"
      [files]="purgeTargets()"
      [busy]="busy()"
      [error]="purgeError()"
      (confirm)="confirmPurge()"
    />
  `,
  styles: [
    `
      .am-bin__card{display:flex;flex-direction:column;min-height:0;border:1px solid var(--am-border);border-radius:var(--am-radius-card);background:var(--am-surface-raised);overflow:hidden}
      .am-bin__bulk{display:flex;flex-wrap:wrap;align-items:center;gap:var(--am-space-8) var(--am-space-12);padding:var(--am-space-8) var(--am-space-12);background:var(--am-info-bg);border-block-end:1px solid var(--am-info-border)}
      .am-bin__bulk-count{font-size:var(--am-type-body-size);font-weight:600;color:var(--am-info-ink)}
      .am-bin__box{flex:none;inline-size:var(--am-space-16);block-size:var(--am-space-16);accent-color:var(--am-primary-600);cursor:pointer}
      .am-bin__name{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--am-type-body-size);font-weight:500;color:var(--am-ink-900);unicode-bidi:plaintext}
      .am-bin__meta{display:block;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-500)}
      .am-bin__link,.am-bin__record{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--am-type-value-size);font-weight:500}
      .am-bin__record{color:var(--am-ink-700)}
      .am-bin__record--gone{color:var(--am-ink-500);text-decoration:line-through}
      .am-bin__cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--am-type-value-size);color:var(--am-ink-700)}
      .am-bin__days--warn{color:var(--am-warning-ink);font-weight:600}
      .am-bin__actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--am-space-4);min-width:0}
      .am-bin__actions--phone{justify-content:flex-start;margin-inline-start:calc(var(--am-space-8) * -1)}
      .am-bin__gone{grid-column:1 / -1;margin:0;padding-inline-start:var(--am-space-24);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-700)}
      .am-bin__outcome{display:flex;align-items:flex-start;gap:var(--am-space-12);padding:var(--am-space-8) var(--am-space-12);border-radius:var(--am-radius-card);border:1px solid var(--am-success-border);background:var(--am-success-bg);color:var(--am-success-ink);font-size:var(--am-type-body-size)}
      .am-bin__outcome--error{border-color:var(--am-danger-border);background:var(--am-danger-bg);color:var(--am-danger-ink)}
    `,
  ],
})
export class RecycleBinComponent {
  private readonly bin = inject(RecycleBinService);
  private readonly files = inject(FilesService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly document = inject(DOCUMENT);

  readonly list = viewChild.required<DataListComponent<IRecycleBinItem>>('list');
  /** "30 days", through the formatting layer: a time quantity is never a bare count. */
  readonly period = computed(() => {
    this.translate.currentLang();
    return this.format.duration(RECYCLE_BIN_DAYS * 24 * 60 * 60 * 1000);
  });
  readonly filterNames = ['recordType', 'deletedBy', 'deleted'] as const;
  readonly trackById = (item: IRecycleBinItem): string => item.id;
  /** The time the Deleted filter measures from. A seam the specs fix. */
  now: () => Date = () => new Date();

  /** The whole bin once read; null until then (and after a write, to read again). */
  readonly items = signal<IRecycleBinItem[] | null>(null);
  private inFlight: Observable<IRecycleBinItem[]> | null = null;
  /** Files a restore was refused for FILE_RECORD_GONE during this visit. */
  readonly goneIds = signal<ReadonlySet<string>>(new Set());
  private readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  readonly restoreOpen = signal(false);
  readonly purgeOpen = signal(false);
  private readonly restoreFor = signal<readonly IRecycleBinItem[]>([]);
  readonly purgeTargets = signal<readonly IRecycleBinItem[]>([]);
  readonly busy = signal(false);
  readonly purgeError = signal<string | null>(null);
  readonly outcome = signal<BinOutcome | null>(null);

  /** ACC-232's phone width: the row folds into the file cell. */
  readonly phone = signal(false);

  constructor() {
    const media = this.document.defaultView?.matchMedia?.(`(max-width: ${SHELL_PHONE_BELOW_PX - 0.02}px)`);
    if (media) {
      this.phone.set(media.matches);
      const onChange = (e: MediaQueryListEvent): void => this.phone.set(e.matches);
      media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
    }
  }

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    const t = (key: string): string => this.translate.instant(`recycleBin.col.${key}`);
    const file: DataListColumn = { key: 'file', label: t('file'), sortBy: 'name', alwaysVisible: true, width: 'minmax(0, 1.4fr)' };
    // A phone keeps two sortable headers: the file, and how soon it goes.
    if (this.phone()) {
      return [
        { ...file, width: 'minmax(0, 1fr)' },
        { key: 'daysLeft', label: t('daysLeft'), sortBy: 'daysLeft', alwaysVisible: true, width: 'calc(var(--am-space-40) * 1.75)' },
      ];
    }
    return [
      file,
      { key: 'from', label: t('from'), sortBy: 'from', width: 'minmax(0, 1.4fr)' },
      { key: 'deletedBy', label: t('deletedBy'), sortBy: 'deletedBy', width: 'minmax(0, 1fr)' },
      { key: 'deleted', label: t('deleted'), sortBy: 'deletedAt', width: 'calc(var(--am-space-40) * 3)' },
      { key: 'daysLeft', label: t('daysLeft'), sortBy: 'daysLeft', width: 'calc(var(--am-space-40) * 2.5)' },
    ];
  });

  // ── the list ──────────────────────────────────────────────────────────────

  /**
   * Read once, then answer every search, sort, filter and page from memory. The
   * three filters narrow the rows before clientSideSource, which reads none.
   */
  readonly source: DataListSource<IRecycleBinItem> = (query) => {
    const cached = this.items();
    const items$ = cached
      ? of(cached)
      : (this.inFlight ??= this.bin.list().pipe(
          tap((rows) => this.items.set(rows)),
          finalize(() => (this.inFlight = null)),
          shareReplay({ bufferSize: 1, refCount: false }),
        ));
    return items$.pipe(
      switchMap((rows) => {
        const f = query.filters ?? {};
        const now = this.now();
        const narrowed = rows.filter((item) =>
          matchesFilters(item, { recordType: f['recordType'] ?? null, deletedBy: f['deletedBy'] ?? null, deleted: f['deleted'] ?? null }, now),
        );
        return clientSideSource(() => narrowed, {
          searchFields: (item) => [item.name],
          comparators: comparators(this.language.isArabic() ? 'ar' : 'en', (item) => `${this.fromType(item)} ${this.recordText(item)}`),
          defaultSort: { column: 'daysLeft', dir: 'asc' },
          nullsLast: { deletedBy: (item) => item.deletedBy?.name },
        })(query);
      }),
    );
  };

  readonly binTotals = computed(() => totals(this.items() ?? []));

  /** "18 files · 212 MB. Deleted files stay here for 30 days…", or the sentence alone. */
  readonly purpose = computed(() => {
    this.translate.currentLang();
    const sentence = this.translate.instant('recycleBin.purpose', { period: this.period() });
    const { count, bytes } = this.binTotals();
    if (!this.items() || count === 0) return sentence;
    return `${this.format.count('recycleBin.summary', count, { size: this.size(bytes) })} ${sentence}`;
  });

  readonly noResultsMessage = computed(() => this.format.count('recycleBin.noResultsBody', this.binTotals().count));

  readonly recordTypeOptions = computed(() => {
    this.translate.currentLang();
    return recordTypes(this.items() ?? []).map((type) => ({ value: type, label: this.typeLabel(type) }));
  });
  readonly deletedByOptions = computed(() => {
    this.translate.currentLang();
    const items = this.items() ?? [];
    const options = deleters(items).map((d) => ({ value: d.id, label: d.name }));
    if (items.some((i) => !i.deletedBy)) options.push({ value: DELETED_BY_NOBODY, label: this.translate.instant('recycleBin.deletedByUnknown') });
    return options;
  });
  readonly deletedOptions = computed(() => {
    this.translate.currentLang();
    return DELETED_BANDS.map((band) => ({ value: band, label: this.translate.instant(`recycleBin.filter.${band}`) }));
  });

  // ── what a row says ───────────────────────────────────────────────────────

  size(bytes: number): string {
    return this.files.size(bytes);
  }

  date(at: string): string {
    return this.format.date(at);
  }

  meta(item: IRecycleBinItem): string {
    return this.translate.instant('recycleBin.meta', {
      kind: this.translate.instant(`recycleBin.kind.${fileKind(item)}`),
      size: this.size(item.sizeBytes),
    });
  }

  private typeLabel(type: string): string {
    return this.translate.instant(type === 'TASK' ? 'recycleBin.recordType.TASK' : 'recycleBin.recordType.other');
  }

  fromType(item: IRecycleBinItem): string {
    return this.typeLabel(item.record.type);
  }

  /** The record's name, or "A task that no longer exists" when there is none. */
  recordText(item: IRecycleBinItem): string {
    if (item.record.name) return item.record.name;
    return this.translate.instant(item.record.type === 'TASK' ? 'recycleBin.recordGoneName.TASK' : 'recycleBin.recordGoneName.other');
  }

  /** A link to the record when it has a page and is still there: a task's. */
  recordLink(item: IRecycleBinItem): string[] | null {
    return item.record.type === 'TASK' && item.record.name && !this.gone(item) ? ['/tasks', item.record.id] : null;
  }

  gone(item: IRecycleBinItem): boolean {
    return isRecordGone(item, this.goneIds());
  }

  warn(item: IRecycleBinItem): boolean {
    return item.daysLeft <= DAYS_LEFT_WARN;
  }

  restoredCount(n: number): string {
    return this.format.number(n);
  }

  // ── selection ─────────────────────────────────────────────────────────────

  /** The selected files still in the bin, in list order. */
  readonly selected = computed(() => (this.items() ?? []).filter((i) => this.selectedIds().has(i.id)));
  readonly selectedBytes = computed(() => totals(this.selected()).bytes);
  readonly selectedRestorable = computed(() => this.selected().filter((i) => !this.gone(i)));

  isSelected(item: IRecycleBinItem): boolean {
    return this.selectedIds().has(item.id);
  }

  toggle(item: IRecycleBinItem): void {
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  private readonly pageRows = computed(() => this.list().rows());
  readonly pageAllSelected = computed(() => {
    const rows = this.pageRows();
    return rows.length > 0 && rows.every((r) => this.selectedIds().has(r.id));
  });
  readonly pageSomeSelected = computed(() => !this.pageAllSelected() && this.pageRows().some((r) => this.selectedIds().has(r.id)));

  /** The header box: every file on this page, or none of them. */
  togglePage(): void {
    const rows = this.pageRows();
    const all = this.pageAllSelected();
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      for (const r of rows) {
        if (all) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  // ── restore ───────────────────────────────────────────────────────────────

  /** The files the Restore dialog will try: every chosen one not known to be gone. */
  readonly restoreTargets = computed(() => this.restoreFor().filter((i) => !this.gone(i)));
  readonly restoreSkipped = computed(() => this.restoreFor().filter((i) => this.gone(i)));
  readonly restoreRecord = computed(() => {
    const one = this.restoreTargets()[0];
    return one ? this.recordText(one) : '';
  });

  openRestore(files: readonly IRecycleBinItem[]): void {
    if (!files.some((f) => !this.gone(f))) return;
    this.restoreFor.set(files);
    this.outcome.set(null);
    this.restoreOpen.set(true);
  }

  /** One request per file, in order; each outcome reported. */
  async confirmRestore(): Promise<void> {
    if (this.busy()) return;
    const files = this.restoreTargets();
    this.busy.set(true);
    let latest: IRecycleBinItem[] | null = null;
    let readAgain = false;
    const restoredIds = new Set<string>();
    const lines: string[] = [];
    for (const file of files) {
      try {
        latest = await firstValueFrom(this.bin.restore(file.id));
        restoredIds.add(file.id);
        lines.push(this.translate.instant('recycleBin.outcome.restoredLine', { name: file.name }));
      } catch (err) {
        const code = (err as HttpErrorResponse)?.error?.code;
        if (code === 'FILE_RECORD_GONE') this.goneIds.update((ids) => new Set([...ids, file.id]));
        if ((err as HttpErrorResponse)?.status === 404) readAgain = true;
        lines.push(this.translate.instant('recycleBin.outcome.refusedLine', { name: file.name, reason: this.restoreReason(err) }));
      }
    }
    this.busy.set(false);
    this.restoreOpen.set(false);
    // The restored files leave the selection; the ones that failed stay chosen.
    this.selectedIds.update((ids) => new Set([...ids].filter((id) => !restoredIds.has(id))));
    const restored = restoredIds.size;
    this.outcome.set(restored === files.length ? { kind: 'restored', count: restored } : { kind: 'restoreMixed', restored, lines });
    if (readAgain) this.readAgain();
    else if (latest) this.show(latest);
  }

  private restoreReason(err: unknown): string {
    if ((err as HttpErrorResponse)?.status === 404) return this.translate.instant('recycleBin.outcome.notInBin');
    return this.files.refusal(err) ?? this.translate.instant('recycleBin.outcome.restoreFailed');
  }

  // ── purge ─────────────────────────────────────────────────────────────────

  openPurge(files: readonly IRecycleBinItem[]): void {
    this.purgeTargets.set(files);
    this.purgeError.set(null);
    this.outcome.set(null);
    this.purgeOpen.set(true);
  }

  /** One request, all or nothing (plan G14). */
  confirmPurge(): void {
    if (this.busy()) return;
    const ids = this.purgeTargets().map((f) => f.id);
    // 1 to 100 per request (the API's DTO); the dialog says so and sends nothing.
    if (ids.length === 0 || ids.length > PURGE_MAX_FILES) return;
    this.busy.set(true);
    this.purgeError.set(null);
    this.bin.purge(ids).subscribe({
      next: ({ purged }) => {
        this.busy.set(false);
        this.purgeOpen.set(false);
        this.selectedIds.update((sel) => new Set([...sel].filter((id) => !ids.includes(id))));
        this.outcome.set({ kind: 'purged', count: purged });
        this.readAgain();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if ((err as HttpErrorResponse)?.status === 404) {
          this.purgeOpen.set(false);
          this.outcome.set({ kind: 'purgeGone' });
          this.readAgain();
          return;
        }
        this.purgeError.set(this.files.refusal(err) ?? this.translate.instant('recycleBin.purgeDialog.failed'));
      },
    });
  }

  // ── after a write ─────────────────────────────────────────────────────────

  /** Show the list a restore answered with. */
  private show(rows: IRecycleBinItem[]): void {
    this.items.set(rows);
    this.list().reload();
  }

  /** GET the bin again (purge answers with a count, not the list). */
  private readAgain(): void {
    this.items.set(null);
    this.list().reload();
  }
}
