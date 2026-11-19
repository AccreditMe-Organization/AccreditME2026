import type { AccessHistoryField, IAccessHistoryNameDto, IAccessHistoryRowDto } from '../../services/user.service';

/**
 * ACC-216 part 2 — the words of one Access history row, from the server's kind.
 * Pure: the panel passes in translation, names and the formatting layer, so the
 * spec can read every kind in both languages without a component.
 *
 * Arabic is written as verbal nouns («منح دور», «إيقاف الحساب»), which name the
 * act without a subject: singular and gender-neutral whoever reads it.
 */
export interface AccessHistoryTextDeps {
  t: (key: string, params?: Record<string, unknown>) => string;
  bilingual: (en: string, ar: string | null) => string;
  dateTime: (value: string) => string;
  /** The signed-in person: their own acts read "by you". */
  viewerId: string | null;
}

const K = 'userRecord.accessHistory';

/** Every kind has its own sentence; CHANGED is the neutral one for anything else. */
const SIMPLE: Record<string, string> = {
  INVITED: `${K}.kind.invited`,
  INVITATION_ACCEPTED: `${K}.kind.invitationAccepted`,
  INVITATION_REVOKED: `${K}.kind.invitationRevoked`,
  OUT_OF_OFFICE_CHANGED: `${K}.kind.outOfOfficeChanged`,
  HEAD_APPOINTMENT_FAILED: `${K}.kind.headAppointmentFailed`,
  DEACTIVATED: `${K}.kind.deactivated`,
  REACTIVATED: `${K}.kind.reactivated`,
  TWO_STEP_TURNED_ON: `${K}.kind.twoStepOn`,
  TWO_STEP_TURNED_OFF: `${K}.kind.twoStepOff`,
  TWO_STEP_RESET: `${K}.kind.twoStepReset`,
  PASSWORD_RESET_REQUESTED: `${K}.kind.passwordResetRequested`,
  PASSWORD_RESET: `${K}.kind.passwordReset`,
  SIGNED_IN_AS: `${K}.kind.signedInAs`,
  CHANGED: `${K}.kind.changed`,
};

function fieldList(fields: readonly AccessHistoryField[], deps: AccessHistoryTextDeps): string {
  return fields.map((f) => deps.t(`${K}.field.${f}`)).join(deps.t(`${K}.listSeparator`));
}

function nameOf(value: IAccessHistoryNameDto | null | undefined, deps: AccessHistoryTextDeps): string {
  return value ? deps.bilingual(value.nameEn, value.nameAr) : deps.t(`${K}.unknownUnit`);
}

/** Line 1: what happened. */
export function accessHistoryWhat(row: IAccessHistoryRowDto, deps: AccessHistoryTextDeps): string {
  switch (row.kind) {
    case 'PROFILE_EDITED': {
      const fields = row.fields ?? [];
      return fields.length
        ? deps.t(`${K}.kind.profileEditedFields`, { fields: fieldList(fields, deps) })
        : deps.t(`${K}.kind.profileEdited`);
    }
    case 'OUT_OF_OFFICE_CHANGED':
      return deps.t(SIMPLE['OUT_OF_OFFICE_CHANGED']!);
    case 'ROLE_GRANTED':
    case 'ROLE_REMOVED': {
      const verb = row.kind === 'ROLE_GRANTED' ? 'roleGranted' : 'roleRemoved';
      const how = row.viaHeadship ? 'Headship' : '';
      return row.role
        ? deps.t(`${K}.kind.${verb}${how}Named`, { role: deps.bilingual(row.role.nameEn, row.role.nameAr) })
        : deps.t(`${K}.kind.${verb}${how}`);
    }
    case 'TRANSFERRED': {
      const tr = row.transfer;
      if (!tr) return deps.t(`${K}.kind.transferred`);
      const parts = [deps.t(`${K}.kind.transferredFromTo`, { from: nameOf(tr.from, deps), to: nameOf(tr.to, deps) })];
      if (tr.position) parts.push(deps.bilingual(tr.position.nameEn, tr.position.nameAr));
      if (tr.headAppointment === 'DONE') parts.push(deps.t(`${K}.headDone`));
      if (tr.headAppointment === 'FAILED') parts.push(deps.t(`${K}.headFailed`));
      return parts.join(' · ');
    }
    default:
      return deps.t(SIMPLE[row.kind] ?? SIMPLE['CHANGED']!);
  }
}

/** Line 2: when, and who did it. Nobody named: the date alone. */
export function accessHistoryWhen(row: IAccessHistoryRowDto, deps: AccessHistoryTextDeps): string {
  const when = deps.dateTime(row.at);
  if (!row.actor) return when;
  return row.actor.id === deps.viewerId
    ? deps.t(`${K}.byYou`, { when })
    : deps.t(`${K}.by`, { when, name: row.actor.name });
}
