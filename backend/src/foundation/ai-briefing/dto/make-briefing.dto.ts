import { IsIn } from 'class-validator';

// ACC-198 — the language the briefing is written in: the one the caller is
// reading in when they press (D4). The top-bar toggle is a session reading
// mode (ACC-79), so the client sends it rather than the saved preference.
export class MakeBriefingDto {
  @IsIn(['en', 'ar'])
  language!: 'en' | 'ar';
}
