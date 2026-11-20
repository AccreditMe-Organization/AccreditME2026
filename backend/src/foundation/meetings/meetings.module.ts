import { MeetingInviteesModule } from './invitees/meeting-invitees.module';
import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkingCalendarModule } from '../working-calendar/working-calendar.module';
import { MeetingsController } from './meetings.controller';
import { MeetingMinutesController } from './meeting-minutes.controller';
import { MeetingsService } from './meetings.service';
import { MeetingPeopleService } from './meeting-people.service';
import { MeetingAgendaService } from './meeting-agenda.service';
import { MeetingFilesService } from './meeting-files.service';
import { MeetingClashService } from './meeting-clash.service';
import { MeetingFormChoicesService } from './meeting-form-choices.service';
import { LookupModule } from '../lookup/lookup.module';
import { MeetingMinutesService } from './meeting-minutes.service';
import { MeetingReviewService } from './meeting-review.service';
import { MeetingSeriesService } from './meeting-series.service';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { TaskModule } from '../task/task.module';
import { AiModule } from '../ai/ai.module';
import { MeetingAiController } from './ai/meeting-ai.controller';
import { MeetingAiService } from './ai/meeting-ai.service';

// ACC-316 PR 3a — one meeting's record. TenantModule for ObjectVisibilityService
// (forwardRef, as CommitteesModule takes it); WorkflowModule for the instance
// start and the stage rules. NotificationService is @Global (NotificationModule).
@Module({
  // ACC-316 PR 7b — TaskModule for TaskAdmissionService (the open actions' task links). TaskModule never imports this module, so no forwardRef.
  // ACC-322 — AiModule for AiService, the one AI gateway (Meetings AI). AiModule imports nothing of meetings.
  imports: [PrismaModule, forwardRef(() => TenantModule), forwardRef(() => LookupModule), WorkflowModule, WorkingCalendarModule, MeetingInviteesModule, FileStorageModule, TaskModule, AiModule],
  controllers: [MeetingsController, MeetingMinutesController, MeetingAiController],
  providers: [
    MeetingsService,
    MeetingPeopleService,
    MeetingAgendaService,
    MeetingFilesService,
    MeetingClashService,
    MeetingMinutesService,
    MeetingReviewService,
    MeetingSeriesService,
    MeetingFormChoicesService,
    MeetingAiService,
  ],
  exports: [MeetingsService],
})
export class MeetingsModule {}
