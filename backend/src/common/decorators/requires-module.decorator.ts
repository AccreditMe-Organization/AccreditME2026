// Named RequiresModule, not Module — @Module() is @nestjs/common's own core
// decorator, used at the top of every *.module.ts file in this codebase. A
// second decorator sharing that name would shadow it.
//
// ACC-102 — the mode is REQUIRED and explicit per handler, never inferred from
// the HTTP method. The decorator also registers ModuleGuard on the route, so a
// decorated route is always checked, after the controller's TenantGuard. Do not
// add ModuleGuard to a controller's @UseGuards as well. See ModuleGuard.

import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import {
  ModuleAccessMode,
  ModuleGuard,
  REQUIRES_MODULE_KEY,
  RequiredModule,
} from '../guards/module.guard';

export type { ModuleAccessMode } from '../guards/module.guard';

export const RequiresModule = (moduleKey: string, mode: ModuleAccessMode): MethodDecorator => {
  const required: RequiredModule = { moduleKey, mode };
  return applyDecorators(SetMetadata(REQUIRES_MODULE_KEY, required), UseGuards(ModuleGuard)) as MethodDecorator;
};
