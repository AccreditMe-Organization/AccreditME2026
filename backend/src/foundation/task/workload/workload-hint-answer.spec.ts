import { estimateTokens } from '../../ai/token-estimate';
import { AI_FEATURES } from '../../ai/ai.config';
import { emptyWorkload } from './task-workload';
import { MAX_OTHERS, hintPrompt, hintSystemPrompt, labelCandidates, parseHintAnswer } from './workload-hint-answer';

// ACC-199 — what the model receives for "Suggest someone", and how its answer
// is read. Plan §6.

const w = (open: number, overdue = 0, dueSoon = 0, urgent = 0, onHold = 0) => ({ ...emptyWorkload(), open, overdue, dueSoon, urgent, onHold });

describe('the hint prompt (ACC-199)', () => {
  it('states the record type, the priority and each label\'s counts, and nothing else about anyone', () => {
    const prompt = hintPrompt({
      recordType: 'COMMITTEE',
      priority: 'HIGH',
      chosen: { label: 'P3', workload: w(12, 3, 2, 4) },
      others: [{ label: 'P1', workload: w(4, 0, 1) }, { label: 'P2', workload: w(7, 1) }],
    });
    expect(prompt).toBe(
      [
        'The task: priority HIGH. Counts are for open tasks on this committee only.',
        'Currently chosen: P3 — open 12, overdue 3, due within 2 working days 2, high or critical 4, on hold 0.',
        'Others who could take it:',
        'P1 — open 4, overdue 0, due within 2 working days 1, high or critical 0, on hold 0.',
        'P2 — open 7, overdue 1, due within 2 working days 0, high or critical 0, on hold 0.',
        '',
        'Reply with the JSON object only, and nothing else.',
      ].join('\n'),
    );
  });

  it('names a meeting as a meeting, and a missing priority as not set', () => {
    const prompt = hintPrompt({ recordType: 'MEETING', priority: null, chosen: { label: 'P1', workload: w(5) }, others: [] });
    expect(prompt).toContain('priority not set');
    expect(prompt).toContain('on this meeting only');
  });

  it('asks for one label from the others, or none, as JSON only', () => {
    const system = hintSystemPrompt();
    expect(system).toContain('{"pick":"P1"}');
    expect(system).toContain('{"pick":null}');
    expect(system).toContain('You never see names');
  });

  it('the largest prompt we can send fits the feature\'s input cap', () => {
    const big = w(999, 999, 999, 999, 999);
    const prompt = hintPrompt({
      recordType: 'COMMITTEE',
      priority: 'CRITICAL',
      chosen: { label: 'P16', workload: big },
      others: Array.from({ length: MAX_OTHERS }, (_, i) => ({ label: `P${i + 1}`, workload: big })),
    });
    const cap = AI_FEATURES.workload_balancing.inputTokenCap!;
    expect(estimateTokens(hintSystemPrompt()) + estimateTokens(prompt)).toBeGreaterThan(300);
    expect(estimateTokens(hintSystemPrompt()) + estimateTokens(prompt)).toBeLessThanOrEqual(cap);
  });
});

describe('parseHintAnswer (ACC-199)', () => {
  const others = new Set(['P1', 'P2']);

  it.each([
    ['{"pick":"P2"}', { kind: 'pick', label: 'P2' }],
    ['```json\n{"pick": " P1 "}\n```', { kind: 'pick', label: 'P1' }],
    ['{"pick":null}', { kind: 'none' }],
    ['{"pick":"P3"}', { kind: 'unusable' }], // the chosen person's own label — not among the others
    ['{"pick":"P9"}', { kind: 'unusable' }], // a label we never sent
    ['{"pick":2}', { kind: 'unusable' }],
    ['{"choice":"P1"}', { kind: 'unusable' }],
    ['', { kind: 'unusable' }],
    ['Sara looks free.', { kind: 'unusable' }],
  ])('%s → %j', (answer, expected) => {
    expect(parseHintAnswer(answer, others)).toEqual(expected);
  });
});

describe('labelCandidates (ACC-199)', () => {
  it('labels everyone P1…Pn in a shuffled order, so a label says nothing about the list', () => {
    const chosen = { id: 'nora' };
    const others = [{ id: 'sara' }, { id: 'khalid' }];
    // A random() that always answers 0 reverses nothing predictable away: pin it.
    const labelled = labelCandidates(chosen, others, () => 0);
    const all = [labelled.chosen, ...labelled.others];
    expect(all.map((c) => c.label).sort()).toEqual(['P1', 'P2', 'P3']);
    expect(labelled.chosen.item).toBe(chosen);
    expect(labelled.others.map((o) => o.item)).not.toContain(chosen);
    // With this random() the chosen person is not P1, though they came first.
    expect(labelled.chosen.label).not.toBe('P1');
  });
});
