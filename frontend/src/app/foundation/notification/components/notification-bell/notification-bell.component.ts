import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { AmDateTimePipe, FormatService } from '../../../../core/formatting';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { PopoverModule, Popover } from 'primeng/popover';
import { NotificationService, NotificationDto } from '../../services/notification.service';
import { LanguageService } from '../../../../core/services/language.service';

const POLL_INTERVAL_MS = 30000;

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [AmDateTimePipe, TranslatePipe, ButtonModule, BadgeModule, PopoverModule, RouterLink, NgTemplateOutlet],
  template: `
    <div class="relative inline-flex">
      <!-- ACC-264 — the bell's name says how many are unread: the badge is drawn, not read. -->
      <p-button
        icon="pi pi-bell"
        [text]="true"
        [rounded]="true"
        [ariaLabel]="bellLabel()"
        (onClick)="onToggle($event, panel)"
        data-testid="notification-bell"
      />
      @if (unreadCount() > 0) {
        <p-badge
          [value]="unreadCount()"
          severity="danger"
          class="absolute -top-1 -end-1"
        />
      }
    </div>

    <p-popover #panel>
      <div class="flex flex-col gap-2 w-80">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold">{{ 'notification.title' | translate }}</h3>
          @if (unreadCount() > 0) {
            <p-button
              [label]="'notification.markAllRead' | translate"
              [text]="true"
              size="small"
              (onClick)="onMarkAllRead()"
            />
          }
        </div>

        @if (loading()) {
          <p class="text-sm text-surface-400">{{ 'common.loading' | translate }}</p>
        } @else if (error()) {
          <p class="text-sm text-red-500">{{ error() | translate }}</p>
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
                  (click)="onItemClick(item); panel.hide()"
                >
                  <ng-container *ngTemplateOutlet="itemText; context: { $implicit: item }" />
                </a>
              } @else {
                <div
                  class="flex flex-col gap-0.5 p-2 rounded cursor-pointer hover:bg-surface-50"
                  [class.font-semibold]="item.status === 'UNREAD'"
                  (click)="onItemClick(item)"
                >
                  <ng-container *ngTemplateOutlet="itemText; context: { $implicit: item }" />
                </div>
              }
            }
            <ng-template #itemText let-item>
              <span class="text-sm">
                {{ isArabic() && item.titleAr ? item.titleAr : item.titleEn }}
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
export class NotificationBellComponent implements OnInit {
  private readonly notificationService = inject(NotificationService);
  private readonly languageService = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly format = inject(FormatService);

  readonly unreadCount = signal(0);
  /** "Notifications, 3 unread" — a plural object, so every Arabic form is right. */
  readonly bellLabel = computed(() => this.format.count('notification.bellUnread', this.unreadCount()));
  readonly recent = signal<NotificationDto[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    interval(POLL_INTERVAL_MS)
      .pipe(
        startWith(0),
        switchMap(() =>
          // Without this, a single failed tick (e.g. a 401 from a session
          // that hadn't settled yet) propagates through switchMap and
          // terminates the whole outer subscription — polling would then
          // stay dead for the rest of the component's lifetime instead of
          // retrying on the next interval.
          this.notificationService.getUnreadCount().pipe(
            catchError(() => of({ count: null })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ count }) => {
        if (count === null) {
          this.error.set('notification.errorLoad');
          return;
        }
        this.error.set(null);
        this.unreadCount.set(count);
      });
  }

  isArabic(): boolean {
    return this.languageService.isArabic();
  }

  onToggle(event: Event, panel: Popover): void {
    panel.toggle(event);
    this.loadRecent();
  }

  /**
   * ACC-228 — every task notification carries the task (objectType 'Task').
   * ACC-271 PR 4 — a closed-task notice carries its record, for a reader who
   * may open it (the server leaves it out for anyone else): a committee.
   */
  itemLink(item: NotificationDto): string[] | null {
    if (!item.objectId) return null;
    if (item.objectType === 'Task') return ['/tasks', item.objectId];
    if (item.objectType === 'COMMITTEE') return ['/committees', item.objectId];
    return null;
  }

  isRecordLink(item: NotificationDto): boolean {
    return item.objectType === 'COMMITTEE' && !!item.objectId;
  }

  onItemClick(item: NotificationDto): void {
    if (item.status !== 'UNREAD') return;
    this.notificationService.markRead(item.id).subscribe({
      next: () => {
        item.status = 'READ';
        this.unreadCount.set(Math.max(0, this.unreadCount() - 1));
      },
    });
  }

  onMarkAllRead(): void {
    this.notificationService.markAllRead().subscribe({
      next: () => {
        this.recent().forEach((n) => (n.status = 'READ'));
        this.unreadCount.set(0);
      },
    });
  }

  private loadRecent(): void {
    this.loading.set(true);
    this.error.set(null);
    // ACC-78 — reads `.data` off the shared envelope. The bell wants the newest
    // few and ignores `total`; it is unaffected by the contract change beyond
    // this one unwrap.
    this.notificationService.list(undefined, 10).subscribe({
      next: (page) => {
        this.recent.set(page.data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('notification.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
