import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { forkJoin } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { registerPageName } from '../../../../core/services/document-title.service';
import { WorkflowService, type WorkflowInstanceDto, type WorkflowMoveDto } from '../../../workflow/services/workflow.service';
import { WorkflowTransitionActionsComponent, type MoveConfirmCopy } from '../../../workflow/components/workflow-transition-actions/workflow-transition-actions.component';
import { WorkflowStageIndicatorComponent } from '../../../workflow/components/workflow-stage-indicator/workflow-stage-indicator.component';
import {
  MEETING_STAGE_FLAG,
  MeetingService,
  type MeetingAgendaItemDto,
  type MeetingAnswer,
  type MeetingAttendeeDto,
  type MeetingDto,
} from '../../services/meeting.service';
import { isCancelled, ownerGlyph, ownerLink, ownerName, stageName } from '../../meeting-display';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingRescheduleDialogComponent } from '../meeting-reschedule-dialog/meeting-reschedule-dialog.component';
import { MeetingAddGuestDialogComponent } from '../meeting-add-guest-dialog/meeting-add-guest-dialog.component';

/**
 * ACC-316 PR 6 — one meeting's page, through Agenda Issued (plan §5; Meeting
 * Screens round 5, section 4). Every rule is the server's: the moves are the
 * moves list's (with Cancel's reason and Issue Agenda's confirm), the buttons
 * are the read's `may`, and what a stage means is its flags. The minutes are
 * PR 7's.
 */
@Component({
  selector: 'app-meeting-page',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    FormsModule,
    ButtonModule,
    TextareaModule,
    WorkflowTransitionActionsComponent,
    WorkflowStageIndicatorComponent,
    MeetingRescheduleDialogComponent,
    MeetingAddGuestDialogComponent,
  ],
  template: `
    @if (state() === 'loading') {
      <p class="text-meta text-[var(--am-ink-500)]" data-testid="meeting-loading">{{ 'meeting.page.loading' | translate }}</p>
    } @else if (state() === 'notFound') {
      <section class="flex flex-col gap-2" data-testid="meeting-not-found">
        <h1 class="m-0 text-[22px] font-semibold">{{ 'meeting.page.notFound' | translate }}</h1>
        <a routerLink="/meetings" class="text-[var(--am-blue-primary)]">{{ 'meeting.page.back' | translate }}</a>
      </section>
    } @else if (state() === 'error') {
      <section class="flex flex-col gap-2" role="alert" data-testid="meeting-error">
        <p class="m-0">{{ loadError()! | translate }}</p>
        <p-button size="small" severity="secondary" [label]="'common.retry' | translate" (onClick)="load()" />
      </section>
    } @else if (meeting(); as m) {
      <div class="flex flex-col gap-4" data-testid="meeting-page">
        <!-- Header -->
        <section class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.page.eyebrow' | translate: { type: typeLabel() } }}</p>
            <h1 class="m-0 text-[28px] font-semibold leading-tight" [class.line-through]="cancelled()">{{ m.title }}</h1>
            <p class="m-0 flex flex-wrap items-center gap-2 text-[13px]">
              <span class="text-[11.5px] font-medium px-2 py-px rounded-full border border-[var(--am-border)]" data-meeting-stage>{{ stage() }}</span>
              <span>{{ when() }}</span>
              <span class="text-[var(--am-ink-500)]">· {{ format.hijri(m.scheduledAt) }}</span>
            </p>
            @if (m.rescheduledFrom; as r) {
              <p class="m-0 text-meta text-[var(--am-ink-500)]" data-testid="meeting-rescheduled-from">
                {{ 'meeting.page.rescheduledFrom' | translate: { from: format.dateTime(r.fromAt), reason: r.reason } }}
              </p>
            }
          </div>
          <div class="flex flex-wrap items-center gap-2">
            @if (m.may.reschedule) {
              <p-button size="small" severity="secondary" [label]="'meeting.reschedule.open' | translate" data-testid="meeting-reschedule" (onClick)="rescheduleOpen.set(true)" />
            }
            @if (instance(); as inst) {
              <app-workflow-transition-actions
                [instance]="inst"
                [recordLabel]="m.title"
                [stageLabel]="stage()"
                [confirmFor]="confirmFor"
                (transitioned)="onMoved($event)"
              />
            }
          </div>
        </section>
        @if (instance(); as inst) {
          <app-workflow-stage-indicator [instance]="inst" show="sequence" />
        }

        <!-- Relations -->
        <section class="grid gap-3 rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] p-3" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
          <div class="flex min-w-0 flex-col">
            <span class="text-meta text-[var(--am-ink-500)]">{{ (m.owner.kind === 'COMMITTEE' ? 'meeting.page.committee' : 'meeting.page.unit') | translate }}</span>
            <a [routerLink]="ownerLink()" class="truncate text-[var(--am-blue-primary)]"><span aria-hidden="true">{{ glyph() }} </span>{{ owner() }}</a>
            @if (m.answers?.quorum != null) {
              <span class="text-meta text-[var(--am-ink-500)]">{{ 'meeting.page.quorum' | translate: { n: format.number(m.answers!.quorum!) } }}</span>
            }
          </div>
          <div class="flex min-w-0 flex-col">
            <span class="text-meta text-[var(--am-ink-500)]">{{ 'meeting.page.where' | translate }}</span>
            <span class="truncate">{{ m.location ?? '—' }}</span>
            @if (m.meetingUrl) {
              <a class="truncate text-meta text-[var(--am-blue-primary)]" dir="ltr" [href]="m.meetingUrl" target="_blank" rel="noopener noreferrer">{{ m.meetingUrl }}</a>
            }
          </div>
          <div class="flex min-w-0 flex-col">
            <span class="text-meta text-[var(--am-ink-500)]">{{ 'meeting.page.organiser' | translate }}</span>
            <span class="truncate">{{ m.organizer.name }}</span>
          </div>
        </section>

        <!-- The viewer's own answer to the invitation (undrawn, plan §5). -->
        @if (m.may.answer || m.myAnswer) {
          <section class="flex flex-col gap-2 rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] p-3" data-testid="meeting-answer">
            <h2 class="m-0 text-[15px] font-semibold">{{ 'meeting.answer.title' | translate }}</h2>
            @if (m.myAnswer?.answer; as a) {
              <p class="m-0 text-[13px]" data-testid="meeting-my-answer">{{ ('meeting.answer.' + a.toLowerCase()) | translate }}</p>
            }
            @if (m.may.answer) {
              <div class="flex flex-wrap items-center gap-2">
                <p-button size="small" [severity]="m.myAnswer?.answer === 'ATTENDING' ? 'primary' : 'secondary'" [label]="'meeting.answer.attending' | translate" [loading]="answering() === 'ATTENDING'" (onClick)="answer('ATTENDING')" data-testid="meeting-answer-attending" />
                <p-button size="small" [severity]="m.myAnswer?.answer === 'CANT_ATTEND' ? 'primary' : 'secondary'" [label]="'meeting.answer.cant_attend' | translate" [loading]="answering() === 'CANT_ATTEND'" (onClick)="answer('CANT_ATTEND')" data-testid="meeting-answer-cant" />
              </div>
              <label class="flex flex-col gap-1 text-meta">
                <span>{{ 'meeting.answer.note' | translate }}</span>
                <textarea pTextarea rows="2" maxlength="500" [(ngModel)]="answerNote" data-testid="meeting-answer-note"></textarea>
              </label>
            } @else {
              <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.answer.closed' | translate }}</p>
            }
            @if (answerError()) {
              <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert">{{ answerError()! | translate }}</p>
            }
          </section>
        }

        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))">
          <!-- Agenda -->
          <section class="flex flex-col gap-2 rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] p-3" data-testid="meeting-agenda">
            <h2 class="m-0 text-[15px] font-semibold">
              {{ 'meeting.agenda.title' | translate }}
              <span class="text-meta text-[var(--am-ink-500)]">{{ format.number(agenda().length) }}</span>
            </h2>
            @if (agenda().length === 0) {
              <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.agenda.empty' | translate }}</p>
            }
            <ol class="m-0 flex flex-col gap-2 ps-0 list-none">
              @for (item of agenda(); track item.id) {
                <li class="flex flex-col gap-0.5" [attr.data-agenda-item]="item.id">
                  <span class="text-[13px] font-medium">
                    <span>{{ format.number(item.order) }}.</span> {{ item.title }}
                    @if (item.standing) {
                      <span class="ms-1 text-[11px] px-1.5 py-px rounded bg-[var(--am-surface)]">{{ 'meeting.agenda.standing' | translate }}</span>
                    }
                  </span>
                  <span class="text-meta text-[var(--am-ink-500)]">{{ itemMeta(item) }}</span>
                </li>
              }
            </ol>
          </section>

          <!-- Invitees -->
          <section class="flex flex-col gap-2 rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] p-3" data-testid="meeting-invitees">
            <h2 class="m-0 flex items-center justify-between gap-2 text-[15px] font-semibold">
              <span>{{ 'meeting.invitees.title' | translate }}</span>
              @if (canManageGuests()) {
                <p-button size="small" [text]="true" icon="pi pi-plus" [label]="'meeting.invitees.addGuest' | translate" data-testid="meeting-add-guest" (onClick)="guestOpen.set(true)" />
              }
            </h2>
            @if (m.answers; as s) {
              <p class="m-0 text-meta" [class.text-[var(--am-warning-ink)]]="s.belowQuorum" data-testid="meeting-answer-summary">
                {{ summary() }}
              </p>
            }
            <ul class="m-0 flex flex-col gap-1.5 ps-0 list-none">
              @for (a of attendees(); track a.id) {
                <li class="flex items-center justify-between gap-2" [attr.data-attendee]="a.id">
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate text-[13px]">
                      {{ a.name }}
                      @if (a.kind === 'OUTSIDE_GUEST') {
                        <span class="ms-1 text-[11px] px-1.5 py-px rounded border border-[var(--am-border)]" data-outside-chip>{{ 'meeting.invitees.outsideGuest' | translate }}</span>
                      }
                    </span>
                    <span class="truncate text-meta text-[var(--am-ink-500)]">{{ attendeeLine(a) }}</span>
                  </span>
                  @if (canManageGuests() && a.kind !== 'MEMBER') {
                    <p-button
                      size="small"
                      [text]="true"
                      severity="danger"
                      icon="pi pi-times"
                      [ariaLabel]="'meeting.invitees.removeGuest' | translate: { name: a.name }"
                      [loading]="removing() === a.id"
                      (onClick)="removeGuest(a)"
                    />
                  }
                </li>
              }
            </ul>
            <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.invitees.guestsNoQuorum' | translate }}</p>
            @if (guestError()) {
              <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert">{{ guestError()! | translate }}</p>
            }
          </section>
        </div>
      </div>

      <app-meeting-reschedule-dialog [visible]="rescheduleOpen()" (visibleChange)="rescheduleOpen.set($event)" [meeting]="m" (rescheduled)="load()" />
      <app-meeting-add-guest-dialog [visible]="guestOpen()" (visibleChange)="guestOpen.set($event)" [meeting]="m" (added)="load()" />
    }
  `,
})
export class MeetingPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly meetings = inject(MeetingService);
  private readonly workflow = inject(WorkflowService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  readonly format = inject(FormatService);

  readonly id = this.route.snapshot.paramMap.get('id')!;
  readonly state = signal<'loading' | 'ready' | 'notFound' | 'error'>('loading');
  readonly loadError = signal<string | null>(null);
  readonly meeting = signal<MeetingDto | null>(null);
  readonly attendees = signal<MeetingAttendeeDto[]>([]);
  readonly agenda = signal<MeetingAgendaItemDto[]>([]);
  readonly instance = signal<WorkflowInstanceDto | null>(null);
  readonly rescheduleOpen = signal(false);
  readonly guestOpen = signal(false);
  readonly answering = signal<MeetingAnswer | null>(null);
  readonly answerError = signal<string | null>(null);
  readonly removing = signal<string | null>(null);
  readonly guestError = signal<string | null>(null);
  answerNote = '';

  /** The server's own flag (may.manageGuests): adding and removing guests. */
  readonly canManageGuests = computed(() => !!this.meeting()?.may.manageGuests);
  readonly stage = computed(() => (this.meeting() ? stageName(this.meeting()!.stage, this.language) : '—'));
  readonly cancelled = computed(() => !!this.meeting() && isCancelled(this.meeting()!.stage));
  readonly owner = computed(() => (this.meeting() ? ownerName(this.meeting()!.owner, this.language) : ''));
  readonly glyph = computed(() => (this.meeting() ? ownerGlyph(this.meeting()!.owner) : ''));
  readonly ownerLink = computed(() => (this.meeting() ? ownerLink(this.meeting()!.owner) : []));
  readonly typeLabel = computed(() => {
    const t = this.meeting()?.type;
    return t ? this.language.bilingual(t.labelEn, t.labelAr) : '—';
  });
  /** "24 Sep 2026, 10:00–11:30": the start, and the end when a duration is set. */
  readonly when = computed(() => {
    const m = this.meeting();
    if (!m) return '';
    const start = this.format.dateTime(m.scheduledAt);
    if (!m.durationMinutes) return start;
    return `${start}–${this.format.timeOfDay(new Date(new Date(m.scheduledAt).getTime() + m.durationMinutes * 60_000))}`;
  });
  /** "6 attending · 2 can't attend · 1 no answer · quorum 5", counted strings. */
  readonly summary = computed(() => {
    const s = this.meeting()?.answers;
    if (!s) return '';
    const parts = [
      this.format.count('meeting.attending', s.attending),
      this.format.count('meeting.cantAttend', s.cantAttend),
      this.format.count('meeting.noAnswer', s.noAnswer),
    ];
    const quorum = s.quorum != null ? this.format.count('meeting.quorum', s.quorum) : null;
    return [...parts, ...(quorum ? [quorum] : [])].join(' · ');
  });

  constructor() {
    registerPageName(() => this.meeting()?.title ?? null);
    this.load();
  }

  load(): void {
    forkJoin({
      meeting: this.meetings.get(this.id),
      attendees: this.meetings.attendees(this.id),
      agenda: this.meetings.agenda(this.id),
      instances: this.workflow.getInstancesByObject('MEETING', this.id),
    }).subscribe({
      next: ({ meeting, attendees, agenda, instances }) => {
        this.meeting.set(meeting);
        // The note as stored, so the next answer keeps it rather than clearing it.
        this.answerNote = meeting.myAnswer?.note ?? '';
        this.attendees.set(attendees);
        this.agenda.set(agenda);
        this.instance.set(instances[0] ?? null);
        this.state.set('ready');
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && (err.status === 404 || err.status === 403)) {
          this.state.set('notFound');
          return;
        }
        this.loadError.set('meeting.page.loadError');
        this.state.set('error');
      },
    });
  }

  onMoved(instance: WorkflowInstanceDto): void {
    this.instance.set(instance);
    this.load();
  }

  /**
   * What a move asks before it is pressed, in this record's words: Cancel
   * Meeting (the server says it needs a reason) and Issue Agenda (a confirm,
   * Meeting Screens round 5). Keyed by the stage the move ENTERS, by its flags.
   */
  readonly confirmFor = (move: WorkflowMoveDto): MoveConfirmCopy | null => {
    if (move.needsReason) {
      return {
        titleKey: 'meeting.cancel.title',
        leadKey: 'meeting.cancel.lead',
        hintKey: 'meeting.cancel.hint',
        confirmKey: 'meeting.cancel.confirm',
        keepKey: 'meeting.cancel.keep',
        danger: true,
      };
    }
    if ((move.toStageFlags ?? []).includes(MEETING_STAGE_FLAG.AGENDA_ISSUED)) {
      return { titleKey: 'meeting.issue.title', leadKey: 'meeting.issue.lead', confirmKey: 'meeting.issue.confirm', keepKey: 'meeting.issue.keep', danger: false };
    }
    return null;
  };

  answer(answer: MeetingAnswer): void {
    this.answering.set(answer);
    this.answerError.set(null);
    this.meetings.answer(this.id, { answer, note: this.answerNote.trim() || null }).subscribe({
      next: () => {
        this.answering.set(null);
        this.load();
      },
      error: (err: unknown) => {
        this.answering.set(null);
        this.answerError.set(meetingRefusalKey(err) ?? 'meeting.answer.error');
      },
    });
  }

  removeGuest(a: MeetingAttendeeDto): void {
    this.removing.set(a.id);
    this.guestError.set(null);
    this.meetings.removeGuest(this.id, a.id).subscribe({
      next: () => {
        this.removing.set(null);
        this.load();
      },
      error: (err: unknown) => {
        this.removing.set(null);
        this.guestError.set(meetingRefusalKey(err) ?? 'meeting.invitees.removeError');
      },
    });
  }

  /** "Secretary" (the seat, from the lookup), "Guest · Facilities Engineer", or an outside guest's organisation and role. */
  attendeeLine(a: MeetingAttendeeDto): string {
    if (a.kind === 'MEMBER') return a.seat ? this.language.bilingual(a.seat.labelEn, a.seat.labelAr) : '';
    if (a.kind === 'OUTSIDE_GUEST') return [a.outsideOrganisation, a.outsideRole].filter((x) => !!x).join(' · ');
    return this.translate.instant('meeting.invitees.guest') as string;
  }

  itemMeta(item: MeetingAgendaItemDto): string {
    const parts = [
      item.presenter?.name ?? null,
      item.durationMinutes ? this.format.count('meeting.minutes', item.durationMinutes) : null,
    ].filter((x): x is string => !!x);
    return parts.join(' · ');
  }
}
