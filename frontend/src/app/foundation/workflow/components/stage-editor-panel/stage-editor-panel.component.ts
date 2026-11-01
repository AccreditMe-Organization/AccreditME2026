import {
  Component,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AmCountPipe, FormatService } from '../../../../core/formatting';
import {
  deadlineBeforeTasks,
  finalStageTaskCount,
  flagExactlyOne,
  plainWorkflowRefusalKey,
  whoMovedToStageMessage,
  whoRefusal,
} from '../../workflow-refusal';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import {
  WorkflowTemplateService,
  WorkflowTemplateDto,
  WorkflowStageDto,
  CreateWorkflowStageDto,
  UpdateWorkflowStageDto,
} from '../../services/workflow-template.service';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { InputNumberLatinDigits } from '../../../../core/formatting/latin-digits';
import { StageWhoComponent } from '../stage-who/stage-who.component';
import { StageWhoDraft } from '../stage-who/stage-who-draft';
import { StageWhoOptionsStore } from '../stage-who/stage-who-options.store';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { RowMenuComponent, RowMenuItem } from '../../../../shared/components/row-menu/row-menu.component';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { StageCheckRow, StageChecksComponent } from '../stage-checks/stage-checks.component';

/** The form's fields, in the order the panel shows them; each is also a stage field the server knows. */
const FIELD_LABELS: Record<string, string> = {
  nameEn: 'workflow.nameEn',
  nameAr: 'workflow.nameAr',
  description: 'workflow.description',
  slaWorkingHours: 'workflow.slaWorkingHours',
  isInitial: 'workflow.isInitial',
  isFinal: 'workflow.isFinal',
};

/** A label key's companion: the one-line description the drawing gives each row. */
const hintKey = (labelKey: string): string =>
  labelKey.replace('workflow.recordAction.', 'workflow.recordActionHint.').replace('workflow.stageFlag.', 'workflow.stageFlagHint.');

/** A flag's "needs one stage that …" phrase, for the exactly-one refusal. */
const needKey = (labelKey: string): string => labelKey.replace('workflow.stageFlag.', 'workflow.stageFlagNeed.');

/** What a refused save says, in the banner and (for a meaning) in its row. */
interface PanelRefusal {
  body: string;
  /** The meaning the refusal is about, for its row's own slot. */
  flagKey?: string;
  /** The other stage to open, when the refusal names one. */
  link?: { stageId: string; label: string };
}

/**
 * ACC-255 PR 4b — the stage editor as a PAGE PANEL (Templates 6b; plan §17),
 * between the flow strip and the stages list (Ahmad's Q1). It replaced the
 * stage form dialog: the editor measures over the 420px cap, so per the
 * template-3 rule it is a page panel, and the route scrolls as the document —
 * nothing in here scrolls.
 *
 * ACC-271 PR 5a — "Who works this stage" (drawing section 8, am-stage-who)
 * replaced the "Who the work lands on" and "How approval is reached" cards: the
 * panel sends `who`, never the old assignee or approval fields. A new stage's
 * first entry starts on Fixed position (ACC-136).
 *
 * It holds today's fields (in am-field wrappers), and the drawing's two new
 * sections, built from the template's registries and the stage's stored keys:
 *   - "What can be done to the record here": one row per record action, with
 *     "Also needs: {the permission's sentence}" from the server's permissionKey;
 *   - "What this stage means": one row per stage flag, with its cardinality.
 * Nothing here decides a rule: the rows are what the server lists, a save sends
 * the keys, and the server answers. A refusal is said from its code.
 *
 * A PROTECTED workflow (the server's isProtected) shows the protected sentence
 * and renders every field the server's editableStageFields leaves out
 * read-only, the two sections included (Ahmad's Q2).
 *
 * While ADDING a stage the two sections are absent and one line says they can
 * be set once it's added (Ahmad's Q1): the server applies its defaults, and the
 * panel reopens on the new stage showing what it stored.
 */
@Component({
  selector: 'am-stage-editor-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    AmCountPipe,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    InputNumberLatinDigits,
    CheckboxModule,
    FieldComponent,
    StageWhoComponent,
    RowMenuComponent,
    StageChecksComponent,
  ],
  template: `
    <section class="am-sep" aria-labelledby="sep-heading" (keydown.escape)="onEscape($event)" data-stage-panel>
      <header class="am-sep__head">
        <div class="am-sep__titles">
          <h2 id="sep-heading" class="am-sep__heading" tabindex="-1" #headingEl data-panel-heading>{{ heading() }}</h2>
          @if (positionText()) {
            <p class="am-sep__context">{{ positionText() }}</p>
          }
        </div>
        @if (stage && menu.length) {
          <am-row-menu
            [groups]="menu"
            [label]="'workflow.stageActionsFor' | translate: { name: heading() }"
            (picked)="menuPicked.emit($event)"
          />
        }
      </header>

      @if (isProtected()) {
        <div class="am-sep__banner am-sep__banner--muted" role="status" data-protected-banner>
          <p class="am-sep__banner-title">{{ 'workflow.editor.protectedTitle' | translate }}</p>
          <p class="am-sep__banner-body">{{ 'workflow.editor.protectedBody' | translate }}</p>
        </div>
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="am-sep__form" novalidate>
        <div class="am-sep__cards">
          <!-- The stage: its names, description and deadline, and where it sits. -->
          <div class="am-sep__card" data-card="identity">
            <h3 class="am-sep__card-title">{{ 'workflow.editor.identityTitle' | translate }}</h3>
            <am-field [label]="'workflow.nameEn' | translate" [control]="form.controls.nameEn" inputId="sep-nameEn"
              [readonly]="!editable('nameEn')" [readonlyText]="form.controls.nameEn.value ?? ''"
              [errorMessages]="{ required: 'workflow.editor.nameRequired' }" [forceShowErrors]="submitted()">
              <input pInputText id="sep-nameEn" formControlName="nameEn" autocomplete="off" />
            </am-field>
            <am-field [label]="'workflow.nameAr' | translate" [control]="form.controls.nameAr" inputId="sep-nameAr"
              [readonly]="!editable('nameAr')" [readonlyText]="form.controls.nameAr.value || '—'">
              <input pInputText id="sep-nameAr" formControlName="nameAr" dir="rtl" autocomplete="off" />
            </am-field>
            <am-field [label]="'workflow.description' | translate" [control]="form.controls.description" inputId="sep-description"
              [readonly]="!editable('description')" [readonlyText]="form.controls.description.value || '—'">
              <textarea pTextarea id="sep-description" rows="2" formControlName="description"></textarea>
            </am-field>
            <am-field [label]="'workflow.slaWorkingHours' | translate" [control]="form.controls.slaWorkingHours" inputId="sep-sla"
              [readonly]="!editable('slaWorkingHours')" [readonlyText]="deadlineText()"
              [hint]="slaRefusal() ? '' : deadlineText()">
              <!-- The field and its input fill the card and may shrink: the input's
                   own intrinsic width (its size attribute times the font's character
                   width) passed a 358px phone column on CI's Linux fonts. -->
              <p-inputNumber inputId="sep-sla" formControlName="slaWorkingHours" [min]="0" styleClass="w-full min-w-0"
                [inputStyleClass]="slaRefusal() ? 'w-full min-w-0 p-invalid' : 'w-full min-w-0'" />
            </am-field>
            @if (slaRefusal(); as refusal) {
              <small class="am-sep__refusal" role="alert" data-sla-refusal>{{ refusal }}</small>
            }
            <div class="am-sep__flags">
              @for (flag of boolFields; track flag) {
                @if (editable(flag)) {
                  <span class="am-sep__flag">
                    <p-checkbox [formControlName]="flag" [binary]="true" [inputId]="'sep-' + flag" />
                    <label [attr.for]="'sep-' + flag">{{ fieldLabel(flag) | translate }}</label>
                  </span>
                } @else {
                  <span class="am-sep__flag" [attr.data-readonly-field]="flag">
                    <span aria-hidden="true">{{ form.get(flag)?.value ? '✓' : '–' }}</span>
                    <span>{{ fieldLabel(flag) | translate }}</span>
                    <span class="am-sep__sr">{{ (form.get(flag)?.value ? 'common.yes' : 'common.no') | translate }}</span>
                  </span>
                }
              }
            </div>
            @if (finalRefusal(); as refusal) {
              <small class="am-sep__refusal" role="alert" data-final-refusal>{{ refusal }}</small>
            }
          </div>

          <!-- ACC-271 PR 5a — who works the stage, and how several of them decide. -->
          <am-stage-who
            class="am-sep__who"
            [draft]="whoDraft"
            [template]="templateSig()"
            [stage]="stageSig()"
            [readonly]="!editable('who')"
            [submitted]="submitted()"
          />
        </div>

        @if (!stage) {
          <!-- Ahmad's Q1: what a new stage allows is the server's default, set once it exists. -->
          <p class="am-sep__note" data-adding-note>{{ 'workflow.editor.addingNote' | translate }}</p>
        } @else {
          <section class="am-sep__section" data-section="actions" aria-labelledby="sep-actions-title">
            <h3 id="sep-actions-title" class="am-sep__section-title">{{ 'workflow.editor.actionsTitle' | translate }}</h3>
            @if (actionRows().length) {
              <p class="am-sep__section-note">{{ 'workflow.editor.actionsNote' | translate }}</p>
              <am-stage-checks
                [rows]="actionRows()"
                [readonly]="!editable('actions')"
                [label]="'workflow.editor.actionsTitle' | translate"
                idPrefix="sep-action-"
                [onLabel]="'workflow.editor.allowed' | translate"
                [offLabel]="'workflow.editor.notAllowed' | translate"
                (toggled)="toggleAction($event.key, $event.checked)"
              />
            } @else {
              <p class="am-sep__section-note" data-actions-empty>{{ 'workflow.editor.actionsEmpty' | translate }}</p>
            }
          </section>

          <section class="am-sep__section" data-section="meanings" aria-labelledby="sep-meanings-title">
            <h3 id="sep-meanings-title" class="am-sep__section-title">{{ 'workflow.editor.meaningsTitle' | translate }}</h3>
            @if (meaningRows().length) {
              <p class="am-sep__section-note">{{ 'workflow.editor.meaningsNote' | translate }}</p>
              <am-stage-checks
                [rows]="meaningRows()"
                [readonly]="!editable('flags')"
                [label]="'workflow.editor.meaningsTitle' | translate"
                idPrefix="sep-meaning-"
                [onLabel]="'workflow.editor.meansThis' | translate"
                [offLabel]="'workflow.editor.doesNotMeanThis' | translate"
                (toggled)="toggleFlag($event.key, $event.checked)"
              />
            } @else {
              <p class="am-sep__section-note" data-meanings-empty>{{ 'workflow.editor.meaningsEmpty' | translate }}</p>
            }
          </section>
        }

        @if (changedNames().length) {
          <p class="am-sep__banner am-sep__banner--info am-sep__banner-body" data-changed-note>
            {{ 'workflow.editor.changedSince' | translate: { names: changedNames().join(listSeparator()) } }}
          </p>
        }

        @if (refusal(); as r) {
          <div class="am-sep__banner am-sep__banner--danger" role="alert" data-panel-refusal>
            <p class="am-sep__banner-title">{{ 'workflow.editor.cantSave' | translate }}</p>
            <p class="am-sep__banner-body">{{ r.body }}</p>
            @if (r.link; as link) {
              <button type="button" class="am-sep__link" (click)="openStage.emit(link.stageId)" data-refusal-link>{{ link.label }}</button>
            }
          </div>
        }

        <footer class="am-sep__foot">
          <span class="am-sep__count" aria-live="polite" data-change-count>
            @if (changeCount()) {
              {{ changeCount() | amCount: 'workflow.editorChanges' }}
            } @else if (savedNotice()) {
              {{ 'workflow.editor.saved' | translate }}
            }
          </span>
          <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" (onClick)="closed.emit()" data-panel-cancel />
          <p-button type="submit" [label]="(stage ? 'workflow.editor.saveStage' : 'workflow.addStage') | translate" [loading]="saving()" data-panel-save />
        </footer>
      </form>
    </section>
  `,
  styles: [
    `
      .am-sep {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-16);
        padding: var(--am-space-16);
        background: var(--am-card);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
      }
      .am-sep__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--am-space-12);
      }
      .am-sep__titles {
        min-inline-size: 0;
      }
      .am-sep__heading {
        margin: 0;
        font-size: 18px;
        line-height: 26px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .am-sep__heading:focus-visible {
        outline: 2px solid var(--am-primary-600);
        outline-offset: 2px;
      }
      .am-sep__context {
        margin: 0;
        font-size: var(--am-type-meta-size);
        color: var(--am-text-secondary);
      }
      .am-sep__form {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-16);
      }
      .am-sep__form {
        container-type: inline-size;
      }
      /* The stage's card beside "Who works this stage" where there is room
         (the list needs the wider column); one above the other otherwise. */
      .am-sep__cards {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--am-space-16);
        align-items: start;
      }
      @container (min-width: 900px) {
        .am-sep__cards {
          grid-template-columns: minmax(280px, 1fr) minmax(0, 2fr);
        }
      }
      .am-sep__who {
        min-inline-size: 0;
      }
      .am-sep__card {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-4);
        min-inline-size: 0;
        padding: var(--am-space-12);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-control);
      }
      /* A card's fields shrink with the card, never past it. */
      .am-sep__card > * {
        min-inline-size: 0;
      }
      .am-sep__card-title,
      .am-sep__section-title {
        margin: 0 0 var(--am-space-4);
        font-size: var(--am-type-body-size);
        font-weight: 600;
      }
      .am-sep__section {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
        min-inline-size: 0;
      }
      .am-sep__section-note,
      .am-sep__note {
        margin: 0;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-text-secondary);
      }
      .am-sep__flags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-16);
      }
      .am-sep__flag {
        display: inline-flex;
        align-items: center;
        gap: var(--am-space-8);
        font-size: var(--am-type-body-size);
      }
      .am-sep__refusal {
        font-size: var(--am-type-meta-size);
        font-weight: 500;
        color: var(--am-danger-ink);
      }
      .am-sep__banner {
        margin: 0;
        padding: var(--am-space-8) var(--am-space-12);
        border-radius: var(--am-radius-control);
        border: 1px solid;
      }
      .am-sep__banner--muted {
        background: var(--am-surface);
        border-color: var(--am-border);
      }
      .am-sep__banner--info {
        background: var(--am-info-bg);
        border-color: var(--am-info-border);
      }
      .am-sep__banner--danger {
        background: var(--am-danger-bg);
        border-color: var(--am-danger-border);
      }
      .am-sep__banner-title {
        margin: 0;
        font-weight: 600;
      }
      .am-sep__banner--danger .am-sep__banner-title {
        color: var(--am-danger-ink);
      }
      .am-sep__banner-body {
        margin: 0;
        font-size: var(--am-type-body-size);
      }
      .am-sep__link {
        margin-block-start: var(--am-space-4);
        padding: 0;
        background: none;
        border: 0;
        font: inherit;
        color: var(--am-primary-700);
        text-decoration: underline;
        cursor: pointer;
      }
      .am-sep__foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--am-space-8);
        padding-block-start: var(--am-space-12);
        border-block-start: 1px solid var(--am-border);
      }
      .am-sep__count {
        margin-inline-end: auto;
        font-size: var(--am-type-meta-size);
        color: var(--am-text-secondary);
      }
      .am-sep__sr {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    `,
  ],
})
export class StageEditorPanelComponent implements OnInit, OnChanges {
  /** The stage being edited; null while adding one. */
  @Input() stage: WorkflowStageDto | null = null;
  @Input() template: WorkflowTemplateDto | null = null;
  @Input() nextOrder = 10;
  /** The panel's ⋯ (Move up, Move down, Remove), from the page; empty for none. */
  @Input() menu: RowMenuItem[][] = [];
  @Output() saved = new EventEmitter<WorkflowStageDto>();
  @Output() closed = new EventEmitter<void>();
  /** A refusal names another stage: open it. */
  @Output() openStage = new EventEmitter<string>();
  @Output() menuPicked = new EventEmitter<string>();

  @ViewChild('headingEl', { static: true }) private headingRef!: ElementRef<HTMLElement>;

  readonly boolFields = ['isInitial', 'isFinal'];

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly languageService = inject(LanguageService);
  private readonly fb = inject(FormBuilder);
  private readonly whoOptions = inject(StageWhoOptionsStore);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly layers = inject(LayerStackService);
  private readonly confirm = inject(AmConfirmService);
  private readonly injector = inject(Injector);

  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly savedNotice = signal(false);
  readonly refusal = signal<PanelRefusal | null>(null);
  // ACC-208 — a refusal shown under its own field; cleared when that field changes.
  readonly slaRefusal = signal<string | null>(null);
  readonly finalRefusal = signal<string | null>(null);
  /** ACC-271 PR 5a — "Who works this stage" while it is edited; loaded with the stage. */
  readonly whoDraft = new StageWhoDraft();

  /** The stage's record actions and meanings as ticked now, and as loaded or last saved. */
  readonly actions = signal<ReadonlySet<string>>(new Set());
  readonly flags = signal<ReadonlySet<string>>(new Set());
  private readonly baseActions = signal<ReadonlySet<string>>(new Set());
  private readonly baseFlags = signal<ReadonlySet<string>>(new Set());
  private readonly baseForm = signal<Record<string, unknown>>({});
  /** Bumped on every form change, so the computeds below re-read the form. */
  private readonly formTick = signal(0);
  /** The inputs, as signals for the computeds. */
  readonly templateSig = signal<WorkflowTemplateDto | null>(null);
  readonly stageSig = signal<WorkflowStageDto | null>(null);

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(100)]],
    // ACC-160 — the Arabic name is OPTIONAL; maxLength stays.
    nameAr: ['', [Validators.maxLength(100)]],
    description: [''],
    slaWorkingHours: [null as number | null, [Validators.min(0)]],
    isInitial: [false],
    isFinal: [false],
  });

  readonly isProtected = computed(() => !!this.templateSig()?.isProtected);

  /**
   * Whether a stage field may change: always, unless the workflow is protected,
   * where only the fields the server lists (editableStageFields) may. A
   * protected template whose read lists none leaves everything read-only.
   */
  editable(field: string): boolean {
    const template = this.templateSig();
    if (!template?.isProtected) return true;
    return (template.editableStageFields ?? []).includes(field);
  }

  readonly heading = computed(() => {
    this.translate.currentLang();
    const stage = this.stageSig();
    return stage ? this.languageService.bilingual(stage.nameEn, stage.nameAr) : (this.translate.instant('workflow.addStage') as string);
  });

  readonly positionText = computed(() => {
    this.translate.currentLang();
    const stages = this.templateSig()?.stages ?? [];
    const stage = this.stageSig();
    const index = stage ? stages.findIndex((s) => s.id === stage.id) : -1;
    if (index < 0) return '';
    return this.translate.instant('workflow.editor.position', {
      n: this.format.number(index + 1),
      total: this.format.number(stages.length),
    }) as string;
  });

  readonly deadlineText = computed(() => {
    this.formTick();
    this.translate.currentLang();
    const hours = this.form.controls.slaWorkingHours.value;
    return hours === null || hours === undefined
      ? (this.translate.instant('workflow.editor.noDeadline') as string)
      : this.format.count('workflow.workingHours', hours);
  });

  readonly actionRows = computed<StageCheckRow[]>(() => {
    this.translate.currentLang();
    const on = this.actions();
    const base = this.baseActions();
    return (this.templateSig()?.recordActions ?? []).map((a) => ({
      key: a.key,
      title: this.translate.instant(a.labelKey) as string,
      description: this.optional(hintKey(a.labelKey)),
      aside: a.permissionKey
        ? (this.translate.instant('workflow.editor.alsoNeeds', {
            permission: this.translate.instant(`roles.matrix.sentence.${a.permissionKey}`),
          }) as string)
        : '',
      checked: on.has(a.key),
      changed: on.has(a.key) !== base.has(a.key),
      error: '',
    }));
  });

  readonly meaningRows = computed<StageCheckRow[]>(() => {
    this.translate.currentLang();
    const on = this.flags();
    const base = this.baseFlags();
    const refusal = this.refusal();
    return (this.templateSig()?.stageFlags ?? []).map((f) => ({
      key: f.key,
      title: this.translate.instant(f.labelKey) as string,
      description: this.optional(hintKey(f.labelKey)),
      aside: this.translate.instant(f.cardinality === 'exactlyOne' ? 'workflow.editor.exactlyOne' : 'workflow.editor.anyNumber') as string,
      checked: on.has(f.key),
      changed: on.has(f.key) !== base.has(f.key),
      error: refusal?.flagKey === f.key ? refusal.body : '',
    }));
  });

  /** Every change since the stage was loaded or last saved, named. */
  readonly changedNames = computed<string[]>(() => {
    this.formTick();
    this.translate.currentLang();
    const base = this.baseForm();
    const now = this.form.getRawValue() as Record<string, unknown>;
    const fields = Object.keys(FIELD_LABELS)
      .filter((f) => normal(now[f]) !== normal(base[f]))
      .map((f) => this.translate.instant(FIELD_LABELS[f]!) as string);
    const who = this.editable('who') && this.whoDraft.hasChanges() ? [this.translate.instant('workflow.who.title') as string] : [];
    const rows = [...this.actionRows(), ...this.meaningRows()].filter((r) => r.changed).map((r) => r.title);
    return [...fields, ...who, ...rows];
  });
  readonly changeCount = computed(() => this.changedNames().length);
  readonly hasChanges = computed(() => this.changeCount() > 0);

  readonly listSeparator = computed(() => (this.languageService.isArabic() ? '، ' : ', '));

  constructor() {
    this.form.valueChanges.subscribe(() => {
      this.formTick.update((n) => n + 1);
      this.savedNotice.set(false);
    });
    // ACC-208 — a refusal stands only until the field it is about changes.
    this.form.controls.slaWorkingHours.valueChanges.subscribe(() => this.slaRefusal.set(null));
    this.form.controls.isFinal.valueChanges.subscribe(() => this.finalRefusal.set(null));
  }

  ngOnInit(): void {
    // ACC-271 PR 5a — the who section's lists, together, once for the page.
    if (this.editable('who')) this.whoOptions.ensureLoaded();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['template']) this.templateSig.set(this.template);
    if (!changes['stage']) return;
    const previous = changes['stage'].previousValue as WorkflowStageDto | null | undefined;
    const switched = changes['stage'].firstChange || previous?.id !== this.stage?.id;
    this.stageSig.set(this.stage);
    // ACC-55 — a reload of the SAME stage never clobbers unsaved work in the panel.
    if (!switched && this.hasChanges()) return;
    this.load(this.stage);
    if (switched) {
      this.refusal.set(null);
      this.savedNotice.set(false);
      this.submitted.set(false);
      // A stage the panel just added reopens on itself: focus stays where it is.
      if (previous !== null || changes['stage'].firstChange) this.focusHeading();
    }
  }

  /** Moves focus to the panel's heading, once it is rendered. */
  focusHeading(): void {
    afterNextRender(() => this.headingRef?.nativeElement.focus(), { injector: this.injector });
  }

  private load(stage: WorkflowStageDto | null): void {
    this.form.reset({
      nameEn: stage?.nameEn ?? '',
      nameAr: stage?.nameAr ?? '',
      description: stage?.description ?? '',
      slaWorkingHours: stage?.slaWorkingHours ?? null,
      isInitial: stage?.isInitial ?? false,
      isFinal: stage?.isFinal ?? false,
    });
    this.baseForm.set(this.form.getRawValue() as Record<string, unknown>);
    this.whoDraft.load(stage, this.templateSig());
    const actions = new Set(stage?.actions ?? []);
    const flags = new Set(stage?.flags ?? []);
    this.actions.set(actions);
    this.flags.set(flags);
    this.baseActions.set(actions);
    this.baseFlags.set(flags);
    this.slaRefusal.set(null);
    this.finalRefusal.set(null);
  }

  toggleAction(key: string, checked: boolean): void {
    this.actions.update((s) => toggled(s, key, checked));
    this.savedNotice.set(false);
  }

  toggleFlag(key: string, checked: boolean): void {
    this.flags.update((s) => toggled(s, key, checked));
    this.savedNotice.set(false);
    if (this.refusal()?.flagKey) this.refusal.set(null);
  }

  fieldLabel(field: string): string {
    return FIELD_LABELS[field] ?? field;
  }

  /** Escape cancels, but only when no overlay above the panel is open (a select, a menu, a confirm). */
  onEscape(event: Event): void {
    if (this.layers.depth() > 0) return;
    event.preventDefault();
    if (!this.hasChanges()) {
      this.closed.emit();
      return;
    }
    this.confirm.ask({
      tone: 'destructive',
      header: this.translate.instant('dialog.discardHeader'),
      message: this.translate.instant('dialog.discardMessage'),
      acceptLabel: this.translate.instant('dialog.discard'),
      accept: () => this.closed.emit(),
    });
  }

  /** A translation that may not exist: '' when it does not. */
  private optional(key: string): string {
    const text = this.translate.instant(key) as string;
    return text === key ? '' : text;
  }

  onSubmit(): void {
    this.submitted.set(true);
    // Both checked, so every missing value shows at once (Save is never disabled).
    const whoComplete = !this.editable('who') || this.whoDraft.validate();
    if (this.form.invalid || !whoComplete) return;
    this.saving.set(true);
    this.refusal.set(null);
    this.savedNotice.set(false);

    const raw = this.form.getRawValue();
    const stage = this.stage;
    // ACC-271 PR 5a — `who`, never the old assignee or approval fields: sent
    // when adding, and when the stage editor changed it.
    const sendWho = this.editable('who') && (!stage || this.whoDraft.hasChanges());
    const shared = {
      nameEn: raw.nameEn!,
      nameAr: raw.nameAr!,
      ...(raw.description ? { description: raw.description } : {}),
      ...(raw.slaWorkingHours != null ? { slaWorkingHours: raw.slaWorkingHours } : {}),
      isInitial: raw.isInitial!,
      isFinal: raw.isFinal!,
      ...(sendWho ? { who: this.whoDraft.write() } : {}),
    };
    // ACC-255 — the two sections are sent only when the stage editor changed
    // them, in registry order, and never where the workflow keeps them fixed.
    const order = <T extends { key: string }>(registry: T[] | undefined, on: ReadonlySet<string>): string[] =>
      (registry ?? []).filter((r) => on.has(r.key)).map((r) => r.key);
    const rules = {
      ...(this.editable('actions') && !sameSet(this.actions(), this.baseActions())
        ? { actions: order(this.template?.recordActions, this.actions()) }
        : {}),
      ...(this.editable('flags') && !sameSet(this.flags(), this.baseFlags())
        ? { flags: order(this.template?.stageFlags, this.flags()) }
        : {}),
    };

    const request$ = stage
      ? this.workflowTemplateService.updateStage(stage.id, { ...shared, ...rules } satisfies UpdateWorkflowStageDto)
      : this.workflowTemplateService.addStage(this.template?.id ?? '', { ...shared, order: this.nextOrder } satisfies CreateWorkflowStageDto);

    request$.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.submitted.set(false);
        // What was just saved is the new baseline: the changed tint clears.
        this.baseForm.set(this.form.getRawValue() as Record<string, unknown>);
        this.baseActions.set(this.actions());
        this.baseFlags.set(this.flags());
        this.whoDraft.markSaved();
        this.savedNotice.set(true);
        this.saved.emit(saved);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        if (this.showFieldRefusal(err)) return;
        this.refusal.set(this.panelRefusal(err));
      },
    });
  }

  /** The refusals with a field to stand under (ACC-208): worded from the code and numbers. True when shown. */
  private showFieldRefusal(err: unknown): boolean {
    // ACC-271 PR 5a — a refused `who` lands in its slot: the section, the mode, or a row's field.
    const who = whoRefusal(err);
    if (who && this.whoDraft.applyRefusal(who)) return true;
    const deadline = deadlineBeforeTasks(err);
    if (deadline) {
      this.slaRefusal.set(
        this.translate.instant('workflow.stageDeadline.beforeTasks', {
          longest: this.format.count('workflow.workingHours', deadline.longestTaskHours),
          min: deadline.longestTaskHours,
        }),
      );
      document.getElementById('sep-sla')?.focus();
      return true;
    }
    const count = finalStageTaskCount(err);
    if (count !== null) {
      this.finalRefusal.set(this.translate.instant('workflow.stageDeadline.finalWithTasks', { tasks: this.format.count('workflow.stageTasks', count) }));
      document.getElementById('sep-isFinal')?.focus();
      return true;
    }
    return false;
  }

  /** Every other refusal, for the banner: the exactly-one meaning names and links the other stage. */
  private panelRefusal(err: unknown): PanelRefusal {
    const exactlyOne = flagExactlyOne(err);
    if (exactlyOne) {
      const flagDef = this.template?.stageFlags?.find((f) => f.key === exactlyOne.flag);
      const flagLabel = flagDef ? (this.translate.instant(flagDef.labelKey) as string) : exactlyOne.flag;
      const other = exactlyOne.stages.find((s) => s.id !== this.stage?.id);
      if (other) {
        const name = this.languageService.bilingual(other.nameEn, other.nameAr);
        return {
          flagKey: exactlyOne.flag,
          body: this.translate.instant('workflow.editor.flagOnOther', { flag: flagLabel, stage: name }),
          link: { stageId: other.id, label: this.translate.instant('workflow.editor.openStage', { name }) },
        };
      }
      const need = flagDef ? this.optional(needKey(flagDef.labelKey)) : '';
      return {
        flagKey: exactlyOne.flag,
        body: need
          ? this.translate.instant('workflow.editor.flagMissing', { need })
          : this.translate.instant('workflow.editor.flagMissingNamed', { flag: flagLabel }),
      };
    }
    // ACC-271 PR 3 — a changed old people field: the server's own sentence, in
    // the reader's language. Shown as it is, never looked up as a key.
    const whoMoved = whoMovedToStageMessage(err, this.languageService.isArabic());
    if (whoMoved) return { body: whoMoved };
    const key = plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.saveFailed');
    return { body: this.translate.instant(key) };
  }
}

/** A form value as compared for "changed": '' and null are the same nothing. */
function normal(value: unknown): unknown {
  return value === '' || value === undefined ? null : value;
}

function toggled(set: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((k) => b.has(k));
}
