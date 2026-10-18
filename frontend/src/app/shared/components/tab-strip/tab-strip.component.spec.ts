import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { TabStripComponent, TabStripItem } from './tab-strip.component';

// ACC-238 — the tab strip a tabbed dialog draws in its header: a WAI-ARIA
// tablist, one tab stop, arrows that follow reading direction, and "⚠ n" on a
// tab holding problems, named for a screen reader as well as drawn.

@Component({
  standalone: true,
  imports: [TabStripComponent],
  template: `<am-tab-strip [tabs]="tabs()" [selected]="selected()" (selectedChange)="selected.set($event)" ariaLabel="Committee details" idPrefix="t" />`,
})
class HostComponent {
  readonly tabs = signal<readonly TabStripItem[]>([
    { id: 'identity', key: 'committee.form.tab.identity' },
    { id: 'governance', key: 'committee.form.tab.governance' },
    { id: 'structure', key: 'committee.form.tab.structure', errors: 2 },
  ]);
  readonly selected = signal('identity');
}

describe('TabStripComponent (ACC-238)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HostComponent>;

  function render(language: 'en' | 'ar' = 'en'): HTMLElement {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const tabs = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]'));
  const press = (el: HTMLElement, key: string) => {
    el.querySelector('[role="tablist"]')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    fixture.detectChanges();
  };

  it('is a labelled tablist; the selected tab is the one tab stop and names its panel', () => {
    const el = render();
    expect(el.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Committee details');
    const [first, second] = tabs(el);
    expect(first!.getAttribute('aria-selected')).toBe('true');
    expect(first!.tabIndex).toBe(0);
    expect(second!.getAttribute('aria-selected')).toBe('false');
    expect(second!.tabIndex).toBe(-1);
    expect(first!.id).toBe('t-tab-identity');
    expect(first!.getAttribute('aria-controls')).toBe('t-panel-identity');
    expect(tabs(el).map((t) => t.querySelector('span')!.textContent!.trim())).toEqual(['Identity', 'Governance', 'Structure']);
  });

  it('a click selects a tab', () => {
    const el = render();
    tabs(el)[1]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toBe('governance');
  });

  it('the arrows move and select in reading order, wrapping; Home and End go to the ends', () => {
    const el = render();
    press(el, 'ArrowRight');
    expect(fixture.componentInstance.selected()).toBe('governance');
    press(el, 'End');
    expect(fixture.componentInstance.selected()).toBe('structure');
    press(el, 'ArrowRight');
    expect(fixture.componentInstance.selected()).toBe('identity');
    press(el, 'ArrowLeft');
    expect(fixture.componentInstance.selected()).toBe('structure');
    press(el, 'Home');
    expect(fixture.componentInstance.selected()).toBe('identity');
  });

  it('in Arabic the left arrow is "next"', () => {
    const el = render('ar');
    press(el, 'ArrowLeft');
    expect(fixture.componentInstance.selected()).toBe('governance');
    press(el, 'ArrowRight');
    expect(fixture.componentInstance.selected()).toBe('identity');
  });

  it('a tab with problems shows "⚠ n" and says how many, in both languages', () => {
    let el = render();
    const structure = tabs(el)[2]!;
    expect(structure.querySelector('[data-tab-errors]')?.textContent?.trim()).toBe('⚠ 2');
    expect(structure.querySelector('.sr-only')?.textContent?.trim()).toBe('2 problems');
    TestBed.resetTestingModule();
    el = render('ar');
    expect(tabs(el)[2]!.querySelector('.sr-only')?.textContent?.trim()).toBe('مشكلتان');
  });

  it('renders nothing for fewer than two tabs', () => {
    const el = render();
    fixture.componentInstance.tabs.set([{ id: 'only', key: 'committee.form.tab.identity' }]);
    fixture.detectChanges();
    expect(el.querySelector('[role="tablist"]')).toBeNull();
  });
});
