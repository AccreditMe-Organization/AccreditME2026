import { Global, Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { TenantModule } from '../tenant/tenant.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationEmailProcessor } from './notification-email.processor';

// @Global() — unlike WorkflowModule, every future functional module in
// Phase 2 (Documents, Incidents, Audits, CAPA, Meetings, Committees,
// Standards, KPI) needs to inject NotificationService directly per CLAUDE.md
// ("all future modules that generate notifications"). Same rationale as
// RolesModule being @Global() for PERMISSION_RESOLVER.
@Global()
@Module({
  imports: [PrismaModule, QueueModule, forwardRef(() => TenantModule)],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationEmailProcessor],
  exports: [NotificationService],
})
export class NotificationModule {}
