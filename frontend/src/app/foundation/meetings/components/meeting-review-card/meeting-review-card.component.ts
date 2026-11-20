import { Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import type { MeetingFailure } from '../../meeting-refusal';
import type { MeetingMinutesDto, MeetingSuggestionDto } from '../../services/meeting.service';

/**
 * ACC-316 PR 7c-1 — the Review card (Meeting Screens, the record page's side
 * column): who answered this round, the suggestions still open, and when the
 * review closes; then each reviewer with their answer. Drawn whenever the
 * minutes are in review or approved: the server has already decided who reads
 * them at all (§4.1), so whoever has the read sees the card.
 *
 * Suggestions about the minutes as a whole (no agenda item) are listed here,
 * with Decline and Mark applied for whoever may apply suggestions
 * (`may.applySuggestions`); a suggestion about an item sits under that item.
 * The page applies; the card says how a Mark applied failed (`failure`), with
 * Retry only when the server could not be reached and Reload when the review on
 * screen is stale (P220), and holds the button while one is in flight.
 */
@Component({
  selector: 'am-meeting-review-card',
  standalone: true,
  imports: [TranslatePipe, ButtonModule],
  template: `
    @if (shown()) {
      <section class="flex flex-col gap-2 rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] p-3" data-testid="meeting-review-card">
        <h2 class="m-0 text-[15px] font-semibold">{{ 'meeting.review.cardTitle' | translate }}</h2>
        <p class="m-0 text-meta text-[var(--am-ink-500)]" data-testid="meeting-review-summary">{{ summary() }}</p>
        <ul class="m-0 flex flex-col gap-1 ps-0 list-none">
          @for (r of minutes().review.reviewers; track r.userId) {
            <li class="flex items-center justify-between gap-2 text-[13px]" [attr.data-reviewer]="r.userId">
              <span class="min-w-0 truncate">{{ r.name }}</span>
              <span class="text-meta whitespace-nowrap" [class.text-[var(--am-ink-500)]]="!r.answered">
                {{ (r.answered ? 'meeting.review.answered' : 'meeting.review.notAnswered') | translate }}
              </span>
            </li>
          }
        </ul>
        @for (s of general(); track s.id) {
          <div class="flex flex-col gap-1 rounded border border-[var(--am-border)] p-2" [attr.data-suggestion]="s.id">
            <span class="text-meta text-[var(--am-ink-500)]">{{ 'meeting.review.fromWhole' | translate: { name: s.author.name } }}</span>
            <span class="whitespace-pre-line text-[13px]" dir="auto">{{ s.text }}</span>
            @if (s.status !== 'OPEN') {
              <span class="text-meta">{{ ('meeting.review.status.' + s.status) | translate }}</span>
              @if (s.reply) {
                <span class="text-meta text-[var(--am-ink-500)]" dir="auto">{{ 'meeting.review.reply' | translate: { reply: s.reply } }}</span>
              }
            } @else if (minutes().may.applySuggestions) {
              <span class="flex gap-1">
                <p-button
                  size="small"
                  [text]="true"
                  [label]="'meeting.review.markApplied' | translate"
                  [loading]="applying() === s.id"
                  [disabled]="applying() !== null"
                  [attr.data-suggestion-apply]="s.id"
                  (onClick)="apply.emit(s)"
                />
                <p-button size="small" [text]="true" severity="secondary" [label]="'meeting.review.decline' | translate" [attr.data-suggestion-decline]="s.id" (onClick)="decline.emit(s)" />
              </span>
            }
          </div>
        }
        @if (failure(); as f) {
          <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="meeting-review-action-error">
            {{ f.key | translate }}
            @if (f.offer === 'retry') {
              <p-button size="small" [text]="true" [label]="'common.retry' | translate" [loading]="applying() !== null" data-testid="meeting-review-action-retry" (onClick)="retry.emit()" />
            } @else if (f.offer === 'reload') {
              <p-button size="small" [text]="true" [label]="'meeting.agenda.reload' | translate" data-testid="meeting-review-action-reload" (onClick)="reload.emit()" />
            }
          </p>
        }
        @if (minutes().phase === 'review' && !minutes().review.closed) {
          <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.review.silence' | translate }}</p>
        }
      </section>
    }
  `,
})
export class MeetingReviewCardComponent {
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  readonly minutes = input.required<MeetingMinutesDto>();
  /** Mark applied on a whole-minutes suggestion: the page applies it. */
  readonly apply = output<MeetingSuggestionDto>();
  /** Decline on a whole-minutes suggestion: the page opens the dialog. */
  readonly decline = output<MeetingSuggestionDto>();
  /** How the page's last Mark applied failed, if it did. */
  readonly failure = input<MeetingFailure | null>(null);
  /** The suggestion being marked applied, while the request is in flight. */
  readonly applying = input<string | null>(null);
  /** Retry the failed Mark applied (the server could not be reached). */
  readonly retry = output<void>();
  /** A stale refusal's Reload: the page reads the meeting again. */
  readonly reload = output<void>();

  readonly shown = computed(() => {
    const m = this.minutes();
    return (m.phase === 'review' || m.phase === 'approved') && m.review.round > 0;
  });

  /** This round's suggestions about the minutes as a whole. */
  readonly general = computed(() => {
    const m = this.minutes();
    return m.review.suggestions.filter((s) => s.agendaItemId === null && s.round === m.review.round);
  });

  /** "4 answered · 2 no answer yet · 1 suggestion open · Review closes 1 Oct", counted strings. */
  readonly summary = computed(() => {
    this.language.isArabic();
    const r = this.minutes().review;
    const answered = r.reviewers.filter((x) => x.answered).length;
    const open = r.suggestions.filter((s) => s.round === r.round && s.status === 'OPEN').length;
    const parts = [
      this.format.count('meeting.reviewAnswered', answered),
      this.format.count('meeting.reviewWaiting', r.reviewers.length - answered),
      this.format.count('meeting.suggestionsOpen', open),
    ];
    if (r.reviewBy) {
      const day = this.format.date(`${r.reviewBy}T12:00:00.000Z`);
      parts.push(this.translate.instant(r.closed ? 'meeting.review.closedOn' : 'meeting.review.closesOn', { day }) as string);
    }
    return parts.join(' · ');
  });
}
