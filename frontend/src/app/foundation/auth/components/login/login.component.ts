import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    MessageModule,
  ],
  template: `
    <div class="flex items-center justify-center min-h-screen p-6">
      <div class="flex flex-col gap-6 w-full max-w-sm">
        <h1 class="text-xl font-semibold text-center">{{ 'auth.login' | translate }}</h1>

        @if (error()) {
          <p-message severity="error" [text]="error()!" />
        }

        @if (!mfaRequired()) {
          <form [formGroup]="loginForm" (ngSubmit)="onSubmitLogin()" class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
              <label for="organizationSlug" class="text-sm font-medium">
                {{ 'auth.organization' | translate }}
              </label>
              <input pInputText id="organizationSlug" formControlName="organizationSlug" />
            </div>

            <div class="flex flex-col gap-1">
              <label for="email" class="text-sm font-medium">{{ 'auth.email' | translate }}</label>
              <input pInputText id="email" type="email" formControlName="email" />
            </div>

            <div class="flex flex-col gap-1">
              <label for="password" class="text-sm font-medium">{{ 'auth.password' | translate }}</label>
              <p-password
                inputId="password"
                formControlName="password"
                [feedback]="false"
                [toggleMask]="true"
                styleClass="w-full"
              />
            </div>

            <p-button
              [label]="'auth.login' | translate"
              type="submit"
              [loading]="submitting()"
              styleClass="w-full"
            />

            <a routerLink="/forgot-password" class="text-sm text-center underline">
              {{ 'auth.forgotPassword' | translate }}
            </a>
          </form>
        } @else {
          <form [formGroup]="mfaForm" (ngSubmit)="onSubmitMfa()" class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
              <label for="code" class="text-sm font-medium">{{ 'auth.mfaCode' | translate }}</label>
              <input pInputText id="code" formControlName="code" maxlength="6" />
            </div>

            <p-button
              [label]="'auth.login' | translate"
              type="submit"
              [loading]="submitting()"
              styleClass="w-full"
            />
          </form>
        }
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly mfaRequired = signal(false);

  readonly loginForm = this.fb.group({
    organizationSlug: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  readonly mfaForm = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
  });

  onSubmitLogin(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);

    const { organizationSlug, email, password } = this.loginForm.getRawValue();
    this.authService.login(organizationSlug!, email!, password!).subscribe({
      next: (result) => {
        this.submitting.set(false);
        if (result.mfaRequired) {
          this.mfaRequired.set(true);
          return;
        }
        void this.router.navigate(['/organization']);
      },
      error: () => {
        this.submitting.set(false);
        this.error.set('auth.errorInvalidCredentials');
      },
    });
  }

  onSubmitMfa(): void {
    if (this.mfaForm.invalid) {
      this.mfaForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);

    const { code } = this.mfaForm.getRawValue();
    this.authService.verifyMfa(code!).subscribe({
      next: () => {
        this.submitting.set(false);
        void this.router.navigate(['/organization']);
      },
      error: () => {
        this.submitting.set(false);
        this.error.set('auth.errorMfaRequired');
      },
    });
  }
}
