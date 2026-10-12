import type { StageTaskDefinitionDto } from '../../services/workflow-template.service';

type Translate = (key: string, params?: Record<string, unknown>) => string;
type Bilingual = (en: string, ar: string | null | undefined) => string;

/**
 * ACC-208 — a stage task's assignment as a sentence (drawing decision 4):
 *
 *   POSITION              "Quality Officer, Cardiology" · "Nora Al-Otaibi"
 *   RECORD_UNIT_POSITION  "Quality Officer in the record's unit"
 *   COMMITTEE_ROLE        "Secretary of the Quality Assurance Committee"
 *   RECORD_COMMITTEE_ROLE "Secretary of the record's committee"
 *
 * Never a system role: ROLE is not a value a definition can hold. Every name
 * is tenant data, so it goes through bilingual() — a missing Arabic name shows
 * the English one (ACC-160) — and only the sentence around it is translated.
 * A name the server could not resolve (a row deleted since) reads as "—"
 * rather than an empty gap in the sentence.
 */
export function stageTaskRouteLabel(definition: StageTaskDefinitionDto, t: Translate, bilingual: Bilingual): string {
  const name = (ref: { nameEn: string; nameAr: string | null } | null) => (ref ? bilingual(ref.nameEn, ref.nameAr) : '—');
  const role = definition.committeeRole
    ? bilingual(definition.committeeRole.labelEn, definition.committeeRole.labelAr)
    : '—';

  switch (definition.assignKind) {
    case 'POSITION': {
      const route = t('workflow.stageTasks.route.position', {
        position: name(definition.position),
        unit: name(definition.orgUnit),
      });
      return definition.user ? `${route} · ${definition.user.name}` : route;
    }
    case 'RECORD_UNIT_POSITION':
      return t('workflow.stageTasks.route.recordUnit', { position: name(definition.position) });
    case 'COMMITTEE_ROLE':
      return t('workflow.stageTasks.route.committee', { role, committee: name(definition.committee) });
    case 'RECORD_COMMITTEE_ROLE':
      return t('workflow.stageTasks.route.recordCommittee', { role });
  }
}
