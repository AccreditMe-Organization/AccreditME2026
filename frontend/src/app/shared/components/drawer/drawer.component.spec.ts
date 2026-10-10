import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { Drawer } from 'primeng/drawer';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { LayerStackService } from '../../overlay/layer-stack.service';
import { DrawerComponent } from './drawer.component';

@Component({
  standalone: true,
  imports: [DrawerComponent],
  template: `
    <am-drawer [visible]="open()" ariaLabel="Hand hygiene audit.pdf" closeLabel="Close viewer" (closeRequested)="closes = closes + 1">
      <span amDrawerHeader>header</span>
      <p>body</p>
    </am-drawer>
  `,
})
class HostComponent {
  readonly open = signal(true);
  closes = 0;
}

describe('DrawerComponent (ACC-189)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let page: HTMLElement;

  async function setup(language: 'en' | 'ar' = 'en', narrow = false) {
    // The 900px breakpoint, decided without resizing the test browser.
    const realMatchMedia = window.matchMedia.bind(window);
    spyOn(window, 'matchMedia').and.callFake((query: string) =>
      query.includes('max-width') ? ({ matches: narrow, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList) : realMatchMedia(query),
    );
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting()],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    // Something else on the page, to be made inert.
    page = document.createElement('div');
    page.id = 'am-test-page';
    document.body.appendChild(page);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const frame = (): HTMLElement => document.body.querySelector('.am-drawer__frame') as HTMLElement;
  const drawer = (): Drawer => fixture.debugElement.query(By.directive(Drawer)).componentInstance as Drawer;

  afterEach(() => {
    fixture?.destroy();
    page?.remove();
    TestBed.inject(TranslateService).use('en');
    document.documentElement.dir = 'ltr';
  });

  it('opens from the END side: right in English, left in Arabic — set by us, not left to PrimeNG', async () => {
    await setup('en');
    expect(drawer().position()).toBe('right');
    TestBed.inject(TranslateService).use('ar');
    fixture.detectChanges();
    expect(drawer().position()).toBe('left');
  });

  it('is a modal dialog named in full, and the mask never closes it', async () => {
    await setup();
    expect(frame().getAttribute('role')).toBe('dialog');
    expect(frame().getAttribute('aria-modal')).toBe('true');
    expect(frame().getAttribute('aria-label')).toBe('Hand hygiene audit.pdf');
    expect(drawer().modal).toBeTrue();
    expect(drawer().dismissible).toBeFalse();
    expect(drawer().closeOnEscape).toBeFalse();
  });

  it('makes the page behind inert while open, and releases it on close', async () => {
    await setup();
    expect(page.hasAttribute('inert')).toBeTrue();
    expect(frame().closest('[inert]')).toBeNull();
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(page.hasAttribute('inert')).toBeFalse();
  });

  it('Expand goes full screen and becomes Restore; it opens at normal width each time', async () => {
    await setup();
    const expand = () => frame().querySelector('[data-am-drawer-expand]') as HTMLButtonElement;
    expect(expand().textContent).toContain('Expand');
    expand().click();
    fixture.detectChanges();
    expect(expand().textContent).toContain('Restore');
    expect(frame().parentElement!.style.width).toBe('100vw');

    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.debugElement.query(By.directive(DrawerComponent)).componentInstance.expanded()).toBeFalse();
  });

  it('below 900px it is always full screen and Expand is hidden', async () => {
    await setup('en', true);
    expect(frame().querySelector('[data-am-drawer-expand]')).toBeNull();
    expect(frame().parentElement!.style.width).toBe('100vw');
  });

  it('Escape asks to close only when it is the TOP layer; the ✕ always does', async () => {
    await setup();
    const layers = TestBed.inject(LayerStackService);
    const above = layers.push();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.componentInstance.closes).toBe(0);
    layers.remove(above);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.componentInstance.closes).toBe(1);
    (frame().querySelector('[data-am-drawer-close]') as HTMLButtonElement).click();
    expect(fixture.componentInstance.closes).toBe(2);
  });
});
