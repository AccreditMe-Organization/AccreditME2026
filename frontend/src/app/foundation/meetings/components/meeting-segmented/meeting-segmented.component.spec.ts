import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MeetingSegmentedComponent, type SegmentedOption } from './meeting-segmented.component';

// ACC-316 PR 8a — the segmented control is a radio group: one segment in the
// Tab order, the arrow keys move AND choose, in the reading direction.
@Component({
  standalone: true,
  imports: [MeetingSegmentedComponent],
  template: `<div [attr.dir]="dir()"><am-meeting-segmented [options]="options" [(value)]="value" ariaLabel="Ends" /></div>`,
})
class Host {
  readonly options: SegmentedOption<'ON' | 'AFTER' | 'NEVER'>[] = [
    { value: 'ON', label: 'On a date' },
    { value: 'AFTER', label: 'After' },
    { value: 'NEVER', label: 'Never' },
  ];
  readonly value = signal<'ON' | 'AFTER' | 'NEVER' | null>('AFTER');
  readonly dir = signal<'ltr' | 'rtl'>('ltr');
}

describe('MeetingSegmentedComponent (ACC-316 PR 8a)', () => {
  function create(dir: 'ltr' | 'rtl' = 'ltr') {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.dir.set(dir);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    const radios = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const key = (el: HTMLElement, k: string) => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      fixture.detectChanges();
    };
    return { fixture, radios, key, host: fixture.componentInstance };
  }

  afterEach(() => document.querySelectorAll('[ng-version], div[dir]').forEach((n) => n.parentElement === document.body && n.remove()));

  it('is a radio group with the chosen segment checked and alone in the Tab order', () => {
    const { radios } = create();
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios().map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(radios()[0]!.closest('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Ends');
  });

  it('a click chooses', () => {
    const { radios, host, fixture } = create();
    radios()[0]!.click();
    fixture.detectChanges();
    expect(host.value()).toBe('ON');
  });

  it('arrows move and choose, wrapping; Home and End go to the ends', () => {
    const { radios, key, host } = create();
    key(radios()[1]!, 'ArrowRight');
    expect(host.value()).toBe('NEVER');
    expect(document.activeElement).toBe(radios()[2]!);
    key(radios()[2]!, 'ArrowRight');
    expect(host.value()).withContext('wraps').toBe('ON');
    key(radios()[0]!, 'End');
    expect(host.value()).toBe('NEVER');
    key(radios()[2]!, 'Home');
    expect(host.value()).toBe('ON');
  });

  it('in Arabic, the left arrow moves forward: the reading direction', () => {
    const { radios, key, host } = create('rtl');
    key(radios()[1]!, 'ArrowLeft');
    expect(host.value()).toBe('NEVER');
    key(radios()[2]!, 'ArrowRight');
    expect(host.value()).toBe('AFTER');
  });
});
