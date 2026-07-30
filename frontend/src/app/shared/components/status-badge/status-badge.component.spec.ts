import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { StatusBadgeComponent } from './status-badge.component';

describe('StatusBadgeComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StatusBadgeComponent],
      providers: [provideTranslateService({ lang: 'en' })],
    });
  });

  function create(variant: 'status' | 'severity', value: string) {
    const fixture = TestBed.createComponent(StatusBadgeComponent);
    fixture.componentRef.setInput('variant', variant);
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    return fixture;
  }

  it('binds background-color to the matching --am-status-* variable, lowercased', () => {
    const fixture = create('status', 'APPROVED');
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(span.style.backgroundColor).toBe('var(--am-status-approved)');
  });

  it('binds background-color to the matching --am-severity-* variable, lowercased', () => {
    const fixture = create('severity', 'CRITICAL');
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(span.style.backgroundColor).toBe('var(--am-severity-critical)');
  });

  it('renders the {variant}.{value} translation key as its label', () => {
    const fixture = create('status', 'DRAFT');
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    // No 'status.draft' translation loaded in this unit test — ngx-translate
    // falls back to rendering the key itself, which is enough to prove the
    // component asks for the right key.
    expect(span.textContent?.trim()).toBe('status.draft');
  });
});
