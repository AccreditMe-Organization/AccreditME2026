import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { AuthService } from '../../../../core/services/auth.service';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import { ForgotPasswordComponent } from './forgot-password.component';

// ACC-139 — the organisation is the address the page was opened at.
describe('ForgotPasswordComponent — the organisation comes from the address (ACC-139)', () => {
  function render(slug: string | null) {
    const forgotPassword = jasmine.createSpy('forgotPassword').and.returnValue(of(undefined));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: AuthService, useValue: { forgotPassword, isAuthenticated: () => false } },
        { provide: TenantHostService, useValue: { slug } },
      ],
    });
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, forgotPassword };
  }

  it('asks for no organisation: the form has only the email', () => {
    const { el } = render('al-manara');
    // Non-vacuity guard: it is the reset form being judged.
    expect(el.querySelector('form #email')).not.toBeNull();
    expect(el.querySelector('#organizationSlug')).toBeNull();
    expect(el.querySelectorAll('form input').length).toBe(1);
  });

  it('asks for a reset with the email only — the organisation is the address', () => {
    const { fixture, forgotPassword } = render('al-manara');
    fixture.componentInstance.form.setValue({ email: 'nurse@example.test' });
    fixture.componentInstance.onSubmit();
    expect(forgotPassword).toHaveBeenCalledOnceWith('nurse@example.test');
  });

  it('shows the note and no form at an address that names no organisation', () => {
    const { el, forgotPassword } = render(null);
    expect(el.querySelector('[data-test="no-organisation-note"]')?.textContent).toContain(
      'auth.openOrganisationAddress',
    );
    expect(el.querySelector('form')).toBeNull();
    expect(forgotPassword).not.toHaveBeenCalled();
  });
});
