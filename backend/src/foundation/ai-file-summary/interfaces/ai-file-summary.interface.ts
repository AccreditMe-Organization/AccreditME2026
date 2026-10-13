import { CoverageUnit } from '../extract/file-text';
import { SummaryLanguage } from '../summary-answer';

/** ACC-193 — GET and POST …/evidence/:evidenceId/summary. */
export interface IFileSummaryView {
  /** Summarize may be offered: a summarizable type, and AI available for the organisation. */
  available: boolean;
  /** Someone is making the summary in this language right now. */
  inProgress: boolean;
  summary: IFileSummary | null;
}

export interface IFileSummary {
  language: SummaryLanguage;
  overview: string;
  keyPoints: string[];
  /** ISO — "Summary made 9 Oct 2026". */
  madeAt: string;
  /** Null when the whole file was read. */
  coverage: { unit: CoverageUnit; read: number; total: number } | null;
}
