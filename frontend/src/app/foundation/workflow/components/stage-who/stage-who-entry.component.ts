import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { of, startWith, switchMap } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import type { StageAssigneeKind, WhoEntryField, WhoRulesDto } from '../../services/workflow-template.service';
import { workflowLabelKey } from '../../workflow-labels';
import { StageWhoOptionsStore } from './stage-who-options.store';
import { ALL_MEMBERS, RECORD_CHOICE, WhoRow, routeOfField, rowUnchanged } from './stage-who.model';

interface Option {
  value: string;
  label: string;
  items?: Option[];
}

/**
 * ACC-271 PR 5a — one entry of "Who works this stage" (drawing section 8): its
 * Kind, the fields that kind uses in a fixed slot each, and a named Remove.
 * The kinds offered are the server's `assigneeKinds`; which fields show, and
 * which are required, are its `whoRules`; "the record's unit" / "the record's
 * committee" appear only where its `recordRoutes` allow them.
 *
 * A Fixed position row says how many hold the position in the unit, and warns
 * when nobody does; the warning never blocks Save. A person and a committee are
 * chosen in a list dialog searched on the server, which the section hosts.
 */
@Component({
  selector: 'am-stage-who-entry',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslatePipe, InputTextModule, FieldComponent, OverlaySelectComponent],
  template: `
    @let g = row().group;
    @let n = index() + 1;
    @if (readonly()) {
      <div class="am-who-entry am-who-entry--readonly" [attr.data-who-row]="index()">
        <span class="am-who-entry__ro-kind">{{ kindLabel() }}</span>
        <span class="am-who-entry__ro-value">
          {{ valueText() }}
          @if (subText(); as sub) {
            <span class="am-who-entry__sub">{{ sub }}</span>
          }
        </span>
        @if (starting()) {
          <span class="am-who-entry__chip" data-starting-chip>{{ 'workflow.who.startingChip' | translate }}</span>
        }
      </div>
    } @else {
      <div class="am-who-entry" role="group" [attr.aria-label]="'workflow.who.assigneeN' | translate: { n: n }" [attr.data-who-row]="index()">
        <div class="am-who-entry__kind" data-slot="kind">
          <am-field
            [label]="'workflow.who.kindLabel' | translate"
            [control]="g.controls.kind"
            [errorMessages]="errorsFor('kind')"
            [forceShowErrors]="submitted()"
          >
            <app-overlay-select
              [formControl]="g.controls.kind"
              [options]="kindOptions()"
              optionLabel="label"
              optionValue="value"
              [placeholder]="'workflow.who.chooseKind' | translate"
              [ariaLabel]="('workflow.who.kindLabel' | translate) + ', ' + ('workflow.who.assigneeN' | translate: { n: n })"
              data-who-kind
            />
          </am-field>
          @if (starting()) {
            <span class="am-who-entry__chip" data-starting-chip>{{ 'workflow.who.startingChip' | translate }}</span>
          }
        </div>

        <div class="am-who-entry__fields">
          @for (field of usedFields(); track field) {
            <div class="am-who-entry__field" [attr.data-slot]="field">
              @switch (field) {
                @case ('userId') {
                  <am-field [label]="fieldLabel(field)" [control]="g.controls.userId" [errorMessages]="errorsFor(field)" [forceShowErrors]="submitted()">
                    <div class="am-who-entry__pick">
                      <input
                        pInputText
                        readonly
                        class="am-who-entry__pick-text"
                        [id]="'who-' + row().key + '-user'"
                        [value]="row().userName() ?? ''"
                        [placeholder]="'workflow.who.choosePerson' | translate"
                        (click)="pickPerson.emit()"
                        (keydown.enter)="$event.preventDefault(); pickPerson.emit()"
                        data-who-person
                      />
                      <button
                        type="button"
                        class="am-who-entry__pick-button"
                        [attr.aria-label]="('workflow.who.choosePerson' | translate) + ', ' + ('workflow.who.assigneeN' | translate: { n: n })"
                        (click)="pickPerson.emit()"
                        data-who-person-button
                      >
                        <i class="pi pi-search" aria-hidden="true"></i>
                      </button>
                    </div>
                  </am-field>
                }
                @case ('positionId') {
                  <am-field [label]="fieldLabel(field)" [control]="g.controls.positionId" [errorMessages]="errorsFor(field)" [forceShowErrors]="submitted()">
                    <app-overlay-select
                      [formControl]="g.controls.positionId"
                      [options]="positionOptions()"
                      optionLabel="label"
                      optionValue="value"
                      [placeholder]="'workflow.who.choosePosition' | translate"
                      [ariaLabel]="fieldLabel(field) + ', ' + ('workflow.who.assigneeN' | translate: { n: n })"
                      data-who-position
                    />
                  </am-field>
                }
                @case ('orgUnitId') {
                  <am-field
                    [label]="fieldLabel(field)"
                    [control]="g.controls.orgUnitId"
                    [errorMessages]="errorsFor(field)"
                    [forceShowErrors]="submitted()"
                    [hint]="holderHint()"
                  >
                    <app-overlay-select
                      [formControl]="g.controls.orgUnitId"
                      [options]="unitOptions()"
                      optionLabel="label"
                      optionValue="value"
                      optionGroupLabel="label"
                      optionGroupChildren="items"
                      [placeholder]="'workflow.who.chooseUnit' | translate"
                      [ariaLabel]="fieldLabel(field) + ', ' + ('workflow.who.assigneeN' | translate: { n: n })"
                      data-who-unit
                    />
                  </am-field>
                  @if (noHolder()) {
                    <small class="am-who-entry__warn" data-no-holder>{{ 'workflow.who.noHolder' | translate }}</small>
                  }
                }
                @case ('committeeId') {
                  <am-field [label]="fieldLabel(field)" [control]="g.controls.committeeId" [errorMessages]="errorsFor(field)" [forceShowErrors]="submitted()">
                    <div class="am-who-entry__pick">
                      <input
                        pInputText
                        readonly
                        class="am-who-entry__pick-text"
                        [id]="'who-' + row().key + '-committee'"
                        [value]="committeeText()"
                        [placeholder]="'workflow.who.chooseCommittee' | translate"
                        (click)="pickCommittee.emit()"
                        (keydown.enter)="$event.preventDefault(); pickCommittee.emit()"
                        data-who-committee
                      />
                      <button
                        type="button"
                        class="am-who-entry__pick-button"
                        [attr.aria-label]="('workflow.who.chooseCommittee' | translate) + ', ' + ('workflow.who.assigneeN' | translate: { n: n })"
                        (click)="pickCommittee.emit()"
                        data-who-committee-button
                      >
                        <i class="pi pi-search" aria-hidden="true"></i>
                      </button>
                    </div>
                  </am-field>
                  @if (canUseRecordCommittee()) {
                    <button type="button" class="am-who-entry__link" (click)="useRecordCommittee()" data-who-record-committee>
                      {{ 'workflow.who.useRecordCommittee' | translate }}
                    </button>
                  }
                }
                @case ('committeeRoleValueId') {
                  <am-field [label]="fieldLabel(field)" [control]="g.controls.committeeRoleValueId" [errorMessages]="errorsFor(field)" [forceShowErrors]="submitted()">
                    <app-overlay-select
                      [formControl]="g.controls.committeeRoleValueId"
                      [options]="roleOptions()"
                      optionLabel="label"
                      optionValue="value"
                      [ariaLabel]="fieldLabel(field) + ', ' + ('workflow.who.assigneeN' | translate: { n: n })"
                      data-who-role
                    />
                  </am-field>
                }
              }
            </div>
          }
        </div>

        <button
          type="button"
          class="am-who-entry__remove"
          [attr.aria-label]="'workflow.who.removeN' | translate: { n: n }"
          (click)="removed.emit()"
          data-who-remove
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        container-type: inline-size;
      }
      .am-who-entry {
        display: grid;
        grid-template-columns: 170px minmax(0, 1fr) 36px;
        gap: var(--am-space-8) var(--am-space-12);
        align-items: start;
        min-inline-size: 0;
      }
      .am-who-entry > * {
        min-inline-size: 0;
      }
      .am-who-entry__fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
        gap: var(--am-space-8) var(--am-space-12);
        min-inline-size: 0;
      }
      .am-who-entry__field {
        display: flex;
        flex-direction: column;
        min-inline-size: 0;
      }
      .am-who-entry__remove {
        margin-block-start: 22px;
        inline-size: 36px;
        block-size: 36px;
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-control);
        background: var(--am-card);
        color: var(--am-text-secondary);
        font: inherit;
        cursor: pointer;
      }
      .am-who-entry__remove:hover {
        color: var(--am-danger-ink);
        border-color: var(--am-danger-border);
      }
      .am-who-entry__remove:focus-visible,
      .am-who-entry__pick-button:focus-visible,
      .am-who-entry__link:focus-visible {
        outline: 2px solid var(--am-primary-600);
        outline-offset: 2px;
      }
      .am-who-entry__pick {
        display: flex;
        gap: var(--am-space-8);
        align-items: center;
        min-inline-size: 0;
      }
      /* A zero basis: an input's intrinsic width would hold the row wider than a phone. */
      .am-who-entry__pick-text {
        flex: 1 1 0;
        inline-size: 0;
        min-inline-size: 0;
        cursor: pointer;
      }
      .am-who-entry__pick-button {
        flex: none;
        inline-size: 36px;
        block-size: 36px;
        border: 1px solid var(--am-control-border, var(--am-border));
        border-radius: var(--am-radius-control);
        background: var(--am-card);
        cursor: pointer;
      }
      .am-who-entry__chip {
        display: inline-block;
        margin-block-start: var(--am-space-4);
        padding: 1px var(--am-space-8);
        border-radius: 999px;
        border: 1px solid var(--am-info-border);
        background: var(--am-info-bg);
        color: var(--am-info-ink);
        font-size: var(--am-type-meta-size);
        font-weight: 600;
        white-space: nowrap;
      }
      .am-who-entry__warn {
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        font-weight: 500;
        color: var(--am-warning-ink);
        overflow-wrap: anywhere;
      }
      .am-who-entry__link {
        align-self: flex-start;
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        font-size: var(--am-type-meta-size);
        color: var(--am-primary-700);
        text-decoration: underline;
        cursor: pointer;
        text-align: start;
      }
      .am-who-entry--readonly {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--am-space-4) var(--am-space-12);
      }
      .am-who-entry__ro-kind {
        flex: 0 0 170px;
        font-weight: 600;
      }
      .am-who-entry__ro-value {
        flex: 1 1 200px;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }
      .am-who-entry__sub {
        display: block;
        font-size: var(--am-type-meta-size);
        color: var(--am-text-secondary);
      }
      /* Phone (drawn): Kind over its value, Remove at the row's end. */
      @container (max-width: 560px) {
        .am-who-entry {
          grid-template-columns: minmax(0, 1fr) 36px;
        }
        .am-who-entry__kind {
          grid-column: 1;
          grid-row: 1;
        }
        .am-who-entry__remove {
          grid-column: 2;
          grid-row: 1;
        }
        .am-who-entry__fields {
          grid-column: 1 / -1;
          grid-row: 2;
        }
        .am-who-entry__ro-kind {
          flex-basis: 100%;
        }
      }
    `,
  ],
})
export class StageWhoEntryComponent implements OnInit {
  readonly row = input.required<WhoRow>();
  readonly index = input.required<number>();
  /** The server's assigneeKinds for the record type. */
  readonly kinds = input<StageAssigneeKind[]>([]);
  readonly rules = input<WhoRulesDto | undefined>(undefined);
  readonly recordRoutes = input<{ unit: boolean; committee: boolean }>({ unit: false, committee: false });
  readonly readonly = input(false);
  readonly submitted = input(false);

  readonly removed = output<void>();
  readonly pickPerson = output<void>();
  readonly pickCommittee = output<void>();

  private readonly store = inject(StageWhoOptionsStore);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);
  private readonly destroyRef = inject(DestroyRef);
  readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Bumped on every change to the row's form, so the computeds re-read it. */
  private readonly tick = signal(0);
  /** A draft Fixed position row's holder count; a saved, unchanged row reads its own. */
  private readonly draftHolders = signal<number | null>(null);

  ngOnInit(): void {
    const group = this.row().group;
    group.valueChanges
      .pipe(
        startWith(null),
        switchMap(() => {
          this.tick.update((n) => n + 1);
          const { kind, positionId, orgUnitId } = group.getRawValue();
          if (kind !== 'POSITION_IN_UNIT' || !positionId || !orgUnitId || orgUnitId === RECORD_CHOICE) return of(null);
          if (rowUnchanged(this.row(), this.rules())) return of(this.row().saved?.holderCount ?? null);
          return this.store.holderCount(orgUnitId, positionId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((count) => this.draftHolders.set(count));
  }

  readonly kind = computed(() => {
    this.tick();
    return this.row().group.controls.kind.value;
  });

  readonly usedFields = computed<WhoEntryField[]>(() => {
    const kind = this.kind();
    return kind ? [...(this.rules()?.kinds[kind]?.uses ?? [])] : [];
  });

  readonly kindOptions = computed<Option[]>(() => {
    this.translate.currentLang();
    return this.kinds().map((k) => ({ value: k, label: this.translate.instant(workflowLabelKey('stageAssignee', k)) as string }));
  });

  readonly kindLabel = computed(() => {
    this.translate.currentLang();
    const kind = this.kind();
    return kind ? (this.translate.instant(workflowLabelKey('stageAssignee', kind)) as string) : '—';
  });

  /** Whether a field may stand for "the record's …" here: used, not required, and the record type has it. */
  private recordChoiceFor(field: WhoEntryField): boolean {
    const kind = this.kind();
    const rule = kind ? this.rules()?.kinds[kind] : undefined;
    const route = routeOfField(field);
    return !!rule && !!route && rule.uses.includes(field) && !rule.requires.includes(field) && this.recordRoutes()[route];
  }

  readonly positionOptions = computed<Option[]>(() => {
    this.translate.currentLang();
    this.tick();
    const options = this.store
      .positions()
      .filter((p) => p.isActive)
      .map((p) => ({ value: p.id, label: this.language.bilingual(p.nameEn, p.nameAr) }));
    const saved = this.row().saved?.position;
    if (saved && !options.some((o) => o.value === saved.id)) options.unshift({ value: saved.id, label: this.language.bilingual(saved.nameEn, saved.nameAr) });
    return options;
  });

  readonly unitOptions = computed<Option[]>(() => {
    this.translate.currentLang();
    this.tick();
    const all = this.store.units();
    const tree = (parentId: string | null): Option[] =>
      all
        .filter((u) => u.parentId === parentId)
        .map((u) => {
          const items = tree(u.id);
          return { value: u.id, label: this.language.bilingual(u.nameEn, u.nameAr), ...(items.length ? { items } : {}) };
        });
    const options = tree(null);
    const saved = this.row().saved?.orgUnit;
    if (saved && !all.some((u) => u.id === saved.id)) options.unshift({ value: saved.id, label: this.language.bilingual(saved.nameEn, saved.nameAr) });
    if (this.recordChoiceFor('orgUnitId')) options.unshift({ value: RECORD_CHOICE, label: this.translate.instant('workflow.who.recordUnit') as string });
    return options;
  });

  readonly roleOptions = computed<Option[]>(() => {
    this.translate.currentLang();
    this.tick();
    const options = this.store.roles().map((r) => ({ value: r.id, label: this.language.bilingual(r.labelEn, r.labelAr) }));
    const saved = this.row().saved?.committeeRole;
    if (saved && !options.some((o) => o.value === saved.id)) options.unshift({ value: saved.id, label: this.language.bilingual(saved.labelEn, saved.labelAr) });
    return [{ value: ALL_MEMBERS, label: this.translate.instant('workflow.who.allMembers') as string }, ...options];
  });

  readonly committeeText = computed(() => {
    this.translate.currentLang();
    this.tick();
    const value = this.row().group.controls.committeeId.value;
    if (value === RECORD_CHOICE) return this.translate.instant('workflow.who.recordCommittee') as string;
    const c = this.row().committee();
    return value && c ? this.language.bilingual(c.nameEn, c.nameAr) : '';
  });

  readonly canUseRecordCommittee = computed(() => {
    this.tick();
    const value = this.row().group.controls.committeeId.value;
    return this.recordChoiceFor('committeeId') && value !== RECORD_CHOICE;
  });

  useRecordCommittee(): void {
    const control = this.row().group.controls.committeeId;
    this.row().committee.set(null);
    control.setValue(RECORD_CHOICE);
    control.markAsDirty();
  }

  /** The holder count to show for a Fixed position row with both picked, or null. */
  readonly holders = computed(() => {
    this.tick();
    return this.kind() === 'POSITION_IN_UNIT' ? this.draftHolders() : null;
  });

  readonly noHolder = computed(() => this.holders() === 0);

  readonly holderHint = computed(() => {
    this.translate.currentLang();
    const count = this.holders();
    return count !== null && count > 0 ? this.format.count('workflow.who.heldBy', count) : '';
  });

  /** "Starting assignment": a seeded entry the admin hasn't replaced. Replacing or changing it clears it. */
  readonly starting = computed(() => {
    this.tick();
    return !!this.row().saved?.isStartingAssignment && rowUnchanged(this.row(), this.rules());
  });

  fieldLabel(field: WhoEntryField): string {
    const key = field === 'orgUnitId' && this.kind() === 'POSITION_IN_UNIT' ? 'workflow.who.field.inUnit' : `workflow.who.field.${field}`;
    return this.translate.instant(key) as string;
  }

  /** A slot's messages: "Choose a …" for a missing value, and the server's refusal when it named this slot. */
  errorsFor(slot: WhoEntryField | 'kind'): Record<string, string> {
    return { required: `workflow.who.error.choose.${slot}`, server: this.row().serverText() || 'validation.invalid' };
  }

  // ── Read-only (a protected workflow) ──────────────────────────────────────

  readonly valueText = computed(() => {
    this.translate.currentLang();
    this.tick();
    const e = this.row().saved;
    const name = (r: { nameEn: string; nameAr: string | null } | null | undefined): string => (r ? this.language.bilingual(r.nameEn, r.nameAr) : '—');
    if (!e) return '—';
    switch (e.kind) {
      case 'SPECIFIC_USER':
        return e.user?.name ?? '—';
      case 'POSITION_IN_UNIT':
        return `${name(e.position)} · ${name(e.orgUnit)}`;
      case 'ORG_UNIT_HEAD':
        return e.orgUnitId ? name(e.orgUnit) : (this.translate.instant('workflow.who.recordUnit') as string);
      case 'CREATOR':
        return this.translate.instant('workflow.who.creatorValue') as string;
      case 'COMMITTEE':
        return e.committeeId ? name(e.committee) : (this.translate.instant('workflow.who.recordCommittee') as string);
    }
  });

  readonly subText = computed(() => {
    this.translate.currentLang();
    const e = this.row().saved;
    if (e?.kind === 'COMMITTEE') {
      return e.committeeRole
        ? (this.translate.instant('workflow.who.roleNamed', { role: this.language.bilingual(e.committeeRole.labelEn, e.committeeRole.labelAr) }) as string)
        : (this.translate.instant('workflow.who.allMembers') as string);
    }
    if (e?.kind === 'POSITION_IN_UNIT' && e.holderCount !== null) {
      return e.holderCount === 0 ? (this.translate.instant('workflow.who.noHolder') as string) : this.format.count('workflow.who.heldBy', e.holderCount);
    }
    return '';
  });

  /** Focuses this row's Kind (Add another). */
  focusKind(): void {
    this.host.nativeElement.querySelector<HTMLElement>('[data-who-kind] .am-overlay-select-trigger')?.focus();
  }

  /** Focuses this row's Remove. */
  focusRemove(): void {
    this.host.nativeElement.querySelector<HTMLElement>('[data-who-remove]')?.focus();
  }
}
