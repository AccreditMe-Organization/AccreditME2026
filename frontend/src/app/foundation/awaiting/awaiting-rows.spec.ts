import type { WorkflowAwaitingRowDto } from '../workflow/services/workflow.service';
import type { ChangeRequestDto } from '../committees/change-requests/change-request.service';
import { AwaitingRow, AwaitingWords, changeRow, compareAwaiting, mergeAwaiting, stageRow, waitingText } from './awaiting-rows';

// ACC-120 — the rows of "Awaiting my action" and the one order they share, as
// pure functions, so the page and (later) Home's panel build them the same way.

const words: AwaitingWords = {
  t: (key, params) => (params ? `${key}${JSON.stringify(params)}` : key),
  bilingual: (en) => en,
  number: (n) => String(n),
  duration: (ms) => `${ms / 86_400_000}d`,
  relative: () => 'rel',
};
const NOW = new Date('2026-11-09T09:00:00.000Z');

const stageDto = (id: string, since: string): WorkflowAwaitingRowDto => ({
  instanceStageId: id,
  record: { type: 'COMMITTEE', id: `c-${id}`, nameEn: `Committee ${id}`, nameAr: null },
  stage: { id: 's', nameEn: 'Review', nameAr: null, position: 2, stageCount: 4 },
  since,
});
const changeDto = (id: string, submittedAt: string | null, createdAt = '2026-01-01T00:00:00.000Z') =>
  ({
    id,
    committeeId: 'c-1',
    committeeNameEn: 'Infection Control',
    committeeNameAr: null,
    number: 7,
    requestedBy: { id: 'u', name: 'Sara Ali' },
    submittedAt,
    createdAt,
  }) as unknown as ChangeRequestDto;

const row = (id: string, since: string, kind: 'stage' | 'change' = 'stage'): AwaitingRow => ({
  id,
  kind,
  since,
  title: id,
  meta: '',
  waiting: '',
  link: null,
});
const ids = (rows: AwaitingRow[]) => rows.map((r) => r.id);

describe('awaiting rows (ACC-120)', () => {
  it('a stage row: the record linked, "type · stage n/N", and how long it waited', () => {
    const r = stageRow(stageDto('is-1', '2026-11-06T09:00:00.000Z'), words, NOW);
    expect(r).toEqual(
      jasmine.objectContaining({
        id: 'is-1',
        kind: 'stage',
        title: 'Committee is-1',
        link: ['/committees', 'c-is-1'],
      }),
    );
    expect(r.meta).toBe('home.awaitingStageMeta{"type":"workflow.objectTypeName.COMMITTEE","stage":"Review","position":"2","count":"4"}');
    expect(r.waiting).toBe('home.waitingFor{"duration":"3d","relative":"rel"}');
  });

  it('a record type with no page yet is named without a link', () => {
    const r = stageRow({ ...stageDto('is-2', '2026-11-08T09:00:00.000Z'), record: { type: 'DOCUMENT', id: 'd-1', nameEn: 'Policy', nameAr: null } }, words, NOW);
    expect(r.link).toBeNull();
  });

  it('a change request: "Change request n · committee", "From name", since Submit (else creation), linked to its page', () => {
    const r = changeRow(changeDto('cr-1', '2026-11-09T08:00:00.000Z'), words, NOW);
    expect(r.title).toBe('home.awaitingChange{"n":"7","committee":"Infection Control"}');
    expect(r.meta).toBe('home.awaitingChangeMeta{"name":"Sara Ali"}');
    expect(r.since).toBe('2026-11-09T08:00:00.000Z');
    expect(r.waiting).toBe('home.waitingToday');
    expect(r.link).toEqual(['/committees', 'c-1', 'change-requests', 'cr-1']);
    expect(changeRow(changeDto('cr-2', null, '2026-10-01T00:00:00.000Z'), words, NOW).since).toBe('2026-10-01T00:00:00.000Z');
  });

  it('under a day reads "waiting since today"', () => {
    expect(waitingText('2026-11-09T00:00:00.000Z', words, NOW)).toBe('home.waitingToday');
  });

  it('orders by since, then by id on an equal since', () => {
    const a = row('b', '2026-11-01T00:00:00.000Z');
    const b = row('a', '2026-11-01T00:00:00.000Z');
    const c = row('z', '2026-10-01T00:00:00.000Z');
    expect(ids([a, b, c].sort(compareAwaiting))).toEqual(['z', 'a', 'b']);
  });

  describe('the merge (stage rows a page at a time, change requests all at once)', () => {
    const stages = [row('s1', '2026-10-01T00:00:00.000Z'), row('s2', '2026-10-05T00:00:00.000Z'), row('s3', '2026-10-09T00:00:00.000Z')];

    it('a change request older than the last loaded stage row shows, in its place', () => {
      const older = row('c-old', '2026-10-03T00:00:00.000Z', 'change');
      expect(ids(mergeAwaiting(stages, [older], false))).toEqual(['s1', 'c-old', 's2', 's3']);
    });

    it('a change request newer than the last loaded stage row waits for the stages to run out', () => {
      const newer = row('c-new', '2026-10-20T00:00:00.000Z', 'change');
      expect(ids(mergeAwaiting(stages, [newer], false))).toEqual(['s1', 's2', 's3']);
      expect(ids(mergeAwaiting(stages, [newer], true))).toEqual(['s1', 's2', 's3', 'c-new']);
    });

    it('once no stage rows remain, every change request shows', () => {
      const all = [row('c-a', '2026-12-01T00:00:00.000Z', 'change'), row('c-b', '2026-09-01T00:00:00.000Z', 'change')];
      expect(ids(mergeAwaiting(stages, all, true))).toEqual(['c-b', 's1', 's2', 's3', 'c-a']);
      expect(ids(mergeAwaiting([], all, true))).toEqual(['c-b', 'c-a']);
    });

    // On the same `since` the list's own tie-break (id) decides: a change request
    // after the last stage row in that order waits, because the next page may
    // hold a stage row with that `since` and an id between them.
    it('an equal since is resolved by id, as the list is ordered', () => {
      const since = '2026-10-09T00:00:00.000Z'; // s3's
      const before = row('c-0', since, 'change'); // 'c-0' < 's3'
      const after = row('t-9', since, 'change'); // 't-9' > 's3'
      expect(ids(mergeAwaiting(stages, [before, after], false))).toEqual(['s1', 's2', 'c-0', 's3']);
    });

    it('nothing loaded yet: no change request shows until stages are known', () => {
      expect(mergeAwaiting([], [row('c-1', '2026-10-01T00:00:00.000Z', 'change')], false)).toEqual([]);
    });
  });
});
