import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NotificationModule } from '../../notification/notification.module';
import { WorkingCalendarModule } from '../../working-calendar/working-calendar.module';
import { StageRulesModule } from '../../workflow/stage-rules.module';
import { MeetingInviteeSyncService } from './meeting-invitee-sync.service';

/**
 * ACC-316 PR 3b — the invitee sync, on its own, importing the modules that own
 * what it uses (lane B's review: no private copies), so it shares their single
 * instances. None of them imports anything that leads back here except through
 * TenantModule, hence the forwardRef on NotificationModule, the same edge every
 * module takes to it. The committee, user and auth modules and the SLA sweep
 * import this module with no cycle of their own.
 */
@Module({
  imports: [PrismaModule, forwardRef(() => NotificationModule), WorkingCalendarModule, StageRulesModule],
  providers: [MeetingInviteeSyncService],
  exports: [MeetingInviteeSyncService],
})
export class MeetingInviteesModule {}
