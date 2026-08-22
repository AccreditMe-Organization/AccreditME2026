import { Component, OnInit, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { OrgPositionService, IOrgPositionDto } from '../../services/org-position.service';
import { RoleService, RoleDto } from '../../../roles/services/role.service';

@Component({
  selector: 'app-position-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    CheckboxModule,
    ButtonModule,
  ],
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

      <div class="flex items-center gap-2">
        <p-checkbox inputId="isSingleAssignee" formControlName="isSingleAssignee" [binary]="true" />
        <label for="isSingleAssignee" class="text-sm font-medium">
          {{ 'orgPosition.isSingleAssignee' | translate }}
        </label>
      </div>
      <small class="text-[var(--am-text-secondary)] -mt-3">
        {{ 'orgPosition.isSingleAssigneeHint' | translate }}
      </small>

      <div class="flex items-center gap-2">
        <p-checkbox
          inputId="isUnitHeadPosition"
          formControlName="isUnitHeadPosition"
          [binary]="true"
          [disabled]="!form.value.isSingleAssignee"
        />
        <label for="isUnitHeadPosition" class="text-sm font-medium">
          {{ 'orgPosition.isUnitHeadPosition' | translate }}
        </label>
      </div>
      <small class="text-[var(--am-text-secondary)] -mt-3">
        {{ 'orgPosition.isUnitHeadPositionHint' | translate }}
      </small>

      <div class="flex flex-col gap-1">
        <label for="roleId" class="text-sm font-medium">{{ 'orgPosition.mappedRole' | translate }}</label>
        <p-select
          inputId="roleId"
          formControlName="roleId"
          [options]="assignableRoles()"
          optionLabel="nameEn"
          optionValue="id"
          [showClear]="true"
          [placeholder]="'orgPosition.mappedRolePlaceholder' | translate"
        />
        <small class="text-[var(--am-text-secondary)]">{{ 'orgPosition.mappedRoleHint' | translate }}</small>
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
  private readonly roleService = inject(RoleService);

  readonly position = input<IOrgPositionDto | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  readonly saving = signal(false);
  readonly allRoles = signal<RoleDto[]>([]);

  // ACC-40 Section 2.9c — hard-excludes PLATFORM_ADMIN/TENANT_ADMIN from this
  // one picker, same reasoning and same shape as UserRoleAssignmentComponent's
  // existing PLATFORM_ADMIN exclusion, extended one role further here.
  get assignableRoles(): () => RoleDto[] {
    return () =>
      this.allRoles().filter((r) => r.isActive && r.key !== 'PLATFORM_ADMIN' && r.key !== 'TENANT_ADMIN');
  }

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(100)]],
    nameAr: ['', [Validators.maxLength(100)]],
    grade: [5, [Validators.required, Validators.min(1), Validators.max(10)]],
    isSingleAssignee: [false],
    isUnitHeadPosition: [false],
    roleId: [null as string | null],
  });

  constructor() {
    effect(() => {
      const current = this.position();
      if (current) {
        this.form.patchValue({
          nameEn: current.nameEn,
          nameAr: current.nameAr ?? '',
          grade: current.grade,
          isSingleAssignee: current.isSingleAssignee,
          isUnitHeadPosition: current.isUnitHeadPosition,
          roleId: current.roleId,
        });
      }
    });

    // isUnitHeadPosition requires isSingleAssignee (ACC-40 Section 2.1) —
    // unchecking isSingleAssignee clears isUnitHeadPosition too, matching
    // the disabled state above rather than leaving a stale checked-but-
    // disabled control that would fail the server-side check on submit.
    // valueChanges, not effect() — FormGroup.value is a plain getter, not a
    // signal, so effect() would only ever run once at construction time.
    this.form.get('isSingleAssignee')!.valueChanges.subscribe((isSingleAssignee) => {
      if (!isSingleAssignee && this.form.value.isUnitHeadPosition) {
        this.form.patchValue({ isUnitHeadPosition: false });
      }
    });
  }

  ngOnInit(): void {
    this.roleService.listRoles().subscribe({ next: (roles) => this.allRoles.set(roles) });
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
      isSingleAssignee: value.isSingleAssignee ?? false,
      isUnitHeadPosition: value.isUnitHeadPosition ?? false,
      roleId: value.roleId || undefined,
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
