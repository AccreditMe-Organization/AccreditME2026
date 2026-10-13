import { BriefingGroupKind, IBriefingItem } from '../briefing-groups';

/** An item as shown: the snapshot our code built, plus whether it has been done since (drawing Q6). */
export interface IBriefingViewItem extends IBriefingItem {
  done: boolean;
}

/** GET /ai/briefing and POST /ai/briefing — ACC-198. */
export interface IBriefingView {
  /** May this user press the button here (permission, feature open, AI on)? Credits used up still counts as available. */
  available: boolean;
  /** The price of one run (D2), or null when the feature is not open. */
  creditCost: number | null;
  /** By the time of day in the tenant's zone (D6). */
  greeting: 'morning' | 'afternoon' | 'evening';
  /** Today's briefing (D3), or null. */
  briefing: {
    language: 'en' | 'ar';
    lead: string;
    generatedAt: string;
    creditCost: number;
    /** D13 — at most three, validated against the items sent. */
    focus: { item: IBriefingViewItem; reason: string }[];
    groups: { kind: BriefingGroupKind; items: IBriefingViewItem[] }[];
  } | null;
}
