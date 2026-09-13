import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb.component';
import { NotificationBellComponent } from '../../foundation/notification/components/notification-bell/notification-bell.component';

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
  ],
  template: `
    <header
      class="h-12 flex-none flex items-center justify-between gap-3 ps-2 pe-4 bg-[var(--am-card)] border-b border-[var(--am-border)]"
    >
      <div class="flex items-center gap-1 min-w-0">
        <!-- Labelled for assistive technology in both states: an icon-only
             control whose meaning flips is otherwise announced as nothing. -->
        <p-button
          icon="pi pi-bars"
          [text]="true"
          severity="secondary"
          size="small"
          [attr.aria-label]="
            (collapsed() ? 'shell.expandRail' : 'shell.collapseRail')
              | translate
          "
          [pTooltip]="
            (collapsed() ? 'shell.expandRail' : 'shell.collapseRail')
              | translate
          "
          [attr.aria-expanded]="!collapsed()"
          (onClick)="toggleSidebar.emit()"
        />
        <app-breadcrumb class="min-w-0" />
      </div>

      <div class="flex items-center gap-2 flex-none">
        <app-notification-bell />
      </div>
    </header>
  `,
})
export class TopbarComponent {
  readonly collapsed = input(false);
  readonly toggleSidebar = output<void>();
}
