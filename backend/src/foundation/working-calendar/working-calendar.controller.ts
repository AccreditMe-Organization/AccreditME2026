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
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ORG_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkingCalendarService } from './working-calendar.service';
import { UpdateWorkingCalendarDto } from './dto/update-working-calendar.dto';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';
import { IWorkingCalendar } from './interfaces/working-calendar.interface';
import { IPublicHoliday } from './interfaces/public-holiday.interface';
import { IWorkingCalendarChange } from './interfaces/working-calendar-change.interface';

@Controller('working-calendar')
@UseGuards(TenantGuard, PermissionGuard)
export class WorkingCalendarController {
  constructor(private readonly workingCalendarService: WorkingCalendarService) {}

  // ACC-96 — DELIBERATELY UNGATED beyond authentication. Was org:view.
  //
  // This is the tenant's office hours: working days, start and end, time zone.
  // Anyone setting a due time needs it — the New Task form computes its "End of
  // working day" and "Tomorrow 09:00" presets from it, and warns when a chosen
  // time falls outside working hours, because the SLA is counted in working
  // time rather than clock time. org:view is held by TENANT_ADMIN,
  // QUALITY_MANAGER and VIEWER only, so every other role got a 403 and lost
  // both the presets and the warning — QUALITY_OFFICER and AUDITOR included.
  //
  // Not a self-scoped read like my-tasks (ACC-101): this is tenant-wide
  // configuration. It is widened because of WHAT it is, not who asks. Office
  // hours are not confidential — they are on the front door — and knowing them
  // discloses nothing about any record. TenantGuard still scopes the row to the
  // caller's own organization, so this is not a cross-tenant read.
  //
  // WRITES ARE UNCHANGED: every @Patch/@Post/@Delete below still requires
  // org:manage. Widening a read must not be read as widening the resource.
  @Get()
  getCalendar(@CurrentTenant() tenantId: string): Promise<IWorkingCalendar> {
    return this.workingCalendarService.getOrCreate(tenantId);
  }

  // ACC-120 slice 1 — who changed the calendar, when, and what it was before.
  //
  // org:manage, NOT the ungated read above, and the difference is deliberate.
  // GET / is office hours: public-facing facts that disclose nothing about any
  // person. THIS payload is different in kind — it names the people who changed
  // the configuration and carries the values they replaced. That is management
  // information about colleagues, so it takes the permission that can manage the
  // calendar rather than the one that can read it. A VIEWER holding org:view
  // would otherwise be handed a list of who did what.
  //
  // The page itself stays reachable with admin:access + org:view; a caller
  // without org:manage simply sees no "Last changed" line, which is an absent
  // annotation rather than a broken page.
  @Get('history')
  @Permissions(ORG_PERMISSIONS.MANAGE)
  getChangeHistory(@CurrentTenant() tenantId: string): Promise<IWorkingCalendarChange[]> {
    return this.workingCalendarService.getChangeHistory(tenantId);
  }

  @Patch()
  @Permissions(ORG_PERMISSIONS.MANAGE)
  updateCalendar(
    @Body() dto: UpdateWorkingCalendarDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IWorkingCalendar> {
    return this.workingCalendarService.update(tenantId, dto, actorId);
  }

  // ACC-96 — ungated for the same reason as getCalendar() above: a public
  // holiday is public by definition, and a due-time warning cannot say "Friday
  // is not a working day" without it.
  @Get('holidays')
  listHolidays(
    @CurrentTenant() tenantId: string,
    @Query('year') year?: string,
  ): Promise<IPublicHoliday[]> {
    return this.workingCalendarService.listHolidays(
      tenantId,
      year ? parseInt(year, 10) : undefined,
    );
  }

  @Post('holidays')
  @Permissions(ORG_PERMISSIONS.MANAGE)
  addHoliday(
    @Body() dto: CreatePublicHolidayDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IPublicHoliday> {
    return this.workingCalendarService.addHoliday(tenantId, dto, actorId);
  }

  @Patch('holidays/:id')
  @Permissions(ORG_PERMISSIONS.MANAGE)
  updateHoliday(
    @Param('id') id: string,
    @Body() dto: UpdatePublicHolidayDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IPublicHoliday> {
    return this.workingCalendarService.updateHoliday(id, tenantId, dto, actorId);
  }

  @Delete('holidays/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(ORG_PERMISSIONS.MANAGE)
  removeHoliday(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.workingCalendarService.removeHoliday(id, tenantId, actorId);
  }
}
