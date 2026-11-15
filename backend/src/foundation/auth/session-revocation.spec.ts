import { endEverySessionInTx } from './session-revocation';

/**
 * ACC-188 (shared with ACC-164) — ending every session, inside the caller's
 * transaction: the version bump, the refresh rows, Better Auth's sessions.
 */
describe('endEverySessionInTx', () => {
  const now = new Date('2026-11-14T09:00:00.000Z');
  const makeTx = () => ({
    user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      create: jest.fn(),
    },
    authSession: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
  });

  it('bumps tokenVersion, revokes every live refresh row and deletes Better Auth sessions, all scoped', async () => {
    const tx = makeTx();
    await endEverySessionInTx(tx as never, { id: 'u-1', organizationId: 'org-a', authUserId: 'au-1' }, now);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', organizationId: 'org-a' },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', organizationId: 'org-a', revokedAt: null },
      data: { revokedAt: now },
    });
    expect(tx.authSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'au-1' } });
  });

  it('never creates a refresh row (ACC-126: one create site)', async () => {
    const tx = makeTx();
    await endEverySessionInTx(tx as never, { id: 'u-1', organizationId: 'org-a', authUserId: 'au-1' }, now);
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
  });

  it('skips Better Auth sessions for a person with no Better Auth account', async () => {
    const tx = makeTx();
    await endEverySessionInTx(tx as never, { id: 'u-1', organizationId: 'org-a', authUserId: null }, now);
    expect(tx.authSession.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.updateMany).toHaveBeenCalled();
  });
});
