import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateLoader, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { EMPTY, catchError, take } from 'rxjs';
import { FormatService } from '../../core/formatting';
import { injectNavAccess } from '../../core/navigation/nav-access';
import {
  ADMIN_CONSOLE_GROUPS,
  AdminConsoleGroupKey,
  NavItem,
  visibleAdminConsoleItems,
  visibleNavGroups,
} from '../../core/navigation/nav-items';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { SetupHealthService } from '../setup-health/services/setup-health.service';
import { MarkSegment, markFind, matchesFind } from './admin-console-find';

const LANGUAGES = ['en', 'ar'] as const;

export interface ConsoleCard {
  key: string;
  route: string;
  icon: string;
  group: AdminConsoleGroupKey;
  /** The name and the line in the reader's language, cut where the query matched. */
  name: MarkSegment[];
  line: MarkSegment[];
}

export interface ConsoleGroup {
  key: AdminConsoleGroupKey;
  labelKey: string;
  cards: ConsoleCard[];
}

/** A translation looked up by its dotted key in one language's loaded file. */
function lookup(translations: unknown, key: string): string | null {
  let node: unknown = translations;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : null;
}

// ACC-292 — the Administration console, /admin. Built against
// frontend/design-reference/AccreditMe Administration.dc.html.
//
// THE CONSOLE READS THE NAV MODEL; IT KEEPS NO LIST OF ITS OWN. Every card is
// an Administration item from nav-items.ts that this user may see and that
// carries `console` data: its name is the item's labelKey, its link the item's
// route, its permission the item's. The Admin Settings hub ACC-79 removed kept
// a hand-copied card array beside the rail, and it drifted; this cannot,
// because there is one list and the rail, the guard, the breadcrumb, the tab
// title and this page all read it.
//
// The Setup health strip reads the summary the rail already polls for a
// setup:view holder (SetupHealthService.summary): no request of its own.
@Component({
  selector: 'app-admin-console',
  standalone: true,
  imports: [PageHeaderComponent, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-(--am-space-12) min-w-0" data-testid="admin-console">
      <app-page-header [title]="'nav.groups.admin' | translate" [purpose]="'adminConsole.purpose' | translate" />

      @if (showsStrip() && summary(); as health) {
        @if (health.open === 0) {
          <p class="am-console__quiet" data-testid="admin-console-quiet">
            <span class="am-console__quiet-tick" aria-hidden="true">✓</span>
            {{ 'adminConsole.strip.quiet' | translate }}
          </p>
        } @else {
          <div
            class="am-console__strip"
            [class.am-console__strip--blocks]="health.blocksWork > 0"
            data-testid="admin-console-strip"
          >
            <span class="am-console__strip-title">{{ 'adminConsole.strip.title' | translate }}</span>
            @if (health.blocksWork > 0) {
              <span class="am-console__chip am-console__chip--danger" data-testid="admin-console-blocks">
                <span aria-hidden="true">●</span> {{ blocksWork() }}
              </span>
            }
            @if (atRiskCount() > 0) {
              <span class="am-console__chip am-console__chip--warning" data-testid="admin-console-at-risk">
                <span aria-hidden="true">●</span> {{ atRisk() }}
              </span>
            }
            <a routerLink="/setup-health" class="am-console__strip-link">{{ 'adminConsole.strip.open' | translate }}</a>
          </div>
        }
      }

      <div class="relative w-full max-w-(--am-find-max-width)">
        <label for="am-console-find" class="sr-only">{{ 'adminConsole.find.label' | translate }}</label>
        <i class="pi pi-search absolute top-1/2 -translate-y-1/2 start-(--am-space-12) text-(length:--am-type-meta-size) text-(--am-ink-500) pointer-events-none" aria-hidden="true"></i>
        <input
          id="am-console-find"
          type="search"
          class="am-console__find-input"
          autocomplete="off"
          [placeholder]="'adminConsole.find.label' | translate"
          [value]="query()"
          (input)="onFind($event)"
          data-testid="admin-console-find"
        />
      </div>
      <!-- Polite, and present before anything is typed, so a screen reader
           announces each result line as it changes. -->
      <p class="m-0 min-h-(--am-type-meta-line) text-(length:--am-type-meta-size) leading-(--am-type-meta-line) text-(--am-ink-500)" aria-live="polite" data-testid="admin-console-result">{{ resultLine() }}</p>

      @for (group of groups(); track group.key) {
        <section class="flex flex-col gap-(--am-space-8)" [attr.aria-labelledby]="'am-console-group-' + group.key" [attr.data-group]="group.key">
          <h2 class="am-console__group-title" [id]="'am-console-group-' + group.key">{{ group.labelKey | translate }}</h2>
          <div class="am-console__grid">
            @for (card of group.cards; track card.key) {
              <a [routerLink]="card.route" class="am-console__card" [attr.data-card]="card.key">
                <span class="am-console__icon" aria-hidden="true"><i [class]="card.icon"></i></span>
                <span class="am-console__name">
                  @for (segment of card.name; track $index) {
                    @if (segment.mark) {<mark class="am-console__mark">{{ segment.text }}</mark>} @else {{{ segment.text }}}
                  }
                </span>
                <span class="am-console__line">
                  @for (segment of card.line; track $index) {
                    @if (segment.mark) {<mark class="am-console__mark">{{ segment.text }}</mark>} @else {{{ segment.text }}}
                  }
                </span>
              </a>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .am-console__strip,
      .am-console__quiet {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--am-space-8) var(--am-space-12);
        margin: 0;
        padding: var(--am-space-8) var(--am-space-12);
        background: var(--am-surface-raised);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
        font-size: var(--am-type-value-size);
        line-height: var(--am-type-value-line);
      }
      .am-console__strip {
        border-color: var(--am-warning-border);
      }
      .am-console__strip--blocks {
        border-color: var(--am-danger-border);
      }
      .am-console__quiet {
        color: var(--am-ink-700);
      }
      .am-console__quiet-tick {
        color: var(--am-success-ink);
        font-weight: 700;
      }
      .am-console__strip-title {
        font-weight: 600;
        color: var(--am-ink-900);
      }
      .am-console__chip {
        display: inline-flex;
        align-items: center;
        gap: var(--am-space-4);
        padding: 0 var(--am-space-8);
        border-radius: var(--am-radius-pill);
        border: 1px solid;
        font-size: var(--am-type-micro-size);
        line-height: var(--am-type-micro-line);
        font-weight: 600;
        white-space: nowrap;
      }
      .am-console__chip--danger {
        color: var(--am-danger-ink);
        background: var(--am-danger-bg);
        border-color: var(--am-danger-border);
      }
      .am-console__chip--warning {
        color: var(--am-warning-ink);
        background: var(--am-warning-bg);
        border-color: var(--am-warning-border);
      }
      .am-console__strip-link {
        margin-inline-start: auto;
        font-weight: 600;
        color: var(--am-primary-600);
        text-decoration: none;
      }
      .am-console__find-input {
        box-sizing: border-box;
        inline-size: 100%;
        block-size: var(--am-form-control-height);
        padding-block: 0;
        padding-inline: var(--am-space-32) var(--am-space-12);
        font: inherit;
        font-size: var(--am-type-value-size);
        color: var(--am-ink-900);
        background: var(--am-control-bg);
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-control);
      }
      .am-console__find-input:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: 0;
        border-color: var(--am-primary-600);
      }
      .am-console__find-input::placeholder {
        color: var(--am-ink-300);
      }
      .am-console__group-title {
        margin: 0;
        font-size: var(--am-type-micro-size);
        line-height: var(--am-type-micro-line);
        font-weight: var(--am-type-micro-weight);
        letter-spacing: var(--am-type-micro-tracking);
        text-transform: var(--am-type-micro-transform);
        color: var(--am-type-micro-color);
      }
      /* Three columns on a desktop, two on a narrower window, one on a phone:
         each card keeps a readable width, and nothing scrolls sideways. */
      .am-console__grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--am-space-12);
      }
      @media (min-width: 768px) {
        .am-console__grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (min-width: 1280px) {
        .am-console__grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      .am-console__card {
        display: grid;
        grid-template-columns: var(--am-space-32) minmax(0, 1fr);
        column-gap: var(--am-space-12);
        row-gap: var(--am-space-2);
        align-content: start;
        align-items: start;
        padding: var(--am-space-12) var(--am-space-16);
        background: var(--am-surface-raised);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
        text-decoration: none;
        min-inline-size: 0;
      }
      .am-console__card:hover {
        border-color: var(--am-info-border);
        background: var(--am-primary-50);
      }
      .am-console__card:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-console__icon {
        grid-row: span 2;
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--am-space-32);
        block-size: var(--am-space-32);
        border-radius: var(--am-radius-button);
        background: var(--am-info-bg);
        color: var(--am-info-ink);
        font-size: var(--am-type-body-size);
      }
      .am-console__name {
        min-inline-size: 0;
        font-size: var(--am-type-body-size);
        line-height: var(--am-type-body-line);
        font-weight: 600;
        color: var(--am-primary-700);
      }
      .am-console__line {
        min-inline-size: 0;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-700);
        text-wrap: pretty;
      }
      .am-console__mark {
        background: var(--am-mark-bg);
        color: inherit;
        border-radius: var(--am-space-2);
      }
    `,
  ],
})
export class AdminConsoleComponent {
  private readonly translate = inject(TranslateService);
  // The app's own loader (the plural-splitting HTTP loader), for the language
  // the reader is not using; see the constructor.
  private readonly loader = inject(TranslateLoader);
  private readonly format = inject(FormatService);
  private readonly setupHealth = inject(SetupHealthService);
  // The rail's own NavAccess, so this page shows exactly the cards whose
  // items the rail, the guard and the breadcrumb agree this user may see.
  private readonly navAccess = injectNavAccess();

  readonly query = signal('');

  readonly summary = this.setupHealth.summary;

  /** Setup health is shown where its item would be: a setup:view holder's. */
  readonly showsStrip = computed(() =>
    visibleNavGroups(this.navAccess).some((group) => group.items.some((item) => item.badge === 'setupHealth')),
  );

  readonly atRiskCount = computed(() => {
    const health = this.summary();
    return health ? Math.max(0, health.open - health.blocksWork) : 0;
  });

  readonly blocksWork = computed(() => this.format.count('adminConsole.blocksWork', this.summary()?.blocksWork ?? 0));
  readonly atRisk = computed(() => this.format.count('adminConsole.atRisk', this.atRiskCount()));

  private readonly items = computed<NavItem[]>(() => visibleAdminConsoleItems(this.navAccess));

  /** Each item's name and line in every loaded language, for matching. */
  private readonly allTexts = computed(() => {
    const files = LANGUAGES.map((language) => this.translate.getTranslations(language));
    return new Map(
      this.items().map((item) => [
        item.key,
        files.flatMap((file) =>
          [lookup(file, item.labelKey), lookup(file, item.console!.lineKey)].filter((text): text is string => !!text),
        ),
      ]),
    );
  });

  private readonly matched = computed<ConsoleCard[]>(() => {
    const query = this.query();
    const texts = this.allTexts();
    return this.items()
      .filter((item) => matchesFind({ texts: texts.get(item.key) ?? [], synonyms: item.console!.synonyms ?? [] }, query))
      .map((item) => {
        const name = this.translate.instant(item.labelKey) as string;
        const line = this.translate.instant(item.console!.lineKey) as string;
        // The name is marked if it holds the match; otherwise the line.
        const nameMarks = markFind(name, query);
        return {
          key: item.key,
          route: item.route,
          icon: item.icon,
          group: item.console!.group,
          name: nameMarks ?? [{ text: name, mark: false }],
          line: (nameMarks ? null : markFind(line, query)) ?? [{ text: line, mark: false }],
        };
      });
  });

  /** The console's groups, each with its matching cards; a group with none is left out. */
  readonly groups = computed<ConsoleGroup[]>(() => {
    const cards = this.matched();
    return ADMIN_CONSOLE_GROUPS.map((group) => ({
      ...group,
      cards: cards.filter((card) => card.group === group.key),
    })).filter((group) => group.cards.length > 0);
  });

  /** Empty until something is typed: "2 settings match", or "No settings match “…”." */
  readonly resultLine = computed(() => {
    const query = this.query().trim();
    if (!query) return '';
    const count = this.matched().length;
    return count > 0
      ? this.format.count('adminConsole.matches', count)
      : (this.translate.instant('adminConsole.find.none', { query }) as string);
  });

  constructor() {
    // Find a setting matches both languages, and only the reader's is loaded
    // at start-up (Arabic arrives on the first switch). Load the other file
    // once, through the app's own loader, and store it WITHOUT switching to it
    // (ngx-translate v18's service has no load-only call; use() switches).
    // Until it lands, or if it fails, the reader's language still matches.
    for (const language of LANGUAGES) {
      if (this.translate.getTranslations(language)) continue;
      this.loader
        .getTranslation(language)
        .pipe(
          take(1),
          catchError(() => EMPTY),
        )
        .subscribe((file) => {
          if (!this.translate.getTranslations(language)) this.translate.setTranslation(language, file);
        });
    }
  }

  onFind(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
