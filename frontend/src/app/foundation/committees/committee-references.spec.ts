import { HttpErrorResponse } from '@angular/common/http';
import { committeeRefusal, CommitteeReferenceRow, referenceOptions } from './committee-references';

// ACC-233 — the dialog's side of the committee reference checks: the refusal
// said from its code, and the pickers leaving out what the server refuses.

const row = (id: string, links: Partial<CommitteeReferenceRow> = {}): CommitteeReferenceRow => ({
  id,
  parentCommitteeId: null,
  reportingToCommitteeId: null,
  isDissolving: false,
  ...links,
});
const ids = (rows: CommitteeReferenceRow[]) => rows.map((r) => r.id).sort();

describe('committeeRefusal (ACC-233)', () => {
  const refused = (code: string | undefined, status = 400) =>
    new HttpErrorResponse({ status, error: { statusCode: status, message: 'English from the server', ...(code ? { code } : {}) } });

  const CASES: [string, string, string][] = [
    ['COMMITTEE_OWN_PARENT', 'parentCommitteeId', 'committee.refusal.ownParent'],
    ['COMMITTEE_PARENT_LOOP', 'parentCommitteeId', 'committee.refusal.parentLoop'],
    ['COMMITTEE_PARENT_DISSOLVING', 'parentCommitteeId', 'committee.refusal.parentDissolving'],
    ['COMMITTEE_PARENT_NOT_FOUND', 'parentCommitteeId', 'committee.refusal.parentNotFound'],
    ['COMMITTEE_REPORTS_TO_ITSELF', 'reportingToCommitteeId', 'committee.refusal.reportsToItself'],
    ['COMMITTEE_REPORTS_TO_LOOP', 'reportingToCommitteeId', 'committee.refusal.reportsToLoop'],
    ['COMMITTEE_REPORTS_TO_DISSOLVING', 'reportingToCommitteeId', 'committee.refusal.reportsToDissolving'],
    ['COMMITTEE_REPORTS_TO_NOT_FOUND', 'reportingToCommitteeId', 'committee.refusal.reportsToNotFound'],
    ['COMMITTEE_UNIT_REQUIRED', 'orgUnitId', 'committee.refusal.unitRequired'],
    ['COMMITTEE_UNIT_NOT_FOUND', 'orgUnitId', 'committee.refusal.unitNotFound'],
  ];
  for (const [code, field, key] of CASES) {
    it(`${code} → its own sentence, under ${field}`, () => {
      expect(committeeRefusal(refused(code))).toEqual({ field: field as never, key });
    });
  }

  it('anything else → one translated fallback for the dialog, never the server text', () => {
    expect(committeeRefusal(refused(undefined, 500))).toEqual({ field: null, key: 'committee.refusal.saveFailed' });
    expect(committeeRefusal(refused('SOMETHING_NEW'))).toEqual({ field: null, key: 'committee.refusal.saveFailed' });
    expect(committeeRefusal(new Error('network'))).toEqual({ field: null, key: 'committee.refusal.saveFailed' });
  });
});

describe('referenceOptions (ACC-233)', () => {
  it('leaves out the committee itself and every dissolving or dissolved committee', () => {
    const all = [row('self'), row('ok'), row('closing', { isDissolving: true })];
    expect(ids(referenceOptions(all, 'self', 'parent', null))).toEqual(['ok']);
  });

  it('the parent picker leaves out the committee\'s descendants, at any depth', () => {
    const all = [row('self'), row('child', { parentCommitteeId: 'self' }), row('grandchild', { parentCommitteeId: 'child' }), row('other')];
    expect(ids(referenceOptions(all, 'self', 'parent', null))).toEqual(['other']);
  });

  it('each picker follows its own chain', () => {
    // "child" sits under self but does not report to it: it may still be reported to.
    const all = [row('self'), row('child', { parentCommitteeId: 'self' }), row('reporter', { reportingToCommitteeId: 'self' })];
    expect(ids(referenceOptions(all, 'self', 'parent', null))).toEqual(['reporter']);
    expect(ids(referenceOptions(all, 'self', 'reportsTo', null))).toEqual(['child']);
  });

  it('on create nothing leads back: only dissolving committees are left out', () => {
    const all = [row('a'), row('b', { parentCommitteeId: 'a' }), row('c', { isDissolving: true })];
    expect(ids(referenceOptions(all, null, 'parent', null))).toEqual(['a', 'b']);
  });

  it('keeps the value already saved, even if it has since begun dissolving', () => {
    const all = [row('self', { parentCommitteeId: 'closing' }), row('closing', { isDissolving: true })];
    expect(ids(referenceOptions(all, 'self', 'parent', 'closing'))).toEqual(['closing']);
  });

  it('a loop already in the data ends the walk', () => {
    const all = [row('self'), row('x', { parentCommitteeId: 'y' }), row('y', { parentCommitteeId: 'x' })];
    expect(ids(referenceOptions(all, 'self', 'parent', null))).toEqual(['x', 'y']);
  });
});
