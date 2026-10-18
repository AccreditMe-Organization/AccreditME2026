import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../core/formatting';
import { LanguageService } from '../../../core/services/language.service';
import { extractErrorMessage } from '../../../shared/utils/http-error.util';
import { RoleService, UserRoleGrantDto } from '../../roles/services/role.service';
import { IUserDto, UserService } from './user.service';
import { AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';

/**
 * ACC-120 slice 5 — the three status actions, written ONCE for both screens
 * that offer them: the Users list's row menu and the user record page.
 *
 * Before this the list owned the confirms, and the record page would have
 * needed a second copy of their wording, their flows and — the part that
 * drifts — the rule for which one applies. Two copies of "may this person be
 * deactivated from here?" is the shape ACC-120's last-admin work removed four
 * of; there is now one.
 */
export type UserStatusAction = 'deactivate' | 'reactivate' | 'revokeInvitation';

/**
 * THE STATUS SLOT (ACC-83): one action, chosen by the user's status, each
 * gated on BOTH its permission and the status the backend accepts, so neither
 * screen offers something that comes back 403 or 409.
 *
 * Deactivate is never offered on the viewer's OWN record or row (CC-88, D4
 * and A1). The backend allows it, subject only to the last-administrator rule,
 * and the first thing it does is end the caller's own sessions: offering it as
 * one click among the actions on your own profile is offering a lockout.
 */
export function statusActionFor(
  user: Pick<IUserDto, 'id' | 'status'>,
  hasPermission: (permission: string) => boolean,
  viewerId: string | null | undefined,
): UserStatusAction | null {
  switch (user.status) {
    case 'ACTIVE':
      return hasPermission('users:deactivate') && user.id !== viewerId ? 'deactivate' : null;
    case 'INACTIVE':
      return hasPermission('users:reactivate') ? 'reactivate' : null;
    case 'INVITED':
      return hasPermission('users:invite') ? 'revokeInvitation' : null;
    default:
      // SUSPENDED: no feature produces it, and no action is defined for it.
      return null;
  }
}

/** What the caller does once the action has run, or failed. */
export interface UserStatusActionResult {
  /** The sentence to show — already translated. */
  succeeded(message: string): void;
  failed(message: string): void;
}

@Injectable({ providedIn: 'root' })
export class UserStatusActionsService {
  private readonly amConfirm = inject(AmConfirmService);
  private readonly userService = inject(UserService);
  private readonly roleService = inject(RoleService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly languageService = inject(LanguageService);

  confirm(action: UserStatusAction, user: IUserDto, result: UserStatusActionResult): void {
    switch (action) {
      case 'deactivate':
        return this.confirmDeactivate(user, result);
      case 'reactivate':
        return this.confirmReactivate(user, result);
      case 'revokeInvitation':
        return this.confirmRevokeInvitation(user, result);
    }
  }

  // Per step-09 plan Section 12, Discussion 5: shows the user's name and a
  // qualitative impact statement up front — the EXACT count of tasks affected
  // is only known once the backend actually runs the departure flow (there is
  // no preview endpoint), so the real counts are surfaced as a message
  // immediately after the action completes instead of guessed at in the
  // confirmation copy.
  confirmDeactivate(user: IUserDto, result: UserStatusActionResult): void {
    this.amConfirm.ask({
      tone: 'destructive',
      message: this.translate.instant('user.deactivateConfirm', { name: user.name }),
      header: this.translate.instant('user.deactivate'),
      acceptLabel: this.translate.instant('user.deactivate'),
      accept: () => {
        this.userService.deactivate(user.id).subscribe({
          next: ({ reassignedCount, unassignedCount }) =>
            result.succeeded(
              // Two counts, two plural forms: one rule cannot agree with both.
              this.translate.instant('user.deactivateSummary', {
                reassigned: this.format.count('user.tasksReassigned', reassignedCount),
                flagged: this.format.count('user.tasksFlaggedUnassigned', unassignedCount),
              }),
            ),
          error: (err: unknown) => result.failed(extractErrorMessage(err, 'Deactivate failed')),
        });
      },
    });
  }

  /**
   * ACC-83 — reactivation says what COMES BACK, before the click.
   *
   * UserRole rows survive deactivation, so a reactivated person returns holding
   * every direct role they had — possibly Organization Administrator. An
   * administrator should see the authority they are about to restore while
   * deciding, not discover it afterwards on the Roles screen.
   *
   * So the roles are fetched FIRST and the dialog waits for them. If that read
   * is refused — a caller may hold users:reactivate without users:view, and
   * GET /users/:id/roles needs the parent permission (ACC-101) — the dialog
   * still opens and SAYS the roles could not be listed, rather than implying
   * there are none.
   */
  confirmReactivate(user: IUserDto, result: UserStatusActionResult): void {
    this.roleService.getUserRoles(user.id).subscribe({
      next: (grants: UserRoleGrantDto[]) =>
        this.openReactivateConfirm(
          user,
          grants.map((g) => g.role),
          false,
          result,
        ),
      error: () => this.openReactivateConfirm(user, [], true, result),
    });
  }

  private openReactivateConfirm(
    user: IUserDto,
    roles: { nameEn: string; nameAr: string | null }[],
    rolesUnavailable: boolean,
    result: UserStatusActionResult,
  ): void {
    const roleLine = rolesUnavailable
      ? this.translate.instant('user.reactivateRolesUnavailable')
      : roles.length === 0
        ? this.translate.instant('user.reactivateNoRoles')
        : this.translate.instant('user.reactivateRoles', {
            roles: roles.map((r) => this.languageService.bilingual(r.nameEn, r.nameAr)).join(', '),
          });

    this.amConfirm.ask({
      tone: 'neutral',
      // ONE key, with the roles sentence passed INTO it: word order and
      // punctuation belong to the translation (check:confirm-translated).
      message: this.translate.instant('user.reactivateConfirm', {
        name: user.name,
        roles: roleLine,
      }),
      header: this.translate.instant('user.reactivate'),
      acceptLabel: this.translate.instant('user.reactivate'),
      accept: () => {
        this.userService.reactivate(user.id).subscribe({
          next: ({ returnedTaskCount }) =>
            result.succeeded(
              this.translate.instant('user.reactivateSummary', {
                name: user.name,
                tasks: this.format.count('user.tasksReturned', returnedTaskCount),
              }),
            ),
          error: (err: unknown) => result.failed(extractErrorMessage(err, 'Reactivate failed')),
        });
      },
    });
  }

  /**
   * ACC-83 — withdrawing an invitation, which is destructive in a way
   * deactivation is not: the row goes, so the confirmation says so plainly and
   * says the email becomes free again.
   */
  confirmRevokeInvitation(user: IUserDto, result: UserStatusActionResult): void {
    this.amConfirm.ask({
      tone: 'destructive',
      message: this.translate.instant('user.revokeInvitationConfirm', {
        name: user.name,
        email: user.email,
      }),
      header: this.translate.instant('user.revokeInvitation'),
      acceptLabel: this.translate.instant('user.revokeInvitation'),
      accept: () => {
        this.userService.revokeInvitation(user.id).subscribe({
          next: () =>
            result.succeeded(this.translate.instant('user.revokeInvitationSummary', { name: user.name })),
          error: (err: unknown) => result.failed(extractErrorMessage(err, 'Revoke failed')),
        });
      },
    });
  }
}
