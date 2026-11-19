import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { MeetingMinutesService } from './meeting-minutes.service';
import { MeetingReviewService } from './meeting-review.service';
import {
  CreateActionItemDto,
  DecideSuggestionDto,
  DecisionDto,
  DistributeMinutesDto,
  ItemMinutesDto,
  OpenActionNoteDto,
  RecordAttendanceDto,
  ReturnMinutesDto,
  SuggestCorrectionDto,
  UpdateActionItemDto,
} from './dto/meeting.dto';
import type { IMeetingMinutes } from './interfaces/meeting.interface';

/**
 * ACC-316 PR 4 — a meeting's minutes and their review. No route carries
 * @Permissions, as MeetingsController's don't: seeing is the parent rule, the
 * minutes' readers are §4.1's by phase, and the writers meeting-authority.ts's
 * RECORDERS and the stage's rules, all in the services. Distribute and Return
 * are the app's moves (mover APP): these routes are their only buttons.
 */
@Controller('meetings')
@UseGuards(TenantGuard, PermissionGuard)
export class MeetingMinutesController {
  constructor(
    private readonly minutes: MeetingMinutesService,
    private readonly review: MeetingReviewService,
  ) {}

  @Get(':id/minutes')
  get(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingMinutes> {
    return this.minutes.getMinutes(id, tenantId, { id: userId, permissions });
  }

  @Put(':id/attendance')
  recordAttendance(
    @Param('id') id: string,
    @Body() dto: RecordAttendanceDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingMinutes> {
    return this.minutes.recordAttendance(id, dto, tenantId, { id: userId, permissions });
  }

  @Put(':id/agenda/:itemId/minutes')
  setItemMinutes(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ItemMinutesDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingMinutes> {
    return this.minutes.setItemMinutes(id, itemId, dto, tenantId, { id: userId, permissions });
  }

  @Post(':id/agenda/:itemId/decisions')
  addDecision(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: DecisionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingMinutes> {
    return this.minutes.addDecision(id, itemId, dto, tenantId, { id: userId, permissions });
  }

  @Patch(':id/agenda/:itemId/decisions/:decisionId')
  updateDecision(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Param('decisionId') decisionId: string,
    @Body() dto: DecisionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingMinutes> {
    return this.minutes.updateDecision(id, itemId, decisionId, dto, tenantId, { id: userId, permissions });
  }

  @Delete(':id/agenda/:itemId/decisions/:decisionId')
  removeDecision(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Param('decisionId') decisionId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingMinutes> {
    return this.minutes.removeDecision(id, itemId, decisionId, tenantId, { id: userId, permissions });
  }

  @Post(':id/agenda/:itemId/actions')
  addActionItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: CreateActionItemDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingMinutes> {
    return this.minutes.addActionItem(id, itemId, dto, tenantId, { id: userId, permissions });
  }

  @Patch(':id/actions/:actionId')
  updateActionItem(
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @Body() dto: UpdateActionItemDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingMinutes> {
    return this.minutes.updateActionItem(id, actionId, dto, tenantId, { id: userId, permissions });
  }

  @Delete(':id/actions/:actionId')
  removeActionItem(
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingMinutes> {
    return this.minutes.removeActionItem(id, actionId, tenantId, { id: userId, permissions });
  }

  @Put(':id/open-actions/:taskId/note')
  setOpenActionNote(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: OpenActionNoteDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingMinutes> {
    return this.minutes.setOpenActionNote(id, taskId, dto, tenantId, { id: userId, permissions });
  }

  // ── Review ───────────────────────────────────────────────────────────────────

  @Post(':id/distribute')
  @HttpCode(HttpStatus.NO_CONTENT)
  distribute(
    @Param('id') id: string,
    @Body() dto: DistributeMinutesDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<void> {
    return this.review.distribute(id, dto, tenantId, { id: userId, permissions });
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.NO_CONTENT)
  returnForCorrection(
    @Param('id') id: string,
    @Body() dto: ReturnMinutesDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<void> {
    return this.review.returnForCorrection(id, dto, tenantId, { id: userId, permissions });
  }

  @Put(':id/review/no-corrections')
  @HttpCode(HttpStatus.NO_CONTENT)
  noCorrections(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<void> {
    return this.review.noCorrections(id, tenantId, { id: userId, permissions });
  }

  @Post(':id/review/suggestions')
  suggest(
    @Param('id') id: string,
    @Body() dto: SuggestCorrectionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<{ id: string }> {
    return this.review.suggest(id, dto, tenantId, { id: userId, permissions });
  }

  @Post(':id/review/suggestions/:suggestionId/apply')
  @HttpCode(HttpStatus.NO_CONTENT)
  apply(
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @Body() dto: DecideSuggestionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<void> {
    return this.review.decideSuggestion(id, suggestionId, 'APPLIED', dto, tenantId, { id: userId, permissions });
  }

  @Post(':id/review/suggestions/:suggestionId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @Body() dto: DecideSuggestionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<void> {
    return this.review.decideSuggestion(id, suggestionId, 'DECLINED', dto, tenantId, { id: userId, permissions });
  }
}
