import { ApplicationRef, ComponentRef, EnvironmentInjector, Injectable, createComponent, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import { FileViewerComponent } from './file-viewer.component';
import { IFileViewerRequest } from './file-viewer.model';

/**
 * ACC-189 — opens the in-app file viewer. ONE viewer at a time: opening
 * another closes the first. A host calls `open()` with its files, its view
 * mint and its download; nothing is placed in the host's template, so task
 * evidence, meeting attachments and document lists all open it the same way.
 *
 * The viewer lives at the application level, not inside the host, so a host
 * list that reloads underneath it does not tear it down. It closes on any
 * navigation (the browser's Back button still works while the page behind is
 * inert). There is no deep link: opening it never changes the URL.
 */
@Injectable({ providedIn: 'root' })
export class FileViewerService {
  private readonly appRef = inject(ApplicationRef);
  private readonly environment = inject(EnvironmentInjector);
  private readonly document = inject(DOCUMENT);
  private current: ComponentRef<FileViewerComponent> | null = null;

  constructor() {
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationStart))
      .subscribe(() => this.current?.instance.close());
  }

  open(request: IFileViewerRequest): void {
    if (request.files.length === 0) return;
    this.destroyCurrent();
    const ref = createComponent(FileViewerComponent, { environmentInjector: this.environment });
    ref.setInput('request', request);
    ref.instance.closed.subscribe((last) => {
      this.destroy(ref);
      request.closed?.(last);
    });
    this.appRef.attachView(ref.hostView);
    this.document.body.appendChild(ref.location.nativeElement as HTMLElement);
    this.current = ref;
  }

  /** Whether a viewer is open — for hosts and tests. */
  isOpen(): boolean {
    return this.current !== null;
  }

  private destroyCurrent(): void {
    if (this.current) this.destroy(this.current);
  }

  private destroy(ref: ComponentRef<FileViewerComponent>): void {
    if (this.current === ref) this.current = null;
    this.appRef.detachView(ref.hostView);
    ref.destroy();
  }
}
