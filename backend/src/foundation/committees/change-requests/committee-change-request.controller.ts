import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { COMMITTEES_PERMISSIONS } from '../../../common/constants/permissions';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../../common/decorators/current-user-permissions.decorator';
import {
  CommitteeChangeRequestService,
  IChangeRequest,
  IOpenChangeRequest,
  IChangeRequestPage,
  IChangeRequestPreview,
} from './committee-change-request.service';
import {
  ChangeRequestListQueryDto,
  CreateChangeRequestDto,
  PreviewChangeRequestDto,
  RejectChangeRequestDto,
  ReturnChangeRequestDto,
  UpdateChangeRequestDto,
} from './dto/change-request.dto';

// ACC-239 — committee change requests. Every route needs committees:view (a
// request is part of its committee, ACC-101); what the caller may DO to a
// request — edit_details to raise and edit one, approve to decide one, being
// its requester — is decided in the service, which knows the request.

/** A committee's requests: its list, its open one, the preview, and raising one. */
@Controller('committees/:committeeId/change-requests')
@UseGuards(TenantGuard, PermissionGuard)
export class CommitteeChangeRequestsByCommitteeController {
  constructor(private readonly requests: CommitteeChangeRequestService) {}

  @Get()
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  list(
    @Param('committeeId') committeeId: string,
    @Query() query: ChangeRequestListQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IChangeRequestPage> {
    return this.requests.list(committeeId, query, tenantId, { userId, permissions });
  }

  @Get('open')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  open(
    @Param('committeeId') committeeId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IOpenChangeRequest> {
    return this.requests.openSummary(committeeId, tenantId, { userId, permissions });
  }

  @Post('preview')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  preview(
    @Param('committeeId') committeeId: string,
    @Body() dto: PreviewChangeRequestDto,
    @CurrentTenant() tenantId: string,
  ): Promise<IChangeRequestPreview> {
    return this.requests.preview(committeeId, dto.changes, tenantId);
  }

  @Post()
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  create(
    @Param('committeeId') committeeId: string,
    @Body() dto: CreateChangeRequestDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IChangeRequest> {
    return this.requests.create(committeeId, dto, tenantId, { userId, permissions });
  }
}

/** One request, and what may be done to it. */
@Controller('committee-change-requests')
@UseGuards(TenantGuard, PermissionGuard)
export class CommitteeChangeRequestsController {
  constructor(private readonly requests: CommitteeChangeRequestService) {}

  // Before ':id', so the path is not read as an id.
  @Get('awaiting-decision')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  awaitingDecision(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IChangeRequest[]> {
    return this.requests.awaitingDecision(tenantId, { userId, permissions });
  }

  @Get(':id')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  getOne(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IChangeRequest> {
    return this.requests.getOne(id, tenantId, { userId, permissions });
  }

  @Patch(':id')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateChangeRequestDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IChangeRequest> {
    return this.requests.update(id, dto, tenantId, { userId, permissions });
  }

  @Post(':id/submit')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  submit(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IChangeRequest> {
    return this.requests.submit(id, tenantId, { userId, permissions });
  }

  @Post(':id/withdraw')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  withdraw(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IChangeRequest> {
    return this.requests.withdraw(id, tenantId, { userId, permissions });
  }

  @Post(':id/approve')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  approve(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IChangeRequest> {
    return this.requests.approve(id, tenantId, { userId, permissions });
  }

  @Post(':id/return')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  returnForChanges(
    @Param('id') id: string,
    @Body() dto: ReturnChangeRequestDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IChangeRequest> {
    return this.requests.returnForChanges(id, dto, tenantId, { userId, permissions });
  }

  @Post(':id/reject')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectChangeRequestDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IChangeRequest> {
    return this.requests.reject(id, dto, tenantId, { userId, permissions });
  }
}
