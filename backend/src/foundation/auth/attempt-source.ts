import type { Request } from 'express';

/**
 * Where a password or code attempt came from, for the LoginAttempt record —
 * ACC-164. The signed-in two-step routes check the password the way sign-in
 * does and record a wrong one the same way, so they need the same two facts,
 * and nothing else from the request.
 */
export interface AttemptSource {
  ipAddress?: string;
  userAgent?: string;
}

export function attemptSource(req: Request): AttemptSource {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}
