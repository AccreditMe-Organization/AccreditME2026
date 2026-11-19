import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { lockRolesForShare } from '../roles/role-active';

/**
 * ACC-105 — a stage's SLA escalation rules (`WorkflowStage.escalationConfig`).
 *
 * Each rule tells a person and/or a role's holders once the stage entry has
 * been past its deadline for `afterHours` WORKING hours (the organisation's
 * calendar, working-time.ts), not clock hours: "after 48 hours" over a weekend
 * means what the person who set it meant. Notify-only: nothing is reassigned.
 *
 * One shape, read here by the write (assertEscalationRules) and by the sweep
 * (readEscalationRules), so the two cannot disagree about what a rule is.
 */
export interface EscalationRule {
  afterHours: number;
  notifyUserId?: string;
  notifyRoleId?: string;
}

const RULE_KEYS: ReadonlySet<string> = new Set(['afterHours', 'notifyUserId', 'notifyRoleId']);
const isId = (v: unknown): boolean => v === undefined || (typeof v === 'string' && v.length > 0);

/** The rule at `value`, or null when it is not a valid rule. */
function asRule(value: unknown): EscalationRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rule = value as Record<string, unknown>;
  if (Object.keys(rule).some((k) => !RULE_KEYS.has(k))) return null;
  const { afterHours, notifyUserId, notifyRoleId } = rule;
  if (typeof afterHours !== 'number' || !Number.isFinite(afterHours) || afterHours <= 0) return null;
  if (!isId(notifyUserId) || !isId(notifyRoleId)) return null;
  if (notifyUserId === undefined && notifyRoleId === undefined) return null;
  return {
    afterHours,
    ...(notifyUserId !== undefined ? { notifyUserId: notifyUserId as string } : {}),
    ...(notifyRoleId !== undefined ? { notifyRoleId: notifyRoleId as string } : {}),
  };
}

/**
 * The sweep's read: each stored rule by its index, or null for one that is not
 * a valid rule (written before ACC-105 validated them). A null rule is never
 * fired; its index stays unclaimed.
 */
export function readEscalationRules(stored: unknown): (EscalationRule | null)[] {
  return Array.isArray(stored) ? stored.map(asRule) : [];
}

export type EscalationRefusalReason = 'SHAPE' | 'USER' | 'ROLE';

function refuse(reason: EscalationRefusalReason, rule: number | null, message: string): never {
  throw new BadRequestException({ statusCode: 400, message, error: 'Bad Request', code: 'STAGE_ESCALATION_INVALID', reason, rule });
}

/**
 * The write's check, on every stage save that sends `escalationConfig`: the
 * shape, then each person (an ACTIVE user of the organisation) and each role
 * (an active role of the organisation), one read each however many rules.
 * null or [] clears the rules and checks nothing. Refused with 400
 * STAGE_ESCALATION_INVALID, `{ reason, rule }` naming the first bad rule.
 *
 * ACC-154 — called INSIDE the stage save's transaction, before its write: the
 * roles are read by locking them FOR SHARE (lockRolesForShare(), scoped by id
 * and organisation), so a role deactivate cannot commit between this check and
 * the write. A save that locks first holds the deactivate, which then sees the
 * rule (ROLE_IN_USE); a save queued behind one reads the role inactive here.
 */
export async function assertEscalationRules(
  client: Pick<PrismaService, 'user' | '$queryRaw'>,
  organizationId: string,
  config: unknown,
): Promise<void> {
  if (config === null || config === undefined) return;
  if (!Array.isArray(config)) refuse('SHAPE', null, 'escalationConfig must be a list of rules');
  const rules = config.map(asRule);
  const bad = rules.findIndex((r) => r === null);
  if (bad >= 0) {
    refuse('SHAPE', bad, `Escalation rule ${bad + 1}: afterHours must be a positive number of working hours, with notifyUserId and/or notifyRoleId and nothing else`);
  }
  const valid = rules as EscalationRule[];
  const userIds = [...new Set(valid.flatMap((r) => (r.notifyUserId ? [r.notifyUserId] : [])))];
  const roleIds = [...new Set(valid.flatMap((r) => (r.notifyRoleId ? [r.notifyRoleId] : [])))];
  const [users, roles] = await Promise.all([
    userIds.length
      ? client.user.findMany({ where: { id: { in: userIds }, organizationId, status: 'ACTIVE' }, select: { id: true } })
      : Promise.resolve([]),
    lockRolesForShare(client, roleIds, organizationId),
  ]);
  const activeUsers = new Set(users.map((u) => u.id));
  const activeRoles = new Set([...roles].filter(([, r]) => r.isActive).map(([id]) => id));
  valid.forEach((r, i) => {
    if (r.notifyUserId && !activeUsers.has(r.notifyUserId)) {
      refuse('USER', i, `Escalation rule ${i + 1}: notifyUserId is not an active user of this organisation`);
    }
    if (r.notifyRoleId && !activeRoles.has(r.notifyRoleId)) {
      refuse('ROLE', i, `Escalation rule ${i + 1}: notifyRoleId is not an active role of this organisation`);
    }
  });
}
