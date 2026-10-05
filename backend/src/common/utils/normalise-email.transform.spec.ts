import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { normaliseEmail } from './normalise-email.transform';
import { LoginDto } from '../../foundation/auth/dto/login.dto';
import { ForgotPasswordDto } from '../../foundation/auth/dto/forgot-password.dto';

// ACC-120 slice 9b — one spelling of a typed sign-in email.
describe('normaliseEmail', () => {
  const run = (value: unknown) =>
    normaliseEmail({ value } as Parameters<typeof normaliseEmail>[0]);

  it('trims and lower-cases a string', () => {
    expect(run('  Hessa@Al-Nakheel.Example ')).toBe('hessa@al-nakheel.example');
  });

  it('passes a non-string through, so @IsEmail() still refuses it by name', () => {
    expect(run(42)).toBe(42);
    expect(run(undefined)).toBeUndefined();
  });

  // Both DTOs that take a typed email, so neither can lose it unnoticed.
  for (const Dto of [LoginDto, ForgotPasswordDto]) {
    it(`is applied by ${Dto.name}, before validation`, async () => {
      const dto = plainToInstance(Dto, {
        organizationSlug: 'al-nakheel',
        email: ' HESSA@Al-Nakheel.example ',
        password: 'pw',
      });
      expect(dto.email).toBe('hessa@al-nakheel.example');
      expect(await validate(dto)).toEqual([]);
    });
  }
});
