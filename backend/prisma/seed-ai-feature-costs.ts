/**
 * ACC-194 — the three priced AI features, seeded once (D4, D12, D17).
 *
 *   npm run seed:ai-feature-costs              # dry run — writes nothing
 *   npm run seed:ai-feature-costs -- --execute # apply
 *
 * Run AFTER the deploy, dry run first: the AiFeatureCost restriction columns
 * do not exist on a database the migration has not reached.
 *
 * Creates a row only when none exists for the feature, and NEVER overwrites
 * one: an edited cost or restriction stays as someone set it. morning_briefing
 * is created restricted to al-nakheel; if al-nakheel cannot be found it is
 * still created restricted, open to nobody, and the run says so.
 *
 * AiFeatureCost is platform data, so each created row gets one audit row in
 * the platform organisation's trail. Prints feature keys and costs only.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { planAiFeatureCostSeed, AI_FEATURE_COST_SEED } from '../src/foundation/ai/ai-feature-cost.seed';

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const existing = await prisma.aiFeatureCost.findMany({ select: { featureKey: true } });
    const slugs = [...new Set(AI_FEATURE_COST_SEED.map((r) => r.restrictedToSlug).filter((s): s is string => !!s))];
    const orgs = await prisma.organization.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
    const actions = planAiFeatureCostSeed(new Set(existing.map((r) => r.featureKey)), new Map(orgs.map((o) => [o.slug, o.id])));

    console.log(`AI feature costs (ACC-194) — ${execute ? 'EXECUTE' : 'dry run, writes nothing'}`);
    for (const a of actions) {
      if (a.kind === 'keep') {
        console.log(`  keep    ${a.featureKey} (${a.reason})`);
      } else {
        const scope = a.restricted ? `restricted to ${a.allowedOrganizationIds.length} organisation(s)` : 'open to every organisation';
        console.log(`  create  ${a.featureKey} = ${a.creditCost} credits, ${scope}${a.warning ? ` — WARNING: ${a.warning}` : ''}`);
      }
    }

    const creates = actions.filter((a) => a.kind === 'create');
    if (!execute || creates.length === 0) {
      console.log(creates.length === 0 ? 'Nothing to create.' : 'Dry run: re-run with --execute to apply.');
      return;
    }

    const platform = await prisma.organization.findFirst({ where: { isPlatformOrg: true }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      for (const a of creates) {
        if (a.kind !== 'create') continue;
        const row = await tx.aiFeatureCost.create({
          data: {
            featureKey: a.featureKey,
            creditCost: a.creditCost,
            description: a.description,
            restricted: a.restricted,
            allowedOrganizationIds: a.allowedOrganizationIds,
          },
        });
        if (platform) {
          await tx.auditLog.create({
            data: {
              organizationId: platform.id,
              action: 'CREATE',
              objectType: 'AiFeatureCost',
              objectId: row.id,
              after: { featureKey: a.featureKey, creditCost: a.creditCost, restricted: a.restricted, allowedOrganizationIds: a.allowedOrganizationIds },
              metadata: { event: 'ai_feature_cost_seeded', ticket: 'ACC-194' },
            },
          });
        }
      }
    });
    console.log(`Created ${creates.length} row(s).${platform ? '' : ' No platform organisation found, so no audit rows were written.'}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`seed:ai-feature-costs failed: ${(error as Error).message}`);
  process.exit(1);
});
