import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { pairwise, startWith } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import {
  CommitteeService,
  CommitteeDetailDto,
  CommitteeDto,
  CommitteeListItemDto,
  CreateCommitteeDto,
  UpdateCommitteeDto,
  COMMITTEE_MEETING_FREQUENCIES,
} from '../../services/committee.service';
import { CommitteeReferenceField, committeeRefusal, referenceOptions } from '../../committee-references';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import {
  OrgUnitService,
  OrgUnitDto,
  buildOrgUnitCascadeOptions,
} from '../../../organization/services/org-unit.service';
import { LanguageService } from '../../../../core/services/language.service';
import { refusalCode } from '../../../../core/http/refusal';
import { FormatService } from '../../../../core/formatting';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { InputNumberLatinDigits } from '../../../../core/formatting/latin-digits';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { TabStripComponent, TabStripItem } from '../../../../shared/components/tab-strip/tab-strip.component';

export type CommitteeFormTab = 'identity' | 'governance' | 'structure';

type FieldName =
  | 'nameEn'
  | 'nameAr'
  | 'typeValueId'
  | 'purpose'
  | 'quorumCount'
  | 'meetingFrequency'
  | 'orgUnitId'
  | 'parentCommitteeId'
  | 'reportingToCommitteeId';

/** Which tab holds each field, in the order a reader meets them. */
export const COMMITTEE_FORM_TABS: Readonly<Record<CommitteeFormTab, readonly FieldName[]>> = {
  identity: ['nameEn', 'nameAr', 'typeValueId', 'purpose'],
  governance: ['quorumCount', 'meetingFrequency'],
  structure: ['orgUnitId', 'parentCommitteeId', 'reportingToCommitteeId'],
};
const TAB_ORDER: readonly CommitteeFormTab[] = ['identity', 'governance', 'structure'];

/**
 * A footer message, and what it offers. `conflict` replaces Save with Reload
 * (the role matrix's shape); `unreachable` offers Retry, the ONE case where
 * trying again can help (Design System artboard 14, rule 5.5); `failed` offers
 * neither.
 */
type FooterState = { kind: 'conflict' } | { kind: 'unreachable' } | { kind: 'failed' } | null;

/** Status codes that mean the server was not reached or did not answer in time. */
const UNREACHABLE = new Set([0, 408, 502, 503, 504]);

/**
 * The committee dialog — Add committee and Edit committee — ACC-238.
 *
 * ## Three tabs, one Save
 *
 * Nine fields in one column measured about 810px against the 420px body cap,
 * so the drawing (AccreditMe Committee Changes, section 1) groups them by what
 * they describe: Identity (names, type, purpose), Governance (quorum,
 * frequency) and Structure (owning unit, parent, reports to). TABS, not steps:
 * any field may be fixed in any order, and one Save covers all three. The strip
 * sits in the dialog header (`am-tab-strip`), so it costs nothing against the
 * cap, and the body holds the TALLEST tab's height — every panel occupies the
 * same grid cell, the others hidden — so Save does not move under the pointer
 * as the reader switches tabs. Heights: committee-form.layout.spec.ts.
 *
 * Edit is offered in Formation only (the committee page decides, by stage
 * key); New committee uses the same tabs.
 *
 * ## Save is never disabled for an invalid form (artboard 14, rule 5.2)
 *
 * Pressing it reveals every error in its field's slot, marks each tab holding
 * one with "⚠" and its count, moves to the first such tab, and focuses the
 * first invalid field there — so a missing owning unit on Structure is not
 * hidden behind Identity. A server refusal about a field (ACC-233's codes) is
 * shown the same way, in that field's slot, from its code.
 *
 * ## Someone else saved first
 *
 * An edit sends the `updatedAt` the dialog loaded; the server compares it
 * under the committee's row lock and refuses a stale save with 409
 * COMMITTEE_CHANGED. The footer then says so and Save becomes Reload, which
 * reads the committee again and replaces the form with the saved values. The
 * body does not grow. Nothing typed is applied.
 *
 * ## Reports to follows Parent
 *
 * Choosing a parent fills Reports to with the same committee, with the line
 * "Filled in from Parent committee · you can change it" — but only while
 * Reports to was empty or still matched the old parent. A committee the
 * reports-to list leaves out (one that would close a loop) is never filled in.
 *
 * ## Absent, not disabled
 *
 * The parent and reports-to lists leave out what the server refuses (ACC-233),
 * and a quiet line under each says what is left out. The owning unit offers
 * active units only.
 */
@Component({
  selector: 'app-committee-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    InputNumberLatinDigits,
    ButtonModule,
    OverlaySelectComponent,
    EditDialogComponent,
    FieldComponent,
    TabStripComponent,
  ],
  template: `
    <ng-template #tabsTpl>
      <am-tab-strip
        [tabs]="tabItems()"
        [selected]="tab()"
        (selectedChange)="tab.set($any($event))"
        [ariaLabel]="'committee.form.tabsLabel' | translate"
        idPrefix="cf"
      />
    </ng-template>

    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="am-cf" data-cf-body>
        <!-- Identity -->
        <div
          class="am-cf__panel"
          [class.am-cf__panel--off]="tab() !== 'identity'"
          role="tabpanel"
          id="cf-panel-identity"
          aria-labelledby="cf-tab-identity"
          [attr.aria-hidden]="tab() !== 'identity' ? 'true' : null"
          data-cf-panel="identity"
        >
          <div class="am-cf__pair">
            <am-field
              data-cf-field="nameEn"
              [label]="'committee.nameEn' | translate"
              [control]="form.controls.nameEn"
              inputId="cf-nameEn"
              [forceShowErrors]="showErrors()"
              [errorMessages]="errorKeys('nameEn', { required: 'committee.form.nameRequired' })"
            >
              <input pInputText id="cf-nameEn" formControlName="nameEn" autocomplete="off" />
            </am-field>
            <am-field
              data-cf-field="nameAr"
              [label]="'committee.nameAr' | translate"
              [control]="form.controls.nameAr"
              inputId="cf-nameAr"
              [forceShowErrors]="showErrors()"
              [errorMessages]="errorKeys('nameAr')"
            >
              <input pInputText id="cf-nameAr" formControlName="nameAr" dir="rtl" autocomplete="off" />
            </am-field>
          </div>

          <am-field
            data-cf-field="typeValueId"
            [label]="'committee.type' | translate"
            [control]="form.controls.typeValueId"
            inputId="cf-type"
            [forceShowErrors]="showErrors()"
            [errorMessages]="errorKeys('typeValueId', { required: 'committee.form.typeRequired' })"
          >
            <app-overlay-select
              formControlName="typeValueId"
              [options]="committeeTypeOptions()"
              optionLabel="label"
              optionValue="id"
              [placeholder]="'committee.selectType' | translate"
            />
          </am-field>

          <am-field
            data-cf-field="purpose"
            [label]="'committee.purpose' | translate"
            [control]="form.controls.purpose"
            inputId="cf-purpose"
            [forceShowErrors]="showErrors()"
            [errorMessages]="errorKeys('purpose')"
          >
            <textarea pTextarea id="cf-purpose" formControlName="purpose" rows="3"></textarea>
          </am-field>
        </div>

        <!-- Governance -->
        <div
          class="am-cf__panel"
          [class.am-cf__panel--off]="tab() !== 'governance'"
          role="tabpanel"
          id="cf-panel-governance"
          aria-labelledby="cf-tab-governance"
          [attr.aria-hidden]="tab() !== 'governance' ? 'true' : null"
          data-cf-panel="governance"
        >
          <div class="am-cf__pair">
            <am-field
              data-cf-field="quorumCount"
              [label]="'committee.quorumCount' | translate"
              [control]="form.controls.quorumCount"
              inputId="cf-quorum"
              [hint]="quorumHint()"
              [forceShowErrors]="showErrors()"
              [errorMessages]="errorKeys('quorumCount', { min: 'committee.form.quorumMin' })"
            >
              <p-inputNumber inputId="cf-quorum" formControlName="quorumCount" [min]="0" [showButtons]="true" />
            </am-field>
            <am-field
              data-cf-field="meetingFrequency"
              [label]="'committee.meetingFrequency' | translate"
              [control]="form.controls.meetingFrequency"
              inputId="cf-frequency"
              [forceShowErrors]="showErrors()"
              [errorMessages]="errorKeys('meetingFrequency')"
            >
              <app-overlay-select
                formControlName="meetingFrequency"
                [options]="frequencyOptions()"
                optionLabel="label"
                optionValue="value"
              />
            </am-field>
          </div>
        </div>

        <!-- Structure -->
        <div
          class="am-cf__panel"
          [class.am-cf__panel--off]="tab() !== 'structure'"
          role="tabpanel"
          id="cf-panel-structure"
          aria-labelledby="cf-tab-structure"
          [attr.aria-hidden]="tab() !== 'structure' ? 'true' : null"
          data-cf-panel="structure"
        >
          <am-field
            data-cf-field="orgUnitId"
            [label]="'committee.owningUnit' | translate"
            [control]="form.controls.orgUnitId"
            inputId="cf-unit"
            [hint]="'committee.form.activeUnitsOnly' | translate"
            [forceShowErrors]="showErrors()"
            [errorMessages]="errorKeys('orgUnitId', { required: 'committee.refusal.unitRequired' })"
          >
            <app-overlay-select
              formControlName="orgUnitId"
              [options]="orgUnitCascadeOptions()"
              optionLabel="label"
              optionValue="value"
              optionGroupLabel="label"
              optionGroupChildren="items"
              [placeholder]="'committee.selectOwningUnit' | translate"
            />
          </am-field>

          <am-field
            data-cf-field="parentCommitteeId"
            [label]="'committee.parentCommittee' | translate"
            [control]="form.controls.parentCommitteeId"
            inputId="cf-parent"
            [hint]="(editing() ? 'committee.form.parentLeftOut' : 'committee.form.leftOutNew') | translate"
            [forceShowErrors]="showErrors()"
            [errorMessages]="errorKeys('parentCommitteeId')"
          >
            <app-overlay-select
              formControlName="parentCommitteeId"
              [options]="parentCommitteeOptions()"
              optionLabel="label"
              optionValue="id"
              [showClear]="true"
              [placeholder]="'committee.noneOption' | translate"
            />
          </am-field>

          <am-field
            data-cf-field="reportingToCommitteeId"
            [label]="'committee.reportingTo' | translate"
            [control]="form.controls.reportingToCommitteeId"
            inputId="cf-reports-to"
            [hint]="reportsToHint() | translate"
            [forceShowErrors]="showErrors()"
            [errorMessages]="errorKeys('reportingToCommitteeId')"
          >
            <app-overlay-select
              formControlName="reportingToCommitteeId"
              [options]="reportingToOptions()"
              optionLabel="label"
              optionValue="id"
              [showClear]="true"
              [placeholder]="'committee.noneOption' | translate"
            />
          </am-field>
        </div>
      </form>
    </ng-template>

    <ng-template #footerTpl>
      <div class="am-cf__foot">
        @if (footer(); as f) {
          <p class="am-cf__foot-message" role="alert" data-cf-footer-message>
            @switch (f.kind) {
              @case ('conflict') {
                {{ 'committee.form.conflict' | translate: { name: loadedName() } }}
              }
              @case ('unreachable') {
                {{ 'committee.form.unreachable' | translate }}
              }
              @default {
                {{ 'committee.refusal.saveFailed' | translate }}
              }
            }
          </p>
        } @else {
          <span class="am-cf__foot-note">{{ 'committee.form.savedTogether' | translate }}</span>
        }
        <div class="am-cf__buttons">
          <p-button
            type="button"
            [label]="'common.cancel' | translate"
            severity="secondary"
            [text]="true"
            [disabled]="saving()"
            (onClick)="dialog.requestClose()"
          />
          @if (footer()?.kind === 'conflict') {
            <p-button
              type="button"
              [label]="'committee.form.reload' | translate"
              [loading]="reloading()"
              (onClick)="reload()"
              data-cf-reload
            />
          } @else if (footer()?.kind === 'unreachable') {
            <p-button type="button" [label]="'list.retry' | translate" [loading]="saving()" (onClick)="submit()" data-cf-retry />
          } @else {
            <p-button type="button" [label]="'common.save' | translate" [loading]="saving()" (onClick)="submit()" data-cf-save />
          }
        </div>
      </div>
    </ng-template>

    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="(editing() ? 'committee.editCommittee' : 'committee.addCommittee') | translate"
      [context]="loadedName()"
      [headerExtra]="tabsTpl"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      density="compact"
      size="form"
    />
  `,
  styles: [
    `
      /* Every panel in ONE grid cell: the body is as tall as the tallest tab,
         whichever is showing, so the footer never moves between tabs. A hidden
         panel keeps its size but is invisible, out of the tab order and out
         of the accessibility tree. */
      .am-cf {
        display: grid;
      }
      .am-cf__panel {
        grid-area: 1 / 1;
        display: flex;
        flex-direction: column;
        align-self: start;
        min-width: 0;
      }
      .am-cf__panel--off {
        visibility: hidden;
      }
      .am-cf__pair {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: var(--am-space-12);
      }
      .am-cf__foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-12);
      }
      .am-cf__foot-note {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
      }
      .am-cf__foot-message {
        margin: 0;
        font-size: var(--am-type-meta-size);
        color: var(--am-danger-ink);
        min-width: 0;
      }
      .am-cf__buttons {
        display: flex;
        gap: var(--am-space-12);
        flex: none;
      }
    `,
  ],
})
export class CommitteeFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly committeeService = inject(CommitteeService);
  private readonly lookupService = inject(LookupService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Whether the dialog is open. Not required, so a spec may build the class alone. */
  readonly visible = input(false);
  /** The committee being edited; null (or absent) for Add committee. */
  readonly committee = input<CommitteeDto | CommitteeDetailDto | null>(null);
  readonly visibleChange = output<boolean>();
  readonly saved = output<void>();
  /** The committee as read again by Reload, so the page can show it too. */
  readonly reloaded = output<CommitteeDetailDto>();

  readonly tab = signal<CommitteeFormTab>('identity');
  readonly saving = signal(false);
  readonly reloading = signal(false);
  readonly showErrors = signal(false);
  readonly footer = signal<FooterState>(null);
  /** ACC-233 — a server refusal about one field, said in that field's slot. */
  readonly refusedField = signal<{ field: CommitteeReferenceField; key: string } | null>(null);
  /** Reports to was filled in from the parent and still matches it. */
  readonly reportsToPrefilled = signal(false);
  /** The committee as this dialog last read it: its updatedAt is what a save sends. */
  private readonly loaded = signal<CommitteeDto | null>(null);

  readonly committeeTypes = signal<LookupValueDto[]>([]);
  readonly allCommittees = signal<CommitteeListItemDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  /** True while fill() loads saved values, which must not move Reports to. */
  private filling = false;
  /** Bumped by every form change, so tab error counts recompute. */
  private readonly formTick = signal(0);

  readonly editing = computed(() => this.loaded() !== null);
  readonly loadedName = computed(() => {
    const c = this.loaded();
    return c ? this.languageService.bilingual(c.nameEn, c.nameAr) : '';
  });

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(150)]],
    // ACC-160 — the Arabic name is OPTIONAL: Arabic fields are never mandatory.
    // An emptied field is sent as '' and stored as NULL by the DTO's trimToNull.
    nameAr: ['', [Validators.maxLength(150)]],
    typeValueId: [null as string | null, [Validators.required]],
    purpose: [''],
    // 0 means "not set yet" (allowed in Formation); leaving Formation needs 1,
    // which the server checks on Submit for Approval (COMMITTEE_QUORUM_NOT_SET).
    quorumCount: [0, [Validators.min(0)]],
    meetingFrequency: ['AS_NEEDED'],
    // ACC-135 — required, and prefilled with the root on create.
    orgUnitId: [null as string | null, [Validators.required]],
    parentCommitteeId: [null as string | null],
    reportingToCommitteeId: [null as string | null],
  });

  // ACC-160 — options carry a RESOLVED label, recomputed on a language switch.
  readonly committeeTypeOptions = computed(() =>
    this.committeeTypes().map((v) => ({ ...v, label: this.languageService.bilingual(v.labelEn, v.labelAr) })),
  );

  // The frequencies in words — the raw enum values were shown before ACC-238.
  readonly frequencyOptions = computed(() => {
    this.translate.currentLang();
    return COMMITTEE_MEETING_FREQUENCIES.map((value) => ({
      value,
      label: this.translate.instant(`committee.frequency.${value.toLowerCase()}`),
    }));
  });

  readonly orgUnitCascadeOptions = computed(() => buildOrgUnitCascadeOptions(this.orgUnits(), null, null));

  // ACC-233 — each picker leaves out what the server would refuse.
  readonly parentCommitteeOptions = computed(() => this.labelled('parent'));
  readonly reportingToOptions = computed(() => this.labelled('reportsTo'));

  /** "0 means not set yet · of 7 members" while editing; the first half on create. */
  readonly quorumHint = computed(() => {
    this.translate.currentLang();
    const self = this.allCommittees().find((c) => c.id === this.loaded()?.id);
    return self
      ? this.format.count('committee.quorumHint', self.memberCount)
      : this.translate.instant('committee.form.quorumNotSet');
  });

  readonly reportsToHint = computed(() =>
    this.reportsToPrefilled()
      ? 'committee.form.reportsToFilledIn'
      : this.editing()
        ? 'committee.form.reportsToLeftOut'
        : 'committee.form.leftOutNew',
  );

  /** Per tab, how many of its fields show an error — only once Save has been pressed. */
  readonly tabErrors = computed<Record<CommitteeFormTab, number>>(() => {
    this.formTick();
    const show = this.showErrors();
    const refused = this.refusedField();
    const count = (tab: CommitteeFormTab) =>
      show || refused ? COMMITTEE_FORM_TABS[tab].filter((name) => this.form.controls[name].invalid).length : 0;
    return { identity: count('identity'), governance: count('governance'), structure: count('structure') };
  });

  readonly tabItems = computed<readonly TabStripItem[]>(() => {
    const errors = this.tabErrors();
    return TAB_ORDER.map((id) => ({ id, key: `committee.form.tab.${id}`, errors: errors[id] }));
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.formTick.update((n) => n + 1));
    this.form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.formTick.update((n) => n + 1));

    // Reports to follows Parent while it still matched the old parent.
    this.form.controls.parentCommitteeId.valueChanges
      .pipe(startWith(this.form.controls.parentCommitteeId.value), pairwise(), takeUntilDestroyed(this.destroyRef))
      .subscribe(([previous, next]) => this.followParent(previous, next));
    // A person who picks Reports to themselves owns it from then on.
    this.form.controls.reportingToCommitteeId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (value !== this.form.controls.parentCommitteeId.value) this.reportsToPrefilled.set(false);
      });

    // Each opening starts from the committee as given, on Identity, with the
    // pickers' choices read fresh.
    effect(() => {
      if (!this.visible()) return;
      const committee = this.committee();
      untracked(() => {
        this.open(committee);
        this.loadChoices();
      });
    });
  }

  /**
   * What the pickers need, read on EVERY opening and never before the first:
   * the dialog lives on the committee list and the record page whether or not
   * it is open, so loading at construction would cost those pages three
   * requests for a dialog nobody opened. Read again each time, so the lists
   * leave out what is true NOW (a committee that began dissolving since).
   */
  private loadChoices(): void {
    this.lookupService.getValues('committee_type').subscribe({ next: (values) => this.committeeTypes.set(values) });
    this.orgUnitService.getFlat().subscribe({
      next: (units) => {
        this.orgUnits.set(units);
        this.prefillRootUnit(units);
      },
    });
    this.committeeService.listCommittees().subscribe({ next: (committees) => this.allCommittees.set(committees) });
  }

  /** The error keys for one field: its own validators, and a server refusal about it. */
  errorKeys(field: FieldName, own: Record<string, string> = {}): Record<string, string> {
    const refused = this.refusedField();
    return refused && refused.field === field ? { ...own, refused: refused.key } : own;
  }

  private labelled(chain: 'parent' | 'reportsTo') {
    const current = this.loaded();
    const saved = chain === 'parent' ? current?.parentCommitteeId : current?.reportingToCommitteeId;
    return referenceOptions(this.allCommittees(), current?.id ?? null, chain, saved ?? null).map((c) => ({
      ...c,
      label: this.languageService.bilingual(c.nameEn, c.nameAr),
    }));
  }

  private open(committee: CommitteeDto | null): void {
    this.loaded.set(committee);
    this.fill(committee);
    this.tab.set('identity');
    this.showErrors.set(false);
    this.footer.set(null);
    this.refusedField.set(null);
    this.saving.set(false);
    this.reloading.set(false);
  }

  private fill(committee: CommitteeDto | null): void {
    // Loading the saved values is not a person choosing a parent.
    this.filling = true;
    this.form.reset(
      {
        nameEn: committee?.nameEn ?? '',
        nameAr: committee?.nameAr ?? '',
        typeValueId: committee?.typeValueId ?? null,
        purpose: committee?.purpose ?? '',
        quorumCount: committee?.quorumCount ?? 0,
        meetingFrequency: committee?.meetingFrequency ?? 'AS_NEEDED',
        orgUnitId: committee?.orgUnitId ?? null,
        parentCommitteeId: committee?.parentCommitteeId ?? null,
        reportingToCommitteeId: committee?.reportingToCommitteeId ?? null,
      },
      { emitEvent: true },
    );
    this.filling = false;
    this.reportsToPrefilled.set(false);
    if (!committee) this.prefillRootUnit(this.orgUnits());
    this.form.markAsPristine();
  }

  private followParent(previous: string | null, next: string | null): void {
    if (this.filling) return;
    const reportsTo = this.form.controls.reportingToCommitteeId;
    const followed = reportsTo.value === null || reportsTo.value === previous;
    if (!followed) return;
    // Never fill in a committee the reports-to list leaves out.
    const allowed = next === null || this.reportingToOptions().some((c) => c.id === next);
    if (!allowed) return;
    reportsTo.setValue(next);
    reportsTo.markAsDirty();
    this.reportsToPrefilled.set(next !== null);
  }

  /**
   * A NEW committee starts owned by the organisation — ACC-135. Only on create,
   * only while the field is empty, and only when exactly one active root exists:
   * two roots is an ACC-134 violation the server refuses with its own message.
   */
  private prefillRootUnit(units: OrgUnitDto[]): void {
    if (this.loaded() || this.form.controls.orgUnitId.value) return;
    const roots = units.filter((u) => u.parentId === null && u.isActive);
    if (roots.length === 1) this.form.controls.orgUnitId.setValue(roots[0]!.id);
  }

  submit(): void {
    if (this.saving()) return;
    this.refusedField.set(null);
    this.clearRefusedErrors();
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.goToFirstError();
      return;
    }
    this.saving.set(true);
    this.footer.set(null);

    const value = this.form.getRawValue();
    const current = this.loaded();
    const dto: CreateCommitteeDto = {
      nameEn: value.nameEn!,
      nameAr: value.nameAr!,
      typeValueId: value.typeValueId!,
      purpose: value.purpose || undefined,
      quorumCount: value.quorumCount ?? undefined,
      meetingFrequency: value.meetingFrequency as CreateCommitteeDto['meetingFrequency'],
      // ACC-233 — on an EDIT a cleared parent or reports-to is sent as null.
      parentCommitteeId: value.parentCommitteeId || (current ? null : undefined),
      orgUnitId: value.orgUnitId || undefined,
      reportingToCommitteeId: value.reportingToCommitteeId || (current ? null : undefined),
    };

    const request = current
      ? this.committeeService.update(current.id, { ...dto, expectedUpdatedAt: current.updatedAt } satisfies UpdateCommitteeDto)
      : this.committeeService.create(dto);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.saved.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.failed(err);
      },
    });
  }

  /** Someone else saved first: read the committee again and show what is saved now. */
  reload(): void {
    const current = this.loaded();
    if (!current || this.reloading()) return;
    this.reloading.set(true);
    this.committeeService.getById(current.id).subscribe({
      next: (fresh) => {
        const tab = this.tab();
        this.open(fresh);
        this.tab.set(tab);
        this.reloaded.emit(fresh);
      },
      error: (err: unknown) => {
        this.reloading.set(false);
        this.footer.set(this.isUnreachable(err) ? { kind: 'unreachable' } : { kind: 'failed' });
      },
    });
  }

  private failed(err: unknown): void {
    if (refusalCode(err) === 'COMMITTEE_CHANGED') {
      this.footer.set({ kind: 'conflict' });
      return;
    }
    const refusal = committeeRefusal(err);
    if (refusal.field) {
      // In the field's own slot, on its own tab (ACC-233's codes).
      this.refusedField.set({ field: refusal.field, key: refusal.key });
      this.form.controls[refusal.field].setErrors({ ...(this.form.controls[refusal.field].errors ?? {}), refused: true });
      // Shown now, whether or not the field was touched: the server answered.
      this.showErrors.set(true);
      this.formTick.update((n) => n + 1);
      this.goToFirstError();
      return;
    }
    this.footer.set(this.isUnreachable(err) ? { kind: 'unreachable' } : { kind: 'failed' });
  }

  private isUnreachable(err: unknown): boolean {
    return err instanceof HttpErrorResponse && UNREACHABLE.has(err.status);
  }

  /** A refusal belongs to the value it was about: the next Save asks the server again. */
  private clearRefusedErrors(): void {
    for (const name of COMMITTEE_FORM_TABS.structure) {
      const control: AbstractControl = this.form.controls[name];
      if (control.hasError('refused')) control.updateValueAndValidity({ emitEvent: false });
    }
  }

  /** Move to the first tab with an error and focus its first invalid field. */
  private goToFirstError(): void {
    const first = TAB_ORDER.find((tab) => COMMITTEE_FORM_TABS[tab].some((name) => this.form.controls[name].invalid));
    if (!first) return;
    this.tab.set(first);
    const field = COMMITTEE_FORM_TABS[first].find((name) => this.form.controls[name].invalid)!;
    // After the panel is shown: a hidden panel's controls cannot take focus.
    setTimeout(() => {
      const holder = this.host.nativeElement.ownerDocument.querySelector(`[data-cf-field="${field}"]`);
      holder?.querySelector<HTMLElement>('input, textarea, button, [tabindex="0"]')?.focus();
    });
  }
}
