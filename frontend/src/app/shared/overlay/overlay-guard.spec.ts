import { TestBed } from '@angular/core/testing';
import { Overlay, ScrollStrategy } from '@angular/cdk/overlay';
import { provideZonelessChangeDetection } from '@angular/core';
import { assertOverlaySafe, findScrollableAncestors } from './overlay-guard';

describe('overlay guard (ACC-111)', () => {
  let overlay: Overlay;
  let host: HTMLElement;

  const strategies = (): {
    reposition: ScrollStrategy;
    close: ScrollStrategy;
    block: ScrollStrategy;
    noop: ScrollStrategy;
  } => ({
    reposition: overlay.scrollStrategies.reposition({ autoClose: true }),
    close: overlay.scrollStrategies.close(),
    block: overlay.scrollStrategies.block(),
    noop: overlay.scrollStrategies.noop(),
  });

  /** trigger inside `overflow: auto` — the shape a dialog body or list creates. */
  const triggerInsideScrollable = (): HTMLElement => {
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    scroller.style.maxHeight = '100px';
    const trigger = document.createElement('button');
    scroller.appendChild(trigger);
    host.appendChild(scroller);
    return trigger;
  };

  const triggerInPlainFlow = (): HTMLElement => {
    const wrapper = document.createElement('div');
    const trigger = document.createElement('button');
    wrapper.appendChild(trigger);
    host.appendChild(wrapper);
    return trigger;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    overlay = TestBed.inject(Overlay);
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  it('refuses a close strategy inside a scrollable ancestor', () => {
    expect(() =>
      assertOverlaySafe(triggerInsideScrollable(), strategies().close, 'TestOverlay'),
    ).toThrowError(/scrollable ancestor/);
  });

  it('refuses block and noop strategies there too — reposition is the only safe one', () => {
    expect(() =>
      assertOverlaySafe(triggerInsideScrollable(), strategies().block, 'TestOverlay'),
    ).toThrowError(/reposition/);
    expect(() =>
      assertOverlaySafe(triggerInsideScrollable(), strategies().noop, 'TestOverlay'),
    ).toThrowError(/reposition/);
  });

  it('allows the reposition strategy inside a scrollable ancestor — the whole point', () => {
    expect(() =>
      assertOverlaySafe(triggerInsideScrollable(), strategies().reposition, 'TestOverlay'),
    ).not.toThrow();
  });

  // The withdrawn rule was "refuse any scrollable ancestor but the document",
  // which would have rejected a legitimate toolbar overlay on every page whose
  // list scrolls in a container. The STRATEGY is what makes it safe.
  it('allows any strategy when there is no scrollable ancestor to dismiss it', () => {
    expect(() =>
      assertOverlaySafe(triggerInPlainFlow(), strategies().close, 'TestOverlay'),
    ).not.toThrow();
  });

  it('names the offending ancestor and what to do, not just that it failed', () => {
    const trigger = triggerInsideScrollable();
    (trigger.parentElement as HTMLElement).className = 'am-dialog__body pr-1';
    expect(() => assertOverlaySafe(trigger, strategies().close, 'HolidayForm')).toThrowError(
      /HolidayForm.*am-dialog__body.*reposition/s,
    );
  });

  // Found by this spec: body computes to overflow auto in a Karma page, so
  // counting the document scroller would make the guard throw for every
  // overlay on every page that scrolls — the over-reach artboard 7 withdrew.
  it('does not count the document scroller as an inner container', () => {
    document.body.style.overflowY = 'auto';
    expect(() =>
      assertOverlaySafe(triggerInPlainFlow(), strategies().close, 'TestOverlay'),
    ).not.toThrow();
  });

  describe('findScrollableAncestors', () => {
    it('finds an overflow:auto ancestor', () => {
      expect(findScrollableAncestors(triggerInsideScrollable()).length).toBeGreaterThan(0);
    });

    it('ignores ancestors that do not scroll', () => {
      const trigger = triggerInPlainFlow();
      const found = findScrollableAncestors(trigger).filter((el) => host.contains(el));
      expect(found).toEqual([]);
    });
  });
});
