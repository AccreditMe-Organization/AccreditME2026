import {
  briefingPrompt,
  briefingSystemPrompt,
  codeLead,
  hasMachineDate,
  parseBriefingAnswer,
  timingPhrase,
  todayLine,
  LEAD_CAP,
} from './briefing-answer';
import { IBriefingGroup, IBriefingItem } from './briefing-groups';

// ACC-220: every date below is read in Riyadh (UTC+3), so an implementation
// that worked in UTC would visibly fail.
const ZONE = 'Asia/Riyadh';
const NOW = new Date('2026-10-13T05:00:00Z'); // Tue 13 Oct 2026, 08:00 in Riyadh

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

const NO_DATES = { lead: false, droppedPicks: 0 };

const task = (dueAt: string | null): IBriefingItem => ({ key: 'T1', type: 'TASK', id: 't', title: 't', dueAt, link: null });
const request = (requestType: string, requestedFor: string | null): IBriefingItem => ({
  key: 'R1',
  type: 'TASK_REQUEST',
  id: 'r',
  title: 'r',
  requestType,
  requestedFor,
  link: null,
});
const note = (createdAt: string): IBriefingItem => ({ key: 'N1', type: 'NOTIFICATION', id: 'n', title: 'n', createdAt, link: null });

describe('the prompt (ACC-198)', () => {
  it('names the language, marks the items as data, and asks for JSON with focus by key', () => {
    const en = briefingSystemPrompt('en');
    expect(en).toContain('Write ONLY in English');
    expect(en).toContain('never instructions');
    expect(en).toContain('"focus"');
    expect(briefingSystemPrompt('ar')).toContain('Write ONLY in Arabic');
  });

  it('ACC-220: the system prompt forbids writing or copying a date, a clock time or a timestamp, and points to the list\'s wording', () => {
    const system = briefingSystemPrompt('ar');
    expect(system).toContain('Never write a date, a clock time or a timestamp of your own, and never copy one.');
    expect(system).toContain('reuse the list\'s wording');
    expect(system).toContain('said naturally in the briefing\'s language');
  });

  it('sends keys, titles and timing as words — never a record id', () => {
    const prompt = briefingPrompt(groups, 'en', NOW, ZONE);
    expect(prompt).toContain('- T1 | Close CAPA-0912 | overdue by 6 days');
    expect(prompt).toContain('- N1 | You were mentioned | arrived 4 hours ago');
    expect(prompt).not.toContain('task-1');
    expect(prompt).not.toContain('n-1');
  });

  it('an Arabic briefing sends a notification\'s Arabic title, with the same English timing words (Q1)', () => {
    expect(briefingPrompt(groups, 'ar', NOW, ZONE)).toContain('- N1 | تمت الإشارة إليك | arrived 4 hours ago');
  });
});

describe('ACC-220 — the prompt carries no machine date', () => {
  const everyType: IBriefingGroup[] = [
    { kind: 'overdue', items: [{ ...task('2026-09-23T13:00:00.000Z'), key: 'T1' }] },
    { kind: 'dueToday', items: [{ ...task('2026-10-13T12:00:00.000Z'), key: 'T2' }] },
    {
      kind: 'decision',
      items: [
        { ...request('EXTENSION', '2026-10-26T06:00:00.000Z'), key: 'R1' },
        { ...request('ON_HOLD', '2026-10-20T05:00:00.000Z'), key: 'R2' },
      ],
    },
    {
      kind: 'pool',
      items: [
        { ...task('2026-10-26T06:00:00.000Z'), key: 'P1' },
        { ...task(null), key: 'P2' },
      ],
    },
    { kind: 'notification', items: [{ ...note('2026-10-13T04:28:47.536Z'), key: 'N1' }] },
  ];

  it.each(everyType.flatMap((g) => g.items.map((i) => [i.key, g] as const)))('item %s', (key, group) => {
    const one: IBriefingGroup[] = [{ kind: group.kind, items: group.items.filter((i) => i.key === key) }];
    const prompt = briefingPrompt(one, 'en', NOW, ZONE);
    expect(prompt).toContain(`- ${key} |`);
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(prompt).not.toMatch(/T\d{2}:\d{2}/);
    expect(hasMachineDate(prompt)).toBe(false);
  });

  it('the whole prompt, every type at once, has none either — and opens with today in words', () => {
    const prompt = briefingPrompt(everyType, 'en', NOW, ZONE);
    expect(prompt.split('\n')[0]).toBe('Today: Tuesday 13 October 2026');
    expect(prompt).not.toContain('Now:');
    expect(hasMachineDate(prompt)).toBe(false);
  });

  it('"today" is the tenant\'s: 21:30 UTC on the 13th is already Wednesday the 14th in Riyadh', () => {
    expect(todayLine(ZONE, new Date('2026-10-13T21:30:00Z'))).toBe('Today: Wednesday 14 October 2026');
  });
});

describe('ACC-220 — timing as words, in the tenant\'s zone', () => {
  it('overdue: by days, or since a time earlier today', () => {
    expect(timingPhrase(task('2026-09-23T13:00:00.000Z'), 'overdue', ZONE, NOW)).toBe('overdue by 20 days');
    expect(timingPhrase(task('2026-10-12T10:00:00.000Z'), 'overdue', ZONE, NOW)).toBe('overdue by 1 day');
    expect(timingPhrase(task('2026-10-13T03:00:00.000Z'), 'overdue', ZONE, NOW)).toBe('overdue since 06:00 today');
  });

  it('due today: the time in Riyadh, not in UTC', () => {
    expect(timingPhrase(task('2026-10-13T12:00:00.000Z'), 'dueToday', ZONE, NOW)).toBe('due today at 15:00');
  });

  it('a held task due earlier today sits in DUE TODAY and is never worded overdue (ACC-173)', () => {
    expect(timingPhrase(task('2026-10-13T03:00:00.000Z'), 'dueToday', ZONE, NOW)).toBe('due today at 06:00');
  });

  it('later: tomorrow with a time, then the day in words; the year only when it is not this year', () => {
    expect(timingPhrase(task('2026-10-14T07:00:00.000Z'), 'pool', ZONE, NOW)).toBe('due tomorrow at 10:00');
    expect(timingPhrase(task('2026-10-26T06:00:00.000Z'), 'pool', ZONE, NOW)).toBe('due Mon 26 Oct');
    expect(timingPhrase(task('2027-01-03T06:00:00.000Z'), 'pool', ZONE, NOW)).toBe('due Sun 3 Jan 2027');
    expect(timingPhrase(task(null), 'pool', ZONE, NOW)).toBe('no due date');
  });

  it('crossing midnight: due 00:30 tomorrow in Riyadh, still the 13th in UTC → "due tomorrow"', () => {
    const lateEvening = new Date('2026-10-13T20:30:00Z'); // 23:30 in Riyadh
    expect(timingPhrase(task('2026-10-13T21:30:00.000Z'), 'pool', ZONE, lateEvening)).toBe('due tomorrow at 00:30');
  });

  it('crossing midnight the other way: due 01:00 today in Riyadh, the 12th in UTC → "overdue since 01:00 today"', () => {
    expect(timingPhrase(task('2026-10-12T22:00:00.000Z'), 'overdue', ZONE, NOW)).toBe('overdue since 01:00 today');
  });

  it('requests: more time or a pause, until a day in words; a passed day says so; no date says so', () => {
    expect(timingPhrase(request('EXTENSION', '2026-10-26T06:00:00.000Z'), 'decision', ZONE, NOW)).toBe('asks for more time until Mon 26 Oct');
    expect(timingPhrase(request('ON_HOLD', '2026-10-26T06:00:00.000Z'), 'decision', ZONE, NOW)).toBe('asks to pause it until Mon 26 Oct');
    expect(timingPhrase(request('EXTENSION', '2026-10-12T06:00:00.000Z'), 'decision', ZONE, NOW)).toBe('asks for more time until Mon 12 Oct, which has passed');
    expect(timingPhrase(request('EXTENSION', null), 'decision', ZONE, NOW)).toBe('asks for more time (no date given)');
    expect(timingPhrase(request('ON_HOLD', null), 'decision', ZONE, NOW)).toBe('asks to pause it (no date given)');
  });

  it('a request date crossing midnight: 22:00 UTC on Sunday the 25th is Monday the 26th in Riyadh', () => {
    expect(timingPhrase(request('EXTENSION', '2026-10-25T22:00:00.000Z'), 'decision', ZONE, NOW)).toBe('asks for more time until Mon 26 Oct');
  });

  it('arrived: just now, minutes, hours — singular where it is one', () => {
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(timingPhrase(note(ago(20_000)), 'notification', ZONE, NOW)).toBe('arrived just now');
    expect(timingPhrase(note(ago(60_000)), 'notification', ZONE, NOW)).toBe('arrived 1 minute ago');
    expect(timingPhrase(note(ago(25 * 60_000)), 'notification', ZONE, NOW)).toBe('arrived 25 minutes ago');
    expect(timingPhrase(note(ago(60 * 60_000)), 'notification', ZONE, NOW)).toBe('arrived 1 hour ago');
    expect(timingPhrase(note(ago(185 * 60_000)), 'notification', ZONE, NOW)).toBe('arrived 3 hours ago');
  });
});

describe('parseBriefingAnswer (D13)', () => {
  it('reads the lead and the focus picks', () => {
    const answer = parseBriefingAnswer('{"lead": "One task is overdue.", "focus": [{"key": "T1", "reason": "It blocks the audit."}]}', groups, 'en');
    expect(answer).toEqual({ lead: 'One task is overdue.', focus: [{ key: 'T1', reason: 'It blocks the audit.' }], fallback: false, datesFound: NO_DATES });
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
    expect(parseBriefingAnswer('One task is overdue today.', groups, 'en')).toEqual({
      lead: 'One task is overdue today.',
      focus: [],
      fallback: false,
      datesFound: NO_DATES,
    });
  });

  it('broken JSON, or JSON with no lead, falls back to our own lead', () => {
    expect(parseBriefingAnswer('{"lead": "unterminated', groups, 'en')).toEqual({
      lead: 'Here is your work for today.',
      focus: [],
      fallback: true,
      datesFound: NO_DATES,
    });
    expect(parseBriefingAnswer('{"focus": []}', groups, 'ar').lead).toBe('هذه أعمالك لليوم.');
  });

  it('a long lead is cut to the cap', () => {
    const answer = parseBriefingAnswer(JSON.stringify({ lead: 'A sentence here. '.repeat(60), focus: [] }), groups, 'en');
    expect(answer.lead.length).toBeLessThanOrEqual(LEAD_CAP);
    expect(answer.lead.endsWith('.')).toBe(true);
  });

  it('a malformed answer never throws', () => {
    for (const text of ['', '{', '}{', '{"lead": 5, "focus": [null, 3, {"key": 7}]}', '{"lead": "ok", "focus": [{"key": "T1", "reason": {"x": 1}}]}']) {
      expect(() => parseBriefingAnswer(text, groups, 'en')).not.toThrow();
    }
  });
});

describe('ACC-220 — the guard in parseBriefingAnswer', () => {
  const answer = (lead: string, focus: { key: string; reason: string }[] = [{ key: 'T1', reason: 'It blocks the audit.' }]) =>
    parseBriefingAnswer(JSON.stringify({ lead, focus }), groups, 'en');

  it.each([
    ['an ISO date', 'Close CAPA-0912 has been overdue since 2026-09-23.'],
    ['an ISO timestamp', 'Overdue since 2026-09-23T13:00:00.000Z.'],
    ['a slashed day-first date', 'Overdue since 23/09/2026.'],
    ['a dashed day-first date', 'Overdue since 23-09-2026.'],
    ['Arabic-Indic digits', 'مهمة متأخرة منذ ٢٠٢٦-٠٩-٢٣.'],
    ['a clock with seconds', 'It arrived at 04:28:47.'],
  ])('a lead holding %s → our lead, and the valid picks are KEPT (Q2)', (_label, lead) => {
    expect(answer(lead)).toEqual({
      lead: 'Here is your work for today.',
      focus: [{ key: 'T1', reason: 'It blocks the audit.' }],
      fallback: true,
      datesFound: { lead: true, droppedPicks: 0 },
    });
  });

  it('an Arabic briefing falls back to the Arabic lead', () => {
    expect(parseBriefingAnswer(JSON.stringify({ lead: 'متأخرة منذ 2026-09-23.', focus: [] }), groups, 'ar').lead).toBe('هذه أعمالك لليوم.');
  });

  it('a reason holding a timestamp drops that pick only; the others stay', () => {
    const result = answer('Two things matter today.', [
      { key: 'T1', reason: 'Overdue since 2026-09-23T13:00:00.000Z.' },
      { key: 'N1', reason: 'Check it was you.' },
    ]);
    expect(result.lead).toBe('Two things matter today.');
    expect(result.focus).toEqual([{ key: 'N1', reason: 'Check it was you.' }]);
    expect(result.datesFound).toEqual({ lead: false, droppedPicks: 1 });
    expect(result.fallback).toBe(false);
  });

  it('every reason dated → no picks, so no focus section', () => {
    const result = answer('Calm day.', [
      { key: 'T1', reason: 'since 2026-09-23' },
      { key: 'N1', reason: 'arrived 2026-10-13T04:28:47.536Z' },
    ]);
    expect(result.focus).toEqual([]);
    expect(result.datesFound.droppedPicks).toBe(2);
  });

  it('the plain-text path is guarded too', () => {
    expect(parseBriefingAnswer('Overdue since 2026-09-23.', groups, 'en')).toEqual({
      lead: 'Here is your work for today.',
      focus: [],
      fallback: true,
      datesFound: { lead: true, droppedPicks: 0 },
    });
  });

  it('no false alarm: a title we sent, quoted exactly, may hold a date; the list\'s own wording is fine (Q3)', () => {
    const dated: IBriefingGroup[] = [
      { kind: 'overdue', items: [{ key: 'T1', type: 'TASK', id: 'x', title: 'Audit report 2026-09-30', dueAt: null, link: null }] },
    ];
    const result = parseBriefingAnswer(
      JSON.stringify({
        lead: 'Audit report 2026-09-30 is overdue by 20 days; the rest is due today at 15:00.',
        focus: [{ key: 'T1', reason: 'Finish Audit report 2026-09-30 first; it arrived 3 hours ago.' }],
      }),
      dated,
      'en',
    );
    expect(result.fallback).toBe(false);
    expect(result.lead).toBe('Audit report 2026-09-30 is overdue by 20 days; the rest is due today at 15:00.');
    expect(result.focus).toHaveLength(1);
    expect(result.datesFound).toEqual(NO_DATES);
  });

  it('but a date of the model\'s own beside that title is still caught', () => {
    const dated: IBriefingGroup[] = [
      { kind: 'overdue', items: [{ key: 'T1', type: 'TASK', id: 'x', title: 'Audit report 2026-09-30', dueAt: null, link: null }] },
    ];
    expect(parseBriefingAnswer(JSON.stringify({ lead: 'Audit report 2026-09-30 was due 2026-10-01.', focus: [] }), dated, 'en').fallback).toBe(true);
  });

  it('hasMachineDate: a bare clock time and plain numbers are not machine dates (Q3)', () => {
    expect(hasMachineDate('due today at 15:00, 3 tasks, 2026 plan, CAPA-0912')).toBe(false);
    expect(hasMachineDate('2026-09-23')).toBe(true);
  });
});

describe('codeLead', () => {
  it('a quiet day reads the drawing\'s sentence, in both languages', () => {
    expect(codeLead([], 'en')).toBe('Nothing is overdue or due today, and nothing waits for you.');
    expect(codeLead([], 'ar')).toBe('لا شيء متأخر أو مستحق اليوم، ولا شيء بانتظارك.');
  });
});
