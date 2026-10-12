import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  Injector,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { FieldComponent } from '../field/field.component';
import { AmDatePipe } from '../../../core/formatting';

/**
 * A write-once secret — ACC-181, the design system's write-once rule (artboard
 * 10). The first of its kind; the storage settings screen uses it later.
 *
 * A secret (an API key, a password, a client secret) is entered once and never
 * rendered again:
 *
 * - NOT SET: an empty password input. No reveal control — there is nothing a
 *   reader needs to see back, and a show/hide button is how a value ends up on
 *   a screen share. (So this is NOT `password-input`, which has one.)
 * - SET: the read-only pair "●●●●●●●● · set 29 Sep" with a single Replace.
 *   No input exists, so there is no masked placeholder pretending to hold the
 *   value — the browser never has it.
 * - REPLACE reopens an empty input. Leaving it empty keeps the stored value.
 *
 * The value goes through `control` (a string). UNTOUCHED, IT IS '' — and the
 * screen sends nothing for it, which is what keeps the stored secret: the
 * server reads an omitted secret as "keep" (backend
 * common/config/write-only-secrets.ts). Whether an empty value is allowed
 * (required while nothing is set) is the caller's validator.
 *
 * The input sits in `am-field`, created when it appears: am-field finds and
 * wires its control once, after it renders, so a field made fresh on Replace is
 * a field it wires.
 */
@Component({
  selector: 'am-secret-field',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, InputTextModule, ButtonModule, FieldComponent, AmDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isSet() && !replacing()) {
      <div class="flex flex-col gap-1" data-secret-state="set">
        <span class="text-sm font-medium" [id]="labelId()">{{ label() }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm" role="group" [attr.aria-labelledby]="labelId()">
            <span aria-hidden="true" dir="ltr">●●●●●●●●</span>
            <span aria-hidden="true"> · </span>
            <span class="text-[var(--am-text-secondary)]" data-secret-set-on>
              @if (setAt(); as at) {
                {{ 'secretField.setOn' | translate: { date: (at | amDate) } }}
              } @else {
                {{ 'secretField.set' | translate }}
              }
            </span>
          </span>
          <p-button
            type="button"
            size="small"
            [text]="true"
            [label]="'secretField.replace' | translate"
            [ariaLabel]="'secretField.replaceNamed' | translate: { label: label() }"
            (onClick)="replace()"
          />
        </div>
        <p class="text-xs text-[var(--am-text-secondary)]">{{ 'secretField.neverShownAgain' | translate }}</p>
      </div>
    } @else {
      <am-field
        [label]="label()"
        [inputId]="inputId()"
        [control]="control()"
        [hint]="replacing() ? ('secretField.replacingHint' | translate) : hint()"
        [errorMessages]="errorMessages()"
      >
        <input
          pInputText
          type="password"
          [id]="inputId()"
          [formControl]="control()"
          autocomplete="new-password"
          spellcheck="false"
          autocapitalize="off"
          dir="ltr"
          class="w-full"
          data-secret-state="input"
        />
      </am-field>
    }
  `,
})
export class SecretFieldComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly label = input.required<string>();
  readonly inputId = input.required<string>();
  readonly control = input.required<FormControl<string>>();
  /** Whether a value is stored (the server's 'set'). */
  readonly isSet = input(false);
  /** When it was set (ISO), shown as "set 29 Sep 2026". */
  readonly setAt = input<string | null>(null);
  readonly hint = input<string>('');
  readonly errorMessages = input<Record<string, string>>({});

  protected readonly replacing = signal(false);
  protected readonly labelId = () => `${this.inputId()}-label`;

  constructor() {
    // A save that stores a new value comes back set: back to the pair, with the
    // typed value gone from the form.
    // setAt changes on every replace, so a replace that leaves isSet true
    // still closes the input.
    effect(() => {
      this.isSet();
      this.setAt();
      untracked(() => {
        this.replacing.set(false);
        if (this.control().value !== '') this.control().setValue('', { emitEvent: false });
      });
    });
  }

  replace(): void {
    this.replacing.set(true);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('input[type="password"]')?.focus(), {
      injector: this.injector,
    });
  }
}
