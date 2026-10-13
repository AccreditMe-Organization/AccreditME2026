import { Observable } from 'rxjs';
import { aiRefusal, AiRefusal } from '../../../core/ai/ai-refusal';
import { refusalCode } from '../../../core/http/refusal';
import type { FormatService } from '../../../core/formatting/format.service';

/**
 * ACC-193 — the AI summary of a file in the viewer. Mirrors the backend's
 * IFileSummaryView (backend/src/foundation/ai-file-summary/interfaces).
 */
export type SummaryLanguage = 'en' | 'ar';

export interface IFileSummaryDto {
  language: SummaryLanguage;
  overview: string;
  keyPoints: string[];
  /** ISO — "Summary made 9 Oct 2026". */
  madeAt: string;
  /** Null when the whole file was read. */
  coverage: { unit: 'pages' | 'rows' | 'text'; read: number; total: number } | null;
}

export interface IFileSummaryView {
  /** Summarize may be offered: a summarizable type, and AI available for the organisation. */
  available: boolean;
  /** Someone is making the summary in this language right now. */
  inProgress: boolean;
  summary: IFileSummaryDto | null;
}

/**
 * A HOST's summary routes (task evidence today). Both carry exactly the host's
 * view entitlement; the viewer never decides who may summarise.
 */
export interface IFileSummaryHost {
  get(file: { id: string }, language: SummaryLanguage): Observable<IFileSummaryView>;
  make(file: { id: string }, language: SummaryLanguage): Observable<IFileSummaryView>;
}

/** The code the in-progress refusal carries: its "Try again" re-reads rather than presses. */
export const SUMMARY_IN_PROGRESS_CODE = 'AI_SUMMARY_IN_PROGRESS';

const of = (kind: AiRefusal['kind'], messageKey: string): AiRefusal => ({ kind, messageKey, params: {} });

/**
 * What the panel says after a press refused. The summary's own codes first
 * (§7 of the plan); the gateway's through ACC-194's one helper; anything else
 * reads as "AI isn't available right now", with Try again.
 *   - no readable text: no Try again (pressing again would read the same file);
 *   - unreadable, busy, in progress: Try again.
 */
export function summaryRefusal(err: unknown, format: Pick<FormatService, 'date'>): AiRefusal {
  switch (refusalCode(err)) {
    case 'SUMMARY_NO_TEXT':
      return of('featureNotAvailable', 'files.viewer.summary.noText');
    case 'SUMMARY_FILE_UNREADABLE':
      return of('unavailable', 'files.viewer.summary.unreadable');
    case 'SUMMARY_BUSY':
      return of('unavailable', 'files.viewer.summary.busy');
    case SUMMARY_IN_PROGRESS_CODE:
      return of('unavailable', 'files.viewer.summary.inProgress');
    default:
      return aiRefusal(err, format) ?? of('unavailable', 'ai.refusal.unavailable');
  }
}

/** The panel's line while someone else's summary is being made (read, not pressed). */
export const IN_PROGRESS_REFUSAL: AiRefusal = of('unavailable', 'files.viewer.summary.inProgress');
