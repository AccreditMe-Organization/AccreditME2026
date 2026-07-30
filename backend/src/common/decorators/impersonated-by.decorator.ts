import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Undefined on every normal session — only set by TenantGuard when the JWT
// carries an impersonatedBy claim (ACC-13, PlatformTenantService.startImpersonation()).
export const ImpersonatedBy = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ impersonatedBy?: string }>();
    return request.impersonatedBy;
  },
);
