import { aiFeatureTimeoutMs } from '../../ai/ai.config';
import { MEETING_AI_CLAIM_STALE_MS, MINUTES_FEATURE } from './meeting-ai.service';

// ACC-322 (P249) — a live Draft minutes run must never look stale: the claim
// outlives the provider call's own timeout, with room for the reads and the save.
describe('the Draft minutes claim (ACC-322)', () => {
  it('is stale only after the call could no longer be running', () => {
    expect(MEETING_AI_CLAIM_STALE_MS).toBeGreaterThan(aiFeatureTimeoutMs(MINUTES_FEATURE));
    expect(MEETING_AI_CLAIM_STALE_MS).toBe(aiFeatureTimeoutMs(MINUTES_FEATURE) + 60_000);
  });
});
