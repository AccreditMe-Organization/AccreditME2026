/**
 * One recorded change to the working calendar — ACC-120 slice 1.
 *
 * Template 5 puts "Last changed 2 Sep 2026 · N. Al-Otaibi" in the settings
 * header, and its destructive-action note says a reset is "recorded in the
 * change history with your name and the previous values". Both were already
 * true of the data: every calendar update writes an `AuditLog` row carrying
 * `actorId`, `before` and `after`, and the table is indexed on
 * `(objectType, objectId)` and on `createdAt`. What was missing was a way to
 * READ it, not the fact — so this is a read over existing rows, and nothing
 * about how the calendar is written changed.
 */
export interface IWorkingCalendarChange {
  id: string;
  /** When the change was recorded. UTC, like every stored timestamp. */
  changedAt: Date;
  /**
   * Who changed it, or null.
   *
   * NULL IS A REAL ANSWER, not a gap to paper over: `AuditLog.actorId` is
   * nullable, so a change made by the system rather than a person genuinely has
   * no actor. A caller must render that as "not recorded" and never as an empty
   * name or a guess — the same rule the design states for a missing ledger date.
   */
  actorName: string | null;
  /**
   * The calendar's fields before and after, as recorded at the time.
   *
   * Deliberately NOT diffed here. What a reader needs to see — "Working days:
   * Sun–Thu became Sun–Wed" — is a display question in two languages, and the
   * surface for it is not drawn in Template 5, which shows only the button. A
   * service that invented a diff shape would be choosing that design in the
   * backend where nobody would look for it.
   */
  before: unknown;
  after: unknown;
}
