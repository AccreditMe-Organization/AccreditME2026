import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RemoveCommitteeMemberDto } from './remove-committee-member.dto';

// ACC-298 (Ahmad, 11 Nov): "removal from committee requires a reason." The DTO
// IS the refusal: the pipe answers 400 before the route's handler runs, so a
// refused body never reaches removeMember() and nothing is written. Tested
// through a pipe configured exactly as main.ts configures the app's.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const run = (value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: RemoveCommitteeMemberDto }) as Promise<RemoveCommitteeMemberDto>;

async function refusal(value: unknown): Promise<string[]> {
  try {
    await run(value);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message;
  }
  throw new Error('Expected a 400, but the body was accepted');
}

describe('RemoveCommitteeMemberDto — a removal needs a reason (ACC-298)', () => {
  it('refuses a body with no reason', async () => {
    expect(await refusal({})).toContain('reason should not be empty');
  });

  it('refuses an empty reason', async () => {
    expect(await refusal({ reason: '' })).toContain('reason should not be empty');
  });

  it('refuses a reason that is only whitespace, because it is trimmed before it is checked', async () => {
    expect(await refusal({ reason: '  \n\t ' })).toContain('reason should not be empty');
  });

  it('refuses a reason that is not a string', async () => {
    expect(await refusal({ reason: 42 })).toContain('reason must be a string');
  });

  it('refuses a reason over 2000 characters', async () => {
    expect(await refusal({ reason: 'x'.repeat(2001) })).toContain(
      'reason must be shorter than or equal to 2000 characters',
    );
  });

  it('accepts exactly 2000 characters', async () => {
    await expect(run({ reason: 'x'.repeat(2000) })).resolves.toEqual({ reason: 'x'.repeat(2000) });
  });

  it('accepts a reason, trimmed', async () => {
    await expect(run({ reason: '  Moved to another unit  ' })).resolves.toEqual({ reason: 'Moved to another unit' });
  });

  it('keeps effectiveDate optional, and checks it when sent', async () => {
    await expect(run({ reason: 'Left', effectiveDate: '2026-11-12' })).resolves.toEqual({
      reason: 'Left',
      effectiveDate: '2026-11-12',
    });
    expect(await refusal({ reason: 'Left', effectiveDate: 'soon' })).toContain(
      'effectiveDate must be a valid ISO 8601 date string',
    );
  });
});
