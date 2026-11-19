/**
 * ACC-216 part 2 — GET /users/:userId/access-history?skip=&take=: what was
 * changed about one person, and by whom, newest first.
 *
 * Each row is ONE stored AuditLog row (objectType `User` with objectId = the
 * person, or objectType `UserRole` naming the person in `metadata.userId`).
 * A transfer's own row is described from its UserTransferEvent. Sign-ins and
 * sign-outs (LOGIN, LOGOUT) are not listed: they are not changes, and the
 * Sessions panel (ACC-216 part 3) is their place.
 *
 * NEVER RETURNED: an audit row's `before`, `after` and `metadata`. They hold a
 * whole User row (its invitation token included) and free text (a failed head
 * appointment's error message, a revoked invitation's email). The server reads
 * them to decide the row's kind and which fields changed, and sends only that.
 */

/**
 * What happened, from the stored row (see classifyAccessRow() for the mapping).
 * CHANGED is the neutral row for an action this list does not know: a row is
 * never dropped for being unknown.
 */
export type AccessHistoryKind =
  | 'INVITED'
  | 'INVITATION_ACCEPTED'
  | 'INVITATION_REVOKED'
  | 'PROFILE_EDITED'
  | 'OUT_OF_OFFICE_CHANGED'
  | 'TRANSFERRED'
  | 'HEAD_APPOINTMENT_FAILED'
  | 'DEACTIVATED'
  | 'REACTIVATED'
  | 'ROLE_GRANTED'
  | 'ROLE_REMOVED'
  | 'TWO_STEP_TURNED_ON'
  | 'TWO_STEP_TURNED_OFF'
  | 'TWO_STEP_RESET'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET'
  | 'SIGNED_IN_AS'
  | 'CHANGED';

/**
 * The person's fields an edit can change, by the names the record page uses.
 * Only these are compared; nothing else in the stored copies is read.
 *
 *   name         name              position    positionId
 *   language     language          unit        primaryOrgUnitId
 *   calendar     hijriDisplay      manager     managerId
 *   actingUnit   actingOrgUnitId, actingOrgUnitUntil
 *   outOfOffice  outOfOfficeFrom, outOfOfficeTo
 *   cover        actingUserId
 */
export type AccessHistoryField =
  | 'name'
  | 'language'
  | 'calendar'
  | 'position'
  | 'unit'
  | 'manager'
  | 'actingUnit'
  | 'outOfOffice'
  | 'cover';

export interface IAccessHistoryName {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

/**
 * Who did it. Null when no person is recorded (the system did it), or the id
 * is not a person of this organisation: a platform administrator signing in as
 * the person, or an account since deleted (a revoked invitation). A
 * deactivated colleague is still named: they did it.
 */
export interface IAccessHistoryActor {
  id: string;
  name: string;
}

export interface IAccessHistoryTransfer {
  /** The unit left and the unit joined, with their current names; null when no longer in the organisation. */
  from: IAccessHistoryName | null;
  to: IAccessHistoryName | null;
  /** The position taken, if the transfer named one. */
  position: IAccessHistoryName | null;
  /**
   * NONE: no head appointment was part of it. DONE: the person became the
   * unit's head. FAILED: it was attempted and did not complete.
   */
  headAppointment: 'NONE' | 'DONE' | 'FAILED';
}

export interface IAccessHistoryRow {
  /** `audit:<AuditLog id>`. */
  id: string;
  /** When the row was written. */
  at: Date;
  kind: AccessHistoryKind;
  actor: IAccessHistoryActor | null;
  /** PROFILE_EDITED and OUT_OF_OFFICE_CHANGED only: which fields differ. Never their values. */
  fields?: AccessHistoryField[];
  /**
   * ROLE_GRANTED and ROLE_REMOVED only: the role, named only for a viewer with
   * roles:view (the rule GET /users/:userId/roles applies), else null. Also null
   * for a headship role removed without its id on record.
   */
  role?: IAccessHistoryName | null;
  /** ROLE_GRANTED and ROLE_REMOVED only: given or taken with a head position, not by hand. */
  viaHeadship?: boolean;
  /** TRANSFERRED only. */
  transfer?: IAccessHistoryTransfer;
}

export interface IUserAccessHistoryPage {
  rows: IAccessHistoryRow[];
  /** Every row there is for this person, LOGIN and LOGOUT excluded. */
  total: number;
  skip: number;
  take: number;
}
