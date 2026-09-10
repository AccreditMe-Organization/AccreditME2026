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

  // ACC-70 — before this, a caller could not tell "loaded, and this user
  // genuinely has no permissions" from "the request failed", because
  // loadAccess()'s catchError set the signals to empty AND reported success.
  //
  // That ambiguity was harmless while the only consumer was the sidebar (an
  // empty sidebar is a reasonable degraded state either way). It stops being
  // harmless the moment a ROUTE GUARD reads the same signals: an empty
  // permission set then means "deny everything", so one transient 5xx on
  // /roles/my-permissions locks the user out of every guarded route until
  // they reload, with nothing on screen explaining why.
  //
  // This is not hypothetical and not introduced by the guards — it is a live
  // bug in platformAdminGuard today. On a hard reload of a deep /platform/*
  // URL, a failed loadAccess() leaves isPlatformOrg false, the initializer
  // still resolves successfully, and a genuine platform admin is bounced to
  // /organization. ACC-21 fixed the TIMING race (guard evaluating before the
  // request resolved); it did not touch the FAILURE case.
  private readonly _loadState = signal<'PENDING' | 'LOADED' | 'FAILED'>('PENDING');

  // Tracked separately from _loadState — see hasTrustworthyTenantAccess().
  private readonly _tenantLoadState = signal<'PENDING' | 'LOADED' | 'FORBIDDEN' | 'FAILED'>(
    'PENDING',
  );

  readonly permissions = this._permissions.asReadonly();
  readonly modules = this._modules.asReadonly();
  readonly loadState = this._loadState.asReadonly();

  // Whether the permission signals reflect a real answer from the server.
  // False while still pending and after a failed load — in both cases the
  // signals are empty for reasons that have nothing to do with what this
  // user may actually do.
  //
  // Guards must consult this BEFORE treating an absent permission as a
  // denial. A guard in this codebase is defence in depth, never the
  // enforcement boundary (platformAdminGuard's own comment says so, and the
  // backend's PermissionGuard/PlatformGuard re-check every request
  // regardless) — so allowing navigation through on an unknown answer is
  // safe, and is strictly better than locking a legitimate user out of the
  // application because one request failed.
  hasTrustworthyPermissions(): boolean {
    return this._loadState() === 'LOADED';
  }

  // Separate from the permissions state above because isPlatformAdmin() reads
  // BOTH isPlatformOrg (from /tenant) and the platform:admin permission, so a
  // guard depending on it needs to know whether each half is a real answer.
  //
  // FORBIDDEN counts as trustworthy, and that distinction is the whole point:
  //   - 403 is INFORMATIVE. It means the caller lacks tenant:view. Every real
  //     platform admin holds it, so a 403 is a reliable "not a platform
  //     admin" — treating it as unknown would let a zero-permission user
  //     straight into /platform, which is the regression this replaces.
  //   - 5xx or a network failure is NOT informative. The answer is genuinely
  //     unknown, so the guard should defer to the backend rather than eject a
  //     legitimate platform admin mid-session.
  hasTrustworthyTenantAccess(): boolean {
    const state = this._tenantLoadState();
    return state === 'LOADED' || state === 'FORBIDDEN';
  }

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
  // The two requests recover INDEPENDENTLY — each has its own catchError
  // inside the forkJoin rather than one wrapped around it.
  //
  // That is not a style preference. These endpoints have different
  // authorization: /roles/my-permissions is ungated (every authenticated user
  // gets an answer, even if that answer is an empty array), while GET /tenant
  // requires tenant:view. With a single outer catchError, forkJoin collapsed
  // on the first failure — so a user holding no permissions got a correct
  // `[]` from the permissions call and then had it THROWN AWAY when /tenant
  // returned 403, leaving loadState FAILED.
  //
  // That broke the guards in the worst possible direction. permissionGuard
  // treats an untrustworthy load as "unknown, let the backend decide" and
  // allows the route through — a sound response to a transient fault, but the
  // /tenant 403 is structural, not transient: a permission-less user hits it
  // on every single load, forever. So the fail-open path became the NORMAL
  // path for exactly the users the guards exist to constrain, and every
  // guarded route was reachable by them (ACC-70 live pass, check 2).
  //
  // Split this way, a /tenant failure can no longer invalidate a known-good
  // permissions answer, and loadState means precisely one thing: whether we
  // know this user's permissions.
  loadAccess(): Observable<void> {
    const permissions$ = this.http.get<string[]>(`${environment.apiUrl}/roles/my-permissions`).pipe(
      tap((permissions) => {
        this._permissions.set(permissions);
        this._loadState.set('LOADED');
      }),
      catchError(() => {
        this._permissions.set([]);
        this._loadState.set('FAILED');
        return of(null);
      }),
    );

    // A /tenant failure is deliberately NOT reflected in loadState. It carries
    // module-enablement and isPlatformOrg, neither of which is a statement
    // about what this user may do.
    //
    // KNOWN CONSEQUENCE, and the reason FUNCTIONAL_NAV_ITEMS carries a matching
    // note: when /tenant 403s, isModuleEnabled() answers false and
    // isPlatformAdmin() answers false for reasons unrelated to the truth.
    // Harmless today — FUNCTIONAL_NAV_ITEMS is empty so isModuleEnabled() has
    // no consumers, and a user who cannot read /tenant is genuinely not a
    // platform admin. It becomes load-bearing the first time a functional
    // module ships behind isModuleEnabled(): that module's nav item would be
    // hidden from a user whose /tenant call failed, whether or not the module
    // is actually enabled. Decide then whether /tenant's tenant:view gating is
    // right, rather than pre-emptively now.
    const tenant$ = this.http.get<TenantAccessResponse>(`${environment.apiUrl}/tenant`).pipe(
      tap((tenant) => {
        this._modules.set(tenant.modules);
        this._isPlatformOrg.set(tenant.isPlatformOrg);
        this._tenantLoadState.set('LOADED');
      }),
      catchError((err: unknown) => {
        this._modules.set({});
        this._isPlatformOrg.set(false);
        const status = (err as { status?: number })?.status;
        this._tenantLoadState.set(status === 403 ? 'FORBIDDEN' : 'FAILED');
        return of(null);
      }),
    );

    // Still completes rather than erroring — every existing caller (the
    // initializer, AppShellComponent) depends on that, and a rejected
    // initializer would block the app from bootstrapping at all.
    return forkJoin({ permissions: permissions$, tenant: tenant$ }).pipe(map(() => void 0));
  }
}
