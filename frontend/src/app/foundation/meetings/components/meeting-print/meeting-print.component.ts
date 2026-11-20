import { Component, DestroyRef, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { forkJoin } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { registerPageName } from '../../../../core/services/document-title.service';
import { IdleService } from '../../../../core/services/idle.service';
import { SessionLimitService } from '../../../../core/services/session-limit.service';
import { IdleWarningComponent } from '../../../../core/components/idle-warning/idle-warning.component';
import { SessionLimitWarningComponent } from '../../../../core/components/session-limit-warning/session-limit-warning.component';
import { ownerName } from '../../meeting-display';
import { refusalCode } from '../../../../core/http/refusal';
import {
  MeetingService,
  type MeetingAttendanceRowDto,
  type MeetingAttendeeDto,
  type MeetingDto,
  type MeetingMinutesDto,
} from '../../services/meeting.service';

type PrintState = 'loading' | 'ready' | 'notApproved' | 'notFound' | 'error';

/**
 * ACC-316 PR 7d-1 — the approved minutes on A4 (Meeting Screens, artboard 13):
 * `/meetings/:id/print`, a route OUTSIDE the app shell, so the page carries no
 * rail or top bar on screen or on paper. A browser print page, no PDF.
 *
 * - **Approved minutes only.** Before Minutes Approved the page says they
 *   aren't approved yet and prints nothing: a draft is never printable as the
 *   minutes. Who may open it is the minutes read's own rule; anyone else gets
 *   the not-found state the meeting page gives.
 * - **What's on it:** the organisation, the committee or unit, the title, when
 *   and where; attendance in five groups with the quorum line; each item's
 *   discussion, decisions, votes, "Taken without quorum" and action items; the
 *   approval line, at the top and again at the end.
 * - **Black on white, no colour carries meaning**; a mark prints as outlined text.
 * - **The print stylesheet** sets A4 portrait with 18mm margins, hides the
 *   on-screen bar (Back, Print), and numbers the pages "1 / 3" in a page margin
 *   box (`counter(pages)`, Chrome/Edge 131+). Where margin boxes aren't
 *   supported (Safari 16.4, Firefox 115 ESR) there is no page number (plan §8).
 *   The number is language-neutral because a margin box's text can't be
 *   translated.
 * - **Dates** go through the formatting layer, so Hijri follows the reader's
 *   preference, as the screen does (P229, ACC-94 D4).
 * - **The session clocks** (idle sign-out, the 12-hour limit) are started here,
 *   as the shell starts them, with their warnings (P232).
 */
@Component({
  selector: 'app-meeting-print',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, RouterLink, IdleWarningComponent, SessionLimitWarningComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <!-- P232 — outside the shell, so this page runs the shell's two session
         clocks itself, and draws their warnings the same way (deferred). -->
    @defer (on idle; when idle.warningVisible()) {
      <app-idle-warning />
    }
    @defer (on idle; when sessionLimit.warningVisible()) {
      <app-session-limit-warning />
    }
    @switch (state()) {
      @case ('loading') {
        <p class="am-print-msg" role="status">{{ 'meeting.print.loading' | translate }}</p>
      }
      @case ('notApproved') {
        <div class="am-print-msg" data-testid="meeting-print-not-approved">
          <p>{{ 'meeting.print.notApproved' | translate }}</p>
          <a [routerLink]="['/meetings', id]">{{ 'meeting.print.back' | translate }}</a>
        </div>
      }
      @case ('notFound') {
        <div class="am-print-msg" data-testid="meeting-print-not-found">
          <p>{{ 'meeting.page.notFound' | translate }}</p>
          <a routerLink="/meetings">{{ 'meeting.page.back' | translate }}</a>
        </div>
      }
      @case ('error') {
        <div class="am-print-msg" data-testid="meeting-print-error">
          <p role="alert">{{ 'meeting.page.loadError' | translate }}</p>
          <p-button size="small" severity="secondary" [label]="'common.retry' | translate" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (meeting(); as m) {
          <nav class="am-print-bar" [attr.aria-label]="'meeting.print.toolbar' | translate">
            <a [routerLink]="['/meetings', m.id]" data-testid="meeting-print-back">‹ {{ 'meeting.print.back' | translate }}</a>
            <p-button size="small" icon="pi pi-print" [label]="'meeting.print.print' | translate" data-testid="meeting-print-print" (onClick)="print()" />
          </nav>
          <article class="am-print" data-testid="meeting-print">
            <header class="am-print__head">
              <div>
                <p class="am-print__org" data-testid="meeting-print-org">{{ organisation() }}</p>
                <p class="am-print__owner">{{ owner() }}</p>
              </div>
              <p class="am-print__kind">{{ 'meeting.print.minutes' | translate }}</p>
            </header>
            <h1 class="am-print__title">{{ m.title }}</h1>
            <p data-testid="meeting-print-when">{{ when() }}</p>
            @if (m.location) {
              <p>{{ m.location }}</p>
            }
            @if (m.meetingUrl) {
              <p dir="ltr" class="am-print__url">{{ m.meetingUrl }}</p>
            }
            <p class="am-print__approval" data-testid="meeting-print-approval">{{ approvalLine() }}</p>

            <h2 class="am-print__h">{{ 'meeting.print.attendance' | translate }}</h2>
            <dl class="am-print__groups" data-testid="meeting-print-attendance">
              @for (g of groups(); track g.key) {
                <div class="am-print__group" [attr.data-group]="g.key">
                  <dt>{{ g.label | translate }}</dt>
                  <dd>
                    @for (p of g.people; track $index; let last = $last) {
                      <span>{{ p.text }}</span>
                      @if (p.outside) {
                        <span class="am-print__mark">{{ 'meeting.invitees.outsideGuest' | translate }}</span>
                      }
                      @if (!last) {
                        <span>{{ separator() }}</span>
                      }
                    }
                  </dd>
                </div>
              }
            </dl>
            <p class="am-print__quorum" data-testid="meeting-print-quorum">{{ quorumLine() }}</p>

            <h2 class="am-print__h">{{ 'meeting.print.items' | translate }}</h2>
            @for (item of minutes()!.items; track item.id) {
              <section class="am-print__item" [attr.data-item]="item.order">
                <h3>{{ 'meeting.print.itemTitle' | translate: { n: format.number(item.order), title: item.title } }}</h3>
                @if (item.discussion) {
                  <p class="am-print__text" dir="auto">{{ 'meeting.print.discussion' | translate: { text: item.discussion } }}</p>
                }
                @for (d of item.decisions; track d.id) {
                  <p class="am-print__text" dir="auto" data-print-decision>{{ 'meeting.print.decision' | translate: { text: d.text } }}</p>
                  @if (d.votes; as v) {
                    <p class="am-print__strong">{{ 'meeting.print.vote' | translate: { for: format.number(v.for), against: format.number(v.against), abstain: format.number(v.abstain) } }}</p>
                  }
                  @if (d.takenWithoutQuorum) {
                    <p><span class="am-print__mark" data-print-without-quorum>{{ 'meeting.minutes.withoutQuorum' | translate }}</span></p>
                  }
                }
                @if (item.actionItems.length) {
                  <p class="am-print__strong">{{ 'meeting.print.actionItems' | translate }}</p>
                  <ul class="am-print__actions">
                    @for (a of item.actionItems; track a.id) {
                      <li data-print-action>{{ 'meeting.print.actionLine' | translate: { title: a.title, owner: a.owner.name, date: format.date(a.dueAt) } }}</li>
                    }
                  </ul>
                }
              </section>
            }

            <footer class="am-print__end">
              <p class="am-print__approval">{{ approvalLine() }}</p>
              <p class="am-print__foot">{{ m.title }} · {{ format.date(m.scheduledAt) }}</p>
            </footer>
          </article>
        }
      }
    }
  `,
  styles: [
    `
      /*
       * Every colour, radius, space and type size is a design token. Only the
       * rule widths (1px, 2px) and the screen column (760px) are literal:
       * there is no token for either. Print stays on the tokens too: the card
       * (white) and ink-900, which prints as near-black, so the paper reads
       * as the screen does.
       */
      app-meeting-print {
        display: block;
        background: var(--am-card);
        color: var(--am-ink-900);
        min-block-size: 100vh;
      }
      .am-print-msg {
        max-inline-size: 760px;
        margin: var(--am-space-24) auto;
        padding-inline: var(--am-space-16);
      }
      .am-print-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-12);
        max-inline-size: 760px;
        margin: 0 auto;
        padding: var(--am-space-12) var(--am-space-16);
      }
      .am-print-bar a {
        color: var(--am-primary-700);
      }
      .am-print {
        max-inline-size: 760px;
        margin: 0 auto;
        padding: var(--am-space-16);
        font-size: var(--am-type-value-size);
        line-height: var(--am-type-value-line);
      }
      .am-print p {
        margin: 0;
      }
      .am-print__head {
        display: flex;
        justify-content: space-between;
        gap: var(--am-space-12);
        padding-block-end: var(--am-space-8);
        border-block-end: 2px solid currentColor;
      }
      .am-print__org {
        font-weight: 600;
      }
      .am-print__kind {
        font-weight: 700;
      }
      .am-print__title {
        margin: var(--am-space-12) 0 var(--am-space-4);
        font-size: var(--am-type-title-size);
        line-height: var(--am-type-title-line);
        font-weight: 700;
      }
      .am-print__approval {
        margin-block-start: var(--am-space-8) !important;
        font-weight: 600;
      }
      .am-print__h {
        margin: var(--am-space-16) 0 var(--am-space-4);
        padding-block: var(--am-space-4);
        border-block-end: 1px solid currentColor;
        font-size: var(--am-type-meta-size);
        font-weight: 700;
      }
      .am-print__groups {
        margin: 0;
      }
      .am-print__group {
        display: grid;
        grid-template-columns: 8.5em 1fr;
        gap: var(--am-space-8);
        padding-block: var(--am-space-2);
      }
      .am-print__group dt {
        font-weight: 600;
      }
      .am-print__group dd {
        margin: 0;
      }
      .am-print__quorum {
        margin-block-start: var(--am-space-4) !important;
        font-weight: 600;
      }
      .am-print__item {
        padding-block-start: var(--am-space-8);
        break-inside: avoid;
      }
      .am-print__item h3 {
        margin: 0;
        font-size: var(--am-type-body-size);
        line-height: var(--am-type-body-line);
        font-weight: 700;
      }
      .am-print__text {
        white-space: pre-line;
      }
      .am-print__strong {
        font-weight: 600;
      }
      /* A mark is outlined text: no colour carries meaning on paper. */
      .am-print__mark {
        display: inline-block;
        margin-inline-start: var(--am-space-4);
        padding: 0 var(--am-space-6);
        border: 1px solid currentColor;
        border-radius: var(--am-radius-pill);
        font-size: var(--am-type-meta-size);
        font-weight: 600;
      }
      .am-print__actions {
        margin: 0;
        padding-inline-start: var(--am-space-20);
      }
      .am-print__end {
        margin-block-start: var(--am-space-16);
        padding-block-start: var(--am-space-8);
        border-block-start: 1px solid currentColor;
      }
      .am-print__foot {
        margin-block-start: var(--am-space-4) !important;
        font-size: var(--am-type-meta-size);
      }
      @page {
        size: A4 portrait;
        margin: 18mm;
        @bottom-right {
          content: counter(page) ' / ' counter(pages);
          font-size: var(--am-type-meta-size);
        }
      }
      @media print {
        app-meeting-print {
          min-block-size: 0;
        }
        .am-print-bar {
          display: none !important;
        }
        .am-print {
          max-inline-size: none;
          margin: 0;
          padding: 0;
        }
      }
    `,
  ],
})
export class MeetingPrintComponent {
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly access = inject(NavigationAccessService);
  readonly format = inject(FormatService);
  protected readonly idle = inject(IdleService);
  protected readonly sessionLimit = inject(SessionLimitService);

  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  readonly state = signal<PrintState>('loading');
  readonly meeting = signal<MeetingDto | null>(null);
  readonly minutes = signal<MeetingMinutesDto | null>(null);
  private readonly attendees = signal<MeetingAttendeeDto[]>([]);

  constructor() {
    registerPageName(() => this.meeting()?.title ?? null);
    // P232 — the shell starts these for every signed-in page (ACC-122, ACC-126);
    // this page is outside the shell, so it starts them exactly as the shell
    // does: the idle clock (idempotent, and it stops itself on destroy) and the
    // 12-hour limit's clock, stopped when the page goes.
    this.idle.start();
    this.sessionLimit.start();
    inject(DestroyRef).onDestroy(() => this.sessionLimit.stop());
    this.load();
  }

  load(): void {
    this.state.set('loading');
    forkJoin({ meeting: this.meetings.get(this.id), minutes: this.meetings.minutes(this.id), attendees: this.meetings.attendees(this.id) }).subscribe({
      next: ({ meeting, minutes, attendees }) => {
        this.meeting.set(meeting);
        this.minutes.set(minutes);
        this.attendees.set(attendees);
        this.state.set(minutes.phase === 'approved' ? 'ready' : 'notApproved');
      },
      error: (err: unknown) => {
        // Not open yet (MEETING_MINUTES_NOT_OPEN) is "not approved"; not seen is not found.
        if (refusalCode(err) === 'MEETING_MINUTES_NOT_OPEN') this.state.set('notApproved');
        else if (err instanceof HttpErrorResponse && (err.status === 404 || err.status === 403)) this.state.set('notFound');
        else this.state.set('error');
      },
    });
  }

  print(): void {
    window.print();
  }

  readonly organisation = computed(() => this.access.tenantName());
  readonly owner = computed(() => {
    const m = this.meeting();
    return m ? ownerName(m.owner, this.language) : '';
  });
  readonly separator = computed(() => {
    this.language.isArabic();
    return this.translate.instant('common.listSeparator') as string;
  });

  /** "24 Sep 2026, 10:00–11:30": the start, and the end when a duration is set (as the meeting page). */
  readonly when = computed(() => {
    const m = this.meeting();
    if (!m) return '';
    const start = this.format.dateTime(m.scheduledAt);
    if (!m.durationMinutes) return start;
    return `${start}–${this.format.timeOfDay(new Date(new Date(m.scheduledAt).getTime() + m.durationMinutes * 60_000))}`;
  });

  /** "Approved by Dr. Fahad Al-Anazi (Chair) on 6 Oct 2026, after review by the 6 present members." */
  readonly approvalLine = computed(() => {
    this.language.isArabic();
    const mm = this.minutes();
    if (!mm?.approvedAt) return '';
    const by = mm.approvedBy;
    const seat = by?.seat ? this.language.bilingual(by.seat.labelEn, by.seat.labelAr) : null;
    const who = by ? (seat ? (this.translate.instant('meeting.print.nameSeat', { name: by.name, seat }) as string) : by.name) : '—';
    return this.format.count('meeting.print.approvedBy', mm.quorum.presentMembers, { who, date: this.format.date(mm.approvedAt) });
  });

  /** Attendance in five groups: members present, with apologies and absent; then the guests who came. */
  readonly groups = computed(() => {
    this.language.isArabic();
    const rows = this.minutes()?.attendance ?? [];
    const extra = new Map(this.attendees().map((a) => [a.id, a]));
    const member = (r: MeetingAttendanceRowDto) => ({
      text: r.seat ? (this.translate.instant('meeting.print.nameSeat', { name: r.name, seat: this.language.bilingual(r.seat.labelEn, r.seat.labelAr) }) as string) : r.name,
      outside: false,
    });
    const members = rows.filter((r) => r.kind === 'MEMBER');
    const came = (kind: MeetingAttendanceRowDto['kind']) => rows.filter((r) => r.kind === kind && r.attendance === 'PRESENT');
    const outside = (r: MeetingAttendanceRowDto) => {
      const a = extra.get(r.attendeeId);
      return { text: [r.name, a?.outsideOrganisation, a?.outsideRole].filter((x) => !!x).join(this.translate.instant('common.listSeparator') as string), outside: true };
    };
    return [
      { key: 'present', label: 'meeting.print.present', people: members.filter((r) => r.attendance === 'PRESENT').map(member) },
      { key: 'apologies', label: 'meeting.print.apologies', people: members.filter((r) => r.attendance === 'APOLOGIES').map(member) },
      { key: 'absent', label: 'meeting.print.absent', people: members.filter((r) => r.attendance === 'ABSENT').map(member) },
      { key: 'guests', label: 'meeting.print.guests', people: came('ORG_GUEST').map((r) => ({ text: r.name, outside: false })) },
      { key: 'outside', label: 'meeting.print.outsideGuests', people: came('OUTSIDE_GUEST').map(outside) },
    ].filter((g) => g.people.length > 0);
  });

  /** "✓ Quorum met · 6 of 9 present, quorum 5. Guests don't count toward quorum." */
  readonly quorumLine = computed(() => {
    this.language.isArabic();
    const mm = this.minutes();
    if (!mm) return '';
    const q = mm.quorum;
    const members = this.format.number(mm.attendance.filter((r) => r.kind === 'MEMBER').length);
    const present = this.format.number(q.presentMembers);
    const guests = this.translate.instant('meeting.print.guestsNoQuorum') as string;
    if (q.quorum == null) return `${this.translate.instant('meeting.attendance.presentOf', { present, members }) as string}. ${guests}`;
    const quorum = this.format.number(q.quorum);
    const line = q.met
      ? (this.translate.instant('meeting.attendance.quorumMet', { present, members, quorum }) as string)
      : (this.translate.instant('meeting.print.quorumNotMet', { present, members, quorum }) as string);
    return `${line}. ${guests}`;
  });

}
