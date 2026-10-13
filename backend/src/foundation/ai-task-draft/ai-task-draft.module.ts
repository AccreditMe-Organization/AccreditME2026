import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { AiModule } from '../ai/ai.module';
import { TaskDraftService } from './task-draft.service';

/**
 * ACC-197 — AI task drafting. No controller of its own: the task module owns
 * the routes (POST /tasks/draft sits beside POST /tasks), and calls
 * TaskDraftService. ObjectVisibilityService is provided here directly, as the
 * summary module provides AuditLogService: it needs only PrismaService, and
 * importing TenantModule would close a cycle through the task module.
 */
@Module({
  imports: [PrismaModule, AiModule],
  providers: [TaskDraftService, ObjectVisibilityService],
  exports: [TaskDraftService],
})
export class AiTaskDraftModule {}
