import {
  OrgUnitHistoryEntryDto,
  OrgUnitHistoryField,
  OrgUnitHistoryPersonDto,
} from '../../services/org-unit.service';

/** Translate, and pick a tenant name by language — the two things a row needs. */
export interface HistoryTextDeps {
  t: (key: string, params?: Record<string, unknown>) => string;
  bilingual: (en: string, ar: string | null) => string;
  date: (value: string) => string;
}

/** The order fields are named in, whatever order the server lists them. */
const FIELD_ORDER: OrgUnitHistoryField[] = ['nameEn', 'nameAr', 'code', 'type', 'description', 'sortOrder'];

/**
 * A person the row names: their name, or — without `users:view` (D7) — their
 * position and "name hidden", never a blank.
 */
export function historyPerson(person: OrgUnitHistoryPersonDto, deps: HistoryTextDeps): string {
  if (person.name) return person.name;
  if (!person.inOrganization) return deps.t('organization.record.outsideOrganization');
  const position = person.positionNameEn ? deps.bilingual(person.positionNameEn, person.positionNameAr) : null;
  return position
    ? deps.t('organization.record.hiddenPersonWithPosition', { position })
    : deps.t('organization.record.nameHidden');
}

/** Line 1: what happened, from the stored row. */
export function historyWhat(entry: OrgUnitHistoryEntryDto, deps: HistoryTextDeps): string {
  const t = (key: string, params?: Record<string, unknown>) => deps.t(`organization.history.${key}`, params);
  if (entry.source === 'HEAD_EVENT') {
    const person = historyPerson(entry.subject, deps);
    const position = entry.position ? deps.bilingual(entry.position.nameEn, entry.position.nameAr) : null;
    if (entry.kind === 'ASSIGNED' && position) return t('head.ASSIGNED_AS', { person, position });
    return t(`head.${entry.kind}`, { person });
  }
  if (entry.kind !== 'CHANGED') return t(`audit.${entry.kind}`);

  const parts: string[] = [];
  if (entry.fields.includes('parent')) {
    if (entry.movedTo === null) parts.push(t('movedToTop'));
    else if (entry.movedTo) parts.push(t('movedUnder', { parent: deps.bilingual(entry.movedTo.nameEn, entry.movedTo.nameAr) }));
    else parts.push(t('parentChanged'));
  }
  const others = FIELD_ORDER.filter((f) => entry.fields.includes(f));
  if (others.length) parts.push(t('changed', { fields: others.map((f) => t(`field.${f}`)).join(t('fieldSeparator')) }));
  return parts.length ? parts.join(' · ') : t('audit.RECORDED');
}

/** Line 2: when, and who did it. */
export function historyWhen(entry: OrgUnitHistoryEntryDto, deps: HistoryTextDeps): string {
  const when = deps.date(entry.at);
  return entry.actor
    ? deps.t('organization.history.byWhom', { date: when, person: historyPerson(entry.actor, deps) })
    : deps.t('organization.history.bySystem', { date: when });
}
