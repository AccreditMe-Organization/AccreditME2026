import { TestBed } from '@angular/core/testing';
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
