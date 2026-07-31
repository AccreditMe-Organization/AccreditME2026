// NavigationAccessService — the sidebar's one-stop source for "what can I
// see" (ACC-13). loadAccess() has TWO call sites, each fixing a different
// gap — neither is redundant with the other:
//
// 1. app.config.ts's initializeSession() (ACC-21) — chained after
//    AuthService.restoreSession() resolves, gated on isAuthenticated(),
//    inside the same provideAppInitializer that blocks the router's initial
//    navigation. This closes a real bug: platformAdminGuard reads
//    isPlatformAdmin() synchronously, and on a hard reload of a deep
//    /platform/* URL the guard could evaluate before this service's HTTP
//    calls resolved, incorrectly bouncing a genuine platform admin to
//    /organization. Blocking the initializer on this means no guard ever
//    runs before permission data is loaded.
// 2. AppShellComponent.ngOnInit() (ACC-13, unchanged by ACC-21) — still
//    required because provideAppInitializer only runs once per full page
//    load. A same-tab logout -> login cycle (no reload) destroys and
//    recreates AppShellComponent (both it and the auth routes share
//    path: '' in app.routes.ts, selected by authGuard's isAuthenticated()
//    check) without ever re-running app initializers, so ngOnInit() is the
//    only thing that refreshes permissions for a freshly-logged-in user in
//    the same tab.
//
// Net effect: on a hard reload, loadAccess() fires twice (initializer, then
// ngOnInit() again moments later) — an accepted, harmless tradeoff (both
// calls just idempotently re-set the same signals), not an oversight.

import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

interface TenantAccessResponse {
  isPlatformOrg: boolean;
  modules: Record<string, boolean>;
}

@Injectable({ providedIn: 'root' })
export class NavigationAccessService {
  private readonly http = inject(HttpClient);

  private readonly _permissions = signal<string[]>([]);
  private readonly _modules = signal<Record<string, boolean>>({});
  private readonly _isPlatformOrg = signal(false);

  readonly permissions = this._permissions.asReadonly();
  readonly modules = this._modules.asReadonly();

  hasPermission(permission: string): boolean {
    return this._permissions().includes(permission);
  }

  isModuleEnabled(moduleKey: string): boolean {
    return this._modules()[moduleKey] === true;
  }

  // Mirrors PlatformGuard's own two-part check server-side — never trust
  // platform:admin permission alone. A self-assigned PLATFORM_ADMIN role in
  // an ordinary tenant grants that permission string but isPlatformOrg is
  // still false for that tenant, so this still correctly hides the section.
  isPlatformAdmin(): boolean {
    return this._isPlatformOrg() && this.hasPermission('platform:admin');
  }

  // A 401/error here just means "not logged in yet" or a transient failure —
  // leaves every signal at its empty/false default rather than throwing, so
  // the shell still renders (with an empty sidebar) instead of crashing.
  loadAccess(): Observable<void> {
    return forkJoin({
      permissions: this.http.get<string[]>(`${environment.apiUrl}/roles/my-permissions`),
      tenant: this.http.get<TenantAccessResponse>(`${environment.apiUrl}/tenant`),
    }).pipe(
      tap(({ permissions, tenant }) => {
        this._permissions.set(permissions);
        this._modules.set(tenant.modules);
        this._isPlatformOrg.set(tenant.isPlatformOrg);
      }),
      map(() => void 0),
      catchError(() => {
        this._permissions.set([]);
        this._modules.set({});
        this._isPlatformOrg.set(false);
        return of(void 0);
      }),
    );
  }
}
