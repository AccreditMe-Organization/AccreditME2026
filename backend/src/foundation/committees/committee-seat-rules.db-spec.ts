/**
 * ACC-286 — required committee seats, read against a REAL Postgres
 * (npm run test:db).
 *
 * Only a database proves:
 *
 *   - the shared default: Chairman and Secretary are required on the SYSTEM
 *     rows the deploy's seed writes (seedSystemData(), run here as pre-deploy
 *     runs it), so every organisation has them with no backfill;
 *   - an organisation's override row is merged KEY BY KEY (Ahmad, 14 Nov, Q1):
 *     a label-only override (a renamed seat) keeps the default, an attribute
 *     override unticks it, and null puts the default back;
 *   - a hidden seat is not required, an organisation's own seat can be;
 *   - requiredSeats() — the one raw query every rule reads — answers exactly
 *     what LookupService.getValues() shows, filtered by `required`;
 *   - only an active membership of an ACTIVE user fills a seat (Q3);
 *   - the attributes endpoint accepts only the category's declared keys, of
 *     their declared type, and is audited;
 *   - another organisation's override changes nothing here.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { LookupService } from '../lookup/lookup.service';
import { activeMemberCount, requiredSeats, seatHolders } from './committee-seat-rules';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

describe('Required committee seats against a real database (ACC-286)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const lookups = new LookupService(prisma, audit);
  let seat: Record<string, string> = {};

  async function org(): Promise<{ id: string; actorId: string }> {
    const slug = `acc286s-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const actor = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-a@example.test`, name: 'Admin', status: 'ACTIVE' } });
    return { id: o.id, actorId: actor.id };
  }

  const keys = async (organizationId: string) => (await requiredSeats(prisma, organizationId)).map((s) => s.key);

  /** getValues() filtered by `required`, the screens' own reading, as keys. */
  const shownRequired = async (organizationId: string) =>
    (await lookups.getValues('committee_member_role', organizationId))
      .filter((v) => v.attributes?.['required'] === true)
      .map((v) => v.key)
      .sort();

  const refusal = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => unknown }) => e.getResponse?.() ?? `ERROR ${String(e)}`,
    );

  beforeAll(async () => {
    await prisma.onModuleInit();
    await lookups.seedSystemData();
    const values = await prisma.lookupValue.findMany({
      where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
      select: { id: true, key: true },
    });
    seat = Object.fromEntries(values.map((v) => [v.key, v.id]));
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('the shared default: Chairman and Secretary, in seat order, with their labels', async () => {
    const o = await org();
    expect(await requiredSeats(prisma, o.id)).toEqual([
      { id: seat['chairman'], key: 'chairman', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
      { id: seat['secretary'], key: 'secretary', labelEn: 'Secretary', labelAr: 'أمين السر' },
    ]);
    expect(await shownRequired(o.id)).toEqual(['chairman', 'secretary']);
  });

  it('a label-only override (a renamed seat) keeps the default, key by key, and the new label', async () => {
    const o = await org();
    await lookups.overrideLabel(seat['chairman']!, o.id, { labelOverrideEn: 'President', labelOverrideAr: 'الرئيس' }, o.actorId);

    const required = await requiredSeats(prisma, o.id);
    expect(required.map((s) => [s.key, s.labelEn, s.labelAr])).toEqual([
      ['chairman', 'President', 'الرئيس'],
      ['secretary', 'Secretary', 'أمين السر'],
    ]);
    const chairman = (await lookups.getValues('committee_member_role', o.id)).find((v) => v.key === 'chairman')!;
    expect(chairman.attributes).toEqual({ required: true });
    expect(chairman.labelEn).toBe('President');
  });

  it('an organisation unticks a seat through its override, then puts the default back with null', async () => {
    const o = await org();
    await lookups.overrideLabel(seat['secretary']!, o.id, { labelOverrideEn: 'Rapporteur' }, o.actorId);
    await lookups.overrideAttributes(seat['secretary']!, o.id, { attributes: { required: false } }, o.actorId);

    expect(await keys(o.id)).toEqual(['chairman']);
    expect(await shownRequired(o.id)).toEqual(['chairman']);
    // The label override survives the attribute write.
    const secretary = (await lookups.getValues('committee_member_role', o.id)).find((v) => v.key === 'secretary')!;
    expect(secretary.labelEn).toBe('Rapporteur');

    await lookups.overrideAttributes(seat['secretary']!, o.id, { attributes: { required: null } }, o.actorId);
    expect(await keys(o.id)).toEqual(['chairman', 'secretary']);
    expect(await shownRequired(o.id)).toEqual(['chairman', 'secretary']);
  });

  it('a non-default seat can be made required, and an organisation\'s own seat can be required', async () => {
    const o = await org();
    await lookups.overrideAttributes(seat['vice_chairman']!, o.id, { attributes: { required: true } }, o.actorId);
    await lookups.addValue('committee_member_role', o.id, { key: 'rapporteur', labelEn: 'Rapporteur', sortOrder: 70, attributes: { required: true } } as never, o.actorId);

    expect(await keys(o.id)).toEqual(['chairman', 'vice_chairman', 'secretary', 'rapporteur']);
    expect(await shownRequired(o.id)).toEqual(['chairman', 'rapporteur', 'secretary', 'vice_chairman']);
  });

  it('a hidden seat is not required', async () => {
    const o = await org();
    await lookups.hideSystemValue(seat['secretary']!, o.id, o.actorId);

    expect(await keys(o.id)).toEqual(['chairman']);
    expect(await shownRequired(o.id)).toEqual(['chairman']);
  });

  it('should NOT return records belonging to a different tenant: another organisation\'s override changes nothing here', async () => {
    const mine = await org();
    const theirs = await org();
    await lookups.overrideAttributes(seat['chairman']!, theirs.id, { attributes: { required: false } }, theirs.actorId);
    await lookups.addValue('committee_member_role', theirs.id, { key: 'theirs_only', labelEn: 'Theirs', sortOrder: 70, attributes: { required: true } } as never, theirs.actorId);

    expect(await keys(mine.id)).toEqual(['chairman', 'secretary']);
    expect(await keys(theirs.id)).toEqual(['secretary', 'theirs_only']);
  });

  describe('the attributes endpoint', () => {
    it('refuses a key the category does not declare, or a value of the wrong type, and writes nothing', async () => {
      const o = await org();
      for (const attributes of [{ colour: 'red' }, { required: 'yes' }, { required: 1 }]) {
        expect(await refusal(lookups.overrideAttributes(seat['chairman']!, o.id, { attributes }, o.actorId))).toMatchObject({
          statusCode: 400,
          code: 'LOOKUP_ATTRIBUTE_INVALID',
          key: Object.keys(attributes)[0],
        });
      }
      expect(await prisma.lookupValue.count({ where: { organizationId: o.id } })).toBe(0);
      expect(await keys(o.id)).toEqual(['chairman', 'secretary']);
    });

    it('is audited with the organisation\'s values before and after', async () => {
      const o = await org();
      await lookups.overrideAttributes(seat['chairman']!, o.id, { attributes: { required: false } }, o.actorId);

      const row = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'LookupValue', objectId: seat['chairman'] } });
      expect(row.before).toEqual({ attributes: {} });
      expect(row.after).toEqual({ attributes: { required: false } });
    });

    it('refuses another organisation\'s own value and an invented id: only a shared value has an override', async () => {
      const o = await org();
      const theirs = await org();
      const own = await lookups.addValue('committee_member_role', theirs.id, { key: 'x', labelEn: 'X' } as never, theirs.actorId);
      expect(await refusal(lookups.overrideAttributes(own.id, o.id, { attributes: { required: true } }, o.actorId))).toMatchObject({ statusCode: 404 });
      expect(await refusal(lookups.overrideAttributes('invented', o.id, { attributes: { required: true } }, o.actorId))).toMatchObject({ statusCode: 404 });
    });
  });

  describe('who fills a seat (Q3)', () => {
    it('only an active membership of an ACTIVE user: invited, inactive and suspended users fill nothing, and do not count toward quorum', async () => {
      const o = await org();
      const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${o.id}` } });
      const c = await prisma.committee.create({
        data: { organizationId: o.id, nameEn: 'C', typeValueId: 't', orgUnitId: unit.id, quorumCount: 3, meetingFrequency: 'MONTHLY' },
      });
      const person = async (status: 'ACTIVE' | 'INVITED' | 'INACTIVE' | 'SUSPENDED', roleKey: string, isActive = true) => {
        const u = await prisma.user.create({ data: { organizationId: o.id, email: `${randomUUID()}@example.test`, name: status, status } });
        return prisma.committeeMember.create({
          data: { organizationId: o.id, committeeId: c.id, userId: u.id, roleValueId: seat[roleKey]!, isActive, leftAt: isActive ? null : new Date() },
        });
      };
      await person('INVITED', 'chairman');
      await person('INACTIVE', 'chairman');
      await person('SUSPENDED', 'chairman');
      await person('ACTIVE', 'chairman', false); // left the committee
      const secretary = await person('ACTIVE', 'secretary');

      const holders = await seatHolders(prisma, o.id, c.id, [seat['chairman']!, seat['secretary']!]);
      expect(holders.map((h) => h.memberId)).toEqual([secretary.id]);
      expect(await activeMemberCount(prisma, o.id, c.id)).toBe(1);
      // Another organisation's id for the committee reads nothing.
      const theirs = await org();
      expect(await seatHolders(prisma, theirs.id, c.id, [seat['secretary']!])).toEqual([]);
      expect(await activeMemberCount(prisma, theirs.id, c.id)).toBe(0);
    });
  });
});
