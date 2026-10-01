import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { LookupService, LookupCategoryDto } from '../../services/lookup.service';
import { LanguageService } from '../../../../core/services/language.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  DataListColumn,
  DataListComponent,
} from '../../../../shared/components/data-list/data-list.component';
import {
  DataListSource,
  clientSideSource,
} from '../../../../shared/components/data-list/data-list.source';
import { ListRowDirective } from '../../../../shared/components/data-list/list-row.directive';

/**
 * Lookup categories — ACC-120 slice 6, Template 1.
 *
 * ## THIS SCREEN HAS NO CREATE ACTION, and that is correct
 *
 * The slice brief said all three screens have "a page header and a gated
 * create". This one does not and should not: a `LookupCategory` is a SYSTEM row
 * with `organizationId: null`, and ACC-17 moved its mutation behind
 * `PlatformGuard` precisely so one tenant cannot alter a catalogue every tenant
 * reads. A tenant customises the VALUES inside a category, which is the next
 * screen. There is nothing to gate here because there is nothing to offer.
 *
 * ## The row is a DESTINATION
 *
 * Opening a category navigates to its values, so the row carries
 * `amListRow` for Enter and double-click, and `hasDestination` tells the list
 * that is what a row does. The old implementation used `pSelectableRow` with
 * `(onRowSelect)`, which `ListRowDirective`'s own header warns against: both
 * bind the same keys on the same element and the collision shows up only via
 * the keyboard.
 */
@Component({
  selector: 'app-lookup-category-list',
  standalone: true,
  imports: [
    PageHeaderComponent,
    TranslatePipe,
    TagModule,
    TooltipModule,
    DataListComponent,
    ListRowDirective,
  ],
  template: `
    <div class="flex h-full flex-col gap-4">
      <app-page-header
        [title]="'lookup.title' | translate"
        [purpose]="'lookup.purpose' | translate"
      />

      @if (error()) {
        <p class="text-red-500">{{ error() }}</p>
      }

      <app-data-list
        #list
        variant="page"
        [source]="source"
        [trackBy]="trackByKey"
        [columns]="columns()"
        [hasDestination]="true"
        [searchPlaceholder]="'lookup.searchPlaceholder' | translate"
        [emptyTitle]="'lookup.noCategories' | translate"
        [emptyMessage]="'lookup.noCategoriesReason' | translate"
        persistKey="lookupCategories"
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
                      class="pi text-[10px]"
                      [class.pi-arrow-up]="h.sortDir === 'asc'"
                      [class.pi-arrow-down]="h.sortDir === 'desc'"
                    ></i>
                  }
                </button>
              } @else {
                <span class="uppercase">{{ column.label }}</span>
              }
            }
          }
          <span></span>
        </ng-template>

        <ng-template #listRow let-category let-visible="visible">
          <div
            amListRow
            [amListRowKey]="category.key"
            (rowOpen)="open(category)"
            (click)="open(category)"
            class="grid cursor-pointer items-center gap-3 border-b border-[var(--am-border)] px-3 py-2"
            style="grid-template-columns: var(--am-list-cols)"
          >
            @if (visible('label')) {
              <span class="truncate text-[13px] font-medium">{{ displayLabel(category) }}</span>
            }
            @if (visible('key')) {
              <span class="truncate font-mono text-[12px]" dir="ltr">{{ category.key }}</span>
            }
            @if (visible('isSystem')) {
              <span>
                <p-tag
                  [value]="
                    (category.isSystem ? 'lookup.typeSystem' : 'lookup.typeTenant') | translate
                  "
                  [severity]="category.isSystem ? 'info' : 'secondary'"
                />
              </span>
            }
            @if (visible('isExtensible')) {
              <span>
                <p-tag
                  [value]="
                    (category.isExtensible ? 'lookup.extensibleYes' : 'lookup.extensibleNo')
                      | translate
                  "
                  [severity]="category.isExtensible ? 'success' : 'secondary'"
                  [pTooltip]="
                    category.isExtensible ? '' : ('lookup.extensibleNoTooltip' | translate)
                  "
                />
              </span>
            }
            @if (visible('isActive')) {
              <span>
                <p-tag
                  [value]="(category.isActive ? 'common.active' : 'common.inactive') | translate"
                  [severity]="category.isActive ? 'success' : 'secondary'"
                />
              </span>
            }
            <i
              aria-hidden="true"
              class="pi pi-chevron-right justify-self-end text-[var(--am-text-secondary)] rtl:rotate-180"
            ></i>
          </div>
        </ng-template>
      </app-data-list>
    </div>
  `,
})
export class LookupCategoryListComponent implements OnInit {
  private readonly lookupService = inject(LookupService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);

  readonly list = viewChild.required<DataListComponent<LookupCategoryDto>>('list');

  readonly categories = signal<readonly LookupCategoryDto[]>([]);
  readonly error = signal<string | null>(null);

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    return [
      {
        key: 'label',
        label: this.translate.instant('lookup.columnLabel'),
        sortBy: 'label',
        alwaysVisible: true,
        width: 'minmax(200px, 1.6fr)',
      },
      {
        key: 'key',
        label: this.translate.instant('lookup.columnKey'),
        sortBy: 'key',
        width: 'minmax(160px, 1.2fr)',
      },
      {
        key: 'isSystem',
        label: this.translate.instant('lookup.columnSystem'),
        width: '120px',
      },
      {
        key: 'isExtensible',
        label: this.translate.instant('lookup.columnExtensible'),
        width: '130px',
      },
      {
        key: 'isActive',
        label: this.translate.instant('lookup.columnStatus'),
        sortBy: 'isActive',
        width: '110px',
      },
    ];
  });

  readonly trackByKey = (category: LookupCategoryDto): string => category.key;

  readonly source: DataListSource<LookupCategoryDto> = clientSideSource(
    () => this.categories(),
    {
      // The KEY is searched as well as both labels: it is on screen in its own
      // column, and an admin who knows a category by its key
      // ('incident_severity') would otherwise find nothing by typing it.
      searchFields: (c) => [c.labelEn, c.labelAr, c.key],
      comparators: {
        // Sorts by what the reader SEES, so the order matches the column in
        // Arabic as well as English.
        label: (a, b) => this.displayLabel(a).localeCompare(this.displayLabel(b)),
        key: (a, b) => a.key.localeCompare(b.key),
        isActive: (a, b) => Number(a.isActive) - Number(b.isActive),
      },
    },
  );

  ngOnInit(): void {
    this.loadCategories();
  }

  displayLabel(category: LookupCategoryDto): string {
    return this.languageService.isArabic() ? category.labelAr || category.labelEn : category.labelEn;
  }

  open(category: LookupCategoryDto): void {
    void this.router.navigate([category.key, 'values'], { relativeTo: this.route });
  }

  private loadCategories(): void {
    this.error.set(null);
    this.lookupService.getCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        this.list().reload();
      },
      error: () => this.error.set(this.translate.instant('lookup.errorLoad')),
    });
  }
}
