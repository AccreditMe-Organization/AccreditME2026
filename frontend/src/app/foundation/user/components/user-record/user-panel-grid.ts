import { CAPPED_PANEL_BODY_PX } from '../../../../shared/components/capped-panel/capped-panel.component';

/**
 * The user record's panel grid: as many 330px columns as fit. ACC-232 —
 * `min(330px, 100%)`, so a column is never wider than the page: on a phone
 * narrower than about 360px, a fixed 330px minimum scrolled the page sideways.
 *
 * One value, read by the page and by its layout spec.
 */
export const USER_PANEL_GRID = 'repeat(auto-fit, minmax(min(330px, 100%), 1fr))';

/** The Two-step sign-in panel's own body height, when it is alone in its row. */
export const TWO_STEP_BODY_PX = 120;

/**
 * ACC-216 (design review of #331) — whether the Two-step card (yours or someone
 * else's) and the Signed-in devices card are both shown and sit in ONE row of the
 * panel grid, read from the grid as laid out. A panel hidden by a refused read
 * (display: none) is not in any row.
 */
export function twoStepSharesRowWithSessions(grid: HTMLElement): boolean {
  const sessions = grid.querySelector<HTMLElement>(':scope > [data-panel="sessions"]');
  const twoStep = grid.querySelector<HTMLElement>(':scope > [data-panel="twoStep"], :scope > [data-panel="twoStepOther"]');
  if (!sessions || !twoStep || !sessions.getClientRects().length || !twoStep.getClientRects().length) return false;
  return Math.abs(sessions.getBoundingClientRect().top - twoStep.getBoundingClientRect().top) < 1;
}

/** The Two-step body: the capped panel's while beside the devices card, its own 120 alone. */
export function twoStepBodyPx(besideSessions: boolean, rtl: boolean): number {
  if (!besideSessions) return TWO_STEP_BODY_PX;
  return rtl ? CAPPED_PANEL_BODY_PX.rtl : CAPPED_PANEL_BODY_PX.ltr;
}

/**
 * Tells `onChange` whether the two cards share a row, now and whenever the grid
 * resizes (a width change, a panel arriving or hidden). Returns the disconnect.
 */
export function observeTwoStepRow(grid: HTMLElement, onChange: (besideSessions: boolean) => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const observer = new ResizeObserver(() => onChange(twoStepSharesRowWithSessions(grid)));
  observer.observe(grid);
  return () => observer.disconnect();
}
