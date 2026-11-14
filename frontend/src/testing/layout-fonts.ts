import { ComponentFixture } from '@angular/core/testing';

/**
 * ACC-305 — a layout spec measures in the REAL font, never a fallback.
 *
 * The app's text is IBM Plex Sans Arabic, self-hosted (src/styles/fonts.css):
 * four weights, each split into a Latin and an Arabic file by unicode-range.
 * Until a file arrives, text is laid out in the next font of
 * `--am-font-family` — `system-ui`, which is Segoe UI on Windows and a wider
 * face on a Linux CI runner. A spec that measured before the font arrived
 * passed on Windows and failed on CI (set-acting-head, 494 vs 488).
 *
 * Call `useLayoutFonts()` at the top of every describe that measures layout
 * (getBoundingClientRect, offset*, scroll*, client*), like
 * `preserveDocumentLanguage()`:
 *
 *   describe('…', () => {
 *     useLayoutFonts({ rtl: true });
 *
 * It registers a `beforeAll`, not a wait inside one test: Jasmine shuffles the
 * tests in a file, so a wait inside one test does not cover the tests that run
 * before it. The font set belongs to the page, so once loaded it stays loaded.
 *
 * The hook carries its own timeout (LAYOUT_FONTS_TIMEOUT_MS), so no call site
 * can forget it: a browser fetches at most six files at once, so a slow font
 * server delivers the eight Plex files in two waves, and that outlasts
 * Jasmine's 5-second default.
 *
 * `document.fonts.ready` alone is NOT enough, and that is why each weight is
 * asked for by name: `ready` resolves whenever nothing is loading — which is
 * also true before any text has asked for a weight, so it can wait for nothing.
 * `document.fonts.load()` requests the files themselves.
 *
 * Then it CHECKS, so a spec that measures in a fallback font fails on any
 * machine, with the weight named, instead of passing wherever the fallback
 * happens to fit (`check:layout-spec-fonts` makes every measuring spec call it).
 */
const FAMILY = '"IBM Plex Sans Arabic"';

/** Every weight src/styles/fonts.css declares, and the app uses (700: micro). */
export const LAYOUT_FONT_WEIGHTS = [400, 500, 600, 700] as const;

/** A Latin and an Arabic character: each script is its own font file. */
const LATIN_SAMPLE = 'a';
const ARABIC_SAMPLE = 'ع';

export interface LayoutFontOptions {
  /** Also the Arabic files, for a spec that measures right-to-left / Arabic text. */
  rtl?: boolean;
  /** Render this fixture first (detectChanges, whenStable), when there is one. */
  fixture?: ComponentFixture<unknown>;
}

const specs = (rtl: boolean): { font: string; text: string; label: string }[] =>
  LAYOUT_FONT_WEIGHTS.flatMap((weight) => [
    { font: `${weight} 13px ${FAMILY}`, text: LATIN_SAMPLE, label: `${weight}` },
    ...(rtl ? [{ font: `${weight} 13px ${FAMILY}`, text: ARABIC_SAMPLE, label: `${weight} (Arabic)` }] : []),
  ]);

/**
 * The check alone: fails, naming the weight, for every weight not loaded.
 * `layoutFontsReady()` ends with it; on its own it waits for nothing.
 */
export function expectLayoutFonts(options: LayoutFontOptions = {}): void {
  for (const { font, text, label } of specs(options.rtl ?? false)) {
    expect(document.fonts.check(font, text))
      .withContext(`measured in a fallback font: ${label}`)
      .toBeTrue();
  }
}

/** The font hook's own budget; without a slow server the fonts take milliseconds. */
export const LAYOUT_FONTS_TIMEOUT_MS = 20_000;

/**
 * THE way a measuring spec waits for its font: call it at the top of the
 * describe that measures. `check:layout-spec-fonts` requires it.
 */
export function useLayoutFonts(options: LayoutFontOptions = {}): void {
  beforeAll(() => layoutFontsReady(options), LAYOUT_FONTS_TIMEOUT_MS);
}

/** Loads every weight the layout uses, waits for it, then checks it. */
export async function layoutFontsReady(options: LayoutFontOptions = {}): Promise<void> {
  if (options.fixture) {
    options.fixture.detectChanges();
    await options.fixture.whenStable();
  }
  await document.fonts.ready;
  await Promise.all(specs(options.rtl ?? false).map(({ font, text }) => document.fonts.load(font, text)));
  await document.fonts.ready;
  expectLayoutFonts(options);
}
