// NavigationAccessService — the sidebar's one-stop source for "what can I
// see" (ACC-13). Loaded once by AppShellComponent.ngOnInit() (not
// APP_INITIALIZER — that only runs once per app boot and would miss a fresh
// login without a full page reload; the shell only ever renders once
// authGuard has already passed, which is exactly when this should load).

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
