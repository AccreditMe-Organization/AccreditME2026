import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';

export type StatePanelTone = 'muted' | 'danger' | 'warn';

/**
 * ACC-189 — the centred panel every state that is not content uses (the
 * drawing, decision 7): no preview yet, couldn't open, deleted, SharePoint
 * withdrawn, and the organisation's storage refusing the browser (D3).
 *
 * - An icon, a title and one sentence that says why.
 * - The no-preview panel is a labelled REGION and its Download is the first
 *   focus stop; the error panels are role="alert", so the change is announced.
 * - Download appears only where it can work: never for deleted or SharePoint
 *   withdrawn (the host decides, through `primaryLabel` / `secondaryLabel`).
 */
@Component({
  selector: 'am-file-state-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="am-fstate">
      <div
        class="am-fstate__box"
        [class]="'am-fstate__box am-fstate__box--' + tone()"
        [attr.role]="role()"
        [attr.aria-labelledby]="role() === 'region' ? titleId : null"
      >
        <span class="am-fstate__icon" [class.am-fstate__icon--glyph]="icon().length === 1" aria-hidden="true">{{ icon() }}</span>
        <span class="am-fstate__title" [id]="titleId">{{ title() }}</span>
        @if (fileLine(); as line) {
          <span class="am-fstate__file">
            <span [attr.dir]="line.dir" class="am-isolate">{{ line.name }}</span> ·
            <span dir="ltr" class="am-isolate">{{ line.type }}</span> ·
            <span dir="auto" class="am-isolate">{{ line.size }}</span>
          </span>
        }
        <span class="am-fstate__body">{{ body() }}</span>
        @if (primaryLabel() || secondaryLabel()) {
          <span class="am-fstate__actions">
            @if (primaryLabel(); as label) {
              <button type="button" class="am-fstate__button am-fstate__button--primary" data-am-primary (click)="primary.emit()">
                @if (primaryIcon()) {
                  <i [class]="primaryIcon()" aria-hidden="true"></i>
                }
                {{ label }}
              </button>
            }
            @if (secondaryLabel(); as label) {
              <button type="button" class="am-fstate__button" data-am-secondary (click)="secondary.emit()">
                @if (secondaryIcon()) {
                  <i [class]="secondaryIcon()" aria-hidden="true"></i>
                }
                {{ label }}
              </button>
            }
          </span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        block-size: 100%;
      }
      .am-fstate {
        block-size: 100%;
        min-block-size: 280px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--am-space-24);
      }
      .am-fstate__box {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--am-space-8);
        max-inline-size: 480px;
        padding: var(--am-space-24) var(--am-space-32);
        text-align: center;
        background: var(--am-surface-raised);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
      }
      .am-fstate__box--danger {
        border-color: var(--am-danger-border);
      }
      .am-fstate__box--warn {
        border-color: var(--am-warning-border);
      }
      .am-fstate__icon {
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: 56px;
        block-size: 56px;
        border-radius: var(--am-radius-card);
        font-size: var(--am-type-value-size);
        font-weight: 700;
        color: var(--am-ink-700);
        background: var(--am-surface);
        border: 1px solid var(--am-border);
      }
      .am-fstate__icon--glyph {
        font-size: var(--am-type-title-size);
      }
      .am-fstate__box--danger .am-fstate__icon {
        color: var(--am-danger-ink);
        background: var(--am-danger-bg);
        border-color: var(--am-danger-border);
      }
      .am-fstate__box--warn .am-fstate__icon {
        color: var(--am-warning-ink);
        background: var(--am-warning-bg);
        border-color: var(--am-warning-border);
      }
      .am-fstate__title {
        font-size: var(--am-type-heading-size);
        font-weight: 600;
      }
      .am-fstate__file {
        font-size: var(--am-type-value-size);
        color: var(--am-ink-700);
        overflow-wrap: anywhere;
      }
      .am-fstate__body {
        max-inline-size: 46ch;
        font-size: var(--am-type-body-size);
        color: var(--am-ink-700);
        text-wrap: pretty;
      }
      .am-fstate__actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--am-space-8);
        margin-block-start: var(--am-space-4);
      }
      .am-fstate__button {
        display: inline-flex;
        align-items: center;
        gap: var(--am-space-6);
        block-size: var(--am-control-height);
        box-sizing: border-box;
        padding: 0 var(--am-space-12);
        border: 1px solid var(--am-control-border-hover);
        border-radius: var(--am-radius-button);
        background: var(--am-control-bg);
        color: var(--am-ink-900);
        font: inherit;
        font-size: var(--am-type-value-size);
        font-weight: 500;
        cursor: pointer;
      }
      .am-fstate__button--primary {
        background: var(--am-primary-600);
        border-color: var(--am-primary-700);
        color: var(--am-surface-raised);
        font-weight: 600;
      }
      .am-fstate__button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-isolate {
        unicode-bidi: isolate;
      }
    `,
  ],
})
export class FileStatePanelComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The type badge ("DOC") or a single glyph ("!", "⊘", "⚠"). */
  readonly icon = input.required<string>();
  readonly tone = input<StatePanelTone>('muted');
  readonly role = input<'region' | 'alert'>('alert');
  readonly title = input.required<string>();
  readonly body = input.required<string>();
  /** The no-preview panel names the file: "name · Word · 1.2 MB" — three runs, each its own direction. */
  readonly fileLine = input<{ name: string; dir: 'ltr' | 'rtl'; type: string; size: string } | null>(null);
  readonly primaryLabel = input<string | null>(null);
  readonly primaryIcon = input<string | null>(null);
  readonly secondaryLabel = input<string | null>(null);
  readonly secondaryIcon = input<string | null>(null);
  /** Moves focus to the primary button once drawn: the no-preview panel's Download is the first stop. */
  readonly focusPrimary = input(false);
  readonly primary = output<void>();
  readonly secondary = output<void>();

  private static nextId = 0;
  readonly titleId = `am-fstate-${FileStatePanelComponent.nextId++}`;

  constructor() {
    afterNextRender(() => {
      if (!this.focusPrimary()) return;
      (this.host.nativeElement.querySelector('[data-am-primary]') as HTMLElement | null)?.focus();
    });
  }
}
