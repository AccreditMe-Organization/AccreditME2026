import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { COMMITTEES_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { CommitteesService } from './committees.service';
import { CreateCommitteeDto } from './dto/create-committee.dto';
import { UpdateCommitteeDto } from './dto/update-committee.dto';
import { AddCommitteeMemberDto } from './dto/add-committee-member.dto';
import { ChangeCommitteeMemberRoleDto } from './dto/change-committee-member-role.dto';
import { RemoveCommitteeMemberDto } from './dto/remove-committee-member.dto';
import { ICommittee, ICommitteeMember, ICommitteeMembershipEvent } from './interfaces/committee.interface';

// Lifecycle transitions (FORMATION -> ... -> DISSOLVED) go through the
// already-generic WorkflowController (GET/POST /workflows/instances...),
// not a committee-specific wrapper — the 6-stage COMMITTEE workflow
// already exists (ACC-9) and needs no committee-specific endpoint shape.
@Controller('committees')
@UseGuards(TenantGuard, PermissionGuard)
export class CommitteesController {
  constructor(private readonly committeesService: CommitteesService) {}

  @Get()
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  listCommittees(@CurrentTenant() tenantId: string): Promise<ICommittee[]> {
    return this.committeesService.listCommittees(tenantId);
  }

  @Get(':id')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  getCommitteeById(@Param('id') id: string, @CurrentTenant() tenantId: string): Promise<ICommittee> {
    return this.committeesService.getCommitteeById(id, tenantId);
  }

  @Post()
  @Permissions(COMMITTEES_PERMISSIONS.MANAGE)
  createCommittee(
    @Body() dto: CreateCommitteeDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ICommittee> {
    return this.committeesService.createCommittee(dto, tenantId, userId);
  }

  // No @Permissions() decorator here on purpose — ACC-28. The required
  // authority is dynamic (flat committees:manage OR active Chairman of
  // THIS specific committee), not a fixed string PermissionGuard could
  // check; CommitteesService.assertCommitteeAuthority() performs the
  // dynamic check itself using userPermissions threaded in below. Same
  // deliberate exception already established for
  // WorkflowController.triggerTransition()/submitApproval().
  @Patch(':id')
  updateCommittee(
    @Param('id') id: string,
    @Body() dto: UpdateCommitteeDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() userPermissions: string[],
  ): Promise<ICommittee> {
    return this.committeesService.updateCommittee(id, dto, tenantId, userId, userPermissions);
  }

  @Get(':id/members')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  listMembers(
    @Param('id') committeeId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<ICommitteeMember[]> {
    return this.committeesService.listMembers(committeeId, tenantId);
  }

  @Get(':id/membership-events')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  listMembershipEvents(
    @Param('id') committeeId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<ICommitteeMembershipEvent[]> {
    return this.committeesService.listMembershipEvents(committeeId, tenantId);
  }

  // Same ACC-28 exception as updateCommittee above.
  @Post(':id/members')
  addMember(
    @Param('id') committeeId: string,
    @Body() dto: AddCommitteeMemberDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() userPermissions: string[],
  ): Promise<ICommitteeMember> {
    return this.committeesService.addMember(committeeId, dto, tenantId, userId, userPermissions);
  }

  // Same ACC-28 exception as updateCommittee above.
  @Patch(':id/members/:memberId')
  changeMemberRole(
    @Param('id') committeeId: string,
    @Param('memberId') memberId: string,
    @Body() dto: ChangeCommitteeMemberRoleDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() userPermissions: string[],
  ): Promise<ICommitteeMember> {
    return this.committeesService.changeMemberRole(committeeId, memberId, dto, tenantId, userId, userPermissions);
  }

  // Same ACC-28 exception as updateCommittee above.
  @Delete(':id/members/:memberId')
  removeMember(
    @Param('id') committeeId: string,
    @Param('memberId') memberId: string,
    @Body() dto: RemoveCommitteeMemberDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() userPermissions: string[],
  ): Promise<void> {
    return this.committeesService.removeMember(committeeId, memberId, dto, tenantId, userId, userPermissions);
  }
}
