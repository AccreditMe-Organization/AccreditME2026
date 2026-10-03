import { Component, inject } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { LanguageService } from '../../core/services/language.service';
import { ConfirmDialogCloseLabel } from '../../shared/directives/confirm-dialog-close-label.directive';

/**
 * ACC-83 — the parts of a confirmation PrimeNG renders ITSELF.
 *
 * Every component passes `header` and `message`, and those are translated and
 * checked by `check:confirm-translated`. The BUTTONS and the close control are
 * different: when a caller passes no label, PrimeNG falls back to its own
 * English strings, and the scan cannot see an absence — flagging a wrong value
 * is not the same as noticing a missing one.
 *
 * Measured before this spec existed: 19 of the app's 22 `confirm()` calls pass
 * no `acceptLabel`, so nineteen dialogs rendered Latin "Yes" / "No" inside a
 * fully Arabic RTL dialog. Verified in `primeng-confirmdialog.mjs`:
 *
 *     this.option('acceptLabel') || this.getAcceptButtonProps()?.label
 *       || this.config.getTranslation(TranslationKeys.ACCEPT)
 *
 * with `accept: 'Yes'` / `reject: 'No'` in `primeng-config.mjs`. And
 * `ConfirmDialog` accepts a `closeAriaLabel` input and NEVER FORWARDS IT to
 * the `<p-dialog>` it renders — confirmed by extracting its inline template,
 * which mentions neither `closeAriaLabel` nor `closeButtonProps`. So the
 * close button has no accessible name and the component's own API cannot give
 * it one; `ConfirmDialogCloseLabel` does, and its header says why removing
 * the button instead would have disabled Escape.
 *
 * Both are fixed in ONE place each — `LanguageService` for the button
 * translations, the app shell's own `<p-confirmDialog>` for the close label —
 * because a per-call fix cannot cover the twenty-third dialog.
 *
 * This renders the real PrimeNG component rather than reading its source, so
 * the assertions are about what a browser shows.
 */
@Component({
  standalone: true,
  imports: [ConfirmDialogModule, ConfirmDialogCloseLabel],
  // The app shell's own markup for this, copied deliberately: if the shell
  // changes how it configures the dialog, this spec should be updated with it.
  template: `<p-confirmDialog amCloseLabel />`,
})
class HostComponent {
  private readonly confirmation = inject(ConfirmationService);
  readonly language = inject(LanguageService);

  open(): void {
    this.confirmation.confirm({ header: 'H', message: 'M', accept: () => {} });
  }
}

describe('the global confirmation dialog — chrome PrimeNG renders itself (ACC-83)', () => {
  let fixture: ComponentFixture<HostComponent>;

  function render(lang: 'en' | 'ar'): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTranslateService({ lang }),
        providePrimeNG({}),
        ConfirmationService,
      ],
    });
    const translate = TestBed.inject(TranslateService);
    // Real strings, both languages — the point is what a reader sees, and
    // asserting on keys would not distinguish "translated" from "English".
    translate.setTranslation('en', { common: { yes: 'Yes', no: 'No', close: 'Close' } });
    translate.setTranslation('ar', { common: { yes: 'نعم', no: 'لا', close: 'إغلاق' } });
    translate.use(lang);

    fixture = TestBed.createComponent(HostComponent);
    // Constructing LanguageService is what applies the PrimeNG translations;
    // in the app it is constructed at bootstrap.
    fixture.componentInstance.language.isArabic();
    fixture.detectChanges();
    fixture.componentInstance.open();
    fixture.detectChanges();
  }

  const buttons = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('.p-confirmdialog button'));

  const labelled = (): string[] =>
    buttons()
      .map((b) => (b.textContent ?? '').trim() || b.getAttribute('aria-label') || '(no name)')
      .filter((t) => t.length > 0);

  afterEach(() => {
    document.querySelectorAll('.p-confirmdialog, .p-dialog-mask').forEach((n) => n.remove());
  });

  // NON-VACUITY FIRST: if no dialog rendered, every assertion below passes for
  // the wrong reason.
  it('renders a dialog with buttons at all', () => {
    render('en');
    expect(buttons().length).toBeGreaterThan(0);
  });

  it('labels the accept and reject buttons in English', () => {
    render('en');
    const names = labelled();
    expect(names).toContain('Yes');
    expect(names).toContain('No');
  });

  // THE DEFECT: Latin "Yes"/"No" in an otherwise fully Arabic dialog.
  it('labels them in ARABIC when the language is Arabic', () => {
    render('ar');
    const names = labelled();
    expect(names).toContain('نعم');
    expect(names).toContain('لا');
    expect(names).not.toContain('Yes');
    expect(names).not.toContain('No');
  });

  // The close control: an icon-only button, so its name can only come from
  // aria-label, and PrimeNG binds that with no fallback of its own.
  it('gives the close button an accessible name', () => {
    render('en');
    // Measured, not guessed: the rendered button carries
    // class="p-dialog-close-button" and data-pc-section="root".
    const close = document.querySelector<HTMLElement>(
      '.p-confirmdialog button.p-dialog-close-button',
    );
    expect(close).withContext('an icon-only close button is rendered').toBeTruthy();
    const name = close!.getAttribute('aria-label');
    expect(name).toBeTruthy();
    expect(name).toBe('Close');
  });

  it('translates the close button name too', () => {
    render('ar');
    const close = document.querySelector<HTMLElement>(
      '.p-confirmdialog button.p-dialog-close-button',
    );
    expect(close!.getAttribute('aria-label')).toBe('إغلاق');
  });
});
