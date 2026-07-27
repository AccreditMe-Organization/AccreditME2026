export interface INotification {
  id: string;
  organizationId: string;
  userId: string;
  titleEn: string;
  titleAr: string | null;
  bodyEn: string;
  bodyAr: string | null;
  channel: string; // NotificationChannel
  status: string; // NotificationStatus
  objectType: string | null;
  objectId: string | null;
  sentAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
}
