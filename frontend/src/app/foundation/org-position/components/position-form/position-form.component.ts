import { Component, OnInit, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { OrgPositionService, IOrgPositionDto } from '../../services/org-position.service';
import { OrgUnitService, OrgUnitDto } from '../../../organization/services/org-unit.service';

@Component({
  selector: 'app-position-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, InputTextModule, InputNumberModule, SelectModule, ButtonModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label for="nameEn" class="text-sm font-medium">
          {{ 'orgPosition.nameEn' | translate }}
          <span class="text-red-500">*</span>
        </label>
        <input pInputText id="nameEn" formControlName="nameEn" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="nameAr" class="text-sm font-medium">{{ 'orgPosition.nameAr' | translate }}</label>
        <input pInputText id="nameAr" formControlName="nameAr" dir="rtl" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="grade" class="text-sm font-medium">
          {{ 'orgPosition.grade' | translate }}
          <span class="text-red-500">*</span>
        </label>
        <p-inputNumber inputId="grade" formControlName="grade" [min]="1" [max]="10" [showButtons]="true" />
        <small class="text-[var(--am-text-secondary)]">{{ 'orgPosition.gradeHint' | translate }}</small>
      </div>

      <div class="flex flex-col gap-1">
        <label for="orgUnitId" class="text-sm font-medium">{{ 'orgPosition.orgUnit' | translate }}</label>
        <p-select
          inputId="orgUnitId"
          formControlName="orgUnitId"
          [options]="orgUnits()"
          optionLabel="nameEn"
          optionValue="id"
          [showClear]="true"
          [placeholder]="'orgPosition.orgWide' | translate"
        />
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="cancelled.emit()"
          [disabled]="saving()"
        />
        <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" />
      </div>
    </form>
  `,
})
export class PositionFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);

  readonly position = input<IOrgPositionDto | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  readonly saving = signal(false);
  readonly orgUnits = signal<OrgUnitDto[]>([]);

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(100)]],
    nameAr: ['', [Validators.maxLength(100)]],
    grade: [5, [Validators.required, Validators.min(1), Validators.max(10)]],
    orgUnitId: [null as string | null],
  });

  constructor() {
    effect(() => {
      const current = this.position();
      if (current) {
        this.form.patchValue({
          nameEn: current.nameEn,
          nameAr: current.nameAr ?? '',
          grade: current.grade,
          orgUnitId: current.orgUnitId,
        });
      }
    });
  }

  ngOnInit(): void {
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);

    const value = this.form.getRawValue();
    const dto = {
      nameEn: value.nameEn!,
      nameAr: value.nameAr || undefined,
      grade: value.grade!,
      orgUnitId: value.orgUnitId || undefined,
    };

    const current = this.position();
    const request = current
      ? this.orgPositionService.update(current.id, dto)
      : this.orgPositionService.create(dto);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.emit();
      },
      error: () => this.saving.set(false),
    });
  }
}
