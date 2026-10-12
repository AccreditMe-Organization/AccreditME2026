import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { DrawerModule } from 'primeng/drawer';
import { LanguageService } from '../../../core/services/language.service';
import { LayerStackService } from '../../overlay/layer-stack.service';

/** Below this window width the drawer is always full screen and Expand is hidden (the drawing). */
export const DRAWER_FULL_SCREEN_BELOW_PX = 900;

/**
 * `am-drawer` — the app's first drawer, defined once (File Viewer drawing,
 * 9 Oct; ACC-189). Built on PrimeNG Drawer, through its HEADLESS template, so
 * the frame, the buttons and the semantics are ours:
 *
 * - **From the END side**: right in English, left in Arabic. PrimeNG's
 *   `position` is PHYSICAL ('left' | 'right') and does not follow `dir`, so
 *   the side is computed from the language here — not trusted to flip.
 * - **Modal**: the page behind is dimmed by the mask and made `inert` (no
 *   clicks, no focus, no scroll), and clicking the mask does NOT close it — a
 *   stray click on the dim page must not lose what the drawer shows.
 * - **Escape closes only the top layer** (LayerStackService), in one press,
 *   from full screen too. PrimeNG's own Escape is off: it answers whichever
 *   drawer has focus, not whichever is on top.
 * - **60% of the window, 720px minimum**, a fixed header and footer around the
 *   one scrolling body. **Expand** makes it full screen and becomes Restore;
 *   it opens at normal width each time. **Below 900px** it is always full
 *   screen and Expand is hidden.
 * - `role="dialog"`, `aria-modal`, named by `ariaLabel` — the FULL name of what
 *   it shows, never a truncated one.
 * - Focus goes to the dialog on open, so its name is announced first. Where
 *   focus goes on CLOSE is the host's decision (the file viewer returns it to
 *   the row of the file last shown), so this component does not guess.
 *
 * Slots: `[amDrawerHeader]` (before Expand and Close), `[amDrawerToolbar]`,
 * the body (default content), `[amDrawerFooter]`. A slot left empty takes no
 * space. Buttons in the slots use the drawer's own `am-drawer__button` (with
 * `--text` for a labelled one and `--on` for a pressed toggle), so every
 * control in a drawer is drawn the same way.
 */
@Component({
  selector: 'am-drawer',
  standalone: true,
  imports: [DrawerModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-drawer
      [visible]="visible()"
      [position]="side()"
      [modal]="true"
      [dismissible]="false"
      [closeOnEscape]="false"
      [blockScroll]="true"
      [showCloseIcon]="false"
      [style]="frameStyle()"
      [maskStyle]="{ background: 'var(--am-overlay-scrim)' }"
      styleClass="am-drawer"
      appendTo="body"
      (onShow)="shown()"
    >
      <ng-template #headless>
        <div
          #frame
          class="am-drawer__frame"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="ariaLabel()"
          [attr.dir]="language.isRtl() ? 'rtl' : 'ltr'"
          tabindex="-1"
        >
          <div class="am-drawer__head">
            <div class="am-drawer__head-content"><ng-content select="[amDrawerHeader]" /></div>
            @if (canExpand()) {
              <button
                type="button"
                class="am-drawer__button am-drawer__button--text"
                data-am-drawer-expand
                [attr.aria-label]="(expanded() ? 'drawer.restoreLabel' : 'drawer.expandLabel') | translate"
                [attr.title]="(expanded() ? 'drawer.restoreLabel' : 'drawer.expandLabel') | translate"
                (click)="expanded.set(!expanded())"
              >
                <i [class]="expanded() ? 'pi pi-window-minimize' : 'pi pi-window-maximize'" aria-hidden="true"></i>
                {{ (expanded() ? 'drawer.restore' : 'drawer.expand') | translate }}
              </button>
            }
            <button
              type="button"
              class="am-drawer__button"
              data-am-drawer-close
              [attr.aria-label]="closeLabel()"
              [attr.title]="closeLabel()"
              (click)="requestClose()"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>
          <ng-content select="[amDrawerToolbar]" />
          <!-- A Tab stop, so Page Up / Page Down scroll the content from the keyboard (the drawing). -->
          <div class="am-drawer__body" tabindex="0" data-am-drawer-body><ng-content /></div>
          <ng-content select="[amDrawerFooter]" />
        </div>
      </ng-template>
    </p-drawer>
  `,
  styles: [
    `
      .am-drawer.p-drawer {
        block-size: 100%;
        border: none;
        background: var(--am-surface-raised);
      }
      .am-drawer__frame {
        display: flex;
        flex-direction: column;
        block-size: 100%;
        min-block-size: 0;
        background: var(--am-surface-raised);
        font-family: var(--am-font-family);
        color: var(--am-ink-900);
        outline: none;
      }
      .am-drawer__head {
        flex: none;
        display: flex;
        align-items: center;
        gap: var(--am-space-12);
        min-block-size: var(--am-drawer-header-height);
        box-sizing: border-box;
        padding: var(--am-space-8) var(--am-space-20);
        border-block-end: 1px solid var(--am-border);
        background: var(--am-surface-raised);
      }
      .am-drawer__head-content {
        flex: 1 1 auto;
        min-inline-size: 0;
        display: flex;
        align-items: center;
        gap: var(--am-space-12);
      }
      .am-drawer__button {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--am-space-6);
        min-inline-size: var(--am-icon-button-size);
        block-size: var(--am-icon-button-size);
        box-sizing: border-box;
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-button);
        background: var(--am-control-bg);
        color: var(--am-ink-900);
        font: inherit;
        font-size: var(--am-type-value-size);
        cursor: pointer;
      }
      .am-drawer__button--text {
        padding: 0 var(--am-space-8);
      }
      .am-drawer__button:hover {
        border-color: var(--am-control-border-hover);
      }
      .am-drawer__button:disabled {
        border-color: var(--am-control-border-disabled);
        color: var(--am-ink-300);
        cursor: default;
      }
      .am-drawer__button--on {
        border-color: var(--am-primary-600);
        background: var(--am-primary-100);
        color: var(--am-primary-700);
        font-weight: 600;
      }
      .am-drawer__button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-drawer__body:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: calc(-1 * var(--am-focus-ring-width));
      }
      .am-drawer__body {
        flex: 1 1 auto;
        min-block-size: 0;
        overflow: auto;
        background: var(--am-surface);
      }
    `,
  ],
  // Not encapsulated: `.am-drawer.p-drawer` styles PrimeNG's own container,
  // which emulated encapsulation cannot reach. Every class here is prefixed
  // am-drawer, so nothing leaks.
  encapsulation: ViewEncapsulation.None,
})
export class DrawerComponent {
  protected readonly language = inject(LanguageService);
  private readonly layers = inject(LayerStackService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  readonly visible = input(false);
  /** The accessible name: the FULL name of what the drawer shows. */
  readonly ariaLabel = input.required<string>();
  /** The close button's name — already translated, naming what closes ("Close viewer"). */
  readonly closeLabel = input.required<string>();
  /** Whether Expand is offered at all (above the full-screen breakpoint). */
  readonly expandable = input(true);
  /** Full screen. Opens at normal width each time; the host may bind it. */
  readonly expanded = model(false);
  /** Every close path: Escape on the top layer and the ✕. The host decides. */
  readonly closeRequested = output<void>();

  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');

  /** Below 900px the drawer is always full screen and Expand is hidden. */
  readonly narrow = signal(false);
  readonly side = computed<'left' | 'right'>(() => (this.language.isRtl() ? 'left' : 'right'));
  readonly canExpand = computed(() => this.expandable() && !this.narrow());
  readonly frameStyle = computed(() => {
    const full = this.narrow() || this.expanded();
    return {
      width: full ? '100vw' : 'min(100vw, max(var(--am-drawer-width), var(--am-drawer-min-width)))',
      height: '100%',
      'box-shadow': full ? 'none' : this.language.isRtl() ? 'var(--am-drawer-shadow-rtl)' : 'var(--am-drawer-shadow-ltr)',
    };
  });

  private layerId: number | null = null;
  private madeInert: Element[] = [];

  constructor() {
    const destroyRef = inject(DestroyRef);
    const query = this.document.defaultView?.matchMedia?.(`(max-width: ${DRAWER_FULL_SCREEN_BELOW_PX - 0.02}px)`);
    if (query) {
      this.narrow.set(query.matches);
      const onChange = (e: MediaQueryListEvent): void => this.narrow.set(e.matches);
      query.addEventListener('change', onChange);
      destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }

    // Escape is ours: only the TOP layer answers it (see LayerStackService).
    // Bubble phase, like EditDialogComponent, so a PrimeNG panel inside the
    // drawer that consumes Escape (stopPropagation) keeps it.
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.visible()) return;
      if (this.layerId === null || !this.layers.isTop(this.layerId)) return;
      event.stopPropagation();
      this.requestClose();
    };
    this.document.addEventListener('keydown', onKeydown);
    destroyRef.onDestroy(() => this.document.removeEventListener('keydown', onKeydown));

    effect(() => {
      if (this.visible()) this.open();
      else this.release();
    });
    destroyRef.onDestroy(() => this.release());
  }

  requestClose(): void {
    this.closeRequested.emit();
  }

  /** Focus lands on the dialog itself, so a screen reader announces its name first. */
  shown(): void {
    this.frame()?.nativeElement.focus();
  }

  /** For the host: whether this drawer is the top layer (its own keyboard shortcuts defer to layers above). */
  isTopLayer(): boolean {
    return this.layerId !== null && this.layers.isTop(this.layerId);
  }

  private open(): void {
    if (this.layerId !== null) return;
    this.layerId = this.layers.push();
    this.expanded.set(false);
    // The page behind is inert: every child of <body> except the one holding
    // this drawer (PrimeNG appends it to the body) and PrimeNG's mask. Only
    // what WE made inert is released later, so a layer below that was already
    // inert stays so.
    afterNextRender(
      {
        write: () => {
          const frame = this.frame()?.nativeElement;
          if (!frame || this.layerId === null) return;
          this.madeInert = Array.from(this.document.body.children).filter(
            (el) => !el.contains(frame) && !el.classList.contains('p-drawer-mask') && !el.hasAttribute('inert'),
          );
          for (const el of this.madeInert) el.setAttribute('inert', '');
        },
      },
      { injector: this.injector },
    );
  }

  private release(): void {
    if (this.layerId !== null) {
      this.layers.remove(this.layerId);
      this.layerId = null;
    }
    for (const el of this.madeInert) el.removeAttribute('inert');
    this.madeInert = [];
  }
}
