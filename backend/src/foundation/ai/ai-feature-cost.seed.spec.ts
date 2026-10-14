import { AI_FEATURE_COST_SEED, planAiFeatureCostSeed } from './ai-feature-cost.seed';
import { AI_FEATURE_KEYS } from './ai.config';

describe('planAiFeatureCostSeed (ACC-194, D4/D12/D17)', () => {
  const slugs = new Map([['al-nakheel', 'org-nakheel']]);

  it('seeds exactly the agreed costs, every one a feature the gateway can call', () => {
    expect(AI_FEATURE_COST_SEED.map((r) => [r.featureKey, r.creditCost])).toEqual([
      ['task_description_drafting', 2],
      ['document_summary', 15],
      ['morning_briefing', 5],
      // ACC-199 (Q10) — open to every organisation with AI.
      ['workload_balancing', 1],
    ]);
    for (const r of AI_FEATURE_COST_SEED) expect(AI_FEATURE_KEYS).toContain(r.featureKey);
  });

  it('creates what is missing; morning_briefing restricted to al-nakheel only', () => {
    expect(planAiFeatureCostSeed(new Set(), slugs)).toEqual([
      expect.objectContaining({ kind: 'create', featureKey: 'task_description_drafting', creditCost: 2, restricted: false, allowedOrganizationIds: [] }),
      expect.objectContaining({ kind: 'create', featureKey: 'document_summary', creditCost: 15, restricted: false, allowedOrganizationIds: [] }),
      expect.objectContaining({ kind: 'create', featureKey: 'morning_briefing', creditCost: 5, restricted: true, allowedOrganizationIds: ['org-nakheel'] }),
      expect.objectContaining({ kind: 'create', featureKey: 'workload_balancing', creditCost: 1, restricted: false, allowedOrganizationIds: [] }),
    ]);
  });

  it('never overwrites an existing row, edited or not', () => {
    const actions = planAiFeatureCostSeed(new Set(['document_summary', 'morning_briefing']), slugs);
    expect(actions.map((a) => [a.featureKey, a.kind])).toEqual([
      ['task_description_drafting', 'create'],
      ['document_summary', 'keep'],
      ['morning_briefing', 'keep'],
      ['workload_balancing', 'create'],
    ]);
  });

  it('a missing organisation leaves the feature restricted and open to NOBODY, never to everyone', () => {
    const briefing = planAiFeatureCostSeed(new Set(), new Map()).find((a) => a.featureKey === 'morning_briefing');
    expect(briefing).toEqual(expect.objectContaining({ kind: 'create', restricted: true, allowedOrganizationIds: [] }));
    expect(briefing).toHaveProperty('warning');
  });
});
