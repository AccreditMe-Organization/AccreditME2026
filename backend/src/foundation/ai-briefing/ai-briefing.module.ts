import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { TaskModule } from '../task/task.module';
import { WorkingCalendarModule } from '../working-calendar/working-calendar.module';
import { AiBriefingController } from './ai-briefing.controller';
import { AiBriefingService } from './ai-briefing.service';

/**
 * ACC-198 — the on-demand AI briefing on Home. Calls the model only through
 * AiService (ACC-194's gateway); NotificationService comes from the @Global
 * NotificationModule. Nothing here is scheduled, so check:worker-gate is
 * unchanged.
 */
@Module({
  imports: [PrismaModule, AiModule, TaskModule, WorkingCalendarModule],
  controllers: [AiBriefingController],
  providers: [AiBriefingService],
})
export class AiBriefingModule {}
