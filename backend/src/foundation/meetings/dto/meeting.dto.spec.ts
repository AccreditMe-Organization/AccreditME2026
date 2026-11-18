import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckMeetingClashesDto, CreateAgendaItemDto, UpdateAgendaItemDto } from './meeting.dto';

/** ACC-316 PR 3b — the request shapes refuse what the service should never see (lane B's review, fix 9). */
describe('meeting DTOs', () => {
  const errorsOf = async <T extends object>(type: new () => T, body: object) => {
    const errors = await validate(plainToInstance(type, body));
    return errors.map((e) => e.property);
  };
  const time = { startsAt: '2026-12-01T09:00:00.000Z', durationMinutes: 60 };

  it('the clash check takes at most 52 times', async () => {
    expect(await errorsOf(CheckMeetingClashesDto, { committeeId: 'c', times: Array(52).fill(time) })).toEqual([]);
    expect(await errorsOf(CheckMeetingClashesDto, { committeeId: 'c', times: Array(53).fill(time) })).toEqual(['times']);
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
