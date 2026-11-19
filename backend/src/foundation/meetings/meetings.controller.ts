import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { SingleFileUploadInterceptor } from '../file-storage/single-file-upload.interceptor';
import type { IFileDownload, IUploadedFile } from '../file-storage/interfaces/stored-file.interface';
import { MeetingsService } from './meetings.service';
import { MeetingPeopleService } from './meeting-people.service';
import { MeetingAgendaService } from './meeting-agenda.service';
import { MeetingFilesService } from './meeting-files.service';
import { MeetingClashService } from './meeting-clash.service';
import { MeetingReviewService } from './meeting-review.service';
import { MeetingSeriesService } from './meeting-series.service';
import {
  AddMeetingGuestDto,
  AnswerMeetingDto,
  CheckMeetingClashesDto,
  CreateMeetingSeriesDto,
  EndMeetingSeriesDto,
  CreateAgendaItemDto,
  ListMeetingsDto,
  OrderAgendaDto,
  RescheduleMeetingDto,
  ScheduleMeetingDto,
  UpdateAgendaItemDto,
  UpdateMeetingDto,
} from './dto/meeting.dto';
import type {
  IMeeting,
  IMeetingAgendaItem,
  IMeetingAttendee,
  IMeetingAwaitingMe,
  IMeetingClash,
  IMeetingFile,
  IMeetingFiles,
  IMeetingList,
  IMeetingScopeResult,
  IMeetingSeriesPreview,
} from './interfaces/meeting.interface';

/**
 * ACC-316 — one meeting's record (PR 3a) and its people, agenda, files and clash
 * check (PR 3b). No route carries @Permissions: who may see a meeting is the
 * parent rule (meetings:view, or a member, a person of its unit, an invited
 * guest, or a head above), and who may write is meeting-authority.ts and the
 * stage's rules — all in the services, through MeetingAccess, as the task
 * page's routes do. Cancel is the workflow's own move
 * (POST /workflows/instances/:id/transition).
 */
@Controller('meetings')
@UseGuards(TenantGuard, PermissionGuard)
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly people: MeetingPeopleService,
    private readonly agenda: MeetingAgendaService,
    private readonly files: MeetingFilesService,
    private readonly clashes: MeetingClashService,
    private readonly review: MeetingReviewService,
    private readonly series: MeetingSeriesService,
  ) {}

  // ── Series (PR 5) ────────────────────────────────────────────────────────────

  /** The dates a repeat would make, each placed and titled, and their clashes. Writes nothing. */
  @Post('series/preview')
  @HttpCode(HttpStatus.OK)
  previewSeries(
    @Body() dto: CreateMeetingSeriesDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingSeriesPreview> {
    return this.series.preview(dto, tenantId, { id: userId, permissions });
  }

  @Post('series')
  createSeries(
    @Body() dto: CreateMeetingSeriesDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<{ seriesId: string; meetingIds: string[] }> {
    return this.series.create(dto, tenantId, { id: userId, permissions });
  }

  @Post('series/:seriesId/end')
  @HttpCode(HttpStatus.OK)
  endSeries(
    @Param('seriesId') seriesId: string,
    @Body() dto: EndMeetingSeriesDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<{ cancelled: string[]; failed: string[] }> {
    return this.series.end(seriesId, dto, tenantId, { id: userId, permissions });
  }

  @Get()
  list(
    @Query() query: ListMeetingsDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingList> {
    return this.meetings.list(query, tenantId, { id: userId, permissions });
  }

  /** PR 3b — the clash warning, for whoever may schedule for the owner or edit the meeting. */
  @Post('clashes')
  @HttpCode(HttpStatus.OK)
  checkClashes(
    @Body() dto: CheckMeetingClashesDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingClash[]> {
    return this.clashes.check(dto, tenantId, { id: userId, permissions });
  }

  /** ACC-316 PR 4 — Home's meeting rows, self-scoped. Before ':id', so it is not read as an id. */
  @Get('awaiting-me')
  awaitingMe(@CurrentTenant() tenantId: string, @CurrentUser() userId: string): Promise<IMeetingAwaitingMe> {
    return this.review.awaitingMe(tenantId, userId);
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
  ): Promise<IMeeting | (IMeeting & { scope: IMeetingScopeResult })> {
    // ACC-316 PR 5 — a series meeting's "this and all later".
    if (dto.scope === 'THIS_AND_LATER') return this.series.updateLater(id, dto, tenantId, { id: userId, permissions });
    return this.meetings.update(id, dto, tenantId, { id: userId, permissions });
  }

  @Post(':id/reschedule')
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleMeetingDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeeting | (IMeeting & { scope: IMeetingScopeResult })> {
    if (dto.scope === 'THIS_AND_LATER') return this.series.rescheduleLater(id, dto, tenantId, { id: userId, permissions });
    return this.meetings.reschedule(id, dto, tenantId, { id: userId, permissions });
  }

  // ── People (PR 3b) ───────────────────────────────────────────────────────────

  @Get(':id/attendees')
  attendees(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAttendee[]> {
    return this.people.attendees(id, tenantId, { id: userId, permissions });
  }

  @Post(':id/guests')
  addGuest(
    @Param('id') id: string,
    @Body() dto: AddMeetingGuestDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAttendee> {
    return this.people.addGuest(id, dto, tenantId, { id: userId, permissions });
  }

  @Delete(':id/guests/:attendeeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeGuest(
    @Param('id') id: string,
    @Param('attendeeId') attendeeId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<void> {
    return this.people.removeGuest(id, attendeeId, tenantId, { id: userId, permissions });
  }

  @Put(':id/answer')
  @HttpCode(HttpStatus.NO_CONTENT)
  answer(
    @Param('id') id: string,
    @Body() dto: AnswerMeetingDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<void> {
    return this.people.answer(id, dto, tenantId, { id: userId, permissions });
  }

  // ── Agenda (PR 3b) ───────────────────────────────────────────────────────────

  @Get(':id/agenda')
  agendaItems(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAgendaItem[]> {
    return this.agenda.list(id, tenantId, { id: userId, permissions });
  }

  @Post(':id/agenda')
  addAgendaItem(
    @Param('id') id: string,
    @Body() dto: CreateAgendaItemDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAgendaItem[]> {
    return this.agenda.create(id, dto, tenantId, { id: userId, permissions });
  }

  @Put(':id/agenda/order')
  orderAgenda(
    @Param('id') id: string,
    @Body() dto: OrderAgendaDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAgendaItem[]> {
    return this.agenda.order(id, dto, tenantId, { id: userId, permissions });
  }

  @Patch(':id/agenda/:itemId')
  updateAgendaItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateAgendaItemDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAgendaItem[]> {
    return this.agenda.update(id, itemId, dto, tenantId, { id: userId, permissions });
  }

  @Delete(':id/agenda/:itemId')
  removeAgendaItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingAgendaItem[]> {
    return this.agenda.remove(id, itemId, tenantId, { id: userId, permissions });
  }

  // ── Files (PR 3b) ────────────────────────────────────────────────────────────

  @Get(':id/files')
  listFiles(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingFiles> {
    return this.files.list(id, tenantId, { id: userId, permissions });
  }

  /** A general attachment of the meeting. */
  @Post(':id/files')
  @UseInterceptors(SingleFileUploadInterceptor)
  addAttachment(
    @Param('id') id: string,
    @UploadedFile() file: IUploadedFile | undefined,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingFile> {
    return this.files.add(id, null, file, tenantId, { id: userId, permissions });
  }

  /** A paper of one agenda item. */
  @Post(':id/agenda/:itemId/files')
  @UseInterceptors(SingleFileUploadInterceptor)
  addPaper(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: IUploadedFile | undefined,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMeetingFile> {
    return this.files.add(id, itemId, file, tenantId, { id: userId, permissions });
  }

  /** The in-app file viewer's link. */
  @Get(':id/files/:fileId/view')
  viewFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IFileDownload> {
    return this.files.openView(id, fileId, tenantId, { id: userId, permissions });
  }

  @Get(':id/files/:fileId/download')
  downloadFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IFileDownload> {
    return this.files.openDownload(id, fileId, tenantId, { id: userId, permissions });
  }

  @Delete(':id/files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<void> {
    return this.files.remove(id, fileId, tenantId, { id: userId, permissions });
  }
}
