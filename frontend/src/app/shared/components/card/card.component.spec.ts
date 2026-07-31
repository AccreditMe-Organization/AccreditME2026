import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CardComponent } from './card.component';

@Component({
  standalone: true,
  imports: [CardComponent],
  template: `<app-card [linkable]="linkable"><span>projected content</span></app-card>`,
})
class HostComponent {
  linkable = false;
}

describe('CardComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('projects its content', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('projected content');
  });

  it('renders the static card classes without the hover/pointer treatment by default', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const div: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(div.className).toContain('bg-[var(--am-card)]');
    expect(div.className).not.toContain('cursor-pointer');
  });

  it('adds the hover-border and pointer treatment when linkable', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.linkable = true;
    fixture.detectChanges();
    const div: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(div.className).toContain('hover:border-[var(--am-blue-primary)]');
    expect(div.className).toContain('cursor-pointer');
  });
});
