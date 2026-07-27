import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'BOTH', 'SMS'] as const;

// Internal DTO only — never exposed on any HTTP route. Notifications are
// always system/workflow-generated (CLAUDE.md's event-driven principle), so
// there is deliberately no POST /notifications endpoint. Other services call
// NotificationService.create() with this shape directly.
export class CreateNotificationDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titleEn!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  titleAr?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  bodyEn!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  bodyAr?: string;

  @IsIn(NOTIFICATION_CHANNELS)
  @IsOptional()
  channel?: (typeof NOTIFICATION_CHANNELS)[number]; // default IN_APP

  @IsString()
  @IsOptional()
  objectType?: string;

  @IsString()
  @IsOptional()
  objectId?: string;
}
