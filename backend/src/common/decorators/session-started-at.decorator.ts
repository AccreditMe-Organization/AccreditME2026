import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// ACC-126 — when the caller's session signed in, from the access token's `sst`
// claim (set by TenantGuard, no query). Undefined only for a token minted
// before ACC-126, which lives at most 15 minutes after the deploy.
export const SessionStartedAt = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Date | undefined => {
    const request = ctx.switchToHttp().getRequest<{ sessionStartedAt?: Date }>();
    return request.sessionStartedAt;
  },
);
