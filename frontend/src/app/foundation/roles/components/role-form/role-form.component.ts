import { Component, Input, Output, EventEmitter, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';
import { RoleService, RoleDto, CreateRoleDto, UpdateRoleDto } from '../../services/role.service';

@Component({
  selector: 'app-role-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    MessageModule,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">

      @if (role?.isSystem) {
        <p-message severity="info" [text]="'roles.systemRoleKeyLocked' | translate" />
      }

      <div class="flex flex-col gap-1">
        <label for="nameEn" class="font-medium text-sm">
          {{ 'roles.nameEn' | translate }} <span class="text-red-500">*</span>
        </label>
        <input id="nameEn" pInputText formControlName="nameEn" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="nameAr" class="font-medium text-sm">
          {{ 'roles.nameAr' | translate }} <span class="text-red-500">*</span>
        </label>
        <input id="nameAr" pInputText dir="rtl" formControlName="nameAr" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="description" class="font-medium text-sm">
          {{ 'roles.description' | translate }}
        </label>
        <textarea id="description" pTextarea rows="3" formControlName="description"></textarea>
      </div>

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
          [label]="(role ? 'common.save' : 'common.add') | translate"
          [loading]="saving()"
          [disabled]="form.invalid"
        />
      </div>

    </form>
  `,
})
export class RoleFormComponent implements OnInit {
  @Input() role: RoleDto | null = null;
  @Output() saved = new EventEmitter<RoleDto>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly roleService = inject(RoleService);
  private readonly fb = inject(FormBuilder);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(100)]],
    nameAr: ['', [Validators.required, Validators.maxLength(100)]],
    description: ['', [Validators.maxLength(500)]],
  });

  ngOnInit(): void {
    if (this.role) {
      this.form.patchValue({
        nameEn: this.role.nameEn,
        nameAr: this.role.nameAr,
        description: this.role.description ?? '',
      });
    }
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.saveError.set(null);

    const raw = this.form.getRawValue();

    const request$ = this.role
      ? this.roleService.updateRole(this.role.id, {
          nameEn: raw.nameEn ?? undefined,
          nameAr: raw.nameAr ?? undefined,
          description: raw.description ?? undefined,
        } satisfies UpdateRoleDto)
      : this.roleService.createRole({
          nameEn: raw.nameEn!,
          nameAr: raw.nameAr!,
          ...(raw.description ? { description: raw.description } : {}),
        } satisfies CreateRoleDto);

    request$.subscribe({
      next: (role) => {
        this.saving.set(false);
        this.saved.emit(role);
      },
      error: (err: { error?: { message?: string } }) => {
        this.saveError.set(err?.error?.message ?? 'Save failed');
        this.saving.set(false);
      },
    });
  }
}
