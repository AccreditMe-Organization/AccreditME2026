import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../../common/decorators/current-user-permissions.decorator';
import { RATE_LIMITS } from '../../../common/throttle/rate-limits';
import { perUser } from '../../../common/throttle/throttle.config';
import { MeetingAiService } from './meeting-ai.service';
import { AcceptMeetingAiDto, DraftMinutesAiDto, MeetingAiNotesDto } from './dto/meeting-ai.dto';
import type { IMeetingAi, IMeetingAiAccepted } from './interfaces/meeting-ai.interface';

/**
 * ACC-322 — Meetings AI (plan step-322 §4). No route carries @Permissions, as
 * the meeting's other routes don't: seeing is the parent rule, the person is
 * meeting-authority.ts's RECORDERS, and the stage's rules decide, all in the
 * service. Draft minutes is the one route that calls the model: 8 credits
 * through the AI gateway, ten presses a minute per user (ACC-197's tier).
 */
@Controller('meetings')
@UseGuards(TenantGuard, PermissionGuard)
export class MeetingAiController {
  constructor(private readonly ai: MeetingAiService) {}

  @Get(':id/ai')
  get(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAi> {
    return this.ai.getAi(id, tenantId, { id: userId, permissions });
  }

  @Put(':id/ai/notes')
  saveNotes(
    @Param('id') id: string,
    @Body() dto: MeetingAiNotesDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<{ notes: string | null }> {
    return this.ai.saveNotes(id, dto, tenantId, { id: userId, permissions });
  }

  @Post(':id/ai/minutes')
  @HttpCode(HttpStatus.OK)
  @perUser(RATE_LIMITS.meetingAi)
  draftMinutes(
    @Param('id') id: string,
    @Body() dto: DraftMinutesAiDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAi> {
    return this.ai.draftMinutes(id, dto, tenantId, { id: userId, permissions });
  }

  @Post(':id/ai/suggestions/:suggestionId/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @Body() dto: AcceptMeetingAiDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAiAccepted> {
    return this.ai.accept(id, suggestionId, dto, tenantId, { id: userId, permissions });
  }

  @Post(':id/ai/suggestions/:suggestionId/discard')
  @HttpCode(HttpStatus.OK)
  discard(
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAi> {
    return this.ai.discard(id, suggestionId, tenantId, { id: userId, permissions });
  }
}
