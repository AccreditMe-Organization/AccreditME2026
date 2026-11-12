import { TranslateService } from '@ngx-translate/core';

/**
 * ACC-296 — the reason every committee seat removed by the Transfer wizard
 * carries (the DELETE's `reason`). The wizard writes it; the admin never types
 * one (Ahmad: the reason is the transfer).
 *
 *   another unit   "Transferred from {from} to {to}."
 *   the same unit  "Moved to a new position in {to}."
 *
 * `from` and `to` are the units' names already picked for the admin's language
 * (LanguageService.bilingual). Built ONCE at Submit and reused for Try again,
 * so a language switch in between cannot change the recorded reason.
 */
export function transferSeatReason(
  translate: Pick<TranslateService, 'instant'>,
  units: { from: string; to: string; sameUnit: boolean },
): string {
  return units.sameUnit
    ? (translate.instant('user.transfer.committees.reasonSameUnit', { unit: units.to }) as string)
    : (translate.instant('user.transfer.committees.reasonMoved', { from: units.from, to: units.to }) as string);
}
