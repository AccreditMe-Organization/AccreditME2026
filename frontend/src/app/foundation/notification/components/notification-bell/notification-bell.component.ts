import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { PopoverModule, Popover } from 'primeng/popover';
import { NotificationService, NotificationDto } from '../../services/notification.service';

const POLL_INTERVAL_MS = 30000;

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [DatePipe, TranslatePipe, ButtonModule, BadgeModule, PopoverModule],
  template: `
    <div class="relative inline-flex">
      <p-button
        icon="pi pi-bell"
        [text]="true"
        [rounded]="true"
        (onClick)="onToggle($event, panel)"
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
              <div
                class="flex flex-col gap-0.5 p-2 rounded cursor-pointer hover:bg-surface-50"
                [class.font-semibold]="item.status === 'UNREAD'"
                (click)="onItemClick(item)"
              >
                <span class="text-sm">
                  {{ isArabic() && item.titleAr ? item.titleAr : item.titleEn }}
                </span>
                <span class="text-xs text-surface-400">{{ item.createdAt | date: 'short' }}</span>
              </div>
            }
          </div>
        }
      </div>
    </p-popover>
  `,
})
export class NotificationBellComponent implements OnInit {
  private readonly notificationService = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly unreadCount = signal(0);
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
    return this.translate.currentLang() === 'ar';
  }

  onToggle(event: Event, panel: Popover): void {
    panel.toggle(event);
    this.loadRecent();
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
    this.notificationService.list(undefined, 10).subscribe({
      next: (items) => {
        this.recent.set(items);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('notification.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
