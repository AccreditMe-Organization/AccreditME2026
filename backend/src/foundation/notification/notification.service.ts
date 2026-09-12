import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { INotification } from './interfaces/notification.interface';
import {
  IPaginatedResponse,
  paginated,
} from '../../common/interfaces/paginated-response.interface';
import { SortWhitelist, toSkipTake } from '../../common/utils/sort-whitelist';

export interface GetNotificationsOptions {
  status?: 'UNREAD' | 'READ' | 'DISMISSED';
  // ACC-78 — was limit/offset. Page-based now, matching every other list.
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

// The inbox's sortable columns. `createdAt desc` is the fallback because a
// notification inbox is newest-first by nature; the other two exist so the
// shared list component's sort menu has something real to offer.
const NOTIFICATION_SORT = new SortWhitelist(['createdAt', 'status', 'titleEn'] as const, {
  column: 'createdAt',
  dir: 'desc',
});

// The cross-cutting service CLAUDE.md refers to in "Event-driven —
// modules emit events, NotificationService subscribes. Never hardcode
// notification logic inside modules." This step ships create() as a plain
// injected method call, not a pub/sub event bus — see plan Section 8/12.
// TODO(event-bus): migrate to event emitter if/when NotificationService
// moves to a pub/sub model.
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    @InjectQueue('email-delivery') private readonly emailDeliveryQueue: Queue,
  ) {}

  // dto.userId is re-validated against organizationId here — the layer
  // boundary, not just the one call site that currently passes it
  // unscoped (workflow.service.ts's SEND_NOTIFICATION action, resolving a
  // SPECIFIC_USER-strategy stage's assigneeUserId with no tenant check of
  // its own — see ACC-17). Every current and future caller is protected by
  // fixing it here, not by re-auditing each caller individually.
  async create(dto: CreateNotificationDto, organizationId: string): Promise<INotification> {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, organizationId },
    });
    if (!user) {
      throw new NotFoundException('Notification target user not found in this tenant');
    }

    const notification = await this.prisma.notification.create({
      data: {
        organizationId,
        userId: dto.userId,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr ?? null,
        bodyEn: dto.bodyEn,
        bodyAr: dto.bodyAr ?? null,
        channel: dto.channel ?? 'IN_APP',
        objectType: dto.objectType ?? null,
        objectId: dto.objectId ?? null,
      },
    });

    if (notification.channel === 'EMAIL' || notification.channel === 'BOTH') {
      await this.emailDeliveryQueue.add('send-email', {
        notificationId: notification.id,
        organizationId,
      });
    }

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'Notification',
      objectId: notification.id,
      tenantId: organizationId,
      after: notification,
    });

    return notification;
  }

  // Personal inbox — always scoped to the CALLING user, never another
  // user's, regardless of any permission the caller holds (see plan
  // Business Rules — Permission Model for the Personal Inbox).
  // ACC-78 — migrated onto the shared page-based envelope. This was the ONLY
  // paginating endpoint in the product, and it used limit/offset and returned
  // no total — so a caller could fetch a page and still not know whether more
  // existed, which is why nothing could render a paginator against it.
  //
  // Migrated first among the endpoints deliberately: it is the one with real
  // pagination already, so it proves the envelope against live behaviour before
  // other endpoints depend on it.
  async getForUser(
    userId: string,
    organizationId: string,
    options: GetNotificationsOptions = {},
  ): Promise<IPaginatedResponse<INotification>> {
    const { skip, take, page, pageSize } = toSkipTake(options.page, options.pageSize, 20);

    const where = {
      userId,
      organizationId,
      ...(options.status ? { status: options.status } : {}),
    };

    // Count and page in parallel — two round trips either way, but not
    // sequentially. At ~110ms each (SYSTEM-REFERENCE §8) that halves the wait.
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: NOTIFICATION_SORT.resolve(options.sortBy, options.sortDir),
        take,
        skip,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paginated(data, total, page, pageSize);
  }

  async getUnreadCount(userId: string, organizationId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, organizationId, status: 'UNREAD' },
    });
  }

  // Ownership check, not just tenant scope — a notification belonging to a
  // different user in the SAME organization must also be rejected.
  async markRead(id: string, userId: string, organizationId: string): Promise<INotification> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Notification not found');
    }

    const notification = await this.prisma.notification.update({
      where: { id },
      data: { status: 'READ', readAt: new Date() },
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Notification',
      objectId: notification.id,
      actorId: userId,
      tenantId: organizationId,
      before: existing,
      after: notification,
    });

    return notification;
  }

  async markAllRead(userId: string, organizationId: string): Promise<{ count: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, organizationId, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });

    // One summary entry for the whole bulk action, not one per row — avoids
    // audit log bloat from a single "mark all read" click (see plan Business
    // Rules — Audit Log).
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Notification',
      actorId: userId,
      tenantId: organizationId,
      metadata: { bulkMarkAllRead: true, count },
    });

    return { count };
  }
}
