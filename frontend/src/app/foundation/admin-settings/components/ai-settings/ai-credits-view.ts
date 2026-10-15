import { IAiBalance, IAiFeatureUsage } from '../../../tenant/services/tenant.service';

/**
 * ACC-120 slice 8 — the AI credits screen's rules, kept apart from the
 * template so each one is pinned by a spec. Plan, with the decisions:
 * backend/Plans/step-120-8-ai-credits.md.
 */

/**
 * The three drawn states, decided by the ALLOCATION, never by `enabled`.
 * `enabled` is false both with no allowance and with AI switched off, so it
 * cannot tell "none" from anything else.
 *
 * - none: no allowance at all. No meter and no zero, because a "0 of 0" bar
 *   would look exactly like spent.
 * - spent: an allowance, fully used. AI is paused until the reset.
 * - normal: an allowance with credits left.
 */
export type AiCreditsState = 'none' | 'spent' | 'normal';

export function aiCreditsState(ai: Pick<IAiBalance, 'monthlyCredits' | 'creditsRemaining'>): AiCreditsState {
  if (ai.monthlyCredits <= 0) return 'none';
  return ai.creditsRemaining <= 0 ? 'spent' : 'normal';
}

/**
 * How a meter segment and its breakdown row are marked. The ink alone would be
 * colour alone, so every row's swatch also carries a glyph, and "Other" is a
 * texture (the hatch), not a fifth blue.
 */
export interface AiUsageMark {
  /** A design token, never a literal. */
  readonly ink: string;
  readonly glyph: string;
}

const MARKS: readonly AiUsageMark[] = [
  { ink: 'var(--am-primary-700)', glyph: '▲' },
  { ink: 'var(--am-primary-600)', glyph: '●' },
  { ink: 'var(--am-ink-500)', glyph: '■' },
  { ink: 'var(--am-ink-300)', glyph: '◆' },
];

/** The rows past the fourth share the last mark: today there are four features. */
function markAt(index: number): AiUsageMark {
  return MARKS[Math.min(index, MARKS.length - 1)];
}

export interface AiUsageRow {
  /** A feature key, or null for "Other". */
  readonly key: string | null;
  /** What the breakdown says this row used. */
  readonly credits: number;
  /** Its share of the breakdown's own total, rounded; null when that total is 0. */
  readonly percent: number | null;
  /** Its segment's width as a share of the ALLOWANCE (0–100). */
  readonly segmentPercent: number;
  /** Null for "Other", which is drawn as the hatch. */
  readonly mark: AiUsageMark | null;
}

export interface AiUsageView {
  /** In the order drawn: features by credits, then "Other". */
  readonly rows: readonly AiUsageRow[];
  /** True when the log adds up to less than `creditsUsed`. */
  readonly hasOther: boolean;
}

/**
 * The meter and the breakdown (Ahmad, 15 Oct, CC-109a):
 *
 * - Feature segments are capped, in order, so their sum NEVER passes
 *   `creditsUsed`. The counter is what the gateway enforces; the log is
 *   evidence of where it went and can disagree (a counter reset by hand
 *   leaves the log as it was).
 * - When the log adds up to LESS than `creditsUsed`, the rest is one plain
 *   "Other" segment, and an "Other" row so the breakdown accounts for it.
 * - Percentages are of the breakdown's own total.
 */
export function aiUsageView(
  ai: Pick<IAiBalance, 'monthlyCredits' | 'creditsUsed'>,
  usage: readonly IAiFeatureUsage[],
): AiUsageView {
  const allowance = Math.max(ai.monthlyCredits, 0);
  const used = Math.min(Math.max(ai.creditsUsed, 0), allowance);
  const width = (credits: number): number => (allowance > 0 ? (credits / allowance) * 100 : 0);

  let room = used;
  const features = usage
    .filter((u) => u.credits > 0)
    .map((u, i) => {
      const drawn = Math.min(u.credits, room);
      room -= drawn;
      return { key: u.key, credits: u.credits, drawn, mark: markAt(i) };
    });
  const logged = features.reduce((sum, f) => sum + f.credits, 0);
  const other = Math.max(used - logged, 0);

  const total = logged + other;
  const percent = (credits: number): number | null => (total > 0 ? Math.round((credits / total) * 100) : null);

  const rows: AiUsageRow[] = features.map((f) => ({
    key: f.key,
    credits: f.credits,
    percent: percent(f.credits),
    segmentPercent: width(f.drawn),
    mark: f.mark,
  }));
  if (other > 0) {
    rows.push({ key: null, credits: other, percent: percent(other), segmentPercent: width(other), mark: null });
  }
  return { rows, hasOther: other > 0 };
}

/** The translation key for a feature's name; an unknown key gets a generic name, never the raw key. */
const FEATURE_NAMES: Readonly<Record<string, string>> = {
  document_summary: 'aiCredits.feature.document_summary',
  morning_briefing: 'aiCredits.feature.morning_briefing',
  task_description_drafting: 'aiCredits.feature.task_description_drafting',
  workload_balancing: 'aiCredits.feature.workload_balancing',
};

export function aiFeatureNameKey(key: string | null): string {
  if (key === null) return 'aiCredits.other';
  return FEATURE_NAMES[key] ?? 'aiCredits.feature.unknown';
}
