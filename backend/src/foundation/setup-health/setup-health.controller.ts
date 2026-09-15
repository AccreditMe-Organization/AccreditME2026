import { Controller, Get, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { SETUP_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { SetupHealthService } from './setup-health.service';
import {
  ISetupHealth,
  ISetupHealthSummary,
} from './interfaces/setup-health.interface';

// ACC-82 — SYSTEM-REFERENCE §13.6. Read-only: conditions are derived state, so
// there is no dismiss, snooze or mark-read endpoint to add later. Both routes
// need setup:view; whether a row's Fix is offered depends on the destination's
// own permission and is decided by the page, which already holds the user's
// permissions.
@Controller('setup-health')
@UseGuards(TenantGuard, PermissionGuard)
export class SetupHealthController {
  constructor(private readonly setupHealthService: SetupHealthService) {}

  @Get()
  @Permissions(SETUP_PERMISSIONS.VIEW)
  getHealth(@CurrentTenant() tenantId: string): Promise<ISetupHealth> {
    return this.setupHealthService.getHealth(tenantId);
  }

  @Get('summary')
  @Permissions(SETUP_PERMISSIONS.VIEW)
  getSummary(@CurrentTenant() tenantId: string): Promise<ISetupHealthSummary> {
    return this.setupHealthService.getSummary(tenantId);
  }
}
