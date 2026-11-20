import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { catchError, forkJoin, of, type Observable } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { registerPageName } from '../../../../core/services/document-title.service';
import { WorkflowService, type WorkflowInstanceDto, type WorkflowMoveDto } from '../../../workflow/services/workflow.service';
import { WorkflowTransitionActionsComponent, type MoveBlock, type MoveConfirmCopy } from '../../../workflow/components/workflow-transition-actions/workflow-transition-actions.component';
import { WorkflowStageIndicatorComponent } from '../../../workflow/components/workflow-stage-indicator/workflow-stage-indicator.component';
import {
  MEETING_STAGE_FLAG,
  MeetingService,
  type MeetingAgendaItemDto,
  type MeetingAnswer,
  type MeetingAttendeeDto,
  type MeetingDto,
  type MeetingFilesDto,
  type MeetingMinutesDto,
  type MeetingOpenActionsDto,
  type MeetingSuggestionDto,
} from '../../services/meeting.service';
import { isCancelled, ownerGlyph, ownerLink, ownerName, stageName } from '../../meeting-display';
import { type MeetingFailure, meetingFailure, meetingRefusalKey } from '../../meeting-refusal';
import { refusalCode } from '../../../../core/http/refusal';
import { MeetingRescheduleDialogComponent } from '../meeting-reschedule-dialog/meeting-reschedule-dialog.component';
import { MeetingAddGuestDialogComponent } from '../meeting-add-guest-dialog/meeting-add-guest-dialog.component';
import { MeetingAgendaPanelComponent } from '../meeting-agenda-panel/meeting-agenda-panel.component';
import { MeetingFileListComponent } from '../meeting-file-list/meeting-file-list.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { MeetingAttendanceComponent } from '../meeting-attendance/meeting-attendance.component';
import { MeetingActionDialogComponent } from '../meeting-action-dialog/meeting-action-dialog.component';
import { MeetingDistributeDialogComponent } from '../meeting-distribute-dialog/meeting-distribute-dialog.component';
import { MinutesWriteOrder } from '../../minutes-write-order';
import { MeetingReviewBannerComponent } from '../meeting-review-banner/meeting-review-banner.component';
import { MeetingReviewCardComponent } from '../meeting-review-card/meeting-review-card.component';
import { MeetingSuggestDialogComponent } from '../meeting-suggest-dialog/meeting-suggest-dialog.component';
import { MeetingDeclineDialogComponent } from '../meeting-decline-dialog/meeting-decline-dialog.component';
import { MeetingReturnDialogComponent } from '../meeting-return-dialog/meeting-return-dialog.component';
import { MEETING_APPROVAL_BLOCKS, MeetingCantApproveDialogComponent } from '../meeting-cant-approve-dialog/meeting-cant-approve-dialog.component';

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
  // P206 — one order for the page's minutes writes: an older answer never puts back what a newer one changed.
  providers: [MinutesWriteOrder],
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
    MeetingAgendaPanelComponent,
    MeetingFileListComponent,
    IconButtonComponent,
    MeetingAttendanceComponent,
    MeetingActionDialogComponent,
    MeetingDistributeDialogComponent,
    MeetingReviewBannerComponent,
    MeetingReviewCardComponent,
    MeetingSuggestDialogComponent,
    MeetingDeclineDialogComponent,
    MeetingReturnDialogComponent,
    MeetingCantApproveDialogComponent,
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
      <div class="am-mp flex flex-col gap-4" data-testid="meeting-page">
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
            @if (minutes()?.may?.distribute) {
              <p-button size="small" [label]="'meeting.distribute.open' | translate" data-testid="meeting-distribute" (onClick)="distributeOpen.set(true)" />
            }
            <!-- PR 7d-1 — the approved minutes on A4; never a draft (P229: the header only). -->
            @if (minutes()?.phase === 'approved') {
              <a
                class="p-button p-button-sm p-button-secondary am-print-link"
                [routerLink]="['/meetings', m.id, 'print']"
                data-testid="meeting-print-minutes"
              ><i class="pi pi-print" aria-hidden="true"></i><span>{{ 'meeting.print.open' | translate }}</span></a>
            }
            @if (minutes()?.may?.returnForCorrection) {
              <p-button size="small" severity="secondary" [label]="'meeting.return.open' | translate" data-testid="meeting-return" (onClick)="returnOpen.set(true)" />
            }
            @if (instance(); as inst) {
              <app-workflow-transition-actions
                [instance]="inst"
                [recordLabel]="m.title"
                [stageLabel]="stage()"
                [confirmFor]="confirmFor"
                [explains]="approvalBlocks"
                (why)="cantApprove.set($event)"
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
            @if (m.may.answer) {
              <!-- The pressed button IS the answer given (aria-pressed): no line repeats it. -->
              <div role="group" class="am-segmented" [attr.aria-label]="'meeting.answer.title' | translate">
                @for (a of answerChoices; track a.value) {
                  <button
                    type="button"
                    class="am-segmented__option"
                    [class.am-segmented__option--active]="m.myAnswer?.answer === a.value"
                    [attr.aria-pressed]="m.myAnswer?.answer === a.value"
                    [disabled]="answering() !== null"
                    (click)="answer(a.value)"
                    [attr.data-testid]="a.testId"
                  >
                    {{ a.labelKey | translate }}
                  </button>
                }
              </div>
              <label class="flex flex-col gap-1 text-meta">
                <span>{{ 'meeting.answer.note' | translate }}</span>
                <textarea pTextarea rows="2" maxlength="500" [(ngModel)]="answerNote" data-testid="meeting-answer-note"></textarea>
              </label>
            } @else {
              <!-- Closed: no button carries the answer, so it is said. -->
              @if (m.myAnswer?.answer; as a) {
                <p class="m-0 text-[13px]" data-testid="meeting-my-answer">{{ ('meeting.answer.' + a.toLowerCase()) | translate }}</p>
              }
              <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.answer.closed' | translate }}</p>
            }
            @if (answerError()) {
              <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert">{{ answerError()! | translate }}</p>
            }
          </section>
        }

        <!-- PR 7c-1 — the review banner, for a present member while corrections are taken (may.review). -->
        @if (minutes(); as mm) {
          <am-meeting-review-banner [meetingId]="m.id" [minutes]="mm" [scheduledAt]="m.scheduledAt" (suggest)="suggestOpen.set(true)" (answered)="afterReview()" (reload)="load()" />
        }

        <div class="am-mp__grid grid gap-3" data-testid="meeting-grid">
          <div class="flex min-w-0 flex-col gap-3">
            <!-- The agenda, its editor and its papers (PR 7). -->
            <am-meeting-agenda-panel
              [meeting]="m"
              [items]="agenda()"
              [attendees]="attendees()"
              [papers]="files().papers"
              [canManage]="m.may.manageAgenda"
              (itemsChange)="onAgendaChange($event)"
              (filesChanged)="loadFiles()"
              [readError]="readFailed() ? readErrorKey[readFailed()!] : null"
              (retryRead)="retryRead()"
              (reload)="load()"
              [minutes]="minutes()"
              [openActions]="openActions()"
              (minutesChange)="minutes.set($event)"
              (raiseAction)="actionItem.set($event)"
              (declineSuggestion)="declining.set($event)"
              (suggestionApplied)="afterReview()"
            />
            <!-- General attachments: absent while empty for someone who may not add one. -->
            @if (m.may.manageAgenda || files().attachments.length > 0) {
              <section class="flex flex-col gap-2 rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] p-3" data-testid="meeting-attachments">
                <h2 class="m-0 flex items-center gap-2 text-[15px] font-semibold">
                  {{ 'meeting.files.attachments' | translate }}
                  <span class="text-meta text-[var(--am-ink-500)]">{{ format.number(files().attachments.length) }}</span>
                </h2>
                <am-meeting-file-list
                  [meetingId]="m.id"
                  [files]="files().attachments"
                  [canManage]="m.may.manageAgenda"
                  addLabel="meeting.files.addAttachment"
                  [contextLabel]="m.title"
                  testId="meeting-attachment-list"
                  (changed)="loadFiles()"
                />
              </section>
            }
          </div>

          @if (minutes(); as mm) {
            <!-- PR 7b — once the meeting is held, attendance takes the invitees' place. -->
            <div class="am-mp__side flex min-w-0 flex-col gap-3" data-testid="meeting-side">
              <am-meeting-attendance [meetingId]="m.id" [minutes]="mm" [scheduledAt]="m.scheduledAt" (minutesChange)="minutes.set($event)" (startReached)="refreshMinutes()" />
              <am-meeting-review-card
                [minutes]="mm"
                [failure]="wholeFailure()?.failure ?? null"
                [applying]="wholeApplying()"
                (apply)="applyWhole($event)"
                (decline)="declining.set($event)"
                (retry)="retryWhole()"
                (reload)="load()"
              />
            </div>
          } @else {
          <!-- Invitees -->
          <section class="am-mp__side flex flex-col gap-2 rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] p-3" data-testid="meeting-invitees">
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
                <li class="flex flex-col gap-0.5" [attr.data-attendee]="a.id">
                  <span class="flex items-center justify-between gap-2">
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate text-[13px]">
                        {{ a.name }}
                        @if (a.kind === 'OUTSIDE_GUEST') {
                          <span class="ms-1 text-[11px] px-1.5 py-px rounded border border-[var(--am-border)]" data-outside-chip>{{ 'meeting.invitees.outsideGuest' | translate }}</span>
                        }
                      </span>
                      <span class="truncate text-meta text-[var(--am-ink-500)]">{{ attendeeLine(a) }}</span>
                    </span>
                    <span class="flex flex-none items-center gap-1">
                      <span class="text-meta whitespace-nowrap" [class.text-[var(--am-ink-500)]]="!a.answer" data-attendee-answer>{{ answerLabel(a) | translate }}</span>
                      @if (canManageGuests() && a.kind !== 'MEMBER') {
                        <am-icon-button
                          icon="pi pi-times"
                          [label]="'meeting.invitees.removeGuest' | translate: { name: a.name }"
                          [disabled]="removing() !== null"
                          (activated)="removeGuest(a)"
                        />
                      }
                    </span>
                  </span>
                  @if (a.answerNote) {
                    <span class="text-meta text-[var(--am-ink-700)] break-words" data-attendee-note dir="auto">{{ a.answerNote }}</span>
                  }
                </li>
              }
            </ul>
            <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.invitees.guestsNoQuorum' | translate }}</p>
            @if (guestError()) {
              <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert">{{ guestError()! | translate }}</p>
            }
          </section>
          }
        </div>
      </div>

      <app-meeting-reschedule-dialog [visible]="rescheduleOpen()" (visibleChange)="rescheduleOpen.set($event)" [meeting]="m" (rescheduled)="load()" />
      <app-meeting-add-guest-dialog [visible]="guestOpen()" (visibleChange)="guestOpen.set($event)" [meeting]="m" (added)="load()" />
      <app-meeting-action-dialog
        [visible]="actionItem() !== null"
        (visibleChange)="$event ? null : actionItem.set(null)"
        [meetingId]="m.id"
        [item]="actionItem()"
        [attendance]="minutes()?.attendance ?? []"
        (saved)="minutes.set($event)"
      />
      <app-meeting-distribute-dialog
        [visible]="distributeOpen()"
        (visibleChange)="distributeOpen.set($event)"
        [meetingId]="m.id"
        [context]="m.title"
        [minutes]="minutes()"
        (distributed)="load()"
        (refreshMinutes)="refreshMinutes()"
      />
      <app-meeting-suggest-dialog
        [visible]="suggestOpen()"
        (visibleChange)="suggestOpen.set($event)"
        [meetingId]="m.id"
        [items]="minutes()?.items ?? []"
        (sent)="afterReview()"
        (reload)="load()"
      />
      <app-meeting-decline-dialog
        [visible]="declining() !== null"
        (visibleChange)="$event ? null : declining.set(null)"
        [meetingId]="m.id"
        [suggestion]="declining()"
        [itemOrder]="declineItemOrder()"
        (declined)="afterReview()"
        (reload)="load()"
      />
      <app-meeting-cant-approve-dialog
        [visible]="cantApprove() !== null"
        (visibleChange)="$event ? null : cantApprove.set(null)"
        [refusal]="cantApprove()"
        [context]="m.title + ' · ' + stage()"
      />
      <app-meeting-return-dialog
        [visible]="returnOpen()"
        (visibleChange)="returnOpen.set($event)"
        [meetingId]="m.id"
        [context]="m.title"
        [minutes]="minutes()"
        (returned)="load()"
        (reload)="load()"
      />
    }
  `,
  styles: [
    `
      /*
       * PR 7d-2 — the phone (artboard 14), as a CONTAINER query on the page's own
       * column, so the rule follows the space the page has (and a 390px layout
       * spec can measure it). Below two 300px cards side by side, the page is
       * one column: the side column's cards (attendance, the review card, the
       * invitees) come above the agenda, and every button is at least 44px tall
       * (44 x 44 for an icon-only one), in this page and the panels inside it.
       */
      .am-mp {
        container: meeting-page / inline-size;
      }
      .am-mp__grid {
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }
      @container meeting-page (max-width: 611.98px) {
        .am-mp__grid {
          grid-template-columns: minmax(0, 1fr);
        }
        .am-mp__side {
          order: -1;
        }
        .am-mp ::ng-deep .p-button {
          min-block-size: 44px;
        }
        .am-mp ::ng-deep .p-button.p-button-icon-only {
          min-inline-size: 44px;
        }
      }
      .am-segmented {
        display: inline-flex;
        align-self: flex-start;
        overflow: hidden;
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-button);
      }
      .am-segmented__option {
        min-block-size: var(--am-control-height);
        padding-inline: var(--am-space-16);
        font-size: var(--am-type-value-size);
        font-weight: 500;
        color: var(--am-ink-700);
        background: var(--am-control-bg);
        border: none;
        cursor: pointer;
      }
      .am-segmented__option + .am-segmented__option {
        border-inline-start: 1px solid var(--am-control-border);
      }
      .am-segmented__option:hover:not(:disabled) {
        background: var(--am-primary-50);
      }
      .am-segmented__option--active,
      .am-segmented__option--active:hover:not(:disabled) {
        color: var(--am-control-bg);
        background: var(--am-primary-600);
      }
      .am-segmented__option:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
    `,
  ],
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
  readonly files = signal<MeetingFilesDto>({ attachments: [], papers: [] });
  readonly answerChoices: { value: MeetingAnswer; labelKey: string; testId: string }[] = [
    { value: 'ATTENDING', labelKey: 'meeting.answer.attending', testId: 'meeting-answer-attending' },
    { value: 'CANT_ATTEND', labelKey: 'meeting.answer.cant_attend', testId: 'meeting-answer-cant' },
  ];
  readonly instance = signal<WorkflowInstanceDto | null>(null);
  readonly rescheduleOpen = signal(false);
  /** PR 7b — the minutes, where this person may read them (null otherwise, and before the meeting is held). */
  readonly minutes = signal<MeetingMinutesDto | null>(null);
  /** PR 7b — "Open actions from the last meeting", for whoever may read that meeting's minutes. */
  readonly openActions = signal<MeetingOpenActionsDto | null>(null);
  /** The agenda item "Raise action item" was pressed on, while its dialog is open. */
  readonly actionItem = signal<{ id: string; order: number; title: string } | null>(null);
  readonly distributeOpen = signal(false);
  // PR 7c-1 — the review.
  readonly suggestOpen = signal(false);
  readonly declining = signal<MeetingSuggestionDto | null>(null);
  readonly returnOpen = signal(false);
  // PR 7c-2 — Approve Minutes held by what its precondition names.
  readonly approvalBlocks = MEETING_APPROVAL_BLOCKS;
  /** "Why?" on Approve Minutes, or a press refused for one of those codes. */
  readonly cantApprove = signal<{ move: WorkflowMoveDto; blockedBy: MoveBlock } | null>(null);
  /** The whole-minutes suggestion being marked applied, while the request is in flight. */
  readonly wholeApplying = signal<string | null>(null);
  /** How the last whole-minutes Mark applied failed, with the suggestion to retry. */
  readonly wholeFailure = signal<{ suggestion: MeetingSuggestionDto; failure: MeetingFailure } | null>(null);
  /** The place of the item the suggestion being declined is about. */
  readonly declineItemOrder = computed(() => {
    const s = this.declining();
    return s?.agendaItemId ? (this.minutes()?.items.find((i) => i.id === s.agendaItemId)?.order ?? null) : null;
  });
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
  /** "Members: 6 attending · 2 can't attend · 1 no answer · quorum 5", counted strings. */
  readonly summary = computed(() => {
    const s = this.meeting()?.answers;
    if (!s) return '';
    const parts = [
      this.format.count('meeting.attending', s.attending),
      this.format.count('meeting.cantAttend', s.cantAttend),
      this.format.count('meeting.noAnswer', s.noAnswer),
    ];
    const quorum = s.quorum != null ? this.format.count('meeting.quorum', s.quorum) : null;
    // Members only (quorum is about members): said, so it reads against the list below.
    return this.translate.instant('meeting.invitees.membersSummary', { counts: [...parts, ...(quorum ? [quorum] : [])].join(' · ') }) as string;
  });

  constructor() {
    registerPageName(() => this.meeting()?.title ?? null);
    // P211 — an answer dropped as older than a newer write: once the newest
    // settles, the minutes are read again, so a saved write is never left unseen.
    inject(MinutesWriteOrder)
      .reread.pipe(takeUntilDestroyed())
      .subscribe(() => this.refreshMinutes());
    this.load();
  }

  /** A re-read after a write that failed: said in the agenda panel, with Retry (P198). */
  readonly readFailed = signal<'files' | 'attendees' | 'minutes' | 'openActions' | null>(null);
  readonly readErrorKey = {
    files: 'meeting.files.loadFailed',
    attendees: 'meeting.invitees.loadFailed',
    minutes: 'meeting.minutes.loadFailed',
    openActions: 'meeting.openActions.loadFailed',
  } as const;

  load(): void {
    forkJoin({
      meeting: this.meetings.get(this.id),
      attendees: this.meetings.attendees(this.id),
      agenda: this.meetings.agenda(this.id),
      files: this.meetings.files(this.id),
      instances: this.workflow.getInstancesByObject('MEETING', this.id),
      // PR 7b — read alongside; a refusal is "not for you", any other failure is said with Retry.
      minutes: this.optional(this.meetings.minutes(this.id), 'minutes'),
      openActions: this.optional(this.meetings.openActions(this.id), 'openActions'),
    }).subscribe({
      next: ({ meeting, attendees, agenda, files, instances, minutes, openActions }) => {
        this.meeting.set(meeting);
        // The note as stored, so the next answer keeps it rather than clearing it.
        this.answerNote = meeting.myAnswer?.note ?? '';
        this.attendees.set(attendees);
        this.agenda.set(agenda);
        this.files.set(files);
        this.minutes.set(minutes);
        this.openActions.set(openActions);
        if (this.readFailed() === 'files' || this.readFailed() === 'attendees') this.readFailed.set(null);
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

  /** The agenda as the server returns it after a write; a new presenter may be a new invitee. */
  onAgendaChange(items: MeetingAgendaItemDto[]): void {
    this.agenda.set(items);
    this.loadAttendees();
  }

  /** A presenter may have been added as a guest: the invitees are read again, and a failure is said. */
  loadAttendees(): void {
    this.meetings.attendees(this.id).subscribe({
      next: (a) => {
        this.attendees.set(a);
        if (this.readFailed() === 'attendees') this.readFailed.set(null);
      },
      error: () => this.readFailed.set('attendees'),
    });
  }

  loadFiles(): void {
    this.meetings.files(this.id).subscribe({
      next: (f) => {
        this.files.set(f);
        if (this.readFailed() === 'files') this.readFailed.set(null);
      },
      error: () => this.readFailed.set('files'),
    });
  }

  /** A review answer, suggestion, apply or decline: the minutes are read again. */
  afterReview(): void {
    this.wholeFailure.set(null);
    this.refreshMinutes();
  }

  /**
   * Mark applied on a suggestion about the minutes as a whole: there is no item
   * to edit. One request at a time; MEETING_SUGGESTION_DECIDED means an earlier
   * press (or a lost answer) already applied it, so it reads as applied (P220).
   * A failure is said from its code (Retry only when the server could not be
   * reached), never as "Your edit was saved", since nothing was edited.
   */
  applyWhole(s: MeetingSuggestionDto): void {
    if (this.wholeApplying() !== null) return;
    this.wholeFailure.set(null);
    this.wholeApplying.set(s.id);
    this.meetings.applySuggestion(this.id, s.id).subscribe({
      next: () => {
        this.wholeApplying.set(null);
        this.afterReview();
      },
      error: (err: unknown) => {
        this.wholeApplying.set(null);
        if (refusalCode(err) === 'MEETING_SUGGESTION_DECIDED') {
          this.afterReview();
          return;
        }
        this.wholeFailure.set({ suggestion: s, failure: meetingFailure(err, 'meeting.review.markFailed', 'meeting.review.markFailed') });
      },
    });
  }

  retryWhole(): void {
    const f = this.wholeFailure();
    if (f) this.applyWhole(f.suggestion);
  }

  /** The minutes read again (attendance opens at the start time, without a reload). */
  refreshMinutes(): void {
    this.optional(this.meetings.minutes(this.id), 'minutes').subscribe((m) => {
      if (m) this.minutes.set(m);
    });
  }

  /** Retry the read that failed after a write. */
  retryRead(): void {
    if (this.readFailed() === 'files') this.loadFiles();
    else if (this.readFailed() === 'attendees') this.loadAttendees();
    else if (this.readFailed() === 'minutes' || this.readFailed() === 'openActions') this.load();
  }

  /**
   * A read the page shows only to some: a 403 or 404 (the minutes not open to
   * this person yet) is simply nothing to show; any other failure is said in
   * the agenda panel's line, with Retry, never swallowed.
   */
  private optional<T>(read: Observable<T>, which: 'minutes' | 'openActions'): Observable<T | null> {
    if (this.readFailed() === which) this.readFailed.set(null);
    return read.pipe(
      catchError((err: unknown) => {
        if (!(err instanceof HttpErrorResponse && (err.status === 403 || err.status === 404))) this.readFailed.set(which);
        return of(null);
      }),
    );
  }

  /** "Attending", "Can't attend" or "No answer", at the end of each invitee's row. */
  answerLabel(a: MeetingAttendeeDto): string {
    return a.answer === 'ATTENDING' ? 'meeting.invitees.attending' : a.answer === 'CANT_ATTEND' ? 'meeting.invitees.cantAttend' : 'meeting.invitees.noAnswer';
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
    // PR 7c-2 — Approve Minutes: the minutes become final and the action items tasks.
    if ((move.toStageFlags ?? []).includes(MEETING_STAGE_FLAG.MINUTES_FINAL)) {
      return { titleKey: 'meeting.approve.title', leadKey: 'meeting.approve.lead', confirmKey: 'meeting.approve.confirm', keepKey: 'meeting.approve.keep', danger: false };
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
}
