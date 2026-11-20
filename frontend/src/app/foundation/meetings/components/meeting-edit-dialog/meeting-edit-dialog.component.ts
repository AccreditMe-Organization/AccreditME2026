import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MEETING_DURATIONS } from '../../meeting-durations';
import { MeetingService, type MeetingDto, type MeetingEditScope, type MeetingScopePreviewRequest, type UpdateMeetingRequest } from '../../services/meeting.service';
import { MeetingScopeDialogComponent } from '../meeting-scope-dialog/meeting-scope-dialog.component';

/** A place or a link (Schedule's rule, MEETING_PLACE_REQUIRED on the server). */
const placeRequired = (group: AbstractControl): ValidationErrors | null => {
  const v = group.value as { location?: string; meetingUrl?: string };
  return v.location?.trim() || v.meetingUrl?.trim() ? null : { place: true };
};

/** The fields Edit details sends, as the server names them. */
type EditField = keyof Omit<UpdateMeetingRequest, 'expectedUpdatedAt' | 'scope'>;

/**
 * ACC-316 PR 8c (Q3) — Edit details: Schedule's step 1 fields without Starts
 * (type, duration, place, link, and a unit meeting's quorum), offered on the
 * server's `may.edit`. The subject stays as it is (a series titles its own
 * meetings; "this and all later" never carries a title, §18.14). Only what
 * changed is sent, so a later meeting's own edit of another field is never
 * overwritten; nothing changed closes the dialog without a write. In a series
 * the button reads Next and "Which meetings change?" follows. A refusal is said
 * from its code; a stale save (MEETING_CHANGED) says so.
 */
@Component({
  selector: 'app-meeting-edit-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, EditDialogComponent, FieldComponent, OverlaySelectComponent, MeetingScopeDialogComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3" data-testid="edit-details-form">
        <div class="grid gap-3" [style.grid-template-columns]="isUnit() ? 'minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(0, 1.2fr)' : 'repeat(2, minmax(0, 1fr))'">
          <am-field [label]="'meeting.schedule.type' | translate" [control]="form.controls.typeValueId" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.schedule.typeRequired' }">
            @if (typesState() === 'error') {
              <span class="flex items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="edit-types-error">
                {{ 'meeting.schedule.typesError' | translate }}
                <p-button size="small" [text]="true" [label]="'common.retry' | translate" data-testid="edit-types-retry" (onClick)="loadTypes()" />
              </span>
            } @else {
              <app-overlay-select [options]="typeOptions()" optionLabel="label" optionValue="value" formControlName="typeValueId" [ariaLabel]="'meeting.schedule.type' | translate" />
            }
          </am-field>
          <am-field [label]="'meeting.schedule.duration' | translate" [control]="form.controls.durationMinutes" message="none">
            <app-overlay-select [options]="durationOptions()" optionLabel="label" optionValue="value" formControlName="durationMinutes" [ariaLabel]="'meeting.schedule.duration' | translate" />
          </am-field>
          @if (isUnit()) {
            <am-field [label]="'meeting.schedule.quorum' | translate" [control]="form.controls.unitQuorum" [forceShowErrors]="showErrors()" [errorMessages]="{ pattern: 'meeting.schedule.quorumNumber' }">
              <input pInputText dir="ltr" inputmode="numeric" formControlName="unitQuorum" [placeholder]="'meeting.schedule.quorumNone' | translate" data-testid="edit-quorum" />
            </am-field>
          }
        </div>
        <div class="grid gap-3" style="grid-template-columns: repeat(2, minmax(0, 1fr))">
          <am-field [label]="'meeting.schedule.location' | translate" [control]="form.controls.location" message="none">
            <input pInputText formControlName="location" maxlength="300" data-testid="edit-location" />
          </am-field>
          <am-field [label]="'meeting.schedule.link' | translate" [control]="form.controls.meetingUrl" message="none">
            <input pInputText dir="ltr" formControlName="meetingUrl" maxlength="2000" placeholder="https://" data-testid="edit-link" />
          </am-field>
        </div>
        <p class="m-0 text-meta" [class.text-[var(--am-danger-ink)]]="showErrors() && form.hasError('place')" data-testid="edit-place-hint">{{ 'meeting.schedule.placeHint' | translate }}</p>
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex flex-wrap items-center justify-end gap-3">
        @if (error()) {
          <p class="m-0 me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="edit-error">{{ error()! | translate }}</p>
        }
        <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
        <p-button type="button" data-testid="edit-submit" [label]="(inSeries() ? 'meeting.edit.next' : 'meeting.edit.save') | translate" [loading]="saving() && !scopeOpen()" (onClick)="submit()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.edit.title' | translate"
      [context]="meeting()?.title ?? ''"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
      density="compact"
    />
    <app-meeting-scope-dialog
      [visible]="scopeOpen()"
      (visibleChange)="scopeOpen.set($event)"
      [meeting]="meeting()"
      [change]="scopeChange()"
      [saving]="saving()"
      [error]="scopeError()"
      (applied)="send($event)"
    />
  `,
})
export class MeetingEditDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);

  readonly visible = input.required<boolean>();
  readonly meeting = input<MeetingDto | null>(null);
  readonly visibleChange = output<boolean>();
  readonly saved = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly typesState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly types = signal<{ id: string; labelEn: string; labelAr: string | null }[]>([]);
  readonly scopeOpen = signal(false);
  readonly scopeChange = signal<MeetingScopePreviewRequest | null>(null);
  readonly scopeError = signal<string | null>(null);
  /** The changed fields Next was pressed with: what Apply sends. */
  private pending: Partial<Pick<UpdateMeetingRequest, EditField>> | null = null;

  readonly isUnit = computed(() => this.meeting()?.owner.kind === 'UNIT');
  readonly inSeries = computed(() => !!this.meeting()?.series);
  readonly typeOptions = computed(() => {
    this.language.isArabic();
    const list = this.types().map((t) => ({ label: this.language.bilingual(t.labelEn, t.labelAr), value: t.id }));
    // The meeting's own type stays a choice even if it has since been deactivated.
    const own = this.meeting()?.type;
    if (own && !list.some((o) => o.value === own.id)) list.unshift({ label: this.language.bilingual(own.labelEn, own.labelAr), value: own.id });
    return list;
  });
  readonly durationOptions = computed(() => {
    this.language.isArabic();
    const own = this.meeting()?.durationMinutes;
    const list = MEETING_DURATIONS.includes(own as never) || !own ? [...MEETING_DURATIONS] : [...MEETING_DURATIONS, own].sort((a, b) => a - b);
    return list.map((m) => ({ label: this.format.count('meeting.minutes', m), value: m }));
  });

  readonly form = this.fb.group(
    {
      typeValueId: ['', Validators.required],
      durationMinutes: [60 as number, Validators.required],
      unitQuorum: ['', Validators.pattern(/^\s*[1-9]\d{0,2}\s*$/)],
      location: [''],
      meetingUrl: [''],
    },
    { validators: placeRequired },
  );

  constructor() {
    // Every OPENING starts from the meeting as it stands; its choices load then (ACC-238).
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        const m = this.meeting();
        if (!m) return;
        this.form.reset({
          typeValueId: m.type?.id ?? '',
          durationMinutes: m.durationMinutes ?? 60,
          unitQuorum: m.unitQuorum != null ? String(m.unitQuorum) : '',
          location: m.location ?? '',
          meetingUrl: m.meetingUrl ?? '',
        });
        this.error.set(null);
        this.showErrors.set(false);
        this.scopeOpen.set(false);
        this.scopeError.set(null);
        this.pending = null;
        this.loadTypes();
      });
    });
  }

  loadTypes(): void {
    this.typesState.set('loading');
    this.meetings.formChoices().subscribe({
      next: (c) => {
        this.types.set(c.types);
        this.typesState.set('ready');
      },
      error: () => {
        this.types.set([]);
        this.typesState.set('error');
      },
    });
  }

  /** The fields that differ from the meeting as loaded: only these are sent. */
  changes(): Partial<Pick<UpdateMeetingRequest, EditField>> {
    const m = this.meeting()!;
    const v = this.form.getRawValue();
    const out: Partial<Pick<UpdateMeetingRequest, EditField>> = {};
    if (v.typeValueId && v.typeValueId !== m.type?.id) out.typeValueId = v.typeValueId;
    if (Number(v.durationMinutes) !== (m.durationMinutes ?? 60)) out.durationMinutes = Number(v.durationMinutes);
    const location = v.location?.trim() || null;
    if (location !== (m.location ?? null)) out.location = location;
    const meetingUrl = v.meetingUrl?.trim() || null;
    if (meetingUrl !== (m.meetingUrl ?? null)) out.meetingUrl = meetingUrl;
    if (this.isUnit()) {
      const quorum = v.unitQuorum?.trim() ? Number(v.unitQuorum) : null;
      if (quorum !== (m.unitQuorum ?? null)) out.unitQuorum = quorum;
    }
    return out;
  }

  submit(): void {
    const m = this.meeting();
    if (!m || this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      return;
    }
    const fields = this.changes();
    if (Object.keys(fields).length === 0) {
      // Nothing changed: nothing to write, in one meeting or a series.
      this.form.markAsPristine();
      this.visibleChange.emit(false);
      return;
    }
    this.error.set(null);
    this.pending = fields;
    if (this.inSeries()) {
      this.scopeError.set(null);
      this.scopeChange.set({ change: 'EDIT', ...fields });
      this.scopeOpen.set(true);
      return;
    }
    this.send(null);
  }

  /** The write: one meeting, or (a series) the scope "Which meetings change?" chose. */
  send(scope: MeetingEditScope | null): void {
    const m = this.meeting();
    if (!m || !this.pending || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.scopeError.set(null);
    this.meetings.update(m.id, { ...this.pending, expectedUpdatedAt: m.updatedAt, ...(scope && { scope }) }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.scopeOpen.set(false);
        this.saved.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const key = meetingRefusalKey(err) ?? 'meeting.edit.error';
        if (this.scopeOpen()) this.scopeError.set(key);
        else this.error.set(key);
      },
    });
  }
}
