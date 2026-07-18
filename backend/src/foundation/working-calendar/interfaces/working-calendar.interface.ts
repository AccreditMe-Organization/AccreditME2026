export interface IWorkingCalendar {
  id: string;
  organizationId: string;
  timezone: string;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  createdAt: Date;
  updatedAt: Date;
}
