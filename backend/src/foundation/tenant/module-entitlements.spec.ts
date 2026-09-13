import {
  NULL_PLAN_FALLBACK_ACCESS,
  PlanModuleAccess,
  resolveModuleEntitlements,
} from './module-entitlements';

describe('resolveModuleEntitlements (ACC-79)', () => {
  // ── THE FALLBACK PIN ─────────────────────────────────────────────────────
  //
  // If this test fails, someone changed what a tenant with no plan receives.
  // Read NULL_PLAN_FALLBACK_ACCESS's comment before "fixing" the test.
  //
  // FULL was chosen for legacy compatibility, not as a product rule: every
  // seeded tenant has planId null ("pre-ACC-13 tenants have none yet"), and
  // resolving that to NONE would empty every existing tenant's rail. The cost
  // is that a tenant put on Starter with planId still unset receives Standards
  // at FULL instead of READ_ONLY. It is meant to be revisited once tenants
  // carry plans — deliberately, by someone who knows why it was FULL, which is
  // what a failing test here forces.
  describe('null-plan fallback', () => {
    it('is FULL, and is a named constant rather than an inline default', () => {
      expect(NULL_PLAN_FALLBACK_ACCESS).toBe('FULL');
    });

    it('grants every enabled module at the fallback level when the tenant has no plan', () => {
      const result = resolveModuleEntitlements({ documents: true, standards: true }, null);

      expect(result).toEqual({
        documents: NULL_PLAN_FALLBACK_ACCESS,
        standards: NULL_PLAN_FALLBACK_ACCESS,
      });
    });

    it('does NOT apply to a tenant whose plan grants nothing — [] is not null', () => {
      // The distinction the fallback depends on. An empty PlanModule list is a
      // real plan that licenses nothing; only an absent plan falls back.
      expect(resolveModuleEntitlements({ documents: true }, [])).toEqual({});
    });

    it('still requires the module to be switched on for the tenant', () => {
      expect(resolveModuleEntitlements({ documents: false, standards: true }, null)).toEqual({
        standards: 'FULL',
      });
    });
  });

  describe('with a plan', () => {
    const starter: PlanModuleAccess[] = [
      { moduleKey: 'documents', accessLevel: 'FULL' },
      { moduleKey: 'standards', accessLevel: 'READ_ONLY' },
      { moduleKey: 'audits', accessLevel: 'NONE' },
    ];

    it('carries the plan tier through, including READ_ONLY', () => {
      const result = resolveModuleEntitlements(
        { documents: true, standards: true },
        starter,
      );
      expect(result).toEqual({ documents: 'FULL', standards: 'READ_ONLY' });
    });

    it('omits a module the plan sets to NONE even when the tenant switched it on', () => {
      expect(resolveModuleEntitlements({ audits: true }, starter)).toEqual({});
    });

    it('omits a module the plan does not mention at all — silence does not grant', () => {
      expect(resolveModuleEntitlements({ incidents: true }, starter)).toEqual({});
    });

    it('omits a module the tenant switched off even when the plan grants FULL', () => {
      expect(resolveModuleEntitlements({ documents: false }, starter)).toEqual({});
    });
  });

  // NONE never appears in the output. Every signed-in user reads this payload,
  // and which modules a tenant is NOT licensed for belongs on the admin's Plan
  // & modules page, not in a non-admin's network tab.
  it('never returns NONE as a value — an unusable module is an absent key', () => {
    const result = resolveModuleEntitlements(
      { documents: true, audits: true, incidents: true },
      [
        { moduleKey: 'documents', accessLevel: 'FULL' },
        { moduleKey: 'audits', accessLevel: 'NONE' },
      ],
    );

    expect(Object.values(result)).not.toContain('NONE');
    expect(Object.keys(result)).toEqual(['documents']);
  });

  // settings is untyped JSON. A module must be switched on by the boolean
  // `true`, not by anything truthy that happens to be stored there.
  it('does not treat truthy non-boolean values as enabled', () => {
    const stored = { documents: 'true', standards: 1 } as unknown as Record<string, boolean>;
    expect(resolveModuleEntitlements(stored, null)).toEqual({});
  });

  it('returns nothing for a tenant with no modules configured', () => {
    expect(resolveModuleEntitlements({}, null)).toEqual({});
  });
});
