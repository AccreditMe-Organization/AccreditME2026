import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { LayerStackService } from '../../overlay/layer-stack.service';
import {
  AmConfirmOptions,
  AmConfirmService,
  CONFIRM_ACCEPT_CLASS,
  CONFIRM_DESTRUCTIVE_CLASS,
  CONFIRM_REJECT_CLASS,
} from './am-confirm.service';
import { ConfirmHostComponent } from './confirm-host.component';

/**
 * ACC-120 slice 10 — what `tone` decides, and what every confirm now gets.
 *
 * Rendered with the REAL host and the real PrimeNG dialog, in a real browser,
 * because each claim here is about the page: which button is filled, which one
 * has focus, where focus goes on close, and whether a layer is held. The row
 * menu is plain markup shaped like the CDK menu's (a trigger with
 * aria-controls naming a [role=menu]), since that shape is all the helper
 * reads.
 */
@Component({
  standalone: true,
  imports: [ConfirmHostComponent],
  template: `
    <button id="opener" type="button">Deactivate</button>
    <button id="elsewhere" type="button">Elsewhere</button>
    <button id="dots" type="button" aria-controls="row-menu-1">⋯</button>
    @if (menuOpen) {
      <div role="menu" id="row-menu-1">
        <button id="menu-item" type="button" role="menuitem">Deactivate</button>
      </div>
    }
    <am-confirm-host />
  `,
})
class HostComponent {
  readonly confirm = inject(AmConfirmService);
  menuOpen = true;
}

describe('AmConfirmService.ask() (ACC-120 slice 10)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let layers: LayerStackService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'en' }), providePrimeNG({}), ConfirmationService],
    });
    TestBed.inject(TranslateService).setTranslation('en', { common: { cancel: 'Cancel', close: 'Close' } });
    TestBed.inject(TranslateService).use('en');
    layers = TestBed.inject(LayerStackService);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.querySelectorAll('.p-confirmdialog, .p-dialog-mask').forEach((n) => n.remove());
  });

  const confirmEl = (): HTMLElement | null => document.querySelector<HTMLElement>('.p-confirmdialog');
  const accept = (): HTMLButtonElement => confirmEl()!.querySelector<HTMLButtonElement>(`button.${CONFIRM_ACCEPT_CLASS}`)!;
  const reject = (): HTMLButtonElement => confirmEl()!.querySelector<HTMLButtonElement>(`button.${CONFIRM_REJECT_CLASS}`)!;
  const el = (id: string): HTMLElement => document.getElementById(id)!;

  // ACC-248 — bounded by polling TURNS, not by the wall clock. What this waits
  // for (PrimeNG's enter and leave motion, then focus) runs on CSS time, and
  // a loaded machine stretched it past the old 2 s budget: "timed out waiting
  // for the confirm to open" (20 Oct). Counting turns still catches a hang,
  // but a slow machine is no longer mistaken for one.
  async function until(condition: () => boolean, what: string, turns = 100): Promise<void> {
    for (let turn = 0; !condition(); turn++) {
      if (turn >= turns) throw new Error(`timed out waiting for ${what}`);
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function ask(overrides: Partial<AmConfirmOptions> = {}, focusFirst = 'opener'): Promise<void> {
    el(focusFirst).focus();
    fixture.componentInstance.confirm.ask({
      tone: 'destructive',
      header: 'Deactivate this role?',
      message: 'Nobody holding it keeps what it grants.',
      acceptLabel: 'Deactivate role',
      accept: () => undefined,
      ...overrides,
    });
    fixture.detectChanges();
    await until(() => !!confirmEl() && confirmEl()!.contains(document.activeElement), 'the confirm to open and take focus');
  }

  async function closed(): Promise<void> {
    await until(() => !confirmEl(), 'the confirm to close');
    // returnFocus runs on the next task, after PrimeNG's own teardown.
    await new Promise((r) => setTimeout(r, 30));
  }

  // NON-VACUITY FIRST: every assertion below reads buttons by class, and would
  // pass for the wrong reason if nothing rendered or the classes never landed.
  it('renders the confirm with exactly an action and a Cancel, labelled as asked', async () => {
    await ask();
    expect(confirmEl()).not.toBeNull();
    expect(accept()).withContext('the action button carries its class').not.toBeNull();
    expect(reject()).withContext('the Cancel button carries its class').not.toBeNull();
    expect(accept().textContent!.trim()).toBe('Deactivate role');
    expect(reject().textContent!.trim()).toBe('Cancel');
    expect(confirmEl()!.querySelector('.p-confirmdialog-icon')).withContext('no icon').toBeNull();
  });

  describe('tone decides the buttons and the focus', () => {
    it('destructive: the action is filled danger, Cancel is a text button, and Cancel has focus', async () => {
      await ask({ tone: 'destructive' });
      expect(accept().classList).toContain(CONFIRM_DESTRUCTIVE_CLASS);
      expect(reject().classList).toContain('p-button-text');
      expect(accept().classList).not.toContain('p-button-text');
      expect(document.activeElement).toBe(reject());
    });

    it('destructive: the filled red is the AA danger ink with white text, not PrimeNG’s own red', async () => {
      await ask({ tone: 'destructive' });
      // --am-danger-ink #B42318 and --am-surface-raised #FFFFFF; PrimeNG's
      // danger is #EF4444, which fails AA with white.
      expect(getComputedStyle(accept()).backgroundColor).toBe('rgb(180, 35, 24)');
      expect(getComputedStyle(accept()).color).toBe('rgb(255, 255, 255)');
    });

    it('neutral: the action is filled primary (no danger class), Cancel is a text button, and the action has focus', async () => {
      await ask({ tone: 'neutral', acceptLabel: 'Reactivate' });
      expect(accept().classList).not.toContain(CONFIRM_DESTRUCTIVE_CLASS);
      expect(accept().classList).not.toContain('p-button-text');
      expect(reject().classList).toContain('p-button-text');
      expect(document.activeElement).toBe(accept());
    });

    it('a custom Cancel label replaces Cancel and keeps the text style', async () => {
      await ask({ rejectLabel: 'Keep handover' });
      expect(reject().textContent!.trim()).toBe('Keep handover');
      expect(reject().classList).toContain('p-button-text');
    });

    it('is 420 wide (the confirm token), capped to the screen', async () => {
      await ask();
      const frame = confirmEl()!;
      expect(frame.style.width).toContain('--am-dialog-confirm');
      // Measured, not read back: the token is 420px, and the cap leaves a 16px
      // gutter each side on a narrow screen.
      const token = getComputedStyle(document.documentElement).getPropertyValue('--am-dialog-confirm').trim();
      expect(token).toBe('420px');
      expect(Math.round(frame.getBoundingClientRect().width)).toBe(Math.min(420, window.innerWidth - 32));
    });
  });

  describe('required labels', () => {
    for (const [field, value] of [
      ['acceptLabel', ''],
      ['acceptLabel', '   '],
      ['header', ''],
      ['message', ''],
    ] as const) {
      it(`refuses a blank ${field}, before pushing a layer or opening anything`, () => {
        expect(() =>
          fixture.componentInstance.confirm.ask({
            tone: 'neutral',
            header: 'H',
            message: 'M',
            acceptLabel: 'Do it',
            accept: () => undefined,
            [field]: value,
          }),
        ).toThrowError(new RegExp(field === 'acceptLabel' ? 'acceptLabel is required' : 'header and message are required'));
        expect(layers.depth()).toBe(0);
        fixture.detectChanges();
        expect(confirmEl()).toBeNull();
      });
    }
  });

  describe('a layer for as long as it is open', () => {
    it('pushes one layer on open, which is the top layer', async () => {
      const under = layers.push();
      await ask();
      expect(layers.depth()).toBe(2);
      expect(layers.isTop(under)).withContext('the layer under the confirm no longer owns Escape').toBeFalse();
      layers.remove(under);
    });

    it('releases it on accept, and runs accept once', async () => {
      const spy = jasmine.createSpy('accept');
      await ask({ accept: spy });
      accept().click();
      await closed();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(layers.depth()).toBe(0);
    });

    it('releases it on Cancel, and runs reject', async () => {
      const spy = jasmine.createSpy('reject');
      await ask({ reject: spy });
      reject().click();
      await closed();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(layers.depth()).toBe(0);
    });

    it('releases it on Escape', async () => {
      await ask();
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await closed();
      expect(layers.depth()).toBe(0);
    });
  });

  describe('focus back on close', () => {
    it('returns to the button that opened it, after Cancel', async () => {
      await ask();
      reject().click();
      await closed();
      expect(document.activeElement).toBe(el('opener'));
    });

    it('returns to it after the action too', async () => {
      await ask({ tone: 'neutral' });
      accept().click();
      await closed();
      expect(document.activeElement).toBe(el('opener'));
    });

    it('returns to the opener passed in, over whatever had focus', async () => {
      await ask({ opener: el('elsewhere') });
      reject().click();
      await closed();
      expect(document.activeElement).toBe(el('elsewhere'));
    });

    it('from a row-menu item, which is gone once the menu closes, returns to that row’s ⋯', async () => {
      await ask({}, 'menu-item');
      fixture.componentInstance.menuOpen = false;
      fixture.detectChanges();
      expect(document.getElementById('menu-item')).withContext('the menu item is gone').toBeNull();
      reject().click();
      await closed();
      expect(document.activeElement).toBe(el('dots'));
    });

    it('leaves focus where the action put it', async () => {
      await ask({ tone: 'neutral', accept: () => el('elsewhere').focus() });
      accept().click();
      await closed();
      expect(document.activeElement).toBe(el('elsewhere'));
    });
  });
});
