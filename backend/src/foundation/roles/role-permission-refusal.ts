import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/**
 * ACC-120 slice 5 — the refusals a permission save or a role assignment can
 * answer with. Same body shape as the storage and email-settings refusals: the
 * code travels in the body HttpExceptionFilter sends, and the frontend words it
 * in both languages. The English `message` is for logs and API readers.
 */

/** The role's set changed since the caller loaded it (D4). */
export const ROLE_PERMISSIONS_CHANGED = 'ROLE_PERMISSIONS_CHANGED';
/** The Platform Administrator role's set is frozen in every organisation (R1c, CC-93). */
export const PLATFORM_ROLE_NOT_EDITABLE = 'PLATFORM_ROLE_NOT_EDITABLE';
/** A tenant role may not gain a platform:* key (R1). */
export const PLATFORM_PERMISSION_NOT_ALLOWED = 'PLATFORM_PERMISSION_NOT_ALLOWED';
/** The Platform Administrator role cannot be assigned inside a tenant (R1). */
export const PLATFORM_ROLE_NOT_ASSIGNABLE = 'PLATFORM_ROLE_NOT_ASSIGNABLE';
/** A key no code checks yet cannot be granted (R2). */
export const PERMISSION_NOT_IN_USE = 'PERMISSION_NOT_IN_USE';

// ACC-120 slice 5b — the role-ASSIGNMENT refusals that carried only an English
// message, so Manage roles could not say them in Arabic without parsing English.
// Same status, same English message and same exception type as before; the
// code is the only thing added, so every caller and spec reads them as before.
/** The role is not in this organisation. */
export const ROLE_NOT_FOUND = 'ROLE_NOT_FOUND';
/** The person is not in this organisation. */
export const USER_NOT_FOUND = 'USER_NOT_FOUND';
/** The person already holds the role. */
export const ROLE_ALREADY_HELD = 'ROLE_ALREADY_HELD';
/** The person does not hold the role (any more). */
export const ROLE_ASSIGNMENT_NOT_FOUND = 'ROLE_ASSIGNMENT_NOT_FOUND';
/** The grant comes with a head position; it ends with the headship. */
export const ROLE_FROM_HEAD_POSITION = 'ROLE_FROM_HEAD_POSITION';
/** The change would leave the organisation with no active administrator (the ACC-120 invariant). */
export const LAST_ACTIVE_ADMINISTRATOR = 'LAST_ACTIVE_ADMINISTRATOR';

export class RolePermissionsChangedException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      message: 'This role was changed by someone else since it was opened. Nothing was saved.',
      error: 'Conflict',
      code: ROLE_PERMISSIONS_CHANGED,
    });
  }
}

export class PlatformRoleNotEditableException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      message: 'The Platform Administrator role has a fixed permission set and cannot be changed.',
      error: 'Conflict',
      code: PLATFORM_ROLE_NOT_EDITABLE,
    });
  }
}

export class PlatformPermissionNotAllowedException extends BadRequestException {
  constructor(readonly keys: readonly string[]) {
    super({
      statusCode: 400,
      message: 'Platform permissions cannot be given to a role inside an organisation.',
      error: 'Bad Request',
      code: PLATFORM_PERMISSION_NOT_ALLOWED,
      keys,
    });
  }
}

export class PlatformRoleNotAssignableException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      message: 'The Platform Administrator role cannot be assigned inside an organisation.',
      error: 'Bad Request',
      code: PLATFORM_ROLE_NOT_ASSIGNABLE,
    });
  }
}

export class PermissionNotInUseException extends BadRequestException {
  constructor(readonly keys: readonly string[]) {
    super({
      statusCode: 400,
      message: 'These permissions are not used by anything yet and cannot be granted.',
      error: 'Bad Request',
      code: PERMISSION_NOT_IN_USE,
      keys,
    });
  }
}

/** The catalogue has no such key (F1: a transition's requiredPermission). */
export const PERMISSION_UNKNOWN = 'PERMISSION_UNKNOWN';

export class PermissionUnknownException extends BadRequestException {
  constructor(readonly keys: readonly string[]) {
    super({
      statusCode: 400,
      message: 'These permissions do not exist.',
      error: 'Bad Request',
      code: PERMISSION_UNKNOWN,
      keys,
    });
  }
}

export class RoleNotFoundException extends NotFoundException {
  constructor() {
    super({ statusCode: 404, message: 'Role not found', error: 'Not Found', code: ROLE_NOT_FOUND });
  }
}

export class UserNotFoundForRoleException extends NotFoundException {
  constructor() {
    super({ statusCode: 404, message: 'User not found', error: 'Not Found', code: USER_NOT_FOUND });
  }
}

export class RoleAlreadyHeldException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      message: 'User is already assigned to this role',
      error: 'Conflict',
      code: ROLE_ALREADY_HELD,
    });
  }
}

export class RoleAssignmentNotFoundException extends NotFoundException {
  constructor() {
    super({
      statusCode: 404,
      message: 'Role assignment not found',
      error: 'Not Found',
      code: ROLE_ASSIGNMENT_NOT_FOUND,
    });
  }
}

export class RoleFromHeadPositionException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      message:
        "This role comes with the user's head position and cannot be removed here. " +
        'End it by changing the head position itself.',
      error: 'Conflict',
      code: ROLE_FROM_HEAD_POSITION,
    });
  }
}

export class LastActiveAdministratorException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      message:
        'This would leave the organization with no active administrator. ' +
        'Give the Organization Administrator role to an active user first, then try again.',
      error: 'Conflict',
      code: LAST_ACTIVE_ADMINISTRATOR,
    });
  }
}
