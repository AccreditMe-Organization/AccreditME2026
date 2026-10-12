import { BadRequestException } from '@nestjs/common';

/**
 * ACC-181 D6 — complete or refused. A save that leaves the chosen provider
 * without a required field is refused, naming the fields, rather than kept as
 * a draft. Same body shape as the storage refusals: the code travels in the
 * body HttpExceptionFilter sends, and the frontend words it in both languages.
 */
export const EMAIL_SETTINGS_INCOMPLETE = 'EMAIL_SETTINGS_INCOMPLETE';

export class EmailSettingsIncompleteException extends BadRequestException {
  constructor(readonly missing: readonly string[]) {
    super({
      statusCode: 400,
      message: 'Fill in every setting this email provider needs',
      error: 'Bad Request',
      code: EMAIL_SETTINGS_INCOMPLETE,
      missing,
    });
  }
}
