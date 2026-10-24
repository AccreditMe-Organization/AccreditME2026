import { inject } from '@angular/core';
import { ActivatedRoute, ActivatedRouteSnapshot } from '@angular/router';

/**
 * ACC-120 slice 11, PR F — the Organisation pages live at two paths (D1, B1):
 *
 * - `/organization`, under Administration, for `admin:access` + `org:view`;
 * - `/org`, under Quality management, READ-ONLY, for `org:view` holders who
 *   do not administer (OS §6, L409-451).
 *
 * The same tree, chart and record serve both. The read-only route says so in
 * its data, and each page asks here for its mode and for the base its own
 * links use, so a link from a read-only page never leaves `/org`.
 */
export const ORG_ADMIN_BASE = '/organization';
export const ORG_READ_ONLY_BASE = '/org';
/** The route data key the `/org` route sets. */
export const ORG_READ_ONLY_DATA = 'orgReadOnly';

export interface OrgPages {
  /** The `/org` page: every write affordance and Setup health prompt is absent. */
  readonly readOnly: boolean;
  /** `/org` or `/organization`, whichever this page was opened at. */
  readonly base: string;
  /** A unit's record, at this page's base. */
  unit(id: string): string[];
}

export function isOrgReadOnly(route: ActivatedRouteSnapshot | null | undefined): boolean {
  if (!route) return false;
  // A test's stub route may carry its own data and no ancestry.
  const chain: readonly (ActivatedRouteSnapshot | null | undefined)[] = route.pathFromRoot ?? [route];
  return chain.some((r) => r?.data?.[ORG_READ_ONLY_DATA] === true);
}

export function orgPagesFor(readOnly: boolean): OrgPages {
  const base = readOnly ? ORG_READ_ONLY_BASE : ORG_ADMIN_BASE;
  return { readOnly, base, unit: (id) => [`${base}/units`, id] };
}

/**
 * The mode of the page this component sits on. Fixed for the component's
 * life: `/org` and `/organization` are different routes, so moving between
 * them builds the page again.
 */
export function injectOrgPages(): OrgPages {
  const route = inject(ActivatedRoute, { optional: true });
  return orgPagesFor(isOrgReadOnly(route?.snapshot));
}
