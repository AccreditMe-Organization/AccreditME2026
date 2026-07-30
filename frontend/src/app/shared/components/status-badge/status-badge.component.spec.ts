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

  function create(variant: 'status' | 'severity' | 'account', value: string) {
    const fixture = TestBed.createComponent(StatusBadgeComponent);
    fixture.componentRef.setInput('variant', variant);
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    return fixture;
  }

  // Asserting the resolved computed color (not the raw var() string) —
  // proves the fallback-bearing binding still resolves to the REAL token
  // when that token is actually defined, not just that a string was set.
  it('resolves to the matching --am-status-* color, lowercased', () => {
    const fixture = create('status', 'APPROVED');
    document.body.appendChild(fixture.nativeElement);
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(getComputedStyle(span).backgroundColor).toBe('rgb(56, 161, 105)'); // --am-status-approved: #38A169
    fixture.nativeElement.remove();
  });

  it('resolves to the matching --am-severity-* color, lowercased', () => {
    const fixture = create('severity', 'CRITICAL');
    document.body.appendChild(fixture.nativeElement);
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(getComputedStyle(span).backgroundColor).toBe('rgb(229, 62, 62)'); // --am-severity-critical: #E53E3E
    fixture.nativeElement.remove();
  });

  it('resolves to the matching --am-account-* color, lowercased', () => {
    const fixture = create('account', 'ACTIVE');
    document.body.appendChild(fixture.nativeElement);
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(getComputedStyle(span).backgroundColor).toBe('rgb(56, 161, 105)'); // --am-account-active: #38A169
    fixture.nativeElement.remove();
  });

  it('falls back to --am-text-secondary when the resolved token is unset', () => {
    const fixture = create('status', 'not-a-real-status');
    document.body.appendChild(fixture.nativeElement);
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(getComputedStyle(span).backgroundColor).toBe('rgb(113, 128, 150)'); // --am-text-secondary: #718096
    fixture.nativeElement.remove();
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
