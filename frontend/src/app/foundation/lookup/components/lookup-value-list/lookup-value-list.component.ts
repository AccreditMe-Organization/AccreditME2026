import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { LookupService, LookupCategoryDto, LookupValueDto } from '../../services/lookup.service';
import { LookupValueFormComponent } from '../lookup-value-form/lookup-value-form.component';

@Component({
  selector: 'app-lookup-value-list',
  standalone: true,
  imports: [
    FormsModule,
    TranslatePipe,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    DialogModule,
    InputTextModule,
    LookupValueFormComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">

      <!-- Header -->
      <div class="flex items-center gap-3">
        <p-button
          icon="pi pi-arrow-left"
          [text]="true"
          size="small"
          (onClick)="goBack()"
        />
        @if (category()) {
          <h2 class="text-xl font-semibold me-auto">{{ displayLabel(category()!) }}</h2>
          <p-tag
            [value]="(category()!.isSystem ? 'lookup.typeSystem' : 'lookup.typeTenant') | translate"
            [severity]="category()!.isSystem ? 'info' : 'secondary'"
          />
          <p-tag
            [value]="(category()!.isExtensible ? 'lookup.extensibleYes' : 'lookup.extensibleNo') | translate"
            [severity]="category()!.isExtensible ? 'success' : 'secondary'"
          />
          @if (category()!.isExtensible) {
            <p-button
              icon="pi pi-plus"
              [label]="'lookup.addValue' | translate"
              (onClick)="openAdd()"
            />
          }
        }
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() }}</p>
      }

      <p-table
        [value]="values()"
        [loading]="loading()"
        [scrollable]="true"
        scrollHeight="flex"
        styleClass="w-full"
      >
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 35%">{{ 'lookup.valueColumnLabel' | translate }}</th>
            <th style="width: 25%">{{ 'lookup.valueColumnKey' | translate }}</th>
            <th style="width: 15%">{{ 'lookup.valueColumnLayer' | translate }}</th>
            <th style="width: 15%">{{ 'lookup.valueColumnStatus' | translate }}</th>
            <th style="width: 10%"></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-val>
          <tr>
            <td>
              <span [class.italic]="val.labelOverrideEn">
                {{ effectiveLabel(val) }}
                @if (val.labelOverrideEn) {
                  <sup class="ms-0.5">*</sup>
                }
              </span>
            </td>
            <td>
              <span class="font-mono text-sm">{{ val.key }}</span>
            </td>
            <td>
              <p-tag
                [value]="(val.layer === 'SYSTEM' ? 'lookup.typeSystem' : 'lookup.typeTenant') | translate"
                [severity]="val.layer === 'SYSTEM' ? 'info' : 'secondary'"
              />
            </td>
            <td>
              <p-tag
                [value]="statusLabel(val) | translate"
                [severity]="statusSeverity(val)"
              />
            </td>
            <td>
              <div class="flex gap-1 justify-end">
                @if (val.layer === 'SYSTEM' && !val.isHidden) {
                  <p-button
                    icon="pi pi-eye-slash"
                    [text]="true"
                    size="small"
                    [pTooltip]="'lookup.actionHide' | translate"
                    (onClick)="onHide(val)"
                  />
                }
                @if (val.layer === 'SYSTEM' && val.isHidden) {
                  <p-button
                    icon="pi pi-eye"
                    [text]="true"
                    size="small"
                    [pTooltip]="'lookup.actionUnhide' | translate"
                    (onClick)="onUnhide(val)"
                  />
                }
                <p-button
                  icon="pi pi-tag"
                  [text]="true"
                  size="small"
                  [pTooltip]="'lookup.actionOverrideLabel' | translate"
                  (onClick)="openOverride(val)"
                />
                @if (val.layer === 'TENANT') {
                  <p-button
                    icon="pi pi-pencil"
                    [text]="true"
                    size="small"
                    [pTooltip]="'common.edit' | translate"
                    (onClick)="openEdit(val)"
                  />
                  <p-button
                    icon="pi pi-trash"
                    [text]="true"
                    size="small"
                    severity="danger"
                    [pTooltip]="'common.delete' | translate"
                    (onClick)="onDelete(val)"
                  />
                }
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5" class="text-center py-8 text-[var(--am-text-secondary)]">
              {{ 'lookup.noValues' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Add / Edit dialog -->
      <p-dialog
        [visible]="showFormDialog()"
        (visibleChange)="showFormDialog.set($event)"
        [header]="(editingValue() ? 'lookup.editValue' : 'lookup.addValue') | translate"
        [modal]="true"
        [style]="{ width: '520px' }"
      >
        <app-lookup-value-form
          [categoryKey]="categoryKey"
          [value]="editingValue()"
          (saved)="onSaved()"
          (cancelled)="showFormDialog.set(false)"
        />
      </p-dialog>

      <!-- Override label dialog -->
      <p-dialog
        [visible]="showOverrideDialog()"
        (visibleChange)="showOverrideDialog.set($event)"
        [header]="'lookup.overrideLabelTitle' | translate"
        [modal]="true"
        [style]="{ width: '480px' }"
      >
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">
              {{ 'lookup.labelEn' | translate }}
            </label>
            <input pInputText [(ngModel)]="overrideForm.labelEn" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="font-medium text-sm">
              {{ 'lookup.labelAr' | translate }}
            </label>
            <input pInputText dir="rtl" [(ngModel)]="overrideForm.labelAr" />
          </div>
          @if (overrideError()) {
            <p class="text-red-500 text-sm">{{ overrideError() }}</p>
          }
          <div class="flex gap-3 justify-end">
            <p-button
              [label]="'common.cancel' | translate"
              severity="secondary"
              [text]="true"
              type="button"
              (onClick)="showOverrideDialog.set(false)"
            />
            <p-button
              [label]="'common.save' | translate"
              [loading]="overrideSaving()"
              [disabled]="!overrideForm.labelEn || !overrideForm.labelAr"
              (onClick)="onSaveOverride()"
            />
          </div>
        </div>
      </p-dialog>

    </div>
  `,
})
export class LookupValueListComponent implements OnInit {
  private readonly lookupService = inject(LookupService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  categoryKey = '';

  readonly loading = signal(false);
  readonly category = signal<LookupCategoryDto | null>(null);
  readonly values = signal<LookupValueDto[]>([]);
  readonly error = signal<string | null>(null);

  readonly showFormDialog = signal(false);
  readonly editingValue = signal<LookupValueDto | null>(null);

  readonly showOverrideDialog = signal(false);
  readonly overridingValue = signal<LookupValueDto | null>(null);
  readonly overrideSaving = signal(false);
  readonly overrideError = signal<string | null>(null);
  readonly overrideForm = { labelEn: '', labelAr: '' };

  ngOnInit(): void {
    this.categoryKey = this.route.snapshot.paramMap.get('key') ?? '';
    this.loadCategory();
    this.loadValues();
  }

  displayLabel(cat: LookupCategoryDto): string {
    // TODO: wire to TranslateService.currentLang to respect
    // user language preference (currently always prefers Arabic
    // when available)
    return cat.labelAr || cat.labelEn;
  }

  effectiveLabel(val: LookupValueDto): string {
    // TODO: wire to TranslateService.currentLang to respect
    // user language preference (currently always prefers Arabic
    // when available)
    return val.labelOverrideEn || val.labelEn;
  }

  statusLabel(val: LookupValueDto): string {
    if (val.isHidden) return 'lookup.statusHidden';
    return val.isActive ? 'common.active' : 'common.inactive';
  }

  statusSeverity(val: LookupValueDto): 'success' | 'warn' | 'secondary' {
    if (val.isHidden) return 'warn';
    return val.isActive ? 'success' : 'secondary';
  }

  openAdd(): void {
    this.editingValue.set(null);
    this.showFormDialog.set(true);
  }

  openEdit(val: LookupValueDto): void {
    this.editingValue.set(val);
    this.showFormDialog.set(true);
  }

  openOverride(val: LookupValueDto): void {
    this.overridingValue.set(val);
    this.overrideForm.labelEn = val.labelOverrideEn ?? val.labelEn;
    this.overrideForm.labelAr = val.labelOverrideAr ?? val.labelAr;
    this.overrideError.set(null);
    this.showOverrideDialog.set(true);
  }

  onSaved(): void {
    this.showFormDialog.set(false);
    this.loadValues();
  }

  onHide(val: LookupValueDto): void {
    this.lookupService.hideSystemValue(val.id).subscribe({
      next: () => this.loadValues(),
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err?.error?.message ?? 'Hide failed'),
    });
  }

  onUnhide(val: LookupValueDto): void {
    this.lookupService.unhideSystemValue(val.id).subscribe({
      next: () => this.loadValues(),
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err?.error?.message ?? 'Unhide failed'),
    });
  }

  onDelete(val: LookupValueDto): void {
    // TODO: replace with PrimeNG ConfirmationService dialog
    this.lookupService.removeValue(val.id).subscribe({
      next: () => this.loadValues(),
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err?.error?.message ?? 'Delete failed'),
    });
  }

  onSaveOverride(): void {
    const val = this.overridingValue();
    if (!val) return;
    this.overrideSaving.set(true);
    this.overrideError.set(null);
    this.lookupService
      .overrideLabel(val.id, {
        labelOverrideEn: this.overrideForm.labelEn,
        labelOverrideAr: this.overrideForm.labelAr,
      })
      .subscribe({
        next: () => {
          this.overrideSaving.set(false);
          this.showOverrideDialog.set(false);
          this.loadValues();
        },
        error: (err: { error?: { message?: string } }) => {
          this.overrideError.set(err?.error?.message ?? 'Save failed');
          this.overrideSaving.set(false);
        },
      });
  }

  goBack(): void {
    // Absolute path, not relativeTo — see ACC-16 (NG04002 on relative '..'
    // navigation across this route's lazy-loaded boundary).
    void this.router.navigate(['/lookups']);
  }

  private loadCategory(): void {
    this.lookupService.getCategoryByKey(this.categoryKey).subscribe({
      next: (cat) => this.category.set(cat),
      error: () => this.error.set('lookup.errorLoad'),
    });
  }

  private loadValues(): void {
    this.loading.set(true);
    this.error.set(null);
    this.lookupService.getValues(this.categoryKey).subscribe({
      next: (vals) => {
        this.values.set(vals);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('lookup.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
