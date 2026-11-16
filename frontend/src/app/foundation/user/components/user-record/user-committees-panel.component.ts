import { Component, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map, tap } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import {
  RequestOutcome,
  RequestOutcomeHandle,
  createRequestOutcome,
} from '../../../../core/request-outcome/request-outcome';
import { RecordPanelComponent } from '../../../../shared/components/record-panel/record-panel.component';
import { IUserCommitteeDto, UserService } from '../../services/user.service';

/** One row of the Committees panel. */
export interface CommitteeRow {
  id: string;
  name: string;
  /** "Member · Since 3 Mar 2026", or "Member · 3 Mar 2025 – 1 May 2026". */
  detail: string;
  current: boolean;
}

/**
 * ACC-216 — the Committees panel of the user record page: the committees a person
 * sits on, then those they sat on, from GET /users/:id/committees.
 *
 * The HOST decides whether it exists: the record page renders it only for a
 * viewer holding committees:view (the page itself is already self or users:view).
 * A refused read (403/404) leaves it ABSENT, its host hidden too, so the panel grid
 * reflows as if it were never there.
 *
 * Every row is shown, as on the Roles panel: the page caps no panel at five, and a
 * person sits on a handful of committees. The server returns at most 200; past that
 * a line says how many are shown.
 *
 * Order and `current` are the server's (ACC-281's membership rule): nothing here
 * re-derives either. Names through LanguageService.bilingual(); dates through the
 * formatting layer.
 */
@Component({
  selector: 'app-user-committees-panel',
  standalone: true,
  imports: [RouterLink, TranslatePipe, RecordPanelComponent],
  host: {
    class: 'block min-w-0',
    '[style.display]': "outcome()?.status === 'denied' ? 'none' : null",
  },
  template: `
    <app-record-panel
      data-panel="committees"
      [heading]="'userRecord.committees.heading' | translate"
      [count]="count()"
      [outcome]="outcome()"
      (retry)="handle()?.retry()"
      [error]="'userRecord.committees.loadError'"
      [emptyTitle]="'userRecord.committees.empty' | translate"
    >
      <ul class="m-0 p-0 list-none">
        @for (row of rows(); track row.id) {
          <li
            class="flex flex-col gap-0.5 min-w-0 px-4 py-2 border-b border-[var(--am-row-rule)]"
            [attr.data-committee-row]="row.current ? 'current' : 'past'"
          >
            <a
              class="text-[13px] font-medium text-[var(--am-primary-600)] hover:underline [overflow-wrap:anywhere]"
              [routerLink]="['/committees', row.id]"
              data-committee-link
              >{{ row.name }}</a
            >
            <span class="text-[11.5px] text-[var(--am-ink-500)] [overflow-wrap:anywhere]" data-committee-detail>{{
              row.detail
            }}</span>
          </li>
        }
      </ul>
      @if (overCap(); as line) {
        <p class="m-0 px-4 py-2 text-[11.5px] text-[var(--am-ink-500)]" data-committees-over-cap>{{ line }}</p>
      }
    </app-record-panel>
  `,
})
export class UserCommitteesPanelComponent implements OnInit, OnDestroy {
  readonly userId = input.required<string>();

  private readonly userService = inject(UserService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly handle = signal<RequestOutcomeHandle<IUserCommitteeDto> | null>(null);
  readonly outcome = computed<RequestOutcome<unknown> | null>(() => this.handle()?.outcome() ?? null);
  private readonly total = signal(0);

  private readonly data = computed<readonly IUserCommitteeDto[]>(() => {
    const outcome = this.handle()?.outcome();
    return outcome?.status === 'rows' ? outcome.data : [];
  });

  /** Every membership the person has; "—" while unknown is the panel's own. */
  readonly count = computed<number | null>(() => {
    const status = this.outcome()?.status;
    return status === 'rows' || status === 'empty' ? this.total() : null;
  });

  readonly rows = computed<CommitteeRow[]>(() => {
    this.translate.currentLang();
    return this.data().map((m) => ({
      id: m.committee.id,
      name: this.language.bilingual(m.committee.nameEn, m.committee.nameAr),
      detail: `${this.seatName(m)} · ${this.period(m)}`,
      current: m.current,
    }));
  });

  readonly overCap = computed<string | null>(() => {
    this.translate.currentLang();
    const shown = this.data().length;
    const total = this.total();
    return shown > 0 && total > shown
      ? this.translate.instant('record.showing', {
          shown: this.format.number(shown),
          total: this.format.number(total),
        })
      : null;
  });

  ngOnInit(): void {
    this.handle.set(
      createRequestOutcome(
        () =>
          this.userService.getCommittees(this.userId()).pipe(
            tap((r) => this.total.set(r.total)),
            map((r) => r.rows),
          ),
        { describeEmpty: () => ({ reason: '', filtered: false }) },
      ),
    );
  }

  ngOnDestroy(): void {
    this.handle()?.destroy();
  }

  private seatName(m: IUserCommitteeDto): string {
    return m.seat.labelEn ? this.language.bilingual(m.seat.labelEn, m.seat.labelAr) : '—';
  }

  /**
   * Current: "Since {date}". Left: "{joined} – {left}". A membership of a committee
   * since deactivated, never ended: "Since {date} · Committee inactive".
   */
  private period(m: IUserCommitteeDto): string {
    const joined = this.format.date(m.joinedAt);
    if (m.current) return this.translate.instant('userRecord.committees.since', { date: joined });
    if (m.leftAt) {
      return this.translate.instant('userRecord.committees.range', { from: joined, to: this.format.date(m.leftAt) });
    }
    return `${this.translate.instant('userRecord.committees.since', { date: joined })} · ${this.translate.instant(
      'userRecord.committees.inactiveCommittee',
    )}`;
  }
}
