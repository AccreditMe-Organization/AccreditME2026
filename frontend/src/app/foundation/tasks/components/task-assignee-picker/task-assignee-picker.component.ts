import { Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MessageModule } from 'primeng/message';
import { EMPTY, Observable, catchError, distinctUntilChanged, of, startWith, switchMap, tap } from 'rxjs';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { aiRefusal } from '../../../../core/ai/ai-refusal';
import { refusalCode } from '../../../../core/http/refusal';
import {
  AssignTargetDto,
  AssignableCommitteeRoleDto,
  AssignableHolderDto,
  AssignablePositionDto,
  AssignableUnitDto,
  AssignRecordRef,
  HolderWorkloadDto,
  TaskPriority,
  TaskService,
  WorkloadHintDto,
} from '../../services/task.service';
import { TaskWorkloadHintComponent, WorkloadHintState, WorkloadHintView } from './task-workload-hint.component';
import { TaskWorkloadHintStore, WorkloadAnswer } from './task-workload-hint.store';

/** The value the scope field holds for "this task's committee" rather than a unit. */
export const COMMITTEE_SCOPE = '__committee__';

export type AssignGroup = FormGroup<{
  /** An org unit id, or COMMITTEE_SCOPE. */
  scope: FormControl<string | null>;
  /** A position id under a unit, a member-role value id under the committee. */
  target: FormControl<string | null>;
  /** Optional: one person in the pool. */
  userId: FormControl<string | null>;
}>;

// A target is needed once a scope is chosen, whether or not choosing anyone
// was required: "Pharmacy" alone says nothing about who does the work.
function targetWhenScoped(control: AbstractControl): ValidationErrors | null {
  return control.parent?.get('scope')?.value && !control.value ? { required: true } : null;
}

/**
 * The picker's form group. `required` is the reassign dialog's case — a
 * reassignment has to name somewhere — while the task form may leave it
 * empty and create the task unassigned, as it always could.
 */
export function createAssignGroup(required: boolean): AssignGroup {
  return new FormGroup({
    scope: new FormControl<string | null>(null, required ? [Validators.required] : []),
    target: new FormControl<string | null>(null, [targetWhenScoped]),
    userId: new FormControl<string | null>(null),
  });
}

/** The group's value as the API's `assignTo`, or null when nothing is chosen. */
export function toAssignTarget(group: AssignGroup, committeeId: string | null): AssignTargetDto | null {
  const { scope, target, userId } = group.getRawValue();
  if (!scope || !target) return null;
  const person = userId ? { userId } : {};
  if (scope === COMMITTEE_SCOPE) {
    return committeeId ? { kind: 'COMMITTEE_ROLE', committeeId, roleValueId: target, ...person } : null;
  }
  return { kind: 'POSITION', orgUnitId: scope, positionId: target, ...person };
}

interface UnitOption {
  label: string;
  value: string;
  items?: UnitOption[];
}

interface TargetOption {
  id: string;
  label: string;
  meta: string;
  /** ACC-199 — a person's open tasks on the record ("12 open"), and overdue ("3 overdue"). */
  open?: string;
  overdue?: string;
}

/** ACC-199 — a press that failed: said, not kept, so it can be tried again. */
interface WorkloadFailure {
  key: string;
  text: string;
  retryable: boolean;
}

/**
 * Who a task goes to — ACC-167 (decisions 1 and 2), shared by New task and
 * Reassign.
 *
 * Chosen the way the organisation is shaped: a unit, then a position in it,
 * then optionally one of the people holding that position there. On a
 * committee's own task the first field also offers the committee, and the
 * second becomes its member roles. ROLE (the permission role) is never
 * offered: it reached every holder anywhere in the tenant, with no
 * connection to the work.
 *
 * ## The outcome line says what will happen before Save does it
 *
 * The server decides the outcome, and the line under the person field states
 * that same rule, in the order the server applies it:
 *
 *   a person chosen          → goes to that person
 *   single-holder position   → goes to its holder; with none, waits unassigned
 *   anything else            → a pool; the first member to pick it up takes it
 *
 * A committee role always pools unless a person is chosen — roles have no
 * single-holder flag.
 *
 * ## No users:view
 *
 * Every list comes from the task picker endpoints, which answer to
 * tasks:create — or, given `taskId`, to whoever may reassign that task. This
 * is what closes ACC-166: a creator who cannot list the tenant's users can
 * still choose who gets their task. The people shown are only a position's
 * holders or a role's members, with their name and position — nothing else.
 *
 * ## Layout
 *
 * `stacked` (Reassign): unit and position share a row, the person takes the
 * next, and the outcome is the person field's hint. `row` (New task): all
 * three in one row, the outcome on a line beneath. New task's step 1 measured
 * 414px against the 420 cap stacked — too close to call a fit, and a pool's
 * outcome wraps to a second line — so it takes the row.
 *
 * ## purpose: 'stage-task' (ACC-208)
 *
 * A stage's task definition chooses the same way, but nothing is placed now:
 * every record entering the stage gets its own task, resolved then. So the
 * outcome line speaks of each entry, not of this save — "whoever holds the
 * position when a record enters" — and still says when nobody holds it today.
 * The lists and the rules are the task picker's own; the server answers to
 * workflows:manage for this use (ACC-208, B4).
 *
 * ## Workload on the record, and "✦ Suggest someone" (ACC-199)
 *
 * When the dialog was opened from a record (the committee or meeting:
 * `sourceType` + `sourceId`), each person row shows their open and overdue
 * tasks ON THAT RECORD — for a caller who can see the record's task list; the
 * server withholds them otherwise, and the rows are as before. Never on a stage
 * task definition: nobody is given a task when one is saved.
 *
 * When the chosen person is past the server's threshold (`canSuggest`) and AI
 * is available, "✦ Suggest someone" sits at the end of the outcome line. ONLY A
 * PRESS calls the model (Ahmad, 14 Oct, Q2). The answer is kept per person for
 * the dialog: pressing again for the same person shows it with no call. Assign
 * … instead sets Person and tells the host (`hintFollowed`), which sends the
 * claim on save; Keep … returns the plain outcome.
 */
@Component({
  selector: 'app-task-assignee-picker',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, MessageModule, FieldComponent, OverlaySelectComponent, TaskWorkloadHintComponent],
  template: `
    @if (unavailable()) {
      <p-message severity="info" [text]="'task.assign.unavailable' | translate" />
    } @else {
      <div [formGroup]="group()" class="am-picker" [class.am-picker--row]="layout() === 'row'">
        <div class="am-picker__pair">
          <am-field
            [label]="(offersCommittee() ? 'task.assign.unitOrCommittee' : 'task.assign.unit') | translate"
            [control]="group().controls.scope"
            [forceShowErrors]="forceShowErrors()"
            [loading]="unitsLoading()"
          >
            <app-overlay-select
              formControlName="scope"
              [options]="scopeOptions()"
              optionLabel="label"
              optionValue="value"
              optionGroupLabel="label"
              optionGroupChildren="items"
              [showClear]="!required()"
              [placeholder]="'task.assign.chooseUnit' | translate"
            />
          </am-field>

          <am-field
            [label]="(isCommitteeScope() ? 'task.assign.role' : 'task.assign.position') | translate"
            [control]="group().controls.target"
            [forceShowErrors]="forceShowErrors()"
            [loading]="targetsLoading()"
          >
            <app-overlay-select
              formControlName="target"
              [options]="targetOptions()"
              optionLabel="label"
              optionValue="id"
              [itemTemplate]="metaItem"
              [placeholder]="
                (scope() ? (isCommitteeScope() ? 'task.assign.chooseRole' : 'task.assign.choosePosition') : 'task.assign.chooseUnitFirst')
                  | translate
              "
            />
          </am-field>
        </div>

        <am-field
          class="am-picker__person"
          [label]="'task.assign.person' | translate"
          [control]="group().controls.userId"
          [hint]="layout() === 'row' || workloadState() ? '' : outcome()"
          [message]="layout() === 'stacked' && workloadState() ? 'none' : 'reserved'"
          [loading]="peopleLoading()"
        >
          <app-overlay-select
            formControlName="userId"
            [options]="peopleOptions()"
            optionLabel="label"
            optionValue="id"
            [itemTemplate]="personItem"
            [panelMinWidth]="record() ? personPanelMinWidth : null"
            [showClear]="true"
            [placeholder]="(target() ? 'task.assign.anyone' : 'task.assign.chooseTargetFirst') | translate"
          />
        </am-field>
      </div>
      <!-- In a row, a third of the width is no place for a sentence: the
           outcome spans the row beneath instead of being the person's hint. -->
      @if (workloadState(); as state) {
        <!-- ACC-199 — the outcome line with "✦ Suggest someone", or its answer. -->
        <app-task-workload-hint
          class="am-picker__workload"
          [state]="state"
          [outcome]="outcome()"
          [view]="hintView()"
          [refusalText]="hintFailureText()"
          [retryable]="hintRetryable()"
          [inline]="layout() === 'stacked'"
          (suggest)="suggestSomeone()"
          (assign)="assignSuggested()"
          (keep)="keepChosen()"
        />
      } @else if (layout() === 'row' && outcome()) {
        <p class="am-picker__outcome" aria-live="polite">{{ outcome() }}</p>
      }
    }

    <!-- ACC-199 — a person: the name and position as metaItem draws them, and
         at the row's end edge their open and overdue tasks on the record, on
         one line, so the row is no taller. -->
    <ng-template #personItem let-option>
      <span class="am-picker__person-row">
        <span class="flex flex-col min-w-0">
          <span>{{ option.label }}</span>
          @if (option.meta) {
            <span class="text-meta text-[var(--am-ink-500)]">{{ option.meta }}</span>
          }
        </span>
        @if (option.open) {
          <span class="am-picker__counts">
            {{ option.open }}
            @if (option.overdue) {
              · <span class="am-picker__overdue">{{ option.overdue }}</span>
            }
          </span>
        }
      </span>
    </ng-template>

    <!-- A name with a second, quieter line: a position's holder count, a
         role's member count, a person's own position (two people can share
         a name; their positions tell them apart). -->
    <ng-template #metaItem let-option>
      <span class="flex flex-col">
        <span>{{ option.label }}</span>
        @if (option.meta) {
          <span class="text-meta text-[var(--am-ink-500)]">{{ option.meta }}</span>
        }
      </span>
    </ng-template>
  `,
  styles: [
    `
      .am-picker {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-12);
      }
      .am-picker__pair {
        display: flex;
        gap: var(--am-space-16);
      }
      .am-picker__pair > * {
        flex: 1 1 0;
        min-width: 0;
      }
      /* One row of three: the pair takes two columns, the person the third. */
      .am-picker--row {
        flex-direction: row;
        gap: var(--am-space-16);
      }
      .am-picker--row .am-picker__pair {
        flex: 2 1 0;
        min-width: 0;
      }
      .am-picker--row .am-picker__person {
        flex: 1 1 0;
        min-width: 0;
      }
      /* ACC-199 — the counts share the row's end edge with the name, on one line. */
      .am-picker__person-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-12);
        width: 100%;
      }
      .am-picker__counts {
        flex: none;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-500);
        white-space: nowrap;
      }
      .am-picker__overdue {
        color: var(--am-warning-ink);
        font-weight: 600;
      }
      /* In a row (New task) the line sits under the row, as the outcome did. In
         Reassign it takes the place of the Person field's own message slot,
         which it gives up (message="none": a person can never be invalid), so
         the hint costs only its own lines. */
      .am-picker__workload {
        margin-block-start: var(--am-space-4);
      }
      .am-picker__outcome {
        margin: 0;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-500);
      }
    `,
  ],
})
export class TaskAssigneePickerComponent implements OnInit {
  private readonly taskService = inject(TaskService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly access = inject(NavigationAccessService);
  private readonly destroyRef = inject(DestroyRef);

  readonly group = input.required<AssignGroup>();
  /** The task's source: a COMMITTEE source adds the committee route. */
  readonly sourceType = input<string | null>(null);
  readonly sourceId = input<string | null>(null);
  /** Shown for the committee option; a generic label when the host has none. */
  readonly committeeName = input<string | null>(null);
  /** The task being reassigned — how its creator reaches the picker without tasks:create. */
  readonly taskId = input<string | undefined>(undefined);
  readonly required = input(false);
  readonly forceShowErrors = input(false);
  /** 'stacked': unit and position, then person (Reassign). 'row': all three in one row (New task). */
  readonly layout = input<'stacked' | 'row'>('stacked');
  /** 'task': one task, placed on save. 'stage-task': a stage's definition, placed at each entry (ACC-208). */
  readonly purpose = input<'task' | 'stage-task'>('task');
  /** ACC-199 — the task's priority, for "✦ Suggest someone". */
  readonly priority = input<TaskPriority | null>(null);

  /**
   * ACC-199 — "Assign … instead" was pressed: the suggestion's AI call and the
   * person it named. The host sends it on save while that person is still the
   * one chosen.
   */
  readonly hintFollowed = output<{ id: string; userId: string }>();

  private readonly units = signal<AssignableUnitDto[]>([]);
  private readonly positions = signal<AssignablePositionDto[]>([]);
  private readonly roles = signal<AssignableCommitteeRoleDto[]>([]);
  private readonly people = signal<AssignableHolderDto[]>([]);

  readonly unitsLoading = signal(true);
  readonly targetsLoading = signal(false);
  readonly peopleLoading = signal(false);
  readonly unavailable = signal(false);

  readonly scope = signal<string | null>(null);
  readonly target = signal<string | null>(null);
  private readonly userId = signal<string | null>(null);

  readonly isCommitteeScope = computed(() => this.scope() === COMMITTEE_SCOPE);

  // ── ACC-199 — workload on the record, and "✦ Suggest someone" ─────────────

  /** ACC-199 — the Person list is wide enough for a name, its position and the counts on one row each. */
  readonly personPanelMinWidth = 360;

  /** The record the dialog was opened from. None on a stage task definition. */
  readonly record = computed<AssignRecordRef | null>(() => {
    const sourceType = this.sourceType();
    const sourceId = this.sourceId();
    return this.purpose() === 'task' && sourceType && sourceId ? { sourceType, sourceId } : null;
  });

  /** The dialog's store when it provides one (New task, Reassign); else the picker's own. */
  private readonly hintStore = inject(TaskWorkloadHintStore, { optional: true }) ?? new TaskWorkloadHintStore();
  private readonly hintAvailable = computed(() => this.hintStore.available() === true);
  private readonly answers = this.hintStore.answers;
  /** The person whose answer is on screen (a press, or a press again). */
  private readonly shownKey = signal<string | null>(null);
  private readonly workingKey = signal<string | null>(null);
  private readonly failure = signal<WorkloadFailure | null>(null);

  /** One answer per person under one target: the counts, and the others, are that target's. */
  private readonly chosenKey = computed(() => {
    const target = this.target();
    const userId = this.userId();
    return target && userId ? `${target}|${userId}` : null;
  });

  readonly workloadState = computed<WorkloadHintState | null>(() => {
    const key = this.chosenKey();
    if (!key || !this.record()) return null;
    if (this.workingKey() === key) return 'working';
    if (this.shownKey() === key) return this.answers().get(key)?.kind === 'hint' ? 'shown' : 'refusal';
    if (this.failure()?.key === key) return 'refusal';
    const person = this.people().find((p) => p.id === this.userId());
    return this.hintAvailable() && person?.workload?.canSuggest ? 'offer' : null;
  });

  readonly hintView = computed<WorkloadHintView | null>(() => {
    const key = this.chosenKey();
    const answer = key ? this.answers().get(key) : undefined;
    if (answer?.kind !== 'hint') return null;
    const { chosen, suggestion } = answer.hint;
    const chosenName = this.people().find((p) => p.id === chosen.userId)?.name ?? '';
    const record = this.recordPhrase();
    const first = this.translate.instant(chosen.overdueCount > 0 ? 'task.workload.chosen' : 'task.workload.chosenNoOverdue', {
      name: chosenName,
      open: this.format.count('task.workloadOpenTasks', chosen.openCount),
      record,
      overdue: this.format.count('task.overdue', chosen.overdueCount),
    });
    const position = suggestion.positionNameEn ? this.language.bilingual(suggestion.positionNameEn, suggestion.positionNameAr) : '';
    const second = this.translate.instant(position ? 'task.workload.alternative' : 'task.workload.alternativeNoPosition', {
      name: suggestion.name,
      position,
      open: this.format.count('task.workloadAltOpen', suggestion.openCount),
    });
    return {
      sentence: `${first} ${second}`,
      assignLabel: this.translate.instant('task.workload.assignInstead', { name: suggestion.name }),
      keepLabel: this.translate.instant('task.workload.keep', { name: chosenName }),
    };
  });

  readonly hintFailureText = computed(() => {
    const key = this.chosenKey();
    if (key && this.shownKey() === key && this.answers().get(key)?.kind === 'none') {
      return this.translate.instant('task.workload.noSuggestion');
    }
    const failure = this.failure();
    return failure && failure.key === key ? failure.text : '';
  });

  readonly hintRetryable = computed(() => {
    const failure = this.failure();
    return !!failure && failure.key === this.chosenKey() && failure.retryable;
  });

  private recordPhrase(): string {
    const type = this.record()?.sourceType;
    const key = type === 'COMMITTEE' || type === 'MEETING' ? `task.workload.record.${type}` : 'task.workload.record.other';
    return this.translate.instant(key);
  }

  // The committee route needs committees:view on the server (its member
  // roles name the committee's members), so it is offered only with it.
  readonly offersCommittee = computed(
    () => this.sourceType() === 'COMMITTEE' && !!this.sourceId() && this.access.hasPermission('committees:view'),
  );

  readonly scopeOptions = computed<UnitOption[]>(() => {
    // The list holds ACTIVE units only, so an active unit under a deactivated
    // parent has a parentId nothing matches. It is a root here rather than
    // silently missing from the picker.
    const units = this.units();
    const ids = new Set(units.map((u) => u.id));
    const rooted = units.map((u) => (u.parentId && ids.has(u.parentId) ? u : { ...u, parentId: null }));
    const tree = this.unitTree(rooted, null);
    if (!this.offersCommittee()) return tree;
    const committee = {
      label: this.committeeName() ?? this.translate.instant('task.assign.thisCommittee'),
      value: COMMITTEE_SCOPE,
    };
    return [committee, ...tree];
  });

  readonly targetOptions = computed<TargetOption[]>(() =>
    this.isCommitteeScope()
      ? this.roles().map((r) => ({
          id: r.id,
          label: this.language.bilingual(r.labelEn, r.labelAr),
          meta: this.format.count('committee.members', r.memberCount),
        }))
      : this.positions().map((p) => ({
          id: p.id,
          label: this.language.bilingual(p.nameEn, p.nameAr),
          meta: this.positionMeta(p),
        })),
  );

  readonly peopleOptions = computed<TargetOption[]>(() =>
    this.people().map((h) => ({
      id: h.id,
      label: h.name,
      meta: h.positionNameEn ? this.language.bilingual(h.positionNameEn, h.positionNameAr) : '',
      ...this.workloadCounts(h.workload),
    })),
  );

  /** ACC-199 — "12 open · 3 overdue" for a person row; nothing when the server withheld the counts. */
  private workloadCounts(workload: HolderWorkloadDto | null | undefined): Pick<TargetOption, 'open' | 'overdue'> {
    if (!workload) return {};
    return {
      open: this.format.count('task.workloadRowOpen', workload.openCount),
      ...(workload.overdueCount > 0 ? { overdue: this.format.count('task.workloadRowOverdue', workload.overdueCount) } : {}),
    };
  }

  /** What Save will do with the current choice — the server's rule, stated first. */
  readonly outcome = computed<string>(() => {
    const scope = this.scope();
    const target = this.target();
    if (!scope) return this.required() ? '' : this.translate.instant('task.assign.outcomeNone');
    if (!target) return '';

    const chosen = this.userId();
    if (chosen) {
      const person = this.people().find((p) => p.id === chosen);
      if (!person) return '';
      return this.translate.instant(
        this.purpose() === 'stage-task' ? 'workflow.stageTaskForm.outcomePerson' : 'task.assign.outcomePerson',
        { name: person.name },
      );
    }

    if (scope === COMMITTEE_SCOPE) {
      const role = this.roles().find((r) => r.id === target);
      return role ? this.poolOutcome(role.memberCount) : '';
    }

    const position = this.positions().find((p) => p.id === target);
    if (!position) return '';
    if (this.purpose() === 'stage-task') {
      // Resolved at each entry: say so, and say when nobody holds it today.
      return this.translate.instant(
        position.holderCount === 0 ? 'workflow.stageTaskForm.outcomeVacant' : 'workflow.stageTaskForm.outcomeAnyone',
      );
    }
    if (position.isSingleAssignee) {
      if (this.peopleLoading()) return '';
      const holder = this.people()[0];
      return holder
        ? this.translate.instant('task.assign.outcomePerson', { name: holder.name })
        : this.translate.instant('task.assign.outcomeVacant');
    }
    return this.poolOutcome(position.holderCount);
  });

  ngOnInit(): void {
    const { scope, target, userId } = this.group().controls;

    this.taskService
      .getAssignableUnits(this.taskId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (units) => {
          this.units.set(units);
          this.unitsLoading.set(false);
        },
        error: () => {
          this.unitsLoading.set(false);
          this.unavailable.set(true);
        },
      });

    // A new scope empties what hung off the old one, then loads its positions
    // or roles. switchMap drops a slow answer for a scope already left.
    //
    // The FIRST emission is the value the group already holds — a host that
    // destroys and recreates the picker (New task's step 2 and date view do)
    // hands it back a choice in progress. That one loads the lists and clears
    // nothing; only a change the user makes empties what depended on it.
    let scopeSeen = false;
    scope.valueChanges
      .pipe(
        startWith(scope.value),
        distinctUntilChanged(),
        tap((value) => {
          this.scope.set(value);
          this.positions.set([]);
          this.roles.set([]);
          if (scopeSeen && target.value !== null) target.setValue(null);
          scopeSeen = true;
          target.updateValueAndValidity();
        }),
        switchMap((value) => this.loadTargets(value)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    let targetSeen = false;
    target.valueChanges
      .pipe(
        startWith(target.value),
        distinctUntilChanged(),
        tap((value) => {
          this.target.set(value);
          this.people.set([]);
          if (targetSeen && userId.value !== null) userId.setValue(null);
          targetSeen = true;
        }),
        switchMap((value) => this.loadPeople(value)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    userId.valueChanges.pipe(startWith(userId.value), takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.userId.set(value);
      // ACC-199 — an answer on screen belongs to the person it was for. It is
      // kept: choosing them again offers the button, and a press shows it free.
      this.shownKey.set(null);
    });

  }

  /** ACC-199 — the chosen person is past the server's threshold. */
  private readonly chosenCanSuggest = computed(
    () => !!this.record() && !!this.people().find((p) => p.id === this.userId())?.workload?.canSuggest,
  );
  private availabilityAsked = false;

  constructor() {
    // ACC-199 — whether "✦ Suggest someone" can be offered at all: asked once
    // per dialog, and only the first time it could matter — a chosen person
    // past the threshold. Most choices never ask.
    effect(() => {
      if (!this.chosenCanSuggest() || this.hintStore.available() !== null || this.availabilityAsked) return;
      this.availabilityAsked = true;
      untracked(() =>
        this.taskService
          .getWorkloadHintAvailability()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: ({ available }) => this.hintStore.available.set(available),
            error: () => this.hintStore.available.set(false),
          }),
      );
    });
  }

  /** ACC-199 — the press. A kept answer is shown again with no call. */
  suggestSomeone(): void {
    const key = this.chosenKey();
    const record = this.record();
    const scope = this.scope();
    const target = this.target();
    const chosenUserId = this.userId();
    if (!key || !record || !scope || !target || !chosenUserId || this.workingKey()) return;
    this.failure.set(null);
    if (this.answers().has(key)) {
      this.shownKey.set(key);
      return;
    }
    const where =
      scope === COMMITTEE_SCOPE ? { committeeId: record.sourceId, roleValueId: target } : { orgUnitId: scope, positionId: target };
    this.workingKey.set(key);
    this.taskService
      .workloadHint({
        ...where,
        chosenUserId,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        ...(this.priority() ? { priority: this.priority()! } : {}),
        ...(this.taskId() ? { taskId: this.taskId() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (hint) => {
          this.keep(key, { kind: 'hint', hint });
          this.workingKey.set(null);
          if (this.chosenKey() === key) this.shownKey.set(key);
        },
        error: (err: unknown) => {
          this.workingKey.set(null);
          const code = refusalCode(err);
          if (code === 'WORKLOAD_NO_SUGGESTION') {
            // An answer — "nobody is clearly better placed" — kept like any other.
            this.keep(key, { kind: 'none' });
            if (this.chosenKey() === key) this.shownKey.set(key);
            return;
          }
          if (code === 'RATE_LIMITED') {
            this.failure.set({ key, text: this.translate.instant('task.workload.tooMany'), retryable: false });
            return;
          }
          const refusal = aiRefusal(err, this.format);
          this.failure.set({
            key,
            text: this.translate.instant(refusal?.messageKey ?? 'ai.refusal.unavailable', refusal?.params ?? {}),
            retryable: !refusal || refusal.kind === 'unavailable',
          });
        },
      });
  }

  /** ACC-199 — "Assign … instead": the suggested person becomes the choice. */
  assignSuggested(): void {
    const key = this.chosenKey();
    const answer = key ? this.answers().get(key) : undefined;
    if (answer?.kind !== 'hint') return;
    const { suggestion, interactionId } = answer.hint;
    this.group().controls.userId.setValue(suggestion.userId);
    this.group().controls.userId.markAsDirty();
    if (interactionId) this.hintFollowed.emit({ id: interactionId, userId: suggestion.userId });
  }

  /** ACC-199 — "Keep …": the plain outcome again; the answer stays kept. */
  keepChosen(): void {
    this.shownKey.set(null);
  }

  private keep(key: string, answer: WorkloadAnswer): void {
    this.hintStore.keep(key, answer);
  }

  private loadTargets(scope: string | null): Observable<unknown> {
    if (!scope) return of(null);
    this.targetsLoading.set(true);
    const done = () => this.targetsLoading.set(false);
    if (scope === COMMITTEE_SCOPE) {
      const committeeId = this.sourceId();
      if (!committeeId) return of(done());
      return this.taskService.getAssignableCommitteeRoles(committeeId, this.taskId()).pipe(
        tap((roles) => {
          this.roles.set(roles);
          done();
        }),
        catchError(() => {
          done();
          return EMPTY;
        }),
      );
    }
    return this.taskService.getAssignablePositions(scope, this.taskId()).pipe(
      tap((positions) => {
        this.positions.set(positions);
        done();
      }),
      catchError(() => {
        done();
        return EMPTY;
      }),
    );
  }

  private loadPeople(target: string | null): Observable<unknown> {
    const scope = this.scope();
    if (!target || !scope) return of(null);
    this.peopleLoading.set(true);
    const request =
      scope === COMMITTEE_SCOPE
        ? this.taskService.getCommitteeAssignees(this.sourceId() ?? '', target, this.taskId(), this.record())
        : this.taskService.getAssignees(scope, target, this.taskId(), this.record());
    return request.pipe(
      tap((people) => {
        this.people.set(people);
        this.peopleLoading.set(false);
      }),
      catchError(() => {
        this.peopleLoading.set(false);
        return EMPTY;
      }),
    );
  }

  private unitTree(all: AssignableUnitDto[], parentId: string | null): UnitOption[] {
    return all
      .filter((u) => u.parentId === parentId)
      .map((u) => {
        const items = this.unitTree(all, u.id);
        return { label: this.language.bilingual(u.nameEn, u.nameAr), value: u.id, ...(items.length ? { items } : {}) };
      });
  }

  private positionMeta(position: AssignablePositionDto): string {
    if (position.isSingleAssignee) {
      return this.translate.instant(
        position.holderCount > 0 ? 'task.assign.singleHolder' : 'task.assign.singleHolderVacant',
      );
    }
    return this.format.count('task.holders', position.holderCount);
  }

  private poolOutcome(count: number): string {
    return count === 0
      ? this.translate.instant('task.assign.outcomeEmptyPool')
      : this.format.count('task.assignPool', count);
  }
}
