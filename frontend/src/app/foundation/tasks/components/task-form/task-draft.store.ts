import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { AiRefusal, aiRefusal } from '../../../../core/ai/ai-refusal';
import { FormatService } from '../../../../core/formatting';
import { refusalCode } from '../../../../core/http/refusal';
import { LanguageService } from '../../../../core/services/language.service';
import { ITaskDraft, TaskService } from '../../services/task.service';

/** "A few words": the server refuses below this too (DRAFT_NOTE_TOO_SHORT). */
export const DRAFT_NOTE_MIN_LETTERS = 8;

export type TaskDraftState = 'idle' | 'working' | 'result' | 'refusal';

export interface TaskDraftInput {
  note: string;
  title: string;
  /** The record the dialog was opened from, when it was. */
  sourceType: string | null;
  sourceId: string | null;
}

/** A refusal that is only a sentence: no "Try again", the neutral mark. */
const notice = (messageKey: string): AiRefusal => ({ kind: 'notEnabled', messageKey, params: {} });
/** A failed call: the danger tint, with "Try again". */
const failed = (): AiRefusal => ({ kind: 'unavailable', messageKey: 'ai.refusal.unavailable', params: {} });

/**
 * ACC-197 — the state of "Draft with AI" for ONE New task dialog.
 *
 * It lives beside the form, not inside step 2: step 2's markup is destroyed
 * when the person goes Back, and a draft they asked for must still be there on
 * their return. Provided by TaskFormComponent, so it ends with the dialog —
 * which is what "closing the dialog cancels the wait" means: the request is
 * unsubscribed, no result appears later, nothing is saved.
 *
 * It creates nothing. A draft is a suggestion on screen; the task exists only
 * when the person presses Create task, with whatever is in the fields then.
 */
@Injectable()
export class TaskDraftStore implements OnDestroy {
  private readonly tasks = inject(TaskService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);

  /** Whether the trigger is shown at all: AI is on for the organisation and drafting is open to it. */
  readonly available = signal(false);
  readonly state = signal<TaskDraftState>('idle');
  readonly draft = signal<ITaskDraft | null>(null);
  readonly refusal = signal<AiRefusal | null>(null);
  /** A draft has been made in this dialog, so the trigger reads "Draft again". */
  readonly hasDrafted = signal(false);
  /** "Use this title" was pressed for the suggestion on screen, so its title row goes. */
  readonly titleUsed = signal(false);
  /**
   * Counts presses of Create task while a draft was unsettled (§2.2). Above
   * zero, the card shows "Accept or discard the suggestion first."; each press
   * moves focus to the card again.
   */
  readonly settleRequests = signal(0);

  /**
   * The working line or a suggestion is showing. Step 2 gives its lower blocks
   * to it (§2.1), so Create task waits until it is settled (§2.2). A refusal is
   * NOT this: there is nothing to settle, and nothing is hidden.
   */
  readonly unsettled = computed(() => this.state() === 'working' || this.state() === 'result');

  private request$: Subscription | null = null;
  private lastInput: TaskDraftInput | null = null;
  /** What the person took from a draft, for the task's audit row. */
  private claim: { id: string | null; description: boolean; title: boolean } = { id: null, description: false, title: false };

  loadAvailability(): void {
    this.tasks.getDraftAvailability().subscribe({
      next: ({ available }) => this.available.set(available),
      // No answer, no trigger: the form is exactly as it was before AI.
      error: () => this.available.set(false),
    });
  }

  /** The trigger, "Draft again", and "Try again". One request at a time. */
  request(input: TaskDraftInput): void {
    if (this.state() === 'working') return;
    this.lastInput = input;
    this.settleRequests.set(0);
    this.draft.set(null);
    this.titleUsed.set(false);
    if ((input.note.match(/\p{L}/gu) ?? []).length < DRAFT_NOTE_MIN_LETTERS) {
      this.refuse(notice('task.draft.noteTooShort'));
      return;
    }
    this.refusal.set(null);
    this.state.set('working');
    this.request$ = this.tasks
      .draftDescription({
        note: input.note,
        language: this.language.isArabic() ? 'ar' : 'en',
        ...(input.title.trim() ? { title: input.title.trim() } : {}),
        ...(input.sourceType && input.sourceId ? { sourceType: input.sourceType, sourceId: input.sourceId } : {}),
      })
      .subscribe({
        next: (draft) => {
          this.draft.set(draft);
          this.hasDrafted.set(true);
          this.state.set('result');
        },
        error: (err: unknown) => this.refuse(this.refusalOf(err)),
      });
  }

  retry(): void {
    if (this.lastInput) this.request(this.lastInput);
  }

  /** Cancel: stop waiting. A request that already reached the provider is still charged (the drawing's Q2). */
  cancel(): void {
    this.request$?.unsubscribe();
    this.request$ = null;
    this.reset();
  }

  /** Accept and Edit: the text for the Description field. */
  accept(): string {
    const draft = this.draft();
    if (!draft) return '';
    this.claim = { id: draft.draftId, description: true, title: this.claim.title };
    this.reset();
    return draft.description;
  }

  /** "Use this title": the suggested title. The suggestion stays on screen. */
  useTitle(): string {
    const draft = this.draft();
    if (!draft?.title) return '';
    this.claim = { id: draft.draftId, description: this.claim.description, title: true };
    this.titleUsed.set(true);
    return draft.title;
  }

  discard(): void {
    this.reset();
  }

  /** The note changed, so a refusal about the old one no longer applies. */
  noteEdited(): void {
    if (this.state() === 'refusal') this.reset();
  }

  /** Create task was pressed while a draft was unsettled. */
  askToSettle(): void {
    this.settleRequests.update((n) => n + 1);
  }

  /**
   * What Create task sends as `aiDraft`, or nothing. The description counts
   * only if the task still has one; the server checks the id against its log.
   */
  claimFor(hasDescription: boolean): { id: string; description: boolean; title: boolean } | undefined {
    const description = this.claim.description && hasDescription;
    if (!this.claim.id || (!description && !this.claim.title)) return undefined;
    return { id: this.claim.id, description, title: this.claim.title };
  }

  ngOnDestroy(): void {
    this.request$?.unsubscribe();
  }

  private reset(): void {
    this.state.set('idle');
    this.draft.set(null);
    this.refusal.set(null);
    this.settleRequests.set(0);
  }

  private refuse(refusal: AiRefusal): void {
    this.refusal.set(refusal);
    this.state.set('refusal');
  }

  /** The server's CODE, worded here — never its English message. */
  private refusalOf(err: unknown): AiRefusal {
    switch (refusalCode(err)) {
      case 'DRAFT_NOTE_TOO_SHORT':
        return notice('task.draft.noteTooShort');
      case 'DRAFT_NOTHING_TO_SUGGEST':
        return notice('task.draft.nothingToSuggest');
      case 'RATE_LIMITED':
        return notice('task.draft.tooMany');
      default:
        return aiRefusal(err, this.format) ?? failed();
    }
  }
}
