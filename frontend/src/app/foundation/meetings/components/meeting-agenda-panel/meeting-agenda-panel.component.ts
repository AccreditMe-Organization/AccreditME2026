import { Component, ElementRef, afterEveryRender, computed, inject, input, output, signal } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import {
  MeetingService,
  type MeetingAgendaItemDto,
  type MeetingAttendeeDto,
  type MeetingDto,
  type MeetingFileDto,
  type MeetingMinutesDto,
  type MeetingMinutesItemDto,
  type MeetingOpenActionsDto,
} from '../../services/meeting.service';
import { meetingNeedsReload, meetingRefusalKey } from '../../meeting-refusal';
import { MeetingAgendaItemDialogComponent } from '../meeting-agenda-item-dialog/meeting-agenda-item-dialog.component';
import { MeetingFileListComponent } from '../meeting-file-list/meeting-file-list.component';
import { MeetingOpenActionsComponent } from '../meeting-open-actions/meeting-open-actions.component';
import { MeetingItemMinutesComponent } from '../meeting-item-minutes/meeting-item-minutes.component';

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
  imports: [TranslatePipe, ButtonModule, CdkDropList, CdkDrag, CdkDragHandle, MeetingAgendaItemDialogComponent, MeetingFileListComponent, MeetingOpenActionsComponent, MeetingItemMinutesComponent],
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
      <!-- PR 7b — the fixed first section: never an agenda item, never moved, edited or removed. -->
      <am-meeting-open-actions
        [meetingId]="meeting().id"
        [openActions]="openActions()"
        [canNote]="minutes()?.may?.recordMinutes ?? false"
        (minutesChange)="minutesChange.emit($event)"
      />
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
                [attr.aria-disabled]="busy() || null"
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
              @if (minutesOf(item.id); as im) {
                <am-meeting-item-minutes
                  [meetingId]="meeting().id"
                  [item]="im"
                  [canWrite]="minutes()!.may.recordMinutes"
                  (minutesChange)="minutesChange.emit($event)"
                  (raiseAction)="raiseAction.emit({ id: im.id, order: im.order, title: im.title })"
                />
              }
            </div>
            @if (canManage()) {
              <p-button size="small" [text]="true" [label]="'meeting.agenda.edit' | translate" [ariaLabel]="'meeting.agenda.editNamed' | translate: { title: item.title }" [attr.data-testid]="'meeting-agenda-edit-' + item.id" (onClick)="openItem(item, i + 1)" />
            }
          </li>
        }
      </ol>
      @if (error()) {
        <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="meeting-agenda-error">
          {{ error()! | translate }}
          @if (needsReload()) {
            <p-button size="small" [text]="true" [label]="'meeting.agenda.reload' | translate" data-testid="meeting-agenda-reload" (onClick)="reload.emit()" />
          }
        </p>
      } @else if (readError()) {
        <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="meeting-agenda-read-error">
          {{ readError()! | translate }}
          <p-button size="small" [text]="true" [label]="'common.retry' | translate" data-testid="meeting-agenda-read-retry" (onClick)="retryRead.emit()" />
        </p>
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
      (reload)="reload.emit()"
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The item whose handle had focus when it was moved by key: focused again once its row is redrawn in its new place. */
  private refocus: { id: string; at: number } | null = null;
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
  /** PR 7b — the minutes, where the viewer may read them; each item's discussion, decisions and actions show under it. */
  readonly minutes = input<MeetingMinutesDto | null>(null);
  /** PR 7b — "Open actions from the last meeting", the fixed first section. */
  readonly openActions = input<MeetingOpenActionsDto | null>(null);
  /** The minutes as the server holds them after a minutes write. */
  readonly minutesChange = output<MeetingMinutesDto>();
  /** "Raise action item" on an item: the page opens the dialog. */
  readonly raiseAction = output<{ id: string; order: number; title: string }>();

  /** A read the page made after a write failed (the files or the invitees): said here, with Retry. */
  readonly readError = input<string | null>(null);
  readonly retryRead = output<void>();
  /** The agenda on screen is stale: the page reads the meeting again. */
  readonly reload = output<void>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** The refusal says the agenda on screen is stale: Reload, never Retry (P198). */
  readonly needsReload = signal(false);
  readonly announcement = signal('');
  readonly dialogOpen = signal(false);
  readonly editing = signal<MeetingAgendaItemDto | null>(null);
  readonly editingPosition = signal<number | null>(null);

  constructor() {
    afterEveryRender(() => {
      const r = this.refocus;
      if (!r || this.items()[r.at]?.id !== r.id) return;
      this.refocus = null;
      const handle = this.handleOf(r.id);
      if (handle && document.activeElement !== handle) handle.focus();
    });
  }

  /** "60 of 90 min planned": the items' durations against the meeting's, when it has one. */
  readonly planned = computed(() => {
    this.language.isArabic();
    const total = this.meeting().durationMinutes;
    if (!total) return null;
    const sum = this.items().reduce((n, i) => n + (i.durationMinutes ?? 0), 0);
    return this.format.count('meeting.minutesPlanned', total, { planned: this.format.number(sum) });
  });

  minutesOf(itemId: string): MeetingMinutesItemDto | null {
    return this.minutes()?.items.find((i) => i.id === itemId) ?? null;
  }

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
    this.needsReload.set(false);
    this.itemsChange.emit(items);
  }

  dropped(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.reorder(event.previousIndex, event.currentIndex);
  }

  /**
   * The handle's keys: ArrowUp and ArrowDown move the item one place. While a
   * move is saving the handle is aria-disabled, never disabled, so it keeps
   * focus; its keys are ignored until the move is done.
   */
  moveByKey(event: KeyboardEvent, index: number): void {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0 || to >= this.items().length || this.busy()) return;
    this.reorder(index, to);
  }

  private reorder(from: number, to: number): void {
    // The order the person saw goes with the new one: the server refuses if the
    // agenda changed since (MEETING_AGENDA_CHANGED), so nothing is lost silently.
    const seen = this.items().map((i) => i.id);
    const ids = [...seen];
    moveItemInArray(ids, from, to);
    const moved = this.items()[from]!;
    const hadFocus = this.handleOf(moved.id) === document.activeElement;
    this.busy.set(true);
    this.error.set(null);
    this.needsReload.set(false);
    this.meetings.orderAgenda(this.meeting().id, ids, seen).subscribe({
      next: (items) => {
        this.busy.set(false);
        this.itemsChange.emit(items);
        this.announcement.set(this.translate.instant('meeting.agenda.moved', { title: moved.title, n: this.format.number(to + 1) }));
        // Moving a row in the DOM drops focus from it: put it back once the row is in its new place.
        if (hadFocus) this.refocus = { id: moved.id, at: to };
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.needsReload.set(meetingNeedsReload(err));
        this.error.set(meetingRefusalKey(err) ?? 'meeting.agenda.orderError');
      },
    });
  }

  private handleOf(itemId: string): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`[data-agenda-item="${itemId}"] [data-testid="meeting-agenda-handle"]`);
  }
}
