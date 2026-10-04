import {
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import {
  RoleService,
  RoleDto,
  UserRoleGrantDto,
} from '../../services/role.service';
import { OrgPositionService } from '../../../org-position/services/org-position.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmCountPipe, AmNumberPipe, FormatService } from '../../../../core/formatting';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

/** One row of the direct-grants list: a tenant role, held or not, changed or not. */
interface RoleRow {
  role: RoleDto;
  held: boolean;
  /** What Save will do to it: nothing, grant it, or remove it. */
  pending: 'none' | 'add' | 'remove';
  /** Populated only for a held role, from the grant's own date. */
  grantedAt: string | null;
  /** Set once a per-role call has been attempted. */
  outcome: 'saved' | 'failed' | null;
  failure: string | null;
}

/** A bilingual name as the API returns it. Kept as the PAIR, never resolved at
 *  load time: resolving eagerly freezes the row in whichever language was
 *  active when the data arrived, and a later switch never reaches it. Caught by
 *  measuring in Arabic — the sentence stayed "Unit Head" and "Neonatal ICU"
 *  while everything around it had translated. */
interface Name {
  en: string;
  ar: string | null;
}

/** One locked row: a role that comes with a head position. */
interface DerivedRow {
  role: RoleDto;
  position: Name | null;
  unit: Name | null;
  orgWide: boolean;
}

@Component({
  selector: 'app-manage-roles',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, CheckboxModule, FormsModule, AmCountPipe, AmNumberPipe],
  template: `
    <div class="flex flex-col gap-3">
      @if (loadError()) {
        <div class="flex flex-col items-start gap-2">
          <p class="text-sm text-[var(--am-danger-600,#B42318)]">{{ loadError() }}</p>
          <p-button
            [label]="'common.retry' | translate"
            size="small"
            [text]="true"
            (onClick)="load()"
          />
        </div>
      } @else if (loading()) {
        <!-- Five skeleton rows at the real row height, so the dialog does not
             resize under the reader when the data lands. -->
        @for (i of skeleton; track i) {
          <div class="h-[44px] rounded bg-[var(--am-surface)] animate-pulse"></div>
        }
      } @else {
        <!-- ── Head-position grants: locked, above the list ─────────────────── -->
        @if (derivedRows().length > 0) {
          <section class="flex flex-col gap-1">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-[var(--am-text-secondary)]">
              {{ 'manageRoles.fromHeadPosition' | translate }} ·
              {{ derivedRows().length | amNumber }}
            </h3>
            @for (d of derivedRows(); track d.role.id) {
              <div class="flex gap-2 rounded border border-[var(--am-border)] bg-[var(--am-surface)] p-2">
                <span aria-hidden="true" class="pt-[2px] text-[var(--am-text-secondary)]">⊡</span>
                <div class="flex min-w-0 flex-col">
                  <span class="text-[13px] font-medium">
                    {{ roleName(d.role) }}
                    <span class="font-normal text-[var(--am-text-secondary)]">
                      · {{ scopeLabel(d) }}
                    </span>
                  </span>
                  <!-- The sentence names the position AND where the grant is
                       actually ended. A locked row exists to send someone
                       somewhere else; one that only says "locked" sends them
                       nowhere. -->
                  <span class="text-[11.5px] leading-[17px] text-[var(--am-text-secondary)]">
                    {{ derivedSentence(d) }}
                  </span>
                </div>
              </div>
            }
          </section>
        }

        <!-- ── Direct grants ────────────────────────────────────────────────── -->
        <section class="flex min-h-0 flex-col gap-1">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-[var(--am-text-secondary)]">
            {{ 'manageRoles.grantedDirectly' | translate }}
          </h3>

          @if (rows().length === 0) {
            <p class="text-sm text-[var(--am-text-secondary)]">
              {{ 'manageRoles.noRolesExist' | translate }}
            </p>
          } @else {
            @if (heldCount() === 0) {
              <p class="text-[11.5px] leading-[17px] text-[var(--am-text-secondary)]">
                {{ 'manageRoles.holdsNothing' | translate: { name: userName() } }}
              </p>
            }
            <p class="text-[11.5px] text-[var(--am-text-secondary)]">
              {{ rows().length | amCount: 'manageRoles.roleCount' }} ·
              {{ 'manageRoles.tickedIsHeld' | translate }}
            </p>

            <!-- SCROLLS WITHIN ITS OWN FRAME, which is what keeps the dialog
                 body off the 420px cap however many roles a tenant defines.
                 Safe HERE and not in general, and the condition is written in
                 full beside the cap rule in edit-dialog.component.ts: nothing
                 in this frame may open a floating panel, because a new
                 scrollable frame is a new scrollable ancestor and PrimeNG's
                 overlays close on any ancestor scroll. Checkboxes only — add
                 no picker to this list. -->
            <ul
              class="am-roles-frame m-0 list-none overflow-y-auto rounded border border-[var(--am-border)] p-0"
            >
              @for (row of rows(); track row.role.id) {
                <li
                  class="flex min-h-[44px] items-center gap-[10px] border-b border-[var(--am-border)] px-[10px] last:border-b-0"
                  [class.am-roles-row--changed]="row.pending !== 'none'"
                >
                  <!-- ACC-120 — the root role's last active holder gets a LOCK
                       where the checkbox would be, matching the head-position
                       rows above: a row that cannot be changed looks the same
                       whatever makes it so. The reason is on the row, because a
                       lock with no sentence reads as a bug. -->
                  @if (isLastRootRoleHolder(row)) {
                    <i
                      class="pi pi-lock shrink-0 text-[var(--am-text-secondary)]"
                      aria-hidden="true"
                    ></i>
                    <span class="flex min-w-0 grow flex-col">
                      <span class="truncate text-[13px] font-medium">{{ roleName(row.role) }}</span>
                      <span class="text-[11.5px] text-[var(--am-text-secondary)]">
                        {{ 'manageRoles.lastAdministratorLocked' | translate }}
                      </span>
                    </span>
                  } @else {
                    <p-checkbox
                      [binary]="true"
                      [inputId]="'role-' + row.role.id"
                      [ngModel]="row.pending === 'add' || (row.held && row.pending !== 'remove')"
                      (ngModelChange)="toggle(row)"
                      [disabled]="saving()"
                    />
                    <label
                      [for]="'role-' + row.role.id"
                      class="flex min-w-0 grow cursor-pointer flex-col"
                    >
                      <span class="truncate text-[13px] font-medium">{{ roleName(row.role) }}</span>
                      @if (row.role.description) {
                        <span class="truncate text-[11.5px] text-[var(--am-text-secondary)]">
                          {{ row.role.description }}
                        </span>
                      }
                    </label>
                  }
                  <span class="shrink-0 whitespace-nowrap text-[11.5px]" [class]="metaClass(row)">
                    {{ metaText(row) }}
                  </span>
                </li>
              }
            </ul>
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      /* Sized so the whole body stays under the 420px cap in BOTH languages.
         Measured rather than chosen: see the component's own header note. */
      .am-roles-frame {
        max-height: 232px;
      }
      .am-roles-row--changed {
        background: var(--am-warning-50, #fffaeb);
      }
    `,
  ],
})
export class ManageRolesComponent implements OnInit {
  /**
   * ACC-120 slice 5 — the Manage roles dialog, panel A.
   *
   * ## What it is not
   *
   * PANEL B (bulk, tri-state, twelve users) IS NOT BUILT, and that is a
   * decision rather than an omission. There is no bulk endpoint — the API is one
   * POST or DELETE per role per user, which the drawing itself assumes — and the
   * Users list has no multi-select at all, so the "bulk bar" its entry point
   * comes from does not exist. Building it would mean inventing both.
   *
   * ## Why the actions are in the host's footer
   *
   * Same reason as invite-user: the 420px body cap applies to
   * `.am-dialog__body`, and the footer renders outside it. The host owns the
   * footer template and drives this component through `(ready)`.
   *
   * ## No author, anywhere
   *
   * UserRole has no granted-by column. The row shows when a person was given a
   * role and never by whom, because inventing that is exactly what the drawing
   * refuses to do.
   */
  readonly userId = input.required<string>();
  readonly userName = input<string>('');

  readonly saved = output<void>();
  readonly cancelled = output<void>();
  readonly dirtyChange = output<boolean>();
  readonly ready = output<ManageRolesComponent>();

  private readonly roleService = inject(RoleService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly access = inject(NavigationAccessService);
  private readonly format = inject(FormatService);

  readonly skeleton = [0, 1, 2, 3, 4];

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);

  readonly rows = signal<RoleRow[]>([]);
  readonly derivedRows = signal<DerivedRow[]>([]);

  readonly heldCount = computed(
    () => this.rows().filter((r) => r.held).length + this.derivedRows().length,
  );

  /**
   * ACC-120 — the root role cannot be taken from its LAST ACTIVE HOLDER, so
   * this row is rendered locked rather than as a checkbox.
   *
   * The server refuses it either way (the invariant rolls the transaction
   * back), and that is exactly why this exists: a checkbox that 409s on Save is
   * the dead Next button rebuilt somewhere more expensive. The refusal has to
   * be visible BEFORE the click.
   *
   * `activeHolderCount` is the role's ACTIVE holders, joined to User on the
   * backend. `<= 1` rather than `=== 1` because a 0 would mean the number is
   * stale or the role is held by nobody, and locking is the safe reading of
   * either.
   */
  isLastRootRoleHolder(row: RoleRow): boolean {
    return (
      row.role.key === 'TENANT_ADMIN' && row.held && (row.role.activeHolderCount ?? 0) <= 1
    );
  }

  readonly added = computed(() => this.rows().filter((r) => r.pending === 'add'));
  readonly removed = computed(() => this.rows().filter((r) => r.pending === 'remove'));
  readonly changeCount = computed(() => this.added().length + this.removed().length);

  /** Named in words, not counted — the footer says what Save will do. */
  readonly changeSummary = computed(() => {
    this.translate.currentLang();
    const parts = [
      ...this.added().map((r) => `+ ${this.roleName(r.role)}`),
      ...this.removed().map((r) => `− ${this.roleName(r.role)}`),
    ];
    return parts.join(' · ');
  });

  /**
   * True when saving would leave the person holding nothing at all — no direct
   * grant and no head-position grant either. A person who still holds a derived
   * role is not left with none, so the confirm does not apply to them.
   */
  readonly wouldLeaveWithNoRoles = computed(() => {
    if (this.derivedRows().length > 0) return false;
    const after = this.rows().filter(
      (r) => r.pending === 'add' || (r.held && r.pending !== 'remove'),
    );
    return after.length === 0 && this.changeCount() > 0;
  });

  ngOnInit(): void {
    this.ready.emit(this);
    this.load();
  }

  // ── loading ────────────────────────────────────────────────────────────────

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.saveError.set(null);

    // Positions and units are fetched for the locked rows' NAMES only, and each
    // is allowed to fail on its own: a caller may hold roles:manage without
    // org:view or positions:view, in which case the endpoint 403s. A failed
    // name must not take the dialog down — it changes what the locked row can
    // say, which scopeLabel()/derivedSentence() handle.
    forkJoin({
      grants: this.roleService.getUserRoles(this.userId()),
      roles: this.roleService.listAllRoles(),
      positions: this.orgPositionService.listPositions().pipe(catchError(() => of(null))),
      units: this.orgUnitService.getFlat().pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ grants, roles, positions, units }) => {
        this.build(grants, roles, positions, units);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loadError.set(extractErrorMessage(err, this.translate.instant('manageRoles.errorLoad')));
        this.loading.set(false);
      },
    });
  }

  private build(
    grants: UserRoleGrantDto[],
    roles: RoleDto[],
    positions: { id: string; nameEn: string; nameAr?: string | null }[] | null,
    units: { id: string; nameEn: string; nameAr?: string | null }[] | null,
  ): void {
    const positionName = new Map<string, Name>(
      (positions ?? []).map((p) => [p.id, { en: p.nameEn, ar: p.nameAr ?? null }]),
    );
    const unitName = new Map<string, Name>(
      (units ?? []).map((u) => [u.id, { en: u.nameEn, ar: u.nameAr ?? null }]),
    );

    this.derivedRows.set(
      grants
        .filter((g) => g.source !== 'DIRECT')
        .map((g) => ({
          role: g.role,
          position: g.grantedViaHeadPositionId
            ? (positionName.get(g.grantedViaHeadPositionId) ?? null)
            : null,
          unit: g.grantedViaHeadPositionOrgUnitId
            ? (unitName.get(g.grantedViaHeadPositionOrgUnitId) ?? null)
            : null,
          orgWide: g.source === 'HEAD_POSITION_ORG_WIDE',
        })),
    );

    const directByRole = new Map(
      grants.filter((g) => g.source === 'DIRECT').map((g) => [g.role.id, g]),
    );
    const derivedIds = new Set(this.derivedRows().map((d) => d.role.id));

    this.rows.set(
      roles
        // A role already held through a head position is shown above, locked.
        // Listing it again with a checkbox would offer a change that the server
        // refuses — and would read as two different answers about one role.
        .filter((r) => !derivedIds.has(r.id))
        .map((role) => ({
          role,
          held: directByRole.has(role.id),
          pending: 'none' as const,
          grantedAt: directByRole.get(role.id)?.grantedAt ?? null,
          outcome: null,
          failure: null,
        })),
    );
    this.dirtyChange.emit(false);
  }

  // ── editing ────────────────────────────────────────────────────────────────

  toggle(row: RoleRow): void {
    if (this.saving()) return;
    // The row renders a lock rather than a checkbox, so this is not the gate —
    // it is here because a template condition is a rendering, and this handler
    // stays reachable from code.
    if (this.isLastRootRoleHolder(row)) return;
    const next = this.rows().map((r) => {
      if (r.role.id !== row.role.id) return r;
      const currentlyOn = r.pending === 'add' || (r.held && r.pending !== 'remove');
      const pending: RoleRow['pending'] = currentlyOn
        ? r.held
          ? 'remove'
          : 'none'
        : r.held
          ? 'none'
          : 'add';
      return { ...r, pending, outcome: null, failure: null };
    });
    this.rows.set(next);
    this.dirtyChange.emit(this.changeCount() > 0);
  }

  // ── saving ─────────────────────────────────────────────────────────────────

  /**
   * One POST or DELETE per changed role, because the API is per role. Each is
   * allowed to fail on its own: the dialog stays open, succeeded rows lose their
   * change mark and read "Saved", failed rows keep theirs with the reason, and
   * a second Save retries only what failed.
   */
  onSubmit(): void {
    if (this.saving() || this.changeCount() === 0) return;
    this.saving.set(true);
    this.saveError.set(null);

    const pending = this.rows().filter((r) => r.pending !== 'none');
    const calls = pending.map((row) =>
      (row.pending === 'add'
        ? this.roleService.assignRoleToUser(this.userId(), row.role.id)
        : this.roleService.removeRoleFromUser(this.userId(), row.role.id)
      ).pipe(
        map(() => ({ id: row.role.id, ok: true, message: null as string | null })),
        catchError((err: unknown) =>
          of({
            id: row.role.id,
            ok: false,
            message: extractErrorMessage(err, this.translate.instant('manageRoles.errorSaveRow')),
          }),
        ),
      ),
    );

    forkJoin(calls).subscribe((results) => {
      const byId = new Map(results.map((r) => [r.id, r]));
      this.rows.set(
        this.rows().map((r) => {
          const result = byId.get(r.role.id);
          if (!result) return r;
          return result.ok
            ? {
                ...r,
                held: r.pending === 'add',
                pending: 'none' as const,
                outcome: 'saved' as const,
                failure: null,
              }
            : { ...r, outcome: 'failed' as const, failure: result.message };
        }),
      );
      this.saving.set(false);
      this.dirtyChange.emit(this.changeCount() > 0);

      const failed = results.filter((r) => !r.ok).length;
      if (failed === 0) {
        this.saved.emit();
        return;
      }
      // Through the plural catalogue: "1 of 2 changes saved" counts, so it is a
      // plural object with every category the language has, not a flat key with
      // {{total}} in it (ACC-94). Caught by translation-keys.spec.ts, which is
      // the second time in this change — the Save label was the first.
      this.saveError.set(
        this.format.count('manageRoles.partialSave', results.length, {
          saved: results.length - failed,
        }),
      );
    });
  }

  // ── display ────────────────────────────────────────────────────────────────

  roleName(role: RoleDto): string {
    return this.languageService.isArabic() ? role.nameAr || role.nameEn : role.nameEn;
  }

  /** Resolved AT RENDER, so a language switch reaches it. */
  private localName(name: Name): string {
    return this.languageService.isArabic() ? name.ar || name.en : name.en;
  }

  /** "Pharmacy only" / "organisation-wide" — or an honest stand-in. */
  scopeLabel(d: DerivedRow): string {
    this.translate.currentLang();
    if (d.orgWide) return this.translate.instant('manageRoles.scopeOrgWide');
    return d.unit
      ? this.translate.instant('manageRoles.scopeUnitOnly', { unit: this.localName(d.unit) })
      : this.translate.instant('manageRoles.scopeUnitUnnamed');
  }

  /**
   * THE LOCKED ROW MUST SAY SOMETHING USEFUL EVEN WHEN A NAME CANNOT BE
   * RESOLVED. A caller may hold roles:manage without org:view or positions:view,
   * and then /org-positions and /organization 403 — the ids are in hand, the
   * names are not. Rendering a blank where the position should be tells the
   * reader nothing, and a locked row's entire job is to say where to go instead.
   * So the unnamed variants still say what kind of grant it is and that it ends
   * with the head position.
   */
  derivedSentence(d: DerivedRow): string {
    this.translate.currentLang();
    return d.position
      ? this.translate.instant('manageRoles.comesWithPosition', {
          position: this.localName(d.position),
        })
      : this.translate.instant('manageRoles.comesWithPositionUnnamed');
  }

  metaText(row: RoleRow): string {
    this.translate.currentLang();
    if (row.outcome === 'failed') return row.failure ?? this.translate.instant('manageRoles.failed');
    if (row.outcome === 'saved') return this.translate.instant('manageRoles.savedMark');
    if (row.pending === 'add') return this.translate.instant('manageRoles.willBeGranted');
    if (row.pending === 'remove') return this.translate.instant('manageRoles.willBeRemoved');
    // Through the formatting layer, by meaning: a granted date is a DATE.
    return row.grantedAt
      ? this.translate.instant('manageRoles.grantedOn', {
          date: this.format.date(row.grantedAt),
        })
      : '';
  }

  metaClass(row: RoleRow): string {
    if (row.outcome === 'failed') return 'font-semibold text-[var(--am-danger-600,#B42318)]';
    if (row.pending === 'add') return 'font-semibold text-[var(--am-warning-700,#B54708)]';
    if (row.pending === 'remove') return 'font-semibold text-[var(--am-danger-600,#B42318)]';
    return 'text-[var(--am-text-secondary)] [font-variant-numeric:tabular-nums]';
  }

  readonly canManage = computed(() => this.access.hasPermission('roles:manage'));
}
