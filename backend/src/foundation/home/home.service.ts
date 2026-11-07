import { Injectable, Logger } from '@nestjs/common';
import {
  COMMITTEES_PERMISSIONS,
  SETUP_PERMISSIONS,
  TENANT_PERMISSIONS,
  USERS_PERMISSIONS,
} from '../../common/constants/permissions';
import { CommitteeHomeService } from '../committees/committee-home.service';
import { SetupHealthService } from '../setup-health/setup-health.service';
import { UserHomeCountsService } from '../user/user-home-counts.service';
import { IHomeAdminSummary, IHomePartFailed } from './home.interface';

const FAILED: IHomePartFailed = { failed: true };

/**
 * ACC-279 — Home's admin block. Each part is decided by the caller's permissions
 * BEFORE anything is read (ACC-101 clause a), and computed by the module that owns
 * its data; this service queries nothing itself.
 *
 *   setup       setup:view        3 queries (SetupHealthService.getHomeSlice)
 *   users       users:view        2, or 3 with tenant:view (seats)
 *   committees  committees:view   1 grouped query
 *
 * At most 7 queries, all in ONE parallel wave; a caller holding none of the three
 * permissions makes no query. Parts run in allSettled, so one that fails answers
 * { failed: true } and the others still arrive: the screen then says which count
 * failed, with Retry, and never shows 0 for it. Nothing here is on the per-request
 * path; Home calls it once when it opens.
 */
@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private readonly setupHealth: SetupHealthService,
    private readonly users: UserHomeCountsService,
    private readonly committees: CommitteeHomeService,
  ) {}

  async adminSummary(organizationId: string, permissions: readonly string[]): Promise<IHomeAdminSummary> {
    const holds = (key: string) => permissions.includes(key);
    const [setup, users, committees] = await Promise.allSettled([
      holds(SETUP_PERMISSIONS.VIEW) ? this.setupHealth.getHomeSlice(organizationId) : Promise.resolve(null),
      holds(USERS_PERMISSIONS.VIEW)
        ? this.users.counts(organizationId, { withSeats: holds(TENANT_PERMISSIONS.VIEW) })
        : Promise.resolve(null),
      holds(COMMITTEES_PERMISSIONS.VIEW) ? this.committees.homeCounts(organizationId) : Promise.resolve(null),
    ]);
    return {
      setup: this.settle('setup', setup, organizationId),
      users: this.settle('users', users, organizationId),
      committees: this.settle('committees', committees, organizationId),
    };
  }

  private settle<T>(part: string, result: PromiseSettledResult<T | null>, organizationId: string): T | IHomePartFailed | null {
    if (result.status === 'fulfilled') return result.value;
    // Ids only: the reason's message can carry query text.
    const reason = result.reason instanceof Error ? result.reason.name : 'unknown';
    this.logger.warn(`[HomeAdminSummary] part=${part} organization=${organizationId} failed (${reason})`);
    return FAILED;
  }
}
