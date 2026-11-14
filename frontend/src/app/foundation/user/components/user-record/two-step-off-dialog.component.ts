import { Component, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { PasswordInputComponent } from '../../../../shared/components/password-input/password-input.component';
import { AuthService } from '../../../../core/services/auth.service';
import { FormatService } from '../../../../core/formatting';
import { TurnOffRefusal, describeTurnOffRefusal } from './two-step-refusal';
import { TwoStepMessageComponent } from './two-step-message.component';

/**
 * Turn off two-step sign-in, on your own record — ACC-164, built to "AccreditMe
 * Two-step Sign-in" screen 1. POST /auth/mfa/disable {password, code}.
 *
 * A 420 confirm with two fields (the design's Q1). Focus starts on Password
 * (Q2). Where each refusal goes is two-step-refusal.ts:
 *   - a wrong password: under Password, which is cleared and focused; the code
 *     is kept (Q3);
 *   - a wrong code: under Code, which is cleared and focused, with "1 or 2
 *     attempts left" on its own line when the server sends that count;
 *   - locked, and unreachable: a red message above the buttons;
 *   - already off: a blue message, and the buttons become Close (Q7). Closing
 *     refreshes the panel.
 * There is no "code expired" state: the server never sends one (plan §0b).
 *
 * While sending, both fields are read-only, Cancel is disabled, and Escape and
 * the backdrop do nothing (Q10): the dialog's `saving` disarms them. Turn off is
 * never disabled otherwise.
 */
@Component({
  selector: 'app-two-step-off-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, EditDialogComponent, FieldComponent, PasswordInputComponent, TwoStepMessageComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3" data-two-step-off-form>
        <p class="am-two-step-intro">{{ 'userRecord.twoStep.intro' | translate }}</p>
        <am-field
          [label]="'user.mfa.password' | translate"
          [control]="form.controls.password"
          inputId="two-step-off-password"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ required: 'userRecord.twoStep.passwordRequired', server: 'userRecord.twoStep.passwordWrong' }"
        >
          <am-password-input inputId="two-step-off-password" formControlName="password" autocomplete="current-password" />
        </am-field>
        <div class="flex flex-col">
          <am-field
            [label]="'userRecord.twoStep.code' | translate"
            [control]="form.controls.code"
            inputId="two-step-off-code"
            [hint]="'userRecord.twoStep.codeHint' | translate"
            [forceShowErrors]="showErrors()"
            [errorMessages]="{
              required: 'userRecord.twoStep.codeInvalid',
              pattern: 'userRecord.twoStep.codeInvalid',
              server: 'auth.signIn.errors.mfaInvalid',
            }"
          >
            <input
              pInputText
              dir="ltr"
              id="two-step-off-code"
              class="am-two-step-code"
              formControlName="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              data-two-step-off-code
            />
          </am-field>
          @if (attemptsLine(); as line) {
            <p class="am-two-step-attempts" data-two-step-attempts>{{ line }}</p>
          }
        </div>
        @if (message(); as m) {
          <am-two-step-message [tone]="m.tone" [text]="m.text" data-two-step-off-message />
        }
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        @if (closeOnly()) {
          <p-button
            [label]="'common.close' | translate"
            severity="secondary"
            [outlined]="true"
            type="button"
            (onClick)="close()"
            data-two-step-off-close
          />
        } @else {
          <p-button
            [label]="'common.cancel' | translate"
            severity="secondary"
            [text]="true"
            type="button"
            [disabled]="busy()"
            (onClick)="dialog.requestClose()"
            data-two-step-off-cancel
          />
          <p-button
            type="button"
            severity="danger"
            [label]="'userRecord.twoStep.turnOff' | translate"
            [loading]="busy()"
            (onClick)="submit()"
            data-two-step-off-confirm
          />
        }
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      [header]="'userRecord.twoStep.offTitle' | translate"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty && !closeOnly()"
      [saving]="busy()"
      role="alertdialog"
      size="confirm"
    />
  `,
  styles: [
    `
      .am-two-step-intro {
        margin: 0;
        font-size: var(--am-type-body-size);
        line-height: var(--am-type-body-line);
        color: var(--am-ink-700);
      }
      .am-two-step-code {
        letter-spacing: 0.28em;
        font-variant-numeric: tabular-nums;
        unicode-bidi: isolate;
      }
      .am-two-step-attempts {
        margin: 0;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        font-weight: 500;
        color: var(--am-danger-ink);
      }
    `,
  ],
})
export class TwoStepOffDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly injector = inject(Injector);

  readonly visible = input.required<boolean>();
  readonly visibleChange = output<boolean>();
  /** Two-step sign-in is now off. */
  readonly disabled = output<void>();
  /** Closed after "already off": the panel should read the status again. */
  readonly stale = output<void>();

  readonly busy = signal(false);
  readonly showErrors = signal(false);
  readonly refusal = signal<TurnOffRefusal | null>(null);
  readonly form = this.fb.nonNullable.group({
    password: ['', [Validators.required]],
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  readonly closeOnly = computed(() => this.refusal()?.closeOnly === true);

  /** A message about no field: locked, already off, unreachable. */
  readonly message = computed(() => {
    this.translate.currentLang();
    const r = this.refusal();
    if (!r || r.field) return null;
    const text = r.until
      ? this.translate.instant(r.key, { when: this.format.relative(r.until) })
      : this.translate.instant(r.key);
    return { tone: r.tone, text };
  });

  readonly attemptsLine = computed(() => {
    this.translate.currentLang();
    const left = this.refusal()?.attemptsLeft;
    return left ? this.format.count('auth.twoStepAttemptsLeft', left) : null;
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.form.reset();
        this.form.enable();
        this.refusal.set(null);
        this.showErrors.set(false);
      });
    });
    // A server refusal belongs to the value it judged: typing clears it.
    for (const name of ['password', 'code'] as const) {
      this.form.controls[name].valueChanges.subscribe(() => {
        if (this.refusal()?.field === name) this.refusal.set(null);
      });
    }
  }

  onVisibleChange(visible: boolean): void {
    if (!visible && this.closeOnly()) this.stale.emit();
    this.visibleChange.emit(visible);
  }

  close(): void {
    this.onVisibleChange(false);
  }

  submit(): void {
    if (this.busy() || this.closeOnly()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.focus(this.form.controls.password.invalid ? 'password' : 'code');
      return;
    }
    const { password, code } = this.form.getRawValue();
    this.busy.set(true);
    this.refusal.set(null);
    this.form.disable({ emitEvent: false });
    this.authService.disableMfa(password, code).subscribe({
      next: () => {
        this.busy.set(false);
        this.form.enable({ emitEvent: false });
        this.form.markAsPristine();
        this.disabled.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.form.enable({ emitEvent: false });
        const refusal = describeTurnOffRefusal(err);
        if (refusal.field) {
          // Clear and focus the field that was wrong; keep the other.
          const control = this.form.controls[refusal.field];
          control.setValue('', { emitEvent: false });
          control.setErrors({ server: true });
          control.markAsTouched();
          this.showErrors.set(true);
          this.focus(refusal.field);
        }
        this.refusal.set(refusal);
      },
    });
  }

  private focus(field: 'password' | 'code'): void {
    afterNextRender(
      {
        write: () =>
          document.getElementById(field === 'password' ? 'two-step-off-password' : 'two-step-off-code')?.focus(),
      },
      { injector: this.injector },
    );
  }
}
