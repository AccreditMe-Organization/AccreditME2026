// ACC-122 — the idle warning: "Stay signed in?" over a live countdown.
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
// reader when it appears, not when focus happens to land on it.
//
// The countdown is then split in two, which is the non-obvious part. The
// VISIBLE number ticks every second and is aria-hidden. A separate sr-only
// live region carries the same sentence but only at milestones, because
// aria-live="polite" queues rather than replaces: 120 updates would be read
// out one after another, long after the dialog had gone, drowning the page.
// Assertive is worse still — it interrupts every second. See
// ANNOUNCE_AT_SECONDS in idle.service.ts.
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
      <!-- ONE statement of the time, and it is the live one.
           There used to be a fixed line above this reading "You'll be signed
           out in 2 minutes", which was wrong from the first tick: by the time
           anyone read it the countdown beneath already said 117 seconds. Two
           numbers for one fact means one of them is always stale, and the
           stale one was the one in larger type. -->
      <p class="text-sm font-medium text-[var(--am-text-primary)]" aria-hidden="true">
        {{ remainingLabel() }}
      </p>

      <!-- The announcement channel, separate from the visible number above.
           aria-live="polite" QUEUES rather than replaces, so a value changing
           once a second for two minutes builds a backlog that drowns out
           everything else on the page — including whatever the user does to
           dismiss this. IdleService therefore moves announceSeconds() only at
           milestones (2 min, 1 min, 30s, then the last ten), while the
           visible text keeps ticking every second. -->
      <p class="sr-only" role="status" aria-live="polite">
        {{ announcement() }}
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

  /**
   * The same sentence, but only at the milestones IdleService publishes.
   * Empty between them, so the live region stays silent rather than queueing.
   */
  protected readonly announcement = computed(() => {
    const seconds = this.idle.announceSeconds();
    return seconds === null ? '' : this.format.count('session.secondsRemaining', seconds);
  });

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
