import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { UserModule } from '../user/user.module';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { OrgUnitHeadService } from './org-unit-head.service';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    // ACC-40 Section 2.3 — OrgUnitHeadService calls
    // UserService.validatePositionAssignment() directly (declareHandover()'s
    // isDeclaredHandoverBypass). forwardRef() since UserModule transitively
    // imports TenantModule, which this module already imports too — same
    // resolved-cycle shape as every other cross-module edge in this
    // codebase touching TenantModule.
    forwardRef(() => UserModule),
  ],
  controllers: [OrganizationController],
  providers: [OrganizationService, OrgUnitHeadService],
  exports: [OrganizationService, OrgUnitHeadService],
})
export class OrganizationModule {}
