import type { WorkflowObjectType } from '../../../generated/prisma/client';

/**
 * ACC-271 PR 3 (plan §10, Section 10) — the moves the app runs itself, and the
 * one line that says when. A transition whose mover is APP is read with its
 * entry here (`appMove`), so the screen never keeps its own copy. Keyed by the
 * record type and the from- and to-stage keys, which the seed sets and a rename
 * keeps. Every APP transition the seed writes must have an entry:
 * app-moves.spec.ts fails otherwise, so a missing one is a test failure, never
 * a runtime gap.
 */
export interface AppMove {
  key: string;
  objectType: WorkflowObjectType;
  fromStageKey: string;
  toStageKey: string;
  en: string;
  ar: string;
}

/**
 * ACC-245 PR 3a — the key an added review stage is read with here. Added stages
 * have no key of their own (review-stages.ts); the template read passes this for
 * a stage isReviewStage() says is one, on the protected template only. Its
 * brackets keep it from ever matching a seeded key.
 */
export const REVIEW_STAGE_MOVE_KEY = '(review stage)';

export const APP_MOVES: readonly AppMove[] = [
  {
    key: 'committee_change_request.submit',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: 'draft',
    toStageKey: 'under_review',
    en: 'Runs when the change request is submitted for review.',
    ar: 'يحدث عند إرسال طلب التغيير للمراجعة.',
  },
  {
    key: 'committee_change_request.resubmit',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: 'returned',
    toStageKey: 'under_review',
    en: 'Runs when the returned change request is submitted again.',
    ar: 'يحدث عند إعادة إرسال طلب التغيير المُعاد.',
  },
  {
    key: 'committee_change_request.approve',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: 'under_review',
    toStageKey: 'approved',
    en: "Runs when the change request is approved on the committee's page.",
    ar: 'يحدث عند اعتماد طلب التغيير من صفحة اللجنة.',
  },
  {
    key: 'committee_change_request.return',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: 'under_review',
    toStageKey: 'returned',
    en: "Runs when the change request is returned for changes on the committee's page.",
    ar: 'يحدث عند إعادة طلب التغيير للتعديل من صفحة اللجنة.',
  },
  {
    key: 'committee_change_request.reject',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: 'under_review',
    toStageKey: 'rejected',
    en: "Runs when the change request is rejected on the committee's page.",
    ar: 'يحدث عند رفض طلب التغيير من صفحة اللجنة.',
  },
  {
    key: 'committee_change_request.withdraw_draft',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: 'draft',
    toStageKey: 'withdrawn',
    en: 'Runs when the draft change request is withdrawn.',
    ar: 'يحدث عند سحب مسودة طلب التغيير.',
  },
  {
    key: 'committee_change_request.withdraw_in_review',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: 'under_review',
    toStageKey: 'withdrawn',
    en: 'Runs when the change request is withdrawn while under review.',
    ar: 'يحدث عند سحب طلب التغيير أثناء مراجعته.',
  },
  // ACC-245 PR 3a — the moves an added review stage brings (review-stages.ts):
  // the two Submit moves re-pointed to it, and its own four.
  {
    key: 'committee_change_request.submit_to_review',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: 'draft',
    toStageKey: REVIEW_STAGE_MOVE_KEY,
    en: 'Runs when the change request is submitted for review.',
    ar: 'يحدث عند إرسال طلب التغيير للمراجعة.',
  },
  {
    key: 'committee_change_request.resubmit_to_review',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: 'returned',
    toStageKey: REVIEW_STAGE_MOVE_KEY,
    en: 'Runs when the returned change request is submitted again.',
    ar: 'يحدث عند إعادة إرسال طلب التغيير المُعاد.',
  },
  {
    key: 'committee_change_request.review_approve',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: REVIEW_STAGE_MOVE_KEY,
    toStageKey: REVIEW_STAGE_MOVE_KEY,
    en: "Runs when someone on this review stage approves the change request on the committee's page.",
    ar: 'يحدث عند اعتماد أحد أعضاء مرحلة المراجعة هذه لطلب التغيير من صفحة اللجنة.',
  },
  {
    key: 'committee_change_request.review_approve_to_decision',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: REVIEW_STAGE_MOVE_KEY,
    toStageKey: 'under_review',
    en: "Runs when someone on this review stage approves the change request on the committee's page.",
    ar: 'يحدث عند اعتماد أحد أعضاء مرحلة المراجعة هذه لطلب التغيير من صفحة اللجنة.',
  },
  {
    key: 'committee_change_request.review_return',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: REVIEW_STAGE_MOVE_KEY,
    toStageKey: 'returned',
    en: "Runs when the change request is returned for changes on the committee's page.",
    ar: 'يحدث عند إعادة طلب التغيير للتعديل من صفحة اللجنة.',
  },
  {
    key: 'committee_change_request.review_reject',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: REVIEW_STAGE_MOVE_KEY,
    toStageKey: 'rejected',
    en: "Runs when the change request is rejected on the committee's page.",
    ar: 'يحدث عند رفض طلب التغيير من صفحة اللجنة.',
  },
  {
    key: 'committee_change_request.review_withdraw',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: REVIEW_STAGE_MOVE_KEY,
    toStageKey: 'withdrawn',
    en: 'Runs when the change request is withdrawn while it is being reviewed.',
    ar: 'يحدث عند سحب طلب التغيير أثناء مراجعته.',
  },
  {
    key: 'committee_change_request.withdraw_returned',
    objectType: 'COMMITTEE_CHANGE_REQUEST',
    fromStageKey: 'returned',
    toStageKey: 'withdrawn',
    en: 'Runs when the returned change request is withdrawn.',
    ar: 'يحدث عند سحب طلب التغيير المُعاد.',
  },
  // ACC-316 — the meeting's own writes ride these moves (the review date and
  // round; resetting the answers), so the meeting page fires them (PR 4).
  {
    key: 'meeting.distribute',
    objectType: 'MEETING',
    fromStageKey: 'minutes_draft',
    toStageKey: 'minutes_review',
    en: "Runs when the minutes are distributed for review on the meeting's page.",
    ar: 'يحدث عند توزيع المحضر للمراجعة من صفحة الاجتماع.',
  },
  {
    key: 'meeting.return_for_correction',
    objectType: 'MEETING',
    fromStageKey: 'minutes_review',
    toStageKey: 'minutes_draft',
    en: "Runs when the minutes are returned for correction on the meeting's page.",
    ar: 'يحدث عند إعادة المحضر للتصحيح من صفحة الاجتماع.',
  },
];

/** The entry for an APP transition, by record type and stage keys; undefined when none. */
export function appMoveFor(
  objectType: WorkflowObjectType,
  fromStageKey: string | null | undefined,
  toStageKey: string | null | undefined,
): { key: string; en: string; ar: string } | undefined {
  const move = APP_MOVES.find((m) => m.objectType === objectType && m.fromStageKey === fromStageKey && m.toStageKey === toStageKey);
  return move && { key: move.key, en: move.en, ar: move.ar };
}
