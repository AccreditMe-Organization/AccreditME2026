import { TaskPoolDto } from './services/task.service';

/**
 * ACC-167 — a pool named for display: "Quality Officer, Pharmacy" or
 * "Secretary, Infection Control Committee". The backend's poolLabel() builds
 * the same text for notifications.
 *
 * Every name is tenant data, so each is picked by language with an English
 * fallback (`bilingual`, ACC-160) — never translated — and the separator is
 * the language's own comma.
 */
export function taskPoolLabel(
  pool: TaskPoolDto,
  bilingual: (en: string, ar: string | null) => string,
  isArabic: boolean,
): string {
  const separator = isArabic ? '، ' : ', ';
  const [first, second] =
    pool.kind === 'POSITION'
      ? [bilingual(pool.positionNameEn ?? '', pool.positionNameAr), bilingual(pool.orgUnitNameEn ?? '', pool.orgUnitNameAr)]
      : [bilingual(pool.roleLabelEn ?? '', pool.roleLabelAr), bilingual(pool.committeeNameEn ?? '', pool.committeeNameAr)];
  return `${first}${separator}${second}`;
}
