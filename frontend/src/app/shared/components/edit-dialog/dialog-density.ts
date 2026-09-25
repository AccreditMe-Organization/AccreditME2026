import { InjectionToken, Signal } from '@angular/core';

/**
 * ACC-120 slice 2 — Design System Rev 7, artboard 13.
 *
 * A SECOND DENSITY FOR CROWDED DIALOGS, and the finding behind it: the space is
 * in the slots and the gaps, not in the type. A standard field block is 75px,
 * of which 36 is the control and 39 is label, gaps and a reserved message slot.
 * Compact recovers 23px of that 39 **without touching a single type size**.
 *
 * | | form | compact |
 * | -- | -- | -- |
 * | label → control | 4 | 2 |
 * | control height | 36 | 32 |
 * | control → message | 4 | 2 |
 * | message slot | 17 always | 17 or 0 |
 * | field gap | 12 | 8 |
 * | block, can message | 75 | 71 |
 * | block, cannot | 75 | **52** — the real saving |
 * | two-column grid | col gap 12 | col gap 8 |
 *
 * **Type size is the obvious lever and it is the wrong one.** Latin label 12px
 * already sits at the floor that keeps its Arabic sibling at 13px, so an 11px
 * Latin label forces Arabic to 12px — below the floor — and the two languages
 * would then need different control heights. That is a separate RTL geometry,
 * which this system does not permit.
 *
 * NOT SCALED BY DENSITY, ever: the inline calendar (28×28 cells, 258px — it sits
 * at the WCAG target floor plus 4px), icon-button targets (32×32), and every
 * type size. Density changes the geometry AROUND controls, never the controls'
 * reach or their legibility.
 *
 * ## When it applies — a measurement, not taste
 *
 * A WHOLE DIALOG is compact when its standard-density body would exceed the
 * 420px cap, or when it holds FIVE OR MORE field blocks. Never mixed inside one
 * dialog: two field rhythms in one form reads as a rendering fault.
 *
 * ## Why a DI token rather than a CSS attribute selector
 *
 * Only `EditDialogComponent` provides this token, so compact density is
 * STRUCTURALLY UNABLE TO REACH A PAGE. Artboard 13 forbids it on pages, record
 * panels and settings sections — they are read far more than edited and have no
 * cap to defend — and a `data-density` attribute could be hand-written onto any
 * element by anyone. With the token, a field outside a dialog cannot inject it
 * and falls back to form density. That matters for the slices after this one:
 * the workflow stage and transition editors are page panels, not dialogs, and
 * the permissions matrix is a page.
 *
 * The shell also reflects `data-density` onto its root, for styling and so a
 * browser pass can read the density off the DOM — but the attribute follows the
 * token, never the other way round.
 */
export type DialogDensity = 'form' | 'compact';

export const DIALOG_DENSITY = new InjectionToken<Signal<DialogDensity>>(
  'DIALOG_DENSITY',
);
