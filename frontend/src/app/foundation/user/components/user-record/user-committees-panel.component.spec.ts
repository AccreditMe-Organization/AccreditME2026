import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { Observable, Subject } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { FormatService } from '../../../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { IUserCommitteeDto, IUserCommitteesDto, UserService } from '../../services/user.service';
import { UserCommitteesPanelComponent } from './user-committees-panel.component';

// ACC-216 — the Committees panel on its own: rows, empty, error with Retry, a
// refused read (absent, host hidden), the over-cap line, Arabic. Absent WITHOUT
// committees:view is the record page's decision, pinned in its spec (test 16).

@Component({
  standalone: true,
  imports: [UserCommitteesPanelComponent],
  template: `<app-user-committees-panel userId="user-1" />`,
})
class HostComponent {}

const membership = (over: Partial<IUserCommitteeDto> & { id: string }): IUserCommitteeDto => ({
  committee: { id: over.id, nameEn: `Committee ${over.id}`, nameAr: `لجنة ${over.id}` },
  seat: { id: 'seat-member', labelEn: 'Member', labelAr: 'عضو', layer: 'SYSTEM' },
  joinedAt: '2026-03-01T09:00:00.000Z',
  leftAt: null,
  current: true,
  ...over,
});

describe('UserCommitteesPanelComponent (ACC-216)', () => {
  let answers: Subject<IUserCommitteesDto>[];

  function render(arabic = false) {
    answers = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        {
          provide: UserService,
          useValue: {
            getCommittees: (): Observable<IUserCommitteesDto> => {
              const s = new Subject<IUserCommitteesDto>();
              answers.push(s);
              return s;
            },
          },
        },
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => arabic,
            isRtl: () => arabic,
            bilingual: (en: string, ar: string | null) => (arabic ? ar || en : en),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(arabic ? 'ar' : 'en');
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const answer = (value: IUserCommitteesDto | HttpErrorResponse) => {
      const s = answers[answers.length - 1]!;
      if (value instanceof HttpErrorResponse) s.error(value);
      else {
        s.next(value);
        s.complete();
      }
      fixture.detectChanges();
    };
    return { fixture, el, answer, format: TestBed.inject(FormatService) };
  }

  const rowsOf = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-committee-row]')).map((r) => ({
      kind: r.getAttribute('data-committee-row'),
      name: r.querySelector('[data-committee-link]')!.textContent!.trim(),
      href: r.querySelector('[data-committee-link]')!.getAttribute('href'),
      detail: r.querySelector('[data-committee-detail]')!.textContent!.trim(),
    }));

  it('rows: the committee linked, the seat, "Since" for a current one and a range for a past one', () => {
    const { el, answer, format } = render();
    answer({
      total: 3,
      rows: [
        membership({ id: 'c1' }),
        membership({
          id: 'c2',
          current: false,
          leftAt: '2026-05-01T09:00:00.000Z',
          joinedAt: '2025-03-01T09:00:00.000Z',
          seat: { id: 'seat-sec', labelEn: 'Secretary', labelAr: 'أمين السر', layer: 'SYSTEM' },
        }),
        membership({ id: 'c3', current: false }),
      ],
    });
    const joined = format.date('2026-03-01T09:00:00.000Z');
    expect(rowsOf(el)).toEqual([
      { kind: 'current', name: 'Committee c1', href: '/committees/c1', detail: `Member · Since ${joined}` },
      {
        kind: 'past',
        name: 'Committee c2',
        href: '/committees/c2',
        detail: `Secretary · ${format.date('2025-03-01T09:00:00.000Z')} – ${format.date('2026-05-01T09:00:00.000Z')}`,
      },
      { kind: 'past', name: 'Committee c3', href: '/committees/c3', detail: `Member · Since ${joined} · Committee inactive` },
    ]);
    expect(el.querySelector('[data-panel="committees"]')!.textContent).toContain('Committees');
    expect(el.querySelector('[data-committees-over-cap]')).toBeNull();
  });

  it('empty: "Not on any committee.", never a blank panel', () => {
    const { el, answer } = render();
    answer({ total: 0, rows: [] });
    const panel = el.querySelector<HTMLElement>('[data-panel="committees"]')!;
    expect(panel.getAttribute('data-outcome')).toBe('empty');
    expect(panel.textContent).toContain('Not on any committee.');
    expect(el.querySelectorAll('[data-committee-row]').length).toBe(0);
    // CC-342 — a plain line, as Sub-committees says it; no icon box.
    expect(panel.querySelector('[data-panel-empty-line]')!.textContent!.trim()).toBe('Not on any committee.');
    expect(panel.querySelector('.border-dashed')).toBeNull();
  });

  it('error: its own message and Retry, which asks again', () => {
    const { el, answer, fixture } = render();
    answer(new HttpErrorResponse({ status: 500 }));
    const error = el.querySelector<HTMLElement>('[data-panel="committees"] [data-panel-error]')!;
    expect(error).not.toBeNull();
    expect(error.textContent).toContain("Committees couldn't be loaded.");
    (error.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(answers.length).toBe(2);
    answer({ total: 1, rows: [membership({ id: 'c1' })] });
    expect(el.querySelector('[data-panel-error]')).toBeNull();
    expect(rowsOf(el).length).toBe(1);
  });

  it('a refused read (403): the panel is absent, its host hidden too', () => {
    const { el, answer } = render();
    answer(new HttpErrorResponse({ status: 403 }));
    const host = el.querySelector<HTMLElement>('app-user-committees-panel')!;
    expect(host.style.display).toBe('none');
  });

  it('past the 200 the server returns, a line says how many are shown', () => {
    const { el, answer } = render();
    answer({ total: 230, rows: [membership({ id: 'c1' }), membership({ id: 'c2' })] });
    expect(el.querySelector('[data-committees-over-cap]')!.textContent!.trim()).toBe('Showing 2 of 230');
  });

  it('Arabic: the heading, the names, the seat and "منذ" in Arabic', () => {
    const { el, answer, format } = render(true);
    answer({ total: 1, rows: [membership({ id: 'c1' })] });
    expect(el.querySelector('[data-panel="committees"]')!.textContent).toContain('اللجان');
    expect(rowsOf(el)[0]).toEqual({
      kind: 'current',
      name: 'لجنة c1',
      href: '/committees/c1',
      detail: `عضو · منذ ${format.date('2026-03-01T09:00:00.000Z')}`,
    });
  });

  it('Arabic empty: «لا عضوية في أي لجنة.»', () => {
    const { el, answer } = render(true);
    answer({ total: 0, rows: [] });
    expect(el.querySelector('[data-panel="committees"]')!.textContent).toContain('لا عضوية في أي لجنة.');
  });

  // CC-276 — the retired #718096 (4.02:1 on white) stays out of THIS template:
  // meta text is ink-500. Read from the compiled definition's static attributes,
  // which hold this component's own class strings and none of the shared
  // record-panel frame's (that frame is retired separately). The ink-500 guard
  // runs first, so an empty read cannot pass.
  it('its template uses no retired --am-text-secondary', () => {
    const def = (UserCommitteesPanelComponent as unknown as { ɵcmp: { consts: unknown } }).ɵcmp;
    const template = JSON.stringify(typeof def.consts === 'function' ? (def.consts as () => unknown)() : def.consts);
    expect(template).withContext('the template classes were read').toContain('--am-ink-500');
    expect(template).not.toContain('--am-text-secondary');
  });
});
