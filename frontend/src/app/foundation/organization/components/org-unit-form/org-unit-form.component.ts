import { Component, OnInit, inject, input, output, signal, computed } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { TooltipModule } from 'primeng/tooltip';
import {
  OrgUnitService,
  OrgUnitDto,
  CreateOrgUnitDto,
  UpdateOrgUnitDto,
  buildOrgUnitCascadeOptions,
} from '../../services/org-unit.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
// ACC-42 Phase 6 — OverlaySelectComponent replaces p-cascadeSelect on this
// field: the first hierarchy-mode consumer (optionGroupLabel/
// optionGroupChildren mirror p-cascadeSelect's own input names exactly, see
// overlay-select.component.ts §1.2). Real-data checkpoint (plan §5.4)
// applies here specifically — verified against this tenant's live
// buildOrgUnitCascadeOptions() output, not a fixture.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

@Component({
  selector: 'app-org-unit-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    OverlaySelectComponent,
    InputNumberModule,
    TooltipModule,
  ],
  template: `
    @if (loadError()) {
      <p class="text-red-500 mb-4">{{ loadError() | translate }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">

      <div class="flex flex-col gap-1">
        <label for="nameEn" class="font-medium text-sm">
          {{ 'organization.nameEn' | translate }} *
        </label>
        <input
          id="nameEn"
          pInputText
          formControlName="nameEn"
          (input)="onNameEnInput()"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="nameAr" class="font-medium text-sm">
          {{ 'organization.nameAr' | translate }}
        </label>
        <input id="nameAr" pInputText formControlName="nameAr" dir="rtl" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="code" class="font-medium text-sm flex items-center gap-2">
          {{ 'organization.code' | translate }} *
          @if (codeLocked()) {
            <span
              class="pi pi-lock text-amber-500"
              [pTooltip]="'organization.codeLockedHint' | translate"
              tooltipPosition="top"
            ></span>
          }
        </label>
        <input
          id="code"
          pInputText
          formControlName="code"
          class="font-mono"
          (input)="onCodeManualEdit()"
        />
        <small class="text-[var(--am-text-secondary)]">{{ 'organization.codeHint' | translate }}</small>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">
          {{ 'organization.parentUnit' | translate }}
        </label>
        <app-overlay-select
          formControlName="parentId"
          [options]="cascadeOptions()"
          optionLabel="label"
          optionValue="value"
          optionGroupLabel="label"
          optionGroupChildren="items"
          [placeholder]="'organization.parentUnit' | translate"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="description" class="font-medium text-sm">
          {{ 'organization.description' | translate }}
        </label>
        <textarea id="description" pTextarea formControlName="description" rows="3"></textarea>
      </div>

      <div class="flex flex-col gap-1">
        <label for="sortOrder" class="font-medium text-sm">Sort Order</label>
        <p-inputNumber id="sortOrder" formControlName="sortOrder" [min]="0" styleClass="w-full" />
      </div>

      @if (saveError()) {
        <p class="text-red-500">{{ saveError() | translate }}</p>
      }

      <div class="flex gap-3 justify-end">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="cancelled.emit()"
          [disabled]="saving()"
        />
        <p-button
          type="submit"
          [label]="'common.save' | translate"
          [loading]="saving()"
          [disabled]="form.invalid"
        />
      </div>

    </form>
  `,
})
export class OrgUnitFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly orgUnitService = inject(OrgUnitService);

  // null = add mode, set = edit mode — same convention as PositionFormComponent's
  // [position] input.
  readonly unit = input<OrgUnitDto | null>(null);
  // Only relevant in add mode — pre-fills parentId when adding a child unit
  // from a specific row (replaces the old ?parentId= query param, which no
  // longer exists now that this isn't a routed page).
  readonly parentId = input<string | null>(null);

  readonly saved = output<void>();
  readonly cancelled = output<void>();

  readonly codeLocked = signal(false);
  readonly codeManuallyEdited = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);

  private readonly flatUnits = signal<OrgUnitDto[]>([]);

  readonly cascadeOptions = computed(() =>
    buildOrgUnitCascadeOptions(this.flatUnits(), this.unit()?.id ?? null, null),
  );

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(255)]],
    nameAr: ['', Validators.maxLength(255)],
    code: ['', [Validators.required, Validators.maxLength(20), Validators.pattern(/^[A-Z0-9_-]+$/)]],
    parentId: [null as string | null],
    description: ['', Validators.maxLength(1000)],
    sortOrder: [0, [Validators.required, Validators.min(0)]],
  });

  ngOnInit(): void {
    this.orgUnitService.getFlat().subscribe({
      next: (units) => this.flatUnits.set(units),
      error: () => this.loadError.set('Failed to load organization units'),
    });

    const unit = this.unit();
    if (unit) {
      if (unit.isCodeLocked) {
        this.codeLocked.set(true);
        this.form.get('code')?.disable();
      }
      this.codeManuallyEdited.set(true);

      this.form.patchValue({
        nameEn: unit.nameEn,
        nameAr: unit.nameAr ?? '',
        code: unit.code,
        parentId: unit.parentId,
        description: unit.description ?? '',
        sortOrder: unit.sortOrder,
      });
    } else if (this.parentId()) {
      this.form.patchValue({ parentId: this.parentId() });
    }
  }

  onNameEnInput(): void {
    if (this.codeManuallyEdited()) return;
    const raw = (this.form.get('nameEn')?.value ?? '') as string;
    const code = raw
      .toUpperCase()
      .replace(/\s+/g, '-')
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 10);
    this.form.get('code')?.setValue(code, { emitEvent: false });
  }

  onCodeManualEdit(): void {
    this.codeManuallyEdited.set(true);
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.saveError.set(null);

    const id = this.unit()?.id ?? null;
    const value = this.form.getRawValue();

    const payload = {
      nameEn: value.nameEn!,
      nameAr: value.nameAr || undefined,
      code: value.code!,
      parentId: value.parentId ?? undefined,
      description: value.description || undefined,
      sortOrder: value.sortOrder ?? 0,
    };

    const request$ = id
      ? this.orgUnitService.update(id, payload as UpdateOrgUnitDto)
      : this.orgUnitService.create(payload as CreateOrgUnitDto);

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, 'Save failed'));
        this.saving.set(false);
      },
    });
  }
}
