import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { StatusChipComponent, StatusChipVariant } from './status-chip.component';

// ACC-78 — the tiering is the whole point of this component, so it is what is
// tested. Colour values are not asserted: those live in tokens.scss and change
// without the rule changing.
describe('StatusChipComponent (ACC-78)', () => {
  let fixture: ComponentFixture<StatusChipComponent>;

  const render = (variant: StatusChipVariant, value: string) => {
    fixture = TestBed.createComponent(StatusChipComponent);
    fixture.componentRef.setInput('variant', variant);
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusChipComponent],
      providers: [provideTranslateService()],
    }).compileComponents();
  });

  // The fix for the finding: colour marks the exception, not the norm. If an
  // active user rendered a chip, every row in the table would carry one again.
  it('renders the unremarkable value as plain text, with no chip', () => {
    const f = render('user', 'ACTIVE');

    expect(f.componentInstance.isPlain()).toBe(true);
    // A bare span — not a chip styled to look bare. No border means no visual
    // weight in a dense table.
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.rounded')).toBeNull();
  });

  it('renders a chip for a value that is not the unremarkable one', () => {
    const f = render('user', 'INACTIVE');

    expect(f.componentInstance.isPlain()).toBe(false);
    expect((f.nativeElement as HTMLElement).querySelector('.rounded')).not.toBeNull();
  });

  // The dot is the strongest signal the component has, so exactly one tier
  // gets it. INVITED means someone has not accepted yet — a state needing
  // action, unlike INACTIVE which is simply true.
  it('gives a dot to the attention tier only', () => {
    const invited = render('user', 'INVITED');
    expect(invited.componentInstance.isAttention()).toBe(true);
    expect((invited.nativeElement as HTMLElement).querySelector('.rounded-full')).not.toBeNull();

    const inactive = render('user', 'INACTIVE');
    expect(inactive.componentInstance.isAttention()).toBe(false);
    expect((inactive.nativeElement as HTMLElement).querySelector('.rounded-full')).toBeNull();
  });

  // A severity scale RATES every value — nothing is unremarkable. This is why
  // StatusBadgeComponent was correct for severity and why this component must
  // not impose a plain tier on it.
  it('treats no severity value as unremarkable', () => {
    for (const value of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
      expect(render('severity', value).componentInstance.isPlain()).toBe(false);
    }
  });

  // Case comes from backend enums ('ACTIVE'); the token and translation key
  // both want lowercase. A mismatch would silently render an unmapped chip.
  it('is case-insensitive about the incoming value', () => {
    expect(render('user', 'active').componentInstance.isPlain()).toBe(true);
    expect(render('user', 'Active').componentInstance.isPlain()).toBe(true);
  });

  it('builds the translation key as {variant}.{value}, lowercased', () => {
    expect(render('user', 'INVITED').componentInstance.labelKey()).toBe('user.invited');
  });

  // An unmapped value must not render an invisible chip — the CSS var()
  // fallback resolves it to secondary text instead. Same safety property
  // StatusBadgeComponent established.
  it('falls back to secondary text for an unmapped value', () => {
    const f = render('user', 'SOME_NEW_STATUS');
    expect(f.componentInstance.ink()).toContain('var(--am-text-secondary)');
  });
});
