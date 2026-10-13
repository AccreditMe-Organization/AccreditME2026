import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * ACC-120 slice 5 — the refusals a permission save or a role assignment can
 * answer with. Same body shape as the storage and email-settings refusals: the
 * code travels in the body HttpExceptionFilter sends, and the frontend words it
 * in both languages. The English `message` is for logs and API readers.
 */

/** The role's set changed since the caller loaded it (D4). */
export const ROLE_PERMISSIONS_CHANGED = 'ROLE_PERMISSIONS_CHANGED';
/** The Platform Administrator role cannot be edited inside a tenant (R1c). */
export const PLATFORM_ROLE_NOT_EDITABLE = 'PLATFORM_ROLE_NOT_EDITABLE';
/** A tenant role may not gain a platform:* key (R1). */
export const PLATFORM_PERMISSION_NOT_ALLOWED = 'PLATFORM_PERMISSION_NOT_ALLOWED';
/** The Platform Administrator role cannot be assigned inside a tenant (R1). */
export const PLATFORM_ROLE_NOT_ASSIGNABLE = 'PLATFORM_ROLE_NOT_ASSIGNABLE';
/** A key no code checks yet cannot be granted (R2). */
export const PERMISSION_NOT_IN_USE = 'PERMISSION_NOT_IN_USE';

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
      message: 'The Platform Administrator role cannot be changed inside an organisation.',
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
