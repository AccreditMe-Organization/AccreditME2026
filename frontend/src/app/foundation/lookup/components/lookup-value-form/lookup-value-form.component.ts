import { Component, Input, Output, EventEmitter, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CheckboxModule } from 'primeng/checkbox';
import {
  LookupService,
  LookupValueDto,
  CreateLookupValueDto,
  UpdateLookupValueDto,
} from '../../services/lookup.service';

@Component({
  selector: 'app-lookup-value-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, CheckboxModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">

      <div class="flex flex-col gap-1">
        <label for="key" class="font-medium text-sm">
          {{ 'lookup.fieldKey' | translate }}
          @if (!value) {
            <span class="text-red-500">*</span>
          }
        </label>
        <input id="key" pInputText formControlName="key" />
        @if (!value) {
          <small class="text-surface-400">{{ 'lookup.fieldKeyHint' | translate }}</small>
        }
      </div>

      <div class="flex flex-col gap-1">
        <label for="labelEn" class="font-medium text-sm">
          {{ 'lookup.fieldLabelEn' | translate }} <span class="text-red-500">*</span>
        </label>
        <input id="labelEn" pInputText formControlName="labelEn" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="labelAr" class="font-medium text-sm">
          {{ 'lookup.fieldLabelAr' | translate }} <span class="text-red-500">*</span>
        </label>
        <input id="labelAr" pInputText dir="rtl" formControlName="labelAr" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="sortOrder" class="font-medium text-sm">
          {{ 'lookup.fieldSortOrder' | translate }}
        </label>
        <input id="sortOrder" pInputText type="number" formControlName="sortOrder" />
      </div>

      @if (value) {
        <div class="flex items-center gap-3">
          <p-checkbox formControlName="isActive" [binary]="true" inputId="isActive" />
          <label for="isActive" class="text-sm cursor-pointer">
            {{ 'common.active' | translate }}
          </label>
        </div>
      }

      @if (categoryLoading()) {
        <p class="text-sm text-surface-400">{{ 'common.loading' | translate }}</p>
      }

      @if (attributeFields().length > 0) {
        <div [formGroup]="attributeGroup" class="flex flex-col gap-4">
          @for (field of attributeFields(); track field.key) {
            <div class="flex flex-col gap-1">
              @if (field.type === 'boolean') {
                <div class="flex items-center gap-3">
                  <p-checkbox
                    [binary]="true"
                    [formControlName]="field.key"
                    [inputId]="'attr_' + field.key"
                  />
                  <label [for]="'attr_' + field.key" class="font-medium text-sm cursor-pointer">
                    {{ field.label }}
                  </label>
                </div>
              } @else if (field.type === 'number') {
                <label [for]="'attr_' + field.key" class="font-medium text-sm">
                  {{ field.label }}
                </label>
                <input
                  [id]="'attr_' + field.key"
                  pInputText
                  type="number"
                  [formControlName]="field.key"
                />
              } @else {
                <label [for]="'attr_' + field.key" class="font-medium text-sm">
                  {{ field.label }}
                </label>
                <input
                  [id]="'attr_' + field.key"
                  pInputText
                  [formControlName]="field.key"
                />
              }
            </div>
          }
        </div>
      }

      @if (saveError()) {
        <p class="text-red-500 text-sm">{{ saveError() }}</p>
      }

      <div class="flex gap-3 justify-end">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          (onClick)="cancelled.emit()"
        />
        <p-button
          type="submit"
          [label]="(value ? 'common.save' : 'common.add') | translate"
          [loading]="saving()"
          [disabled]="form.invalid"
        />
      </div>

    </form>
  `,
})
export class LookupValueFormComponent implements OnInit {
  @Input() categoryKey = '';
  @Input() value: LookupValueDto | null = null;
  @Output() saved = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly lookupService = inject(LookupService);
  private readonly fb = inject(FormBuilder);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly categoryLoading = signal(false);
  readonly attributeFields = signal<Array<{ key: string; type: string; label: string }>>([]);

  readonly form = this.fb.group({
    key:       ['', [Validators.required, Validators.maxLength(100), Validators.pattern(/^[a-z0-9_]+$/)]],
    labelEn:   ['', [Validators.required, Validators.maxLength(255)]],
    labelAr:   ['', [Validators.required, Validators.maxLength(255)]],
    sortOrder: [0 as number | null],
    isActive:  [true],
  });

  // Rebuilt dynamically from JSON Schema properties — must remain untyped
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributeGroup: FormGroup = this.fb.group({} as Record<string, any>);

  ngOnInit(): void {
    if (this.value) {
      this.form.get('key')?.disable();
      this.form.patchValue({
        key:       this.value.key,
        labelEn:   this.value.labelEn,
        labelAr:   this.value.labelAr,
        sortOrder: this.value.sortOrder,
        isActive:  this.value.isActive,
      });
    }
    this.loadCategory();
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.saveError.set(null);

    const raw = this.form.getRawValue();
    const attrs: Record<string, unknown> | undefined =
      this.attributeFields().length > 0
        ? (this.attributeGroup.value as Record<string, unknown>)
        : undefined;

    const request$ = this.value
      ? this.lookupService.updateValue(this.value.id, {
          labelEn:    raw.labelEn   ?? undefined,
          labelAr:    raw.labelAr   ?? undefined,
          isActive:   raw.isActive  ?? undefined,
          ...(raw.sortOrder !== null ? { sortOrder: raw.sortOrder } : {}),
          ...(attrs !== undefined    ? { attributes: attrs }        : {}),
        } satisfies UpdateLookupValueDto)
      : this.lookupService.addValue(this.categoryKey, {
          key:     raw.key!,
          labelEn: raw.labelEn!,
          labelAr: raw.labelAr!,
          ...(raw.sortOrder !== null ? { sortOrder: raw.sortOrder } : {}),
          ...(attrs !== undefined    ? { attributes: attrs }        : {}),
        } satisfies CreateLookupValueDto);

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.emit();
      },
      error: (err: { error?: { message?: string } }) => {
        this.saveError.set(err?.error?.message ?? 'Save failed');
        this.saving.set(false);
      },
    });
  }

  private loadCategory(): void {
    this.categoryLoading.set(true);
    this.lookupService.getCategoryByKey(this.categoryKey).subscribe({
      next: (cat) => {
        this.categoryLoading.set(false);
        this.buildAttributeGroup(cat.attributeSchema);
      },
      error: () => this.categoryLoading.set(false),
    });
  }

  private buildAttributeGroup(schema: Record<string, unknown> | null): void {
    const props =
      (schema as { properties?: Record<string, { type?: string; label?: string }> } | null)
        ?.properties ?? {};

    const fields = Object.entries(props).map(([key, def]) => ({
      key,
      type:  def.type  ?? 'string',
      label: def.label ?? key,
    }));
    this.attributeFields.set(fields);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- values determined at runtime
    const config: Record<string, any> = {};
    for (const field of fields) {
      config[field.key] = field.type === 'boolean' ? false
                        : field.type === 'number'  ? null
                        : '';
    }
    this.attributeGroup = this.fb.group(config);

    if (this.value?.attributes) {
      this.attributeGroup.patchValue(this.value.attributes as Record<string, unknown>);
    }
  }
}
