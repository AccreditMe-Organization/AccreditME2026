import {
  Directive,
  ElementRef,
  HostBinding,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

/**
 * The table row (ACC-111) — artboard 9 and template 1 of the design system.
 *
 * Put on whatever element a caller renders as a row inside
 * `DataListComponent`'s row template. A directive rather than a component
 * because the row's MARKUP is the caller's (every list has different columns);
 * only its BEHAVIOUR is shared.
 *
 * ## The keyboard contract
 *
 * The table is ONE tab stop. Inside it: ↑/↓ move between rows, Home/End jump
 * to the ends, Enter opens the record, Space selects it. Tab leaves the table
 * entirely rather than walking 25 rows of controls.
 *
 * **The row's own actions are reached with →/←, and this is the part that
 * matters.** The design records today's row menus as unreachable by keyboard;
 * a new component that keeps the row a single tab stop and stops there would
 * reproduce that defect while looking like the fix. So the row's controls are
 * taken out of the tab order (`tabindex="-1"`) and reached by arrow instead —
 * the WAI-ARIA grid pattern — which keeps both properties at once.
 *
 * →/← mirror in RTL, because "next" follows reading order.
 *
 * ## Focus and selection are SEPARATE, deliberately
 *
 * PrimeNG's own `pSelectableRow` conflates them: arrows move selection. The
 * design separates them — arrows move focus, Space selects — because a reader
 * scanning a list with the keyboard is not choosing 25 rows on the way past.
 * This directive therefore owns FOCUS and key handling, and reports selection
 * to its caller, which owns the selection STATE the bulk-action bar reads.
 *
 * ## Premise, with its dependency
 *
 * `DataListComponent` is not a `p-table`, so there is no second keyboard model
 * on these rows today — verified against PrimeNG 21.2.x, where row keys live
 * ONLY in the `[pSelectableRow]` directive (arrows, Home/End, Enter, Space,
 * Ctrl+A), never in `p-table` itself.
 *
 * **So: never put `pSelectableRow` on a row carrying this directive.** Both
 * bind the same keys on the same element, both switch on `event.code`, and the
 * collision would appear only via the keyboard. If a future PrimeNG version
 * moves row key handling into `p-table` proper, any list built on `p-table`
 * inherits that collision silently — re-verify on upgrade, the same way
 * SYSTEM-REFERENCE §10.12 requires for the Escape rule.
 */
@Directive({
  selector: '[amListRow]',
  standalone: true,
})
export class ListRowDirective {
  /** Whether this row is currently selected. The CALLER owns the state. */
  readonly selected = input(false, { alias: 'amListRowSelected' });

  /** Rows that cannot be opened or selected still receive focus, and say so. */
  readonly disabled = input(false, { alias: 'amListRowDisabled' });

  /** Enter, or a double click. */
  readonly rowOpen = output<void>();

  /** Space. The caller flips its own selection state. */
  readonly rowToggleSelect = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** -1 until this row is the roving tab stop. The first row starts at 0. */
  private readonly isTabStop = signal(false);

  @HostBinding('attr.role') readonly role = 'row';

  @HostBinding('attr.tabindex')
  get tabIndex(): number {
    return this.isTabStop() || this.isFirstRow() ? 0 : -1;
  }

  @HostBinding('attr.aria-selected')
  get ariaSelected(): boolean {
    return this.selected();
  }

  @HostBinding('class.am-list-row') readonly baseClass = true;

  @HostBinding('class.am-list-row--selected')
  get selectedClass(): boolean {
    return this.selected();
  }

  @HostBinding('class.am-list-row--disabled')
  get disabledClass(): boolean {
    return this.disabled();
  }

  private isFirstRow(): boolean {
    const el = this.host.nativeElement;
    return this.siblings()[0] === el;
  }

  private siblings(): HTMLElement[] {
    const parent = this.host.nativeElement.parentElement;
    if (!parent) return [this.host.nativeElement];
    return Array.from(parent.querySelectorAll<HTMLElement>(':scope > [amlistrow], :scope > .am-list-row'));
  }

  /** The row's own controls, which Tab deliberately cannot reach. */
  private controls(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea'),
    ).filter((el) => !el.hasAttribute('disabled'));
  }

  private readonly rtl = computed(() => getComputedStyle(this.host.nativeElement).direction === 'rtl');

  @HostListener('focusin')
  onFocusIn(): void {
    // Roving tabindex: the row last focused is the one Tab returns to.
    this.siblings().forEach((el) => el.setAttribute('tabindex', '-1'));
    this.host.nativeElement.setAttribute('tabindex', '0');
    this.isTabStop.set(true);
    // Controls stay out of the tab order — they are arrow-reachable only.
    this.controls().forEach((el) => el.setAttribute('tabindex', '-1'));
  }

  @HostListener('dblclick')
  onDoubleClick(): void {
    if (!this.disabled()) this.rowOpen.emit();
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // `code`, not `key`: layout-independent, and the same thing PrimeNG
    // switches on, so the two models cannot disagree about what was pressed.
    switch (event.code) {
      case 'ArrowDown':
        this.moveRow(1, event);
        break;
      case 'ArrowUp':
        this.moveRow(-1, event);
        break;
      case 'Home':
        this.focusRowAt(0, event);
        break;
      case 'End':
        this.focusRowAt(this.siblings().length - 1, event);
        break;
      case 'ArrowRight':
        this.moveControl(this.rtl() ? -1 : 1, event);
        break;
      case 'ArrowLeft':
        this.moveControl(this.rtl() ? 1 : -1, event);
        break;
      case 'Enter':
        if (this.disabled() || this.isOnControl(event)) return;
        event.preventDefault();
        this.rowOpen.emit();
        break;
      case 'Space':
        if (this.disabled() || this.isOnControl(event)) return;
        // Without preventDefault the list scrolls a page on every selection.
        event.preventDefault();
        this.rowToggleSelect.emit();
        break;
      default:
        break;
    }
  }

  /** A key pressed while a control inside the row has focus belongs to it. */
  private isOnControl(event: KeyboardEvent): boolean {
    return event.target !== this.host.nativeElement;
  }

  private moveRow(delta: number, event: KeyboardEvent): void {
    const rows = this.siblings();
    const index = rows.indexOf(this.host.nativeElement);
    const next = rows[index + delta];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  private focusRowAt(index: number, event: KeyboardEvent): void {
    const target = this.siblings()[index];
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  /**
   * Moves along the row's controls. From the row itself, → enters the first
   * control; ← from the first control returns to the row, so a reader can
   * always get back out without leaving the list.
   */
  private moveControl(delta: number, event: KeyboardEvent): void {
    const controls = this.controls();
    if (controls.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const current = active ? controls.indexOf(active) : -1;

    if (current === -1) {
      if (delta < 0) return; // already at the row, nothing to the left of it
      event.preventDefault();
      controls[0].focus();
      return;
    }

    const next = current + delta;
    event.preventDefault();
    if (next < 0) {
      this.host.nativeElement.focus();
      return;
    }
    controls[Math.min(next, controls.length - 1)].focus();
  }
}
