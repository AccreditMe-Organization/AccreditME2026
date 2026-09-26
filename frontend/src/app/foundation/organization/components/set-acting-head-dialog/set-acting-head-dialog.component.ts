import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { FormatService } from '../../../../core/formatting';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import {
  IOrgUnitHeadStatus,
  OrgUnitActingReason,
  OrgUnitHeadService,
} from '../../services/org-unit-head.service';

/**
 * Arrange cover — ACC-120 slice 2, section 3 of the head-management design.
 *
 * ## The reason is DERIVED, and that is the point of this dialog
 *
 * `actingReason` is not a control and must never become one. A unit with a
 * head can only need cover because the head is away (ABSENCE, covering for
 * that head); a vacant unit can only need cover because the post is empty
 * (VACANCY, covering for nobody). Offering the choice would let someone record
 * something false — "post is vacant" on a unit that has a head — and the
 * record is what a surveyor reads. So the reason and `coveringForUserId` are
 * computed from the unit's own state, sent with the request, and STATED in the
 * strip at the top rather than asked for.
 *
 * The backend agrees independently: `assignActingHead()` refuses a VACANCY on
 * a unit that has a substantive head, so a hand-built request cannot record
 * the false version either. The dialog is not the only thing holding this.
 *
 * ## Body height — 253px against the 420 cap, so FORM density
 *
 *     strip 52 + 12 + acting head 79 + 12 + range row 58 + 6 + message 34
 *
 * Three blocks' worth, well under the cap and under artboard 13's five-field
 * threshold, so this dialog is deliberately NOT compact. Recorded as
 * arithmetic because the number is a design-time measurement no test can
 * re-derive.
 *
 * THE FIELD BLOCK IS 79, not 75 — Rev 8 of the design system re-measured it.
 * Any sum in an older comment built on 75 is 4px per block short.
 *
 * ## Why the date range is NOT two am-fields
 *
 * The range is ONE control with ONE message: "26 days, the cover ends on its
 * own on 20 Oct 2026", or the open-ended warning. `am-field` is shaped for one
 * field with one message slot, and two fields declaring `message="none"` would
 * each still receive an `aria-describedby` pointing at a slot that does not
 * render — a dangling reference on both inputs, which is worse than the
 * geometry it would have saved. So the row is built here, as a labelled group
 * whose two inputs both describe to the single group message.
 *
 * ## The calendar is `am-inline-calendar` — THE one in the product
 *
 * Not a `p-datepicker` of our own. The first version of this dialog rendered
 * one, copying `public-holiday-form`'s stacked picker layer, and that was
 * wrong twice over:
 *
 * - **It silently dropped most of a calendar.** `InlineCalendarComponent`
 *   exists because artboard 12 needs four things PrimeNG does not give an
 *   inline picker: RTL arrow direction (`case 37` is hard-wired to
 *   `previousElementSibling`), Shift+PageUp/Down by year, a real per-day
 *   announcement, and A TAB STOP ON THE GRID AT ALL — `initFocusableCell()`
 *   runs from the overlay's show path, and inline there is no overlay, so all
 *   42 cells stay `tabIndex -1` and Tab skips the calendar entirely. A local
 *   copy loses every one of those and looks fine while doing it.
 * - **It left the body half empty.** A raw `p-datepicker` panel is
 *   `max-content` wide, so it sat at ~258px in a 488px body. The shared
 *   component sets `inline-size: 100%` on the panel, with a comment recording
 *   the same defect being fixed once before ("it used to be max-content, which
 *   left the calendar at ~226px in a 520px dialog body").
 *
 * And the VIEW is in this body, substituting for the fields, as New Task's
 * does — not a second stacked dialog. The design's fits table budgets it
 * against the 420 cap, which only means anything for a view inside this body.
 *
 * ## No hatching and no minDate here, and both are decisions
 *
 * The shared component hatches nothing by default: `workingDays` and
 * `holidays` are null unless a caller passes them, so the look is identical
 * and the difference is opt-in.
 *
 * New Task passes them because a due date IS working-day aware — the SLA
 * engine computes in working days, so a Friday means something. **A cover
 * period is not.** `validFrom`/`validTo` are calendar dates, and the 90-day
 * condition ages them in calendar days (`now - 90 * 24 * 60 * 60 * 1000` in
 * `setup-condition.detectors.ts`), not working ones. Worse, cover often starts
 * *because* someone is away over a weekend — hatching Friday would imply an
 * unusual choice where it is the normal one. So the hatch is omitted because
 * it would state something false here, not to save work.
 *
 * `minDate` is omitted for the same kind of reason: a cover may legitimately
 * be recorded as having begun last Monday, and the condition ages from
 * `validFrom`, so a backdated start is meaningful rather than a mistake.
 */
@Component({
  selector: 'app-set-acting-head-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    InlineCalendarComponent,
    EditDialogComponent,
    FieldComponent,
    IconButtonComponent,
    OverlaySelectComponent,
  ],
  template: `
    <ng-template #bodyTpl>
      @if (calendarFor(); as which) {
        <!-- THE DATE VIEW — it SUBSTITUTES for the fields in this same body,
             exactly as New Task's does. Same dialog, same footer, every value
             still live; the back link returns. It is not a second stacked
             dialog: the design's own fits table budgets this view against the
             420 cap ("back link 26 + date field 79 + 8 + calendar 258"), which
             only means anything for a view inside THIS body. -->
        <div class="am-cover-dateview">
          <button type="button" class="am-backlink" (click)="closeDateView()">
            <i class="pi pi-arrow-left am-backlink__icon" aria-hidden="true"></i>
            {{ 'orgUnitHead.cover.backToDetails' | translate }}
          </button>

          <am-field
            [label]="
              (which === 'until'
                ? 'orgUnitHead.cover.until'
                : 'orgUnitHead.cover.from'
              ) | translate
            "
            [hint]="'orgUnitHead.cover.dateTypeHint' | translate"
          >
            <input
              pInputText
              dir="ltr"
              [id]="dateViewInputId"
              [value]="which === 'until' ? untilText() : fromText()"
              (input)="onTyped(which, $any($event.target).value)"
              (blur)="commitTyped(which)"
              autocomplete="off"
            />
          </am-field>

          <!-- THE ONE CALENDAR IN THE PRODUCT (ACC-96, artboard 12) — the same
               component New Task renders, not a p-datepicker of our own. See
               this class's header for what a local one silently loses. -->
          <am-inline-calendar
            [value]="which === 'until' ? validTo() : validFrom()"
            (valueChange)="onPicked($event)"
          />
        </div>
      } @else {
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col">
        <!-- The strip: a read-only relation stating what the dialog derived,
             so the user sees the record it is about to write. -->
        <div class="am-cover-strip">
          <span class="am-cover-strip__label">{{ stripLabel() | translate }}</span>
          <span class="am-cover-strip__body">
            <span class="am-cover-strip__value">{{ stripValue() }}</span>
            <span class="am-cover-strip__meta">{{ stripMeta() | translate }}</span>
          </span>
        </div>

        <am-field
          class="am-cover-person"
          [label]="'orgUnitHead.cover.actingHead' | translate"
          [control]="form.controls.userId"
          [forceShowErrors]="showErrors()"
          [hint]="personHint()"
        >
          <app-overlay-select
            formControlName="userId"
            [options]="people()"
            optionLabel="name"
            optionValue="id"
            [placeholder]="'orgUnitHead.cover.actingHeadPlaceholder' | translate"
          />
        </am-field>

        <!-- The range. "From" sits at the inline start, so its position is set
             by dir and never by left or right; each date is isolated LTR so
             "25 Sep 2026" stays whole in an RTL line. No arrow between them —
             an arrow would have to mirror, and a label cannot point the wrong
             way. Tab order is From then Until, which is reading order in both
             directions. -->
        <div
          class="am-cover-range"
          role="group"
          [attr.aria-label]="'orgUnitHead.cover.rangeGroup' | translate"
        >
          <div class="am-cover-range__col">
            <label class="am-cover-range__label" [attr.for]="fromId">
              {{ 'orgUnitHead.cover.from' | translate }}
            </label>
            <div class="am-cover-range__control">
              <input
                pInputText
                dir="ltr"
                [id]="fromId"
                [attr.aria-describedby]="messageId"
                [value]="fromText()"
                (input)="onTyped('from', $any($event.target).value)"
                (blur)="commitTyped('from')"
                autocomplete="off"
              />
              <am-icon-button
                [label]="'orgUnitHead.cover.showCalendarFrom' | translate"
                icon="pi pi-calendar"
                (activated)="openCalendar('from')"
              />
            </div>
          </div>

          <div class="am-cover-range__col">
            <label class="am-cover-range__label" [attr.for]="untilId">
              {{ 'orgUnitHead.cover.until' | translate }}
              <span class="am-cover-range__hint">· {{ untilHint() | translate }}</span>
            </label>
            <div class="am-cover-range__control">
              <input
                pInputText
                dir="ltr"
                [id]="untilId"
                [attr.aria-describedby]="messageId"
                [value]="untilText()"
                (input)="onTyped('until', $any($event.target).value)"
                (blur)="commitTyped('until')"
                autocomplete="off"
              />
              <am-icon-button
                [label]="'orgUnitHead.cover.showCalendarUntil' | translate"
                icon="pi pi-calendar"
                (activated)="openCalendar('until')"
              />
            </div>
          </div>
        </div>

        <!-- ONE message for the range, and it always says what the cover will
             DO — never only what is wrong with it. That is what makes the open
             end visible at the moment it is chosen, rather than 90 days later
             on Setup health. -->
        <p
          class="am-cover-message"
          [class.am-cover-message--warn]="messageSeverity() === 'warn'"
          [class.am-cover-message--error]="messageSeverity() === 'error'"
          [id]="messageId"
          [attr.role]="messageSeverity() === 'error' ? 'alert' : null"
        >
          <span class="am-cover-message__glyph" aria-hidden="true">{{ messageGlyph() }}</span>
          <span>{{ messageKey() | translate: messageParams() }}</span>
        </p>

        @if (saveError()) {
          <p class="text-meta text-[var(--am-danger-ink)] mt-2">{{ saveError()! | translate }}</p>
        }
      </form>
      }
    </ng-template>

    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="saving()"
          (onClick)="dialog.requestClose()"
        />
        <p-button
          type="button"
          [label]="ctaKey() | translate: ctaParams()"
          [loading]="saving()"
          [disabled]="!canSave()"
          (onClick)="submit()"
        />
      </div>
    </ng-template>

    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'orgUnitHead.cover.title' | translate: { unit: unitName() }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="dirty()"
      [saving]="saving()"
      size="form"
    />

  `,
  styles: [
    `
      /* THE DATE VIEW — 8px gaps, not the form's 12, because the design's own
         fits table budgets it that way: back link 26 + date field 79 + 8 +
         calendar 258 = 371 against the 420 cap. With the 8px under the back
         link that this rule adds it measures 379, still 41px clear; the design
         does not count that one, and 379 is stated rather than rounded to its
         figure. The calendar is 258 and fills the body's width, because
         am-inline-calendar sets inline-size 100% — which is the whole reason a
         local p-datepicker left ~160px of the body empty. */
      .am-cover-dateview {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* DUPLICATED FROM task-form, deliberately and with the duplication
         named. These twelve lines are the second copy in the app; the third is
         where they should become a shared am-back-link. Extracting now would
         edit New Task's template, which this PR's scope excludes — and the
         thing whose divergence actually costs behaviour, the calendar, IS
         shared. If you move these, move both copies in one change and keep the
         RTL mirror: an arrow that does not flip points the wrong way in Arabic. */
      .am-backlink {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        align-self: flex-start;
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        font-size: 12.5px;
        color: var(--am-primary-600);
        cursor: pointer;
      }
      :dir(rtl) .am-backlink__icon {
        transform: scaleX(-1);
      }
      .am-backlink:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }

      /* Geometry from the head-management design's own measurement table.
         Sizes are explicit because the body sum (253) is only true if they
         are — a block inheriting a different line-height silently moves it. */
      .am-cover-strip {
        display: flex;
        gap: var(--am-space-8);
        align-items: flex-start;
        padding: 8px 0;
        border-block: 1px solid var(--am-border);
      }
      .am-cover-strip__label {
        flex: none;
        font-size: 11px;
        line-height: 18px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--am-ink-500);
      }
      .am-cover-strip__body {
        flex: 1 1 auto;
        min-width: 0;
      }
      .am-cover-strip__value {
        display: block;
        font-size: 13px;
        line-height: 18px;
        font-weight: 500;
        color: var(--am-ink-900);
      }
      /* Clamped to one line: the design leaves 16px of headroom in Arabic, so a
         second line is affordable but not guaranteed. The full text lives on
         the record this names. */
      .am-cover-strip__meta {
        display: block;
        font-size: 11.5px;
        line-height: 16px;
        color: var(--am-ink-500);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .am-cover-person {
        display: block;
        margin-block-start: 12px;
      }

      .am-cover-range {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-block-start: 12px;
      }
      /* min-width 0, NOT a 120px floor. A floor here plus an input that
         cannot shrink is what put the body 104px over its 488px in English and
         108px over in Arabic, scrolling every label mid-sentence. */
      .am-cover-range__col {
        flex: 1 1 130px;
        min-width: 0;
      }
      .am-cover-range__label {
        display: block;
        font-size: var(--am-type-meta-size);
        line-height: 18px;
        font-weight: 500;
        color: var(--am-ink-500);
        margin-block-end: 4px;
      }
      .am-cover-range__hint {
        font-weight: 400;
      }
      .am-cover-range__control {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        min-height: 36px;
      }
      /* THE FIX, and the reason it is not obvious: an <input> carries an
         intrinsic width from its size attribute (default 20 characters), and a
         flex item's automatic minimum size (min-width: auto) refuses to go
         below it. So flex: 1 1 0% does NOT make an input shrinkable — a
         flex-basis of 0 is overridden by that minimum. Only min-width: 0
         releases it. Measured, not reasoned about: the layout spec beside this
         file pins the body against horizontal overflow in both directions. */
      .am-cover-range__control input {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* 34px = two lines at 17. Reserved at that height whatever the copy, so
         switching between the ended and open-ended messages never moves the
         footer under a cursor already travelling to it. */
      .am-cover-message {
        display: flex;
        gap: 7px;
        align-items: flex-start;
        margin: 6px 0 0;
        min-height: 34px;
        font-size: 11.5px;
        line-height: 17px;
        color: var(--am-ink-500);
        text-wrap: pretty;
      }
      .am-cover-message__glyph {
        flex: none;
        font-weight: 700;
      }
      .am-cover-message--warn {
        color: var(--am-warning-ink);
      }
      .am-cover-message--error {
        color: var(--am-danger-ink);
        font-weight: 500;
      }
    `,
  ],
})
export class SetActingHeadDialogComponent {
  /**
   * How long an open-ended cover runs before Setup health reports it. MUST
   * match OPEN_ENDED_ACTING_DAYS in the backend's setup-condition detectors:
   * this dialog names the exact date the condition will fire, and a date the
   * condition does not honour is worse than no date at all.
   */
  static readonly OPEN_ENDED_ACTING_DAYS = 90;

  readonly orgUnitId = input.required<string>();
  readonly unitName = input.required<string>();
  readonly status = input.required<IOrgUnitHeadStatus>();
  readonly people = input.required<{ id: string; name: string; email?: string }[]>();
  readonly visible = input.required<boolean>();

  readonly visibleChange = output<boolean>();
  readonly saved = output<void>();

  private readonly fb = inject(FormBuilder);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly headService = inject(OrgUnitHeadService);
  private readonly layers = inject(LayerStackService);
  private readonly destroyRef = inject(DestroyRef);

  private static nextId = 0;
  private readonly uid = `am-cover-${SetActingHeadDialogComponent.nextId++}`;
  protected readonly fromId = `${this.uid}-from`;
  protected readonly untilId = `${this.uid}-until`;
  protected readonly messageId = `${this.uid}-message`;
  protected readonly dateViewInputId = `${this.uid}-dateview`;

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly showErrors = signal(false);

  private dateViewLayerId: number | null = null;

  constructor() {
    // Clear on the open -> closed transition, so a discard genuinely discards
    // and the next open starts from today. Not on open: resetting then would
    // leave abandoned state readable by anything that inspects the component
    // while it is shut, and would fight a save's own reset.
    let wasVisible = false;
    effect(() => {
      const visible = this.visible();
      if (wasVisible && !visible) this.reset();
      wasVisible = visible;
    });

    // ── THE DATE VIEW IS A LAYER, even though nothing floats ──────────────
    //
    // Artboard 12's Escape ladder, copied from task-form because it IS the
    // behaviour and not merely a convention: the first press collapses the
    // calendar and leaves the dialog open, "otherwise a user who opened it to
    // look at next month loses the whole form to a single key".
    //
    // Checked in New Task before writing this, rather than assumed. An earlier
    // version of this dialog let Escape close the whole dialog and claimed that
    // matched New Task. It did not — New Task returns to the form — and the
    // claim was wrong on exactly the axis it cited.
    effect(() => {
      const open = this.calendarFor() !== null;
      if (open && this.dateViewLayerId === null) {
        this.dateViewLayerId = this.layers.push();
      } else if (!open && this.dateViewLayerId !== null) {
        this.layers.remove(this.dateViewLayerId);
        this.dateViewLayerId = null;
      }
    });

    // BUBBLE phase, not capture. EditDialogComponent listens in capture and
    // returns early once it sees it is not on top, so by the time this runs the
    // dialog has already declined. Listening in capture here would race it, and
    // a dirty form would go straight to "Discard changes?" with the calendar
    // still open.
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || this.calendarFor() === null) return;
      if (this.dateViewLayerId === null || !this.layers.isTop(this.dateViewLayerId)) return;
      event.preventDefault();
      event.stopPropagation();
      this.closeDateView();
    };
    document.addEventListener('keydown', onKeydown);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('keydown', onKeydown);
      if (this.dateViewLayerId !== null) this.layers.remove(this.dateViewLayerId);
    });
  }

  readonly form = this.fb.group({
    userId: [null as string | null, [Validators.required]],
  });

  // Today, so a cover arranged now starts now. The design pre-fills From for
  // the same reason: a start date nobody chose is still a fact the record needs.
  readonly validFrom = signal<Date | null>(startOfToday());
  readonly validTo = signal<Date | null>(null);

  /**
   * The start date this opening BEGAN with, so `dirty` can tell "still today"
   * from "the user moved it". Re-stamped on every open rather than fixed at
   * construction: the component is never destroyed, so a session left open
   * overnight would otherwise compare against yesterday.
   */
  private readonly openedWithFrom = signal(startOfToday().getTime());

  private readonly typedFrom = signal<string | null>(null);
  private readonly typedUntil = signal<string | null>(null);

  readonly fromText = computed(
    () => this.typedFrom() ?? this.format.dateForInput(this.validFrom()),
  );
  readonly untilText = computed(
    () => this.typedUntil() ?? this.format.dateForInput(this.validTo()),
  );

  // ── Derived from the unit, never asked ──────────────────────────────────
  readonly actingReason = computed<OrgUnitActingReason>(() =>
    this.status().holders.length === 0 ? 'VACANCY' : 'ABSENCE',
  );

  readonly coveredHead = computed(() => this.status().holders[0] ?? null);

  readonly stripLabel = computed(() =>
    this.actingReason() === 'ABSENCE'
      ? 'orgUnitHead.cover.stripCoversFor'
      : 'orgUnitHead.cover.stripPost',
  );

  readonly stripValue = computed(() => {
    if (this.actingReason() === 'ABSENCE') return this.coveredHead()?.name ?? '';
    // NOT "vacant since <date>". OrgUnitHeadEvent only covers units that have
    // had an event since ACC-40, so there is no true "since" for most units,
    // and the design is explicit that a fallback states what is NOT recorded
    // rather than inventing a date.
    return this.translate.instant('orgUnitHead.cover.stripVacant');
  });

  readonly stripMeta = computed(() =>
    this.actingReason() === 'ABSENCE'
      ? 'orgUnitHead.cover.stripHeadAway'
      : 'orgUnitHead.cover.stripNobodyCovered',
  );

  readonly personHint = computed(() => {
    const id = this.form.controls.userId.value;
    const person = this.people().find((p) => p.id === id);
    // The design's meta line is "position · unit". The user LIST endpoint
    // returns neither name — only positionId, and `references` comes back
    // solely from GET /users/:id — so the email stands in: it is real, it is
    // present, and it does the same job of telling two people with one name
    // apart. Stated rather than fabricated, per the design's own rule.
    return person?.email ?? this.translate.instant('orgUnitHead.cover.actingHeadHint');
  });

  readonly untilHint = computed(() =>
    this.actingReason() === 'ABSENCE'
      ? 'orgUnitHead.cover.untilHintReturn'
      : 'orgUnitHead.cover.untilHintOptional',
  );

  // ── The group message ───────────────────────────────────────────────────
  /** The day ACTING_HEAD_OPEN_ENDED fires, if no end date is set. */
  readonly flagDate = computed(() => {
    const from = this.validFrom();
    if (!from) return null;
    const d = new Date(from);
    d.setDate(d.getDate() + SetActingHeadDialogComponent.OPEN_ENDED_ACTING_DAYS);
    return d;
  });

  readonly rangeInvalid = computed(() => {
    const from = this.validFrom();
    const to = this.validTo();
    return !!from && !!to && to.getTime() <= from.getTime();
  });

  readonly messageSeverity = computed<'info' | 'warn' | 'error'>(() => {
    if (this.rangeInvalid()) return 'error';
    if (this.validTo()) return 'info';
    return this.actingReason() === 'ABSENCE' ? 'warn' : 'info';
  });

  readonly messageGlyph = computed(() => (this.messageSeverity() === 'info' ? 'ⓘ' : '!'));

  readonly messageKey = computed(() => {
    if (this.rangeInvalid()) return 'orgUnitHead.cover.messageRangeInvalid';
    if (this.validTo()) return 'orgUnitHead.cover.messageEnds';
    return this.actingReason() === 'ABSENCE'
      ? 'orgUnitHead.cover.messageOpenAbsence'
      : 'orgUnitHead.cover.messageOpenVacancy';
  });

  readonly messageParams = computed(() => ({
    unit: this.unitName(),
    date: this.format.date(this.validTo() ?? this.flagDate()),
    // NAMED `duration`, not `days`, and the name is load-bearing. It holds a
    // whole formatted phrase — "26 days" — produced by the layer's duration
    // format, which pluralises by construction in both languages. A
    // placeholder called `days` would say it holds the number 26, which is the
    // shape ACC-94 forbids outside the translations' own plural section, and
    // translation-keys.spec.ts matches exactly that name. Renaming is the fix;
    // an exception entry would have been a false claim.
    duration: this.format.duration(this.coverLengthMs()),
  }));

  private coverLengthMs(): number | null {
    const from = this.validFrom();
    const to = this.validTo();
    if (!from || !to) return null;
    return to.getTime() - from.getTime();
  }

  // ── The button says what it will do ─────────────────────────────────────
  readonly ctaKey = computed(() =>
    this.validTo() ? 'orgUnitHead.cover.ctaUntil' : 'orgUnitHead.cover.ctaOpen',
  );
  readonly ctaParams = computed(() => ({ date: this.format.date(this.validTo()) }));

  /**
   * A SIGNAL of the chosen person, not `form.controls.userId.value`.
   *
   * `dirty` below is a computed bound to the dialog's unsaved-work guard, and
   * `AbstractControl.dirty` / `.value` are plain properties, not signals — a
   * computed reading one never re-evaluates. It would have read false forever,
   * so Escape would have thrown away a chosen person WITHOUT ASKING, which is
   * the one thing that guard exists to prevent. Caught by the spec below, not
   * by review.
   */
  private readonly chosenUserId = toSignal(this.form.controls.userId.valueChanges, {
    initialValue: null as string | null,
  });

  /**
   * Unsaved work is ANY of four things, and three of them live outside the
   * form. Ahmad's browser pass found only `validTo` was counted: changing the
   * START date and pressing Escape closed silently, discarding it without
   * asking. The fix is to enumerate the state rather than to trust the form,
   * because the dates deliberately are not form controls.
   *
   * A part-typed date counts too. Escape does not blur first, so
   * `commitTyped()` never runs — without this, a half-written date is thrown
   * away with no prompt.
   */
  readonly dirty = computed(
    () =>
      this.chosenUserId() !== null ||
      this.validTo() !== null ||
      this.validFrom()?.getTime() !== this.openedWithFrom() ||
      this.typedFrom() !== null ||
      this.typedUntil() !== null,
  );

  canSave(): boolean {
    return this.form.valid && !this.rangeInvalid() && !!this.validFrom() && !this.saving();
  }

  submit(): void {
    this.showErrors.set(true);
    if (!this.canSave()) return;

    const coveringForUserId =
      this.actingReason() === 'ABSENCE' ? (this.coveredHead()?.id ?? undefined) : undefined;

    this.saving.set(true);
    this.saveError.set(null);
    this.headService
      .assignActingHead(this.orgUnitId(), {
        userId: this.form.controls.userId.value!,
        actingReason: this.actingReason(),
        validFrom: this.validFrom()!.toISOString(),
        validTo: this.validTo()?.toISOString(),
        coveringForUserId,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.reset();
          this.saved.emit();
          this.visibleChange.emit(false);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.saveError.set(extractErrorMessage(err, 'orgUnitHead.errorSave'));
        },
      });
  }

  /**
   * Called on every close, not only after a save.
   *
   * The dialog component is never destroyed — `EditDialogComponent` re-attaches
   * the TEMPLATE through ngTemplateOutlet (ACC-29), so the signals holding the
   * dates outlive the dialog being shut. Ahmad's browser pass found the
   * consequence: set From to 30 Sep, discard, reopen, and it still read 30 Sep.
   * That is worse than untidy — a user who believes they abandoned a date can
   * reopen and submit it.
   */
  private reset(): void {
    const today = startOfToday();
    this.form.reset();
    this.validFrom.set(today);
    this.openedWithFrom.set(today.getTime());
    this.validTo.set(null);
    this.typedFrom.set(null);
    this.typedUntil.set(null);
    this.showErrors.set(false);
    this.saveError.set(null);
    this.calendarFor.set(null);
  }

  // ── The date view ───────────────────────────────────────────────────────
  /**
   * Which end of the range the date view is editing, or null for the fields.
   * Doubles as the view switch, so the calendar cannot be open for two dates.
   */
  readonly calendarFor = signal<'from' | 'until' | null>(null);

  openCalendar(which: 'from' | 'until'): void {
    this.calendarFor.set(which);
  }

  /** Returns to the fields and puts focus back on the date that was edited. */
  closeDateView(): void {
    const which = this.calendarFor();
    this.calendarFor.set(null);
    this.focusBack(which);
  }

  /**
   * STAYS IN THE DATE VIEW, matching New Task: picking a day is not the same
   * act as finishing with the field, and a grid that closes under the cursor
   * makes correcting a mis-click a second navigation.
   */
  onPicked(value: Date | null): void {
    const which = this.calendarFor();
    if (which === 'until') {
      this.validTo.set(value);
      this.typedUntil.set(null);
    } else {
      this.validFrom.set(value);
      this.typedFrom.set(null);
    }
    this.form.markAsDirty();
  }

  onTyped(which: 'from' | 'until', value: string): void {
    (which === 'until' ? this.typedUntil : this.typedFrom).set(value);
  }

  /** On BLUR, not per keystroke — "15 S" is not an error, it is unfinished. */
  commitTyped(which: 'from' | 'until'): void {
    const typed = which === 'until' ? this.typedUntil : this.typedFrom;
    const target = which === 'until' ? this.validTo : this.validFrom;
    const text = typed();
    if (text === null) return;

    const trimmed = text.trim();
    if (trimmed === '') {
      target.set(null);
      typed.set(null);
      this.form.markAsDirty();
      return;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      // Left as typed rather than silently discarded: the group message says
      // what is wrong, and the user's own text is still there to correct.
      return;
    }
    target.set(parsed);
    typed.set(null);
    this.form.markAsDirty();
  }

  private focusBack(which: 'from' | 'until' | null): void {
    if (!which) return;
    setTimeout(() => {
      document.getElementById(which === 'until' ? this.untilId : this.fromId)?.focus();
    });
  }
}

/** Midnight local, so a same-day comparison is not decided by the clock. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
