import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { RECORD_VIEW_PERMISSION } from '../../common/services/object-visibility.service';
import { closedNoticeText, recordLinkTarget, type ClosedNoticeKind, type Named } from './task-closed-notice';

/** A task that just closed, and who was still on it. */
export interface ClosedTask {
  id: string;
  title: string;
  titleAr: string | null;
  /** Active assignees at the moment it closed (not those removed earlier). */
  assigneeUserIds: string[];
}

/**
 * ACC-271 PR 4 (plan §7) — tells the people whose task closed because of
 * someone else's action. Called only AFTER the change that closed the tasks
 * has committed — the engine's stage change, or a completion — so a move that
 * rolls back tells nobody.
 *
 * Who is told: every assignee still on a closed task, never the actor; an
 * assignee who is away now, with an ACTIVE acting user, is told through that
 * acting user — the same routing the stage's pool uses (StagePoolService).
 * Someone no longer ACTIVE is told nothing.
 *
 * Batched (the performance rule): one read of the people, then the record's
 * name and who may open it together, then ONE createMany for the whole move.
 * No query inside a loop.
 */
@Injectable()
export class TaskClosedNoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** A stage change's closed tasks: optional work on an ADVANCE, everything on a RETURN or EXIT. */
  async afterStageExit(
    organizationId: string,
    actorId: string,
    move: {
      kind: 'ADVANCE' | 'RETURN' | 'EXIT';
      record: { objectType: string; objectId: string };
      toStage: Named;
      transition: { labelEn: string; labelAr: string | null };
      closed: ClosedTask[];
    },
  ): Promise<number> {
    const kind: ClosedNoticeKind = move.kind === 'ADVANCE' ? 'MOVED' : move.kind === 'RETURN' ? 'SENT_BACK' : 'ENDED';
    return this.send(organizationId, actorId, kind, move.closed, move.record, { stage: move.toStage, transition: move.transition });
  }

  /** A task completed by one assignee: the others on it, whose part closed with it. */
  async afterCompletion(
    organizationId: string,
    actorId: string,
    task: ClosedTask & { sourceType: string; sourceId: string },
  ): Promise<number> {
    return this.send(organizationId, actorId, 'COMPLETED', [task], { objectType: task.sourceType, objectId: task.sourceId }, {});
  }

  private async send(
    organizationId: string,
    actorId: string,
    kind: ClosedNoticeKind,
    closed: ClosedTask[],
    record: { objectType: string; objectId: string },
    extra: { stage?: Named; transition?: { labelEn: string; labelAr: string | null } },
  ): Promise<number> {
    const assignees = [...new Set(closed.flatMap((t) => t.assigneeUserIds))];
    if (assignees.length === 0) return 0;

    // 1. The people: who is ACTIVE, who is away with someone acting, and the actor's name.
    const now = new Date();
    const people = await this.prisma.user.findMany({
      where: { organizationId, id: { in: [...assignees, actorId] } },
      select: {
        id: true,
        name: true,
        status: true,
        outOfOfficeFrom: true,
        outOfOfficeTo: true,
        actingUserId: true,
        actingUser: { select: { status: true, organizationId: true } },
      },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    const toldFor = (userId: string): string | null => {
      const p = byId.get(userId);
      if (!p || p.status !== 'ACTIVE') return null;
      const away = !!p.outOfOfficeFrom && !!p.outOfOfficeTo && p.outOfOfficeFrom <= now && now <= p.outOfOfficeTo;
      if (away && p.actingUserId && p.actingUser?.status === 'ACTIVE' && p.actingUser.organizationId === organizationId) {
        return p.actingUserId;
      }
      return userId;
    };
    const perTask = closed.map((task) => ({
      task,
      readers: [...new Set(task.assigneeUserIds.map(toldFor).filter((id): id is string => id !== null && id !== actorId))],
    }));
    const readers = [...new Set(perTask.flatMap((t) => t.readers))];
    if (readers.length === 0) return 0;

    // 2. The record's name, and which readers may open it — together.
    const [named, mayOpen] = await Promise.all([this.recordName(organizationId, record), this.whoMayOpen(organizationId, record.objectType, readers)]);
    const link = named ? recordLinkTarget(record.objectType, record.objectId, named.committeeId) : null;
    const actorName = byId.get(actorId)?.name ?? '—';

    const rows = perTask.flatMap(({ task, readers: taskReaders }) =>
      taskReaders.map((userId) => {
        const sees = mayOpen.has(userId) && named !== null;
        const text = closedNoticeText({
          kind,
          task: { title: task.title, titleAr: task.titleAr },
          actorName,
          recordType: record.objectType,
          record: sees ? named : null,
          ...extra,
        });
        return {
          userId,
          titleEn: text.en,
          titleAr: text.ar,
          bodyEn: text.en,
          bodyAr: text.ar,
          // "Open record" — only for someone who may open it.
          objectType: sees && link ? link.objectType : null,
          objectId: sees && link ? link.objectId : null,
        };
      }),
    );
    // 3. One write for the whole move.
    return this.notifications.createInAppMany(rows, organizationId, `task-closed:${kind}`);
  }

  /** The record's name (and a change request's committee, for its link), or null. One read. */
  private async recordName(
    organizationId: string,
    record: { objectType: string; objectId: string },
  ): Promise<(Named & { committeeId: string | null }) | null> {
    const where = { id: record.objectId, organizationId };
    switch (record.objectType) {
      case 'COMMITTEE': {
        const c = await this.prisma.committee.findFirst({ where, select: { nameEn: true, nameAr: true } });
        return c ? { ...c, committeeId: null } : null;
      }
      case 'COMMITTEE_CHANGE_REQUEST': {
        const r = await this.prisma.committeeChangeRequest.findFirst({ where, select: { committeeId: true, committee: { select: { nameEn: true, nameAr: true } } } });
        return r ? { ...r.committee, committeeId: r.committeeId } : null;
      }
      case 'MEETING': {
        const m = await this.prisma.meeting.findFirst({ where, select: { title: true } });
        return m ? { nameEn: m.title, nameAr: null, committeeId: null } : null;
      }
      default:
        return null;
    }
  }

  /** Which of these readers hold the record type's view permission (ACC-228's rule). One read; a type with none: nobody. */
  private async whoMayOpen(organizationId: string, recordType: string, readers: string[]): Promise<Set<string>> {
    const key = RECORD_VIEW_PERMISSION[recordType];
    if (!key) return new Set();
    const [module, action] = key.split(':') as [string, string];
    const rows = await this.prisma.userRole.findMany({
      where: {
        userId: { in: readers },
        role: { organizationId, isActive: true, rolePermissions: { some: { permission: { module, action } } } },
      },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }
}
