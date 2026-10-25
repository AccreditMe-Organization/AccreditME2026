import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * ACC-263 — a plan's seat limits, Full users and Staff (Plan.maxFullUsers,
 * Plan.maxStaff). Each is a whole number of 1 or more, or null for unlimited.
 *
 * The form keeps the number and an "Unlimited" box side by side. Unlimited
 * saves null, whatever number is left in the (disabled) input, so a cleared
 * limit is always sent as null and never as a stale number.
 */
export function limitForSave(unlimited: boolean | null | undefined, value: number | null | undefined): number | null {
  return unlimited ? null : (value ?? null);
}

/** A limit read from a plan: null means unlimited. */
export function limitFromPlan(value: number | null | undefined): { unlimited: boolean; value: number | null } {
  return value === null || value === undefined ? { unlimited: true, value: null } : { unlimited: false, value };
}

/** Whole numbers only: 1.5 users is not a limit. Empty is left to `required`. */
export const wholeNumber: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = control.value;
  return v === null || v === undefined || v === '' || Number.isInteger(v) ? null : { integer: true };
};
