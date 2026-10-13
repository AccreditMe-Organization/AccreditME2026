import { IDraftLine } from '../draft-answer';

/** ACC-197 — a task draft, as the New task dialog receives it. Nothing is stored. */
export interface ITaskDraft {
  /**
   * The AI log row of the call that made this draft. The dialog sends it back
   * with Create task, and the task's audit row is marked only if it checks out.
   */
  draftId: string | null;
  /** A suggested title, or null when there is none worth showing (Q10). */
  title: string | null;
  /** Purpose, To do, Done when — the labels in the reader's language. */
  lines: IDraftLine[];
  /** What Accept puts in the Description field: the three lines, one per line. */
  description: string;
}

export interface ITaskDraftAvailability {
  available: boolean;
}
