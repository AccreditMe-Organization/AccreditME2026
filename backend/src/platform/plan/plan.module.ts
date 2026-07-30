import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../../foundation/tenant/tenant.module';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';

// TenantModule imported for AuditLogService — it isn't @Global(), and
// TenantModule is the module that provides + exports it (same pattern every
// other module needing AuditLogService follows).
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule)],
  controllers: [PlanController],
  providers: [PlanService],
  exports: [PlanService],
})
export class PlanModule {}
