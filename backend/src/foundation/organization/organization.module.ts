import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { UserModule } from '../user/user.module';
import { RolesModule } from '../roles/roles.module';
import { NotificationModule } from '../notification/notification.module';
import { OrganizationController } from './organization.controller';
import { OrgUnitHeadController } from './org-unit-head.controller';
import { OrganizationService } from './organization.service';
import { OrgUnitHeadService } from './org-unit-head.service';

@Module({
  imports: [
    PrismaModule,
    // ACC-40 Section 2.3 — forwardRef() now required on THIS edge too:
    // WorkflowModule imports this module (forwardRef, for
    // SlaMonitorProcessor's OrgUnitHeadService, Phase 5 commit 5), and
    // TenantModule already imports WorkflowModule (forwardRef) — a real,
    // confirmed circular *file-level* import chain (TenantModule →
    // WorkflowModule → OrganizationModule → TenantModule), not just a
    // theoretical DI-graph one. A plain (non-forwardRef) TenantModule
    // import here previously worked only because OrganizationModule was a
    // leaf in that graph; it no longer is. Confirmed the hard way: `nest
    // start` failed with "UndefinedModuleException ... module at index [1]
    // ... is undefined" before this fix — the same edge OrgPositionModule
    // already wraps for the identical reason.
    forwardRef(() => TenantModule),
    // ACC-40 Section 2.3 — OrgUnitHeadService calls
    // UserService.validatePositionAssignment() directly (declareHandover()'s
    // isDeclaredHandoverBypass). forwardRef() since UserModule transitively
    // imports TenantModule, which this module already imports too — same
    // resolved-cycle shape as every other cross-module edge in this
    // codebase touching TenantModule.
    forwardRef(() => UserModule),
    // ACC-40 Section 2.6.4/2.6.5 — OrgUnitHeadService injects RoleService
    // directly for Acting Head's grant/revoke. RolesModule is @Global()
    // (no forwardRef needed for DI to resolve RoleService), but this edge
    // closes yet another cycle through the same TenantModule graph as
    // every edge above it: OrganizationModule -> RolesModule -> TenantModule
    // (forwardRef, in roles.module.ts) -> WorkflowModule (forwardRef, in
    // tenant.module.ts) -> OrganizationModule (forwardRef, in
    // workflow.module.ts). forwardRef() here too, verified via a real
    // `nest start` boot, not just tsc/jest — same standard as every other
    // edge in this file.
    forwardRef(() => RolesModule),
  ],
  controllers: [OrganizationController, OrgUnitHeadController],
  providers: [OrganizationService, OrgUnitHeadService],
  exports: [OrganizationService, OrgUnitHeadService],
})
export class OrganizationModule {}
