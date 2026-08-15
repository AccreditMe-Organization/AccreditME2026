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

@Controller('working-calendar')
@UseGuards(TenantGuard, PermissionGuard)
export class WorkingCalendarController {
  constructor(private readonly workingCalendarService: WorkingCalendarService) {}

  @Get()
  @Permissions(ORG_PERMISSIONS.VIEW)
  getCalendar(@CurrentTenant() tenantId: string): Promise<IWorkingCalendar> {
    return this.workingCalendarService.getOrCreate(tenantId);
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

  @Get('holidays')
  @Permissions(ORG_PERMISSIONS.VIEW)
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
