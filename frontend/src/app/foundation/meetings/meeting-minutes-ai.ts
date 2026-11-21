import { Injectable, computed, inject, signal } from '@angular/core';
import { ReplaySubject, Subject, type Observable } from 'rxjs';
import { MinutesWriteOrder } from './minutes-write-order';
import {
  MeetingService,
  type MeetingAiAcceptRequest,
  type MeetingAiActionSuggestionDto,
  type MeetingAiDto,
  type MeetingAiMinutesSuggestionDto,
  type MeetingMinutesDto,
} from './services/meeting.service';

/**
 * How long the screen waits for Draft minutes: longer than the server's own
 * 300 s call (`AI_FEATURES.minutes_drafting.timeoutMs`, P249) plus its save.
 * Giving up earlier would say "timed out" while the server finishes the run
 * and charges for it. On a client timeout the screen reads the run's state
 * (`GET …/ai`) and shows it running, or its saved suggestions: never Retry.
 */
export const DRAFT_MINUTES_WAIT_MS = 330_000;

/**
 * ACC-322 PR 2 — the meeting page's Meetings AI state for Draft minutes: the
 * one AI read (GET /meetings/:id/ai), shared by the Rough notes box, each
 * item's suggestions, the agenda panel's header count and the Action items
 * card. Provided by the meeting page, beside MinutesWriteOrder.
 *
 * Every flag is the server's: who may draft, whether AI is available, what is
 * left to draft (M8). Nothing here re-derives a rule.
 *
 * Accept is a minutes write: it answers with the whole minutes, which the
 * page shows only when it answers the newest minutes write (P206). A draft or
 * a discard changes the undecided count without a minutes answer, so the page
 * reads the minutes again (`countChanged`) and Distribute's confirm says the
 * current count (M2).
 */
@Injectable()
export class MeetingMinutesAi {
  private readonly meetings = inject(MeetingService);
  private readonly order = inject(MinutesWriteOrder, { optional: true }) ?? new MinutesWriteOrder();

  private meetingId: string | null = null;
  /** Each read is numbered: an older answer never replaces a newer one. */
  private reads = 0;

  readonly ai = signal<MeetingAiDto | null>(null);
  /** The read failed (not a refusal): the box says so, with Retry. */
  readonly loadFailed = signal(false);
  /** An accept answered with the minutes, and it answers the newest minutes write: the page shows them. */
  readonly minutesChange = new Subject<MeetingMinutesDto>();
  /** The undecided count changed without a minutes answer (a draft, a discard): the page reads the minutes again. */
  readonly countChanged = new Subject<void>();

  readonly actionSuggestions = computed(() => this.ai()?.suggestions.actions ?? []);
  readonly minutesSuggestions = computed(() => this.ai()?.suggestions.minutes ?? []);
  /** "3 items drafted": minutes suggestions with something in them (a "nothing" item is not drafted). */
  readonly itemsDrafted = computed(() => this.minutesSuggestions().filter((s) => !s.nothing).length);

  /** Read for this meeting (the page calls it while the minutes are a draft the viewer records). */
  load(meetingId: string): void {
    if (this.meetingId !== meetingId) this.ai.set(null);
    this.meetingId = meetingId;
    this.reread();
  }

  /** Read again, keeping what is shown until the answer comes. Returns the read, for a caller that waits on it. */
  reread(): Observable<MeetingAiDto> | null {
    const id = this.meetingId;
    if (!id) return null;
    const seq = ++this.reads;
    const read = new ReplaySubject<MeetingAiDto>(1);
    this.meetings.ai(id).subscribe({
      next: (ai) => {
        if (seq === this.reads && id === this.meetingId) {
          this.ai.set(ai);
          this.loadFailed.set(false);
        }
        read.next(ai);
        read.complete();
      },
      error: (err: unknown) => {
        if (seq === this.reads && id === this.meetingId) this.loadFailed.set(true);
        read.error(err);
      },
    });
    return read;
  }

  /** Not a draft the viewer records any more (or another meeting): nothing to show. */
  clear(): void {
    this.meetingId = null;
    this.reads++;
    this.ai.set(null);
    this.loadFailed.set(false);
  }

  /** An answer from a draft, a discard or an accept: the newest read wins over anything older. */
  set(ai: MeetingAiDto): void {
    this.reads++;
    this.ai.set(ai);
    this.loadFailed.set(false);
  }

  minutesOf(itemId: string): MeetingAiMinutesSuggestionDto | null {
    return this.minutesSuggestions().find((s) => s.agendaItemId === itemId) ?? null;
  }

  actionsOf(itemId: string): MeetingAiActionSuggestionDto[] {
    return this.actionSuggestions().filter((s) => s.agendaItemId === itemId);
  }

  /** Accept one suggestion (an action's Edit sends what it chose). Answers both reads. */
  accept(suggestionId: string, body: MeetingAiAcceptRequest = {}): Observable<{ minutes: MeetingMinutesDto; ai: MeetingAiDto }> {
    const seq = this.order.begin();
    const done = new ReplaySubject<{ minutes: MeetingMinutesDto; ai: MeetingAiDto }>(1);
    this.meetings.acceptAi(this.meetingId!, suggestionId, body).subscribe({
      next: (answer) => {
        this.set(answer.ai);
        if (this.order.answered(seq)) this.minutesChange.next(answer.minutes);
        done.next(answer);
        done.complete();
      },
      error: (err: unknown) => {
        this.order.failed(seq);
        done.error(err);
      },
    });
    return done;
  }

  discard(suggestionId: string): Observable<MeetingAiDto> {
    const done = new ReplaySubject<MeetingAiDto>(1);
    this.meetings.discardAi(this.meetingId!, suggestionId).subscribe({
      next: (ai) => {
        this.set(ai);
        this.countChanged.next();
        done.next(ai);
        done.complete();
      },
      error: (err: unknown) => done.error(err),
    });
    return done;
  }
}
