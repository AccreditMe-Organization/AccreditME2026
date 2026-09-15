import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { providePrimeNG } from 'primeng/config';
import { InputNumber, InputNumberModule } from 'primeng/inputnumber';
import { Paginator, PaginatorModule } from 'primeng/paginator';
import { InputNumberLatinDigits, LATIN_DIGITS_LOCALE, PaginatorLatinDigits } from './latin-digits';

// ACC-94 — found in the browser pass: in an English session on a browser set to
// ar-SA, the Users list pager read "1-24 of 24" beside page link "١" and page
// size "٢٥". PrimeNG builds `new Intl.NumberFormat(this.locale)`, and an unset
// locale is the browser's. Karma's browser is English, so rendered text alone
// cannot fail here; what is asserted is which locale PrimeNG actually built its
// formatter from — the browser's without the directive (the control), the
// pinned Latin one with it.

@Component({
  imports: [InputNumberModule, InputNumberLatinDigits, PaginatorModule, PaginatorLatinDigits, FormsModule],
  template: `
    <p-inputNumber [(ngModel)]="value" inputId="n" />
    <p-paginator [rows]="25" [totalRecords]="24" [rowsPerPageOptions]="[10, 25]" />
  `,
})
class PinnedHostComponent {
  value = 12345;
  readonly input = viewChild.required(InputNumber);
  readonly pager = viewChild.required(Paginator);
}

@Component({
  imports: [InputNumberModule, PaginatorModule, FormsModule],
  template: `
    <p-inputNumber [(ngModel)]="value" inputId="n" />
    <p-paginator [rows]="25" [totalRecords]="24" />
  `,
})
class UnpinnedHostComponent {
  value = 12345;
  readonly input = viewChild.required(InputNumber);
  readonly pager = viewChild.required(Paginator);
}

// InputNumber keeps the formatter it built in ngOnInit; not part of its typed API.
const builtFormatter = (input: InputNumber) =>
  (input as unknown as { numberFormat: Intl.NumberFormat }).numberFormat.resolvedOptions();

describe('Latin digits in PrimeNG number components (ACC-94)', () => {
  async function render<T>(host: new () => T) {
    TestBed.configureTestingModule({ providers: [provideNoopAnimations(), providePrimeNG()] });
    const fixture = TestBed.createComponent(host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('control: without the directive, PrimeNG formats in the browser locale', async () => {
    const fixture = await render(UnpinnedHostComponent);
    const browser = new Intl.NumberFormat().resolvedOptions().locale;
    expect(fixture.componentInstance.pager().locale).toBeUndefined();
    expect(builtFormatter(fixture.componentInstance.input()).locale).toBe(browser);
  });

  it('pins the locale PrimeNG builds its number formatter from, before ngOnInit', async () => {
    const fixture = await render(PinnedHostComponent);
    const formatter = builtFormatter(fixture.componentInstance.input());
    expect(new Intl.NumberFormat(LATIN_DIGITS_LOCALE).resolvedOptions().numberingSystem).toBe('latn');
    expect(formatter.locale).toBe(new Intl.NumberFormat(LATIN_DIGITS_LOCALE).resolvedOptions().locale);
    expect(formatter.numberingSystem).toBe('latn');
    expect(fixture.componentInstance.pager().locale).toBe(LATIN_DIGITS_LOCALE);
  });

  it('shows Latin digits in the input and the pager', async () => {
    const fixture = await render(PinnedHostComponent);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector<HTMLInputElement>('#n')?.value).toBe('12,345');
    expect(fixture.componentInstance.pager().getLocalization(25)).toBe('25');
    expect(el.querySelector('.p-paginator-page')?.textContent?.trim()).toBe('1');
  });

  it('gives Arabic the same number text as the pinned locale, so one locale serves both languages', () => {
    const arabic = new Intl.NumberFormat('ar-SA', { numberingSystem: 'latn' }).format(12345.5);
    expect(new Intl.NumberFormat(LATIN_DIGITS_LOCALE).format(12345.5)).toBe(arabic);
    // …and is what an ar-SA browser would otherwise have shown.
    expect(new Intl.NumberFormat('ar-SA').format(25)).toBe('٢٥');
  });
});
