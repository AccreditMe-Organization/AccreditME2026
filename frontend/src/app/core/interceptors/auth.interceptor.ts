// Reads the dev-only demo JWT (if present) and attaches it as a Bearer token
// to every outgoing request. Functional interceptor style (Angular 21+).
// No-op when no token is set — does not interfere with unauthenticated requests
// (e.g. before /dev/login has been used).

import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { DemoAuthService } from '../../dev/demo-auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const demoAuthService = inject(DemoAuthService);
  const token = demoAuthService.getToken();

  if (!token) {
    return next(req);
  }

  const authorizedReq = req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });

  return next(authorizedReq);
};
