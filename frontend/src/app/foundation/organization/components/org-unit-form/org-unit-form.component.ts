import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { CascadeSelectModule } from 'primeng/cascadeselect';
import { InputNumberModule } from 'primeng/inputnumber';
import { TooltipModule } from 'primeng/tooltip';
import {
  OrgUnitService,
  OrgUnitDto,
  CreateOrgUnitDto,
  UpdateOrgUnitDto,
  orgUnitDisplayName,
} from '../../services/org-unit.service';

interface CascadeOption {
  label: string;
  value: string;
  items?: CascadeOption[];
}

@Component({
  selector: 'app-org-unit-form',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    CascadeSelectModule,
    InputNumberModule,
    TooltipModule,
  ],
  template: `
    <div class="mb-4">
      <a [routerLink]="['../..']" class="text-sm text-surface-500">
        ← {{ 'organization.title' | translate }}
      </a>
    </div>

    <h2 class="text-xl font-semibold mb-6">
      {{ (editId() ? 'organization.editUnit' : 'organization.addUnit') | translate }}
    </h2>

    @if (loadError()) {
      <p class="text-red-500 mb-4">{{ loadError() }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4" style="max-width: 640px">

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
        <small class="text-surface-400">{{ 'organization.codeHint' | translate }}</small>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">
          {{ 'organization.parentUnit' | translate }}
        </label>
        <p-cascadeSelect
          formControlName="parentId"
          [options]="cascadeOptions()"
          optionLabel="label"
          optionValue="value"
          optionGroupLabel="label"
          optionGroupChildren="items"
          [placeholder]="'organization.parentUnit' | translate"
          styleClass="w-full"
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
        <p class="text-red-500">{{ saveError() }}</p>
      }

      <div class="flex gap-3 justify-end">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          [routerLink]="['../..']"
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly orgUnitService = inject(OrgUnitService);

  readonly editId = signal<string | null>(null);
  readonly codeLocked = signal(false);
  readonly codeManuallyEdited = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);

  private readonly flatUnits = signal<OrgUnitDto[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly cascadeOptions = computed<any[]>(() =>
    this.buildCascadeOptions(this.flatUnits(), this.editId(), null),
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
    const id = this.route.snapshot.paramMap.get('id');
    this.editId.set(id);

    this.orgUnitService.getFlat().subscribe({
      next: (units) => this.flatUnits.set(units),
      error: () => this.loadError.set('Failed to load organization units'),
    });

    if (id) {
      this.orgUnitService.getTree().subscribe({
        next: (units) => {
          const unit = this.findUnit(units, id);
          if (!unit) { this.loadError.set('Unit not found'); return; }

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
        },
        error: () => this.loadError.set('Failed to load unit'),
      });
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

    const id = this.editId();
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
      next: () => this.router.navigate(['../..'], { relativeTo: this.route }),
      error: (err) => {
        this.saveError.set(err?.error?.message ?? 'Save failed');
        this.saving.set(false);
      },
    });
  }

  private findUnit(units: OrgUnitDto[], id: string): OrgUnitDto | null {
    for (const unit of units) {
      if (unit.id === id) return unit;
      if (unit.children?.length) {
        const found = this.findUnit(unit.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  private buildCascadeOptions(
    all: OrgUnitDto[],
    excludeId: string | null,
    parentId: string | null,
  ): CascadeOption[] {
    return all
      .filter((u) => u.parentId === parentId && u.id !== excludeId && u.isActive)
      .map((u) => {
        const items = this.buildCascadeOptions(all, excludeId, u.id);
        return {
          label: orgUnitDisplayName(u),
          value: u.id,
          ...(items.length ? { items } : {}),
        };
      });
  }
}
