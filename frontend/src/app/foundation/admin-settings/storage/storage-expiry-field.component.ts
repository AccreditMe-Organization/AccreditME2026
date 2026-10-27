import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService } from '../../../core/formatting';
import { FieldComponent } from '../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../shared/components/inline-calendar/inline-calendar.component';

/** A YYYY-MM-DD day as an instant at noon UTC, so no time zone within ±12 hours moves it to another day. */
export function noonOf(day: string): string {
  return `${day}T12:00:00Z`;
}

/** The calendar's picked day (local midnight) as YYYY-MM-DD. */
function dayOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * ACC-260 PR C — the client secret's expiry date (D3): optional, a day the
 * person PICKS from the product's one calendar (`am-inline-calendar`, ACC-96),
 * never types. The value is '' or YYYY-MM-DD, which is what the API takes.
 *
 * On a page, not in a dialog, so the calendar opens below the field and the
 * page grows: there is no 420 cap to keep (ACC-111 governs dialogs).
 */
@Component({
  selector: 'am-storage-expiry-field',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, InputTextModule, FieldComponent, InlineCalendarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <am-field
      [label]="label()"
      [control]="control()"
      [inputId]="inputId()"
      [hint]="hint()"
      [forceShowErrors]="forceShowErrors()"
      [errorMessages]="{ date: 'storage.sp.expiryInvalid' }"
    >
      <div class="am-ef">
        <input
          pInputText
          readonly
          dir="ltr"
          class="am-ef__text"
          [id]="inputId()"
          [value]="shown()"
          [placeholder]="'storage.sp.expiryPlaceholder' | translate"
          (click)="toggle()"
          (keydown.enter)="$event.preventDefault(); toggle()"
          data-testid="expiry-text"
        />
        <p-button
          type="button"
          [text]="true"
          severity="secondary"
          icon="pi pi-calendar"
          [ariaLabel]="'storage.sp.expiryChoose' | translate"
          [attr.aria-expanded]="open()"
          (onClick)="toggle()"
          data-testid="expiry-toggle"
        />
        @if (value()) {
          <p-button type="button" size="small" [text]="true" severity="secondary" [label]="'storage.sp.expiryClear' | translate" (onClick)="clear()" data-testid="expiry-clear" />
        }
      </div>
    </am-field>
    @if (open()) {
      <div class="am-ef__cal" data-testid="expiry-calendar">
        <am-inline-calendar [value]="picked()" (valueChange)="pick($event)" />
      </div>
    }
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-ef{display:flex;align-items:center;gap:var(--am-space-4)}
      .am-ef__text{flex:1 1 auto;min-inline-size:0;cursor:pointer}
      .am-ef__cal{margin-block-start:var(--am-space-8);max-inline-size:320px}
    `,
  ],
})
export class StorageExpiryFieldComponent {
  private readonly format = inject(FormatService);

  readonly control = input.required<FormControl<string>>();
  readonly label = input.required<string>();
  readonly inputId = input.required<string>();
  readonly hint = input('');
  readonly forceShowErrors = input(false);

  readonly open = signal(false);
  /** The control's value, followed — including a value set from outside (a stored date, a reset). */
  readonly value = signal('');
  readonly shown = computed(() => (this.value() ? this.format.dateForInput(noonOf(this.value())) : ''));
  readonly picked = computed(() => {
    const v = this.value();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y!, m! - 1, d!);
  });

  constructor() {
    effect((onCleanup) => {
      const c = this.control();
      untracked(() => this.value.set(c.value ?? ''));
      const sub = c.valueChanges.subscribe((v) => this.value.set(v ?? ''));
      onCleanup(() => sub.unsubscribe());
    });
  }

  toggle(): void {
    this.open.update((o) => !o);
  }

  pick(date: Date | null): void {
    if (!date) return;
    const c = this.control();
    c.setValue(dayOf(date));
    c.markAsDirty();
    c.markAsTouched();
    this.open.set(false);
  }

  clear(): void {
    const c = this.control();
    c.setValue('');
    c.markAsDirty();
    this.open.set(false);
  }
}
