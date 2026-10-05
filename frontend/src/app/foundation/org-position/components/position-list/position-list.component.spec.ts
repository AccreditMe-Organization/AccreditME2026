import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Subject, of } from 'rxjs';
import { PositionListComponent } from './position-list.component';
import { OrgPositionService, IOrgPositionDto } from '../../services/org-position.service';
import { RoleService } from '../../../roles/services/role.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

// ACC-120 slice 6 — the org positions screen.
//
// NEW FILE. The screen had no spec, which is why nothing caught the defect the
// first two tests below pin: the list rendered its genuinely-empty state while
// the request was still in flight.
// ACC-160 — `over` was accepted and never applied, so position({ id: 'p2' })
// silently returned p1 again. Nothing passed it until now; it does now.
const position = (over: Partial<IOrgPositionDto> = {}): IOrgPositionDto =>
  ({
    id: 'p1',
    organizationId: 'org-1',
    nameEn: 'Unit Head',
    nameAr: 'رئيس وحدة',
    grade: 6,
    isSingleAssignee: true,
    isUnitHeadPosition: true,
    roleId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as IOrgPositionDto;

describe('PositionListComponent (ACC-120)', () => {
  let fixture: ComponentFixture<PositionListComponent>;
  let component: PositionListComponent;
  let deactivate: jasmine.Spy;
  let confirmed: (() => void) | null;

  function render(held: string[], list$: { subscribe: unknown } = of([position()])) {
    confirmed = null;
    deactivate = jasmine.createSpy('deactivate').and.returnValue(of(undefined));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PositionListComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        {
          provide: ConfirmationService,
          useValue: { confirm: (o: { accept: () => void }) => (confirmed = o.accept) },
        },
        {
          provide: OrgPositionService,
          useValue: {
            listPositions: () => list$,
            deactivate,
            reactivate: () => of(undefined),
          },
        },
        { provide: RoleService, useValue: { listAllRoles: () => of([]) } },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => held.includes(p) },
        },
      ],
    });
    fixture = TestBed.createComponent(PositionListComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
    return fixture;
  }

  const html = (): string => (fixture.nativeElement as HTMLElement).innerHTML;
  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  // ── THE DEFECT THIS FILE EXISTS FOR ───────────────────────────────────────
  //
  // clientSideSource() resolves synchronously, so wiring it straight to a signal
  // that had not loaded made the list draw "no positions defined yet" for the
  // two seconds before the request returned. An admin who believes there are
  // none creates a duplicate.
  describe('while the first request is in flight', () => {
    it('shows a skeleton, not the empty state', fakeAsync(() => {
      const pending = new Subject<IOrgPositionDto[]>();
      render(['positions:manage'], pending);
      // The list debounces its query before subscribing, so the pending state
      // only exists after that timer. tick() alone lands before it.
      tick(500);
      fixture.detectChanges();

      expect(html()).toContain('am-skeleton-bar');
      expect(text()).not.toContain('orgPosition.noPositions');

      pending.next([position()]);
      pending.complete();
      tick();
      fixture.detectChanges();

      expect(html()).not.toContain('am-skeleton-bar');
      expect(text()).toContain('Unit Head');
    }));

    it('reaches the empty state only once an empty result has actually arrived', fakeAsync(() => {
      const pending = new Subject<IOrgPositionDto[]>();
      render(['positions:manage'], pending);
      tick(500);
      pending.next([]);
      pending.complete();
      tick();
      fixture.detectChanges();

      expect(text()).toContain('orgPosition.noPositions');
    }));
  });

  // ── permissions ───────────────────────────────────────────────────────────
  describe('with positions:manage', () => {
    it('offers Add Position', () => {
      render(['positions:manage']);
      expect(text()).toContain('orgPosition.addPosition');
    });

    it('offers the row actions, named after the position', () => {
      render(['positions:manage']);
      const labels = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).map((b) => b.getAttribute('aria-label') ?? '');
      expect(labels.some((l) => l.startsWith('orgPosition.editFor'))).toBe(true);
      expect(labels.some((l) => l.startsWith('orgPosition.deactivateFor'))).toBe(true);
    });
  });

  describe('with positions:view only', () => {
    // Proved in a browser against READ_ONLY_ADMIN, who gets no write control
    // here at all; pinned so the next change cannot drop it.
    it('offers no create and no row actions', () => {
      render(['positions:view']);
      expect(text()).not.toContain('orgPosition.addPosition');
      const labels = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).map((b) => b.getAttribute('aria-label') ?? '');
      expect(labels.filter((l) => l.startsWith('orgPosition.'))).toEqual([]);
    });

    it('still lists the positions, which is what the screen is for', () => {
      render(['positions:view']);
      expect(text()).toContain('Unit Head');
    });
  });

  // ── deactivate asks, in the reader's language ─────────────────────────────
  it('raises a translated confirmation before deactivating', () => {
    render(['positions:manage']);
    component.onDeactivate(position());
    expect(confirmed).not.toBeNull();
    expect(deactivate).not.toHaveBeenCalled();
    confirmed!();
    expect(deactivate).toHaveBeenCalledWith('p1');
  });

  // ACC-160 — a dedicated Arabic-name slot in a list shows "—" when there is
  // no Arabic name, rather than a blank cell. Not the English name: that slot's
  // job is to report the Arabic one, and an English name there would lie.
  // GUARD FIRST: a list whose records all have Arabic names shows no "—" at all,
  // so the dash in the null case can only have come from that cell.
  describe('the Arabic-name column (ACC-160)', () => {
    const slots = (): string[] => arabicSlots(fixture.nativeElement as HTMLElement);

    it('shows the Arabic name, and no dash, while every position has one', () => {
      render(['org:view']);
      expect(slots()).toContain('رئيس وحدة');
      expect(slots()).not.toContain('—');
    });

    it('shows "—" for a position with no Arabic name, not a blank', () => {
      render(['org:view'], of([position(), position({ id: 'p2', nameEn: 'Charge Nurse', nameAr: null })]));
      expect(slots()).toContain('رئيس وحدة');
      expect(slots()).toContain('—');
      expect(slots()).not.toContain('');
    });
  });
});

// Reads the Arabic-name SLOTS themselves (dir="rtl"), not the page: a page can
// show "—" elsewhere — the stage list's empty SLA column does — and a whole-page
// assertion would then pass or fail for a reason that has nothing to do with
// the Arabic name. That is exactly how this test's first draft went wrong.
const arabicSlots = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('[dir="rtl"]')).map((e) => (e.textContent ?? '').trim());
