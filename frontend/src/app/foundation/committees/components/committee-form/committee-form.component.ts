import { Component, OnInit, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import {
  CommitteeService,
  CommitteeDto,
  CreateCommitteeDto,
  COMMITTEE_MEETING_FREQUENCIES,
} from '../../services/committee.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { RoleService, RoleDto } from '../../../roles/services/role.service';
import { LanguageService } from '../../../../core/services/language.service';
// ACC-42 Phase 3 — OverlaySelectComponent replaces p-select on this field:
// EditDialogComponent context. See CLAUDE.md's PrimeNG-components-only
// exception note and overlay-select.component.ts for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

type ReportingToMode = 'none' | 'committee' | 'role';

@Component({
  selector: 'app-committee-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectButtonModule,
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
          <span class="text-red-500">*</span>
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
          [options]="committeeTypes()"
          [optionLabel]="typeLabelField()"
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
        <label for="parentCommitteeId" class="text-sm font-medium">{{ 'committee.parentCommittee' | translate }}</label>
        <app-overlay-select
          formControlName="parentCommitteeId"
          [options]="parentOptions()"
          [optionLabel]="nameLabelField()"
          optionValue="id"
          [showClear]="true"
          [placeholder]="'committee.noneOption' | translate"
        />
      </div>

      <div class="flex flex-col gap-2 pt-2 border-t border-[var(--am-border)]">
        <label class="text-sm font-medium">{{ 'committee.reportingTo' | translate }}</label>
        <p-selectButton
          [options]="reportingToModeOptions"
          [(ngModel)]="reportingToMode"
          [ngModelOptions]="{ standalone: true }"
          optionValue="value"
          (onChange)="onReportingToModeChange()"
        >
          <ng-template #item let-mode>
            {{ ('committee.reportingToMode.' + mode.value) | translate }}
          </ng-template>
        </p-selectButton>

        @if (reportingToMode === 'committee') {
          <app-overlay-select
            formControlName="reportingToCommitteeId"
            [options]="parentOptions()"
            [optionLabel]="nameLabelField()"
            optionValue="id"
            [placeholder]="'committee.selectCommittee' | translate"
          />
        }

        @if (reportingToMode === 'role') {
          <app-overlay-select
            formControlName="reportingToRoleId"
            [options]="roles()"
            optionLabel="nameEn"
            optionValue="id"
            [placeholder]="'committee.selectRole' | translate"
          />
        }
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
export class CommitteeFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly committeeService = inject(CommitteeService);
  private readonly lookupService = inject(LookupService);
  private readonly roleService = inject(RoleService);
  private readonly languageService = inject(LanguageService);

  readonly committee = input<CommitteeDto | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  readonly saving = signal(false);
  readonly committeeTypes = signal<LookupValueDto[]>([]);
  readonly parentOptions = signal<CommitteeDto[]>([]);
  readonly roles = signal<RoleDto[]>([]);

  reportingToMode: ReportingToMode = 'none';

  readonly frequencyOptions = COMMITTEE_MEETING_FREQUENCIES.map((value) => ({
    value,
    label: value,
  }));

  readonly reportingToModeOptions: { value: ReportingToMode }[] = [
    { value: 'none' },
    { value: 'committee' },
    { value: 'role' },
  ];

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(150)]],
    nameAr: ['', [Validators.required, Validators.maxLength(150)]],
    typeValueId: [null as string | null, [Validators.required]],
    purpose: [''],
    quorumCount: [0, [Validators.min(0)]],
    meetingFrequency: ['AS_NEEDED'],
    parentCommitteeId: [null as string | null],
    reportingToCommitteeId: [null as string | null],
    reportingToRoleId: [null as string | null],
  });

  typeLabelField(): 'labelAr' | 'labelEn' {
    return this.languageService.isArabic() ? 'labelAr' : 'labelEn';
  }

  nameLabelField(): 'nameAr' | 'nameEn' {
    return this.languageService.isArabic() ? 'nameAr' : 'nameEn';
  }

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
          reportingToCommitteeId: current.reportingToCommitteeId,
          reportingToRoleId: current.reportingToRoleId,
        });
        this.reportingToMode = current.reportingToCommitteeId
          ? 'committee'
          : current.reportingToRoleId
            ? 'role'
            : 'none';
      }
    });
  }

  ngOnInit(): void {
    this.lookupService.getValues('committee_type').subscribe({ next: (values) => this.committeeTypes.set(values) });
    this.roleService.listRoles().subscribe({ next: (roles) => this.roles.set(roles) });
    this.committeeService.listCommittees().subscribe({
      next: (committees) => {
        const currentId = this.committee()?.id;
        this.parentOptions.set(currentId ? committees.filter((c) => c.id !== currentId) : committees);
      },
    });
  }

  onReportingToModeChange(): void {
    if (this.reportingToMode !== 'committee') {
      this.form.patchValue({ reportingToCommitteeId: null });
    }
    if (this.reportingToMode !== 'role') {
      this.form.patchValue({ reportingToRoleId: null });
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
      reportingToCommitteeId: value.reportingToCommitteeId || undefined,
      reportingToRoleId: value.reportingToRoleId || undefined,
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
