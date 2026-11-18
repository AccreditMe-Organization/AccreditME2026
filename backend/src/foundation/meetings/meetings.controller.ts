import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { MeetingsService } from './meetings.service';
import { ListMeetingsDto, RescheduleMeetingDto, ScheduleMeetingDto, UpdateMeetingDto } from './dto/meeting.dto';
import type { IMeeting, IMeetingList } from './interfaces/meeting.interface';

/**
 * ACC-316 PR 3a — one meeting's record. No route carries @Permissions: who may
 * see a meeting is the parent rule (meetings:view, or a member, a person of its
 * unit, an invitee, or a head above), and who may write is meeting-authority.ts
 * and the stage's rules, both in the service, as the task page's routes do.
 * Cancel is the workflow's own move (POST /workflows/instances/:id/transition).
 */
@Controller('meetings')
@UseGuards(TenantGuard, PermissionGuard)
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  list(
    @Query() query: ListMeetingsDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingList> {
    return this.meetings.list(query, tenantId, { id: userId, permissions });
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeeting> {
    return this.meetings.getForViewer(id, tenantId, { id: userId, permissions });
  }

  @Post()
  schedule(
    @Body() dto: ScheduleMeetingDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeeting> {
    return this.meetings.schedule(dto, tenantId, { id: userId, permissions });
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMeetingDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeeting> {
    return this.meetings.update(id, dto, tenantId, { id: userId, permissions });
  }

  @Post(':id/reschedule')
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleMeetingDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeeting> {
    return this.meetings.reschedule(id, dto, tenantId, { id: userId, permissions });
  }
}
