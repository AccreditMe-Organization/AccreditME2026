import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { AmDatePipe, AmDateTimePipe, AmDurationPipe, AmNumberPipe, AmRelativePipe } from './format.pipes';
import { TestFormatContext } from './format-context';
import { provideFormatTesting } from './testing';

// ACC-94 — the template side of the layer. The hosts are deliberately OnPush: a
// language, zone or calendar change is not an input change, so an OnPush view
// updates only because the pipes read the context signals during evaluation. No
// component in the app is OnPush today; this is the failure that would
// otherwise arrive silently with the first one.
@Component({
  standalone: true,
  imports: [AmDatePipe, AmDateTimePipe, AmRelativePipe, AmDurationPipe, AmNumberPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span id="date">{{ at() | amDate }}</span>
    <span id="dateTime">{{ at() | amDateTime }}</span>
    <span id="relative">{{ recent() | amRelative }}</span>
    <span id="duration">{{ span() | amDuration }}</span>
    <span id="number">{{ total() | amNumber }}</span>
    <span id="missing">{{ missing() | amDateTime }}</span>
  `,
})
class HostComponent {
  readonly at = signal<string | null>('2026-09-15T21:30:00Z');
  readonly recent = signal(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
  readonly span = signal(5 * 60 * 60 * 1000);
  readonly total = signal(1234);
  readonly missing = signal<string | null>(null);
}

// Only a memoised pipe, plus an unrelated binding that re-runs the template. A
// re-run that returns memoised text must still read the context signals, or
// Angular drops the view's subscription to them and the next language switch is
// missed. HostComponent above cannot show this: amRelative is never memoised, so
// it keeps that whole view subscribed.
@Component({
  standalone: true,
  imports: [AmDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span id="date">{{ at | amDate }}</span><span id="other">{{ other() }}</span>`,
})
class MemoisedOnlyHostComponent {
  readonly at = '2026-09-15T21:30:00Z';
  readonly other = signal(0);
}

describe('Formatting pipes (ACC-94)', () => {
  let translate: TranslateService;
  let context: TestFormatContext;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()],
    });
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { format: { lessThanMinute: 'less than a minute' } });
    translate.setTranslation('ar', { format: { lessThanMinute: 'أقل من دقيقة' } });
    translate.use('en');
    context = TestBed.inject(TestFormatContext);
  });

  const render = () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const text = (id: string) => (fixture.nativeElement as HTMLElement).querySelector(`#${id}`)?.textContent?.trim();
    return { fixture, text };
  };

  it('renders each meaning, and — for a missing value', () => {
    const { text } = render();
    expect(text('date')).toBe('16 Sep 2026');
    expect(text('dateTime')).toBe('16 Sep 2026, 00:30');
    expect(text('relative')).toBe('3 days ago');
    expect(text('duration')).toBe('5 hours');
    expect(text('number')).toBe('1,234');
    expect(text('missing')).toBe('—');
  });

  it('updates an OnPush view on a language switch, with no input change', () => {
    const { fixture, text } = render();
    // Idle passes first: the real app runs change detection constantly, and a
    // pass that returns memoised text must still keep the view subscribed to
    // the language, or the next switch goes unnoticed.
    fixture.detectChanges();
    fixture.detectChanges();
    translate.use('ar');
    fixture.detectChanges();
    expect(text('date')).toBe('16 سبتمبر 2026');
    expect(text('dateTime')).toBe('16 سبتمبر 2026، 00:30');
    expect(text('relative')).toBe('قبل 3 أيام');
    expect(text('duration')).toBe('5 ساعات');
  });

  it('updates an OnPush view when the tenant zone or the calendar changes', () => {
    const { fixture, text } = render();
    context.zone.set('America/New_York');
    fixture.detectChanges();
    expect(text('dateTime')).toBe('15 Sep 2026, 17:30');
    context.hijri.set(true);
    fixture.detectChanges();
    expect(text('date')).toBe('4 Rabiʻ II 1448 AH (15 Sep 2026)');
  });

  it('keeps a view of memoised pipes subscribed after an unrelated re-render', () => {
    const fixture = TestBed.createComponent(MemoisedOnlyHostComponent);
    fixture.detectChanges();
    const date = () => (fixture.nativeElement as HTMLElement).querySelector('#date')?.textContent?.trim();
    expect(date()).toBe('16 Sep 2026');

    fixture.componentInstance.other.set(1); // re-runs the template; amDate returns memoised text
    fixture.detectChanges();
    translate.use('ar');
    fixture.detectChanges();

    expect(date()).toBe('16 سبتمبر 2026');
  });

  it('follows an input change like any pipe', () => {
    const { fixture, text } = render();
    fixture.componentInstance.at.set('2026-01-01T09:00:00Z');
    fixture.detectChanges();
    expect(text('date')).toBe('1 Jan 2026');
  });
});
