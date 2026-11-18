import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

// ACC-316 PR 3a — one meeting's record. TenantModule for ObjectVisibilityService
// (forwardRef, as CommitteesModule takes it); WorkflowModule for the instance
// start and the stage rules. NotificationService is @Global (NotificationModule).
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule), WorkflowModule],
  controllers: [MeetingsController],
  providers: [MeetingsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
