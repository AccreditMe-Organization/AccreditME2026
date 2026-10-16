import { aiCreditsState, aiFeatureNameKey, aiUsageView } from './ai-credits-view';

describe('aiCreditsState (ACC-120 slice 8)', () => {
  it('is none with no allowance, whatever else is set — never "0 of 0"', () => {
    expect(aiCreditsState({ monthlyCredits: 0, creditsRemaining: 0 })).toBe('none');
  });

  it('is spent with an allowance and nothing left', () => {
    expect(aiCreditsState({ monthlyCredits: 40, creditsRemaining: 0 })).toBe('spent');
  });

  it('is normal with an allowance and credits left', () => {
    expect(aiCreditsState({ monthlyCredits: 40, creditsRemaining: 22 })).toBe('normal');
  });
});

describe('aiUsageView (ACC-120 slice 8)', () => {
  const usage = [
    { key: 'document_summary', credits: 9, calls: 3 },
    { key: 'task_description_drafting', credits: 6, calls: 3 },
    { key: 'workload_balancing', credits: 3, calls: 3 },
  ];

  it('draws each feature as its share of the ALLOWANCE, and its percent of the breakdown', () => {
    const view = aiUsageView({ monthlyCredits: 40, creditsUsed: 18 }, usage);
    expect(view.hasOther).toBe(false);
    expect(view.rows.map((r) => [r.key, r.credits, r.percent, r.segmentPercent])).toEqual([
      ['document_summary', 9, 50, 22.5],
      ['task_description_drafting', 6, 33, 15],
      ['workload_balancing', 3, 17, 7.5],
    ]);
  });

  it('caps the segments so they never add up past creditsUsed, in order', () => {
    // The log says 18, the counter says 10 (a counter reset by hand).
    const view = aiUsageView({ monthlyCredits: 40, creditsUsed: 10 }, usage);
    const drawn = view.rows.reduce((sum, r) => sum + (r.segmentPercent / 100) * 40, 0);
    expect(drawn).toBe(10);
    expect(view.rows.map((r) => r.segmentPercent)).toEqual([22.5, 2.5, 0]);
    // The breakdown still says what the log says, and no "Other" is invented.
    expect(view.rows.map((r) => r.credits)).toEqual([9, 6, 3]);
    expect(view.hasOther).toBe(false);
  });

  it('draws nothing at all when the counter is 0, however much the log holds', () => {
    const view = aiUsageView({ monthlyCredits: 2000, creditsUsed: 0 }, usage);
    expect(view.rows.every((r) => r.segmentPercent === 0)).toBe(true);
  });

  it('adds one plain "Other" segment and row when the log adds up to less than creditsUsed', () => {
    const view = aiUsageView({ monthlyCredits: 40, creditsUsed: 24 }, usage);
    expect(view.hasOther).toBe(true);
    const other = view.rows[view.rows.length - 1];
    expect(other).toEqual({ key: null, credits: 6, percent: 25, segmentPercent: 15, mark: null });
    // Percentages are of the breakdown's own total, Other included: 9/24.
    expect(view.rows[0].percent).toBe(38);
  });

  it('is all "Other" when the log has nothing for a period that used credits', () => {
    const view = aiUsageView({ monthlyCredits: 40, creditsUsed: 40 }, []);
    expect(view.rows).toEqual([{ key: null, credits: 40, percent: 100, segmentPercent: 100, mark: null }]);
  });

  it('is empty when nothing was used and nothing logged', () => {
    expect(aiUsageView({ monthlyCredits: 40, creditsUsed: 0 }, [])).toEqual({ rows: [], hasOther: false });
  });

  it('marks every feature row with a glyph as well as an ink, so no row is told apart by colour alone', () => {
    const view = aiUsageView({ monthlyCredits: 40, creditsUsed: 18 }, usage);
    const glyphs = view.rows.map((r) => r.mark?.glyph);
    expect(new Set(glyphs).size).toBe(3);
    expect(view.rows.every((r) => r.mark?.ink.startsWith('var(--am-'))).toBe(true);
  });
});

describe('aiFeatureNameKey (ACC-120 slice 8)', () => {
  it('names a known feature, "Other" for null, and never shows a raw key', () => {
    expect(aiFeatureNameKey('document_summary')).toBe('aiCredits.feature.document_summary');
    expect(aiFeatureNameKey(null)).toBe('aiCredits.other');
    expect(aiFeatureNameKey('something_new')).toBe('aiCredits.feature.unknown');
  });
});
