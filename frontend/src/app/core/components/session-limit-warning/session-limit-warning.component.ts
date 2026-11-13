// ACC-126 — "Your session ends soon": shown once, 10 minutes before the
// session's 12-hour limit, then the sign-out.
//
// Built like the idle warning (ACC-122): EditDialogComponent, so Escape
// resolves to the top layer through LayerStackService, and role="alertdialog",
// so a screen reader hears it when it appears.
//
// Unlike the idle warning there is no "Stay signed in" and no countdown: the
// session cannot be extended, so the dialog states WHEN it ends (one clock time,
// in the organisation's zone) and lets the person get on with saving.
// "Continue working" and Escape dismiss it; the deadline does not move.

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TranslatePipe } from '@ngx-translate/core';
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { FormatService } from '../../formatting';
import { SessionLimitService } from '../../services/session-limit.service';

@Component({
  selector: 'app-session-limit-warning',
  standalone: true,
  imports: [EditDialogComponent, ButtonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-edit-dialog
      [visible]="limit.warningVisible()"
      (visibleChange)="onVisibleChange($event)"
      [header]="'session.limit.title' | translate"
      role="alertdialog"
      size="confirm"
      [content]="body"
      [footer]="actions"
    />

    <ng-template #body>
      <p class="text-sm text-[var(--am-text-primary)]" data-testid="session-limit-body">
        {{ 'session.limit.body' | translate: { time: endsAtTime() } }}
      </p>
    </ng-template>

    <ng-template #actions>
      <div class="flex justify-end gap-2">
        <p-button
          [label]="'session.idle.signOutNow' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="limit.signOutNow()"
        />
        <!-- Focused on open: Enter keeps the person working. -->
        <p-button
          [label]="'session.limit.continueWorking' | translate"
          [autofocus]="true"
          (onClick)="limit.dismiss()"
        />
      </div>
    </ng-template>
  `,
})
export class SessionLimitWarningComponent {
  protected readonly limit = inject(SessionLimitService);
  private readonly format = inject(FormatService);

  /** "17:40", 24-hour, in the organisation's zone — through the ACC-94 layer. */
  protected readonly endsAtTime = computed(() => {
    const end = this.limit.endsAt();
    return end === null ? '' : this.format.timeOfDay(new Date(end));
  });

  /** Escape, or the shell's own close path: the person is here; dismiss. */
  protected onVisibleChange(visible: boolean): void {
    if (!visible) this.limit.dismiss();
  }
}
