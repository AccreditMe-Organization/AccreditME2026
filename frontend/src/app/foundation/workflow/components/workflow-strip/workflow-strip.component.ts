import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AmCountPipe, AmNumberPipe } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { WorkflowStageDto, WorkflowTransitionDto } from '../../services/workflow-template.service';
import { ZoomControlsComponent } from '../../../../shared/components/zoom-controls/zoom-controls.component';
import { ZOOM, clampZoom, fitZoom, innerInlineSize } from '../../../../shared/utils/zoom';

/** One stage card, and the connector that follows it to the next stage. */
interface StripItem {
  stage: WorkflowStageDto;
  name: string;
  /** The labels of every transition out of this stage, for the card's last line. */
  exits: string;
  /** Transitions from this stage to the NEXT one in order (solid, forward). */
  forward: string[];
  /** RETURN transitions from the next stage back to this one (dashed). */
  back: string[];
}

/**
 * ACC-255 PR 4b — the workflow's flow strip (Templates 6b): one picture,
 * GENERATED from the template's stages and transitions, never authored. Stage
 * cards in order, each with how many records stand in it now (the server's
 * `liveCount`) and the names of its exits. Between two cards, the forward
 * transitions from the first to the second are drawn solid and the RETURN
 * transitions back from the second are drawn dashed; a transition to any other
 * stage is named on its card only.
 *
 * Cards are buttons in stage order: pressing one opens that stage in the editor
 * panel below. Connectors are labels, not buttons (Ahmad, 27 Oct): the
 * transition editor stays a dialog that belongs to its stage's row.
 *
 * The strip scrolls sideways inside its own frame; the page never does, and
 * nothing here scrolls vertically (the route scrolls as the document).
 *
 * ACC-271 PR 5b — Zoom out / Fit / Zoom in, the org chart's buttons and rule
 * (shared/utils/zoom.ts): the row is a CSS scale inside a wrapper sized to the
 * scaled row, so the frame always measures what is drawn. It OPENS ON FIT and
 * stays fitted (a resize, a language switch, a stage added) until someone
 * zooms; Fit returns to that. At Fit nothing scrolls sideways: Zoom out stops
 * at the smaller of 30% and the Fit value, so a long workflow on a phone still
 * fits rather than stopping at 30% and scrolling.
 */
@Component({
  selector: 'am-workflow-strip',
  standalone: true,
  imports: [TranslatePipe, AmNumberPipe, AmCountPipe, ZoomControlsComponent],
  template: `
    <div class="am-strip" data-strip>
      <div class="am-strip__bar">
        <am-zoom-controls
          testIdPrefix="strip"
          [canZoomIn]="zoom() < zoomMax"
          [canZoomOut]="zoom() > minZoom()"
          (zoomIn)="zoomBy(zoomStep)"
          (zoomOut)="zoomBy(-zoomStep)"
          (fit)="fitNow()"
        />
      </div>
      <div class="am-strip__scroll" #scroll data-strip-frame>
      <div class="am-strip__sizer" [style.width.px]="natural().w * zoom()" [style.height.px]="natural().h * zoom()">
      <div class="am-strip__zoom" #zoomer [style.transform]="'scale(' + zoom() + ')'" data-strip-zoom>
      <ol class="am-strip__row" [attr.aria-label]="'workflow.strip.label' | translate">
        @for (item of items(); track item.stage.id; let i = $index; let last = $last) {
          <li class="am-strip__item">
            <button
              type="button"
              class="am-strip__card"
              [class.am-strip__card--selected]="item.stage.id === selectedId()"
              [attr.aria-current]="item.stage.id === selectedId() ? 'true' : null"
              [disabled]="!interactive()"
              (click)="opened.emit({ stageId: item.stage.id, opener: $any($event.currentTarget) })"
              data-strip-card
              [attr.data-stage-id]="item.stage.id"
            >
              <span class="am-strip__head">
                <span class="am-strip__num" aria-hidden="true">{{ i + 1 | amNumber }}</span>
                <span class="am-strip__name" data-strip-name>{{ item.name }}</span>
              </span>
              @if (item.stage.liveCount !== undefined) {
                <span class="am-strip__live" data-strip-live>{{ item.stage.liveCount | amCount: 'workflow.liveInStage' }}</span>
              }
              <span class="am-strip__exits" data-strip-exits>{{ item.exits || ('workflow.stageList.noExits' | translate) }}</span>
            </button>
            @if (!last) {
              <span class="am-strip__conn" aria-hidden="true" data-strip-conn>
                @for (label of item.forward; track $index) {
                  <span class="am-strip__label">{{ label }}</span>
                }
                <span class="am-strip__line"></span>
                @for (label of item.back; track $index) {
                  <span class="am-strip__line am-strip__line--back"></span>
                  <span class="am-strip__label am-strip__label--back">{{ label }}</span>
                }
              </span>
            }
          </li>
        }
      </ol>
      </div>
      </div>
      </div>
      <p class="am-strip__legend">
        <span class="am-strip__key"><span class="am-strip__swatch"></span>{{ 'workflow.strip.forward' | translate }}</span>
        <span class="am-strip__key"><span class="am-strip__swatch am-strip__swatch--back"></span>{{ 'workflow.strip.back' | translate }}</span>
      </p>
    </div>
  `,
  styles: [
    `
      .am-strip {
        padding: var(--am-space-12);
        background: var(--am-surface);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
        min-inline-size: 0;
      }
      .am-strip__bar {
        display: flex;
        justify-content: flex-end;
        margin-block-end: var(--am-space-8);
      }
      /* Sideways only, inside its own frame (Templates 6b, "No inner scroll"). */
      .am-strip__scroll {
        overflow-x: auto;
        overflow-y: hidden;
      }
      .am-strip__zoom {
        inline-size: max-content;
        transform-origin: top left;
      }
      :host-context([dir='rtl']) .am-strip__zoom {
        transform-origin: top right;
      }
      .am-strip__row {
        display: flex;
        align-items: stretch;
        margin: 0;
        padding: 0;
        list-style: none;
        width: max-content;
      }
      .am-strip__item {
        display: flex;
        align-items: stretch;
        flex: none;
      }
      .am-strip__card {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-4);
        inline-size: 170px;
        padding: var(--am-space-8) var(--am-space-12);
        text-align: start;
        background: var(--am-card);
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-control);
        cursor: pointer;
        font: inherit;
        color: inherit;
      }
      .am-strip__card:hover:not(:disabled) {
        border-color: var(--am-control-border-hover);
      }
      .am-strip__card:focus-visible {
        outline: 2px solid var(--am-primary-600);
        outline-offset: 2px;
      }
      .am-strip__card:disabled {
        cursor: default;
      }
      .am-strip__card--selected {
        background: var(--am-primary-50);
        border: 2px solid var(--am-primary-600);
        padding: calc(var(--am-space-8) - 1px) calc(var(--am-space-12) - 1px);
      }
      .am-strip__head {
        display: flex;
        align-items: center;
        gap: var(--am-space-6);
        min-inline-size: 0;
      }
      .am-strip__num {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        inline-size: 20px;
        block-size: 20px;
        border-radius: 50%;
        background: var(--am-primary-100);
        color: var(--am-primary-700);
        font-size: var(--am-type-micro-size);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .am-strip__name {
        min-inline-size: 0;
        font-size: var(--am-type-body-size);
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .am-strip__live {
        font-size: var(--am-type-meta-size);
        color: var(--am-text-secondary);
        font-variant-numeric: tabular-nums;
      }
      .am-strip__exits {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-700);
        overflow-wrap: anywhere;
      }
      .am-strip__conn {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: var(--am-space-2);
        inline-size: 112px;
        padding-inline: var(--am-space-8);
        flex: none;
      }
      .am-strip__label {
        max-inline-size: 100%;
        font-size: var(--am-type-micro-size);
        line-height: var(--am-type-micro-line);
        color: var(--am-text-secondary);
        text-align: center;
        overflow-wrap: anywhere;
      }
      .am-strip__label--back {
        color: var(--am-warning-ink);
      }
      .am-strip__line {
        inline-size: 100%;
        border-block-start: 2px solid var(--am-control-border);
      }
      .am-strip__line--back {
        border-block-start: 2px dashed var(--am-warning-ink);
      }
      .am-strip__legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-6) var(--am-space-16);
        margin: var(--am-space-12) 0 0;
        font-size: var(--am-type-meta-size);
        color: var(--am-text-secondary);
      }
      .am-strip__key {
        display: inline-flex;
        align-items: center;
        gap: var(--am-space-6);
      }
      .am-strip__swatch {
        inline-size: 18px;
        border-block-start: 2px solid var(--am-control-border);
      }
      .am-strip__swatch--back {
        border-block-start: 2px dashed var(--am-warning-ink);
      }
    `,
  ],
})
export class WorkflowStripComponent implements AfterViewInit {
  readonly stages = input.required<WorkflowStageDto[]>();
  readonly selectedId = input<string | null>(null);
  /** False where the reader may not open a stage. */
  readonly interactive = input(true);
  readonly opened = output<{ stageId: string; opener: HTMLElement }>();

  private readonly language = inject(LanguageService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  private readonly zoomer = viewChild<ElementRef<HTMLElement>>('zoomer');

  protected readonly zoomMax = ZOOM.max;
  protected readonly zoomStep = ZOOM.step;
  /** The row's own size, unscaled (a transform does not change offsetWidth). */
  readonly natural = signal({ w: 0, h: 0 });
  readonly zoom = signal(1);
  /** The zoom that fits the row in the frame; 1 until measured. */
  readonly fitValue = signal(1);
  /** True once someone zooms: the strip then stops following the frame's width, until Fit. */
  private readonly zoomed = signal(false);
  /** Zoom out stops at 30%, or lower when that is what fits. */
  readonly minZoom = computed(() => Math.min(ZOOM.min, this.fitValue()));

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    // The row's size (a stage added, a language switch) and the frame's width
    // (a resize, the rail) are both watched: either changes what fits.
    const observer = new ResizeObserver(() => this.zone.run(() => this.measure()));
    const row = this.zoomer()?.nativeElement;
    const frame = this.scroll()?.nativeElement;
    if (row) observer.observe(row);
    if (frame) observer.observe(frame);
    this.measure();
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  private measure(): void {
    const row = this.zoomer()?.nativeElement;
    const frame = this.scroll()?.nativeElement;
    if (!row || !frame) return;
    const w = row.offsetWidth;
    const h = row.offsetHeight;
    if (w !== this.natural().w || h !== this.natural().h) this.natural.set({ w, h });
    if (!w) return;
    this.fitValue.set(Math.max(0.01, fitZoom(innerInlineSize(frame), w)));
    if (!this.zoomed()) this.zoom.set(this.fitValue());
  }

  zoomBy(step: number): void {
    this.zoomed.set(true);
    this.zoom.set(clampZoom(this.zoom() + step, this.minZoom()));
  }

  /** Fit: the whole row in the frame, never above 100%, and following the frame again. */
  fitNow(): void {
    this.zoomed.set(false);
    this.measure();
    this.zoom.set(this.fitValue());
  }

  readonly items = computed<StripItem[]>(() => {
    const stages = this.stages();
    const label = (t: WorkflowTransitionDto): string => this.language.bilingual(t.labelEn, t.labelAr);
    return stages.map((stage, i) => {
      const next = stages[i + 1];
      const out = stage.transitions ?? [];
      return {
        stage,
        name: this.language.bilingual(stage.nameEn, stage.nameAr),
        exits: out.map(label).join(' · '),
        forward: next ? out.filter((t) => t.toStageId === next.id && t.kind !== 'RETURN').map(label) : [],
        back: next ? (next.transitions ?? []).filter((t) => t.toStageId === stage.id && t.kind === 'RETURN').map(label) : [],
      };
    });
  });
}
