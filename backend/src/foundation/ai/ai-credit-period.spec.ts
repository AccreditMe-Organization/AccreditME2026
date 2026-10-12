import { activationOf, creditPeriodAt, renewalAt } from './ai-credit-period';

const iso = (d: Date): string => d.toISOString();
const at = (s: string): Date => new Date(s);

describe('creditPeriodAt (ACC-194, D2)', () => {
  describe('monthly, when activation falls on the 1st–28th', () => {
    const activation = at('2026-09-21T04:39:49.741Z'); // al-nakheel's bootstrappedAt

    it('the first period begins at activation and renews at 00:00 UTC on the same day next month', () => {
      const p = creditPeriodAt(activation, at('2026-10-12T13:00:00Z'));
      expect(iso(p.start)).toBe('2026-09-21T04:39:49.741Z');
      expect(iso(p.renewsAt)).toBe('2026-10-21T00:00:00.000Z');
    });

    it('a renewal instant belongs to the new period', () => {
      const p = creditPeriodAt(activation, at('2026-10-21T00:00:00Z'));
      expect(iso(p.start)).toBe('2026-10-21T00:00:00.000Z');
      expect(iso(p.renewsAt)).toBe('2026-11-21T00:00:00.000Z');
    });

    it('one millisecond before renewal is still the old period', () => {
      const p = creditPeriodAt(activation, at('2026-10-20T23:59:59.999Z'));
      expect(iso(p.renewsAt)).toBe('2026-10-21T00:00:00.000Z');
    });

    it('crosses a year and keeps the day', () => {
      const p = creditPeriodAt(activation, at('2027-01-30T00:00:00Z'));
      expect(iso(p.start)).toBe('2027-01-21T00:00:00.000Z');
      expect(iso(p.renewsAt)).toBe('2027-02-21T00:00:00.000Z');
    });

    it('the 28th renews on the 28th, February included, in a non-leap and a leap year', () => {
      const a = at('2026-01-28T10:00:00Z');
      expect(iso(creditPeriodAt(a, at('2027-02-28T05:00:00Z')).start)).toBe('2027-02-28T00:00:00.000Z');
      expect(iso(creditPeriodAt(a, at('2028-02-28T05:00:00Z')).renewsAt)).toBe('2028-03-28T00:00:00.000Z');
    });

    it('the 1st renews on the 1st', () => {
      const p = creditPeriodAt(at('2026-03-01T00:00:00Z'), at('2026-07-15T00:00:00Z'));
      expect(iso(p.start)).toBe('2026-07-01T00:00:00.000Z');
      expect(iso(p.renewsAt)).toBe('2026-08-01T00:00:00.000Z');
    });

    it('catches up across many missed periods in one step', () => {
      const p = creditPeriodAt(activation, at('2029-06-25T00:00:00Z'));
      expect(iso(p.start)).toBe('2029-06-21T00:00:00.000Z');
      expect(iso(p.renewsAt)).toBe('2029-07-21T00:00:00.000Z');
    });
  });

  describe('every 30 days, when activation falls on the 29th, 30th or 31st', () => {
    it.each([
      ['29th', '2026-01-29T09:00:00Z', '2026-02-28T00:00:00.000Z', '2026-03-30T00:00:00.000Z'],
      ['30th', '2026-01-30T09:00:00Z', '2026-03-01T00:00:00.000Z', '2026-03-31T00:00:00.000Z'],
      ['31st', '2026-01-31T09:00:00Z', '2026-03-02T00:00:00.000Z', '2026-04-01T00:00:00.000Z'],
    ])('the %s renews every 30 days from its date at 00:00 UTC', (_label, activation, first, second) => {
      expect(iso(renewalAt(at(activation), 1))).toBe(first);
      expect(iso(renewalAt(at(activation), 2))).toBe(second);
    });

    it('30-day mode never turns monthly, even when a period starts early in a month', () => {
      const a = at('2026-01-31T09:00:00Z');
      // The second period starts on 2 March: "day 2" must NOT switch it to monthly.
      const p = creditPeriodAt(a, at('2026-03-10T00:00:00Z'));
      expect(iso(p.start)).toBe('2026-03-02T00:00:00.000Z');
      expect(iso(p.renewsAt)).toBe('2026-04-01T00:00:00.000Z');
    });

    it('in a leap year the 29th of January still counts 30 days', () => {
      expect(iso(renewalAt(at('2028-01-29T00:00:00Z'), 1))).toBe('2028-02-28T00:00:00.000Z');
    });

    it('catches up across many missed periods', () => {
      const a = at('2026-01-31T00:00:00Z');
      const p = creditPeriodAt(a, at('2026-12-31T12:00:00Z'));
      expect(p.start.getTime()).toBeLessThanOrEqual(at('2026-12-31T12:00:00Z').getTime());
      expect(p.renewsAt.getTime()).toBeGreaterThan(at('2026-12-31T12:00:00Z').getTime());
      expect((p.renewsAt.getTime() - p.start.getTime()) / 86_400_000).toBe(30);
    });
  });

  it('before activation (a clock behind) still answers the first period', () => {
    const a = at('2026-09-21T04:39:00Z');
    const p = creditPeriodAt(a, at('2026-09-20T00:00:00Z'));
    expect(iso(p.start)).toBe(iso(a));
    expect(iso(p.renewsAt)).toBe('2026-10-21T00:00:00.000Z');
  });

  it('activation is bootstrappedAt, falling back to createdAt (D14)', () => {
    const createdAt = at('2026-09-21T04:38:14Z');
    const bootstrappedAt = at('2026-09-21T04:39:49Z');
    expect(activationOf({ bootstrappedAt, createdAt })).toBe(bootstrappedAt);
    expect(activationOf({ bootstrappedAt: null, createdAt })).toBe(createdAt);
  });
});
