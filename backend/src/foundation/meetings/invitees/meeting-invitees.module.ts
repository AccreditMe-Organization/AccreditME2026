import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { QueueModule } from '../../../common/queue/queue.module';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { NotificationService } from '../../notification/notification.service';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { StageRulesService } from '../../workflow/stage-rules.service';
import { MeetingInviteeSyncService } from './meeting-invitee-sync.service';

/**
 * ACC-316 PR 3b — the invitee sync, on its own (ACC-297's shape): only Prisma
 * and the queues are imported, and the stateless services it needs are its own,
 * so the committee, user and auth modules and the SLA sweep import it with no
 * cycle and no forwardRef.
 */
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [MeetingInviteeSyncService, NotificationService, AuditLogService, WorkingCalendarService, StageRulesService],
  exports: [MeetingInviteeSyncService],
})
export class MeetingInviteesModule {}
