import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { QueueModule } from '../../../common/queue/queue.module';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { LookupService } from '../../lookup/lookup.service';
import { NotificationService } from '../../notification/notification.service';
import { CommitteeSeatDepartureService } from './committee-seat-departure.service';

/**
 * ACC-306 — a deactivated person's committee seats, in a module of its own so
 * UserModule can import it without a cycle. The same shape as
 * CommitteeTransferNoticeModule (ACC-297): it imports only PrismaModule and
 * QueueModule (NotificationService's email queue), and provides its own
 * stateless LookupService, NotificationService and AuditLogService, because
 * LookupModule and NotificationModule reach TenantModule, which reaches
 * UserModule. So no forwardRef.
 */
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [CommitteeSeatDepartureService, LookupService, NotificationService, AuditLogService],
  exports: [CommitteeSeatDepartureService],
})
export class CommitteeSeatDepartureModule {}
