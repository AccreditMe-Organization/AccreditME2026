import { ForbiddenException } from '@nestjs/common';

/**
 * ACC-102 — why ModuleGuard refused a request, as a stable code.
 *
 *   MODULE_NOT_ENABLED  the organisation does not have the module: it is not
 *                       switched on, or its plan grants it NONE
 *   MODULE_READ_ONLY    a 'write' route on a module the plan grants READ_ONLY
 *
 * Never named as a permission: no role change can open a module the plan does
 * not grant, so a message naming a permission would send the reader to ask for
 * the wrong thing. The screens say both codes from the code, naming the module
 * by its rail label (frontend `core/http/module-refusal.ts`).
 */
export type ModuleRefusalCode = 'MODULE_NOT_ENABLED' | 'MODULE_READ_ONLY';

const MESSAGES: Record<ModuleRefusalCode, string> = {
  MODULE_NOT_ENABLED: 'This module is not available to the organization.',
  MODULE_READ_ONLY: "This module is read-only on the organization's plan.",
};

/** 403 `{ statusCode, message, error, code, module }`. */
export class ModuleRefusalException extends ForbiddenException {
  constructor(
    readonly code: ModuleRefusalCode,
    readonly module: string,
  ) {
    super({ statusCode: 403, message: MESSAGES[code], error: 'Forbidden', code, module });
  }
}
