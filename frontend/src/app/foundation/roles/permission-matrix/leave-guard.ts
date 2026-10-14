import { CanDeactivateFn } from '@angular/router';

/**
 * ACC-120 slice 5, PR B (D11) — a screen that holds unsaved work it would be
 * costly to lose. The permission matrix is the first: a role's grid can carry
 * many changed cells, and an accidental click on the rail must not drop them.
 *
 * The screen answers; the guard only asks. `canLeave()` returns true when
 * there is nothing to lose, or a promise that settles once the person has
 * chosen in a confirmation.
 */
export interface LeaveGuarded {
  canLeave(): boolean | Promise<boolean>;
}

export const leaveGuard: CanDeactivateFn<LeaveGuarded> = (component) => component.canLeave();
