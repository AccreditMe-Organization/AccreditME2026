import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AiAssistComponent, AiAssistState } from '../../shared/components/ai-assist/ai-assist.component';
import { aiRefusal, AiRefusal } from '../../core/ai/ai-refusal';
import { FormatService } from '../../core/formatting';
import { LanguageService } from '../../core/services/language.service';
import { AuthService } from '../../core/services/auth.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { AiBriefingService, BriefingItemDto, BriefingViewDto, BriefingGroupKind } from './ai-briefing.service';

const MANAGE_CONFIG = 'tenant:manage_config';
const UNAVAILABLE: AiRefusal = { kind: 'unavailable', messageKey: 'ai.refusal.unavailable', params: {} };

/**
 * The AI briefing card on Home — ACC-198, drawing "AccreditMe AI for Users" §4,
 * with Ahmad's change of TRIGGER (12 Oct): it is made only when a tenant admin
 * presses the button, never automatically.
 *
 * Faces (am-ai-assist's states):
 *   - the button: allowed here and nothing made today;
 *   - working: after the press, until the answer (D11: no 8-second vanish);
 *   - the briefing: greeting, the tag with the time it was made, the lead,
 *     "Focus on these first" (D13, only when the model picked something we
 *     sent), the groups, "Show the full list", and "Make a new briefing";
 *   - a refusal: only after a press (D1), inside the card, with the previous
 *     briefing still below it.
 *
 * Absent entirely — no card, no button, no error — for anyone without
 * tenant:manage_config, and where the feature is not open or AI is off. A
 * briefing already made today stays visible without a button if the feature
 * is later closed (D12).
 *
 * Every item, date and link is the server's code's, never the model's: the
 * model wrote the lead and the focus reasons only. Those two are shown in the
 * language the briefing was made in (D4), marked with lang/dir.
 */
@Component({
  selector: 'app-home-briefing',
  standalone: true,
  imports: [AiAssistComponent, NgTemplateOutlet, RouterLink, TranslatePipe],
  template: `
    @if (view(); as v) {
      @if (v.available || v.briefing) {
        <section class="am-briefing" [attr.aria-label]="'home.briefing.label' | translate">
          @if (state() === 'idle' && !v.briefing) {
            <p class="am-briefing__intro">{{ 'home.briefing.intro' | translate }}</p>
          }
          <am-ai-assist
            [state]="state()"
            [triggerLabel]="'home.briefing.trigger' | translate"
            [againLabel]="'home.briefing.again' | translate"
            [triggerNote]="creditsNote()"
            [workingText]="'home.briefing.working' | translate"
            [tag]="tag()"
            [refusal]="refusal()"
            [hasResult]="!!v.briefing"
            [hideTrigger]="!v.available"
            [resultTemplate]="briefingTpl"
            (trigger)="press()"
            (retry)="press()"
          />
        </section>
      }
    }

    <ng-template #briefingTpl>
      @if (view()?.briefing; as b) {
        <p class="am-briefing__hello">{{ greeting() }}</p>
        <p class="am-briefing__lead" [attr.lang]="b.language" [attr.dir]="b.language === 'ar' ? 'rtl' : 'ltr'">{{ b.lead }}</p>

        @if (b.focus.length > 0) {
          <h3 class="am-briefing__head">{{ 'home.briefing.focus' | translate }}</h3>
          <ul class="am-briefing__list">
            @for (pick of b.focus; track pick.item.key) {
              <li class="am-briefing__row">
                <ng-container [ngTemplateOutlet]="itemTpl" [ngTemplateOutletContext]="{ $implicit: pick.item }" />
                <span class="am-briefing__reason" [attr.lang]="b.language" [attr.dir]="b.language === 'ar' ? 'rtl' : 'ltr'">{{ pick.reason }}</span>
              </li>
            }
          </ul>
        }

        @for (group of b.groups; track group.kind) {
          <h3 class="am-briefing__head" [class.am-briefing__head--warn]="group.kind === 'overdue'">{{ groupHeading(group.kind, group.items.length) }}</h3>
          <ul class="am-briefing__list">
            @for (item of group.items; track item.key) {
              <li class="am-briefing__row">
                <ng-container [ngTemplateOutlet]="itemTpl" [ngTemplateOutletContext]="{ $implicit: item }" />
                <span class="am-briefing__meta">{{ itemMeta(item) }}</span>
              </li>
            }
          </ul>
        }

        <button type="button" class="am-briefing__show-all" (click)="showAll.emit()">{{ 'home.briefing.showAll' | translate }}</button>
      }
    </ng-template>

    <ng-template #itemTpl let-item>
      @if (linkOf(item); as link) {
        <a class="am-briefing__link" [routerLink]="link.commands" [queryParams]="link.query">{{ itemTitle(item) }}</a>
      } @else {
        <span class="am-briefing__link am-briefing__link--plain">{{ itemTitle(item) }}</span>
      }
      @if (item.done) {
        <span class="am-briefing__done">{{ 'home.briefing.done' | translate }}</span>
      }
    </ng-template>
  `,
  styles: [
    `
      .am-briefing {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
        background: var(--am-surface-raised);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
        padding: var(--am-space-16);
      }
      .am-briefing__intro {
        margin: 0;
        color: var(--am-ink-700);
      }
      .am-briefing__hello {
        margin: 0;
        font-size: var(--am-type-heading-size);
        font-weight: 600;
      }
      .am-briefing__lead {
        margin: var(--am-space-4) 0 0;
      }
      .am-briefing__head {
        margin: var(--am-space-12) 0 var(--am-space-2);
        font-size: var(--am-type-meta-size);
        font-weight: 700;
        color: var(--am-ink-700);
      }
      .am-briefing__head--warn {
        color: var(--am-danger-ink);
      }
      .am-briefing__list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .am-briefing__row {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--am-space-2) var(--am-space-8);
        padding: var(--am-space-2) 0;
      }
      .am-briefing__link {
        font-weight: 500;
        text-decoration: none;
        color: var(--am-primary-600);
      }
      .am-briefing__link--plain {
        color: var(--am-ink-900);
      }
      .am-briefing__meta,
      .am-briefing__reason {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
      }
      .am-briefing__done {
        font-size: var(--am-type-meta-size);
        color: var(--am-success-ink);
        background: var(--am-success-bg);
        border: 1px solid var(--am-success-border);
        border-radius: var(--am-radius-pill);
        padding: 0 var(--am-space-6);
      }
      .am-briefing__show-all {
        align-self: flex-start;
        margin-block-start: var(--am-space-12);
        font: inherit;
        font-size: var(--am-type-meta-size);
        font-weight: 600;
        color: var(--am-primary-600);
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
      }
      .am-briefing__show-all:focus-visible,
      .am-briefing__link:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
    `,
  ],
})
export class HomeBriefingComponent implements OnInit {
  private readonly briefings = inject(AiBriefingService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly auth = inject(AuthService);
  private readonly access = inject(NavigationAccessService);

  /** "Show the full list" — Home scrolls to its panels. */
  readonly showAll = output<void>();

  readonly view = signal<BriefingViewDto | null>(null);
  readonly state = signal<AiAssistState>('idle');
  readonly refusal = signal<AiRefusal | null>(null);

  /** D2 — the price, quietly after the button's words: "· 5 credits". */
  readonly creditsNote = computed(() => {
    const cost = this.view()?.creditCost;
    return cost ? this.format.count('home.briefingCredits', cost) : '';
  });

  readonly tag = computed(() => {
    if (this.state() === 'working') return this.translate.instant('home.briefing.tagWorking');
    const made = this.view()?.briefing?.generatedAt;
    return made ? this.translate.instant('home.briefing.tagMade', { time: this.format.timeOfDay(made) }) : '';
  });

  readonly greeting = computed(() => {
    const view = this.view();
    if (!view) return '';
    return this.translate.instant(`home.briefing.greeting.${view.greeting}`, { name: this.auth.currentUser()?.name ?? '' });
  });

  ngOnInit(): void {
    // Only a tenant admin can ever press, so nobody else asks the server.
    if (!this.access.hasPermission(MANAGE_CONFIG)) return;
    this.briefings.get().subscribe({
      next: (view) => {
        this.view.set(view);
        this.state.set(view.briefing ? 'result' : 'idle');
      },
      // Never an error on Home: no card at all.
      error: () => this.view.set(null),
    });
  }

  press(): void {
    if (this.state() === 'working') return;
    this.state.set('working');
    this.refusal.set(null);
    this.briefings.make(this.language.isArabic() ? 'ar' : 'en').subscribe({
      next: (view) => {
        this.view.set(view);
        this.state.set(view.briefing ? 'result' : 'idle');
      },
      // D1 — after a press, the refusal shows inside the card. Anything that is
      // not an AI refusal (a dropped connection, a run already in flight in
      // another tab) reads as "unavailable", with Try again.
      error: (err: unknown) => {
        this.refusal.set(aiRefusal(err, this.format) ?? UNAVAILABLE);
        this.state.set('refusal');
      },
    });
  }

  groupHeading(kind: BriefingGroupKind, n: number): string {
    return this.translate.instant(`home.briefing.groups.${kind}`, { n: this.format.number(n) });
  }

  itemTitle(item: BriefingItemDto): string {
    return item.type === 'NOTIFICATION' ? this.language.bilingual(item.title, item.titleAr ?? null) : item.title;
  }

  itemMeta(item: BriefingItemDto): string {
    if (item.type === 'TASK') return item.dueAt ? this.translate.instant('home.briefing.due', { date: this.format.dateTime(item.dueAt) }) : '';
    if (item.type === 'TASK_REQUEST') {
      return item.requestType === 'ON_HOLD'
        ? this.translate.instant('home.briefing.hold', { date: this.format.date(item.requestedFor) })
        : this.translate.instant('home.briefing.moreTime', { date: this.format.dateTime(item.requestedFor) });
    }
    return item.createdAt ? this.format.relative(item.createdAt) : '';
  }

  /** The one map from a link target to a route. The server chose the target; the model never did. */
  linkOf(item: BriefingItemDto): { commands: string[]; query: Record<string, string> | null } | null {
    const link = item.link;
    if (!link) return null;
    // ACC-228 — a task opens its own page. A 'request' link (briefings saved
    // before ACC-228 carry the request's id, not the task's) still lands on
    // My tasks' "Waiting for your decision" row.
    if (link.target === 'task') return { commands: ['/tasks', link.id], query: null };
    if (link.target === 'request') return { commands: ['/tasks'], query: { request: link.id } };
    return { commands: ['/committees', link.id], query: null };
  }
}
