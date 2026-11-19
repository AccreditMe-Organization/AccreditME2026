import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService } from '../../../../core/formatting';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingService, type MeetingMinutesDto, type MeetingOpenActionRowDto, type MeetingOpenActionsDto } from '../../services/meeting.service';

/**
 * ACC-316 PR 7b — "Open actions from the last meeting", the agenda's FIXED
 * first section (Meeting Screens, the record page; plan round 3 B5): the last
 * meeting's action items whose task is still open, read from each task. It is
 * not an agenda item: it can't be moved, edited or removed, and has no papers.
 *
 * Rows come from GET /meetings/:id/open-actions, only for whoever may read the
 * last meeting's minutes (`mayRead`); anyone else gets no rows and the section
 * is simply not drawn. A title links to its task only where the task page
 * would open it (`mayOpen`). In Minutes Draft whoever records the minutes adds
 * a short note to each (`canNote`); status is the task's and isn't changed here.
 */
@Component({
  selector: 'am-meeting-open-actions',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslatePipe, ButtonModule, InputTextModule],
  template: `
    @if (rows().length > 0) {
      <section class="am-oa flex flex-col gap-2" data-testid="meeting-open-actions">
        <h3 class="m-0 flex flex-wrap items-baseline justify-between gap-2 text-[13px] font-semibold">
          <span>{{ 'meeting.openActions.title' | translate }}</span>
          <span class="text-meta font-normal text-[var(--am-ink-500)]">{{ summary() }}</span>
        </h3>
        <ul class="m-0 flex flex-col gap-2 ps-0 list-none">
          @for (row of rows(); track row.taskId) {
            <li class="flex flex-col gap-1" [attr.data-open-action]="row.taskId">
              @if (row.mayOpen) {
                <a class="text-[13px] text-[var(--am-blue-primary)]" [routerLink]="['/tasks', row.taskId]" data-open-action-link>{{ row.title }}</a>
              } @else {
                <span class="text-[13px]" data-open-action-title>{{ row.title }}</span>
              }
              <span class="text-meta text-[var(--am-ink-500)]">{{ metaOf(row) }}</span>
              @if (canNote()) {
                <span class="flex items-center gap-2">
                  <input
                    pInputText
                    class="min-w-0 flex-1"
                    maxlength="500"
                    [attr.aria-label]="'meeting.openActions.noteFor' | translate: { title: row.title }"
                    [placeholder]="'meeting.openActions.notePlaceholder' | translate"
                    [ngModel]="draftOf(row)"
                    (ngModelChange)="setDraft(row.taskId, $event)"
                    [attr.data-open-action-note]="row.taskId"
                  />
                  @if (changed(row)) {
                    <p-button size="small" [label]="'common.save' | translate" [loading]="saving() === row.taskId" [attr.data-open-action-save]="row.taskId" (onClick)="saveNote(row)" />
                  }
                </span>
              } @else if (row.note) {
                <span class="text-meta" data-open-action-note-text>{{ 'meeting.openActions.note' | translate: { note: row.note } }}</span>
              }
              @if (error()?.id === row.taskId) {
                <span class="text-meta text-[var(--am-danger-ink)]" role="alert">{{ error()!.key | translate }}</span>
              }
            </li>
          }
        </ul>
        <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.openActions.fixed' | translate }}</p>
      </section>
    }
  `,
  styles: [
    `
      .am-oa {
        padding-block-end: var(--am-space-8);
        border-block-end: 1px solid var(--am-border);
      }
    `,
  ],
})
export class MeetingOpenActionsComponent {
  private readonly meetings = inject(MeetingService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);

  readonly meetingId = input.required<string>();
  readonly openActions = input<MeetingOpenActionsDto | null>(null);
  /** Whoever records the minutes, while the stage takes them (the minutes read's `may.recordMinutes`). */
  readonly canNote = input(false);
  /** The minutes as the server holds them after a note. */
  readonly minutesChange = output<MeetingMinutesDto>();

  /** Notes saved here since the read, by task: shown in place of the read's. */
  private readonly savedNotes = signal<Record<string, string | null>>({});
  private readonly drafts = signal<Record<string, string>>({});
  readonly saving = signal<string | null>(null);
  readonly error = signal<{ id: string; key: string } | null>(null);

  readonly rows = computed(() => {
    const read = this.openActions();
    if (!read?.mayRead) return [];
    const saved = this.savedNotes();
    return read.rows.map((r) => (r.taskId in saved ? { ...r, note: saved[r.taskId]! } : r));
  });

  readonly summary = computed(() => this.format.count('meeting.openActionsNotDone', this.rows().length));

  metaOf(row: MeetingOpenActionRowDto): string {
    return [
      row.owner?.name,
      row.dueAt ? this.translate.instant('meeting.openActions.due', { at: this.format.dateTime(row.dueAt) }) : null,
      this.translate.instant(`task.status.${row.status.toLowerCase()}`),
    ]
      .filter((x): x is string => !!x)
      .join(' · ');
  }

  draftOf(row: MeetingOpenActionRowDto): string {
    return this.drafts()[row.taskId] ?? row.note ?? '';
  }

  setDraft(taskId: string, value: string): void {
    this.drafts.update((d) => ({ ...d, [taskId]: value }));
  }

  changed(row: MeetingOpenActionRowDto): boolean {
    const draft = this.drafts()[row.taskId];
    return draft !== undefined && (draft.trim() || null) !== (row.note ?? null);
  }

  saveNote(row: MeetingOpenActionRowDto): void {
    if (this.saving()) return;
    const note = this.draftOf(row).trim() || null;
    this.saving.set(row.taskId);
    this.error.set(null);
    this.meetings.saveOpenActionNote(this.meetingId(), row.taskId, note).subscribe({
      next: (minutes) => {
        this.saving.set(null);
        const stored = minutes.openActions.find((a) => a.taskId === row.taskId)?.note ?? note;
        this.savedNotes.update((s) => ({ ...s, [row.taskId]: stored }));
        this.drafts.update((d) => {
          const next = { ...d };
          delete next[row.taskId];
          return next;
        });
        this.minutesChange.emit(minutes);
      },
      error: (err: unknown) => {
        this.saving.set(null);
        this.error.set({ id: row.taskId, key: meetingRefusalKey(err) ?? 'meeting.openActions.noteError' });
      },
    });
  }
}
