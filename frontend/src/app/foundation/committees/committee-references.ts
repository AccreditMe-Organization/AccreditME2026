import { refusalCode } from '../../core/http/refusal';

/**
 * ACC-233 — what a committee may point at, as the committee dialog sees it.
 *
 * The SERVER decides (committee-reference-checks.ts). This file only:
 *   1. says a refusal in the reader's words, from its CODE — never the English
 *      `message` — under the field it is about; and
 *   2. leaves out of the pickers what the server would refuse, so a refusal is
 *      rare rather than routine: the committee itself, a dissolving or
 *      dissolved committee, and anything that would close a loop.
 */

export type CommitteeReferenceField = 'parentCommitteeId' | 'reportingToCommitteeId' | 'orgUnitId';

export interface CommitteeRefusal {
  /** The field the sentence belongs under; null for a refusal about no one field. */
  field: CommitteeReferenceField | null;
  /** A translation key, translated at render so a language switch reaches it. */
  key: string;
}

const REFUSALS: Readonly<Record<string, CommitteeRefusal>> = {
  COMMITTEE_OWN_PARENT: { field: 'parentCommitteeId', key: 'committee.refusal.ownParent' },
  COMMITTEE_PARENT_LOOP: { field: 'parentCommitteeId', key: 'committee.refusal.parentLoop' },
  COMMITTEE_PARENT_DISSOLVING: { field: 'parentCommitteeId', key: 'committee.refusal.parentDissolving' },
  COMMITTEE_PARENT_NOT_FOUND: { field: 'parentCommitteeId', key: 'committee.refusal.parentNotFound' },
  COMMITTEE_REPORTS_TO_ITSELF: { field: 'reportingToCommitteeId', key: 'committee.refusal.reportsToItself' },
  COMMITTEE_REPORTS_TO_LOOP: { field: 'reportingToCommitteeId', key: 'committee.refusal.reportsToLoop' },
  COMMITTEE_REPORTS_TO_DISSOLVING: { field: 'reportingToCommitteeId', key: 'committee.refusal.reportsToDissolving' },
  COMMITTEE_REPORTS_TO_NOT_FOUND: { field: 'reportingToCommitteeId', key: 'committee.refusal.reportsToNotFound' },
  COMMITTEE_UNIT_REQUIRED: { field: 'orgUnitId', key: 'committee.refusal.unitRequired' },
  COMMITTEE_UNIT_NOT_FOUND: { field: 'orgUnitId', key: 'committee.refusal.unitNotFound' },
};

/** The sentence for a refused save: the code's own, else one translated fallback. */
export function committeeRefusal(err: unknown): CommitteeRefusal {
  const code = refusalCode(err);
  return (code && REFUSALS[code]) || { field: null, key: 'committee.refusal.saveFailed' };
}

/** The fields a committee list row needs for the pickers. */
export interface CommitteeReferenceRow {
  id: string;
  parentCommitteeId: string | null;
  reportingToCommitteeId: string | null;
  isDissolving: boolean;
}

export type CommitteeChain = 'parent' | 'reportsTo';

/**
 * The committees a picker offers. Left out:
 *   - the committee itself;
 *   - any committee being dissolved, or dissolved;
 *   - (editing) any committee whose chain leads back to this one — a
 *     sub-committee for the parent picker, a committee that reports to it for
 *     the reports-to picker.
 * The value already saved is always kept, so the field still shows what is
 * saved and an unrelated edit is not blocked by it.
 */
export function referenceOptions<T extends CommitteeReferenceRow>(
  all: readonly T[],
  editingId: string | null,
  chain: CommitteeChain,
  savedValue: string | null,
): T[] {
  const link = (c: CommitteeReferenceRow) => (chain === 'parent' ? c.parentCommitteeId : c.reportingToCommitteeId);
  const byId = new Map(all.map((c) => [c.id, c]));
  const leadsBack = (start: T): boolean => {
    if (!editingId) return false;
    const seen = new Set<string>();
    for (let cur: CommitteeReferenceRow | undefined = start; cur; cur = byId.get(link(cur) ?? '')) {
      if (cur.id === editingId) return true;
      if (seen.has(cur.id)) return false; // a loop already in the data ends the walk
      seen.add(cur.id);
    }
    return false;
  };
  return all.filter(
    (c) => c.id === savedValue || (c.id !== editingId && !c.isDissolving && !leadsBack(c)),
  );
}
