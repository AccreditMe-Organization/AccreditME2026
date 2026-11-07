import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import {
  ICommittee,
  ICommitteeDetail,
  ICommitteeFormChoices,
  ICommitteeListItem,
  ICommitteeMember,
  ICommitteeMemberRow,
  ICommitteeMembershipEventRow,
  ICommitteePage,
  IMyCommittees,
  ISubCommitteeRow,
} from './interfaces/committee.interface';
import { CommitteeListsService } from './committee-lists.service';
import { CommitteeFormChoicesService } from './committee-form-choices.service';
import { CommitteeHomeService } from './committee-home.service';
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
    private readonly formChoices: CommitteeFormChoicesService,
    private readonly home: CommitteeHomeService,
  ) {}

  // ACC-281 — no route permission: committees:view lists every committee, anyone
  // else only their own (an empty list for a non-member). Decided in the service.
  @Get()
  listCommittees(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ICommitteeListItem[]> {
    return this.committeesService.listCommittees(tenantId, { id: userId, permissions });
  }

  // ACC-255 (plan §10.5) — what the create and edit dialogs choose from, for
  // anyone who may create OR edit a committee (the guard admits either), so
  // neither needs lookups:view or org:view. Declared ABOVE ':id' so
  // 'form-choices' is not read as an id.
  @Get('form-choices')
  @Permissions(COMMITTEES_PERMISSIONS.CREATE, COMMITTEES_PERMISSIONS.EDIT_DETAILS)
  getFormChoices(@CurrentTenant() tenantId: string): Promise<ICommitteeFormChoices> {
    return this.formChoices.forOrganization(tenantId);
  }

  // ACC-279 — the caller's own committees, for Home. Deliberately NO @Permissions:
  // it answers only for the caller's own memberships, and being a member is the
  // entitlement (ACC-101's self-scoped rule, like GET /tasks/my-tasks). PermissionGuard
  // still runs and passes with no metadata; TenantGuard still authenticates. Declared
  // ABOVE ':id' so 'mine' is not read as an id.
  @Get('mine')
  getMine(@CurrentTenant() tenantId: string, @CurrentUser() userId: string): Promise<IMyCommittees> {
    return this.home.mine(tenantId, userId);
  }

  // ACC-281 — no route permission: committees:view OR an active member of the
  // committee, decided in the service; anyone else gets today's 403.
  @Get(':id')
  getCommitteeById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ICommitteeDetail> {
    return this.committeesService.getCommitteeDetail(id, tenantId, { id: userId, permissions });
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
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ICommittee> {
    return this.committeesService.updateCommittee(id, dto, tenantId, userId, permissions);
  }

  // ACC-281 — no route permission: committees:view OR an active member of the
  // committee, decided in the service; anyone else gets today's 403.
  @Get(':id/members')
  listMembers(
    @Param('id') committeeId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ICommitteeMember[]> {
    return this.committeesService.listMembers(committeeId, tenantId, { id: userId, permissions });
  }

  // ACC-230 — the Members panel and its See all list: searched, sorted and
  // paged on the server. The bare array above stays for its other callers.
  // ACC-281 — no route permission: committees:view OR an active member of the
  // committee, decided in the service; anyone else gets today's 403.
  @Get(':id/members/page')
  membersPage(
    @Param('id') committeeId: string,
    @Query() query: CommitteeMembersPageQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ICommitteePage<ICommitteeMemberRow>> {
    return this.lists.members(committeeId, query, tenantId, { id: userId, permissions });
  }

  // ACC-230 — the Sub-committees panel and its See all list.
  // ACC-281 — no route permission: committees:view OR an active member of the
  // committee, decided in the service; anyone else gets today's 403.
  @Get(':id/sub-committees')
  subCommittees(
    @Param('id') committeeId: string,
    @Query() query: SubCommitteesQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ICommitteePage<ISubCommitteeRow>> {
    return this.lists.subCommittees(committeeId, query, tenantId, { id: userId, permissions });
  }

  // ACC-281 — no route permission: committees:view OR an active member of the
  // committee, decided in the service; anyone else gets today's 403.
  @Get(':id/membership-events')
  listMembershipEvents(
    @Param('id') committeeId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ICommitteeMembershipEventRow[]> {
    // ACC-281 — named by the read, so a member needs no users or lookups read.
    return this.lists.membershipEvents(committeeId, tenantId, { id: userId, permissions });
  }

  @Post(':id/members')
  @Permissions(COMMITTEES_PERMISSIONS.ADD_MEMBER)
  addMember(
    @Param('id') committeeId: string,
    @Body() dto: AddCommitteeMemberDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ICommitteeMember> {
    return this.committeesService.addMember(committeeId, dto, tenantId, userId, permissions);
  }

  @Patch(':id/members/:memberId')
  @Permissions(COMMITTEES_PERMISSIONS.CHANGE_MEMBER_ROLE)
  changeMemberRole(
    @Param('id') committeeId: string,
    @Param('memberId') memberId: string,
    @Body() dto: ChangeCommitteeMemberRoleDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ICommitteeMember> {
    return this.committeesService.changeMemberRole(committeeId, memberId, dto, tenantId, userId, permissions);
  }

  @Delete(':id/members/:memberId')
  @Permissions(COMMITTEES_PERMISSIONS.REMOVE_MEMBER)
  removeMember(
    @Param('id') committeeId: string,
    @Param('memberId') memberId: string,
    @Body() dto: RemoveCommitteeMemberDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<void> {
    return this.committeesService.removeMember(committeeId, memberId, dto, tenantId, userId, permissions);
  }
}
