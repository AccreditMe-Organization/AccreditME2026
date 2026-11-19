import { applyGrants, KEY, planGrants } from '../../../prisma/backfill-acc216-manage-sessions-permission';

jest.mock('dotenv/config', () => ({}));

/**
 * ACC-216 — the users:manage_sessions grant backfill's plan and its writes,
 * against an in-memory client. Grant-only, written to RolePermission directly,
 * one audit row per organisation, customers refused, the platform organisation
 * skipped, a re-run plans 0. Nothing here touches a database.
 */
function build(extraOrgs: { id: string; slug: string; isPlatformOrg: boolean }[] = []) {
  const orgs = [
    { id: 'o-a', slug: 'al-manara', isPlatformOrg: false },
    { id: 'o-b', slug: 'al-nakheel', isPlatformOrg: false },
    { id: 'o-p', slug: 'platform', isPlatformOrg: true },
    { id: 'o-x', slug: 'no-admin-role', isPlatformOrg: false },
    ...extraOrgs,
  ];
  const roles = [
    { id: 'r-a', organizationId: 'o-a', key: 'TENANT_ADMIN' },
    { id: 'r-b', organizationId: 'o-b', key: 'TENANT_ADMIN' },
    { id: 'r-p', organizationId: 'o-p', key: 'TENANT_ADMIN' },
    { id: 'r-c', organizationId: 'o-c', key: 'TENANT_ADMIN' },
  ];
  let permission: { id: string } | null = null;
  const grants: { id: string; roleId: string; permissionId: string }[] = [];
  const audits: Record<string, unknown>[] = [];
  const client = {
    organization: { findMany: jest.fn(() => Promise.resolve(orgs)) },
    permission: {
      findFirst: jest.fn(() => Promise.resolve(permission)),
      upsert: jest.fn(() => {
        permission ??= { id: 'perm-manage-sessions' };
        return Promise.resolve(permission);
      }),
    },
    role: {
      findMany: jest.fn(({ where }: { where: { organizationId: { in: string[] }; key: string } }) =>
        Promise.resolve(
          roles
            .filter((r) => where.organizationId.in.includes(r.organizationId) && r.key === where.key)
            .map((r) => ({
              id: r.id,
              organizationId: r.organizationId,
              rolePermissions: grants.filter((g) => g.roleId === r.id).map((g) => ({ id: g.id })),
            })),
        ),
      ),
    },
    rolePermission: {
      create: jest.fn(({ data }: { data: { roleId: string; permissionId: string } }) => {
        const row = { id: `rp-${grants.length + 1}`, ...data };
        grants.push(row);
        return Promise.resolve({ id: row.id });
      }),
    },
    auditLog: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return Promise.resolve({});
      }),
    },
  };
  const withTx = { ...client, $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(client)) };
  return { client: withTx, grants, audits };
}

describe('backfill-acc216-manage-sessions-permission', () => {
  it('plans one grant per fixture tenant without it, skipping the platform organisation', async () => {
    const t = build();
    const plan = await planGrants(t.client as never);
    expect(plan.catalogueRowMissing).toBe(true);
    expect(plan.grants.map((g) => g.slug)).toEqual(['al-manara', 'al-nakheel']);
    expect(plan.customers).toEqual([]);
    expect(plan.skipped).toEqual(['platform']);
    expect(plan.withoutRole).toEqual(['no-admin-role']);
    expect(t.grants).toEqual([]);
  });

  it('--execute writes RolePermission directly, with one audit row per organisation, in one transaction; a re-run plans 0', async () => {
    const t = build();
    const written = await applyGrants(t.client as never, await planGrants(t.client as never));
    expect(written).toBe(2);
    expect(t.client.$transaction).toHaveBeenCalledTimes(1);
    expect(t.grants.map((g) => g.roleId)).toEqual(['r-a', 'r-b']);
    expect(t.audits).toEqual([
      expect.objectContaining({ organizationId: 'o-a', actorId: null, action: 'CREATE', objectType: 'RolePermission', after: expect.objectContaining({ permission: KEY }) as unknown }),
      expect.objectContaining({ organizationId: 'o-b', actorId: null, action: 'CREATE', objectType: 'RolePermission', after: expect.objectContaining({ permission: KEY }) as unknown }),
    ]);

    const again = await planGrants(t.client as never);
    expect(again.grants).toEqual([]);
    expect(again.alreadyHeld).toEqual(['al-manara', 'al-nakheel']);
    expect(await applyGrants(t.client as never, again)).toBe(0);
    expect(t.audits).toHaveLength(2);
  });

  it('refuses customers: a customer organisation in the plan means --execute writes NOTHING', async () => {
    const t = build([{ id: 'o-c', slug: 'a-real-hospital', isPlatformOrg: false }]);
    const plan = await planGrants(t.client as never);
    expect(plan.customers).toEqual(['a-real-hospital']);
    await expect(applyGrants(t.client as never, plan)).rejects.toThrow('Refused: customer organisation(s) a-real-hospital');
    expect(t.client.$transaction).not.toHaveBeenCalled();
    expect(t.grants).toEqual([]);
    expect(t.audits).toEqual([]);
  });

  it('grants users:manage_sessions and nothing else', () => {
    expect(KEY).toBe('users:manage_sessions');
  });
});
