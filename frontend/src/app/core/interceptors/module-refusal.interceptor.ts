import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { catchError, throwError } from 'rxjs';
import { moduleRefusal, moduleRefusalSentence } from '../http/module-refusal';

/**
 * ACC-102 — a module refusal reaches every screen already in words.
 *
 * On a 403 MODULE_NOT_ENABLED or MODULE_READ_ONLY, the error is re-thrown with
 * its body unchanged except `message`, which becomes the sentence in the
 * reader's language naming the module by its rail label (`module-refusal.ts`).
 * The code and the module stay in the body. Any other error passes untouched.
 */
export const moduleRefusalInterceptor: HttpInterceptorFn = (req, next) => {
  const translate = inject(TranslateService);
  return next(req).pipe(
    catchError((err: unknown) => {
      const refusal = moduleRefusal(err);
      if (!refusal || !(err instanceof HttpErrorResponse)) return throwError(() => err);
      return throwError(
        () =>
          new HttpErrorResponse({
            error: { ...(err.error as Record<string, unknown>), message: moduleRefusalSentence(refusal, translate) },
            headers: err.headers,
            status: err.status,
            statusText: err.statusText,
            url: err.url ?? undefined,
          }),
      );
    }),
  );
};
