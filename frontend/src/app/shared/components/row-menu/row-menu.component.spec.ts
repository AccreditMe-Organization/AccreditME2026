import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { RowMenuComponent, RowMenuItem } from './row-menu.component';

// ACC-235 — the two things am-row-menu's reposition strategy needed, both
// measured on /roles and /users:
// - it follows its row when a container scrolls (<main>, a dialog body), not
//   only when the document does;
// - in an Arabic session it aligns to its ⋯'s end, which is the LEFT edge.

const GROUPS: RowMenuItem[][] = [[{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }]];

@Component({
  standalone: true,
  imports: [RowMenuComponent],
  template: `
    <div id="scroller" style="block-size: 300px; overflow: auto; inline-size: 500px; position: relative">
      <div style="block-size: 900px; padding-block-start: 80px; padding-inline: 200px">
        <am-row-menu [groups]="groups" label="Actions for Row" />
      </div>
    </div>
  `,
})
class HostComponent {
  readonly groups = GROUPS;
}

describe('am-row-menu — follows its row, and aligns in either direction (ACC-235)', () => {
  let fixture: ComponentFixture<HostComponent>;

  preserveDocumentLanguage();

  function render(lang: 'en' | 'ar'): void {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'en' })],
    });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(LanguageService).use(lang);
    // The app's page never scrolls; a test page's scrollbar would shift CDK's
    // right-to-left placement by its own width.
    document.documentElement.style.overflow = 'hidden';
    fixture = TestBed.createComponent(HostComponent);
    // Pinned to the window's top: earlier specs can leave the test page long
    // enough to put the ⋯ below the window, and CDK then pulls the menu back
    // into view away from it.
    (fixture.nativeElement as HTMLElement).style.cssText = 'position: fixed; inset-block-start: 0; inset-inline-start: 0; display: block';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }

  afterEach(() => {
    document.documentElement.style.overflow = '';
    fixture?.nativeElement.remove();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
  });

  const trigger = () => document.querySelector<HTMLButtonElement>('[data-testid="row-menu-trigger"]')!;
  const menu = () => document.querySelector<HTMLElement>('[data-testid="row-menu"]');
  const settle = () => new Promise((r) => setTimeout(r, 60));

  it('when the container it sits in scrolls, the menu moves with its ⋯', async () => {
    render('en');
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(menu()).withContext('the menu opened').not.toBeNull();
    const gap = () => menu()!.getBoundingClientRect().top - trigger().getBoundingClientRect().bottom;
    const before = gap();
    const triggerTop = trigger().getBoundingClientRect().top;
    const scroller = document.getElementById('scroller')!;
    scroller.scrollTop = 40;
    scroller.dispatchEvent(new Event('scroll'));
    await settle();
    // Non-vacuity: the ⋯ really moved, so a fixed menu would now be 40px off.
    expect(triggerTop - trigger().getBoundingClientRect().top).withContext('the ⋯ moved').toBeCloseTo(40, 0);
    expect(gap()).withContext('the menu kept its place under the ⋯').toBeCloseTo(before, 0);
  });

  it('closing it stops listening to the container', async () => {
    render('en');
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(menu()).toBeNull();
    const scroller = document.getElementById('scroller')!;
    expect(() => {
      scroller.scrollTop = 30;
      scroller.dispatchEvent(new Event('scroll'));
    }).not.toThrow();
  });

  for (const lang of ['en', 'ar'] as const) {
    it(`opens under its ⋯ and aligned to its end (${lang})`, async () => {
      render(lang);
      trigger().click();
      fixture.detectChanges();
      await fixture.whenStable();
      const t = trigger().getBoundingClientRect();
      const r = menu()!.getBoundingClientRect();
      expect(r.width).withContext('the menu is laid out').toBeGreaterThan(t.width);
      expect(r.top).withContext('below the ⋯').toBeGreaterThanOrEqual(t.bottom - 1);
      // The end is the right edge in English and the left edge in Arabic.
      const endGap = lang === 'ar' ? Math.abs(r.left - t.left) : Math.abs(r.right - t.right);
      expect(endGap).withContext(`aligned to the ⋯'s end (menu ${r.left}-${r.right}, ⋯ ${t.left}-${t.right})`).toBeLessThanOrEqual(2);
    });
  }
});

// ACC-120 slice 11 — two opt-in additions the org tree needs: a heading per
// group, and an event when the menu opens.
@Component({
  standalone: true,
  imports: [RowMenuComponent],
  template: `<am-row-menu [groups]="groups" [groupLabels]="labels" label="Actions for Pharmacy" (openedChange)="events.push($event)" />`,
})
class LabelledHostComponent {
  readonly groups: RowMenuItem[][] = [[{ id: 'edit', label: 'Edit' }], [{ id: 'vacate', label: 'Vacate' }]];
  labels: (string | null)[] = [null, 'Headship'];
  readonly events: boolean[] = [];
}

describe('am-row-menu — group headings and the opened event (ACC-120 slice 11)', () => {
  let fixture: ComponentFixture<LabelledHostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [LabelledHostComponent], providers: [provideTranslateService({ lang: 'en' })] });
    fixture = TestBed.createComponent(LabelledHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
  });

  const open = () => {
    (fixture.nativeElement.querySelector('[data-testid="row-menu-trigger"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('draws a heading only where one is given, and never as an item', () => {
    open();
    const headings = Array.from(document.querySelectorAll('[data-testid="row-menu-heading"]')).map((h) => h.textContent!.trim());
    expect(headings).toEqual(['Headship']);
    const items = Array.from(document.querySelectorAll('[cdkMenuItem], .am-row-menu__item')).map((i) => i.textContent!.trim());
    expect(items).toEqual(['Edit', 'Vacate']);
  });

  it('without groupLabels, no heading renders', () => {
    fixture.componentInstance.labels = [];
    fixture.detectChanges();
    open();
    expect(document.querySelectorAll('[data-testid="row-menu-heading"]').length).toBe(0);
  });

  it('says when it opens and when it closes', () => {
    open();
    expect(fixture.componentInstance.events).toEqual([true]);
    open(); // a second press on the ⋯ closes it
    expect(fixture.componentInstance.events).toEqual([true, false]);
  });
});
