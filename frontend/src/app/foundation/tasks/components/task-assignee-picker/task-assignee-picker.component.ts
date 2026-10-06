import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
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
import {
  AssignTargetDto,
  AssignableCommitteeRoleDto,
  AssignableHolderDto,
  AssignablePositionDto,
  AssignableUnitDto,
  TaskService,
} from '../../services/task.service';

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
 * Unit and position share a row, the person field takes the next, and the
 * outcome is the person field's hint. Three field blocks in two rows, so a
 * host keeps its own density.
 */
@Component({
  selector: 'app-task-assignee-picker',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, MessageModule, FieldComponent, OverlaySelectComponent],
  template: `
    @if (unavailable()) {
      <p-message severity="info" [text]="'task.assign.unavailable' | translate" />
    } @else {
      <div [formGroup]="group()" class="flex flex-col gap-3">
        <div class="flex gap-4">
          <am-field
            class="flex-1 min-w-0"
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
            class="flex-1 min-w-0"
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
          [label]="'task.assign.person' | translate"
          [control]="group().controls.userId"
          [hint]="outcome()"
          [loading]="peopleLoading()"
        >
          <app-overlay-select
            formControlName="userId"
            [options]="peopleOptions()"
            optionLabel="label"
            optionValue="id"
            [itemTemplate]="metaItem"
            [showClear]="true"
            [placeholder]="(target() ? 'task.assign.anyone' : 'task.assign.chooseTargetFirst') | translate"
          />
        </am-field>
      </div>
    }

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
    })),
  );

  /** What Save will do with the current choice — the server's rule, stated first. */
  readonly outcome = computed<string>(() => {
    const scope = this.scope();
    const target = this.target();
    if (!scope) return this.required() ? '' : this.translate.instant('task.assign.outcomeNone');
    if (!target) return '';

    const chosen = this.userId();
    if (chosen) {
      const person = this.people().find((p) => p.id === chosen);
      return person ? this.translate.instant('task.assign.outcomePerson', { name: person.name }) : '';
    }

    if (scope === COMMITTEE_SCOPE) {
      const role = this.roles().find((r) => r.id === target);
      return role ? this.poolOutcome(role.memberCount) : '';
    }

    const position = this.positions().find((p) => p.id === target);
    if (!position) return '';
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

    userId.valueChanges
      .pipe(startWith(userId.value), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.userId.set(value));
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
        ? this.taskService.getCommitteeAssignees(this.sourceId() ?? '', target, this.taskId())
        : this.taskService.getAssignees(scope, target, this.taskId());
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
