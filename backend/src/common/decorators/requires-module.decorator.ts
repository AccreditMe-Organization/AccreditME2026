// Named RequiresModule, not Module — @Module() is @nestjs/common's own core
// decorator, used at the top of every *.module.ts file in this codebase. A
// second decorator sharing that name would shadow it. See ModuleGuard's own
// header comment (step-12-admin-portal.md Section 1, finding B).

import { SetMetadata } from '@nestjs/common';

export const REQUIRES_MODULE_KEY = 'requiresModule';

export const RequiresModule = (moduleKey: string): MethodDecorator =>
  SetMetadata(REQUIRES_MODULE_KEY, moduleKey);
