import { ITaskActions, TaskPrimaryAction } from './interfaces/task-page.interface';
import { PICKABLE_STATUSES } from './task-pool';
import { REQUESTABLE_STATUSES } from './task-request-lifecycle';

/**
 * ACC-228 — WHAT A VIEWER MAY DO ON ONE TASK, from the facts the server already
 * holds. Each line restates the refusal of the endpoint it stands for, so a
 * button is offered exactly when that endpoint would not refuse the viewer for
 * who they are or for the task's state. The endpoints re-check everything;
 * this only decides what to show. The task page reads it, and ACC-229's record
 * panel will read it per row.
 *
 * A pure function on purpose: the facts that need a query (who acts for the
 * creator, pool membership, whether a reopened workflow task is still in its
 * step) are gathered once by the caller, and each rule here is testable alone.
 */
export interface TaskActionFacts {
  status: string;
  requiresEvidence: boolean;
  evidenceCount: number;
  viewerId: string;
  /** The viewer holds a TaskAssignee row with removedAt null. */
  viewerIsActiveAssignee: boolean;
  /** …and that row came from a pick. */
  viewerPickedIt: boolean;
  /** Anyone at all is an active assignee. */
  anyActiveAssignee: boolean;
  /** The task remembers a pool target (ACC-167). */
  hasPoolTarget: boolean;
  /** The viewer is in that pool right now (task-pool.ts isPoolMember). */
  viewerInPool: boolean;
  openRequest: { requestedById: string } | null;
  /** mayManage(): the creator, anyone acting for them, or tasks:reassign while the creator is gone. */
  mayManage: boolean;
  /** tasks:reassign, or canActForCreator(): who may reassign, decide a request and resume. */
  mayDecide: boolean;
  /** ACC-190 — created from a stage task definition, for one stage entry. */
  stageEntryTask: boolean;
  isMandatory: boolean;
  /** An older workflow task with no stage entry (sourceStageId or workflowInstanceId only). */
  legacyWorkflowTask: boolean;
  /** For a Completed workflow task: its record is still in that step (reopen's own check). */
  stillInStep: boolean;
}

const CLOSED = new Set(['COMPLETED', 'CANCELLED']);
// start(): PENDING, or a row stored as OVERDUE before ACC-163's backfill.
const STARTABLE = new Set(['PENDING', 'OVERDUE']);
// reject(): Assigned or In progress.
const REJECTABLE = new Set(['PENDING', 'IN_PROGRESS', 'OVERDUE']);

export function taskActionsFor(f: TaskActionFacts): ITaskActions {
  const open = !CLOSED.has(f.status);
  const onHold = f.status === 'ON_HOLD';
  const assignee = f.viewerIsActiveAssignee;

  // lockOpenForActiveAssignee(): an active assignee, the task open, and not on hold.
  const start = assignee && STARTABLE.has(f.status);
  const complete = assignee && open && !onHold;
  const reject = assignee && REJECTABLE.has(f.status);
  // release(): only a row that came from a pick, while the task keeps its pool.
  const release = assignee && f.viewerPickedIt && f.hasPoolTarget && open && !onHold;
  // pick(): a member of the task's pool, nobody on it yet, the task still waiting.
  const pickUp =
    f.hasPoolTarget && f.viewerInPool && !f.anyActiveAssignee && (PICKABLE_STATUSES as readonly string[]).includes(f.status);
  // TaskRequestService.create(): an active assignee of an Assigned or In-progress task, one request at a time.
  const canAsk = assignee && REQUESTABLE_STATUSES.includes(f.status) && !f.openRequest;
  const withdrawRequest = !!f.openRequest && f.openRequest.requestedById === f.viewerId;
  // decide(): tasks:reassign or acting for the creator — never the person who asked.
  const reviewRequest = !!f.openRequest && f.openRequest.requestedById !== f.viewerId && f.mayDecide;
  // resume(): an active assignee, or anyone who may decide.
  const resume = onHold && (assignee || f.mayDecide);
  // TaskEvidenceService: an active assignee while the task is open (on hold included).
  const addEvidence = assignee && open;
  // reassign(): tasks:reassign or canActForCreator, the task not closed.
  const reassign = open && f.mayDecide;
  // update(): mayManage, not closed.
  const edit = f.mayManage && open;
  // cancel(): a stage-entry task only when optional; an older workflow task never.
  const cancel = edit && (f.stageEntryTask ? !f.isMandatory : !f.legacyWorkflowTask);
  // reopen(): mayManage, Completed, and a workflow task's record still in that step.
  const reopen = f.mayManage && f.status === 'COMPLETED' && f.stillInStep;

  const actions: Omit<ITaskActions, 'primary'> = {
    start,
    complete,
    completeNeedsEvidence: complete && f.requiresEvidence && f.evidenceCount === 0,
    reject,
    release,
    pickUp,
    requestMoreTime: canAsk,
    requestHold: canAsk,
    withdrawRequest,
    reviewRequest,
    resume,
    addEvidence,
    reassign,
    edit,
    cancel,
    reopen,
  };
  return { ...actions, primary: primaryAction(actions, f.status) };
}

/**
 * The drawn precedence (Record Tasks Panel §4): a decision waiting on the
 * viewer comes first, then taking a pool task, then the status's own step —
 * Start for Assigned, Complete for In progress, Resume for On hold. Complete
 * on an Assigned task is offered too (the app allows it, Q6), in the menu.
 */
function primaryAction(a: Omit<ITaskActions, 'primary'>, status: string): TaskPrimaryAction | null {
  if (a.reviewRequest) return 'REVIEW_REQUEST';
  if (a.pickUp) return 'PICK_UP';
  if (a.start) return 'START';
  if (a.complete && status === 'IN_PROGRESS') return 'COMPLETE';
  if (a.resume) return 'RESUME';
  return null;
}
