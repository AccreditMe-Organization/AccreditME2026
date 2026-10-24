import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input, output } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { ChartBox, headSubject, initialsOf } from './org-chart-model';

/**
 * ACC-120 slice 11, PR E — one box of the chart (OS L176-204, L569), and the
 * tree's treeitem itself: the host carries the role, the roving tabindex and
 * the accessible name, so the box is ONE tab stop with nothing focusable
 * inside it (the "below" button is reached by Shift+Enter, OS L577).
 *
 * At rest: the name (one line, clamped — its full text is in the accessible
 * name and the side panel), the type on levels 1–2, the head, one summary line
 * and the attention chip. Colour means attention only (OS L573). The size is
 * the chart's, fixed per level (`boxSize()`).
 */
@Component({
  selector: 'am-org-chart-box',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'treeitem',
    class: 'ocb',
    '[class.ocb--wide]': 'box().level <= 2',
    '[class.ocb--selected]': 'selected()',
    '[style.width.px]': 'width()',
    '[style.height.px]': 'height()',
    '[attr.tabindex]': 'focusable() ? 0 : -1',
    '[attr.aria-level]': 'box().level',
    '[attr.aria-posinset]': 'box().index',
    '[attr.aria-setsize]': 'box().parent ? box().parent!.children.length : 1',
    '[attr.aria-selected]': 'selected()',
    '[attr.aria-expanded]': 'box().children.length ? true : null',
    '[attr.aria-label]': 'label()',
    '[attr.data-box]': 'box().node.id',
    '[attr.data-level]': 'box().level',
  },
  template: `
    <div class="ocb__name" [attr.title]="name()" data-testid="box-name">{{ name() }}</div>
    @if (box().level <= 2) {
      <div class="ocb__line ocb__muted">{{ type() }}</div>
    }
    <div class="ocb__head">
      <span class="ocb__av" [class.ocb__av--none]="!head()" aria-hidden="true">{{ initials() }}</span>
      <span class="ocb__cut" [class.ocb__muted]="!head()" data-testid="box-head">{{ headLine() }}</span>
    </div>
    <div class="ocb__sum">
      <span class="ocb__cut" data-testid="box-people">{{ people() }}</span>
      @if (chip(); as c) {
        <span class="ocb__chip" [class.ocb__chip--blocks]="c.blocks" data-testid="box-chip">{{ c.text }}</span>
      }
    </div>
    @if (committeesLine(); as line) {
      <div class="ocb__cmt" data-testid="box-committees">◇ {{ line }}</div>
    }
    @if (box().below) {
      <button type="button" class="ocb__below" tabindex="-1" (click)="$event.stopPropagation(); reroot.emit()" data-testid="box-below">
        {{ belowText() }}
      </button>
    }
  `,
  styles: [
    `
      am-org-chart-box.ocb{display:block;box-sizing:border-box;overflow:hidden;padding:var(--am-space-8);text-align:start;background:var(--am-surface-raised);border:1px solid var(--am-control-border);border-radius:var(--am-radius-card);cursor:pointer;color:var(--am-ink-900)}
      am-org-chart-box.ocb--wide{padding-inline:var(--am-space-12)}
      am-org-chart-box.ocb--selected{border-color:var(--am-primary-600);box-shadow:inset 0 0 0 1px var(--am-primary-600)}
      am-org-chart-box.ocb:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .ocb__name{font-size:var(--am-type-value-size);line-height:var(--am-type-meta-line);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ocb__line{font-size:var(--am-type-micro-size);line-height:var(--am-type-micro-line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ocb__muted{color:var(--am-ink-500)}
      .ocb__head{display:flex;align-items:center;gap:var(--am-space-6);min-inline-size:0;margin-block-start:var(--am-space-4);font-size:var(--am-type-meta-size);line-height:var(--am-space-20)}
      .ocb__av{flex:none;display:flex;align-items:center;justify-content:center;inline-size:var(--am-space-20);block-size:var(--am-space-20);border-radius:var(--am-radius-pill);background:var(--am-primary-100);color:var(--am-primary-700);font-size:var(--am-type-micro-size);font-weight:600}
      .ocb__av--none{background:none;border:1px dashed var(--am-control-border)}
      .ocb__cut{min-inline-size:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ocb__sum{display:flex;align-items:center;justify-content:space-between;gap:var(--am-space-6);min-inline-size:0;margin-block-start:var(--am-space-4);font-size:var(--am-type-micro-size);line-height:var(--am-type-meta-line);color:var(--am-ink-700)}
      .ocb__chip{flex:none;font-weight:600;padding-inline:var(--am-space-6);border-radius:var(--am-radius-pill);color:var(--am-warning-ink);background:var(--am-warning-bg);border:1px solid var(--am-warning-border)}
      .ocb__chip--blocks{color:var(--am-danger-ink);background:var(--am-danger-bg);border-color:var(--am-danger-border)}
      .ocb__cmt{margin-block-start:var(--am-space-6);padding-block-start:var(--am-space-6);border-block-start:1px solid var(--am-border);font-size:var(--am-type-micro-size);line-height:var(--am-type-micro-line);color:var(--am-ink-700)}
      .ocb__below{display:block;inline-size:100%;block-size:var(--ocb-below);margin-block-start:var(--ocb-below-gap);padding:var(--am-space-4) var(--am-space-6);font:inherit;font-size:var(--am-type-micro-size);font-weight:600;line-height:var(--am-type-micro-line);color:var(--am-primary-700);background:var(--am-primary-50);border:1px solid var(--am-info-border);border-radius:var(--am-radius-control);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    `,
  ],
  encapsulation: ViewEncapsulation.None,
})
export class OrgChartBoxComponent {
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  readonly box = input.required<ChartBox>();
  readonly width = input.required<number>();
  readonly height = input.required<number>();
  readonly selected = input(false);
  /** The roving tab stop: exactly one box in the chart has tabindex 0. */
  readonly focusable = input(false);
  /** Showing committees, and this box's level has any. */
  readonly showCommittees = input(false);
  readonly reroot = output<void>();

  private readonly t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params);

  readonly name = computed(() => this.language.bilingual(this.box().node.nameEn, this.box().node.nameAr));

  readonly type = computed(() => {
    this.translate.currentLang();
    const type = this.box().node.type;
    return type ? this.language.bilingual(type.labelEn, type.labelAr) : this.t('organization.tree.noTypeCell');
  });

  readonly head = computed(() => {
    this.translate.currentLang();
    return headSubject(this.box().node, this.t, (en, ar) => this.language.bilingual(en, ar));
  });

  readonly initials = computed(() => initialsOf(this.head()?.name));

  readonly headLine = computed(() => {
    const h = this.head();
    if (!h) return this.t('headship.head.none');
    let line = h.text;
    if (h.acting) line += ` ${this.t('organization.chart.acting')}`;
    if (h.incoming) line += ` · ${this.t('organization.tree.incoming', { name: h.incoming })}`;
    return line;
  });

  readonly people = computed(() => {
    this.translate.currentLang();
    const n = this.box().node.headcount;
    return n ? this.format.count('organization.people', n) : this.t('organization.chart.noOneAssigned');
  });

  /** False on the read-only page (PR F, OS §6): no severity chip, whatever the API sent. */
  readonly attention = input(true);

  /** The attention chip: present only when the API sent it (setup:view, D7). */
  readonly chip = computed(() => {
    if (!this.attention()) return null;
    this.translate.currentLang();
    const a = this.box().node.attention;
    if (!a) return null;
    return { text: this.t(`organization.tree.attention.${a.code}`, { date: this.format.date(a.since) }), blocks: a.severity === 'BLOCKS_WORK' };
  });

  readonly committeesLine = computed(() => {
    this.translate.currentLang();
    const n = this.box().node.committees.count;
    return this.showCommittees() && n > 0 ? this.format.count('organization.committees', n) : null;
  });

  readonly belowText = computed(() => {
    this.translate.currentLang();
    return this.format.count('organization.subUnitsBelow', this.box().below);
  });

  /** The full accessible name: name, type, head, people, attention, hidden children. */
  readonly label = computed(() =>
    [this.name(), this.box().level <= 2 ? this.type() : null, this.headLine(), this.people(), this.chip()?.text.replace(/^▲\s*/, ''), this.box().below ? this.belowText() : null]
      .filter(Boolean)
      .join(', '),
  );
}
