/**
 * ACC-280 — New task's record picker (GET /tasks/record-choices), New task's create
 * types, and the closed-record rule POST /tasks shares with the picker, against a
 * REAL Postgres (npm run test:db).
 *
 * One organisation's committees, one of each kind decision 7 names:
 *   Alpha     active, no workflow instance                → takes tasks
 *   Bravo     in a stage with no flags (Formation)         → takes tasks
 *   Charlie   DISSOLVING, not final (Dissolution Pending)  → takes tasks
 *   Delta     DISSOLVING and final (Dissolved)             → closed
 *   Echo      inactive                                     → closed
 *   Foxtrot   an OLDER instance Dissolved, the NEWEST in Formation → takes tasks
 *   Golf      final but not DISSOLVING (a Rejected-like stage)     → takes tasks
 * and another organisation's committee, which never appears.
 *
 * The rule is read from the stage's flags and isFinal, never its name or key: every
 * stage here is named "Stage" and has no key.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database, and
 * refuses any database not on this machine.
 */
import { randomUUID } from 'crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { STAGE_FLAG } from '../workflow/record-registry';
import { CreateTaskDto } from './dto/create-task.dto';
import { RecordChoicesQueryDto } from './dto/record-choices-query.dto';
import { TaskService, TaskViewer } from './task.service';
import { createTypes, recordChoices, TASK_RECORD_CLOSED } from './task-record-choices';
import { AssignmentViewer, TaskAssignmentService } from './task-assignment.service';
import { TaskAuthorityService } from './task-authority.service';
import { LookupService } from '../lookup/lookup.service';
import { AiService } from '../ai/ai.service';
import { TaskDraftService } from '../ai-task-draft/task-draft.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const KEY = 'committees:create_tasks';
const VIEW = 'committees:view';
const OPEN_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Foxtrot', 'Golf'];

describe('New task picks its record: the choices, the create types and the closed rule, on a real database (ACC-280)', () => {
  const prisma = new PrismaService();
  const create = jest.fn();
  const createForViewer = TaskService.prototype.createForViewer.bind({
    objectVisibility: new ObjectVisibilityService(prisma),
    prisma,
    create,
  }) as (dto: CreateTaskDto, organizationId: string, viewer: TaskViewer) => Promise<unknown>;

  let A = '';
  let B = '';
  const ids: Record<string, string> = {};
  let otherOrgCommittee = '';
  const people = { holder: '', viewerOnly: '', keyedMember: '', loneMember: '', stranger: '', member: '', dissolvedOnly: '' };

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc280c-${randomUUID().slice(0, 8)}`;
    A = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    B = (await prisma.organization.create({ data: { name: `${slug}-b`, slug: `${slug}-b`, country: 'SA' } })).id;
    const unitA = (await prisma.orgUnit.create({ data: { organizationId: A, nameEn: 'Quality', code: `QA${slug.slice(-4)}` } })).id;
    const unitB = (await prisma.orgUnit.create({ data: { organizationId: B, nameEn: 'Quality', code: `QB${slug.slice(-4)}` } })).id;

    // Stages are told apart by their flags and isFinal alone: one name, no key.
    const template = (await prisma.workflowTemplate.create({ data: { organizationId: A, nameEn: 'Committee', objectType: 'COMMITTEE' } })).id;
    const stage = async (order: number, flags: string[], isFinal: boolean) =>
      (await prisma.workflowStage.create({ data: { workflowTemplateId: template, nameEn: 'Stage', order, flags, isFinal } })).id;
    const formation = await stage(1, [], false);
    const pending = await stage(2, [STAGE_FLAG.DISSOLVING], false);
    const dissolved = await stage(3, [STAGE_FLAG.DISSOLVING], true);
    const rejected = await stage(4, [], true);

    const committee = async (organizationId: string, orgUnitId: string, nameEn: string, nameAr: string | null, isActive = true) =>
      (await prisma.committee.create({ data: { organizationId, nameEn, nameAr, typeValueId: 'type', orgUnitId, isActive } })).id;
    const instance = (objectId: string, currentStageId: string, createdAt: Date) =>
      prisma.workflowInstance.create({
        data: { organizationId: A, workflowTemplateId: template, objectType: 'COMMITTEE', objectId, currentStageId, createdAt },
      });

    ids['Alpha'] = await committee(A, unitA, 'Alpha', null);
    ids['Bravo'] = await committee(A, unitA, 'Bravo', 'ب');
    await instance(ids['Bravo'], formation, new Date('2026-01-01T00:00:00Z'));
    ids['Charlie'] = await committee(A, unitA, 'Charlie', 'ج');
    await instance(ids['Charlie'], pending, new Date('2026-01-01T00:00:00Z'));
    ids['Delta'] = await committee(A, unitA, 'Delta', 'د');
    await instance(ids['Delta'], dissolved, new Date('2026-01-01T00:00:00Z'));
    ids['Echo'] = await committee(A, unitA, 'Echo', 'ه', false);
    ids['Foxtrot'] = await committee(A, unitA, 'Foxtrot', 'و');
    await instance(ids['Foxtrot'], dissolved, new Date('2025-01-01T00:00:00Z'));
    await instance(ids['Foxtrot'], formation, new Date('2026-01-01T00:00:00Z'));
    ids['Golf'] = await committee(A, unitA, 'Golf', 'ز');
    await instance(ids['Golf'], rejected, new Date('2026-01-01T00:00:00Z'));
    otherOrgCommittee = await committee(B, unitB, 'Alpha', null);

    for (const name of Object.keys(people) as (keyof typeof people)[]) {
      people[name] = (await prisma.user.create({ data: { organizationId: A, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE' } })).id;
    }
    const seat = (committeeId: string, userId: string) =>
      prisma.committeeMember.create({ data: { organizationId: A, committeeId, userId, roleValueId: 'seat-member' } });
    // keyedMember sits on Alpha (open), Delta (dissolved) and Echo (inactive);
    // loneMember only on Echo; member (no key) on Alpha.
    await seat(ids['Alpha'], people.keyedMember);
    await seat(ids['Delta'], people.keyedMember);
    await seat(ids['Echo'], people.keyedMember);
    await seat(ids['Echo'], people.loneMember);
    // dissolvedOnly (with the key) sits only on Delta, a committee that takes no tasks.
    await seat(ids['Delta'], people.dissolvedOnly);
    await seat(ids['Alpha'], people.member);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: 'new-task' });
  });

  const viewer = (who: keyof typeof people, permissions: string[]): TaskViewer => ({ id: people[who], permissions });
  const holder = () => viewer('holder', [KEY, VIEW]);
  const query = (extra: Partial<RecordChoicesQueryDto> = {}): RecordChoicesQueryDto =>
    ({ type: 'COMMITTEE', take: 50, ...extra }) as RecordChoicesQueryDto;
  const namesOf = async (v: TaskViewer, extra: Partial<RecordChoicesQueryDto> = {}) =>
    (await recordChoices(prisma, query(extra), A, v)).items.map((i) => i.nameEn);

  describe('the choices', () => {
    it('a key holder with committees:view: every committee that takes tasks, by name, and Dissolution Pending stays in', async () => {
      const page = await recordChoices(prisma, query(), A, holder());
      expect(page.items.map((i) => i.nameEn)).toEqual(OPEN_NAMES);
      expect(page.total).toBe(5);
      expect(page.matching).toBe(5);
    });

    it('leaves out a dissolved committee (DISSOLVING and final) and an inactive one', async () => {
      const names = await namesOf(holder());
      expect(names).not.toContain('Delta');
      expect(names).not.toContain('Echo');
    });

    it('reads the NEWEST instance: a committee re-formed after an old Dissolved instance is listed', async () => {
      expect(await namesOf(holder())).toContain('Foxtrot');
    });

    it('a final stage that is not DISSOLVING does not close the committee', async () => {
      expect(await namesOf(holder())).toContain('Golf');
    });

    it('searches either name, case-insensitively, with LIKE wildcards taken literally', async () => {
      const page = await recordChoices(prisma, query({ q: '  cHAr ' }), A, holder());
      expect(page.items.map((i) => i.nameEn)).toEqual(['Charlie']);
      expect(page).toMatchObject({ total: 5, matching: 1 });
      expect(await namesOf(holder(), { q: 'ز' })).toEqual(['Golf']);
      expect((await recordChoices(prisma, query({ q: '%' }), A, holder())).matching).toBe(0);
    });

    it('pages without repeating or skipping, and sorts by the Arabic name in Arabic (an unnamed one last)', async () => {
      const pages = [0, 2, 4].map((skip) => namesOf(holder(), { take: 2, skip }));
      expect((await Promise.all(pages)).flat()).toEqual(OPEN_NAMES);
      expect(await namesOf(holder(), { lang: 'ar' })).toEqual(['Bravo', 'Charlie', 'Golf', 'Foxtrot', 'Alpha']);
    });

    it('committees:view WITHOUT the key: no choices, and nothing to create on', async () => {
      const v = viewer('viewerOnly', [VIEW]);
      expect(await recordChoices(prisma, query(), A, v)).toEqual({ items: [], total: 0, matching: 0 });
      expect(await createTypes(prisma, v, A)).toEqual([]);
    });

    it('a member WITH the key, without committees:view: only their own committees that take tasks (decision 2)', async () => {
      const v = viewer('keyedMember', [KEY]);
      expect(await namesOf(v)).toEqual(['Alpha']);
      expect(await createTypes(prisma, v, A)).toEqual(['COMMITTEE']);
    });

    it('a member WITHOUT the key: no choices, and nothing to create on', async () => {
      const v = viewer('member', []);
      expect(await recordChoices(prisma, query(), A, v)).toEqual({ items: [], total: 0, matching: 0 });
      expect(await createTypes(prisma, v, A)).toEqual([]);
    });

    it('the key with no membership, or only of an inactive committee: COMMITTEE is not a create type, and no choices', async () => {
      for (const who of ['stranger', 'loneMember'] as const) {
        const v = viewer(who, [KEY]);
        expect(await createTypes(prisma, v, A)).toEqual([]);
        expect((await recordChoices(prisma, query(), A, v)).items).toEqual([]);
      }
      expect(await createTypes(prisma, holder(), A)).toEqual(['COMMITTEE']);
    });

    it('a type with no choices entry has none', async () => {
      expect(await recordChoices(prisma, query({ type: 'MEETING' }), A, viewer('holder', [KEY, VIEW, 'meetings:view']))).toEqual({
        items: [],
        total: 0,
        matching: 0,
      });
    });

    itEnforcesTenantIsolation('GET /tasks/record-choices lists only the caller organisation\'s records', async () => {
      const page = await recordChoices(prisma, query({ q: 'Alpha' }), A, holder());
      expect(page.items.map((i) => i.id)).toEqual([ids['Alpha']]);
      expect(page.items.map((i) => i.id)).not.toContain(otherOrgCommittee);
      expect((await recordChoices(prisma, query({ q: 'Alpha' }), B, holder())).items.map((i) => i.id)).toEqual([otherOrgCommittee]);
    });
  });

  // ACC-280 — "may create tasks at all" is create.types' own rule (mayCreateTasks()),
  // for New task's reads that name no record: the assignee picker, the SLA preview and
  // Draft with AI's availability. The key alone is not enough: the type must be open
  // to the caller, as a viewer or as an active member of a committee that takes tasks.
  describe("New task's own reads follow create.types", () => {
    const assignment = new TaskAssignmentService(prisma, {} as TaskAuthorityService, {} as LookupService);
    const slaPreview = TaskService.prototype.slaPreview.bind({
      prisma,
      sla: { preview: () => Promise.resolve({}) },
    }) as (organizationId: string, viewer: TaskViewer) => Promise<unknown>;
    const run = jest.fn(() => Promise.reject(new Error('the AI must not be called by this spec')));
    const drafts = new TaskDraftService(prisma, { run } as unknown as AiService, new ObjectVisibilityService(prisma));
    const REFUSAL = `403 Required permission: ${KEY}`;

    /** Each read's answer: 'OK', or the refusal's status and message. */
    const reads = async (v: TaskViewer): Promise<string[]> => {
      const answer = (p: Promise<unknown>) =>
        p.then(
          () => 'OK',
          (e: unknown) => {
            if (e instanceof ForbiddenException) return `403 ${e.message}`;
            throw e;
          },
        );
      return Promise.all([
        answer(assignment.listUnits(v as AssignmentViewer, A)),
        answer(slaPreview(A, v)),
        answer(drafts.availability(A, v)),
      ]);
    };

    it('a key holder who is neither a viewer nor a member: the same 403 as before, from all three', async () => {
      expect(await reads(viewer('stranger', [KEY]))).toEqual([REFUSAL, REFUSAL, REFUSAL]);
    });

    it('a key holder whose only committees take no tasks (dissolved, inactive): the same 403', async () => {
      expect(await reads(viewer('dissolvedOnly', [KEY]))).toEqual([REFUSAL, REFUSAL, REFUSAL]);
      expect(await reads(viewer('loneMember', [KEY]))).toEqual([REFUSAL, REFUSAL, REFUSAL]);
      expect(await createTypes(prisma, viewer('dissolvedOnly', [KEY]), A)).toEqual([]);
    });

    it('a key holder who is a member of a committee that takes tasks, and a viewer with the key: all three open', async () => {
      expect(await reads(viewer('keyedMember', [KEY]))).toEqual(['OK', 'OK', 'OK']);
      expect(await reads(holder())).toEqual(['OK', 'OK', 'OK']);
    });

    it('a viewer or a member without the key: the same 403', async () => {
      expect(await reads(viewer('viewerOnly', [VIEW]))).toEqual([REFUSAL, REFUSAL, REFUSAL]);
      expect(await reads(viewer('member', []))).toEqual([REFUSAL, REFUSAL, REFUSAL]);
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('POST /tasks asks the same rule (decision 7)', () => {
    const dto = (name: string) => ({ title: 'Collect the minutes', sourceType: 'COMMITTEE', sourceId: ids[name] }) as CreateTaskDto;
    /** 'CREATED', or the refusal's status and code (or message). */
    const outcome = (p: Promise<unknown>): Promise<string> =>
      p.then(
        () => 'CREATED',
        (e: unknown) => {
          if (e instanceof ConflictException) return `409 ${(e.getResponse() as { code: string }).code}`;
          if (e instanceof ForbiddenException || e instanceof NotFoundException) {
            return `${e.getStatus()} ${(e.getResponse() as { message: string }).message}`;
          }
          throw e;
        },
      );

    it('a dissolved committee and an inactive one: 409 TASK_RECORD_CLOSED, and no task', async () => {
      expect(await outcome(createForViewer(dto('Delta'), A, holder()))).toBe(`409 ${TASK_RECORD_CLOSED}`);
      expect(await outcome(createForViewer(dto('Echo'), A, holder()))).toBe(`409 ${TASK_RECORD_CLOSED}`);
      expect(create).not.toHaveBeenCalled();
    });

    it('the refusal names the code, in the reference refusals\' shape', async () => {
      const error = await createForViewer(dto('Delta'), A, holder()).catch((e: unknown) => e);
      expect((error as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        code: TASK_RECORD_CLOSED,
        message: 'This committee is dissolved or inactive, so it takes no new tasks.',
        error: 'Conflict',
      });
    });

    it('every committee the picker lists is accepted, Dissolution Pending included', async () => {
      for (const name of OPEN_NAMES) {
        expect(await outcome(createForViewer(dto(name), A, holder()))).toBe('CREATED');
      }
      expect(create).toHaveBeenCalledTimes(OPEN_NAMES.length);
    });

    it('a member with the key: their dissolved committee is refused as closed, after the record check', async () => {
      const v = viewer('keyedMember', [KEY]);
      expect(await outcome(createForViewer(dto('Alpha'), A, v))).toBe('CREATED');
      expect(await outcome(createForViewer(dto('Delta'), A, v))).toBe(`409 ${TASK_RECORD_CLOSED}`);
      // An inactive committee admits no member (ACC-281), so the record check refuses first.
      expect(await outcome(createForViewer(dto('Echo'), A, v))).toBe(`403 Required permission: ${VIEW}`);
    });

    itEnforcesTenantIsolation('POST /tasks on another organisation\'s committee is the invented id\'s 404, not a closed refusal', async () => {
      const other = { title: 'Collect the minutes', sourceType: 'COMMITTEE', sourceId: otherOrgCommittee } as CreateTaskDto;
      const invented = { title: 'Collect the minutes', sourceType: 'COMMITTEE', sourceId: randomUUID() } as CreateTaskDto;
      const a = await outcome(createForViewer(other, A, holder()));
      expect(a).toMatch(/^404 /);
      expect(a).toBe(await outcome(createForViewer(invented, A, holder())));
      expect(create).not.toHaveBeenCalled();
    });
  });
});
