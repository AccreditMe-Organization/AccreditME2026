import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { FIELD_TRAILING_CONTROL } from '../field/trailing-control';

/** The show/hide button's inline size — also what am-field moves its glyph past. */
const TOGGLE_SIZE = 'var(--am-space-32)';

/**
 * A password input with a show/hide button — ACC-120 slice 9e.
 *
 * WHY NOT `p-password [toggleMask]`, which this replaces where a mask toggle is
 * wanted: PrimeNG draws the toggle as a bare `<svg (click)>` — no role, no name,
 * no tabindex, so Tab skips it and a screen reader cannot find it. Its custom
 * icon templates do not cure that: PrimeNG wraps each in its own clickable
 * `<span>` and swaps the two with `*ngIf` on every toggle, so a button placed
 * inside is destroyed by its own click and keyboard focus falls to the page.
 * Verified in primeng-password.mjs (21.2.13), not assumed.
 *
 * So the input stays PrimeNG's (`pInputText`, every token and state it has)
 * and only the toggle is ours: a real `<button>`, focusable, named in the UI
 * language, with `aria-pressed` saying whether the password is showing. It is
 * one element that changes, never two that swap, so focus stays on it.
 *
 * Use it inside `am-field`, which finds the input and wires its id, its
 * `aria-invalid` and its message; the field also moves its error glyph past
 * the button (FIELD_TRAILING_CONTROL).
 */
@Component({
  selector: 'am-password-input',
  standalone: true,
  imports: [InputTextModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PasswordInputComponent),
      multi: true,
    },
    { provide: FIELD_TRAILING_CONTROL, useValue: TOGGLE_SIZE },
  ],
  template: `
    <div class="am-password">
      <input
        pInputText
        class="am-password__input"
        [id]="inputId()"
        [attr.type]="visible() ? 'text' : 'password'"
        [attr.autocomplete]="autocomplete()"
        [value]="value()"
        [disabled]="disabled()"
        (input)="onInput($event)"
        (blur)="onTouched()"
      />
      <button
        type="button"
        class="am-password__toggle"
        [attr.aria-label]="(visible() ? 'common.hidePassword' : 'common.showPassword') | translate"
        [attr.aria-pressed]="visible()"
        [attr.aria-controls]="inputId()"
        [disabled]="disabled()"
        (click)="toggle()"
      >
        <i [class]="visible() ? 'pi pi-eye-slash' : 'pi pi-eye'" aria-hidden="true"></i>
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .am-password {
        position: relative;
        display: flex;
        align-items: center;
      }
      .am-password__input {
        width: 100%;
        padding-inline-end: var(--am-space-32);
      }
      .am-password__toggle {
        position: absolute;
        inset-inline-end: 0;
        inset-block: 0;
        width: var(--am-space-32);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--am-ink-500);
        border-radius: var(--am-radius-control);
        cursor: pointer;
      }
      .am-password__toggle:hover {
        color: var(--am-ink-900);
      }
      .am-password__toggle:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: calc(-1 * var(--am-focus-ring-width));
      }
      .am-password__toggle:disabled {
        cursor: default;
        color: var(--am-ink-300);
      }
    `,
  ],
})
export class PasswordInputComponent implements ControlValueAccessor {
  private static nextId = 0;

  /** The input's id; `am-field` labels it by this. */
  readonly inputId = input(`am-password-${PasswordInputComponent.nextId++}`);

  /** 'new-password' when choosing one, 'current-password' when signing in. */
  readonly autocomplete = input<'new-password' | 'current-password'>('current-password');

  readonly visible = signal(false);
  protected readonly value = signal('');
  protected readonly disabled = signal(false);

  private onChange: (value: string) => void = () => {};
  protected onTouched: () => void = () => {};

  toggle(): void {
    this.visible.update((v) => !v);
  }

  protected onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.onChange(next);
  }

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
