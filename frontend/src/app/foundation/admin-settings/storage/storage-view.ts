import { IStorageSettings, SharePointAccessLostReason, StorageKind } from './storage-settings.service';

/**
 * ACC-260, PR A — what the File storage page shows, as pure functions of
 * GET /tenant/storage, so every state is specified (and mutation-checked)
 * without a page. Design: AccreditMe Storage Settings.dc.html §1 (L41-196);
 * plan: backend/Plans/step-260-storage-settings.md §1.
 *
 * Nothing here can show AccreditMe's own storage: for AccreditMe cloud there
 * is no location text and no field, only "Managed by AccreditMe" (rule 1).
 */

/** Order the design draws them in (L718). */
export const STORAGE_KINDS: readonly StorageKind[] = ['S3', 'MINIO', 'LOCAL_FILESYSTEM', 'SHAREPOINT'];

/** The tenant admins are warned from this many days before the secret expires (backend SECRET_EXPIRY_WARNING_DAYS). */
export const SECRET_WARNING_DAYS = 30;
/** "Almost full" from this share of the limit (backend STORAGE_ALMOST_FULL). */
export const NEAR_FULL_RATIO = 0.9;
/** maxStorageGb counts in binary gigabytes (stored-file.service.ts, GIB). */
export const GIB = 1024 ** 3;

/** The confirmed location, or null while uploads are still blocked. */
export function currentKind(s: IStorageSettings): StorageKind | null {
  return s.confirmed ? s.provider : null;
}

// ── SharePoint health ─────────────────────────────────────────────────────────

export type SharePointHealth =
  | { state: 'ok' }
  | { state: 'withdrawn'; since: string; reason: SharePointAccessLostReason | null }
  | { state: 'expiring'; on: string; daysLeft: number }
  | { state: 'expired'; on: string };

/** Whole days from `today` to `date`, both YYYY-MM-DD (UTC calendar days). */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/**
 * Only for a confirmed SharePoint location. Withdrawn access wins: it is the
 * state uploads are refused in, and an expired secret ends up there anyway.
 */
export function sharePointHealth(s: IStorageSettings, today: string): SharePointHealth | null {
  if (currentKind(s) !== 'SHAREPOINT') return null;
  const sp = s.sharepoint;
  if (sp.accessLostAt) return { state: 'withdrawn', since: sp.accessLostAt, reason: sp.accessLostReason };
  if (sp.secretExpiresOn) {
    const daysLeft = daysBetween(today, sp.secretExpiresOn);
    if (daysLeft < 0) return { state: 'expired', on: sp.secretExpiresOn };
    if (daysLeft <= SECRET_WARNING_DAYS) return { state: 'expiring', on: sp.secretExpiresOn, daysLeft };
  }
  return { state: 'ok' };
}

// ── the current-location strip (L55-68, CUR L697-705) ─────────────────────────

export interface StripView {
  /** null: not confirmed yet. */
  kind: StorageKind | null;
  tone: 'ok' | 'danger';
  chipKey: 'storage.chip.blocked' | 'storage.chip.confirmed' | 'storage.chip.unreachable';
  /** The tenant's own location (host · bucket, folder, site › library). Never set for AccreditMe cloud. */
  location: string | null;
  /** AccreditMe cloud: "Managed by AccreditMe". */
  managed: boolean;
  /** SharePoint with access withdrawn: the detail says new uploads are refused. */
  refused: boolean;
  confirmed: { at: string; by: string | null } | null;
  request: { at: string; by: string | null } | null;
}

export function stripView(s: IStorageSettings, today: string): StripView {
  const kind = currentKind(s);
  if (!kind) {
    return { kind: null, tone: 'danger', chipKey: 'storage.chip.blocked', location: null, managed: false, refused: false, confirmed: null, request: null };
  }
  const refused = sharePointHealth(s, today)?.state === 'withdrawn';
  return {
    kind,
    tone: refused ? 'danger' : 'ok',
    chipKey: refused ? 'storage.chip.unreachable' : 'storage.chip.confirmed',
    location: locationText(s, kind),
    managed: kind === 'S3',
    refused,
    confirmed: s.confirmedAt ? { at: s.confirmedAt, by: s.confirmedBy?.name ?? null } : null,
    request: s.changeRequestedAt ? { at: s.changeRequestedAt, by: s.changeRequestedBy?.name ?? null } : null,
  };
}

/** The host of a URL, or the text as given if it is not one. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** The tenant's own location, as the strip shows it. Null for AccreditMe cloud, always. */
export function locationText(s: IStorageSettings, kind: StorageKind): string | null {
  switch (kind) {
    case 'S3':
      return null;
    case 'MINIO':
      return [s.minio.endpoint ? hostOf(s.minio.endpoint) : null, s.minio.bucket].filter(Boolean).join(' · ') || null;
    case 'LOCAL_FILESYSTEM':
      return s.local.rootPath;
    case 'SHAREPOINT': {
      const site = s.sharepoint.siteName ?? s.sharepoint.siteUrl;
      return [site, s.sharepoint.libraryName].filter(Boolean).join(' › ') || null;
    }
  }
}

// ── the location list (L70-140, OPTS L713-729) ────────────────────────────────

export interface OptionView {
  kind: StorageKind;
  /** This installation offers it (a local folder only on-premises). */
  offered: boolean;
  /** The confirmed location: open, with a "Current" chip. */
  current: boolean;
  /** Greyed: once confirmed, every other option; before, one not offered. */
  disabled: boolean;
}

export function optionsView(s: IStorageSettings): OptionView[] {
  const kind = currentKind(s);
  return STORAGE_KINDS.map((k) => {
    const offered = s.offeredProviders.includes(k);
    const current = kind === k;
    return { kind: k, offered, current, disabled: kind ? !current : !offered };
  });
}

// ── the current location's fields, locked (L606-610, L673-681) ────────────────

/** One part of a field's value: the tenant's own text, a translated word, or a date. */
export type ValuePart = { text: string } | { key: string } | { date: string };

export interface FieldView {
  id: string;
  labelKey: string;
  value: ValuePart[];
  /** Addresses, keys and paths read left to right in both languages. */
  ltr: boolean;
  /** Where files are: grey, 🔒. Credentials and notes are not locked. */
  locked: boolean;
  helpKey: 'storage.help.lock' | 'storage.help.locked' | 'storage.help.cantShow' | null;
}

const SET: ValuePart = { key: 'storage.field.set' };
const text = (t: string | null): ValuePart[] => (t ? [{ text: t }] : [{ key: 'storage.field.none' }]);

/**
 * The confirmed location's details, read-only. The first locked field says who
 * changes where files are; the rest say "Locked" (L1052). Secrets only as "Set".
 */
export function currentFields(s: IStorageSettings): FieldView[] {
  switch (currentKind(s)) {
    case 'MINIO': {
      const m = s.minio;
      const https = m.endpoint ? m.endpoint.toLowerCase().startsWith('https:') : true;
      return [
        { id: 'endpoint', labelKey: 'storage.field.endpoint', value: text(m.endpoint), ltr: true, locked: true, helpKey: 'storage.help.lock' },
        { id: 'bucket', labelKey: 'storage.field.bucket', value: text(m.bucket), ltr: true, locked: true, helpKey: 'storage.help.locked' },
        {
          id: 'regionHttps',
          labelKey: 'storage.field.regionHttps',
          value: [...text(m.region), { key: https ? 'storage.field.on' : 'storage.field.off' }],
          ltr: false,
          locked: true,
          helpKey: 'storage.help.locked',
        },
        { id: 'accessKey', labelKey: 'storage.field.accessKey', value: m.accessKeyId ? [SET] : text(null), ltr: false, locked: false, helpKey: 'storage.help.cantShow' },
        { id: 'secretKey', labelKey: 'storage.field.secretKey', value: m.secretAccessKey ? [SET] : text(null), ltr: false, locked: false, helpKey: 'storage.help.cantShow' },
      ];
    }
    case 'LOCAL_FILESYSTEM':
      return [{ id: 'folderPath', labelKey: 'storage.field.folderPath', value: text(s.local.rootPath), ltr: true, locked: true, helpKey: 'storage.help.lock' }];
    case 'SHAREPOINT': {
      const sp = s.sharepoint;
      return [
        { id: 'spTenant', labelKey: 'storage.field.spTenant', value: text(sp.tenant ?? sp.tenantId), ltr: true, locked: true, helpKey: 'storage.help.lock' },
        { id: 'spSiteUrl', labelKey: 'storage.field.spSiteUrl', value: text(sp.siteWebUrl ?? sp.siteUrl), ltr: true, locked: true, helpKey: 'storage.help.locked' },
        { id: 'spLibrary', labelKey: 'storage.field.spLibrary', value: text(sp.libraryName), ltr: false, locked: true, helpKey: 'storage.help.locked' },
        { id: 'spClientId', labelKey: 'storage.field.spClientId', value: text(sp.clientId), ltr: true, locked: false, helpKey: null },
        { id: 'spClientSecret', labelKey: 'storage.field.spClientSecret', value: sp.clientSecret ? [SET] : text(null), ltr: false, locked: false, helpKey: 'storage.help.cantShow' },
        {
          id: 'spSecretExpires',
          labelKey: 'storage.field.spSecretExpires',
          value: sp.secretExpiresOn ? [{ date: sp.secretExpiresOn }] : [{ key: 'storage.field.notRecorded' }],
          ltr: false,
          locked: false,
          helpKey: null,
        },
      ];
    }
    default:
      // AccreditMe cloud (a banner, no fields) and not confirmed yet.
      return [];
  }
}

// ── usage (L143-152, USE L731-736) ────────────────────────────────────────────

export interface UsageView {
  /** own: the organisation keeps files elsewhere, so no AccreditMe limit applies. */
  tone: 'normal' | 'near' | 'full' | 'own';
  usedBytes: number;
  limitBytes: number;
  leftBytes: number;
  /** Whole percent of the limit used, 0-100. */
  percent: number;
}

export function usageView(s: IStorageSettings): UsageView {
  const usedBytes = Math.max(0, s.usage.usedBytes);
  const limitBytes = Math.max(0, s.usage.maxStorageGb) * GIB;
  const ratio = limitBytes > 0 ? usedBytes / limitBytes : 1;
  // A hair of tolerance: 9.1 GB of 10 GB is 91%, not 90.9999…% floored to 90.
  const percent = Math.min(100, Math.floor(ratio * 100 + 1e-6));
  const kind = currentKind(s);
  const tone = kind && kind !== 'S3' ? 'own' : ratio >= 1 ? 'full' : ratio >= NEAR_FULL_RATIO ? 'near' : 'normal';
  return { tone, usedBytes, limitBytes, leftBytes: Math.max(0, limitBytes - usedBytes), percent };
}
