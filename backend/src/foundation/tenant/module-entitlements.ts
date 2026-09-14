// ACC-79 — what a tenant may use, per functional module, in three states.
//
// A pure function, deliberately, and kept outside TenantService. Two callers
// need exactly this answer and must never disagree about it: the entitlements
// endpoint the frontend shell reads, and ModuleGuard, which today reads the
// same `settings.modules` boolean directly and ignores plan tiers. ModuleGuard
// has no consumers yet (no controller carries @RequiresModule), so nothing is
// inconsistent today — but the first functional module that ships behind it
// should resolve through this function too, or the rail will show a module as
// read-only while the API lets it be written. See SYSTEM-REFERENCE §1.

export type ModuleAccessLevel = 'FULL' | 'READ_ONLY' | 'NONE';

export interface PlanModuleAccess {
  moduleKey: string;
  accessLevel: ModuleAccessLevel;
}

// ─────────────────────────────────────────────────────────────────────────────
// NULL-PLAN FALLBACK — a legacy compatibility rule, NOT a product decision.
//
// Organization.planId is nullable, and its own schema comment says why:
// "pre-ACC-13 tenants have none yet". Every seeded tenant is in that state.
// With no plan there is no PlanModule row to read a tier from, so something
// has to be returned, and this is it: every module the tenant has enabled is
// treated as FULL.
//
// Why FULL and not NONE — and note the tense. TODAY THE CHOICE CHANGES
// NOTHING: no tenant has any module switched on (every org's settings.modules
// key is absent), so FULL and NONE produce identical, empty module lists. It
// becomes load-bearing ONCE modules are switched on: from then, treating a
// missing plan as NONE would empty every tenant's rail of the modules they had
// just been given. FULL is chosen so that day does not arrive as a surprise.
// It is NOT an endorsement of "no plan means everything". Read it as a debt:
//
//   The first tenant put on Starter with planId still null would receive
//   Standards at FULL, not READ_ONLY, and nothing would say so.
//
// Revisit this once tenants carry plans. Assigning the seeded tenants to a
// Plan is a pricing decision and was deliberately kept out of ACC-79.
//
// module-entitlements.spec.ts pins this value by name, so changing it fails a
// test that states what it was for.
// ─────────────────────────────────────────────────────────────────────────────
export const NULL_PLAN_FALLBACK_ACCESS: ModuleAccessLevel = 'FULL';

/**
 * Resolves each functional module to the access level this tenant has.
 *
 * A module is usable only when BOTH halves allow it:
 *   - the tenant has it switched on (`Organization.settings.modules[key]`)
 *   - the tenant's plan grants it above NONE (`PlanModule.accessLevel`)
 *
 * Modules that resolve to NONE are OMITTED from the result rather than
 * returned as NONE. This payload is read by every signed-in user, and which
 * modules a tenant is not licensed for is commercial detail that belongs on
 * the admin's Plan & modules page, not in a non-admin's network tab. An absent
 * key and NONE mean the same thing to every consumer.
 *
 * @param enabledModules `settings.modules` as stored — boolean per module key
 * @param planModules the plan's PlanModule rows, or `null` when the tenant has
 *                    no plan at all (see NULL_PLAN_FALLBACK_ACCESS)
 */
export function resolveModuleEntitlements(
  enabledModules: Record<string, boolean>,
  planModules: readonly PlanModuleAccess[] | null,
): Record<string, Exclude<ModuleAccessLevel, 'NONE'>> {
  const planLevels = new Map(planModules?.map((m) => [m.moduleKey, m.accessLevel]) ?? []);
  const result: Record<string, Exclude<ModuleAccessLevel, 'NONE'>> = {};

  for (const [moduleKey, enabled] of Object.entries(enabledModules)) {
    // `=== true`, not truthiness: settings is untyped JSON, and a stray
    // "false" string must not switch a module on.
    if (enabled !== true) continue;

    const level: ModuleAccessLevel =
      planModules === null
        ? NULL_PLAN_FALLBACK_ACCESS
        : // A plan that says nothing about a module does not grant it.
          (planLevels.get(moduleKey) ?? 'NONE');

    if (level !== 'NONE') result[moduleKey] = level;
  }

  return result;
}
