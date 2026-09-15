import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { SetupConditionDetectors } from './setup-condition.detectors';
import { SetupConditionReconciler } from './setup-condition.reconciler';
import { SetupHealthProcessor } from './setup-health.processor';

// ACC-82 — Setup health (SYSTEM-REFERENCE §13). Depends only on Prisma and the
// queue: the detectors read other modules' tables directly rather than calling
// their services, so this module adds no edge to the existing
// Tenant/Workflow/Task/Organization forwardRef cycles.
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [
    SetupConditionDetectors,
    SetupConditionReconciler,
    SetupHealthProcessor,
  ],
})
export class SetupHealthModule {}
