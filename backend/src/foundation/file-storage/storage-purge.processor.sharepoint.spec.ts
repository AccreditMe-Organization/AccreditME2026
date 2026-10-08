import { Job, Queue } from 'bullmq';
import { PURGE_JOB, SHAREPOINT_PROBE_INTERVAL_MS, SHAREPOINT_PROBE_JOB, StoragePurgeProcessor } from './storage-purge.processor';
import { RecycleBinService } from './recycle-bin.service';
import { SharePointAccessService } from './sharepoint-access.service';

// ACC-185 — the same queue: the hourly SharePoint probe, and the daily secret
// warning beside the purge.
describe('StoragePurgeProcessor — SharePoint duties (ACC-185)', () => {
  const recycleBin = { purgeExpired: jest.fn() };
  const sharePointAccess = { probeAll: jest.fn(), warnExpiringSecrets: jest.fn() };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const processor = new StoragePurgeProcessor(
    recycleBin as unknown as RecycleBinService,
    sharePointAccess as unknown as SharePointAccessService,
    queue as unknown as Queue,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    recycleBin.purgeExpired.mockResolvedValue({ purged: 0, failedOrganizations: [], deferredOrganizations: [] });
    sharePointAccess.warnExpiringSecrets.mockResolvedValue({ warned: 0 });
    sharePointAccess.probeAll.mockResolvedValue({ checked: 1, withdrawn: 0, unavailable: 0 });
  });

  it('schedules the probe hourly, under its own fixed job id', async () => {
    await processor.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith(SHAREPOINT_PROBE_JOB, {}, { repeat: { every: SHAREPOINT_PROBE_INTERVAL_MS }, jobId: 'storage-sharepoint-probe-repeat' });
    expect(SHAREPOINT_PROBE_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  it('the probe job probes, and does nothing else', async () => {
    await processor.process({ name: SHAREPOINT_PROBE_JOB } as Job);
    expect(sharePointAccess.probeAll).toHaveBeenCalledTimes(1);
    expect(recycleBin.purgeExpired).not.toHaveBeenCalled();
    expect(sharePointAccess.warnExpiringSecrets).not.toHaveBeenCalled();
  });

  it('the daily job warns about expiring secrets and purges', async () => {
    await processor.process({ name: PURGE_JOB } as Job);
    expect(sharePointAccess.warnExpiringSecrets).toHaveBeenCalledTimes(1);
    expect(recycleBin.purgeExpired).toHaveBeenCalledTimes(1);
    expect(sharePointAccess.probeAll).not.toHaveBeenCalled();
  });

  it('a deferred organisation does not fail the daily job', async () => {
    recycleBin.purgeExpired.mockResolvedValue({ purged: 0, failedOrganizations: [], deferredOrganizations: ['org-a'] });
    await expect(processor.process({ name: PURGE_JOB } as Job)).resolves.toBeUndefined();
  });

  it('a failing warning still lets the purge run, and fails the job after it', async () => {
    sharePointAccess.warnExpiringSecrets.mockRejectedValue(new Error('notice store down'));
    await expect(processor.process({ name: PURGE_JOB } as Job)).rejects.toThrow('notice store down');
    expect(recycleBin.purgeExpired).toHaveBeenCalledTimes(1);
  });
});
