import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { SignInLanguageService } from '../../../../core/services/sign-in-language.service';
import { AuthLayoutComponent } from './auth-layout.component';

@Component({
  standalone: true,
  imports: [AuthLayoutComponent],
  template: `<app-auth-layout><p class="projected">Card content</p></app-auth-layout>`,
})
class HostComponent {}

// ACC-120 slice 9e — the frame the sign-in screens share.
describe('AuthLayoutComponent (ACC-120 slice 9e)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let httpMock: HttpTestingController;
  let current: ReturnType<typeof signal<'en' | 'ar'>>;
  let switches: { lang: string; done: Subject<unknown> }[];
  let remembered: string[];

  function setup(opts: { signedIn?: boolean; initial: 'en' | 'ar' }): void {
    current = signal<'en' | 'ar'>('en');
    switches = [];
    remembered = [];
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: AuthService, useValue: { isAuthenticated: () => opts.signedIn ?? false } },
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => current() === 'ar',
            use: (lang: string) => {
              const done = new Subject<unknown>();
              switches.push({ lang, done });
              return done;
            },
          },
        },
        {
          provide: SignInLanguageService,
          useValue: {
            initial: () => opts.initial,
            remember: (lang: string) => remembered.push(lang),
          },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  }

  function land(index: number): void {
    current.set(switches[index].lang as 'en' | 'ar');
    switches[index].done.complete();
    fixture.detectChanges();
  }

  const projected = () => fixture.nativeElement.querySelector('.projected');
  const button = (lang: string): HTMLButtonElement =>
    fixture.nativeElement.querySelector(`button[lang="${lang}"]`);

  afterEach(() => httpMock.verify());

  it('opens in the remembered language, and shows the card only once it is applied', () => {
    setup({ initial: 'ar' });

    expect(switches.map((s) => s.lang)).toEqual(['ar']);
    expect(projected()).toBeNull();

    land(0);
    expect(projected()).not.toBeNull();
  });

  it('shows the card at once when the language is already the right one', () => {
    setup({ initial: 'en' });
    expect(switches).toEqual([]);
    expect(projected()).not.toBeNull();
  });

  it('shows the card even if the translation file fails to load', () => {
    setup({ initial: 'ar' });
    switches[0].done.error(new Error('offline'));
    fixture.detectChanges();
    expect(projected()).not.toBeNull();
  });

  it('leaves a signed-in session in the language it resolved to', () => {
    setup({ signedIn: true, initial: 'ar' });
    expect(switches).toEqual([]);
    expect(projected()).not.toBeNull();
  });

  it('remembers a switch for the next visit, and writes no profile', () => {
    setup({ initial: 'en' });

    button('ar').click();
    expect(remembered).toEqual([]); // not before the switch has landed
    land(0);

    expect(remembered).toEqual(['ar']);
    // No request of any kind: the saved preference is a profile write, and a
    // sign-in screen has no profile to write. httpMock.verify() in afterEach
    // fails on any request made.
    httpMock.expectNone(() => true);
  });
});
