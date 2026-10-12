import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LookupModule } from '../lookup/lookup.module';
import { RolesModule } from '../roles/roles.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { OrgPositionModule } from '../org-position/org-position.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { AUTH_PROVIDER } from '../../providers/auth/auth.provider';
import { BetterAuthProvider } from '../../providers/auth/better-auth.provider';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => LookupModule),
    forwardRef(() => RolesModule),
    forwardRef(() => WorkflowModule),
    forwardRef(() => OrgPositionModule),
  ],
  controllers: [TenantController],
  providers: [
    TenantService,
    AuditLogService,
    DelegationLabelService,
    ObjectVisibilityService,
    { provide: AUTH_PROVIDER, useClass: BetterAuthProvider },
  ],
  exports: [
    TenantService,
    AuditLogService,
    DelegationLabelService,
    ObjectVisibilityService,
    AUTH_PROVIDER,
  ],
})
export class TenantModule {}
