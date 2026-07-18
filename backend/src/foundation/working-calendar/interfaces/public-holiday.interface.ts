export interface IPublicHoliday {
  id: string;
  workingCalendarId: string;
  nameEn: string;
  nameAr: string | null;
  date: Date;
  isRecurring: boolean;
  createdAt: Date;
}
