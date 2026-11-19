import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { MeetingService, type MeetingAgendaItemDto, type MeetingAttendeeDto, type MeetingDto, type MeetingFileDto } from '../../services/meeting.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingAgendaItemDialogComponent } from '../meeting-agenda-item-dialog/meeting-agenda-item-dialog.component';
import { MeetingFileListComponent } from '../meeting-file-list/meeting-file-list.component';

/**
 * ACC-316 PR 7 — the meeting's Agenda panel (Meeting Screens round 5, section
 * 4): items in order, each with its number, title, Standing chip, "Presenter ·
 * seat · 10 min", its papers in flow, and Edit. Whoever may manage the agenda
 * (the read's `may.manageAgenda`, the stage's and the scheduler's rule) adds,
 * edits, removes and reorders: by the handle, dragged, or with the arrow keys
 * on it. Every write returns the agenda as the server now holds it, and the
 * panel shows that, never its own guess.
 */
@Component({
  selector: 'am-meeting-agenda-panel',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, CdkDropList, CdkDrag, CdkDragHandle, MeetingAgendaItemDialogComponent, MeetingFileListComponent],
  template: `
    <section class="flex flex-col gap-2 rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] p-3" data-testid="meeting-agenda">
      <h2 class="m-0 flex flex-wrap items-center justify-between gap-2 text-[15px] font-semibold">
        <span class="flex items-center gap-2">
          {{ 'meeting.agenda.title' | translate }}
          <span class="text-meta text-[var(--am-ink-500)]">{{ format.number(items().length) }}</span>
          @if (planned(); as p) {
            <span class="text-meta font-normal text-[var(--am-ink-500)]" data-testid="meeting-agenda-planned">{{ p }}</span>
          }
        </span>
        @if (canManage()) {
          <p-button size="small" [text]="true" icon="pi pi-plus" [label]="'meeting.agenda.add' | translate" data-testid="meeting-agenda-add" (onClick)="openItem(null)" />
        }
      </h2>
      @if (items().length === 0) {
        <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.agenda.empty' | translate }}</p>
      }
      <ol class="m-0 flex flex-col gap-2 ps-0 list-none" cdkDropList [cdkDropListDisabled]="!canManage() || busy()" (cdkDropListDropped)="dropped($event)">
        @for (item of items(); track item.id; let i = $index) {
          <li class="flex items-start gap-2 bg-[var(--am-card)]" cdkDrag [cdkDragDisabled]="!canManage() || busy()" [attr.data-agenda-item]="item.id">
            @if (canManage()) {
              <button
                type="button"
                cdkDragHandle
                class="am-agenda__handle"
                [attr.aria-label]="'meeting.agenda.reorder' | translate: { n: format.number(i + 1), title: item.title }"
                [attr.aria-keyshortcuts]="'ArrowUp ArrowDown'"
                [disabled]="busy()"
                (keydown)="moveByKey($event, i)"
                data-testid="meeting-agenda-handle"
              >
                <span aria-hidden="true">⣿</span>
              </button>
            }
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex flex-wrap items-center gap-1 text-[13px] font-medium">
                <span>{{ format.number(item.order) }}.</span>
                <span class="min-w-0 break-words">{{ item.title }}</span>
                @if (item.standing) {
                  <span class="text-[11px] px-1.5 py-px rounded bg-[var(--am-surface)]">{{ 'meeting.agenda.standing' | translate }}</span>
                }
              </span>
              @if (itemMeta(item); as meta) {
                <span class="text-meta text-[var(--am-ink-500)]">{{ meta }}</span>
              }
              <am-meeting-file-list
                [meetingId]="meeting().id"
                [itemId]="item.id"
                [files]="papersOf(item.id)"
                [canManage]="canManage()"
                [contextLabel]="item.title"
                [testId]="'meeting-papers-' + item.id"
                (changed)="filesChanged.emit()"
              />
            </div>
            @if (canManage()) {
              <p-button size="small" [text]="true" [label]="'meeting.agenda.edit' | translate" [ariaLabel]="'meeting.agenda.editNamed' | translate: { title: item.title }" [attr.data-testid]="'meeting-agenda-edit-' + item.id" (onClick)="openItem(item, i + 1)" />
            }
          </li>
        }
      </ol>
      @if (error()) {
        <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="meeting-agenda-error">{{ error()! | translate }}</p>
      }
      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
    </section>
    <app-meeting-agenda-item-dialog
      [visible]="dialogOpen()"
      (visibleChange)="dialogOpen.set($event)"
      [meeting]="meeting()"
      [item]="editing()"
      [position]="editingPosition()"
      [attendees]="attendees()"
      (saved)="onSaved($event)"
    />
  `,
  styles: [
    `
      .am-agenda__handle {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        inline-size: 28px;
        block-size: 28px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: none;
        color: var(--am-ink-500);
        cursor: grab;
      }
      .am-agenda__handle:hover {
        background: var(--am-surface);
      }
      .am-agenda__handle:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: 1px;
      }
      .cdk-drag-preview {
        box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
      }
      .cdk-drag-placeholder {
        opacity: 0.4;
      }
    `,
  ],
})
export class MeetingAgendaPanelComponent {
  private readonly meetings = inject(MeetingService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  readonly format = inject(FormatService);

  readonly meeting = input.required<MeetingDto>();
  readonly items = input<MeetingAgendaItemDto[]>([]);
  readonly attendees = input<MeetingAttendeeDto[]>([]);
  readonly papers = input<MeetingFileDto[]>([]);
  /** The read's `may.manageAgenda`: add, edit, remove, reorder and attach papers. */
  readonly canManage = input(false);
  /** The agenda as the server returned it after a write. */
  readonly itemsChange = output<MeetingAgendaItemDto[]>();
  /** A paper was added or removed: the page reads the files again. */
  readonly filesChanged = output<void>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly announcement = signal('');
  readonly dialogOpen = signal(false);
  readonly editing = signal<MeetingAgendaItemDto | null>(null);
  readonly editingPosition = signal<number | null>(null);

  /** "60 of 90 min planned": the items' durations against the meeting's, when it has one. */
  readonly planned = computed(() => {
    this.language.isArabic();
    const total = this.meeting().durationMinutes;
    if (!total) return null;
    const sum = this.items().reduce((n, i) => n + (i.durationMinutes ?? 0), 0);
    return this.format.count('meeting.minutesPlanned', total, { planned: this.format.number(sum) });
  });

  papersOf(itemId: string): MeetingFileDto[] {
    return this.papers().filter((f) => f.agendaItemId === itemId);
  }

  /** "Dr. Khalid · Chairman · 10 min": who presents, their seat or kind, and how long. */
  itemMeta(item: MeetingAgendaItemDto): string {
    const parts: string[] = [];
    if (item.presenter) {
      parts.push(item.presenter.name);
      const a = this.attendees().find((x) => x.id === item.presenter!.attendeeId);
      if (a?.kind === 'MEMBER' && a.seat) parts.push(this.language.bilingual(a.seat.labelEn, a.seat.labelAr));
      else if (a && a.kind !== 'MEMBER') parts.push(this.translate.instant(a.kind === 'OUTSIDE_GUEST' ? 'meeting.invitees.outsideGuest' : 'meeting.invitees.guest'));
    }
    if (item.durationMinutes) parts.push(this.format.count('meeting.minutes', item.durationMinutes));
    return parts.join(' · ');
  }

  openItem(item: MeetingAgendaItemDto | null, position: number | null = null): void {
    this.editing.set(item);
    this.editingPosition.set(item ? position : this.items().length + 1);
    this.dialogOpen.set(true);
  }

  onSaved(items: MeetingAgendaItemDto[]): void {
    this.error.set(null);
    this.itemsChange.emit(items);
  }

  dropped(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.reorder(event.previousIndex, event.currentIndex);
  }

  /** The handle's keys: ArrowUp and ArrowDown move the item one place. */
  moveByKey(event: KeyboardEvent, index: number): void {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0 || to >= this.items().length || this.busy()) return;
    this.reorder(index, to);
  }

  private reorder(from: number, to: number): void {
    const ids = this.items().map((i) => i.id);
    moveItemInArray(ids, from, to);
    const moved = this.items()[from]!;
    this.busy.set(true);
    this.error.set(null);
    this.meetings.orderAgenda(this.meeting().id, ids).subscribe({
      next: (items) => {
        this.busy.set(false);
        this.itemsChange.emit(items);
        this.announcement.set(this.translate.instant('meeting.agenda.moved', { title: moved.title, n: this.format.number(to + 1) }));
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(meetingRefusalKey(err) ?? 'meeting.agenda.orderError');
      },
    });
  }
}
