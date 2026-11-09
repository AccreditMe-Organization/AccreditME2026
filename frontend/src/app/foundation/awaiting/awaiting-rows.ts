import { recordPageLink } from '../../shared/utils/record-link.util';
import type { WorkflowAwaitingRowDto } from '../workflow/services/workflow.service';
import type { ChangeRequestDto } from '../committees/change-requests/change-request.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One thing waiting on the person: a record at their stage, or a change request to decide. */
export interface AwaitingRow {
  id: string;
  kind: 'stage' | 'change';
  /** When it began waiting: entering the stage, or a change request's Submit. */
  since: string;
  title: string;
  meta: string;
  /** "3 days waiting": how long, from `since`. */
  waiting: string;
  /** The record's page; null for a record with no page yet, named without a link. */
  link: string[] | null;
}

/** What a row needs to word itself, so the builders stay pure (no injection). */
export interface AwaitingWords {
  t(key: string, params?: Record<string, unknown>): string;
  bilingual(en: string, ar: string | null): string;
  number(n: number): string;
  duration(ms: number): string;
  relative(since: string, now: Date): string;
}

/**
 * ACC-120 — a record waiting at this person's stage, worded exactly as Home's
 * "Awaiting my action" panel words it: the record, linked when it has a page,
 * then "type · stage n/N · waiting".
 */
export function stageRow(r: WorkflowAwaitingRowDto, w: AwaitingWords, now: Date): AwaitingRow {
  return {
    id: r.instanceStageId,
    kind: 'stage',
    since: r.since,
    title: w.bilingual(r.record.nameEn, r.record.nameAr),
    meta: w.t('home.awaitingStageMeta', {
      type: w.t(`workflow.objectTypeName.${r.record.type}`),
      stage: w.bilingual(r.stage.nameEn, r.stage.nameAr),
      position: w.number(r.stage.position),
      count: w.number(r.stage.stageCount),
    }),
    waiting: waitingText(r.since, w, now),
    link: recordPageLink(r.record.type, r.record.id),
  };
}

/** A committee change request to decide: "Change request n · committee", "From name". */
export function changeRow(r: ChangeRequestDto, w: AwaitingWords, now: Date): AwaitingRow {
  const since = r.submittedAt ?? r.createdAt;
  return {
    id: r.id,
    kind: 'change',
    since,
    title: w.t('home.awaitingChange', { n: w.number(r.number), committee: w.bilingual(r.committeeNameEn, r.committeeNameAr) }),
    meta: w.t('home.awaitingChangeMeta', { name: r.requestedBy.name }),
    waiting: waitingText(since, w, now),
    link: ['/committees', r.committeeId, 'change-requests', r.id],
  };
}

/**
 * "3 days waiting"; under a day, "waiting since today". Both forms, as Home:
 * English reads the duration, Arabic the relative form, which takes the
 * genitive after its preposition (ACC-94).
 */
export function waitingText(since: string, w: AwaitingWords, now: Date): string {
  const ms = now.getTime() - new Date(since).getTime();
  return ms < DAY_MS
    ? w.t('home.waitingToday')
    : w.t('home.waitingFor', { duration: w.duration(Math.floor(ms / DAY_MS) * DAY_MS), relative: w.relative(since, now) });
}

/** Home's order: oldest first by `since`, then by id. */
export function compareAwaiting(a: Pick<AwaitingRow, 'since' | 'id'>, b: Pick<AwaitingRow, 'since' | 'id'>): number {
  return a.since.localeCompare(b.since) || a.id.localeCompare(b.id);
}

/**
 * ACC-120 — one list, oldest first, from stage rows that arrive a page at a
 * time and change requests that arrive all at once.
 *
 * Every loaded stage row shows. A change request shows once it falls no later
 * than the last loaded stage row in the list's own order (`since`, then id):
 * anything later might still have a stage row before it on a page not yet
 * loaded. Once no stage rows remain, every change request shows. So Load more
 * only ever appends below what is shown: no row moves, repeats or is skipped.
 */
export function mergeAwaiting(stages: readonly AwaitingRow[], changes: readonly AwaitingRow[], stagesExhausted: boolean): AwaitingRow[] {
  const sortedStages = [...stages].sort(compareAwaiting);
  const last = sortedStages[sortedStages.length - 1];
  const shownChanges = stagesExhausted ? [...changes] : last ? changes.filter((c) => compareAwaiting(c, last) <= 0) : [];
  return [...sortedStages, ...shownChanges].sort(compareAwaiting);
}
