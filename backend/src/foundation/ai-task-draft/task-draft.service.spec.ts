import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { AiService, AiRunRequest } from '../ai/ai.service';
import { AiRefusalException } from '../ai/ai-refusal';
import { CLOSE_NOTE, OPEN_NOTE } from './draft-answer';
import { DraftRefusalException } from './draft-refusal';
import { TaskDraftService } from './task-draft.service';

// ACC-197 — the draft service. The REAL ObjectVisibilityService runs over a
// mocked database, so the permission order and the tenant scoping are exercised
// and not assumed.

const ORG = 'org-a';
const ACTOR = 'user-1';
const COMMITTEE = 'committee-1';
const NOTE = 'follow up hand rub stock ward 6A';
const SECRET_NAME = 'Infection Control Committee';
const VIEWER = { id: ACTOR, permissions: ['tasks:create', 'committees:view'] };

const GOOD = JSON.stringify({
  title: 'Restock and check hand rub on ward 6A',
  purpose: 'Keep ward 6A supplied with hand rub.',
  toDo: 'Check every dispenser and reorder through Supply.',
  doneWhen: 'Every dispenser is full.',
});

const orgRow = {
  aiMonthlyCredits: 2000,
  aiPendingMonthlyCredits: null,
  aiCreditsUsed: 0,
  aiCreditsPeriodStart: new Date('2026-09-21T00:00:00.000Z'),
  aiCreditsRenewsAt: new Date('2099-01-01T00:00:00.000Z'),
  bootstrappedAt: new Date('2026-09-21T00:00:00.000Z'),
  createdAt: new Date('2026-09-21T00:00:00.000Z'),
  settings: {},
};

function setup(answer: string = GOOD) {
  const prisma = {
    organization: { findFirst: jest.fn().mockResolvedValue(orgRow) },
    aiFeatureCost: {
      findMany: jest.fn().mockResolvedValue([{ featureKey: 'task_description_drafting', creditCost: 2, restricted: false, allowedOrganizationIds: [] }]),
    },
    committee: {
      // The visibility check selects { id }, the context read the names.
      findFirst: jest.fn().mockImplementation(({ where }: { where: { id: string; organizationId: string } }) =>
        Promise.resolve(where.id === COMMITTEE && where.organizationId === ORG ? { id: COMMITTEE, nameEn: SECRET_NAME, nameAr: 'لجنة مكافحة العدوى', purpose: 'Oversees infection prevention.' } : null),
      ),
    },
    meeting: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const ai = {
    // The real gateway calls accept() before it logs; a rejected answer is
    // refunded and refused AI_PROVIDER_FAILED.
    run: jest.fn().mockImplementation((_feature: string, _context: unknown, request: AiRunRequest) => {
      if (request.accept && !request.accept(answer, false)) return Promise.reject(new AiRefusalException('AI_PROVIDER_FAILED'));
      return Promise.resolve({ content: answer, interactionId: 'log-1', creditCost: 2, inputTokens: 300, outputTokens: 120, truncated: false });
    }),
  };
  const service = new TaskDraftService(
    prisma as unknown as PrismaService,
    ai as unknown as AiService,
    new ObjectVisibilityService(prisma as unknown as PrismaService),
  );
  return { service, prisma, ai };
}

const requestOf = (ai: { run: jest.Mock }): AiRunRequest => (ai.run.mock.calls[0] as [string, unknown, AiRunRequest])[2];

describe('TaskDraftService.draft (ACC-197)', () => {
  it('drafts from the note and the record, through the gateway, and returns the labelled lines', async () => {
    const { service, ai } = setup();
    const draft = await service.draft(VIEWER, ORG, { note: NOTE, language: 'en', title: 'Hand rub', sourceType: 'COMMITTEE', sourceId: COMMITTEE });

    expect(draft).toEqual({
      draftId: 'log-1',
      title: 'Restock and check hand rub on ward 6A',
      lines: [
        { label: 'Purpose:', text: 'Keep ward 6A supplied with hand rub.' },
        { label: 'To do:', text: 'Check every dispenser and reorder through Supply.' },
        { label: 'Done when:', text: 'Every dispenser is full.' },
      ],
      description: 'Purpose: Keep ward 6A supplied with hand rub.\nTo do: Check every dispenser and reorder through Supply.\nDone when: Every dispenser is full.',
    });

    const [feature, context] = ai.run.mock.calls[0] as [string, unknown];
    expect(feature).toBe('task_description_drafting');
    expect(context).toEqual({ organizationId: ORG, actorId: ACTOR });
    const request = requestOf(ai);
    expect(request.system).toContain('Write ONLY in English');
    expect(request.prompt).toContain(`Record: Committee "${SECRET_NAME}"`);
    expect(request.prompt).toContain('Record purpose: Oversees infection prevention.');
    expect(request.prompt).toContain('Title typed so far: Hand rub');
    expect(request.prompt).toContain(`${OPEN_NOTE}\n${NOTE}\n${CLOSE_NOTE}`);
    expect(typeof request.accept).toBe('function');
  });

  it("the log's description is counts and ids only: no note, no title, no record name", async () => {
    const { service, ai } = setup();
    await service.draft(VIEWER, ORG, { note: NOTE, language: 'en', title: 'Hand rub title', sourceType: 'COMMITTEE', sourceId: COMMITTEE });
    const { description } = requestOf(ai);
    expect(description).toBe(`task draft · COMMITTEE ${COMMITTEE} · note ${NOTE.length} characters`);
    expect(description).not.toContain(NOTE);
    expect(description).not.toContain('Hand rub title');
    expect(description).not.toContain(SECRET_NAME);
  });

  it('in Arabic, the record goes by its Arabic name, and the labels are Arabic', async () => {
    const { service, ai } = setup();
    const draft = await service.draft(VIEWER, ORG, { note: NOTE, language: 'ar', sourceType: 'COMMITTEE', sourceId: COMMITTEE });
    expect(requestOf(ai).system).toContain('Write ONLY in Arabic');
    expect(requestOf(ai).prompt).toContain('Record: Committee "لجنة مكافحة العدوى"');
    expect(draft.lines.map((l) => l.label)).toEqual(['الغرض:', 'المطلوب:', 'يُعدّ منجزًا:']);
  });

  it('a record with no Arabic name is sent by its English one (Arabic is never mandatory)', async () => {
    const { service, ai, prisma } = setup();
    prisma.committee.findFirst.mockResolvedValue({ id: COMMITTEE, nameEn: SECRET_NAME, nameAr: null, purpose: null });
    await service.draft(VIEWER, ORG, { note: NOTE, language: 'ar', sourceType: 'COMMITTEE', sourceId: COMMITTEE });
    expect(requestOf(ai).prompt).toContain(`Record: Committee "${SECRET_NAME}"`);
    expect(requestOf(ai).prompt).not.toContain('Record purpose');
  });

  it('with no record, drafts from the note alone and reads no record', async () => {
    const { service, ai, prisma } = setup();
    await service.draft(VIEWER, ORG, { note: NOTE, language: 'en' });
    expect(requestOf(ai).prompt).toBe(`${OPEN_NOTE}\n${NOTE}\n${CLOSE_NOTE}`);
    expect(requestOf(ai).description).toBe(`task draft · no record · note ${NOTE.length} characters`);
    expect(prisma.committee.findFirst).not.toHaveBeenCalled();
  });

  describe('refused before the model is called — nothing is charged', () => {
    it.each(['', '   ', 'ward 6A', '12/10/2026'])('a note with fewer than 8 letters (%j) → DRAFT_NOTE_TOO_SHORT, with no read and no call', async (note) => {
      const { service, ai, prisma } = setup();
      const error = await service.draft(VIEWER, ORG, { note, language: 'en', sourceType: 'COMMITTEE', sourceId: COMMITTEE }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DraftRefusalException);
      expect((error as DraftRefusalException).code).toBe('DRAFT_NOTE_TOO_SHORT');
      expect((error as DraftRefusalException).getStatus()).toBe(409);
      expect(ai.run).not.toHaveBeenCalled();
      expect(prisma.committee.findFirst).not.toHaveBeenCalled();
      expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    });

    it('a record type without its id (or the reverse) is a 400', async () => {
      const { service, ai } = setup();
      await expect(service.draft(VIEWER, ORG, { note: NOTE, language: 'en', sourceType: 'COMMITTEE' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.draft(VIEWER, ORG, { note: NOTE, language: 'en', sourceId: COMMITTEE })).rejects.toBeInstanceOf(BadRequestException);
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('a viewer who cannot see the record → 403 naming the permission, BEFORE the record is read', async () => {
      const { service, ai, prisma } = setup();
      const error = await service
        .draft({ id: ACTOR, permissions: ['tasks:create'] }, ORG, { note: NOTE, language: 'en', sourceType: 'COMMITTEE', sourceId: COMMITTEE })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe('Required permission: committees:view');
      expect(prisma.committee.findFirst).not.toHaveBeenCalled();
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('should NOT return records belonging to a different tenant', async () => {
      // The committee exists, in ANOTHER organisation. The caller holds every
      // permission in their own.
      const { service, ai, prisma } = setup();
      const error = await service.draft(VIEWER, 'org-b', { note: NOTE, language: 'en', sourceType: 'COMMITTEE', sourceId: COMMITTEE }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      // Every read of the record was scoped by id AND the caller's organisation.
      expect(prisma.committee.findFirst).toHaveBeenCalled();
      for (const call of prisma.committee.findFirst.mock.calls as Array<[{ where: unknown }]>) {
        expect(call[0].where).toEqual({ id: COMMITTEE, organizationId: 'org-b' });
      }
      // Nothing about it reached the model.
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('the record is read for context only AFTER the visibility check, scoped by organisation', async () => {
      const { service, prisma } = setup();
      await service.draft(VIEWER, ORG, { note: NOTE, language: 'en', sourceType: 'COMMITTEE', sourceId: COMMITTEE });
      const calls = prisma.committee.findFirst.mock.calls as Array<[{ where: unknown; select: Record<string, boolean> }]>;
      expect(calls).toHaveLength(2);
      expect(calls[0]![0].select).toEqual({ id: true });
      expect(calls[1]![0].select).toEqual({ nameEn: true, nameAr: true, purpose: true });
      for (const call of calls) expect(call[0].where).toEqual({ id: COMMITTEE, organizationId: ORG });
    });

    it.each([
      ['NO_ALLOWANCE', { ...orgRow, aiMonthlyCredits: 0 }],
      ['SWITCHED_OFF', { ...orgRow, settings: { ai: { enabled: false } } }],
    ])('AI not available (%s) → AI_NOT_ENABLED with the reason, and no call', async (reason, org) => {
      const { service, ai, prisma } = setup();
      prisma.organization.findFirst.mockResolvedValue(org);
      const error = await service.draft(VIEWER, ORG, { note: NOTE, language: 'en' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiRefusalException);
      expect((error as AiRefusalException).code).toBe('AI_NOT_ENABLED');
      expect((error as AiRefusalException).details).toEqual({ reason, feature: 'task_description_drafting' });
      expect(ai.run).not.toHaveBeenCalled();
    });
  });

  describe('an answer we cannot use — the gateway refunds it', () => {
    it('accept() takes a good answer, and rejects a cut-short, empty or unreadable one', async () => {
      const { service, ai } = setup();
      await service.draft(VIEWER, ORG, { note: NOTE, language: 'en' });
      const accept = requestOf(ai).accept!;
      expect(accept(GOOD, false)).toBe(true);
      expect(accept(GOOD, true)).toBe(false);
      expect(accept('', false)).toBe(false);
      expect(accept('{"title": "x"}', false)).toBe(false);
      expect(accept('{"insufficient": true}', false)).toBe(false);
    });

    it('"the note does not say what the task is" → DRAFT_NOTHING_TO_SUGGEST', async () => {
      const { service } = setup('{"insufficient": true}');
      const error = await service.draft(VIEWER, ORG, { note: NOTE, language: 'en' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DraftRefusalException);
      expect((error as DraftRefusalException).code).toBe('DRAFT_NOTHING_TO_SUGGEST');
    });

    it('any other unusable answer stays the gateway\'s own refusal ("Try again")', async () => {
      const { service } = setup('I cannot produce JSON today.');
      const error = await service.draft(VIEWER, ORG, { note: NOTE, language: 'en' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiRefusalException);
      expect((error as AiRefusalException).code).toBe('AI_PROVIDER_FAILED');
    });

    it('a gateway refusal passes through unchanged', async () => {
      const { service, ai } = setup();
      const refusal = new AiRefusalException('AI_CREDITS_EXHAUSTED', { creditCost: 2, creditsRemaining: 1, renewsAt: '2026-10-21T00:00:00.000Z' });
      ai.run.mockRejectedValue(refusal);
      await expect(service.draft(VIEWER, ORG, { note: NOTE, language: 'en' })).rejects.toBe(refusal);
    });
  });
});

describe('TaskDraftService.availability (ACC-197)', () => {
  it('true when AI is on and the feature is open; false otherwise — and nothing else is told', async () => {
    const { service, prisma } = setup();
    await expect(service.availability(ORG)).resolves.toEqual({ available: true });
    prisma.organization.findFirst.mockResolvedValue({ ...orgRow, aiMonthlyCredits: 0 });
    await expect(service.availability(ORG)).resolves.toEqual({ available: false });
  });
});
