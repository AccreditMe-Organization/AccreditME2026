import { TranslateService } from '@ngx-translate/core';
import { TENANT_NAV_GROUPS } from '../navigation/nav-items';
import { refusalBody, refusalCode } from './refusal';

/**
 * ACC-102 — the API's module refusals, said in the reader's language.
 *
 * ModuleGuard refuses a route on a module the organisation's plan does not
 * grant (MODULE_NOT_ENABLED) or grants read-only to a write (MODULE_READ_ONLY),
 * with `{ code, module }` in the body. The sentence names the module by its
 * RAIL label — the nav item carrying that `moduleKey` — so a reader meets the
 * same name the rail shows them. It never names a permission: no role change
 * opens a module the plan does not grant.
 *
 * `moduleRefusalInterceptor` puts the sentence into the error's `message`, so
 * every screen that shows an error through `extractErrorMessage()` says it
 * without a change of its own. A screen that wants to react to the code reads
 * it with `moduleRefusal()` or `refusalCode()`, as before.
 */
export type ModuleRefusalCode = 'MODULE_NOT_ENABLED' | 'MODULE_READ_ONLY';

export interface ModuleRefusal {
  code: ModuleRefusalCode;
  module: string | null;
}

const CODES: readonly string[] = ['MODULE_NOT_ENABLED', 'MODULE_READ_ONLY'];

/** The module refusal an HTTP error carries, or null for any other error. */
export function moduleRefusal(err: unknown): ModuleRefusal | null {
  const code = refusalCode(err);
  if (!code || !CODES.includes(code)) return null;
  const module = refusalBody(err)?.['module'];
  return { code: code as ModuleRefusalCode, module: typeof module === 'string' && module ? module : null };
}

/** The rail label's translation key for a module, or null if no rail item carries it. */
export function moduleLabelKey(moduleKey: string): string | null {
  const item = TENANT_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.moduleKey === moduleKey);
  return item?.labelKey ?? null;
}

/** The refusal as a sentence in the current language. */
export function moduleRefusalSentence(refusal: ModuleRefusal, translate: TranslateService): string {
  const base = refusal.code === 'MODULE_READ_ONLY' ? 'moduleRefusal.readOnly' : 'moduleRefusal.notEnabled';
  const labelKey = refusal.module ? moduleLabelKey(refusal.module) : null;
  return labelKey
    ? translate.instant(base, { module: translate.instant(labelKey) as string }) as string
    : translate.instant(`${base}Unnamed`) as string;
}
