import { Component, computed, input } from '@angular/core';

// Extracts the card pattern that was already duplicated inline in
// settings-hub.component.ts (p-4 rounded-md bg-[var(--am-card)] border
// border-[var(--am-border)]) — see step-15-design-foundation.md Section 1.
@Component({
  selector: 'app-card',
  standalone: true,
  template: `
    <div [class]="containerClasses()">
      <ng-content />
    </div>
  `,
})
export class CardComponent {
  // Adds the hover-border-highlight + pointer cursor treatment already used
  // for clickable settings-hub cards — false renders a static, non-interactive card.
  readonly linkable = input(false);

  readonly containerClasses = computed(() => {
    const base = 'p-4 rounded-md bg-[var(--am-card)] border border-[var(--am-border)] transition-colors';
    return this.linkable() ? `${base} hover:border-[var(--am-blue-primary)] cursor-pointer` : base;
  });
}
