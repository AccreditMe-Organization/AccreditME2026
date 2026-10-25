import { GIB, currentFields, daysBetween, hostOf, locationText, optionsView, sharePointHealth, stripView, usageView } from './storage-view';
import { HESSA, TODAY, cloud, local, minio, requested, sharepoint, unconfirmed } from './storage-fixtures';

// ACC-260, PR A — the File storage page's state logic, without a page.

describe('storage view (ACC-260, PR A)', () => {
  describe('the strip', () => {
    it('not confirmed: no location, uploads blocked, danger', () => {
      const st = stripView(unconfirmed(), TODAY);
      expect(st).toEqual(jasmine.objectContaining({ kind: null, tone: 'danger', chipKey: 'storage.chip.blocked', location: null, confirmed: null, request: null }));
    });

    it('a draft is still not confirmed', () => {
      expect(stripView(unconfirmed({ draftProvider: 'MINIO' }), TODAY).kind).toBeNull();
    });

    it('AccreditMe cloud: managed, no location text, confirmed by whom and when', () => {
      const st = stripView(cloud(), TODAY);
      expect(st).toEqual(jasmine.objectContaining({ kind: 'S3', tone: 'ok', chipKey: 'storage.chip.confirmed', managed: true, location: null, refused: false }));
      expect(st.confirmed).toEqual({ at: '2026-10-03T09:00:00.000Z', by: HESSA.name });
    });

    it('MinIO: host · bucket; local: the folder; SharePoint: site › library', () => {
      expect(stripView(minio(), TODAY).location).toBe('minio.alnakheel.local · accreditme-files');
      expect(stripView(local(), TODAY).location).toBe('quality/files');
      expect(stripView(sharepoint(), TODAY).location).toBe('Quality Department › Quality Documents');
    });

    it('SharePoint with access withdrawn: refused, danger, "can\'t be reached"', () => {
      const st = stripView(sharepoint({ accessLostAt: '2026-10-05T10:00:00.000Z', accessLostReason: 'GRANT_REMOVED' }), TODAY);
      expect(st).toEqual(jasmine.objectContaining({ tone: 'danger', chipKey: 'storage.chip.unreachable', refused: true }));
    });

    it('a pending change request is a line, with who asked', () => {
      expect(stripView(requested(), TODAY).request).toEqual({ at: '2026-10-07T08:00:00.000Z', by: HESSA.name });
    });

    it('a confirmer or requester who has gone leaves the date only', () => {
      const s = { ...requested(), confirmedBy: null, changeRequestedBy: null };
      expect(stripView(s, TODAY).confirmed?.by).toBeNull();
      expect(stripView(s, TODAY).request?.by).toBeNull();
    });
  });

  it('rule 1: AccreditMe cloud never has location text, whatever the other blocks hold', () => {
    const s = cloud();
    s.minio = { endpoint: 'https://s3.eu-central-1.amazonaws.com', region: 'eu-central-1', bucket: 'accreditme-files-prod', accessKeyId: 'set', secretAccessKey: 'set' };
    s.local = { rootPath: 'platform/root' };
    expect(locationText(s, 'S3')).toBeNull();
    expect(stripView(s, TODAY).location).toBeNull();
    expect(currentFields(s)).toEqual([]);
  });

  describe('the options', () => {
    it('before confirming: all four, local greyed where this installation does not offer it', () => {
      expect(optionsView(unconfirmed()).map((o) => [o.kind, o.offered, o.current, o.disabled])).toEqual([
        ['S3', true, false, false],
        ['MINIO', true, false, false],
        ['LOCAL_FILESYSTEM', false, false, true],
        ['SHAREPOINT', true, false, false],
      ]);
    });

    it('after confirming: the current one only, every other greyed', () => {
      expect(optionsView(minio()).map((o) => [o.kind, o.current, o.disabled])).toEqual([
        ['S3', false, true],
        ['MINIO', true, false],
        ['LOCAL_FILESYSTEM', false, true],
        ['SHAREPOINT', false, true],
      ]);
    });
  });

  describe('the current location, locked', () => {
    it('MinIO: where files are is locked; credentials only "Set"', () => {
      const f = currentFields(minio());
      expect(f.map((x) => [x.id, x.locked, x.helpKey])).toEqual([
        ['endpoint', true, 'storage.help.lock'],
        ['bucket', true, 'storage.help.locked'],
        ['regionHttps', true, 'storage.help.locked'],
        ['accessKey', false, 'storage.help.cantShow'],
        ['secretKey', false, 'storage.help.cantShow'],
      ]);
      expect(f.find((x) => x.id === 'regionHttps')!.value).toEqual([{ key: 'storage.field.none' }, { key: 'storage.field.on' }]);
      expect(f.find((x) => x.id === 'secretKey')!.value).toEqual([{ key: 'storage.field.set' }]);
    });

    it('MinIO over http says HTTPS is off', () => {
      const f = currentFields(minio({ minio: { ...minio().minio, endpoint: 'http://10.0.0.5:9000', region: 'me-central-1' } }));
      expect(f.find((x) => x.id === 'regionHttps')!.value).toEqual([{ text: 'me-central-1' }, { key: 'storage.field.off' }]);
    });

    it('local: the folder, locked', () => {
      expect(currentFields(local()).map((x) => [x.id, x.locked])).toEqual([['folderPath', true]]);
    });

    it('SharePoint: tenant, site and library locked; client ID, secret ("Set") and expiry not', () => {
      expect(currentFields(sharepoint()).map((x) => [x.id, x.locked])).toEqual([
        ['spTenant', true],
        ['spSiteUrl', true],
        ['spLibrary', true],
        ['spClientId', false],
        ['spClientSecret', false],
        ['spSecretExpires', false],
      ]);
      expect(currentFields(sharepoint({ secretExpiresOn: null })).at(-1)!.value).toEqual([{ key: 'storage.field.notRecorded' }]);
    });

    it('no fields before confirming, and none for AccreditMe cloud', () => {
      expect(currentFields(unconfirmed())).toEqual([]);
      expect(currentFields(cloud())).toEqual([]);
    });
  });

  describe('SharePoint health', () => {
    it('only for a confirmed SharePoint location', () => {
      expect(sharePointHealth(minio(), TODAY)).toBeNull();
      expect(sharePointHealth(unconfirmed({ draftProvider: 'SHAREPOINT' }), TODAY)).toBeNull();
    });

    it('withdrawn wins over an expiring secret', () => {
      expect(sharePointHealth(sharepoint({ accessLostAt: '2026-10-05T10:00:00.000Z', accessLostReason: 'SECRET_INVALID', secretExpiresOn: '2026-10-30' }), TODAY)).toEqual({
        state: 'withdrawn',
        since: '2026-10-05T10:00:00.000Z',
        reason: 'SECRET_INVALID',
      });
    });

    it('expiring from 30 days before, through the day itself; expired after; ok before', () => {
      expect(sharePointHealth(sharepoint({ secretExpiresOn: '2026-11-23' }), TODAY)).toEqual({ state: 'expiring', on: '2026-11-23', daysLeft: 30 });
      expect(sharePointHealth(sharepoint({ secretExpiresOn: '2026-11-24' }), TODAY)).toEqual({ state: 'ok' });
      expect(sharePointHealth(sharepoint({ secretExpiresOn: TODAY }), TODAY)).toEqual({ state: 'expiring', on: TODAY, daysLeft: 0 });
      expect(sharePointHealth(sharepoint({ secretExpiresOn: '2026-10-23' }), TODAY)).toEqual({ state: 'expired', on: '2026-10-23' });
      expect(sharePointHealth(sharepoint({ secretExpiresOn: null }), TODAY)).toEqual({ state: 'ok' });
    });

    it('counts calendar days', () => {
      expect(daysBetween('2026-10-24', '2026-11-23')).toBe(30);
      expect(daysBetween('2026-10-24', '2026-10-24')).toBe(0);
      expect(daysBetween('2026-10-24', '2026-10-23')).toBe(-1);
    });
  });

  describe('usage', () => {
    it('normal below 90%, near from 90%, full at the limit', () => {
      expect(usageView(cloud(3.2))).toEqual(jasmine.objectContaining({ tone: 'normal', percent: 32 }));
      expect(usageView(cloud(8.99)).tone).toBe('normal');
      expect(usageView(cloud(9)).tone).toBe('near');
      expect(usageView(cloud(9.1))).toEqual(jasmine.objectContaining({ tone: 'near', percent: 91 }));
      expect(usageView(cloud(10))).toEqual(jasmine.objectContaining({ tone: 'full', percent: 100, leftBytes: 0 }));
      expect(usageView(cloud(11)).percent).toBe(100);
    });

    it('the limit is binary gigabytes', () => {
      expect(usageView(cloud()).limitBytes).toBe(10 * GIB);
    });

    it('own storage: no AccreditMe limit applies; before confirming, the cloud meter shows', () => {
      expect(usageView(minio()).tone).toBe('own');
      expect(usageView(sharepoint()).tone).toBe('own');
      expect(usageView(unconfirmed()).tone).toBe('normal');
    });
  });

  it('hostOf: the host of a URL, or the text as given', () => {
    expect(hostOf('https://minio.alnakheel.local:9000/x')).toBe('minio.alnakheel.local');
    expect(hostOf('not a url')).toBe('not a url');
  });
});
