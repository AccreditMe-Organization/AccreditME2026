// ACC-94 — PrimeNG components that write digits themselves. Found in the
// browser pass, not by the inventory: the source scan looks for OUR formatting
// calls, and these two format inside PrimeNG.
//
// p-paginator (page links, rows-per-page options) and p-inputNumber (the value
// shown and typed) build `new Intl.NumberFormat(this.locale)`. Left unset,
// `locale` is undefined, which means the BROWSER's locale — so a reader whose
// browser is set to ar-SA or ar-EG sees "١" and "٢٥" beside a "1-24 of 24"
// that PrimeNG writes with String(), in an English session as much as an
// Arabic one. Digits are Latin in both languages, and the browser drives none
// of the display (CLAUDE.md, ACC-94).
//
// One fixed locale is correct for both languages: with Latin digits, Arabic's
// number text is identical to English's ("12,345.5" from ar-SA-u-nu-latn and
// from en — checked), so there is nothing for the UI language to change.
//
// Host directives rather than [locale] on each tag: the selector matches the
// PrimeNG element, so importing the directive is the whole change and a
// multi-line tag cannot be missed. check-formatting-rules.mjs fails a file that
// uses either tag without importing its directive.
//
// Not exported from the index: the index is imported by the sidebar, which is in
// the initial bundle, and these reference PrimeNG's InputNumber and Paginator.
// Import from './latin-digits' directly.
import { Directive, inject } from '@angular/core';
import { InputNumber } from 'primeng/inputnumber';
import { Paginator } from 'primeng/paginator';

export const LATIN_DIGITS_LOCALE = 'en-u-nu-latn';

// Set in the constructor: after PrimeNG's own constructor, before inputs bind
// and before ngOnInit builds InputNumber's parser from `locale`.
@Directive({ selector: 'p-inputNumber, p-inputnumber, p-input-number' })
export class InputNumberLatinDigits {
  constructor() {
    inject(InputNumber, { self: true }).locale = LATIN_DIGITS_LOCALE;
  }
}

@Directive({ selector: 'p-paginator' })
export class PaginatorLatinDigits {
  constructor() {
    inject(Paginator, { self: true }).locale = LATIN_DIGITS_LOCALE;
  }
}
