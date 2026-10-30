import { HttpErrorResponse } from '@angular/common/http';
import { refusalCode } from '../../../../core/http/refusal';

/**
 * ACC-120 slice 5b — what Manage roles says when the server refuses.
 *
 * NEVER the server's `message`. It is English, written for a log, and it
 * reached an Arabic session verbatim. A refusal is mapped from its CODE (and,
 * where it has none, its status) to a translation KEY. The component stores
 * the key and translates it at render time, so a language switch reaches it.
 *
 * Same shape as the permission matrix (`refusalCode()` plus status).
 * backend/Plans/step-120-5b-manage-roles-gaps.md lists every refusal the
 * dialog can receive, with its status and code.
 */

export type ManageRolesPhase = 'load' | 'save';

/** A row's add or remove, by the code the backend sends. */
const SAVE_REFUSALS: Readonly<Record<string, string>> = {
  PLATFORM_ROLE_NOT_ASSIGNABLE: 'manageRoles.refusal.platformRoleNotAssignable',
  ROLE_ALREADY_HELD: 'manageRoles.refusal.alreadyHeld',
  ROLE_FROM_HEAD_POSITION: 'manageRoles.refusal.fromHeadPosition',
  LAST_ACTIVE_ADMINISTRATOR: 'manageRoles.refusal.lastAdministrator',
  // ACC-221 — the account owner keeps Organization Administrator.
  ACCOUNT_OWNER_PROTECTED: 'manageRoles.refusal.accountOwnerProtected',
  ROLE_NOT_FOUND: 'manageRoles.refusal.roleNotFound',
  USER_NOT_FOUND: 'manageRoles.refusal.userNotFound',
  ROLE_ASSIGNMENT_NOT_FOUND: 'manageRoles.refusal.assignmentNotFound',
  RATE_LIMITED: 'manageRoles.refusal.rateLimited',
};

/** The fallback for anything not named above, per phase. */
export const MANAGE_ROLES_FALLBACK: Readonly<Record<ManageRolesPhase, string>> = {
  load: 'manageRoles.errorLoad',
  save: 'manageRoles.errorSaveRow',
};

/** The translation key for a refused load or a refused row. */
export function manageRolesRefusalKey(err: unknown, phase: ManageRolesPhase): string {
  const code = refusalCode(err);
  const status = err instanceof HttpErrorResponse ? err.status : null;

  if (phase === 'load') {
    // GET users/:id/roles needs roles:view, and users:view for anyone but
    // yourself (ACC-101); GET /roles needs roles:view. Both answer 403 with no
    // code, so the status decides.
    if (status === 403) return 'manageRoles.refusal.loadForbidden';
    if (code === 'RATE_LIMITED') return 'manageRoles.refusal.rateLimited';
    return MANAGE_ROLES_FALLBACK.load;
  }

  if (code && SAVE_REFUSALS[code]) return SAVE_REFUSALS[code];
  // The drawn sentence (Users and Roles, Manage roles outcomes): a permission
  // revoked mid-session.
  if (status === 403) return 'manageRoles.refusal.saveForbidden';
  return MANAGE_ROLES_FALLBACK.save;
}
