import { Injectable, inject, signal } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { TaskService, AssignableUnitDto, CommitteeRoleCatalogueDto } from '../../../tasks/services/task.service';
import { OrgPositionService, IOrgPositionDto } from '../../../org-position/services/org-position.service';

/**
 * ACC-271 PR 5a — the lists the stage editor's "Who works this stage" picks
 * from, loaded TOGETHER when the panel first opens and kept for the page
 * (provided by the stages page, so switching stages reads nothing again):
 *
 *   - the units (the task assignment picker's units; workflows:manage reaches it, ACC-208),
 *   - the position catalogue,
 *   - the committee member roles (one lookup for every committee; the role
 *     filter needs its labels, not a committee's counts).
 *
 * People and committees are NOT here: they are searched and paged on the server
 * (who-options), because either list can be long. A Fixed position row's
 * holder count for a draft is read per unit on demand — one read per unit,
 * shared by every row naming it — and a saved row uses the template read's own
 * holderCount, so the panel makes no call per row.
 *
 * A failed list reads as empty: the row's select then has nothing to offer,
 * and the save's own refusal still says what is missing.
 */
@Injectable()
export class StageWhoOptionsStore {
  private readonly tasks = inject(TaskService);
  private readonly positionService = inject(OrgPositionService);

  readonly units = signal<AssignableUnitDto[]>([]);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly roles = signal<CommitteeRoleCatalogueDto[]>([]);
  readonly loaded = signal(false);

  private requested = false;
  private readonly holdersByUnit = new Map<string, Observable<Map<string, number> | null>>();

  /** Loads the three lists once for the page; later calls do nothing. */
  ensureLoaded(): void {
    if (this.requested) return;
    this.requested = true;
    forkJoin({
      units: this.tasks.getAssignableUnits().pipe(catchError(() => of([] as AssignableUnitDto[]))),
      positions: this.positionService.listPositions().pipe(catchError(() => of([] as IOrgPositionDto[]))),
      roles: this.tasks.getCommitteeRoleCatalogue().pipe(catchError(() => of([] as CommitteeRoleCatalogueDto[]))),
    }).subscribe(({ units, positions, roles }) => {
      this.units.set(units);
      this.positions.set(positions);
      this.roles.set(roles);
      this.loaded.set(true);
    });
  }

  /**
   * How many hold `positionId` with `orgUnitId` as their primary unit, or null
   * when it could not be read (no warning is better than a wrong one).
   */
  holderCount(orgUnitId: string, positionId: string): Observable<number | null> {
    let unit$ = this.holdersByUnit.get(orgUnitId);
    if (!unit$) {
      unit$ = this.tasks.getAssignablePositions(orgUnitId).pipe(
        map((rows) => new Map(rows.map((r) => [r.id, r.holderCount]))),
        catchError(() => of(null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.holdersByUnit.set(orgUnitId, unit$);
    }
    return unit$.pipe(map((counts) => (counts ? (counts.get(positionId) ?? 0) : null)));
  }
}
