import { TranslateService } from '@ngx-translate/core';
import { refusalBody, refusalCode } from '../../core/http/refusal';
import { LanguageService } from '../../core/services/language.service';
import { withArabicLam } from '../../shared/utils/arabic-prefix.util';

/**
 * ACC-288 — the root unit always keeps a head or an acting head. The server
 * refuses a change that would leave it with neither (409 `ROOT_UNIT_NEEDS_HEAD`,
 * `root-unit-head.invariant.ts`), naming the root in `unitNameEn` / `unitNameAr`.
 *
 * Every screen that can be refused says it through this one function, in the
 * dialog or row that made the call — deactivating a person, the transfer
 * wizard, the headship panel (vacate, end cover, complete handover now) and
 * positions (deactivate, head flag off). Never the server's English `message`,
 * and no pre-click disabling: the server decides.
 */
export const ROOT_UNIT_NEEDS_HEAD = 'ROOT_UNIT_NEEDS_HEAD';

/** The sentence for a ROOT_UNIT_NEEDS_HEAD refusal, or null for any other error. */
export function rootUnitNeedsHeadMessage(
  err: unknown,
  translate: TranslateService,
  language: LanguageService,
): string | null {
  if (refusalCode(err) !== ROOT_UNIT_NEEDS_HEAD) return null;
  const body = refusalBody(err) ?? {};
  const nameEn = typeof body['unitNameEn'] === 'string' ? body['unitNameEn'] : '';
  const nameAr = typeof body['unitNameAr'] === 'string' ? body['unitNameAr'] : null;
  // The root's name is the organisation's, in the reader's language; English
  // reads {{unit}}, Arabic {{unitWithLam}} (the headship titles' form).
  const unit = language.bilingual(nameEn, nameAr);
  return translate.instant('organization.refusal.rootNeedsHead', { unit, unitWithLam: withArabicLam(unit) });
}
