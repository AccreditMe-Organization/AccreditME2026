import { Component, ElementRef, input, model, viewChildren } from '@angular/core';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * ACC-316 PR 8a — a choice of two or three, drawn as one segmented control
 * (Schedule's step 2: Repeats, On, Ends). A radio group: one segment in the
 * Tab order (the chosen one), arrow keys move AND choose, as a native radio
 * group does, in the reading direction. The meeting room's tablet (a coarse
 * pointer) gets 44px segments.
 */
@Component({
  selector: 'am-meeting-segmented',
  standalone: true,
  template: `
    <span role="radiogroup" class="am-segmented" [attr.aria-label]="ariaLabel()" [attr.aria-labelledby]="labelledBy()">
      @for (o of options(); track o.value; let i = $index) {
        <button
          #segment
          type="button"
          role="radio"
          class="am-segmented__option"
          [class.am-segmented__option--active]="value() === o.value"
          [attr.aria-checked]="value() === o.value"
          [attr.tabindex]="value() === o.value || (!chosen() && i === 0) ? 0 : -1"
          [attr.data-segment]="o.value"
          (click)="choose(o.value)"
          (keydown)="onKey($event, i)"
        >
          {{ o.label }}
        </button>
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        max-inline-size: 100%;
      }
      .am-segmented {
        display: inline-flex;
        max-inline-size: 100%;
        overflow: hidden;
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-button);
      }
      .am-segmented__option {
        min-block-size: var(--am-control-height);
        padding-inline: var(--am-space-12);
        font: inherit;
        font-size: var(--am-type-meta-size);
        font-weight: 500;
        white-space: nowrap;
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
        outline-offset: calc(-1 * var(--am-focus-ring-width));
      }
      @media (pointer: coarse) {
        .am-segmented__option {
          min-block-size: calc(var(--am-space-40) + var(--am-space-4));
        }
      }
    `,
  ],
})
export class MeetingSegmentedComponent<T extends string> {
  readonly options = input.required<SegmentedOption<T>[]>();
  readonly value = model<T | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly labelledBy = input<string | null>(null);
  private readonly segments = viewChildren<ElementRef<HTMLButtonElement>>('segment');

  chosen(): boolean {
    return this.options().some((o) => o.value === this.value());
  }

  choose(value: T): void {
    this.value.set(value);
  }

  onKey(event: KeyboardEvent, i: number): void {
    const rtl = getComputedStyle(event.target as Element).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    const n = this.options().length;
    let to: number | null = null;
    if (event.key === forward || event.key === 'ArrowDown') to = (i + 1) % n;
    else if (event.key === back || event.key === 'ArrowUp') to = (i - 1 + n) % n;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = n - 1;
    if (to === null) return;
    event.preventDefault();
    this.choose(this.options()[to]!.value);
    this.segments()[to]?.nativeElement.focus();
  }
}
