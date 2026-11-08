import { inject } from '@angular/core';
import { NavigationAccessService } from '../services/navigation-access.service';
import { MyWorkCountsService } from '../../foundation/home/my-work-counts.service';
import { NavAccess } from './nav-items';

/**
 * ACC-281 — the NavAccess every reader of the nav model uses: the rail, the
 * breadcrumb and the tab title, so all three agree on which items a person sees.
 *
 * Composed here rather than in NavigationAccessService, because
 * MyWorkCountsService already injects NavigationAccessService: injecting it back
 * would be a circular dependency. Each method delegates explicitly. Spreading
 * the service would lose its methods, which live on the class prototype.
 *
 * isCommitteeMember reads a signal MyWorkCountsService already holds. The shell
 * loads it after sign-in. Nothing here starts a load, a timer or a request.
 * Call inside an injection context (a field initialiser).
 */
export function injectNavAccess(): NavAccess {
  const access = inject(NavigationAccessService);
  const myWork = inject(MyWorkCountsService);
  return {
    hasPermission: (permission) => access.hasPermission(permission),
    isModuleEnabled: (moduleKey) => access.isModuleEnabled(moduleKey),
    isPlatformAdmin: () => access.isPlatformAdmin(),
    isCommitteeMember: () => myWork.isCommitteeMember(),
  };
}
