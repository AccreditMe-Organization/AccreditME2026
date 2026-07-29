import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, InputTextModule, ButtonModule, MessageModule],
  template: `
    <div class="flex items-center justify-center min-h-screen p-6">
      <div class="flex flex-col gap-6 w-full max-w-sm">
        <h1 class="text-xl font-semibold text-center">{{ 'auth.forgotPassword' | translate }}</h1>

        @if (submitted()) {
          <p-message severity="info" [text]="'auth.forgotPasswordSent' | translate" />
        } @else {
          <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
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

            <p-button
              [label]="'auth.forgotPassword' | translate"
              type="submit"
              [loading]="submitting()"
              styleClass="w-full"
            />
          </form>
        }

        <a routerLink="/login" class="text-sm text-center underline">{{ 'auth.login' | translate }}</a>
      </div>
    </div>
  `,
})
export class ForgotPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);

  readonly submitting = signal(false);
  readonly submitted = signal(false);

  readonly form = this.fb.group({
    organizationSlug: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
  });

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);

    const { organizationSlug, email } = this.form.getRawValue();
    // Always shows the same success state regardless of outcome — the
    // backend deliberately never reveals whether the org/email exists
    // (enumeration protection), so the UI shouldn't either.
    this.authService.forgotPassword(organizationSlug!, email!).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submitted.set(true);
      },
      error: () => {
        this.submitting.set(false);
        this.submitted.set(true);
      },
    });
  }
}
