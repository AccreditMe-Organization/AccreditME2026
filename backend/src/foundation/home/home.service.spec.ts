import { HomeService } from './home.service';
import { SetupHealthService } from '../setup-health/setup-health.service';
import { UserHomeCountsService } from '../user/user-home-counts.service';
import { CommitteeHomeService } from '../committees/committee-home.service';

// ACC-279 — the admin summary returns only the parts the caller may see, and a
// part that fails says so without blanking the others.

const ORG = 'org-a';
const SLICE = { open: 2, blocksWork: 1, top: [], freshness: [] };
const USERS = { active: 3, invited: 1, invitedExpired: 0, seats: null };
const COMMITTEES = { inForce: 4, belowQuorum: 1 };

function setup() {
  const setupHealth = { getHomeSlice: jest.fn().mockResolvedValue(SLICE) };
  const users = { counts: jest.fn().mockResolvedValue(USERS) };
  const committees = { homeCounts: jest.fn().mockResolvedValue(COMMITTEES) };
  const service = new HomeService(
    setupHealth as unknown as SetupHealthService,
    users as unknown as UserHomeCountsService,
    committees as unknown as CommitteeHomeService,
  );
  return { setupHealth, users, committees, service };
}

describe('HomeService.adminSummary (ACC-279)', () => {
  it('no permission: every part null, and nothing is read', async () => {
    const { setupHealth, users, committees, service } = setup();

    expect(await service.adminSummary(ORG, ['committees:approve', 'tenant:view'])).toEqual({ setup: null, users: null, committees: null });
    expect(setupHealth.getHomeSlice).not.toHaveBeenCalled();
    expect(users.counts).not.toHaveBeenCalled();
    expect(committees.homeCounts).not.toHaveBeenCalled();
  });

  it("each part on its own permission, for the caller's organisation", async () => {
    const { setupHealth, users, committees, service } = setup();

    expect(await service.adminSummary(ORG, ['setup:view'])).toEqual({ setup: SLICE, users: null, committees: null });
    expect(await service.adminSummary(ORG, ['users:view'])).toEqual({ setup: null, users: USERS, committees: null });
    expect(await service.adminSummary(ORG, ['committees:view'])).toEqual({ setup: null, users: null, committees: COMMITTEES });
    expect(setupHealth.getHomeSlice).toHaveBeenCalledWith(ORG);
    expect(committees.homeCounts).toHaveBeenCalledWith(ORG);
    expect(users.counts).toHaveBeenCalledWith(ORG, { withSeats: false });
  });

  it('seats are asked for only with tenant:view as well', async () => {
    const { users, service } = setup();

    await service.adminSummary(ORG, ['users:view', 'tenant:view']);

    expect(users.counts).toHaveBeenCalledWith(ORG, { withSeats: true });
  });

  it('a part that fails answers { failed: true }; the others still arrive', async () => {
    const { users, service } = setup();
    users.counts.mockRejectedValue(new Error('connection lost'));

    expect(await service.adminSummary(ORG, ['setup:view', 'users:view', 'committees:view'])).toEqual({
      setup: SLICE,
      users: { failed: true },
      committees: COMMITTEES,
    });
  });

  it('the parts are read together, not one after another', async () => {
    const { setupHealth, users, committees, service } = setup();
    const started: string[] = [];
    const hold = (name: string) => () => {
      started.push(name);
      return new Promise(() => undefined);
    };
    setupHealth.getHomeSlice.mockImplementation(hold('setup'));
    users.counts.mockImplementation(hold('users'));
    committees.homeCounts.mockImplementation(hold('committees'));

    void service.adminSummary(ORG, ['setup:view', 'users:view', 'committees:view']);
    await Promise.resolve();

    expect(started.sort()).toEqual(['committees', 'setup', 'users']);
  });
});
