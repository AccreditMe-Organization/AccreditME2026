import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { SetupConditionDetectors } from './setup-condition.detectors';
import { SetupConditionReconciler } from './setup-condition.reconciler';
import { SetupHealthProcessor } from './setup-health.processor';
import { SetupHealthService } from './setup-health.service';
import { SetupHealthController } from './setup-health.controller';

// ACC-82 — Setup health (SYSTEM-REFERENCE §13). Depends only on Prisma and the
// queue: the detectors read other modules' tables directly rather than calling
// their services, so this module adds no edge to the existing
// Tenant/Workflow/Task/Organization forwardRef cycles.
@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [SetupHealthController],
  providers: [
    SetupConditionDetectors,
    SetupConditionReconciler,
    SetupHealthProcessor,
    SetupHealthService,
  ],
})
export class SetupHealthModule {}
