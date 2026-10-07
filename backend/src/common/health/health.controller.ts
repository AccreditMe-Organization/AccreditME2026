import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService, HealthReport } from './health.service';

/**
 * ACC-127 — GET /api/v1/health.
 *
 * UNGUARDED ON PURPOSE. Authorization guards in this codebase are applied per
 * controller (`@UseGuards(TenantGuard, PermissionGuard)`), so omitting them here
 * is a decision rather than an oversight: a health check that needs a tenant
 * session cannot answer the one question it exists for — whether the service
 * came up at all — and would be useless to an uptime monitor.
 *
 * NOT RATE-LIMITED, and the only route that is not (ACC-129). The rate limiter
 * IS global (APP_GUARD), and an uptime monitor polls this route by design, so a
 * limit here would turn a healthy service into a reported outage.
 *
 * It exposes no tenant data. The commit SHA is already public in the GitHub
 * repository, and uptime says nothing a request's own latency does not.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthReport {
    return this.healthService.getHealth();
  }
}
