import { HttpErrorResponse } from '@angular/common/http';
import { TWO_STEP_KEYS, describeResetRefusal, describeTurnOffRefusal } from './two-step-refusal';

/** ACC-164 — every code the two dialogs can receive, worded from its CODE. */
const refusal = (status: number, body: Record<string, unknown>) => new HttpErrorResponse({ status, error: body });
const NOW = new Date('2026-11-14T09:00:00.000Z');

describe('describeTurnOffRefusal (ACC-164)', () => {
  it('a wrong password goes under Password', () => {
    expect(describeTurnOffRefusal(refusal(400, { code: 'INVALID_CREDENTIALS' }), NOW)).toEqual(
      jasmine.objectContaining({ field: 'password', key: TWO_STEP_KEYS.passwordWrong, closeOnly: false }),
    );
  });

  it('a wrong code goes under Code, with the count only for 1 or 2', () => {
    for (const [left, shown] of [[2, 2], [1, 1], [3, null], [9, null], [undefined, null]] as const) {
      const r = describeTurnOffRefusal(refusal(400, { code: 'MFA_INVALID', attemptsRemaining: left }), NOW);
      expect(r.field).toBe('code');
      expect(r.key).toBe(TWO_STEP_KEYS.codeWrong);
      expect(r.attemptsLeft).toBe(shown);
    }
  });

  it('locked: a message above the buttons, with when it lifts rounded up to the minute', () => {
    const r = describeTurnOffRefusal(refusal(400, { code: 'ACCOUNT_LOCKED', lockedUntil: '2026-11-14T09:14:10.000Z' }), NOW);
    expect(r.field).toBeNull();
    expect(r.key).toBe(TWO_STEP_KEYS.locked);
    expect(r.until?.toISOString()).toBe('2026-11-14T09:15:00.000Z');
  });

  it('locked with no time: the no-time sentence', () => {
    const r = describeTurnOffRefusal(refusal(400, { code: 'ACCOUNT_LOCKED' }), NOW);
    expect(r.key).toBe(TWO_STEP_KEYS.lockedNoTime);
    expect(r.until).toBeNull();
  });

  it('already off: blue, and only Close', () => {
    expect(describeTurnOffRefusal(refusal(400, { code: 'MFA_NOT_ENABLED' }), NOW)).toEqual(
      jasmine.objectContaining({ field: null, key: TWO_STEP_KEYS.alreadyOff, tone: 'info', closeOnly: true }),
    );
  });

  it('no answer, or a server fault: unreachable; anything else: it was not turned off', () => {
    expect(describeTurnOffRefusal(new HttpErrorResponse({ status: 0 }), NOW).key).toBe(TWO_STEP_KEYS.unreachable);
    expect(describeTurnOffRefusal(new HttpErrorResponse({ status: 503 }), NOW).key).toBe(TWO_STEP_KEYS.unreachable);
    expect(describeTurnOffRefusal(refusal(400, { message: 'x' }), NOW).key).toBe(TWO_STEP_KEYS.offFailed);
  });
});

describe('describeResetRefusal (ACC-164)', () => {
  it('the account owner: the message replaces the paragraph, only Close', () => {
    expect(describeResetRefusal(refusal(409, { code: 'ACCOUNT_OWNER_PROTECTED' }))).toEqual({
      key: TWO_STEP_KEYS.resetOwner,
      tone: 'danger',
      closeOnly: true,
      replacesBody: true,
    });
  });

  it('already off: blue, only Close, the paragraph kept', () => {
    expect(describeResetRefusal(refusal(409, { code: 'MFA_NOT_ENABLED' }))).toEqual({
      key: TWO_STEP_KEYS.resetAlreadyOff,
      tone: 'info',
      closeOnly: true,
      replacesBody: false,
    });
  });

  for (const [code, key] of [
    ['MFA_RESET_IMPERSONATING', TWO_STEP_KEYS.resetActingAs],
    ['MFA_RESET_HIGHER_ACCOUNT', TWO_STEP_KEYS.resetHigher],
    ['MFA_RESET_SELF', TWO_STEP_KEYS.resetSelf],
  ] as const) {
    it(`${code}: its own sentence, only Close`, () => {
      expect(describeResetRefusal(refusal(409, { code }))).toEqual(
        jasmine.objectContaining({ key, tone: 'danger', closeOnly: true }),
      );
    });
  }

  it('unreachable keeps Reset, so pressing it again retries', () => {
    expect(describeResetRefusal(new HttpErrorResponse({ status: 0 }))).toEqual(
      jasmine.objectContaining({ key: TWO_STEP_KEYS.unreachable, closeOnly: false }),
    );
    expect(describeResetRefusal(refusal(404, { message: 'User not found' })).key).toBe(TWO_STEP_KEYS.resetFailed);
  });
});
