import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphError } from '../../providers/storage/sharepoint/graph-client';
import { MicrosoftSignInError } from '../../providers/storage/sharepoint/microsoft-identity';
import { readStorageConfig } from './storage-config';
import { StorageRefusalException } from './storage-refusal';
import { StorageResolverService } from './storage-resolver.service';
import { SharePointAccessLostReason, StorageNoticesService } from './storage-notices.service';

/** The tenant admins are told this many days before the secret expires. */
export const SECRET_EXPIRY_WARNING_DAYS = 30;

/**
 * Whether a SharePoint failure means access was WITHDRAWN — and why. `scope`
 * says what the failing call addressed: a 404 on the library itself is the
 * library gone, while a 404 on one file is only that file (deleted inside
 * SharePoint), and the connection is fine.
 *
 * Not a withdrawal: Microsoft or the network failing (status 0, 5xx,
 * throttling that outlasted the retries, an unrecognised sign-in answer).
 */
export function classifyAccessLoss(error: unknown, scope: 'library' | 'file'): SharePointAccessLostReason | null {
  if (error instanceof MicrosoftSignInError) {
    if (error.reason === 'SECRET_INVALID') return 'SECRET_INVALID';
    if (error.reason === 'CLIENT_NOT_FOUND' || error.reason === 'APP_DISABLED' || error.reason === 'TENANT_NOT_FOUND') {
      return 'CONSENT_REVOKED';
    }
    return null;
  }
  if (error instanceof GraphError) {
    if (error.status === 401) return 'CONSENT_REVOKED';
    if (error.status === 403) return 'GRANT_REMOVED';
    if (error.status === 404 && scope === 'library') return 'LIBRARY_GONE';
  }
  return null;
}

export type ProbeOutcome = 'OK' | 'NOT_SHAREPOINT' | 'UNAVAILABLE' | SharePointAccessLostReason;

/**
 * ACC-185 — whether a confirmed organisation's SharePoint can still be reached.
 *
 * ONE RECORD, ONE NOTICE. storageAccessLostAt/Reason are stamped by the one
 * updateMany that moves them from null; that same call — and only it — tells
 * the tenant admins. Later failures stamp nothing and send nothing.
 *
 * THE SCHEDULED RECOMPUTER IS probe() (ACC-82's rule): every hour, per
 * confirmed SharePoint organisation, one token request and one small read of
 * the library. It sets the flag on a withdrawal and CLEARS it when access
 * works again — so a customer restoring access by hand, or a new secret, is
 * picked up without anyone pressing a button. A check that could not run
 * (Microsoft down) never clears the flag: rows stay as last confirmed.
 *
 * Uploads and downloads never read the flag to decide: they make the call,
 * and a failing call is what refuses them (decided live, ACC-82). The flag is
 * what Setup health and the settings screen show.
 */
@Injectable()
export class SharePointAccessService {
  private readonly logger = new Logger(SharePointAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: StorageResolverService,
    private readonly notices: StorageNoticesService,
  ) {}

  /**
   * A provider failure as the refusal a person sees: STORAGE_ACCESS_WITHDRAWN
   * (stamping the loss) or FILE_UNAVAILABLE for a file gone inside SharePoint.
   * Null when it is neither — the caller's own handling applies.
   */
  async refusalFor(organizationId: string, error: unknown, scope: 'library' | 'file'): Promise<StorageRefusalException | null> {
    const reason = classifyAccessLoss(error, scope);
    if (reason) {
      await this.markLost(organizationId, reason);
      return new StorageRefusalException('STORAGE_ACCESS_WITHDRAWN');
    }
    if (scope === 'file' && error instanceof GraphError && error.status === 404) {
      return new StorageRefusalException('FILE_UNAVAILABLE');
    }
    return null;
  }

  /** Stamps the loss; true when THIS call did, and so sent the one notice. */
  async markLost(organizationId: string, reason: SharePointAccessLostReason): Promise<boolean> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { storageConfig: true },
    });
    // A token Microsoft refused must not be reused for the next attempt.
    if (org) this.resolver.forgetSharePointToken(readStorageConfig(org.storageConfig));
    const stamped = await this.prisma.organization.updateMany({
      where: { id: organizationId, storageProvider: 'SHAREPOINT', storageAccessLostAt: null },
      data: { storageAccessLostAt: new Date(), storageAccessLostReason: reason },
    });
    if (stamped.count !== 1) return false;
    this.logger.warn(`SharePoint access withdrawn for org ${organizationId}: ${reason}`);
    const libraryName = org ? (readStorageConfig(org.storageConfig).sharepoint?.resolved?.libraryName ?? null) : null;
    await this.notices.sharePointAccessLost(organizationId, reason, libraryName);
    return true;
  }

  /** Clears the loss, so the next one is told again. */
  async markRestored(organizationId: string): Promise<void> {
    const cleared = await this.prisma.organization.updateMany({
      where: { id: organizationId, storageAccessLostAt: { not: null } },
      data: { storageAccessLostAt: null, storageAccessLostReason: null },
    });
    if (cleared.count === 1) this.logger.log(`SharePoint access restored for org ${organizationId}`);
  }

  /** The recomputer: sets or clears the flag from one live check. */
  async probe(organizationId: string): Promise<ProbeOutcome> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { storageProvider: true, storageConfirmedAt: true, storageConfig: true },
    });
    if (!org || org.storageProvider !== 'SHAREPOINT' || !org.storageConfirmedAt) return 'NOT_SHAREPOINT';
    try {
      await this.resolver.probeSharePoint(readStorageConfig(org.storageConfig));
    } catch (error) {
      const reason = classifyAccessLoss(error, 'library');
      if (reason) {
        await this.markLost(organizationId, reason);
        return reason;
      }
      this.logger.warn(`SharePoint probe could not run for org ${organizationId}: ${(error as Error)?.name ?? 'Error'} ${(error as Error)?.message ?? ''}`);
      return 'UNAVAILABLE';
    }
    await this.markRestored(organizationId);
    return 'OK';
  }

  /** Refuses — before anything is changed — when the library cannot be reached. */
  async assertReachable(organizationId: string): Promise<void> {
    const outcome = await this.probe(organizationId);
    if (outcome === 'UNAVAILABLE') throw new StorageRefusalException('STORAGE_UNAVAILABLE');
    if (outcome !== 'OK' && outcome !== 'NOT_SHAREPOINT') throw new StorageRefusalException('STORAGE_ACCESS_WITHDRAWN');
  }

  /** The hourly pass over every confirmed SharePoint organisation. */
  async probeAll(): Promise<{ checked: number; withdrawn: number; unavailable: number }> {
    const orgs = await this.prisma.organization.findMany({
      where: { storageProvider: 'SHAREPOINT', storageConfirmedAt: { not: null } },
      select: { id: true },
    });
    let withdrawn = 0;
    let unavailable = 0;
    for (const { id } of orgs) {
      try {
        const outcome = await this.probe(id);
        if (outcome === 'UNAVAILABLE') unavailable++;
        else if (outcome !== 'OK' && outcome !== 'NOT_SHAREPOINT') withdrawn++;
      } catch (error) {
        unavailable++;
        this.logger.error(`SharePoint probe failed for org ${id}: ${(error as Error).message}`);
      }
    }
    return { checked: orgs.length, withdrawn, unavailable };
  }

  /**
   * The daily 30-day warning: tenant admins told ONCE per expiry date — the
   * stamp is cleared whenever the date changes (a replaced secret), so the new
   * secret warns again 30 days before ITS date. No date, no warning: we cannot
   * know it. An already-expired secret is not warned about here; the probe
   * finds it invalid and the withdrawn-access notice says so.
   */
  async warnExpiringSecrets(now: Date = new Date()): Promise<{ warned: number }> {
    const orgs = await this.prisma.organization.findMany({
      where: { storageProvider: 'SHAREPOINT', storageConfirmedAt: { not: null }, storageSecretWarnedAt: null },
      select: { id: true, storageConfig: true },
    });
    const today = DateTime.fromJSDate(now, { zone: 'utc' }).startOf('day');
    let warned = 0;
    for (const org of orgs) {
      try {
        const expiresOn = readStorageConfig(org.storageConfig).sharepoint?.secretExpiresOn;
        if (!expiresOn) continue;
        const daysLeft = DateTime.fromISO(expiresOn, { zone: 'utc' }).startOf('day').diff(today, 'days').days;
        if (daysLeft < 0 || daysLeft > SECRET_EXPIRY_WARNING_DAYS) continue;
        const stamped = await this.prisma.organization.updateMany({
          where: { id: org.id, storageSecretWarnedAt: null },
          data: { storageSecretWarnedAt: now },
        });
        if (stamped.count !== 1) continue;
        await this.notices.sharePointSecretExpiring(org.id, expiresOn);
        warned++;
      } catch (error) {
        this.logger.error(`Secret-expiry warning failed for org ${org.id}: ${(error as Error).message}`);
      }
    }
    return { warned };
  }
}
