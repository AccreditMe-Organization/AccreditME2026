import { errorKind } from './error-kind';

// ACC-297 (lane A's review) — a log line says what kind of error it was, never its message.

describe('errorKind (ACC-297)', () => {
  it('the name and the code: "Error / ECONNREFUSED"', () => {
    expect(errorKind(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:6379'), { code: 'ECONNREFUSED' }))).toBe('Error / ECONNREFUSED');
  });

  it('a numeric code is kept too', () => {
    expect(errorKind(Object.assign(new Error('x'), { code: 503 }))).toBe('Error / 503');
  });

  it('the name alone when there is no code: "TimeoutError"', () => {
    expect(errorKind(Object.assign(new Error('enqueue timed out'), { name: 'TimeoutError' }))).toBe('TimeoutError');
  });

  it('never the message', () => {
    const kind = errorKind(Object.assign(new Error('redis://user:secret@host:6379 refused'), { code: 'ECONNREFUSED' }));
    expect(kind).not.toContain('secret');
    expect(kind).not.toContain('redis');
  });

  it('something thrown that is not an Error: "unknown"', () => {
    expect(errorKind('redis://secret-host')).toBe('unknown');
    expect(errorKind(undefined)).toBe('unknown');
  });
});
