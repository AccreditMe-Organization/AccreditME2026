import type { WorkflowObjectType, WorkflowTransitionKind } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationService } from '../notification/notification.service';
import type { TaskService } from '../task/task.service';
import type { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import type { EngineTx } from './workflow.service';

/**
 * ACC-316 PR 3a — the shape of a transition effect (transition-effects.ts), in
 * a file of its own so a record type's effects can import it without importing
 * the registry that imports them.
 */
export interface TransitionEffectContext {
  objectType: WorkflowObjectType;
  objectId: string;
  organizationId: string;
  actorId: string;
  kind: WorkflowTransitionKind;
  fromStageFlags: readonly string[];
  toStageFlags: readonly string[];
  /** The press's comment (a cancellation's reason), or null. */
  comment: string | null;
}

/**
 * What an effect may use. prepare() reads with `prisma`; apply() writes only
 * through the move's `tx`; finish() sends. ACC-316 PR 4 — `tasks`, so entering
 * MINUTES_FINAL can turn action items into tasks: prepare them before the
 * transaction, insert them inside it, announce them after it.
 */
export interface TransitionEffectDeps {
  prisma: PrismaService;
  notifications: NotificationService;
  /** The organisation's time zone, for a notice that names a date and time. */
  calendar: Pick<WorkingCalendarService, 'getEffectiveTimeZone'>;
  tasks: Pick<TaskService, 'prepareRecordTask' | 'insertPrepared' | 'announceCreated'>;
}

export interface TransitionEffect<P> {
  key: string;
  /** The flag of the stage entered that runs it. */
  flag: string;
  prepare(deps: TransitionEffectDeps, ctx: TransitionEffectContext): Promise<P>;
  /**
   * Writes inside the move's transaction, under the instance's lock. What it
   * returns (if anything) replaces the prepared value for finish(): a write that
   * must act on the rows as they stand at commit, not as prepare() read them
   * before the lock, reads them here and hands them on.
   */
  apply?(tx: EngineTx, ctx: TransitionEffectContext, prepared: P, deps: TransitionEffectDeps): Promise<P | void>;
  finish?(deps: TransitionEffectDeps, ctx: TransitionEffectContext, prepared: P): Promise<void>;
}

/** One effect, its prepared value carried opaquely between the three parts. */
export type AnyTransitionEffect = TransitionEffect<unknown>;

/** Erases an effect's prepared type for the registry; the engine passes back what prepare() returned. */
export function transitionEffect<P>(effect: TransitionEffect<P>): AnyTransitionEffect {
  return effect as unknown as AnyTransitionEffect;
}
