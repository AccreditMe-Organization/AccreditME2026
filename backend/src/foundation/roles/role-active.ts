import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * ACC-154 — a deactivated role is never given out again: not to a person
 * (assignRoleToUser), not through a head position (grantRoleViaHeadAuthority,
 * and the position paths that lead to it), not as a position's role, and not
 * as a stage escalation's recipient. Refused with 409 ROLE_INACTIVE.
 *
 * THE RACE, and why the check is a LOCK: deactivateRole() takes the role row
 * FOR UPDATE and then reads what still holds or names it (roleReferences()). A
 * writer that only READ `isActive` could pass its check, let a deactivate
 * commit, and then write a grant or a reference the deactivate never saw. So a
 * writer takes the role row FOR SHARE, inside its own transaction, before its
 * write, and reads `isActive` from that locked row:
 *   - a writer that locks first holds the deactivate until it commits, and the
 *     deactivate then sees the new grant or reference and refuses (ROLE_IN_USE);
 *   - a writer queued behind a deactivate reads the committed `isActive: false`
 *     after the lock, and refuses (ROLE_INACTIVE).
 * FOR SHARE, not FOR UPDATE: two grants of the same role never wait for each
 * other, only for a deactivate.
 */
export const ROLE_INACTIVE = 'ROLE_INACTIVE';

export class RoleInactiveException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      message: 'This role is inactive and cannot be given out. Reactivate it first, or choose another role.',
      error: 'Conflict',
      code: ROLE_INACTIVE,
    });
  }
}

type Client = Pick<PrismaService, '$queryRaw'>;

/**
 * Locks the roles FOR SHARE, scoped by id AND organisation, and returns which
 * of them exist here and which of those are active. One statement for any
 * number of roles; ids not in this organisation are simply absent.
 */
export async function lockRolesForShare(
  tx: Client,
  roleIds: readonly string[],
  organizationId: string,
): Promise<Map<string, { isActive: boolean }>> {
  if (roleIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ id: string; isActive: boolean }[]>(Prisma.sql`
    SELECT id, "isActive" FROM "Role"
     WHERE id IN (${Prisma.join([...roleIds])}) AND "organizationId" = ${organizationId}
     ORDER BY id
     FOR SHARE`);
  return new Map(rows.map((r) => [r.id, { isActive: r.isActive }]));
}

/**
 * One role, locked FOR SHARE: refused with ROLE_INACTIVE when it is inactive.
 * Returns false when the role is not in this organisation at all, so the
 * caller keeps its own not-found answer.
 */
export async function lockActiveRole(tx: Client, roleId: string, organizationId: string): Promise<boolean> {
  const role = (await lockRolesForShare(tx, [roleId], organizationId)).get(roleId);
  if (!role) return false;
  if (!role.isActive) throw new RoleInactiveException();
  return true;
}
