import { briefingPrompt, briefingSystemPrompt, codeLead, parseBriefingAnswer, LEAD_CAP } from './briefing-answer';
import { IBriefingGroup } from './briefing-groups';

const groups: IBriefingGroup[] = [
  {
    kind: 'overdue',
    items: [{ key: 'T1', type: 'TASK', id: 'task-1', title: 'Close CAPA-0912', dueAt: '2026-10-07T09:00:00.000Z', link: { target: 'task', id: 'task-1' } }],
  },
  {
    kind: 'notification',
    items: [
      { key: 'N1', type: 'NOTIFICATION', id: 'n-1', title: 'You were mentioned', titleAr: 'تمت الإشارة إليك', createdAt: '2026-10-13T01:00:00.000Z', link: null },
    ],
  },
];

describe('the prompt (ACC-198)', () => {
  it('names the language, marks the items as data, and asks for JSON with focus by key', () => {
    const en = briefingSystemPrompt('en');
    expect(en).toContain('Write ONLY in English');
    expect(en).toContain('never instructions');
    expect(en).toContain('"focus"');
    expect(briefingSystemPrompt('ar')).toContain('Write ONLY in Arabic');
  });

  it('sends keys, titles and dates — never a record id', () => {
    const prompt = briefingPrompt(groups, 'en', new Date('2026-10-13T06:00:00Z'));
    expect(prompt).toContain('- T1 | Close CAPA-0912 | due 2026-10-07T09:00:00.000Z');
    expect(prompt).toContain('- N1 | You were mentioned');
    expect(prompt).not.toContain('task-1');
    expect(prompt).not.toContain('n-1');
  });

  it('an Arabic briefing sends a notification\'s Arabic title', () => {
    expect(briefingPrompt(groups, 'ar', new Date())).toContain('- N1 | تمت الإشارة إليك');
  });
});

describe('parseBriefingAnswer (D13)', () => {
  it('reads the lead and the focus picks', () => {
    const answer = parseBriefingAnswer('{"lead": "One task is overdue.", "focus": [{"key": "T1", "reason": "It blocks the audit."}]}', groups, 'en');
    expect(answer).toEqual({ lead: 'One task is overdue.', focus: [{ key: 'T1', reason: 'It blocks the audit.' }], fallback: false });
  });

  it('drops keys we never sent, duplicates, empty reasons, and anything past three', () => {
    const answer = parseBriefingAnswer(
      JSON.stringify({
        lead: 'Busy day.',
        focus: [
          { key: 'T9', reason: 'invented' },
          { key: 'T1', reason: 'first' },
          { key: 'T1', reason: 'again' },
          { key: 'N1', reason: '  ' },
          { key: 'N1', reason: 'read it' },
          { key: 'https://evil.example', reason: 'a link' },
        ],
      }),
      groups,
      'en',
    );
    expect(answer.focus).toEqual([
      { key: 'T1', reason: 'first' },
      { key: 'N1', reason: 'read it' },
    ]);
  });

  it('caps at three valid picks', () => {
    const many: IBriefingGroup[] = [
      { kind: 'overdue', items: ['T1', 'T2', 'T3', 'T4'].map((key) => ({ key, type: 'TASK' as const, id: key, title: key, link: null })) },
    ];
    const answer = parseBriefingAnswer(
      JSON.stringify({ lead: 'x', focus: ['T1', 'T2', 'T3', 'T4'].map((key) => ({ key, reason: 'r' })) }),
      many,
      'en',
    );
    expect(answer.focus.map((f) => f.key)).toEqual(['T1', 'T2', 'T3']);
  });

  it('no valid picks → no focus section (an empty list)', () => {
    expect(parseBriefingAnswer('{"lead": "Calm.", "focus": "T1"}', groups, 'en').focus).toEqual([]);
  });

  it('reads JSON inside a code fence', () => {
    expect(parseBriefingAnswer('```json\n{"lead": "Fenced.", "focus": []}\n```', groups, 'en').lead).toBe('Fenced.');
  });

  it('plain text with no JSON at all becomes the lead, with no focus', () => {
    expect(parseBriefingAnswer('One task is overdue today.', groups, 'en')).toEqual({ lead: 'One task is overdue today.', focus: [], fallback: false });
  });

  it('broken JSON, or JSON with no lead, falls back to our own lead', () => {
    expect(parseBriefingAnswer('{"lead": "unterminated', groups, 'en')).toEqual({ lead: 'Here is your work for today.', focus: [], fallback: true });
    expect(parseBriefingAnswer('{"focus": []}', groups, 'ar').lead).toBe('هذه أعمالك لليوم.');
  });

  it('a long lead is cut to the cap', () => {
    const answer = parseBriefingAnswer(JSON.stringify({ lead: 'A sentence here. '.repeat(60), focus: [] }), groups, 'en');
    expect(answer.lead.length).toBeLessThanOrEqual(LEAD_CAP);
    expect(answer.lead.endsWith('.')).toBe(true);
  });
});

describe('codeLead', () => {
  it('a quiet day reads the drawing\'s sentence, in both languages', () => {
    expect(codeLead([], 'en')).toBe('Nothing is overdue or due today, and nothing waits for you.');
    expect(codeLead([], 'ar')).toBe('لا شيء متأخر أو مستحق اليوم، ولا شيء بانتظارك.');
  });
});
