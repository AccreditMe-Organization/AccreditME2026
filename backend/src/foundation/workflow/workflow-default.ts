import type { WorkflowObjectType } from '../../../generated/prisma/client';
import type { EngineTx } from './workflow.service';

/**
 * ACC-303 — every record type of an organisation has exactly ONE default
 * template: the one startInstance() starts a new record on (it reads the
 * ACTIVE default). Every path that changes which template that is goes
 * through this file, in one order:
 *
 *   1. lockTypeDefaults() — the per-(organisation, record type) lock, before
 *      anything is read. Two writers of the same type's default queue here.
 *      A template row lock cannot do it: a create has no row yet, and two
 *      promotions of DIFFERENT templates each held their own row and waited on
 *      the other's (a deadlock). ACC-233's shape (committee-hierarchy).
 *   2. the template's own row lock (WorkflowTemplateService.lockTemplate), for
 *      the starting-stage check (ACC-57).
 *   3. a re-read of the template, then the refusals, then makeDefaultInTx().
 *
 * Released when the transaction ends.
 */
export async function lockTypeDefaults(tx: EngineTx, organizationId: string, objectTypes: readonly WorkflowObjectType[]): Promise<void> {
  // Sorted and unique, so two writers locking the same two types (a type
  // change) take them in the same order and cannot deadlock.
  for (const objectType of [...new Set(objectTypes)].sort()) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`workflow-default:${organizationId}:${objectType}`}))::text`;
  }
}

/**
 * Makes `templateId` the default of its type and clears every other template
 * of that type in the organisation, in the caller's transaction, under the
 * caller's lockTypeDefaults(). Another organisation's templates and another
 * type's are never touched: the clear names both.
 */
export async function makeDefaultInTx(
  tx: EngineTx,
  templateId: string,
  organizationId: string,
  objectType: WorkflowObjectType,
): Promise<void> {
  await tx.workflowTemplate.updateMany({
    where: { organizationId, objectType, isDefault: true, NOT: { id: templateId } },
    data: { isDefault: false },
  });
  await tx.workflowTemplate.update({ where: { id: templateId }, data: { isDefault: true } });
}
