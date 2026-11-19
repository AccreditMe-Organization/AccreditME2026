import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { forkJoin } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { CappedPanelComponent } from '../../../../shared/components/capped-panel/capped-panel.component';
import { MeetingService, type MeetingListItemDto } from '../../services/meeting.service';
import { isCancelled, stageName } from '../../meeting-display';
import { MeetingScheduleDialogComponent, type ScheduleOwner } from '../meeting-schedule-dialog/meeting-schedule-dialog.component';

type PanelState = 'loading' | 'error' | 'ready';

/** Upcoming meetings shown, then the most recent held ones (Meeting Screens round 5, section 2). */
const UPCOMING = 3;
const HELD = 2;

/**
 * ACC-316 PR 6 — a committee's or a unit's Meetings panel: the next meetings
 * this person may see, then the most recent ones held, each linked to its page
 * (the server's list views, filtered to this owner, so what shows is what the
 * parent rule lets them see). "Schedule meeting" shows only when the server
 * says this person may schedule for the owner (GET /meetings/may-schedule), and
 * opens step 1 with the owner fixed.
 */
@Component({
  selector: 'app-meetings-panel',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ButtonModule, CappedPanelComponent, MeetingScheduleDialogComponent],
  template: `
    <am-capped-panel
      [heading]="'meeting.panel.title' | translate"
      [state]="state()"
      [total]="rows().length"
      [shown]="rows().length"
      [loadingText]="'meeting.panel.loading' | translate"
      [errorText]="'meeting.panel.error' | translate"
      [emptyText]="'meeting.panel.empty' | translate"
      [emptyBody]="'meeting.panel.emptyBody' | translate"
      [testIdPrefix]="'meetings-' + owner().kind.toLowerCase()"
      (retry)="load()"
    >
      @if (maySchedule()) {
        <p-button amPanelActions size="small" [text]="true" icon="pi pi-plus" [label]="'meeting.panel.schedule' | translate" data-testid="meetings-panel-schedule" (onClick)="scheduleOpen.set(true)" />
      }
      @for (m of rows(); track m.id) {
        <li class="am-cp-row" [attr.data-meeting-row]="m.id">
          <span class="am-cp-l1">
            <a class="am-cp-cut" [class.line-through]="cancelled(m)" [routerLink]="['/meetings', m.id]">{{ m.title }}</a>
          </span>
          <span class="am-cp-l2"><span class="am-cp-cut">{{ format.dateTime(m.scheduledAt) }} · {{ stage(m) }}</span></span>
        </li>
      }
    </am-capped-panel>
    <app-meeting-schedule-dialog [visible]="scheduleOpen()" (visibleChange)="scheduleOpen.set($event)" [owner]="owner()" />
  `,
})
export class MeetingsPanelComponent {
  private readonly meetings = inject(MeetingService);
  private readonly language = inject(LanguageService);
  readonly format = inject(FormatService);

  readonly owner = input.required<ScheduleOwner>();

  readonly state = signal<PanelState>('loading');
  readonly upcoming = signal<MeetingListItemDto[]>([]);
  readonly held = signal<MeetingListItemDto[]>([]);
  readonly maySchedule = signal(false);
  readonly scheduleOpen = signal(false);
  readonly rows = computed(() => [...this.upcoming(), ...this.held()]);

  constructor() {
    effect(() => {
      const owner = this.owner();
      untracked(() => {
        this.load();
        const key = owner.kind === 'COMMITTEE' ? { committeeId: owner.id } : { orgUnitId: owner.id };
        this.meetings.maySchedule(key).subscribe({ next: (r) => this.maySchedule.set(r.may), error: () => this.maySchedule.set(false) });
      });
    });
  }

  load(): void {
    const owner = this.owner();
    const key = owner.kind === 'COMMITTEE' ? { committeeId: owner.id } : { orgUnitId: owner.id };
    this.state.set('loading');
    forkJoin({
      upcoming: this.meetings.list({ view: 'mine', ...key, take: UPCOMING }),
      held: this.meetings.list({ view: 'past', ...key, take: HELD }),
    }).subscribe({
      next: ({ upcoming, held }) => {
        this.upcoming.set(upcoming.items);
        this.held.set(held.items);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  stage = (m: MeetingListItemDto) => stageName(m.stage, this.language);
  cancelled = (m: MeetingListItemDto) => isCancelled(m.stage);
}
