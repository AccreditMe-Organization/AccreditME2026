import { statusActionFor } from './user-status-actions.service';

// ACC-221 — the account owner is never offered Deactivate or Revoke
// invitation; the server refuses both (ACCOUNT_OWNER_PROTECTED).
describe('statusActionFor — the account owner (ACC-221)', () => {
  const all = () => true;

  it('offers nothing for the owner, active or invited', () => {
    expect(statusActionFor({ id: 'u1', status: 'ACTIVE', isAccountOwner: true }, all, 'me')).toBeNull();
    expect(statusActionFor({ id: 'u1', status: 'INVITED', isAccountOwner: true }, all, 'me')).toBeNull();
  });

  it('offers Deactivate and Revoke invitation for anyone else', () => {
    expect(statusActionFor({ id: 'u1', status: 'ACTIVE', isAccountOwner: false }, all, 'me')).toBe('deactivate');
    expect(statusActionFor({ id: 'u1', status: 'INVITED', isAccountOwner: false }, all, 'me')).toBe('revokeInvitation');
    // A list row has no isAccountOwner at all: it reads as "not the owner".
    expect(statusActionFor({ id: 'u1', status: 'ACTIVE' }, all, 'me')).toBe('deactivate');
  });
});
