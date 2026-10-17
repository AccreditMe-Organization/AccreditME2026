import { NgZone } from '@angular/core';
import { CdkScrollable, ScrollDispatcher } from '@angular/cdk/scrolling';
import { Subject } from 'rxjs';

// Moved here unchanged from overlay-select.component.ts (ACC-235), so the row
// menu (am-row-menu) can follow its row when a page or dialog scrolls, as
// OverlaySelectComponent's panel does. CDK's ScrollDispatcher only hears the
// document and what is registered with it, and nothing in this app uses
// [cdkScrollable] (see OverlaySelectComponent's registration note): an
// overlay opened from inside <main> or a dialog body learns of that
// container's scroll only through the manual registration below.

// Minimal object satisfying ScrollDispatcher.register()/deregister()'s real
// RUNTIME contract — verified directly against
// @angular/cdk/fesm2022/scrolling.mjs: register()/deregister() only ever
// call scrollable.elementScrolled(), keyed by object identity in a Map, so
// a lightweight object works exactly as well as a real CdkScrollable
// directive instance here. TypeScript's own .d.ts types register()'s
// parameter as the concrete CdkScrollable class rather than a structural
// interface, so `asScrollable()` below casts through it at the two call
// sites — justified by the verified-minimal runtime contract above, not a
// blind `any` escape hatch.
export interface ManualScrollable {
  elementScrolled(): Subject<Event>;
}

export function asScrollable(manual: ManualScrollable): CdkScrollable {
  return manual as unknown as CdkScrollable;
}

const SCROLLABLE_OVERFLOW = /(auto|scroll)/;

// Mirrors PrimeNG's own DomHandler.getScrollableParents() (primeng-dom.mjs)
// exactly — same computed-style overflow/overflow-x/overflow-y check,
// walking every ancestor. PrimeNG uses this list to bind its own
// close-on-scroll listeners; here it's used to tell CDK's ScrollDispatcher
// which real ancestors exist at all, since nothing does that automatically
// (see the registration note on OverlaySelectComponent).
export function findScrollableAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let parent = element.parentElement;
  while (parent) {
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

export function createManualScrollable(
  element: HTMLElement,
  ngZone: NgZone,
): { scrollable: ManualScrollable; destroy: () => void } {
  const elementScrolled = new Subject<Event>();
  const listener = (event: Event) => elementScrolled.next(event);
  // Matches CdkScrollable's own ngOnInit() pattern (scrolling.mjs) —
  // registered outside the zone since RepositionScrollStrategy's own
  // updatePosition() call is likewise unzoned (a direct inline-style DOM
  // write, not template-bound, so it doesn't need change detection).
  const removeListener = ngZone.runOutsideAngular(() => {
    element.addEventListener('scroll', listener, { passive: true });
    return () => element.removeEventListener('scroll', listener);
  });
  return {
    scrollable: { elementScrolled: () => elementScrolled },
    destroy: () => {
      removeListener();
      elementScrolled.complete();
    },
  };
}

/**
 * Registers every scrollable ancestor of `element` with CDK's
 * ScrollDispatcher, so a reposition scroll strategy hears those containers
 * scroll. Returns the matching deregistration; call it when the overlay closes.
 */
export function registerScrollableAncestors(
  element: HTMLElement,
  dispatcher: ScrollDispatcher,
  ngZone: NgZone,
): () => void {
  const manual = findScrollableAncestors(element).map((ancestor) => createManualScrollable(ancestor, ngZone));
  manual.forEach(({ scrollable }) => dispatcher.register(asScrollable(scrollable)));
  return () =>
    manual.forEach(({ scrollable, destroy }) => {
      dispatcher.deregister(asScrollable(scrollable));
      destroy();
    });
}
