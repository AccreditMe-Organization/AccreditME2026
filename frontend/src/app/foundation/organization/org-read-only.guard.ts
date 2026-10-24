import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ADMIN_ACCESS } from '../../core/navigation/admin-access';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { ORG_ADMIN_BASE, ORG_READ_ONLY_BASE } from './org-pages';

/**
 * ACC-120 slice 11, PR F — `/org` is the read-only page for a viewer who does
 * not administer. An administrator who opens a `/org` link (shared by a
 * quality manager, say) is sent to the same place under `/organization`, with
 * the path and query kept, so they land on the page with their write controls
 * and never see the read-only copy.
 *
 * Runs BEFORE permissionGuard. With permissions not yet known it lets the
 * request through, as permissionGuard does (ACC-70): the page is then shown
 * read-only, which is the safe direction.
 */
export const orgReadOnlyRedirectGuard: CanActivateFn = (_route, state) => {
  const access = inject(NavigationAccessService);
  if (!access.hasTrustworthyPermissions() || !access.hasPermission(ADMIN_ACCESS)) return true;
  return inject(Router).parseUrl(toAdminUrl(state.url));
};

/** `/org/units/x?view=chart` → `/organization/units/x?view=chart`. Only a leading `/org` segment moves. */
export function toAdminUrl(url: string): string {
  return url.replace(new RegExp(`^${ORG_READ_ONLY_BASE}(?=$|[/?#])`), ORG_ADMIN_BASE);
}
