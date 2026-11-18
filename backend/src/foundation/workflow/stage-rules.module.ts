import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StageRulesService } from './stage-rules.service';

/**
 * ACC-316 PR 3b — StageRulesService on its own (it injects only Prisma), so a
 * module that WorkflowModule itself imports (the meeting invitee sync) can use
 * the one instance without a cycle. WorkflowModule imports and re-exports it,
 * so every module that read it through WorkflowModule still does.
 */
@Module({
  imports: [PrismaModule],
  providers: [StageRulesService],
  exports: [StageRulesService],
})
export class StageRulesModule {}
