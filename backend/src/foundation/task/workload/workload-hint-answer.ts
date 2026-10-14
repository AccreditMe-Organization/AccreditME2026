import { firstJsonObject } from '../../ai/first-json-object';
import type { IPersonWorkload } from './task-workload';

/**
 * ACC-199 — what the model receives for "✦ Suggest someone", and how its
 * answer is read. Plan: backend/Plans/step-199-workload-hint.md §6.
 *
 * NOBODY IS NAMED. Each person is an opaque label made for this one call — P1,
 * P2, … in a shuffled order, so a label says nothing about where the person
 * sits in the list — with their counts on THIS record. No name, no user id, no
 * task title, no record name, no unit or position name reaches the model. It
 * answers with one label, or none; our code turns the label back into a
 * person and writes every word the assigner reads (ACC-198 D13).
 */

/** At most this many others are sent, the least loaded first. */
export const MAX_OTHERS = 15;

/** The record's type, as the prompt says it. Only the types with a visibility rule can reach here. */
const RECORD_WORDS: Readonly<Record<string, string>> = { COMMITTEE: 'committee', MEETING: 'meeting' };

export interface IHintCandidate {
  label: string;
  workload: IPersonWorkload;
}

export interface IHintPromptInput {
  recordType: string;
  /** The task's priority, when the dialog has one. */
  priority: string | null;
  chosen: IHintCandidate;
  others: readonly IHintCandidate[];
}

export function hintSystemPrompt(): string {
  return [
    'You help someone decide who should take a task in a quality management system.',
    'You are given anonymous labels with workload counts, each counted on one record only. You never see names.',
    'Pick the ONE person from "Others who could take it" best placed to take this task now.',
    'Weigh overdue work most, then work due within 2 working days, then high or critical work, then the open count. Work on hold counts least.',
    'If nobody among the others is clearly better placed than the person currently chosen, pick nobody.',
    'Reply with the JSON object ONLY: no explanation, no reasoning, no other words before or after it.',
    'Exactly {"pick":"P1"} using a label from "Others", or {"pick":null}.',
  ].join('\n');
}

function line(candidate: IHintCandidate): string {
  const w = candidate.workload;
  return `${candidate.label} — open ${w.open}, overdue ${w.overdue}, due within 2 working days ${w.dueSoon}, high or critical ${w.urgent}, on hold ${w.onHold}.`;
}

export function hintPrompt(input: IHintPromptInput): string {
  const record = RECORD_WORDS[input.recordType] ?? 'record';
  return [
    `The task: priority ${input.priority ?? 'not set'}. Counts are for open tasks on this ${record} only.`,
    `Currently chosen: ${line(input.chosen)}`,
    'Others who could take it:',
    ...input.others.map(line),
    '',
    // Said again last: without it the model often explains its weighing first,
    // which costs output and risks the limit (measured 14 Oct: 3 of 6 runs).
    'Reply with the JSON object only, and nothing else.',
  ].join('\n');
}

export type HintParse =
  | { kind: 'pick'; label: string }
  /** The model says nobody is clearly better placed. Refunded; its own message. */
  | { kind: 'none' }
  /** Empty, not JSON, a label we did not send, or the chosen person's own. Refunded; "Try again". */
  | { kind: 'unusable' };

export function parseHintAnswer(text: string, otherLabels: ReadonlySet<string>): HintParse {
  const parsed = firstJsonObject(text);
  if (!parsed || typeof parsed !== 'object' || !('pick' in parsed)) return { kind: 'unusable' };
  const pick = (parsed as { pick: unknown }).pick;
  if (pick === null) return { kind: 'none' };
  if (typeof pick !== 'string') return { kind: 'unusable' };
  const label = pick.trim();
  return otherLabels.has(label) ? { kind: 'pick', label } : { kind: 'unusable' };
}

/**
 * Labels for the chosen person and the others, in a shuffled order. `random`
 * is injectable so a spec can pin the order.
 */
export function labelCandidates<T>(
  chosen: T,
  others: readonly T[],
  random: () => number = Math.random,
): { chosen: { label: string; item: T }; others: { label: string; item: T }[] } {
  const all = [chosen, ...others];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  const labelled = all.map((item, i) => ({ label: `P${i + 1}`, item }));
  return {
    chosen: labelled.find((c) => c.item === chosen)!,
    others: labelled.filter((c) => c.item !== chosen),
  };
}
