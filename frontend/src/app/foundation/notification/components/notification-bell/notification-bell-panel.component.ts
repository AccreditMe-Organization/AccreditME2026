import { Component, input, output, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { Popover } from 'primeng/popover';
import { AmDateTimePipe } from '../../../../core/formatting';
import { NotificationDto } from '../../services/notification.service';
import { isNotificationRecordLink, notificationLink } from './notification-links';

/**
 * ACC-90 — the bell's panel, in its own file so the bell can load it on the
 * first press (@defer) instead of at start-up. Deferring a LOCAL component
 * keeps p-popover, the list and their imports in a chunk of their own. When
 * the bell deferred them inline, Angular loaded RouterLink and NgTemplateOutlet
 * through dynamic imports of their whole packages, which ended tree-shaking of
 * @angular/common and the router module: the start-up bundle grew 74 kB.
 *
 * It draws what the bell holds (the newest notifications, whether they are
 * loading or failed, how many are unread) and reports what was pressed.
 */
@Component({
  selector: 'app-notification-bell-panel',
  standalone: true,
  imports: [AmDateTimePipe, TranslatePipe, ButtonModule, Popover, RouterLink, NgTemplateOutlet],
  template: `
    <p-popover #panel>
      <div class="flex flex-col gap-2 w-80">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold">{{ 'notification.title' | translate }}</h3>
          @if (unreadCount() > 0) {
            <p-button
              [label]="'notification.markAllRead' | translate"
              [text]="true"
              size="small"
              (onClick)="markAllRead.emit()"
            />
          }
        </div>

        @if (loading()) {
          <p class="text-sm text-surface-400">{{ 'common.loading' | translate }}</p>
        } @else if (error()) {
          <p class="text-sm text-red-500">{{ error()! | translate }}</p>
        } @else if (recent().length === 0) {
          <p class="text-sm text-surface-400 py-4 text-center">
            {{ 'notification.noNotifications' | translate }}
          </p>
        } @else {
          <div class="flex flex-col gap-1 max-h-96 overflow-y-auto">
            @for (item of recent(); track item.id) {
              <!-- ACC-228 — a task's notification opens the task's own page.
                   A real link, so it is reachable by keyboard and opens in a
                   new tab like any link; it still marks the item read. -->
              @if (itemLink(item); as link) {
                <a
                  class="am-bell-item flex flex-col gap-0.5 p-2 rounded hover:bg-surface-50"
                  [class.font-semibold]="item.status === 'UNREAD'"
                  [routerLink]="link"
                  (click)="itemClick.emit(item); panel.hide()"
                >
                  <ng-container *ngTemplateOutlet="itemText; context: { $implicit: item }" />
                </a>
              } @else {
                <div
                  class="flex flex-col gap-0.5 p-2 rounded cursor-pointer hover:bg-surface-50"
                  [class.font-semibold]="item.status === 'UNREAD'"
                  (click)="itemClick.emit(item)"
                >
                  <ng-container *ngTemplateOutlet="itemText; context: { $implicit: item }" />
                </div>
              }
            }
            <ng-template #itemText let-item>
              <span class="text-sm">
                {{ arabic() && item.titleAr ? item.titleAr : item.titleEn }}
              </span>
              <!-- ACC-271 PR 4 — a closed-task notice opens the record it is about. -->
              @if (isRecordLink(item)) {
                <span class="text-xs text-primary">{{ 'notification.openRecord' | translate }}</span>
              }
              <span class="text-xs text-surface-400">{{ item.createdAt | amDateTime }}</span>
            </ng-template>
          </div>
        }
      </div>
    </p-popover>
  `,
  styles: [
    `
      .am-bell-item {
        color: inherit;
        text-decoration: none;
      }
      .am-bell-item:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: -2px;
      }
    `,
  ],
})
export class NotificationBellPanelComponent {
  readonly recent = input.required<NotificationDto[]>();
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly unreadCount = input(0);
  readonly arabic = input(false);

  readonly markAllRead = output<void>();
  readonly itemClick = output<NotificationDto>();

  private readonly popover = viewChild.required(Popover);

  protected readonly itemLink = notificationLink;
  protected readonly isRecordLink = isNotificationRecordLink;

  toggle(event: Event): void {
    this.popover().toggle(event);
  }

  show(event: Event | null, target?: HTMLElement): void {
    this.popover().show(event, target);
  }
}
