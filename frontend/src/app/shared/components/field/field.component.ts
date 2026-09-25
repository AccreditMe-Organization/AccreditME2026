import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  isDevMode,
  signal,
} from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DIALOG_DENSITY } from '../edit-dialog/dialog-density';

/**
 * The field wrapper (ACC-111) — artboards 3 and 6 of the design system.
 *
 * Wraps ONE control and owns everything around it: the label above, the seven
 * states, and a single message slot. The control itself stays the caller's —
 * a PrimeNG input, a select, `OverlaySelectComponent` — projected through
 * `<ng-content>`, because this component decides how a field BEHAVES, not
 * which control a screen needs.
 *
 * ## The seven states
 *
 * Default, focus, filled, disabled, read-only, error and loading. Five are
 * derived rather than declared: `filled` from the control's value, `disabled`
 * from `control.disabled`, `error` from the control's validity AND the timing
 * rule below, and focus from the browser. Only `readonly` and `loading` are
 * inputs, because nothing in the control's own state can tell us.
 *
 * ## Why the message slot is always in the layout
 *
 * `.am-field__message` is rendered at all times with a reserved min-height,
 * empty when there is nothing to say. A slot that appears with the error moves
 * every field below it at the moment the user is reading one — and in a dialog
 * it moves the footer under a cursor already travelling to Save.
 *
 * Error text REPLACES the hint rather than stacking with it: two messages
 * where one is now wrong is worse than one.
 *
 * ## Validation timing
 *
 * Validate on blur; after a field has errored once, re-validate on every
 * keystroke. Erroring while someone is still typing their first attempt is
 * nagging; staying silent after they have been told is hiding their recovery.
 * `erroredOnce` is what separates the two, and it never resets — a field that
 * has been wrong once keeps giving live feedback for the rest of the session.
 *
 * ## Colour is never the only carrier
 *
 * An error shows a `!` glyph and a sentence, not only a red border — artboard
 * 3's rule, and the greyscale test the design system sets as its acceptance
 * criterion. This matters more than it looks: PrimeNG's own Aura theme signals
 * FOCUS with border colour alone (its form-field focus ring is width 0), which
 * fails that test today. This component adds the design's 3px halo so focus
 * survives greyscale too.
 */
@Component({
  selector: 'am-field',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="am-field"
      [class.am-field--readonly]="readonly()"
      [class.am-field--compact]="isCompact()"
    >
      <label class="am-field__label" [attr.for]="controlId()">
        {{ label() }}
        @if (required()) {
          <span class="am-field__required" aria-hidden="true">*</span>
        }
      </label>

      @if (readonly()) {
        <!-- No box, no border: a read-only field is a value, and drawing it as
             a disabled control invites the reader to try. -->
        <div class="am-field__value">{{ readonlyText() || displayValue() }}</div>
      } @else {
        <div class="am-field__control">
          <ng-content />
          @if (loading()) {
            <span class="am-field__spinner" aria-hidden="true"></span>
          } @else if (showError()) {
            <span class="am-field__glyph" aria-hidden="true">!</span>
          }
        </div>
      }

      <!-- Rendered unless the field DECLARED it can never produce a message.
           That declaration is the largest single saving in compact density
           (23px of the 39 non-control pixels) and it costs nothing, because a
           slot reserved for a message that cannot happen is pure whitespace. -->
      @if (message() === 'reserved') {
      <p
        class="am-field__message"
        [class.am-field__message--error]="showError()"
        [id]="messageId"
        [attr.role]="showError() ? 'alert' : null"
      >
        @if (showError()) {
          {{ errorText() | translate }}
        } @else {
          {{ hint() }}
        }
      </p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .am-field {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-4);
        max-width: var(--am-form-max-width);
      }

      .am-field__label {
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        font-weight: 500;
        color: var(--am-ink-500);
      }

      .am-field__required {
        color: var(--am-danger-ink);
        margin-inline-start: 2px;
      }

      .am-field__control {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
      }

      /* The projected control fills the row whatever it is. */
      .am-field__control ::ng-deep > *:first-child {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* Focus: the design's 3px halo on top of the preset's border colour, so
         focus is carried by more than hue (artboard 3). */
      .am-field__control ::ng-deep input:focus-visible,
      .am-field__control ::ng-deep textarea:focus-visible,
      .am-field__control ::ng-deep .p-inputtext:focus,
      .am-field__control ::ng-deep .p-select:focus-within {
        border-color: var(--am-primary-600);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--am-primary-600) 18%, transparent);
        outline: none;
      }

      .am-field__control ::ng-deep .p-invalid,
      .am-field__control ::ng-deep [aria-invalid='true'] {
        border-color: var(--am-danger-ink);
      }

      .am-field__control ::ng-deep .p-invalid:focus,
      .am-field__control ::ng-deep [aria-invalid='true']:focus {
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--am-danger-ink) 12%, transparent);
      }

      .am-field__glyph {
        position: absolute;
        inset-inline-end: var(--am-space-8);
        color: var(--am-danger-ink);
        font-weight: 700;
        font-size: var(--am-type-value-size);
        pointer-events: none;
      }

      .am-field__spinner {
        position: absolute;
        inset-inline-end: var(--am-space-8);
        width: 13px;
        height: 13px;
        border: 2px solid var(--am-border-strong);
        border-top-color: var(--am-primary-600);
        border-radius: 50%;
        animation: am-field-spin 0.8s linear infinite;
      }

      @keyframes am-field-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .am-field__spinner {
          animation-duration: 2.4s;
        }
      }

      .am-field__value {
        min-height: var(--am-form-control-height);
        display: flex;
        align-items: center;
        font-size: var(--am-type-body-size);
        font-weight: 500;
        color: var(--am-ink-900);
      }

      /* Reserved at all times — an appearing message must never move the form. */
      .am-field__message {
        margin: 0;
        min-height: 17px;
        font-size: 11.5px;
        line-height: 17px;
        color: var(--am-ink-500);
        text-wrap: pretty;
      }

      /* ACC-120 slice 2 — artboard 13. Geometry only: no type size changes, and
         the control's own height is the one thing a reader's finger has to hit,
         so 36 -> 32 is the floor the artboard sets and not a free variable. */
      .am-field--compact .am-field__label {
        margin-block-end: 2px;
      }
      .am-field--compact .am-field__control,
      .am-field--compact .am-field__value {
        min-height: 32px;
      }
      .am-field--compact .am-field__control ::ng-deep .p-inputtext,
      .am-field--compact .am-field__control ::ng-deep .p-select,
      .am-field--compact .am-field__control ::ng-deep .am-overlay-select__trigger {
        min-height: 32px;
        height: 32px;
      }
      .am-field--compact .am-field__message {
        margin-block-start: 2px;
      }

      .am-field__message--error {
        color: var(--am-danger-ink);
        font-weight: 500;
      }
    `,
  ],
})
export class FieldComponent {
  private static nextId = 0;

  /** Rendered above the control, and the control's accessible name. */
  readonly label = input.required<string>();

  /**
   * The control this field wraps. Optional: a field may hold something with no
   * validity of its own (a read-only value, a display-only row).
   */
  readonly control = input<AbstractControl | null>(null);

  /** Helper text. Replaced by the error message while one is showing. */
  readonly hint = input<string>('');

  /** Renders the value as text, with no control and no box. */
  readonly readonly = input(false);

  /** What to render in the read-only state, when the raw value is not it. */
  readonly readonlyText = input<string>('');

  /** In flight — an async check the user should not be asked to wait on blindly. */
  readonly loading = input(false);

  /**
   * Error key to message key. Merged over the defaults, so a field overrides
   * only what it needs ({ minlength: 'committee.nameTooShort' }).
   */
  readonly errorMessages = input<Record<string, string>>({});

  /** Set when the caller gives the control its own id; otherwise generated. */
  readonly inputId = input<string>('');

  /**
   * Reveal every error now, whatever the user has touched. A form sets this on
   * SUBMIT: at that point an untouched required field is a real answer to a
   * real question, where before the submit it was just a field nobody had
   * reached yet.
   */
  readonly forceShowErrors = input(false);

  /**
   * ACC-120 slice 2 — artboard 13's message-slot rule, WITH the clause that
   * keeps "the layout never jumps" true.
   *
   * The slot is reserved only on fields that CAN produce a message: anything
   * with validation, a persistent helper line, or an async state. A required
   * select over a closed list with a default, or a toggle, can produce none, so
   * they get no slot — and in compact density that is the largest single saving
   * (a block drops 75 -> 52 rather than 75 -> 71).
   *
   * THE CLAUSE: a field that declared 'none' may NEVER show a runtime message.
   * If one later needs one — a server-side conflict on Assigned to, say — it
   * changes its declaration and pays the 17px, rather than growing a slot the
   * first time the server disagrees. Without that, removing the slot just moves
   * the jump from every form to the rare one, which is worse: it happens
   * exactly when the user is already being told something went wrong.
   *
   * Enforced, not documented: declaring 'none' and then producing a message
   * throws in development (see the effect below).
   */
  readonly message = input<'reserved' | 'none'>('reserved');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly translate = inject(TranslateService);

  private readonly generatedId = `am-field-${FieldComponent.nextId++}`;
  protected readonly messageId = `${this.generatedId}-message`;

  /**
   * ACC-120 slice 2 — density comes from the DIALOG, never from the field, and
   * never from a page. `optional: true` is the whole mechanism: only
   * EditDialogComponent provides this token, so a field on a page injects
   * nothing and stays at form density by construction rather than by review.
   */
  private readonly dialogDensity = inject(DIALOG_DENSITY, { optional: true });

  protected readonly isCompact = computed(
    () => this.dialogDensity?.() === 'compact',
  );

  /** The resolved id of the projected control, for the label's `for`. */
  protected readonly controlId = signal<string>('');

  /**
   * The projected control, resolved after the first render. A SIGNAL, not a
   * field: the state-mirroring effect below has to re-run once it exists.
   * Holding it in a plain property meant the effect ran once against null,
   * before projection, and then never again — every aria attribute stayed unset.
   */
  private readonly controlEl = signal<HTMLElement | null>(null);

  /** Re-read on every control event, so derived state follows the form. */
  private readonly controlTick = signal(0);

  /** True once the field has shown an error — the switch for live validation. */
  private readonly erroredOnce = signal(false);

  /** The field has been left at least once. Not sufficient on its own — see showError. */
  private readonly blurred = signal(false);

  protected readonly required = computed(() => {
    this.controlTick();
    const c = this.control();
    return c ? probeRequired(c) : false;
  });

  protected readonly showError = computed(() => {
    this.controlTick();
    const c = this.control();
    if (!c || this.readonly() || c.disabled) return false;
    if (!c.invalid) return false;
    // BLUR ALONE IS NOT A VALIDATION EVENT — the control must also be dirty.
    // A dialog focuses its first field on open, and opening a picker moves
    // focus away again, so a pure blur rule told the user "This field is
    // required" about a form they had not typed into yet. Found in ACC-111's
    // browser pass, on the Add holiday proof screen.
    return this.erroredOnce() || (this.blurred() && c.dirty) || this.forceShowErrors();
  });

  protected readonly errorText = computed(() => {
    this.controlTick();
    const c = this.control();
    const errors = c?.errors;
    if (!errors) return '';
    const key = Object.keys(errors)[0];
    const overrides = this.errorMessages();
    return overrides[key] ?? DEFAULT_ERROR_MESSAGES[key] ?? 'validation.invalid';
  });

  protected readonly displayValue = computed(() => {
    this.controlTick();
    const value = this.control()?.value;
    return value === null || value === undefined || value === '' ? '—' : String(value);
  });

  constructor() {
    // ACC-120 slice 2 — the message-slot clause, enforced rather than trusted.
    // A field that declared it can never message, and then messages, has a
    // layout that jumps exactly when the user is being told something is wrong.
    // Dev-only: in production the message is simply not rendered, which is a
    // missing hint rather than a broken page.
    effect(() => {
      if (!isDevMode()) return;
      if (this.message() === 'none' && this.showError()) {
        throw new Error(
          `am-field "${this.label()}" declared message="none" but produced an ` +
            `error message. A field that can produce a message must declare ` +
            `message="reserved" and pay the 17px, rather than growing a slot ` +
            `the first time the server disagrees.`,
        );
      }
    });

    // Blur anywhere inside the field marks it touched: that is the "validate on
    // blur" half. Leaving a field is the moment the user has finished with it.
    this.host.nativeElement.addEventListener('focusout', () => {
      this.blurred.set(true);
      this.controlTick.update((n) => n + 1);
      const c = this.control();
      if (c?.invalid && c.dirty) this.erroredOnce.set(true);
    });

    // Every keystroke re-reads validity. It only becomes VISIBLE once
    // erroredOnce is set, which is what stops the nagging.
    this.host.nativeElement.addEventListener('input', () => {
      this.controlTick.update((n) => n + 1);
    });

    // The control's own streams, because not every state change passes through
    // the DOM: disable(), setValue() and a parent's patchValue() are all
    // invisible to the listeners above. Without this a disabled control kept
    // showing the error it had before it was disabled.
    effect((onCleanup) => {
      const c = this.control();
      if (!c) return;
      const bump = (): void => this.controlTick.update((n) => n + 1);
      const status = c.statusChanges.subscribe(bump);
      const value = c.valueChanges.subscribe(bump);
      onCleanup(() => {
        status.unsubscribe();
        value.unsubscribe();
      });
    });

    afterNextRender(() => {
      const el = this.host.nativeElement.querySelector<HTMLElement>(
        'input, textarea, select, [contenteditable="true"]',
      );
      if (!el) return;
      const id = this.inputId() || el.id || this.generatedId;
      el.id = id;
      this.controlId.set(id);
      this.controlEl.set(el);
    });

    // Mirrors state onto the projected control, which this component does not
    // own and cannot bind to. aria-describedby always points at the message
    // slot: the hint is as much part of the field's name as the error is.
    effect(() => {
      const el = this.controlEl();
      if (!el) return;
      const invalid = this.showError();
      el.setAttribute('aria-invalid', String(invalid));
      el.classList.toggle('p-invalid', invalid);
      el.setAttribute('aria-describedby', this.messageId);
      if (this.required()) el.setAttribute('aria-required', 'true');
      if (this.loading()) {
        el.setAttribute('aria-busy', 'true');
      } else {
        el.removeAttribute('aria-busy');
      }
    });
  }

  /** Called by the form on submit; see FieldComponent's class comment. */
  focusControl(): void {
    this.host.nativeElement.querySelector<HTMLElement>('input, textarea, select')?.focus();
  }
}

const DEFAULT_ERROR_MESSAGES: Record<string, string> = {
  required: 'validation.required',
  minlength: 'validation.minLength',
  maxlength: 'validation.maxLength',
  email: 'validation.email',
  min: 'validation.min',
  max: 'validation.max',
  pattern: 'validation.pattern',
};

/**
 * Whether a control rejects emptiness. Asked by running the control's own
 * validator against an empty value, rather than through hasValidator(), which
 * compares function REFERENCES and so answers false for any composed validator
 * — which is what a form built with an array of validators always has.
 */
function probeRequired(control: AbstractControl): boolean {
  const validator = control.validator;
  if (!validator) return false;
  const result = validator({ value: '' } as AbstractControl);
  return !!result?.['required'];
}
