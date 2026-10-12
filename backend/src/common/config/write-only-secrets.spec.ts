import { changedFieldNames, mergeKeepingSecrets } from './write-only-secrets';

// ACC-181 D4 — the one write-only rule, shared by storage and email settings.
describe('mergeKeepingSecrets (ACC-181)', () => {
  const stored = { host: 'mail.example.test', password: 'stored-secret', fromName: 'Quality' };

  it('keeps a stored value the caller did not send', () => {
    expect(mergeKeepingSecrets(stored, { host: 'smtp.example.test' })).toEqual({
      host: 'smtp.example.test',
      password: 'stored-secret',
      fromName: 'Quality',
    });
  });

  it('with no secret list, an empty string keeps the stored value for EVERY key (storage)', () => {
    expect(mergeKeepingSecrets(stored, { password: '', fromName: '' })).toEqual(stored);
  });

  it('with a secret list, an empty string keeps a secret and clears anything else', () => {
    expect(mergeKeepingSecrets(stored, { password: '', fromName: '' }, ['password'])).toEqual({
      host: 'mail.example.test',
      password: 'stored-secret',
    });
  });

  it('replaces a value that was sent, secret or not', () => {
    expect(mergeKeepingSecrets(stored, { password: 'new-secret', port: 465 }, ['password'])).toEqual({
      host: 'mail.example.test',
      password: 'new-secret',
      fromName: 'Quality',
      port: 465,
    });
  });

  it('starts from nothing when nothing is stored', () => {
    expect(mergeKeepingSecrets(undefined, { host: 'a.example.test', password: '' }, ['password'])).toEqual({
      host: 'a.example.test',
    });
  });

  it('never changes the objects it was given', () => {
    const before = { ...stored };
    mergeKeepingSecrets(stored, { host: 'x.example.test', fromName: '' }, ['password']);
    expect(stored).toEqual(before);
  });
});

describe('changedFieldNames (ACC-181)', () => {
  it('names each field that differs, added, removed or changed, with its prefix', () => {
    expect(
      changedFieldNames({ host: 'a', password: 'x', fromName: 'n' }, { host: 'b', password: 'x', port: 25 }, 'smtp.').sort(),
    ).toEqual(['smtp.fromName', 'smtp.host', 'smtp.port']);
  });

  it('is empty when nothing differs, and treats a missing block as empty', () => {
    expect(changedFieldNames({ host: 'a' }, { host: 'a' })).toEqual([]);
    expect(changedFieldNames(undefined, { host: 'a' })).toEqual(['host']);
  });

  it('returns names only, never a value', () => {
    const names = changedFieldNames({ password: 'old-secret' }, { password: 'new-secret' });
    expect(names).toEqual(['password']);
    expect(JSON.stringify(names)).not.toMatch(/secret/);
  });
});
