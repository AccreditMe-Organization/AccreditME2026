/**
 * The committee page's panel grid: as many 320px columns as fit, each sharing
 * the rest. ACC-232 — `min(320px, 100%)`, so a column is never wider than the
 * page itself: on a 390px phone, less the page padding, a fixed 320px minimum
 * pushed the panels out and the page scrolled sideways.
 *
 * One value, read by the page and by its layout spec, so the spec measures the
 * grid the page actually draws.
 */
export const COMMITTEE_PANEL_GRID = 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))';
