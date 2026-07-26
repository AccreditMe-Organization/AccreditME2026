import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUserPermissions = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string[] => {
    const request = ctx.switchToHttp().getRequest<{ userPermissions?: string[] }>();
    return request.userPermissions ?? [];
  },
);
