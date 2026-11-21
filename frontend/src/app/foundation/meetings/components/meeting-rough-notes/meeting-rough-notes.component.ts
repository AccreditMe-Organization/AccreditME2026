import { Component, Injector, OnDestroy, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { TimeoutError, catchError, finalize, map, of, shareReplay, switchMap, throwError, timeout, type Observable, type Subscription } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { aiRefusal, type AiRefusal } from '../../../../core/ai/ai-refusal';
import { refusalCode } from '../../../../core/http/refusal';
import { AiAssistComponent, type AiAssistState } from '../../../../shared/components/ai-assist/ai-assist.component';
import { type MeetingFailure, meetingFailure, meetingUnreachable } from '../../meeting-refusal';
import { DRAFT_MINUTES_WAIT_MS, MeetingMinutesAi } from '../../meeting-minutes-ai';
import { MeetingService, type MeetingAiDto } from '../../services/meeting.service';

/** The notes' cap, as the server's (NOTES_MAX, plan step-322 §1.2). */
export const ROUGH_NOTES_MAX = 18_000;
/** Typing pauses this long before the notes are saved. */
const SAVE_AFTER_MS = 800;
/** The items one press drafts at most (ITEMS_PER_CALL): the working line names no more. */
const ITEMS_PER_PRESS = 6;

/** The notes could not be saved, so Draft minutes (which reads the SAVED notes) does not go ahead. */
class NotesNotSaved extends Error {}

/**
 * ACC-322 PR 2 — the Rough notes box and Draft minutes, at the top of Agenda &
 * minutes ("AccreditMe AI for Users" 6.2). Only for whoever records the
 * minutes while they are a draft the meeting was never returned from: the AI
 * read's `minutes.may` (M9 included). Nobody else sees the box (M3, 6.6).
 *
 * THE NOTES are saved as typed (after a pause) and are never written back
 * into the box from an answer: the server trims, so writing back would eat a
 * trailing space under the cursor. A press saves any unsaved text first,
 * because the server drafts from the SAVED notes.
 *
 * THE PRESS waits longer than the server's 300 s call (DRAFT_MINUTES_WAIT_MS).
 * If the page stops waiting (a client timeout, the connection lost, or
 * Cancel), the run goes on on the server and is charged: the screen reads its
 * state and shows it running, with "Check again", or its saved suggestions.
 * It never offers Retry for a run that may still be going.
 *
 * Every refusal is said from its code: the AI gateway's through
 * core/ai/ai-refusal.ts, the meeting's through meeting-refusal.ts.
 */
@Component({
  selector: 'am-meeting-rough-notes',
  standalone: true,
  imports: [FormsModule, TranslatePipe, ButtonModule, TextareaModule, AiAssistComponent],
  template: `
    @if (ai(); as a) {
      @if (a.minutes.may) {
        <div class="am-rn flex flex-col gap-1" data-testid="meeting-rough-notes">
          <div class="flex flex-wrap items-center gap-2">
            <label class="me-auto text-[12.5px] font-medium text-[var(--am-ink-700)]" for="meetingRoughNotes">{{ 'meeting.ai.roughNotes' | translate }}</label>
            @if (offered()) {
              <am-ai-assist
                placement="inline"
                [hideResult]="true"
                [state]="triggerState()"
                [triggerLabel]="'meeting.ai.draftMinutes' | translate"
                [againLabel]="'meeting.ai.draftAgain' | translate"
                [hasResult]="a.undecided > 0"
                [cancellable]="waiting()"
                (trigger)="draft()"
                (cancel)="stopWaiting()"
                data-testid="meeting-ai-draft"
              />
            }
          </div>
          <textarea
            pTextarea
            id="meetingRoughNotes"
            class="am-rn__box"
            rows="6"
            [attr.maxlength]="max"
            [attr.aria-describedby]="'meetingRoughNotesHint'"
            [ngModel]="text()"
            (ngModelChange)="typed($event)"
            data-testid="meeting-rough-notes-box"
          ></textarea>
          <p class="m-0 text-[11.5px] text-[var(--am-ink-500)]" id="meetingRoughNotesHint">{{ 'meeting.ai.notesHint' | translate }} {{ 'meeting.ai.notesProvider' | translate }}</p>
          @if (notesFailed(); as f) {
            <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="meeting-rough-notes-error">
              {{ f.key | translate }}
              @if (f.offer === 'retry') {
                <p-button size="small" [text]="true" [label]="'common.retry' | translate" (onClick)="saveNow()" />
              } @else if (f.offer === 'reload') {
                <p-button size="small" [text]="true" [label]="'meeting.agenda.reload' | translate" (onClick)="reload.emit()" />
              }
            </p>
          }
          @if (noNotes()) {
            <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="meeting-ai-no-notes">{{ 'meeting.refusal.aiNoNotes' | translate }}</p>
          }
          <am-ai-assist
            [hideTrigger]="true"
            [state]="resultState()"
            [triggerLabel]="'meeting.ai.draftMinutes' | translate"
            [workingText]="workingText()"
            [refusal]="refusal()"
            (retry)="draft()"
            data-testid="meeting-ai-outcome"
          />
          @if (runningElsewhere()) {
            <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-ink-700)]" role="status" data-testid="meeting-ai-running">
              {{ (stopped() ? 'meeting.ai.stopped' : 'meeting.ai.running') | translate }}
              <p-button size="small" [text]="true" [label]="'meeting.ai.checkAgain' | translate" data-testid="meeting-ai-check-again" (onClick)="checkAgain()" />
            </p>
          }
          @if (failure(); as f) {
            <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="meeting-ai-failure">
              {{ f.key | translate }}
              @if (f.offer === 'reload') {
                <p-button size="small" [text]="true" [label]="'meeting.agenda.reload' | translate" data-testid="meeting-ai-reload" (onClick)="reload.emit()" />
              }
            </p>
          }
          <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
        </div>
      }
    } @else if (store.loadFailed()) {
      <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="meeting-ai-load-failed">
        {{ 'meeting.ai.loadFailed' | translate }}
        <p-button size="small" [text]="true" [label]="'common.retry' | translate" (onClick)="store.reread()" />
      </p>
    }
  `,
  styles: [
    `
      .am-rn {
        padding: var(--am-space-8) var(--am-space-12);
        margin-inline: calc(var(--am-space-12) * -1);
        border-block: 1px solid var(--am-border);
        background: var(--am-surface);
      }
      .am-rn__box {
        inline-size: 100%;
        min-block-size: calc(var(--am-space-40) * 3);
        font-family: var(--am-font-mono);
        font-size: var(--am-type-meta-size);
        resize: vertical;
      }
      @container meeting-page (max-width: 611.98px) {
        .am-rn__box {
          min-block-size: calc(var(--am-space-40) * 2);
        }
      }
    `,
  ],
})
export class MeetingRoughNotesComponent implements OnDestroy {
  private readonly meetings = inject(MeetingService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly injector = inject(Injector);
  private readonly format = inject(FormatService);
  readonly store = inject(MeetingMinutesAi);

  readonly meetingId = input.required<string>();
  /** A stale refusal's Reload: the page reads the meeting again. */
  readonly reload = output<void>();

  readonly max = ROUGH_NOTES_MAX;
  readonly ai = this.store.ai;
  readonly text = signal('');
  /** Our own press is waiting for its answer. */
  readonly waiting = signal(false);
  /** The person pressed Cancel: the run goes on on the server. */
  readonly stopped = signal(false);
  readonly refusal = signal<AiRefusal | null>(null);
  readonly failure = signal<MeetingFailure | null>(null);
  readonly notesFailed = signal<MeetingFailure | null>(null);
  readonly noNotes = signal(false);
  readonly announcement = signal('');

  /** The trigger shows where the server offers it, AI is available, and something is left to draft (M8). */
  readonly offered = computed(() => {
    const a = this.ai();
    return !!a && a.minutes.may && a.minutes.available && (a.leftToDraft > 0 || this.waiting() || a.minutes.running);
  });
  /** A run the server holds that this press is not waiting on: from an earlier visit, another tab, or after Cancel. */
  readonly runningElsewhere = computed(() => !!this.ai()?.minutes.running && !this.waiting());
  readonly triggerState = computed<AiAssistState>(() => (this.waiting() || this.runningElsewhere() ? 'working' : 'idle'));
  readonly resultState = computed<AiAssistState>(() => (this.waiting() ? 'working' : this.refusal() ? 'refusal' : 'idle'));
  readonly workingText = computed(() => {
    this.language.isArabic();
    const n = Math.min(this.ai()?.leftToDraft ?? 0, ITEMS_PER_PRESS);
    return n > 0 ? this.format.count('meeting.aiDrafting', n) : (this.translate.instant('meeting.ai.draftingAll') as string);
  });

  /** The notes as last stored (trimmed, null when none): what is saved, never written into the box. */
  private stored: string | null = null;
  private touched = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Observable<boolean> | null = null;
  private press: Subscription | null = null;

  constructor() {
    // The box takes the stored notes once, before the person types; never after.
    effect(() => {
      const a = this.ai();
      if (!a) return;
      untracked(() => {
        if (this.touched) return;
        this.stored = a.notes;
        this.text.set(a.notes ?? '');
      });
    });
  }

  ngOnDestroy(): void {
    // Leaving with unsaved text: saved on the way out.
    if (this.saveTimer) this.flush().subscribe();
    this.press?.unsubscribe();
  }

  typed(value: string): void {
    this.touched = true;
    this.text.set(value);
    this.noNotes.set(false);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush().subscribe(), SAVE_AFTER_MS);
  }

  saveNow(): void {
    this.flush().subscribe();
  }

  /** Draft minutes: the notes saved first, then the press, waiting longer than the server's call. */
  draft(): void {
    if (this.waiting()) return;
    this.refusal.set(null);
    this.failure.set(null);
    this.stopped.set(false);
    this.announcement.set('');
    if (!this.value()) {
      this.noNotes.set(true);
      document.getElementById('meetingRoughNotes')?.focus();
      return;
    }
    this.waiting.set(true);
    const language = this.language.isArabic() ? 'ar' : 'en';
    this.press = this.flush()
      .pipe(
        switchMap((saved) => (saved ? this.meetings.draftMinutes(this.meetingId(), language).pipe(timeout({ first: DRAFT_MINUTES_WAIT_MS })) : throwError(() => new NotesNotSaved()))),
      )
      .subscribe({
        next: (ai) => {
          this.waiting.set(false);
          this.drafted(ai);
        },
        error: (err: unknown) => {
          this.waiting.set(false);
          this.pressFailed(err);
        },
      });
  }

  /** Cancel: the page stops waiting. The run goes on on the server and is charged (ACC-193 Q2), so its state is read. */
  stopWaiting(): void {
    this.press?.unsubscribe();
    this.press = null;
    this.waiting.set(false);
    this.stopped.set(true);
    this.store.reread();
  }

  /** "Check again": the run's state, read once (never polled). */
  checkAgain(): void {
    const had = this.ai()?.undecided ?? 0;
    this.store.reread()?.subscribe({
      next: (ai) => {
        if (!ai.minutes.running) {
          this.stopped.set(false);
          if (ai.undecided !== had) this.store.countChanged.next();
        }
      },
      error: () => undefined,
    });
  }

  private drafted(ai: MeetingAiDto): void {
    this.store.set(ai);
    this.store.countChanged.next();
    const items = ai.suggestions.minutes.filter((s) => !s.nothing).length;
    this.announcement.set(
      this.translate.instant('meeting.ai.drafted', {
        items: this.format.count('meeting.aiItemsDrafted', items),
        actions: this.format.count('meeting.aiActionsUndecided', ai.suggestions.actions.length),
      }) as string,
    );
    // Focus moves to the first suggestion, so a keyboard user lands on what was made.
    afterNextRender(() => document.querySelector<HTMLElement>('[data-ai-suggestion] [tabindex="-1"]')?.focus(), { injector: this.injector });
  }

  private pressFailed(err: unknown): void {
    if (err instanceof NotesNotSaved) return; // the notes line already says so
    const ai = aiRefusal(err, this.format);
    if (ai) {
      this.refusal.set(ai);
      return;
    }
    const code = refusalCode(err);
    // The page stopped waiting, or lost the connection: the run may still be going. Read its state; never Retry.
    if (err instanceof TimeoutError || (!code && meetingUnreachable(err))) {
      this.afterLostWait();
      return;
    }
    // Someone else's run (or an earlier press of ours) holds the meeting: its state is shown, with Check again.
    if (code === 'MEETING_AI_IN_PROGRESS') {
      this.store.reread();
      return;
    }
    this.failure.set(meetingFailure(err, 'meeting.ai.draftFailed', 'meeting.ai.draftFailed'));
  }

  private afterLostWait(): void {
    const read = this.store.reread();
    if (!read) return;
    read.subscribe({
      next: (ai) => {
        if (ai.minutes.running) return; // shown running, with Check again
        if (ai.undecided > 0) {
          // It finished while the page wasn't waiting: its suggestions are shown in their items.
          this.store.countChanged.next();
          return;
        }
        // Finished with nothing saved: the call failed and was refunded. Nothing is in flight, so Try again is safe.
        this.refusal.set({ kind: 'unavailable', messageKey: 'ai.refusal.unavailable', params: {} });
      },
      error: () => this.failure.set({ key: 'meeting.ai.lostWait', offer: null }),
    });
  }

  /** The notes as the server stores them: trimmed, null when empty. */
  private value(): string | null {
    return this.text().trim() || null;
  }

  /**
   * Save the notes now if they differ from what is stored; true once they are
   * stored. One save at a time: a call while one is in flight waits for it,
   * then saves again if the text moved on.
   */
  private flush(): Observable<boolean> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.saving) return this.saving.pipe(switchMap((ok) => (ok ? this.flush() : of(false))));
    const value = this.value();
    if (value === this.stored) return of(true);
    this.saving = this.meetings.saveAiNotes(this.meetingId(), value).pipe(
      map(() => {
        this.stored = value;
        this.notesFailed.set(null);
        return true;
      }),
      catchError((err: unknown) => {
        this.notesFailed.set(meetingFailure(err, 'meeting.ai.notesUnreachable', 'meeting.ai.notesFailed'));
        return of(false);
      }),
      finalize(() => (this.saving = null)),
      shareReplay(1),
    );
    return this.saving;
  }
}
