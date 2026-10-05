import { Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import {
  CommitteeService,
  CommitteeDto,
  CreateCommitteeDto,
  COMMITTEE_MEETING_FREQUENCIES,
} from '../../services/committee.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
// ACC-135 — the owning unit's picker. RoleService is gone from this file: the
// "reports to a role" option it served does not exist any more.
import {
  OrgUnitService,
  OrgUnitDto,
  buildOrgUnitCascadeOptions,
} from '../../../organization/services/org-unit.service';
import { LanguageService } from '../../../../core/services/language.service';
// ACC-42 Phase 3 — OverlaySelectComponent replaces p-select on this field:
// EditDialogComponent context. See CLAUDE.md's PrimeNG-components-only
// exception note and overlay-select.component.ts for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { InputNumberLatinDigits } from '../../../../core/formatting/latin-digits';

@Component({
  selector: 'app-committee-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    InputNumberLatinDigits,
    ButtonModule,
    OverlaySelectComponent,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label for="nameEn" class="text-sm font-medium">
          {{ 'committee.nameEn' | translate }}
          <span class="text-red-500">*</span>
        </label>
        <input pInputText id="nameEn" formControlName="nameEn" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="nameAr" class="text-sm font-medium">
          {{ 'committee.nameAr' | translate }}
        </label>
        <input pInputText id="nameAr" formControlName="nameAr" dir="rtl" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="typeValueId" class="text-sm font-medium">
          {{ 'committee.type' | translate }}
          <span class="text-red-500">*</span>
        </label>
        <app-overlay-select
          formControlName="typeValueId"
          [options]="committeeTypeOptions()"
          optionLabel="label"
          optionValue="id"
          [placeholder]="'committee.selectType' | translate"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="purpose" class="text-sm font-medium">{{ 'committee.purpose' | translate }}</label>
        <textarea pTextarea id="purpose" formControlName="purpose" rows="3"></textarea>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1">
          <label for="quorumCount" class="text-sm font-medium">{{ 'committee.quorumCount' | translate }}</label>
          <p-inputNumber inputId="quorumCount" formControlName="quorumCount" [min]="0" [showButtons]="true" />
        </div>

        <div class="flex flex-col gap-1">
          <label for="meetingFrequency" class="text-sm font-medium">{{ 'committee.meetingFrequency' | translate }}</label>
          <app-overlay-select
            formControlName="meetingFrequency"
            [options]="frequencyOptions"
            optionLabel="label"
            optionValue="value"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label for="orgUnitId" class="text-sm font-medium">
          {{ 'committee.owningUnit' | translate }}
          <span class="text-red-500">*</span>
        </label>
        <app-overlay-select
          formControlName="orgUnitId"
          [options]="orgUnitCascadeOptions()"
          optionLabel="label"
          optionValue="value"
          optionGroupLabel="label"
          optionGroupChildren="items"
          [placeholder]="'committee.selectOwningUnit' | translate"
        />
        <small class="text-[var(--am-text-secondary)]">{{ 'committee.owningUnitHint' | translate }}</small>
      </div>

      <div class="flex flex-col gap-1">
        <label for="parentCommitteeId" class="text-sm font-medium">{{ 'committee.parentCommittee' | translate }}</label>
        <app-overlay-select
          formControlName="parentCommitteeId"
          [options]="parentCommitteeOptions()"
          optionLabel="label"
          optionValue="id"
          [showClear]="true"
          [placeholder]="'committee.noneOption' | translate"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="reportingToCommitteeId" class="text-sm font-medium">
          {{ 'committee.reportingTo' | translate }}
        </label>
        <app-overlay-select
          formControlName="reportingToCommitteeId"
          [options]="parentCommitteeOptions()"
          optionLabel="label"
          optionValue="id"
          [showClear]="true"
          [placeholder]="'committee.noneOption' | translate"
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
        <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
      </div>
    </form>
  `,
})
export class CommitteeFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly committeeService = inject(CommitteeService);
  private readonly lookupService = inject(LookupService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly languageService = inject(LanguageService);

  readonly committee = input<CommitteeDto | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  readonly saving = signal(false);
  readonly committeeTypes = signal<LookupValueDto[]>([]);
  readonly parentOptions = signal<CommitteeDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);

  // ACC-135 — no excludeId: a committee is not itself an org unit, so there is no
  // self/descendant relationship to exclude (unlike org-unit-form's parentId).
  readonly orgUnitCascadeOptions = computed(() => buildOrgUnitCascadeOptions(this.orgUnits(), null, null));

  readonly frequencyOptions = COMMITTEE_MEETING_FREQUENCIES.map((value) => ({
    value,
    label: value,
  }));

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(150)]],
    // ACC-160 — the Arabic name is OPTIONAL: Arabic fields are never mandatory,
    // because the product is sold to customers who do not operate in Arabic.
    // maxLength stays. An emptied field is sent as '' and stored as NULL by the
    // DTO's trimToNull, so the empty-to-null decision lives in one place.
    nameAr: ['', [Validators.maxLength(150)]],
    typeValueId: [null as string | null, [Validators.required]],
    purpose: [''],
    quorumCount: [0, [Validators.min(0)]],
    meetingFrequency: ['AS_NEEDED'],
    parentCommitteeId: [null as string | null],
    // ACC-135 — required, and prefilled with the root on create rather than left
    // empty. "The whole organisation" is a real, common answer, and the root unit
    // IS the organisation (ACC-141) — so the honest control is a required field
    // that arrives already holding that answer, which the creator may change.
    // Leaving it empty would disable Save on a question most people do not need
    // to answer.
    orgUnitId: [null as string | null, [Validators.required]],
    reportingToCommitteeId: [null as string | null],
  });

  // ACC-160 — options carry a RESOLVED label instead of handing the dropdown a
  // field NAME ('nameAr' / 'labelAr'), which drew a BLANK option for a record
  // with no Arabic name. A computed over the options AND the language —
  // bilingual() reads the language signal — so a switch relabels the list. Never
  // a label written once at load: the one-time-set trap (SYSTEM-REFERENCE §9.3).
  readonly committeeTypeOptions = computed(() =>
    this.committeeTypes().map((v) => ({
      ...v,
      label: this.languageService.bilingual(v.labelEn, v.labelAr),
    })),
  );

  readonly parentCommitteeOptions = computed(() =>
    this.parentOptions().map((c) => ({
      ...c,
      label: this.languageService.bilingual(c.nameEn, c.nameAr),
    })),
  );

  constructor() {
    effect(() => {
      const current = this.committee();
      if (current) {
        this.form.patchValue({
          nameEn: current.nameEn,
          nameAr: current.nameAr,
          typeValueId: current.typeValueId,
          purpose: current.purpose ?? '',
          quorumCount: current.quorumCount,
          meetingFrequency: current.meetingFrequency,
          parentCommitteeId: current.parentCommitteeId,
          orgUnitId: current.orgUnitId,
          reportingToCommitteeId: current.reportingToCommitteeId,
        });
      }
    });
  }

  ngOnInit(): void {
    this.lookupService.getValues('committee_type').subscribe({ next: (values) => this.committeeTypes.set(values) });
    this.orgUnitService.getFlat().subscribe({
      next: (units) => {
        this.orgUnits.set(units);
        this.prefillRootUnit(units);
      },
    });
    this.committeeService.listCommittees().subscribe({
      next: (committees) => {
        const currentId = this.committee()?.id;
        this.parentOptions.set(currentId ? committees.filter((c) => c.id !== currentId) : committees);
      },
    });
  }

  /**
   * A NEW committee starts owned by the organisation — ACC-135.
   *
   * Only on create, and only when the field is still empty: an EDIT already
   * patched the committee's own unit in, and overwriting that with the root would
   * silently move it.
   *
   * TWO ACTIVE ROOTS PREFILLS NOTHING. That is an ACC-134 violation rather than a
   * choice between them, and the backend refuses it with a message naming both.
   * Picking one here would hide that refusal behind a value the user never chose.
   */
  private prefillRootUnit(units: OrgUnitDto[]): void {
    if (this.committee() || this.form.controls.orgUnitId.value) return;
    const roots = units.filter((u) => u.parentId === null && u.isActive);
    if (roots.length === 1) {
      this.form.patchValue({ orgUnitId: roots[0]!.id });
    }
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);

    const value = this.form.getRawValue();
    const dto: CreateCommitteeDto = {
      nameEn: value.nameEn!,
      nameAr: value.nameAr!,
      typeValueId: value.typeValueId!,
      purpose: value.purpose || undefined,
      quorumCount: value.quorumCount ?? undefined,
      meetingFrequency: value.meetingFrequency as CreateCommitteeDto['meetingFrequency'],
      parentCommitteeId: value.parentCommitteeId || undefined,
      orgUnitId: value.orgUnitId || undefined,
      reportingToCommitteeId: value.reportingToCommitteeId || undefined,
    };

    const current = this.committee();
    const request = current
      ? this.committeeService.update(current.id, dto)
      : this.committeeService.create(dto);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.emit();
      },
      error: () => this.saving.set(false),
    });
  }
}
