import { FormControl, Validators } from '@angular/forms';
import { IStorageCandidate, StorageTestStep } from './storage-settings.service';
import {
  BUCKET_PATTERN,
  ROOT_PATH_PATTERN,
  TestState,
  choosable,
  confirmBar,
  confirmLocation,
  endpointUrl,
  initialSelection,
  keysBar,
  keysCandidate,
  passedFor,
  sameCandidate,
  setupCandidate,
  stepFailureKey,
  testView,
} from './storage-setup';
import { TYPED_ACCESS_KEY, TYPED_SECRET, testFailed, testPassed, unconfirmed, unconfirmedOnPrem } from './storage-fixtures';

// ACC-260, PR B — the setup rules as pure functions.

const EMPTY_LOCAL = { rootPath: '' };
const minioValues = (over: Partial<{ endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }> = {}) => ({
  endpoint: 'https://minio.alnakheel.local:9000',
  bucket: 'accreditme-files',
  region: '',
  accessKeyId: TYPED_ACCESS_KEY,
  secretAccessKey: TYPED_SECRET,
  ...over,
});
const done = (candidate: IStorageCandidate, result = testPassed()): TestState => ({ status: 'done', candidate, result, at: '2026-10-25T09:12:00.000Z' });

describe('storage setup (ACC-260, PR B)', () => {
  describe('choosing', () => {
    it('AccreditMe cloud and MinIO always; a local folder only where offered; SharePoint not here (PR C)', () => {
      expect(choosable(unconfirmed(), 'S3')).toBeTrue();
      expect(choosable(unconfirmed(), 'MINIO')).toBeTrue();
      expect(choosable(unconfirmed(), 'LOCAL_FILESYSTEM')).toBeFalse();
      expect(choosable(unconfirmedOnPrem(), 'LOCAL_FILESYSTEM')).toBeTrue();
      expect(choosable(unconfirmedOnPrem(), 'SHAREPOINT')).toBeFalse();
    });

    it('arrives on AccreditMe cloud, or on a draft that can be chosen', () => {
      expect(initialSelection(unconfirmed())).toBe('S3');
      expect(initialSelection(unconfirmed({ draftProvider: 'MINIO' }))).toBe('MINIO');
      expect(initialSelection(unconfirmed({ draftProvider: 'LOCAL_FILESYSTEM' }))).toBe('S3');
      expect(initialSelection(unconfirmed({ draftProvider: 'SHAREPOINT' }))).toBe('S3');
    });
  });

  describe('request bodies — a secret only when typed (rule 2)', () => {
    it('AccreditMe cloud: the provider and nothing else', () => {
      expect(setupCandidate('S3', minioValues(), { rootPath: 'x' })).toEqual({ provider: 'S3' });
    });

    it('MinIO with typed keys carries them; an empty region is left out', () => {
      expect(setupCandidate('MINIO', minioValues(), EMPTY_LOCAL)).toEqual({
        provider: 'MINIO',
        minio: { endpoint: 'https://minio.alnakheel.local:9000', bucket: 'accreditme-files', accessKeyId: TYPED_ACCESS_KEY, secretAccessKey: TYPED_SECRET },
      });
    });

    it('MinIO with untyped keys omits them — never null, never an empty string', () => {
      const body = setupCandidate('MINIO', minioValues({ accessKeyId: '', secretAccessKey: '   ' }), EMPTY_LOCAL);
      expect('accessKeyId' in body.minio!).toBeFalse();
      expect('secretAccessKey' in body.minio!).toBeFalse();
      expect(JSON.stringify(body)).not.toContain('null');
    });

    it('trims the endpoint, bucket, region and folder', () => {
      expect(setupCandidate('MINIO', minioValues({ endpoint: '  https://a.b:9000 ', bucket: ' b-1 ', region: ' me-central-1 ' }), EMPTY_LOCAL).minio).toEqual(
        jasmine.objectContaining({ endpoint: 'https://a.b:9000', bucket: 'b-1', region: 'me-central-1' }),
      );
      expect(setupCandidate('LOCAL_FILESYSTEM', minioValues(), { rootPath: ' quality/files ' })).toEqual({ provider: 'LOCAL_FILESYSTEM', local: { rootPath: 'quality/files' } });
    });

    it('replacing the keys: the two keys and nothing else', () => {
      expect(keysCandidate(TYPED_ACCESS_KEY, TYPED_SECRET)).toEqual({ provider: 'MINIO', minio: { accessKeyId: TYPED_ACCESS_KEY, secretAccessKey: TYPED_SECRET } });
      expect(keysCandidate('', '')).toEqual({ provider: 'MINIO', minio: {} });
    });
  });

  describe('the stale check', () => {
    const a = setupCandidate('MINIO', minioValues(), EMPTY_LOCAL);
    it('a pass counts only for exactly the values on screen', () => {
      expect(passedFor(done(a), a)).toBeTrue();
      expect(passedFor(done(a), setupCandidate('MINIO', minioValues({ bucket: 'accreditme-evidence' }), EMPTY_LOCAL))).toBeFalse();
      expect(passedFor(done(a), setupCandidate('MINIO', minioValues({ secretAccessKey: 'another-secret' }), EMPTY_LOCAL))).toBeFalse();
      expect(passedFor(done(a, testFailed('write')), a)).toBeFalse();
      expect(sameCandidate(null, a)).toBeFalse();
    });
  });

  describe('the test box', () => {
    const c = setupCandidate('MINIO', minioValues(), EMPTY_LOCAL);

    it('idle: not tested yet, what the test does', () => {
      const v = testView('MINIO', { status: 'idle' }, c);
      expect([v.tone, v.headKey, v.noteKey, v.buttonKey, v.steps]).toEqual(['idle', 'storage.test.idle', 'storage.test.idleNote', 'storage.test.run', null]);
    });

    it('running: every step waits (the API answers once, at the end)', () => {
      const v = testView('MINIO', { status: 'running', candidate: c }, c);
      expect(v.tone).toBe('run');
      expect(v.steps!.map((s) => s.state)).toEqual(['wait', 'wait', 'wait', 'wait', 'wait']);
    });

    it('passed: every step done, with the time', () => {
      const v = testView('MINIO', done(c), c);
      expect([v.tone, v.headKey, v.at]).toEqual(['pass', 'storage.test.passed', '2026-10-25T09:12:00.000Z']);
      expect(v.steps!.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done']);
    });

    const steps: StorageTestStep[] = ['configure', 'write', 'read', 'verify', 'delete'];
    for (const step of steps) {
      it(`failed at ${step}: the steps before passed, ${step} failed with its own sentence, the rest skipped`, () => {
        const v = testView('MINIO', done(c, testFailed(step)), c);
        expect(v.tone).toBe('fail');
        expect(v.headKey).toBe(`storage.test.failHead.${step}`);
        const i = steps.indexOf(step);
        expect(v.steps!.map((s) => s.state)).toEqual(steps.map((_, j) => (j < i ? 'done' : j === i ? 'fail' : 'skip')));
        expect(v.steps![i]!.detailKey).toBe(`storage.test.fail.MINIO.${step}`);
      });
    }

    it('a refusal that names the problem keeps its shared words', () => {
      for (const code of ['STORAGE_SETTINGS_INCOMPLETE', 'STORAGE_ENDPOINT_NOT_ALLOWED', 'STORAGE_PROVIDER_NOT_ALLOWED']) {
        expect(stepFailureKey('MINIO', 'configure', code)).toBe(`files.refusal.${code}`);
      }
      expect(stepFailureKey('LOCAL_FILESYSTEM', 'write', 'STORAGE_UNAVAILABLE')).toBe('storage.test.fail.LOCAL_FILESYSTEM.write');
      expect(stepFailureKey('SHAREPOINT', 'token', 'SHAREPOINT_SECRET_INVALID')).toBe('storage.test.fail.generic');
    });

    it('stale: a result for other values is out of date, pass or fail', () => {
      const other = setupCandidate('MINIO', minioValues({ bucket: 'accreditme-evidence' }), EMPTY_LOCAL);
      expect(testView('MINIO', done(c), other).tone).toBe('stale');
      expect(testView('MINIO', done(c, testFailed('read')), other).tone).toBe('stale');
      expect(testView('MINIO', { status: 'error', candidate: c }, other).tone).toBe('stale');
    });

    it('the request itself failing: a fail head, no steps', () => {
      const v = testView('MINIO', { status: 'error', candidate: c }, c);
      expect([v.tone, v.headKey, v.steps]).toEqual(['fail', 'storage.test.couldNotRun', null]);
    });
  });

  describe('the reason beside Confirm', () => {
    const c = setupCandidate('MINIO', minioValues(), EMPTY_LOCAL);
    const changed = setupCandidate('MINIO', minioValues({ bucket: 'accreditme-evidence' }), EMPTY_LOCAL);

    it('AccreditMe cloud: always open, no test', () => {
      expect(confirmBar('S3', { status: 'idle' }, { provider: 'S3' })).toEqual({ reasonKey: 'storage.save.blocked', canSave: true });
    });

    it('MinIO: closed until a pass for exactly these values', () => {
      expect(confirmBar('MINIO', { status: 'idle' }, c)).toEqual({ reasonKey: 'storage.save.testFirst', canSave: false });
      expect(confirmBar('MINIO', { status: 'running', candidate: c }, c)).toEqual({ reasonKey: 'storage.save.waiting', canSave: false });
      expect(confirmBar('MINIO', done(c, testFailed('delete')), c)).toEqual({ reasonKey: 'storage.save.fixAndTest', canSave: false });
      expect(confirmBar('MINIO', done(c), changed)).toEqual({ reasonKey: 'storage.save.stale', canSave: false });
      expect(confirmBar('MINIO', done(c), c)).toEqual({ reasonKey: 'storage.save.tested', canSave: true });
    });

    it('Save new key: closed until the new keys pass', () => {
      const k = keysCandidate(TYPED_ACCESS_KEY, TYPED_SECRET);
      expect(keysBar({ status: 'idle' }, k).canSave).toBeFalse();
      expect(keysBar(done(k), k)).toEqual({ reasonKey: 'storage.save.keysTested', canSave: true });
      expect(keysBar(done(k), keysCandidate(TYPED_ACCESS_KEY, 'another-secret')).canSave).toBeFalse();
    });
  });

  it("the confirm dialog's Location: AccreditMe cloud by name only (rule 1), else the tenant's own endpoint or folder", () => {
    expect(confirmLocation('S3', { provider: 'S3', minio: { endpoint: 'https://s3.eu-central-1.amazonaws.com' } })).toEqual({ key: 'storage.kind.S3.name' });
    expect(confirmLocation('MINIO', setupCandidate('MINIO', minioValues(), EMPTY_LOCAL))).toEqual({ text: 'https://minio.alnakheel.local:9000' });
    expect(confirmLocation('LOCAL_FILESYSTEM', setupCandidate('LOCAL_FILESYSTEM', minioValues(), { rootPath: 'quality/files' }))).toEqual({ text: 'quality/files' });
  });

  describe("validators — the server's DTO rules", () => {
    const valid = (v: string) => endpointUrl(new FormControl(v)) === null;
    it('an endpoint is an http(s) address with a host', () => {
      expect(valid('https://minio.alnakheel.local:9000')).toBeTrue();
      expect(valid('http://10.0.0.4:9000')).toBeTrue();
      expect(valid('')).toBeTrue(); // empty is left to required
      expect(valid('minio.alnakheel.local')).toBeFalse();
      expect(valid('ftp://minio.alnakheel.local')).toBeFalse();
      expect(valid('https://')).toBeFalse();
    });

    it('a bucket follows S3 naming; a folder is relative, with no . or .. segments', () => {
      const bucket = (v: string) => Validators.pattern(BUCKET_PATTERN)(new FormControl(v)) === null;
      expect(bucket('accreditme-files')).toBeTrue();
      expect(bucket('Accreditme')).toBeFalse();
      expect(bucket('a')).toBeFalse();
      expect(ROOT_PATH_PATTERN.test('quality/files')).toBeTrue();
      expect(ROOT_PATH_PATTERN.test('../etc')).toBeFalse();
      expect(ROOT_PATH_PATTERN.test('quality/./files')).toBeFalse();
      expect(ROOT_PATH_PATTERN.test('\\\\fileserver01\\AccreditMe')).toBeFalse();
    });
  });
});
