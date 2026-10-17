import { Component, Input, Output, EventEmitter, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';
import { RoleService, RoleDto, CreateRoleDto, UpdateRoleDto } from '../../services/role.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { FieldComponent } from '../../../../shared/components/field/field.component';

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
    FieldComponent,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col">

      @if (role?.isSystem) {
        <p-message severity="info" [text]="'roles.systemRoleKeyLocked' | translate" />
      }

      <!-- ACC-235 — every field in am-field, so a submit shows its errors
           under the field (the wrapper reads the form's own submitted). -->
      <am-field
        [label]="'roles.nameEn' | translate"
        [control]="form.controls.nameEn"
        inputId="nameEn"
        [errorMessages]="{ required: 'roles.form.nameRequired', maxlength: 'roles.form.nameTooLong' }"
        [forceShowErrors]="showErrors()"
      >
        <input id="nameEn" pInputText formControlName="nameEn" class="w-full" />
      </am-field>

      <am-field
        [label]="'roles.nameAr' | translate"
        [control]="form.controls.nameAr"
        inputId="nameAr"
        [errorMessages]="{ maxlength: 'roles.form.nameTooLong' }"
        [forceShowErrors]="showErrors()"
      >
        <input id="nameAr" pInputText dir="rtl" formControlName="nameAr" class="w-full" />
      </am-field>

      <am-field
        [label]="'roles.description' | translate"
        [control]="form.controls.description"
        inputId="description"
        [errorMessages]="{ maxlength: 'roles.form.descriptionTooLong' }"
        [forceShowErrors]="showErrors()"
      >
        <textarea id="description" pTextarea rows="3" formControlName="description" class="w-full"></textarea>
      </am-field>

      @if (saveError()) {
        <p class="text-meta text-[var(--am-danger-ink)] m-0 mb-2" role="alert" data-testid="role-save-error">{{ saveError() | translate }}</p>
      }

      <!-- Cancel and Save live in the dialog's FOOTER (role-list), outside the
           420px body: measured, an Arabic system role's Edit reached 420 and
           scrolled at 390px wide with them inside. Enter in a field still
           submits, through the form. -->
    </form>
  `,
})
export class RoleFormComponent implements OnInit {
  @Input() role: RoleDto | null = null;
  @Output() saved = new EventEmitter<RoleDto>();
  /**
   * Hands this instance to the host, whose FOOTER drives it (Cancel, Save) —
   * the shape invite-user uses. A footer Save is not a form submit, so it
   * reveals the field errors through showErrors.
   */
  @Output() ready = new EventEmitter<RoleFormComponent>();
  /** ACC-235 — the dialog's [dirty] lives on the dialog, so the state travels out (ACC-96). */
  @Output() dirtyChange = new EventEmitter<boolean>();

  private readonly roleService = inject(RoleService);
  private readonly fb = inject(FormBuilder);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly showErrors = signal(false);

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(100)]],
    // ACC-160 — the Arabic name is OPTIONAL: Arabic fields are never mandatory,
    // because the product is sold to customers who do not operate in Arabic.
    // maxLength stays. An emptied field is sent as '' and stored as NULL by the
    // DTO's trimToNull, so the empty-to-null decision lives in one place.
    nameAr: ['', [Validators.maxLength(100)]],
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
    // Each opening is a new form, so the host's dirty flag starts clean too.
    this.dirtyChange.emit(false);
    this.ready.emit(this);
    this.form.valueChanges.subscribe(() => this.dirtyChange.emit(this.form.dirty));
  }

  onSubmit(): void {
    // Save stays enabled: a disabled Save says nothing about why, and the
    // submit is what makes each field show its error.
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.form.markAllAsTouched();
      return;
    }
    if (this.saving()) return;
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
        this.form.markAsPristine();
        this.dirtyChange.emit(false);
        this.saved.emit(role);
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, 'Save failed'));
        this.saving.set(false);
      },
    });
  }
}
