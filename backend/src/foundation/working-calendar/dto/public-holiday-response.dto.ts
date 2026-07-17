import { IPublicHoliday } from '../interfaces/public-holiday.interface';

export class PublicHolidayResponseDto implements IPublicHoliday {
  id!: string;
  workingCalendarId!: string;
  nameEn!: string;
  nameAr!: string | null;
  date!: Date;
  isRecurring!: boolean;
  createdAt!: Date;
}
