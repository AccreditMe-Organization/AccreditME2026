import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { PasswordInputComponent } from '../../../../shared/components/password-input/password-input.component';
import { StepStripComponent, StepStripItem } from '../../../../shared/components/step-strip/step-strip.component';
import { AuthService, MfaSetupResult } from '../../../../core/services/auth.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

const STEPS: readonly StepStripItem[] = [
  { n: 1, key: 'userRecord.twoStep.stepPassword' },
  { n: 2, key: 'userRecord.twoStep.stepApp' },
];

/**
 * Set up two-step sign-in — ACC-120 slice 5, moved off the profile page,
 * where it was an inline form, onto the dialog shell. The requests are the
 * same, in the same order, and nothing else changed:
 *
 *   1. POST /auth/mfa/setup {password}        → the QR code and the secret
 *   2. POST /auth/mfa/setup/verify {code}     → two-step sign-in is on
 *
 * The two steps are the flow's own seam, not a split for height: the second
 * step's content does not exist until the first request returns.
 *
 * The backup codes the setup response carries are NEVER rendered — the page
 * never showed them, and this does not start. A spec pins it.
 *
 * Closing after step 1 abandons a secret that was issued and never verified:
 * the dialog counts that as unsaved work and asks first.
 */
@Component({
  selector: 'app-two-step-setup-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    EditDialogComponent,
    FieldComponent,
    PasswordInputComponent,
    StepStripComponent,
  ],
  template: `
    <ng-template #stepsTpl>
      <am-step-strip [steps]="steps" [current]="step()" [ariaLabel]="'userRecord.twoStep.setupTitle' | translate" />
    </ng-template>
    <ng-template #bodyTpl>
      @if (step() === 1) {
        <form [formGroup]="passwordForm" (ngSubmit)="start()" class="flex flex-col" data-two-step-password>
          <p class="am-two-step-intro">{{ 'userRecord.twoStep.passwordIntro' | translate }}</p>
          <am-field
            [label]="'user.mfa.password' | translate"
            [control]="passwordForm.controls.password"
            inputId="two-step-password"
            [forceShowErrors]="showErrors()"
            [errorMessages]="{ required: 'userRecord.twoStep.passwordRequired' }"
          >
            <am-password-input inputId="two-step-password" formControlName="password" autocomplete="current-password" />
          </am-field>
        </form>
      } @else if (setup(); as s) {
        <form [formGroup]="codeForm" (ngSubmit)="verify()" class="flex flex-col" data-two-step-code>
          <p class="am-two-step-intro">{{ 'user.mfa.scanQrCode' | translate }}</p>
          <img [src]="s.qrCodeDataUrl" [attr.alt]="'user.mfa.scanQrCode' | translate" class="am-two-step-qr" />
          <p class="am-two-step-intro">
            {{ 'user.mfa.manualEntryKey' | translate }}
            <code dir="ltr" class="font-mono [unicode-bidi:isolate]" data-two-step-secret>{{ s.secret }}</code>
          </p>
          <am-field
            [label]="'user.mfa.verificationCode' | translate"
            [control]="codeForm.controls.code"
            inputId="two-step-code"
            [forceShowErrors]="showErrors()"
            [errorMessages]="{
              required: 'userRecord.twoStep.codeInvalid',
              minlength: 'userRecord.twoStep.codeInvalid',
              maxlength: 'userRecord.twoStep.codeInvalid',
            }"
          >
            <input
              pInputText
              dir="ltr"
              id="two-step-code"
              formControlName="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
            />
          </am-field>
        </form>
      }
      @if (error()) {
        <p class="am-two-step-error" role="alert">{{ error()! | translate }}</p>
      }
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
        @if (step() === 1) {
          <p-button
            type="button"
            [label]="'userRecord.twoStep.continue' | translate"
            [loading]="busy()"
            (onClick)="start()"
            data-two-step-continue
          />
        } @else {
          <p-button
            type="button"
            [label]="'user.mfa.verifyAndActivate' | translate"
            [loading]="busy()"
            (onClick)="verify()"
            data-two-step-verify
          />
        }
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'userRecord.twoStep.setupTitle' | translate"
      [headerExtra]="stepsTpl"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="passwordForm.dirty || step() === 2"
      [saving]="busy()"
      size="form"
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
      .am-two-step-qr {
        inline-size: 160px;
        block-size: 160px;
        margin: 0 0 var(--am-space-12);
      }
      .am-two-step-error {
        margin: 0;
        font-size: var(--am-type-meta-size);
        color: var(--am-danger-ink);
      }
    `,
  ],
})
export class TwoStepSetupDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);

  readonly visible = input.required<boolean>();
  readonly visibleChange = output<boolean>();
  /** Two-step sign-in is now on. */
  readonly enabled = output<void>();

  readonly steps = STEPS;
  readonly step = signal<1 | 2>(1);
  readonly setup = signal<MfaSetupResult | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);

  readonly passwordForm = this.fb.nonNullable.group({ password: ['', [Validators.required]] });
  readonly codeForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
  });

  constructor() {
    // Each opening starts at step one with nothing typed.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.step.set(1);
        this.setup.set(null);
        this.passwordForm.reset();
        this.codeForm.reset();
        this.error.set(null);
        this.showErrors.set(false);
      });
    });
  }

  start(): void {
    if (this.busy()) return;
    if (this.passwordForm.invalid) {
      this.showErrors.set(true);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.authService.setupMfa(this.passwordForm.getRawValue().password).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.setup.set(result);
        this.passwordForm.reset();
        this.showErrors.set(false);
        this.step.set(2);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(extractErrorMessage(err, 'user.mfa.errorSetup'));
      },
    });
  }

  verify(): void {
    if (this.busy()) return;
    if (this.codeForm.invalid) {
      this.showErrors.set(true);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.authService.verifyAndEnableMfa(this.codeForm.getRawValue().code).subscribe({
      next: () => {
        this.busy.set(false);
        // Nothing left to lose: clear what made the dialog "dirty" first.
        this.step.set(1);
        this.setup.set(null);
        this.enabled.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(extractErrorMessage(err, 'user.mfa.errorVerify'));
      },
    });
  }
}
