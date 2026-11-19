import { TranslateService } from '@ngx-translate/core';
import { refusalCode } from '../../core/http/refusal';

/**
 * ACC-154 — a deactivated role is never given out again. The server refuses
 * with 409 `ROLE_INACTIVE` (`role-active.ts`) wherever a role would be handed
 * out: Manage roles, a position's role, and every path that puts someone in a
 * head position or an acting cover (invite, edit profile, transfer, appoint
 * head, appoint successor, set acting head, the headship actions).
 *
 * Every one of those screens says it through this one function, in the dialog
 * or row that made the call. Never the server's English `message`.
 */
export const ROLE_INACTIVE = 'ROLE_INACTIVE';

/** The sentence for a ROLE_INACTIVE refusal, or null for any other error. */
export function roleInactiveMessage(err: unknown, translate: TranslateService): string | null {
  return refusalCode(err) === ROLE_INACTIVE ? translate.instant('roles.refusal.roleInactive') : null;
}
