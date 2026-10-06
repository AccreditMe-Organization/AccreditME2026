import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageModule } from 'primeng/message';
import { providePrimeNG } from 'primeng/config';
import { AccreditMePreset } from './accreditme-preset';

@Component({
  standalone: true,
  imports: [MessageModule],
  template: `
    <div style="background: #FFFFFF; padding: 8px">
      <p-message severity="success" text="Your password is set. Sign in to continue." />
      <p-message severity="error" text="Something went wrong." />
      <p-message severity="info" text="You were signed out after a period of inactivity." />
    </div>
  `,
})
class HostComponent {}

/** WCAG 2.2 relative luminance of an `rgb()` / `rgba()` string. */
function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `rgb()`/`rgba()`, or `color(srgb r g b / a)` — what a color-mix() computes to. */
function parse(css: string): { rgb: number[]; alpha: number } {
  const srgb = css.match(/^color\(srgb ([^)]+)\)$/);
  if (srgb) {
    const parts = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
    return { rgb: parts.slice(0, 3).map((c) => c * 255), alpha: parts[3] ?? 1 };
  }
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not a colour this test reads: ${css}`);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { rgb: parts.slice(0, 3), alpha: parts[3] ?? 1 };
}

/** A translucent background composited over the white card it sits on. */
function over(bg: { rgb: number[]; alpha: number }, base = [255, 255, 255]): number[] {
  return bg.rgb.map((c, i) => c * bg.alpha + base[i] * (1 - bg.alpha));
}

const ratio = (a: number[], b: number[]): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ACC-120 slice 9e — the rendered message, measured. check:contrast asserts the
// TOKEN pairs; this asserts PrimeNG actually draws a message with them, which
// it did not: Aura's own success message was 3.15:1.
describe('p-message contrast under the AccreditMe preset (ACC-120 slice 9e)', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  function measure(severity: string): number {
    const root = fixture.nativeElement.querySelector(`.p-message-${severity}`) as HTMLElement;
    const text = root.querySelector('.p-message-text') as HTMLElement;
    const fg = parse(getComputedStyle(text).color);
    const bg = parse(getComputedStyle(root).backgroundColor);
    // Non-vacuity guard: a theme that did not load leaves the background
    // transparent and the text inherited black — which would "pass" on white.
    expect(bg.alpha).withContext(`${severity} background`).toBeGreaterThan(0.5);
    expect(fg.rgb).withContext(`${severity} text`).not.toEqual([0, 0, 0]);
    return ratio(fg.rgb, over(bg));
  }

  for (const severity of ['success', 'error', 'info']) {
    it(`${severity}: text is at least 4.5:1 on the message background`, () => {
      expect(measure(severity)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
