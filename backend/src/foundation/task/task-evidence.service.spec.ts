import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaskEvidenceService } from './task-evidence.service';
import { TaskService } from './task.service';
import { StoredFileService } from '../file-storage/stored-file.service';
import { StorageRefusalException } from '../file-storage/storage-refusal';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const ORG = 'org-a';
const ASSIGNEE = 'user-assignee';
const OTHER = 'user-other';
const FILE = { originalname: 'evidence.pdf', mimetype: 'application/pdf', size: 9, buffer: Buffer.from('%PDF-1.7\n') };

const TASK = {
  id: 'task-1',
  organizationId: ORG,
  status: 'IN_PROGRESS',
  sourceType: 'COMMITTEE',
  sourceId: 'committee-1',
  createdById: 'creator-1',
  createdBy: { status: 'ACTIVE' },
  assignees: [{ userId: ASSIGNEE, removedAt: null }],
};

const STORED = {
  id: 'file-1',
  organizationId: ORG,
  provider: 'S3',
  bucket: 'b',
  endpoint: null,
  rootPath: null,
  storageKey: 'org-a/tasks/task-1/x-evidence.pdf',
  originalName: 'evidence.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 9,
  sha256: 'a'.repeat(64),
  uploadedAt: new Date('2026-10-07T08:00:00Z'),
  deletedAt: null,
};

const EVIDENCE = {
  id: 'ev-1',
  organizationId: ORG,
  taskId: 'task-1',
  type: 'ATTACHMENT',
  url: null,
  linkTitle: null,
  refType: null,
  refId: null,
  refDisplay: null,
  uploadedById: ASSIGNEE,
  uploadedAt: new Date('2026-10-07T08:00:00Z'),
  uploadedBy: { id: ASSIGNEE, name: 'Sara' },
  storedFileId: 'file-1',
  storedFile: STORED,
};

describe('TaskEvidenceService (ACC-177)', () => {
  const prisma = {
    task: { findFirst: jest.fn() },
    taskEvidence: {
      create: jest.fn().mockResolvedValue({ id: 'ev-1' }),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn().mockResolvedValue(EVIDENCE),
      findMany: jest.fn().mockResolvedValue([EVIDENCE]),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  // Assigned after the literal: the transaction runs its callback against this same mock.
  (prisma as unknown as Record<string, unknown>)['$transaction'] = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
  const tasks = {
    lockOpenForActiveAssignee: jest.fn().mockResolvedValue(TASK),
    mayManage: jest.fn().mockResolvedValue(false),
  };
  const prepared = {
    originalName: 'evidence.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 9,
    sha256: 'a'.repeat(64),
    location: { provider: 'S3' },
  };
  const storedFiles = {
    prepare: jest.fn().mockResolvedValue(prepared),
    put: jest.fn().mockResolvedValue(undefined),
    recordInTx: jest.fn().mockResolvedValue({ id: 'file-1' }),
    discard: jest.fn().mockResolvedValue(undefined),
    openDownload: jest.fn().mockResolvedValue({ url: 'https://signed', viaApi: false, expiresAt: 'x' }),
    softDeleteInTx: jest.fn().mockResolvedValue({}),
    removeBytes: jest.fn().mockResolvedValue(undefined),
    summary: (f: typeof STORED) => ({ id: f.id, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, uploadedAt: f.uploadedAt }),
  };
  const visibility = { assertCanViewOrNotFound: jest.fn().mockRejectedValue(new NotFoundException('Task not found')) };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new TaskEvidenceService(
    prisma as unknown as PrismaService,
    tasks as unknown as TaskService,
    storedFiles as unknown as StoredFileService,
    visibility as unknown as ObjectVisibilityService,
    auditLog as unknown as AuditLogService,
  );
  const viewer = (id: string, permissions: string[] = []) => ({ id, permissions });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.task.findFirst.mockResolvedValue(TASK);
    prisma.taskEvidence.findFirst.mockResolvedValue(EVIDENCE);
    tasks.lockOpenForActiveAssignee.mockResolvedValue(TASK);
    tasks.mayManage.mockResolvedValue(false);
    visibility.assertCanViewOrNotFound.mockRejectedValue(new NotFoundException('Task not found'));
  });

  describe('addFile', () => {
    it('refuses someone not on the task BEFORE any byte is stored', async () => {
      tasks.lockOpenForActiveAssignee.mockRejectedValueOnce(new NotFoundException('Task not found'));
      await expect(service.addFile('task-1', FILE, ORG, OTHER)).rejects.toThrow('Task not found');
      expect(storedFiles.prepare).not.toHaveBeenCalled();
      expect(storedFiles.put).not.toHaveBeenCalled();
    });

    it('refuses a closed task with the same 409 as a link, before any byte is stored', async () => {
      tasks.lockOpenForActiveAssignee.mockRejectedValueOnce(new ConflictException('A completed task cannot have evidence added'));
      await expect(service.addFile('task-1', FILE, ORG, ASSIGNEE)).rejects.toBeInstanceOf(ConflictException);
      expect(storedFiles.put).not.toHaveBeenCalled();
    });

    it('stores the file, records it as ATTACHMENT evidence, and writes ONE audit row', async () => {
      const view = await service.addFile('task-1', FILE, ORG, ASSIGNEE);

      expect(storedFiles.prepare).toHaveBeenCalledWith(ORG, { type: 'TASK', id: 'task-1', module: 'tasks' }, FILE);
      expect(storedFiles.put).toHaveBeenCalledTimes(1);
      // The lock is taken again around the record: the task may have closed during the upload.
      expect(tasks.lockOpenForActiveAssignee).toHaveBeenCalledTimes(2);
      expect(prisma.taskEvidence.create).toHaveBeenCalledWith({
        data: { organizationId: ORG, taskId: 'task-1', type: 'ATTACHMENT', storedFileId: 'file-1', uploadedById: ASSIGNEE },
      });
      expect(auditLog.log).toHaveBeenCalledTimes(1);
      expect(auditLog.log.mock.calls[0]![0]).toEqual(
        expect.objectContaining({ action: 'CREATE', objectType: 'TaskEvidence', objectId: 'ev-1', tenantId: ORG }),
      );
      expect(view.file).toEqual(expect.objectContaining({ id: 'file-1', name: 'evidence.pdf' }));
      expect(JSON.stringify(view)).not.toContain('storageKey');
    });

    it('a refusal while recording deletes the uploaded bytes again', async () => {
      storedFiles.recordInTx.mockRejectedValueOnce(new StorageRefusalException('STORAGE_QUOTA_EXCEEDED'));
      await expect(service.addFile('task-1', FILE, ORG, ASSIGNEE)).rejects.toBeInstanceOf(StorageRefusalException);
      expect(storedFiles.discard).toHaveBeenCalledWith(prepared);
      expect(auditLog.log).not.toHaveBeenCalled();
    });

    it('the task closing during the upload also deletes the bytes', async () => {
      tasks.lockOpenForActiveAssignee
        .mockResolvedValueOnce(TASK)
        .mockRejectedValueOnce(new ConflictException('A completed task cannot have evidence added'));
      await expect(service.addFile('task-1', FILE, ORG, ASSIGNEE)).rejects.toBeInstanceOf(ConflictException);
      expect(storedFiles.discard).toHaveBeenCalled();
      expect(prisma.taskEvidence.create).not.toHaveBeenCalled();
    });
  });

  describe('list — who may see the evidence', () => {
    it('an assignee sees it, may add, and may delete their own', async () => {
      const list = await service.list('task-1', ORG, viewer(ASSIGNEE));
      expect(list.canAdd).toBe(true);
      expect(list.items[0]).toEqual(expect.objectContaining({ id: 'ev-1', canDelete: true, file: expect.objectContaining({ name: 'evidence.pdf' }) }));
      expect(prisma.taskEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { taskId: 'task-1', organizationId: ORG, deletedAt: null } }));
    });

    it('someone removed from the task still sees it, read-only', async () => {
      prisma.task.findFirst.mockResolvedValue({ ...TASK, assignees: [{ userId: ASSIGNEE, removedAt: new Date() }] });
      const list = await service.list('task-1', ORG, viewer(ASSIGNEE));
      expect(list.canAdd).toBe(false);
      expect(list.items[0]!.canDelete).toBe(false);
    });

    it('evidence on a completed task is read-only, even for its uploader', async () => {
      prisma.task.findFirst.mockResolvedValue({ ...TASK, status: 'COMPLETED' });
      const list = await service.list('task-1', ORG, viewer(ASSIGNEE));
      expect(list.canAdd).toBe(false);
      expect(list.closed).toBe(true);
      expect(list.items[0]!.canDelete).toBe(false);
    });

    it('a co-assignee sees it but cannot delete what someone else added', async () => {
      prisma.task.findFirst.mockResolvedValue({ ...TASK, assignees: [...TASK.assignees, { userId: OTHER, removedAt: null }] });
      const list = await service.list('task-1', ORG, viewer(OTHER));
      expect(list.canAdd).toBe(true);
      expect(list.items[0]!.canDelete).toBe(false);
    });

    it('the creator, or anyone who may manage the task, sees it', async () => {
      tasks.mayManage.mockResolvedValue(true);
      await expect(service.list('task-1', ORG, viewer('creator-1'))).resolves.toEqual(expect.objectContaining({ canAdd: false }));
      expect(visibility.assertCanViewOrNotFound).not.toHaveBeenCalled();
    });

    it('anyone who can see the record it belongs to sees it', async () => {
      visibility.assertCanViewOrNotFound.mockResolvedValue(undefined);
      await expect(service.list('task-1', ORG, viewer(OTHER, ['committees:view']))).resolves.toBeDefined();
      expect(visibility.assertCanViewOrNotFound).toHaveBeenCalledWith('COMMITTEE', 'committee-1', ORG, ['committees:view'], 'Task not found', OTHER);
    });

    it('anyone else gets the same 404 as a task that does not exist', async () => {
      await expect(service.list('task-1', ORG, viewer(OTHER))).rejects.toThrow('Task not found');
      prisma.task.findFirst.mockResolvedValue(null);
      await expect(service.list('task-1', ORG, viewer(OTHER))).rejects.toThrow('Task not found');
    });

    itEnforcesTenantIsolation('list reads the task and its evidence in the caller\'s organisation only', async () => {
      prisma.task.findFirst.mockResolvedValue(null); // the task belongs to org-a; the caller is in org-b
      await expect(service.list('task-1', 'org-b', viewer(ASSIGNEE))).rejects.toThrow('Task not found');
      expect(prisma.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task-1', organizationId: 'org-b' } }));
      expect(prisma.taskEvidence.findMany).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('hands back a fifteen-minute download for a file the caller may see', async () => {
      await expect(service.download('task-1', 'ev-1', ORG, viewer(ASSIGNEE))).resolves.toEqual(expect.objectContaining({ url: 'https://signed' }));
      expect(prisma.taskEvidence.findFirst).toHaveBeenCalledWith({
        where: { id: 'ev-1', taskId: 'task-1', organizationId: ORG, deletedAt: null, type: 'ATTACHMENT' },
        include: { storedFile: true },
      });
    });

    it('checks who is asking BEFORE looking at the evidence', async () => {
      await expect(service.download('task-1', 'ev-1', ORG, viewer(OTHER))).rejects.toThrow('Task not found');
      expect(prisma.taskEvidence.findFirst).not.toHaveBeenCalled();
      expect(storedFiles.openDownload).not.toHaveBeenCalled();
    });

    it('a link, a deleted file, or another task\'s evidence is "Evidence not found"', async () => {
      prisma.taskEvidence.findFirst.mockResolvedValue(null);
      await expect(service.download('task-1', 'ev-x', ORG, viewer(ASSIGNEE))).rejects.toThrow('Evidence not found');
      prisma.taskEvidence.findFirst.mockResolvedValue({ ...EVIDENCE, storedFile: { ...STORED, deletedAt: new Date() } });
      await expect(service.download('task-1', 'ev-1', ORG, viewer(ASSIGNEE))).rejects.toThrow('Evidence not found');
    });

    itEnforcesTenantIsolation('download never reaches another organisation\'s task or file', async () => {
      prisma.task.findFirst.mockResolvedValue(null);
      await expect(service.download('task-1', 'ev-1', 'org-b', viewer(ASSIGNEE))).rejects.toThrow('Task not found');
      expect(prisma.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task-1', organizationId: 'org-b' } }));
      expect(storedFiles.openDownload).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('the uploader soft-deletes the evidence and its file, removes the bytes after commit, and audits once', async () => {
      await service.remove('task-1', 'ev-1', ORG, ASSIGNEE);

      expect(tasks.lockOpenForActiveAssignee).toHaveBeenCalledWith(prisma, 'task-1', ASSIGNEE, ORG, 'have evidence removed', { allowOnHold: true });
      expect(prisma.taskEvidence.update).toHaveBeenCalledWith({
        where: { id: 'ev-1', organizationId: ORG },
        data: { deletedAt: expect.any(Date), deletedById: ASSIGNEE },
      });
      expect(storedFiles.softDeleteInTx).toHaveBeenCalledWith(prisma, 'file-1', ORG, ASSIGNEE);
      expect(storedFiles.removeBytes).toHaveBeenCalledWith(STORED);
      expect(auditLog.log).toHaveBeenCalledTimes(1);
      expect(auditLog.log.mock.calls[0]![0]).toEqual(expect.objectContaining({ action: 'DELETE', objectType: 'TaskEvidence', objectId: 'ev-1' }));
    });

    it('a link is soft-deleted the same way, with no file to remove', async () => {
      prisma.taskEvidence.findFirst.mockResolvedValue({ ...EVIDENCE, type: 'LINK', url: 'https://x', storedFileId: null, storedFile: null });
      await service.remove('task-1', 'ev-1', ORG, ASSIGNEE);
      expect(storedFiles.softDeleteInTx).not.toHaveBeenCalled();
      expect(storedFiles.removeBytes).not.toHaveBeenCalled();
    });

    it('evidence on a closed task cannot be removed', async () => {
      tasks.lockOpenForActiveAssignee.mockRejectedValueOnce(new ConflictException('A completed task cannot have evidence removed'));
      await expect(service.remove('task-1', 'ev-1', ORG, ASSIGNEE)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.taskEvidence.update).not.toHaveBeenCalled();
    });

    it('a co-assignee cannot remove someone else\'s evidence', async () => {
      await expect(service.remove('task-1', 'ev-1', ORG, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.taskEvidence.update).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('remove reads and writes evidence in the caller\'s organisation only', async () => {
      prisma.taskEvidence.findFirst.mockResolvedValue(null);
      await expect(service.remove('task-1', 'ev-1', 'org-b', ASSIGNEE)).rejects.toThrow('Evidence not found');
      expect(tasks.lockOpenForActiveAssignee).toHaveBeenCalledWith(prisma, 'task-1', ASSIGNEE, 'org-b', 'have evidence removed', { allowOnHold: true });
      expect(prisma.taskEvidence.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ev-1', taskId: 'task-1', organizationId: 'org-b', deletedAt: null } }),
      );
    });
  });

  itEnforcesTenantIsolation('addFile stores under, and records in, the caller\'s organisation only', async () => {
    await service.addFile('task-1', FILE, 'org-b', ASSIGNEE);
    expect(tasks.lockOpenForActiveAssignee).toHaveBeenCalledWith(prisma, 'task-1', ASSIGNEE, 'org-b', 'have evidence added', { allowOnHold: true });
    expect(storedFiles.prepare).toHaveBeenCalledWith('org-b', expect.anything(), FILE);
    expect(prisma.taskEvidence.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organizationId: 'org-b' }) });
  });
});
