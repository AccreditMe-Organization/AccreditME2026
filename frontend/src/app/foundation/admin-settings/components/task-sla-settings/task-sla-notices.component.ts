import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ITaskSlaNotices, TenantService } from '../../../tenant/services/tenant.service';

/**
 * ACC-313 PR 3 — the Task SLA page's Notifications section: one switch,
 * "Notify assignees when a due date changes", on PATCH /tenant/task-sla/notices.
 *
 * IMMEDIATE, with no Save and no footer (the design's own rule for this
 * section): the press sends the change. The switch is `readonly` so it never
 * flips itself; it shows the pending value while the request runs and the
 * stored one after (ACC-286's pattern), so a refused press never shows the new
 * state. On failure it stays where it was, with a line under it.
 *
 * The page owns the read: it passes the stored notices and the load state, and
 * hears `changed` to take the saved value and read the history again.
 */
@Component({
  selector: 'am-task-sla-notices',
  standalone: true,
  imports: [FormsModule, TranslatePipe, ButtonModule, ToggleSwitchModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="am-sln" data-sla-section="notices" aria-labelledby="sla-notices-title">
      <header>
        <h2 class="am-sln__title" id="sla-notices-title">{{ 'adminSettings.taskSlaPage.notices.title' | translate }}</h2>
        <p class="am-sln__help">{{ 'adminSettings.taskSlaPage.notices.help' | translate }}</p>
      </header>
      @switch (load()) {
        @case ('loading') {
          <span class="am-skeleton-bar" aria-hidden="true"></span>
        }
        @case ('error') {
          <p class="am-sln__outcome" role="alert">
            <span>{{ 'adminSettings.taskSlaPage.loadFailed' | translate }}</span>
            <p-button [label]="'common.retry' | translate" severity="secondary" size="small" (onClick)="retry.emit()" />
          </p>
        }
        @default {
          <div class="am-sln__row" data-testid="sla-notify-due-change">
            <div class="am-sln__text">
              <label class="am-sln__label" for="sla-notify-due-change">{{ 'adminSettings.taskSlaPage.notices.dueChange' | translate }}</label>
              <p class="am-sln__help" id="sla-notify-due-change-help">{{ 'adminSettings.taskSlaPage.notices.dueChangeHelp' | translate }}</p>
            </div>
            <!-- readonly: the switch never flips itself. The click (and Space on
                 the switch) is ours: it sends the change, and the switch shows
                 the pending value, then the stored one. -->
            <p-toggleswitch
              [ngModel]="shown()"
              [readonly]="true"
              inputId="sla-notify-due-change"
              ariaLabelledBy="sla-notify-due-change-help"
              [disabled]="pending() !== null"
              (click)="toggle()"
            />
            <span class="am-sln__state" data-testid="sla-notify-due-change-state">{{ (shown() ? 'common.on' : 'common.off') | translate }}</span>
          </div>
          @if (error()) {
            <p class="am-sln__error" role="alert" data-testid="sla-notices-error">{{ 'adminSettings.taskSlaPage.notices.failed' | translate }}</p>
          }
        }
      }
    </section>
  `,
  styles: [
    `
      .am-sln{display:flex;flex-direction:column;gap:var(--am-space-12);padding:var(--am-space-16);background:var(--am-surface-raised);border:1px solid var(--am-border);border-radius:var(--am-radius-card);min-inline-size:0}
      .am-sln__title{margin:0;font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);font-weight:600;color:var(--am-ink-900)}
      .am-sln__help{margin:0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-500);text-wrap:pretty}
      .am-sln__row{display:flex;align-items:center;gap:var(--am-space-12)}
      .am-sln__text{flex:1 1 auto;min-inline-size:0}
      .am-sln__label{font-size:var(--am-type-body-size);font-weight:500;color:var(--am-ink-900)}
      .am-sln__state{flex:none;min-inline-size:3ch;font-size:var(--am-type-meta-size);color:var(--am-ink-700)}
      .am-sln__error{margin:0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-danger-ink)}
      .am-sln__outcome{display:flex;flex-wrap:wrap;align-items:center;gap:var(--am-space-8);margin:0;font-size:var(--am-type-body-size);color:var(--am-ink-700)}
    `,
  ],
})
export class TaskSlaNoticesComponent {
  private readonly tenantService = inject(TenantService);

  readonly notices = input<ITaskSlaNotices | null>(null);
  readonly load = input<'loading' | 'error' | 'ready'>('loading');
  readonly retry = output<void>();
  /** The stored notices after a successful press. */
  readonly changed = output<ITaskSlaNotices>();

  /** The value being sent, while the request runs. */
  readonly pending = signal<boolean | null>(null);
  readonly error = signal(false);
  readonly shown = computed(() => this.pending() ?? this.notices()?.notifyOnDueChange ?? true);

  toggle(): void {
    if (this.pending() !== null || !this.notices()) return;
    const next = !this.shown();
    this.pending.set(next);
    this.error.set(false);
    this.tenantService.updateTaskSlaNotices({ notifyOnDueChange: next }).subscribe({
      next: (notices) => {
        this.pending.set(null);
        this.changed.emit(notices);
      },
      error: () => {
        this.pending.set(null);
        this.error.set(true);
      },
    });
  }
}
