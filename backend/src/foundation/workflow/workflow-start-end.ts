import type { EngineTx } from './workflow.service';
import { WorkflowRefusalException } from './workflow-refusal';

/**
 * ACC-57 — a workflow template has exactly one starting stage, and no stage is
 * both its starting stage and a final one (Ahmad, 13 Nov). Every write that can
 * change a template's start or end calls assertStartAndEnd() inside its own
 * transaction, under the template's row lock, after the write: addStage,
 * updateStage (when it changes Initial or Final), removeStage and setDefault.
 * The seed is static data, pinned by workflow.seed.spec.ts.
 *
 * A template with no stages is one not yet built: it breaks nothing until it
 * has a stage. Only setDefault asks for a starting stage regardless, because
 * a default template is what startInstance() reads.
 *
 * A save is refused only when it makes the template WORSE (ACC-120's root-role
 * shape): a template already in breach — by a script, a restore — can still be
 * renamed, and fixed one save at a time.
 */

/** A stage as the rule reads it. */
export interface StartEndStage {
  id: string;
  nameEn: string;
  nameAr: string | null;
  isInitial: boolean;
  isFinal: boolean;
}

/** A stage a refusal names. */
export type NamedStage = Pick<StartEndStage, 'id' | 'nameEn' | 'nameAr'>;

export type StartEndViolation =
  | { kind: 'NO_INITIAL' }
  | { kind: 'MULTIPLE_INITIAL'; stageIds: string[] }
  | { kind: 'INITIAL_AND_FINAL'; stageIds: string[] };

/** What is wrong with a template's start and end. Nothing for a template with no stages, unless `requireStages`. */
export function startEndViolations(stages: readonly StartEndStage[], options: { requireStages?: boolean } = {}): StartEndViolation[] {
  if (stages.length === 0) return options.requireStages ? [{ kind: 'NO_INITIAL' }] : [];
  const violations: StartEndViolation[] = [];
  const initials = stages.filter((s) => s.isInitial);
  if (initials.length === 0) violations.push({ kind: 'NO_INITIAL' });
  if (initials.length > 1) violations.push({ kind: 'MULTIPLE_INITIAL', stageIds: initials.map((s) => s.id) });
  const both = stages.filter((s) => s.isInitial && s.isFinal);
  if (both.length > 0) violations.push({ kind: 'INITIAL_AND_FINAL', stageIds: both.map((s) => s.id) });
  return violations;
}

/**
 * The refusal a save earns, comparing the template after it with the template
 * before it — or null when the save made nothing worse:
 * - a stage both initial and final that was not before;
 * - no starting stage, where there was one (or the template was empty);
 * - more starting stages than before, two or more.
 * `subject` is the stage the save was about (named when the save left the
 * template without a starting stage).
 */
export function startEndRefusal(
  before: readonly StartEndStage[],
  after: readonly StartEndStage[],
  subject?: NamedStage,
): WorkflowRefusalException | null {
  const name = (s: NamedStage) => ({ nameEn: s.nameEn, nameAr: s.nameAr });
  const was = startEndViolations(before);
  const now = startEndViolations(after);

  const bothBefore = new Set(was.flatMap((v) => (v.kind === 'INITIAL_AND_FINAL' ? v.stageIds : [])));
  const bothNew = after.filter((s) => s.isInitial && s.isFinal && !bothBefore.has(s.id));
  if (bothNew.length > 0) {
    return new WorkflowRefusalException('STAGE_INITIAL_AND_FINAL', {
      stageIds: bothNew.map((s) => s.id),
      stageNames: bothNew.map(name),
    });
  }

  if (now.some((v) => v.kind === 'NO_INITIAL') && !was.some((v) => v.kind === 'NO_INITIAL')) {
    const named = subject ? [subject] : [];
    return new WorkflowRefusalException('STAGE_INITIAL_REQUIRED', {
      stageIds: named.map((s) => s.id),
      stageNames: named.map(name),
    });
  }

  const initialsBefore = before.filter((s) => s.isInitial).length;
  const initialsAfter = after.filter((s) => s.isInitial);
  if (initialsAfter.length > 1 && initialsAfter.length > initialsBefore) {
    return new WorkflowRefusalException('STAGE_INITIAL_NOT_UNIQUE', {
      stageIds: initialsAfter.map((s) => s.id),
      stageNames: initialsAfter.map(name),
    });
  }
  return null;
}

/**
 * A template's stages as the rule reads them, in stage order. Run inside the
 * save's transaction, after the template lock. Scoped by organisation as well as
 * template (the stage has no organisation column of its own).
 */
export function readStartEnd(tx: EngineTx, templateId: string, organizationId: string): Promise<StartEndStage[]> {
  return tx.workflowStage.findMany({
    where: { workflowTemplateId: templateId, workflowTemplate: { organizationId } },
    select: { id: true, nameEn: true, nameAr: true, isInitial: true, isFinal: true },
    orderBy: { order: 'asc' },
  });
}

/** Refuses (rolling the save back) when the save made the template's start or end worse than `before`. */
export async function assertStartAndEnd(
  tx: EngineTx,
  templateId: string,
  organizationId: string,
  before: readonly StartEndStage[],
  subject?: NamedStage,
): Promise<void> {
  const refusal = startEndRefusal(before, await readStartEnd(tx, templateId, organizationId), subject);
  if (refusal) throw refusal;
}

/**
 * Q1 (Ahmad, 13 Nov) — ticking Initial on a stage MOVES the starting stage to
 * it: every other starting stage of the template is cleared, in the save's
 * transaction. Returns the stages it cleared, for their audit rows and the
 * panel's "{{stage}} is no longer the starting stage". `except` is the stage
 * being saved (absent while adding: it does not exist yet).
 */
export async function clearOtherStartingStages(
  tx: EngineTx,
  templateId: string,
  organizationId: string,
  before: readonly StartEndStage[],
  except?: string,
): Promise<NamedStage[]> {
  const others = before.filter((s) => s.isInitial && s.id !== except);
  if (others.length === 0) return [];
  await tx.workflowStage.updateMany({
    where: { workflowTemplateId: templateId, workflowTemplate: { organizationId }, id: { in: others.map((s) => s.id) } },
    data: { isInitial: false },
  });
  return others.map(({ id, nameEn, nameAr }) => ({ id, nameEn, nameAr }));
}

/**
 * Q2 (Ahmad, 13 Nov) — a template becomes the default only with a starting
 * stage: the default is what startInstance() reads, and one without a starting
 * stage throws at whoever creates a record, not at the admin who chose it.
 * Strict, unlike a stage save: becoming the default is the moment it must work.
 */
export async function assertHasStartingStage(tx: EngineTx, templateId: string, organizationId: string): Promise<void> {
  const stages = await readStartEnd(tx, templateId, organizationId);
  if (startEndViolations(stages, { requireStages: true }).some((v) => v.kind === 'NO_INITIAL')) {
    throw new WorkflowRefusalException('STAGE_INITIAL_REQUIRED', { stageIds: [], stageNames: [] });
  }
}
