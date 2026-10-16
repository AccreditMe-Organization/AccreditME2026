/**
 * The user record's panel grid: as many 330px columns as fit. ACC-232 —
 * `min(330px, 100%)`, so a column is never wider than the page: on a phone
 * narrower than about 360px, a fixed 330px minimum scrolled the page sideways.
 *
 * One value, read by the page and by its layout spec.
 */
export const USER_PANEL_GRID = 'repeat(auto-fit, minmax(min(330px, 100%), 1fr))';
