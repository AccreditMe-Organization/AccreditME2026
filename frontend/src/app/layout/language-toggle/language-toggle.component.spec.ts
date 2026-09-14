import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { LanguageToggleComponent } from './language-toggle.component';
import { LanguageService } from '../../core/services/language.service';

// ACC-79 — the session reading-mode toggle. The test that matters most is the
// one that proves it writes nothing: flipping to English to read something
// must not change the saved preference that decides a user's email language.
describe('LanguageToggleComponent (ACC-79)', () => {
  let lang: ReturnType<typeof signal<'en' | 'ar'>>;
  let use: jasmine.Spy;
  let pending: Subject<unknown>;

  function render(initial: 'en' | 'ar' = 'en') {
    lang = signal(initial);
    pending = new Subject<unknown>();
    use = jasmine.createSpy('use').and.callFake((next: 'en' | 'ar') => {
      lang.set(next);
      return pending.asObservable();
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LanguageToggleComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en' }),
        {
          provide: LanguageService,
          useValue: { use, isArabic: () => lang() === 'ar' },
        },
      ],
    });
    const fixture = TestBed.createComponent(LanguageToggleComponent);
    fixture.detectChanges();
    const buttons = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      );
    return { fixture, buttons };
  }

  it('marks the current language as pressed', () => {
    const { buttons } = render('en');
    expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
    ]);
  });

  it('switches the interface through LanguageService', () => {
    const { fixture, buttons } = render('en');
    buttons()[1]!.click();
    pending.complete();
    fixture.detectChanges();

    expect(use).toHaveBeenCalledOnceWith('ar');
    expect(buttons()[1]!.getAttribute('aria-pressed')).toBe('true');
  });

  // Session-scoped: the saved preference lives behind PATCH /users/:id/profile
  // and drives email language. The toggle must never reach it.
  it('sends no request of its own — it does not write the saved preference', () => {
    const { buttons } = render('en');
    buttons()[1]!.click();
    pending.complete();

    TestBed.inject(HttpTestingController).verify();
  });

  it('does nothing when the current language is chosen again', () => {
    const { buttons } = render('ar');
    buttons()[1]!.click();
    expect(use).not.toHaveBeenCalled();
  });

  it('is disabled while a switch is loading, so a double click cannot race it', () => {
    const { fixture, buttons } = render('en');
    buttons()[1]!.click();
    fixture.detectChanges();
    expect(buttons().every((b) => b.disabled)).toBe(true);

    pending.complete();
    fixture.detectChanges();
    expect(buttons().some((b) => b.disabled)).toBe(false);
  });

  it('labels each option in its own language', () => {
    const { buttons } = render('en');
    expect(
      buttons().map((b) => [b.getAttribute('lang'), b.getAttribute('aria-label')]),
    ).toEqual([
      ['en', 'English'],
      ['ar', 'العربية'],
    ]);
  });
});
