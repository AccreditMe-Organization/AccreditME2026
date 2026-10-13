import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * ACC-193 — the summary's own refusals, each with a stable CODE the frontend
 * words in English and Arabic (§7). Same body shape as StorageRefusalException
 * and AiRefusalException: `{ statusCode, message, error, code }`. None of these
 * is charged: each is decided before the model is called.
 *
 * The gateway's own codes (AI_NOT_ENABLED, AI_CREDITS_EXHAUSTED, …) and the
 * storage ones (STORAGE_ACCESS_WITHDRAWN) pass through unchanged.
 */
export type SummaryRefusalCode =
  | 'SUMMARY_NOT_AVAILABLE_FOR_TYPE'
  | 'SUMMARY_NO_TEXT'
  | 'SUMMARY_FILE_UNREADABLE'
  | 'SUMMARY_BUSY'
  | 'AI_SUMMARY_IN_PROGRESS';

const REFUSALS: Readonly<Record<SummaryRefusalCode, { status: HttpStatus; message: string }>> = {
  SUMMARY_NOT_AVAILABLE_FOR_TYPE: { status: HttpStatus.CONFLICT, message: 'Only PDF, TXT and CSV files can be summarized' },
  SUMMARY_NO_TEXT: { status: HttpStatus.CONFLICT, message: 'This file has no readable text to summarize' },
  SUMMARY_FILE_UNREADABLE: { status: HttpStatus.CONFLICT, message: 'This file could not be read for a summary' },
  SUMMARY_BUSY: { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Summaries are busy right now; try again in a moment' },
  AI_SUMMARY_IN_PROGRESS: { status: HttpStatus.CONFLICT, message: 'A summary of this file is being made' },
};

export class SummaryRefusalException extends HttpException {
  constructor(readonly code: SummaryRefusalCode) {
    const { status, message } = REFUSALS[code];
    super({ statusCode: status, message, error: status === HttpStatus.CONFLICT ? 'Conflict' : 'Service Unavailable', code }, status);
  }
}

/** The file was deleted while its summary was being made: nothing was saved. The host answers its own 404. */
export class SummaryFileGoneError extends Error {
  constructor() {
    super('The file was deleted while its summary was being made');
    this.name = 'SummaryFileGoneError';
  }
}
