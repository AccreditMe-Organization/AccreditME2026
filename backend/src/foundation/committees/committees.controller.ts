import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { COMMITTEES_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommitteesService } from './committees.service';
import { CreateCommitteeDto } from './dto/create-committee.dto';
import { UpdateCommitteeDto } from './dto/update-committee.dto';
import { AddCommitteeMemberDto } from './dto/add-committee-member.dto';
import { ChangeCommitteeMemberRoleDto } from './dto/change-committee-member-role.dto';
import { RemoveCommitteeMemberDto } from './dto/remove-committee-member.dto';
import {
  ICommittee,
  ICommitteeListItem,
  ICommitteeMember,
  ICommitteeMemberRow,
  ICommitteeMembershipEvent,
  ICommitteePage,
  ISubCommitteeRow,
} from './interfaces/committee.interface';
import { CommitteeListsService } from './committee-lists.service';
import { CommitteeMembersPageQueryDto, SubCommitteesQueryDto } from './dto/committee-list-query.dto';

// Lifecycle transitions (FORMATION -> ... -> DISSOLVED) go through the
// already-generic WorkflowController (GET/POST /workflows/instances...),
// not a committee-specific wrapper — the 6-stage COMMITTEE workflow
// already exists (ACC-9) and needs no committee-specific endpoint shape.
@Controller('committees')
@UseGuards(TenantGuard, PermissionGuard)
export class CommitteesController {
  constructor(
    private readonly committeesService: CommitteesService,
    private readonly lists: CommitteeListsService,
  ) {}

  @Get()
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  listCommittees(@CurrentTenant() tenantId: string): Promise<ICommitteeListItem[]> {
    return this.committeesService.listCommittees(tenantId);
  }

  @Get(':id')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  getCommitteeById(@Param('id') id: string, @CurrentTenant() tenantId: string): Promise<ICommittee> {
    return this.committeesService.getCommitteeById(id, tenantId);
  }

  @Post()
  @Permissions(COMMITTEES_PERMISSIONS.CREATE)
  createCommittee(
    @Body() dto: CreateCommitteeDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ICommittee> {
    return this.committeesService.createCommittee(dto, tenantId, userId);
  }

  @Patch(':id')
  @Permissions(COMMITTEES_PERMISSIONS.EDIT_DETAILS)
  updateCommittee(
    @Param('id') id: string,
    @Body() dto: UpdateCommitteeDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ICommittee> {
    return this.committeesService.updateCommittee(id, dto, tenantId, userId);
  }

  @Get(':id/members')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  listMembers(
    @Param('id') committeeId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<ICommitteeMember[]> {
    return this.committeesService.listMembers(committeeId, tenantId);
  }

  // ACC-230 — the Members panel and its See all list: searched, sorted and
  // paged on the server. The bare array above stays for its other callers.
  @Get(':id/members/page')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  membersPage(
    @Param('id') committeeId: string,
    @Query() query: CommitteeMembersPageQueryDto,
    @CurrentTenant() tenantId: string,
  ): Promise<ICommitteePage<ICommitteeMemberRow>> {
    return this.lists.members(committeeId, query, tenantId);
  }

  // ACC-230 — the Sub-committees panel and its See all list.
  @Get(':id/sub-committees')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  subCommittees(
    @Param('id') committeeId: string,
    @Query() query: SubCommitteesQueryDto,
    @CurrentTenant() tenantId: string,
  ): Promise<ICommitteePage<ISubCommitteeRow>> {
    return this.lists.subCommittees(committeeId, query, tenantId);
  }

  @Get(':id/membership-events')
  @Permissions(COMMITTEES_PERMISSIONS.VIEW)
  listMembershipEvents(
    @Param('id') committeeId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<ICommitteeMembershipEvent[]> {
    return this.committeesService.listMembershipEvents(committeeId, tenantId);
  }

  @Post(':id/members')
  @Permissions(COMMITTEES_PERMISSIONS.ADD_MEMBER)
  addMember(
    @Param('id') committeeId: string,
    @Body() dto: AddCommitteeMemberDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ICommitteeMember> {
    return this.committeesService.addMember(committeeId, dto, tenantId, userId);
  }

  @Patch(':id/members/:memberId')
  @Permissions(COMMITTEES_PERMISSIONS.CHANGE_MEMBER_ROLE)
  changeMemberRole(
    @Param('id') committeeId: string,
    @Param('memberId') memberId: string,
    @Body() dto: ChangeCommitteeMemberRoleDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ICommitteeMember> {
    return this.committeesService.changeMemberRole(committeeId, memberId, dto, tenantId, userId);
  }

  @Delete(':id/members/:memberId')
  @Permissions(COMMITTEES_PERMISSIONS.REMOVE_MEMBER)
  removeMember(
    @Param('id') committeeId: string,
    @Param('memberId') memberId: string,
    @Body() dto: RemoveCommitteeMemberDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.committeesService.removeMember(committeeId, memberId, dto, tenantId, userId);
  }
}
