import { Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { Observable, of, map, tap } from 'rxjs';
import {
  CommitteeService,
  CommitteeMemberDto,
} from '../../services/committee.service';
import { UserService, IUserDto } from '../../../user/services/user.service';
import { OrgUnitService, OrgUnitDto } from '../../../organization/services/org-unit.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { LanguageService } from '../../../../core/services/language.service';
import { FormatService } from '../../../../core/formatting';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
// ACC-42 Phase 3 — OverlaySelectComponent replaces p-select on this field:
// EditDialogComponent context, proves item-template projection (Phase 2)
// end-to-end for the first time in a real consumer. See CLAUDE.md's
// PrimeNG-components-only exception note and overlay-select.component.ts.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import {
  SimpleListComponent,
  SimpleListPage,
  SimpleListQuery,
} from '../../../../shared/components/simple-list/simple-list.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';

/** The day a date falls on, at local midnight. */
function startOfDay(at: Date): Date {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** Why an add was refused, as a translation key: from the status, never the server's text. */
export function addMemberRefusal(err: unknown): string {
  const status = err instanceof HttpErrorResponse ? err.status : 0;
  if (status === 409) return 'committee.memberForm.errorAlreadyMember';
  if (status === 403) return 'committee.memberForm.errorDenied';
  if (status === 404) return 'committee.memberForm.errorNotFound';
  return 'committee.memberForm.errorSave';
}

// ACC-120 slice 4 — Add member (plan: backend/Plans/step-120-4-committees-list.md).
//
// TWO MODES, AND ONLY ONE OF THEM CHANGED. Add member gains the person picker,
// the joined date and the field wrapper. Change role (`member` set) renders the
// markup it always had: it is not part of this slice and keeps its behaviour.
//
// THE PERSON PICKER IS ITS OWN LAYER, above this dialog: ACC-230's searchable
// list (`am-simple-list` in `am-list-dialog size="compact"`), with its two
// opt-in options on — rows you can pick, and rows disabled with a reason. A
// current member stays in the list as "Already a member" rather than vanishing,
// so a searcher is never left wondering where someone went. The list dialog
// owns Escape (top layer only) and returns focus to the field's button.
@Component({
  selector: 'app-committee-member-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    ButtonModule,
    OverlaySelectComponent,
    FieldComponent,
    InlineCalendarComponent,
    ListDialogComponent,
    SimpleListComponent,
  ],
  template: `
    @if (member()) {
      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label for="roleValueId" class="text-sm font-medium">
            {{ 'committee.memberRole' | translate }}
            <span class="text-red-500">*</span>
          </label>
          <app-overlay-select
            formControlName="roleValueId"
            [options]="memberRoleOptions()"
            optionLabel="label"
            optionValue="id"
            [placeholder]="'committee.selectMemberRole' | translate"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="reason" class="text-sm font-medium">{{ 'committee.reason' | translate }}</label>
          <input pInputText id="reason" formControlName="reason" />
        </div>

        @if (saveError()) {
          <p class="text-red-500 text-sm">{{ saveError() | translate }}</p>
        }

        <div class="flex justify-end gap-2 pt-2">
          <p-button
            [label]="'common.cancel' | translate"
            severity="secondary"
            [text]="true"
            (onClick)="cancelled.emit()"
            [disabled]="saving()"
          />
          <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" />
        </div>
      </form>
    } @else if (dateView()) {
      <div class="am-member-dateview" data-testid="member-date-view">
        <button type="button" class="am-backlink" (click)="closeDateView()">
          <i class="pi pi-arrow-left am-backlink__icon" aria-hidden="true"></i>
          {{ 'committee.memberForm.backToForm' | translate }}
        </button>
        <am-inline-calendar
          [value]="form.controls.joinedOn.value"
          (valueChange)="onDayPicked($event)"
          [maxDate]="today()"
        />
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col" data-testid="member-add-form">
        <am-field
          [label]="'committee.memberForm.person' | translate"
          [control]="form.controls.userId"
          inputId="memberPerson"
          [hint]="personHint() | translate"
          [errorMessages]="{ required: 'committee.memberForm.personRequired' }"
        >
          <div class="am-member-pick">
            <input
              pInputText
              id="memberPerson"
              readonly
              class="am-member-pick__text"
              data-testid="member-person"
              [value]="chosenName()"
              [placeholder]="'committee.memberForm.choosePerson' | translate"
              (click)="openPicker()"
              (keydown.enter)="$event.preventDefault(); openPicker()"
            />
            <button
              type="button"
              class="am-member-pick__button"
              data-testid="member-person-button"
              [attr.aria-label]="'committee.memberForm.choosePerson' | translate"
              (click)="openPicker()"
            >
              <i class="pi pi-search" aria-hidden="true"></i>
            </button>
          </div>
        </am-field>

        <am-field
          [label]="'committee.memberForm.role' | translate"
          [control]="form.controls.roleValueId"
          [errorMessages]="{ required: 'committee.memberForm.roleRequired' }"
        >
          <app-overlay-select
            formControlName="roleValueId"
            data-testid="member-role"
            [options]="memberRoleOptions()"
            optionLabel="label"
            optionValue="id"
            [placeholder]="'committee.selectMemberRole' | translate"
          />
        </am-field>

        <am-field
          [label]="'committee.memberForm.joined' | translate"
          [control]="form.controls.joinedOn"
          inputId="memberJoined"
          [hint]="'committee.memberForm.joinedHint' | translate"
          [errorMessages]="{ required: 'committee.memberForm.joinedRequired', future: 'committee.memberForm.joinedFuture' }"
        >
          <div class="am-member-pick">
            <input
              pInputText
              id="memberJoined"
              readonly
              class="am-member-pick__text"
              data-testid="member-joined"
              [value]="joinedText()"
              (click)="openDateView()"
              (keydown.enter)="$event.preventDefault(); openDateView()"
            />
            <button
              type="button"
              class="am-member-pick__button"
              data-testid="member-joined-button"
              [attr.aria-label]="'committee.memberForm.chooseDate' | translate"
              (click)="openDateView()"
            >
              <i class="pi pi-calendar" aria-hidden="true"></i>
            </button>
          </div>
        </am-field>

        <am-field
          [label]="'committee.reason' | translate"
          [control]="form.controls.reason"
          inputId="memberReason"
          [errorMessages]="{ maxlength: 'committee.memberForm.reasonTooLong' }"
        >
          <input pInputText id="memberReason" formControlName="reason" class="w-full" />
        </am-field>

        @if (saveError()) {
          <p class="text-meta text-[var(--am-danger-ink)] m-0 mb-2" role="alert" data-testid="member-save-error">
            {{ saveError()! | translate }}
          </p>
        }

        <div class="flex justify-end gap-2">
          <p-button
            [label]="'common.cancel' | translate"
            severity="secondary"
            [text]="true"
            type="button"
            (onClick)="cancel()"
            [disabled]="saving()"
          />
          <p-button
            [label]="'committee.addMember' | translate"
            type="submit"
            [loading]="saving()"
            data-testid="member-submit"
          />
        </div>
      </form>
    }

    <ng-template #pickerBody>
      <am-simple-list
        [load]="loadPeople"
        [columns]="pickerColumns()"
        grid="minmax(0,1.5fr) minmax(0,1fr) minmax(110px,auto)"
        [row]="personCells"
        [sortOptions]="pickerSortOptions()"
        defaultSort="name:asc"
        [searchLabel]="'committee.memberForm.searchPeople' | translate"
        [searchPlaceholder]="'committee.memberForm.searchPeoplePlaceholder' | translate"
        [emptyText]="'committee.memberForm.noPeople' | translate"
        [noMatchText]="'committee.noMatch' | translate: { q: peopleQuery() }"
        [countText]="peopleCountText"
        [selectable]="true"
        [rowDisabled]="alreadyMember"
        (picked)="onPicked($event)"
      />
    </ng-template>
    <ng-template #personCells let-person>
      <span class="flex flex-col min-w-0">
        <span class="truncate font-medium">{{ person.name }}</span>
        <span dir="ltr" class="truncate text-[12px] text-[var(--am-ink-700)] text-start" style="unicode-bidi: isolate">{{
          person.email
        }}</span>
      </span>
      <span class="truncate text-[12px] text-[var(--am-ink-700)]">{{ orgUnitName(person.primaryOrgUnitId) }}</span>
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="pickerOpen()"
      [heading]="'committee.memberForm.pickerTitle' | translate"
      [closeLabel]="'committee.memberForm.closePicker' | translate"
      [body]="pickerBody"
      (closeRequested)="pickerOpen.set(false)"
    />
  `,
  styles: [
    `
      .am-member-pick {
        display: flex;
        gap: var(--am-space-8);
        align-items: center;
      }
      /* A zero basis AND width: an input's intrinsic width (its size of 20)
         otherwise counts toward the row's minimum, which held the dialog at
         395px on a 390px phone. */
      .am-member-pick__text {
        flex: 1 1 0;
        inline-size: 0;
        min-width: 0;
        cursor: pointer;
      }
      .am-member-pick__button {
        flex: none;
        inline-size: 36px;
        block-size: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-control);
        background: var(--am-surface-raised);
        color: var(--am-ink-700);
        cursor: pointer;
      }
      .am-member-pick__button:hover {
        border-color: var(--am-control-border-hover);
      }
      .am-member-dateview {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
      }
      .am-backlink {
        align-self: flex-start;
        display: inline-flex;
        gap: var(--am-space-8);
        align-items: center;
        border: 0;
        background: none;
        padding: 0;
        font: inherit;
        color: var(--am-primary-600);
        cursor: pointer;
      }
      :dir(rtl) .am-backlink__icon {
        transform: scaleX(-1);
      }
      .am-backlink:focus-visible,
      .am-member-pick__button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
    `,
  ],
})
export class CommitteeMemberFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly committeeService = inject(CommitteeService);
  private readonly userService = inject(UserService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly lookupService = inject(LookupService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly layers = inject(LayerStackService);
  private readonly destroyRef = inject(DestroyRef);
  // The dialog this form sits in (its content is rendered in the dialog's own
  // injector), so Cancel asks the same "Discard changes?" question Escape does.
  private readonly dialog = inject(EditDialogComponent, { optional: true });

  readonly committeeId = input.required<string>();
  readonly member = input<CommitteeMemberDto | null>(null);
  readonly activeMembers = input<CommitteeMemberDto[]>([]);
  readonly saved = output<void>();
  readonly cancelled = output<void>();
  /** ACC-96 — the dialog's [dirty] lives on the dialog, so the state travels out. */
  readonly dirtyChange = output<boolean>();

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  /** Active people, once loaded; null until then (the picker shows its skeleton). */
  private readonly users = signal<IUserDto[] | null>(null);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  readonly memberRoles = signal<LookupValueDto[]>([]);
  readonly pickerOpen = signal(false);
  readonly dateView = signal(false);
  private readonly chosen = signal<IUserDto | null>(null);
  readonly peopleQuery = signal('');
  private dateViewLayerId: number | null = null;

  readonly today = computed(() => startOfDay(new Date()));

  readonly form = this.fb.group({
    userId: [null as string | null, [Validators.required]],
    roleValueId: [null as string | null, [Validators.required]],
    joinedOn: [startOfDay(new Date()) as Date | null, [Validators.required, (c: AbstractControl) => notFuture(c)]],
    reason: ['', [Validators.maxLength(2000)]],
  });

  // ACC-160 — options carry a RESOLVED label instead of handing the dropdown a
  // field NAME ('nameAr' / 'labelAr'), which drew a BLANK option for a record
  // with no Arabic name. A computed over the options AND the language —
  // bilingual() reads the language signal — so a switch relabels the list. Never
  // a label written once at load: the one-time-set trap (SYSTEM-REFERENCE §9.3).
  readonly memberRoleOptions = computed(() =>
    this.memberRoles().map((v) => ({
      ...v,
      label: this.languageService.bilingual(v.labelEn, v.labelAr),
    })),
  );

  private readonly memberIds = computed(() => new Set(this.activeMembers().map((m) => m.userId)));

  /** The field's hint: says so when everyone active is already on the committee. */
  readonly personHint = computed(() => {
    const users = this.users();
    if (users && users.length > 0 && users.every((u) => this.memberIds().has(u.id))) {
      return 'committee.memberForm.noOneToAdd';
    }
    return 'committee.memberForm.personHint';
  });

  readonly chosenName = computed(() => this.chosen()?.name ?? '');

  readonly joinedText = computed(() => {
    this.tick();
    const day = this.form.controls.joinedOn.value;
    return day ? this.format.date(day) : '';
  });
  private readonly tick = signal(0);

  readonly pickerColumns = computed(() => {
    this.translate.currentLang();
    return [
      { label: this.translate.instant('committee.memberForm.col.person') },
      { label: this.translate.instant('committee.memberForm.col.unit') },
      { label: '', srLabel: this.translate.instant('committee.memberForm.col.availability') },
    ];
  });

  readonly pickerSortOptions = computed(() => {
    this.translate.currentLang();
    return [
      { value: 'name:asc', label: this.translate.instant('committee.sort.nameAsc') },
      { value: 'name:desc', label: this.translate.instant('committee.sort.nameDesc') },
    ];
  });

  /** A current member's reason they can't be picked; null for anyone else. */
  readonly alreadyMember = (person: IUserDto): string | null =>
    this.memberIds().has(person.id) ? this.translate.instant('committee.memberForm.alreadyMember') : null;

  readonly peopleCountText = (n: number, searching: boolean): string =>
    this.format.count(searching ? 'committee.peopleMatch' : 'committee.people', n);

  /**
   * One read of the active people, then search, sort and Load more in memory.
   * A failed read is the list's own error with Retry, which reads again.
   */
  readonly loadPeople = (query: SimpleListQuery): Observable<SimpleListPage<IUserDto>> => {
    this.peopleQuery.set(query.q ?? '');
    const cached = this.users();
    const all$ = cached
      ? of(cached)
      : this.userService.listAllUsers({ status: 'ACTIVE' }).pipe(tap((rows) => this.users.set(rows)));
    return all$.pipe(
      map((all) => {
        const term = query.q?.trim().toLowerCase() ?? '';
        const matching = term
          ? all.filter((u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
          : [...all];
        const locale = this.languageService.isArabic() ? 'ar' : 'en';
        matching.sort((a, b) => (query.dir === 'desc' ? -1 : 1) * a.name.localeCompare(b.name, locale));
        return {
          items: matching.slice(query.skip, query.skip + query.take),
          total: all.length,
          matching: matching.length,
        };
      }),
    );
  };

  constructor() {
    effect(() => {
      const current = this.member();
      if (current) {
        this.form.patchValue({ roleValueId: current.roleValueId });
      }
    });

    this.form.valueChanges.subscribe(() => {
      this.tick.update((n) => n + 1);
      this.dirtyChange.emit(this.form.dirty);
    });

    // The date view is a layer: Escape closes it before EditDialogComponent's
    // own capture-phase handler can ask about discarding the form (ACC-111).
    effect(() => {
      const open = this.dateView();
      if (open && this.dateViewLayerId === null) {
        this.dateViewLayerId = this.layers.push();
      } else if (!open && this.dateViewLayerId !== null) {
        this.layers.remove(this.dateViewLayerId);
        this.dateViewLayerId = null;
      }
    });
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.dateView()) return;
      if (this.dateViewLayerId === null || !this.layers.isTop(this.dateViewLayerId)) return;
      event.preventDefault();
      event.stopPropagation();
      this.closeDateView();
    };
    document.addEventListener('keydown', onKeydown);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('keydown', onKeydown);
      if (this.dateViewLayerId !== null) this.layers.remove(this.dateViewLayerId);
    });
  }

  ngOnInit(): void {
    // Each opening is a new form, so the host's dirty flag starts clean too:
    // it would otherwise still hold the last opening's answer.
    this.dirtyChange.emit(false);
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
    this.lookupService.getValues('committee_member_role').subscribe({
      next: (values) => this.memberRoles.set(values),
    });
  }

  orgUnitName(orgUnitId: string | null): string {
    if (!orgUnitId) return '—';
    const unit = this.orgUnits().find((u) => u.id === orgUnitId);
    return unit ? this.languageService.bilingual(unit.nameEn, unit.nameAr) : '—';
  }

  openPicker(): void {
    this.pickerOpen.set(true);
  }

  onPicked(person: IUserDto): void {
    this.chosen.set(person);
    // Dirty FIRST: setValue() emits valueChanges, which is when the host is
    // told whether the form is dirty.
    this.form.controls.userId.markAsDirty();
    this.form.controls.userId.setValue(person.id);
    this.saveError.set(null);
    this.pickerOpen.set(false);
  }

  openDateView(): void {
    this.dateView.set(true);
  }

  closeDateView(): void {
    this.dateView.set(false);
  }

  onDayPicked(day: Date | null): void {
    if (day) {
      this.form.controls.joinedOn.markAsDirty();
      this.form.controls.joinedOn.setValue(startOfDay(day));
    }
    this.closeDateView();
  }

  /** Cancel asks the dialog, so unsaved work gets the same question as Escape. */
  cancel(): void {
    if (this.dialog) {
      this.dialog.requestClose();
      return;
    }
    this.cancelled.emit();
  }

  /**
   * The joined date as the API takes it, or nothing for today: omitted, the
   * server records now, which is what today means. Gregorian, picked in the
   * browser's zone and sent as an instant (ACC-96 Part A's convention).
   */
  effectiveDate(): string | undefined {
    const day = this.form.controls.joinedOn.value;
    if (!day || startOfDay(day).getTime() === this.today().getTime()) return undefined;
    return startOfDay(day).toISOString();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);

    const value = this.form.getRawValue();
    const current = this.member();

    if (current) {
      this.committeeService
        .changeMemberRole(this.committeeId(), current.id, {
          roleValueId: value.roleValueId!,
          reason: value.reason || undefined,
        })
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.saved.emit();
          },
          error: (err: unknown) => {
            this.saveError.set(extractErrorMessage(err, 'Save failed'));
            this.saving.set(false);
          },
        });
      return;
    }

    const effectiveDate = this.effectiveDate();
    this.committeeService
      .addMember(this.committeeId(), {
        userId: value.userId!,
        roleValueId: value.roleValueId!,
        reason: value.reason?.trim() || undefined,
        ...(effectiveDate ? { effectiveDate } : {}),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.form.markAsPristine();
          this.dirtyChange.emit(false);
          this.saved.emit();
        },
        error: (err: unknown) => {
          this.saveError.set(addMemberRefusal(err));
          this.saving.set(false);
        },
      });
  }
}

/** A joined date can't be after today. */
function notFuture(control: AbstractControl): ValidationErrors | null {
  const day = control.value as Date | null;
  if (!day) return null;
  return startOfDay(day).getTime() > startOfDay(new Date()).getTime() ? { future: true } : null;
}
