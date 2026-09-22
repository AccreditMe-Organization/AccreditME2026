// New task — Template 3, a TWO-STEP form dialog (ACC-96).
//
// ## Why two steps, and why the due date is not what moved
//
// One step with the real inline calendar open measures 750px against a 420px
// body cap — title 75, description 128, priority 75, assignee 75, due 75 plus 8
// plus 314. That is 330px over, and it cannot be recovered by shrinking the
// calendar, which is already at the WCAG target-size floor plus 4px.
//
// So the form splits, and the DUE DATE STAYS ON STEP 1. Moving it to step 2
// would have satisfied the arithmetic and broken the product: "complete step 1
// and Create" is the path for someone raising an urgent task in ten seconds,
// and a task created with no due time is exactly the task the SLA cannot
// govern. The split is editorial rather than arithmetic — step 1 is the
// commitment (what, who, when, how urgent), step 2 is the substance.
//
// ## Nothing expands on step 1; the calendar SUBSTITUTES for it
//
// A calendar with time leaves 23px of the cap, room for no other field at all.
// So pressing the calendar button swaps step 1's body for the date view rather
// than pushing it down: same step, same footer, values all still live, Create
// still reachable. Artboard 12 names this as a scoped exception — "in flow"
// meaning INSTEAD OF rather than BELOW — and it applies only because the
// presets already cover the common case.
//
// ## Not built here, deliberately
//
// Template 3's step 2 also draws evidence-required and a delegation label.
// Neither exists in CreateTaskDto; both wait for the task analysis, and a
// disabled placeholder would be worse than their absence.

import { Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputMaskModule } from 'primeng/inputmask';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TaskService } from '../../services/task.service';
import { DueDateService, DuePreset } from '../../services/due-date.service';
import { UserService, IUserDto } from '../../../user/services/user.service';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { FormatService } from '../../../../core/formatting';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';

const SOURCE_TYPES = [
  'MEETING',
  'DOCUMENT',
  'AUDIT',
  'CAPA',
  'INCIDENT',
  'CORRECTIVE_ACTION',
  'STANDARD',
  'KPI',
  'GAP',
  'QUALITY_IMPROVEMENT_PLAN',
  // ACC-76 — was missing, though TaskSourceType has carried it since ACC-22
  // and TaskController's own query union lists it. Manual creation of a
  // committee task was therefore impossible from this form.
  'COMMITTEE',
];

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

@Component({
  selector: 'app-task-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    NgTemplateOutlet,
    TranslatePipe,
    InputTextModule,
    TextareaModule,
    InputMaskModule,
    ButtonModule,
    MessageModule,
    OverlaySelectComponent,
    InlineCalendarComponent,
  ],
  template: `
    <form id="taskForm" [formGroup]="form" (ngSubmit)="onSubmit()" class="am-task-form flex flex-col gap-4">
      <!-- The step strip. EditDialogComponent's header is a plain string, so
           this lives at the top of the body rather than beside the title.
           HIDDEN IN THE DATE VIEW: that view has a 6px margin against the cap
           and the strip costs 37px with its gap. The drawing does not show it
           there either — the Back link is what orients you. -->
      @if (!dateView()) {
        <ol class="am-steps" [attr.aria-label]="'task.steps' | translate">
          @for (s of steps; track s.n) {
            <li class="am-steps__item" [class.am-steps__item--on]="step() === s.n">
              <span class="am-steps__n">{{ s.n }}</span>
              <span>{{ s.key | translate }}</span>
            </li>
          }
        </ol>
      }

      @if (step() === 1) {
        @if (dateView()) {
          <!-- ── Step 1, date view ───────────────────────────────────────
               SUBSTITUTES for the fields rather than pushing them down. Same
               step, same footer; every value is still live. -->
          <!-- 8px gaps, not the form's 16: the drawing budgets the date view
               at 414 of a 420 cap, and the gap it names between the due block
               and the calendar is 8. -->
          <div class="am-dateview">
            <ng-container *ngTemplateOutlet="dueBlock; context: { presets: false, back: true }" />

              <am-inline-calendar
              [showTime]="true"
              [value]="dueDay()"
              (valueChange)="onDayPicked($event)"
              [time]="dueTimeText()"
              (timeChange)="onTimeTyped($event)"
              [workingDays]="dueDates.workingDays()"
              [holidays]="dueDates.holidays()"
              [zoneSuffix]="dueDates.zoneSuffix()"
              timeInputId="dueTimePanel"
            />
          </div>
        } @else {
          <!-- ── Step 1, fields ──────────────────────────────────────────── -->
          <div class="flex flex-col gap-1">
            <label for="title" class="text-sm font-medium">
              {{ 'task.title' | translate }} <span class="text-red-500">*</span>
            </label>
            <input pInputText id="title" formControlName="title" />
          </div>

          <div class="flex gap-4">
            <div class="flex flex-col gap-1 flex-1">
              <label for="assigneeUserIds" class="text-sm font-medium">
                {{ 'task.assignees' | translate }}
              </label>
              @if (users().length > 0) {
                <!-- ACC-96 — a trigger, not the inline p-listbox ACC-76 added.
                     Same data source and the same eligible set: every ACTIVE
                     user in the tenant, because a committee task can
                     legitimately go to a department head outside it. What
                     changed is the height — the list was ~200px and step 1
                     budgets 75px for this field. -->
                <app-overlay-select
                  formControlName="assigneeUserIds"
                  [options]="users()"
                  optionLabel="name"
                  optionValue="id"
                  [multiple]="true"
                  [showClear]="true"
                  [multipleSummary]="assigneeSummary()"
                  [placeholder]="'task.assigneesNone' | translate"
                />
              } @else {
                <!-- Degrades rather than blocks. A caller whose role grants
                     tasks:create but not users:view gets an empty list and a
                     403 they cannot act on; creating the task unassigned is
                     still a real, supported outcome. -->
                <p-message severity="info" [text]="'task.assigneesUnavailable' | translate" />
              }
            </div>

            <div class="flex flex-col gap-1 flex-1">
              <label for="priority" class="text-sm font-medium">
                {{ 'task.priority.title' | translate }}
              </label>
              <app-overlay-select formControlName="priority" [options]="priorities" />
            </div>
          </div>

          <ng-container *ngTemplateOutlet="dueBlock" />
        }
      } @else {
        <!-- ── Step 2 — the substance ──────────────────────────────────── -->
        <div class="flex flex-col gap-1">
          <label for="description" class="text-sm font-medium">
            {{ 'task.description' | translate }}
          </label>
          <textarea pTextarea id="description" formControlName="description" rows="3"></textarea>
          <small class="am-hint">{{ 'task.descriptionHint' | translate }}</small>
        </div>

        @if (isSourceLocked()) {
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">{{ 'task.source' | translate }}</label>
            <p class="text-sm text-[var(--am-ink-500)]">{{ lockedSourceLabel() }}</p>
            <small class="am-hint">{{ 'task.sourceLockedHint' | translate }}</small>
          </div>
        } @else {
          <div class="flex gap-4">
            <div class="flex flex-col gap-1 flex-1">
              <label for="sourceType" class="text-sm font-medium">
                {{ 'task.sourceType' | translate }} <span class="text-red-500">*</span>
              </label>
              <app-overlay-select formControlName="sourceType" [options]="sourceTypes" />
            </div>
            <div class="flex flex-col gap-1 flex-1">
              <label for="sourceId" class="text-sm font-medium">
                {{ 'task.sourceId' | translate }} <span class="text-red-500">*</span>
              </label>
              <input pInputText id="sourceId" formControlName="sourceId" />
            </div>
          </div>
        }
      }

    </form>

    <!-- The due block is identical on both step-1 views, which is the point:
         pressing the calendar button must not appear to move the control. -->
    <ng-template #dueBlock let-showPresets="presets" let-showBack="back">
      <div class="flex flex-col gap-1 am-due">
        <!-- THE BACK LINK SHARES THE LABEL'S ROW, and that is a height
             decision rather than a layout preference. The drawing's 414 is
             due block 75 + gap 8 + calendar 314 + one warning line 17, and it
             does NOT include the link. On its own row the link costs 24px in
             Arabic, and a warning that wraps to two lines then takes the view
             to 455 against a 420 cap — measured, with the body scrolling,
             which is the defect this ticket removes. On the label's row it
             costs nothing.
             The arrow is an icon, not a literal "←": a left arrow in an
             Arabic layout points away from where Back goes, so it mirrors. -->
        <div class="am-due__labelrow">
          <label for="dueDate" class="text-sm font-medium">{{ 'task.dueDate' | translate }}</label>
          @if (showBack) {
            <button type="button" class="am-backlink" (click)="closeDateView()">
              <i class="pi pi-arrow-left am-backlink__icon" aria-hidden="true"></i>
              {{ 'task.due.backToDetails' | translate }}
            </button>
          }
        </div>
        <div class="am-due__row">
          <!-- dir="ltr" on a value that is Latin script inside an RTL layout.
               Without it the bidi algorithm reorders "25 Sep 2026" into
               "Sep 2026 25" — seen in the Arabic pass. ACC-94 D4 keeps a typed
               date Gregorian with English months in both languages precisely
               so it round-trips, and that only holds if it also READS in the
               order it is typed. Same for the HH:mm field. -->
          <input
            pInputText
            id="dueDate"
            class="am-due__date"
            dir="ltr"
            [value]="dueDateText()"
            (input)="onDateTyped($any($event.target).value)"
            (blur)="commitTypedDate()"
            [placeholder]="'task.due.datePlaceholder' | translate"
            autocomplete="off"
          />
          <p-button
            type="button"
            icon="pi pi-calendar"
            [text]="true"
            [ariaLabel]="'task.due.toggleCalendar' | translate"
            [attr.aria-expanded]="dateView()"
            (onClick)="toggleDateView()"
          />
          <p-inputmask
            inputId="dueTime"
            dir="ltr"
            mask="99:99"
            [placeholder]="'task.due.timePlaceholder' | translate"
            [ngModel]="dueTimeText()"
            [ngModelOptions]="{ standalone: true }"
            (ngModelChange)="onTimeTyped($event ?? '')"
          />
          <span class="am-due__zone">{{ dueDates.zoneSuffix() }}</span>
        </div>

        <!-- Presets. Each sets BOTH date and time in one press — the urgent
             case end to end — and the resolved line below announces the
             absolute value it set, because a button that silently changes two
             fields is not usable without sight. +1h and +2h are clock
             arithmetic and always present; the other two need the tenant
             calendar and are withheld without it. -->
        @if (showPresets !== false) {
        <div class="am-presets" role="group" [attr.aria-label]="'task.due.presets' | translate">
          @for (p of presets(); track p.key) {
            <button
              type="button"
              class="am-presets__chip"
              [class.am-presets__chip--on]="activePreset() === p.key"
              (click)="applyPreset(p)"
            >
              {{ p.labelKey | translate: p.labelParams }}
            </button>
          }
        </div>
        }

        <!-- One live region for the whole block: the resolved value, or the
             warning that replaces it. -->
        <div class="am-due__messages" aria-live="polite">
          <!-- The resolved value is announced WHERE THE PRESETS ARE, and only
               there. A preset writes two fields in one press, so "announces
               the absolute value it set" is the whole reason this line exists;
               a warning that swallowed it would leave a screen-reader user
               told their time is out of hours and never told what it is.
               In the date view there are no presets, and the date and time
               fields sit directly above showing that same value — so echoing
               it there buys nothing and costs 17px of a 420px cap. With it,
               a warning wrapped to two lines measured 424 (English) and 427
               (Arabic) and the body scrolled. -->
          @if (showPresets !== false) {
            <p class="am-due__resolved">{{ resolvedText() }}</p>
          }
          @if (warning().kind === 'past') {
            <p class="am-due__resolved am-due__error">{{ 'task.due.past' | translate }}</p>
          } @else if (warningText()) {
            <p class="am-due__resolved am-due__warn">{{ warningText() }}</p>
          }
        </div>
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .am-steps {
        display: flex;
        gap: 1.25rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .am-steps__item {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 12.5px;
        color: var(--am-ink-500);
      }

      .am-steps__item--on {
        color: var(--am-primary-700);
        font-weight: 600;
      }

      .am-steps__n {
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: 18px;
        block-size: 18px;
        border-radius: 999px;
        border: 1px solid currentColor;
        font-size: 11px;
      }

      .am-due__labelrow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        min-block-size: 22px;
      }

      .am-backlink {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        font-size: 12.5px;
        color: var(--am-primary-600);
        cursor: pointer;
      }

      :dir(rtl) .am-backlink__icon {
        transform: scaleX(-1);
      }

      .am-backlink:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }

      /* The form and everything in it may shrink. Without min-inline-size: 0
         a flex child refuses to go below its content width, and the due row's
         time field then pushes the body into a horizontal scrollbar — which is
         a scrollable ancestor around a calendar, the exact thing this ticket
         removes. Seen in a browser, not predicted. */
      .am-task-form,
      .am-task-form > *,
      .am-dateview > * {
        min-inline-size: 0;
      }

      .am-dateview {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-inline-size: 0;
      }

      .am-due__row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        block-size: 36px;
        min-inline-size: 0;
      }

      .am-due__date {
        flex: 1 1 auto;
        min-inline-size: 0;
      }

      /* ::ng-deep for the INNER input, matching field.component.ts. The
         <p-inputmask> host element carries this component's content attribute
         and can be styled directly; the <input> PrimeNG renders inside it
         cannot, so sizing only the wrapper left a 305px input inside an 84px
         box — which overflowed the body horizontally and clipped the time
         field off the dialog's edge. Measured in a browser. */
      .am-due__row .p-inputmask {
        flex: none;
        inline-size: 84px;
      }

      .am-due__row ::ng-deep .p-inputmask input {
        inline-size: 84px;
        min-inline-size: 0;
      }

      .am-due__zone {
        font-size: 12px;
        color: var(--am-ink-500);
        font-variant-numeric: tabular-nums;
      }

      .am-presets {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
        margin-block-start: 0.375rem;
        block-size: 30px;
        overflow: hidden;
      }

      .am-presets__chip {
        border: 1px solid var(--am-control-border);
        background: var(--am-control-bg);
        color: var(--am-ink-900);
        border-radius: 999px;
        padding: 4px 11px;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
      }

      .am-presets__chip--on {
        background: var(--am-primary-100);
        border-color: var(--am-primary-600);
        color: var(--am-primary-700);
        font-weight: 600;
      }

      .am-presets__chip:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }

      /* The reserved message slot: always 17px, so a warning appearing never
         changes the dialog's height and the footer cannot move under the
         cursor mid-click. */
      .am-due__resolved {
        margin: 0;
        min-block-size: 17px;
        font-size: 12px;
        line-height: 17px;
        color: var(--am-ink-500);
      }

      /* The reserved slot, always present so the footer cannot move under the
         cursor when a warning appears. A warning that WRAPS adds a line, which
         the drawing budgets for explicitly ("second warning line 17"). */
      .am-due__messages {
        display: flex;
        flex-direction: column;
        min-block-size: 17px;
      }

      .am-due__warn {
        color: var(--am-warning-ink);
      }

      .am-due__error {
        color: var(--am-danger-ink);
      }

      .am-hint {
        font-size: 12px;
        line-height: 17px;
        color: var(--am-ink-500);
      }

      .am-task-form__footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
    `,
  ],
})
export class TaskFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  private readonly userService = inject(UserService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  readonly dueDates = inject(DueDateService);
  private readonly layers = inject(LayerStackService);
  private readonly destroyRef = inject(DestroyRef);

  readonly saved = output<void>();
  readonly cancelled = output<void>();
  /**
   * ACC-96 — lets the host pass [dirty] to EditDialogComponent, so Escape asks
   * before discarding. The input is on the DIALOG, which this component sits
   * inside, so the state has to travel outward.
   */
  readonly dirtyChange = output<boolean>();
  /**
   * Emits THIS instance so the host can render app-task-form-footer inside the
   * dialog's own fixed footer.
   *
   * Handing the host a TemplateRef was the first attempt and does not work:
   * p-dialog collects pTemplate children at CONTENT INIT, and a footer that
   * arrives from a projected component's ngAfterViewInit is already too late —
   * it silently rendered no footer at all. The host's footer template must
   * exist from the start, so what travels outward is the instance, not the
   * markup.
   */
  readonly ready = output<TaskFormComponent>();

  // ACC-76 — set by a record's own detail page. Both or neither.
  readonly lockedSourceType = input<string | null>(null);
  readonly lockedSourceId = input<string | null>(null);
  readonly lockedSourceLabel = input<string | null>(null);

  readonly isSourceLocked = computed(
    () => !!this.lockedSourceType() && !!this.lockedSourceId() && !!this.lockedSourceLabel(),
  );

  readonly steps = [
    { n: 1 as const, key: 'task.step1' },
    { n: 2 as const, key: 'task.step2' },
  ];

  readonly step = signal<1 | 2>(1);
  readonly dateView = signal(false);
  readonly saving = signal(false);
  readonly sourceTypes = SOURCE_TYPES;
  readonly priorities = PRIORITIES;
  readonly users = signal<IUserDto[]>([]);

  // ── The due value ──────────────────────────────────────────────────────
  //
  // One signal holds the instant; the two fields are projections of it. A
  // separate `typedDate` holds what the user is part-way through writing, so
  // re-rendering mid-keystroke cannot rewrite the text under the cursor.
  private readonly due = signal<Date | null>(null);
  private readonly typedDate = signal<string | null>(null);
  private readonly now = signal(new Date());
  readonly activePreset = signal<string | null>(null);

  readonly dueDay = computed(() => this.due());

  readonly dueDateText = computed(
    () => this.typedDate() ?? (this.due() ? this.format.dateForInput(this.due()) : ''),
  );

  readonly dueTimeText = computed(() => {
    const at = this.due();
    if (!at) return '';
    return `${`${at.getHours()}`.padStart(2, '0')}:${`${at.getMinutes()}`.padStart(2, '0')}`;
  });

  readonly presets = computed<DuePreset[]>(() => {
    this.dueDates.ready();
    return this.dueDates.presets(this.now());
  });

  readonly warning = computed(() => this.dueDates.warningFor(this.due(), this.now()));

  readonly resolvedText = computed(() => {
    const at = this.due();
    if (!at) return this.translate.instant('task.due.none');
    return this.format.dateTimeForInput(at);
  });

  readonly warningText = computed(() => {
    const w = this.warning();
    const resumes = (at: Date): string => this.format.dateTimeForInput(at);
    // The tenant zone is named only when the reader's clock is not the SLA's.
    // Where they agree, saying it adds a word and no information.
    const zoneNote = this.dueDates.zoneMismatch()
      ? ` ${this.translate.instant('task.due.zoneNote', { zone: this.dueDates.tenantZone() })}`
      : '';
    if (w.kind === 'nonWorkingDay') {
      return (
        this.translate.instant('task.due.nonWorkingDay', {
          weekday: w.weekday,
          resumesAt: resumes(w.resumesAt),
        }) + zoneNote
      );
    }
    if (w.kind === 'outsideHours') {
      return (
        this.translate.instant('task.due.outsideHours', {
          time: this.dueTimeText(),
          start: w.start,
          end: w.end,
          // `weekdays`, not `days`: the i18n guard reserves {{days}} for a
          // COUNT, and this is a list of weekday names ("Sun–Thu").
          weekdays: w.days,
          resumesAt: resumes(w.resumesAt),
        }) + zoneNote
      );
    }
    return '';
  });

  readonly assigneeCount = signal(0);
  readonly assigneeSummary = computed(() =>
    this.translate.instant('common.selectedCount', { count: this.assigneeCount() }),
  );

  /**
   * Create is offered on step 1 only when every REQUIRED field lives there.
   *
   * With the source locked — a task raised from a committee, which is the
   * normal case and the one Template 3 draws — nothing on step 2 is required,
   * so the ten-second path is title, +2h, Create. With the source unfilled,
   * sourceType and sourceId are required and live on step 2, so Create waits
   * there. That is Template 3's own rule: "use Create from there when step 2
   * has no required fields".
   */
  readonly canCreateFromStep1 = computed(() => {
    if (this.saving()) return false;
    if (!this.isSourceLocked()) return false;
    if (this.warning().kind === 'past') return false;
    return this.titleValid();
  });

  private readonly titleValid = signal(false);

  readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(255)]],
    description: ['', [Validators.maxLength(2000)]],
    sourceType: ['DOCUMENT', [Validators.required]],
    sourceId: ['', [Validators.required]],
    assigneeUserIds: [[] as string[]],
    priority: ['MEDIUM'],
    dueDate: [null as Date | null],
  });

  private dateViewLayerId: number | null = null;

  constructor() {
    // THE DATE VIEW IS A LAYER, even though nothing floats.
    //
    // Artboard 12's Escape ladder: the first press collapses the calendar and
    // leaves the dialog open, "otherwise a user who opened it to look at next
    // month loses the whole form to a single key". Without registering,
    // EditDialogComponent's own capture-phase handler answers first and a dirty
    // form goes straight to "Discard this task?" with the calendar still open —
    // observed in a browser, and the exact failure LayerStackService exists to
    // prevent for floating pickers.
    effect(() => {
      const open = this.dateView();
      if (open && this.dateViewLayerId === null) {
        this.dateViewLayerId = this.layers.push();
      } else if (!open && this.dateViewLayerId !== null) {
        this.layers.remove(this.dateViewLayerId);
        this.dateViewLayerId = null;
      }
    });

    // Bubble phase, not capture: EditDialogComponent listens in capture and
    // returns early once it sees it is not on top, so by the time this runs the
    // dialog has already declined. Listening in capture here would race it.
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

    effect(() => {
      if (!this.isSourceLocked()) return;
      this.form.patchValue({
        sourceType: this.lockedSourceType(),
        sourceId: this.lockedSourceId(),
      });
      this.form.controls.sourceType.disable();
      this.form.controls.sourceId.disable();
    });
  }

  ngOnInit(): void {
    this.dueDates.load();

    this.userService.listAllUsers({ status: 'ACTIVE' }).subscribe({
      next: (users) => this.users.set(users),
      error: () => this.users.set([]),
    });

    this.ready.emit(this);
    this.titleValid.set(this.form.controls.title.valid);
    this.form.valueChanges.subscribe(() => {
      this.titleValid.set(this.form.controls.title.valid);
      this.assigneeCount.set((this.form.controls.assigneeUserIds.value ?? []).length);
      // Opening a calendar, changing month or focusing a field is NOT a change
      // (artboard 12's own rule for what counts as dirty), so this follows the
      // form's own dirty flag rather than any view state.
      this.dirtyChange.emit(this.form.dirty);
    });
  }

  // ── Step and view ──────────────────────────────────────────────────────

  goToStep(n: 1 | 2): void {
    this.commitTypedDate();
    this.dateView.set(false);
    this.step.set(n);
  }

  toggleDateView(): void {
    this.commitTypedDate();
    // Recomputed on open so a dialog left sitting does not offer "+2h" from
    // an hour ago.
    this.now.set(new Date());
    this.dateView.set(!this.dateView());
  }

  closeDateView(): void {
    this.dateView.set(false);
    setTimeout(() => document.getElementById('dueDate')?.focus());
  }

  // ── The due value ──────────────────────────────────────────────────────

  onDayPicked(day: Date | null): void {
    if (!day) {
      this.setDue(null);
      return;
    }
    // Same rule as a typed date, through the same helper: a time already set
    // wins, otherwise the end of that day's working hours. Picking 25 Sep in
    // the grid and typing "25 Sep 2026" are the same statement, so they must
    // not produce different times — and the day is usually chosen before the
    // time, so a pick must never strand one nobody chose.
    this.setDue(this.withResolvedTime(day));
  }

  onTimeTyped(hm: string): void {
    const m = /^(\d{2}):(\d{2})$/.exec(hm ?? '');
    if (!m) return;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) return;
    const at = new Date(this.due() ?? new Date());
    at.setHours(hour, minute, 0, 0);
    this.setDue(at);
  }

  onDateTyped(text: string): void {
    this.typedDate.set(text);
  }

  /**
   * On BLUR, not per keystroke — "15 Sep" is not yet a date, and validating it
   * as one would put an error under someone mid-word. Same parse and the same
   * invalidDate error shape as public-holiday-form: one way to fail, not two.
   */
  commitTypedDate(): void {
    const text = this.typedDate();
    if (text === null) return;

    const control = this.form.controls.dueDate;
    const trimmed = text.trim();

    if (trimmed === '') {
      this.setDue(null);
      return;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      control.setErrors({ ...(control.errors ?? {}), invalidDate: true });
      control.markAsDirty();
      return;
    }

    this.setDue(this.withResolvedTime(parsed));
  }

  /**
   * A date the user named, given the time it should carry.
   *
   * A TIME ALREADY SET WINS — typed, picked or from a preset. Otherwise the
   * day takes the tenant's end of working hours (Ahmad, 2026-09-22), because
   * midnight is what the parser returns and almost never what anyone means: a
   * task "due Thursday" is due by the end of Thursday, not at the very start
   * of it, and 00:00 also made every typed date warn about being out of hours.
   *
   * On a non-working day or a holiday it still takes that same configured end
   * time, and the warning then says so — see endOfDayFor().
   */
  private withResolvedTime(day: Date): Date {
    const at = new Date(day);
    const current = this.due();
    if (current) {
      at.setHours(current.getHours(), current.getMinutes(), 0, 0);
      return at;
    }
    const endOfDay = this.dueDates.endOfDayFor(at);
    if (endOfDay) at.setHours(endOfDay.getHours(), endOfDay.getMinutes(), 0, 0);
    return at;
  }

  applyPreset(preset: DuePreset): void {
    this.setDue(new Date(preset.at));
    this.activePreset.set(preset.key);
  }

  private setDue(at: Date | null): void {
    this.due.set(at);
    this.typedDate.set(null);
    if (at === null) this.activePreset.set(null);

    const control = this.form.controls.dueDate;
    if (control.hasError('invalidDate')) {
      const { invalidDate: _cleared, ...rest } = control.errors ?? {};
      control.setErrors(Object.keys(rest).length > 0 ? rest : null);
    }
    control.setValue(at);
    control.markAsDirty();
  }

  // ── Submit ─────────────────────────────────────────────────────────────

  onSubmit(): void {
    // Create can be reached straight from the date field without a blur, so
    // the typed text is committed here too, or a value the user can see would
    // not be submitted.
    this.commitTypedDate();

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Send the user to the step that holds the problem rather than leaving
      // Create apparently dead.
      if (this.form.controls.sourceId.invalid || this.form.controls.sourceType.invalid) {
        this.step.set(2);
      }
      return;
    }
    this.saving.set(true);

    const value = this.form.getRawValue();
    this.taskService
      .create({
        title: value.title!,
        description: value.description || undefined,
        sourceType: value.sourceType!,
        sourceId: value.sourceId!,
        priority: value.priority ?? undefined,
        dueDate: value.dueDate ? value.dueDate.toISOString() : undefined,
        // Empty is a real, supported outcome: TaskService.create() records an
        // UNASSIGNED task. A task worth recording now is worth recording
        // before its owner is known.
        assigneeUserIds: value.assigneeUserIds ?? [],
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.saved.emit();
        },
        error: () => this.saving.set(false),
      });
  }
}
