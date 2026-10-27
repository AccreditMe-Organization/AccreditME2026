import { FormControl } from '@angular/forms';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { StorageTestStep } from './storage-settings.service';
import {
  SHAREPOINT_CODES,
  SHAREPOINT_STEPS,
  SharePointValues,
  TENANT_PATTERN,
  GUID_PATTERN,
  TestState,
  calendarDay,
  confirmBar,
  confirmLocation,
  expiryCandidate,
  setupCandidate,
  sharePointCredentialsBar,
  sharePointCredentialsCandidate,
  sharePointSiteUrl,
  stepFailureKey,
  storedSharePointCandidate,
  testView,
  withExpiry,
} from './storage-setup';
import { SP_CLIENT_ID, SP_LIBRARY, SP_SITE_NAME, SP_SITE_URL, SP_TENANT, TYPED_SP_SECRET, spFound, spTestFailed, spTestPassed } from './storage-fixtures';

// ACC-260, PR C — SharePoint's setup rules as pure functions (D1, D3): the
// request bodies, the test box's seven rows, a sentence for every refusal code,
// the stale check, and the server's validators.

const EMPTY_M = { endpoint: '', bucket: '', region: '', accessKeyId: '', secretAccessKey: '' };
const EMPTY_L = { rootPath: '' };
const values = (over: Partial<SharePointValues> = {}): SharePointValues => ({
  tenant: SP_TENANT,
  clientId: SP_CLIENT_ID,
  clientSecret: TYPED_SP_SECRET,
  siteUrl: SP_SITE_URL,
  libraryName: SP_LIBRARY,
  secretExpiresOn: '',
  ...over,
});
const candidate = (over: Partial<SharePointValues> = {}) => setupCandidate('SHAREPOINT', EMPTY_M, EMPTY_L, values(over));
const done = (result: ReturnType<typeof spTestPassed>, c = candidate()): TestState => ({ status: 'done', candidate: c, result, at: '2026-10-24T09:12:00.000Z' });
const lookup = (lang: Record<string, unknown>, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], lang);

describe('storage setup — SharePoint (ACC-260, PR C)', () => {
  describe('request bodies (rule 2)', () => {
    it('carries the six fields, trimmed, and the secret only when typed', () => {
      expect(candidate({ tenant: ` ${SP_TENANT} `, libraryName: ` ${SP_LIBRARY} ` })).toEqual({
        provider: 'SHAREPOINT',
        sharepoint: { tenant: SP_TENANT, clientId: SP_CLIENT_ID, clientSecret: TYPED_SP_SECRET, siteUrl: SP_SITE_URL, libraryName: SP_LIBRARY },
      });
      const untyped = candidate({ clientSecret: '' });
      expect(Object.keys(untyped.sharepoint ?? {})).not.toContain('clientSecret');
      expect(Object.keys(candidate({ clientSecret: '   ' }).sharepoint ?? {})).not.toContain('clientSecret');
    });

    it('leaves the expiry date out of the test body, so picking one never makes a pass stale; withExpiry adds it to Confirm', () => {
      const c = candidate({ secretExpiresOn: '2027-06-30' });
      expect(Object.keys(c.sharepoint ?? {})).not.toContain('secretExpiresOn');
      expect(withExpiry(c, '2027-06-30').sharepoint!.secretExpiresOn).toBe('2027-06-30');
      expect(withExpiry(c, '')).toBe(c);
      expect(withExpiry({ provider: 'MINIO', minio: {} }, '2027-06-30')).toEqual({ provider: 'MINIO', minio: {} });
    });

    it('after Confirm: Replace secret sends the secret; Change client ID sends both; the expiry alone sends only the date; Test sends nothing but the provider', () => {
      expect(sharePointCredentialsCandidate(null, TYPED_SP_SECRET)).toEqual({ provider: 'SHAREPOINT', sharepoint: { clientSecret: TYPED_SP_SECRET } });
      expect(sharePointCredentialsCandidate(` ${SP_CLIENT_ID} `, TYPED_SP_SECRET)).toEqual({
        provider: 'SHAREPOINT',
        sharepoint: { clientId: SP_CLIENT_ID, clientSecret: TYPED_SP_SECRET },
      });
      expect(sharePointCredentialsCandidate(null, '')).toEqual({ provider: 'SHAREPOINT', sharepoint: {} });
      expect(expiryCandidate('2028-01-15')).toEqual({ provider: 'SHAREPOINT', sharepoint: { secretExpiresOn: '2028-01-15' } });
      // D5: no SharePoint value at all, so the server tests what is stored.
      expect(storedSharePointCandidate()).toEqual({ provider: 'SHAREPOINT' });
    });
  });

  describe('the test box', () => {
    const rows = (state: TestState, c = candidate()) => testView('SHAREPOINT', state, c).steps!.map((s) => `${s.step}:${s.state}`);

    it('shows seven rows in order: settings, sign in, site, library, write, read back, delete', () => {
      expect(SHAREPOINT_STEPS).toEqual(['configure', 'token', 'site', 'library', 'write', 'read', 'delete']);
      expect(rows({ status: 'running', candidate: candidate() })).toEqual(SHAREPOINT_STEPS.map((s) => `${s}:wait`));
      const idle = testView('SHAREPOINT', { status: 'idle' }, candidate());
      expect(idle.noteKey).toBe('storage.test.idleNoteSharePoint');
      expect(testView('SHAREPOINT', { status: 'running', candidate: candidate() }, candidate()).noteKey).toBe('storage.test.runningNoteSharePoint');
    });

    it('a pass: every row done, and the "site › library" it reached', () => {
      const v = testView('SHAREPOINT', done(spTestPassed()), candidate());
      expect(v.tone).toBe('pass');
      expect(v.steps!.every((s) => s.state === 'done')).toBeTrue();
      expect(v.found).toBe(`${SP_SITE_NAME} › ${SP_LIBRARY}`);
      // A site with no name shows its address instead.
      expect(testView('SHAREPOINT', done(spTestPassed(spFound({ siteName: null }))), candidate()).found).toBe(`${SP_SITE_URL} › ${SP_LIBRARY}`);
      // MinIO never shows one.
      expect(testView('MINIO', done(spTestPassed()), candidate()).found).toBeNull();
    });

    const AT: Array<[StorageTestStep, string, string]> = [
      ['token', 'SHAREPOINT_TENANT_NOT_FOUND', 'token'],
      ['token', 'SHAREPOINT_CLIENT_NOT_FOUND', 'token'],
      ['token', 'SHAREPOINT_SECRET_INVALID', 'token'],
      ['token', 'SHAREPOINT_APP_DISABLED', 'token'],
      ['configure', 'SHAREPOINT_SITE_URL_INVALID', 'configure'],
      ['site', 'SHAREPOINT_SITE_NOT_FOUND', 'site'],
      ['library', 'SHAREPOINT_LIBRARY_NOT_FOUND', 'library'],
      ['write', 'SHAREPOINT_NO_WRITE_ACCESS', 'write'],
      ['site', 'STORAGE_UNAVAILABLE', 'site'],
      // The API's verify is shown in Read back.
      ['verify', 'STORAGE_UNAVAILABLE', 'read'],
    ];
    for (const [step, code, row] of AT) {
      it(`fails at ${step} with ${code}: that row fails with its own sentence, those before it passed, the rest skipped`, () => {
        const v = testView('SHAREPOINT', done(spTestFailed(step, code)), candidate());
        expect(v.tone).toBe('fail');
        expect(v.headKey).toBe(`storage.test.failHead.${step}`);
        const failed = v.steps!.filter((s) => s.state === 'fail');
        expect(failed.map((s) => s.step)).toEqual([row as StorageTestStep]);
        expect(failed[0]!.detailKey).toBe(stepFailureKey('SHAREPOINT', step, code));
        const at = SHAREPOINT_STEPS.indexOf(row as StorageTestStep);
        expect(v.steps!.slice(0, at).every((s) => s.state === 'done')).withContext('before').toBeTrue();
        expect(v.steps!.slice(at + 1).every((s) => s.state === 'skip')).withContext('after').toBeTrue();
        expect(v.found).toBeNull();
      });
    }

    it('every SharePoint code has its own sentence, in English and Arabic', () => {
      const keys = SHAREPOINT_CODES.map((code) => stepFailureKey('SHAREPOINT', 'token', code));
      expect(keys).toEqual(SHAREPOINT_CODES.map((code) => `storage.test.fail.SHAREPOINT.${code}`));
      const all = [...keys, 'storage.test.fail.SHAREPOINT.STORAGE_UNAVAILABLE', 'storage.test.fail.SHAREPOINT.verify', 'storage.test.fail.SHAREPOINT.delete'];
      for (const lang of [en, ar] as Record<string, unknown>[]) {
        const said = all.map((k) => lookup(lang, k));
        expect(said.every((t) => typeof t === 'string' && t.length > 20)).withContext('every key has words').toBeTrue();
        expect(new Set(said).size).withContext('no two codes share a sentence').toBe(all.length);
      }
      // The steps and their fail heads, too.
      for (const lang of [en, ar] as Record<string, unknown>[]) {
        for (const s of ['token', 'site', 'library']) {
          expect(typeof lookup(lang, `storage.test.step.${s}`)).toBe('string');
          expect(typeof lookup(lang, `storage.test.failHead.${s}`)).toBe('string');
        }
      }
    });

    it('STORAGE_UNAVAILABLE says Microsoft failed, except at verify and delete, which say what they need', () => {
      expect(stepFailureKey('SHAREPOINT', 'token', 'STORAGE_UNAVAILABLE')).toBe('storage.test.fail.SHAREPOINT.STORAGE_UNAVAILABLE');
      expect(stepFailureKey('SHAREPOINT', 'write', null)).toBe('storage.test.fail.SHAREPOINT.STORAGE_UNAVAILABLE');
      expect(stepFailureKey('SHAREPOINT', 'verify', 'STORAGE_UNAVAILABLE')).toBe('storage.test.fail.SHAREPOINT.verify');
      expect(stepFailureKey('SHAREPOINT', 'delete', 'STORAGE_UNAVAILABLE')).toBe('storage.test.fail.SHAREPOINT.delete');
      // An unknown code is never shown as the server said it.
      expect(stepFailureKey('SHAREPOINT', 'site', 'SOMETHING_NEW')).toBe('storage.test.fail.SHAREPOINT.STORAGE_UNAVAILABLE');
    });

    it('a timeout says so; any other failed request says it could not run', () => {
      expect(testView('SHAREPOINT', { status: 'error', candidate: candidate(), timedOut: true }, candidate()).headKey).toBe('storage.test.timedOut');
      expect(testView('SHAREPOINT', { status: 'error', candidate: candidate() }, candidate()).headKey).toBe('storage.test.couldNotRun');
    });

    it('a pass goes stale when a field it tested changes, but not when the expiry date does', () => {
      const state = done(spTestPassed());
      expect(confirmBar('SHAREPOINT', state, candidate()).canSave).toBeTrue();
      expect(confirmBar('SHAREPOINT', state, candidate({ secretExpiresOn: '2027-06-30' })).canSave).toBeTrue();
      expect(confirmBar('SHAREPOINT', state, candidate({ libraryName: 'Other' })).reasonKey).toBe('storage.save.stale');
      expect(confirmBar('SHAREPOINT', { status: 'idle' }, candidate()).canSave).toBeFalse();
    });

    it('replacing credentials: Save opens only on a pass for exactly what was typed', () => {
      const c = sharePointCredentialsCandidate(null, TYPED_SP_SECRET);
      expect(sharePointCredentialsBar({ status: 'idle' }, c).canSave).toBeFalse();
      const passed: TestState = { status: 'done', candidate: c, result: spTestPassed(), at: 'x' };
      expect(sharePointCredentialsBar(passed, c)).toEqual({ reasonKey: 'storage.save.spTested', canSave: true });
      expect(sharePointCredentialsBar(passed, sharePointCredentialsCandidate(null, `${TYPED_SP_SECRET}x`)).canSave).toBeFalse();
    });

    it('Confirm\'s Location is the "site › library" the passing test reached; before a pass, the library as typed', () => {
      expect(confirmLocation('SHAREPOINT', candidate(), done(spTestPassed()))).toEqual({ text: `${SP_SITE_NAME} › ${SP_LIBRARY}` });
      expect(confirmLocation('SHAREPOINT', candidate())).toEqual({ text: SP_LIBRARY });
      // A pass for other values is not what Confirm records.
      expect(confirmLocation('SHAREPOINT', candidate({ libraryName: 'Other' }), done(spTestPassed()))).toEqual({ text: 'Other' });
    });
  });

  describe("validators: the server's SharePointSettingsDto", () => {
    const ok = (fn: (c: FormControl) => unknown, v: string) => fn(new FormControl(v)) === null;

    it('Tenant ID: a GUID or a domain', () => {
      expect(TENANT_PATTERN.test('00000000-0000-4000-8000-0000000000a1')).toBeTrue();
      expect(TENANT_PATTERN.test('alnakheel.example.test')).toBeTrue();
      expect(TENANT_PATTERN.test('alnakheel')).toBeFalse();
      expect(TENANT_PATTERN.test('https://alnakheel.example.test')).toBeFalse();
      expect(TENANT_PATTERN.test('0000-0000')).toBeFalse();
    });

    it('Client ID: a GUID', () => {
      expect(GUID_PATTERN.test(SP_CLIENT_ID)).toBeTrue();
      expect(GUID_PATTERN.test(SP_CLIENT_ID.toUpperCase())).toBeTrue();
      expect(GUID_PATTERN.test(`${SP_CLIENT_ID}0`)).toBeFalse();
      expect(GUID_PATTERN.test('not-a-guid')).toBeFalse();
    });

    it('Site URL: https on sharepoint.com, the root site or /sites/ or /teams/ and a name', () => {
      for (const v of [
        SP_SITE_URL,
        'https://example-test.sharepoint.com',
        'https://example-test.sharepoint.com/teams/quality',
        'https://example-test-my.sharepoint.com/sites/x',
        `${SP_SITE_URL}/Shared%20Documents/Forms/AllItems.aspx`,
      ]) {
        expect(ok(sharePointSiteUrl, v)).withContext(v).toBeTrue();
      }
      for (const v of [
        'http://example-test.sharepoint.com/sites/quality',
        'https://example-test.sharepoint.com:8443/sites/quality',
        'https://example.test/sites/quality',
        'https://sharepoint.com.example.test/sites/quality',
        'https://example-test.sharepoint.com/lists/quality',
        'https://example-test.sharepoint.com/sites/',
        'https://user:pw@example-test.sharepoint.com/sites/quality',
        'example-test.sharepoint.com/sites/quality',
      ]) {
        expect(ok(sharePointSiteUrl, v)).withContext(v).toBeFalse();
      }
      expect(ok(sharePointSiteUrl, '')).withContext('empty is "required"\'s business').toBeTrue();
    });

    it('Secret expiry: empty, or a real calendar day', () => {
      expect(ok(calendarDay, '')).toBeTrue();
      expect(ok(calendarDay, '2027-06-30')).toBeTrue();
      expect(ok(calendarDay, '2028-02-29')).toBeTrue();
      expect(ok(calendarDay, '2026-02-31')).toBeFalse();
      expect(ok(calendarDay, '2027-6-30')).toBeFalse();
      expect(ok(calendarDay, '30/06/2027')).toBeFalse();
    });
  });
});
