import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, inject, input, output } from '@angular/core';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ScrollDispatcher } from '@angular/cdk/scrolling';
import { LayerStackService } from '../../overlay/layer-stack.service';
import { registerScrollableAncestors } from '../../overlay/scrollable-ancestors';

export interface RowMenuItem {
  id: string;
  /** Already translated. */
  label: string;
  /** A quieter second line, already translated. */
  sub?: string;
  danger?: boolean;
  disabled?: boolean;
}

// Below the trigger, aligned to its inline end; above it when there is no room.
const POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
];

/**
 * `am-row-menu` — a row's "⋯" and its worded menu (ACC-229, Record Tasks
 * Panel §4).
 *
 * Built on the CDK menu, whose trigger uses the REPOSITION scroll strategy
 * (verified in @angular/cdk/menu's source, ACC-228): when the list behind it
 * scrolls, the menu moves with its row instead of closing or being cut off —
 * the same property OverlaySelectComponent was built for.
 *
 * ACC-235 — two things that strategy needs and did not have, both measured on
 * /roles and /users:
 * - THE SCROLL. CDK only hears the document scroll and what is registered with
 *   its ScrollDispatcher, and nothing registers <main> or a dialog body. So
 *   while open the menu registers its trigger's scrollable ancestors, exactly
 *   as OverlaySelectComponent does (shared/overlay/scrollable-ancestors.ts).
 *   Before this, scrolling <main> 60px left the menu 60px from its row.
 * - THE DIRECTION. CDK's root Directionality reads the page's direction once,
 *   at start-up, and never followed a language switch, so an Arabic session
 *   aligned the menu as if left-to-right and pushed it 48-60px off its ⋯.
 *   ACC-235 wrapped this trigger in a CDK [dir]; ACC-237 replaced that with the
 *   app-level fix: LanguageService keeps the ROOT Directionality current, and
 *   the menu trigger passes that object to its overlay (cdk menu.mjs:704), so
 *   every CDK menu follows a switch with nothing here.
 *
 * It is a LAYER while open (LayerStackService), so Escape closes the menu and
 * never the dialog or popup it sits in. The CDK menu handles the arrow keys,
 * Home and End, and Escape itself; focus returns to the ⋯ on close.
 *
 * Items arrive grouped; a divider separates groups. An item the viewer cannot
 * use is left out by the caller, not disabled — `disabled` is for the one
 * action that is offered but waiting (Complete, before evidence).
 */
@Component({
  selector: 'am-row-menu',
  standalone: true,
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="am-row-menu__trigger"
      [cdkMenuTriggerFor]="menu"
      [cdkMenuPosition]="positions"
      [attr.aria-label]="label()"
      [attr.title]="label()"
      data-testid="row-menu-trigger"
      (cdkMenuOpened)="opened()"
      (cdkMenuClosed)="closed()"
    >
      <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
    </button>
    <ng-template #menu>
      <div cdkMenu class="am-row-menu" data-testid="row-menu">
        @for (group of groups(); track $index; let first = $first; let g = $index) {
          @if (!first) {
            <div class="am-row-menu__divider" role="separator"></div>
          }
          @if (groupLabels()[g]; as heading) {
            <div class="am-row-menu__heading" role="presentation" data-testid="row-menu-heading">{{ heading }}</div>
          }
          @for (item of group; track item.id) {
            <button
              type="button"
              cdkMenuItem
              class="am-row-menu__item"
              [class.am-row-menu__item--danger]="item.danger"
              [cdkMenuItemDisabled]="!!item.disabled"
              [attr.data-action]="item.id"
              (cdkMenuItemTriggered)="picked.emit(item.id)"
            >
              <span class="block">{{ item.label }}</span>
              @if (item.sub) {
                <span class="am-row-menu__sub">{{ item.sub }}</span>
              }
            </button>
          }
        }
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host{display:inline-flex;flex:none}
      .am-row-menu__trigger{inline-size:26px;block-size:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--am-radius-control);background:none;color:var(--am-ink-700);cursor:pointer}
      .am-row-menu__trigger:hover{background:var(--am-primary-50)}
      .am-row-menu__trigger:focus-visible,.am-row-menu__item:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-row-menu{min-inline-size:220px;max-inline-size:320px;padding:4px 0;display:flex;flex-direction:column;background:var(--am-surface-raised);border:1px solid var(--am-border-strong);border-radius:var(--am-radius-card);box-shadow:var(--am-shadow-overlay)}
      .am-row-menu__item{font:inherit;font-size:13px;text-align:start;color:var(--am-ink-900);background:none;border:0;padding:7px 14px;cursor:pointer}
      .am-row-menu__item:hover{background:var(--am-primary-50)}
      .am-row-menu__item[aria-disabled=true]{color:var(--am-ink-500);cursor:not-allowed}
      .am-row-menu__item--danger{color:var(--am-danger-ink)}
      .am-row-menu__sub{display:block;font-size:11.5px;color:var(--am-ink-500)}
      .am-row-menu__divider{block-size:1px;margin:4px 0;background:var(--am-border)}
      .am-row-menu__heading{padding:6px 14px 2px;font-size:var(--am-type-micro-size);font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--am-ink-500)}
    `,
  ],
})
export class RowMenuComponent {
  private readonly layers = inject(LayerStackService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scrollDispatcher = inject(ScrollDispatcher);
  private readonly ngZone = inject(NgZone);
  private unregisterScroll: (() => void) | null = null;

  readonly groups = input.required<RowMenuItem[][]>();
  /** The ⋯'s accessible name, naming the row ("Actions for Renew the terms"). */
  readonly label = input.required<string>();
  /**
   * ACC-120 slice 11 — an optional heading per group, by index (null for none),
   * already translated: the org tree's "Headship" group. Opt-in; a menu without
   * it renders exactly as before. The heading is not an item: the CDK menu's
   * keys never land on it.
   */
  readonly groupLabels = input<(string | null)[]>([]);
  readonly picked = output<string>();
  /**
   * ACC-120 slice 11 — the menu opened, so a caller can read what its items
   * depend on (the org tree reads the unit's headship then). Opt-in.
   */
  readonly openedChange = output<boolean>();

  protected readonly positions = POSITIONS;
  private layerId: number | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.closed());
  }

  opened(): void {
    if (this.layerId === null) this.layerId = this.layers.push();
    this.unregisterScroll ??= registerScrollableAncestors(this.host.nativeElement, this.scrollDispatcher, this.ngZone);
    this.openedChange.emit(true);
  }

  closed(): void {
    if (this.layerId !== null) this.openedChange.emit(false);
    if (this.layerId !== null) {
      this.layers.remove(this.layerId);
      this.layerId = null;
    }
    this.unregisterScroll?.();
    this.unregisterScroll = null;
  }
}
