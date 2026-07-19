import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { LookupService, LookupCategoryDto } from '../../services/lookup.service';

@Component({
  selector: 'app-lookup-category-list',
  standalone: true,
  imports: [TranslatePipe, TableModule, TagModule, TooltipModule],
  template: `
    <div class="flex flex-col h-full gap-4">
      <div class="flex justify-between items-center">
        <h2 class="text-xl font-semibold">{{ 'lookup.title' | translate }}</h2>
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() }}</p>
      }

      <p-table
        [value]="categories()"
        [loading]="loading()"
        scrollable
        scrollHeight="flex"
        styleClass="w-full"
        selectionMode="single"
        (onRowSelect)="onRowSelect($event)"
      >
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 35%">{{ 'lookup.columnLabel' | translate }}</th>
            <th style="width: 25%">{{ 'lookup.columnKey' | translate }}</th>
            <th style="width: 15%">{{ 'lookup.columnSystem' | translate }}</th>
            <th style="width: 15%">{{ 'lookup.columnExtensible' | translate }}</th>
            <th style="width: 10%">{{ 'lookup.columnStatus' | translate }}</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-row>
          <tr [pSelectableRow]="row" class="cursor-pointer">
            <td>{{ displayLabel(row) }}</td>
            <td>
              <span class="font-mono text-sm">{{ row.key }}</span>
            </td>
            <td>
              <p-tag
                [value]="(row.isSystem ? 'lookup.typeSystem' : 'lookup.typeTenant') | translate"
                [severity]="row.isSystem ? 'info' : 'secondary'"
              />
            </td>
            <td>
              <p-tag
                [value]="(row.isExtensible ? 'lookup.extensibleYes' : 'lookup.extensibleNo') | translate"
                [severity]="row.isExtensible ? 'success' : 'secondary'"
                [pTooltip]="row.isExtensible ? '' : ('lookup.extensibleNoTooltip' | translate)"
              />
            </td>
            <td>
              <p-tag
                [value]="(row.isActive ? 'common.active' : 'common.inactive') | translate"
                [severity]="row.isActive ? 'success' : 'secondary'"
              />
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5" class="text-center py-8 text-surface-400">
              {{ 'lookup.noCategories' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
})
export class LookupCategoryListComponent implements OnInit {
  private readonly lookupService = inject(LookupService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly categories = signal<LookupCategoryDto[]>([]);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadCategories();
  }

  displayLabel(cat: LookupCategoryDto): string {
    // TODO: wire to TranslateService.currentLang to respect
    // user language preference (currently always prefers Arabic
    // when available)
    return cat.labelAr || cat.labelEn;
  }

  onRowSelect(event: { data: LookupCategoryDto }): void {
    void this.router.navigate([event.data.key, 'values'], { relativeTo: this.route });
  }

  private loadCategories(): void {
    this.loading.set(true);
    this.error.set(null);
    this.lookupService.getCategories().subscribe({
      next: (cats) => {
        this.categories.set(cats);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('lookup.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
