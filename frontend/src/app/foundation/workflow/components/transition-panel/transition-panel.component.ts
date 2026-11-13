import {
  Component,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { AmCountPipe, FormatService } from '../../../../core/formatting';
import {
  WorkflowTemplateService,
  WorkflowTemplateDto,
  WorkflowStageDto,
  WorkflowTransitionDto,
  WorkflowTransitionKind,
  WORKFLOW_TRANSITION_KINDS,
  CreateWorkflowTransitionDto,
  UpdateWorkflowTransitionDto,
} from '../../services/workflow-template.service';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { plainWorkflowRefusalKey, removeRefusal } from '../../workflow-refusal';
import { workflowLabelKey } from '../../workflow-labels';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { TransitionActionsDialogComponent } from '../transition-actions-dialog/transition-actions-dialog.component';

/** The form's fields, named for "n changes" and the changed note. */
const FIELD_LABELS: Record<string, string> = {
  labelEn: 'workflow.nameEn',
  labelAr: 'workflow.nameAr',
  toStageId: 'workflow.transitionPanel.to',
  kind: 'workflow.kind.label',
};

// ACC-208 — literal keys, so the translation-keys spec sees each one.
const KIND_HELP_KEYS: Record<WorkflowTransitionKind, string> = {
  ADVANCE: 'workflow.kind.advanceHelp',
  RETURN: 'workflow.kind.returnHelp',
  EXIT: 'workflow.kind.exitHelp',
};

/** Splits a sentence around one placeholder, so the placeholder can be a link. */
const MARK = '\u0001';

/**
 * ACC-271 PR 5b — a transition in a PAGE PANEL on the Stages page (drawing
 * sections 9 and 10), built like the stage editor panel and in its slot: one
 * panel is open at a time, and the route scrolls as the document.
 *
 * It replaced the Add and Edit transition dialogs. What it holds:
 *   - its names, From (read-only), To (chosen when adding, read-only after),
 *     Kind and Approval path;
 *   - "How it moves": A person only for now — "Pressed by whoever works
 *     {stage}", the stage a link that opens that stage's panel. Whoever works
 *     the from-stage presses it; a transition names no people (round 4).
 *     "Automatically", "Share in turn" and "Show this button only when" are not
 *     built (ACC-270, step 2);
 *   - its automatic actions, in a dialog given the transition as last loaded.
 *
 * "Who can trigger", Required permission, the permission warning and the raw
 * validator JSON are gone: a save sends none of them, so the stored values are
 * left as they are.
 *
 * READ-ONLY in two cases, with Close and no Save or Remove:
 *   - a move the app runs (the server's mover APP): the server's `appMove` line
 *     and "The app runs this move itself, so it can't be changed here.";
 *   - a protected workflow (the server's isProtected), whose moves the server
 *     refuses to change (409 WORKFLOW_TEMPLATE_PROTECTED).
 */
@Component({
  selector: 'am-transition-panel',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    TranslatePipe,
    AmCountPipe,
    ButtonModule,
    InputTextModule,
    FieldComponent,
    OverlaySelectComponent,
    TransitionActionsDialogComponent,
  ],
  template: `
    <section class="am-tp" aria-labelledby="tp-heading" (keydown.escape)="onEscape($event)" data-transition-panel>
      <header class="am-tp__head">
        <h2 id="tp-heading" class="am-tp__heading" tabindex="-1" #headingEl data-panel-heading>{{ heading() }}</h2>
        @if (contextText()) {
          <p class="am-tp__context" data-panel-context>{{ contextText() }}</p>
        }
      </header>

      @if (appRun()) {
        <div class="am-tp__banner am-tp__banner--muted" role="status" data-app-run-banner>
          @if (appMoveLine()) {
            <p class="am-tp__banner-title" data-app-move>{{ appMoveLine() }}</p>
          }
          <p class="am-tp__banner-body">{{ 'workflow.transitionPanel.appRunBody' | translate }}</p>
        </div>
      } @else if (isProtected()) {
        <div class="am-tp__banner am-tp__banner--muted" role="status" data-protected-banner>
          <p class="am-tp__banner-title">{{ 'workflow.editor.protectedTitle' | translate }}</p>
          <p class="am-tp__banner-body">{{ 'workflow.refusal.protected.TRANSITION' | translate }}</p>
        </div>
      }

      @if (readonly()) {
        <dl class="am-tp__pairs" data-readonly-pairs>
          <div class="am-tp__pair">
            <dt>{{ 'workflow.nameEn' | translate }}</dt>
            <dd>{{ transition?.labelEn }}</dd>
          </div>
          <div class="am-tp__pair">
            <dt>{{ 'workflow.nameAr' | translate }}</dt>
            <dd dir="rtl">{{ transition?.labelAr || '—' }}</dd>
          </div>
          <div class="am-tp__pair">
            <dt>{{ 'workflow.transitionPanel.from' | translate }}</dt>
            <dd data-from>{{ fromName() }}</dd>
          </div>
          <div class="am-tp__pair">
            <dt>{{ 'workflow.transitionPanel.to' | translate }}</dt>
            <dd data-to>{{ toName() }}</dd>
          </div>
          <div class="am-tp__pair">
            <dt>{{ 'workflow.kind.label' | translate }}</dt>
            <dd data-kind>{{ kindLabelKey(transition?.kind) | translate }}</dd>
          </div>
          @if (!appRun()) {
            <div class="am-tp__pair">
              <dt>{{ 'workflow.transitionPanel.howItMoves' | translate }}</dt>
              <dd>
                {{ 'workflow.mover.PERSON' | translate }} ·
                <ng-container *ngTemplateOutlet="pressedByTpl" />
              </dd>
            </div>
          }
          <div class="am-tp__pair">
            <dt>{{ 'workflow.transitionPanel.actionsTitle' | translate }}</dt>
            <dd data-actions-summary>{{ actionsSummary() }}</dd>
          </div>
        </dl>
        @if (transition?.actions?.length) {
          <p-button
            [label]="'workflow.transitionPanel.viewActions' | translate"
            severity="secondary"
            [outlined]="true"
            size="small"
            (onClick)="actionsOpen.set(true)"
            data-open-actions
          />
        }
        <footer class="am-tp__foot">
          <p-button [label]="'common.close' | translate" severity="secondary" type="button" (onClick)="closed.emit()" data-panel-close />
        </footer>
      } @else {
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="am-tp__form" novalidate>
          <div class="am-tp__row">
            <am-field [label]="'workflow.nameEn' | translate" [control]="form.controls.labelEn" inputId="tp-labelEn"
              [errorMessages]="{ required: 'workflow.transitionPanel.nameRequired' }" [forceShowErrors]="submitted()">
              <input pInputText id="tp-labelEn" formControlName="labelEn" autocomplete="off" />
            </am-field>
            <am-field [label]="'workflow.nameAr' | translate" [control]="form.controls.labelAr" inputId="tp-labelAr">
              <input pInputText id="tp-labelAr" formControlName="labelAr" dir="rtl" autocomplete="off" />
            </am-field>
          </div>

          <div class="am-tp__row am-tp__row--three">
            <am-field [label]="'workflow.transitionPanel.from' | translate" [readonly]="true" [readonlyText]="fromName()"></am-field>
            @if (adding()) {
              <am-field [label]="'workflow.transitionPanel.to' | translate" [control]="form.controls.toStageId" inputId="tp-to"
                [errorMessages]="{ required: 'workflow.transitionPanel.toRequired' }" [forceShowErrors]="submitted()">
                <app-overlay-select
                  formControlName="toStageId"
                  [ariaLabel]="'workflow.transitionPanel.to' | translate"
                  [options]="stageOptions()"
                  optionLabel="label"
                  optionValue="value"
                  [placeholder]="'workflow.transitionPanel.chooseStage' | translate"
                  data-to-select
                />
              </am-field>
            } @else {
              <am-field [label]="'workflow.transitionPanel.to' | translate" [readonly]="true" [readonlyText]="toName()"></am-field>
            }
            <am-field [label]="'workflow.kind.label' | translate" [control]="form.controls.kind" inputId="tp-kind"
              [hint]="kindHelpKey() | translate">
              <app-overlay-select
                formControlName="kind"
                [ariaLabel]="'workflow.kind.label' | translate"
                [options]="kindOptions()"
                optionLabel="label"
                optionValue="value"
                data-kind-select
              />
            </am-field>
          </div>

          <!-- ACC-284 — no "approval path" box: on a stage decided together, the
               move's Kind says whether a press is a vote, and the engine no longer
               reads the flag. Edits leave the stored value alone (it is dropped later). -->
          <section class="am-tp__section" aria-labelledby="tp-moves-title" data-section="how-it-moves">
            <h3 id="tp-moves-title" class="am-tp__section-title">{{ 'workflow.transitionPanel.howItMoves' | translate }}</h3>
            <!-- Only "A person" for now: "Automatically" waits for step 2. -->
            <span class="am-tp__seg" data-mover>{{ 'workflow.mover.PERSON' | translate }}</span>
            <p class="am-tp__line" data-pressed-by><ng-container *ngTemplateOutlet="pressedByTpl" /></p>
          </section>

          <section class="am-tp__section" aria-labelledby="tp-actions-title" data-section="actions">
            <h3 id="tp-actions-title" class="am-tp__section-title">{{ 'workflow.transitionPanel.actionsTitle' | translate }}</h3>
            @if (adding()) {
              <p class="am-tp__line" data-actions-adding>{{ 'workflow.transitionPanel.actionsAdding' | translate }}</p>
            } @else {
              <p class="am-tp__line" data-actions-summary>{{ actionsSummary() }}</p>
              <span>
                <p-button
                  [label]="'workflow.transitionPanel.changeActions' | translate"
                  severity="secondary"
                  [outlined]="true"
                  size="small"
                  (onClick)="actionsOpen.set(true)"
                  data-open-actions
                />
              </span>
            }
          </section>

          @if (refusal(); as r) {
            <div class="am-tp__banner am-tp__banner--danger" role="alert" data-panel-refusal>
              <p class="am-tp__banner-title">{{ 'workflow.transitionPanel.cantSave' | translate }}</p>
              <p class="am-tp__banner-body">{{ r }}</p>
            </div>
          }

          <footer class="am-tp__foot">
            <span class="am-tp__count" aria-live="polite" data-change-count>
              @if (changeCount()) {
                {{ changeCount() | amCount: 'workflow.editorChanges' }}
              } @else if (savedNotice()) {
                {{ 'workflow.transitionPanel.saved' | translate }}
              }
            </span>
            @if (!adding()) {
              <p-button
                [label]="'workflow.transitionPanel.remove' | translate"
                severity="danger"
                [text]="true"
                type="button"
                [disabled]="saving()"
                (onClick)="onRemove()"
                data-panel-remove
              />
            }
            <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" (onClick)="closed.emit()" data-panel-cancel />
            <p-button
              type="submit"
              [label]="(adding() ? 'workflow.addTransition' : 'workflow.transitionPanel.save') | translate"
              [loading]="saving()"
              data-panel-save
            />
          </footer>
        </form>
      }

      <!-- "Pressed by whoever works {stage}": the stage is a link to its panel. -->
      <ng-template #pressedByTpl>
        {{ pressedBy().before }}<a
          class="am-tp__link"
          [attr.href]="'?stage=' + (fromStage()?.id ?? '')"
          (click)="onStageLink($event)"
          data-stage-link
        >{{ fromName() }}</a>{{ pressedBy().after }}
      </ng-template>
    </section>

    <am-transition-actions-dialog
      [transition]="transition"
      [isProtected]="readonly()"
      [visible]="actionsOpen()"
      (visibleChange)="actionsOpen.set($event)"
      (changed)="actionsChanged.emit()"
    />
  `,
  styles: [
    `
      .am-tp {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-16);
        padding: var(--am-space-16);
        background: var(--am-card);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
        container-type: inline-size;
      }
      .am-tp__heading {
        margin: 0;
        font-size: 18px;
        line-height: 26px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .am-tp__heading:focus-visible {
        outline: 2px solid var(--am-primary-600);
        outline-offset: 2px;
      }
      .am-tp__context {
        margin: 0;
        font-size: var(--am-type-meta-size);
        color: var(--am-text-secondary);
        overflow-wrap: anywhere;
      }
      .am-tp__form {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-16);
      }
      /* Two fields beside each other where there is room, one above the other otherwise. */
      .am-tp__row {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--am-space-12);
      }
      @container (min-width: 560px) {
        .am-tp__row {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .am-tp__row--three {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      .am-tp__row > * {
        min-inline-size: 0;
      }
      .am-tp__section {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--am-space-8);
        min-inline-size: 0;
      }
      .am-tp__section-title {
        margin: 0;
        font-size: var(--am-type-body-size);
        font-weight: 600;
      }
      .am-tp__seg {
        display: inline-block;
        padding: var(--am-space-4) var(--am-space-12);
        font-size: var(--am-type-body-size);
        font-weight: 500;
        color: var(--am-primary-700);
        background: var(--am-primary-100);
        border: 1px solid var(--am-primary-600);
        border-radius: var(--am-radius-control);
      }
      .am-tp__line {
        margin: 0;
        font-size: var(--am-type-body-size);
        overflow-wrap: anywhere;
      }
      .am-tp__link {
        color: var(--am-primary-700);
        text-decoration: underline;
      }
      .am-tp__link:focus-visible {
        outline: 2px solid var(--am-primary-600);
        outline-offset: 2px;
        border-radius: var(--am-radius-control);
      }
      .am-tp__pairs {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--am-space-12);
        margin: 0;
      }
      @container (min-width: 560px) {
        .am-tp__pairs {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      .am-tp__pair {
        min-inline-size: 0;
      }
      .am-tp__pair dt {
        font-size: var(--am-type-meta-size);
        color: var(--am-text-secondary);
      }
      .am-tp__pair dd {
        margin: 0;
        font-size: var(--am-type-body-size);
        overflow-wrap: anywhere;
      }
      .am-tp__banner {
        margin: 0;
        padding: var(--am-space-8) var(--am-space-12);
        border-radius: var(--am-radius-control);
        border: 1px solid;
      }
      .am-tp__banner--muted {
        background: var(--am-surface);
        border-color: var(--am-border);
      }
      .am-tp__banner--danger {
        background: var(--am-danger-bg);
        border-color: var(--am-danger-border);
      }
      .am-tp__banner-title {
        margin: 0;
        font-weight: 600;
      }
      .am-tp__banner--danger .am-tp__banner-title {
        color: var(--am-danger-ink);
      }
      .am-tp__banner-body {
        margin: 0;
        font-size: var(--am-type-body-size);
      }
      .am-tp__foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--am-space-8);
        padding-block-start: var(--am-space-12);
        border-block-start: 1px solid var(--am-border);
      }
      .am-tp__count {
        margin-inline-end: auto;
        font-size: var(--am-type-meta-size);
        color: var(--am-text-secondary);
      }
    `,
  ],
})
export class TransitionPanelComponent implements OnChanges {
  @Input() template: WorkflowTemplateDto | null = null;
  /** The transition as last loaded; null while adding one. */
  @Input() transition: WorkflowTransitionDto | null = null;
  /** The stage a new transition leaves; a loaded one says its own. */
  @Input() fromStageId: string | null = null;
  /** Saved (added or changed): the page reloads and keeps the panel on it. */
  @Output() saved = new EventEmitter<WorkflowTransitionDto>();
  @Output() removed = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();
  /** "Pressed by whoever works {stage}": open that stage's panel. */
  @Output() openStage = new EventEmitter<string>();
  /** The automatic actions changed in their dialog: the page reloads. */
  @Output() actionsChanged = new EventEmitter<void>();

  @ViewChild('headingEl', { static: true }) private headingRef!: ElementRef<HTMLElement>;

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly fb = inject(FormBuilder);
  private readonly layers = inject(LayerStackService);
  private readonly confirm = inject(AmConfirmService);
  private readonly injector = inject(Injector);

  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly savedNotice = signal(false);
  readonly refusal = signal<string | null>(null);
  readonly actionsOpen = signal(false);

  private readonly templateSig = signal<WorkflowTemplateDto | null>(null);
  private readonly transitionSig = signal<WorkflowTransitionDto | null>(null);
  private readonly fromIdSig = signal<string | null>(null);
  private readonly baseForm = signal<Record<string, unknown>>({});
  private readonly formTick = signal(0);

  readonly form = this.fb.group({
    labelEn: ['', [Validators.required, Validators.maxLength(100)]],
    // ACC-160 — the Arabic name is OPTIONAL: Arabic fields are never mandatory.
    // An emptied field is sent as '' and stored as NULL by the DTO's trimToNull.
    labelAr: ['', [Validators.maxLength(100)]],
    toStageId: [null as string | null],
    kind: ['ADVANCE' as WorkflowTransitionKind, [Validators.required]],
  });

  readonly adding = computed(() => this.transitionSig() === null);
  /** The server says the app runs this move (mover APP). */
  readonly appRun = computed(() => this.transitionSig()?.mover === 'APP');
  readonly isProtected = computed(() => !!this.templateSig()?.isProtected);
  readonly readonly = computed(() => this.appRun() || this.isProtected());

  private readonly stages = computed<WorkflowStageDto[]>(() => this.templateSig()?.stages ?? []);
  readonly fromStage = computed(() => {
    const id = this.transitionSig()?.fromStageId ?? this.fromIdSig();
    return this.stages().find((s) => s.id === id) ?? null;
  });

  readonly fromName = computed(() => this.stageName(this.fromStage()));
  readonly toName = computed(() => {
    const id = this.transitionSig()?.toStageId;
    return this.stageName(this.stages().find((s) => s.id === id) ?? null);
  });

  readonly heading = computed(() => {
    this.translate.currentLang();
    const t = this.transitionSig();
    return t ? this.languageService.bilingual(t.labelEn, t.labelAr) : (this.translate.instant('workflow.addTransition') as string);
  });

  /** "Policy review · Under review → Legal review" (the arrow points the reading way). */
  readonly contextText = computed(() => {
    this.translate.currentLang();
    const template = this.templateSig();
    if (!template) return '';
    const name = this.languageService.bilingual(template.nameEn, template.nameAr);
    if (this.adding()) return this.translate.instant('workflow.transitionPanel.contextFrom', { template: name, from: this.fromName() }) as string;
    return this.translate.instant('workflow.transitionPanel.context', { template: name, from: this.fromName(), to: this.toName() }) as string;
  });

  /** The server's one line for a move the app runs; never a frontend copy. */
  readonly appMoveLine = computed(() => {
    const move = this.transitionSig()?.appMove;
    if (!move) return '';
    return this.languageService.isArabic() ? move.ar : move.en;
  });

  readonly pressedBy = computed(() => {
    this.translate.currentLang();
    const text = this.translate.instant('workflow.transitionPanel.pressedBy', { stage: MARK }) as string;
    const [before = '', after = ''] = text.split(MARK);
    return { before, after };
  });

  readonly stageOptions = computed(() => {
    this.translate.currentLang();
    return this.stages().map((s) => ({ value: s.id, label: this.stageName(s) }));
  });

  readonly kindOptions = computed(() => {
    this.translate.currentLang();
    return WORKFLOW_TRANSITION_KINDS.map((value) => ({ value, label: this.translate.instant(workflowLabelKey('transitionKind', value)) as string }));
  });

  readonly kindHelpKey = computed(() => {
    this.formTick();
    return KIND_HELP_KEYS[this.form.controls.kind.value ?? 'ADVANCE'];
  });

  /** "Notify the record's people · Log in the audit trail", in run order; "None" when there are none. */
  readonly actionsSummary = computed(() => {
    this.translate.currentLang();
    const actions = [...(this.transitionSig()?.actions ?? [])].sort((a, b) => a.order - b.order);
    if (!actions.length) return this.translate.instant('workflow.transitionPanel.noActions') as string;
    return actions
      .map((a) => {
        const key = `workflow.actionTypeName.${a.actionType}`;
        const name = this.translate.instant(key) as string;
        const shown = name === key ? (this.translate.instant('workflow.actionTypeName.unknown') as string) : name;
        return a.isEnabled ? shown : (this.translate.instant('workflow.transitionPanel.actionOff', { name: shown }) as string);
      })
      .join(' · ');
  });

  readonly changedNames = computed<string[]>(() => {
    this.formTick();
    this.translate.currentLang();
    if (this.readonly()) return [];
    const base = this.baseForm();
    const now = this.form.getRawValue() as Record<string, unknown>;
    return Object.keys(FIELD_LABELS)
      .filter((f) => normal(now[f]) !== normal(base[f]))
      .map((f) => this.translate.instant(FIELD_LABELS[f]!) as string);
  });
  readonly changeCount = computed(() => this.changedNames().length);
  readonly hasChanges = computed(() => this.changeCount() > 0);

  /**
   * True while load() refills the form from what the server holds. A refill is
   * not the person changing something, so it must not take the saved line away:
   * a save reloads the template, the panel refills itself, and "saved" used to
   * vanish about a second after it appeared.
   */
  private refilling = false;

  constructor() {
    this.form.valueChanges.subscribe(() => {
      this.formTick.update((n) => n + 1);
      // The saved line stays until the person next changes something here.
      if (!this.refilling) this.savedNotice.set(false);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['template']) this.templateSig.set(this.template);
    if (changes['fromStageId']) this.fromIdSig.set(this.fromStageId);
    if (!changes['transition'] && !changes['fromStageId']) return;
    const previous = changes['transition']?.previousValue as WorkflowTransitionDto | null | undefined;
    const firstChange = changes['transition']?.firstChange ?? changes['fromStageId']?.firstChange ?? false;
    const switched =
      firstChange ||
      (changes['transition'] && previous?.id !== this.transition?.id) ||
      (!!changes['fromStageId'] && this.transition === null);
    this.transitionSig.set(this.transition);
    // ACC-55 — a reload of the SAME transition never clobbers unsaved work.
    if (!switched && this.hasChanges()) return;
    this.load(this.transition);
    if (switched) {
      this.refusal.set(null);
      this.submitted.set(false);
      this.actionsOpen.set(false);
      // A transition the panel just added reopens on itself: focus stays on Save.
      const justAdded = !!changes['transition'] && previous === null && !firstChange;
      if (!justAdded) {
        this.savedNotice.set(false);
        this.focusHeading();
      }
    }
  }

  /** Moves focus to the panel's heading, once it is rendered. */
  focusHeading(): void {
    afterNextRender(() => this.headingRef?.nativeElement.focus(), { injector: this.injector });
  }

  private load(transition: WorkflowTransitionDto | null): void {
    this.refilling = true;
    try {
      this.form.reset({
        labelEn: transition?.labelEn ?? '',
        labelAr: transition?.labelAr ?? '',
        toStageId: transition?.toStageId ?? null,
        kind: transition?.kind ?? 'ADVANCE',
      });
    } finally {
      this.refilling = false;
    }
    // To is chosen only when adding; after that it is read-only.
    this.form.controls.toStageId.setValidators(transition ? [] : [Validators.required]);
    this.form.controls.toStageId.updateValueAndValidity({ emitEvent: false });
    this.baseForm.set(this.form.getRawValue() as Record<string, unknown>);
  }

  stageName(stage: WorkflowStageDto | null): string {
    return stage ? this.languageService.bilingual(stage.nameEn, stage.nameAr) : '—';
  }

  kindLabelKey(kind: string | null | undefined): string {
    return workflowLabelKey('transitionKind', kind ?? 'ADVANCE');
  }

  /** The from-stage link: opens that stage's panel; a new tab still gets ?stage=. */
  onStageLink(event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    const id = this.fromStage()?.id;
    if (id) this.openStage.emit(id);
  }

  /** Escape cancels, but only when no overlay above the panel is open (a select, a dialog, a confirm). */
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

  onSubmit(): void {
    if (this.readonly()) return;
    this.submitted.set(true);
    // Save is never disabled: an invalid form says what is missing in its slots.
    if (this.form.invalid) return;
    this.saving.set(true);
    this.refusal.set(null);
    this.savedNotice.set(false);

    const raw = this.form.getRawValue();
    const transition = this.transition;
    // ACC-271 PR 5b — the names and the kind, and on add the two stages. Never a
    // trigger, role, person, permission or validator: the stage says who presses
    // it, and an edit that leaves them out leaves them stored. ACC-284 — nor
    // Approval path: the engine no longer reads it, so it is left as stored.
    const shared = {
      labelEn: raw.labelEn!,
      labelAr: raw.labelAr ?? '',
      kind: raw.kind!,
    };
    const request$ = transition
      ? this.workflowTemplateService.updateTransition(transition.id, shared satisfies UpdateWorkflowTransitionDto)
      : this.workflowTemplateService.addTransition({
          ...shared,
          fromStageId: this.fromStage()?.id ?? '',
          toStageId: raw.toStageId!,
        } satisfies CreateWorkflowTransitionDto);

    request$.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.submitted.set(false);
        this.baseForm.set(this.form.getRawValue() as Record<string, unknown>);
        this.savedNotice.set(true);
        this.saved.emit(result.transition);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.refusal.set(this.refusalText(err));
      },
    });
  }

  /** A refused save, said by its code. */
  private refusalText(err: unknown): string {
    return this.translate.instant(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.saveFailed')) as string;
  }

  onRemove(): void {
    const transition = this.transition;
    if (!transition) return;
    this.confirm.ask({
      tone: 'destructive',
      // workflow-template.service.ts removeTransition() deletes its actions, then the transition.
      message: this.translate.instant('workflow.confirmRemoveTransition'),
      header: this.translate.instant('workflow.confirmRemoveTransitionHeader', { name: this.heading() }),
      acceptLabel: this.translate.instant('confirm.removeTransition'),
      accept: () => {
        this.workflowTemplateService.removeTransition(transition.id).subscribe({
          next: () => this.removed.emit(transition.id),
          // ACC-191 (Q3) — a transition that has been used says how many times.
          error: (err: unknown) =>
            this.refusal.set(
              this.translate.instant(
                removeRefusal(err, (key, n) => this.format.count(key, n)) ?? extractErrorMessage(err, 'workflow.error.removeFailed'),
              ) as string,
            ),
        });
      },
    });
  }
}

/** A form value as compared for "changed": '' and null are the same nothing. */
function normal(value: unknown): unknown {
  return value === '' || value === undefined ? null : value;
}
