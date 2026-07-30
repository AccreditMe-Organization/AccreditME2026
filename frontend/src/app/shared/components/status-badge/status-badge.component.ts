import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export type StatusBadgeVariant = 'status' | 'severity';

// Deliberately generic (not a fixed enum) — reads --am-{variant}-{value} and
// {variant}.{value} (translation key) for whatever value is passed, rather
// than assuming a specific vocabulary. See step-15-design-foundation.md and
// this ticket's checkpoint note on the --am-status-* domain question before
// wiring this into tenant-list.component.ts specifically.
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

  readonly colorVar = computed(() => `var(--am-${this.variant()}-${this.value().toLowerCase()})`);
  readonly labelKey = computed(() => `${this.variant()}.${this.value().toLowerCase()}`);
}
