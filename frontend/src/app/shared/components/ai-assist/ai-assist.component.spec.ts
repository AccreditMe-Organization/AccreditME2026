import { Component, TemplateRef, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { AiAssistComponent, AiAssistState } from './ai-assist.component';
import type { AiRefusal } from '../../../core/ai/ai-refusal';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';

@Component({
  standalone: true,
  imports: [AiAssistComponent],
  template: `
    <div [attr.dir]="dir()">
      <am-ai-assist
        [state]="state()"
        triggerLabel="Prepare my briefing"
        againLabel="Make a new briefing"
        [triggerNote]="note()"
        workingText="Preparing your briefing…"
        tag="Your briefing · made by AI"
        [refusal]="refusal()"
        [accept]="accept()"
        [cancellable]="cancellable()"
        [hasResult]="hasResult()"
        [resultTemplate]="body()"
        [collapsible]="collapsible()"
        [clamped]="clamped()"
        [tagNote]="tagNote()"
        collapseLabel="Collapse summary"
        expandLabel="Expand summary"
        (trigger)="events.push('trigger')"
        (retry)="events.push('retry')"
        (cancel)="events.push('cancel')"
        (accepted)="events.push('accepted')"
        (edited)="events.push('edited')"
        (discarded)="events.push('discarded')"
      />
    </div>
    <ng-template #bodyTpl><p class="result-body">Two tasks are overdue.</p></ng-template>
  `,
})
class HostComponent {
  readonly state = signal<AiAssistState>('idle');
  readonly refusal = signal<AiRefusal | null>(null);
  readonly note = signal('');
  readonly accept = signal(false);
  readonly cancellable = signal(false);
  readonly hasResult = signal(false);
  readonly collapsible = signal(false);
  readonly clamped = signal(false);
  readonly tagNote = signal('');
  readonly dir = signal<'ltr' | 'rtl'>('ltr');
  readonly bodyTpl = viewChild<TemplateRef<unknown>>('bodyTpl');
  readonly body = () => this.bodyTpl() ?? null;
  readonly events: string[] = [];
}

describe('AiAssistComponent (ACC-198)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  const el = () => fixture.nativeElement as HTMLElement;
  const trigger = () => el().querySelector('.am-ai__trigger') as HTMLButtonElement;
  const render = () => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'en' })],
    }).compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', en);
    translate.setTranslation('ar', ar);
    translate.use('en');
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    render();
  });

  it('idle: the spark (hidden from screen readers) plus words, never an icon alone', () => {
    expect(trigger().textContent).toContain('Prepare my briefing');
    const mark = trigger().querySelector('.am-ai__mark')!;
    expect(mark.textContent).toBe('✦');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    trigger().click();
    expect(host.events).toEqual(['trigger']);
  });

  it('a quiet note after the words (the briefing\'s "· 5 credits")', () => {
    host.note.set('· 5 credits');
    render();
    expect(trigger().querySelector('.am-ai__note')!.textContent).toBe('· 5 credits');
  });

  it('working: the trigger reads Working…, is disabled and busy; the area shows what it is doing', () => {
    host.state.set('working');
    host.note.set('· 5 credits');
    render();
    expect(trigger().disabled).toBe(true);
    expect(trigger().getAttribute('aria-busy')).toBe('true');
    expect(trigger().textContent).toContain('Working…');
    expect(trigger().querySelector('.am-ai__mark')!.textContent).toBe('◌');
    expect(trigger().querySelector('.am-ai__note')).toBeNull();
    expect(el().querySelector('.am-ai__result--working')!.textContent).toContain('Preparing your briefing…');
    expect(el().querySelector('.am-ai__result--working')!.getAttribute('role')).toBe('status');
  });

  it('Cancel shows while working only when cancellable', () => {
    host.state.set('working');
    render();
    expect(el().querySelector('.am-ai__text-button')).toBeNull();
    host.cancellable.set(true);
    render();
    (el().querySelector('.am-ai__text-button') as HTMLButtonElement).click();
    expect(host.events).toEqual(['cancel']);
  });

  it('result: marked four ways — the ✦, the tag words, a dashed inline-start rule, a tint — and the trigger reads "again"', () => {
    host.state.set('result');
    render();
    const result = el().querySelector('.am-ai__result') as HTMLElement;
    expect(result.querySelector('.am-ai__tag')!.textContent).toContain('✦');
    expect(result.querySelector('.am-ai__tag')!.textContent).toContain('Your briefing · made by AI');
    const style = getComputedStyle(result);
    expect(style.borderLeftStyle).toBe('dashed'); // inline-start in LTR
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(result.querySelector('.result-body')!.textContent).toContain('Two tasks are overdue.');
    expect(trigger().textContent).toContain('Make a new briefing');
  });

  it('in Arabic (RTL) the dashed rule moves to the right edge — still inline-start', () => {
    host.dir.set('rtl');
    host.state.set('result');
    render();
    const style = getComputedStyle(el().querySelector('.am-ai__result') as HTMLElement);
    expect(style.borderRightStyle).toBe('dashed');
    expect(style.borderLeftStyle).not.toBe('dashed');
  });

  it('focus moves to the result when it arrives, and it is announced', async () => {
    host.state.set('result');
    render();
    await fixture.whenStable();
    expect(document.activeElement).toBe(el().querySelector('.am-ai__result'));
    expect(el().querySelector('[aria-live="polite"]')!.textContent).toContain('AI result ready');
  });

  it('Accept / Edit / Discard only when asked for (ACC-197)', () => {
    host.state.set('result');
    render();
    expect(el().querySelector('.am-ai__actions')).toBeNull();
    host.accept.set(true);
    render();
    const buttons = Array.from(el().querySelectorAll('.am-ai__actions button')) as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(['Accept', 'Edit', 'Discard']);
    buttons.forEach((b) => b.click());
    expect(host.events).toEqual(['accepted', 'edited', 'discarded']);
  });

  it('credits used up: the helper\'s words with the date, no Try again', () => {
    host.state.set('refusal');
    host.refusal.set({ kind: 'creditsUsedUp', messageKey: 'ai.refusal.creditsUsedUp', params: { date: '21 Oct 2026' } });
    render();
    const box = el().querySelector('.am-ai__refusal')!;
    expect(box.textContent).toContain('used all its AI credits for this period. They renew on 21 Oct 2026.');
    expect(box.textContent).toContain('◔');
    expect(box.querySelector('button')).toBeNull();
    expect(el().querySelector('[aria-live="polite"]')!.textContent).toContain('They renew on 21 Oct 2026.');
  });

  it('unavailable or failed: the danger box with Try again', () => {
    host.state.set('refusal');
    host.refusal.set({ kind: 'unavailable', messageKey: 'ai.refusal.unavailable', params: {} });
    render();
    const box = el().querySelector('.am-ai__refusal--failed')!;
    expect(box.textContent).toContain("AI isn't available right now.");
    (box.querySelector('button') as HTMLButtonElement).click();
    expect(host.events).toEqual(['retry']);
  });

  it('after a refusal that followed a result, the trigger still reads "again"', () => {
    host.state.set('refusal');
    host.hasResult.set(true);
    host.refusal.set({ kind: 'unavailable', messageKey: 'ai.refusal.unavailable', params: {} });
    render();
    expect(trigger().textContent).toContain('Make a new briefing');
  });

  it('a refusal after a result keeps the earlier result below the refusal, still marked as AI', () => {
    host.state.set('refusal');
    host.hasResult.set(true);
    host.refusal.set({ kind: 'creditsUsedUp', messageKey: 'ai.refusal.creditsUsedUp', params: { date: '21 Oct 2026' } });
    render();
    const refusal = el().querySelector('.am-ai__refusal')!;
    const body = el().querySelector('.result-body')!;
    expect(body.textContent).toContain('Two tasks are overdue.');
    expect(refusal.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el().querySelector('.am-ai__tag')!.textContent).toContain('Your briefing · made by AI');
  });

  it('a refusal with no earlier result shows no result area', () => {
    host.state.set('refusal');
    host.refusal.set({ kind: 'unavailable', messageKey: 'ai.refusal.unavailable', params: {} });
    render();
    expect(el().querySelector('.result-body')).toBeNull();
  });
describe('collapsible and clamped (ACC-193, Q5) — opt-in', () => {
    it('off by default: no fold control, no clamp, the whole result shown (the briefing is unchanged)', () => {
      host.state.set('result');
      render();
      expect(el().querySelector('.am-ai__fold')).toBeNull();
      expect(el().querySelector('.am-ai__body--clamped')).toBeNull();
      expect(el().querySelector('.am-ai__show-all')).toBeNull();
      expect(el().querySelector('.result-body')).not.toBeNull();
    });

    it('collapsible: ▴ on the tag line folds the result to that line, and ▾ opens it again, with its names and state', () => {
      host.state.set('result');
      host.collapsible.set(true);
      render();
      const fold = el().querySelector('.am-ai__fold') as HTMLButtonElement;
      const body = el().querySelector('.am-ai__body') as HTMLElement;
      expect(fold.getAttribute('aria-expanded')).toBe('true');
      expect(fold.getAttribute('aria-label')).toBe('Collapse summary');
      expect(fold.getAttribute('aria-controls')).toBe(body.id);
      expect(fold.textContent?.trim()).toBe('▴');
      expect(body.hidden).toBeFalse();

      fold.click();
      render();
      expect(body.hidden).toBeTrue();
      expect(fold.getAttribute('aria-expanded')).toBe('false');
      expect(fold.getAttribute('aria-label')).toBe('Expand summary');
      expect(fold.textContent?.trim()).toBe('▾');
      // The tag line stays: the result folds TO it.
      expect(el().querySelector('.am-ai__tag')?.textContent).toContain('Your briefing · made by AI');

      fold.click();
      render();
      expect(body.hidden).toBeFalse();
    });

    it('clamped: opens at two lines with "Show all", which shows everything and goes away', () => {
      host.state.set('result');
      host.clamped.set(true);
      render();
      const body = el().querySelector('.am-ai__body') as HTMLElement;
      expect(body.classList).toContain('am-ai__body--clamped');
      const showAll = el().querySelector('.am-ai__show-all') as HTMLButtonElement;
      expect(showAll.textContent?.trim()).toBe('Show all');
      expect(showAll.getAttribute('aria-controls')).toBe(body.id);
      showAll.click();
      render();
      expect(body.classList).not.toContain('am-ai__body--clamped');
      expect(el().querySelector('.am-ai__show-all')).toBeNull();
    });

    it('tagNote: a quiet line under the tag, OUTSIDE the clamp, gone when folded', () => {
      host.state.set('result');
      host.clamped.set(true);
      host.collapsible.set(true);
      host.tagNote.set('Summary made 9 Oct 2026 · saved');
      render();
      const note = el().querySelector('.am-ai__tag-note') as HTMLElement;
      expect(note.textContent?.trim()).toBe('Summary made 9 Oct 2026 · saved');
      expect(el().querySelector('.am-ai__body')!.contains(note)).toBeFalse();
      (el().querySelector('.am-ai__fold') as HTMLButtonElement).click();
      render();
      expect(el().querySelector('.am-ai__tag-note')).toBeNull();
    });

    it('the clamp is two lines of the body\'s own line height', () => {
      host.state.set('result');
      host.clamped.set(true);
      render();
      const body = el().querySelector('.am-ai__body') as HTMLElement;
      const line = parseFloat(getComputedStyle(body).getPropertyValue('--am-type-body-line')) || 21;
      // Non-vacuity: the line height is a real length, so "two lines" means something.
      expect(line).toBeGreaterThan(0);
      expect(getComputedStyle(body).overflow).toBe('hidden');
      expect(parseFloat(getComputedStyle(body).maxHeight)).toBeCloseTo(line * 2, 0);
    });
  });
});

// ── ACC-197 — the split: a trigger in one place, its result in another ─────

@Component({
  standalone: true,
  imports: [AiAssistComponent],
  template: `
    <div class="label-row">
      <am-ai-assist
        class="trigger-half"
        [state]="state()"
        triggerLabel="Draft with AI"
        [hideResult]="true"
        [labelRow]="labelRow()"
        [cancellable]="true"
        [resultTemplate]="body()"
        tag="AI suggestion"
        workingText="Drafting…"
        [refusal]="refusal()"
      />
    </div>
    <am-ai-assist
      class="result-half"
      [state]="state()"
      triggerLabel=""
      [hideTrigger]="true"
      [accept]="accept()"
      [actionsExtra]="extra()"
      [resultTemplate]="body()"
      tag="AI suggestion"
      workingText="Drafting…"
      [refusal]="refusal()"
    />
    <ng-template #bodyTpl><p class="result-body">Check every dispenser.</p></ng-template>
    <ng-template #extraTpl><button type="button" class="host-action" (click)="events.push('extra')">Use this title</button></ng-template>
  `,
})
class SplitHostComponent {
  readonly state = signal<AiAssistState>('idle');
  readonly refusal = signal<AiRefusal | null>(null);
  readonly labelRow = signal(false);
  readonly accept = signal(true);
  readonly withExtra = signal(false);
  readonly bodyTpl = viewChild<TemplateRef<unknown>>('bodyTpl');
  readonly extraTpl = viewChild<TemplateRef<unknown>>('extraTpl');
  readonly body = () => this.bodyTpl() ?? null;
  readonly extra = () => (this.withExtra() ? (this.extraTpl() ?? null) : null);
  readonly events: string[] = [];
}

describe('the split — hideResult, labelRow, actionsExtra (ACC-197) — opt-in', () => {
  let fixture: ComponentFixture<SplitHostComponent>;
  let host: SplitHostComponent;
  const el = () => fixture.nativeElement as HTMLElement;
  const half = (name: 'trigger' | 'result') => el().querySelector(`.${name}-half`) as HTMLElement;
  const render = () => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SplitHostComponent],
      providers: [provideTranslateService({ lang: 'en' })],
    }).compileComponents();
    TestBed.inject(TranslateService).setTranslation('en', en);
    fixture = TestBed.createComponent(SplitHostComponent);
    host = fixture.componentInstance;
    render();
  });

  it('hideResult: the trigger alone — no working line, no result, no refusal, and nothing announced twice', () => {
    for (const state of ['working', 'result', 'refusal'] as const) {
      host.refusal.set(state === 'refusal' ? { kind: 'unavailable', messageKey: 'ai.refusal.unavailable', params: {} } : null);
      host.state.set(state);
      render();
      expect(half('trigger').querySelector('.am-ai__trigger')).withContext(state).not.toBeNull();
      expect(half('trigger').querySelector('.am-ai__result, .am-ai__refusal, [aria-live]')).withContext(state).toBeNull();
      expect(half('result').querySelector('.am-ai__trigger')).withContext(state).toBeNull();
      expect(half('result').querySelector('.am-ai__result, .am-ai__refusal')).withContext(state).not.toBeNull();
    }
    // Exactly one live region for the pair.
    expect(el().querySelectorAll('[aria-live]').length).toBe(1);
  });

  it('labelRow: the trigger, and Cancel beside it, are exactly one label line tall (1.25rem) — off by default', () => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const trigger = () => half('trigger').querySelector('.am-ai__trigger') as HTMLElement;
    const natural = trigger().getBoundingClientRect().height;
    expect(natural).withContext('off by default: the trigger keeps its own height').toBeGreaterThan(1.25 * rem);

    host.labelRow.set(true);
    host.state.set('working');
    render();
    expect(trigger().getBoundingClientRect().height).toBeCloseTo(1.25 * rem, 1);
    const cancel = half('trigger').querySelector('.am-ai__trigger-row .am-ai__text-button') as HTMLElement;
    expect(cancel.textContent).toContain('Cancel');
    expect(cancel.getBoundingClientRect().height).toBeCloseTo(1.25 * rem, 1);
  });

  it("actionsExtra: the host's own action at the far end of Accept · Edit · Discard — and only with accept", () => {
    host.state.set('result');
    render();
    const actions = () => Array.from(half('result').querySelectorAll('.am-ai__actions button')).map((b) => b.textContent!.trim());
    expect(actions()).withContext('null by default').toEqual(['Accept', 'Edit', 'Discard']);

    host.withExtra.set(true);
    render();
    expect(actions()).toEqual(['Accept', 'Edit', 'Discard', 'Use this title']);
    (half('result').querySelector('.host-action') as HTMLButtonElement).click();
    expect(host.events).toEqual(['extra']);

    host.accept.set(false);
    render();
    expect(half('result').querySelector('.host-action')).toBeNull();
  });
});
