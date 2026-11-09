import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { of, switchMap, tap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageModule } from 'primeng/message';
import { PlanService, IAiCreditPack } from '../../services/plan.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
// ACC-39 — EditDialogComponent replaces this raw p-dialog + manual @if.
// Unlike every other item in this ticket, this screen is genuinely
// create-only: only openAdd() exists, no edit affordance in the table row
// template at all. This migration has nothing to verify pre-fill-wise —
// there was never a second-open-shows-stale-data risk to begin with. Pure
// architectural consistency with SYSTEM-REFERENCE.md Section 10.5's
// required pattern, not a bug-adjacent fix like the others in this ticket.
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../shared/components/field/field.component';
import { InputNumberLatinDigits } from '../../../core/formatting/latin-digits';
import { AmNumberPipe } from '../../../core/formatting';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { LanguageService } from '../../../core/services/language.service';
import { DataListColumn, DataListComponent } from '../../../shared/components/data-list/data-list.component';
import { DataListSource, clientSideSource } from '../../../shared/components/data-list/data-list.source';
import { SortHeaderComponent } from '../../../shared/components/sort-header/sort-header.component';

/** A stored decimal price as a number for the formatting layer; null when it is not one. */
function priceOf(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Platform → AI credit packs — ACC-120, on the shared list (`app-data-list`).
 *
 * `GET /platform/ai-credit-packs` returns every pack as one array, so the list
 * reads it once and searches, sorts and pages it in memory
 * (`clientSideSource()`). Opens sorted by credits, fewest first. Packs have no
 * row action: there is no edit endpoint.
 *
 * The Add dialog follows the dialog rules: Save is never disabled (a press on
 * an invalid form reveals every error and sends nothing), every field is an
 * `am-field` with its control, and the actions are the dialog's footer.
 */
@Component({
  selector: 'app-ai-credit-pack-list',
  standalone: true,
  imports: [
    PageHeaderComponent,
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    InputNumberLatinDigits,
    MessageModule,
    EditDialogComponent,
    FieldComponent,
    AmNumberPipe,
    DataListComponent,
    SortHeaderComponent,
  ],
  template: `
    <div class="flex h-full flex-col gap-4">
      <app-page-header [title]="'platform.aiCreditPacks' | translate">
        <div pageActions>
          @if (canCreate()) {
            <p-button icon="pi pi-plus" [label]="'platform.addAiCreditPack' | translate" (onClick)="openAdd()" />
          }
        </div>
      </app-page-header>

      <app-data-list
        #list
        variant="page"
        [source]="source"
        [trackBy]="trackById"
        [columns]="columns()"
        [initialSort]="{ sortBy: 'credits', sortDir: 'asc' }"
        [searchPlaceholder]="'platform.searchAiCreditPacks' | translate"
        [emptyTitle]="'platform.noAiCreditPacks' | translate"
        [errorMessage]="'platform.errorLoad' | translate"
        gridSuffix=""
        persistKey="platformAiCreditPacks"
      >
        <ng-template #listHeader let-h>
          @for (column of columns(); track column.key) {
            @if (h.visible(column.key)) {
              @if (column.sortBy) {
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
        </ng-template>

        <ng-template #listRow let-pack let-v="visible">
          <div
            class="grid items-center gap-3 border-b border-[var(--am-border)] px-3 py-2 text-[length:var(--am-type-value-size)]"
            style="grid-template-columns: var(--am-list-cols)"
            [attr.data-pack-row]="pack.id"
          >
            @if (v('name')) {
              <span class="min-w-0 truncate font-medium" [attr.title]="nameOf(pack)" data-testid="pack-name">{{ nameOf(pack) }}</span>
            }
            @if (v('credits')) {
              <span class="min-w-0 truncate tabular-nums" data-testid="pack-credits">{{ pack.credits | amNumber }}</span>
            }
            @if (v('price')) {
              <span class="min-w-0 truncate tabular-nums" data-testid="pack-price">{{ priceOf(pack.price) | amNumber }}</span>
            }
          </div>
        </ng-template>
      </app-data-list>

      <ng-template #formTpl>
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col" data-testid="pack-form">
          @if (actionError()) {
            <p-message severity="error" [text]="actionError()! | translate" styleClass="mb-3" data-testid="pack-save-error" />
          }
          <am-field [label]="'platform.packName' | translate" [control]="form.controls.name" [forceShowErrors]="showErrors()">
            <input pInputText id="name" formControlName="name" class="w-full" />
          </am-field>
          <am-field [label]="'platform.credits' | translate" [control]="form.controls.credits" [forceShowErrors]="showErrors()">
            <p-inputNumber inputId="credits" formControlName="credits" [min]="1" styleClass="w-full" />
          </am-field>
          <am-field [label]="'platform.price' | translate" [control]="form.controls.price" [forceShowErrors]="showErrors()">
            <input pInputText id="price" formControlName="price" class="w-full" dir="ltr" />
          </am-field>
        </form>
      </ng-template>
      <ng-template #footerTpl>
        <div class="flex justify-end gap-2">
          <p-button
            [label]="'common.cancel' | translate"
            severity="secondary"
            [text]="true"
            [disabled]="saving()"
            (onClick)="addDialog.requestClose()"
          />
          <p-button [label]="'common.save' | translate" [loading]="saving()" (onClick)="onSubmit()" data-testid="pack-save" />
        </div>
      </ng-template>
      <app-edit-dialog
        #addDialog
        [(visible)]="showAddDialog"
        [header]="'platform.addAiCreditPack' | translate"
        [content]="formTpl"
        [footer]="footerTpl"
        [dirty]="form.dirty"
        [saving]="saving()"
        width="420px"
      />
    </div>
  `,
})
export class AiCreditPackListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly planService = inject(PlanService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  readonly list = viewChild.required<DataListComponent<IAiCreditPack>>('list');

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. Same mechanism as committee-detail.component.ts's canEdit /
  // canAddMember, deliberately rather than a second one.
  // PlatformGuard, not @Permissions(): PlanController is @UseGuards(TenantGuard,
  // PlatformGuard) at class level and its POSTs carry no permission decorator,
  // so isPlatformAdmin() mirrors that guard's own two-part check.
  readonly canCreate = computed(() => this.navigationAccess.isPlatformAdmin());

  /** null means NOT LOADED — distinct from loaded-and-empty. */
  readonly packs = signal<readonly IAiCreditPack[] | null>(null);
  readonly saving = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly showAddDialog = signal(false);
  /** Set by Save: every field shows its error, touched or not. */
  readonly showErrors = signal(false);

  readonly form = this.fb.group({
    name: ['', [Validators.required]],
    credits: [100 as number | null, [Validators.required, Validators.min(1)]],
    price: ['0', [Validators.required]],
  });

  protected readonly priceOf = priceOf;

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    const t = (key: string): string => this.translate.instant(key);
    return [
      { key: 'name', label: t('platform.packName'), sortBy: 'name', alwaysVisible: true, width: 'minmax(0, 2fr)' },
      { key: 'credits', label: t('platform.credits'), sortBy: 'credits', width: 'minmax(0, 1fr)' },
      { key: 'price', label: t('platform.price'), sortBy: 'price', width: 'minmax(0, 1fr)' },
    ];
  });

  readonly trackById = (pack: IAiCreditPack): string => pack.id;

  /** The pack's name in the reader's language, English when it has no Arabic one. */
  nameOf(pack: IAiCreditPack): string {
    return this.language.bilingual(pack.name, pack.nameAr);
  }

  private readonly slice: DataListSource<IAiCreditPack> = clientSideSource(() => this.packs() ?? [], {
    searchFields: (p) => [p.name, p.nameAr],
    comparators: {
      name: (a, b) => this.nameOf(a).localeCompare(this.nameOf(b)),
      credits: (a, b) => a.credits - b.credits,
      price: (a, b) => (priceOf(a.price) ?? 0) - (priceOf(b.price) ?? 0),
    },
  });

  /** Fetch once (inactive packs included, as before), then slice the cache. */
  readonly source: DataListSource<IAiCreditPack> = (query) => {
    const cached = this.packs();
    const items$ = cached ? of(cached) : this.planService.listAiCreditPacks(true).pipe(tap((rows) => this.packs.set(rows)));
    return items$.pipe(switchMap(() => this.slice(query)));
  };

  openAdd(): void {
    this.form.reset({ name: '', credits: 100, price: '0' });
    this.showErrors.set(false);
    this.actionError.set(null);
    this.showAddDialog.set(true);
  }

  onSubmit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const value = this.form.getRawValue();

    this.planService.createAiCreditPack({ name: value.name!, credits: value.credits!, price: value.price! }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showAddDialog.set(false);
        this.reload();
      },
      error: () => {
        this.saving.set(false);
        this.actionError.set('platform.errorAction');
      },
    });
  }

  /** Invalidate, then let the LIST refetch through `source`. */
  private reload(): void {
    this.packs.set(null);
    this.list().reload();
  }
}
