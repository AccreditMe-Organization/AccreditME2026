import { IsIn } from 'class-validator';

/**
 * ACC-193 — the reader's interface language at the moment of the request
 * (decision 8). The summary is written in it, whatever the file's language.
 */
export const SUMMARY_LANGUAGES = ['en', 'ar'] as const;

export class EvidenceSummaryQueryDto {
  @IsIn(SUMMARY_LANGUAGES)
  language!: 'en' | 'ar';
}

export class MakeEvidenceSummaryDto {
  @IsIn(SUMMARY_LANGUAGES)
  language!: 'en' | 'ar';
}
