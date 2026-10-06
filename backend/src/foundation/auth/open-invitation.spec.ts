import {
  INVITATION_TOKEN_SHAPE,
  InvitationRow,
  isOpenInvitation,
} from './open-invitation';
import {
  INVITATION_REFUSAL_BODY,
  InvitationRefusalException,
} from './invitation-refusal';

// ACC-120 slice 9c — the one rule for whether an invitation can be used.
describe('isOpenInvitation', () => {
  const now = new Date('2026-10-05T09:00:00.000Z');
  const row = (over: Partial<InvitationRow> = {}): InvitationRow => ({
    status: 'INVITED',
    invitationExpiresAt: new Date(now.getTime() + 60_000),
    organization: { status: 'ACTIVE', name: 'Acme', nameAr: null },
    ...over,
  });

  it('is open for an invited person in an ACTIVE or TRIAL tenant before the expiry', () => {
    expect(isOpenInvitation(row(), now)).toBe(true);
    expect(
      isOpenInvitation(
        row({ organization: { status: 'TRIAL', name: 'A', nameAr: null } }),
        now,
      ),
    ).toBe(true);
  });

  it('is open at the expiry instant itself, and closed one millisecond after', () => {
    expect(
      isOpenInvitation(row({ invitationExpiresAt: new Date(now) }), now),
    ).toBe(true);
    expect(
      isOpenInvitation(
        row({ invitationExpiresAt: new Date(now.getTime() - 1) }),
        now,
      ),
    ).toBe(false);
  });

  it('is closed with no row, no expiry, or a person who is no longer INVITED', () => {
    expect(isOpenInvitation(null, now)).toBe(false);
    expect(isOpenInvitation(row({ invitationExpiresAt: null }), now)).toBe(
      false,
    );
    for (const status of ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const) {
      expect(isOpenInvitation(row({ status }), now)).toBe(false);
    }
  });

  it('is closed for a SUSPENDED, CANCELLED or OFFBOARDING tenant', () => {
    for (const status of ['SUSPENDED', 'CANCELLED', 'OFFBOARDING'] as const) {
      expect(
        isOpenInvitation(
          row({ organization: { status, name: 'A', nameAr: null } }),
          now,
        ),
      ).toBe(false);
    }
  });
});

describe('INVITATION_TOKEN_SHAPE', () => {
  it('accepts exactly what invite() creates: 48 lower-case hex characters', () => {
    expect(INVITATION_TOKEN_SHAPE.test('a'.repeat(48))).toBe(true);
    for (const bad of [
      'a'.repeat(47),
      'a'.repeat(49),
      'A'.repeat(48),
      'g'.repeat(48),
      '',
    ]) {
      expect(INVITATION_TOKEN_SHAPE.test(bad)).toBe(false);
    }
  });
});

describe('InvitationRefusalException', () => {
  it("is accept-invitation's existing 400 and message, plus the code", () => {
    const e = new InvitationRefusalException();
    expect(e.getStatus()).toBe(400);
    expect(e.getResponse()).toStrictEqual({
      statusCode: 400,
      message: 'Invalid or expired invitation',
      error: 'Bad Request',
      code: 'INVITATION_INVALID',
    });
  });

  it('cannot be reworded: the body is frozen and copied per throw', () => {
    expect(Object.isFrozen(INVITATION_REFUSAL_BODY)).toBe(true);
    const first = new InvitationRefusalException().getResponse();
    expect(first).not.toBe(INVITATION_REFUSAL_BODY);
    expect(first).toStrictEqual(new InvitationRefusalException().getResponse());
  });
});
