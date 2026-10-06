import { TestBed } from '@angular/core/testing';
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
// once: only the navigation that brought them here carries the notice.
describe('LoginComponent — after accepting an invitation (ACC-120 slice 9e)', () => {
  function render(state: Record<string, unknown> | undefined): HTMLElement {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        {
          provide: Router,
          useValue: {
            currentNavigation: () => (state === undefined ? null : { extras: { state } }),
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

  it('shows the notice when the navigation carries it', () => {
    const el = render({ notice: INVITATION_ACCEPTED_NOTICE });
    expect(el.textContent).toContain('auth.invitation.acceptedNotice');
  });

  it('does not show it on a plain visit or a refresh, which carry no state', () => {
    expect(render(undefined).textContent).not.toContain('auth.invitation.acceptedNotice');
  });

  it('does not show it for some other navigation state', () => {
    expect(render({ notice: 'somethingElse' }).textContent).not.toContain(
      'auth.invitation.acceptedNotice',
    );
  });
});
