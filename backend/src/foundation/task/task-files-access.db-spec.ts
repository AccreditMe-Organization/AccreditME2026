/**
 * ACC-231 — a task's files follow the task page's rule, against a REAL
 * Postgres (npm run test:db). Plan: backend/Plans/step-231-task-files-access.md §5.
 *
 * Every viewer kind, on ALL FIVE routes that reach a task's files: the
 * evidence list, download, the in-app viewer, and reading and making the AI
 * summary. An admitted viewer gets 200 from each; a refused one gets the
 * identical 404 from each — the same body for a real file, an invented one and
 * another organisation's.
 *
 * The admission rule, mayManage() and the acting-for-the-creator rule are the
 * real ones, on real rows; storage and the AI are stubs, reached only after
 * admission.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { StoredFileService } from '../file-storage/stored-file.service';
import { AiFileSummaryService } from '../ai-file-summary/ai-file-summary.service';
import { TaskService, TaskViewer } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskAdmissionService } from './task-admission.service';
import { TaskEvidenceService } from './task-evidence.service';
import { TENANT_ISOLATION_GATE_STRING } from '../../common/testing/tenant-isolation';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);
const HOUR = 3_600_000;

describe('A task\'s files follow the task page\'s rule, on a real database (ACC-231)', () => {
  const prisma = new PrismaService();
  const authority = new TaskAuthorityService(prisma);
  // The real mayManage on the real authority — the one rule the admission calls.
  const tasks = { mayManage: TaskService.prototype.mayManage.bind({ prisma, authority }) } as unknown as TaskService;
  const visibility = new ObjectVisibilityService(prisma);
  const admission = new TaskAdmissionService(prisma, visibility, tasks, authority);
  const storedFiles = {
    openDownload: async () => ({ url: 'signed-download', viaApi: false, expiresAt: 'later' }),
    openView: async () => ({ url: 'signed-view', viaApi: false, expiresAt: 'later' }),
    summary: (f: { id: string; originalName: string; mimeType: string; sizeBytes: number; uploadedAt: Date }) => ({
      id: f.id,
      name: f.originalName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      uploadedAt: f.uploadedAt,
    }),
  } as unknown as StoredFileService;
  const summaries = {
    read: async () => ({ available: true, inProgress: false, summary: null }),
    make: async () => ({ available: true, inProgress: false, summary: null }),
  } as unknown as AiFileSummaryService;
  const evidence = new TaskEvidenceService(prisma, tasks, storedFiles, admission, new AuditLogService(prisma), summaries);

  type Five = Record<'list' | 'download' | 'view' | 'readSummary' | 'makeSummary', string>;

  /** What each of the five routes answers: 'OK', or the 404's body as JSON. */
  async function five(taskId: string, fileId: string, organizationId: string, viewer: TaskViewer): Promise<Five> {
    const outcome = (p: Promise<unknown>) =>
      p.then(
        () => 'OK',
        (e: unknown) => (e instanceof NotFoundException ? `404 ${body(e.getResponse())}` : `ERROR ${String(e)}`),
      );
    return {
      list: await outcome(evidence.list(taskId, organizationId, viewer)),
      download: await outcome(evidence.download(taskId, fileId, organizationId, viewer)),
      view: await outcome(evidence.openView(taskId, fileId, organizationId, viewer)),
      readSummary: await outcome(evidence.getSummary(taskId, fileId, organizationId, viewer, 'en')),
      makeSummary: await outcome(evidence.makeSummary(taskId, fileId, organizationId, viewer, 'en')),
    };
  }

  /** A 404's body, keys sorted, so two bodies compare by content alone. */
  const body = (r: unknown) => JSON.stringify(r, Object.keys(r as object).sort());
  const NOT_FOUND = `404 ${body({ message: 'Task not found', error: 'Not Found', statusCode: 404 })}`;
  const allOk: Five = { list: 'OK', download: 'OK', view: 'OK', readSummary: 'OK', makeSummary: 'OK' };
  const all404: Five = { list: NOT_FOUND, download: NOT_FOUND, view: NOT_FOUND, readSummary: NOT_FOUND, makeSummary: NOT_FOUND };

  let A = '';
  let B = '';
  const u: Record<string, string> = {};
  // Tasks and their file evidence ids.
  const t: Record<string, { id: string; file: string }> = {};
  let foreign = { id: '', file: '' };

  async function org(slug: string): Promise<string> {
    return (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
  }

  async function taskWithFiles(
    organizationId: string,
    data: Record<string, unknown>,
    assignees: { userId: string; removedAt?: Date | null; pickedAt?: Date | null }[] = [],
  ): Promise<{ id: string; file: string }> {
    const task = await prisma.task.create({ data: { organizationId, title: 'Bring the audit pack', ...data } as never });
    for (const a of assignees) {
      await prisma.taskAssignee.create({ data: { taskId: task.id, assignedById: data['createdById'] as string, ...a } });
    }
    const uploader = (assignees[0]?.userId ?? data['createdById']) as string;
    const stored = await prisma.storedFile.create({
      data: {
        organizationId,
        provider: 'LOCAL_FILESYSTEM',
        storageKey: `${organizationId}/tasks/${task.id}/x-pack.pdf`,
        originalName: 'audit-pack.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 9,
        sha256: 'a'.repeat(64),
        ownerType: 'TASK',
        ownerId: task.id,
        uploadedById: uploader,
      },
    });
    const file = await prisma.taskEvidence.create({
      data: { organizationId, taskId: task.id, type: 'ATTACHMENT', storedFileId: stored.id, uploadedById: uploader },
    });
    await prisma.taskEvidence.create({
      data: { organizationId, taskId: task.id, type: 'LINK', url: 'https://example.test/pack', uploadedById: uploader },
    });
    return { id: task.id, file: file.id };
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const slug = `acc231-${randomUUID().slice(0, 8)}`;
    A = await org(slug);
    B = await org(`${slug}-b`);

    const unit = await prisma.orgUnit.create({ data: { organizationId: A, nameEn: 'Quality', code: `Q${slug.slice(-4)}` } });
    const head = await prisma.orgPosition.create({ data: { organizationId: A, nameEn: 'Head of Quality', grade: 1, isUnitHeadPosition: true } });
    const officer = await prisma.orgPosition.create({ data: { organizationId: A, nameEn: 'Quality Officer', grade: 3 } });
    const committee = await prisma.committee.create({ data: { organizationId: A, nameEn: 'Quality Committee', typeValueId: 'type', orgUnitId: unit.id } });

    const user = async (key: string, extra: Record<string, unknown> = {}, organizationId = A) =>
      (u[key] = (
        await prisma.user.create({
          data: { organizationId, email: `${slug}-${key}@example.test`, name: key, status: 'ACTIVE', ...extra },
        })
      ).id);

    const now = Date.now();
    await user('delegate');
    // The creator heads Quality, is out of office with a delegate, and an acting
    // head is appointed for the absence: both act for the creator.
    await user('creator', {
      positionId: head.id,
      primaryOrgUnitId: unit.id,
      actingUserId: u['delegate'],
      outOfOfficeFrom: new Date(now - 24 * HOUR),
      outOfOfficeTo: new Date(now + 24 * HOUR),
    });
    await user('actingHead');
    await prisma.orgUnitHeadAssignment.create({
      data: {
        organizationId: A,
        orgUnitId: unit.id,
        userId: u['actingHead']!,
        kind: 'ACTING',
        reason: 'ABSENCE',
        validFrom: new Date(now - 24 * HOUR),
        createdById: u['creator']!,
      },
    });
    await user('plainCreator'); // active, heads nothing, not away: nobody acts for them
    await user('leftCreator', { status: 'INACTIVE' });
    for (const k of ['assignee', 'former', 'reassigner', 'reader', 'fahad', 'tasksViewOnly', 'nobody', 'picker']) await user(k);
    await user('poolMember', { positionId: officer.id, primaryOrgUnitId: unit.id });
    await user('poolMemberReader', { positionId: officer.id, primaryOrgUnitId: unit.id });
    await user('outsider', {}, B);

    const onCommittee = { sourceType: 'COMMITTEE', sourceId: committee.id };
    t['main'] = await taskWithFiles(A, { ...onCommittee, createdById: u['creator'], status: 'IN_PROGRESS' }, [
      { userId: u['assignee']! },
      { userId: u['former']!, removedAt: new Date(now - HOUR) },
    ]);
    const pool = { assignedOrgUnitId: unit.id, assignedPositionId: officer.id };
    t['waiting'] = await taskWithFiles(A, { ...onCommittee, ...pool, createdById: u['plainCreator'], status: 'PENDING' });
    t['picked'] = await taskWithFiles(A, { ...onCommittee, ...pool, createdById: u['plainCreator'], status: 'IN_PROGRESS' }, [
      { userId: u['picker']!, pickedAt: new Date(now - HOUR) },
    ]);
    t['request'] = await taskWithFiles(A, { ...onCommittee, createdById: u['plainCreator'], status: 'IN_PROGRESS' }, [{ userId: u['assignee']! }]);
    await prisma.taskRequest.create({
      data: { organizationId: A, taskId: t['request'].id, type: 'EXTENSION', requestedById: u['assignee']!, reason: 'Two more days', requestedDueAt: new Date(now + 72 * HOUR) } as never,
    });
    t['noRequest'] = await taskWithFiles(A, { ...onCommittee, createdById: u['plainCreator'], status: 'IN_PROGRESS' }, [{ userId: u['assignee']! }]);
    t['orphaned'] = await taskWithFiles(A, { ...onCommittee, createdById: u['leftCreator'], status: 'IN_PROGRESS' }, [{ userId: u['assignee']! }]);

    const outsiderCommittee = await prisma.committee.create({
      data: {
        organizationId: B,
        nameEn: 'Other committee',
        typeValueId: 'type',
        orgUnitId: (await prisma.orgUnit.create({ data: { organizationId: B, nameEn: 'Root', code: `B${slug.slice(-4)}` } })).id,
      },
    });
    foreign = await taskWithFiles(B, { sourceType: 'COMMITTEE', sourceId: outsiderCommittee.id, createdById: u['outsider'], status: 'IN_PROGRESS' }, [
      { userId: u['outsider']! },
    ]);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const as = (key: string, permissions: string[] = []): TaskViewer => ({ id: u[key]!, permissions });
  const on = (task: string, viewer: TaskViewer) => five(t[task]!.id, t[task]!.file, A, viewer);

  describe('unchanged — admitted before, admitted now', () => {
    it('an active assignee, without tasks:view', async () => expect(await on('main', as('assignee'))).toEqual(allOk));
    it('a former assignee', async () => expect(await on('main', as('former'))).toEqual(allOk));
    it('the creator', async () => expect(await on('main', as('creator'))).toEqual(allOk));
    it('the creator\'s out-of-office delegate', async () => expect(await on('main', as('delegate'))).toEqual(allOk));
    it('the acting head appointed for the creator\'s absence', async () => expect(await on('main', as('actingHead'))).toEqual(allOk));
    it('a tasks:reassign holder, the creator no longer active', async () =>
      expect(await on('orphaned', as('reassigner', ['tasks:reassign']))).toEqual(allOk));
    it('tasks:view AND the record', async () => expect(await on('main', as('reader', ['tasks:view', 'committees:view']))).toEqual(allOk));
  });

  describe('gains — refused before, admitted now', () => {
    it('a pool member while the task waits, who cannot see the record', async () =>
      expect(await on('waiting', as('poolMember'))).toEqual(allOk));
    it('a tasks:reassign holder while a request is open, who cannot see the record', async () =>
      expect(await on('request', as('reassigner', ['tasks:reassign']))).toEqual(allOk));
  });

  describe('loses — admitted before, the identical 404 now', () => {
    it('Fahad: sees the record, without tasks:view, not otherwise related', async () =>
      expect(await on('main', as('fahad', ['committees:view']))).toEqual(all404));
    it('a pool member after someone picked it up, who sees the record without tasks:view', async () =>
      expect(await on('picked', as('poolMemberReader', ['committees:view']))).toEqual(all404));
    it('a tasks:reassign holder with no open request, creator active, record visible, no tasks:view', async () =>
      expect(await on('noRequest', as('reassigner', ['tasks:reassign', 'committees:view']))).toEqual(all404));
  });

  describe('unchanged — refused before, refused now', () => {
    it('tasks:view without the record', async () => expect(await on('main', as('tasksViewOnly', ['tasks:view']))).toEqual(all404));
    it('no relation and no permission', async () => expect(await on('main', as('nobody'))).toEqual(all404));
    it('a pool member, once the task is picked up and without the record', async () =>
      expect(await on('picked', as('poolMember'))).toEqual(all404));
  });

  it(`${TENANT_ISOLATION_GATE_STRING} — a task's files, for a refused viewer: a real file, an invented one and another organisation's`, async () => {
    const fahad = as('fahad', ['committees:view']);
    const realFile = await on('main', fahad);
    const inventedFile = await five(t['main']!.id, 'cmzzzzzzzzzzzzzzzzzzzzzzz', A, fahad);
    const inventedTask = await five('cmzzzzzzzzzzzzzzzzzzzzzzz', 'cmzzzzzzzzzzzzzzzzzzzzzzz', A, fahad);
    const otherOrganisation = await five(foreign.id, foreign.file, A, fahad);
    // Even the other organisation's own assignee, asking from here.
    const outsiderHere = await five(foreign.id, foreign.file, A, as('outsider'));

    for (const answer of [realFile, inventedFile, inventedTask, otherOrganisation, outsiderHere]) expect(answer).toEqual(all404);
    // …and the other organisation's assignee is admitted in their own organisation.
    expect(await five(foreign.id, foreign.file, B, as('outsider'))).toEqual(allOk);
  });

  it('an ADMITTED viewer asking for a file that does not exist gets "Evidence not found" — never a hint to anyone refused', async () => {
    const answer = await five(t['main']!.id, 'cmzzzzzzzzzzzzzzzzzzzzzzz', A, as('assignee'));
    expect(answer.list).toBe('OK');
    expect(answer.download).toContain('Evidence not found');
  });
});
