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

/**
 * The header grid above the panels: the lifecycle stepper (which spans two
 * columns) and its history, 340px columns. Same rule as the panel grid, for
 * the same reason: at 320px a fixed 340px minimum was 48px wider than the page.
 */
export const COMMITTEE_HEADER_GRID = 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))';
