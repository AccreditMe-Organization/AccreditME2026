import { CanActivateFn, Route, Routes } from '@angular/router';
import { routes as APP_ROUTES } from '../../app.routes';
import { ROUTE_PERMISSIONS } from './nav-items';
import { permissionGuard } from '../guards/permission.guard';
import { ownProfileGuard } from '../guards/own-profile.guard';
import { platformAdminGuard } from '../guards/platform-admin.guard';

// THE INVARIANT: if a route needs a permission, something in its chain enforces
// it.
//
// ## Why this exists, and the correction that produced it
//
// Three occurrences of "a child route was not guarded" had been recorded —
// ACC-79's admin-settings children, tasks/all, and /roles/:id/permissions. THE
// THIRD WAS WRONG, and that error is the reason for a test rather than another
// note.
//
// Angular runs every ancestor's canActivate before activating a child. The
// `roles` route in app.routes.ts carries permissionGuard, so the permission
// matrix underneath it was already protected — app.routes.ts's own header says
// exactly this. It was read as unguarded because its own routes file does not
// repeat the guard, and ACC-79's note, true of ITS case, was generalised
// without checking that the two cases differed. Proved by removing the child's
// guard and signing in as a BASE_USER: the matrix URL redirected to /home.
//
// What went wrong in the two REAL cases is narrower: the route's whole CHAIN was
// unguarded. ACC-79 removed the Admin Settings hub's nav item, so
// 'admin-settings' lost its ROUTE_PERMISSIONS entry AND its parent route had no
// canActivate of its own, leaving four screens with nothing above them.
// tasks/all is the same shape — /tasks is unmapped, so its child inherits a
// guard that finds no requirement.
//
// A reader cannot hold that distinction reliably; the evidence is that one of us
// did not, in both directions, in a single session. So it is asserted.
//
// ## Two false alarms this test raised on its first run, both kept as rules
//
// 1. A GROUPING ROUTE IS NOT A SCREEN. `users` has no component — the list is
//    its child `path: ''`, which collapses to the same URL and does carry the
//    guard. Judging the parent on its own reported a hole that cannot be
//    reached. So only ACTIVATABLE LEAVES are judged: a route that renders
//    something.
//
// 2. PERMISSIONGUARD IS NOT THE ONLY LEGITIMATE GUARD. `users/:id` runs
//    ownProfileGuard on purpose (ACC-79: every user may open their own profile,
//    anyone else's needs users:view). A test that demanded permissionGuard
//    everywhere would push that back to the defect it fixed. Alternatives are
//    named below with their reason, so adding one is a decision somebody writes
//    down.
//
// ## One test deliberately NOT written
//
// "A route running permissionGuard with nothing mapped to it." It looks like
// the mirror image and is not an invariant at all: `tasks` is unmapped and
// carries the guard precisely so its mapped child tasks/all is covered. That is
// the mechanism working, not a defect — and it was this test's other first-run
// false alarm.
//
// ## What this does NOT answer
//
// Whether the requirement is the RIGHT one. ROUTE_PERMISSIONS is derived from
// the nav model, and nav-items.ts owns that. This asserts only that whatever
// requirement exists is reachable by the guard that reads it.
//
// It is also not ACC-112, which asks whether a route can be REACHED at all. A
// route can be reachable and unguarded, or guarded and unreachable; the
// permission matrix was reachable through a row menu AND guarded. Opposite
// questions over the same table.
describe('Route guard invariant — a mapped route is guarded somewhere in its chain', () => {
  // A guard other than permissionGuard that legitimately protects a mapped
  // route. Each entry needs a reason, because an allow-list without one becomes
  // the rule.
  const ALTERNATIVE_GUARDS: ReadonlyArray<{ guard: CanActivateFn; why: string }> = [
    {
      guard: ownProfileGuard,
      why:
        'ACC-79 — users/:id. Own id always allowed, anyone else needs users:view. ' +
        'permissionGuard here would bounce a user from their own profile, which is ' +
        'the defect ACC-79 fixed.',
    },
    {
      guard: platformAdminGuard,
      why:
        'ACC-13 — /platform is gated as a whole on isPlatformOrg AND platform:admin, ' +
        'never on a tenant permission. Its routes are deliberately absent from ' +
        'ROUTE_PERMISSIONS, so this is belt-and-braces rather than load-bearing.',
    },
  ];
  const ACCEPTED = [permissionGuard, ...ALTERNATIVE_GUARDS.map((a) => a.guard)];

  // Resolves loadChildren so lazily-loaded route files are walked too. Without
  // it the test sees a dozen top-level entries and misses every screen — the
  // kind of green that proves nothing.
  async function resolveChildren(route: Route): Promise<Routes> {
    if (route.children) return route.children;
    if (!route.loadChildren) return [];
    const loaded = await (route.loadChildren as () => Promise<unknown>)();
    if (Array.isArray(loaded)) return loaded as Routes;
    const exported = Object.values(loaded as Record<string, unknown>).find((v) =>
      Array.isArray(v),
    );
    return (exported as Routes) ?? [];
  }

  interface WalkedRoute {
    /** The CONFIGURED path, exactly as permissionGuard rebuilds it. */
    fullPath: string;
    /** Renders something, rather than only grouping children. */
    isScreen: boolean;
    /** This route or an ancestor runs an accepted guard. */
    guardedInChain: boolean;
  }

  async function walk(
    routes: Routes,
    parentSegments: string[] = [],
    guardedAbove = false,
  ): Promise<WalkedRoute[]> {
    const out: WalkedRoute[] = [];
    for (const route of routes) {
      if (route.redirectTo !== undefined) continue;
      const segments = [...parentSegments, route.path ?? ''].filter((s) => s.length > 0);
      const guardedHere =
        guardedAbove ||
        (route.canActivate ?? []).some((g) => ACCEPTED.includes(g as CanActivateFn));
      out.push({
        fullPath: segments.join('/'),
        isScreen: !!route.component || !!route.loadComponent,
        guardedInChain: guardedHere,
      });
      out.push(...(await walk(await resolveChildren(route), segments, guardedHere)));
    }
    return out;
  }

  // Mirrors permissionGuard's own lookup exactly — exact match, then walk up —
  // so the test and the guard cannot disagree about which routes are mapped.
  function requirementFor(fullPath: string): readonly string[] | undefined {
    const segments = fullPath.split('/').filter((s) => s.length > 0);
    for (let i = segments.length; i > 0; i--) {
      const found = ROUTE_PERMISSIONS.get(segments.slice(0, i).join('/'));
      if (found) return found;
    }
    return undefined;
  }

  let walked: WalkedRoute[];

  beforeAll(async () => {
    walked = await walk(APP_ROUTES);
  });

  it('walks past the top level into the lazily-loaded route files', () => {
    // A floor, not a count: it may rise freely, and a fall means the walk broke
    // and every assertion below went quietly vacuous.
    expect(walked.filter((r) => r.isScreen).length).toBeGreaterThan(20);
    expect(walked.map((r) => r.fullPath)).toContain('roles/:id/permissions');
    expect(walked.map((r) => r.fullPath)).toContain('admin-settings/task-sla');
  });

  it('runs a guard somewhere in the chain of every screen that needs a permission', () => {
    const unguarded = walked
      .filter((r) => r.isScreen)
      .filter((r) => requirementFor(r.fullPath) !== undefined)
      .filter((r) => !r.guardedInChain)
      .map((r) => `${r.fullPath}  (needs ${requirementFor(r.fullPath)!.join(' + ')})`);

    // Named, not counted: "expected 1 to be 0" sends the next reader back to the
    // route table to work out which one.
    expect(unguarded).toEqual([]);
  });

  it('covers the three routes whose guarding was got wrong before', () => {
    const chainGuarded = (path: string): boolean =>
      walked.some((r) => r.fullPath === path && r.guardedInChain);

    expect(chainGuarded('admin-settings/task-sla')).toBe(true);
    expect(chainGuarded('tasks/all')).toBe(true);
    // The one that was never actually broken. Pinned so the correction cannot
    // quietly reverse.
    expect(chainGuarded('roles/:id/permissions')).toBe(true);
  });

  it('records a reason for every guard it accepts besides permissionGuard', () => {
    for (const alternative of ALTERNATIVE_GUARDS) {
      expect(alternative.why.length).toBeGreaterThan(40);
    }
  });
});
