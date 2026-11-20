import { whoIsAlreadyTheSeeds } from '../../../prisma/backfill-acc316-meeting-workflow';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';

// ACC-316 — "who works this stage is already the seed's" must not depend on the
// order rows come back in. Postgres guarantees none without ORDER BY: on CI
// (18 Nov) Minutes Review's two entries came back second-first, and a second
// dry run called them configured. The check sorts by `order` itself.

const meeting = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'MEETING')!;
const entriesOf = (key: string): { kind: string }[] => {
  const who = meeting.stages.find((s) => s.key === key)!.who;
  if (!('entries' in who)) throw new Error(`the seed's ${key} has no entries`);
  return [...who.entries];
};
// Stored as the backfill writes them: order 1, 2, … in the seed's order.
const stored = (entries: { kind: string }[]) => entries.map((e, i) => ({ kind: e.kind, order: i + 1 }));

describe('backfill-acc316-meeting-workflow — whoIsAlreadyTheSeeds', () => {
  describe.each(['agenda_ready', 'minutes_review'])('%s', (key) => {
    const entries = entriesOf(key);

    it('has two entries of different kinds in the seed, so a reversal is visible', () => {
      // Non-vacuity: with one entry, or two of the same kind, reversing the
      // rows changes nothing and the next test would prove nothing.
      expect(entries).toHaveLength(2);
      expect(entries[0]!.kind).not.toBe(entries[1]!.kind);
    });

    it('answers "already the seed\'s" for the rows in either order', () => {
      const rows = stored(entries);
      expect(whoIsAlreadyTheSeeds(rows, entries)).toBe(true);
      expect(whoIsAlreadyTheSeeds([...rows].reverse(), entries)).toBe(true);
    });

    it('still answers "configured" when the stored order really differs from the seed', () => {
      const swapped = stored([...entries].reverse());
      expect(whoIsAlreadyTheSeeds(swapped, entries)).toBe(false);
      expect(whoIsAlreadyTheSeeds([...swapped].reverse(), entries)).toBe(false);
    });

    it('answers "configured" for a missing or an extra entry', () => {
      expect(whoIsAlreadyTheSeeds(stored(entries.slice(0, 1)), entries)).toBe(false);
      expect(whoIsAlreadyTheSeeds(stored([...entries, { kind: 'SPECIFIC_USER' }]), entries)).toBe(false);
    });
  });

  it('does not reorder the rows it was given', () => {
    const entries = entriesOf('minutes_review');
    const reversed = [...stored(entries)].reverse();
    const before = reversed.map((r) => r.order);
    whoIsAlreadyTheSeeds(reversed, entries);
    expect(reversed.map((r) => r.order)).toEqual(before);
  });
});
