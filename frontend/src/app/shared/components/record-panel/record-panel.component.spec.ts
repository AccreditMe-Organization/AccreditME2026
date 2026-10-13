import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest } from '../../../core/formatting/testing';
import { RequestOutcome } from '../../../core/request-outcome/request-outcome';
import { RecordPanelComponent } from './record-panel.component';

// ACC-120 slice 5 — the opt-in outcome. Each state is artboard 8's, read off
// the shared state machine rather than three flags a caller can half-set.
@Component({
  standalone: true,
  imports: [RecordPanelComponent],
  template: `
    <app-record-panel
      heading="Roles"
      emptyTitle="No roles"
      [count]="count()"
      [outcome]="outcome()"
      (retry)="retries = retries + 1"
    >
      <p data-row>a row</p>
    </app-record-panel>
  `,
})
class OutcomeHost {
  readonly outcome = signal<RequestOutcome<unknown> | null>({ status: 'loading' });
  readonly count = signal<number | null>(3);
  retries = 0;
}

// The Committee page's shape: no outcome bound, the old three inputs.
@Component({
  standalone: true,
  imports: [RecordPanelComponent],
  template: `
    <app-record-panel heading="Members" [count]="2" [loading]="loading()" [isEmpty]="false">
      <p data-row>a member</p>
    </app-record-panel>
  `,
})
class LegacyHost {
  readonly loading = signal(true);
}

describe('RecordPanelComponent — the opt-in outcome (ACC-120 slice 5)', () => {
  let fixture: ComponentFixture<OutcomeHost>;
  const el = () => fixture.nativeElement as HTMLElement;
  const panel = () => el().querySelector('app-record-panel') as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OutcomeHost, LegacyHost],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' })],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(OutcomeHost);
    fixture.detectChanges();
  });

  // Test 8
  it('loading renders skeleton rows, never a centred spinner', () => {
    expect(el().querySelector('[data-panel-skeleton]')).not.toBeNull();
    expect(el().querySelector('p-progressspinner')).toBeNull();
    expect(el().querySelector('[data-row]')).toBeNull();
  });

  it('idle renders nothing in the body — a fast answer never flashes a shape', () => {
    fixture.componentInstance.outcome.set({ status: 'idle' });
    fixture.detectChanges();
    expect(el().querySelector('[data-panel-skeleton]')).toBeNull();
    expect(el().querySelector('p-progressspinner')).toBeNull();
    expect(el().querySelector('[data-row]')).toBeNull();
  });

  it('rows render the projected content', () => {
    fixture.componentInstance.outcome.set({ status: 'rows', data: [1], refreshing: false });
    fixture.detectChanges();
    expect(el().querySelector('[data-row]')?.textContent).toContain('a row');
  });

  it('error shows the message, the error id and Retry, and the count reads "—"', () => {
    fixture.componentInstance.outcome.set({ status: 'error', errorId: 'req-42' });
    fixture.detectChanges();
    const error = el().querySelector('[data-panel-error]') as HTMLElement;
    expect(error.textContent).toContain('This could not be loaded.');
    expect(error.textContent).toContain('Error ID: req-42');
    expect(el().querySelector('header')!.textContent).toContain('—');
    expect(el().querySelector('header')!.textContent).not.toContain('3');

    (error.querySelector('button') as HTMLButtonElement).click();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it('denied is ABSENT: the host is hidden so the grid reflows', () => {
    fixture.componentInstance.outcome.set({ status: 'denied', httpStatus: 403 });
    fixture.detectChanges();
    expect(panel().style.display).toBe('none');
  });

  it('every other state leaves the host displayed', () => {
    fixture.componentInstance.outcome.set({ status: 'rows', data: [1], refreshing: false });
    fixture.detectChanges();
    expect(panel().style.display).toBe('');
  });

  it('empty shows the empty state', () => {
    fixture.componentInstance.outcome.set({ status: 'empty', reason: '', filtered: false, refreshing: false });
    fixture.detectChanges();
    expect(el().textContent).toContain('No roles');
    expect(el().querySelector('[data-row]')).toBeNull();
  });

  it('a caller that binds no outcome keeps the old behaviour (the Committee page)', () => {
    const legacy = TestBed.createComponent(LegacyHost);
    legacy.detectChanges();
    const host = legacy.nativeElement as HTMLElement;
    expect(host.querySelector('p-progressspinner')).not.toBeNull();
    expect(host.querySelector('[data-panel-skeleton]')).toBeNull();
    legacy.componentInstance.loading.set(false);
    legacy.detectChanges();
    expect(host.querySelector('[data-row]')?.textContent).toContain('a member');
    expect(host.querySelector('header')!.textContent).toContain('2');
  });
});
