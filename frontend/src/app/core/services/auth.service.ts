// Real AuthService (Step 9) — replaces the dev-only DemoAuthService/token
// signal entirely. Per step-09 plan Section 12, Discussion 4: no token is
// ever stored in Angular. The httpOnly access_token/refresh_token cookies
// are the only place the session exists, and Angular code can never read
// them (that's the point of httpOnly). The one piece of in-memory state
// this service keeps — currentUser — is display information only (id,
// email, name), populated from each auth response's own `user` object,
// never a credential and never sufficient on its own to grant access.

import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

// /auth/me's own response shape — impersonatedBy (ACC-13) only ever
// non-null when a platform admin is currently impersonating this session
// (see AuthController.getMe()/TenantGuard's impersonatedBy passthrough).
export interface MeResponse extends PublicUser {
  impersonatedBy: { id: string; email: string; name: string } | null;
}

export interface LoginResult {
  success?: true;
  user?: PublicUser;
  mfaRequired?: true;
}

export interface MfaSetupResult {
  qrCodeDataUrl: string;
  secret: string;
  backupCodes: string[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/auth`;

  private readonly _currentUser = signal<PublicUser | null>(null);
  readonly currentUser = this._currentUser.asReadonly();

  private readonly _impersonatedBy = signal<MeResponse['impersonatedBy']>(null);
  readonly impersonatedBy = this._impersonatedBy.asReadonly();

  isAuthenticated(): boolean {
    return this._currentUser() !== null;
  }

  login(organizationSlug: string, email: string, password: string): Observable<LoginResult> {
    return this.http
      .post<LoginResult>(`${this.baseUrl}/login`, { organizationSlug, email, password })
      .pipe(tap((result) => this.applyLoginResult(result)));
  }

  verifyMfa(code: string): Observable<LoginResult> {
    return this.http
      .post<LoginResult>(`${this.baseUrl}/mfa/verify`, { code })
      .pipe(tap((result) => this.applyLoginResult(result)));
  }

  logout(): Observable<{ success: true }> {
    return this.http
      .post<{ success: true }>(`${this.baseUrl}/logout`, {})
      .pipe(tap(() => {
        this._currentUser.set(null);
        this._impersonatedBy.set(null);
      }));
  }

  acceptInvitation(token: string, password: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/accept-invitation`, { token, password });
  }

  forgotPassword(organizationSlug: string, email: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/forgot-password`, { organizationSlug, email });
  }

  resetPassword(token: string, password: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/reset-password`, { token, password });
  }

  // Distinct from verifyMfa() above (the login-time 2FA challenge) — these
  // four manage MFA enrollment for the already-logged-in user. Endpoint
  // paths match AuthController exactly: 'mfa/verify' was already taken by
  // the login flow, so enrollment-verify lives at 'mfa/setup/verify'.
  setupMfa(password: string): Observable<MfaSetupResult> {
    return this.http.post<MfaSetupResult>(`${this.baseUrl}/mfa/setup`, { password });
  }

  verifyAndEnableMfa(code: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/mfa/setup/verify`, { code });
  }

  disableMfa(password: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/mfa/disable`, { password });
  }

  getMfaStatus(): Observable<{ enabled: boolean }> {
    return this.http.get<{ enabled: boolean }>(`${this.baseUrl}/mfa/status`);
  }

  // Called by the auth interceptor on a 401 response — the source of truth
  // for "session expired" is the backend rejecting a request, not a local
  // token check (there is no local token to check).
  clearSession(): void {
    this._currentUser.set(null);
    this._impersonatedBy.set(null);
  }

  // Called once via APP_INITIALIZER on app startup — currentUser is
  // in-memory only, so a page refresh or direct URL navigation loses it even
  // though the httpOnly access_token cookie is still valid. /auth/me reads
  // that cookie server-side and restores the signal. A 401 (missing/expired/
  // stale-tokenVersion cookie) is the expected "not logged in" case, not an
  // error to surface.
  restoreSession(): Observable<void> {
    return this.http.get<MeResponse>(`${this.baseUrl}/me`).pipe(
      tap((response) => {
        this._currentUser.set({ id: response.id, email: response.email, name: response.name });
        this._impersonatedBy.set(response.impersonatedBy);
      }),
      catchError(() => {
        this._currentUser.set(null);
        this._impersonatedBy.set(null);
        return of(null);
      }),
      map(() => void 0),
    );
  }

  private applyLoginResult(result: LoginResult): void {
    if (result.success && result.user) {
      this._currentUser.set(result.user);
    }
  }
}
