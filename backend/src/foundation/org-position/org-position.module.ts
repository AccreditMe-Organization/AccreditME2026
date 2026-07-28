import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { OrgPositionController } from './org-position.controller';
import { OrgPositionService } from './org-position.service';

// Not @Global() — modules that need validateEscalationTarget() (this step's
// TaskModule, and Steps 10/11/17/18/19 later) import it explicitly, same
// reasoning as TaskModule and WorkflowModule.
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule)],
  controllers: [OrgPositionController],
  providers: [OrgPositionService],
  exports: [OrgPositionService],
})
export class OrgPositionModule {}
