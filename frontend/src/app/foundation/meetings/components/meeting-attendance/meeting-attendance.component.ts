import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingService, type MeetingAttendance, type MeetingAttendanceRowDto, type MeetingMinutesDto } from '../../services/meeting.service';
import { MinutesWriteOrder } from '../../minutes-write-order';

/** setTimeout's longest wait: 2^31 - 1 ms (about 24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;

function omit<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  const next = { ...record };
  for (const k of keys) delete next[k];
  return next;
}

const CHOICES: { value: MeetingAttendance; key: string }[] = [
  { value: 'PRESENT', key: 'meeting.attendance.present' },
  { value: 'APOLOGIES', key: 'meeting.attendance.apologies' },
  { value: 'ABSENT', key: 'meeting.attendance.absent' },
];

/**
 * ACC-316 PR 7b — Attendance (Meeting Screens, the record page and "Attendance
 * on a tablet in the meeting room"): Present / Apologies / Absent per invitee,
 * saved on each tap with a "Saved" tick on its row, and the quorum line at the
 * top, counting MEMBERS recorded present (guests never count).
 *
 * Who records is the read's `may.recordAttendance` (whoever records the
 * minutes, from the meeting's start, where the stage allows it). Before the
 * start the panel says when it opens; anyone else reads what was recorded.
 * The segments are a radiogroup: arrow keys move in reading direction. Under a
 * coarse pointer the segments are 44px tall and at least 72px wide.
 *
 * P206: a tap while another row saves is QUEUED for its row, never dropped, and
 * sent when the save ends; focus moves only once a tap is accepted. An answer
 * is shown only when it answers the page's newest minutes write
 * (MinutesWriteOrder). At the start time the panel asks the page to read the
 * minutes again (`startReached`), so attendance opens without a reload.
 */
@Component({
  selector: 'am-meeting-attendance',
  standalone: true,
  imports: [TranslatePipe, ButtonModule],
  template: `
    <section class="flex flex-col gap-2 rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] p-3" data-testid="meeting-attendance">
      <h2 class="m-0 flex items-center justify-between gap-2 text-[15px] font-semibold">
        <span>{{ 'meeting.attendance.title' | translate }}</span>
        @if (canRecord() && !allPresent()) {
          <p-button size="small" [text]="true" [label]="'meeting.attendance.markAll' | translate" [disabled]="busy() !== null" data-testid="meeting-attendance-all" (onClick)="markAllPresent()" />
        }
      </h2>
      <p class="am-att__quorum m-0" [class.am-att__quorum--met]="minutes().quorum.met === true" [class.am-att__quorum--short]="minutes().quorum.met === false" data-testid="meeting-attendance-quorum">
        {{ quorumLine() }}
      </p>
      @if (opensAt(); as at) {
        <p class="m-0 text-meta text-[var(--am-ink-500)]" data-testid="meeting-attendance-opens">{{ 'meeting.attendance.opensAt' | translate: { at } }}</p>
      }
      <ul class="m-0 flex flex-col ps-0 list-none">
        @for (row of minutes().attendance; track row.attendeeId) {
          <li class="am-att__row" [attr.data-attendance-row]="row.attendeeId">
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-[13px] font-medium">{{ row.name }}</span>
              <span class="text-meta text-[var(--am-ink-500)]">{{ roleOf(row) }}</span>
              @if (!row.attendance && row.suggested) {
                <span class="text-meta text-[var(--am-ink-500)]" data-attendance-suggested>{{ 'meeting.attendance.saidCant' | translate }}</span>
              }
              @if (rowErrors()[row.attendeeId]; as err) {
                <span class="text-meta text-[var(--am-danger-ink)]" role="alert" data-attendance-error>{{ err | translate }}</span>
              }
            </span>
            @if (canRecord()) {
              <span class="flex items-center gap-2">
                @if (saved() === row.attendeeId) {
                  <span class="text-meta text-[var(--am-success-ink)]" data-attendance-saved>✓ {{ 'meeting.attendance.saved' | translate }}</span>
                }
                <span role="radiogroup" class="am-segmented am-att__seg" [attr.aria-label]="'meeting.attendance.of' | translate: { name: row.name }">
                  @for (c of choices; track c.value; let i = $index) {
                    <button
                      type="button"
                      role="radio"
                      class="am-segmented__option"
                      [class.am-segmented__option--active]="shown(row) === c.value"
                      [attr.aria-checked]="shown(row) === c.value"
                      [attr.tabindex]="tabIndexOf(row, i)"
                      [attr.aria-disabled]="busy() === row.attendeeId || null"
                      [attr.data-attendance]="c.value"
                      (click)="record(row, c.value)"
                      (keydown)="onKey($event, row, i)"
                    >
                      {{ c.key | translate }}
                    </button>
                  }
                </span>
              </span>
            } @else {
              <span class="text-meta whitespace-nowrap" [class.text-[var(--am-ink-500)]]="!row.attendance" data-attendance-value>
                {{ (row.attendance ? 'meeting.attendance.' + row.attendance.toLowerCase() : 'meeting.attendance.notRecorded') | translate }}
              </span>
            }
          </li>
        }
      </ul>
      @if (hasGuests()) {
        <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.invitees.guestsNoQuorum' | translate }}</p>
      }
    </section>
  `,
  styles: [
    `
      .am-att__quorum {
        margin: 0;
        padding: var(--am-space-8);
        border-radius: var(--am-radius-button);
        font-size: var(--am-type-value-size);
        background: var(--am-surface);
      }
      .am-att__quorum--met {
        color: var(--am-success-ink);
        background: var(--am-success-bg);
      }
      .am-att__quorum--short {
        color: var(--am-danger-ink);
        background: var(--am-danger-bg);
      }
      .am-att__row {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        padding-block: var(--am-space-8);
        border-block-end: 1px solid var(--am-border);
      }
      .am-att__row:last-child {
        border-block-end: none;
      }
      .am-segmented {
        display: inline-flex;
        overflow: hidden;
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-button);
      }
      .am-segmented__option {
        min-block-size: var(--am-control-height);
        padding-inline: var(--am-space-12);
        font-size: var(--am-type-meta-size);
        font-weight: 500;
        color: var(--am-ink-700);
        background: var(--am-control-bg);
        border: none;
        cursor: pointer;
      }
      .am-segmented__option + .am-segmented__option {
        border-inline-start: 1px solid var(--am-control-border);
      }
      .am-segmented__option--active {
        color: var(--am-control-bg);
        background: var(--am-primary-600);
      }
      .am-segmented__option:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      /* The meeting room's tablet: a coarse pointer gets 44px segments, 72px wide, and 56px rows. */
      @media (pointer: coarse) {
        .am-att__row {
          min-block-size: calc(var(--am-space-40) + var(--am-space-16));
        }
        .am-att__seg .am-segmented__option {
          min-block-size: calc(var(--am-space-40) + var(--am-space-4));
          min-inline-size: calc(var(--am-space-40) + var(--am-space-32));
        }
      }
    `,
  ],
})
export class MeetingAttendanceComponent {
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  readonly meetingId = input.required<string>();
  readonly minutes = input.required<MeetingMinutesDto>();
  /** The meeting's start: before it, the panel says when attendance opens. */
  readonly scheduledAt = input.required<string>();
  /** The minutes as the server holds them after a recording. */
  readonly minutesChange = output<MeetingMinutesDto>();
  /** The meeting's start time arrived while the panel was open: the page reads the minutes again. */
  readonly startReached = output<void>();

  private readonly order = inject(MinutesWriteOrder, { optional: true }) ?? new MinutesWriteOrder();
  /** Taps made while a save was running, by row: sent together when it ends. */
  readonly queued = signal<Record<string, MeetingAttendance>>({});
  /**
   * Values being saved (or whose save failed), by row: shown until the save
   * settles, so a tap never flips back while it is in flight (P211). A failed
   * one stays shown, marked by its row's error.
   */
  readonly pending = signal<Record<string, MeetingAttendance>>({});
  /** Now, moved forward by a timer to the meeting's start (opensAt reads it). */
  private readonly now = signal(Date.now());

  readonly choices = CHOICES;
  /** The row being saved, or 'all' for Mark all present. */
  readonly busy = signal<string | null>(null);
  readonly saved = signal<string | null>(null);
  /** A refused or failed save's message, by row: kept until that row is saved again. */
  readonly rowErrors = signal<Record<string, string>>({});

  readonly canRecord = computed(() => this.minutes().may.recordAttendance);
  readonly members = computed(() => this.minutes().attendance.filter((r) => r.kind === 'MEMBER'));
  readonly hasGuests = computed(() => this.minutes().attendance.some((r) => r.kind !== 'MEMBER'));
  readonly allPresent = computed(() => this.minutes().attendance.every((r) => r.attendance === 'PRESENT'));

  /** Before the start, in the draft, the time attendance opens; otherwise nothing. */
  readonly opensAt = computed(() => {
    const m = this.minutes();
    if (m.may.recordAttendance || m.phase !== 'draft' || new Date(this.scheduledAt()).getTime() <= this.now()) return null;
    return this.format.dateTime(this.scheduledAt());
  });

  constructor() {
    // A timer to the start: the sentence goes, and the page reads the minutes
    // again so the controls arrive, without a reload. A timer that fires early
    // re-arms for the remainder, and a start further away than setTimeout's
    // maximum (2^31 - 1 ms) is reached by chained waits (P211). Cleared on destroy.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const arm = (at: number) => {
      const wait = at - Date.now();
      if (wait <= 0) {
        timer = null;
        this.now.set(Date.now());
        this.startReached.emit();
        return;
      }
      timer = setTimeout(() => arm(at), Math.min(wait, MAX_TIMER_MS));
    };
    effect(() => {
      clear();
      const at = new Date(this.scheduledAt()).getTime();
      if (at - Date.now() > 0) arm(at);
    });
    inject(DestroyRef).onDestroy(clear);
  }

  /** The value a row shows: a queued tap, else one being saved (or that failed), else what is recorded. */
  shown(row: MeetingAttendanceRowDto): MeetingAttendance | null {
    return this.queued()[row.attendeeId] ?? this.pending()[row.attendeeId] ?? row.attendance;
  }

  readonly quorumLine = computed(() => {
    this.language.isArabic();
    const q = this.minutes().quorum;
    const members = this.format.number(this.members().length);
    const present = this.format.number(q.presentMembers);
    if (q.quorum == null) return this.translate.instant('meeting.attendance.presentOf', { present, members }) as string;
    const quorum = this.format.number(q.quorum);
    if (q.met) return this.translate.instant('meeting.attendance.quorumMet', { present, members, quorum }) as string;
    const more = this.format.count('meeting.moreNeeded', Math.max(q.quorum - q.presentMembers, 0));
    return this.translate.instant('meeting.attendance.quorumShort', { present, members, quorum, more }) as string;
  });

  roleOf(row: MeetingAttendanceRowDto): string {
    if (row.kind === 'MEMBER') return row.seat ? this.language.bilingual(row.seat.labelEn, row.seat.labelAr) : this.translate.instant('meeting.agendaItem.member');
    return this.translate.instant(row.kind === 'OUTSIDE_GUEST' ? 'meeting.invitees.outsideGuest' : 'meeting.invitees.guest');
  }

  /** The radiogroup's one tab stop: the shown value, else the first. */
  tabIndexOf(row: MeetingAttendanceRowDto, index: number): number {
    const at = CHOICES.findIndex((c) => c.value === this.shown(row));
    return index === (at < 0 ? 0 : at) ? 0 : -1;
  }

  /** Arrow keys move the choice in reading direction, and record it. */
  onKey(event: KeyboardEvent, row: MeetingAttendanceRowDto, index: number): void {
    const rtl = this.language.isRtl();
    const step = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + CHOICES.length) % CHOICES.length;
    // Focus moves only once the tap is accepted (recorded, or queued).
    if (!this.record(row, CHOICES[next]!.value)) return;
    const group = (event.currentTarget as HTMLElement).parentElement;
    (group?.children[next] as HTMLElement | undefined)?.focus();
  }

  /** A tap: sent at once, or queued for its row while another save runs. False when it changes nothing. */
  record(row: MeetingAttendanceRowDto, value: MeetingAttendance): boolean {
    if (this.shown(row) === value) return false;
    if (this.busy() !== null) {
      this.queued.update((q) => ({ ...q, [row.attendeeId]: value }));
      return true;
    }
    this.save([{ attendeeId: row.attendeeId, attendance: value }], row.attendeeId);
    return true;
  }

  markAllPresent(): void {
    if (this.busy() !== null) return;
    const rows = this.minutes().attendance.filter((r) => this.shown(r) !== 'PRESENT').map((r) => ({ attendeeId: r.attendeeId, attendance: 'PRESENT' as const }));
    if (rows.length) this.save(rows, 'all');
  }

  private save(rows: { attendeeId: string; attendance: MeetingAttendance }[], busy: string): void {
    const seq = this.order.begin();
    const ids = rows.map((r) => r.attendeeId);
    this.busy.set(busy);
    this.saved.set(null);
    // In flight: shown until the answer. Only THESE rows' old errors are cleared.
    this.pending.update((p) => ({ ...p, ...Object.fromEntries(rows.map((r) => [r.attendeeId, r.attendance])) }));
    this.rowErrors.update((e) => omit(e, ids));
    this.meetings.recordAttendance(this.meetingId(), rows).subscribe({
      next: (minutes) => {
        this.busy.set(null);
        this.saved.set(busy === 'all' ? null : busy);
        const shown = this.order.answered(seq);
        if (shown) this.minutesChange.emit(minutes);
        // Saved: the recorded value takes over (or the re-read brings it).
        this.pending.update((p) => omit(p, ids));
        this.flush();
      },
      error: (err: unknown) => {
        this.order.failed(seq);
        this.busy.set(null);
        // The value stays shown, marked by its row's error.
        const key = meetingRefusalKey(err) ?? 'meeting.attendance.error';
        this.rowErrors.update((e) => ({ ...e, ...Object.fromEntries(ids.map((id) => [id, key])) }));
        this.flush();
      },
    });
  }

  /** The taps queued during a save, sent together once it ends: they stay shown, now in flight. */
  private flush(): void {
    const q = this.queued();
    const rows = Object.entries(q).map(([attendeeId, attendance]) => ({ attendeeId, attendance }));
    if (rows.length === 0) return;
    this.queued.set({});
    this.save(rows, rows.length === 1 ? rows[0]!.attendeeId : 'all');
  }
}
