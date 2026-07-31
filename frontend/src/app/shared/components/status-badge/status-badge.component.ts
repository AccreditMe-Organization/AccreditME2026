import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export type StatusBadgeVariant = 'status' | 'severity' | 'account';

// Deliberately generic (not a fixed enum) — reads --am-{variant}-{value} and
// {variant}.{value} (translation key) for whatever value is passed, rather
// than assuming a specific vocabulary. See step-15-design-foundation.md.
//
// 'status'   — document-lifecycle tokens (draft/review/approved/rejected/
//              published/archived)
// 'severity' — critical/high/medium/low
// 'account'  — tenant/organization lifecycle (trial/active/suspended/
//              cancelled/offboarding) — its own domain, not folded into
//              'status' (see tokens.scss's own comment on why)
//
// Before wiring a real value into this component, confirm en.json/ar.json
// actually have a matching "{variant}.{value}" key — ngx-translate falls
// back to rendering the raw key string otherwise, which must never reach
// a real screen.
@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <span
      class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium text-white"
      [style.background-color]="colorVar()"
    >
      {{ labelKey() | translate }}
    </span>
  `,
})
export class StatusBadgeComponent {
  readonly variant = input.required<StatusBadgeVariant>();
  readonly value = input.required<string>();

  // CSS's own var() fallback — if --am-{variant}-{value} was never defined
  // (an unmapped/typo'd value), the browser resolves --am-text-secondary
  // instead of rendering an invisible/transparent badge. No JS-side
  // "does this variable exist" check needed; the cascade handles it.
  readonly colorVar = computed(
    () => `var(--am-${this.variant()}-${this.value().toLowerCase()}, var(--am-text-secondary))`,
  );
  readonly labelKey = computed(() => `${this.variant()}.${this.value().toLowerCase()}`);
}
