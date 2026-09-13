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

// ACC-79 — mirrors the backend's ITenantEntitlements. A module that is not
// usable by this tenant, for any reason (not built, not licensed, switched
// off), is simply absent: the backend omits NONE rather than returning it.
export type ModuleAccessLevel = 'FULL' | 'READ_ONLY';

interface TenantEntitlementsResponse {
  name: string;
  slug: string;
  isPlatformOrg: boolean;
  modules: Record<string, ModuleAccessLevel>;
}

@Injectable({ providedIn: 'root' })
export class NavigationAccessService {
  private readonly http = inject(HttpClient);

  private readonly _permissions = signal<string[]>([]);
  private readonly _modules = signal<Record<string, ModuleAccessLevel>>({});
  private readonly _isPlatformOrg = signal(false);
  // ACC-79 — for the browser tab title ("Page · Tenant — AccreditMe") and the
  // tenant label in the shell. Empty until entitlements load.
  private readonly _tenantName = signal('');

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
  private readonly _loadState = signal<'PENDING' | 'LOADED' | 'FAILED'>(
    'PENDING',
  );

  // Tracked separately from _loadState — see hasTrustworthyTenantAccess().
  private readonly _tenantLoadState = signal<
    'PENDING' | 'LOADED' | 'FORBIDDEN' | 'FAILED'
  >('PENDING');

  readonly permissions = this._permissions.asReadonly();
  readonly modules = this._modules.asReadonly();
  readonly tenantName = this._tenantName.asReadonly();
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
  // ACC-79 — what changed underneath this. The tenant half used to be GET
  // /tenant, gated on tenant:view, so a zero-permission user got a 403 on
  // every load and "403 means not a platform admin" was the NORMAL path for
  // most users. It now reads GET /tenant/entitlements, which is ungated: every
  // signed-in user gets a 200 carrying a real isPlatformOrg. That is strictly
  // better — a direct answer replaces an inference — and the zero-permission
  // user is still denied, now because isPlatformOrg is false.
  //
  // FORBIDDEN still counts as trustworthy, but it is no longer expected. A 403
  // from an endpoint that requires no permission means something is wrong with
  // this user's tenant context, and for a guard protecting /platform, denying
  // on an anomaly is the safe direction.
  //
  // 5xx or a network failure is NOT informative. The answer is genuinely
  // unknown, so the guard should defer to the backend rather than eject a
  // legitimate platform admin mid-session.
  hasTrustworthyTenantAccess(): boolean {
    const state = this._tenantLoadState();
    return state === 'LOADED' || state === 'FORBIDDEN';
  }

  hasPermission(permission: string): boolean {
    return this._permissions().includes(permission);
  }

  // Whether the module is usable at all — FULL or READ_ONLY. This is the rail's
  // question: a read-only module is still fully present and readable.
  isModuleEnabled(moduleKey: string): boolean {
    return this.moduleAccess(moduleKey) !== null;
  }

  // ACC-79 — null when the module is not usable by this tenant. Deliberately
  // does not distinguish "not built" from "not licensed" from "switched off":
  // the rail treats all three identically, and only the admin's Plan & modules
  // page is allowed to know which is which.
  moduleAccess(moduleKey: string): ModuleAccessLevel | null {
    return this._modules()[moduleKey] ?? null;
  }

  // Whether write affordances should render for a module. READ_ONLY (Standards
  // on Starter) is readable with its write controls ABSENT — and an Upgrade to
  // edit button in their place, never a disabled control with no explanation.
  //
  // UX only, like every other method here. The backend must enforce READ_ONLY
  // itself; see SYSTEM-REFERENCE §1.8 on ModuleGuard, which does not yet.
  canWriteModule(moduleKey: string): boolean {
    return this.moduleAccess(moduleKey) === 'FULL';
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
  // That is not a style preference. With a single outer catchError, forkJoin
  // collapses on the first failure. Before ACC-79 the tenant call was GET
  // /tenant, gated on tenant:view, so a user holding no permissions got a
  // correct `[]` from the permissions call and then had it THROWN AWAY when
  // /tenant returned 403, leaving loadState FAILED. Both calls are now ungated,
  // so that exact case no longer arises — but a transient fault on either one
  // still must not discard the other's good answer, so the split stays.
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
    const permissions$ = this.http
      .get<string[]>(`${environment.apiUrl}/roles/my-permissions`)
      .pipe(
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

    // A tenant-call failure is deliberately NOT reflected in loadState. It
    // carries module entitlements and isPlatformOrg, neither of which is a
    // statement about what this user may do.
    //
    // ACC-79 — reads GET /tenant/entitlements, NOT GET /tenant. This resolves
    // the decision this comment used to defer ("decide whether /tenant's
    // tenant:view gating is right when the first functional module ships").
    // Only TENANT_ADMIN holds tenant:view, so reading GET /tenant left
    // `modules` empty for every other role, and the rail restructure would
    // have shown non-admins none of their quality modules. The backend split
    // the endpoint rather than ungating GET /tenant, because that payload also
    // carries provider configuration and the AI credit balance. See
    // SYSTEM-REFERENCE §1.8.
    //
    // A failure here still hides every module — correctly now, since it is a
    // fault rather than the permanent 403 most users used to receive.
    const tenant$ = this.http
      .get<TenantEntitlementsResponse>(
        `${environment.apiUrl}/tenant/entitlements`,
      )
      .pipe(
        tap((tenant) => {
          this._modules.set(tenant.modules);
          this._isPlatformOrg.set(tenant.isPlatformOrg);
          this._tenantName.set(tenant.name);
          this._tenantLoadState.set('LOADED');
        }),
        catchError((err: unknown) => {
          this._modules.set({});
          this._isPlatformOrg.set(false);
          this._tenantName.set('');
          const status = (err as { status?: number })?.status;
          this._tenantLoadState.set(status === 403 ? 'FORBIDDEN' : 'FAILED');
          return of(null);
        }),
      );

    // Still completes rather than erroring — every existing caller (the
    // initializer, AppShellComponent) depends on that, and a rejected
    // initializer would block the app from bootstrapping at all.
    return forkJoin({ permissions: permissions$, tenant: tenant$ }).pipe(
      map(() => void 0),
    );
  }
}
