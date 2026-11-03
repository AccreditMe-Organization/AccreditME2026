/**
 * The zoom rule a scaled picture shares (the org chart, ACC-120 slice 11; the
 * workflow strip, ACC-271 PR 5b): steps of 10%, from 30% to 150%, and Fit
 * shows the whole picture in the area's width, never above 100%.
 *
 * The picture is a CSS scale inside a wrapper sized to the scaled picture, so
 * the scroll area always measures what is drawn. `natural` is the picture's
 * own width, unscaled (a transform does not change offsetWidth).
 */
export const ZOOM = { min: 0.3, max: 1.5, step: 0.1 } as const;

/** A zoom rounded to whole percent and held between `min` and the maximum. */
export function clampZoom(zoom: number, min: number = ZOOM.min): number {
  return Math.min(ZOOM.max, Math.max(min, Math.round(zoom * 100) / 100));
}

/** The zoom that fits a picture `natural` wide into `inner`, never above 100%; rounded down, so it never overflows. */
export function fitZoom(inner: number, natural: number): number {
  return Math.floor(Math.min(1, inner / natural) * 100) / 100;
}

/** An element's width inside its inline padding: the room a picture has. */
export function innerInlineSize(area: HTMLElement): number {
  const style = getComputedStyle(area);
  return area.clientWidth - parseFloat(style.paddingInlineStart || '0') - parseFloat(style.paddingInlineEnd || '0');
}
