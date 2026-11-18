import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { StoredFileService } from '../file-storage/stored-file.service';
import type { IFileDownload, IUploadedFile } from '../file-storage/interfaces/stored-file.interface';
import { StageRulesService } from '../workflow/stage-rules.service';
import { MEETING_ACTIONS } from '../workflow/record-registry';
import { MeetingAccess, type MeetingViewer } from './meeting-access';
import { MeetingRefusal } from './meeting-refusal';
import type { IMeetingFile, IMeetingFiles } from './interfaces/meeting.interface';

const FILE_NOT_FOUND = 'File not found';

/**
 * ACC-316 PR 3b — a meeting's FILES: general attachments (owned by the
 * meeting, StoredFileOwnerType MEETING) and each agenda item's papers (owned by
 * the item, MEETING_AGENDA_ITEM). Plan step-316 §3.3, §4.1.
 *
 *   Seeing: whoever may see the meeting (MeetingAccess.seeing, the parent rule
 *   with oversight) — organisation guests included once invited. Nobody outside
 *   the meeting reaches a file: the identical 404. Outside guests have no
 *   account, and their emails carry no file.
 *   Adding and deleting: whoever schedules the meeting, while its stage allows
 *   `manage_agenda` (the instance FOR SHARE first, again after the bytes are
 *   stored: the stage may have moved meanwhile).
 *   Opening: the in-app file viewer, through a 15-minute link
 *   (StoredFileService.openView / openDownload), as task evidence does.
 *
 * A deleted file is the 30-day soft delete, in the tenant admin's recycle bin
 * (ACC-177); restored to its meeting or agenda item while that still exists.
 */
@Injectable()
export class MeetingFilesService {
  private readonly access: MeetingAccess;

  constructor(
    private readonly prisma: PrismaService,
    visibility: ObjectVisibilityService,
    private readonly stageRules: StageRulesService,
    private readonly storedFiles: StoredFileService,
    private readonly auditLog: AuditLogService,
  ) {
    this.access = new MeetingAccess(prisma, visibility);
  }

  /** Attach a file to the meeting (itemId null) or to one of its agenda items (a paper). */
  async add(
    meetingId: string,
    itemId: string | null,
    file: IUploadedFile | undefined,
    organizationId: string,
    viewer: MeetingViewer,
    now: Date = new Date(),
  ): Promise<IMeetingFile> {
    await this.access.writing(meetingId, organizationId, viewer, now);
    if (itemId) await this.assertItem(this.prisma, meetingId, itemId, organizationId);
    // Refuse a stage that allows no agenda change BEFORE any byte is stored.
    await this.prisma.$transaction((tx) =>
      this.stageRules.assertStageAllows('MEETING', meetingId, MEETING_ACTIONS.MANAGE_AGENDA, organizationId, tx, { lock: 'share' }),
    );

    const owner = itemId
      ? { type: 'MEETING_AGENDA_ITEM' as const, id: itemId, module: 'meetings' }
      : { type: 'MEETING' as const, id: meetingId, module: 'meetings' };
    const prepared = await this.storedFiles.prepare(organizationId, owner, file);
    await this.storedFiles.put(prepared);

    let storedId: string;
    try {
      storedId = await this.prisma.$transaction(async (tx) => {
        // Again under the instance's lock: the agenda may have closed while the bytes were uploading.
        await this.stageRules.assertStageAllows('MEETING', meetingId, MEETING_ACTIONS.MANAGE_AGENDA, organizationId, tx, { lock: 'share' });
        if (itemId) await this.assertItem(tx, meetingId, itemId, organizationId);
        return (await this.storedFiles.recordInTx(tx, prepared, viewer.id)).id;
      });
    } catch (error) {
      await this.storedFiles.discard(prepared);
      throw error;
    }

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'StoredFile',
      objectId: storedId,
      actorId: viewer.id,
      tenantId: organizationId,
      after: {
        meetingId,
        agendaItemId: itemId,
        file: { name: prepared.originalName, mimeType: prepared.mimeType, sizeBytes: prepared.sizeBytes, sha256: prepared.sha256, provider: prepared.location.provider },
      },
    });
    await this.storedFiles.afterUpload(prepared);

    const files = await this.list(meetingId, organizationId, viewer, now);
    return [...files.attachments, ...files.papers].find((f) => f.id === storedId)!;
  }

  /** The meeting's attachments and its agenda items' papers, in one read. */
  async list(meetingId: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingFiles> {
    await this.access.seeing(meetingId, organizationId, viewer, now);
    const items = await this.prisma.agendaItem.findMany({ where: { organizationId, meetingId }, select: { id: true } });
    const files = await this.prisma.storedFile.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [
          { ownerType: 'MEETING', ownerId: meetingId },
          { ownerType: 'MEETING_AGENDA_ITEM', ownerId: { in: items.map((i) => i.id) } },
        ],
      },
      select: { id: true, ownerType: true, ownerId: true, originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
    });
    const view = (f: (typeof files)[number]): IMeetingFile => ({
      id: f.id,
      agendaItemId: f.ownerType === 'MEETING_AGENDA_ITEM' ? f.ownerId : null,
      name: f.originalName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      uploadedAt: f.uploadedAt,
    });
    return {
      attachments: files.filter((f) => f.ownerType === 'MEETING').map(view),
      papers: files.filter((f) => f.ownerType === 'MEETING_AGENDA_ITEM').map(view),
    };
  }

  /** The in-app viewer's 15-minute link. */
  async openView(meetingId: string, fileId: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IFileDownload> {
    return this.storedFiles.openView(await this.fileForViewer(meetingId, fileId, organizationId, viewer, now));
  }

  async openDownload(meetingId: string, fileId: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IFileDownload> {
    return this.storedFiles.openDownload(await this.fileForViewer(meetingId, fileId, organizationId, viewer, now));
  }

  /** The 30-day soft delete, by whoever schedules the meeting, while the agenda can change. */
  async remove(meetingId: string, fileId: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<void> {
    await this.access.writing(meetingId, organizationId, viewer, now);
    const removed = await this.prisma.$transaction(async (tx) => {
      await this.stageRules.assertStageAllows('MEETING', meetingId, MEETING_ACTIONS.MANAGE_AGENDA, organizationId, tx, { lock: 'share' });
      const file = await this.ownedFile(tx, meetingId, fileId, organizationId);
      await this.storedFiles.softDeleteInTx(tx, file.id, organizationId, viewer.id);
      return file;
    });
    await this.auditLog.log({
      action: 'DELETE',
      objectType: 'StoredFile',
      objectId: removed.id,
      actorId: viewer.id,
      tenantId: organizationId,
      before: { meetingId, name: removed.originalName },
    });
  }

  /** The one entitlement behind view and download: may see the meeting, and the file is the meeting's. */
  private async fileForViewer(meetingId: string, fileId: string, organizationId: string, viewer: MeetingViewer, now: Date) {
    await this.access.seeing(meetingId, organizationId, viewer, now);
    return this.ownedFile(this.prisma, meetingId, fileId, organizationId);
  }

  /** A live file of this meeting: one of its attachments, or a paper of one of its agenda items. */
  private async ownedFile(client: Pick<PrismaService, 'storedFile' | 'agendaItem'>, meetingId: string, fileId: string, organizationId: string) {
    const file = await client.storedFile.findFirst({ where: { id: fileId, organizationId, deletedAt: null } });
    if (!file) throw new NotFoundException(FILE_NOT_FOUND);
    if (file.ownerType === 'MEETING' && file.ownerId === meetingId) return file;
    if (file.ownerType === 'MEETING_AGENDA_ITEM') {
      const item = await client.agendaItem.findFirst({ where: { id: file.ownerId, organizationId, meetingId }, select: { id: true } });
      if (item) return file;
    }
    throw new NotFoundException(FILE_NOT_FOUND);
  }

  private async assertItem(client: Pick<PrismaService, 'agendaItem'>, meetingId: string, itemId: string, organizationId: string): Promise<void> {
    const item = await client.agendaItem.findFirst({ where: { id: itemId, organizationId, meetingId }, select: { id: true } });
    if (!item) throw new MeetingRefusal('MEETING_AGENDA_ITEM_NOT_FOUND');
  }
}
