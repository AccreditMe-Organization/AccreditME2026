import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { StoredFileService } from '../file-storage/stored-file.service';
import { IFileDownload, IUploadedFile } from '../file-storage/interfaces/stored-file.interface';
import { TaskService, TaskViewer } from './task.service';
import { ITaskEvidenceList, ITaskEvidenceView } from './interfaces/task-evidence.interface';

// The same line lockOpenForActiveAssignee() draws: evidence may change on any
// task that is not closed — an on-hold one included.
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'CANCELLED']);

const EVIDENCE_INCLUDE = {
  storedFile: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true, deletedAt: true } },
  uploadedBy: { select: { id: true, name: true } },
} as const;

/**
 * ACC-177 — file evidence, the evidence list, downloads and deletes. Adding a
 * LINK or a REFERENCE stays TaskService.addEvidence() (ACC-163), unchanged.
 *
 * WHO, for each action — the rules the other evidence types already have:
 *
 *   add a file     an active assignee, task open or on hold — the SAME
 *                  lockOpenForActiveAssignee() addEvidence() uses;
 *   list/download  anyone who may see the task's evidence: someone who is or
 *                  was on it, anyone who may manage it (mayManage()), or anyone
 *                  who can see the record it belongs to (ACC-101). Everyone
 *                  else, and every other organisation, gets the identical 404;
 *   delete         the person who added it, while still an active assignee and
 *                  the task open or on hold (Ahmad, 7 Oct). Evidence on a
 *                  closed task is the record of what proved the work and
 *                  cannot be removed.
 *
 * A deleted piece of evidence is soft-deleted and hidden at once. A FILE goes
 * to the recycle bin for 30 days with its bytes kept (Ahmad, 7 Oct): a tenant
 * admin can restore it — which brings this evidence row back too — or purge
 * it, and the daily job purges it after 30 days. A deleted link or record
 * reference holds no file and cannot be restored. Every evidence count in the
 * product excludes deleted rows.
 */
@Injectable()
export class TaskEvidenceService {
  private readonly logger = new Logger(TaskEvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskService,
    private readonly storedFiles: StoredFileService,
    private readonly objectVisibility: ObjectVisibilityService,
    private readonly auditLog: AuditLogService,
  ) {}

  async addFile(
    taskId: string,
    file: IUploadedFile | undefined,
    organizationId: string,
    actorId: string,
  ): Promise<ITaskEvidenceView> {
    // Refuse a stranger or a closed task BEFORE any byte is stored. The lock
    // is released straight away; the write below takes it again.
    await this.prisma.$transaction((tx) =>
      this.tasks.lockOpenForActiveAssignee(tx, taskId, actorId, organizationId, 'have evidence added', {
        allowOnHold: true,
      }),
    );

    // Storage must have been confirmed, then the file judged — before any
    // byte is stored.
    const prepared = await this.storedFiles.prepare(organizationId, { type: 'TASK', id: taskId, module: 'tasks' }, file);
    await this.storedFiles.put(prepared);

    let evidenceId: string;
    try {
      evidenceId = await this.prisma.$transaction(async (tx) => {
        // Again under the lock: the task may have been completed while the
        // bytes were uploading.
        await this.tasks.lockOpenForActiveAssignee(tx, taskId, actorId, organizationId, 'have evidence added', {
          allowOnHold: true,
        });
        const stored = await this.storedFiles.recordInTx(tx, prepared, actorId);
        const evidence = await tx.taskEvidence.create({
          data: { organizationId, taskId, type: 'ATTACHMENT', storedFileId: stored.id, uploadedById: actorId },
        });
        return evidence.id;
      });
    } catch (error) {
      await this.storedFiles.discard(prepared);
      throw error;
    }

    // One audit row per upload: the evidence, with the file it carries.
    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'TaskEvidence',
      objectId: evidenceId,
      actorId,
      tenantId: organizationId,
      after: {
        taskId,
        type: 'ATTACHMENT',
        file: {
          name: prepared.originalName,
          mimeType: prepared.mimeType,
          sizeBytes: prepared.sizeBytes,
          sha256: prepared.sha256,
          provider: prepared.location.provider,
        },
      },
    });

    // After commit: the 90% storage warning, for a file on AccreditMe cloud.
    await this.storedFiles.afterUpload(prepared);

    const evidence = await this.prisma.taskEvidence.findFirstOrThrow({
      where: { id: evidenceId, organizationId },
      include: EVIDENCE_INCLUDE,
    });
    return this.view(evidence, { viewerId: actorId, viewerIsActiveAssignee: true, taskOpen: true });
  }

  async list(taskId: string, organizationId: string, viewer: TaskViewer): Promise<ITaskEvidenceList> {
    const task = await this.assertCanSeeEvidence(taskId, organizationId, viewer);
    const evidence = await this.prisma.taskEvidence.findMany({
      where: { taskId, organizationId, deletedAt: null },
      include: EVIDENCE_INCLUDE,
      orderBy: { uploadedAt: 'asc' },
    });
    const viewerIsActiveAssignee = task.assignees.some((a) => a.userId === viewer.id && a.removedAt === null);
    const taskOpen = !CLOSED_STATUSES.has(task.status);
    return {
      items: evidence.map((e) => this.view(e, { viewerId: viewer.id, viewerIsActiveAssignee, taskOpen })),
      canAdd: viewerIsActiveAssignee && taskOpen,
      closed: !taskOpen,
    };
  }

  async download(taskId: string, evidenceId: string, organizationId: string, viewer: TaskViewer): Promise<IFileDownload> {
    await this.assertCanSeeEvidence(taskId, organizationId, viewer);
    const evidence = await this.prisma.taskEvidence.findFirst({
      where: { id: evidenceId, taskId, organizationId, deletedAt: null, type: 'ATTACHMENT' },
      include: { storedFile: true },
    });
    const file = evidence?.storedFile;
    if (!file || file.deletedAt) throw new NotFoundException('Evidence not found');

    // A read, so a log line and not an audit row (ACC-101's reasoning).
    this.logger.log(`File ${file.id} on task ${taskId} in org ${organizationId} opened by ${viewer.id}`);
    return this.storedFiles.openDownload(file);
  }

  async remove(taskId: string, evidenceId: string, organizationId: string, actorId: string): Promise<void> {
    const removed = await this.prisma.$transaction(async (tx) => {
      // The identical 404 for anyone not on the task, then the closed-task 409.
      await this.tasks.lockOpenForActiveAssignee(tx, taskId, actorId, organizationId, 'have evidence removed', {
        allowOnHold: true,
      });
      const evidence = await tx.taskEvidence.findFirst({
        where: { id: evidenceId, taskId, organizationId, deletedAt: null },
        include: { storedFile: true },
      });
      if (!evidence) throw new NotFoundException('Evidence not found');
      // The caller is on the task and can see this evidence, so saying whose
      // it is discloses nothing.
      if (evidence.uploadedById !== actorId) {
        throw new ForbiddenException('Only the person who added this evidence can remove it');
      }

      const now = new Date();
      await tx.taskEvidence.update({
        where: { id: evidence.id, organizationId },
        data: { deletedAt: now, deletedById: actorId },
      });
      if (evidence.storedFile) {
        await this.storedFiles.softDeleteInTx(tx, evidence.storedFile.id, organizationId, actorId);
      }
      return evidence;
    });

    await this.auditLog.log({
      action: 'DELETE',
      objectType: 'TaskEvidence',
      objectId: removed.id,
      actorId,
      tenantId: organizationId,
      // A file is recoverable from the recycle bin for 30 days; a link or a
      // reference is not.
      metadata: { recoverable: removed.storedFile !== null },
      before: {
        taskId,
        type: removed.type,
        url: removed.url,
        refType: removed.refType,
        refId: removed.refId,
        ...(removed.storedFile
          ? {
              file: {
                name: removed.storedFile.originalName,
                mimeType: removed.storedFile.mimeType,
                sizeBytes: removed.storedFile.sizeBytes,
                sha256: removed.storedFile.sha256,
                provider: removed.storedFile.provider,
              },
            }
          : {}),
      },
    });
  }

  // Who may see a task's evidence. The task is read first because its parent
  // is only knowable from the row (ACC-101 clause (b)): a refusal is the same
  // 404 as a missing task, and is logged by the visibility service.
  private async assertCanSeeEvidence(taskId: string, organizationId: string, viewer: TaskViewer) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: { assignees: true, createdBy: { select: { status: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.assignees.some((a) => a.userId === viewer.id)) return task;
    if (await this.tasks.mayManage(task, viewer, organizationId)) return task;
    await this.objectVisibility.assertCanViewOrNotFound(
      task.sourceType,
      task.sourceId,
      organizationId,
      viewer.permissions,
      'Task not found',
      viewer.id,
    );
    return task;
  }

  private view(
    evidence: {
      id: string;
      type: string;
      url: string | null;
      linkTitle: string | null;
      refType: string | null;
      refId: string | null;
      refDisplay: string | null;
      uploadedAt: Date;
      uploadedById: string;
      uploadedBy: { id: string; name: string };
      storedFile: { id: string; originalName: string; mimeType: string; sizeBytes: number; uploadedAt: Date; deletedAt: Date | null } | null;
    },
    ctx: { viewerId: string; viewerIsActiveAssignee: boolean; taskOpen: boolean },
  ): ITaskEvidenceView {
    const file = evidence.storedFile && !evidence.storedFile.deletedAt ? this.storedFiles.summary(evidence.storedFile) : null;
    return {
      id: evidence.id,
      type: evidence.type,
      url: evidence.url,
      linkTitle: evidence.linkTitle,
      refType: evidence.refType,
      refId: evidence.refId,
      refDisplay: evidence.refDisplay,
      file,
      uploadedBy: evidence.uploadedBy,
      uploadedAt: evidence.uploadedAt,
      canDelete: ctx.taskOpen && ctx.viewerIsActiveAssignee && evidence.uploadedById === ctx.viewerId,
    };
  }
}
