import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { Observable } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { SimpleListComponent, type SimpleListPage, type SimpleListQuery } from '../../../../shared/components/simple-list/simple-list.component';
import {
  MeetingService,
  type AgendaItemRequest,
  type MeetingAgendaItemDto,
  type MeetingAttendeeDto,
  type MeetingDto,
  type MeetingGuestCandidatesDto,
} from '../../services/meeting.service';
import { meetingNeedsReload, meetingRefusalKey } from '../../meeting-refusal';

/** The durations an item may take, in minutes (the design's "10 min"). */
export const AGENDA_DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;

type Candidate = MeetingGuestCandidatesDto['items'][number];
/** The presenter as chosen: none, an invitee, or a person of the organisation not yet invited. */
type Presenter = { kind: 'none' } | { kind: 'attendee'; id: string } | { kind: 'person'; id: string; name: string };

/**
 * ACC-316 PR 7 — Agenda item, added or edited (Meeting Screens round 5,
 * "Add or edit agenda item", 560 standard): Title, Description, then Presenter
 * and Duration on one row. The presenter is an invitee, or a person of the
 * organisation found by name: one not yet invited is added as a guest by the
 * server (meeting-agenda.service.ts), and the dialog says so. Papers are
 * attached on the item in the page, in flow, never here (a drop zone would pass
 * the 420 cap). Removing an item asks first. Refusals are said from their codes.
 */
@Component({
  selector: 'app-meeting-agenda-item-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, TextareaModule, EditDialogComponent, FieldComponent, OverlaySelectComponent, ListDialogComponent, SimpleListComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
        <am-field [label]="'meeting.agendaItem.title' | translate" [control]="form.controls.title" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.agendaItem.titleRequired' }">
          <input #titleInput pInputText formControlName="title" maxlength="300" data-testid="agenda-item-title" />
        </am-field>
        <am-field [label]="'meeting.agendaItem.description' | translate" [control]="form.controls.description" message="none">
          <textarea pTextarea id="agendaItemDescription" formControlName="description" rows="3" maxlength="4000" data-testid="agenda-item-description"></textarea>
        </am-field>
        <div class="grid gap-3" style="grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr)">
          <am-field [label]="'meeting.agendaItem.presenter' | translate" [control]="form.controls.presenter" [hint]="presenterHint() | translate">
            <div class="flex items-center gap-2">
              <app-overlay-select class="flex-1 min-w-0" [options]="presenterOptions()" optionLabel="label" optionValue="value" formControlName="presenter" [ariaLabel]="'meeting.agendaItem.presenter' | translate" />
              @if (meeting().may.manageGuests) {
                <p-button type="button" severity="secondary" icon="pi pi-search" [ariaLabel]="'meeting.agendaItem.findPerson' | translate" data-testid="agenda-item-find-person" (onClick)="pickerOpen.set(true)" />
              }
            </div>
          </am-field>
          <am-field [label]="'meeting.agendaItem.duration' | translate" [control]="form.controls.durationMinutes" message="none">
            <app-overlay-select [options]="durationOptions()" optionLabel="label" optionValue="value" formControlName="durationMinutes" [ariaLabel]="'meeting.agendaItem.duration' | translate" />
          </am-field>
        </div>
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex items-center justify-end gap-3">
        @if (error()) {
          <p class="m-0 me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="agenda-item-error">{{ error()! | translate }}</p>
        } @else if (item()) {
          <p-button class="me-auto" type="button" severity="danger" [text]="true" [label]="'meeting.agendaItem.remove' | translate" [disabled]="saving()" data-testid="agenda-item-remove" (onClick)="askRemove()" />
        }
        <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
        @if (needsReload()) {
          <p-button type="button" data-testid="agenda-item-reload" [label]="'meeting.agenda.reload' | translate" (onClick)="reloadMeeting()" />
        } @else {
          <p-button type="button" data-testid="agenda-item-save" [label]="'meeting.agendaItem.save' | translate" [loading]="saving()" (onClick)="submit()" />
        }
      </div>
    </ng-template>
    <ng-template #pickerBody>
      <am-simple-list
        [load]="loadCandidates"
        [columns]="pickerColumns()"
        grid="minmax(0,1.5fr) minmax(0,1fr)"
        [row]="candidateCells"
        defaultSort="name:asc"
        [searchLabel]="'meeting.guest.search' | translate"
        [searchPlaceholder]="'meeting.guest.searchPlaceholder' | translate"
        [emptyText]="'meeting.guest.noPeople' | translate"
        [noMatchText]="'meeting.guest.noMatch' | translate"
        [countText]="countText"
        [selectable]="true"
        (picked)="onPicked($event)"
      />
    </ng-template>
    <ng-template #candidateCells let-c>
      <span class="truncate font-medium">{{ c.name }}</span>
      <span class="truncate text-[12px] text-[var(--am-ink-700)]">{{ placeOf(c) }}</span>
    </ng-template>
    <am-list-dialog size="compact" [visible]="pickerOpen()" [heading]="'meeting.agendaItem.pickerTitle' | translate" [closeLabel]="'common.close' | translate" [body]="pickerBody" (closeRequested)="pickerOpen.set(false)" />
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="(item() ? 'meeting.agendaItem.editTitle' : 'meeting.agendaItem.addTitle') | translate"
      [context]="context()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
})
export class MeetingAgendaItemDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);
  private readonly confirm = inject(AmConfirmService);

  readonly visible = input.required<boolean>();
  readonly meeting = input.required<MeetingDto>();
  /** The item edited, or null to add one. */
  readonly item = input<MeetingAgendaItemDto | null>(null);
  /** Its place in the agenda, for the context line ("item 4"). */
  readonly position = input<number | null>(null);
  readonly attendees = input<MeetingAttendeeDto[]>([]);
  readonly visibleChange = output<boolean>();
  /** The agenda as the server returns it after a save or a removal. */
  readonly saved = output<MeetingAgendaItemDto[]>();
  /** The agenda changed under the person: the page reads the meeting again. */
  readonly reload = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  /** The refusal says the agenda on screen is stale: Reload, never Retry (P198). */
  readonly needsReload = signal(false);
  readonly showErrors = signal(false);
  readonly pickerOpen = signal(false);
  /** A person found by name, not yet invited: offered as a presenter beside the invitees. */
  readonly found = signal<Candidate | null>(null);
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(300), (c: { value: unknown }) => (typeof c.value === 'string' && !c.value.trim() ? { required: true } : null)]],
    description: [''],
    presenter: ['none'],
    durationMinutes: [null as number | null],
  });

  readonly context = computed(() => {
    const title = this.meeting().title;
    const n = this.position();
    return n ? this.translate.instant('meeting.agendaItem.context', { meeting: title, n: this.format.number(n) }) : title;
  });

  readonly presenterOptions = computed(() => {
    this.language.isArabic();
    const none = { label: this.translate.instant('meeting.agendaItem.noPresenter'), value: 'none' };
    const invitees = this.attendees().map((a) => ({ label: `${a.name} · ${this.attendeeRole(a)}`, value: `attendee:${a.id}` }));
    const f = this.found();
    const person = f ? [{ label: `${f.name} · ${this.translate.instant('meeting.agendaItem.notInvited')}`, value: `person:${f.id}` }] : [];
    return [none, ...invitees, ...person];
  });

  readonly durationOptions = computed(() => {
    this.language.isArabic();
    return [
      { label: this.translate.instant('meeting.agendaItem.noDuration'), value: null },
      ...AGENDA_DURATIONS.map((m) => ({ label: this.format.count('meeting.minutes', m), value: m })),
    ];
  });

  /** A person not yet invited becomes a guest when the item is saved: said under the field. */
  readonly presenterValue = signal('none');
  readonly presenterHint = computed(() => (this.presenterValue().startsWith('person:') ? 'meeting.agendaItem.addedAsGuest' : ''));

  readonly pickerColumns = computed(() => {
    this.translate.currentLang();
    return [{ label: this.translate.instant('meeting.guest.col.person'), sort: 'name' }, { label: this.translate.instant('meeting.guest.col.place') }];
  });

  readonly countText = (n: number): string => this.format.count('meeting.people', n);

  constructor() {
    this.form.controls.presenter.valueChanges.subscribe((v) => this.presenterValue.set(v ?? 'none'));
    // Every opening starts from the item as it stands (or empty), and only an opening.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        const item = this.item();
        this.found.set(null);
        this.form.reset({
          title: item?.title ?? '',
          description: item?.description ?? '',
          presenter: item?.presenter ? `attendee:${item.presenter.attendeeId}` : 'none',
          durationMinutes: item?.durationMinutes ?? null,
        });
        this.presenterValue.set(this.form.controls.presenter.value ?? 'none');
        this.error.set(null);
        this.needsReload.set(false);
        this.showErrors.set(false);
      });
    });
  }

  attendeeRole(a: MeetingAttendeeDto): string {
    if (a.kind === 'MEMBER') return a.seat ? this.language.bilingual(a.seat.labelEn, a.seat.labelAr) : this.translate.instant('meeting.agendaItem.member');
    return this.translate.instant(a.kind === 'OUTSIDE_GUEST' ? 'meeting.invitees.outsideGuest' : 'meeting.invitees.guest');
  }

  readonly loadCandidates = (query: SimpleListQuery): Observable<SimpleListPage<Candidate>> =>
    this.meetings.guestCandidates(this.meeting().id, { q: query.q, skip: query.skip, take: Math.min(query.take, 50) });

  placeOf(c: Candidate): string {
    return [c.position, c.unit].filter((x) => !!x).map((x) => this.language.bilingual(x!.nameEn, x!.nameAr)).join(' · ');
  }

  onPicked(c: Candidate): void {
    this.found.set(c);
    this.form.controls.presenter.setValue(`person:${c.id}`);
    this.form.markAsDirty();
    this.pickerOpen.set(false);
  }

  private presenterBody(): AgendaItemRequest['presenter'] {
    const v = this.form.getRawValue().presenter ?? 'none';
    if (v.startsWith('attendee:')) return { attendeeId: v.slice('attendee:'.length) };
    if (v.startsWith('person:')) return { userId: v.slice('person:'.length) };
    return null;
  }

  submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.titleInput()?.nativeElement.focus();
      return;
    }
    const v = this.form.getRawValue();
    const body: AgendaItemRequest = {
      title: v.title!.trim(),
      description: v.description?.trim() || null,
      durationMinutes: v.durationMinutes ?? null,
      presenter: this.presenterBody(),
    };
    const item = this.item();
    if (!item) {
      this.run(this.meetings.addAgendaItem(this.meeting().id, body));
      return;
    }
    // An edit sends only what this person changed, so it never writes back
    // someone else's newer value for a field they did not touch (P198).
    const changes: Partial<AgendaItemRequest> = {};
    if (body.title !== item.title) changes.title = body.title;
    if (body.description !== (item.description ?? null)) changes.description = body.description;
    if (body.durationMinutes !== (item.durationMinutes ?? null)) changes.durationMinutes = body.durationMinutes;
    if ((v.presenter ?? 'none') !== (item.presenter ? `attendee:${item.presenter.attendeeId}` : 'none')) changes.presenter = body.presenter;
    if (Object.keys(changes).length === 0) {
      this.form.markAsPristine();
      this.visibleChange.emit(false);
      return;
    }
    this.run(this.meetings.updateAgendaItem(this.meeting().id, item.id, changes));
  }

  /** Close, and let the page read the meeting again. */
  reloadMeeting(): void {
    this.form.markAsPristine();
    this.visibleChange.emit(false);
    this.reload.emit();
  }

  askRemove(): void {
    const item = this.item();
    if (!item) return;
    this.confirm.ask({
      tone: 'destructive',
      header: this.translate.instant('meeting.agendaItem.removeTitle'),
      message: this.translate.instant('meeting.agendaItem.removeLead', { title: item.title }),
      acceptLabel: this.translate.instant('meeting.agendaItem.remove'),
      accept: () => this.run(this.meetings.removeAgendaItem(this.meeting().id, item.id)),
    });
  }

  private run(request: Observable<MeetingAgendaItemDto[]>): void {
    this.saving.set(true);
    this.error.set(null);
    request.subscribe({
      next: (agenda) => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.saved.emit(agenda);
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.needsReload.set(meetingNeedsReload(err));
        this.error.set(meetingRefusalKey(err) ?? 'meeting.agendaItem.error');
      },
    });
  }
}
