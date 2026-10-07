import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Location } from '@angular/common';
import { SpyLocation } from '@angular/common/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { AuthService } from '../../../../core/services/auth.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { INVITATION_ACCEPTED_NOTICE } from '../accept-invitation/accept-invitation.component';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import { LoginComponent } from './login.component';

// ACC-120 slice 9e — arriving from Accept invitation says the password is set,
// ONCE. The browser keeps history.state across a reload and Angular hands it
// back to the reloaded page's navigation as extras.state, which is how the
// notice came back on every refresh. The router stub below does the same: the
// navigation's state is whatever the current history entry holds.
describe('LoginComponent — after accepting an invitation (ACC-120 slice 9e)', () => {
  const NOTICE_TEXT = 'auth.invitation.acceptedNotice';
  let location: SpyLocation;

  beforeEach(() => {
    location = new SpyLocation();
  });

  /** One page load of /login: the navigation carries the history entry's state. */
  function load(): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: Location, useValue: location },
        {
          provide: Router,
          useValue: {
            currentNavigation: () => {
              const state = location.getState() as Record<string, unknown> | null;
              return state ? { extras: { state } } : null;
            },
            navigate: jasmine.createSpy('navigate'),
            navigateByUrl: jasmine.createSpy('navigateByUrl'),
            createUrlTree: () => ({}),
            serializeUrl: () => '',
            events: { subscribe: () => ({ unsubscribe: () => {} }) },
          },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: AuthService, useValue: {} },
        { provide: NavigationAccessService, useValue: {} },
        { provide: TenantHostService, useValue: { slug: 'al-nakheel' } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  /** The entry Accept invitation's navigate() leaves: our state plus the router's own. */
  function arriveFromAcceptInvitation(): void {
    location.replaceState('/login', '', {
      notice: INVITATION_ACCEPTED_NOTICE,
      navigationId: 4,
      ɵrouterPageId: 3,
    });
  }

  it('shows the notice on arrival', () => {
    arriveFromAcceptInvitation();
    expect(load().textContent).toContain(NOTICE_TEXT);
  });

  it('announces it politely, as a status rather than an alert', () => {
    arriveFromAcceptInvitation();
    const notice = load().querySelector('p-message')!;
    // Non-vacuity guard: it is the notice being judged, not some other message.
    expect(notice.textContent).toContain(NOTICE_TEXT);
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.getAttribute('aria-live')).toBe('polite');
  });

  it('removes it from the history entry, keeping the router\'s own keys and the URL', () => {
    arriveFromAcceptInvitation();
    load();
    expect(location.getState()).toEqual({ navigationId: 4, ɵrouterPageId: 3 });
    expect(location.path()).toBe('/login');
  });

  it('does not show it again when the page is reloaded', () => {
    arriveFromAcceptInvitation();
    expect(load().textContent).toContain(NOTICE_TEXT);

    // Reload: same history entry, same (now cleared) state.
    expect(load().textContent).not.toContain(NOTICE_TEXT);
  });

  it('does not show it on a plain visit, which carries no state', () => {
    location.replaceState('/login', '', null);
    expect(load().textContent).not.toContain(NOTICE_TEXT);
  });

  it('does not show it for some other navigation state, and leaves that state alone', () => {
    location.replaceState('/login', '', { notice: 'somethingElse', navigationId: 1 });
    expect(load().textContent).not.toContain(NOTICE_TEXT);
    expect(location.getState()).toEqual({ notice: 'somethingElse', navigationId: 1 });
  });
});

// ACC-139 — the organisation is the address the page was opened at.
describe('LoginComponent — the organisation comes from the address (ACC-139)', () => {
  function render(slug: string | null, login = jasmine.createSpy('login').and.returnValue(of({ mfaRequired: true }))) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        {
          provide: Router,
          useValue: {
            currentNavigation: () => null,
            navigate: jasmine.createSpy('navigate'),
            navigateByUrl: jasmine.createSpy('navigateByUrl'),
            createUrlTree: () => ({}),
            serializeUrl: () => '',
            events: { subscribe: () => ({ unsubscribe: () => {} }) },
          },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: AuthService, useValue: { login, isAuthenticated: () => false } },
        { provide: NavigationAccessService, useValue: {} },
        { provide: TenantHostService, useValue: { slug } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, login };
  }

  it('asks for no organisation: the form has only email and password', () => {
    const { el } = render('al-nakheel');
    // Non-vacuity guard: it is the sign-in form being judged.
    expect(el.querySelector('form #email')).not.toBeNull();
    expect(el.querySelector('#organizationSlug')).toBeNull();
    expect(el.textContent).not.toContain('auth.organization');
    expect(el.querySelector('[data-test="no-organisation-note"]')).toBeNull();
  });

  it('signs in with the email and password only — the organisation is the address', () => {
    const { fixture, login } = render('al-nakheel');
    fixture.componentInstance.loginForm.setValue({ email: 'nurse@example.test', password: 'pw' });
    fixture.componentInstance.onSubmitLogin();
    expect(login).toHaveBeenCalledOnceWith('nurse@example.test', 'pw');
  });

  it('shows the note and no form at an address that names no organisation', () => {
    const { el } = render(null);
    expect(el.querySelector('[data-test="no-organisation-note"]')?.textContent).toContain(
      'auth.openOrganisationAddress',
    );
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('input')).toBeNull();
  });
});
