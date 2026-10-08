import { HttpErrorResponse } from '@angular/common/http';
import { refusalBody, refusalCode } from './refusal';

// ACC-120 slice 9d — the shared reader every screen uses for a refusal's code.
describe('refusalCode / refusalBody', () => {
  const refused = (error: unknown, status = 401) => new HttpErrorResponse({ error, status });

  it('reads the code and the details from a refusal body', () => {
    const err = refused({ statusCode: 401, code: 'ACCOUNT_LOCKED', lockedUntil: '2026-10-08T10:00:00.000Z' });
    expect(refusalCode(err)).toBe('ACCOUNT_LOCKED');
    expect(refusalBody(err)?.['lockedUntil']).toBe('2026-10-08T10:00:00.000Z');
  });

  it('gives null for anything that is not an HTTP error with an object body', () => {
    for (const err of [
      new Error('boom'),
      null,
      'ACCOUNT_LOCKED',
      refused(null),
      refused('plain text'),
      refused(['code']),
    ]) {
      expect(refusalCode(err)).toBeNull();
    }
    expect(refusalBody(refused('plain text'))).toBeNull();
  });

  it('gives null for a code that is not a string', () => {
    expect(refusalCode(refused({ code: 42 }))).toBeNull();
    expect(refusalCode(refused({ message: 'no code' }))).toBeNull();
  });
});
