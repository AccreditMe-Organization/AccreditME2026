import { WritableSignal, signal } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import type {
  StageAssigneeKind,
  StageWhoEntryDto,
  StageWhoEntryWriteDto,
  StageWhoMode,
  WhoEntryField,
  WhoRulesDto,
} from '../../services/workflow-template.service';

/**
 * ACC-271 PR 5a — the stage editor's "Who works this stage", as rows of forms.
 * Nothing here is a rule of its own: what a kind uses and needs, which modes
 * exist and when the choice shows all come from the server's `whoRules`, and
 * which "the record's …" forms exist from its `recordRoutes`.
 */

/** A select's value for "the record's unit" / "the record's committee": sent as null. */
export const RECORD_CHOICE = '@record';
/** The role filter's "All members": sent as null. */
export const ALL_MEMBERS = '@all';

export const WHO_FIELDS: readonly WhoEntryField[] = ['userId', 'positionId', 'orgUnitId', 'committeeId', 'committeeRoleValueId'];

/** Which of the server's recordRoutes a field's "the record's …" form needs. */
export function routeOfField(field: WhoEntryField): 'unit' | 'committee' | null {
  if (field === 'orgUnitId') return 'unit';
  if (field === 'committeeId') return 'committee';
  return null;
}

export type WhoRowControls = { kind: FormControl<StageAssigneeKind | null> } & { [F in WhoEntryField]: FormControl<string | null> };

/** One entry being edited: its form, the names a picker chose, and the stored entry it came from. */
export interface WhoRow {
  /** Stable while the row lives: tracks the row and names its controls' ids. */
  key: number;
  group: FormGroup<WhoRowControls>;
  /** The person the picker chose (the select can't name them: they are paged on the server). */
  userName: WritableSignal<string | null>;
  /** The committee the picker chose, likewise. */
  committee: WritableSignal<{ nameEn: string; nameAr: string | null } | null>;
  /** The stored entry this row was loaded from; null for a row added here. */
  saved: StageWhoEntryDto | null;
  /** The server's refusal for this row, shown in its slot until the slot changes. */
  serverText: WritableSignal<string>;
}

let nextKey = 1;

export function newRowControls(): FormGroup<WhoRowControls> {
  const field = () => new FormControl<string | null>({ value: null, disabled: true });
  return new FormGroup<WhoRowControls>({
    kind: new FormControl<StageAssigneeKind | null>(null, [Validators.required]),
    userId: field(),
    positionId: field(),
    orgUnitId: field(),
    committeeId: field(),
    committeeRoleValueId: field(),
  });
}

export function createRow(saved: StageWhoEntryDto | null): WhoRow {
  return {
    key: nextKey++,
    group: newRowControls(),
    userName: signal(saved?.user?.name ?? null),
    committee: signal(saved?.committee ? { nameEn: saved.committee.nameEn, nameAr: saved.committee.nameAr } : null),
    saved,
    serverText: signal(''),
  };
}

/**
 * Sets a row up for its kind: only the fields the kind uses are enabled, the
 * ones it requires are required, and a field the kind doesn't use is cleared.
 * A used field that may stand for "the record's …" starts on that choice where
 * the record type has it; the role filter starts on All members.
 */
export function applyKind(
  row: WhoRow,
  kind: StageAssigneeKind | null,
  rules: WhoRulesDto | undefined,
  routes: { unit: boolean; committee: boolean },
  values: Partial<Record<WhoEntryField, string | null>> | null,
): void {
  const rule = kind ? rules?.kinds[kind] : undefined;
  for (const field of WHO_FIELDS) {
    const control = row.group.controls[field];
    const uses = !!rule?.uses.includes(field);
    const requires = !!rule?.requires.includes(field);
    control.setValidators(requires ? [Validators.required] : []);
    if (!uses) {
      control.setValue(null, { emitEvent: false });
      control.disable({ emitEvent: false });
      continue;
    }
    control.enable({ emitEvent: false });
    let value = values ? (values[field] ?? null) : null;
    if (!requires && value === null) {
      const route = routeOfField(field);
      if (field === 'committeeRoleValueId') value = ALL_MEMBERS;
      else if (route && (values !== null || routes[route])) value = RECORD_CHOICE;
    }
    control.setValue(value, { emitEvent: false });
  }
  if (!values) {
    row.userName.set(null);
    row.committee.set(null);
  }
  row.group.updateValueAndValidity({ emitEvent: false });
}

/** A row's entry as a save sends it: the kind and every field it uses, "the record's …" as null. */
export function rowToWrite(row: WhoRow, rules: WhoRulesDto | undefined): StageWhoEntryWriteDto | null {
  const kind = row.group.controls.kind.value;
  if (!kind) return null;
  const out: StageWhoEntryWriteDto = { kind };
  for (const field of rules?.kinds[kind]?.uses ?? []) {
    const value = row.group.controls[field].value;
    out[field] = value === RECORD_CHOICE || value === ALL_MEMBERS || value === '' ? null : value;
  }
  return out;
}

/** A stored entry as a save would send it, for "has this row changed?". */
export function savedToWrite(entry: StageWhoEntryDto, rules: WhoRulesDto | undefined): StageWhoEntryWriteDto {
  const out: StageWhoEntryWriteDto = { kind: entry.kind };
  for (const field of rules?.kinds[entry.kind]?.uses ?? []) out[field] = entry[field] ?? null;
  return out;
}

/** Whether a row still says exactly what its stored entry said. */
export function rowUnchanged(row: WhoRow, rules: WhoRulesDto | undefined): boolean {
  if (!row.saved) return false;
  return JSON.stringify(rowToWrite(row, rules)) === JSON.stringify(savedToWrite(row.saved, rules));
}

/** When the server shows "When there are several people", and which modes it offers for this list. */
export function modeChoice(
  rules: WhoRulesDto | undefined,
  kinds: (StageAssigneeKind | null)[],
): { shown: boolean; offered: StageWhoMode[] } {
  if (!rules) return { shown: false, offered: [] };
  const single = kinds.length === 1 ? kinds[0] : null;
  const shown = kinds.length >= rules.modeChoiceShownWhen.minEntries || (single !== null && single === rules.modeChoiceShownWhen.orSingleKind);
  const offered = rules.modes.filter((m) => !m.onlyWithSingle || single === m.onlyWithSingle).map((m) => m.key);
  return { shown, offered };
}

/** The mode a save sends: the one chosen while it's offered, else the server's default. */
export function effectiveMode(rules: WhoRulesDto | undefined, kinds: (StageAssigneeKind | null)[], chosen: StageWhoMode | null): StageWhoMode {
  const fallback = rules?.defaultMode ?? 'ANY_ONE';
  const { shown, offered } = modeChoice(rules, kinds);
  return shown && chosen && offered.includes(chosen) ? chosen : fallback;
}
