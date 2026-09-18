import { isDevMode } from '@angular/core';
import { RepositionScrollStrategy, ScrollStrategy } from '@angular/cdk/overlay';

/**
 * The overlay guard (ACC-111, artboard 7).
 *
 * An overlay anchored inside a scrollable ancestor must use CDK's reposition
 * scroll strategy. Anything else — PrimeNG's connected overlays, or a CDK
 * overlay configured with `close` or `block` — is dismissed or misplaced the
 * moment that ancestor scrolls. That is the platform fault artboard 7 exists
 * to make unreachable, and it is the reason `OverlaySelectComponent` exists
 * (SYSTEM-REFERENCE §10.7).
 *
 * The rule the design states is "refuse to mount inside a scrollable ancestor
 * unless using the reposition strategy, and throw in development". Note what
 * it does NOT say: the earlier wording was "refuse any scrollable ancestor but
 * the document", which would reject a legitimate toolbar overlay on every page
 * whose list scrolls in a container — the strategy is what makes it safe, not
 * the absence of a scrolling parent.
 *
 * ## Why it throws in development only
 *
 * A wrong strategy is a defect the developer who wrote it must see, and a
 * thrown error in `ng serve` or a spec is unmissable. In production the same
 * throw would replace a working-but-twitchy dropdown with a blank screen,
 * which is worse for the user in front of it. So: loud where it can be fixed,
 * silent where it cannot.
 *
 * ## What it cannot cover
 *
 * Only overlays WE construct. A raw `p-select`, `p-datepicker` or
 * `p-overlaypanel` builds its own overlay inside PrimeNG, and patching PrimeNG
 * to satisfy our rule would be worse than the rule. Those are caught
 * statically instead, by `scripts/check-dialog-overlays.mjs`.
 */

const SCROLLABLE_OVERFLOW = /(auto|scroll)/;

/**
 * Every scrollable ancestor of `element`, nearest first. Mirrors PrimeNG's own
 * `DomHandler.getScrollableParents()` (primeng-dom.mjs) so that what the guard
 * considers scrollable is exactly what PrimeNG would close on.
 */
export function findScrollableAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let parent = element.parentElement;
  while (parent) {
    // The DOCUMENT scroller is not an inner container, and excluding it is the
    // difference between the design's current rule and the one it withdrew.
    // body/html frequently compute to overflow auto, so counting them would
    // make the guard throw for every overlay on every page that scrolls at
    // all — which is exactly the "refuse any scrollable ancestor but the
    // document" phrasing artboard 7 replaced. Rev 4 goes further and REQUIRES
    // some pages (the stage and transition editors) to scroll as the document
    // precisely so no inner container exists to dismiss an overlay.
    if (parent === document.body || parent === document.documentElement) {
      parent = parent.parentElement;
      continue;
    }
    const style = window.getComputedStyle(parent);
    if (
      SCROLLABLE_OVERFLOW.test(style.overflow) ||
      SCROLLABLE_OVERFLOW.test(style.overflowX) ||
      SCROLLABLE_OVERFLOW.test(style.overflowY)
    ) {
      ancestors.push(parent);
    }
    parent = parent.parentElement;
  }
  return ancestors;
}

function describe(element: HTMLElement): string {
  const classes = typeof element.className === 'string' ? element.className.trim() : '';
  return classes ? `${element.tagName.toLowerCase()}.${classes.split(/\s+/).slice(0, 3).join('.')}` : element.tagName.toLowerCase();
}

/**
 * Throws in development when `trigger` sits inside a scrollable ancestor and
 * `scrollStrategy` is not CDK's reposition strategy.
 *
 * The strategy is checked by INSTANCE, not by a caller-supplied flag: a flag
 * records what someone believed when they wrote it, and stays true after a
 * later edit changes the strategy underneath it.
 */
export function assertOverlaySafe(
  trigger: HTMLElement,
  scrollStrategy: ScrollStrategy,
  context: string,
): void {
  if (!isDevMode()) return;
  if (scrollStrategy instanceof RepositionScrollStrategy) return;

  const ancestors = findScrollableAncestors(trigger);
  if (ancestors.length === 0) return;

  throw new Error(
    `${context}: overlay mounted inside a scrollable ancestor (${ancestors
      .map(describe)
      .join(', ')}) without CDK's reposition scroll strategy. That ancestor's ` +
      `first scroll dismisses or misplaces the panel. Use ` +
      `overlay.scrollStrategies.reposition({ autoClose: true }) — see ` +
      `SYSTEM-REFERENCE §10.7 and artboard 7 of the design system.`,
  );
}
