import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * ACC-279 — "something the person did may have changed one of their work counts".
 *
 * The services that make those changes (complete, pick up, decide, approve…) say
 * so here once their request succeeds, and MyWorkCountsService listens and reloads.
 * It is its own tiny service so TaskService and the others depend on nothing but
 * this: the counts service reads TaskService, so a direct dependency the other way
 * would be a cycle.
 *
 * There is no timer anywhere: a count changes when the person acts, when Home
 * opens, and at sign-in, never by polling.
 */
@Injectable({ providedIn: 'root' })
export class MyWorkEvents {
  private readonly subject = new Subject<void>();
  readonly changes$: Observable<void> = this.subject.asObservable();

  changed(): void {
    this.subject.next();
  }
}
