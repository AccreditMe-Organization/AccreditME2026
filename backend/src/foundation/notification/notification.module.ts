import { Global, Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { TenantModule } from '../tenant/tenant.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationEmailProcessor } from './notification-email.processor';
import { workersEnabled } from '../../common/queue/workers.config';

// @Global() — unlike WorkflowModule, every future functional module in
// Phase 2 (Documents, Incidents, Audits, CAPA, Meetings, Committees,
// Standards, KPI) needs to inject NotificationService directly per CLAUDE.md
// ("all future modules that generate notifications"). Same rationale as
// RolesModule being @Global() for PERMISSION_RESOLVER.
@Global()
@Module({
  imports: [PrismaModule, QueueModule, forwardRef(() => TenantModule)],
  controllers: [NotificationController],
  // ACC-92 — email-delivery has no schedule, so a local process never STEALS
  // a tick here. It is gated anyway because the consequence is worse than a
  // stolen sweep: a laptop consuming this queue sends real mail, from the
  // deployment's own backlog, over the developer's network. NotificationService
  // stays registered — producing a notification is API work, not worker work.
  providers: [NotificationService, ...(workersEnabled() ? [NotificationEmailProcessor] : [])],
  exports: [NotificationService],
})
export class NotificationModule {}
