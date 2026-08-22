import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { OrganizationModule } from '../organization/organization.module';
import { OrgPositionController } from './org-position.controller';
import { OrgPositionService } from './org-position.service';

// Not @Global() — modules that need validateEscalationTarget() (this step's
// TaskModule, and Steps 10/11/17/18/19 later) import it explicitly, same
// reasoning as TaskModule and WorkflowModule.
//
// ACC-40 Section 2.5.1 — OrganizationModule import (for
// OrganizationService.refreshOrgUnitHeadVacancy(), called from
// deactivatePosition()) needs forwardRef(): TenantModule already
// forwardRef()s THIS module, and OrganizationModule already forwardRef()s
// TenantModule — the new edge closes OrgPositionModule -> OrganizationModule
// -> TenantModule -> OrgPositionModule. Same discipline as every other
// cross-module edge in this codebase touching TenantModule's cycle.
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule), forwardRef(() => OrganizationModule)],
  controllers: [OrgPositionController],
  providers: [OrgPositionService],
  exports: [OrgPositionService],
})
export class OrgPositionModule {}
