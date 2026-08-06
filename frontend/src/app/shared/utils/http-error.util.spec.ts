// ACC-26 — extractErrorMessage() is what stands between a raw HTTP error
// and a template-bound signal. The bug this guards against: NestJS's
// default ValidationPipe returns `message` as a string array, and passing
// that straight through renders as "[object Object]" once ngx-translate's
// array-key handling turns it into a translations object.
import { extractErrorMessage } from './http-error.util';

describe('extractErrorMessage', () => {
  it('joins a class-validator style message array into a single string', () => {
    const err = { error: { message: ['roleId must be a string'] } };
    expect(extractErrorMessage(err, 'fallback')).toBe('roleId must be a string');
  });

  it('joins multiple array entries with a comma', () => {
    const err = { error: { message: ['field a is required', 'field b must be a string'] } };
    expect(extractErrorMessage(err, 'fallback')).toBe(
      'field a is required, field b must be a string',
    );
  });

  it('returns a plain string message unchanged', () => {
    const err = { error: { message: 'Role not found' } };
    expect(extractErrorMessage(err, 'fallback')).toBe('Role not found');
  });

  it('falls back when message is missing', () => {
    const err = { error: {} };
    expect(extractErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('falls back when error is missing entirely', () => {
    expect(extractErrorMessage({}, 'fallback')).toBe('fallback');
  });

  it('falls back when err is null or undefined', () => {
    expect(extractErrorMessage(null, 'fallback')).toBe('fallback');
    expect(extractErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('falls back when message is an empty string', () => {
    const err = { error: { message: '' } };
    expect(extractErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('falls back when message is an empty array', () => {
    const err = { error: { message: [] } };
    expect(extractErrorMessage(err, 'fallback')).toBe('fallback');
  });
});
