import { Injectable, signal } from '@angular/core';
import type { WorkloadHintDto } from '../../services/task.service';

/** What a press answered: a suggestion, or "nobody is clearly better placed". */
export type WorkloadAnswer = { kind: 'hint'; hint: WorkloadHintDto } | { kind: 'none' };

/**
 * ACC-199 — "✦ Suggest someone"'s answers, kept FOR THE DIALOG (Q2): a second
 * press for the same person shows the kept answer and costs nothing.
 *
 * Provided by the dialog (New task, Reassign), not the picker, because New
 * task destroys and rebuilds the picker whenever the person moves to step 2 or
 * opens the date view — an answer kept in the picker would be lost, and paid
 * for twice. A picker with no dialog store keeps its own.
 */
@Injectable()
export class TaskWorkloadHintStore {
  /** Keyed by target and person: the counts and the others are that target's. */
  readonly answers = signal<ReadonlyMap<string, WorkloadAnswer>>(new Map());
  /** Whether the organisation can use the feature: null until asked, asked once. */
  readonly available = signal<boolean | null>(null);

  keep(key: string, answer: WorkloadAnswer): void {
    const next = new Map(this.answers());
    next.set(key, answer);
    this.answers.set(next);
  }
}
