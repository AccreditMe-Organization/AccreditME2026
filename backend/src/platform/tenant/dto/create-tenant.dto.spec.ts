import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTenantDto } from './create-tenant.dto';
import {
  INFRASTRUCTURE_LABELS,
  PLATFORM_SIGN_IN_LABELS,
} from '../../../common/tenant/reserved-slugs';

/**
 * ACC-139 — a tenant's slug becomes its address, {slug}.accreditme.app, so it
 * must be a DNS label and must not be a name we keep for ourselves.
 */
describe('CreateTenantDto slug (ACC-139)', () => {
  const VALID = {
    name: 'Acme Hospital',
    country: 'SA',
    adminEmail: 'admin@acme.example',
    adminName: 'Acme Admin',
  };

  async function slugErrors(slug: string): Promise<string[]> {
    const dto = plainToInstance(CreateTenantDto, { ...VALID, slug });
    const errors = await validate(dto);
    return errors
      .filter((e) => e.property === 'slug')
      .flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts an ordinary slug, including the existing tenants', async () => {
    // Non-vacuity guard: the rest of the DTO is valid, so any error below is
    // the slug's.
    const dto = plainToInstance(CreateTenantDto, { ...VALID, slug: 'acme' });
    expect(await validate(dto)).toEqual([]);
    for (const slug of [
      'acme',
      'al-nakheel',
      'al-manara',
      'a',
      'h2',
      '9lives',
    ]) {
      expect([slug, await slugErrors(slug)]).toEqual([slug, []]);
    }
  });

  it('refuses what is not a DNS label', async () => {
    for (const slug of [
      '-acme',
      'acme-',
      'Acme',
      'acme.org',
      'acme_org',
      'xn--80ak6aa92e',
      'a'.repeat(64),
    ]) {
      expect([slug, (await slugErrors(slug)).length > 0]).toEqual([slug, true]);
    }
  });

  it('refuses every infrastructure label, and the platform sign-in host', async () => {
    // Non-vacuity guard: the lists are not empty.
    expect(INFRASTRUCTURE_LABELS.length).toBeGreaterThan(30);
    expect(PLATFORM_SIGN_IN_LABELS).toEqual(['platform']);
    for (const slug of [...INFRASTRUCTURE_LABELS, ...PLATFORM_SIGN_IN_LABELS]) {
      expect([slug, await slugErrors(slug)]).toEqual([
        slug,
        ['slug is reserved: choose another'],
      ]);
    }
  });
});
