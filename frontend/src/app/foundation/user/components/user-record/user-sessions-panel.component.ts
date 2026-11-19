import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, Subscription, map } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { RequestOutcomeHandle, createRequestOutcome } from '../../../../core/request-outcome/request-outcome';
import {
  CappedPanelComponent,
  CappedPanelState,
  CAPPED_PANEL_ROWS,
} from '../../../../shared/components/capped-panel/capped-panel.component';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { ISessionsEndedDto, IUserSessionDto, IUserSessionsDto, UserService } from '../../services/user.service';
import { sessionsRefusalKey } from './sessions-refusal';

/**
 * Who is looking. `own`: the person themself, who may end their other devices.
 * `admin`: someone else holding users:view + users:manage_sessions, who may
 * "Sign out everywhere". The record page renders the panel for nobody else.
 */
export type SessionsPanelMode = 'own' | 'admin';

interface SessionRow {
  id: string;
  device: string;
  lastActive: string;
  signedIn: string;
  address: string | null;
  current: boolean;
}

/**
 * ACC-216 Sessions, PR 2 — the "Signed-in devices" panel of the user record page,
 * from GET /users/:id/sessions (backend PR #328). The standard capped panel for
 * now (Ahmad, Q11); the design thread checks it before it merges.
 *
 * The HOST decides whether it exists (yourself, or users:view +
 * users:manage_sessions — the endpoint's own rule). A refused read (403 or 404)
 * still leaves it ABSENT, its host hidden, never an empty panel.
 *
 * Its own request outcome (core/request-outcome, as the Two-step panel's) on
 * am-capped-panel: five rows, a skeleton while loading, the record panel's own
 * error state (the message, the error id, Retry), "No signed-in devices." when empty,
 * and See all in am-list-dialog (compact) past five (the server sends at most
 * 20, so there is no Load more).
 *
 * Actions, each through AmConfirmService.ask() (check:confirm-through-helper):
 *   - own: "Sign out" on each OTHER device and "Sign out other devices" — both
 *     say plainly it can take up to 15 minutes (Q7). Nothing on this device:
 *     Sign out in the user menu ends it.
 *   - admin: one "Sign out everywhere", naming the person, saying it is at once
 *     and that they are emailed (Q4, Q5).
 * A refusal is said from its code (sessions-refusal.ts), in both languages.
 */
@Component({
  selector: 'app-user-sessions-panel',
  standalone: true,
  imports: [TranslatePipe, CappedPanelComponent, ListDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block min-w-0',
    '[style.display]': 'denied() ? "none" : null',
    'data-panel': 'sessions',
  },
  template: `
    @if (!denied()) {
      <am-capped-panel
        [heading]="'userRecord.sessions.heading' | translate"
        [state]="state()"
        [total]="total()"
        [shown]="rows().length"
        [loadingText]="'userRecord.sessions.loading' | translate"
        [errorText]="'userRecord.sessions.loadError' | translate"
        [emptyText]="'userRecord.sessions.empty' | translate"
        [outcome]="outcome()"
        testIdPrefix="sessions"
        (retry)="load()"
        (seeAll)="popupOpen.set(true)"
      >
        @if (offersEndOthers()) {
          <button amPanelActions type="button" class="am-sp__act" (click)="confirmEndOthers()" data-testid="sessions-end-others">
            {{ 'userRecord.sessions.signOutOthers' | translate }}
          </button>
        }
        @if (offersEndAll()) {
          <button amPanelActions type="button" class="am-sp__act am-sp__act--danger" (click)="confirmEndAll()" data-testid="sessions-end-all">
            {{ 'userRecord.sessions.signOutEverywhere' | translate }}
          </button>
        }
        @for (row of rows(); track row.id) {
          <li class="am-cp-row" [attr.data-session-row]="row.id">
            <span class="flex items-center gap-2 min-w-0">
              <span class="flex flex-col min-w-0 flex-1">
                <span class="am-cp-l1">
                  <span class="am-cp-cut am-sp__device" [attr.title]="row.device">{{ row.device }}</span>
                  @if (row.current) {
                    <span class="am-sp__tag" data-testid="sessions-this-device">{{ 'userRecord.sessions.thisDevice' | translate }}</span>
                  }
                </span>
                <span class="am-cp-l2"><span class="am-cp-cut" [attr.title]="secondLine(row)">{{ secondLine(row) }}</span></span>
              </span>
              @if (mode() === 'own' && !row.current) {
                <button
                  type="button"
                  class="am-sp__row-act"
                  (click)="confirmEndOne(row)"
                  [attr.aria-label]="'userRecord.sessions.signOutLabel' | translate: { device: row.device }"
                  data-testid="sessions-end-one"
                >
                  {{ 'userRecord.sessions.signOut' | translate }}
                </button>
              }
            </span>
          </li>
        }
      </am-capped-panel>
      @if (done(); as message) {
        <p class="am-sp__note" role="status" data-testid="sessions-done">{{ message }}</p>
      }
      @if (refusal(); as key) {
        <p class="am-sp__note am-sp__note--error" role="alert" data-testid="sessions-refusal">{{ key | translate }}</p>
      }
    }

    <ng-template #popupBody>
      <ul class="am-sp__list" role="list" data-testid="sessions-popup">
        @for (row of allRows(); track row.id) {
          <li class="am-sp__item" [attr.data-session-row]="row.id">
            <span class="am-sp__what">
              {{ row.device }}
              @if (row.current) {
                <span class="am-sp__tag">{{ 'userRecord.sessions.thisDevice' | translate }}</span>
              }
            </span>
            <span class="am-sp__when">{{ secondLine(row) }}</span>
            <span class="am-sp__when">{{ row.signedIn }}</span>
          </li>
        }
      </ul>
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="popupOpen()"
      [heading]="'userRecord.sessions.popupTitle' | translate: { name: personName() }"
      [count]="format.number(total())"
      [closeLabel]="'userRecord.sessions.close' | translate"
      [body]="popupBody"
      (closeRequested)="popupOpen.set(false)"
    />
  `,
  styles: [
    `
      .am-sp__device{color:var(--am-ink-900)}
      .am-sp__tag{flex:none;font-size:11px;font-weight:600;line-height:18px;padding:0 6px;border-radius:var(--am-radius-pill);color:var(--am-primary-700);background:var(--am-primary-50)}
      .am-sp__act{flex:none;display:inline-flex;align-items:center;font:inherit;font-size:12.5px;font-weight:600;block-size:28px;padding:0 10px;color:var(--am-primary-700);background:var(--am-surface-raised);border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);cursor:pointer}
      .am-sp__act--danger{color:var(--am-danger-ink)}
      .am-sp__row-act{flex:none;font:inherit;font-size:12.5px;font-weight:600;padding:2px 6px;border:0;background:none;color:var(--am-primary-700);cursor:pointer}
      .am-sp__act:focus-visible,.am-sp__row-act:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-sp__note{margin:var(--am-space-8) 0 0;font-size:var(--am-type-meta-size);color:var(--am-ink-700)}
      .am-sp__note--error{color:var(--am-danger-ink)}
      .am-sp__list{list-style:none;margin:0;padding:0}
      .am-sp__item{display:flex;flex-direction:column;gap:var(--am-space-2);padding:var(--am-space-8) var(--am-space-16);border-block-end:1px solid var(--am-border);font-size:var(--am-type-value-size);overflow-wrap:anywhere}
      .am-sp__what{display:flex;align-items:center;gap:6px;color:var(--am-ink-900)}
      .am-sp__when{font-size:var(--am-type-meta-size);color:var(--am-ink-500)}
    `,
  ],
})
export class UserSessionsPanelComponent implements OnInit, OnDestroy {
  readonly userId = input.required<string>();
  readonly mode = input.required<SessionsPanelMode>();
  /** The person's name, for the See all title and the "Sign out everywhere" confirm. */
  readonly personName = input('');

  private readonly userService = inject(UserService);
  private readonly translate = inject(TranslateService);
  private readonly amConfirm = inject(AmConfirmService);
  protected readonly format = inject(FormatService);

  /** The read, as the shared request outcome; set in ngOnInit, once the user id is known. */
  private readonly handle = signal<RequestOutcomeHandle<IUserSessionsDto> | null>(null);
  readonly outcome = computed(() => this.handle()?.outcome() ?? null);
  readonly state = computed<CappedPanelState>(() => {
    const o = this.outcome();
    if (o?.status === 'rows' || o?.status === 'empty') return 'ready';
    return o?.status === 'error' ? 'error' : 'loading';
  });
  /** A refused read (403 or 404): the panel is absent, not empty. */
  readonly denied = computed(() => this.outcome()?.status === 'denied');
  private readonly page = computed(() => {
    const o = this.outcome();
    return o?.status === 'rows' ? o.data[0]! : null;
  });
  readonly total = computed(() => this.page()?.total ?? 0);
  private readonly entries = computed<readonly IUserSessionDto[]>(() => this.page()?.rows ?? []);
  readonly popupOpen = signal(false);
  /** The last action's outcome, said under the panel. */
  readonly done = signal<string | null>(null);
  readonly refusal = signal<string | null>(null);
  private readonly busy = signal(false);

  private action: Subscription | null = null;

  private readonly allMapped = computed<SessionRow[]>(() => {
    this.translate.currentLang();
    return this.entries().map((s) => this.toRow(s));
  });
  readonly rows = computed(() => this.allMapped().slice(0, CAPPED_PANEL_ROWS));
  readonly allRows = this.allMapped;

  /** Own list: only when there is another device to sign out. */
  readonly offersEndOthers = computed(
    () => this.mode() === 'own' && this.state() === 'ready' && this.entries().some((s) => !s.current),
  );
  /** Someone else's: only when they are signed in somewhere. */
  readonly offersEndAll = computed(() => this.mode() === 'admin' && this.state() === 'ready' && this.total() > 0);

  ngOnInit(): void {
    // One page in, one item out: the outcome's rows are [the page].
    this.handle.set(
      createRequestOutcome(() => this.userService.getSessions(this.userId()).pipe(map((page) => [page])), {
        describeEmpty: () => ({ reason: '', filtered: false }),
      }),
    );
  }

  ngOnDestroy(): void {
    this.handle()?.destroy();
    this.action?.unsubscribe();
  }

  /** Asks again: Retry, and the fresh list after an action. */
  load(): void {
    this.handle()?.retry();
  }

  secondLine(row: SessionRow): string {
    const parts = [row.lastActive];
    if (row.address) parts.push(row.address);
    return parts.join(' · ');
  }

  confirmEndOne(row: SessionRow): void {
    this.amConfirm.ask({
      tone: 'destructive',
      header: this.translate.instant('userRecord.sessions.confirm.one.header', { device: row.device }),
      message: this.translate.instant('userRecord.sessions.confirm.one.message', { device: row.device }),
      acceptLabel: this.translate.instant('userRecord.sessions.signOut'),
      accept: () => this.run(this.userService.endOwnSession(row.id), 'userRecord.sessions.done.one'),
    });
  }

  confirmEndOthers(): void {
    this.amConfirm.ask({
      tone: 'destructive',
      header: this.translate.instant('userRecord.sessions.confirm.others.header'),
      message: this.translate.instant('userRecord.sessions.confirm.others.message'),
      acceptLabel: this.translate.instant('userRecord.sessions.signOutOthers'),
      accept: () => this.run(this.userService.endOtherOwnSessions(), 'userRecord.sessions.done.others'),
    });
  }

  confirmEndAll(): void {
    const name = this.personName();
    this.amConfirm.ask({
      tone: 'destructive',
      header: this.translate.instant('userRecord.sessions.confirm.all.header', { name }),
      message: this.translate.instant('userRecord.sessions.confirm.all.message', { name }),
      acceptLabel: this.translate.instant('userRecord.sessions.signOutEverywhere'),
      accept: () => this.run(this.userService.endAllSessions(this.userId()), 'userRecord.sessions.done.all', { name }),
    });
  }

  private run(request: Observable<ISessionsEndedDto>, doneKey: string, params: Record<string, string> = {}): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.done.set(null);
    this.refusal.set(null);
    this.action?.unsubscribe();
    this.action = request.subscribe({
      next: () => {
        this.busy.set(false);
        this.done.set(this.translate.instant(doneKey, params));
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.refusal.set(sessionsRefusalKey(err));
      },
    });
  }

  private toRow(s: IUserSessionDto): SessionRow {
    const browser = s.device.browser ?? this.translate.instant('userRecord.sessions.unknownBrowser');
    const os = s.device.os ?? this.translate.instant('userRecord.sessions.unknownOs');
    return {
      id: s.id,
      device: this.translate.instant('userRecord.sessions.device', { browser, os }),
      lastActive: this.translate.instant('userRecord.sessions.lastActive', { when: this.format.relative(s.lastActiveAt) }),
      signedIn: this.translate.instant('userRecord.sessions.signedIn', { when: this.format.dateTime(s.startedAt) }),
      address: s.address,
      current: s.current,
    };
  }
}
