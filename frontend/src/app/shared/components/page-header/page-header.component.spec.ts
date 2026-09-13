import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageHeaderComponent } from './page-header.component';

@Component({
  standalone: true,
  imports: [PageHeaderComponent],
  template: `
    <app-page-header [title]="title" [eyebrow]="eyebrow" [purpose]="purpose">
      <div pageActions><button type="button">Add committee</button></div>
    </app-page-header>
  `,
})
class HostComponent {
  title = 'Committees';
  eyebrow: string | null = null;
  purpose: string | null = null;
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
});
