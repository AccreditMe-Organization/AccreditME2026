/**
 * ACC-322 PR 1 — Draft minutes, with the action items, against a REAL Postgres
 * (npm run test:db). Plan: backend/Plans/step-322-meetings-ai.md §1.2, §2, §4.
 *
 * The gateway is a stub that records each call and answers as a test says: the
 * gateway's own metering is ai-credit.db-spec.ts's. A call the stub was asked
 * for is a call the gateway would have charged.
 *
 * Only a database proves:
 *   - the gate: whoever records the minutes, Minutes Draft, never after Return
 *     for Correction (M9), notes included; another organisation's 404;
 *   - the notes are read by their writer only (M3);
 *   - names never reach the model as written; owners come back from labels;
 *   - Accept as ONE minutes write, once; votes above the members present kept
 *     by Accept and still refused by the ordinary write and by Distribute (M6);
 *   - Draft again by part (M8);
 *   - Distribute and cancel deleting, with Distribute's count on its audit row;
 *   - one run at a time, released after a failure; a meeting that moved on
 *     during the call saves nothing.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { DelegationLabelService } from '../../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { NotificationService } from '../../notification/notification.service';
import { TenantService } from '../../tenant/tenant.service';
import { LookupService } from '../../lookup/lookup.service';
import { TaskService } from '../../task/task.service';
import { TaskAuthorityService } from '../../task/task-authority.service';
import { TaskAssignmentService } from '../../task/task-assignment.service';
import { TaskSlaService } from '../../task/task-sla.service';
import { TaskClosedNoticeService } from '../../task/task-closed-notice.service';
import { TaskVisibilityService } from '../../task/task-visibility.service';
import { TaskAdmissionService } from '../../task/task-admission.service';
import { WorkflowService } from '../../workflow/workflow.service';
import { StageTaskDefinitionService } from '../../workflow/stage-task-definition.service';
import { StageRulesService } from '../../workflow/stage-rules.service';
import { StagePoolService } from '../../workflow/stage-pool.service';
import { applyWorkflowSeed } from '../../workflow/workflow-seed-apply';
import { writeStartingAssignments } from '../../workflow/workflow-who';
import { SYSTEM_WORKFLOW_SEED } from '../../workflow/workflow.seed';
import { STAGE_FLAG } from '../../workflow/record-registry';
import { applyTransitionEffects, prepareTransitionEffects } from '../../workflow/transition-effects';
import { copyDefaultSeatActions } from '../../committees/seat-actions';
import { AiService } from '../../ai/ai.service';
import { AiRefusalException } from '../../ai/ai-refusal';
import { itEnforcesTenantIsolation } from '../../../common/testing/tenant-isolation';
import { MeetingMinutesService } from '../meeting-minutes.service';
import { MeetingReviewService } from '../meeting-review.service';
import type { MeetingViewer } from '../meeting-access';
import { MeetingAiService } from './meeting-ai.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
const MEETING_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'MEETING')!;
const DAY = 86_400_000;
const OUTSIDE = 'Dr. Lina Mansour';

describe('Meetings AI: Draft minutes against a real database (ACC-322 PR 1)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const lookupService = new LookupService(prisma, audit);
  const notifications = {
    create: async () => ({ id: randomUUID() }),
    createInAppMany: async () => 0,
    sendOutsideEmail: async () => undefined,
  } as unknown as NotificationService;
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(
    prisma,
    audit,
    labels,
    visibility,
    calendar,
    notifications,
    tenant,
    new TaskAssignmentService(prisma, authority, lookups),
    authority,
    sla,
    new TaskClosedNoticeService(prisma, notifications),
  );
  const stageRules = new StageRulesService(prisma);
  const workflow = new WorkflowService(
    prisma,
    audit,
    labels,
    visibility,
    calendar,
    notifications,
    tasks,
    { add: async () => undefined } as never,
    new StageTaskDefinitionService(prisma, audit, tasks),
    new StagePoolService(prisma),
  );
  const admission = new TaskAdmissionService(prisma, visibility, tasks, new TaskVisibilityService(prisma, authority));
  const minutes = new MeetingMinutesService(prisma, visibility, stageRules, workflow, calendar, admission);
  const review = new MeetingReviewService(prisma, visibility, stageRules, workflow, notifications, calendar);

  /** The gateway's stand-in: records each call; `reply` answers it; `during` runs while it "waits". */
  const calls: { prompt: string; system: string; description: string }[] = [];
  let reply: (prompt: string) => string = () => '';
  let during: (() => Promise<void>) | null = null;
  const gateway = {
    run: async (_feature: string, _ctx: unknown, req: { prompt: string; system: string; description: string; accept?: (c: string, t: boolean) => boolean }) => {
      calls.push({ prompt: req.prompt, system: req.system, description: req.description });
      if (during) await during();
      const content = reply(req.prompt);
      if (req.accept && !req.accept(content, false)) throw new AiRefusalException('AI_PROVIDER_FAILED');
      return { content, interactionId: `log-${calls.length}`, creditCost: 8, inputTokens: 1, outputTokens: 1, truncated: false };
    },
  } as unknown as AiService;
  const meetingAi = new MeetingAiService(prisma, visibility, stageRules, gateway, minutes, calendar);

  let seat: Record<string, string> = {};
  let meetingType = '';

  interface World {
    orgId: string;
    people: Record<string, string>;
    committeeId: string;
  }

  async function world(): Promise<World> {
    const slug = `acc322-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED, MEETING_SEED]);
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Clinical', code: `C-${slug}` } });
    const person = async (key: string, name: string) =>
      (await prisma.user.create({ data: { organizationId: o.id, email: `${key}-${slug}@example.test`, name, status: 'ACTIVE' } })).id;
    const people: Record<string, string> = {
      admin: await person('admin', 'Admin Person'),
      chair: await person('chair', 'Khalid Otaibi'),
      secretary: await person('secretary', 'Noura Harbi'),
      member: await person('member', 'Faisal Qahtani'),
      outsider: await person('outsider', 'Ibrahim Zahrani'),
    };
    await writeStartingAssignments(prisma, o.id, people['admin']!, people['admin']!);
    const committeeTemplate = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const active = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: committeeTemplate.id, key: 'active' } });
    const c = await prisma.committee.create({ data: { organizationId: o.id, nameEn: 'IPC', typeValueId: 'type', orgUnitId: unit.id, quorumCount: 2 } });
    const instance = await prisma.workflowInstance.create({
      data: { organizationId: o.id, workflowTemplateId: committeeTemplate.id, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: active.id },
    });
    await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: active.id, enteredAt: new Date() } });
    for (const [key, userId] of [
      ['chairman', people['chair']!],
      ['secretary', people['secretary']!],
      ['member', people['member']!],
    ] as const) {
      await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: c.id, userId, roleValueId: seat[key]! } });
    }
    await prisma.$transaction((tx) => copyDefaultSeatActions(tx, o.id, c.id));
    return { orgId: o.id, people, committeeId: c.id };
  }

  /** A committee meeting at the stage keyed `key`: its members invited, and an outside guest. */
  async function meetingAt(w: World, key: string): Promise<{ id: string; itemId: string; instanceId: string }> {
    const m = await prisma.meeting.create({
      data: {
        organizationId: w.orgId,
        organizerId: w.people['secretary']!,
        title: `IPC ${randomUUID().slice(0, 4)}`,
        typeValueId: meetingType,
        scheduledAt: new Date(Date.now() - DAY),
        durationMinutes: 60,
        location: 'Room 4',
        committeeId: w.committeeId,
      },
    });
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: w.orgId, objectType: 'MEETING', isDefault: true } });
    const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
    const instance = await prisma.workflowInstance.create({
      data: { organizationId: w.orgId, workflowTemplateId: template.id, objectType: 'MEETING', objectId: m.id, status: 'IN_PROGRESS', currentStageId: stage.id },
    });
    await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id, enteredAt: new Date() } });
    for (const [name, seatKey] of [
      ['chair', 'chairman'],
      ['secretary', 'secretary'],
      ['member', 'member'],
    ] as const) {
      await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: m.id, kind: 'MEMBER', userId: w.people[name]!, seatValueId: seat[seatKey]!, invitedAt: new Date() } });
    }
    await prisma.meetingAttendee.create({
      data: { organizationId: w.orgId, meetingId: m.id, kind: 'OUTSIDE_GUEST', outsideName: OUTSIDE, outsideEmail: `lina-${randomUUID().slice(0, 4)}@partner.test`, invitedAt: new Date() },
    });
    const item = await prisma.agendaItem.create({ data: { organizationId: w.orgId, meetingId: m.id, title: 'Hand hygiene audit', order: 1 } });
    return { id: m.id, itemId: item.id, instanceId: instance.id };
  }

  const as = (w: World, name: string, permissions: string[] = []): MeetingViewer => ({ id: w.people[name]!, permissions });
  const outcome = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => unknown }) => e.getResponse?.() ?? `ERROR ${String(e)}`,
    );
  const code = async (p: Promise<unknown>): Promise<unknown> => {
    const r = await outcome(p);
    return typeof r === 'object' && r !== null ? ((r as { code?: string }).code ?? (r as { statusCode?: number }).statusCode) : r;
  };
  const NOTES = `Faisal Qahtani reported 92% compliance. ${OUTSIDE} presented the audit; Lina asked about ward 6. Vote: 5 for, 1 against, 0 abstain. Faisal to send the figures by 2099-01-31; Lina to share her template. Contact faisal@hospital.test.`;
  /** The model's answer: P1 is the first person the notes name (Faisal), P2 the outside guest. */
  const answer = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      items: [
        {
          item: 'A1',
          discussion: '[P1] reported 92% compliance; [P2] presented the audit.',
          decisions: [{ text: 'Adopt the audit tool.', votes: { for: 5, against: 1, abstain: 0 } }],
          actions: [
            { what: 'Send the figures', owner: '[P1]', due: '2099-01-31', time: null },
            { what: 'Share the template', owner: '[P2]', due: '2099-01-31', time: null },
            { what: 'Book the room', owner: null, ownerName: 'Omar', due: '2020-01-01', time: null },
          ],
          ...over,
        },
      ],
    });
  const withNotes = async (w: World, meetingId: string, text = NOTES) => meetingAi.saveNotes(meetingId, { text }, w.orgId, as(w, 'secretary'));
  const draft = (w: World, meetingId: string, who = 'secretary') => meetingAi.draftMinutes(meetingId, { language: 'en' }, w.orgId, as(w, who));

  let a: World;
  let b: World;

  beforeAll(async () => {
    await prisma.onModuleInit();
    await lookupService.seedSystemData();
    const seats = await prisma.lookupValue.findMany({
      where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
      select: { id: true, key: true },
    });
    seat = Object.fromEntries(seats.map((s) => [s.key, s.id]));
    meetingType = (await prisma.lookupValue.findFirstOrThrow({ where: { organizationId: null, category: { key: 'meeting_type', organizationId: null } } })).id;
    a = await world();
    b = await world();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(() => {
    calls.length = 0;
    reply = () => answer();
    during = null;
  });

  describe('the gate', () => {
    it('whoever records the minutes drafts them in Minutes Draft; anyone else is MEETING_NOT_RECORDER', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      expect(await code(draft(a, m.id, 'member'))).toBe('MEETING_NOT_RECORDER');
      expect(calls).toHaveLength(0);
      const read = await draft(a, m.id);
      expect(read.minutes.may).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it('not in Minutes Draft: MEETING_AI_NOT_OFFERED, with the stage named, for the press and the notes', async () => {
      const m = await meetingAt(a, 'planned');
      const refused = (await outcome(meetingAi.saveNotes(m.id, { text: 'x' }, a.orgId, as(a, 'secretary')))) as { code: string; stageNameEn: string };
      expect(refused.code).toBe('MEETING_AI_NOT_OFFERED');
      expect(refused.stageNameEn).toBe('Planned');
      expect(await code(draft(a, m.id))).toBe('MEETING_AI_NOT_OFFERED');
      expect((await meetingAi.getAi(m.id, a.orgId, as(a, 'secretary'))).minutes.may).toBe(false);
    });

    it('M9: after Return for Correction (a round of 1 or more), Draft minutes and the notes are not offered', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      await prisma.meeting.update({ where: { id: m.id }, data: { reviewRound: 1 } });
      expect(await code(draft(a, m.id))).toBe('MEETING_AI_NOT_OFFERED');
      expect(await code(meetingAi.saveNotes(m.id, { text: 'more' }, a.orgId, as(a, 'secretary')))).toBe('MEETING_AI_NOT_OFFERED');
      expect((await meetingAi.getAi(m.id, a.orgId, as(a, 'secretary'))).minutes.may).toBe(false);
      expect(calls).toHaveLength(0);
    });

    itEnforcesTenantIsolation("Meetings AI refuses another organisation's meeting with the identical 404, and writes nothing", async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      await draft(a, m.id);
      const sid = (await prisma.meetingAiSuggestion.findFirstOrThrow({ where: { meetingId: m.id } })).id;
      const other = as(b, 'secretary');
      for (const call of [
        () => meetingAi.getAi(m.id, b.orgId, other),
        () => meetingAi.saveNotes(m.id, { text: 'x' }, b.orgId, other),
        () => meetingAi.draftMinutes(m.id, { language: 'en' }, b.orgId, other),
        () => meetingAi.accept(m.id, sid, {}, b.orgId, other),
        () => meetingAi.discard(m.id, sid, b.orgId, other),
      ]) {
        const refused = await outcome(call());
        expect(refused).toEqual(await outcome(meetingAi.getAi('no-such-meeting', b.orgId, other)));
        expect((refused as { statusCode: number }).statusCode).toBe(404);
      }
      expect(await prisma.meetingAiSuggestion.count({ where: { meetingId: m.id } })).toBe(4);
      expect(calls).toHaveLength(1);
    });
  });

  describe('the rough notes', () => {
    it('are read by their writer only (M3): another recorder of the same meeting never sees them', async () => {
      const w = await world();
      // The Chair records minutes too, on this committee.
      await prisma.committeeSeatAction.create({ data: { organizationId: w.orgId, committeeId: w.committeeId, roleValueId: seat['chairman']!, actionKey: 'record_minutes' } });
      const m = await meetingAt(w, 'minutes_draft');
      await withNotes(w, m.id, 'the Secretary only');
      expect((await meetingAi.getAi(m.id, w.orgId, as(w, 'secretary'))).notes).toBe('the Secretary only');
      expect((await meetingAi.getAi(m.id, w.orgId, as(w, 'chair'))).notes).toBeNull();
    });

    it('a viewer who does not record the minutes gets every flag false and no content, and no error', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      await draft(a, m.id);
      const read = await meetingAi.getAi(m.id, a.orgId, as(a, 'member'));
      expect(read.minutes.may).toBe(false);
      expect(read.notes).toBeNull();
      expect(read.suggestions).toEqual({ minutes: [], actions: [] });
      expect(read.undecided).toBe(0);
    });

    it('no notes: MEETING_AI_NO_NOTES before any call', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      expect(await code(draft(a, m.id))).toBe('MEETING_AI_NO_NOTES');
      expect(calls).toHaveLength(0);
    });
  });

  describe('a draft', () => {
    it("sends no name or email as written, and maps each owner from its label (M7: never an outside guest)", async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      const read = await draft(a, m.id);
      const sent = calls[0]!;
      for (const name of ['Faisal', 'Qahtani', 'Lina', 'Mansour', 'faisal@hospital.test']) {
        expect(sent.prompt).not.toContain(name);
        expect(sent.description).not.toContain(name);
      }
      expect(sent.description).not.toContain('compliance');

      const [minutesSuggestion] = read.suggestions.minutes;
      expect(minutesSuggestion!.discussion).toBe(`Faisal Qahtani reported 92% compliance; ${OUTSIDE} presented the audit.`);
      expect(read.suggestions.actions.map((x) => [x.title, x.owner?.userId ?? null, x.ownerReason, x.dueReason])).toEqual([
        ['Send the figures', a.people['member'], null, null],
        ['Share the template', null, { code: 'OUTSIDE_GUEST', name: OUTSIDE }, null],
        ['Book the room', null, { code: 'NO_MATCH', name: 'Omar' }, { code: 'DATE_PASSED', day: '2020-01-01' }],
      ]);
      expect(read.undecided).toBe(4);
    });

    it('an answer where every item is "nothing" is MEETING_AI_NOTHING_SUGGESTED, and saves nothing', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      reply = () => JSON.stringify({ items: [{ item: 'A1', nothing: true }] });
      expect(await code(draft(a, m.id))).toBe('MEETING_AI_NOTHING_SUGGESTED');
      expect(await prisma.meetingAiSuggestion.count({ where: { meetingId: m.id } })).toBe(0);
    });

    it('one run at a time: a second press while one runs is MEETING_AI_IN_PROGRESS before any call', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      await prisma.meetingAiRun.create({ data: { organizationId: a.orgId, meetingId: m.id, kind: 'MINUTES', claimedById: a.people['chair']!, claimedAt: new Date() } });
      expect(await code(draft(a, m.id))).toBe('MEETING_AI_IN_PROGRESS');
      expect(calls).toHaveLength(0);
      expect((await meetingAi.getAi(m.id, a.orgId, as(a, 'secretary'))).minutes.running).toBe(true);
    });

    it('a failed call releases the claim, so the next press runs', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      reply = () => 'not json';
      expect(await code(draft(a, m.id))).toBe('AI_PROVIDER_FAILED');
      expect((await prisma.meetingAiRun.findFirstOrThrow({ where: { meetingId: m.id } })).claimedAt).toBeNull();
      reply = () => answer();
      await draft(a, m.id);
      expect(calls).toHaveLength(2);
    });

    it('a meeting that moved on during the call saves nothing (MEETING_CHANGED); the call was made, so it is charged', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      during = async () => {
        await prisma.meeting.update({ where: { id: m.id }, data: { reviewRound: 1 } });
      };
      expect(await code(draft(a, m.id))).toBe('MEETING_CHANGED');
      expect(calls).toHaveLength(1);
      expect(await prisma.meetingAiSuggestion.count({ where: { meetingId: m.id } })).toBe(0);
    });
  });

  describe('accept and discard', () => {
    it('Accept writes the discussion and decisions as ONE minutes write, with aiDraft on its audit row, once', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await minutes.setItemMinutes(m.id, m.itemId, { discussion: 'typed by hand' }, a.orgId, as(a, 'secretary'));
      await minutes.addDecision(m.id, m.itemId, { text: 'typed decision' }, a.orgId, as(a, 'secretary'));
      await withNotes(a, m.id);
      const read = await draft(a, m.id);
      const s = read.suggestions.minutes[0]!;
      expect(s.replaces).toEqual({ discussion: true, decisions: true });
      const before = await prisma.auditLog.count({ where: { objectId: m.id } });

      const accepted = await meetingAi.accept(m.id, s.id, {}, a.orgId, as(a, 'secretary'));
      const item = accepted.minutes.items[0]!;
      expect(item.discussion).toBe(s.discussion);
      expect(item.decisions.map((d) => [d.text, d.votes])).toEqual([['Adopt the audit tool.', { for: 5, against: 1, abstain: 0 }]]);
      const rows = await prisma.auditLog.findMany({ where: { objectId: m.id }, orderBy: { createdAt: 'desc' }, take: 2 });
      expect(await prisma.auditLog.count({ where: { objectId: m.id } })).toBe(before + 1);
      expect((rows[0]!.after as { minutes: { aiDraft: unknown } }).minutes.aiDraft).toEqual({ kind: 'ITEM_MINUTES', interactionId: 'log-1' });
      expect(accepted.ai.undecided).toBe(3);
      expect(await code(meetingAi.accept(m.id, s.id, {}, a.orgId, as(a, 'secretary')))).toBe('MEETING_AI_SUGGESTION_GONE');
    });

    it('M6: Accept keeps votes above the members present; the ordinary write and Distribute still refuse them', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      const read = await draft(a, m.id);
      // Attendance unrecorded: nobody present, so 5 + 1 + 0 is above it.
      expect(read.suggestions.minutes[0]!.decisions[0]!.abovePresent).toBe(true);
      await meetingAi.accept(m.id, read.suggestions.minutes[0]!.id, {}, a.orgId, as(a, 'secretary'));
      expect(await prisma.meetingDecision.count({ where: { agendaItemId: m.itemId, votesFor: 5 } })).toBe(1);

      expect(await code(minutes.addDecision(m.id, m.itemId, { text: 'x', votesFor: 5, votesAgainst: 1, votesAbstain: 0 }, a.orgId, as(a, 'secretary')))).toBe(
        'MEETING_VOTES_EXCEED_PRESENT',
      );
      const rows = await prisma.meetingAttendee.findMany({ where: { meetingId: m.id }, select: { id: true } });
      await minutes.recordAttendance(m.id, { rows: rows.map((r) => ({ attendeeId: r.id, attendance: 'PRESENT' as const })) }, a.orgId, as(a, 'secretary'));
      expect(await code(review.distribute(m.id, {}, a.orgId, as(a, 'secretary')))).toBe('MEETING_VOTES_EXCEED_PRESENT');
    });

    it('an action is accepted only with an owner who is a person and a due date in the future; Edit supplies them', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      const read = await draft(a, m.id);
      const [send, share, book] = read.suggestions.actions;
      expect(await code(meetingAi.accept(m.id, share!.id, {}, a.orgId, as(a, 'secretary')))).toBe('MEETING_PERSON_NOT_FOUND');
      expect(await code(meetingAi.accept(m.id, book!.id, { ownerUserId: a.people['chair']! }, a.orgId, as(a, 'secretary')))).toBe('MEETING_ACTION_DUE_IN_PAST');

      const done = await meetingAi.accept(m.id, send!.id, {}, a.orgId, as(a, 'secretary'));
      expect(done.minutes.items[0]!.actionItems.map((x) => [x.title, x.owner?.id, x.task])).toEqual([['Send the figures', a.people['member'], null]]);
      const due = new Date(Date.now() + 5 * DAY).toISOString();
      const edited = await meetingAi.accept(m.id, share!.id, { ownerUserId: a.people['chair']!, title: 'Share the audit template' }, a.orgId, as(a, 'secretary'));
      expect(edited.minutes.items[0]!.actionItems.map((x) => x.title)).toContain('Share the audit template');
      await meetingAi.accept(m.id, book!.id, { ownerUserId: a.people['chair']!, dueAt: due }, a.orgId, as(a, 'secretary'));
      expect(await prisma.meetingActionItem.count({ where: { meetingId: m.id } })).toBe(3);
    });

    it('Discard removes one suggestion; a second discard is MEETING_AI_SUGGESTION_GONE', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      const read = await draft(a, m.id);
      const after = await meetingAi.discard(m.id, read.suggestions.actions[0]!.id, a.orgId, as(a, 'secretary'));
      expect(after.undecided).toBe(3);
      expect(await code(meetingAi.discard(m.id, read.suggestions.actions[0]!.id, a.orgId, as(a, 'secretary')))).toBe('MEETING_AI_SUGGESTION_GONE');
    });
  });

  describe('Draft again (M8)', () => {
    it('an item with accepted minutes and undecided actions is sent for its actions only, and gets only actions back', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      const first = await draft(a, m.id);
      await meetingAi.accept(m.id, first.suggestions.minutes[0]!.id, {}, a.orgId, as(a, 'secretary'));

      reply = () => JSON.stringify({ items: [{ item: 'A1', discussion: 'IGNORED', decisions: [{ text: 'IGNORED' }], actions: [{ what: 'Chase the lab', owner: '[P1]', due: '2099-02-01' }] }] });
      const second = await draft(a, m.id);
      expect(calls[1]!.prompt).toContain('A1 (actions only)');
      expect(second.suggestions.minutes).toEqual([]);
      expect(second.suggestions.actions.map((x) => x.title)).toEqual(['Chase the lab']);
      // The accepted minutes are untouched.
      expect((await prisma.agendaItem.findFirstOrThrow({ where: { id: m.itemId } })).discussion).not.toBe('IGNORED');
    });

    it('nothing left to draft is MEETING_AI_NOTHING_TO_DRAFT before any call', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      const first = await draft(a, m.id);
      await meetingAi.accept(m.id, first.suggestions.minutes[0]!.id, {}, a.orgId, as(a, 'secretary'));
      for (const s of first.suggestions.actions) await meetingAi.discard(m.id, s.id, a.orgId, as(a, 'secretary'));
      // PR 2 — the read says so first, from the same rule, so the screen shows no trigger.
      expect((await meetingAi.getAi(m.id, a.orgId, as(a, 'secretary'))).leftToDraft).toBe(0);
      expect(await code(draft(a, m.id))).toBe('MEETING_AI_NOTHING_TO_DRAFT');
      expect(calls).toHaveLength(1);
    });

    it("the read's leftToDraft counts what a press would draft: every item before the first run, then M8's", async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      expect((await meetingAi.getAi(m.id, a.orgId, as(a, 'secretary'))).leftToDraft).toBe(1);
      const first = await draft(a, m.id);
      // Its minutes and actions undecided: drafted again.
      expect(first.leftToDraft).toBe(1);
      await meetingAi.accept(m.id, first.suggestions.minutes[0]!.id, {}, a.orgId, as(a, 'secretary'));
      // Minutes accepted, actions undecided: still sent, for its actions.
      expect((await meetingAi.getAi(m.id, a.orgId, as(a, 'secretary'))).leftToDraft).toBe(1);
    });
  });

  describe('when the stored rows end', () => {
    it('Distribute discards the undecided suggestions and the notes, and its audit row says how many', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      reply = () => answer({ decisions: [{ text: 'Adopt.', votes: null }] });
      const read = await draft(a, m.id);
      expect(read.undecided).toBe(4);
      const rows = await prisma.meetingAttendee.findMany({ where: { meetingId: m.id }, select: { id: true } });
      await minutes.recordAttendance(m.id, { rows: rows.map((r) => ({ attendeeId: r.id, attendance: 'PRESENT' as const })) }, a.orgId, as(a, 'secretary'));
      expect((await minutes.getMinutes(m.id, a.orgId, as(a, 'secretary'))).distribute!.aiUndecided).toBe(4);

      await review.distribute(m.id, {}, a.orgId, as(a, 'secretary'));
      expect(await prisma.meetingAiSuggestion.count({ where: { meetingId: m.id } })).toBe(0);
      expect(await prisma.meetingAiNotes.count({ where: { meetingId: m.id } })).toBe(0);
      const row = (await prisma.auditLog.findMany({ where: { objectId: m.id }, orderBy: { createdAt: 'desc' } })).find(
        (r) => (r.after as { minutes?: { distributed?: boolean } } | null)?.minutes?.distributed,
      );
      expect((row!.after as { minutes: { aiDiscarded: number } }).minutes.aiDiscarded).toBe(4);
    });

    it('entering a cancelled stage deletes every suggestion and every rough note', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await withNotes(a, m.id);
      await draft(a, m.id);
      const ctx = {
        objectType: 'MEETING' as const,
        objectId: m.id,
        organizationId: a.orgId,
        actorId: a.people['chair']!,
        kind: 'EXIT' as const,
        fromStageFlags: [],
        toStageFlags: [STAGE_FLAG.MEETING_CANCELLED],
        comment: 'Postponed',
      };
      const prepared = await prepareTransitionEffects({ prisma, notifications, calendar, tasks }, ctx);
      await prisma.$transaction((tx) => applyTransitionEffects(tx as never, prepared));
      expect(await prisma.meetingAiSuggestion.count({ where: { meetingId: m.id } })).toBe(0);
      expect(await prisma.meetingAiNotes.count({ where: { meetingId: m.id } })).toBe(0);
    });
  });
});
