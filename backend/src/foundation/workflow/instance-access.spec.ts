import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { INSTANCE_NOT_FOUND, InstanceAccess } from './instance-access';
import type { StagePool, StagePoolService } from './stage-pool.service';

// ACC-282 — the ONE place the workflow read and act rule lives. Proved on real
// rows in pool-member-moves.db-spec.ts; this pins the order and the costs.

const ORG = 'org-a';
const INSTANCE = { id: 'wi-1', objectType: 'COMMITTEE', objectId: 'c-1' };
const STAGE = { id: 'st-1', nameEn: 'Terms Review', nameAr: null };

const pool = (members: string[], direct: string[] = members): StagePool => ({
  members,
  direct,
  coveringFor: new Map(),
  actingHeadOf: new Map(),
  voteCommitteeId: null,
});

function setup(opts: { opens?: boolean; members?: string[] } = {}) {
  const visibility = {
    assertCanView: jest.fn(async () => {
      if (opens === false) throw new ForbiddenException('Required permission: committees:view');
    }),
    assertCanViewOrNotFound: jest.fn(async () => {
      if (opens === false) throw new NotFoundException(INSTANCE_NOT_FOUND);
    }),
  };
  const opens = opts.opens ?? true;
  const pools = { resolve: jest.fn(async () => pool(opts.members ?? ['u-pool'])) };
  const access = new InstanceAccess(visibility as unknown as ObjectVisibilityService, pools as unknown as StagePoolService);
  return { access, visibility, pools };
}

describe('InstanceAccess (ACC-282)', () => {
  it('reading is the parent rule alone: no pool is read, whatever the viewer holds', async () => {
    const { access, visibility, pools } = setup();
    await access.assertMayReadInstance(INSTANCE, ORG, { id: 'u-1', permissions: [] });
    await access.assertMayReadRecord('COMMITTEE', 'c-1', ORG, { id: 'u-1', permissions: ['workflows:view'] });
    expect(visibility.assertCanViewOrNotFound).toHaveBeenCalledWith('COMMITTEE', 'c-1', ORG, [], INSTANCE_NOT_FOUND, 'u-1');
    expect(visibility.assertCanView).toHaveBeenCalledWith('COMMITTEE', 'c-1', ORG, ['workflows:view'], 'u-1');
    expect(pools.resolve).not.toHaveBeenCalled();
  });

  it('acting: a pool member who may open the record is admitted, with one pool resolution returned', async () => {
    const { access, pools } = setup({ members: ['u-pool'] });
    const got = await access.assertMayAct(INSTANCE, STAGE, ORG, { id: 'u-pool', permissions: [] });
    expect(got.members).toEqual(['u-pool']);
    expect(pools.resolve).toHaveBeenCalledTimes(1);
  });

  it('acting: someone who may not open the record gets the 404 BEFORE any pool is read — even if the pool names them', async () => {
    const { access, pools } = setup({ opens: false, members: ['u-former'] });
    await expect(access.assertMayAct(INSTANCE, STAGE, ORG, { id: 'u-former', permissions: [] })).rejects.toEqual(
      new NotFoundException(INSTANCE_NOT_FOUND),
    );
    expect(pools.resolve).not.toHaveBeenCalled();
  });

  it("acting: someone who may open the record but is outside the pool keeps the pool's own refusals", async () => {
    const outside = setup({ members: ['u-pool'] });
    await expect(outside.access.assertMayAct(INSTANCE, STAGE, ORG, { id: 'u-other', permissions: ['workflows:view'] })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_IN_STAGE_POOL' }),
    });
    const empty = setup({ members: [] });
    await expect(empty.access.assertMayAct(INSTANCE, STAGE, ORG, { id: 'u-pool', permissions: [] })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STAGE_HAS_NO_ONE' }),
    });
  });

  it('mayAct is the pool rule: a member, or someone named directly who is away', () => {
    const { access } = setup();
    expect(access.mayAct(pool(['u-cover'], ['u-away']), 'u-away')).toBe(true);
    expect(access.mayAct(pool(['u-cover'], ['u-away']), 'u-cover')).toBe(true);
    expect(access.mayAct(pool([], ['u-away']), 'u-away')).toBe(false);
  });

  itEnforcesTenantIsolation('instance access', async () => {
    const { access, visibility, pools } = setup({ members: ['u-pool'] });
    await access.assertMayAct(INSTANCE, STAGE, 'org-b', { id: 'u-pool', permissions: [] });
    await access.assertMayReadRecord('COMMITTEE', 'c-1', 'org-b', { id: 'u-pool', permissions: [] });
    expect(visibility.assertCanViewOrNotFound.mock.calls[0]).toContain('org-b');
    expect(visibility.assertCanView.mock.calls[0]).toContain('org-b');
    expect((pools.resolve.mock.calls[0] as unknown[])[0]).toBe('org-b');
  });
});
