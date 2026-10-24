import { Injectable } from '@angular/core';

/** What the PDF view hears about its pages (ACC-253). */
export interface PdfPageEvents {
  /** Page `n` came within a screen of the view (`true`), or left that band (`false`). */
  near(n: number, isNear: boolean): void;
  /** Page `n` went more than four screens away from the view. */
  far(n: number): void;
  /** How much of each reported page is visible, 0 to 1, one batch at a time. */
  visible(ratios: ReadonlyArray<readonly [n: number, ratio: number]>): void;
}

/** A running watch; `disconnect()` stops every report. */
export interface PdfPageWatch {
  disconnect(): void;
}

/**
 * ACC-253 — where the PDF view learns which pages are near the view. The
 * default is the browser's IntersectionObserver, exactly as the view always
 * used it: three observers rooted at the scroll container (a screen of
 * look-ahead to paint, four screens before a canvas is released, and the
 * visible share of each page for the current page).
 *
 * It is injectable so a spec can say "page n is near the view" itself. A real
 * observer in a headless browser may never report: CI saw "renders asked
 * for: 0" on three PRs while the same order passed locally. What the view
 * DOES with a report stays in the view.
 */
@Injectable({ providedIn: 'root' })
export class PdfPageVisibility {
  watch(scroller: Element | null, pages: readonly Element[], events: PdfPageEvents): PdfPageWatch {
    const pageOf = (entry: IntersectionObserverEntry): number => Number((entry.target as HTMLElement).dataset['page']);
    const nearby = new IntersectionObserver(
      (entries) => {
        for (const e of entries) events.near(pageOf(e), e.isIntersecting);
      },
      { root: scroller, rootMargin: '100% 0px' },
    );
    const far = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (!e.isIntersecting) events.far(pageOf(e));
      },
      { root: scroller, rootMargin: '400% 0px' },
    );
    const visible = new IntersectionObserver(
      (entries) => events.visible(entries.map((e) => [pageOf(e), e.intersectionRatio] as const)),
      { root: scroller, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    const observers = [nearby, far, visible];
    for (const el of pages) {
      for (const o of observers) o.observe(el);
    }
    return {
      disconnect: () => {
        for (const o of observers) o.disconnect();
      },
    };
  }
}
