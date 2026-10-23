import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The type marker's glyph, by what the relation points at. */
const GLYPH = { unit: '▦', person: '◉', committee: '◇' } as const;

export type RelationKind = keyof typeof GLYPH;

/**
 * `am-relation` — one pointer from a record to another, in a record HEADER
 * (Design System artboard 4, context C). ACC-120 slice 11, PR D: the org unit
 * record's Parent unit · Head · Acting head is its first use.
 *
 * Four slots, always in this order: the type glyph, the name in the reader's
 * language, its state as text, and nothing else. The name is a real link when
 * the caller passes one (the viewer may open the target), else plain text.
 *
 * - `hidden`: the target exists and its name is withheld from this viewer
 *   (D7). The caller passes what may be shown in its place (a position title)
 *   and the qualifier as `state`; the field's ground is hatched, so it reads
 *   as present-but-withheld, never as empty.
 * - `none`: there is no target (no parent, no head). The name slot carries the
 *   caller's sentence, muted, with no glyph.
 *
 * The caller translates everything; this component holds no strings.
 */
@Component({
  selector: 'am-relation',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="am-rel__label">{{ label() }}</div>
    <div class="am-rel__value" [class.am-rel__value--hidden]="hidden()" data-testid="relation-value">
      @if (!none()) {
        <span class="am-rel__glyph" aria-hidden="true">{{ glyph() }}</span>
      }
      @if (link() && !hidden() && !none()) {
        <a class="am-rel__name am-rel__name--link" [routerLink]="link()" data-testid="relation-link">{{ name() }}</a>
      } @else {
        <span class="am-rel__name" [class.am-rel__name--none]="none()">{{ name() }}</span>
      }
      @if (state()) {
        <span class="am-rel__state" data-testid="relation-state">· {{ state() }}</span>
      }
    </div>
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-rel__label{font-size:var(--am-type-micro-size);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--am-ink-500);margin-block-end:var(--am-space-4)}
      .am-rel__value{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:var(--am-space-4);min-inline-size:0;font-size:var(--am-type-value-size);overflow-wrap:anywhere}
      .am-rel__value--hidden{background:repeating-linear-gradient(135deg,transparent 0 4px,var(--am-surface) 4px 8px);border-radius:var(--am-radius-control);padding-inline:var(--am-space-4)}
      .am-rel__glyph{color:var(--am-ink-500)}
      .am-rel__name{font-weight:500;color:var(--am-ink-900)}
      .am-rel__name--link{color:var(--am-primary-700);text-decoration:none}
      .am-rel__name--link:hover{text-decoration:underline}
      .am-rel__name--link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-rel__name--none{font-weight:400;color:var(--am-ink-500)}
      .am-rel__state{color:var(--am-ink-500);font-size:var(--am-type-meta-size)}
    `,
  ],
})
export class RelationComponent {
  /** The field label, translated. */
  readonly label = input.required<string>();
  readonly kind = input.required<RelationKind>();
  /** The name, or what stands in for it (see `hidden` and `none`). */
  readonly name = input.required<string>();
  /** The target's page, only when the viewer may open it. */
  readonly link = input<readonly unknown[] | null>(null);
  /** The target's state as text ("Director", "no end date"), translated. */
  readonly state = input('');
  readonly hidden = input(false);
  readonly none = input(false);

  protected readonly glyph = computed(() => GLYPH[this.kind()]);
}
