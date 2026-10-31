import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { withArabicLam } from '../../../../shared/utils/arabic-prefix.util';
import { IOrgPositionDto, OrgPositionService } from '../../../org-position/services/org-position.service';
import { UserService } from '../../../user/services/user.service';
import { IOrgUnitHeadStatus, OrgUnitHeadService } from '../../services/org-unit-head.service';
import { AppointHeadDialogComponent, HeadshipPerson } from '../appoint-head-dialog/appoint-head-dialog.component';
import { AppointSuccessorDialogComponent } from '../appoint-successor-dialog/appoint-successor-dialog.component';
import { SetActingHeadDialogComponent } from '../set-acting-head-dialog/set-acting-head-dialog.component';
import { HeadshipAction, deriveHeadshipState } from '../headship-panel/headship-state';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ACC-133's headship ACTIONS, for one unit: the three dialogs (Appoint head,
 * Appoint successor, Arrange cover), the four confirms (Vacate, Start new head
 * today, Withdraw appointment, End cover), and what they need (the unit's
 * active people, the organisation's head-conferring positions).
 *
 * ACC-120 slice 11 — moved, unchanged, out of the Headship panel so the org
 * tree's row menu opens exactly the same dialogs and confirms. The panel and
 * the tree both host it; there is one copy. Nothing here decides which actions
 * a state allows: that is `deriveHeadshipState()`, and the server checks again.
 *
 * Rendered whether or not the status has arrived, so the people and positions
 * are read as soon as it is created, as the panel did. Only for org:manage.
 */
@Component({
  selector: 'am-headship-actions',
  standalone: true,
  imports: [AppointHeadDialogComponent, AppointSuccessorDialogComponent, SetActingHeadDialogComponent],
  template: `
    @if (status(); as s) {
      <am-appoint-head-dialog
        [orgUnitId]="orgUnitId()"
        [unitName]="unitName()"
        [people]="people()"
        [positions]="headPositions()"
        [visible]="dialog() === 'appointHead'"
        (visibleChange)="!$event && dialog.set(null)"
        (saved)="onSaved()"
      />
      <am-appoint-successor-dialog
        [orgUnitId]="orgUnitId()"
        [unitName]="unitName()"
        [status]="s"
        [people]="people()"
        [positions]="headPositions()"
        [visible]="dialog() === 'appointSuccessor'"
        (visibleChange)="!$event && dialog.set(null)"
        (saved)="onSaved()"
      />
      <app-set-acting-head-dialog
        [orgUnitId]="orgUnitId()"
        [unitName]="unitName()"
        [status]="s"
        [people]="people()"
        [visible]="dialog() === 'arrangeCover'"
        (visibleChange)="!$event && dialog.set(null)"
        (saved)="onSaved()"
      />
    }
  `,
})
export class HeadshipActionsComponent implements OnInit {
  private readonly headService = inject(OrgUnitHeadService);
  private readonly userService = inject(UserService);
  private readonly positionService = inject(OrgPositionService);
  private readonly confirm = inject(AmConfirmService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly access = inject(NavigationAccessService);

  readonly orgUnitId = input.required<string>();
  readonly unitName = input.required<string>();
  /** The unit's head status (`GET …/:id/head`). The dialogs wait for it. */
  readonly status = input<IOrgUnitHeadStatus | null>(null);
  /** After any change, so the host can read the unit again. */
  readonly saved = output<void>();

  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly dialog = signal<'appointHead' | 'appointSuccessor' | 'arrangeCover' | null>(null);

  readonly people = signal<HeadshipPerson[]>([]);
  readonly headPositions = signal<IOrgPositionDto[] | null>(null);
  private readonly positionsFailed = signal(false);

  readonly canManage = computed(() => this.access.hasPermission('org:manage'));

  readonly view = computed(() => {
    const s = this.status();
    return s ? deriveHeadshipState(s) : null;
  });

  ngOnInit(): void {
    if (!this.canManage()) return;
    // The dialogs' choices: this unit's active people, and the organisation's
    // head-conferring positions. Read only for a viewer who may act.
    this.userService.listAllUsers({ status: 'ACTIVE', orgUnitId: this.orgUnitId() }).subscribe({
      next: (users) =>
        this.people.set(
          users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            positionId: u.positionId,
            // ACC-172 — both names; each dialog picks the reader's language.
            positionName: u.position ?? null,
          })),
        ),
      error: () => this.people.set([]),
    });
    this.positionService.listPositions().subscribe({
      next: (positions) => this.headPositions.set(positions.filter((p) => p.isUnitHeadPosition && p.isActive !== false)),
      error: () => this.positionsFailed.set(true),
    });
  }

  private personName(name: string | null, fallbackKey: string): string {
    return name ?? this.translate.instant(fallbackKey);
  }

  /**
   * Why an offered action cannot open yet, said beside it. Only Appoint head
   * has one: with no head-conferring position there is nothing to appoint to,
   * so the dialog does not open and the reason stays visible.
   */
  blockedReason(action: HeadshipAction): string | null {
    if (action !== 'appointHead') return null;
    if (this.positionsFailed()) return 'headship.appoint.positionsUnavailable';
    const positions = this.headPositions();
    if (positions !== null && positions.length === 0) return 'headship.appoint.noPosition';
    return null;
  }

  run(action: HeadshipAction): void {
    this.actionError.set(null);
    switch (action) {
      case 'appointHead':
      case 'appointSuccessor':
      case 'arrangeCover':
        this.dialog.set(action);
        return;
      case 'vacate':
        return this.askVacate();
      case 'startNewHeadToday':
        return this.askStartToday();
      case 'withdrawAppointment':
        return this.askWithdraw();
      case 'endCover':
        return this.askEndCover();
    }
  }

  onSaved(): void {
    this.dialog.set(null);
    this.saved.emit();
  }

  private send(request: ReturnType<OrgUnitHeadService['vacateHead']>): void {
    this.busy.set(true);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.actionError.set(extractErrorMessage(err, 'headship.saveFailed'));
      },
    });
  }

  private askVacate(): void {
    const v = this.view()!;
    const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params);
    const name = this.personName(v.head?.name ?? null, 'headship.confirm.theHead');
    const unit = this.unitName();
    let message = t('headship.confirm.vacate.message', { unit, unitWithLam: withArabicLam(unit), name });
    if (this.status()?.cover) {
      message += ' ' + t('headship.confirm.vacate.coverContinues', {
        name: this.personName(this.status()!.cover!.name, 'headship.confirm.theActingHead'),
      });
    }
    this.confirm.ask({
      tone: 'destructive',
      header: t('headship.confirm.vacate.header', { name, unit, unitWithLam: withArabicLam(unit) }),
      message,
      acceptLabel: t('headship.confirm.vacate.accept'),
      accept: () => this.send(this.headService.vacateHead(this.orgUnitId())),
    });
  }

  private askStartToday(): void {
    const v = this.view()!;
    const s = this.status()!;
    const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params);
    const incoming = this.personName(v.incoming?.name ?? null, 'headship.confirm.theIncomingHead');
    const outgoing = this.personName(v.head?.name ?? null, 'headship.confirm.theCurrentHead');
    const unit = this.unitName();
    const planned = s.headHandoverEffectiveDate;
    const daysEarly = planned ? Math.max(0, Math.ceil((new Date(planned).getTime() - Date.now()) / DAY_MS)) : 0;
    let message = planned
      ? t('headship.confirm.startToday.message', {
          incoming,
          outgoing,
          early: this.format.count('headship.daysBefore', daysEarly),
          date: this.format.date(planned),
        })
      : t('headship.confirm.startToday.messageUndated', { incoming, outgoing });
    // completeHandoverNow() does not touch a running cover, so it is said to
    // continue — never that it ends (the drawing's line was not what the
    // server does).
    if (s.cover || s.scheduledCover) {
      message += ' ' + t('headship.confirm.startToday.coverContinues', {
        name: this.personName((s.cover ?? s.scheduledCover)!.name, 'headship.confirm.theActingHead'),
      });
    }
    this.confirm.ask({
      tone: 'neutral',
      header: t('headship.confirm.startToday.header', { name: incoming, unit, unitWithLam: withArabicLam(unit) }),
      message,
      acceptLabel: t('headship.confirm.startToday.accept'),
      accept: () => this.send(this.headService.completeHandoverNow(this.orgUnitId())),
    });
  }

  private askWithdraw(): void {
    const v = this.view()!;
    const s = this.status()!;
    const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params);
    const incoming = this.personName(v.incoming?.name ?? null, 'headship.confirm.theIncomingHead');
    const outgoing = this.personName(v.head?.name ?? null, 'headship.confirm.theCurrentHead');
    const header = s.headHandoverEffectiveDate
      ? t('headship.confirm.withdraw.header', { name: incoming, date: this.format.date(s.headHandoverEffectiveDate) })
      : t('headship.confirm.withdraw.headerUndated', { name: incoming });
    const message = s.pendingHeadAccessSince
      ? t('headship.confirm.withdraw.message', { incoming, outgoing, date: this.format.date(s.pendingHeadAccessSince) })
      : t('headship.confirm.withdraw.messageUndated', { incoming, outgoing });
    this.confirm.ask({
      tone: 'destructive',
      header,
      message,
      acceptLabel: t('headship.confirm.withdraw.accept'),
      rejectLabel: t('headship.confirm.withdraw.keep'),
      accept: () => this.send(this.headService.cancelHandover(this.orgUnitId())),
    });
  }

  private askEndCover(): void {
    const v = this.view()!;
    const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params);
    const name = this.personName(v.cover?.name ?? null, 'headship.confirm.theActingHead');
    const unit = this.unitName();
    const message =
      v.cover?.reason === 'ABSENCE'
        ? t('headship.confirm.endCover.messageAbsence', {
            name,
            head: this.personName(v.head?.name ?? null, 'headship.confirm.theHead'),
          })
        : t('headship.confirm.endCover.messageVacancy', { name, unit, unitWithLam: withArabicLam(unit) });
    this.confirm.ask({
      tone: 'destructive',
      header: t('headship.confirm.endCover.header', { name, unit, unitWithLam: withArabicLam(unit) }),
      message,
      acceptLabel: t('headship.confirm.endCover.accept'),
      accept: () => this.send(this.headService.clearActingHead(this.orgUnitId())),
    });
  }
}
