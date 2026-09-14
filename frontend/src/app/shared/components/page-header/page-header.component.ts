import { Component, input } from '@angular/core';
import { registerPageName } from '../../../core/services/document-title.service';

// ACC-79 — the page header, from frontend/design-reference/AccreditMe App
// Shell.dc.html: an optional eyebrow, the H1, an optional one-line purpose,
// and the page's actions beside them.
//
// THE TITLE APPEARS ONCE (UX-04). The breadcrumb is ancestry and stops at the
// parent; this H1 owns the page's own name. A page using this component must
// not also render its name anywhere else in its header area. The same holds for
// the eyebrow: it must never repeat the last breadcrumb crumb.
//
// Inputs are ALREADY-TRANSLATED strings, not translation keys. A record page's
// title is tenant data — a committee's own name — which SYSTEM-REFERENCE §9.3
// requires be rendered by isArabic() selection, never through `| translate`.
//
// Actions are PROJECTED, not configured: `<div pageActions>…</div>`. They are
// real buttons with real handlers, and a config API would only re-describe them.
//
// ─────────────────────────────────────────────────────────────────────────────
// PURPOSE IS OPTIONAL, AND MOST PAGES SHOULD NOT HAVE ONE.
//
// The reference itself sets it on only four pages; every ordinary page is null.
// Checked against eight of this app's pages during ACC-79, four earned a line.
// Write one only if it passes BOTH tests:
//
//   1. It tells the reader something neither the title nor the page shows.
//      "Committees — the governance bodies in this organization" restates the
//      title. "Home — your open work and recent activity" describes what is
//      directly below. Both are worse than no line: they cost a line of height
//      and teach readers to skip the subtitle on the pages where it matters.
//
//   2. It states a DURABLE rule or consequence, not the page's contents.
//      "Every SLA and due date is counted against this calendar" stays true
//      until the architecture changes. "Plans and status for every tenant"
//      goes false the day someone adds a column — the stale-promise pattern in
//      SYSTEM-REFERENCE §10.10, where a string asserting something about the
//      product decays when the product changes and nothing fails.
//
// If a line needs updating whenever the page gains a feature, it fails test 2.
// ─────────────────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-page-header',
  standalone: true,
  template: `
    <header class="flex flex-wrap items-end justify-between gap-3 pb-3">
      <div class="min-w-0">
        @if (eyebrow()) {
          <div
            class="mb-[3px] text-[11px] font-bold tracking-[0.08em] uppercase text-[var(--am-text-secondary)]"
          >
            {{ eyebrow() }}
          </div>
        }
        <h1
          class="m-0 text-[22px] font-semibold tracking-[-0.01em] text-pretty text-[var(--am-text-primary)]"
        >
          {{ title() }}
        </h1>
        @if (purpose()) {
          <p
            class="mt-[3px] mb-0 max-w-[92ch] text-[12.5px] text-pretty text-[var(--am-text-secondary)]"
          >
            {{ purpose() }}
          </p>
        }
      </div>

      <!-- Wraps under the title on a narrow screen rather than squeezing it. -->
      <div class="flex flex-wrap items-center gap-2">
        <ng-content select="[pageActions]" />
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly eyebrow = input<string | null>(null);
  readonly purpose = input<string | null>(null);
  // The name for the browser tab, when the H1 is not a name. Home is the case:
  // its H1 is a greeting, and a tab reading "Good morning, Layla" says nothing
  // about which page it is.
  readonly tabTitle = input<string | null>(null);

  // The browser tab reads this H1 (DocumentTitleService), so a tab and its
  // page say the same thing, and a record page's tab names the record. An
  // effect underneath, because a record page's title arrives when the record
  // loads.
  constructor() {
    registerPageName(() => this.tabTitle() || this.title());
  }
}
