import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * ACC-199 — "✦ Suggest someone"'s own refusal, with a stable CODE the dialog
 * words in English and Arabic. Same body shape as DraftRefusalException and
 * AiRefusalException: `{ statusCode, message, error, code }`.
 *
 * WORKLOAD_NO_SUGGESTION is never charged: either the chosen person is no
 * longer past the threshold (decided before the model is called), or the model
 * said nobody is clearly better placed (an answer the gateway refunded).
 *
 * The gateway's own codes (AI_NOT_ENABLED, AI_CREDITS_EXHAUSTED, …) pass
 * through unchanged.
 */
export type WorkloadRefusalCode = 'WORKLOAD_NO_SUGGESTION';

export class WorkloadRefusalException extends HttpException {
  constructor(readonly code: WorkloadRefusalCode) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        message: 'Nobody here is clearly better placed to take it. No credits were used',
        error: 'Conflict',
        code,
      },
      HttpStatus.CONFLICT,
    );
  }
}
