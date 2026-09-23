import { HealthService } from './health.service';

describe('HealthService (ACC-127)', () => {
  const service = new HealthService();
  const original = process.env['RAILWAY_GIT_COMMIT_SHA'];

  afterEach(() => {
    if (original === undefined) {
      delete process.env['RAILWAY_GIT_COMMIT_SHA'];
    } else {
      process.env['RAILWAY_GIT_COMMIT_SHA'] = original;
    }
  });

  it('reports the deployed commit, full and short', () => {
    process.env['RAILWAY_GIT_COMMIT_SHA'] = '5f9ba890da0805c7c878907980efc93919799496';

    const report = service.getHealth();

    expect(report.status).toBe('ok');
    expect(report.commit).toBe('5f9ba890da0805c7c878907980efc93919799496');
    expect(report.commitShort).toBe('5f9ba89');
  });

  // Null rather than a placeholder string: a health check that invents a
  // commit is worse than one that admits it does not know, because the
  // invented value reads as a real answer to whoever is checking what shipped.
  it('reports null for the commit when nothing was injected', () => {
    delete process.env['RAILWAY_GIT_COMMIT_SHA'];

    const report = service.getHealth();

    expect(report.commit).toBeNull();
    expect(report.commitShort).toBeNull();
    expect(report.status).toBe('ok');
  });

  it('does not touch the database or the queue', () => {
    // Constructed with no dependencies at all — the guarantee is structural,
    // so a future readiness probe cannot be added here without changing the
    // constructor and failing this test.
    expect(HealthService.length).toBe(0);
    expect(service.getHealth().uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
