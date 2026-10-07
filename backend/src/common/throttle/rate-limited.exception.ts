import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The one refusal for a request over a rate limit — ACC-129.
 *
 * Thrown in place of the library's ThrottlerException, whose body is a bare
 * string: HttpExceptionFilter passes an HttpException's response through as-is,
 * so that would reach the client as `"ThrottlerException: Too Many Requests"`
 * rather than the API's error shape. A stable `code` lets a screen show its own
 * translated message; `retryAfterSeconds` repeats the Retry-After header for
 * clients that do not read headers.
 */
export const RATE_LIMITED_CODE = 'RATE_LIMITED';

export class RateLimitedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests. Try again later.',
        error: 'Too Many Requests',
        code: RATE_LIMITED_CODE,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
