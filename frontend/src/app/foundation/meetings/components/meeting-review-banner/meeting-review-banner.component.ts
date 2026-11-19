import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingService, type MeetingMinutesDto } from '../../services/meeting.service';

/**
 * ACC-316 PR 7c-1 — the review banner (Meeting Screens, the record page): "Review
 * the minutes by {date}", for a member recorded present while the stage takes
 * corrections. Shown exactly when the server says so (`may.review`); the
 * screen copies no rule. "No corrections" is one press; "Suggest a correction…"
 * opens the dialog, which the page owns. After answering, the banner says the
 * person's own answer (`review.mine`) and still offers Suggest, which the server
 * allows (it replaces "No corrections").
 */
@Component({
  selector: 'am-meeting-review-banner',
  standalone: true,
  imports: [TranslatePipe, ButtonModule],
  template: `
    @if (minutes().may.review) {
      <section class="am-rb flex flex-wrap items-start justify-between gap-3" role="region" [attr.aria-label]="title()" data-testid="meeting-review-banner">
        <div class="flex min-w-0 flex-col gap-1">
          <h2 class="m-0 text-[15px] font-semibold">{{ title() }}</h2>
          <p class="m-0 text-[13px]">{{ lead() }}</p>
          @if (minutes().review.mine; as mine) {
            <p class="m-0 text-meta font-medium" data-testid="meeting-review-mine">{{ ('meeting.review.mine.' + mine) | translate }}</p>
          }
          @if (changesLine(); as line) {
            <p class="m-0 text-meta" data-testid="meeting-review-changes">{{ line }}</p>
          }
          @if (error()) {
            <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="meeting-review-error">{{ error()! | translate }}</p>
          }
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <p-button size="small" severity="secondary" [label]="'meeting.review.suggest' | translate" data-testid="meeting-review-suggest" (onClick)="suggest.emit()" />
          @if (minutes().review.mine !== 'NO_CORRECTIONS') {
            <p-button size="small" [label]="'meeting.review.noCorrections' | translate" [loading]="busy()" data-testid="meeting-review-no-corrections" (onClick)="noCorrections()" />
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      .am-rb {
        padding: var(--am-space-12);
        border: 1px solid var(--am-warning-border);
        border-radius: var(--am-radius-card);
        background: var(--am-warning-bg);
      }
    `,
  ],
})
export class MeetingReviewBannerComponent {
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly meetingId = input.required<string>();
  readonly minutes = input.required<MeetingMinutesDto>();
  readonly scheduledAt = input.required<string>();
  /** "Suggest a correction…": the page opens the dialog. */
  readonly suggest = output<void>();
  /** The person answered: the page reads the minutes again. */
  readonly answered = output<void>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  /** The review date as a day (stored as yyyy-MM-dd, the organisation's day). */
  private readonly reviewDay = computed(() => {
    const by = this.minutes().review.reviewBy;
    return by ? this.format.date(`${by}T12:00:00.000Z`) : null;
  });

  readonly title = computed(() => {
    const day = this.reviewDay();
    return day ? (this.translate.instant('meeting.review.title', { day }) as string) : (this.translate.instant('meeting.review.titleNoDate') as string);
  });

  readonly lead = computed(() => {
    const day = this.reviewDay();
    return this.translate.instant(day ? 'meeting.review.lead' : 'meeting.review.leadNoDate', { held: this.format.date(this.scheduledAt()), day }) as string;
  });

  /** "Changed during review: item 2, decision" — this round's changes, from the server's list. */
  readonly changesLine = computed(() => {
    const m = this.minutes();
    const round = m.review.round;
    const order = new Map(m.items.map((i) => [i.id, i.order]));
    const parts = m.review.changes
      .filter((c) => c.round === round)
      .map((c) => {
        const what = this.translate.instant(`meeting.review.change.${c.what}`) as string;
        const n = c.agendaItemId ? order.get(c.agendaItemId) : undefined;
        return n ? (this.translate.instant('meeting.review.changeOnItem', { n: this.format.number(n), what }) as string) : what;
      });
    return parts.length ? (this.translate.instant('meeting.review.changed', { list: parts.join(this.translate.instant('common.listSeparator') as string) }) as string) : null;
  });

  noCorrections(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.meetings.noCorrections(this.meetingId()).subscribe({
      next: () => {
        this.busy.set(false);
        this.answered.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(meetingRefusalKey(err) ?? 'meeting.review.error');
      },
    });
  }
}
