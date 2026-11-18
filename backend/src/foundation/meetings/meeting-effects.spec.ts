import { MEETING_TRANSITION_EFFECTS } from './meeting-effects';
import type { TransitionEffectContext, TransitionEffectDeps } from '../workflow/transition-effect.types';

/**
 * ACC-316 PR 3a — a meeting effect's notices are sent one by one: a notice that
 * fails is logged, and the rest still go (as MeetingsService.tellInvited does).
 */
describe('Meeting transition effects — notices', () => {
  const ctx: TransitionEffectContext = {
    objectType: 'MEETING',
    objectId: 'meeting-1',
    organizationId: 'org-1',
    actorId: 'actor',
    kind: 'ADVANCE',
    fromStageFlags: [],
    toStageFlags: ['AGENDA_ISSUED'],
    comment: null,
  };

  it.each(['meeting.agenda_issued', 'meeting.cancelled'])('%s: one failed notice does not stop the others', async (key) => {
    const effect = MEETING_TRANSITION_EFFECTS.find((e) => e.key === key)!;
    const sent: string[] = [];
    const deps = {
      prisma: {},
      calendar: { getEffectiveTimeZone: async () => 'Asia/Riyadh' },
      notifications: {
        create: jest.fn(async (dto: { userId: string }) => {
          if (dto.userId === 'first') throw new Error('mail server down');
          sent.push(dto.userId);
          return { id: dto.userId };
        }),
      },
    } as unknown as TransitionEffectDeps;
    const prepared = { title: 'Monthly review', startsAt: new Date(Date.UTC(2026, 10, 25, 9, 0)), userIds: ['first', 'second', 'third'] };

    await expect(effect.finish!(deps, ctx, prepared)).resolves.toBeUndefined();
    expect(sent).toEqual(['second', 'third']);
  });
});
