// ACC-38 — mirrors edit-dialog.component.spec.ts's "scroll-boundary wheel
// guard" tests exactly: AppShellComponent.onWheel() extends the identical
// EditDialogComponent mitigation to app-shell's own scrollable <main>,
// since it is a second scrollable ancestor of every routed page's
// p-select/p-multiselect overlays, not just a dialog's own scroll area.
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { AppShellComponent } from './app-shell.component';

function makeListContainer(
  cls: string,
  { scrollTop, clientHeight, scrollHeight }: { scrollTop: number; clientHeight: number; scrollHeight: number },
): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  return el;
}

function fireWheel(shell: AppShellComponent, target: HTMLElement, deltaY: number): boolean {
  const event = new WheelEvent('wheel', { deltaY, cancelable: true });
  Object.defineProperty(event, 'target', { value: target, configurable: true });
  shell.onWheel(event);
  return event.defaultPrevented;
}

describe('AppShellComponent scroll-boundary wheel guard (ACC-38)', () => {
  let shell: AppShellComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        ConfirmationService,
      ],
    });
    // Deliberately not calling detectChanges() -- onWheel() is a pure
    // method independent of the child component tree (topbar/sidebar/
    // breadcrumb/router-outlet) rendering or ngOnInit's navigation-access
    // load firing, matching how EditDialogComponent's own wheel-guard
    // spec tests it directly against the component instance.
    shell = TestBed.createComponent(AppShellComponent).componentInstance;
  });

  it('ignores wheel events whose target is outside any listbox container', () => {
    const outsider = document.createElement('div');
    expect(fireWheel(shell, outsider, 100)).toBe(false);
  });

  it('does NOT preventDefault mid-list (not yet at either boundary)', () => {
    const list = makeListContainer('p-select-list-container', {
      scrollTop: 29,
      clientHeight: 200,
      scrollHeight: 258,
    });
    expect(fireWheel(shell, list, 120)).toBe(false);
    expect(fireWheel(shell, list, -120)).toBe(false);
  });

  it('preventDefaults scrolling further down once genuinely at the bottom boundary', () => {
    const list = makeListContainer('p-select-list-container', {
      scrollTop: 58,
      clientHeight: 200,
      scrollHeight: 258,
    });
    expect(fireWheel(shell, list, 120)).toBe(true);
  });

  it('preventDefaults scrolling further up once genuinely at the top boundary', () => {
    const list = makeListContainer('p-multiselect-list-container', {
      scrollTop: 0,
      clientHeight: 200,
      scrollHeight: 258,
    });
    expect(fireWheel(shell, list, -120)).toBe(true);
  });

  it('does NOT preventDefault scrolling down from the top boundary -- only the opposite direction is blocked there', () => {
    const list = makeListContainer('p-select-list-container', {
      scrollTop: 0,
      clientHeight: 200,
      scrollHeight: 258,
    });
    expect(fireWheel(shell, list, 120)).toBe(false);
  });

  it('covers both p-select and p-multiselect list-container class names', () => {
    const selectList = makeListContainer('p-select-list-container', {
      scrollTop: 0,
      clientHeight: 200,
      scrollHeight: 400,
    });
    const multiList = makeListContainer('p-multiselect-list-container', {
      scrollTop: 0,
      clientHeight: 200,
      scrollHeight: 400,
    });
    expect(fireWheel(shell, selectList, -50)).toBe(true);
    expect(fireWheel(shell, multiList, -50)).toBe(true);
  });
});
