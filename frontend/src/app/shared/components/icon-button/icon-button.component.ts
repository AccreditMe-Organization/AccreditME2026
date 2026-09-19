import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

/**
 * The icon button (ACC-111) — artboard 9 of the design system.
 *
 * ONE required label, rendered as BOTH the accessible name and the tooltip.
 * They read from the same string, so they cannot drift, and no meaning lives
 * in the tooltip alone — a tooltip is unreachable to a screen reader and to
 * anyone on a touch device, so a tooltip-only meaning is invisible to both.
 *
 * `label` is `input.required`, which means an unlabelled icon button FAILS THE
 * BUILD: `ng build` type-checks templates (strictTemplates), so a missing
 * required input is a compile error, not a lint warning someone can merge past.
 * That is the whole point of the component — the design's rule is "an
 * unlabelled icon button fails the build", and a convention that only lives in
 * a document is one somebody will not read.
 *
 * ## The label names the OBJECT, not the control
 *
 * "More actions for Nora Al-Otaibi", never "More actions". A table of twenty
 * rows otherwise gives a screen-reader user twenty identical buttons and no
 * way to tell which row they are on. The caller resolves the text (it will
 * usually interpolate a record's name into a translated string), because only
 * the caller knows the object.
 *
 * ## Size follows density, not the caller
 *
 * 32x32 at compact density, 40x40 on a coarse pointer, from the density
 * tokens — a tablet on rounds is a different target size, and that is a
 * property of the device, not of the screen that happens to be open.
 */
@Component({
  selector: 'am-icon-button',
  standalone: true,
  imports: [ButtonModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-button
      type="button"
      [icon]="icon()"
      [text]="true"
      [severity]="severity()"
      [disabled]="disabled()"
      [ariaLabel]="label()"
      [pTooltip]="label()"
      tooltipPosition="bottom"
      [tooltipDisabled]="disabled()"
      tooltipStyleClass="am-icon-button__tooltip"
      (onClick)="activated.emit($event)"
    />
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      :host ::ng-deep .p-button {
        width: var(--am-icon-button-size);
        height: var(--am-icon-button-size);
        padding: 0;
        border-radius: var(--am-radius-button);
      }

      :host ::ng-deep .p-button .p-button-icon {
        font-size: var(--am-type-value-size);
      }

      /* A tooltip that clips its own text says less than no tooltip: it must
         wrap and break long words rather than run off the viewport edge. */
      ::ng-deep .am-icon-button__tooltip .p-tooltip-text {
        max-width: 240px;
        white-space: normal;
        overflow-wrap: break-word;
      }
    `,
  ],
})
export class IconButtonComponent {
  /**
   * The button's whole meaning: its accessible name AND its tooltip. Required
   * — see the class comment. Already translated by the caller, and naming the
   * object where there is one.
   */
  readonly label = input.required<string>();

  /** A PrimeIcons class, e.g. 'pi pi-pencil'. */
  readonly icon = input.required<string>();

  readonly disabled = input(false);

  /** 'danger' for a destructive action; otherwise the default ink. */
  readonly severity = input<'primary' | 'secondary' | 'danger' | 'contrast'>('secondary');

  /** Named `activated`, not `click`, so it cannot shadow the DOM event. */
  readonly activated = output<MouseEvent>();
}
