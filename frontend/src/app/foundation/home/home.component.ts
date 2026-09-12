import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { CardComponent } from '../../shared/components/card/card.component';
import { TaskService, ITaskDto } from '../tasks/services/task.service';
import { NotificationService, NotificationDto } from '../notification/services/notification.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';

// HomeComponent — ACC-70. The post-login landing page.
//
// WHY IT EXISTS: every non-platform-admin used to be redirected to
// /organization, an admin screen. A user without org:view landed on a page
// that rendered a wall of failed requests — the concrete finding from ACC-62's
// persona testing. Sending them to their own profile instead would have been a
// workaround; this is the product working.
//
// DELIBERATELY REACHABLE BY ANY AUTHENTICATED USER. It carries no
// permissionGuard and has no entry in ROUTE_PERMISSIONS, so it cannot become
// the thing it exists to prevent. Both panels below are self-scoped —
// /tasks/my-tasks filters assignees.some(userId = caller) and /notifications
// filters userId = caller — so neither needs a permission and neither can 403
// for a legitimately logged-in user. A user holding NO permissions at all
// sees both panels populated with their own work.
//
// NOT THE DASHBOARD. CLAUDE.md records a permission-gated widget dashboard as
// part of Committee production-readiness ("my committees / pending my action",
// widgets gated on permission strings, never on named roles). That is this
// same screen's LATER pass, once modules exist to draw from — not a duplicate
// of this one and not superseded by it. This pass is deliberately the
// smallest thing that makes login land somewhere honest. When the dashboard
// work happens, it should grow this component rather than add a second
// landing page.
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [DatePipe, RouterLink, TranslatePipe, TableModule, TagModule, CardComponent],
  template: `
    <div class="flex flex-col gap-6">
      <div>
        <h2 class="text-xl font-semibold">
          {{ 'home.greeting' | translate: { name: userName() } }}
        </h2>
        <p class="text-sm text-[var(--am-text-secondary)]">{{ 'home.subtitle' | translate }}</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <app-card>
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-medium">{{ 'home.myTasks' | translate }}</h3>
            <a routerLink="/tasks" class="text-sm text-[var(--am-blue-primary)]">
              {{ 'home.viewAll' | translate }}
            </a>
          </div>

          <p-table [value]="openTasks()" [loading]="tasksLoading()" styleClass="w-full">
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 55%">{{ 'task.title' | translate }}</th>
                <th style="width: 25%">{{ 'task.dueDate' | translate }}</th>
                <th style="width: 20%">{{ 'task.status.title' | translate }}</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-task>
              <tr>
                <td>{{ task.title }}</td>
                <td>{{ task.dueAt ? (task.dueAt | date: 'mediumDate') : '—' }}</td>
                <td>
                  <p-tag
                    [value]="'task.status.' + task.status.toLowerCase() | translate"
                    [severity]="statusSeverity(task.status)"
                  />
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="3" class="text-[var(--am-text-secondary)]">
                  {{ 'home.noOpenTasks' | translate }}
                </td>
              </tr>
            </ng-template>
          </p-table>
        </app-card>

        <app-card>
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-medium">{{ 'home.notifications' | translate }}</h3>
          </div>

          @if (notificationsLoading()) {
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'common.loading' | translate }}</p>
          } @else if (notifications().length === 0) {
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'home.noNotifications' | translate }}</p>
          } @else {
            <ul class="flex flex-col divide-y divide-[var(--am-border)]">
              @for (item of notifications(); track item.id) {
                <li class="py-3 flex flex-col gap-1">
                  <span class="text-sm" [class.font-semibold]="item.status === 'UNREAD'">
                    {{ notificationTitle(item) }}
                  </span>
                  <span class="text-xs text-[var(--am-text-secondary)]">
                    {{ item.createdAt | date: 'short' }}
                  </span>
                </li>
              }
            </ul>
          }
        </app-card>
      </div>
    </div>
  `,
})
export class HomeComponent implements OnInit {
  private readonly taskService = inject(TaskService);
  private readonly notificationService = inject(NotificationService);
  private readonly authService = inject(AuthService);
  private readonly languageService = inject(LanguageService);

  readonly openTasks = signal<ITaskDto[]>([]);
  readonly notifications = signal<NotificationDto[]>([]);
  readonly tasksLoading = signal(false);
  readonly notificationsLoading = signal(false);

  userName(): string {
    return this.authService.currentUser()?.name ?? '';
  }

  // Notifications carry titleEn/titleAr, not a single resolved title — same
  // shape NotificationBellComponent already renders. Arabic falls back to
  // English when titleAr is null rather than showing an empty row.
  notificationTitle(item: NotificationDto): string {
    return this.languageService.isArabic() && item.titleAr ? item.titleAr : item.titleEn;
  }

  statusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' {
    if (status === 'COMPLETED') return 'success';
    if (status === 'OVERDUE') return 'danger';
    if (status === 'UNASSIGNED') return 'warn';
    return 'info';
  }

  ngOnInit(): void {
    this.loadTasks();
    this.loadNotifications();
  }

  private loadTasks(): void {
    this.tasksLoading.set(true);
    this.taskService.getMyTasks().subscribe({
      next: (tasks) => {
        // Open work only — a landing page listing everything the user has
        // ever completed buries what still needs doing.
        this.openTasks.set(
          tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED'),
        );
        this.tasksLoading.set(false);
      },
      // Both panels fail QUIETLY and independently. Neither endpoint is
      // permission-gated, so an error here is a genuine fault rather than a
      // denial — and this is the screen a user is sent to when something has
      // already gone wrong elsewhere. Rendering an error banner on it would
      // reproduce, on the landing page itself, the "wall of failed requests"
      // this page exists to stop people landing on.
      error: () => this.tasksLoading.set(false),
    });
  }

  private loadNotifications(): void {
    this.notificationsLoading.set(true);
    // ACC-78 — unwraps the shared envelope. Like the bell, this panel wants the
    // newest few and ignores `total`.
    this.notificationService.list(undefined, 5).subscribe({
      next: (page) => {
        this.notifications.set(page.data);
        this.notificationsLoading.set(false);
      },
      error: () => this.notificationsLoading.set(false),
    });
  }
}
