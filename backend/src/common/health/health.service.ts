import { Injectable } from '@nestjs/common';

export interface HealthReport {
  status: 'ok';
  commit: string | null;
  commitShort: string | null;
  environment: string | null;
  uptimeSeconds: number;
  timestamp: string;
}

/**
 * ACC-127 — what is actually deployed right now.
 *
 * DELIBERATELY A LIVENESS SIGNAL, NOT A READINESS ONE: it touches no database
 * and no queue. Its job is to answer "is this process up, and which commit is
 * it running", which is the question a deployment leaves open — especially now
 * that migrations run as a pre-deploy step, where knowing whether the new
 * image is serving is the difference between a migration that shipped and one
 * that was rolled past.
 *
 * Adding a database probe here would couple the answer to a dependency that
 * has its own failure modes, so a connection blip would report the service
 * down when the service is fine. If a readiness check is ever wanted it should
 * be a SEPARATE path, so the two questions keep separate answers.
 *
 * `RAILWAY_GIT_COMMIT_SHA` is injected by Railway at build time. It is null in
 * local development and in tests, which is correct rather than a gap: there is
 * no deployed commit to report.
 */
@Injectable()
export class HealthService {
  getHealth(): HealthReport {
    const commit = process.env['RAILWAY_GIT_COMMIT_SHA'] ?? null;

    return {
      status: 'ok',
      commit,
      commitShort: commit ? commit.slice(0, 7) : null,
      environment: process.env['RAILWAY_ENVIRONMENT_NAME'] ?? null,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
