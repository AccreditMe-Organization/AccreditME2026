import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageHeaderComponent } from './page-header.component';
import { PageNameRegistry } from '../../../core/services/document-title.service';

@Component({
  standalone: true,
  imports: [PageHeaderComponent],
  template: `
    <app-page-header [title]="title" [eyebrow]="eyebrow" [purpose]="purpose" [tabTitle]="tabTitle">
      <div pageActions><button type="button">Add committee</button></div>
    </app-page-header>
  `,
})
class HostComponent {
  title = 'Committees';
  eyebrow: string | null = null;
  purpose: string | null = null;
  tabTitle: string | null = null;
}

// ACC-79 — the header's contract: one H1, and nothing rendered for what a page
// does not supply.
describe('PageHeaderComponent (ACC-79)', () => {
  function render(overrides: Partial<HostComponent> = {}): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    Object.assign(fixture.componentInstance, overrides);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  // The page's name is the H1 — the document's one top-level heading, which is
  // what assistive technology jumps to. Pages previously used an h2 with no h1.
  it('renders the title as the single H1', () => {
    const el = render();
    const h1s = el.querySelectorAll('h1');
    expect(h1s.length).toBe(1);
    expect(h1s[0]!.textContent!.trim()).toBe('Committees');
  });

  // Optional means absent, not an empty element holding a line of height.
  it('renders no purpose element at all when the page has no purpose line', () => {
    const el = render({ purpose: null });
    expect(el.querySelector('header p')).toBeNull();
  });

  it('renders the purpose line when one is supplied', () => {
    const el = render({
      purpose: 'Every SLA and due date is counted against this calendar.',
    });
    expect(el.querySelector('header p')!.textContent!.trim()).toContain(
      'Every SLA',
    );
  });

  it('renders no eyebrow element when none is supplied', () => {
    const el = render({ eyebrow: null });
    expect(el.querySelector('header .uppercase')).toBeNull();
  });

  it('renders the eyebrow above the title when supplied', () => {
    const el = render({ eyebrow: 'Quality management' });
    expect(el.querySelector('header .uppercase')!.textContent!.trim()).toBe(
      'Quality management',
    );
  });

  it('projects the page actions', () => {
    const el = render();
    expect(el.querySelector('header button')!.textContent).toContain(
      'Add committee',
    );
  });

  // The browser tab names the page from this H1, so the two cannot disagree —
  // and a record page's tab follows its title when the record loads.
  describe('as the tab title source', () => {
    it('registers its title, follows a change, and releases it when destroyed', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [HostComponent] });
      const registry = TestBed.inject(PageNameRegistry);
      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(registry.entry()?.text).toBe('Committees');

      fixture.componentInstance.title = 'Quality Management Committee';
      fixture.detectChanges();
      expect(registry.entry()?.text).toBe('Quality Management Committee');

      fixture.destroy();
      expect(registry.entry()).toBeNull();
    });

    // Home's H1 is a greeting; its tab must still say which page it is.
    it('registers tabTitle instead of the H1 when one is given', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [HostComponent] });
      const registry = TestBed.inject(PageNameRegistry);
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.title = 'Good morning, Layla';
      fixture.componentInstance.tabTitle = 'Home';
      fixture.detectChanges();

      expect(registry.entry()?.text).toBe('Home');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('h1')!.textContent!.trim(),
      ).toBe('Good morning, Layla');
    });
  });
});
