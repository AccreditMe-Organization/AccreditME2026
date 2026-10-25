import { FormControl } from '@angular/forms';
import { limitForSave, limitFromPlan, wholeNumber } from './plan-limits';

// ACC-263 — the seat limits' null mapping: Unlimited is null, both ways.
describe('plan limits', () => {
  describe('limitForSave', () => {
    it('saves the number when Unlimited is not ticked', () => {
      expect(limitForSave(false, 15)).toBe(15);
    });

    it('saves null when Unlimited is ticked, whatever number is left behind', () => {
      expect(limitForSave(true, 15)).toBeNull();
      expect(limitForSave(true, null)).toBeNull();
    });

    it('saves null rather than undefined for a missing number', () => {
      expect(limitForSave(false, undefined)).toBeNull();
    });
  });

  describe('limitFromPlan', () => {
    it('reads null as Unlimited with no number', () => {
      expect(limitFromPlan(null)).toEqual({ unlimited: true, value: null });
      expect(limitFromPlan(undefined)).toEqual({ unlimited: true, value: null });
    });

    it('reads a number as that number, not Unlimited', () => {
      expect(limitFromPlan(250)).toEqual({ unlimited: false, value: 250 });
    });
  });

  describe('wholeNumber', () => {
    const check = (v: unknown) => wholeNumber(new FormControl(v));

    it('accepts whole numbers and leaves empty to required', () => {
      expect(check(1)).toBeNull();
      expect(check(1500)).toBeNull();
      expect(check(null)).toBeNull();
      expect(check('')).toBeNull();
    });

    it('refuses a decimal', () => {
      expect(check(1.5)).toEqual({ integer: true });
    });
  });
});
