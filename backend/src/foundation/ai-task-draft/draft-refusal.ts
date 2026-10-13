import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * ACC-197 — task drafting's own refusals, each with a stable CODE the frontend
 * words in English and Arabic. Same body shape as SummaryRefusalException and
 * AiRefusalException: `{ statusCode, message, error, code }`. Neither is
 * charged: the first is decided before the model is called, the second is an
 * answer the gateway refunded.
 *
 * The gateway's own codes (AI_NOT_ENABLED, AI_CREDITS_EXHAUSTED, …) pass
 * through unchanged.
 */
export type DraftRefusalCode = 'DRAFT_NOTE_TOO_SHORT' | 'DRAFT_NOTHING_TO_SUGGEST';

const MESSAGES: Readonly<Record<DraftRefusalCode, string>> = {
  DRAFT_NOTE_TOO_SHORT: 'Add a few words about the task, then try again',
  DRAFT_NOTHING_TO_SUGGEST: 'AI could not suggest anything from this note. No credits were used',
};

export class DraftRefusalException extends HttpException {
  constructor(readonly code: DraftRefusalCode) {
    super({ statusCode: HttpStatus.CONFLICT, message: MESSAGES[code], error: 'Conflict', code }, HttpStatus.CONFLICT);
  }
}
