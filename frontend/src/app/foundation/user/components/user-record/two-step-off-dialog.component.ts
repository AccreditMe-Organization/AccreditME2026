import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { PasswordInputComponent } from '../../../../shared/components/password-input/password-input.component';
import { AuthService } from '../../../../core/services/auth.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

/**
 * Turn off two-step sign-in — ACC-120 slice 5, moved off the profile page onto
 * the dialog shell. The page asked for the password inline, then confirmed;
 * this dialog is that confirmation, with the password in it, and sends the
 * same request: POST /auth/mfa/disable {password}.
 *
 * KNOWN BROKEN, AND LEFT AS IT IS (CC-88, D9): for an account that has
 * two-step sign-in on, the server refuses every attempt with "Invalid
 * password", whatever is typed — `AuthService.disableMfa()` re-checks the
 * password through a sign-in, and that sign-in answers with the two-step
 * challenge instead of a user. ACC-164 owns the fix. Until then this dialog
 * shows the refusal the server sends, exactly as the page did.
 */
@Component({
  selector: 'app-two-step-off-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, EditDialogComponent, FieldComponent, PasswordInputComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col">
        <p class="am-two-step-intro">{{ 'user.mfa.disableConfirmMessage' | translate }}</p>
        <am-field
          [label]="'user.mfa.password' | translate"
          [control]="form.controls.password"
          inputId="two-step-off-password"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ required: 'userRecord.twoStep.passwordRequired' }"
        >
          <am-password-input inputId="two-step-off-password" formControlName="password" autocomplete="current-password" />
        </am-field>
        @if (error()) {
          <p class="am-two-step-error" role="alert">{{ error()! | translate }}</p>
        }
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="busy()"
          (onClick)="dialog.requestClose()"
        />
        <p-button
          type="button"
          severity="danger"
          [label]="'userRecord.twoStep.turnOff' | translate"
          [loading]="busy()"
          (onClick)="submit()"
          data-two-step-off-confirm
        />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'userRecord.twoStep.offTitle' | translate"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="busy()"
      role="alertdialog"
      size="confirm"
    />
  `,
  styles: [
    `
      .am-two-step-intro {
        margin: 0 0 var(--am-space-12);
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-500);
      }
      .am-two-step-error {
        margin: 0;
        font-size: var(--am-type-meta-size);
        color: var(--am-danger-ink);
      }
    `,
  ],
})
export class TwoStepOffDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);

  readonly visible = input.required<boolean>();
  readonly visibleChange = output<boolean>();
  /** Two-step sign-in is now off. */
  readonly disabled = output<void>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly form = this.fb.nonNullable.group({ password: ['', [Validators.required]] });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.form.reset();
        this.error.set(null);
        this.showErrors.set(false);
      });
    });
  }

  submit(): void {
    if (this.busy()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.authService.disableMfa(this.form.getRawValue().password).subscribe({
      next: () => {
        this.busy.set(false);
        this.form.markAsPristine();
        this.disabled.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(extractErrorMessage(err, 'user.mfa.errorDisable'));
      },
    });
  }
}
