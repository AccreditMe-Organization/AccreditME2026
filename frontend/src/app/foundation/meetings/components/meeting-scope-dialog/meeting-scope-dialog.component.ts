import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { Subscription, catchError, of } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { meetingRefusalKey } from '../../meeting-refusal';
import {
  MeetingService,
  type MeetingClashDto,
  type MeetingDto,
  type MeetingEditScope,
  type MeetingScopePreviewDto,
  type MeetingScopePreviewRequest,
  type MeetingSeriesField,
} from '../../services/meeting.service';
import { MeetingClashComponent } from '../meeting-clash/meeting-clash.component';

/** How many kept lines show before "and n more": one, so the most there can be (kept lines, six clash rows) stays 20px under the 420 cap, measured. */
export const SCOPE_KEPT_SHOWN = 1;

/** The words for a field a later meeting kept as its own, in the order they are said. */
const KEPT_FIELD_ORDER: readonly MeetingSeriesField[] = ['scheduledAt', 'typeValueId', 'durationMinutes', 'location', 'meetingUrl', 'unitQuorum'];

/**
 * ACC-316 PR 8c — "Which meetings change?" (Meeting Screens round 5, artboards
 * 10–11): the scope a series meeting's edit or reschedule applies to, asked
 * after Reschedule's or Edit details' Next. Past meetings never change, and it
 * says so first.
 *
 *   This meeting only            its own line ("22 Oct 2026 moves to 10:30"),
 *                                and Reschedule's per-person clash line for that
 *                                one meeting (R5-4, Q8);
 *   This and all later meetings  the range the server works out ("8 meetings,
 *                                22 Oct 2026 → 27 May 2027"), never guessed here:
 *                                times move off non-working days and the owner's
 *                                own meetings. With its clash line, one row per
 *                                meeting ("2 of the 8 meetings have a clash").
 *   Kept its own edit            a later meeting that changed this on its own
 *                                keeps it; the line says so, as kept, not skipped.
 *
 * It reads (`scopePreview`, and the clash check for this meeting alone when the
 * change moves time) and writes nothing: Apply hands the scope to the dialog
 * that opened it, which writes and closes both. A clash is a warning: Apply
 * stays enabled. A refusal is said from its code.
 */
@Component({
  selector: 'app-meeting-scope-dialog',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, EditDialogComponent, MeetingClashComponent],
  template: `
    <ng-template #bodyTpl>
      <div class="flex flex-col gap-3" data-testid="scope-body">
        <p class="m-0 text-[13px]">{{ 'meeting.scope.lead' | translate }}</p>
        <div class="flex flex-col gap-1" role="radiogroup" [attr.aria-label]="'meeting.scope.title' | translate">
          @for (s of scopes; track s) {
            <label class="am-scope__option" [class.am-scope__option--on]="scope() === s" [attr.data-testid]="'scope-' + s">
              <input type="radio" name="meetingScope" [value]="s" [checked]="scope() === s" (change)="choose(s)" />
              <span class="flex min-w-0 flex-col">
                <span class="text-value font-semibold">{{ (s === 'THIS_ONLY' ? 'meeting.scope.thisOnly' : 'meeting.scope.thisAndLater') | translate }}</span>
                <span class="text-meta text-[var(--am-ink-500)]" [attr.data-testid]="'scope-' + s + '-line'">{{ s === 'THIS_ONLY' ? thisOnlyLine() : laterLine() }}</span>
              </span>
            </label>
          }
        </div>
        @if (previewState() === 'error') {
          <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="scope-preview-error">
            {{ previewError()! | translate }}
            @if (!previewRefused()) {
              <p-button size="small" [text]="true" [label]="'common.retry' | translate" data-testid="scope-preview-retry" (onClick)="loadPreview()" />
            }
          </p>
        }
        @for (k of keptShown(); track k.meetingId) {
          <p class="m-0 text-[13px]" data-testid="scope-kept">{{ keptLine(k) }}</p>
        }
        @if (keptMore() > 0) {
          <p class="m-0 text-meta text-[var(--am-ink-500)]" data-testid="scope-kept-more">{{ format.count('meeting.keptMore', keptMore()) }}</p>
        }
        @if (scope() === 'THIS_ONLY') {
          @if (thisOnlyClash()?.people?.length) {
            <am-meeting-clash
              [clash]="thisOnlyClash()"
              [toggleLabel]="(showRows() ? 'meeting.clash.hide' : 'meeting.clash.showWho') | translate"
              [showRows]="showRows()"
              [capped]="true"
              (toggled)="showRows.set(!showRows())"
            />
          }
        } @else if (preview()?.clashes?.length) {
          <am-meeting-clash
            [perMeeting]="preview()!.clashes"
            [meetingTotal]="preview()!.meetings.length"
            [toggleLabel]="(showRows() ? 'meeting.clash.hide' : 'meeting.clash.showWhich') | translate"
            [showRows]="showRows()"
            [capped]="true"
            (toggled)="showRows.set(!showRows())"
          />
        }
      </div>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex flex-wrap items-center justify-end gap-3">
        @if (error()) {
          <p class="m-0 me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="scope-error">{{ error()! | translate }}</p>
        }
        <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
        <p-button type="button" data-testid="scope-apply" [label]="'meeting.scope.apply' | translate" [loading]="saving() || waiting()" (onClick)="apply()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.scope.title' | translate"
      [context]="context()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [saving]="saving()"
      size="confirm"
    />
  `,
  styles: [
    `
      .am-scope__option {
        display: flex;
        align-items: flex-start;
        gap: var(--am-space-8);
        padding: var(--am-space-4) var(--am-space-8);
        border-radius: var(--am-radius-control);
        cursor: pointer;
      }
      .am-scope__option input {
        margin-block-start: 3px;
        flex: none;
      }
      .am-scope__option--on {
        background: var(--am-surface);
      }
    `,
  ],
})
export class MeetingScopeDialogComponent {
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  readonly meeting = input<MeetingDto | null>(null);
  /** What the change would be: a reschedule's new time, or an edit's changed fields. */
  readonly change = input<MeetingScopePreviewRequest | null>(null);
  /** The opener's write is in flight. */
  readonly saving = input(false);
  /** The opener's write's refusal, as a translation key. */
  readonly error = input<string | null>(null);
  readonly visibleChange = output<boolean>();
  readonly applied = output<MeetingEditScope>();

  readonly scopes: readonly MeetingEditScope[] = ['THIS_ONLY', 'THIS_AND_LATER'];
  readonly scope = signal<MeetingEditScope>('THIS_ONLY');
  readonly showRows = signal(false);
  readonly preview = signal<MeetingScopePreviewDto | null>(null);
  readonly previewState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly previewError = signal<string | null>(null);
  /** The preview was refused (a code), not lost: Retry would ask the same. */
  readonly previewRefused = signal(false);
  readonly thisOnlyClash = signal<MeetingClashDto | null>(null);
  /** Apply was pressed for "this and all later" before the range was known: it applies when it is. */
  readonly waiting = signal(false);
  private reads = new Subscription();

  /** The new start of a reschedule; null for an edit. */
  private readonly newStart = computed(() => {
    const c = this.change();
    return c?.change === 'RESCHEDULE' ? new Date(c.scheduledAt) : null;
  });

  /** "IPC · October 2026 · 5 of 12 · new time 10:30". */
  readonly context = computed(() => {
    this.translate.currentLang();
    const m = this.meeting();
    if (!m) return '';
    const parts = [m.title];
    if (m.series) parts.push(this.translate.instant('meeting.scope.position', { index: this.format.number(m.series.index), total: this.format.number(m.series.total) }));
    const to = this.newStart();
    if (to) parts.push(this.translate.instant('meeting.scope.newTime', { when: this.movedTo(new Date(m.scheduledAt), to) }));
    return parts.join(' · ');
  });

  /** "22 Oct 2026 moves to 10:30" (a reschedule), "22 Oct 2026 only" (an edit). */
  readonly thisOnlyLine = computed(() => {
    this.translate.currentLang();
    const m = this.meeting();
    if (!m) return '';
    const from = new Date(m.scheduledAt);
    const to = this.newStart();
    return to
      ? this.translate.instant('meeting.scope.thisOnlyMoves', { date: this.format.date(from), to: this.movedTo(from, to) })
      : this.translate.instant('meeting.scope.thisOnlyEdit', { date: this.format.date(from) });
  });

  /** "8 meetings, 22 Oct 2026 → 27 May 2027", from the server's own placement; a working line until it answers. */
  readonly laterLine = computed(() => {
    this.translate.currentLang();
    const p = this.preview();
    if (this.previewState() === 'loading' || !p) return this.translate.instant(this.previewState() === 'error' ? 'meeting.scope.laterUnknown' : 'meeting.scope.working');
    const list = p.meetings;
    if (list.length === 0) return this.translate.instant('meeting.scope.laterNone');
    const first = this.format.date(list[0]!.startsAt);
    const last = this.format.date(list[list.length - 1]!.startsAt);
    return this.format.count('meeting.scopeMeetings', list.length, { range: first === last ? first : `${first} → ${last}` });
  });

  readonly keptShown = computed(() => (this.preview()?.kept ?? []).slice(0, SCOPE_KEPT_SHOWN));
  readonly keptMore = computed(() => Math.max(0, (this.preview()?.kept.length ?? 0) - SCOPE_KEPT_SHOWN));

  constructor() {
    // Every OPENING asks afresh, from "This meeting only", the rows folded.
    effect(() => {
      if (!this.visible()) {
        untracked(() => this.reads.unsubscribe());
        return;
      }
      untracked(() => {
        this.scope.set('THIS_ONLY');
        this.showRows.set(false);
        this.waiting.set(false);
        this.thisOnlyClash.set(null);
        this.reads.unsubscribe();
        this.reads = new Subscription();
        this.loadPreview();
        this.loadThisOnlyClash();
      });
    });
  }

  choose(scope: MeetingEditScope): void {
    this.scope.set(scope);
    this.showRows.set(false);
  }

  loadPreview(): void {
    const m = this.meeting();
    const change = this.change();
    if (!m || !change) return;
    this.previewState.set('loading');
    this.previewError.set(null);
    this.previewRefused.set(false);
    this.preview.set(null);
    this.reads.add(
      this.meetings.scopePreview(m.id, change).subscribe({
        next: (p) => {
          this.preview.set(p);
          this.previewState.set('ready');
          if (this.waiting()) {
            this.waiting.set(false);
            this.applied.emit('THIS_AND_LATER');
          }
        },
        error: (err: unknown) => {
          const key = meetingRefusalKey(err);
          this.previewRefused.set(!!key);
          this.previewError.set(key ?? 'meeting.scope.previewError');
          this.previewState.set('error');
          this.waiting.set(false);
        },
      }),
    );
  }

  /** The per-person line for this meeting alone, when the change moves its time (a new start or a new duration). */
  private loadThisOnlyClash(): void {
    const m = this.meeting();
    const change = this.change();
    if (!m || !change) return;
    const startsAt = change.change === 'RESCHEDULE' ? change.scheduledAt : m.scheduledAt;
    const minutes = change.durationMinutes ?? m.durationMinutes ?? 60;
    if (change.change === 'EDIT' && change.durationMinutes === undefined) return;
    this.reads.add(
      this.meetings
        .clashes({ meetingId: m.id, times: [{ startsAt: new Date(startsAt).toISOString(), durationMinutes: minutes }] })
        // A failed check says nothing: the line is a warning, never a gate.
        .pipe(catchError(() => of([] as MeetingClashDto[])))
        .subscribe((r) => this.thisOnlyClash.set(r[0] ?? null)),
    );
  }

  apply(): void {
    if (this.saving() || this.waiting()) return;
    const scope = this.scope();
    if (scope === 'THIS_AND_LATER') {
      // "This and later" is never a guess: it applies once its range is on screen.
      if (this.previewState() === 'loading') {
        this.waiting.set(true);
        return;
      }
      if (this.previewState() === 'error' && !this.previewRefused()) {
        this.waiting.set(true);
        this.loadPreview();
        return;
      }
    }
    this.applied.emit(scope);
  }

  /** "Kept its own edit: 26 Nov 2026 (its own time, 10:00)". */
  keptLine(k: MeetingScopePreviewDto['kept'][number]): string {
    const what = KEPT_FIELD_ORDER.filter((f) => k.fields.includes(f)).map((f) =>
      f === 'scheduledAt' ? this.translate.instant('meeting.scope.keptField.scheduledAt', { time: this.format.timeOfDay(k.startsAt) }) : this.translate.instant(`meeting.scope.keptField.${f}`),
    );
    return this.translate.instant('meeting.scope.kept', { date: this.format.date(k.startsAt), what: what.join(this.translate.instant('meeting.scope.keptJoin')) });
  }

  /** The new time alone on the same day ("10:30"), else the date and time. */
  private movedTo(from: Date, to: Date): string {
    return this.format.date(from) === this.format.date(to) ? this.format.timeOfDay(to) : this.format.dateTime(to);
  }
}
