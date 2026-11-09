import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { of, switchMap, tap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageModule } from 'primeng/message';
import { PlanService, IAiFeatureCost } from '../../services/plan.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
// ACC-39 — EditDialogComponent replaces this raw p-dialog + manual @if.
// Genuine edit flow (openAdd()/openEdit() both present), but already
// immune to ACC-29's bug: inline form (no separate *-form.component.ts),
// this.form.reset() runs imperatively on every openAdd()/openEdit() call.
// Architectural consistency with SYSTEM-REFERENCE.md Section 10.5's
// required pattern, not a bug fix.
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../shared/components/field/field.component';
import { InputNumberLatinDigits } from '../../../core/formatting/latin-digits';
import { AmNumberPipe } from '../../../core/formatting';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { DataListColumn, DataListComponent } from '../../../shared/components/data-list/data-list.component';
import { DataListSource, clientSideSource } from '../../../shared/components/data-list/data-list.source';
import { SortHeaderComponent } from '../../../shared/components/sort-header/sort-header.component';

/**
 * Platform → AI feature costs — ACC-120, on the shared list (`app-data-list`).
 *
 * `GET /platform/ai-feature-costs` returns every row as one array, so the list
 * reads it once and searches (the feature key), sorts and pages it in memory
 * (`clientSideSource()`). Opens sorted by feature key, A to Z. Edit is the
 * row's one action.
 *
 * The dialog follows the dialog rules: Save is never disabled (a press on an
 * invalid form reveals every error and sends nothing), every field is an
 * `am-field` with its control, and the actions are the dialog's footer.
 */
@Component({
  selector: 'app-ai-feature-cost-list',
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
      <app-page-header [title]="'platform.aiFeatureCosts' | translate">
        <div pageActions>
          @if (canCreate()) {
            <p-button icon="pi pi-plus" [label]="'platform.addAiFeatureCost' | translate" (onClick)="openAdd()" />
          }
        </div>
      </app-page-header>

      <app-data-list
        #list
        variant="page"
        [source]="source"
        [trackBy]="trackById"
        [columns]="columns()"
        [initialSort]="{ sortBy: 'featureKey', sortDir: 'asc' }"
        [searchPlaceholder]="'platform.searchAiFeatureCosts' | translate"
        [emptyTitle]="'platform.noAiFeatureCosts' | translate"
        [errorMessage]="'platform.errorLoad' | translate"
        [gridSuffix]="canCreate() ? 'calc(var(--am-space-40) * 2)' : ''"
        persistKey="platformAiFeatureCosts"
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
          @if (canCreate()) {
            <span></span>
          }
        </ng-template>

        <ng-template #listRow let-cost let-v="visible">
          <div
            class="grid items-center gap-3 border-b border-[var(--am-border)] px-3 py-2 text-[length:var(--am-type-value-size)]"
            style="grid-template-columns: var(--am-list-cols)"
            [attr.data-cost-row]="cost.featureKey"
          >
            @if (v('featureKey')) {
              <span class="min-w-0 truncate font-medium" dir="ltr" [attr.title]="cost.featureKey" data-testid="cost-key">{{
                cost.featureKey
              }}</span>
            }
            @if (v('creditCost')) {
              <span class="min-w-0 truncate tabular-nums" data-testid="cost-credits">{{ cost.creditCost | amNumber }}</span>
            }
            <!-- ACC-123 — the same gate the create action already had.
                 /platform is behind platformAdminGuard as a whole, so this
                 is belt and braces rather than a fix; it is here because a
                 reader should not have to know that to see the rule. -->
            @if (canCreate()) {
              <span class="flex justify-end">
                <p-button
                  [label]="'common.edit' | translate"
                  size="small"
                  [text]="true"
                  [ariaLabel]="'platform.editFeatureCost' | translate: { feature: cost.featureKey }"
                  (onClick)="openEdit(cost)"
                  data-testid="feature-cost-edit"
                />
              </span>
            }
          </div>
        </ng-template>
      </app-data-list>

      <ng-template #formTpl>
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col" data-testid="cost-form">
          @if (actionError()) {
            <p-message severity="error" [text]="actionError()! | translate" styleClass="mb-3" data-testid="cost-save-error" />
          }
          <am-field [label]="'platform.featureKey' | translate" [control]="form.controls.featureKey" [forceShowErrors]="showErrors()">
            <input pInputText id="featureKey" formControlName="featureKey" [readonly]="!!editingKey()" class="w-full" dir="ltr" />
          </am-field>
          <am-field [label]="'platform.creditCost' | translate" [control]="form.controls.creditCost" [forceShowErrors]="showErrors()">
            <p-inputNumber inputId="creditCost" formControlName="creditCost" [min]="0" styleClass="w-full" />
          </am-field>
          <am-field [label]="'common.description' | translate" [control]="form.controls.description" [forceShowErrors]="showErrors()">
            <input pInputText id="description" formControlName="description" class="w-full" />
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
            (onClick)="costDialog.requestClose()"
          />
          <p-button [label]="'common.save' | translate" [loading]="saving()" (onClick)="onSubmit()" data-testid="cost-save" />
        </div>
      </ng-template>
      <app-edit-dialog
        #costDialog
        [(visible)]="showDialog"
        [header]="
          editingKey()
            ? ('platform.editFeatureCost' | translate: { feature: editingKey() })
            : ('platform.addAiFeatureCost' | translate)
        "
        [content]="formTpl"
        [footer]="footerTpl"
        [dirty]="form.dirty"
        [saving]="saving()"
        width="420px"
      />
    </div>
  `,
})
export class AiFeatureCostListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly planService = inject(PlanService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);

  readonly list = viewChild.required<DataListComponent<IAiFeatureCost>>('list');

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. Same mechanism as committee-detail.component.ts's canEdit /
  // canAddMember, deliberately rather than a second one.
  // PlatformGuard rather than a permission string — see ai-credit-pack-list.
  readonly canCreate = computed(() => this.navigationAccess.isPlatformAdmin());

  /** null means NOT LOADED — distinct from loaded-and-empty. */
  readonly costs = signal<readonly IAiFeatureCost[] | null>(null);
  readonly saving = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly showDialog = signal(false);
  readonly editingKey = signal<string | null>(null);
  /** Set by Save: every field shows its error, touched or not. */
  readonly showErrors = signal(false);

  readonly form = this.fb.group({
    featureKey: ['', [Validators.required]],
    creditCost: [1 as number | null, [Validators.required, Validators.min(0)]],
    description: [''],
  });

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    const t = (key: string): string => this.translate.instant(key);
    return [
      { key: 'featureKey', label: t('platform.featureKey'), sortBy: 'featureKey', alwaysVisible: true, width: 'minmax(0, 2fr)' },
      { key: 'creditCost', label: t('platform.creditCost'), sortBy: 'creditCost', width: 'minmax(0, 1fr)' },
    ];
  });

  readonly trackById = (cost: IAiFeatureCost): string => cost.id;

  private readonly slice: DataListSource<IAiFeatureCost> = clientSideSource(() => this.costs() ?? [], {
    searchFields: (c) => [c.featureKey],
    comparators: {
      featureKey: (a, b) => a.featureKey.localeCompare(b.featureKey),
      creditCost: (a, b) => a.creditCost - b.creditCost,
    },
  });

  /** Fetch once, then slice the cache. */
  readonly source: DataListSource<IAiFeatureCost> = (query) => {
    const cached = this.costs();
    const items$ = cached ? of(cached) : this.planService.listAiFeatureCosts().pipe(tap((rows) => this.costs.set(rows)));
    return items$.pipe(switchMap(() => this.slice(query)));
  };

  openAdd(): void {
    this.editingKey.set(null);
    this.form.reset({ featureKey: '', creditCost: 1, description: '' });
    this.showErrors.set(false);
    this.actionError.set(null);
    this.showDialog.set(true);
  }

  openEdit(cost: IAiFeatureCost): void {
    this.editingKey.set(cost.featureKey);
    this.form.reset({ featureKey: cost.featureKey, creditCost: cost.creditCost, description: cost.description ?? '' });
    this.showErrors.set(false);
    this.actionError.set(null);
    this.showDialog.set(true);
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

    this.planService
      .upsertAiFeatureCost({ featureKey: value.featureKey!, creditCost: value.creditCost!, description: value.description ?? undefined })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.showDialog.set(false);
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
    this.costs.set(null);
    this.list().reload();
  }
}
