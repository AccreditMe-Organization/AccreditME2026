import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { withArabicLam } from '../../../../shared/utils/arabic-prefix.util';
import { IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { IOrgUnitHeadStatus, OrgUnitHeadService } from '../../services/org-unit-head.service';
import { HeadshipPerson, personMeta } from '../appoint-head-dialog/appoint-head-dialog.component';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SUCCESSOR_NOTE_MAX = 500;

/**
 * ACC-133 — Appoint successor, dialog C (the occupied unit). Calls
 * `POST /handover`. The word "handover" appears nowhere on screen.
 *
 * HEAD ACCESS STARTS WHEN THIS IS SAVED, NOT ON THE DATE CHOSEN.
 * `declareHandover()` grants the successor the head position at once, and the
 * date gates only the sweep that later clears the outgoing head. There is no
 * maximum window (Ahmad, 25 Sep), so a successor appointed today "from 1 March"
 * is head today. The interface is the only safeguard, so it says so in three
 * places nobody can miss: the line under the title, the button ("Give head
 * access now", never "Appoint from 1 Oct"), and the date's label ("Sole head
 * from"). DO NOT SOFTEN ANY OF THEM.
 *
 * NO POSITION FIELD (Ahmad, CC-127b). `DeclareHandoverDto` takes no position:
 * the successor receives the outgoing head's (`declareHandover()`), so a
 * position control would offer a choice the server ignores. The drawing showed
 * a read-only Position block instead; it was removed because the dialog did
 * not fit with it, and the Replaces strip already names the position
 * ("Director · since 3 Mar 2024 · until …").
 *
 * COMPACT, DECLARED EXPLICITLY AND PERMANENTLY. The drawing sized this body at
 * 421px at standard density, 1px over the 420 cap, with four field blocks, so
 * the five-or-more limb of the density rule never fires and only this
 * declaration keeps it compact. Measured as built (CC-127b,
 * headship-dialogs.layout.spec.ts, the long real position name in the strip):
 * WITH the Position block, compact, 434 / 454 (EN / AR) at 1280 and up to
 * 472 / 495 at 390, over the cap, because am-field's compact fields measure 79
 * where artboard 13 draws 71 (ACC-251). WITHOUT it, as now, it fits; the
 * numbers are in that spec's output. Do not remove `density="compact"` because
 * the dialog "looks like it fits": it is the margin.
 */
@Component({
  selector: 'am-appoint-successor-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    EditDialogComponent,
    FieldComponent,
    IconButtonComponent,
    InlineCalendarComponent,
    OverlaySelectComponent,
  ],
  template: `
    <ng-template #warnTpl>
      <p class="am-asd__warn" data-testid="successor-access-warning">
        <span aria-hidden="true">▲</span> {{ 'headship.successor.accessWarning' | translate }}
      </p>
    </ng-template>

    <ng-template #bodyTpl>
      @if (calendarOpen()) {
        <div class="am-asd__dateview">
          <button type="button" class="am-asd__back" (click)="closeDateView()">
            <i class="pi pi-arrow-left" aria-hidden="true"></i>
            {{ 'headship.successor.backToDetails' | translate }}
          </button>
          <am-field [label]="'headship.successor.soleFrom' | translate" [hint]="'headship.successor.dateTypeHint' | translate">
            <input
              pInputText
              dir="ltr"
              [id]="dateViewInputId"
              [value]="dateText()"
              (input)="onTyped($any($event.target).value)"
              (blur)="commitTyped()"
              autocomplete="off"
            />
          </am-field>
          <am-inline-calendar [value]="effectiveDate()" [minDate]="todayStart" (valueChange)="onPicked($event)" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="am-asd" novalidate>
          <!-- A read-only relation, not a field block. -->
          <div class="am-asd__strip" data-testid="successor-replaces">
            <span class="am-asd__strip-label">{{ 'headship.successor.replaces' | translate }}</span>
            <span class="am-asd__strip-body">
              <span class="am-asd__strip-value">{{ outgoingName() }}</span>
              <span class="am-asd__strip-meta">{{ replacesMeta() }}</span>
            </span>
          </div>

          <am-field
            [label]="'headship.successor.nextHead' | translate"
            [control]="form.controls.incomingUserId"
            inputId="am-asd-person"
            [hint]="personHint()"
            [forceShowErrors]="showErrors()"
          >
            <app-overlay-select
              formControlName="incomingUserId"
              [options]="personOptions()"
              optionLabel="label"
              optionValue="value"
              [itemTemplate]="personItem"
              [ariaLabel]="'headship.successor.nextHead' | translate"
              [placeholder]="(personOptions().length ? 'headship.appoint.personPlaceholder' : 'headship.appoint.nobody') | translate"
            />
          </am-field>

          <am-field
            [label]="'headship.successor.soleFrom' | translate"
            [control]="form.controls.effectiveDate"
            [inputId]="dateInputId"
            [hint]="dateHint()"
            [forceShowErrors]="showErrors()"
            [errorMessages]="{ required: 'headship.successor.dateRequired', min: 'headship.successor.datePast' }"
          >
            <div class="am-asd__date">
              <input
                pInputText
                dir="ltr"
                class="w-full"
                [id]="dateInputId"
                [value]="dateText()"
                (input)="onTyped($any($event.target).value)"
                (blur)="commitTyped()"
                autocomplete="off"
              />
              <am-icon-button
                [label]="'headship.successor.showCalendar' | translate"
                icon="pi pi-calendar"
                (activated)="calendarOpen.set(true)"
              />
            </div>
          </am-field>

          <am-field
            [label]="'headship.successor.note' | translate"
            [control]="form.controls.reason"
            inputId="am-asd-note"
            [counter]="{ value: noteLength(), max: noteMax }"
            [forceShowErrors]="showErrors()"
          >
            <textarea
              pTextarea
              id="am-asd-note"
              class="w-full am-asd__note"
              formControlName="reason"
              rows="2"
              [placeholder]="'headship.successor.notePlaceholder' | translate"
            ></textarea>
          </am-field>

          @if (saveError()) {
            <p class="am-asd__error" role="alert" data-testid="appoint-successor-error">{{ saveError() }}</p>
          }
        </form>
      }
    </ng-template>

    <ng-template #footerTpl>
      <div class="flex justify-end gap-2">
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
          data-testid="appoint-successor-submit"
          [label]="'headship.successor.submit' | translate"
          [loading]="saving()"
          [disabled]="saving()"
          (onClick)="submit()"
        />
      </div>
    </ng-template>

    <!-- density="compact": see the class comment — 421 at standard. -->
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'headship.successor.title' | translate: unitParams()"
      [headerExtra]="warnTpl"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="dirty()"
      [saving]="saving()"
      size="form"
      density="compact"
    />

    <!-- ACC-172 — a person and, beneath, their position (or their email when
         they hold none): two people with one name are told apart. Both lines
         truncate, so a long position name cannot widen the dialog. -->
    <ng-template #personItem let-option>
      <span class="flex min-w-0 flex-col">
        <span class="truncate">{{ option.label ?? option.name }}</span>
        @if (option.meta) {
          <span class="truncate text-meta text-[var(--am-ink-500)]" data-person-meta>{{ option.meta }}</span>
        }
      </span>
    </ng-template>
  `,
  styles: [
    `
      .am-asd {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
      }
      .am-asd__warn {
        margin: var(--am-space-4) 0 0;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        font-weight: 600;
        color: var(--am-warning-ink);
      }
      .am-asd__strip {
        display: flex;
        gap: var(--am-space-12);
        padding: var(--am-space-8) var(--am-space-12);
        border-radius: var(--am-radius-control);
        background: var(--am-surface);
      }
      .am-asd__strip-label {
        flex: none;
        min-inline-size: calc(var(--am-space-40) + var(--am-space-32));
        font-size: var(--am-type-micro-size);
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--am-ink-500);
      }
      .am-asd__strip-body {
        display: flex;
        flex-direction: column;
        min-inline-size: 0;
      }
      .am-asd__strip-value {
        font-size: var(--am-type-value-size);
        font-weight: 500;
        color: var(--am-primary-700);
      }
      .am-asd__strip-meta {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
      }
      .am-asd__date {
        display: flex;
        gap: var(--am-space-4);
        align-items: center;
      }
      .am-asd__note {
        resize: vertical;
      }
      .am-asd__dateview {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
      }
      .am-asd__back {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: var(--am-space-4);
        border: none;
        background: none;
        padding: 0;
        color: var(--am-primary-700);
        font: inherit;
        cursor: pointer;
      }
      :host-context([dir='rtl']) .am-asd__back .pi-arrow-left {
        transform: scaleX(-1);
      }
      .am-asd__error {
        margin: 0;
        font-size: var(--am-type-body-size);
        color: var(--am-danger-ink);
      }
    `,
  ],
})
export class AppointSuccessorDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly headService = inject(OrgUnitHeadService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly layers = inject(LayerStackService);
  private readonly destroyRef = inject(DestroyRef);

  private static nextId = 0;
  private readonly uid = `am-asd-${AppointSuccessorDialogComponent.nextId++}`;
  protected readonly dateInputId = `${this.uid}-date`;
  protected readonly dateViewInputId = `${this.uid}-dateview`;
  protected readonly noteMax = SUCCESSOR_NOTE_MAX;

  readonly orgUnitId = input.required<string>();
  readonly unitName = input.required<string>();
  readonly status = input.required<IOrgUnitHeadStatus>();
  readonly people = input.required<HeadshipPerson[]>();
  /** The organisation's active head-conferring positions; null while loading. */
  readonly positions = input<IOrgPositionDto[] | null>(null);
  readonly visible = input.required<boolean>();
  readonly visibleChange = output<boolean>();
  readonly saved = output<void>();

  /** Both forms of the unit's name: Arabic attaches ل and elides ال (withArabicLam). */
  readonly unitParams = computed(() => ({ unit: this.unitName(), unitWithLam: withArabicLam(this.unitName()) }));

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly calendarOpen = signal(false);
  private readonly typed = signal<string | null>(null);
  readonly todayStart = startOfToday();

  readonly form = this.fb.group({
    incomingUserId: [null as string | null, Validators.required],
    effectiveDate: [null as Date | null, [Validators.required, notBefore(startOfToday)]],
    reason: ['', Validators.maxLength(SUCCESSOR_NOTE_MAX)],
  });

  private readonly incomingValue = toSignal(this.form.controls.incomingUserId.valueChanges, { initialValue: null });
  private readonly dateValue = toSignal(this.form.controls.effectiveDate.valueChanges, { initialValue: null });
  private readonly reasonValue = toSignal(this.form.controls.reason.valueChanges, { initialValue: '' });

  readonly effectiveDate = computed(() => this.dateValue() ?? null);
  readonly noteLength = computed(() => (this.reasonValue() ?? '').length);

  /** The head being replaced: the holder who is not a pending successor. */
  readonly outgoing = computed(() => {
    const s = this.status();
    return s.holders.find((h) => h.id !== s.pendingHeadUserId) ?? null;
  });

  readonly outgoingName = computed(
    () => this.outgoing()?.name ?? this.translate.instant('headship.head.assigned'),
  );
  private readonly outgoingInSentence = computed(
    () => this.outgoing()?.name ?? this.translate.instant('headship.confirm.theCurrentHead'),
  );

  readonly positionName = computed(() => {
    const o = this.outgoing();
    return o?.positionNameEn ? this.language.bilingual(o.positionNameEn, o.positionNameAr) : '—';
  });

  /** The outgoing head's last day with access: the day before the chosen date. */
  private readonly lastDay = computed(() => {
    const d = this.effectiveDate();
    return d ? new Date(d.getTime() - DAY_MS) : null;
  });

  readonly replacesMeta = computed(() => {
    const parts: string[] = [];
    if (this.positionName() !== '—') parts.push(this.positionName());
    const since = this.outgoing()?.headSince;
    parts.push(
      since
        ? this.translate.instant('headship.successor.since', { date: this.format.date(since) })
        : this.translate.instant('headship.successor.sinceUnknown'),
    );
    const last = this.lastDay();
    if (last) parts.push(this.translate.instant('headship.successor.until', { date: this.format.date(last) }));
    return parts.join(' · ');
  });

  /**
   * Who can be appointed: an active person of this unit who is not the current
   * head and does not already hold a head-conferring position (both refused by
   * `declareHandover()`).
   */
  readonly personOptions = computed(() => {
    const outgoingId = this.outgoing()?.id;
    const headPositionIds = new Set((this.positions() ?? []).map((p) => p.id));
    return this.people()
      .filter((p) => p.id !== outgoingId && !(p.positionId && headPositionIds.has(p.positionId)))
      .map((p) => ({ label: p.name, value: p.id, meta: this.meta(p) }));
  });

  /** ACC-172 — the chosen person's position, else their email. */
  readonly personHint = computed(() => {
    const id = this.incomingValue();
    const person = this.people().find((p) => p.id === id);
    return person ? this.meta(person) : '';
  });

  private meta(person: HeadshipPerson): string {
    return personMeta(person, (en, ar) => this.language.bilingual(en, ar));
  }

  readonly dateHint = computed(() => {
    const last = this.lastDay();
    return last
      ? this.translate.instant('headship.successor.dateHintChosen', {
          name: this.outgoingInSentence(),
          date: this.format.date(last),
        })
      : this.translate.instant('headship.successor.dateHint');
  });

  readonly dateText = computed(() => this.typed() ?? this.format.dateForInput(this.effectiveDate()));

  /** A chosen person, a picked or typed date, or a note: Escape must ask. */
  readonly dirty = computed(
    () =>
      this.incomingValue() !== null ||
      this.effectiveDate() !== null ||
      this.typed() !== null ||
      (this.reasonValue() ?? '').length > 0,
  );

  private dateViewLayerId: number | null = null;

  constructor() {
    effect(() => {
      if (this.visible()) untracked(() => this.reset());
    });

    // The date view is a layer: the first Escape returns to the fields, as in
    // Arrange cover and New Task, rather than asking to discard the dialog.
    effect(() => {
      const open = this.calendarOpen();
      if (open && this.dateViewLayerId === null) {
        this.dateViewLayerId = this.layers.push();
      } else if (!open && this.dateViewLayerId !== null) {
        this.layers.remove(this.dateViewLayerId);
        this.dateViewLayerId = null;
      }
    });
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.calendarOpen()) return;
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

  private reset(): void {
    this.form.reset({ incomingUserId: null, effectiveDate: null, reason: '' });
    this.typed.set(null);
    this.calendarOpen.set(false);
    this.showErrors.set(false);
    this.saveError.set(null);
  }

  closeDateView(): void {
    this.calendarOpen.set(false);
    setTimeout(() => document.getElementById(this.dateInputId)?.focus());
  }

  onPicked(value: Date | null): void {
    this.form.controls.effectiveDate.setValue(value);
    this.form.controls.effectiveDate.markAsDirty();
    this.typed.set(null);
  }

  onTyped(value: string): void {
    this.typed.set(value);
  }

  /** On blur, not per keystroke: "15 S" is unfinished, not wrong. */
  commitTyped(): void {
    const text = this.typed();
    if (text === null) return;
    const trimmed = text.trim();
    const control = this.form.controls.effectiveDate;
    if (trimmed === '') {
      control.setValue(null);
      this.typed.set(null);
      control.markAsDirty();
      return;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return;
    control.setValue(parsed);
    control.markAsDirty();
    this.typed.set(null);
  }

  submit(): void {
    if (this.saving()) return;
    this.commitTyped();
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.form.markAllAsTouched();
      return;
    }
    const { incomingUserId, effectiveDate, reason } = this.form.getRawValue();
    this.saving.set(true);
    this.saveError.set(null);
    this.headService
      .declareHandover(this.orgUnitId(), {
        incomingUserId: incomingUserId!,
        effectiveDate: effectiveDate!.toISOString(),
        reason: reason?.trim() ? reason.trim() : undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.saved.emit();
          this.visibleChange.emit(false);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.saveError.set(extractErrorMessage(err, this.translate.instant('headship.saveFailed')));
        },
      });
  }
}

/** Midnight local, so a same-day comparison is not decided by the clock. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The date may be today or later: a sole-head date in the past means nothing. */
function notBefore(floor: () => Date) {
  return (control: { value: Date | null }) =>
    control.value && control.value.getTime() < floor().getTime() ? { min: true } : null;
}
