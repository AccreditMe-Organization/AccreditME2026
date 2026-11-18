/**
 * ACC-317 — an organisation's working calendar is created by its first read,
 * against a REAL Postgres (npm run test:db).
 *
 * Only a database proves:
 *
 *   - the row is created by ONE native INSERT … ON CONFLICT DO NOTHING, never
 *     a plain INSERT after a read (and an empty-update upsert is NOT native:
 *     Prisma sends it as read, insert, read, so it is not used);
 *   - first reads at the same moment all get the one row, and none fails on
 *     the unique key (P2002), which is what a read-then-create did;
 *   - a calendar that already exists is returned as it is, by one read, with
 *     nothing written.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from './working-calendar.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

describe('A working calendar is created by its first read, once, on a real database (ACC-317)', () => {
  // A client that reports every statement it sends, so the spec reads the SQL
  // the service's own call produced.
  const pool = new Pool({ connectionString: url, max: 10 });
  const client = new PrismaClient({ adapter: new PrismaPg(pool), log: [{ emit: 'event', level: 'query' }] });
  const statements: string[] = [];
  client.$on('query', (e) => statements.push(e.query));
  const calendars = new WorkingCalendarService(client as unknown as PrismaService, { log: async () => undefined } as unknown as AuditLogService);

  const newOrganization = async (): Promise<string> => {
    const slug = `acc317-${randomUUID().slice(0, 8)}`;
    return (await client.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
  };

  afterAll(async () => {
    await client.$disconnect();
    await pool.end();
  });

  it('creates the row with ONE native INSERT … ON CONFLICT DO NOTHING, never a plain INSERT', async () => {
    const org = await newOrganization();
    statements.length = 0;

    await calendars.getOrCreate(org);

    const inserts = statements.filter((q) => /^INSERT INTO .*"WorkingCalendar"/.test(q));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('eight first reads at the same moment: one row, every read gets it, none fails', async () => {
    const org = await newOrganization();

    const results = await Promise.allSettled(Array.from({ length: 8 }, () => calendars.getOrCreate(org)));

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(ids.size).toBe(1);
    expect(await client.workingCalendar.count({ where: { organizationId: org } })).toBe(1);
  });

  it('an existing calendar is returned as it is, by one read, with nothing written', async () => {
    const org = await newOrganization();
    const saved = await client.workingCalendar.create({
      data: { organizationId: org, timezone: 'Europe/London', workingDays: [1, 2, 3, 4, 5], workingHoursStart: '09:00', workingHoursEnd: '17:00' },
    });

    statements.length = 0;
    const read = await calendars.getOrCreate(org);

    expect(statements.filter((q) => /"WorkingCalendar"/.test(q)).map((q) => q.split(' ')[0])).toEqual(['SELECT']);
    expect(read).toEqual(
      expect.objectContaining({ id: saved.id, timezone: 'Europe/London', workingDays: [1, 2, 3, 4, 5], workingHoursStart: '09:00', workingHoursEnd: '17:00' }),
    );
    const after = await client.workingCalendar.findUniqueOrThrow({ where: { organizationId: org } });
    expect(after.updatedAt.getTime()).toBe(saved.updatedAt.getTime());
  });
});
