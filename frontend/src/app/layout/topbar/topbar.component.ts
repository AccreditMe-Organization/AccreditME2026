import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb.component';
import { NotificationBellComponent } from '../../foundation/notification/components/notification-bell/notification-bell.component';
import { LanguageToggleComponent } from '../language-toggle/language-toggle.component';

// ACC-79 — the top bar of the CONTENT COLUMN, per the App Shell reference:
// rail toggle and breadcrumb on the start side, notification bell on the end.
//
// It used to span the full width above the rail, carrying the brand, the
// user's name and their menu. The brand and the user now live in the rail
// (its header and footer), so the rail runs the full height of the window.
// The impersonation banner moved OUT to ImpersonationBannerComponent, because
// it must stay full-width above everything rather than sit in this column.
@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [
    TranslatePipe,
    ButtonModule,
    TooltipModule,
    BreadcrumbComponent,
    NotificationBellComponent,
    LanguageToggleComponent,
  ],
  template: `
    <header
      class="h-12 flex-none flex items-center justify-between gap-3 ps-2 pe-4 bg-[var(--am-card)] border-b border-[var(--am-border)]"
    >
      <div class="flex items-center gap-1 min-w-0">
        <!-- [ariaLabel], NOT [attr.aria-label]. PrimeNG's p-button renders
             its own inner <button> and binds that element's aria-label from
             this input (primeng-button.mjs: [attr.aria-label]="ariaLabel ||
             buttonProps?.ariaLabel"). An attr binding lands on the p-button
             HOST, which is not focusable, and left the real button with no
             accessible name — a screen reader announced it as just "button".
             Found in commit 7's browser pass, when the control could not be
             located by its name.
             aria-expanded (ACC-232, phone only) reaches the inner element
             through PrimeNG's pass-through: p-button binds ptm('root') onto it
             ([pBind] in primeng-button.mjs). The desktop toggle is unchanged.
             On both, the label changes with the state. -->
        <p-button
          icon="pi pi-bars"
          [text]="true"
          severity="secondary"
          size="small"
          data-rail-toggle
          [pt]="togglePt()"
          [ariaLabel]="toggleLabelKey() | translate"
          [pTooltip]="toggleLabelKey() | translate"
          (onClick)="toggleSidebar.emit()"
        />
        <app-breadcrumb class="min-w-0" />
      </div>

      <div class="flex items-center gap-3 flex-none">
        <app-language-toggle />
        <app-notification-bell />
      </div>
    </header>
  `,
})
export class TopbarComponent {
  readonly collapsed = input(false);
  /** ACC-232 — the phone shell: the toggle opens and closes the rail over the page. */
  readonly phone = input(false);
  readonly railOpen = input(false);
  readonly toggleSidebar = output<void>();

  readonly toggleLabelKey = computed(() => {
    if (this.phone()) return this.railOpen() ? 'shell.closeNav' : 'shell.openNav';
    return this.collapsed() ? 'shell.expandRail' : 'shell.collapseRail';
  });

  /**
   * aria-expanded on the inner <button>, on a phone only. On a desktop it is
   * null, never absent: PrimeNG's pass-through removes an attribute given null
   * (primeng-bind.mjs) but leaves one it is no longer given, so a phone that
   * crossed to a desktop would keep a stale aria-expanded.
   */
  readonly togglePt = computed(() => ({
    root: { 'aria-expanded': this.phone() ? (this.railOpen() ? 'true' : 'false') : null },
  }));
}
