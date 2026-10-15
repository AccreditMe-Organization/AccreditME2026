import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AuthService } from '../../../../core/services/auth.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { SimpleListComponent } from '../../../../shared/components/simple-list/simple-list.component';
import { CommitteeMembersPanelComponent } from './committee-members-panel.component';
import { CommitteeSubCommitteesPanelComponent } from '../committee-sub-committees-panel/committee-sub-committees-panel.component';
import { memberRow, subRow } from './committee-members-panel.component.spec';

// ACC-230 — the Members and Sub-committees panels, and the plain list behind
// their See all, MEASURED in both languages, in the real theme and font:
//
//   - each panel's body is EXACTLY 294px English / 328px Arabic with 0, 3, 5
//     and 12 rows, and never overflows — the same as the Tasks panel beside it;
//     header 42/46, rows 52/58, footer 34/38;
//   - a long name and a long seat do not change a row's height;
//   - the popup body at 720 × 560 (less the dialog's own header): the toolbar
//     and footer stay put and ONLY the list scrolls; rows are at least 44;
//   - at a phone's width the rows are cards of at least 60 / 64, with no
//     column header and nothing scrolling sideways.
//
// NON-VACUITY FIRST (ACC-120).

const API = `${environment.apiUrl}/committees/c-1`;
const LONG_NAME = 'Dr. Abdulrahman bin Abdulaziz Al-Qahtani Al-Shahrani';
const LONG_SEAT = { en: 'Deputy Chair for Infection Prevention and Antimicrobial Stewardship', ar: 'نائب الرئيس لشؤون الوقاية من العدوى والإشراف على مضادات الميكروبات' };
const EXPECT = { en: { head: 42, body: 294, row: 52, foot: 34, dialogHead: 64 }, ar: { head: 46, body: 328, row: 58, foot: 38, dialogHead: 68 } };

@Component({
  standalone: true,
  imports: [CommitteeMembersPanelComponent, CommitteeSubCommitteesPanelComponent],
  template: `<div class="grid gap-3" [style.width.px]="width()" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))">
    <app-committee-members-panel committeeId="c-1" committeeName="Q" [canAddMember]="true" [canChangeRole]="true" [canRemove]="true" />
    <app-committee-sub-committees-panel committeeId="c-1" committeeName="Q" />
  </div>`,
})
class PanelsHost {
  readonly width = input(820);
}

@Component({
  standalone: true,
  imports: [SimpleListComponent],
  template: `<ng-template #cells let-m>
      <span class="truncate">{{ m.name }}</span><span class="truncate">{{ m.roleLabelEn }}</span><span>{{ m.joinedAt }}</span><span></span>
    </ng-template>
    <div class="flex flex-col" [style.width.px]="width()" [style.height.px]="height()">
      <am-simple-list
        [load]="load"
        [columns]="[{ label: 'Member' }, { label: 'Seat' }, { label: 'Since' }, { label: '' }]"
        grid="minmax(200px,1.6fr) minmax(120px,1fr) 120px 32px"
        [row]="cells"
        [sortOptions]="[{ value: 'seat:asc', label: 'By seat' }]"
        defaultSort="seat:asc"
        searchLabel="Search members"
        [countText]="count"
      />
    </div>`,
})
class ListHost {
  readonly width = input(720);
  readonly height = input(560 - 64);
  readonly load = () => of({ items: Array.from({ length: 40 }, (_, i) => memberRow(i + 1)), total: 40, matching: 40 });
  readonly count = (n: number) => `${n} members`;
}

describe('Committee Members and Sub-committees — layout, measured (ACC-230)', () => {
  preserveDocumentLanguage();
  const measured: string[] = [];
  let http: HttpTestingController;

  afterAll(() => console.log(`ACC-230 measurements:\n  ${measured.join('\n  ')}`));

  function configure(language: 'en' | 'ar'): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PanelsHost, ListHost],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    http = TestBed.inject(HttpTestingController);
  }

  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    await fixture.whenStable();
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  for (const language of ['en', 'ar'] as const) {
    describe(language === 'en' ? 'English' : 'Arabic', () => {
      const want = EXPECT[language];

      for (const count of [0, 3, 5, 12]) {
        it(`both panels' bodies are exactly ${want.body}px with ${count} rows, and never overflow`, async () => {
          configure(language);
          const fixture = TestBed.createComponent(PanelsHost);
          fixture.autoDetectChanges(true);
          document.body.appendChild(fixture.nativeElement);
          const shown = Math.min(count, 5);
          const members = Array.from({ length: shown }, (_, i) =>
            memberRow(i + 1, i === 0 ? { name: LONG_NAME, roleLabelEn: LONG_SEAT.en, roleLabelAr: LONG_SEAT.ar } : {}),
          );
          const subs = Array.from({ length: shown }, (_, i) => subRow(i + 1, i === 0 ? { nameEn: LONG_NAME, nameAr: LONG_SEAT.ar } : {}));
          http.expectOne((r) => r.url === `${API}/members/page`).flush({ items: members, total: count, matching: count });
          http.expectOne((r) => r.url === `${API}/sub-committees`).flush({ items: subs, total: count, matching: count });
          await settle(fixture);

          const el = fixture.nativeElement as HTMLElement;
          expect(document.fonts.check('13px "IBM Plex Sans Arabic"')).withContext('measured in a fallback font').toBe(true);
          for (const prefix of ['committee-members', 'committee-subs']) {
            const head = el.querySelector<HTMLElement>(`[data-testid="${prefix}-head"]`)!;
            const body = el.querySelector<HTMLElement>(`[data-testid="${prefix}-body"]`)!;
            expect(head.getBoundingClientRect().height).withContext(`${prefix}: not laid out`).toBeGreaterThan(0);
            const rows = Array.from(body.querySelectorAll<HTMLElement>('li.am-cp-row'));
            expect(rows.length).withContext(`${prefix}: rows rendered`).toBe(shown);
            measured.push(`${language} ${prefix}, ${count} rows: header ${head.getBoundingClientRect().height}, body ${body.getBoundingClientRect().height}`);
            expect(head.getBoundingClientRect().height).withContext(`${prefix} header`).toBe(want.head);
            expect(body.getBoundingClientRect().height).withContext(`${prefix} body`).toBe(want.body);
            expect(body.scrollHeight).withContext(`${prefix} overflows`).toBeLessThanOrEqual(body.clientHeight);
            for (const row of rows) expect(row.getBoundingClientRect().height).withContext(`${prefix} row`).toBe(want.row);
            const foot = el.querySelector<HTMLElement>(`[data-testid="${prefix}-foot"]`);
            if (count > 5) {
              expect(foot!.getBoundingClientRect().height).toBe(want.foot);
              expect(foot!.getBoundingClientRect().bottom).toBe(body.getBoundingClientRect().bottom);
            } else {
              expect(foot).toBeNull();
            }
          }
          fixture.nativeElement.remove();
        });
      }

      it('the See all list at 720 × 560: only the list scrolls; rows at least 44', async () => {
        configure(language);
        const fixture = TestBed.createComponent(ListHost);
        fixture.componentRef.setInput('height', 560 - want.dialogHead);
        document.body.appendChild(fixture.nativeElement);
        fixture.autoDetectChanges(true);
        const list = fixture.debugElement.query((d) => d.componentInstance instanceof SimpleListComponent)!
          .componentInstance as SimpleListComponent<{ id: string }>;
        list.phone.set(false);
        await settle(fixture);
        const el = fixture.nativeElement as HTMLElement;
        const part = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
        const scroll = part('simple-list-scroll');
        expect(el.querySelectorAll('[data-testid="simple-list-row"]').length).withContext('rows rendered').toBe(40);
        const toolbar = el.querySelector<HTMLElement>('.am-sl__toolbar')!;
        const h = (n: HTMLElement) => Math.round(n.getBoundingClientRect().height);
        measured.push(`${language} See all at 720 × ${560 - want.dialogHead}: toolbar ${h(toolbar)}, column header ${h(part('simple-list-head'))}, list ${h(scroll)}, footer ${h(part('simple-list-foot'))}`);
        const scrollers = Array.from(el.querySelectorAll<HTMLElement>('*')).filter(
          (n) => n.scrollHeight > n.clientHeight + 1 && !['visible', 'hidden'].includes(getComputedStyle(n).overflowY),
        );
        expect(scrollers).toEqual([scroll]);
        for (const row of Array.from(el.querySelectorAll<HTMLElement>('[data-testid="simple-list-row"]')).slice(0, 5)) {
          expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        }
        expect(scroll.scrollWidth).withContext('sideways scroll at 720').toBeLessThanOrEqual(scroll.clientWidth);
        fixture.nativeElement.remove();
      });

      it('the phone sheet: card rows, no column header, nothing sideways', async () => {
        configure(language);
        const fixture = TestBed.createComponent(ListHost);
        fixture.componentRef.setInput('width', 390);
        fixture.componentRef.setInput('height', 844 - want.dialogHead);
        document.body.appendChild(fixture.nativeElement);
        fixture.autoDetectChanges(true);
        const list = fixture.debugElement.query((d) => d.componentInstance instanceof SimpleListComponent)!
          .componentInstance as SimpleListComponent<{ id: string }>;
        list.phone.set(true);
        await settle(fixture);
        const el = fixture.nativeElement as HTMLElement;
        const scroll = el.querySelector<HTMLElement>('[data-testid="simple-list-scroll"]')!;
        expect(el.querySelector('[data-testid="simple-list-head"]')).toBeNull();
        const heights = Array.from(el.querySelectorAll<HTMLElement>('[data-testid="simple-list-row"]')).map((r) => Math.round(r.getBoundingClientRect().height));
        measured.push(`${language} phone rows at 390: ${Math.min(...heights)}–${Math.max(...heights)}`);
        expect(Math.min(...heights)).toBeGreaterThanOrEqual(language === 'en' ? 60 : 64);
        expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
        fixture.nativeElement.remove();
      });
    });
  }
});
