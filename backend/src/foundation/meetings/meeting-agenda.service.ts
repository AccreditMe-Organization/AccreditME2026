import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { StoredFileService } from '../file-storage/stored-file.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import type { EngineTx } from '../workflow/workflow.service';
import { MEETING_ACTIONS, STAGE_FLAG } from '../workflow/record-registry';
import { peopleDateIn } from '../task/task-sla.service';
import { MeetingAccess, asMeetingConflict, lockMeetingRow, type MeetingViewer } from './meeting-access';
import { MeetingRefusal } from './meeting-refusal';
import { agendaChangedNotice, invitationNotice } from './meeting-notices';
import { notifyUsers } from './meeting-send';
import type { AgendaPresenterDto, CreateAgendaItemDto, OrderAgendaDto, UpdateAgendaItemDto } from './dto/meeting.dto';
import type { IMeetingAgendaItem } from './interfaces/meeting.interface';

/** What an agenda write changed, for the notice the invited get after issue. */
interface AgendaChange {
  en: string;
  ar: string;
}

/**
 * ACC-316 PR 3b — a meeting's AGENDA (plan step-316 §3.3, §0 "Agenda"):
 * ordered items with a title, a description, a duration, an optional presenter
 * and the `standing` mark a series copies in (PR 5). Papers are files owned by
 * an item (MeetingFilesService).
 *
 *   Who: whoever schedules the meeting (MeetingAccess.writing), while its
 *   stage allows `manage_agenda` (Planned and Agenda Issued, seeded) — the
 *   instance FOR SHARE first, then the writes, in one transaction.
 *   The presenter is an INVITEE: a member, an organisation guest or an outside
 *   guest (by attendeeId). An organisation person who is not yet invited (by
 *   userId) is added as an organisation guest in the same write, marked
 *   `addedAsPresenter`, and invited at once if the agenda is already issued.
 *   An outside guest presents only once added as a guest.
 *   Editable after issue: the invited users are told again, with what changed.
 *
 * "Open actions from the last meeting" is a read of the previous meeting's
 * action-item tasks; nothing reaches Minutes Approved before PR 4, so it ships
 * with the minutes.
 */
@Injectable()
export class MeetingAgendaService {
  private readonly access: MeetingAccess;

  constructor(
    private readonly prisma: PrismaService,
    visibility: ObjectVisibilityService,
    private readonly stageRules: StageRulesService,
    private readonly notifications: NotificationService,
    private readonly calendar: WorkingCalendarService,
    private readonly storedFiles: StoredFileService,
  ) {
    this.access = new MeetingAccess(prisma, visibility);
  }

  async list(meetingId: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingAgendaItem[]> {
    await this.access.seeing(meetingId, organizationId, viewer, now);
    return this.items(this.prisma, meetingId, organizationId);
  }

  async create(meetingId: string, dto: CreateAgendaItemDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingAgendaItem[]> {
    await this.access.writing(meetingId, organizationId, viewer, now);
    const title = dto.title.trim();
    if (!title) throw new MeetingRefusal('MEETING_AGENDA_TITLE_REQUIRED');
    const done = await this.prisma
      .$transaction(async (tx) => {
      const issued = await this.lockAgenda(tx, meetingId, organizationId);
      const presenter = dto.presenter ? await this.resolvePresenter(tx, meetingId, organizationId, dto.presenter, issued, now, viewer.id) : null;
      const last = await tx.agendaItem.aggregate({ where: { organizationId, meetingId }, _max: { order: true } });
      const item = await tx.agendaItem.create({
        data: {
          organizationId,
          meetingId,
          title,
          description: dto.description ?? null,
          duration: dto.durationMinutes ?? null,
          standing: dto.standing ?? false,
          presenterAttendeeId: presenter?.attendeeId ?? null,
          order: (last._max.order ?? 0) + 1,
        },
        select: { id: true },
      });
      await this.audit(tx, organizationId, viewer.id, 'CREATE', item.id, null, { meetingId, title, presenterAttendeeId: presenter?.attendeeId ?? null });
      return { issued, invitedPresenter: presenter?.invitedUserId ?? null };
    })
      .catch((error: unknown) => asMeetingConflict(error));
    await this.afterChange(meetingId, organizationId, viewer.id, done, { en: `"${title}" was added.`, ar: `أُضيف «${title}».` });
    return this.items(this.prisma, meetingId, organizationId);
  }

  async update(
    meetingId: string,
    itemId: string,
    dto: UpdateAgendaItemDto,
    organizationId: string,
    viewer: MeetingViewer,
    now: Date = new Date(),
  ): Promise<IMeetingAgendaItem[]> {
    await this.access.writing(meetingId, organizationId, viewer, now);
    if (dto.title !== undefined && !dto.title.trim()) throw new MeetingRefusal('MEETING_AGENDA_TITLE_REQUIRED');
    const done = await this.prisma
      .$transaction(async (tx) => {
      const issued = await this.lockAgenda(tx, meetingId, organizationId);
      const current = await tx.agendaItem.findFirst({
        where: { id: itemId, organizationId, meetingId },
        select: { title: true, description: true, duration: true, standing: true, presenterAttendeeId: true },
      });
      if (!current) throw new MeetingRefusal('MEETING_AGENDA_ITEM_NOT_FOUND');
      const presenter =
        dto.presenter === undefined
          ? undefined
          : dto.presenter === null
            ? null
            : await this.resolvePresenter(tx, meetingId, organizationId, dto.presenter, issued, now, viewer.id);
      const next = {
        title: dto.title !== undefined ? dto.title.trim() : current.title,
        description: dto.description !== undefined ? dto.description : current.description,
        duration: dto.durationMinutes !== undefined ? dto.durationMinutes : current.duration,
        standing: dto.standing !== undefined ? dto.standing : current.standing,
        presenterAttendeeId: presenter === undefined ? current.presenterAttendeeId : (presenter?.attendeeId ?? null),
      };
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== current[k]);
      if (changed.length === 0) return { issued, invitedPresenter: null, title: current.title, changed: false };
      await tx.agendaItem.update({ where: { id: itemId }, data: Object.fromEntries(changed.map((k) => [k, next[k]])) });
      await this.audit(
        tx,
        organizationId,
        viewer.id,
        'UPDATE',
        itemId,
        Object.fromEntries(changed.map((k) => [k, current[k]])),
        Object.fromEntries(changed.map((k) => [k, next[k]])),
      );
      return { issued, invitedPresenter: presenter?.invitedUserId ?? null, title: next.title, changed: true };
    })
      .catch((error: unknown) => asMeetingConflict(error));
    if (done.changed) await this.afterChange(meetingId, organizationId, viewer.id, done, { en: `"${done.title}" was changed.`, ar: `عُدّل «${done.title}».` });
    return this.items(this.prisma, meetingId, organizationId);
  }

  /** Removes an item and soft-deletes its papers (the 30-day recycle bin). */
  async remove(meetingId: string, itemId: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingAgendaItem[]> {
    await this.access.writing(meetingId, organizationId, viewer, now);
    const done = await this.prisma
      .$transaction(async (tx) => {
      const issued = await this.lockAgenda(tx, meetingId, organizationId);
      // The item FOR UPDATE (fix 3): a paper being recorded on it holds it FOR
      // SHARE, so the removal waits for it and then takes that paper too.
      await tx.$queryRaw`SELECT id FROM "AgendaItem" WHERE id = ${itemId} AND "organizationId" = ${organizationId} AND "meetingId" = ${meetingId} FOR UPDATE`;
      const item = await tx.agendaItem.findFirst({ where: { id: itemId, organizationId, meetingId }, select: { id: true, title: true } });
      if (!item) throw new MeetingRefusal('MEETING_AGENDA_ITEM_NOT_FOUND');
      const papers = await tx.storedFile.findMany({
        where: { organizationId, ownerType: 'MEETING_AGENDA_ITEM', ownerId: itemId, deletedAt: null },
        select: { id: true },
      });
      for (const paper of papers) await this.storedFiles.softDeleteInTx(tx, paper.id, organizationId, viewer.id);
      await tx.agendaItem.delete({ where: { id: itemId } });
      // The remaining items close up, keeping their order.
      const rest = await tx.agendaItem.findMany({ where: { organizationId, meetingId }, orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { id: true } });
      for (const [i, r] of rest.entries()) await tx.agendaItem.update({ where: { id: r.id }, data: { order: i + 1 } });
      await this.audit(tx, organizationId, viewer.id, 'DELETE', itemId, { meetingId, title: item.title, papers: papers.length }, null);
      return { issued, invitedPresenter: null, title: item.title };
    })
      .catch((error: unknown) => asMeetingConflict(error));
    await this.afterChange(meetingId, organizationId, viewer.id, done, { en: `"${done.title}" was removed.`, ar: `حُذف «${done.title}».` });
    return this.items(this.prisma, meetingId, organizationId);
  }

  /**
   * The new order: every item's id, once (MEETING_AGENDA_ORDER_MISMATCH
   * otherwise). With `expectedItemIds`, the order the person saw, it is
   * compared under the locks with the agenda's order now: any difference (a
   * reorder, an item added or removed meanwhile) is MEETING_AGENDA_CHANGED, and
   * nothing moves.
   */
  async order(meetingId: string, dto: OrderAgendaDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingAgendaItem[]> {
    await this.access.writing(meetingId, organizationId, viewer, now);
    const done = await this.prisma
      .$transaction(async (tx) => {
      const issued = await this.lockAgenda(tx, meetingId, organizationId);
      const items = await tx.agendaItem.findMany({ where: { organizationId, meetingId }, orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { id: true, order: true } });
      if (dto.expectedItemIds && (dto.expectedItemIds.length !== items.length || dto.expectedItemIds.some((id, i) => items[i]!.id !== id))) {
        throw new MeetingRefusal('MEETING_AGENDA_CHANGED');
      }
      const known = new Set(items.map((i) => i.id));
      if (dto.itemIds.length !== items.length || new Set(dto.itemIds).size !== items.length || dto.itemIds.some((id) => !known.has(id))) {
        throw new MeetingRefusal('MEETING_AGENDA_ORDER_MISMATCH');
      }
      const before = new Map(items.map((i) => [i.id, i.order]));
      const moved = dto.itemIds.filter((id, i) => before.get(id) !== i + 1);
      for (const [i, id] of dto.itemIds.entries()) if (before.get(id) !== i + 1) await tx.agendaItem.update({ where: { id }, data: { order: i + 1 } });
      if (moved.length > 0) await this.audit(tx, organizationId, viewer.id, 'UPDATE', meetingId, { order: items.map((i) => i.id) }, { order: dto.itemIds });
      return { issued, invitedPresenter: null, changed: moved.length > 0 };
    })
      .catch((error: unknown) => asMeetingConflict(error));
    if (done.changed) await this.afterChange(meetingId, organizationId, viewer.id, done, { en: 'The items were reordered.', ar: 'تغيّر ترتيب البنود.' });
    return this.items(this.prisma, meetingId, organizationId);
  }

  // ── Shared ──────────────────────────────────────────────────────────────────

  /**
   * The instance FOR SHARE (the stage must allow manage_agenda), then the
   * meeting row FOR UPDATE (fix 6: `max(order) + 1` and the presenter's guest
   * check read a state no other write on this meeting can change meanwhile).
   * True when the agenda is already issued.
   */
  private async lockAgenda(tx: EngineTx, meetingId: string, organizationId: string): Promise<boolean> {
    const rules = await this.stageRules.assertStageAllows('MEETING', meetingId, MEETING_ACTIONS.MANAGE_AGENDA, organizationId, tx, { lock: 'share' });
    await lockMeetingRow(tx, meetingId, organizationId);
    return rules.flags.includes(STAGE_FLAG.AGENDA_ISSUED);
  }

  /**
   * The presenter as an invitee of this meeting. An organisation person who is
   * not invited yet becomes an organisation guest, `addedAsPresenter`, invited
   * at once when the agenda is already issued (round 1 Q12).
   */
  private async resolvePresenter(
    tx: EngineTx,
    meetingId: string,
    organizationId: string,
    presenter: AgendaPresenterDto,
    issued: boolean,
    now: Date,
    actorId: string,
  ): Promise<{ attendeeId: string; invitedUserId: string | null }> {
    if (presenter.attendeeId) {
      const row = await tx.meetingAttendee.findFirst({ where: { id: presenter.attendeeId, organizationId, meetingId }, select: { id: true } });
      if (!row) throw new MeetingRefusal('MEETING_PRESENTER_NOT_FOUND');
      return { attendeeId: row.id, invitedUserId: null };
    }
    if (!presenter.userId) throw new MeetingRefusal('MEETING_PRESENTER_NOT_FOUND');
    const existing = await tx.meetingAttendee.findFirst({ where: { organizationId, meetingId, userId: presenter.userId }, select: { id: true } });
    if (existing) return { attendeeId: existing.id, invitedUserId: null };
    const user = await tx.user.findFirst({ where: { id: presenter.userId, organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!user) throw new MeetingRefusal('MEETING_PRESENTER_NOT_FOUND');
    // Adding the presenter IS adding a guest: the stage must allow guests too,
    // with the very refusal Add a guest gives (lane B's review, fix 2).
    await this.stageRules.assertStageAllows('MEETING', meetingId, MEETING_ACTIONS.MANAGE_GUESTS, organizationId, tx, { lock: 'share' });
    const row = await tx.meetingAttendee.create({
      data: { organizationId, meetingId, kind: 'ORG_GUEST', userId: user.id, addedAsPresenter: true, invitedAt: issued ? now : null, createdById: actorId },
      select: { id: true },
    });
    return { attendeeId: row.id, invitedUserId: issued ? user.id : null };
  }

  /**
   * After the commit, once the agenda is issued: the invited users are told
   * what changed, and a presenter just added as a guest gets the invitation.
   */
  private async afterChange(
    meetingId: string,
    organizationId: string,
    actorId: string,
    done: { issued: boolean; invitedPresenter: string | null },
    change: AgendaChange,
  ): Promise<void> {
    if (!done.issued) return;
    const [meeting, invited] = await Promise.all([
      this.prisma.meeting.findFirst({ where: { id: meetingId, organizationId }, select: { title: true, scheduledAt: true } }),
      this.prisma.meetingAttendee.findMany({ where: { organizationId, meetingId, userId: { not: null }, invitedAt: { not: null } }, select: { userId: true } }),
    ]);
    if (!meeting) return;
    if (done.invitedPresenter) {
      const when = peopleDateIn(meeting.scheduledAt, await this.calendar.getEffectiveTimeZone(organizationId));
      await notifyUsers(this.notifications, organizationId, meetingId, actorId, [done.invitedPresenter], invitationNotice(meeting.title, when));
    }
    const told = invited.map((r) => r.userId!).filter((u) => u !== done.invitedPresenter);
    await notifyUsers(this.notifications, organizationId, meetingId, actorId, told, agendaChangedNotice(meeting.title, change));
  }

  private async items(client: Pick<PrismaService, 'agendaItem'>, meetingId: string, organizationId: string): Promise<IMeetingAgendaItem[]> {
    const items = await client.agendaItem.findMany({
      where: { organizationId, meetingId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        order: true,
        title: true,
        description: true,
        duration: true,
        standing: true,
        presenterAttendee: { select: { id: true, kind: true, outsideName: true, user: { select: { name: true } } } },
      },
    });
    return items.map((i) => ({
      id: i.id,
      order: i.order,
      title: i.title,
      description: i.description,
      durationMinutes: i.duration,
      standing: i.standing,
      presenter: i.presenterAttendee
        ? { attendeeId: i.presenterAttendee.id, name: i.presenterAttendee.user?.name ?? i.presenterAttendee.outsideName ?? '', kind: i.presenterAttendee.kind }
        : null,
    }));
  }

  private audit(
    tx: EngineTx,
    organizationId: string,
    actorId: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    objectId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action,
        objectType: 'AgendaItem',
        objectId,
        ...(before ? { before: before as object } : {}),
        ...(after ? { after: after as object } : {}),
      },
    });
  }
}
