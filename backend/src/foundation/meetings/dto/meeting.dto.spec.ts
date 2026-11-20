import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckMeetingClashesDto, CreateAgendaItemDto, CreateMeetingSeriesDto, ListMeetingsDto, ScheduleMeetingDto, UpdateAgendaItemDto, UpdateMeetingDto } from './meeting.dto';

/** ACC-316 PR 3b — the request shapes refuse what the service should never see (lane B's review, fix 9). */
describe('meeting DTOs', () => {
  const errorsOf = async <T extends object>(type: new () => T, body: object) => {
    const errors = await validate(plainToInstance(type, body));
    return errors.map((e) => e.property);
  };
  const time = { startsAt: '2026-12-01T09:00:00.000Z', durationMinutes: 60 };

  // ACC-316 PR 5 — a series' most meetings: weekly for twelve months, both ends included.
  it('the clash check takes at most 53 times', async () => {
    expect(await errorsOf(CheckMeetingClashesDto, { committeeId: 'c', times: Array(53).fill(time) })).toEqual([]);
    expect(await errorsOf(CheckMeetingClashesDto, { committeeId: 'c', times: Array(54).fill(time) })).toEqual(['times']);
  });

  // PR 8a (Ahmad, 20 Nov, Q5) — a standing agenda holds at most ten items.
  it('a series takes at most ten standing agenda items', async () => {
    const series = { committeeId: 'c', subject: 'IPC', typeValueId: 't', startTime: '10:00', durationMinutes: 60, location: 'Room 4', every: 'MONTH_1', onKind: 'DAY_OF_MONTH', dayOfMonth: 5, firstDate: '2027-01-05', count: 4 };
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Item ${i}` }));
    expect(await errorsOf(CreateMeetingSeriesDto, { ...series, standingAgenda: items(10) })).toEqual([]);
    expect(await errorsOf(CreateMeetingSeriesDto, { ...series, standingAgenda: items(11) })).toEqual(['standingAgenda']);
  });

  // ACC-316 PR 8b (P240) — the whole series view names its series.
  it('view=series needs a seriesId; the other views do not', async () => {
    expect(await errorsOf(ListMeetingsDto, { view: 'series' })).toEqual(['seriesId']);
    expect(await errorsOf(ListMeetingsDto, { view: 'series', seriesId: '' })).toEqual(['seriesId']);
    expect(await errorsOf(ListMeetingsDto, { view: 'series', seriesId: '  ' })).toEqual(['seriesId']);
    expect(await errorsOf(ListMeetingsDto, { view: 'series', seriesId: 's-1' })).toEqual([]);
    expect(await errorsOf(ListMeetingsDto, { view: 'upcoming' })).toEqual([]);
    expect(await errorsOf(ListMeetingsDto, { view: 'nothing' })).toEqual(['view']);
  });

  it('a bare ?seriesId= on any other view is ignored, as before view=series (P243)', async () => {
    expect(await errorsOf(ListMeetingsDto, { view: 'upcoming', seriesId: '' })).toEqual([]);
    expect(await errorsOf(ListMeetingsDto, { seriesId: '' })).toEqual([]);
    expect(await errorsOf(ListMeetingsDto, { view: 'past', seriesId: 's-1' })).toEqual([]);
  });

  it("an online meeting link is https only (it goes into an outside guest's email)", async () => {
    const schedule = { committeeId: 'c', title: 'Board', typeValueId: 't', scheduledAt: '2026-12-01T09:00:00.000Z', durationMinutes: 60 };
    expect(await errorsOf(ScheduleMeetingDto, { ...schedule, meetingUrl: 'https://teams.example/join/1' })).toEqual([]);
    expect(await errorsOf(ScheduleMeetingDto, { ...schedule, meetingUrl: 'http://teams.example/join/1' })).toEqual(['meetingUrl']);
    expect(await errorsOf(ScheduleMeetingDto, { ...schedule, meetingUrl: 'javascript:alert(1)' })).toEqual(['meetingUrl']);
    expect(await errorsOf(UpdateMeetingDto, { meetingUrl: 'http://teams.example/join/1' })).toEqual(['meetingUrl']);
  });

  it('a presenter names an invitee or a person: an empty one is refused', async () => {
    expect(await errorsOf(CreateAgendaItemDto, { title: 'Budget', presenter: {} })).toEqual(['presenter']);
    expect(await errorsOf(UpdateAgendaItemDto, { presenter: {} })).toEqual(['presenter']);
    expect(await errorsOf(CreateAgendaItemDto, { title: 'Budget', presenter: { attendeeId: 'a' } })).toEqual([]);
    expect(await errorsOf(CreateAgendaItemDto, { title: 'Budget', presenter: { userId: 'u' } })).toEqual([]);
    // No presenter at all, or null on an update (clear it), is fine.
    expect(await errorsOf(CreateAgendaItemDto, { title: 'Budget' })).toEqual([]);
    expect(await errorsOf(UpdateAgendaItemDto, { presenter: null })).toEqual([]);
  });
});
