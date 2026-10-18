import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Directionality } from '@angular/cdk/bidi';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { LanguageService } from './language.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { RowMenuComponent, RowMenuItem } from '../../shared/components/row-menu/row-menu.component';
import { OverlaySelectComponent } from '../../shared/components/overlay-select/overlay-select.component';

/**
 * ACC-237 — CDK overlays follow a language switch WITHOUT a reload.
 *
 * The CDK's root Directionality reads <html dir> once, at start-up. Before
 * this, LanguageService changed <html dir> and nothing told the CDK, so a menu
 * or dropdown opened after a switch was placed for the old direction — the row
 * menu 48-60px off its ⋯. The fix keeps the root Directionality current from
 * LanguageService, and the overlay select hands the CDK that object instead of
 * a string frozen when its overlay was first created.
 *
 * Each overlay is opened ONCE in English before the switch, so the opens after
 * it reuse the overlay the CDK already built — the case that was broken. No
 * [dir] sits anywhere in the host: what the overlays read is the root.
 */

const GROUPS: RowMenuItem[][] = [[{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }]];
const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
];

@Component({
  standalone: true,
  imports: [RowMenuComponent, OverlaySelectComponent, ReactiveFormsModule],
  template: `
    <div style="padding: 120px 300px; display: flex; gap: 40px; align-items: flex-start">
      <am-row-menu [groups]="groups" label="Actions for Row" />
      <div style="inline-size: 160px">
        <app-overlay-select [options]="options" [formControl]="control" [panelMinWidth]="320" ariaLabel="Pick one" />
      </div>
    </div>
  `,
})
class HostComponent {
  readonly groups = GROUPS;
  readonly options = OPTIONS;
  readonly control = new FormControl<string | null>(null);
}

describe('CDK overlays follow a language switch without a reload (ACC-237)', () => {
  let fixture: ComponentFixture<HostComponent>;

  preserveDocumentLanguage();

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'en' }), providePrimeNG({})],
    });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(LanguageService);
    document.documentElement.style.overflow = 'hidden';
    fixture = TestBed.createComponent(HostComponent);
    (fixture.nativeElement as HTMLElement).style.cssText = 'position: fixed; inset-block-start: 0; inset-inline-start: 0; display: block';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.documentElement.style.overflow = '';
    fixture?.nativeElement.remove();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
  });

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 40));
    fixture.detectChanges();
  };

  /** The switch the app makes — LanguageService, no reload, no new component. */
  async function switchTo(lang: 'en' | 'ar'): Promise<void> {
    TestBed.inject(LanguageService).use(lang);
    TestBed.tick();
    await settle();
  }

  const rowTrigger = () => document.querySelector<HTMLElement>('[data-testid="row-menu-trigger"]')!;
  const rowMenu = () => document.querySelector<HTMLElement>('[data-testid="row-menu"]');
  const selectTrigger = () => document.querySelector<HTMLElement>('.am-overlay-select-trigger')!;
  const selectPanel = () => document.querySelector<HTMLElement>('.am-overlay-select-panel');
  /** The dir the CDK wrote on the overlay's host (_updateElementDirection). */
  const overlayDir = (inside: HTMLElement) => inside.closest('.cdk-overlay-pane')?.parentElement?.getAttribute('dir');

  async function openRowMenu(): Promise<{ menu: DOMRect; trigger: DOMRect; dir: string | null | undefined }> {
    rowTrigger().click();
    await settle();
    const menu = rowMenu();
    expect(menu).withContext('the row menu opened').not.toBeNull();
    const result = { menu: menu!.getBoundingClientRect(), trigger: rowTrigger().getBoundingClientRect(), dir: overlayDir(menu!) };
    rowTrigger().click();
    await settle();
    expect(rowMenu()).withContext('the row menu closed').toBeNull();
    return result;
  }

  async function openSelect(): Promise<{ panel: DOMRect; trigger: DOMRect; dir: string | null | undefined }> {
    selectTrigger().click();
    await settle();
    const panel = selectPanel();
    expect(panel).withContext('the select opened').not.toBeNull();
    const result = { panel: panel!.getBoundingClientRect(), trigger: selectTrigger().getBoundingClientRect(), dir: overlayDir(panel!) };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    (document.querySelector('.cdk-overlay-backdrop') as HTMLElement | null)?.click();
    await settle();
    return result;
  }

  it('English, then Arabic, then English again: each overlay opens against its trigger', async () => {
    const root = TestBed.inject(Directionality);
    expect(root.value).toBe('ltr');

    // ── English first: this builds both overlays ────────────────────────────
    let row = await openRowMenu();
    let sel = await openSelect();
    // NON-VACUITY: both are wider than their trigger, so start and end differ.
    expect(row.menu.width).toBeGreaterThan(row.trigger.width + 20);
    expect(sel.panel.width).toBeGreaterThan(sel.trigger.width + 20);
    expect(row.dir).toBe('ltr');
    expect(sel.dir).toBe('ltr');
    expect(Math.abs(row.menu.right - row.trigger.right)).withContext('row menu: end = right edge').toBeLessThanOrEqual(2);
    expect(Math.abs(sel.panel.left - sel.trigger.left)).withContext('select: start = left edge').toBeLessThanOrEqual(2);

    // ── Arabic, without a reload ────────────────────────────────────────────
    await switchTo('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(root.value).withContext('the root Directionality followed').toBe('rtl');

    row = await openRowMenu();
    sel = await openSelect();
    expect(row.dir).withContext('row menu overlay dir').toBe('rtl');
    expect(sel.dir).withContext('select overlay dir').toBe('rtl');
    expect(Math.abs(row.menu.left - row.trigger.left))
      .withContext(`row menu: end = left edge (menu ${row.menu.left}-${row.menu.right}, ⋯ ${row.trigger.left}-${row.trigger.right})`)
      .toBeLessThanOrEqual(2);
    expect(Math.abs(sel.panel.right - sel.trigger.right))
      .withContext(`select: start = right edge (panel ${sel.panel.left}-${sel.panel.right}, trigger ${sel.trigger.left}-${sel.trigger.right})`)
      .toBeLessThanOrEqual(2);

    // ── And back to English ─────────────────────────────────────────────────
    await switchTo('en');
    expect(root.value).toBe('ltr');
    row = await openRowMenu();
    sel = await openSelect();
    expect(row.dir).toBe('ltr');
    expect(sel.dir).toBe('ltr');
    expect(Math.abs(row.menu.right - row.trigger.right)).toBeLessThanOrEqual(2);
    expect(Math.abs(sel.panel.left - sel.trigger.left)).toBeLessThanOrEqual(2);
  });

  it('emits change once per real switch, never for the same direction', async () => {
    const root = TestBed.inject(Directionality);
    const seen: string[] = [];
    const sub = root.change.subscribe((d) => seen.push(d));
    await switchTo('ar');
    await switchTo('ar');
    await switchTo('en');
    sub.unsubscribe();
    expect(seen).toEqual(['rtl', 'ltr']);
  });
});
