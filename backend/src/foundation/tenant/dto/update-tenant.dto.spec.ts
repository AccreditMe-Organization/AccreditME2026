import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateTenantDto } from './update-tenant.dto';

/**
 * ACC-120 — the Arabic name's storage rule, tested where it lives.
 *
 * This is the first DTO-level spec in the backend, and it is here because the
 * rule is a TRANSFORM rather than service logic: by the time `update()` sees
 * the value, the decision has already been made. A service test asserting
 * "null was stored" would pass whether the transform ran or the caller happened
 * to send null, which is the vacuous shape.
 *
 * It runs the real pipeline — `plainToInstance` then `validateSync` — in the
 * same order and with the same options as `main.ts`'s global ValidationPipe
 * (`whitelist`, `forbidNonWhitelisted`, `transform`), so what is asserted here
 * is what an HTTP request actually produces.
 */
describe('UpdateTenantDto — nameAr (ACC-120)', () => {
  const parse = (body: Record<string, unknown>): UpdateTenantDto =>
    plainToInstance(UpdateTenantDto, body, { enableImplicitConversion: false });

  const errorsOn = (body: Record<string, unknown>): string[] =>
    validateSync(parse(body), {
      whitelist: true,
      forbidNonWhitelisted: true,
      skipMissingProperties: false,
    }).map((e) => e.property);

  it('keeps a real Arabic name, trimmed', () => {
    expect(parse({ nameAr: '  مستشفى النخيل التخصصي  ' }).nameAr).toBe(
      'مستشفى النخيل التخصصي',
    );
    expect(errorsOn({ nameAr: 'مستشفى النخيل التخصصي' })).toEqual([]);
  });

  // THE RULE. An empty field stores null, not ''. Refusing it was the earlier
  // plan and is worse: a PATCH DTO that 400s on '' makes the form's own
  // clear-the-field path fail, and storing '' leaves two different falsy values
  // meaning "no Arabic name" for every future reader to handle.
  it('turns an empty string into null, rather than storing it or refusing it', () => {
    expect(parse({ nameAr: '' }).nameAr).toBeNull();
    expect(errorsOn({ nameAr: '' })).toEqual([]);
  });

  it('turns a whitespace-only value into null too', () => {
    expect(parse({ nameAr: '   ' }).nameAr).toBeNull();
    expect(errorsOn({ nameAr: '   ' })).toEqual([]);
  });

  // The field is optional because this DTO is PATCH-shaped and serves screens
  // with nothing to do with the name. Omitting it must not touch the column.
  // Omitted means UNDEFINED, which is the distinction that matters: Prisma
  // ignores an undefined field and writes null for a null one, so an unrelated
  // update cannot clear the Arabic name.
  //
  // Not asserted as `'nameAr' in dto === false` — that was the first version of
  // this test and it failed, correctly: plainToInstance materialises every
  // DECLARED property, so the key exists carrying undefined. The key's presence
  // is not the behaviour; the value is.
  it('is undefined when omitted, so an unrelated update cannot clear it', () => {
    const dto = parse({ timezone: 'Asia/Dubai' });
    expect(dto.nameAr).toBeUndefined();
    expect(dto.nameAr).not.toBeNull();
    expect(errorsOn({ timezone: 'Asia/Dubai' })).toEqual([]);
  });

  it('refuses a value longer than the column allows', () => {
    expect(errorsOn({ nameAr: 'ا'.repeat(256) })).toEqual(['nameAr']);
  });

  it('refuses a non-string', () => {
    expect(errorsOn({ nameAr: 42 })).toEqual(['nameAr']);
  });

  // THE NON-VACUITY GUARD. Every assertion above would also pass against a DTO
  // that silently dropped unknown properties, so this pins that the pipeline
  // under test is the strict one — and it is the clause that rejects every
  // Organization Profile save today, because the form sends `country` and this
  // DTO does not declare it.
  it('refuses a property it does not declare, which is the strict pipeline working', () => {
    expect(errorsOn({ country: 'SA' })).toEqual(['country']);
  });

  // ACC-185 (Q6) — only POST /tenant/storage/confirm chooses where files go.
  // This DTO used to accept storageProvider and the service wrote it straight
  // to the organisation, past the connection test and the post-confirmation
  // lock. It is refused now, for every value.
  it.each(['S3', 'MINIO', 'LOCAL_FILESYSTEM', 'SHAREPOINT'])('refuses storageProvider %p — only Confirm sets it', (value) => {
    expect(errorsOn({ storageProvider: value })).toEqual(['storageProvider']);
  });
});
