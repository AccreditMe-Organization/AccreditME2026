import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { QueueModule } from '../../../common/queue/queue.module';
import { workersEnabled } from '../../../common/queue/workers.config';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { LookupService } from '../../lookup/lookup.service';
import { NotificationService } from '../../notification/notification.service';
import { CommitteeTransferNoticeService } from './committee-transfer-notice.service';
import { CommitteeTransferNoticeProcessor } from './committee-transfer-notice.processor';

/**
 * ACC-297 — the committee notice after a transfer, in a module of its own so
 * UserModule can import it without a cycle.
 *
 * It imports only PrismaModule and QueueModule, which import nothing back. It
 * provides its own LookupService, NotificationService and AuditLogService (each
 * needs only Prisma, the audit log and the email queue, and keeps no state)
 * instead of importing LookupModule or NotificationModule: both reach TenantModule,
 * which reaches UserModule through OrgPositionModule and OrganizationModule, and
 * importing them here would close a cycle back to UserModule. So no forwardRef.
 *
 * The processor consumes the shared queue, so it is registered only where
 * workers run (ACC-92).
 */
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [
    CommitteeTransferNoticeService,
    LookupService,
    NotificationService,
    AuditLogService,
    ...(workersEnabled() ? [CommitteeTransferNoticeProcessor] : []),
  ],
  exports: [CommitteeTransferNoticeService],
})
export class CommitteeTransferNoticeModule {}
