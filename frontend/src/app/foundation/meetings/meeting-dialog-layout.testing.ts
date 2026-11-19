import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { LanguageService } from '../../core/services/language.service';
import { MeetingService } from './services/meeting.service';

/**
 * ACC-316 PR 6 — the measuring steps the meeting dialogs' layout specs share
 * (the remove-member layout spec's, ACC-298): open a host in the real theme and
 * font, wait for PrimeNG's open motion to stop, then measure the body against
 * the 420px cap with 20px of room, and find anything in it that scrolls.
 * Test support only: imported by *.layout.spec.ts and nothing else.
 */
export const CAP = 420;
export const ROOM = 20;
export const FLOOR = 60;
export const WIDTHS = [1280, 390] as const;
export type Width = (typeof WIDTHS)[number];

export class DialogLayout<H> {
  fixture!: ComponentFixture<H>;
  readonly measured: string[] = [];

  async open(host: Type<H>, language: 'en' | 'ar', width: Width, meetings: Partial<MeetingService>, setup?: (host: H) => void): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [host],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: MeetingService, useValue: meetings },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    this.fixture = TestBed.createComponent(host);
    setup?.(this.fixture.componentInstance);
    document.body.appendChild(this.fixture.nativeElement);
    this.fixture.autoDetectChanges(true);
    await this.settle();
    if (width === 390) this.frame().style.width = '390px';
    await this.still();
  }

  destroy(): void {
    document.querySelectorAll('.p-dialog-mask, .p-dialog, .cdk-overlay-container').forEach((n) => n.remove());
    this.fixture?.destroy();
  }

  async settle(): Promise<void> {
    await this.fixture.whenStable();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  body(): HTMLElement {
    return document.querySelector<HTMLElement>('.am-dialog__body')!;
  }

  frame(): HTMLElement {
    return document.querySelector<HTMLElement>('.p-dialog')!;
  }

  /** Boxes are read once PrimeNG's open motion has stopped (it scales the frame). */
  async still(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const f = this.frame();
      if (f && Math.abs(f.getBoundingClientRect().width - f.offsetWidth) <= 0.01) return this.settle();
      await new Promise((r) => setTimeout(r, 20));
    }
    fail('the dialog never stopped animating');
  }

  async click(selector: string): Promise<void> {
    const el = document.querySelector<HTMLElement>(selector);
    expect(el).withContext(`${selector} not found`).not.toBeNull();
    el!.click();
    await this.settle();
    await this.still();
  }

  /** A body: laid out, under the cap with the room, the expected width, and scrolling nowhere but `allow`. */
  check(label: string, language: string, width: Width, expectedWidth: number, allow: HTMLElement[] = []): number {
    const b = this.body();
    expect(b).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    const height = b.scrollHeight;
    const drawn = Math.round(this.frame().getBoundingClientRect().width);
    this.measured.push(`${label} [${language}, ${width}]: body ${height}px, room ${CAP - height}px, dialog ${drawn}px wide`);
    expect(height).withContext(`${label} [${language}, ${width}] not laid out`).toBeGreaterThan(FLOOR);
    expect(drawn).withContext(`${label} [${language}] dialog width`).toBe(width === 390 ? 390 : expectedWidth);
    expect(CAP - height).withContext(`${label} [${language}, ${width}] body ${height}px leaves under ${ROOM}px`).toBeGreaterThanOrEqual(ROOM);
    const scrollers = Array.from(b.querySelectorAll<HTMLElement>('*'))
      .filter((n) => !allow.includes(n))
      .filter((n) => n.scrollHeight > n.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(n).overflowY));
    expect(scrollers.map((n) => `${n.tagName}.${n.className} ${n.scrollHeight}/${n.clientHeight}`))
      .withContext(`${label} [${language}, ${width}] something scrolls`)
      .toEqual([]);
    expect(b.scrollWidth).withContext(`${label} [${language}, ${width}] nothing runs sideways`).toBeLessThanOrEqual(b.clientWidth + 1);
    return height;
  }
}
