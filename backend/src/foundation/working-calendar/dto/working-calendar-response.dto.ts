import { IWorkingCalendar } from '../interfaces/working-calendar.interface';
import { PublicHolidayResponseDto } from './public-holiday-response.dto';

export class WorkingCalendarResponseDto implements IWorkingCalendar {
  id!: string;
  organizationId!: string;
  timezone!: string;
  workingDays!: number[];
  workingHoursStart!: string;
  workingHoursEnd!: string;
  createdAt!: Date;
  updatedAt!: Date;
  publicHolidays?: PublicHolidayResponseDto[];
}
