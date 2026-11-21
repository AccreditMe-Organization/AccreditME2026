import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Observable, Subscription, catchError, of } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { SimpleListComponent, type SimpleListPage, type SimpleListQuery } from '../../../../shared/components/simple-list/simple-list.component';
import { MEETING_STAGE_FLAG, MeetingService, type MeetingClashDto, type MeetingDto, type MeetingGuestCandidatesDto } from '../../services/meeting.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingClashComponent } from '../meeting-clash/meeting-clash.component';

type Candidate = MeetingGuestCandidatesDto['items'][number];
type GuestKind = 'person' | 'outside';

/**
 * ACC-316 PR 6 — Add a guest (Meeting Screens round 5, section 5): a person in
 * the organisation, picked from the server's candidates (people not already
 * invited; never an email), or an outside guest with a name and an email. Once
 * the agenda is issued (the stage's AGENDA_ISSUED flag) the server invites the
 * guest at once, and the button and the sentence say so. There is no "Presents
 * item" field: PR 7 sets a presenter from the agenda item's own Presenter field.
 *
 * PR 8c (R5-5, Q9) — once a person is chosen, the same clash line for them at
 * the meeting's time ("Dr. Huda Zahrani has another meeting then · Show
 * which"). A warning only: Add stays enabled. An outside guest is never checked.
 */
@Component({
  selector: 'app-meeting-add-guest-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, EditDialogComponent, FieldComponent, ListDialogComponent, SimpleListComponent, MeetingClashComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
        <fieldset class="m-0 border-0 p-0 flex flex-col gap-1">
          <legend class="text-meta font-medium mb-1">{{ 'meeting.guest.kind.label' | translate }}</legend>
          <div class="flex flex-wrap gap-3" role="radiogroup">
            @for (k of kinds; track k) {
              <label class="flex items-center gap-1.5 text-[13px]">
                <input type="radio" name="guestKind" [value]="k" [checked]="kind() === k" (change)="setKind(k)" [attr.data-testid]="'guest-kind-' + k" />
                {{ ('meeting.guest.kind.' + k) | translate }}
              </label>
            }
          </div>
        </fieldset>
        @if (kind() === 'person') {
          <am-field [label]="'meeting.guest.person' | translate" [control]="form.controls.userId" [hint]="'meeting.guest.personHint' | translate" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.guest.personRequired' }">
            <div class="flex items-center gap-2">
              <input #personInput pInputText readonly class="flex-1 min-w-0" [value]="picked()?.name ?? ''" [placeholder]="'meeting.guest.personPlaceholder' | translate" data-testid="guest-person" />
              <p-button type="button" severity="secondary" icon="pi pi-search" [ariaLabel]="'meeting.guest.search' | translate" (onClick)="pickerOpen.set(true)" />
            </div>
          </am-field>
          @if (clash()?.people?.length) {
            <am-meeting-clash
              [clash]="clash()"
              [person]="true"
              [toggleLabel]="(showWhich() ? 'meeting.clash.hide' : 'meeting.clash.showWhich') | translate"
              [showRows]="showWhich()"
              [capped]="true"
              (toggled)="showWhich.set(!showWhich())"
            />
          }
        } @else {
          <p class="m-0 text-meta text-[var(--am-ink-500)]">{{ 'meeting.guest.outsideHelp' | translate }}</p>
          <div class="grid gap-3" style="grid-template-columns: repeat(2, minmax(0, 1fr))">
            <am-field [label]="'meeting.guest.name' | translate" [control]="form.controls.outsideName" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.guest.nameRequired' }">
              <input #nameInput pInputText formControlName="outsideName" maxlength="200" data-testid="guest-name" />
            </am-field>
            <am-field [label]="'meeting.guest.email' | translate" [control]="form.controls.outsideEmail" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.guest.emailRequired', email: 'storage.request.contactEmailInvalid' }">
              <input pInputText dir="ltr" type="email" formControlName="outsideEmail" maxlength="320" data-testid="guest-email" />
            </am-field>
            <am-field [label]="'meeting.guest.organisation' | translate" [control]="form.controls.outsideOrganisation">
              <input pInputText formControlName="outsideOrganisation" maxlength="200" />
            </am-field>
            <am-field [label]="'meeting.guest.role' | translate" [control]="form.controls.outsideRole">
              <input pInputText formControlName="outsideRole" maxlength="200" />
            </am-field>
          </div>
          <p class="m-0 text-meta text-[var(--am-ink-500)]" data-testid="guest-outside-when">{{ (issued() ? 'meeting.guest.emailNow' : 'meeting.guest.emailAtIssue') | translate }}</p>
        }
        @if (error()) {
          <p class="text-meta text-[var(--am-danger-ink)] m-0" role="alert" data-testid="guest-error">{{ error()! | translate }}</p>
        }
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
        <p-button type="button" data-testid="guest-submit" [label]="(issued() ? 'meeting.guest.addAndSend' : 'meeting.guest.add') | translate" [loading]="saving()" (onClick)="submit()" />
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
    <am-list-dialog size="compact" [visible]="pickerOpen()" [heading]="'meeting.guest.pickerTitle' | translate" [closeLabel]="'common.close' | translate" [body]="pickerBody" (closeRequested)="pickerOpen.set(false)" />
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.guest.title' | translate"
      [context]="meeting()?.title ?? ''"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
      density="compact"
    />
  `,
})
export class MeetingAddGuestDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  readonly meeting = input<MeetingDto | null>(null);
  readonly visibleChange = output<boolean>();
  readonly added = output<void>();

  readonly kinds: GuestKind[] = ['person', 'outside'];
  readonly kind = signal<GuestKind>('person');
  readonly picked = signal<Candidate | null>(null);
  readonly pickerOpen = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  /** PR 8c — the chosen person's clash at the meeting's time (null until one is chosen, or when they're free). */
  readonly clash = signal<MeetingClashDto | null>(null);
  readonly showWhich = signal(false);
  private clashRead = new Subscription();
  /** Issued: the server invites the guest at once (the stage's AGENDA_ISSUED flag). */
  readonly issued = computed(() => this.meeting()?.stage.flags.includes(MEETING_STAGE_FLAG.AGENDA_ISSUED) ?? false);
  private readonly personInput = viewChild<ElementRef<HTMLInputElement>>('personInput');
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  readonly form = this.fb.group({
    userId: ['', Validators.required],
    outsideName: [''],
    outsideEmail: [''],
    outsideOrganisation: [''],
    outsideRole: [''],
  });

  readonly pickerColumns = computed(() => {
    this.translate.currentLang();
    return [{ label: this.translate.instant('meeting.guest.col.person'), sort: 'name' }, { label: this.translate.instant('meeting.guest.col.place') }];
  });

  readonly countText = (n: number): string => this.format.count('meeting.people', n);

  constructor() {
    effect(() => {
      if (this.visible()) {
        // Untracked: setKind() reads the chosen person, and a pick must never re-run this reset.
        untracked(() => {
          this.picked.set(null);
          this.clearClash();
          this.setKind('person');
          this.form.reset({ userId: '', outsideName: '', outsideEmail: '', outsideOrganisation: '', outsideRole: '' });
          this.error.set(null);
          this.showErrors.set(false);
        });
      }
    });
  }

  private clearClash(): void {
    this.clashRead.unsubscribe();
    this.clash.set(null);
    this.showWhich.set(false);
  }

  /** The chosen person's clash at the meeting's time; the latest choice wins, and a failed check says nothing. */
  private checkClash(userId: string): void {
    const m = this.meeting();
    this.clearClash();
    if (!m) return;
    this.clashRead = this.meetings
      .clashes({ meetingId: m.id, userIds: [userId], times: [{ startsAt: m.scheduledAt, durationMinutes: m.durationMinutes ?? 60 }] })
      .pipe(catchError(() => of([] as MeetingClashDto[])))
      .subscribe((r) => this.clash.set(r[0] ?? null));
  }

  /** The required fields follow the kind: a person, or a name and an email. */
  setKind(kind: GuestKind): void {
    this.kind.set(kind);
    // An outside guest is never checked; back on a person, their line returns.
    if (kind === 'outside') this.clearClash();
    else if (this.picked()) this.checkClash(this.picked()!.id);
    const c = this.form.controls;
    c.userId.setValidators(kind === 'person' ? Validators.required : null);
    c.outsideName.setValidators(kind === 'outside' ? Validators.required : null);
    c.outsideEmail.setValidators(kind === 'outside' ? [Validators.required, Validators.email] : null);
    for (const control of [c.userId, c.outsideName, c.outsideEmail]) control.updateValueAndValidity();
  }

  readonly loadCandidates = (query: SimpleListQuery): Observable<SimpleListPage<Candidate>> => {
    const id = this.meeting()!.id;
    return this.meetings.guestCandidates(id, { q: query.q, skip: query.skip, take: Math.min(query.take, 50) });
  };

  placeOf(c: Candidate): string {
    return [c.position, c.unit].filter((x) => !!x).map((x) => this.language.bilingual(x!.nameEn, x!.nameAr)).join(' · ');
  }

  onPicked(c: Candidate): void {
    this.picked.set(c);
    this.form.controls.userId.setValue(c.id);
    this.form.markAsDirty();
    this.pickerOpen.set(false);
    this.checkClash(c.id);
  }

  submit(): void {
    const m = this.meeting();
    if (!m || this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      (this.kind() === 'person' ? this.personInput() : this.nameInput())?.nativeElement.focus();
      return;
    }
    const v = this.form.getRawValue();
    const body =
      this.kind() === 'person'
        ? { userId: v.userId! }
        : { outsideName: v.outsideName!.trim(), outsideEmail: v.outsideEmail!.trim(), outsideOrganisation: v.outsideOrganisation?.trim() || null, outsideRole: v.outsideRole?.trim() || null };
    this.saving.set(true);
    this.error.set(null);
    this.meetings.addGuest(m.id, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.added.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(meetingRefusalKey(err) ?? 'meeting.guest.error');
      },
    });
  }
}
