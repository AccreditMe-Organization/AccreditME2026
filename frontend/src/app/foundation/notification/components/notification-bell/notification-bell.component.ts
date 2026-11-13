import { Component, DestroyRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormatService } from '../../../../core/formatting';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { NotificationService, NotificationDto } from '../../services/notification.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NotificationBellPanelComponent } from './notification-bell-panel.component';
import { isNotificationRecordLink, notificationLink } from './notification-links';

const POLL_INTERVAL_MS = 30000;

/** What the bell calls on its panel. */
interface PanelHandle {
  toggle(event: Event): void;
  show(event: Event | null, target?: HTMLElement): void;
}

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [ButtonModule, BadgeModule, NotificationBellPanelComponent],
  template: `
    <div class="relative inline-flex">
      <!-- ACC-264 — the bell's name says how many are unread: the badge is drawn, not read. -->
      <p-button
        icon="pi pi-bell"
        [text]="true"
        [rounded]="true"
        [ariaLabel]="bellLabel()"
        (onClick)="onToggle($event)"
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

    <!-- ACC-90 — the panel loads on the first press, not at start-up: the
         bell and its count are eager; the panel (p-popover and the list) is
         its own component in its own chunk. The press that loads it opens it
         (onToggle / the effect below). -->
    @defer (when panelWanted()) {
      <app-notification-bell-panel
        #panel
        [recent]="recent()"
        [loading]="loading()"
        [error]="error()"
        [unreadCount]="unreadCount()"
        [arabic]="isArabic()"
        (markAllRead)="onMarkAllRead()"
        (itemClick)="onItemClick($event)"
      />
    }
  `,
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

  /** ACC-90 — set by the first press; the panel's @defer loads on it. */
  readonly panelWanted = signal(false);
  // By template name, and typed by what is called on it: @defer can lazy-load
  // the panel only if this file names it nowhere but `imports` and the block.
  private readonly panel = viewChild<PanelHandle>('panel');
  /** The bell button the first press came from, until the panel has loaded. */
  private pendingAnchor: HTMLElement | null = null;

  constructor() {
    // The press that loaded the panel opens it, anchored to the bell.
    effect(() => {
      const panel = this.panel();
      if (!panel || !this.pendingAnchor) return;
      const anchor = this.pendingAnchor;
      this.pendingAnchor = null;
      panel.show(null, anchor);
    });
  }

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

  onToggle(event: Event): void {
    const panel = this.panel();
    if (panel) {
      panel.toggle(event);
    } else {
      // First press: load the panel, then open it from the same button.
      this.pendingAnchor = ((event.currentTarget ?? event.target) as HTMLElement | null) ?? null;
      this.panelWanted.set(true);
    }
    this.loadRecent();
  }

  /**
   * ACC-228 — every task notification carries the task (objectType 'Task').
   * ACC-271 PR 4 — a closed-task notice carries its record, for a reader who
   * may open it (the server leaves it out for anyone else): a committee.
   */
  itemLink(item: NotificationDto): string[] | null {
    return notificationLink(item);
  }

  isRecordLink(item: NotificationDto): boolean {
    return isNotificationRecordLink(item);
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
