import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-accept-invitation',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, PasswordModule, ButtonModule, MessageModule],
  template: `
    <div class="flex items-center justify-center min-h-screen p-6">
      <div class="flex flex-col gap-6 w-full max-w-sm">
        <h1 class="text-xl font-semibold text-center">{{ 'auth.acceptInvitation' | translate }}</h1>

        @if (error()) {
          <p-message severity="error" [text]="error()! | translate" />
        }
        @if (success()) {
          <p-message severity="success" [text]="'auth.acceptInvitationSuccess' | translate" />
        } @else {
          <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
              <label for="password" class="text-sm font-medium">{{ 'auth.password' | translate }}</label>
              <p-password
                inputId="password"
                formControlName="password"
                [toggleMask]="true"
                styleClass="w-full"
              />
            </div>

            <p-button
              [label]="'auth.acceptInvitation' | translate"
              type="submit"
              [loading]="submitting()"
              [disabled]="!token"
              styleClass="w-full"
            />
          </form>
        }
      </div>
    </div>
  `,
})
export class AcceptInvitationComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal(false);
  readonly token = this.route.snapshot.queryParamMap.get('token');

  readonly form = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  onSubmit(): void {
    if (this.form.invalid || !this.token) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);

    this.authService.acceptInvitation(this.token, this.form.getRawValue().password!).subscribe({
      next: () => {
        this.submitting.set(false);
        this.success.set(true);
        setTimeout(() => void this.router.navigate(['/login']), 2000);
      },
      error: () => {
        this.submitting.set(false);
        this.error.set('auth.errorInvalidInvitation');
      },
    });
  }
}
