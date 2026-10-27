import { TranslateService } from '@ngx-translate/core';
import { FilesService } from '../../../shared/files/files.service';
import { StorageKind, StorageTestStep } from './storage-settings.service';
import { SHAREPOINT_CODES, stepFailureKey } from './storage-setup';

/** The refusal's code, or null when the error is not a storage refusal. */
export function refusalCode(err: unknown): string | null {
  const code = (err as { error?: { code?: unknown } })?.error?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * A refusal of a storage write in the reader's words, never the server's
 * message (it can name a host):
 *
 * - a SharePoint code at Confirm (SHAREPOINT_SITE_URL_INVALID) says what to
 *   fix, as the test box does;
 * - a failed test at Confirm or Save also says which step failed and what to
 *   check (ACC-260 PR B);
 * - anything else is the shared files.refusal.* sentence, or `fallbackKey`.
 */
export function storageRefusalText(
  err: unknown,
  kind: StorageKind,
  fallbackKey: string,
  files: FilesService,
  translate: TranslateService,
): string {
  const code = refusalCode(err);
  if (kind === 'SHAREPOINT' && code && SHAREPOINT_CODES.includes(code)) {
    return translate.instant(`storage.test.fail.SHAREPOINT.${code}`);
  }
  const said = files.refusal(err) ?? translate.instant(fallbackKey);
  const body = (err as { error?: { code?: unknown; failedStep?: unknown; cause?: unknown } })?.error;
  if (body?.code === 'STORAGE_TEST_FAILED' && typeof body.failedStep === 'string') {
    const cause = typeof body.cause === 'string' ? body.cause : null;
    return `${said} ${translate.instant(stepFailureKey(kind, body.failedStep as StorageTestStep, cause))}`;
  }
  return said;
}

/** A gateway gave up waiting for the test (it can run several minutes against a throttled Microsoft). */
export function isTimeout(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  return status === 408 || status === 504;
}
