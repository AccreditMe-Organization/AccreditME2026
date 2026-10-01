import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { StepStripComponent } from './step-strip.component';

// ACC-120 slice 6 — the shared step strip, extracted on its second use.
describe('StepStripComponent (ACC-120)', () => {
  let fixture: ComponentFixture<StepStripComponent>;

  function render(steps: { n: number; key: string }[], current = 1): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [StepStripComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    fixture = TestBed.createComponent(StepStripComponent);
    fixture.componentRef.setInput('steps', steps);
    fixture.componentRef.setInput('current', current);
    fixture.detectChanges();
  }

  const items = (): HTMLElement[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.am-steps__item'));

  const TWO = [
    { n: 1, key: 'a.one' },
    { n: 2, key: 'a.two' },
  ];

  it('renders one item per step', () => {
    render(TWO);
    expect(items().length).toBe(2);
  });

  it('marks the current step, and only it', () => {
    render(TWO, 2);
    expect(items().map((el) => el.getAttribute('aria-current'))).toEqual([null, 'step']);
  });

  // A caller should not have to remember to hide the strip: how many steps
  // there are is data. The lookup value form has a second step only when its
  // category defines attributes.
  it('renders nothing at all for a single step', () => {
    render([{ n: 1, key: 'a.one' }]);
    expect((fixture.nativeElement as HTMLElement).querySelector('.am-steps')).toBeNull();
  });

  it('renders nothing for no steps', () => {
    render([]);
    expect((fixture.nativeElement as HTMLElement).querySelector('.am-steps')).toBeNull();
  });
});
