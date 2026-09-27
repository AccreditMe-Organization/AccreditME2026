import {
  Component,
  DestroyRef,
  effect,
  TemplateRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import {
  WorkingCalendarChangeDto,
  WorkingCalendarDto,
  WorkingCalendarService,
} from '../../services/working-calendar.service';
import { WEEK_DAYS } from '../../week-days';
import { CalendarFieldChange, diffCalendarChange } from '../../calendar-change';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import {
  RequestOutcome,
  composePageOutcome,
  createRequestOutcome,
} from '../../../../core/request-outcome/request-outcome';
import { AmDateTimePipe } from '../../../../core/formatting';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

const COMMON_TIMEZONES = [
  { label: 'Asia/Riyadh (UTC+3)', value: 'Asia/Riyadh' },
  { label: 'Asia/Dubai (UTC+4)', value: 'Asia/Dubai' },
  { label: 'Asia/Kuwait (UTC+3)', value: 'Asia/Kuwait' },
  { label: 'Asia/Bahrain (UTC+3)', value: 'Asia/Bahrain' },
  { label: 'Asia/Qatar (UTC+3)', value: 'Asia/Qatar' },
  { label: 'Africa/Cairo (UTC+2)', value: 'Africa/Cairo' },
  { label: 'Asia/Amman (UTC+3)', value: 'Asia/Amman' },
  { label: 'Asia/Beirut (UTC+3)', value: 'Asia/Beirut' },
  { label: 'Europe/London (UTC+0/+1)', value: 'Europe/London' },
  { label: 'Europe/Paris (UTC+1/+2)', value: 'Europe/Paris' },
];

/**
 * Every half hour of the day, as the value the API stores.
 *
 * A BOUNDED LIST rather than a time picker, and the reason is the platform
 * fault this design keeps running into: `p-datepicker [timeOnly]` builds a
 * PrimeNG connected overlay, which `ConnectedOverlayScrollHandler` closes on ANY
 * ancestor scroll — and the app shell's `<main>` scrolls. The overlay guard
 * cannot help, because it only sees overlays we construct. So the control is
 * `OverlaySelectComponent`, which is immune by construction, and 48 options is
 * far past the five-option threshold where that is required anyway.
 *
 * GRANULARITY IS A REDUCTION, and it is flagged rather than hidden: the old
 * time picker accepted any minute, so a tenant could store 08:15. The API still
 * accepts any "HH:mm" — nothing is lost at the data layer — but this picker
 * offers half hours only. Office hours in practice sit on the hour or the half
 * hour (the GCC default is 08:00–16:00), and a 96-entry list buys a case nobody
 * has asked for. Widening it is one constant.
 */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hh = `${Math.floor(i / 2)}`.padStart(2, '0');
  const mm = i % 2 === 0 ? '00' : '30';
  return { label: `${hh}:${mm}`, value: `${hh}:${mm}` };
});

/**
 * Working calendar — ACC-120 slice 1, Template 5 (settings page).
 *
 * ## Section-level save, which is the template's own shape
 *
 * Template 5's reference is Task SLA & escalation: each section carries its own
 * Unsaved flag, Discard and Save, because a settings page is several unrelated
 * decisions and one Save over all of them cannot say which one the user meant.
 * The working week and the working hours are two such decisions, so there are
 * two sections and two saves.
 *
 * NO IMMEDIATE-EFFECT SECTION HERE, and that is stated rather than invented.
 * The reference has one — toggles that take hold as you switch them, with no
 * Save — because notification switches are individually meaningful. Nothing on
 * this page is: a half-applied working week would have the SLA engine counting
 * against a calendar nobody chose. So every change on this page is saved
 * deliberately, and the template's immediate section simply does not arise.
 *
 * ## "Last changed" is real data, and nearly was not
 *
 * The DTO carries only `updatedAt`, so this line was first planned as a date
 * with no actor under the design's "state what isn't recorded" fallback. That
 * was wrong: every calendar update already writes an `AuditLog` row with
 * `actorId`, `before` and `after`. The fallback rule covers a fact we do not
 * RECORD, not one we had not yet EXPOSED — using it here would have hidden
 * something we hold. The DTO is a projection, not the record.
 *
 * A null actor is still a real case (`AuditLog.actorId` is nullable), and reads
 * "not recorded" rather than an empty byline.
 *
 * ## `partial` is reachable here, and declined — see `page()` for why
 *
 * The two requests carry different permissions, so a caller with
 * `admin:access` + `org:view` genuinely gets the calendar and is refused the
 * history. That is a real `partial`, and the page still does not report one: a
 * complete page with one annotation absent is not a partial page. The reasoning
 * is on `page()` rather than repeated here.
 */
@Component({
  selector: 'app-calendar-config',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    TranslatePipe,
    AmDateTimePipe,
    ButtonModule,
    PageHeaderComponent,
    FieldComponent,
    OverlaySelectComponent,
    EditDialogComponent,
  ],
  template: `
    <app-page-header
      [title]="'workingCalendar.title' | translate"
      [purpose]="'workingCalendar.purpose' | translate"
    >
      <div pageActions class="flex gap-3 items-center">
        <p-button
          [label]="'workingCalendar.holidays' | translate"
          icon="pi pi-calendar"
          severity="secondary"
          routerLink="/working-calendar/holidays"
        />
      </div>
    </app-page-header>

    <!-- LAST CHANGED, from the audit trail. Absent for a caller without
         org:manage, and absent when nothing has ever been changed — both are
         real states rather than errors. -->
    @if (lastChange(); as change) {
      <div class="am-settings__meta">
        <span>
          {{
            'workingCalendar.lastChangedBy'
              | translate: { who: change.actorName || notRecorded() }
          }}
          <span dir="ltr">{{ change.changedAt | amDateTime }}</span>
        </span>
        <p-button
          [label]="'workingCalendar.changeHistory' | translate"
          severity="secondary"
          size="small"
          (onClick)="historyOpen.set(true)"
        />
      </div>
    } @else if (canManage() && historyOutcome().status === 'empty') {
      <div class="am-settings__meta">
        <span>{{ 'workingCalendar.neverChanged' | translate }}</span>
      </div>
    }

    @switch (page()) {
      @case ('loading') {
        <div class="am-settings__skeleton" aria-hidden="true">
          <span class="am-skeleton-bar"></span>
          <span class="am-skeleton-bar"></span>
          <span class="am-skeleton-bar"></span>
        </div>
      }
      @case ('failed') {
        <div class="am-settings__outcome" role="alert">
          <p>{{ calendarProblem() | translate }}</p>
          @if (calendarOutcome().status === 'error') {
            <p-button
              [label]="'common.retry' | translate"
              severity="secondary"
              (onClick)="reloadCalendar()"
            />
          }
        </div>
      }
      @default {
        @if (calendar(); as cal) {
          <div class="am-settings">
            <!-- ── The working week ─────────────────────────────────────── -->
            <section class="am-settings__section" [formGroup]="weekForm">
              <header class="am-settings__head">
                <div>
                  <h2 class="am-settings__title">
                    {{ 'workingCalendar.workingDays' | translate }}
                  </h2>
                  <p class="am-settings__help">
                    {{ 'workingCalendar.workingDaysHelp' | translate }}
                  </p>
                </div>
                @if (weekDirty()) {
                  <span class="am-settings__unsaved">
                    {{ 'common.unsaved' | translate }}
                  </span>
                }
              </header>

              @if (canManage()) {
                <div class="flex gap-3 flex-wrap">
                  <p-button
                    [label]="'workingCalendar.presetGcc' | translate"
                    size="small"
                    severity="secondary"
                    type="button"
                    (onClick)="applyPreset([0, 1, 2, 3, 4])"
                  />
                  <p-button
                    [label]="'workingCalendar.presetWestern' | translate"
                    size="small"
                    severity="secondary"
                    type="button"
                    (onClick)="applyPreset([1, 2, 3, 4, 5])"
                  />
                </div>
              }

              <div class="am-settings__days" role="group"
                   [attr.aria-label]="'workingCalendar.workingDays' | translate">
                @for (day of weekDays; track day.value) {
                  <label class="am-settings__day">
                    <input
                      type="checkbox"
                      [checked]="isDaySelected(day.value)"
                      [disabled]="!canManage()"
                      (change)="toggleDay(day.value)"
                    />
                    {{ day.labelKey | translate }}
                  </label>
                }
              </div>
              @if (noDaysChosen()) {
                <p class="am-settings__error" role="alert">
                  {{ 'workingCalendar.atLeastOneDay' | translate }}
                </p>
              }

              @if (canManage()) {
                <footer class="am-settings__actions">
                  @if (weekError()) {
                    <p class="am-settings__error" role="alert">{{ weekError()! | translate }}</p>
                  }
                  <p-button
                    [label]="'common.discard' | translate"
                    severity="secondary"
                    [text]="true"
                    type="button"
                    [disabled]="!weekDirty() || weekSaving()"
                    (onClick)="resetWeek()"
                  />
                  <p-button
                    [label]="'workingCalendar.saveWorkingDays' | translate"
                    type="button"
                    [loading]="weekSaving()"
                    [disabled]="!weekDirty() || noDaysChosen()"
                    (onClick)="saveWeek()"
                  />
                </footer>
              }
            </section>

            <!-- ── Working hours and time zone ──────────────────────────── -->
            <section class="am-settings__section" [formGroup]="hoursForm">
              <header class="am-settings__head">
                <div>
                  <h2 class="am-settings__title">
                    {{ 'workingCalendar.workingHours' | translate }}
                  </h2>
                  <p class="am-settings__help">
                    {{ 'workingCalendar.workingHoursHelp' | translate }}
                  </p>
                </div>
                @if (hoursDirty()) {
                  <span class="am-settings__unsaved">{{ 'common.unsaved' | translate }}</span>
                }
              </header>

              <div class="am-settings__fields">
                <!-- Labelled, not "From"/"To" in hardcoded English as before:
                     those two strings rendered in English in an Arabic session. -->
                <am-field
                  class="am-settings__field"
                  [label]="'workingCalendar.workingHoursStart' | translate"
                  [control]="hoursForm.controls.workingHoursStart"
                >
                  <app-overlay-select
                    formControlName="workingHoursStart"
                    [options]="timeOptions"
                    optionLabel="label"
                    optionValue="value"
                  />
                </am-field>

                <am-field
                  class="am-settings__field"
                  [label]="'workingCalendar.workingHoursEnd' | translate"
                  [control]="hoursForm.controls.workingHoursEnd"
                  [errorMessages]="{ endBeforeStart: 'workingCalendar.endBeforeStart' }"
                >
                  <app-overlay-select
                    formControlName="workingHoursEnd"
                    [options]="timeOptions"
                    optionLabel="label"
                    optionValue="value"
                  />
                </am-field>

                <am-field
                  class="am-settings__field"
                  [label]="'workingCalendar.timezone' | translate"
                  [control]="hoursForm.controls.timezone"
                  [hint]="'workingCalendar.timezoneHint' | translate"
                >
                  <app-overlay-select
                    formControlName="timezone"
                    [options]="timezones"
                    optionLabel="label"
                    optionValue="value"
                  />
                </am-field>
              </div>

              @if (canManage()) {
                <footer class="am-settings__actions">
                  @if (hoursError()) {
                    <p class="am-settings__error" role="alert">{{ hoursError()! | translate }}</p>
                  }
                  <p-button
                    [label]="'common.discard' | translate"
                    severity="secondary"
                    [text]="true"
                    type="button"
                    [disabled]="!hoursDirty() || hoursSaving()"
                    (onClick)="resetHours()"
                  />
                  <p-button
                    [label]="'workingCalendar.saveWorkingHours' | translate"
                    type="button"
                    [loading]="hoursSaving()"
                    [disabled]="!hoursDirty() || hoursForm.invalid"
                    (onClick)="saveHours()"
                  />
                </footer>
              }
            </section>

            <!-- ── AI holiday suggestions ───────────────────────────────── -->
            <!-- A FEATURE STATE, not a request outcome. The endpoint
                 POST /working-calendar/ai/suggest-holidays has no handler
                 anywhere in the backend — the controller exposes six routes and
                 none under ai/ — so this is not a refusal, a quota or a failure,
                 and forcing it into the six-outcome union would misdescribe it.
                 Kept rather than deleted (Ahmad): "we need to keep it until we
                 bring AI capabilities to the application." So it says what it
                 is, up front, and offers no control that could only fail. -->
            <section class="am-settings__section am-settings__section--inert">
              <header class="am-settings__head">
                <div>
                  <h2 class="am-settings__title">
                    {{ 'workingCalendar.suggestHolidays' | translate }}
                  </h2>
                  <p class="am-settings__help">
                    {{ 'workingCalendar.suggestHolidaysHelp' | translate }}
                  </p>
                </div>
                <span class="am-settings__badge">
                  {{ 'workingCalendar.notAvailableYet' | translate }}
                </span>
              </header>
              <p class="am-settings__help">
                {{ 'workingCalendar.suggestHolidaysUnavailable' | translate }}
              </p>
            </section>
          </div>
        }
      }
    }

    <!-- The change history. Rows, in the dialog shell — an instance of a
         pattern we have rather than a new surface. Each row names the fields
         that changed with their previous values, which is what Template 5's
         reset note promises the history records. -->
    <ng-template #historyTpl>
      @if (changes().length === 0) {
        <p class="am-settings__help">{{ 'workingCalendar.neverChanged' | translate }}</p>
      }
      <ol class="am-history">
        @for (change of changes(); track change.id) {
          <li class="am-history__entry">
            <div class="am-history__meta">
              <span dir="ltr">{{ change.changedAt | amDateTime }}</span>
              <span>{{ change.actorName || notRecorded() }}</span>
            </div>
            @if (fieldsOf(change).length === 0) {
              <p class="am-history__none">{{ 'workingCalendar.noFieldsChanged' | translate }}</p>
            }
            <ul class="am-history__fields">
              @for (field of fieldsOf(change); track field.labelKey) {
                <!-- THE MEANING IS IN WORDS, not in a decoration.
                     The first version marked the old value with
                     text-decoration: line-through and separated the two with an
                     aria-hidden arrow, so a screen reader heard two day lists
                     back to back with nothing saying which was which — the whole
                     content of the row lived in a CSS rule and a hidden
                     character. That is the sibling of colour-only, which the
                     design system already forbids.
                     <del>/<ins> carry the semantics, and the visually-hidden
                     "was"/"now" carry it for the readers that do not announce
                     those elements — support is genuinely patchy, and the cost
                     of redundancy where both are announced is a slightly long
                     phrase, while the cost of omitting the words is total loss
                     of meaning. -->
                <li>
                  <span class="am-history__label">{{ field.labelKey | translate }}</span>
                  <del class="am-history__from">
                    <span class="sr-only">{{ 'workingCalendar.wasValue' | translate }}</span>
                    {{ renderValue(field.from) }}
                  </del>
                  <span class="am-history__arrow" aria-hidden="true">→</span>
                  <ins class="am-history__to">
                    <span class="sr-only">{{ 'workingCalendar.nowValue' | translate }}</span>
                    {{ renderValue(field.to) }}
                  </ins>
                </li>
              }
            </ul>
          </li>
        }
      </ol>
    </ng-template>
    <app-edit-dialog
      [visible]="historyOpen()"
      (visibleChange)="historyOpen.set($event)"
      [header]="'workingCalendar.changeHistory' | translate"
      [content]="historyTpl"
      size="form"
    />
  `,
  styles: [
    `
      .am-settings {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-16);
        max-width: 680px;
      }

      .am-settings__meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-12);
        margin-block-end: var(--am-space-16);
        font-size: 11.5px;
        line-height: 17px;
        color: var(--am-ink-500);
      }

      .am-settings__section {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-12);
        padding: var(--am-space-16);
        background: var(--am-card);
        border: 1px solid var(--am-border);
        border-radius: 8px;
      }

      /* A section with nothing to do carries no border emphasis and no control,
         so it does not read as something waiting to be filled in. */
      .am-settings__section--inert {
        background: var(--am-surface);
      }

      .am-settings__head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--am-space-8);
      }

      .am-settings__title {
        margin: 0;
        font-size: var(--am-type-value-size);
        font-weight: 600;
        color: var(--am-ink-900);
      }

      .am-settings__help {
        margin: 0;
        font-size: 11.5px;
        line-height: 17px;
        color: var(--am-ink-500);
        text-wrap: pretty;
      }

      /* Carries a WORD, not a colour: the design's own rule is that no state is
         shown by colour alone, and "Unsaved" is a state. */
      .am-settings__unsaved {
        flex: none;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--am-warning-ink);
      }

      /* The documented neutral-chip pair, not a border-strong outline.
         border-strong is 1.49:1 on white — one of the four pairs
         check:contrast asserts as FAILING on purpose — so an outline drawn in
         it is very nearly invisible and the badge reads as unstyled text. The
         token's own rule only forbids it as a CONTROL border, so this was
         within the letter of it; the chip pair is better anyway, because it is
         a pair the design system already defines and the scan already asserts
         passes (6.82:1). */
      .am-settings__badge {
        flex: none;
        font-size: 11px;
        font-weight: 600;
        color: var(--am-neutral-chip-ink);
        background: var(--am-neutral-chip-bg);
        border: 1px solid var(--am-neutral-chip-border);
        border-radius: 4px;
        padding: 1px 7px;
      }

      .am-settings__days {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-16);
      }

      .am-settings__day {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        cursor: pointer;
        user-select: none;
        font-size: var(--am-type-body-size);
      }

      .am-settings__fields {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-12);
      }

      .am-settings__field {
        flex: 1 1 190px;
        min-width: 0;
      }

      .am-settings__actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--am-space-12);
        padding-block-start: var(--am-space-8);
        border-block-start: 1px solid var(--am-border);
      }

      .am-settings__error {
        margin: 0;
        margin-inline-end: auto;
        font-size: 11.5px;
        line-height: 17px;
        font-weight: 500;
        color: var(--am-danger-ink);
      }

      .am-settings__outcome {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--am-space-12);
        padding: var(--am-space-16);
        border: 1px solid var(--am-border);
        border-radius: 8px;
      }

      .am-settings__skeleton {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-12);
        max-width: 680px;
      }

      .am-history {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-12);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .am-history__entry {
        padding-block-end: var(--am-space-12);
        border-block-end: 1px solid var(--am-border);
      }

      .am-history__meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-8);
        font-size: 11.5px;
        color: var(--am-ink-500);
      }

      .am-history__fields {
        margin: var(--am-space-4) 0 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: var(--am-type-meta-size);
      }

      /* Flex with a gap, so the label does not run into its value and the arrow
         has air on both sides. Wraps rather than overflows, because a long day
         list in Arabic is wider than the dialog. */
      .am-history__fields li {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px;
      }

      .am-history__label {
        font-weight: 500;
        color: var(--am-ink-900);
      }

      /* MIRRORED IN RTL, because U+2192 is not bidi-mirrored by the renderer.
         The VALUES order correctly by themselves — old on the right, new on the
         left in Arabic — but the glyph kept pointing left-to-right, so it ran
         from the new value back to the old one. Correct in English, inverted for
         every Arabic reader, and it is the row's only visual direction cue.
         (aria-hidden, so a screen reader was never affected: the "was"/"now"
         words carry it there.)
         Mirrored rather than swapped for U+2190, to match the idiom this
         codebase already uses for directional icons — :dir(rtl) +
         scaleX(-1), as on .am-backlink__icon in two other components. One
         idiom for "this glyph follows the reading direction" beats two.
         display: inline-block is a SAFETY NET, not the thing that makes this work
         today. A transform does not apply to a non-replaced inline element, so
         the rule could parse, match and silently do nothing — but this glyph is a
         flex item (its li is display: flex), and flex items are blockified, so it
         already computes to block. The declaration keeps the mirror working if
         that row ever stops being a flex container. Measured, not assumed: the
         spec asserts the computed box is not inline rather than asserting
         inline-block, which is what it would wrongly have expected. */
      .am-history__arrow {
        display: inline-block;
        color: var(--am-ink-500);
      }
      :dir(rtl) .am-history__arrow {
        transform: scaleX(-1);
      }

      .am-history__from {
        color: var(--am-ink-500);
        text-decoration: line-through;
      }

      .am-history__to {
        color: var(--am-ink-900);
        font-weight: 500;
        /* <ins> underlines by default, which reads as a link. The word "now"
           and the position carry it instead. */
        text-decoration: none;
      }

      .am-history__none {
        margin: var(--am-space-4) 0 0;
        font-size: 11.5px;
        color: var(--am-ink-500);
      }
    `,
  ],
})
export class CalendarConfigComponent {
  private readonly svc = inject(WorkingCalendarService);
  private readonly fb = inject(FormBuilder);
  private readonly translate = inject(TranslateService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('historyTpl', { read: TemplateRef, static: true })
  historyTpl!: TemplateRef<unknown>;

  readonly weekDays = WEEK_DAYS;
  readonly timezones = COMMON_TIMEZONES;
  readonly timeOptions = TIME_OPTIONS;

  readonly canManage = computed(() => this.navigationAccess.hasPermission('org:manage'));
  readonly historyOpen = signal(false);

  // ── The two requests, and the page outcome they compose ──────────────────
  //
  // A single record wrapped as a one-element array, because the outcome machine
  // is row-shaped. ACC-104 records that a record page has no panel-level outcome
  // definition and ACC-120 consumes it; until it does, reusing the list machine
  // is better than a fourth hand-rolled loading flag. `describeEmpty` can never
  // fire for the calendar — getOrCreate guarantees one.
  private readonly calendarRequest = createRequestOutcome<WorkingCalendarDto>(
    () => this.svc.getCalendar().pipe(map((c) => [c])),
    { describeEmpty: () => ({ reason: '', filtered: false }) },
  );

  private readonly historyRequest = createRequestOutcome<WorkingCalendarChangeDto>(
    () => this.svc.getChangeHistory(),
    {
      describeEmpty: () => ({
        reason: this.translate.instant('workingCalendar.neverChanged'),
        filtered: false,
      }),
    },
  );

  readonly calendarOutcome = this.calendarRequest.outcome;
  readonly historyOutcome = this.historyRequest.outcome;

  /**
   * The page's own outcome — composed from the CALENDAR alone, deliberately.
   *
   * `partial` has a real meaning on this page and is still not used, which is
   * worth stating rather than leaving as an apparent omission. The two requests
   * carry different permissions: the calendar needs none, the history needs
   * `org:manage`. So a caller who opens the page with `admin:access` + `org:view`
   * genuinely gets one and is refused the other, and `composePageOutcome` would
   * report `partial` if the history were passed in.
   *
   * It is not, because that would describe the page wrongly. Without the
   * calendar there is no page; without the history there is a complete page with
   * one annotation absent — which is exactly how ACC-101 says a suppressed
   * qualifier behaves, an absence rather than a hatched gap. Marking the whole
   * page partial would tell a Quality Manager something is broken when nothing
   * is.
   *
   * So on this page `partial` is reachable in principle and correct to decline.
   */
  readonly page = computed(() => composePageOutcome([this.calendarOutcome()]));

  readonly calendar = computed(() => {
    const outcome = this.calendarOutcome();
    return outcome.status === 'rows' ? (outcome.data[0] ?? null) : null;
  });

  readonly changes = computed(() => {
    const outcome = this.historyOutcome();
    return outcome.status === 'rows' ? outcome.data : [];
  });

  readonly lastChange = computed(() => this.changes()[0] ?? null);

  readonly calendarProblem = computed(() => {
    const outcome = this.calendarOutcome();
    if (outcome.status === 'denied') return 'workingCalendar.deniedCalendar';
    return 'workingCalendar.loadFailed';
  });

  // ── Section 1: the working week ──────────────────────────────────────────
  readonly weekForm = this.fb.group({ workingDays: [[] as number[]] });
  readonly weekSaving = signal(false);
  readonly weekError = signal<string | null>(null);
  private readonly weekBaseline = signal<number[]>([]);
  private readonly weekTick = signal(0);

  readonly selectedDays = computed(() => {
    this.weekTick();
    return this.weekForm.controls.workingDays.value ?? [];
  });

  readonly noDaysChosen = computed(() => this.selectedDays().length === 0);

  readonly weekDirty = computed(
    () => sameSet(this.selectedDays(), this.weekBaseline()) === false,
  );

  // ── Section 2: hours and time zone ───────────────────────────────────────
  readonly hoursForm = this.fb.group({
    workingHoursStart: ['08:00', Validators.required],
    // ON THE END CONTROL, reading its sibling — not on the group.
    //
    // A group validator that calls setErrors() on a child sets the error and has
    // no clean way to clear it: setErrors() re-validates ancestors, so clearing
    // from inside the group validator risks looping. The first version did set it
    // and never cleared it, so once the end was before the start the error stuck
    // even after the start moved back. Caught by this component's spec.
    //
    // The relationship is still re-checked when the START moves, by the
    // subscription in the constructor.
    workingHoursEnd: ['16:00', [Validators.required, endAfterStart]],
    timezone: ['Asia/Riyadh', Validators.required],
  });
  readonly hoursSaving = signal(false);
  readonly hoursError = signal<string | null>(null);
  private readonly hoursBaseline = signal('');
  private readonly hoursTick = signal(0);

  readonly hoursDirty = computed(() => {
    this.hoursTick();
    return JSON.stringify(this.hoursForm.getRawValue()) !== this.hoursBaseline();
  });

  constructor() {
    // Moving the START has to re-judge the END, which a validator on one control
    // cannot see on its own. This is the half that makes the relationship
    // symmetrical without either control owning the other's error.
    const startSub = this.hoursForm.controls.workingHoursStart.valueChanges.subscribe(() =>
      this.hoursForm.controls.workingHoursEnd.updateValueAndValidity({ emitEvent: false }),
    );

    const sub = this.hoursForm.valueChanges.subscribe(() =>
      this.hoursTick.update((n) => n + 1),
    );
    this.destroyRef.onDestroy(() => {
      startSub.unsubscribe();
      sub.unsubscribe();
      this.calendarRequest.destroy();
      this.historyRequest.destroy();
    });

    // Fill both forms when the calendar lands, and re-baseline so neither reads
    // dirty before anyone has touched it. An effect, not a poll: the outcome is
    // a signal, so there is nothing to wait for on a timer.
    //
    // Re-applies on a RELOAD too, which is wanted — after Retry the forms should
    // show what the server now holds. It does not clobber a user's edit, because
    // the only things that change `calendar()` are the first load, an explicit
    // Retry, and a successful save, all of which should re-baseline.
    effect(() => {
      const cal = this.calendar();
      if (cal) this.applyCalendar(cal);
    });
  }

  private applyCalendar(cal: WorkingCalendarDto): void {
    this.weekForm.controls.workingDays.setValue([...cal.workingDays]);
    this.weekBaseline.set([...cal.workingDays]);
    this.weekTick.update((n) => n + 1);

    this.hoursForm.setValue({
      workingHoursStart: cal.workingHoursStart,
      workingHoursEnd: cal.workingHoursEnd,
      timezone: cal.timezone,
    });
    this.hoursBaseline.set(JSON.stringify(this.hoursForm.getRawValue()));
    this.hoursTick.update((n) => n + 1);
  }

  isDaySelected(day: number): boolean {
    return this.selectedDays().includes(day);
  }

  toggleDay(day: number): void {
    const next = this.isDaySelected(day)
      ? this.selectedDays().filter((d) => d !== day)
      : [...this.selectedDays(), day];
    this.weekForm.controls.workingDays.setValue(next);
    this.weekTick.update((n) => n + 1);
  }

  applyPreset(days: number[]): void {
    this.weekForm.controls.workingDays.setValue([...days]);
    this.weekTick.update((n) => n + 1);
  }

  resetWeek(): void {
    this.weekForm.controls.workingDays.setValue([...this.weekBaseline()]);
    this.weekError.set(null);
    this.weekTick.update((n) => n + 1);
  }

  saveWeek(): void {
    if (this.noDaysChosen() || this.weekSaving()) return;
    this.weekSaving.set(true);
    this.weekError.set(null);
    this.svc.updateCalendar({ workingDays: this.selectedDays() }).subscribe({
      next: (cal) => {
        this.weekSaving.set(false);
        this.applyCalendar(cal);
        // The history now has a new entry, and the header line names it.
        this.historyRequest.retry();
      },
      error: (err: unknown) => {
        this.weekSaving.set(false);
        this.weekError.set(extractErrorMessage(err, 'workingCalendar.saveFailed'));
      },
    });
  }

  resetHours(): void {
    const cal = this.calendar();
    if (cal) this.applyCalendar(cal);
    this.hoursError.set(null);
  }

  saveHours(): void {
    if (this.hoursForm.invalid || this.hoursSaving()) return;
    this.hoursSaving.set(true);
    this.hoursError.set(null);
    // Built field by field rather than passed straight through: getRawValue()
    // types every control as string | null, and the DTO takes string | undefined.
    // Guarded by hoursForm.invalid above, so none of the three can be null here.
    const { workingHoursStart, workingHoursEnd, timezone } = this.hoursForm.getRawValue();
    this.svc
      .updateCalendar({
        workingHoursStart: workingHoursStart ?? undefined,
        workingHoursEnd: workingHoursEnd ?? undefined,
        timezone: timezone ?? undefined,
      })
      .subscribe({
      next: (cal) => {
        this.hoursSaving.set(false);
        this.applyCalendar(cal);
        this.historyRequest.retry();
      },
      error: (err: unknown) => {
        this.hoursSaving.set(false);
        this.hoursError.set(extractErrorMessage(err, 'workingCalendar.saveFailed'));
      },
    });
  }

  reloadCalendar(): void {
    this.calendarRequest.retry();
  }

  // ── The history's rows ───────────────────────────────────────────────────
  fieldsOf(change: WorkingCalendarChangeDto): CalendarFieldChange[] {
    return diffCalendarChange(change.before, change.after);
  }

  /** A change value as text. Day sets are translated here, where a list is. */
  renderValue(value: CalendarFieldChange['from']): string {
    if (value.kind === 'dayKeys') {
      if (value.dayKeys.length === 0) return this.notRecorded();
      // Joined with the language's own list separator, not a hardcoded comma.
      const separator = this.translate.instant('common.listSeparator');
      return value.dayKeys.map((k) => this.translate.instant(k)).join(separator);
    }
    return value.text === '' ? this.notRecorded() : value.text;
  }

  /** What a genuinely absent value reads as — never a blank. */
  notRecorded(): string {
    return this.translate.instant('common.notRecorded');
  }
}

/**
 * The working day must end after it starts.
 *
 * Compares "HH:mm" strings directly, which is correct because they are
 * zero-padded and fixed-width — "08:00" < "16:00" lexically and numerically. No
 * parsing, so no time zone enters a comparison that has nothing to do with one.
 */
function endAfterStart(control: AbstractControl): ValidationErrors | null {
  const end = control.value as string | null;
  const start = control.parent?.get('workingHoursStart')?.value as string | null;
  if (!start || !end) return null;
  return end > start ? null : { endBeforeStart: true };
}

/** Two day sets are the same week whatever order they arrived in. */
function sameSet(a: readonly number[], b: readonly number[]): boolean {
  return [...a].sort().join(',') === [...b].sort().join(',');
}
