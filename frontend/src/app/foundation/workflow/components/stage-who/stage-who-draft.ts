import { computed, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import type {
  StageAssigneeKind,
  StageWhoMode,
  StageWhoWriteDto,
  WhoEntryField,
  WorkflowStageDto,
  WorkflowTemplateDto,
} from '../../services/workflow-template.service';
import type { WhoRefusal } from '../../workflow-refusal';
import { WhoRow, applyKind, createRow, effectiveMode, modeChoice, routeOfField, rowToWrite, savedToWrite } from './stage-who.model';

/** The kind a new stage's first row starts on (ACC-136): a Fixed position, where the record type offers it. */
const FIRST_ROW_KIND: StageAssigneeKind = 'POSITION_IN_UNIT';

/**
 * ACC-271 PR 5a — the stage editor's "Who works this stage" while it is being
 * edited: the rows, the mode chosen, and what was loaded (to tell a change).
 * Owned by the panel, so a stage can be loaded before the section renders; the
 * section draws it. Every rule it applies is the template's (whoRules,
 * assigneeKinds, recordRoutes).
 */
export class StageWhoDraft {
  readonly rows = signal<WhoRow[]>([]);
  /** The mode as chosen (or stored); the save sends effectiveMode(). */
  readonly chosenMode = signal<StageWhoMode | null>(null);
  /** The section's own slot ("A stage needs at least one assignee."), a translation key. */
  readonly sectionError = signal('');
  /** The mode choice's slot, a translation key. */
  readonly modeError = signal('');
  /** Bumped on every change to a row, so computeds over the rows re-read them. */
  readonly tick = signal(0);

  private template: WorkflowTemplateDto | null = null;
  private readonly baseline = signal('');
  private subscriptions: Subscription[] = [];

  readonly kinds = computed(() => {
    this.tick();
    return this.rows().map((r) => r.group.controls.kind.value);
  });

  readonly mode = computed(() => effectiveMode(this.template?.whoRules, this.kinds(), this.chosenMode()));
  readonly choice = computed(() => modeChoice(this.template?.whoRules, this.kinds()));
  /** The chosen mode can't be used with this list, so the save sends the default: say so. */
  readonly fellBack = computed(() => {
    const chosen = this.chosenMode();
    return this.choice().shown && chosen !== null && chosen !== this.mode() ? chosen : null;
  });

  readonly hasChanges = computed(() => {
    this.tick();
    this.rows();
    return this.serialized() !== this.baseline();
  });

  /** Loads a stage's stored `who` (or a new stage's first row) and makes it the baseline. */
  load(stage: WorkflowStageDto | null, template: WorkflowTemplateDto | null): void {
    this.template = template;
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.subscriptions = [];
    const rules = template?.whoRules;
    const routes = template?.recordRoutes ?? { unit: false, committee: false };
    let rows: WhoRow[];
    if (stage?.who) {
      rows = stage.who.entries.map((entry) => {
        const row = createRow(entry);
        row.group.controls.kind.setValue(entry.kind, { emitEvent: false });
        applyKind(row, entry.kind, rules, routes, savedToWrite(entry, rules));
        return row;
      });
      this.chosenMode.set(stage.who.mode);
    } else if (!stage) {
      const kinds = template?.assigneeKinds ?? [];
      const first = kinds.includes(FIRST_ROW_KIND) ? FIRST_ROW_KIND : (kinds[0] ?? null);
      const row = createRow(null);
      row.group.controls.kind.setValue(first, { emitEvent: false });
      applyKind(row, first, rules, routes, null);
      rows = [row];
      this.chosenMode.set(null);
    } else {
      // A stage not yet converted: nobody listed until someone is added.
      rows = [];
      this.chosenMode.set(null);
    }
    rows.forEach((row) => this.watch(row));
    this.rows.set(rows);
    this.sectionError.set('');
    this.modeError.set('');
    this.markSaved();
  }

  /** What was just saved (or loaded) is the new baseline. */
  markSaved(): void {
    this.baseline.set(this.serialized());
    this.tick.update((n) => n + 1);
  }

  /** "+ Add another": a row with no kind chosen yet. Returns it, so focus can go to its Kind. */
  addRow(): WhoRow {
    const row = createRow(null);
    applyKind(row, null, this.template?.whoRules, this.template?.recordRoutes ?? { unit: false, committee: false }, null);
    this.watch(row);
    this.rows.update((rows) => [...rows, row]);
    this.sectionError.set('');
    this.tick.update((n) => n + 1);
    return row;
  }

  removeRow(row: WhoRow): void {
    this.rows.update((rows) => rows.filter((r) => r !== row));
    this.clearRefusals();
    this.tick.update((n) => n + 1);
  }

  setMode(mode: StageWhoMode): void {
    this.chosenMode.set(mode);
    this.modeError.set('');
  }

  /** The `who` a save sends. */
  write(): StageWhoWriteDto {
    const rules = this.template?.whoRules;
    return {
      mode: this.mode(),
      entries: this.rows()
        .map((r) => rowToWrite(r, rules))
        .filter((e): e is NonNullable<typeof e> => e !== null),
    };
  }

  /**
   * Marks every row's slots so their "Choose a …" shows (Save never disabled,
   * rule 5.2); returns whether each row has a kind and every field it requires.
   * The rest — an empty list, a duplicate, a route the record type lacks — is
   * the server's to say.
   */
  validate(): boolean {
    // The last refusal is the server's answer to the last Save; this Save asks
    // again, so it must not be held back by it.
    this.clearRefusals();
    let ok = true;
    for (const row of this.rows()) {
      row.group.markAllAsTouched();
      if (row.group.invalid) ok = false;
    }
    this.tick.update((n) => n + 1);
    return ok;
  }

  /** Puts a refused `who` in its slot. False when its row no longer exists. */
  applyRefusal(refusal: WhoRefusal): boolean {
    this.clearRefusals();
    const where = refusal.where;
    if (where.slot === 'section') {
      this.sectionError.set('workflow.who.error.required');
      return true;
    }
    if (where.slot === 'mode') {
      this.modeError.set(refusal.code === 'COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE' ? 'workflow.who.error.voteNeedsOne' : 'workflow.who.error.mode');
      return true;
    }
    const row = this.rows()[where.index];
    if (!row) return false;
    const slot = this.slotFor(row, refusal);
    const control = slot === 'kind' ? row.group.controls.kind : row.group.controls[slot];
    row.serverText.set(this.refusalKey(refusal, slot));
    control.setErrors({ server: true });
    control.markAsTouched();
    this.tick.update((n) => n + 1);
    return true;
  }

  private slotFor(row: WhoRow, refusal: WhoRefusal): WhoEntryField | 'kind' {
    const where = refusal.where;
    if (where.slot === 'entry' && where.field) return where.field;
    const kind = row.group.controls.kind.value;
    const rule = kind ? this.template?.whoRules?.kinds[kind] : undefined;
    if (refusal.code === 'WHO_RECORD_ROUTE_NOT_AVAILABLE') {
      return rule?.uses.find((f) => routeOfField(f) !== null && !rule.requires.includes(f)) ?? 'kind';
    }
    if (refusal.code === 'WHO_ENTRY_DUPLICATE') return rule?.uses[rule.uses.length - 1] ?? 'kind';
    return 'kind';
  }

  private refusalKey(refusal: WhoRefusal, slot: WhoEntryField | 'kind'): string {
    switch (refusal.code) {
      case 'WHO_ENTRY_DUPLICATE':
        return 'workflow.who.error.duplicate';
      case 'WHO_KIND_NOT_ALLOWED':
        return 'workflow.who.error.kindNotAllowed';
      case 'WHO_ENTRY_FIELD_NOT_USED':
        return 'workflow.who.error.fieldNotUsed';
      case 'WHO_RECORD_ROUTE_NOT_AVAILABLE':
        return slot === 'committeeId' ? 'workflow.who.error.noRecordCommittee' : 'workflow.who.error.noRecordUnit';
      case 'WHO_REFERENCE_NOT_FOUND':
        return 'workflow.who.error.removed';
      case 'WHO_USER_NOT_ACTIVE':
        return 'workflow.who.error.userNotActive';
      case 'WHO_ENTRY_INCOMPLETE':
      default:
        return `workflow.who.error.choose.${slot}`;
    }
  }

  private clearRefusals(): void {
    this.sectionError.set('');
    this.modeError.set('');
    for (const row of this.rows()) {
      if (!row.serverText()) continue;
      row.serverText.set('');
      for (const control of Object.values(row.group.controls)) {
        if (control.hasError('server')) control.updateValueAndValidity({ emitEvent: false });
      }
    }
  }

  private watch(row: WhoRow): void {
    const rules = () => this.template?.whoRules;
    const routes = () => this.template?.recordRoutes ?? { unit: false, committee: false };
    this.subscriptions.push(
      row.group.controls.kind.valueChanges.subscribe((kind) => applyKind(row, kind, rules(), routes(), null)),
      row.group.valueChanges.subscribe(() => {
        if (row.serverText()) row.serverText.set('');
        this.sectionError.set('');
        this.modeError.set('');
        this.tick.update((n) => n + 1);
      }),
    );
  }

  private serialized(): string {
    return JSON.stringify(this.write());
  }
}
