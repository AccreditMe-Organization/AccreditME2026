// Global exception filter (ACC-27). Registered once via
// app.useGlobalFilters() in main.ts — every controller benefits with no
// per-controller change.
//
// CLAUDE.md's project-structure diagram referenced a GlobalExceptionFilter
// that was never actually built; this is that filter. Confirmed via a live
// empirical check against this app's actual running dev server (NODE_ENV=
// development) before writing any of this: an unhandled throw already
// returned NestJS's own safe default ({"statusCode":500,"message":"Internal
// server error"}) with no stack trace, SQL fragment, or file path leaked.
// This filter is a consistency/polish improvement (one predictable error
// contract across the whole API) — not closing an active leak.
//
// Three branches, in order:
//   1. HttpException (and every subclass NestJS's own guards/pipes/services
//      already throw — BadRequestException, NotFoundException,
//      ConflictException, the ValidationPipe's own BadRequestException,
//      etc.) — passed through with its existing response shape unchanged.
//      This is the { statusCode, message, error } contract ACC-26's
//      frontend extractErrorMessage() depends on; must not regress it.
//   2. An explicit allowlist of known-safe third-party error shapes,
//      matching AuthService's ACC-25 isAPIError() precedent exactly: a real
//      class-identity check via the library's own type guard, never a
//      duck-typed "has a .message" check. To add a new safe error type
//      later: import its library-provided type-guard function (not a
//      hand-rolled shape check) and add an `if (theLibraryGuard(exception))`
//      branch above the generic fallback, mapping it to an appropriate HTTP
//      status and forwarding its own safe message.
//   3. Everything else — a genuine unhandled/unexpected error. The real
//      error is always logged server-side (console for now, matching this
//      codebase's current logging approach — CLAUDE.md lists Winston as the
//      intended structured-logging tool, but nothing in this codebase uses
//      it yet, so this filter is not the place to introduce that
//      assumption). The client always gets ONE static, non-cryptic message
//      — never varies by status code or error type, per this ticket's own
//      resolution.
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { isAPIError } from 'better-auth/api';

const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred. Please try again or contact support.';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (isAPIError(exception)) {
      const message = (exception.body as { message?: string } | undefined)?.message;
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: message ?? GENERIC_ERROR_MESSAGE,
        error: 'Bad Request',
      });
      return;
    }

    // TODO(Sentry): call Sentry.captureException(exception) here once
    // Sentry is actually configured elsewhere in this codebase. Out of
    // scope for ACC-27 — console logging only for now.
    console.error('Unhandled exception:', exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: GENERIC_ERROR_MESSAGE,
      error: 'Internal Server Error',
    });
  }
}
