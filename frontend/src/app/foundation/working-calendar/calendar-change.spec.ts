import { diffCalendarChange } from './calendar-change';

/** What WorkingCalendarService.toInterface() actually writes — the whole interface. */
const state = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  id: 'cal-a',
  organizationId: 'org-a',
  timezone: 'Asia/Riyadh',
  workingDays: [0, 1, 2, 3, 4],
  workingHoursStart: '08:00',
  workingHoursEnd: '16:00',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('diffCalendarChange (ACC-120 slice 1)', () => {
  // THE REASON THE WHITELIST EXISTS. toInterface() writes the whole interface,
  // so updatedAt differs on every single edit by definition. A diff over all
  // keys would report it every time and bury the field the reader came for.
  it('ignores updatedAt, which changes on every edit by definition', () => {
    const changes = diffCalendarChange(
      state({ updatedAt: '2026-09-01T00:00:00.000Z' }),
      state({ updatedAt: '2026-09-20T00:00:00.000Z' }),
    );

    expect(changes).toEqual([]);
  });

  it('ignores the immutable fields, which can never differ', () => {
    const changes = diffCalendarChange(
      state(),
      state({ id: 'something-else', organizationId: 'other-org', createdAt: 'later' }),
    );

    expect(changes).toEqual([]);
  });

  it('reports a changed time of day with both values', () => {
    const changes = diffCalendarChange(state(), state({ workingHoursEnd: '17:00' }));

    expect(changes.length).toBe(1);
    expect(changes[0].labelKey).toBe('workingCalendar.workingHoursEnd');
    expect(changes[0].from).toEqual({ kind: 'text', text: '16:00' });
    expect(changes[0].to).toEqual({ kind: 'text', text: '17:00' });
  });

  // The design's own example: "Sun–Thu became Sun–Wed". Day KEYS, not rendered
  // names, because only a component can translate them.
  it('reports a changed working week as day label keys', () => {
    const changes = diffCalendarChange(state(), state({ workingDays: [0, 1, 2, 3] }));

    expect(changes.length).toBe(1);
    expect(changes[0].labelKey).toBe('workingCalendar.workingDays');
    expect(changes[0].from).toEqual({
      kind: 'dayKeys',
      dayKeys: [
        'workingCalendar.daySun',
        'workingCalendar.dayMon',
        'workingCalendar.dayTue',
        'workingCalendar.dayWed',
        'workingCalendar.dayThu',
      ],
    });
    expect(changes[0].to).toEqual({
      kind: 'dayKeys',
      dayKeys: [
        'workingCalendar.daySun',
        'workingCalendar.dayMon',
        'workingCalendar.dayTue',
        'workingCalendar.dayWed',
      ],
    });
  });

  // workingDays is a SET stored as an array. Reordering checkboxes is not a
  // change, and reporting it as one would teach a reader to distrust the history.
  it('does not report a reordered working week as a change', () => {
    const changes = diffCalendarChange(state({ workingDays: [0, 1, 2, 3, 4] }), state({ workingDays: [4, 2, 0, 3, 1] }));

    expect(changes).toEqual([]);
  });

  // ...and it renders in WEEK order regardless of how it was stored, so the same
  // week always reads the same way.
  it('renders days in week order, not arrival order', () => {
    const changes = diffCalendarChange(state({ workingDays: [1] }), state({ workingDays: [6, 0, 3] }));

    expect(changes[0].to).toEqual({
      kind: 'dayKeys',
      dayKeys: ['workingCalendar.daySun', 'workingCalendar.dayWed', 'workingCalendar.daySat'],
    });
  });

  it('reports several changed fields in a fixed order, not the JSON order', () => {
    const changes = diffCalendarChange(
      state(),
      state({ workingHoursEnd: '17:00', timezone: 'Europe/London', workingDays: [1, 2, 3, 4, 5] }),
    );

    expect(changes.map((c) => c.labelKey)).toEqual([
      'workingCalendar.timezone',
      'workingCalendar.workingDays',
      'workingCalendar.workingHoursEnd',
    ]);
  });

  // A field absent on one side is a real change, not a gap to hide: the first
  // edit of a calendar created before a field existed legitimately has no
  // "before" for it, and "not set → Asia/Riyadh" is the truth there.
  it('reports a field that only one side has, with the missing side empty', () => {
    const before = state();
    delete before['timezone'];

    const changes = diffCalendarChange(before, state());

    expect(changes.length).toBe(1);
    expect(changes[0].from).toEqual({ kind: 'text', text: '' });
    expect(changes[0].to).toEqual({ kind: 'text', text: 'Asia/Riyadh' });
  });

  it('survives a row whose before or after is not an object', () => {
    expect(diffCalendarChange(null, null)).toEqual([]);
    expect(diffCalendarChange(undefined, undefined)).toEqual([]);
    expect(diffCalendarChange('nonsense', 42)).toEqual([]);
    // One real side is still readable.
    expect(diffCalendarChange(null, state()).length).toBe(4);
  });
});
