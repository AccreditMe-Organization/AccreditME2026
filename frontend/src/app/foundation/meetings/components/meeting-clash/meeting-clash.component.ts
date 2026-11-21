import { Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import type { MeetingClashDto } from '../../services/meeting.service';

/**
 * ACC-316 PR 8a — a clash warning (Meeting Screens round 5, artboard 16), for
 * Schedule's step 1 and step 2, Reschedule, Add a guest and the scope confirm (8c):
 *
 *   the line  "2 of 11 invitees have another meeting then", with a toggle
 *             ("Show who" / "Hide") when the caller offers one. An info line,
 *             never a refusal: Schedule stays enabled;
 *   the rows  one per person: their name, then each other meeting's title, or
 *             "another meeting" (muted) when the asker may not open it, with
 *             its time ("10:00–11:30", an isolated run).
 *
 * `prefix` goes before the line (step 2's "Thu 25 Mar 2027, 10:00–11:30").
 * Nothing at all when nobody has a clash.
 *
 * PR 8c adds two forms of the same warning, and a cap:
 *   `person`   Add a guest (R5-5): one person checked, so the line names them
 *              ("Dr. Huda Zahrani has another meeting then") and each row is
 *              one of their meetings, without their name again;
 *   `perMeeting` the scope confirm with "This and all later meetings"
 *              (artboards 10–11): "2 of the 8 meetings have a clash", and one
 *              row per clash, its date first, then who and their other meeting;
 *   `capped`   rows shown in place (Reschedule, the scope confirm) scroll inside
 *              a fixed height, so a long list never pushes the dialog past its cap.
 */
@Component({
  selector: 'am-meeting-clash',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (perMeeting(); as list) {
      @if (list.length > 0) {
        <div class="flex flex-col" data-testid="meeting-clash">
          <p class="am-clash__line m-0" data-testid="meeting-clash-line">
            <span>{{ format.count('meeting.meetingsClash', list.length, { total: format.number(meetingTotal()) }) }}</span>
            @if (toggleLabel()) {
              <button type="button" class="am-clash__link" [attr.aria-expanded]="showRows()" data-testid="meeting-clash-toggle" (click)="toggled.emit()">{{ toggleLabel()! }}</button>
            }
          </p>
          @if (showRows()) {
            <ul class="am-clash__rows m-0 p-0" [class.am-clash__rows--capped]="capped()" [attr.tabindex]="capped() ? 0 : null" [attr.aria-label]="capped() ? rowsLabel() : null" data-testid="meeting-clash-rows">
              @for (c of list; track c.startsAt) {
                @for (p of c.people; track p.userId) {
                  @for (m of p.meetings; track $index) {
                    <li class="am-clash__row" [attr.data-clash-person]="p.userId" [attr.data-clash-at]="c.startsAt">
                      <span class="flex min-w-0 flex-col">
                        <span class="text-value font-medium truncate">{{ dayLabel(c.startsAt) }}</span>
                        <span class="text-meta truncate"><bdi>{{ p.name }}</bdi> · <span [class.am-clash__muted]="!m.title">{{ m.title ?? ('meeting.clash.another' | translate) }}</span></span>
                      </span>
                      <bdi class="text-meta am-clash__time">{{ range(m.startsAt, m.durationMinutes) }}</bdi>
                    </li>
                  }
                }
              }
            </ul>
          }
        </div>
      }
    } @else if (clash(); as c) {
      @if (c.people.length > 0) {
        <div class="flex flex-col" data-testid="meeting-clash">
          <p class="am-clash__line m-0" data-testid="meeting-clash-line">
            @if (person()) {
              <span>{{ 'meeting.clash.personHas' | translate: { name: c.people[0]!.name } }}</span>
            } @else {
              <span>@if (prefix()) {<bdi>{{ prefix() }}</bdi> · }{{ format.count('meeting.clashPeople', c.people.length, { total: format.number(c.invitees) }) }}</span>
            }
            @if (toggleLabel()) {
              <button type="button" class="am-clash__link" [attr.aria-expanded]="showRows()" data-testid="meeting-clash-toggle" (click)="toggled.emit()">{{ toggleLabel()! }}</button>
            }
          </p>
          @if (showRows()) {
            <ul class="am-clash__rows m-0 p-0" [class.am-clash__rows--capped]="capped()" [attr.tabindex]="capped() ? 0 : null" [attr.aria-label]="capped() ? rowsLabel() : null" data-testid="meeting-clash-rows">
              @for (p of c.people; track p.userId) {
                @for (m of p.meetings; track $index) {
                  <li class="am-clash__row" [attr.data-clash-person]="p.userId">
                    <span class="flex min-w-0 flex-col">
                      @if (person()) {
                        <span class="text-value truncate" [class.am-clash__muted]="!m.title">{{ m.title ?? ('meeting.clash.another' | translate) }}</span>
                      } @else {
                        <span class="text-value font-medium truncate">{{ p.name }}</span>
                        <span class="text-meta truncate" [class.am-clash__muted]="!m.title">{{ m.title ?? ('meeting.clash.another' | translate) }}</span>
                      }
                    </span>
                    <bdi class="text-meta am-clash__time">{{ range(m.startsAt, m.durationMinutes) }}</bdi>
                  </li>
                }
              }
            </ul>
          }
        </div>
      }
    }
  `,
  styles: [
    `
      .am-clash__line {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 2px var(--am-space-8);
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        font-weight: 500;
        color: var(--am-info-ink);
      }
      .am-clash__link {
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        font-weight: 600;
        color: var(--am-blue-primary);
        cursor: pointer;
      }
      .am-clash__link:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-clash__rows {
        list-style: none;
        margin-block-start: var(--am-space-4);
      }
      .am-clash__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-8);
        padding-block: var(--am-space-4);
        border-block-end: 1px solid var(--am-border);
      }
      .am-clash__rows--capped {
        /* Two and a half rows: the cut row says there are more, which scroll inside
           the list, never the dialog's body (Reschedule's six people in Arabic stay
           20px under the 420 cap at this height, measured). */
        max-block-size: 8rem;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .am-clash__rows--capped:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-clash__row:last-child {
        border-block-end: none;
      }
      .am-clash__muted {
        color: var(--am-ink-500);
      }
      .am-clash__time {
        flex: none;
        color: var(--am-ink-700);
      }
    `,
  ],
})
export class MeetingClashComponent {
  readonly format = inject(FormatService);
  /** One time's clashes, as the server answers them. */
  readonly clash = input<MeetingClashDto | null>(null);
  /** "Show who" or "Hide": the toggle's words, or no toggle. */
  readonly toggleLabel = input<string | null>(null);
  readonly showRows = input(false);
  readonly prefix = input<string | null>(null);
  /** PR 8c — one person checked (Add a guest): the line names them. */
  readonly person = input(false);
  /** PR 8c — the scope confirm: one clash per meeting that has one, of `meetingTotal` meetings. */
  readonly perMeeting = input<MeetingClashDto[] | null>(null);
  readonly meetingTotal = input(0);
  /** PR 8c — rows shown in place scroll inside a fixed height. */
  readonly capped = input(false);
  readonly toggled = output<void>();
  private readonly translate = inject(TranslateService);

  /** Whether anyone clashes: callers draw nothing else for a clash-free time. */
  readonly any = computed(() => (this.clash()?.people.length ?? 0) > 0);

  /** The scrolling list's name, for a screen reader (it takes focus to scroll by keyboard). */
  rowsLabel(): string {
    return this.translate.instant('meeting.clash.rowsLabel');
  }

  /** "Thu 28 Jan 2027": a scope row's date, as step 2's dates read. */
  dayLabel(at: string): string {
    return `${this.format.weekday(at, 'short')} ${this.format.date(at)}`;
  }

  /** "10:00–11:30", in the organisation's zone. */
  range(startsAt: string, minutes: number): string {
    const start = new Date(startsAt);
    return `${this.format.timeOfDay(start)}–${this.format.timeOfDay(new Date(start.getTime() + minutes * 60_000))}`;
  }
}
