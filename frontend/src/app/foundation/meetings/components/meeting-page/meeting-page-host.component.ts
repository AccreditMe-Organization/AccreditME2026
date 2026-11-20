import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MeetingPageComponent } from './meeting-page.component';

/**
 * ACC-316 PR 8b — /meetings/:id. A series' previous and next links open the
 * same route with another id, and Angular then REUSES the page component, which
 * reads its id once and keeps that meeting's state (its minutes, its open
 * dialogs, its write order). So the page is built inside a block keyed by the
 * id: another id is a new page, as if opened from the list. The page itself
 * is unchanged and still reads the route's id.
 */
@Component({
  selector: 'app-meeting-page-host',
  standalone: true,
  imports: [MeetingPageComponent],
  template: `
    @for (id of [id()]; track id) {
      <app-meeting-page />
    }
  `,
})
export class MeetingPageHostComponent {
  private readonly route = inject(ActivatedRoute);
  readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), { initialValue: this.route.snapshot.paramMap.get('id') });
}
