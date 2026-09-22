// ACC-122 — "You'll be signed out in 2 minutes. Stay signed in?"
//
// WCAG 2.2.1 (Timing Adjustable) is the reason this exists rather than a
// silent sign-out: a time limit is allowed when the user is warned before it
// expires and can extend it with a simple action. Two minutes is well past
// the twenty seconds the criterion asks for, and "Stay signed in" is the
// simple action.
//
// Built on EditDialogComponent so it inherits the shell every other dialog
// uses — including registration with LayerStackService, which is what makes
// Escape resolve to the TOP layer. Without that, Escape over this warning
// could close the form behind it, which on a dirty form is the exact loss of
// work the ticket is about.
//
// role="alertdialog", not "dialog": the announcement has to reach a screen
// reader when it appears, not when focus happens to land on it. The countdown
// then lives in a polite live region — assertive would interrupt the user
// every single second, which is worse than not announcing it at all.
//
// ESCAPE MEANS "STAY SIGNED IN" HERE, deliberately. Every exit from this
// dialog other than the countdown running out is the user telling us they are
// present, and dismissing a warning is not consent to be signed out.

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TranslatePipe } from '@ngx-translate/core';
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { FormatService } from '../../formatting';
import { IdleService } from '../../services/idle.service';

@Component({
  selector: 'app-idle-warning',
  standalone: true,
  imports: [EditDialogComponent, ButtonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-edit-dialog
      [visible]="idle.warningVisible()"
      (visibleChange)="onVisibleChange($event)"
      [header]="'session.idle.title' | translate"
      role="alertdialog"
      size="confirm"
      [content]="body"
      [footer]="actions"
    />

    <ng-template #body>
      <p class="text-sm text-[var(--am-text-primary)]">
        {{ 'session.idle.message' | translate }}
      </p>

      <!-- The live countdown. polite, so it is announced between the user's
           own actions rather than cutting across them once a second. -->
      <p
        class="mt-2 text-sm font-medium"
        aria-live="polite"
        [attr.aria-label]="remainingLabel()"
      >
        {{ remainingLabel() }}
      </p>

      <!-- ACC-122 — said out loud rather than assumed. The sign-out cannot
           save an open form, so a user with unsaved work needs to be told
           that staying signed in is how they keep it. -->
      <p class="mt-3 text-sm text-[var(--am-text-secondary)]">
        {{ 'session.idle.unsavedWarning' | translate }}
      </p>
    </ng-template>

    <ng-template #actions>
      <div class="flex justify-end gap-2">
        <p-button
          [label]="'session.idle.signOutNow' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="onSignOut()"
        />
        <!-- Focused on open: the safe action is the easy one, and a user who
             presses Enter on the warning stays signed in. -->
        <p-button
          [label]="'session.idle.staySignedIn' | translate"
          [autofocus]="true"
          (onClick)="onStay()"
        />
      </div>
    </ng-template>
  `,
})
export class IdleWarningComponent {
  protected readonly idle = inject(IdleService);
  private readonly format = inject(FormatService);

  /** "Signing out in 45 seconds" — through the ACC-94 layer, never Intl. */
  protected readonly remainingLabel = computed(() =>
    this.format.count('session.secondsRemaining', this.idle.secondsRemaining()),
  );

  protected onStay(): void {
    this.idle.extend();
  }

  protected onSignOut(): void {
    void this.idle.signOut('user');
  }

  /**
   * Any dismissal that is not the countdown expiring — Escape, the shell's
   * own close path — is the user saying they are here.
   */
  protected onVisibleChange(visible: boolean): void {
    if (!visible) this.idle.extend();
  }
}
