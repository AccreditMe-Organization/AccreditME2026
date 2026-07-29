import { IsIn, IsObject } from 'class-validator';

// UI only for now (ACC-13) — NotificationEmailProcessor keeps calling Resend
// directly. Shape validated loosely (not per-provider-typed) since no
// provider but Resend is ever actually read yet — see CLAUDE.md's Email
// Provider section for the later IEmailProvider refactor this feeds into.
export class UpdateEmailConfigDto {
  @IsIn(['resend', 'smtp', 'office365', 'sendgrid', 'ses'])
  emailProvider!: 'resend' | 'smtp' | 'office365' | 'sendgrid' | 'ses';

  @IsObject()
  config!: Record<string, unknown>;
}
