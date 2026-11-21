import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toObservable, toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Observable, catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap, tap } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { SimpleListComponent, type SimpleListPage, type SimpleListQuery } from '../../../../shared/components/simple-list/simple-list.component';
import { MeetingService, type MeetingGuestCandidatesDto, type MeetingSeriesEvery, type MeetingSeriesOrdinal, type MeetingSeriesPreviewDto, type MeetingSeriesRequest } from '../../services/meeting.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { meetingDay, meetingTimeText } from '../../meeting-when';
import { SERIES_EVERY, SERIES_ORDINALS, SERIES_WEEKDAYS, seriesEveryChoice, seriesEveryFromFrequency, seriesInWeeks, seriesOrdinal, seriesPattern, seriesWeekday } from '../../meeting-series-text';
import { MeetingClashComponent } from '../meeting-clash/meeting-clash.component';
import { MeetingSegmentedComponent, type SegmentedOption } from '../meeting-segmented/meeting-segmented.component';
import { MEETING_DURATIONS } from '../../meeting-durations';
import type { ScheduleOwner } from '../meeting-schedule-dialog/meeting-schedule-dialog.component';

/** Step 1's answers, which every meeting of the series takes. */
export interface RepeatBase {
  subject: string;
  typeValueId: string;
  /** The first meeting: its day and time, in the tenant's zone. */
  startsAt: Date;
  durationMinutes: number;
  location: string | null;
  meetingUrl: string | null;
  unitQuorum: number | null;
}

/** A standing agenda item as step 2 edits it (Q5): at most ten. */
export interface StandingDraft {
  key: number;
  title: string;
  presenter: { id: string; name: string } | null;
  durationMinutes: number | null;
}

/** The step's body: the form, or what swaps in for it (each keeps the 420 cap). */
type RepeatView = { kind: 'form' } | { kind: 'endDate' } | { kind: 'standing' } | { kind: 'allDates' } | { kind: 'clash'; index: number };

type Candidate = MeetingGuestCandidatesDto['items'][number];

/** How many dates step 2 shows before "n later dates · … · Show all" (Ahmad, 20 Nov, Q7). */
export const REPEAT_DATES_SHOWN = 5;
/** A series' most standing agenda items (Ahmad, 20 Nov, Q5; the server's MEETING_STANDING_AGENDA_MAX). */
export const REPEAT_STANDING_MAX = 10;
/**
 * How many meetings Ends · After starts at, by Every: 12 weekly (12 weeks), 12
 * fortnightly (about 6 months), 12 monthly (a year), 4 quarterly (a year), 2
 * six-monthly (a year), 1 yearly; each inside the server's 12 months. A
 * starting value: the person may type any number from 1 to 53.
 */
const DEFAULT_COUNT: Readonly<Record<MeetingSeriesEvery, number>> = { WEEK_1: 12, WEEK_2: 12, MONTH_1: 12, MONTH_3: 4, MONTH_6: 2, MONTH_12: 1 };

/** yyyy-MM-dd of a calendar day (a picker's local Date). */
function isoDay(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

/** Luxon's weekday (1 Monday … 7 Sunday) of a calendar day. */
function weekdayOf(day: Date): number {
  return day.getDay() === 0 ? 7 : day.getDay();
}

/** Which of its weekday in the month the day is: the 1st to the 4th, or the last. */
function ordinalOf(day: Date): MeetingSeriesOrdinal {
  const n = Math.ceil(day.getDate() / 7);
  const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
  if (day.getDate() + 7 > lastDay && n >= 4) return 'LAST';
  return SERIES_ORDINALS[Math.min(n, 4) - 1]!;
}

/**
 * ACC-316 PR 8a — Schedule meeting, step 2: Repeat (Meeting Screens round 5,
 * section 3; artboards 3 and 16; Ahmad's answers of 20 Nov, PR 8 Q5–Q7).
 *
 *   Repeats    Doesn't repeat / Repeats. Every starts from the committee's
 *              frequency (Q6, meeting-series-text.ts's ONE mapping); As needed
 *              and a unit start on Doesn't repeat.
 *   the pattern  Every, then On: a weekday for weeks; for months Day [1–31] or
 *              The [1st–4th, last] [weekday], seeded from the first meeting's
 *              day. Its readback is meeting-series-text.ts's, the same words
 *              the series' meetings will show.
 *   Ends       On a date (a calendar that swaps in for the body) or After n.
 *   Standing agenda  "n items · Edit…" / "None · Add…": its editor swaps in
 *              for the body (Q5), at most ten; a presenter is picked from a
 *              list that opens as its own layer above the dialog.
 *   Next dates  the server's preview, never worked out here: the first five
 *              with their titles, Moved, "No 31st · last day" and Clash; then
 *              "n later dates · m moved · k have a clash · Show all" (Q7),
 *              which swaps in the whole list. A Clash chip swaps in that
 *              date's people ("← All dates").
 *
 * Nothing here decides a date: every date, move, title and clash is the
 * preview's (POST /meetings/series/preview), read again as the choices change.
 */
@Component({
  selector: 'am-meeting-repeat-step',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    FieldComponent,
    IconButtonComponent,
    InlineCalendarComponent,
    ListDialogComponent,
    OverlaySelectComponent,
    SimpleListComponent,
    MeetingClashComponent,
    MeetingSegmentedComponent,
  ],
  template: `
    @switch (view().kind) {
      @case ('endDate') {
        <div class="flex flex-col gap-2" data-testid="repeat-end-date-view">
          <button type="button" class="am-backlink self-start" (click)="view.set({ kind: 'form' })">{{ 'meeting.when.back' | translate }}</button>
          <am-inline-calendar [value]="endsOn()" (valueChange)="pickEnd($event)" [minDate]="firstDay()" />
        </div>
      }
      @case ('standing') {
        <div class="flex flex-col gap-2" data-testid="repeat-standing-view">
          <button type="button" class="am-backlink self-start" data-testid="repeat-standing-back" (click)="closeStanding()">{{ 'meeting.repeat.backToRepeat' | translate }}</button>
          <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.repeat.standingHelp' | translate }}</p>
          @if (standing().length === 0) {
            <p class="m-0 text-value" data-testid="repeat-standing-empty">{{ 'meeting.repeat.standingNone' | translate }}</p>
          }
          <!-- Ten items would pass the 420 cap: the list scrolls inside itself, as Show all does. -->
          <div class="am-rep__scroll" tabindex="0" role="region" [attr.aria-label]="'meeting.repeat.standing' | translate">
          <ol class="am-rep__items m-0 p-0" data-testid="repeat-standing-items">
            @for (item of standing(); track item.key; let i = $index) {
              <li class="am-rep__item" [attr.data-standing-item]="i">
                <span class="am-rep__num text-meta" aria-hidden="true">{{ format.number(i + 1) }}</span>
                <label class="am-rep__cell am-rep__title">
                  <span class="sr-only">{{ 'meeting.repeat.itemTitle' | translate: { n: format.number(i + 1) } }}</span>
                  <input
                    pInputText
                    class="w-full"
                    maxlength="300"
                    [value]="item.title"
                    [placeholder]="'meeting.repeat.itemTitlePlaceholder' | translate"
                    [attr.aria-invalid]="showErrors() && !item.title.trim() ? 'true' : null"
                    (input)="setTitle(i, $any($event.target).value)"
                    [attr.data-testid]="'repeat-item-title-' + i"
                  />
                </label>
                <span class="am-rep__cell am-rep__presenter">
                  <button type="button" class="am-rep__pick text-meta" (click)="openPresenter(i)" [attr.data-testid]="'repeat-item-presenter-' + i">
                    {{ item.presenter?.name ?? ('meeting.repeat.noPresenter' | translate) }}
                  </button>
                </span>
                <span class="am-rep__cell am-rep__dur">
                  <app-overlay-select
                    [options]="itemDurations()"
                    optionLabel="label"
                    optionValue="value"
                    [ngModel]="item.durationMinutes"
                    (ngModelChange)="setDuration(i, $event)"
                    [ariaLabel]="'meeting.repeat.itemDuration' | translate: { n: format.number(i + 1) }"
                    [ngModelOptions]="{ standalone: true }"
                  />
                </span>
                <am-icon-button icon="pi pi-times" [label]="'meeting.repeat.removeItem' | translate: { n: format.number(i + 1) }" (activated)="removeItem(i)" />
              </li>
            }
          </ol>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <p-button size="small" severity="secondary" [label]="'meeting.repeat.addItem' | translate" [disabled]="standing().length >= standingMax" data-testid="repeat-standing-add" (onClick)="addItem()" />
            @if (standing().length >= standingMax) {
              <span class="text-meta text-[var(--am-ink-500)]" data-testid="repeat-standing-full">{{ 'meeting.repeat.standingFull' | translate: { n: format.number(standingMax) } }}</span>
            }
          </div>
        </div>
      }
      @case ('allDates') {
        <div class="flex flex-col gap-2" data-testid="repeat-all-dates-view">
          <button type="button" class="am-backlink self-start" (click)="view.set({ kind: 'form' })">{{ 'meeting.repeat.backToRepeat' | translate }}</button>
          <p class="m-0 text-meta font-medium">{{ format.count('meeting.seriesDates', dates().length) }}</p>
          <div class="am-rep__scroll" tabindex="0" role="region" [attr.aria-label]="'meeting.repeat.nextDates' | translate" data-testid="repeat-all-dates">
            <ng-container *ngTemplateOutlet="dateRows; context: { $implicit: dates() }" />
          </div>
        </div>
      }
      @case ('clash') {
        <div class="flex flex-col gap-2" data-testid="repeat-clash-view">
          <button type="button" class="am-backlink self-start" data-testid="repeat-clash-back" (click)="view.set({ kind: 'form' })">{{ 'meeting.repeat.allDates' | translate }}</button>
          <am-meeting-clash [clash]="clashOf(clashIndex())" [showRows]="true" [prefix]="whenOf(clashIndex())" />
        </div>
      }
      @default {
        <form [formGroup]="form" class="flex flex-col gap-2" data-testid="repeat-form" (submit)="$event.preventDefault()">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="am-rep__label" id="repeatRepeatsLabel">{{ 'meeting.repeat.repeats' | translate }}</span>
            <am-meeting-segmented [options]="repeatsOptions()" [(value)]="repeatsValue" labelledBy="repeatRepeatsLabel" data-testid="repeat-repeats" />
          </div>
          @if (repeats()) {
            <div class="flex flex-col gap-1">
              <div class="grid gap-3" [style.grid-template-columns]="patternColumns()">
                <am-field [label]="'meeting.repeat.every' | translate" [control]="form.controls.every" message="none">
                  <app-overlay-select [options]="everyOptions()" optionLabel="label" optionValue="value" formControlName="every" [ariaLabel]="'meeting.repeat.every' | translate" />
                </am-field>
                @if (inWeeks()) {
                  <am-field [label]="'meeting.repeat.weekday' | translate" [control]="form.controls.weekday" message="none">
                    <app-overlay-select [options]="weekdayOptions()" optionLabel="label" optionValue="value" formControlName="weekday" [ariaLabel]="'meeting.repeat.weekday' | translate" />
                  </am-field>
                } @else {
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="am-rep__label" id="repeatOnLabel">{{ 'meeting.repeat.on' | translate }}</span>
                    <am-meeting-segmented [options]="onOptions()" [(value)]="monthMode" labelledBy="repeatOnLabel" data-testid="repeat-on" />
                  </div>
                  @if (monthMode() === 'DAY') {
                    <am-field [label]="'meeting.repeat.day' | translate" [control]="form.controls.dayOfMonth" message="none">
                      <app-overlay-select [options]="dayOptions()" optionLabel="label" optionValue="value" formControlName="dayOfMonth" [ariaLabel]="'meeting.repeat.day' | translate" />
                    </am-field>
                    <span></span>
                  } @else {
                    <am-field [label]="'meeting.repeat.which' | translate" [control]="form.controls.ordinal" message="none">
                      <app-overlay-select [options]="ordinalOptions()" optionLabel="label" optionValue="value" formControlName="ordinal" [ariaLabel]="'meeting.repeat.which' | translate" />
                    </am-field>
                    <am-field [label]="'meeting.repeat.weekday' | translate" [control]="form.controls.weekday" message="none">
                      <app-overlay-select [options]="weekdayOptions()" optionLabel="label" optionValue="value" formControlName="weekday" [ariaLabel]="'meeting.repeat.weekday' | translate" />
                    </am-field>
                  }
                }
              </div>
              <p class="m-0 text-meta am-rep__info" data-testid="repeat-readback"><bdi>{{ readback() }}</bdi></p>
            </div>
            <div class="flex flex-col gap-1">
              <div class="grid gap-3" style="grid-template-columns: auto minmax(0, 1fr) minmax(0, 1.2fr)">
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="am-rep__label" id="repeatEndsLabel">{{ 'meeting.repeat.ends' | translate }}</span>
                  <am-meeting-segmented [options]="endsOptions()" [(value)]="ends" labelledBy="repeatEndsLabel" data-testid="repeat-ends" />
                </div>
                @if (ends() === 'AFTER') {
                  <am-field [label]="'meeting.repeat.count' | translate" [control]="form.controls.count" message="none">
                    <input pInputText dir="ltr" inputmode="numeric" formControlName="count" aria-describedby="repeatEndsHint" [attr.aria-invalid]="countError() ? 'true' : null" data-testid="repeat-count" />
                  </am-field>
                } @else {
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="am-rep__label" id="repeatEndLabel">{{ 'meeting.repeat.endDate' | translate }}</span>
                    <button
                      type="button"
                      class="am-rep__date"
                      aria-labelledby="repeatEndLabel"
                      [attr.aria-invalid]="showErrors() && !endsOn() ? 'true' : null"
                      data-testid="repeat-end-date"
                      (click)="view.set({ kind: 'endDate' })"
                    >
                      <bdi>{{ endsOn() ? format.date(endInstant()!) : ('meeting.repeat.pickDate' | translate) }}</bdi>
                    </button>
                  </div>
                }
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="am-rep__label" id="repeatStandingLabel">{{ 'meeting.repeat.standing' | translate }}</span>
                  <button type="button" class="am-rep__date" aria-labelledby="repeatStandingLabel" data-testid="repeat-standing" (click)="view.set({ kind: 'standing' })">
                    {{ standingLine() }}
                  </button>
                </div>
              </div>
              <!-- The Ends row's line: the count's error when there is one, else where Every started from. -->
              @if (countError(); as err) {
                <p class="m-0 text-meta text-[var(--am-danger-ink)]" id="repeatEndsHint" role="alert" data-testid="repeat-count-error">{{ err | translate }}</p>
              } @else {
                <p class="m-0 text-meta text-[var(--am-ink-500)]" id="repeatEndsHint" data-testid="repeat-hint">{{ hint() }}</p>
              }
            </div>
            <div class="flex flex-col gap-1" data-testid="repeat-dates">
              <p class="m-0 am-rep__label">{{ 'meeting.repeat.nextDates' | translate }}</p>
              @switch (previewState()) {
                @case ('loading') {
                  <p class="m-0 text-meta text-[var(--am-ink-500)]" data-testid="repeat-dates-loading">{{ 'meeting.repeat.datesLoading' | translate }}</p>
                }
                @case ('error') {
                  <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="repeat-dates-error">
                    {{ previewError()! | translate }}
                    <p-button size="small" [text]="true" [label]="'common.retry' | translate" data-testid="repeat-dates-retry" (onClick)="retry()" />
                  </p>
                }
                @case ('ready') {
                  <ng-container *ngTemplateOutlet="dateRows; context: { $implicit: shownDates() }" />
                  @if (laterCount() > 0) {
                    <p class="m-0 flex flex-wrap items-baseline gap-x-2 text-meta" data-testid="repeat-later">
                      <span>{{ laterLine() }}</span>
                      <button type="button" class="am-rep__link" data-testid="repeat-show-all" (click)="view.set({ kind: 'allDates' })">{{ 'meeting.repeat.showAll' | translate }}</button>
                    </p>
                  }
                }
              }
            </div>
          }
        </form>
      }
    }

    <ng-template #dateRows let-rows>
      <ul class="am-rep__dates m-0 p-0">
        @for (d of rows; track d.index) {
          <li class="am-rep__date-row" [attr.data-repeat-date]="d.index">
            <bdi class="am-rep__when text-value">{{ dayLabel(d.startsAt) }}</bdi>
            <span class="am-rep__title text-meta text-[var(--am-ink-700)]" [title]="d.title">@if (d.moved) {<bdi>→ {{ dayLabel(d.startsAt) }}</bdi> · }{{ d.title }}</span>
            <span class="am-rep__chips">
              @if (d.moved) {
                <span class="am-rep__chip am-rep__chip--warn" data-chip="moved">{{ 'meeting.repeat.moved' | translate }}</span>
              }
              @if (shortMonth(d)) {
                <span class="am-rep__chip" data-chip="short-month">{{ 'meeting.repeat.noDay' | translate: { day: format.number(form.controls.dayOfMonth.value ?? 0) } }}</span>
              }
              @if (clashOf(d.index - 1)?.people?.length) {
                <button type="button" class="am-rep__chip am-rep__chip--warn am-rep__chip--button" data-chip="clash" [attr.aria-label]="'meeting.repeat.clashOn' | translate: { date: dayLabel(d.startsAt) }" (click)="view.set({ kind: 'clash', index: d.index - 1 })">
                  {{ 'meeting.repeat.clash' | translate }}
                </button>
              }
            </span>
          </li>
        }
      </ul>
    </ng-template>

    <ng-template #pickerBody>
      <am-simple-list
        [load]="loadPresenters"
        [columns]="pickerColumns()"
        grid="minmax(0,1.5fr) minmax(0,1fr)"
        [row]="candidateCells"
        defaultSort="name:asc"
        [searchLabel]="'meeting.guest.search' | translate"
        [searchPlaceholder]="'meeting.guest.searchPlaceholder' | translate"
        [emptyText]="'meeting.guest.noPeople' | translate"
        [noMatchText]="'meeting.guest.noMatch' | translate"
        [countText]="countText"
        [selectable]="true"
        (picked)="onPresenter($event)"
      />
    </ng-template>
    <ng-template #candidateCells let-c>
      <span class="truncate font-medium">{{ c.name }}</span>
      <span class="truncate text-meta text-[var(--am-ink-700)]">{{ placeOf(c) }}</span>
    </ng-template>
    <am-list-dialog size="compact" [visible]="presenterFor() !== null" [heading]="'meeting.repeat.presenterTitle' | translate" [closeLabel]="'common.close' | translate" [body]="pickerBody" (closeRequested)="presenterFor.set(null)" />
  `,
  styles: [
    `
      .am-rep__label {
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        font-weight: 600;
        color: var(--am-ink-700);
      }
      .am-rep__info {
        color: var(--am-info-ink);
      }
      .am-rep__link {
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        font-weight: 600;
        color: var(--am-blue-primary);
        cursor: pointer;
      }
      .am-rep__date {
        min-block-size: var(--am-control-height);
        padding-inline: var(--am-space-8);
        text-align: start;
        font: inherit;
        font-size: var(--am-type-value-size);
        color: var(--am-ink-900);
        background: var(--am-control-bg);
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-button);
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .am-rep__date[aria-invalid='true'] {
        border-color: var(--am-danger-ink);
      }
      .am-rep__dates {
        list-style: none;
      }
      .am-rep__date-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        column-gap: var(--am-space-8);
        align-items: baseline;
        padding-block: 2px;
      }
      .am-rep__when {
        white-space: nowrap;
      }
      .am-rep__chips {
        display: flex;
        gap: var(--am-space-4);
      }
      .am-rep__title {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .am-rep__chip {
        font-size: var(--am-type-micro-size);
        line-height: var(--am-type-micro-line);
        font-weight: 600;
        padding-inline: var(--am-space-8);
        border-radius: 999px;
        border: 1px solid var(--am-border);
        color: var(--am-ink-700);
        background: var(--am-surface);
        white-space: nowrap;
      }
      .am-rep__chip--warn {
        color: var(--am-warning-ink);
        background: var(--am-warning-bg);
        border-color: var(--am-warning-border);
      }
      .am-rep__chip--button {
        cursor: pointer;
        font-family: inherit;
      }
      .am-rep__chip--button:focus-visible,
      .am-rep__pick:focus-visible,
      .am-rep__link:focus-visible,
      .am-rep__date:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-rep__scroll {
        max-block-size: calc(var(--am-space-40) * 7);
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .am-rep__items {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--am-space-4);
      }
      .am-rep__item {
        display: grid;
        grid-template-columns: auto minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.8fr) auto;
        align-items: center;
        gap: var(--am-space-8);
      }
      .am-rep__num {
        color: var(--am-ink-500);
      }
      .am-rep__pick {
        inline-size: 100%;
        min-block-size: var(--am-control-height);
        padding-inline: var(--am-space-8);
        text-align: start;
        font-family: inherit;
        color: var(--am-ink-900);
        background: var(--am-control-bg);
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-button);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }
    `,
  ],
})
export class MeetingRepeatStepComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  readonly format = inject(FormatService);

  readonly owner = input.required<ScheduleOwner>();
  /** Step 1's answers; null until step 1 is complete. */
  readonly base = input<RepeatBase | null>(null);
  readonly showErrors = input(false);
  /** How many times step 2 has been opened (the dialog counts each Next): each opening seeds the On fields, the first also Every. */
  readonly entry = input(0);

  readonly standingMax = REPEAT_STANDING_MAX;
  readonly view = signal<RepeatView>({ kind: 'form' });
  /** Doesn't repeat / Repeats, as the segmented control's value. */
  readonly repeatsValue = signal<'ONCE' | 'REPEATS'>('ONCE');
  readonly repeats = computed(() => this.repeatsValue() === 'REPEATS');
  readonly monthMode = signal<'DAY' | 'THE'>('THE');
  readonly ends = signal<'ON' | 'AFTER'>('AFTER');
  readonly endsOn = signal<Date | null>(null);
  readonly standing = signal<StandingDraft[]>([]);
  /** Which standing item's presenter is being picked, while the list is open. */
  readonly presenterFor = signal<number | null>(null);
  private nextKey = 1;
  /** Whether Every was seeded from the committee's frequency (its hint says so). */
  readonly seeded = signal<MeetingSeriesEvery | null>(null);

  readonly form = this.fb.group({
    every: ['MONTH_1' as MeetingSeriesEvery, Validators.required],
    weekday: [1 as number, Validators.required],
    dayOfMonth: [1 as number, Validators.required],
    ordinal: ['FIRST' as MeetingSeriesOrdinal, Validators.required],
    count: ['12', [Validators.required, Validators.pattern(/^\s*([1-9]|[1-4]\d|5[0-3])\s*$/)]],
  });
  private readonly value = toSignal(this.form.valueChanges.pipe(startWith(null), map(() => this.form.getRawValue())), { requireSync: true });

  /** Every alone: changes only when Every does. */
  readonly every = computed(() => this.value().every!);
  readonly inWeeks = computed(() => seriesInWeeks(this.every()));
  readonly firstDay = computed(() => {
    const b = this.base();
    return b ? meetingDay(b.startsAt, this.format) : null;
  });
  readonly endInstant = computed(() => {
    const d = this.endsOn();
    return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12) : null;
  });

  // ── Choices ──────────────────────────────────────────────────────────────────

  readonly repeatsOptions = computed<SegmentedOption<'ONCE' | 'REPEATS'>[]>(() => {
    this.translate.currentLang();
    return [
      { value: 'ONCE', label: this.translate.instant('meeting.repeat.once') },
      { value: 'REPEATS', label: this.translate.instant('meeting.repeat.repeatsOn') },
    ];
  });
  readonly onOptions = computed<SegmentedOption<'DAY' | 'THE'>[]>(() => {
    this.translate.currentLang();
    return [
      { value: 'DAY', label: this.translate.instant('meeting.repeat.onDay') },
      { value: 'THE', label: this.translate.instant('meeting.repeat.onThe') },
    ];
  });
  readonly endsOptions = computed<SegmentedOption<'ON' | 'AFTER'>[]>(() => {
    this.translate.currentLang();
    return [
      { value: 'ON', label: this.translate.instant('meeting.repeat.endsOn') },
      { value: 'AFTER', label: this.translate.instant('meeting.repeat.endsAfter') },
    ];
  });
  readonly everyOptions = computed(() => {
    this.translate.currentLang();
    return SERIES_EVERY.map((e) => ({ value: e, label: seriesEveryChoice(e, this.translate) }));
  });
  readonly weekdayOptions = computed(() => {
    this.translate.currentLang();
    return SERIES_WEEKDAYS.map((d) => ({ value: d, label: seriesWeekday(d, this.translate) }));
  });
  readonly ordinalOptions = computed(() => {
    this.translate.currentLang();
    return SERIES_ORDINALS.map((o) => ({ value: o, label: seriesOrdinal(o, this.translate) }));
  });
  readonly dayOptions = computed(() => Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: this.format.number(i + 1) })));
  readonly itemDurations = computed(() => {
    this.translate.currentLang();
    return [{ value: null as number | null, label: this.translate.instant('meeting.repeat.noDuration') }, ...MEETING_DURATIONS.map((m) => ({ value: m as number | null, label: this.format.count('meeting.minutes', m) }))];
  });
  /** Every | On | Which/Day | Weekday; weeks have Every | Weekday. */
  readonly patternColumns = computed(() => (this.inWeeks() ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr) auto minmax(0, 0.9fr) minmax(0, 1fr)'));

  // ── The request, and the server's preview of it ─────────────────────────────

  /** What step 2 sends, or null while it is incomplete (the preview waits). */
  readonly request = computed<MeetingSeriesRequest | null>(() => {
    const b = this.base();
    const first = this.firstDay();
    const v = this.value();
    if (!b || !first || !this.repeats()) return null;
    const owner = this.owner();
    const weeks = seriesInWeeks(v.every!);
    const onKind = weeks ? 'WEEKDAY' : this.monthMode() === 'DAY' ? 'DAY_OF_MONTH' : 'ORDINAL_WEEKDAY';
    const count = /^\s*\d+\s*$/.test(v.count ?? '') ? Number(v.count) : null;
    const end = this.ends() === 'ON' ? this.endsOn() : null;
    if (this.ends() === 'AFTER' ? this.form.controls.count.invalid || count === null : !end) return null;
    return {
      ...(owner.kind === 'COMMITTEE' ? { committeeId: owner.id } : { orgUnitId: owner.id, unitQuorum: b.unitQuorum }),
      subject: b.subject,
      typeValueId: b.typeValueId,
      startTime: meetingTimeText(b.startsAt, this.format),
      durationMinutes: b.durationMinutes,
      location: b.location,
      meetingUrl: b.meetingUrl,
      every: v.every!,
      onKind,
      weekday: onKind === 'DAY_OF_MONTH' ? null : v.weekday,
      dayOfMonth: onKind === 'DAY_OF_MONTH' ? v.dayOfMonth : null,
      ordinal: onKind === 'ORDINAL_WEEKDAY' ? v.ordinal : null,
      firstDate: isoDay(first),
      ...(end ? { endsOn: isoDay(end), count: null } : { endsOn: null, count }),
      standingAgenda: this.standing()
        .filter((s) => s.title.trim())
        .map((s) => ({ title: s.title.trim(), presenterUserId: s.presenter?.id ?? null, durationMinutes: s.durationMinutes })),
    };
  });

  readonly previewState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly previewError = signal<string | null>(null);
  readonly preview = signal<MeetingSeriesPreviewDto | null>(null);
  private readonly retries = signal(0);

  readonly dates = computed(() => this.preview()?.dates ?? []);
  readonly shownDates = computed(() => this.dates().slice(0, REPEAT_DATES_SHOWN));
  readonly laterCount = computed(() => Math.max(0, this.dates().length - REPEAT_DATES_SHOWN));
  /** How many meetings Schedule will make: the preview's, never counted here. */
  readonly count = computed(() => (this.repeats() && this.previewState() === 'ready' ? this.dates().length : null));

  constructor() {
    // The preview, read again as the choices settle: one request at a time, the latest wins.
    // A changed request makes the step loading AT ONCE, before the debounce (P250):
    // otherwise, for those 250 ms, the button would still count the old preview's
    // meetings for choices that make a different number. Only a CHANGED request
    // does this (distinct first), so a signal that changes nothing never leaves
    // the step loading with no request on its way.
    toObservable(computed(() => ({ request: this.request(), retry: this.retries() })))
      .pipe(
        distinctUntilChanged((a, b) => a.retry === b.retry && JSON.stringify(a.request) === JSON.stringify(b.request)),
        tap(({ request }) => this.previewState.set(request ? 'loading' : 'idle')),
        debounceTime(250),
        switchMap(({ request }) => {
          if (!request) return of({ kind: 'idle' as const });
          return this.meetings.seriesPreview(request).pipe(
            map((preview) => ({ kind: 'ready' as const, preview })),
            catchError((err: unknown) => of({ kind: 'error' as const, key: meetingRefusalKey(err) ?? 'meeting.repeat.datesError' })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((r) => {
        if (r.kind === 'ready') {
          this.preview.set(r.preview);
          this.previewError.set(null);
          this.previewState.set('ready');
        } else if (r.kind === 'error') {
          this.preview.set(null);
          this.previewError.set(r.key);
          this.previewState.set('error');
        } else {
          this.preview.set(null);
          this.previewState.set('idle');
        }
      });

    // Each opening of step 2 seeds it, once its inputs are in (no timer: the order is the signals').
    effect(() => {
      const n = this.entry();
      if (n > 0) untracked(() => this.enter(n === 1));
    });

    // Ends · After starts at about a year for the Every chosen, until the person types a number.
    // It reads Every alone (a computed that changes only when Every does): setting the count changes the form's value, and must not run this again.
    effect(() => {
      const every = this.every();
      untracked(() => {
        if (!this.form.controls.count.dirty) this.form.controls.count.setValue(String(DEFAULT_COUNT[every]));
      });
    });
  }

  /**
   * Called each time step 2 opens: Every from the committee's frequency (once,
   * Q6), and the On fields from the first meeting's day, which step 1 may have
   * changed.
   */
  enter(firstTime: boolean): void {
    const first = this.firstDay();
    if (firstTime) {
      const every = seriesEveryFromFrequency(this.owner().frequency);
      this.seeded.set(every);
      this.repeatsValue.set(every ? 'REPEATS' : 'ONCE');
      this.form.controls.every.setValue(every ?? 'MONTH_1');
    }
    if (first) {
      this.form.controls.weekday.setValue(weekdayOf(first));
      this.form.controls.dayOfMonth.setValue(first.getDate());
      this.form.controls.ordinal.setValue(ordinalOf(first));
      const end = this.endsOn();
      if (end && end < first) this.endsOn.set(null);
    }
    this.view.set({ kind: 'form' });
  }

  retry(): void {
    this.retries.update((n) => n + 1);
  }

  /** Whether step 2 can be sent: repeating, the choices complete, and the preview read. */
  ready(): boolean {
    return !this.repeats() || (this.request() !== null && this.previewState() === 'ready' && this.standing().every((s) => !!s.title.trim()));
  }

  // ── What the step says ───────────────────────────────────────────────────────

  /** "Every 3 months, the last Thursday · Dec, Mar, Jun, Sep", or "… on day 31 · the last day in shorter months". */
  readonly readback = computed(() => {
    this.translate.currentLang();
    const v = this.value();
    const weeks = seriesInWeeks(v.every!);
    const onKind = weeks ? 'WEEKDAY' : this.monthMode() === 'DAY' ? 'DAY_OF_MONTH' : 'ORDINAL_WEEKDAY';
    const pattern = seriesPattern(
      { every: v.every!, on: { kind: onKind, weekday: v.weekday ?? null, dayOfMonth: v.dayOfMonth ?? null, ordinal: v.ordinal ?? null } },
      this.translate,
      this.format,
    );
    const extra: string[] = [];
    if (onKind === 'DAY_OF_MONTH' && (v.dayOfMonth ?? 0) > 28) extra.push(this.translate.instant('meeting.repeat.lastDayInShort'));
    if (v.every === 'MONTH_3' || v.every === 'MONTH_6') {
      // The months come from the preview's own pattern days: nothing here works out a date.
      const months = [...new Set(this.dates().map((d) => this.format.month(`${d.patternDay}T12:00:00Z`, 'short')))];
      if (months.length) extra.push(months.slice(0, 4).join(this.translate.instant('meeting.repeat.listJoin')));
    }
    return [pattern, ...extra].join(' · ');
  });

  readonly standingLine = computed(() => {
    this.translate.currentLang();
    const n = this.standing().length;
    return n === 0 ? this.translate.instant('meeting.repeat.standingAdd') : this.translate.instant('meeting.repeat.standingEdit', { items: this.format.count('meeting.standingItems', n) });
  });

  /** "From the committee's frequency, Quarterly → every 3 months · up to 12 months ahead". */
  readonly hint = computed(() => {
    this.translate.currentLang();
    const seeded = this.seeded();
    const frequency = this.owner().frequency;
    if (seeded && frequency && this.value().every === seeded) {
      return this.translate.instant('meeting.repeat.fromFrequency', {
        frequency: this.translate.instant(`committee.frequency.${frequency.toLowerCase()}`),
        every: seriesEveryChoice(seeded, this.translate),
      });
    }
    return this.translate.instant('meeting.repeat.ahead');
  });

  /** "4 later dates · 1 moved · 2 have a clash" (Q7): a Moved or Clash date past the fifth is never hidden without a count. */
  readonly laterLine = computed(() => {
    this.translate.currentLang();
    const later = this.dates().slice(REPEAT_DATES_SHOWN);
    const moved = later.filter((d) => d.moved).length;
    const clashing = later.filter((d) => (this.clashOf(d.index - 1)?.people.length ?? 0) > 0).length;
    return [
      this.format.count('meeting.laterDates', later.length),
      ...(moved ? [this.format.count('meeting.datesMoved', moved)] : []),
      ...(clashing ? [this.format.count('meeting.datesClash', clashing)] : []),
    ].join(' · ');
  });

  /** The count's error, said in the Ends row's line: once errors show, or as soon as a typed number is out of range. */
  readonly countError = computed(() => {
    this.value();
    const c = this.form.controls.count;
    if (this.ends() !== 'AFTER' || c.valid || !(this.showErrors() || c.dirty)) return null;
    return c.hasError('required') ? 'meeting.repeat.countRequired' : 'meeting.repeat.countRange';
  });

  clashIndex(): number {
    const v = this.view();
    return v.kind === 'clash' ? v.index : 0;
  }

  clashOf(i: number) {
    return this.preview()?.clashes[i] ?? null;
  }

  /** "Thu 31 Dec 2026", in the tenant's zone. */
  dayLabel(at: string): string {
    return `${this.format.weekday(at, 'short')} ${this.format.date(at)}`;
  }

  /** The Clash view's prefix: "Thu 25 Mar 2027, 10:00–11:30". */
  whenOf(i: number): string | null {
    const d = this.dates()[i];
    const b = this.base();
    if (!d || !b) return null;
    const start = new Date(d.startsAt);
    return `${this.dayLabel(d.startsAt)}, ${this.format.timeOfDay(start)}–${this.format.timeOfDay(new Date(start.getTime() + b.durationMinutes * 60_000))}`;
  }

  /** "No 31st · last day": the rule chose a shorter month's last day; nothing moved. */
  shortMonth(d: MeetingSeriesPreviewDto['dates'][number]): boolean {
    if (d.moved || this.inWeeks() || this.monthMode() !== 'DAY') return false;
    return Number(d.patternDay.slice(8, 10)) < (this.form.controls.dayOfMonth.value ?? 0);
  }

  // ── Ends on a date ───────────────────────────────────────────────────────────

  pickEnd(day: Date | null): void {
    this.endsOn.set(day);
    this.view.set({ kind: 'form' });
  }

  // ── The standing agenda (Q5) ─────────────────────────────────────────────────

  addItem(): void {
    if (this.standing().length >= REPEAT_STANDING_MAX) return;
    this.standing.update((s) => [...s, { key: this.nextKey++, title: '', presenter: null, durationMinutes: null }]);
  }

  removeItem(i: number): void {
    this.standing.update((s) => s.filter((_, j) => j !== i));
  }

  setTitle(i: number, title: string): void {
    this.standing.update((s) => s.map((item, j) => (j === i ? { ...item, title } : item)));
  }

  setDuration(i: number, minutes: number | null): void {
    this.standing.update((s) => s.map((item, j) => (j === i ? { ...item, durationMinutes: minutes } : item)));
  }

  /** Back to the form: an item with no title is dropped, so nothing half-made is sent. */
  closeStanding(): void {
    this.standing.update((s) => s.filter((item) => item.title.trim() || item.presenter || item.durationMinutes));
    this.view.set({ kind: 'form' });
  }

  openPresenter(i: number): void {
    this.presenterFor.set(i);
  }

  readonly pickerColumns = computed(() => {
    this.translate.currentLang();
    return [{ label: this.translate.instant('meeting.guest.col.person'), sort: 'name' }, { label: this.translate.instant('meeting.guest.col.place') }];
  });

  readonly countText = (n: number): string => this.format.count('meeting.people', n);

  readonly loadPresenters = (query: SimpleListQuery): Observable<SimpleListPage<Candidate>> => {
    const owner = this.owner();
    return this.meetings.presenterCandidates(owner.kind === 'COMMITTEE' ? { committeeId: owner.id } : { orgUnitId: owner.id }, {
      q: query.q,
      skip: query.skip,
      take: Math.min(query.take, 50),
    });
  };

  placeOf(c: Candidate): string {
    return [c.position, c.unit].filter((x) => !!x).map((x) => this.language.bilingual(x!.nameEn, x!.nameAr)).join(' · ');
  }

  onPresenter(c: Candidate): void {
    const i = this.presenterFor();
    if (i !== null) this.standing.update((s) => s.map((item, j) => (j === i ? { ...item, presenter: { id: c.id, name: c.name } } : item)));
    this.presenterFor.set(null);
  }
}
