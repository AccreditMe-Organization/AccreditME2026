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
// ACC-149 - the unit's type is an org_unit_type lookup value (ACC-137). The
// form had no such field while the API required one, so every Add Unit returned
// 400. Read through LookupService rather than a local map: ACC-137's read-path
// contract is that a label is labelOverride ?? label, and a client-side
// translation table is exactly what shows a tenant the wrong word.
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { LanguageService } from '../../../../core/services/language.service';
import { TranslateService } from '@ngx-translate/core';
// ACC-42 Phase 6 — OverlaySelectComponent replaces p-cascadeSelect on this
// field: the first hierarchy-mode consumer (optionGroupLabel/
// optionGroupChildren mirror p-cascadeSelect's own input names exactly, see
// overlay-select.component.ts §1.2). Real-data checkpoint (plan §5.4)
// applies here specifically — verified against this tenant's live
// buildOrgUnitCascadeOptions() output, not a fixture.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { InputNumberLatinDigits } from '../../../../core/formatting/latin-digits';

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
    InputNumberLatinDigits,
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

      <!-- ACC-149 - the unit's type. Required by the API since ACC-137; this
           form never had the field, so every Add Unit returned 400. -->
      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">
          {{ 'organization.unitType' | translate }} *
        </label>

        @if (typesLoading()) {
          <p class="text-sm text-[var(--am-text-secondary)]">
            {{ 'organization.typeLoading' | translate }}
          </p>
        } @else if (typesError()) {
          <!-- Error, with a retry that re-requests ONLY this list. Everything
               already typed into the form survives, because losing a
               half-filled form to a failed side request is its own defect. -->
          <div class="flex items-center gap-2">
            <p class="text-sm text-red-500">{{ typesError() }}</p>
            <p-button
              size="small"
              severity="secondary"
              [label]="'common.retry' | translate"
              (onClick)="retryTypes()"
            />
          </div>
        } @else if (typeOptions().length === 0) {
          <!-- Empty states the CAUSE. An admin cannot add a lookup value from
               this form, so "no types" without a reason is a dead end. -->
          <p class="text-sm text-[var(--am-text-secondary)]">
            {{ 'organization.typesEmpty' | translate }}
          </p>
        } @else {
          <app-overlay-select
            formControlName="typeValueId"
            [options]="typeOptions()"
            optionLabel="label"
            optionValue="value"
            [placeholder]="'organization.unitType' | translate"
          />
        }
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

  // ACC-149 - the type list has its own request, so it has its own outcome.
  // A failure here must not read as "no types exist": an empty picker and a
  // broken picker look identical to a user, and only one of them is worth
  // retrying.
  private readonly lookupService = inject(LookupService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly typeValues = signal<LookupValueDto[]>([]);
  readonly typesLoading = signal(true);
  readonly typesError = signal<string | null>(null);

  /**
   * The selectable types, plus whatever the unit already holds.
   *
   * ACC-137's contract, applied to a picker: a value the tenant has since
   * hidden or deactivated is NOT offered as a new choice, but a unit that holds
   * one must still show it - marked - or opening the form would silently
   * present a different type from the one saved, and saving would change it.
   * getValues() already drops hidden and inactive values, so the unit's own
   * type is re-added here when the list does not contain it.
   */
  readonly typeOptions = computed(() => {
    const options = this.typeValues().map((v) => ({
      label: this.labelFor(v),
      value: v.id,
    }));
    const held = this.unit()?.typeValue ?? null;
    if (held && !options.some((o) => o.value === held.id)) {
      options.push({
        label: `${this.languageService.isArabic() ? held.labelAr : held.labelEn} (${this.translate.instant('organization.typeRetired')})`,
        value: held.id,
      });
    }
    return options;
  });

  readonly cascadeOptions = computed(() =>
    buildOrgUnitCascadeOptions(this.flatUnits(), this.unit()?.id ?? null, null),
  );

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(255)]],
    nameAr: ['', Validators.maxLength(255)],
    code: ['', [Validators.required, Validators.maxLength(20), Validators.pattern(/^[A-Z0-9_-]+$/)]],
    parentId: [null as string | null],
    // ACC-149 - required, matching the API. Required on EDIT too: without it an
    // existing unit's type could never be changed through the UI, which is the
    // other half of the same gap - the 40 units that have types have them only
    // because a backfill put them there.
    typeValueId: [null as string | null, [Validators.required]],
    description: ['', Validators.maxLength(1000)],
    sortOrder: [0, [Validators.required, Validators.min(0)]],
  });

  ngOnInit(): void {
    this.orgUnitService.getFlat().subscribe({
      next: (units) => this.flatUnits.set(units),
      error: () => this.loadError.set('Failed to load organization units'),
    });

    this.loadTypes();

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
        typeValueId: unit.typeValueId,
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

  /**
   * ACC-149 - the type list, with its own outcome handling.
   *
   * Gate 6's six outcomes for this list:
   *   loading  - typesLoading(), the select is disabled and says so
   *   rows     - typeOptions(), the normal case
   *   empty    - loaded but no values: states the cause rather than blaming
   *              the user, since an admin cannot fix it from this form
   *   denied   - a 403 renders through the same error branch with the server's
   *              own message; lookups:view is held by every role that can reach
   *              this form, so this is defensive rather than reachable
   *   error    - typesError(), with a Retry that re-requests only this list and
   *              leaves everything typed in the form untouched
   *   partial  - NOT APPLICABLE, and stated rather than faked. Partial means
   *              some regions of a composite view loaded and others did not.
   *              This is one request for one list; it either arrives or it does
   *              not. Inventing a half-state here would be ceremony.
   */
  private loadTypes(): void {
    this.typesLoading.set(true);
    this.typesError.set(null);
    this.lookupService.getValues('org_unit_type').subscribe({
      next: (values) => {
        this.typeValues.set(values);
        this.typesLoading.set(false);
      },
      error: (err: unknown) => {
        this.typesError.set(extractErrorMessage(err, 'organization.typeLoadFailed'));
        this.typesLoading.set(false);
      },
    });
  }

  retryTypes(): void {
    this.loadTypes();
  }

  /**
   * ACC-137's read-path contract, on the client side of it.
   *
   * labelOverride ?? label, and the language decides which pair - never a
   * key-to-label map of the client's own, which is what shows a tenant the
   * seeded word after they renamed it.
   */
  private labelFor(value: LookupValueDto): string {
    return this.languageService.isArabic()
      ? (value.labelOverrideAr ?? value.labelAr)
      : (value.labelOverrideEn ?? value.labelEn);
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
      typeValueId: value.typeValueId!,
      description: value.description || undefined,
      sortOrder: value.sortOrder ?? 0,
    };

    const request$ = id
      ? this.orgUnitService.update(id, payload as UpdateOrgUnitDto)
      : this.orgUnitService.create(payload);

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
