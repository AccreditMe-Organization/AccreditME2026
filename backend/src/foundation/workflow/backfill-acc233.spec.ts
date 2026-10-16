import { committeeSeedStages, matchStageKeys, StoredStage } from '../../../prisma/backfill-acc233-committee-stage-keys';
import { COMMITTEE_STAGE_KEYS } from './workflow-stage-keys';

// ACC-233 — the backfill keys an organisation's committee stages by POSITION,
// confirmed by the first/final flags, and never guesses.

const seed = committeeSeedStages();
const stored = (overrides: Partial<Record<number, Partial<StoredStage>>> = {}): StoredStage[] =>
  seed.map((s, i) => ({
    id: `stage-${s.order}`,
    nameEn: `Stage ${i + 1}`,
    order: s.order,
    isInitial: s.isInitial,
    isFinal: s.isFinal,
    key: null,
    ...(overrides[s.order] ?? {}),
  }));

describe('backfill-acc233 — committee stage keys', () => {
  it('the seed keys every stage of the committee lifecycle, in order', () => {
    expect(seed.map((s) => s.key)).toEqual([...COMMITTEE_STAGE_KEYS]);
  });

  it('keys every stage by position, whatever the tenant has called it', () => {
    const match = matchStageKeys(stored({ 50: { nameEn: 'Winding up' } }), seed);
    expect(match.toSet.map((s) => [s.order, s.key])).toEqual(seed.map((s) => [s.order, s.key]));
    expect(match.unmatched).toEqual([]);
    expect(match.seedKeysMissing).toEqual([]);
  });

  it('a stage the tenant added, at a position the seed does not use, is left null and reported', () => {
    const match = matchStageKeys([...stored(), { id: 'extra', nameEn: 'Extra review', order: 35, isInitial: false, isFinal: false, key: null }], seed);
    expect(match.toSet).toHaveLength(6);
    expect(match.unmatched).toEqual([expect.objectContaining({ stageId: 'extra', reason: 'no seed stage at this position' })]);
  });

  it('two stages at one position are both left null — never a guess between them', () => {
    const rows = [...stored(), { id: 'twin', nameEn: 'Twin', order: 50, isInitial: false, isFinal: false, key: null }];
    const match = matchStageKeys(rows, seed);
    expect(match.unmatched.map((u) => u.stageId).sort()).toEqual(['stage-50', 'twin']);
    expect(match.toSet.find((s) => s.order === 50)).toBeUndefined();
    expect(match.seedKeysMissing).toEqual(['dissolution_pending']);
  });

  it('a stage whose first/final flags disagree with the seed is left null', () => {
    const match = matchStageKeys(stored({ 60: { isFinal: false } }), seed);
    expect(match.unmatched).toEqual([expect.objectContaining({ stageId: 'stage-60' })]);
    expect(match.seedKeysMissing).toEqual(['dissolved']);
  });

  it('a re-run changes nothing: a stage already holding its key is counted, not set again', () => {
    const keyed = stored(Object.fromEntries(seed.map((s) => [s.order, { key: s.key }])));
    const match = matchStageKeys(keyed, seed);
    expect(match.toSet).toEqual([]);
    expect(match.alreadyKeyed).toBe(6);
  });

  it('a stage already holding a DIFFERENT key is reported, not overwritten', () => {
    const match = matchStageKeys(stored({ 30: { key: 'something_else' } }), seed);
    expect(match.unmatched).toEqual([expect.objectContaining({ stageId: 'stage-30' })]);
    expect(match.toSet.find((s) => s.stageId === 'stage-30')).toBeUndefined();
  });
});
