import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export type StatusChipVariant = 'user' | 'status' | 'severity' | 'account';

// ACC-78 — WRAPS StatusBadgeComponent's idea rather than modifying it.
//
// StatusBadgeComponent (§10.2) is deliberately generic: any value resolves to
// --am-{variant}-{value}, so EVERY value gets a coloured badge. That is
// correct for a severity scale, where every value is a rating. It is wrong for
// a status column, and is what the UX review found (ACC-71): colour applied so
// uniformly that nearly every row was green and nothing stood out.
//
// This component adds the missing distinction — WHICH values are worth
// colouring — and leaves StatusBadgeComponent untouched for its four existing
// consumers.
//
// THREE TIERS, not two:
//
//   PLAIN      the unremarkable value. Plain secondary text, no chip, no
//              border. An active user is the normal case; saying so in colour
//              spends attention on the majority of rows.
//   MUTED      a real but unalarming state (inactive). Grey chip — visible as
//              a state, not competing for attention.
//   ATTENTION  a state someone should act on (invited = not yet accepted).
//              Coloured chip AND a dot. The dot is reserved for this tier;
//              it is the strongest signal the component has, so exactly one
//              tier gets it.
//
// The tiering lives HERE, per variant, rather than at each call site. A
// `[plain]="['ACTIVE']"` input repeated across eighteen tables is a rule that
// drifts; a table in one place is a rule that can be read and tested.
const TIERS: Record<StatusChipVariant, { plain: string[]; attention: string[] }> = {
  // ACTIVE is plain; INVITED needs chasing; INACTIVE is muted.
  user: { plain: ['ACTIVE'], attention: ['INVITED'] },
  // Document lifecycle: PUBLISHED is the settled, unremarkable end state.
  // REJECTED is what someone must act on.
  status: { plain: ['PUBLISHED'], attention: ['REJECTED'] },
  // A severity scale rates EVERY value — nothing is unremarkable, which is
  // why StatusBadgeComponent was right for it and why nothing is plain here.
  severity: { plain: [], attention: ['CRITICAL', 'HIGH'] },
  // Tenant lifecycle: ACTIVE is the normal running state.
  account: { plain: ['ACTIVE'], attention: ['SUSPENDED', 'CANCELLED'] },
};

@Component({
  selector: 'app-status-chip',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (isPlain()) {
      <!-- No chip at all. Not a chip styled to look like text — an actual
           bare span, so it costs no border, no padding and no visual weight
           in a dense table. -->
      <span class="text-[var(--am-text-secondary)]">{{ labelKey() | translate }}</span>
    } @else {
      <span
        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs whitespace-nowrap"
        [class.font-semibold]="isAttention()"
        [class.font-medium]="!isAttention()"
        [style.color]="ink()"
        [style.background]="background()"
        [style.border]="border()"
      >
        @if (isAttention()) {
          <!-- Reserved for the attention tier alone. If every chip had a dot
               it would signal nothing. -->
          <span class="w-1.5 h-1.5 rounded-full" [style.background]="ink()"></span>
        }
        {{ labelKey() | translate }}
      </span>
    }
  `,
})
export class StatusChipComponent {
  readonly variant = input.required<StatusChipVariant>();
  readonly value = input.required<string>();

  // Uppercased once: callers pass backend enum values ('ACTIVE'), the token
  // and translation key both want lowercase, and the tier table is declared in
  // the enum's own casing.
  private readonly normalized = computed(() => this.value().toUpperCase());
  private readonly tier = computed(() => TIERS[this.variant()]);

  readonly isPlain = computed(() => this.tier().plain.includes(this.normalized()));
  readonly isAttention = computed(() => this.tier().attention.includes(this.normalized()));

  // Same var()-with-fallback safety StatusBadgeComponent established: an
  // unmapped value resolves to --am-text-secondary rather than rendering an
  // invisible chip. The cascade handles it; no existence check needed.
  private readonly colorVar = computed(
    () =>
      `var(--am-${this.variant()}-${this.value().toLowerCase()}, var(--am-text-secondary))`,
  );

  readonly ink = computed(() => this.colorVar());

  // Tinted from the same token rather than a second hardcoded colour, so a
  // token change moves the chip and its ink together and they cannot drift.
  readonly background = computed(
    () => `color-mix(in srgb, ${this.colorVar()} 12%, transparent)`,
  );
  readonly border = computed(
    () => `1px solid color-mix(in srgb, ${this.colorVar()} 30%, transparent)`,
  );

  // Where the labels live. Defaults to the variant name, matching
  // StatusBadgeComponent's "{variant}.{value}" convention.
  //
  // OVERRIDABLE BECAUSE THE CONVENTION IS NOT UNIVERSAL, and this was found
  // the way the component's own warning predicted: user statuses are keyed
  // `user.status.invited`, not `user.invited`, so the default resolved to a
  // key that does not exist and ngx-translate renders the raw key string —
  // "user.invited" shown to a user, with nothing failing anywhere. An
  // override is better than duplicating every status label under a second
  // key purely to satisfy a naming rule.
  readonly labelPrefix = input<string>('');

  readonly labelKey = computed(
    () => `${this.labelPrefix() || this.variant()}.${this.value().toLowerCase()}`,
  );
}
